<?php

namespace Tests\Feature;

use App\Models\InventoryMovement;
use App\Models\Sale;
use App\Models\SyncOperation;
use Illuminate\Support\Str;
use Tests\TestCase;

class SyncPushTest extends TestCase
{
    public function test_offline_sale_is_accepted_and_reduces_stock(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $device = $this->registerDevice($token, $business);
        $productId = $this->createStockedProduct($token, $business, $device, $owner->id, 10);

        $saleId = (string) Str::uuid();
        $response = $this->push($token, $business, $device, [
            $this->op('CREATE_SALE', 'sale', $saleId, $this->salePayload($business, $productId, 2), $owner->id),
        ])->assertOk();

        $response->assertJsonCount(1, 'accepted')->assertJsonCount(0, 'rejected')->assertJsonCount(0, 'conflicts');
        $this->assertFalse($response->json('accepted.0.duplicate'));
        $this->assertSame('sale', $response->json('server_changes.0.entity_type'));
        $this->assertSame(8.0, $this->stockOf($business, $productId));
        $this->assertSame([], $this->inTenant($business, fn () => Sale::query()->find($saleId)->review_flags));
    }

    public function test_replaying_the_same_operation_does_not_duplicate_the_sale(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $device = $this->registerDevice($token, $business);
        $productId = $this->createStockedProduct($token, $business, $device, $owner->id, 10);

        $op = $this->op('CREATE_SALE', 'sale', (string) Str::uuid(), $this->salePayload($business, $productId, 3), $owner->id);
        $first = $this->push($token, $business, $device, [$op])->assertOk();
        // Network dropped before the device saw the response: it retries the very same operation.
        $second = $this->push($token, $business, $device, [$op])->assertOk();

        $this->assertFalse($first->json('accepted.0.duplicate'));
        $this->assertTrue($second->json('accepted.0.duplicate'));
        $this->assertSame($first->json('accepted.0.result.invoice_number'), $second->json('accepted.0.result.invoice_number'));
        $this->assertSame(1, $this->inTenant($business, fn () => Sale::query()->count()));
        $this->assertSame(7.0, $this->stockOf($business, $productId));
        $this->assertSame(1, $this->inTenant($business, fn () => InventoryMovement::query()->where('type', 'SALE')->count()));
    }

    public function test_same_sale_pushed_with_a_new_operation_id_is_still_deduplicated(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $device = $this->registerDevice($token, $business);
        $productId = $this->createStockedProduct($token, $business, $device, $owner->id, 10);

        $saleId = (string) Str::uuid();
        $payload = $this->salePayload($business, $productId, 1);
        $this->push($token, $business, $device, [$this->op('CREATE_SALE', 'sale', $saleId, $payload, $owner->id)]);
        $again = $this->push($token, $business, $device, [$this->op('CREATE_SALE', 'sale', $saleId, $payload, $owner->id)]);

        $this->assertTrue($again->json('accepted.0.duplicate'));
        $this->assertSame(1, $this->inTenant($business, fn () => Sale::query()->count()));
        $this->assertSame(9.0, $this->stockOf($business, $productId));
    }

    public function test_operations_referencing_unsynced_records_are_retryable(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $device = $this->registerDevice($token, $business);

        $missingProduct = (string) Str::uuid();
        $op = $this->op('CREATE_SALE', 'sale', (string) Str::uuid(), $this->salePayload($business, $missingProduct, 1), $owner->id);
        $response = $this->push($token, $business, $device, [$op])->assertOk();

        $this->assertSame('dependency_missing', $response->json('rejected.0.code'));
        $this->assertTrue($response->json('rejected.0.retryable'));
        // Retryable rejections are not recorded, so the same operation succeeds once the product exists.
        $this->assertFalse(SyncOperation::query()->where('operation_id', $op['operation_id'])->exists());

        $this->push($token, $business, $device, [
            $this->op('CREATE_PRODUCT', 'product', $missingProduct, $this->productPayload(), $owner->id),
            $op,
        ])->assertJsonCount(2, 'accepted');
    }

    public function test_invalid_payloads_are_rejected_permanently_and_stored(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $device = $this->registerDevice($token, $business);
        $op = $this->op('CREATE_PRODUCT', 'product', (string) Str::uuid(), ['name' => ''], $owner->id);

        $response = $this->push($token, $business, $device, [$op]);
        $this->assertSame('validation_failed', $response->json('rejected.0.code'));
        $this->assertFalse($response->json('rejected.0.retryable'));
        $this->assertArrayHasKey('name', $response->json('rejected.0.errors'));

        // Replay returns the stored rejection.
        $this->assertSame('validation_failed', $this->push($token, $business, $device, [$op])->json('rejected.0.code'));
    }

    public function test_partial_batches_apply_valid_operations(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $device = $this->registerDevice($token, $business);

        $response = $this->push($token, $business, $device, [
            $this->op('CREATE_CUSTOMER', 'customer', (string) Str::uuid(), ['name' => 'Ravi', 'active' => true], $owner->id),
            $this->op('CREATE_CUSTOMER', 'customer', (string) Str::uuid(), ['name' => '', 'active' => true], $owner->id),
            $this->op('CREATE_SUPPLIER', 'supplier', (string) Str::uuid(), ['name' => 'Wholesale Traders', 'active' => true], $owner->id),
            $this->op('NOT_A_REAL_OPERATION', 'customer', (string) Str::uuid(), [], $owner->id),
        ])->assertOk();

        $response->assertJsonCount(2, 'accepted')->assertJsonCount(2, 'rejected');
        $this->assertSame('unknown_operation', $response->json('rejected.1.code'));
    }

    public function test_two_devices_selling_offline_converge_to_correct_stock(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $counter1 = $this->registerDevice($token, $business, null, 'Counter 1');
        $counter2 = $this->registerDevice($token, $business, null, 'Counter 2');
        $productId = $this->createStockedProduct($token, $business, $counter1, $owner->id, 10);

        // Both devices saw stock = 10 while offline; A sold 2 and B sold 3.
        $this->push($token, $business, $counter1, [$this->op('CREATE_SALE', 'sale', (string) Str::uuid(), $this->salePayload($business, $productId, 2), $owner->id)])->assertJsonCount(1, 'accepted');
        $this->push($token, $business, $counter2, [$this->op('CREATE_SALE', 'sale', (string) Str::uuid(), $this->salePayload($business, $productId, 3), $owner->id)])->assertJsonCount(1, 'accepted');

        $this->assertSame(5.0, $this->stockOf($business, $productId));

        // Both devices pull the same authoritative stock level.
        $level = collect($this->pull($token, $business, $counter2)->json('changes'))->firstWhere('entity_type', 'stock_level');
        $this->assertSame(5, (int) $level['data']['qty']);
    }

    public function test_overselling_offline_is_accepted_and_goes_negative(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $a = $this->registerDevice($token, $business);
        $b = $this->registerDevice($token, $business);
        $productId = $this->createStockedProduct($token, $business, $a, $owner->id, 2);

        $this->push($token, $business, $a, [$this->op('CREATE_SALE', 'sale', (string) Str::uuid(), $this->salePayload($business, $productId, 2), $owner->id)]);
        $this->push($token, $business, $b, [$this->op('CREATE_SALE', 'sale', (string) Str::uuid(), $this->salePayload($business, $productId, 1), $owner->id)])
            ->assertJsonCount(1, 'accepted');

        // Financial transactions are never discarded; the ledger shows the oversell.
        $this->assertSame(-1.0, $this->stockOf($business, $productId));
    }

    public function test_totals_that_do_not_reprice_are_flagged_not_rejected(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $device = $this->registerDevice($token, $business);
        $productId = $this->createStockedProduct($token, $business, $device, $owner->id, 10);

        $saleId = (string) Str::uuid();
        $payload = $this->salePayload($business, $productId, 1, 100, ['grand_total' => 90]);
        $this->push($token, $business, $device, [$this->op('CREATE_SALE', 'sale', $saleId, $payload, $owner->id)])
            ->assertJsonCount(1, 'accepted')
            ->assertJsonPath('accepted.0.result.review_flags.0', 'totals_mismatch');

        $sale = $this->inTenant($business, fn () => Sale::query()->find($saleId));
        $this->assertSame(90.0, $sale->grand_total, 'The amount actually charged is preserved');
        $this->assertEquals(100, $sale->meta['server_grand_total']);
    }
}
