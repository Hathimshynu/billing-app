<?php

namespace App\Services\Sync;

use App\Models\BusinessSetting;
use App\Models\CashRegister;
use App\Models\Expense;
use App\Models\KitchenOrder;
use App\Models\MetalRate;
use App\Models\Purchase;
use App\Models\Sale;
use App\Models\StockTransfer;
use App\Models\Store;
use App\Models\SyncConflict;
use App\Services\Audit\AuditLogger;
use App\Services\Finance\FinanceService;
use App\Services\Inventory\StockOperationsService;
use App\Services\Purchases\PurchaseService;
use App\Services\Sales\SaleReturnService;
use App\Services\Sales\SaleService;
use App\Services\Sync\Exceptions\SyncRejected;
use App\Services\Sync\Handlers\MasterDataHandler;
use App\Services\Sync\Handlers\MasterDefinitions;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Arr;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/**
 * Maps every pushable operation (see packages/shared/src/sync.ts SYNC_OPERATIONS) to the domain
 * service that applies it. Controllers and sync share the same services — no duplicated logic.
 */
class OperationRegistry
{
    /** Operation => entity type. Must match the shared contract. */
    public const OPERATIONS = [
        'CREATE_CATEGORY' => 'category', 'UPDATE_CATEGORY' => 'category', 'DELETE_CATEGORY' => 'category',
        'CREATE_BRAND' => 'brand', 'UPDATE_BRAND' => 'brand', 'DELETE_BRAND' => 'brand',
        'CREATE_UNIT' => 'unit', 'UPDATE_UNIT' => 'unit', 'DELETE_UNIT' => 'unit',
        'CREATE_TAX_RATE' => 'tax_rate', 'UPDATE_TAX_RATE' => 'tax_rate', 'DELETE_TAX_RATE' => 'tax_rate',
        'CREATE_PRODUCT' => 'product', 'UPDATE_PRODUCT' => 'product', 'DELETE_PRODUCT' => 'product',
        'CREATE_PRODUCT_BATCH' => 'product_batch', 'UPDATE_PRODUCT_BATCH' => 'product_batch',
        'CREATE_CUSTOMER' => 'customer', 'UPDATE_CUSTOMER' => 'customer', 'DELETE_CUSTOMER' => 'customer',
        'CREATE_SUPPLIER' => 'supplier', 'UPDATE_SUPPLIER' => 'supplier', 'DELETE_SUPPLIER' => 'supplier',
        'CREATE_SALE' => 'sale', 'UPDATE_QUOTATION' => 'sale', 'CANCEL_SALE' => 'sale',
        'CREATE_SALE_RETURN' => 'sale_return',
        'CREATE_PURCHASE' => 'purchase', 'RECEIVE_PURCHASE' => 'purchase', 'CANCEL_PURCHASE' => 'purchase',
        'CREATE_PURCHASE_RETURN' => 'purchase_return',
        'CREATE_STOCK_ADJUSTMENT' => 'stock_adjustment',
        'CREATE_STOCK_TRANSFER' => 'stock_transfer', 'RECEIVE_STOCK_TRANSFER' => 'stock_transfer',
        'CREATE_CUSTOMER_PAYMENT' => 'customer_payment', 'CREATE_SUPPLIER_PAYMENT' => 'supplier_payment',
        'CREATE_EXPENSE_CATEGORY' => 'expense_category', 'UPDATE_EXPENSE_CATEGORY' => 'expense_category', 'DELETE_EXPENSE_CATEGORY' => 'expense_category',
        'CREATE_EXPENSE' => 'expense', 'VOID_EXPENSE' => 'expense',
        'OPEN_CASH_REGISTER' => 'cash_register', 'CLOSE_CASH_REGISTER' => 'cash_register', 'CREATE_CASH_TRANSACTION' => 'cash_transaction',
        'CREATE_RESTAURANT_TABLE' => 'restaurant_table', 'UPDATE_RESTAURANT_TABLE' => 'restaurant_table', 'DELETE_RESTAURANT_TABLE' => 'restaurant_table',
        'CREATE_KITCHEN_ORDER' => 'kitchen_order', 'UPDATE_KITCHEN_ORDER_STATUS' => 'kitchen_order',
        'CREATE_METAL_RATE' => 'metal_rate',
        'CREATE_JEWELLERY_ORDER' => 'jewellery_order', 'UPDATE_JEWELLERY_ORDER' => 'jewellery_order',
        'CREATE_COUPON' => 'coupon', 'UPDATE_COUPON' => 'coupon',
        'UPDATE_SETTING' => 'setting',
        'RESOLVE_CONFLICT' => 'sync_conflict',
    ];

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly MasterDataHandler $master,
        private readonly MasterDefinitions $definitions,
        private readonly SaleService $sales,
        private readonly SaleReturnService $returns,
        private readonly PurchaseService $purchases,
        private readonly StockOperationsService $stock,
        private readonly FinanceService $finance,
        private readonly AuditLogger $audit,
    ) {}

    public function dispatch(OperationContext $op): HandlerResult
    {
        $expectedEntity = self::OPERATIONS[$op->operation] ?? null;
        if ($expectedEntity === null) {
            throw new SyncRejected('unknown_operation', "Unknown operation {$op->operation}.");
        }
        if ($expectedEntity !== $op->entityType) {
            throw new SyncRejected('entity_mismatch', "{$op->operation} must target a {$expectedEntity}.");
        }
        $device = $op->device;
        $user = $op->userId;
        $p = $op->payload;
        foreach (['store_id', 'from_store_id'] as $storeKey) {
            if (isset($p[$storeKey]) && is_string($p[$storeKey]) && ! $this->tenant->canAccessStore($p[$storeKey])) {
                throw new SyncRejected('forbidden', 'This user is not assigned to the store this operation belongs to.');
            }
        }

        [$verb] = explode('_', $op->operation, 2);
        if (in_array($expectedEntity, ['category', 'brand', 'unit', 'tax_rate', 'product', 'product_batch', 'customer', 'supplier', 'expense_category', 'restaurant_table', 'jewellery_order', 'coupon'], true)) {
            $definition = $this->definitions->get($expectedEntity);

            return match ($verb) {
                'CREATE' => $this->master->create($definition, $op),
                'UPDATE' => $this->master->update($definition, $op),
                'DELETE' => $this->master->delete($definition, $op),
                default => throw new SyncRejected('unknown_operation', "Unknown operation {$op->operation}."),
            };
        }

        return match ($op->operation) {
            'CREATE_SALE' => $this->wrap($this->sales->create($p, $op->entityId, $device, $user), 'sale'),
            'UPDATE_QUOTATION' => HandlerResult::ok([$this->sales->updateQuotation($this->find(Sale::class, $op->entityId, 'Sale'), $p, $user, $device)]),
            'CANCEL_SALE' => HandlerResult::ok([$this->sales->cancel($this->find(Sale::class, $op->entityId, 'Sale'), $p['reason'] ?? null, $user, $device, $this->movementIds($p))]),
            'CREATE_SALE_RETURN' => $this->wrap($this->returns->create($p, $op->entityId, $device, $user), 'return'),
            'CREATE_PURCHASE' => $this->wrap($this->purchases->create($p, $op->entityId, $device, $user), 'purchase'),
            'RECEIVE_PURCHASE' => HandlerResult::ok([$this->purchases->receive($this->find(Purchase::class, $op->entityId, 'Purchase'), $p, $device, $user)]),
            'CANCEL_PURCHASE' => HandlerResult::ok([$this->purchases->cancel($this->find(Purchase::class, $op->entityId, 'Purchase'), $user, $device, $this->movementIds($p))]),
            'CREATE_PURCHASE_RETURN' => $this->wrap($this->purchases->createReturn($p, $op->entityId, $device, $user), 'return'),
            'CREATE_STOCK_ADJUSTMENT' => HandlerResult::ok([$this->stock->adjust($p, $op->entityId, $device, $user)]),
            'CREATE_STOCK_TRANSFER' => HandlerResult::ok([$this->stock->transfer($p, $op->entityId, $device, $user)]),
            'RECEIVE_STOCK_TRANSFER' => HandlerResult::ok([$this->stock->receiveTransfer($this->find(StockTransfer::class, $op->entityId, 'Stock transfer'), $device, $user, $this->movementIds($p))]),
            'CREATE_CUSTOMER_PAYMENT' => HandlerResult::ok([$this->finance->customerPayment($p, $op->entityId, $device, $user)]),
            'CREATE_SUPPLIER_PAYMENT' => HandlerResult::ok([$this->finance->supplierPayment($p, $op->entityId, $device, $user)]),
            'CREATE_EXPENSE' => HandlerResult::ok([$this->finance->expense($p, $op->entityId, $device, $user)]),
            'VOID_EXPENSE' => HandlerResult::ok([$this->finance->voidExpense($this->find(Expense::class, $op->entityId, 'Expense'), $user, $device)]),
            'OPEN_CASH_REGISTER' => HandlerResult::ok([$this->finance->openRegister($p, $op->entityId, $device, $user)]),
            'CLOSE_CASH_REGISTER' => HandlerResult::ok([$this->finance->closeRegister($this->find(CashRegister::class, $op->entityId, 'Cash register'), $p, $device, $user)]),
            'CREATE_CASH_TRANSACTION' => HandlerResult::ok([$this->finance->cashTransaction($p, $op->entityId, $device, $user)]),
            'CREATE_KITCHEN_ORDER' => HandlerResult::ok([$this->createKitchenOrder($op)]),
            'UPDATE_KITCHEN_ORDER_STATUS' => HandlerResult::ok([$this->updateKitchenStatus($op)]),
            'CREATE_METAL_RATE' => HandlerResult::ok([$this->createMetalRate($op)]),
            'UPDATE_SETTING' => $this->updateSetting($op),
            'RESOLVE_CONFLICT' => HandlerResult::ok([$this->resolveConflict($op)]),
            default => throw new SyncRejected('unknown_operation', "Unknown operation {$op->operation}."),
        };
    }

    /**
     * Movement ids generated on the device for reversal operations (item id → movement id).
     *
     * @param  array<string, mixed>  $payload
     * @return array<string, string>
     */
    private function movementIds(array $payload): array
    {
        $ids = $payload['movement_ids'] ?? [];

        return is_array($ids) ? array_filter($ids, fn ($v, $k) => is_string($k) && is_string($v), ARRAY_FILTER_USE_BOTH) : [];
    }

    /** @param array<string, mixed> $outcome */
    private function wrap(array $outcome, string $key): HandlerResult
    {
        return HandlerResult::ok([$outcome[$key]], $outcome['result']);
    }

    /**
     * @template T of \Illuminate\Database\Eloquent\Model
     *
     * @param  class-string<T>  $class
     * @return T
     */
    private function find(string $class, string $id, string $label): mixed
    {
        return $class::query()->whereKey($id)->first() ?? throw SyncRejected::dependency($label);
    }

    /** @param array<string, mixed> $rules @param array<string, mixed> $payload @return array<string, mixed> */
    private function validate(array $payload, array $rules): array
    {
        $validator = Validator::make($payload, $rules);
        if ($validator->fails()) {
            throw SyncRejected::invalid($validator->errors()->toArray());
        }

        return $validator->validated();
    }

    private function createKitchenOrder(OperationContext $op): KitchenOrder
    {
        if ($existing = KitchenOrder::query()->find($op->entityId)) {
            return $existing;
        }
        if (! $this->tenant->can('restaurant.manage')) {
            throw SyncRejected::forbidden('restaurant.manage');
        }
        $data = $this->validate($op->payload, [
            'store_id' => ['required', 'uuid'],
            'table_id' => ['nullable', 'uuid'],
            'order_type' => ['required', Rule::in(['dine_in', 'takeaway', 'delivery', 'retail'])],
            'kot_number' => ['required', 'string', 'max:40'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.id' => ['required', 'uuid'],
            'items.*.product_id' => ['required', 'uuid'],
            'items.*.variant_id' => ['nullable', 'uuid'],
            'items.*.name' => ['required', 'string', 'max:200'],
            'items.*.quantity' => ['required', 'numeric', 'not_in:0'],
            'items.*.unit_price' => ['required', 'numeric', 'min:0'],
            'items.*.modifiers' => ['nullable', 'array'],
            'items.*.notes' => ['nullable', 'string', 'max:300'],
            'is_void' => ['boolean'],
            'guests' => ['nullable', 'integer', 'min:1'],
            'notes' => ['nullable', 'string', 'max:500'],
            'occurred_at' => ['required', 'date'],
        ]);
        if (! Store::query()->whereKey($data['store_id'])->exists()) {
            throw SyncRejected::invalid(['store_id' => ['Unknown store.']]);
        }

        return KitchenOrder::query()->create([
            'id' => $op->entityId,
            'store_id' => $data['store_id'],
            'device_id' => $op->deviceId(),
            'table_id' => $data['table_id'] ?? null,
            'order_type' => $data['order_type'],
            'kot_number' => $data['kot_number'],
            'items' => $data['items'],
            'status' => 'pending',
            'is_void' => (bool) ($data['is_void'] ?? false),
            'guests' => $data['guests'] ?? null,
            'notes' => $data['notes'] ?? null,
            'created_by' => $op->userId,
            'occurred_at' => Carbon::parse($data['occurred_at']),
        ]);
    }

    private function updateKitchenStatus(OperationContext $op): KitchenOrder
    {
        if (! $this->tenant->can('kitchen.view') && ! $this->tenant->can('restaurant.manage')) {
            throw SyncRejected::forbidden('kitchen.view');
        }
        $data = $this->validate($op->payload, ['status' => ['required', Rule::in(['pending', 'preparing', 'ready', 'served', 'cancelled'])]]);
        $kot = $this->find(KitchenOrder::class, $op->entityId, 'Kitchen order');
        $kot->status = $data['status'];
        $kot->save();

        return $kot;
    }

    private function createMetalRate(OperationContext $op): MetalRate
    {
        if ($existing = MetalRate::query()->find($op->entityId)) {
            return $existing;
        }
        if (! $this->tenant->can('jewellery.rates')) {
            throw SyncRejected::forbidden('jewellery.rates');
        }
        $data = $this->validate($op->payload, [
            'metal' => ['required', Rule::in(['gold', 'silver', 'platinum', 'diamond', 'other'])],
            'purity' => ['required', 'string', 'max:16'],
            'rate_per_gram' => ['required', 'numeric', 'gt:0'],
            'effective_from' => ['required', 'date'],
        ]);
        $rate = MetalRate::query()->create([
            'id' => $op->entityId,
            'metal' => $data['metal'],
            'purity' => $data['purity'],
            'rate_per_gram' => $data['rate_per_gram'],
            'effective_from' => Carbon::parse($data['effective_from']),
            'created_by' => $op->userId,
        ]);
        $this->audit->log('METAL_RATE_SET', 'metal_rate', $rate->id, null, Arr::only($data, ['metal', 'purity', 'rate_per_gram']), $op->userId, $op->deviceId());

        return $rate;
    }

    private function updateSetting(OperationContext $op): HandlerResult
    {
        if (! $this->tenant->can('settings.manage')) {
            throw SyncRejected::forbidden('settings.manage');
        }
        $data = $this->validate($op->payload, [
            'key' => ['required', Rule::in(['invoice', 'pos', 'printer', 'loyalty', 'notifications', 'appearance'])],
            'changes' => ['required', 'array'],
            'base' => ['nullable', 'array'],
        ]);
        $setting = BusinessSetting::query()->where('key', $data['key'])->first()
            ?? BusinessSetting::query()->create(['id' => $op->entityId, 'key' => $data['key'], 'value' => []]);
        $current = $setting->value ?? [];
        $conflicts = [];
        if ($op->baseVersion !== null && $setting->version !== $op->baseVersion) {
            foreach ($data['changes'] as $field => $value) {
                if (array_key_exists($field, $data['base'] ?? []) && ! ValueComparator::equals($current[$field] ?? null, $data['base'][$field]) && ! ValueComparator::equals($current[$field] ?? null, $value)) {
                    $conflicts[] = ['field' => $field, 'base' => $data['base'][$field], 'local' => $value, 'server' => $current[$field] ?? null];
                }
            }
        }
        $apply = Arr::except($data['changes'], array_column($conflicts, 'field'));
        if ($apply !== []) {
            $setting->value = array_replace($current, $apply);
            $setting->save();
            $this->audit->log('SETTINGS_UPDATED', 'setting', $setting->id, Arr::only($current, array_keys($apply)), $apply, $op->userId, $op->deviceId());
        }

        return $conflicts === []
            ? HandlerResult::ok([$setting])
            : new HandlerResult(entities: [$setting], conflictFields: $conflicts, conflictType: 'field', conflictMessage: 'Settings were changed on another device.', conflictEntity: $setting);
    }

    private function resolveConflict(OperationContext $op): SyncConflict
    {
        $data = $this->validate($op->payload, ['resolution' => ['required', Rule::in(['keep_local', 'keep_server', 'reviewed'])]]);
        $conflict = $this->find(SyncConflict::class, $op->entityId, 'Conflict');
        if (! $this->tenant->can('sync.manage') && $conflict->user_id !== $op->userId) {
            throw SyncRejected::forbidden('sync.manage');
        }
        $conflict->status = 'resolved';
        $conflict->resolution = $data['resolution'];
        $conflict->resolved_by = $op->userId;
        $conflict->resolved_at = now();
        $conflict->save();
        $this->audit->log('CONFLICT_RESOLVED', 'sync_conflict', $conflict->id, null, ['resolution' => $data['resolution']], $op->userId, $op->deviceId());

        return $conflict;
    }
}
