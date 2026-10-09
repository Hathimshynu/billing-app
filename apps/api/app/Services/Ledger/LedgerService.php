<?php

namespace App\Services\Ledger;

use App\Domain\Pricing\Money;
use App\Models\Customer;
use App\Models\CustomerLedgerEntry;
use App\Models\Supplier;
use App\Models\SupplierLedgerEntry;
use Illuminate\Support\Facades\DB;

/**
 * Append-only customer & supplier ledgers.
 *
 * Customer:  debit = customer owes us (sales), credit = we received / owe them (payments, returns).
 * Supplier:  credit = we owe them (purchases), debit = paid / returned.
 *
 * Entry ids may be supplied by devices so the entry they created offline is replaced (not
 * duplicated) when the server copy is pulled. Creating an entry with an existing id is a no-op.
 * Cached balances are maintained with atomic increments (no version bump / change-feed noise).
 */
class LedgerService
{
    /** @param array<string, mixed> $attributes */
    public function customer(array $attributes): ?CustomerLedgerEntry
    {
        $debit = Money::round($attributes['debit'] ?? 0);
        $credit = Money::round($attributes['credit'] ?? 0);
        $points = (int) ($attributes['points'] ?? 0);
        if ($debit == 0.0 && $credit == 0.0 && $points === 0) {
            return null;
        }
        if (! empty($attributes['id']) && CustomerLedgerEntry::query()->whereKey($attributes['id'])->exists()) {
            return null;
        }

        $entry = CustomerLedgerEntry::query()->create([
            'id' => $attributes['id'] ?? null,
            'customer_id' => $attributes['customer_id'],
            'type' => $attributes['type'],
            'reference_type' => $attributes['reference_type'] ?? null,
            'reference_id' => $attributes['reference_id'] ?? null,
            'reference_no' => $attributes['reference_no'] ?? null,
            'debit' => $debit,
            'credit' => $credit,
            'points' => $points,
            'notes' => $attributes['notes'] ?? null,
            'created_by' => $attributes['created_by'] ?? null,
            'device_id' => $attributes['device_id'] ?? null,
            'occurred_at' => $attributes['occurred_at'] ?? now(),
        ]);

        $delta = Money::toDecimalString(Money::toScaled($debit, 2) - Money::toScaled($credit, 2), 2);
        Customer::query()->whereKey($attributes['customer_id'])->update([
            'balance' => DB::raw('balance + '.$delta),
            'loyalty_points' => DB::raw('loyalty_points + '.$points),
        ]);

        return $entry;
    }

    /** @param array<string, mixed> $attributes */
    public function supplier(array $attributes): ?SupplierLedgerEntry
    {
        $debit = Money::round($attributes['debit'] ?? 0);
        $credit = Money::round($attributes['credit'] ?? 0);
        if ($debit == 0.0 && $credit == 0.0) {
            return null;
        }
        if (! empty($attributes['id']) && SupplierLedgerEntry::query()->whereKey($attributes['id'])->exists()) {
            return null;
        }

        $entry = SupplierLedgerEntry::query()->create([
            'id' => $attributes['id'] ?? null,
            'supplier_id' => $attributes['supplier_id'],
            'type' => $attributes['type'],
            'reference_type' => $attributes['reference_type'] ?? null,
            'reference_id' => $attributes['reference_id'] ?? null,
            'reference_no' => $attributes['reference_no'] ?? null,
            'debit' => $debit,
            'credit' => $credit,
            'notes' => $attributes['notes'] ?? null,
            'created_by' => $attributes['created_by'] ?? null,
            'device_id' => $attributes['device_id'] ?? null,
            'occurred_at' => $attributes['occurred_at'] ?? now(),
        ]);

        $delta = Money::toDecimalString(Money::toScaled($credit, 2) - Money::toScaled($debit, 2), 2);
        Supplier::query()->whereKey($attributes['supplier_id'])->update(['balance' => DB::raw('balance + '.$delta)]);

        return $entry;
    }

    /** Re-state the opening balance entry of a customer (opening balances are editable). */
    public function setCustomerOpeningBalance(Customer $customer, float $amount, ?string $entryId, ?string $userId, ?string $deviceId): void
    {
        $existing = CustomerLedgerEntry::query()
            ->where('customer_id', $customer->id)
            ->where('type', 'opening_balance')
            ->first();
        if ($existing) {
            $oldDelta = Money::toScaled($existing->debit, 2) - Money::toScaled($existing->credit, 2);
            $existing->debit = $amount > 0 ? $amount : 0;
            $existing->credit = $amount < 0 ? -$amount : 0;
            $existing->save();
            $newDelta = Money::toScaled($existing->debit, 2) - Money::toScaled($existing->credit, 2);
            Customer::query()->whereKey($customer->id)->update([
                'balance' => DB::raw('balance + '.Money::toDecimalString($newDelta - $oldDelta, 2)),
            ]);

            return;
        }
        $this->customer([
            'id' => $entryId,
            'customer_id' => $customer->id,
            'type' => 'opening_balance',
            'debit' => $amount > 0 ? $amount : 0,
            'credit' => $amount < 0 ? -$amount : 0,
            'notes' => 'Opening balance',
            'created_by' => $userId,
            'device_id' => $deviceId,
            'occurred_at' => $customer->created_at ?? now(),
        ]);
    }

    public function setSupplierOpeningBalance(Supplier $supplier, float $amount, ?string $entryId, ?string $userId, ?string $deviceId): void
    {
        $existing = SupplierLedgerEntry::query()
            ->where('supplier_id', $supplier->id)
            ->where('type', 'opening_balance')
            ->first();
        if ($existing) {
            $oldDelta = Money::toScaled($existing->credit, 2) - Money::toScaled($existing->debit, 2);
            $existing->credit = $amount > 0 ? $amount : 0;
            $existing->debit = $amount < 0 ? -$amount : 0;
            $existing->save();
            $newDelta = Money::toScaled($existing->credit, 2) - Money::toScaled($existing->debit, 2);
            Supplier::query()->whereKey($supplier->id)->update([
                'balance' => DB::raw('balance + '.Money::toDecimalString($newDelta - $oldDelta, 2)),
            ]);

            return;
        }
        $this->supplier([
            'id' => $entryId,
            'supplier_id' => $supplier->id,
            'type' => 'opening_balance',
            'credit' => $amount > 0 ? $amount : 0,
            'debit' => $amount < 0 ? -$amount : 0,
            'notes' => 'Opening balance',
            'created_by' => $userId,
            'device_id' => $deviceId,
            'occurred_at' => $supplier->created_at ?? now(),
        ]);
    }

    public function customerBalance(string $customerId): float
    {
        $row = CustomerLedgerEntry::query()->where('customer_id', $customerId)
            ->selectRaw('COALESCE(SUM(debit),0) as d, COALESCE(SUM(credit),0) as c')->toBase()->first();

        return Money::round(((float) ($row->d ?? 0)) - ((float) ($row->c ?? 0)));
    }

    public function supplierBalance(string $supplierId): float
    {
        $row = SupplierLedgerEntry::query()->where('supplier_id', $supplierId)
            ->selectRaw('COALESCE(SUM(debit),0) as d, COALESCE(SUM(credit),0) as c')->toBase()->first();

        return Money::round(((float) ($row->c ?? 0)) - ((float) ($row->d ?? 0)));
    }
}
