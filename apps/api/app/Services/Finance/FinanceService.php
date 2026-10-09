<?php

namespace App\Services\Finance;

use App\Domain\Business\BusinessTypes;
use App\Domain\Pricing\Money;
use App\Models\CashRegister;
use App\Models\CashTransaction;
use App\Models\Customer;
use App\Models\CustomerPayment;
use App\Models\Device;
use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\Purchase;
use App\Models\Sale;
use App\Models\SalePayment;
use App\Models\SaleReturn;
use App\Models\Store;
use App\Models\Supplier;
use App\Models\SupplierPayment;
use App\Services\Audit\AuditLogger;
use App\Services\Ledger\LedgerService;
use App\Services\Notifications\NotificationService;
use App\Services\Numbering\NumberingService;
use App\Services\Purchases\PurchaseService;
use App\Services\Sync\Exceptions\SyncRejected;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/**
 * Money that is not a sale: customer receipts, supplier payments, expenses and the cash register.
 */
class FinanceService
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly LedgerService $ledger,
        private readonly NumberingService $numbering,
        private readonly AuditLogger $audit,
        private readonly NotificationService $notifications,
        private readonly PurchaseService $purchases,
    ) {}

    /**
     * @param  array<string, mixed>  $payload
     * @param  array<string, mixed>  $rules
     * @return array<string, mixed>
     */
    private function validate(array $payload, array $rules): array
    {
        $validator = Validator::make($payload, $rules);
        if ($validator->fails()) {
            throw SyncRejected::invalid($validator->errors()->toArray());
        }

        return $validator->validated();
    }

    /** @param array<string, mixed> $payload */
    public function customerPayment(array $payload, string $id, ?Device $device, string $userId): CustomerPayment
    {
        if ($existing = CustomerPayment::query()->find($id)) {
            return $existing;
        }
        if (! $this->tenant->can('customers.payments')) {
            throw SyncRejected::forbidden('customers.payments');
        }
        $data = $this->validate($payload, [
            'customer_id' => ['required', 'uuid'],
            'sale_id' => ['nullable', 'uuid'],
            'store_id' => ['nullable', 'uuid'],
            'register_id' => ['nullable', 'uuid'],
            'receipt_number' => ['nullable', 'string', 'max:64'],
            'number_status' => ['nullable', 'string'],
            'number_block_id' => ['nullable', 'uuid'],
            'number_sequence' => ['nullable', 'integer'],
            'amount' => ['required', 'numeric', 'gt:0'],
            'method' => ['required', Rule::in(BusinessTypes::PAYMENT_METHODS)],
            'reference' => ['nullable', 'string', 'max:100'],
            'payment_date' => ['required', 'date_format:Y-m-d'],
            'notes' => ['nullable', 'string', 'max:500'],
            'ledger_id' => ['nullable', 'uuid'],
        ]);
        $customer = Customer::withTrashed()->find($data['customer_id']) ?? throw SyncRejected::dependency('Customer');
        $number = $this->numbering->finalize('customer_payment', 'customer_payment', $id, $data['receipt_number'] ?? null, $data['number_status'] ?? null, $data['number_block_id'] ?? null, $data['number_sequence'] ?? null, $data['payment_date'], $device, $data['store_id'] ?? null);
        $payment = CustomerPayment::query()->create([
            'id' => $id,
            'store_id' => $data['store_id'] ?? $device?->store_id,
            'device_id' => $device?->id,
            'register_id' => $data['register_id'] ?? null,
            'customer_id' => $customer->id,
            'sale_id' => $data['sale_id'] ?? null,
            'receipt_number' => $number['number'],
            'amount' => $data['amount'],
            'method' => $data['method'],
            'reference' => $data['reference'] ?? null,
            'payment_date' => $data['payment_date'],
            'notes' => $data['notes'] ?? null,
            'created_by' => $userId,
        ]);
        $this->ledger->customer([
            'id' => $data['ledger_id'] ?? null, 'customer_id' => $customer->id, 'type' => 'payment', 'credit' => $payment->amount,
            'reference_type' => 'customer_payment', 'reference_id' => $payment->id, 'reference_no' => $payment->receipt_number,
            'created_by' => $userId, 'device_id' => $device?->id,
        ]);
        if ($payment->sale_id && ($sale = Sale::query()->find($payment->sale_id))) {
            $paid = Money::round((float) $sale->paid_total + $payment->amount);
            $sale->paid_total = min($paid, (float) $sale->grand_total);
            $sale->balance_due = max(Money::round((float) $sale->grand_total - $sale->paid_total), 0);
            $sale->payment_status = $sale->balance_due <= 0 ? 'paid' : 'partial';
            $sale->save();
        }
        $this->audit->log('PAYMENT_RECEIVED', 'customer_payment', $payment->id, null, ['customer' => $customer->name, 'amount' => $payment->amount, 'method' => $payment->method], $userId, $device?->id);

        return $payment;
    }

    /** @param array<string, mixed> $payload */
    public function supplierPayment(array $payload, string $id, ?Device $device, string $userId): SupplierPayment
    {
        if ($existing = SupplierPayment::query()->find($id)) {
            return $existing;
        }
        if (! $this->tenant->can('suppliers.payments')) {
            throw SyncRejected::forbidden('suppliers.payments');
        }
        $data = $this->validate($payload, [
            'supplier_id' => ['required', 'uuid'],
            'purchase_id' => ['nullable', 'uuid'],
            'store_id' => ['nullable', 'uuid'],
            'register_id' => ['nullable', 'uuid'],
            'payment_number' => ['nullable', 'string', 'max:64'],
            'number_status' => ['nullable', 'string'],
            'number_block_id' => ['nullable', 'uuid'],
            'number_sequence' => ['nullable', 'integer'],
            'amount' => ['required', 'numeric', 'gt:0'],
            'method' => ['required', Rule::in(BusinessTypes::PAYMENT_METHODS)],
            'reference' => ['nullable', 'string', 'max:100'],
            'payment_date' => ['required', 'date_format:Y-m-d'],
            'notes' => ['nullable', 'string', 'max:500'],
            'ledger_id' => ['nullable', 'uuid'],
        ]);
        $supplier = Supplier::withTrashed()->find($data['supplier_id']) ?? throw SyncRejected::dependency('Supplier');
        $number = $this->numbering->finalize('supplier_payment', 'supplier_payment', $id, $data['payment_number'] ?? null, $data['number_status'] ?? null, $data['number_block_id'] ?? null, $data['number_sequence'] ?? null, $data['payment_date'], $device, $data['store_id'] ?? null);
        $payment = SupplierPayment::query()->create([
            'id' => $id,
            'store_id' => $data['store_id'] ?? $device?->store_id,
            'device_id' => $device?->id,
            'register_id' => $data['register_id'] ?? null,
            'supplier_id' => $supplier->id,
            'purchase_id' => $data['purchase_id'] ?? null,
            'payment_number' => $number['number'],
            'amount' => $data['amount'],
            'method' => $data['method'],
            'reference' => $data['reference'] ?? null,
            'payment_date' => $data['payment_date'],
            'notes' => $data['notes'] ?? null,
            'created_by' => $userId,
        ]);
        $this->ledger->supplier([
            'id' => $data['ledger_id'] ?? null, 'supplier_id' => $supplier->id, 'type' => 'payment', 'debit' => $payment->amount,
            'reference_type' => 'supplier_payment', 'reference_id' => $payment->id, 'reference_no' => $payment->payment_number,
            'created_by' => $userId, 'device_id' => $device?->id,
        ]);
        if ($payment->purchase_id && ($purchase = Purchase::query()->find($payment->purchase_id))) {
            $this->purchases->refreshPaymentStatus($purchase);
        }
        $this->audit->log('SUPPLIER_PAID', 'supplier_payment', $payment->id, null, ['supplier' => $supplier->name, 'amount' => $payment->amount], $userId, $device?->id);

        return $payment;
    }

    /** @param array<string, mixed> $payload */
    public function expense(array $payload, string $id, ?Device $device, string $userId): Expense
    {
        if ($existing = Expense::query()->find($id)) {
            return $existing;
        }
        if (! $this->tenant->can('expenses.create')) {
            throw SyncRejected::forbidden('expenses.create');
        }
        $data = $this->validate($payload, [
            'store_id' => ['nullable', 'uuid'],
            'register_id' => ['nullable', 'uuid'],
            'category_id' => ['nullable', 'uuid'],
            'category_name' => ['nullable', 'string', 'max:80'],
            'expense_number' => ['nullable', 'string', 'max:64'],
            'number_status' => ['nullable', 'string'],
            'number_block_id' => ['nullable', 'uuid'],
            'number_sequence' => ['nullable', 'integer'],
            'amount' => ['required', 'numeric', 'gt:0'],
            'payment_method' => ['required', Rule::in(BusinessTypes::PAYMENT_METHODS)],
            'expense_date' => ['required', 'date_format:Y-m-d'],
            'reference' => ['nullable', 'string', 'max:100'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);
        $category = ! empty($data['category_id']) ? ExpenseCategory::withTrashed()->find($data['category_id']) : null;
        if (! empty($data['category_id']) && ! $category) {
            throw SyncRejected::dependency('Expense category');
        }
        $number = $this->numbering->finalize('expense', 'expense', $id, $data['expense_number'] ?? null, $data['number_status'] ?? null, $data['number_block_id'] ?? null, $data['number_sequence'] ?? null, $data['expense_date'], $device, $data['store_id'] ?? null);
        $expense = Expense::query()->create([
            'id' => $id,
            'store_id' => $data['store_id'] ?? $device?->store_id,
            'device_id' => $device?->id,
            'register_id' => $data['register_id'] ?? null,
            'category_id' => $category?->id,
            'category_name' => $category->name ?? ($data['category_name'] ?? null),
            'expense_number' => $number['number'],
            'amount' => $data['amount'],
            'payment_method' => $data['payment_method'],
            'expense_date' => $data['expense_date'],
            'reference' => $data['reference'] ?? null,
            'notes' => $data['notes'] ?? null,
            'status' => 'active',
            'created_by' => $userId,
        ]);
        $this->audit->log('EXPENSE_CREATED', 'expense', $expense->id, null, ['amount' => $expense->amount, 'category' => $expense->category_name], $userId, $device?->id);

        return $expense;
    }

    public function voidExpense(Expense $expense, string $userId, ?Device $device): Expense
    {
        if (! $this->tenant->can('expenses.delete')) {
            throw SyncRejected::forbidden('expenses.delete');
        }
        $expense->status = 'void';
        $expense->save();
        $this->audit->log('EXPENSE_VOIDED', 'expense', $expense->id, ['status' => 'active'], ['status' => 'void'], $userId, $device?->id);

        return $expense;
    }

    /** @param array<string, mixed> $payload */
    public function openRegister(array $payload, string $id, ?Device $device, string $userId): CashRegister
    {
        if ($existing = CashRegister::query()->find($id)) {
            return $existing;
        }
        if (! $this->tenant->can('cash_register.open')) {
            throw SyncRejected::forbidden('cash_register.open');
        }
        $data = $this->validate($payload, [
            'store_id' => ['required', 'uuid'],
            'opening_cash' => ['required', 'numeric', 'min:0'],
            'opened_at' => ['required', 'date'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);
        if (! Store::query()->whereKey($data['store_id'])->exists()) {
            throw SyncRejected::invalid(['store_id' => ['Unknown store.']]);
        }
        $register = CashRegister::query()->create([
            'id' => $id,
            'store_id' => $data['store_id'],
            'device_id' => $device?->id,
            'status' => 'open',
            'opened_by' => $userId,
            'opened_at' => Carbon::parse($data['opened_at']),
            'opening_cash' => $data['opening_cash'],
            'notes' => $data['notes'] ?? null,
        ]);
        $this->audit->log('REGISTER_OPENED', 'cash_register', $register->id, null, ['opening_cash' => $register->opening_cash], $userId, $device?->id);

        return $register;
    }

    /** @param array<string, mixed> $payload */
    public function cashTransaction(array $payload, string $id, ?Device $device, string $userId): CashTransaction
    {
        if ($existing = CashTransaction::query()->find($id)) {
            return $existing;
        }
        if (! $this->tenant->can('cash_register.manage')) {
            throw SyncRejected::forbidden('cash_register.manage');
        }
        $data = $this->validate($payload, [
            'register_id' => ['required', 'uuid'],
            'type' => ['required', Rule::in(['cash_in', 'cash_out'])],
            'amount' => ['required', 'numeric', 'gt:0'],
            'reason' => ['nullable', 'string', 'max:500'],
            'occurred_at' => ['required', 'date'],
        ]);
        $register = CashRegister::query()->find($data['register_id']) ?? throw SyncRejected::dependency('Cash register');
        $transaction = CashTransaction::query()->create([
            'id' => $id,
            'register_id' => $register->id,
            'store_id' => $register->store_id,
            'type' => $data['type'],
            'amount' => $data['amount'],
            'reason' => $data['reason'] ?? null,
            'occurred_at' => Carbon::parse($data['occurred_at']),
            'created_by' => $userId,
        ]);
        $this->audit->log(strtoupper($data['type']), 'cash_transaction', $transaction->id, null, ['amount' => $transaction->amount, 'reason' => $transaction->reason], $userId, $device?->id);

        return $transaction;
    }

    /**
     * Expected cash = opening + cash sales − cash refunds + cash in − cash out − cash expenses.
     *
     * @return array<string, float>
     */
    public function registerTotals(CashRegister $register): array
    {
        $saleIds = Sale::query()->where('register_id', $register->id)->where('doc_type', 'invoice')->where('status', 'completed')->pluck('id');
        $cashSales = (float) SalePayment::query()->whereIn('sale_id', $saleIds)->where('method', 'cash')->sum('amount');
        $cashRefunds = (float) SaleReturn::query()->where('register_id', $register->id)->where('refund_method', 'cash')->sum('total');
        $collections = (float) CustomerPayment::query()->where('register_id', $register->id)->where('method', 'cash')->sum('amount');
        $supplierCash = (float) SupplierPayment::query()->where('register_id', $register->id)->where('method', 'cash')->sum('amount');
        $cashIn = (float) CashTransaction::query()->where('register_id', $register->id)->where('type', 'cash_in')->sum('amount') + $collections;
        $cashOut = (float) CashTransaction::query()->where('register_id', $register->id)->where('type', 'cash_out')->sum('amount') + $supplierCash;
        $expenses = (float) Expense::query()->where('register_id', $register->id)->where('payment_method', 'cash')->where('status', 'active')->sum('amount');
        $expected = Money::round((float) $register->opening_cash + $cashSales - $cashRefunds + $cashIn - $cashOut - $expenses);

        return [
            'cash_sales' => Money::round($cashSales),
            'cash_refunds' => Money::round($cashRefunds),
            'cash_in' => Money::round($cashIn),
            'cash_out' => Money::round($cashOut),
            'cash_expenses' => Money::round($expenses),
            'expected_cash' => $expected,
        ];
    }

    /** @param array<string, mixed> $payload */
    public function closeRegister(CashRegister $register, array $payload, ?Device $device, string $userId): CashRegister
    {
        if (! $this->tenant->can('cash_register.close')) {
            throw SyncRejected::forbidden('cash_register.close');
        }
        if ($register->status === 'closed') {
            return $register;
        }
        $data = $this->validate($payload, [
            'closing_cash' => ['required', 'numeric', 'min:0'],
            'closed_at' => ['required', 'date'],
            'denominations' => ['nullable', 'array'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'expected_cash' => ['nullable', 'numeric'],
        ]);
        $totals = $this->registerTotals($register);
        $register->fill($totals + [
            'status' => 'closed',
            'closed_by' => $userId,
            'closed_at' => Carbon::parse($data['closed_at']),
            'closing_cash' => $data['closing_cash'],
            'difference' => Money::round((float) $data['closing_cash'] - $totals['expected_cash']),
            'denominations' => $data['denominations'] ?? null,
            'notes' => $data['notes'] ?? $register->notes,
        ]);
        $register->save();
        if (abs((float) $register->difference) >= 1) {
            $this->notifications->notify(
                'register_mismatch',
                'Cash register mismatch',
                'Register closed with a difference of '.number_format((float) $register->difference, 2).' (expected '.number_format($totals['expected_cash'], 2).', counted '.number_format((float) $register->closing_cash, 2).').',
                'warning', 'cash_register', $register->id,
            );
        }
        $this->audit->log('REGISTER_CLOSED', 'cash_register', $register->id, null, ['expected' => $totals['expected_cash'], 'counted' => $register->closing_cash, 'difference' => $register->difference], $userId, $device?->id);

        return $register;
    }
}
