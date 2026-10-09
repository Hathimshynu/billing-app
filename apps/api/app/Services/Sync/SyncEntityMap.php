<?php

namespace App\Services\Sync;

use App\Models;
use App\Models\Contracts\SyncableEntity;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\SoftDeletingScope;

/**
 * Sync entity type → model, with the relations needed to serialize aggregates in one query.
 */
final class SyncEntityMap
{
    /** @var array<string, array{0: class-string<Model>, 1: list<string>}> */
    public const MAP = [
        'business' => [Models\Business::class, []],
        'store' => [Models\Store::class, []],
        'device' => [Models\Device::class, []],
        'user' => [Models\BusinessUser::class, ['user', 'role.permissions']],
        'role' => [Models\Role::class, ['permissions']],
        'setting' => [Models\BusinessSetting::class, []],
        'category' => [Models\Category::class, []],
        'brand' => [Models\Brand::class, []],
        'unit' => [Models\Unit::class, []],
        'tax_rate' => [Models\TaxRate::class, []],
        'product' => [Models\Product::class, ['variants', 'extraBarcodes', 'priceTiers']],
        'product_batch' => [Models\ProductBatch::class, []],
        'product_serial' => [Models\ProductSerial::class, []],
        'stock_level' => [Models\StockLevel::class, []],
        'inventory_movement' => [Models\InventoryMovement::class, []],
        'stock_adjustment' => [Models\StockAdjustment::class, []],
        'stock_transfer' => [Models\StockTransfer::class, []],
        'customer' => [Models\Customer::class, []],
        'customer_ledger_entry' => [Models\CustomerLedgerEntry::class, []],
        'supplier' => [Models\Supplier::class, []],
        'supplier_ledger_entry' => [Models\SupplierLedgerEntry::class, []],
        'sale' => [Models\Sale::class, ['items', 'payments', 'creator']],
        'sale_return' => [Models\SaleReturn::class, ['items', 'sale']],
        'purchase' => [Models\Purchase::class, ['items', 'payments']],
        'purchase_return' => [Models\PurchaseReturn::class, ['items']],
        'customer_payment' => [Models\CustomerPayment::class, []],
        'supplier_payment' => [Models\SupplierPayment::class, []],
        'expense_category' => [Models\ExpenseCategory::class, []],
        'expense' => [Models\Expense::class, []],
        'cash_register' => [Models\CashRegister::class, []],
        'cash_transaction' => [Models\CashTransaction::class, []],
        'restaurant_table' => [Models\RestaurantTable::class, []],
        'kitchen_order' => [Models\KitchenOrder::class, []],
        'metal_rate' => [Models\MetalRate::class, []],
        'jewellery_order' => [Models\JewelleryOrder::class, []],
        'coupon' => [Models\Coupon::class, []],
        'notification' => [Models\AppNotification::class, []],
        'sync_conflict' => [Models\SyncConflict::class, []],
    ];

    /**
     * Load current snapshots for a set of entity ids keyed by entity id. Soft-deleted entities are
     * included (devices receive them with deleted_at set).
     *
     * @param  list<string>  $ids
     * @return array<string, SyncableEntity>
     */
    public static function load(string $type, array $ids): array
    {
        if (! isset(self::MAP[$type]) || $ids === []) {
            return [];
        }
        [$class, $with] = self::MAP[$type];
        $query = $class::query()->with($with);
        if (in_array(SoftDeletes::class, class_uses_recursive($class), true)) {
            $query->withoutGlobalScope(SoftDeletingScope::class);
        }
        $key = $type === 'user' ? 'user_id' : 'id';
        $out = [];
        foreach ($query->whereIn($key, $ids)->get() as $model) {
            if ($model instanceof SyncableEntity) {
                $out[(string) $model->getAttribute($key)] = $model;
            }
        }

        return $out;
    }
}
