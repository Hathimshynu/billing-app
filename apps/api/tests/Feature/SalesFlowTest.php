<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\CashRegister;
use App\Models\Customer;
use App\Models\Sale;
use App\Services\Ledger\LedgerService;
use Illuminate\Support\Str;
use Tests\TestCase;

class SalesFlowTest extends TestCase
{
    public function test_credit_sale_updates_customer_ledger_and_payment_collection(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $device = $this->registerDevice($token, $business);
        $productId = $this->createStockedProduct($token, $business, $device, $owner->id, 10);
        $customerId = (string) Str::uuid();
        $saleId = (string) Str::uuid();

        $this->push($token, $business, $device, [
            $this->op('CREATE_CUSTOMER', 'customer', $customerId, ['name' => 'Suresh Traders', 'credit_limit' => 5000, 'opening_balance' => 0, 'active' => true], $owner->id),
            // Split payment: 200 cash + 300 on credit.
            $this->op('CREATE_SALE', 'sale', $saleId, $this->salePayload($business, $productId, 5, 100, [
                'customer_id' => $customerId,
                'payments' => [
                    ['id' => (string) Str::uuid(), 'method' => 'cash', 'amount' => 200, 'tendered' => 200, 'change' => 0],
                    ['id' => (string) Str::uuid(), 'method' => 'credit', 'amount' => 300],
                ],
            ]), $owner->id),
        ])->assertJsonCount(2, 'accepted');

        $sale = $this->inTenant($business, fn () => Sale::query()->find($saleId));
        $this->assertSame('partial', $sale->payment_status);
        $this->assertSame(300.0, $sale->balance_due);
        $this->assertSame(300.0, $this->inTenant($business, fn () => app(LedgerService::class)->customerBalance($customerId)));

        $this->push($token, $business, $device, [
            $this->op('CREATE_CUSTOMER_PAYMENT', 'customer_payment', (string) Str::uuid(), [
                'customer_id' => $customerId, 'sale_id' => $saleId, 'amount' => 300, 'method' => 'upi', 'payment_date' => now()->toDateString(),
            ], $owner->id),
        ])->assertJsonCount(1, 'accepted');

        $this->assertSame(0.0, $this->inTenant($business, fn () => app(LedgerService::class)->customerBalance($customerId)));
        $this->assertSame('paid', $this->inTenant($business, fn () => Sale::query()->find($saleId))->payment_status);
        $this->assertSame(0.0, $this->inTenant($business, fn () => Customer::query()->find($customerId))->balance);
    }

    public function test_exceeding_credit_limit_offline_is_flagged_and_notified(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        [$cashier] = $this->addMember($business, 'cashier');
        $device = $this->registerDevice($token, $business);
        $productId = $this->createStockedProduct($token, $business, $device, $owner->id, 10);
        $customerId = (string) Str::uuid();

        $response = $this->push($token, $business, $device, [
            $this->op('CREATE_CUSTOMER', 'customer', $customerId, ['name' => 'Small Credit', 'credit_limit' => 100, 'active' => true], $owner->id),
            $this->op('CREATE_SALE', 'sale', (string) Str::uuid(), $this->salePayload($business, $productId, 5, 100, [
                'customer_id' => $customerId,
                'payments' => [['id' => (string) Str::uuid(), 'method' => 'credit', 'amount' => 500]],
            ]), $cashier->id),
        ]);

        $response->assertJsonCount(2, 'accepted');
        $this->assertContains('credit_limit_exceeded', $response->json('accepted.1.result.review_flags'));
        $this->assertDatabaseHas('app_notifications', ['type' => 'credit_limit_exceeded']);
    }

    public function test_partial_return_restocks_and_credits_the_customer(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $device = $this->registerDevice($token, $business);
        $productId = $this->createStockedProduct($token, $business, $device, $owner->id, 10);
        $customerId = (string) Str::uuid();
        $sale = $this->salePayload($business, $productId, 4, 118, ['customer_id' => $customerId]);
        $saleId = (string) Str::uuid();

        $this->push($token, $business, $device, [
            $this->op('CREATE_CUSTOMER', 'customer', $customerId, ['name' => 'Return Customer', 'active' => true], $owner->id),
            $this->op('CREATE_SALE', 'sale', $saleId, $sale, $owner->id),
        ])->assertJsonCount(2, 'accepted');
        $this->assertSame(6.0, $this->stockOf($business, $productId));

        $response = $this->push($token, $business, $device, [
            $this->op('CREATE_SALE_RETURN', 'sale_return', (string) Str::uuid(), [
                'sale_id' => $saleId,
                'return_date' => now()->toDateString(),
                'occurred_at' => now()->toIso8601String(),
                'refund_method' => 'store_credit',
                'reason' => 'Damaged packaging',
                'items' => [['id' => (string) Str::uuid(), 'sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1, 'restock' => true]],
            ], $owner->id),
        ])->assertJsonCount(1, 'accepted');

        $this->assertMatchesRegularExpression('/^CN-/', $response->json('accepted.0.result.return_number'));
        $this->assertSame(7.0, $this->stockOf($business, $productId));
        // Sold 4 × 118 = 472 fully paid; 1 unit returned as store credit → customer is owed 118.
        $this->assertSame(-118.0, $this->inTenant($business, fn () => app(LedgerService::class)->customerBalance($customerId)));
        $this->assertSame(118.0, $this->inTenant($business, fn () => Sale::query()->find($saleId))->returned_total);
    }

    public function test_cancelling_an_invoice_reverses_stock(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $device = $this->registerDevice($token, $business);
        $productId = $this->createStockedProduct($token, $business, $device, $owner->id, 10);
        $saleId = (string) Str::uuid();
        $this->push($token, $business, $device, [$this->op('CREATE_SALE', 'sale', $saleId, $this->salePayload($business, $productId, 3), $owner->id)]);

        $this->push($token, $business, $device, [$this->op('CANCEL_SALE', 'sale', $saleId, ['reason' => 'Billing mistake'], $owner->id)])
            ->assertJsonCount(1, 'accepted');

        $this->assertSame(10.0, $this->stockOf($business, $productId));
        $this->assertSame('cancelled', $this->inTenant($business, fn () => Sale::query()->find($saleId))->status);
        $this->assertTrue(AuditLog::query()->where('action', 'SALE_CANCELLED')->where('entity_id', $saleId)->exists());
    }

    public function test_quotation_does_not_touch_stock_and_converts_to_invoice(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $device = $this->registerDevice($token, $business);
        $productId = $this->createStockedProduct($token, $business, $device, $owner->id, 10);
        $quoteId = (string) Str::uuid();

        $response = $this->push($token, $business, $device, [
            $this->op('CREATE_SALE', 'sale', $quoteId, $this->salePayload($business, $productId, 2, 100, ['doc_type' => 'quotation', 'payments' => []]), $owner->id),
        ]);
        $this->assertMatchesRegularExpression('/^QT-/', $response->json('accepted.0.result.invoice_number'));
        $this->assertSame(10.0, $this->stockOf($business, $productId));

        $this->push($token, $business, $device, [
            $this->op('CREATE_SALE', 'sale', (string) Str::uuid(), $this->salePayload($business, $productId, 2, 100, ['converted_from_id' => $quoteId]), $owner->id),
        ])->assertJsonCount(1, 'accepted');
        $this->assertSame('converted', $this->inTenant($business, fn () => Sale::query()->find($quoteId))->status);
        $this->assertSame(8.0, $this->stockOf($business, $productId));
    }

    public function test_cash_register_close_computes_expected_cash(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $device = $this->registerDevice($token, $business);
        $productId = $this->createStockedProduct($token, $business, $device, $owner->id, 20);
        $store = $this->defaultStore($business);
        $registerId = (string) Str::uuid();

        $this->push($token, $business, $device, [
            $this->op('OPEN_CASH_REGISTER', 'cash_register', $registerId, ['store_id' => $store->id, 'opening_cash' => 1000, 'opened_at' => now()->toIso8601String()], $owner->id),
            $this->op('CREATE_SALE', 'sale', (string) Str::uuid(), $this->salePayload($business, $productId, 5, 100, ['register_id' => $registerId]), $owner->id),
            $this->op('CREATE_CASH_TRANSACTION', 'cash_transaction', (string) Str::uuid(), ['register_id' => $registerId, 'type' => 'cash_in', 'amount' => 200, 'reason' => 'Change float', 'occurred_at' => now()->toIso8601String()], $owner->id),
            $this->op('CREATE_CASH_TRANSACTION', 'cash_transaction', (string) Str::uuid(), ['register_id' => $registerId, 'type' => 'cash_out', 'amount' => 50, 'reason' => 'Tea', 'occurred_at' => now()->toIso8601String()], $owner->id),
            $this->op('CREATE_EXPENSE', 'expense', (string) Str::uuid(), ['register_id' => $registerId, 'store_id' => $store->id, 'category_name' => 'Transportation', 'amount' => 150, 'payment_method' => 'cash', 'expense_date' => now()->toDateString()], $owner->id),
            $this->op('CLOSE_CASH_REGISTER', 'cash_register', $registerId, ['closing_cash' => 1490, 'closed_at' => now()->toIso8601String()], $owner->id),
        ])->assertJsonCount(6, 'accepted');

        $register = $this->inTenant($business, fn () => CashRegister::query()->find($registerId));
        // 1000 + 500 cash sales + 200 in − 50 out − 150 expense = 1500
        $this->assertSame(1500.0, $register->expected_cash);
        $this->assertSame(-10.0, $register->difference);
        $this->assertDatabaseHas('app_notifications', ['type' => 'register_mismatch']);
    }
}
