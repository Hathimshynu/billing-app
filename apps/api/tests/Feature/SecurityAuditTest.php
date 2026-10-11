<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessSetting;
use App\Models\BusinessUser;
use App\Models\Customer;
use App\Models\Role;
use App\Models\Sale;
use App\Models\SaleReturn;
use App\Models\Store;
use App\Models\TaxRate;
use App\Models\User;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Regression tests for the Phase A security & transaction-integrity audit. Each test reproduces an
 * attack or failure that was possible before the fix.
 */
class SecurityAuditTest extends TestCase
{
    /** @return array{0: User, 1: Business, 2: string, 3: string, 4: string} owner, business, token, device, product */
    private function shop(float $stock = 20): array
    {
        [$owner, $business, $token] = $this->createOwner();
        $device = $this->registerDevice($token, $business);
        $product = $this->createStockedProduct($token, $business, $device, $owner->id, $stock);

        return [$owner, $business, $token, $device, $product];
    }

    private function customer(string $token, Business $business, string $device, string $userId, array $overrides = []): string
    {
        $id = (string) Str::uuid();
        $this->push($token, $business, $device, [
            $this->op('CREATE_CUSTOMER', 'customer', $id, $overrides + ['name' => 'Ravi', 'credit_limit' => 0, 'opening_balance' => 0, 'active' => true], $userId),
        ])->assertJsonCount(1, 'accepted');

        return $id;
    }

    /** @return list<string> */
    private function flags(Business $business, string $saleId): array
    {
        return $this->inTenant($business, fn () => Sale::query()->findOrFail($saleId)->review_flags ?? []);
    }

    public function test_manipulated_line_totals_never_reach_the_ledger_or_refunds(): void
    {
        [$owner, $business, $token, $device, $product] = $this->shop();
        $saleId = (string) Str::uuid();
        $payload = $this->salePayload($business, $product, 1, 100);
        // The device claims the line is worth 10 000 (a refund would then pay out 10 000).
        $payload['items'][0] += ['taxable' => 8474.58, 'tax_total' => 1525.42, 'total' => 10000];
        $this->push($token, $business, $device, [$this->op('CREATE_SALE', 'sale', $saleId, $payload, $owner->id)])->assertJsonCount(1, 'accepted');

        $sale = $this->inTenant($business, fn () => Sale::query()->with('items')->findOrFail($saleId));
        $this->assertEquals(100, $sale->items[0]->total);
        $this->assertContains('totals_mismatch', $sale->review_flags);

        $returnId = (string) Str::uuid();
        $this->push($token, $business, $device, [$this->op('CREATE_SALE_RETURN', 'sale_return', $returnId, [
            'sale_id' => $saleId, 'return_date' => now()->toDateString(), 'occurred_at' => now()->toIso8601String(), 'refund_method' => 'cash',
            'items' => [['id' => (string) Str::uuid(), 'sale_item_id' => $sale->items[0]->id, 'quantity' => 1, 'restock' => true]],
        ], $owner->id)])->assertJsonCount(1, 'accepted');
        $this->assertEquals(100, $this->inTenant($business, fn () => SaleReturn::query()->findOrFail($returnId)->total));
    }

    public function test_server_total_is_authoritative_for_the_customer_balance(): void
    {
        [$owner, $business, $token, $device, $product] = $this->shop();
        $customer = $this->customer($token, $business, $device, $owner->id);
        $saleId = (string) Str::uuid();
        // Credit sale where the device under-states the total.
        $payload = $this->salePayload($business, $product, 2, 100, ['customer_id' => $customer, 'grand_total' => 50, 'payments' => [['id' => (string) Str::uuid(), 'method' => 'credit', 'amount' => 50]]]);
        $this->push($token, $business, $device, [$this->op('CREATE_SALE', 'sale', $saleId, $payload, $owner->id)])->assertJsonCount(1, 'accepted');

        $balance = $this->inTenant($business, fn () => (float) Customer::query()->findOrFail($customer)->balance);
        $this->assertEquals(200, $balance);
    }

    public function test_cashier_price_and_tax_manipulation_is_flagged(): void
    {
        [, $business, $ownerToken, , $product] = $this->shop();
        [$cashier, $token] = $this->addMember($business, 'cashier');
        $device = $this->registerDevice($token, $business);

        $cheap = (string) Str::uuid();
        $this->push($token, $business, $device, [$this->op('CREATE_SALE', 'sale', $cheap, $this->salePayload($business, $product, 1, 1), $cashier->id)])->assertJsonCount(1, 'accepted');
        $this->assertContains('price_override_without_permission', $this->flags($business, $cheap));

        $zeroTax = $this->inTenant($business, fn () => TaxRate::query()->where('rate', 0)->first()) ?? null;
        $taxFree = (string) Str::uuid();
        $payload = $this->salePayload($business, $product, 1, 100);
        $payload['items'][0]['tax'] = ['name' => 'No tax', 'kind' => 'exempt', 'rate' => 0];
        $payload['items'][0]['tax_rate_id'] = $zeroTax?->id;
        $this->push($token, $business, $device, [$this->op('CREATE_SALE', 'sale', $taxFree, $payload, $cashier->id)])->assertJsonCount(1, 'accepted');
        $this->assertContains('tax_mismatch', $this->flags($business, $taxFree));
        unset($ownerToken);
    }

    public function test_negative_lines_and_negative_payments(): void
    {
        [, $business, , , $product] = $this->shop();
        [$cashier, $token] = $this->addMember($business, 'cashier');
        $device = $this->registerDevice($token, $business);

        // A negative line is a refund in disguise; the cashier lacks sales.refund.
        $saleId = (string) Str::uuid();
        $this->push($token, $business, $device, [$this->op('CREATE_SALE', 'sale', $saleId, $this->salePayload($business, $product, -1, 100, ['grand_total' => -100, 'payments' => [['id' => (string) Str::uuid(), 'method' => 'cash', 'amount' => 0, 'tendered' => 0, 'change' => 0]]]), $cashier->id)])
            ->assertJsonCount(1, 'accepted');
        $this->assertContains('negative_line_without_permission', $this->flags($business, $saleId));

        $response = $this->push($token, $business, $device, [$this->op('CREATE_SALE', 'sale', (string) Str::uuid(), $this->salePayload($business, $product, 1, 100, ['payments' => [['id' => (string) Str::uuid(), 'method' => 'cash', 'amount' => -500]]]), $cashier->id)]);
        $this->assertSame('validation_failed', $response->json('rejected.0.code'));
    }

    public function test_loyalty_points_are_computed_and_checked_on_the_server(): void
    {
        [$owner, $business, $token, $device, $product] = $this->shop();
        $this->inTenant($business, fn () => BusinessSetting::query()->updateOrCreate(['key' => 'loyalty'], ['value' => ['enabled' => true, 'earn_per_100' => 1, 'point_value' => 1, 'min_redeem_points' => 0]]));
        $customer = $this->customer($token, $business, $device, $owner->id);

        // Device claims 1000 earned points on a 200 sale.
        $earn = (string) Str::uuid();
        $this->push($token, $business, $device, [$this->op('CREATE_SALE', 'sale', $earn, $this->salePayload($business, $product, 2, 100, ['customer_id' => $customer, 'loyalty_points_earned' => 1000]), $owner->id)])->assertJsonCount(1, 'accepted');
        $this->assertSame(2, $this->inTenant($business, fn () => Sale::query()->findOrFail($earn)->loyalty_points_earned));
        $this->assertSame(2, $this->inTenant($business, fn () => Customer::query()->findOrFail($customer)->loyalty_points));

        // Redeeming 50 points' worth with only 2 points is recorded (money changed hands) but flagged.
        $redeem = (string) Str::uuid();
        $payload = $this->salePayload($business, $product, 1, 100, ['customer_id' => $customer, 'loyalty_points_redeemed' => 50, 'payments' => [
            ['id' => (string) Str::uuid(), 'method' => 'loyalty', 'amount' => 50],
            ['id' => (string) Str::uuid(), 'method' => 'cash', 'amount' => 50],
        ]]);
        $this->push($token, $business, $device, [$this->op('CREATE_SALE', 'sale', $redeem, $payload, $owner->id)])->assertJsonCount(1, 'accepted');
        $this->assertContains('loyalty_over_redeemed', $this->flags($business, $redeem));
        $this->assertSame(50, $this->inTenant($business, fn () => Sale::query()->findOrFail($redeem)->loyalty_points_redeemed));

        // Replaying the redemption never deducts twice.
        $this->push($token, $business, $device, [$this->op('CREATE_SALE', 'sale', $redeem, $payload, $owner->id)])->assertJsonCount(1, 'accepted');
        $this->assertSame(2 - 50 + 0, $this->inTenant($business, fn () => Customer::query()->findOrFail($customer)->loyalty_points));
    }

    public function test_refund_replay_and_refunds_on_non_invoices(): void
    {
        [$owner, $business, $token, $device, $product] = $this->shop(10);
        $saleId = (string) Str::uuid();
        $this->push($token, $business, $device, [$this->op('CREATE_SALE', 'sale', $saleId, $this->salePayload($business, $product, 2), $owner->id)]);
        $itemId = $this->inTenant($business, fn () => Sale::query()->with('items')->findOrFail($saleId)->items[0]->id);

        $returnOp = $this->op('CREATE_SALE_RETURN', 'sale_return', (string) Str::uuid(), [
            'sale_id' => $saleId, 'return_date' => now()->toDateString(), 'occurred_at' => now()->toIso8601String(), 'refund_method' => 'cash',
            'items' => [['id' => (string) Str::uuid(), 'sale_item_id' => $itemId, 'quantity' => 1, 'restock' => true, 'movement_id' => (string) Str::uuid()]],
        ], $owner->id);
        $this->push($token, $business, $device, [$returnOp]);
        $this->push($token, $business, $device, [$returnOp])->assertJsonPath('accepted.0.duplicate', true);
        $this->assertSame(1, $this->inTenant($business, fn () => SaleReturn::query()->count()));
        $this->assertSame(9.0, $this->stockOf($business, $product));

        // A quotation was never paid — it cannot be refunded.
        $quoteId = (string) Str::uuid();
        $this->push($token, $business, $device, [$this->op('CREATE_SALE', 'sale', $quoteId, $this->salePayload($business, $product, 1, 100, ['doc_type' => 'quotation', 'payments' => []]), $owner->id)]);
        $quoteItem = $this->inTenant($business, fn () => Sale::query()->with('items')->findOrFail($quoteId)->items[0]->id);
        $response = $this->push($token, $business, $device, [$this->op('CREATE_SALE_RETURN', 'sale_return', (string) Str::uuid(), [
            'sale_id' => $quoteId, 'return_date' => now()->toDateString(), 'occurred_at' => now()->toIso8601String(), 'refund_method' => 'cash',
            'items' => [['id' => (string) Str::uuid(), 'sale_item_id' => $quoteItem, 'quantity' => 1]],
        ], $owner->id)]);
        $this->assertSame('validation_failed', $response->json('rejected.0.code'));
    }

    public function test_return_after_cancellation_is_kept_and_flagged(): void
    {
        [$owner, $business, $token, $device, $product] = $this->shop();
        $saleId = (string) Str::uuid();
        $this->push($token, $business, $device, [$this->op('CREATE_SALE', 'sale', $saleId, $this->salePayload($business, $product, 1), $owner->id)]);
        $itemId = $this->inTenant($business, fn () => Sale::query()->with('items')->findOrFail($saleId)->items[0]->id);
        $this->push($token, $business, $device, [$this->op('CANCEL_SALE', 'sale', $saleId, ['reason' => 'error'], $owner->id)])->assertJsonCount(1, 'accepted');

        $this->push($token, $business, $device, [$this->op('CREATE_SALE_RETURN', 'sale_return', (string) Str::uuid(), [
            'sale_id' => $saleId, 'return_date' => now()->toDateString(), 'occurred_at' => now()->toIso8601String(), 'refund_method' => 'cash',
            'items' => [['id' => (string) Str::uuid(), 'sale_item_id' => $itemId, 'quantity' => 1]],
        ], $owner->id)])->assertJsonCount(1, 'accepted');
        $this->assertContains('returned_after_cancel', $this->flags($business, $saleId));
    }

    public function test_payment_cannot_be_applied_to_another_customers_invoice(): void
    {
        [$owner, $business, $token, $device, $product] = $this->shop();
        $alice = $this->customer($token, $business, $device, $owner->id, ['name' => 'Alice']);
        $bob = $this->customer($token, $business, $device, $owner->id, ['name' => 'Bob']);
        $saleId = (string) Str::uuid();
        $this->push($token, $business, $device, [$this->op('CREATE_SALE', 'sale', $saleId, $this->salePayload($business, $product, 1, 100, ['customer_id' => $alice, 'payments' => [['id' => (string) Str::uuid(), 'method' => 'credit', 'amount' => 100]]]), $owner->id)]);

        $response = $this->push($token, $business, $device, [$this->op('CREATE_CUSTOMER_PAYMENT', 'customer_payment', (string) Str::uuid(), [
            'customer_id' => $bob, 'sale_id' => $saleId, 'amount' => 100, 'method' => 'cash', 'payment_date' => now()->toDateString(),
        ], $owner->id)]);
        $this->assertSame('validation_failed', $response->json('rejected.0.code'));
        $this->assertSame('unpaid', $this->inTenant($business, fn () => Sale::query()->findOrFail($saleId)->payment_status));
    }

    public function test_unauthorized_stock_adjustment_is_rejected_and_preserved(): void
    {
        [, $business, , , $product] = $this->shop(5);
        [$cashier, $token] = $this->addMember($business, 'cashier');
        $device = $this->registerDevice($token, $business);
        $op = $this->op('CREATE_STOCK_ADJUSTMENT', 'stock_adjustment', (string) Str::uuid(), [
            'store_id' => $this->defaultStore($business)->id, 'type' => 'adjustment', 'occurred_at' => now()->toIso8601String(),
            'items' => [['id' => (string) Str::uuid(), 'product_id' => $product, 'quantity' => 100, 'unit_cost' => 1]],
        ], $cashier->id);
        $this->assertSame('forbidden', $this->push($token, $business, $device, [$op])->json('rejected.0.code'));
        $this->assertSame(5.0, $this->stockOf($business, $product));

        // A manager grants the permission; the device retries the same operation and it now succeeds.
        $this->inTenant($business, function () use ($cashier) {
            BusinessUser::query()->where('user_id', $cashier->id)->update(['role_id' => Role::query()->where('key', 'manager')->value('id')]);
        });
        $this->push($token, $business, $device, [$op])->assertJsonCount(1, 'accepted');
        $this->assertSame(105.0, $this->stockOf($business, $product));
    }

    public function test_device_identity_requires_its_secret(): void
    {
        [$owner, $business, $token, $device] = $this->shop();
        [, $otherToken] = $this->addMember($business, 'manager');
        $headers = ['Authorization' => 'Bearer '.$otherToken, 'X-Business-Id' => $business->id, 'X-Device-Id' => $device, 'Accept' => 'application/json'];

        // Knowing a device id (it appears on every synced sale) is not enough to act as that device.
        $this->postJson('/api/v1/sync/pull', ['device_id' => $device, 'cursor' => 0], $headers)->assertForbidden()->assertJsonPath('code', 'device_secret_invalid');
        $this->postJson('/api/v1/sync/pull', ['device_id' => $device, 'cursor' => 0], $headers + ['X-Device-Secret' => 'guess'])->assertForbidden();
        $this->postJson('/api/v1/devices/register', ['device_id' => $device, 'name' => 'Hijack'], $headers)->assertStatus(409)->assertJsonPath('code', 'device_secret_required');

        // The real device still works and can re-register with its secret.
        $this->pull($token, $business, $device)->assertOk();
        $this->postJson('/api/v1/devices/register', ['device_id' => $device, 'name' => 'Counter 1'], $this->headers($token, $business, $device))->assertOk();
        unset($owner);
    }

    public function test_store_restricted_members_cannot_work_in_other_stores(): void
    {
        [$owner, $business, $ownerToken, $ownerDevice, $product] = $this->shop();
        $branch = $this->inTenant($business, fn () => Store::query()->create(['name' => 'Branch', 'code' => 'BR', 'is_default' => false, 'active' => true]));
        [$cashier, $token] = $this->addMember($business, 'cashier');
        $main = $this->defaultStore($business);
        $this->inTenant($business, fn () => BusinessUser::query()->where('user_id', $cashier->id)->update(['store_ids' => json_encode([$main->id])]));

        $this->postJson('/api/v1/devices/register', ['device_id' => (string) Str::uuid(), 'name' => 'X', 'store_id' => $branch->id], $this->headers($token, $business))->assertForbidden();

        $device = $this->registerDevice($token, $business);
        $response = $this->push($token, $business, $device, [$this->op('CREATE_SALE', 'sale', (string) Str::uuid(), $this->salePayload($business, $product, 1, 100, ['store_id' => $branch->id]), $cashier->id)]);
        $this->assertSame('forbidden', $response->json('rejected.0.code'));
        unset($owner, $ownerToken, $ownerDevice);
    }

    public function test_disabled_members_lose_access_with_a_machine_readable_code(): void
    {
        [, $business] = $this->shop();
        [$cashier, $token] = $this->addMember($business, 'cashier');
        $this->inTenant($business, fn () => BusinessUser::query()->where('user_id', $cashier->id)->update(['status' => 'disabled']));
        $this->getJson('/api/v1/business', $this->headers($token, $business))->assertForbidden()->assertJsonPath('code', 'business_access_denied');
    }
}
