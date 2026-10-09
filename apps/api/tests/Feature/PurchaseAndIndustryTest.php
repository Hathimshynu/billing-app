<?php

namespace Tests\Feature;

use App\Models\ProductBatch;
use App\Models\ProductSerial;
use App\Models\Purchase;
use App\Models\Sale;
use App\Models\SyncConflict;
use App\Services\Ledger\LedgerService;
use Illuminate\Support\Str;
use Tests\TestCase;

class PurchaseAndIndustryTest extends TestCase
{
    /** @return array<string, mixed> */
    private function purchasePayload($business, string $supplierId, string $productId, float $qty, float $cost, array $item = [], array $overrides = []): array
    {
        $store = $this->defaultStore($business);

        return $overrides + [
            'store_id' => $store->id,
            'supplier_id' => $supplierId,
            'doc_type' => 'invoice',
            'purchase_date' => now()->toDateString(),
            'supply_type' => 'intra',
            'items' => [$item + [
                'id' => (string) Str::uuid(),
                'product_id' => $productId,
                'name' => 'Purchased item',
                'quantity' => $qty,
                'unit_cost' => $cost,
                'price_includes_tax' => false,
                'tax' => null,
            ]],
        ];
    }

    public function test_purchase_invoice_adds_stock_and_supplier_payable(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $device = $this->registerDevice($token, $business);
        $supplierId = (string) Str::uuid();
        $productId = (string) Str::uuid();
        $purchaseId = (string) Str::uuid();

        $this->push($token, $business, $device, [
            $this->op('CREATE_SUPPLIER', 'supplier', $supplierId, ['name' => 'Agro Distributors', 'credit_days' => 30, 'active' => true], $owner->id),
            $this->op('CREATE_PRODUCT', 'product', $productId, $this->productPayload(), $owner->id),
            $this->op('CREATE_PURCHASE', 'purchase', $purchaseId, $this->purchasePayload($business, $supplierId, $productId, 20, 50, [], [
                'payments' => [['id' => (string) Str::uuid(), 'method' => 'bank_transfer', 'amount' => 400]],
            ]), $owner->id),
        ])->assertJsonCount(3, 'accepted');

        $this->assertSame(20.0, $this->stockOf($business, $productId));
        $this->assertSame(600.0, $this->inTenant($business, fn () => app(LedgerService::class)->supplierBalance($supplierId)));
        $purchase = $this->inTenant($business, fn () => Purchase::query()->find($purchaseId));
        $this->assertSame('partial', $purchase->payment_status);
        $this->assertSame(50.0, $this->product($business, $productId)->purchase_price);
    }

    public function test_purchase_order_partial_receiving_and_return(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $device = $this->registerDevice($token, $business);
        $supplierId = (string) Str::uuid();
        $productId = (string) Str::uuid();
        $poId = (string) Str::uuid();
        $payload = $this->purchasePayload($business, $supplierId, $productId, 10, 40, [], ['doc_type' => 'order']);

        $this->push($token, $business, $device, [
            $this->op('CREATE_SUPPLIER', 'supplier', $supplierId, ['name' => 'Tools Co', 'active' => true], $owner->id),
            $this->op('CREATE_PRODUCT', 'product', $productId, $this->productPayload(), $owner->id),
            $this->op('CREATE_PURCHASE', 'purchase', $poId, $payload, $owner->id),
        ])->assertJsonCount(3, 'accepted');
        $this->assertSame(0.0, $this->stockOf($business, $productId), 'Orders do not move stock');

        $lineId = $payload['items'][0]['id'];
        $this->push($token, $business, $device, [
            $this->op('RECEIVE_PURCHASE', 'purchase', $poId, ['items' => [['purchase_item_id' => $lineId, 'quantity' => 6]]], $owner->id),
        ])->assertJsonCount(1, 'accepted');
        $this->assertSame(6.0, $this->stockOf($business, $productId));
        $this->assertSame('partially_received', $this->inTenant($business, fn () => Purchase::query()->find($poId))->status);
        $this->assertSame(240.0, $this->inTenant($business, fn () => app(LedgerService::class)->supplierBalance($supplierId)));

        $this->push($token, $business, $device, [
            $this->op('RECEIVE_PURCHASE', 'purchase', $poId, ['items' => [['purchase_item_id' => $lineId, 'quantity' => 4]]], $owner->id),
            $this->op('CREATE_PURCHASE_RETURN', 'purchase_return', (string) Str::uuid(), [
                'purchase_id' => $poId, 'return_date' => now()->toDateString(), 'occurred_at' => now()->toIso8601String(),
                'items' => [['id' => (string) Str::uuid(), 'purchase_item_id' => $lineId, 'quantity' => 2]],
            ], $owner->id),
        ])->assertJsonCount(2, 'accepted');

        $this->assertSame('received', $this->inTenant($business, fn () => Purchase::query()->find($poId))->status);
        $this->assertSame(8.0, $this->stockOf($business, $productId));
        $this->assertSame(320.0, $this->inTenant($business, fn () => app(LedgerService::class)->supplierBalance($supplierId)));
    }

    public function test_pharmacy_batches_from_purchase_and_expired_sale_flag(): void
    {
        [$owner, $business, $token] = $this->createOwner('pharmacy');
        [$cashier] = $this->addMember($business, 'cashier');
        $device = $this->registerDevice($token, $business);
        $supplierId = (string) Str::uuid();
        $productId = (string) Str::uuid();
        $expiredBatchId = (string) Str::uuid();

        $this->push($token, $business, $device, [
            $this->op('CREATE_SUPPLIER', 'supplier', $supplierId, ['name' => 'Pharma Dist', 'active' => true], $owner->id),
            $this->op('CREATE_PRODUCT', 'product', $productId, $this->productPayload([
                'name' => 'Paracetamol 500mg', 'track_batch' => true, 'track_expiry' => true, 'selling_price' => 22, 'mrp' => 25,
                'attributes' => ['generic_name' => 'Paracetamol', 'schedule' => 'H', 'prescription_required' => false],
            ]), $owner->id),
            $this->op('CREATE_PURCHASE', 'purchase', (string) Str::uuid(), $this->purchasePayload($business, $supplierId, $productId, 100, 15, [
                'batch_no' => 'ABC123', 'expiry_date' => now()->addYears(2)->toDateString(), 'mrp' => 25,
            ]), $owner->id),
            $this->op('CREATE_PURCHASE', 'purchase', (string) Str::uuid(), $this->purchasePayload($business, $supplierId, $productId, 10, 15, [
                'batch_id' => $expiredBatchId, 'batch_no' => 'OLD001', 'expiry_date' => now()->subMonth()->toDateString(),
            ]), $owner->id),
        ])->assertJsonCount(4, 'accepted');

        $batches = $this->inTenant($business, fn () => ProductBatch::query()->where('product_id', $productId)->get());
        $this->assertCount(2, $batches);
        $this->assertTrue($batches->contains('id', $expiredBatchId), 'Device supplied batch id is preserved');
        $this->assertSame(110.0, $this->stockOf($business, $productId));

        $sale = $this->salePayload($business, $productId, 1, 22, ['items' => [['batch_id' => $expiredBatchId]]]);
        $response = $this->push($token, $business, $device, [$this->op('CREATE_SALE', 'sale', (string) Str::uuid(), $sale, $cashier->id)]);
        $this->assertContains('expired_batch_sold', $response->json('accepted.0.result.review_flags'));
        $this->assertDatabaseHas('app_notifications', ['type' => 'expired_batch_sold']);
    }

    public function test_imei_tracking_warranty_and_double_sale_conflict(): void
    {
        [$owner, $business, $token] = $this->createOwner('mobile');
        $a = $this->registerDevice($token, $business);
        $b = $this->registerDevice($token, $business);
        $supplierId = (string) Str::uuid();
        $productId = (string) Str::uuid();
        $serialId = (string) Str::uuid();

        $this->push($token, $business, $a, [
            $this->op('CREATE_SUPPLIER', 'supplier', $supplierId, ['name' => 'Mobile Dist', 'active' => true], $owner->id),
            $this->op('CREATE_PRODUCT', 'product', $productId, $this->productPayload(['name' => 'Galaxy A55', 'track_serial' => true, 'warranty_months' => 12, 'selling_price' => 31999, 'mrp' => 35999]), $owner->id),
            $this->op('CREATE_PURCHASE', 'purchase', (string) Str::uuid(), $this->purchasePayload($business, $supplierId, $productId, 1, 27000, [
                'serial_numbers' => ['356938035643809'], 'serial_ids' => [$serialId],
            ]), $owner->id),
        ])->assertJsonCount(3, 'accepted');

        $serial = $this->inTenant($business, fn () => ProductSerial::query()->find($serialId));
        $this->assertSame('in_stock', $serial->status);
        $this->assertSame('356938035643809', $serial->imei1);

        $saleA = (string) Str::uuid();
        $payloadA = $this->salePayload($business, $productId, 1, 31999, ['items' => [['serial_ids' => [$serialId], 'serial_numbers' => ['356938035643809']]]]);
        $this->push($token, $business, $a, [$this->op('CREATE_SALE', 'sale', $saleA, $payloadA, $owner->id)])->assertJsonCount(1, 'accepted');

        $serial->refresh();
        $this->assertSame('sold', $serial->status);
        $this->assertSame($saleA, $serial->sale_id);
        $this->assertNotNull($serial->warranty_expires_at);

        // Device B sold the same phone while offline: sale accepted, conflict recorded for review.
        $payloadB = $this->salePayload($business, $productId, 1, 31999, ['items' => [['serial_ids' => [$serialId], 'serial_numbers' => ['356938035643809']]]]);
        $this->push($token, $business, $b, [$this->op('CREATE_SALE', 'sale', (string) Str::uuid(), $payloadB, $owner->id)])->assertJsonCount(1, 'accepted');

        $this->assertSame(2, $this->inTenant($business, fn () => Sale::query()->count()));
        $this->assertTrue($this->inTenant($business, fn () => SyncConflict::query()->where('conflict_type', 'serial_double_sale')->exists()));
        $this->assertSame($saleA, $serial->refresh()->sale_id, 'First sale keeps the IMEI');
    }

    public function test_variants_are_saved_with_the_product_aggregate(): void
    {
        [$owner, $business, $token] = $this->createOwner('clothing');
        $device = $this->registerDevice($token, $business);
        $productId = (string) Str::uuid();
        $variantS = (string) Str::uuid();
        $variantM = (string) Str::uuid();

        $this->push($token, $business, $device, [
            $this->op('CREATE_PRODUCT', 'product', $productId, $this->productPayload([
                'name' => 'Classic Tee', 'has_variants' => true,
                'variant_attributes' => [['name' => 'Size', 'values' => ['S', 'M']], ['name' => 'Color', 'values' => ['Black']]],
                'variants' => [
                    ['id' => $variantS, 'name' => 'S / Black', 'sku' => 'TEE-S-BLK', 'barcode' => '2000000000011', 'attributes' => ['Size' => 'S', 'Color' => 'Black'], 'selling_price' => 499, 'active' => true, 'sort_order' => 0],
                    ['id' => $variantM, 'name' => 'M / Black', 'sku' => 'TEE-M-BLK', 'barcode' => '2000000000028', 'attributes' => ['Size' => 'M', 'Color' => 'Black'], 'selling_price' => 499, 'active' => true, 'sort_order' => 1],
                ],
            ]), $owner->id),
        ])->assertJsonCount(1, 'accepted');

        $data = $this->getJson("/api/v1/products/{$productId}", $this->headers($token, $business))->assertOk()->json('data');
        $this->assertCount(2, $data['variants']);
        $this->assertSame('M', $data['variants'][1]['attributes']['Size']);

        // Removing a variant through an update.
        $this->push($token, $business, $device, [
            $this->op('UPDATE_PRODUCT', 'product', $productId, ['changes' => ['variants' => [$data['variants'][0]]], 'base' => ['variants' => $data['variants']]], $owner->id, $data['version']),
        ])->assertJsonCount(1, 'accepted');
        $this->assertCount(1, $this->getJson("/api/v1/products/{$productId}", $this->headers($token, $business))->json('data.variants'));
    }
}
