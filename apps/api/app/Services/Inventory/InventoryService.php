<?php

namespace App\Services\Inventory;

use App\Domain\Pricing\Money;
use App\Models\InventoryMovement;
use App\Models\StockLevel;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Str;

/**
 * Inventory ledger. Stock is NEVER overwritten: every change is an immutable movement and the
 * running quantity is adjusted atomically by the movement's delta. Two devices that each sold
 * offline from the same stock therefore converge correctly (10 − 2 − 3 = 5) after sync.
 */
class InventoryService
{
    public const IN_TYPES = ['PURCHASE', 'SALE_RETURN', 'TRANSFER_IN', 'OPENING_STOCK'];

    public const OUT_TYPES = ['SALE', 'PURCHASE_RETURN', 'TRANSFER_OUT', 'DAMAGE', 'EXPIRED'];

    public const ALL_TYPES = ['PURCHASE', 'SALE', 'SALE_RETURN', 'PURCHASE_RETURN', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'DAMAGE', 'EXPIRED', 'OPENING_STOCK'];

    public function __construct(private readonly TenantContext $tenant) {}

    public static function stockKey(string $storeId, string $productId, ?string $variantId = null, ?string $batchId = null): string
    {
        return "{$storeId}|{$productId}|".($variantId ?? '').'|'.($batchId ?? '');
    }

    /**
     * Record a movement and apply it to the running stock. Idempotent on the movement id.
     *
     * @param  array<string, mixed>  $m
     */
    public function move(array $m): InventoryMovement
    {
        if (! empty($m['id'])) {
            $existing = InventoryMovement::query()->find($m['id']);
            if ($existing) {
                return $existing;
            }
        }

        $qtyIn = Money::toScaled($m['qty_in'] ?? 0, Money::QTY_SCALE);
        $qtyOut = Money::toScaled($m['qty_out'] ?? 0, Money::QTY_SCALE);
        $unitCost = (float) ($m['unit_cost'] ?? 0);
        $level = $this->lockLevel($m['store_id'], $m['product_id'], $m['variant_id'] ?? null, $m['batch_id'] ?? null);

        $before = Money::toScaled($level->qty, Money::QTY_SCALE);
        $after = $before + $qtyIn - $qtyOut;

        // Weighted average cost on receipts that carry a cost.
        if ($qtyIn > 0 && $unitCost > 0 && in_array($m['type'], ['PURCHASE', 'OPENING_STOCK', 'TRANSFER_IN', 'ADJUSTMENT'], true)) {
            $positiveBefore = max($before, 0);
            $totalQty = $positiveBefore + $qtyIn;
            $level->avg_cost = $totalQty > 0
                ? round((($positiveBefore * (float) $level->avg_cost) + ($qtyIn * $unitCost)) / $totalQty, 4)
                : $unitCost;
        }

        $movement = InventoryMovement::query()->create([
            'id' => $m['id'] ?? null,
            'store_id' => $m['store_id'],
            'product_id' => $m['product_id'],
            'variant_id' => $m['variant_id'] ?? null,
            'batch_id' => $m['batch_id'] ?? null,
            'type' => $m['type'],
            'qty_in' => Money::fromScaled($qtyIn, Money::QTY_SCALE),
            'qty_out' => Money::fromScaled($qtyOut, Money::QTY_SCALE),
            'unit_cost' => $unitCost > 0 ? $unitCost : (float) $level->avg_cost,
            'balance_after' => Money::fromScaled($after, Money::QTY_SCALE),
            'reference_type' => $m['reference_type'] ?? null,
            'reference_id' => $m['reference_id'] ?? null,
            'reference_no' => $m['reference_no'] ?? null,
            'notes' => $m['notes'] ?? null,
            'created_by' => $m['created_by'] ?? $this->tenant->userId(),
            'device_id' => $m['device_id'] ?? null,
            'occurred_at' => $m['occurred_at'] ?? now(),
        ]);

        // The stock change is logged after the movement so devices always see the movement first.
        $level->qty = Money::fromScaled($after, Money::QTY_SCALE);
        $level->save();

        return $movement;
    }

    private function lockLevel(string $storeId, string $productId, ?string $variantId, ?string $batchId): StockLevel
    {
        $key = self::stockKey($storeId, $productId, $variantId, $batchId);
        $level = StockLevel::query()->where('stock_key', $key)->lockForUpdate()->first();
        if ($level) {
            return $level;
        }
        StockLevel::query()->insertOrIgnore([
            'id' => (string) Str::uuid7(),
            'business_id' => $this->tenant->businessId(),
            'store_id' => $storeId,
            'product_id' => $productId,
            'variant_id' => $variantId,
            'batch_id' => $batchId,
            'stock_key' => $key,
            'qty' => 0,
            'avg_cost' => 0,
            'version' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return StockLevel::query()->where('stock_key', $key)->lockForUpdate()->firstOrFail();
    }

    public function quantity(string $storeId, string $productId, ?string $variantId = null, ?string $batchId = null): float
    {
        return (float) (StockLevel::query()->where('stock_key', self::stockKey($storeId, $productId, $variantId, $batchId))->value('qty') ?? 0);
    }

    public function averageCost(string $storeId, string $productId, ?string $variantId = null, ?string $batchId = null): float
    {
        return (float) (StockLevel::query()->where('stock_key', self::stockKey($storeId, $productId, $variantId, $batchId))->value('avg_cost') ?? 0);
    }
}
