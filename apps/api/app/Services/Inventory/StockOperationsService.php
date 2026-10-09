<?php

namespace App\Services\Inventory;

use App\Models\Device;
use App\Models\Product;
use App\Models\StockAdjustment;
use App\Models\StockTransfer;
use App\Models\Store;
use App\Services\Audit\AuditLogger;
use App\Services\Numbering\NumberingService;
use App\Services\Sync\Exceptions\SyncRejected;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Stock adjustments (count corrections, opening stock, damage, expiry write-offs) and
 * store-to-store transfers. Both are expressed purely as inventory movements.
 */
class StockOperationsService
{
    private const ADJUSTMENT_TYPES = [
        'adjustment' => 'ADJUSTMENT',
        'opening_stock' => 'OPENING_STOCK',
        'damage' => 'DAMAGE',
        'expired' => 'EXPIRED',
    ];

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly InventoryService $inventory,
        private readonly NumberingService $numbering,
        private readonly AuditLogger $audit,
    ) {}

    /** @param array<string, mixed> $payload */
    public function adjust(array $payload, string $id, ?Device $device, string $userId): StockAdjustment
    {
        $existing = StockAdjustment::query()->find($id);
        if ($existing) {
            return $existing;
        }
        if (! $this->tenant->can('inventory.adjust')) {
            throw SyncRejected::forbidden('inventory.adjust');
        }
        $validator = Validator::make($payload, [
            'store_id' => ['required', 'uuid'],
            'type' => ['required', Rule::in(array_keys(self::ADJUSTMENT_TYPES))],
            'reason' => ['nullable', 'string', 'max:500'],
            'occurred_at' => ['required', 'date'],
            'items' => ['required', 'array', 'min:1', 'max:1000'],
            'items.*.id' => ['required', 'uuid'],
            'items.*.product_id' => ['required', 'uuid'],
            'items.*.variant_id' => ['nullable', 'uuid'],
            'items.*.batch_id' => ['nullable', 'uuid'],
            'items.*.quantity' => ['required', 'numeric', 'not_in:0'],
            'items.*.unit_cost' => ['nullable', 'numeric', 'min:0'],
            'items.*.movement_id' => ['nullable', 'uuid'],
        ]);
        if ($validator->fails()) {
            throw SyncRejected::invalid($validator->errors()->toArray());
        }
        $data = $validator->validated();
        if (! Store::query()->whereKey($data['store_id'])->exists()) {
            throw SyncRejected::invalid(['store_id' => ['Unknown store.']]);
        }
        $productIds = array_values(array_unique(array_column($data['items'], 'product_id')));
        if (Product::withTrashed()->whereIn('id', $productIds)->count() !== count($productIds)) {
            throw SyncRejected::dependency('Product');
        }

        $adjustment = StockAdjustment::query()->create([
            'id' => $id,
            'store_id' => $data['store_id'],
            'device_id' => $device?->id,
            'type' => $data['type'],
            'reason' => $data['reason'] ?? null,
            'items' => array_map(fn ($i) => [
                'id' => $i['id'], 'product_id' => $i['product_id'], 'variant_id' => $i['variant_id'] ?? null,
                'batch_id' => $i['batch_id'] ?? null, 'quantity' => (float) $i['quantity'], 'unit_cost' => (float) ($i['unit_cost'] ?? 0),
            ], $data['items']),
            'occurred_at' => Carbon::parse($data['occurred_at']),
            'created_by' => $userId,
        ]);
        $movementType = self::ADJUSTMENT_TYPES[$data['type']];
        foreach ($data['items'] as $item) {
            $qty = (float) $item['quantity'];
            $this->inventory->move([
                'id' => $item['movement_id'] ?? null,
                'store_id' => $data['store_id'],
                'product_id' => $item['product_id'],
                'variant_id' => $item['variant_id'] ?? null,
                'batch_id' => $item['batch_id'] ?? null,
                'type' => $movementType,
                'qty_in' => $qty > 0 ? $qty : 0,
                'qty_out' => $qty < 0 ? -$qty : 0,
                'unit_cost' => (float) ($item['unit_cost'] ?? 0),
                'reference_type' => 'stock_adjustment',
                'reference_id' => $adjustment->id,
                'notes' => $data['reason'] ?? null,
                'created_by' => $userId,
                'device_id' => $device?->id,
                'occurred_at' => $adjustment->occurred_at,
            ]);
        }
        $this->audit->log('STOCK_ADJUSTED', 'stock_adjustment', $adjustment->id, null, ['type' => $data['type'], 'items' => count($data['items']), 'reason' => $data['reason'] ?? null], $userId, $device?->id);

        return $adjustment;
    }

    /** @param array<string, mixed> $payload */
    public function transfer(array $payload, string $id, ?Device $device, string $userId): StockTransfer
    {
        $existing = StockTransfer::query()->find($id);
        if ($existing) {
            return $existing;
        }
        if (! $this->tenant->can('inventory.transfer')) {
            throw SyncRejected::forbidden('inventory.transfer');
        }
        $validator = Validator::make($payload, [
            'from_store_id' => ['required', 'uuid', 'different:to_store_id'],
            'to_store_id' => ['required', 'uuid'],
            'transfer_number' => ['nullable', 'string', 'max:40'],
            'notes' => ['nullable', 'string', 'max:500'],
            'sent_at' => ['required', 'date'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.id' => ['required', 'uuid'],
            'items.*.product_id' => ['required', 'uuid'],
            'items.*.variant_id' => ['nullable', 'uuid'],
            'items.*.batch_id' => ['nullable', 'uuid'],
            'items.*.quantity' => ['required', 'numeric', 'gt:0'],
            'items.*.unit_cost' => ['nullable', 'numeric', 'min:0'],
            'items.*.movement_id' => ['nullable', 'uuid'],
        ]);
        if ($validator->fails()) {
            throw SyncRejected::invalid($validator->errors()->toArray());
        }
        $data = $validator->validated();
        if (Store::query()->whereIn('id', [$data['from_store_id'], $data['to_store_id']])->count() !== 2) {
            throw SyncRejected::invalid(['to_store_id' => ['Unknown store.']]);
        }
        $number = $this->numbering->allocate('stock_transfer', Carbon::parse($data['sent_at'])->toDateString(), $device, $data['from_store_id']);
        $transfer = StockTransfer::query()->create([
            'id' => $id,
            'from_store_id' => $data['from_store_id'],
            'to_store_id' => $data['to_store_id'],
            'transfer_number' => $number['number'],
            'status' => 'in_transit',
            'items' => array_map(fn ($i) => [
                'id' => $i['id'], 'product_id' => $i['product_id'], 'variant_id' => $i['variant_id'] ?? null,
                'batch_id' => $i['batch_id'] ?? null, 'quantity' => (float) $i['quantity'],
                'unit_cost' => (float) ($i['unit_cost'] ?? $this->inventory->averageCost($data['from_store_id'], $i['product_id'], $i['variant_id'] ?? null, $i['batch_id'] ?? null)),
            ], $data['items']),
            'notes' => $data['notes'] ?? null,
            'created_by' => $userId,
            'sent_at' => Carbon::parse($data['sent_at']),
        ]);
        foreach ($transfer->items as $i => $item) {
            $this->inventory->move([
                'id' => $data['items'][$i]['movement_id'] ?? null,
                'store_id' => $transfer->from_store_id, 'product_id' => $item['product_id'], 'variant_id' => $item['variant_id'],
                'batch_id' => $item['batch_id'], 'type' => 'TRANSFER_OUT', 'qty_out' => $item['quantity'], 'unit_cost' => $item['unit_cost'],
                'reference_type' => 'stock_transfer', 'reference_id' => $transfer->id, 'reference_no' => $transfer->transfer_number,
                'created_by' => $userId, 'device_id' => $device?->id, 'occurred_at' => $transfer->sent_at,
            ]);
        }
        $this->audit->log('STOCK_TRANSFERRED', 'stock_transfer', $transfer->id, null, ['number' => $transfer->transfer_number], $userId, $device?->id);

        return $transfer;
    }

    /** @param array<string, string> $movementIds transfer item id → movement id generated on the device */
    public function receiveTransfer(StockTransfer $transfer, ?Device $device, string $userId, array $movementIds = []): StockTransfer
    {
        if (! $this->tenant->can('inventory.transfer')) {
            throw SyncRejected::forbidden('inventory.transfer');
        }
        if ($transfer->status !== 'in_transit') {
            return $transfer;
        }
        foreach ($transfer->items as $item) {
            $movementId = $movementIds[$item['id'] ?? ''] ?? null;
            $this->inventory->move([
                'id' => is_string($movementId) && Str::isUuid($movementId) ? $movementId : null,
                'store_id' => $transfer->to_store_id, 'product_id' => $item['product_id'], 'variant_id' => $item['variant_id'] ?? null,
                'batch_id' => $item['batch_id'] ?? null, 'type' => 'TRANSFER_IN', 'qty_in' => $item['quantity'], 'unit_cost' => $item['unit_cost'] ?? 0,
                'reference_type' => 'stock_transfer', 'reference_id' => $transfer->id, 'reference_no' => $transfer->transfer_number,
                'created_by' => $userId, 'device_id' => $device?->id,
            ]);
        }
        $transfer->status = 'received';
        $transfer->received_at = now();
        $transfer->received_by = $userId;
        $transfer->save();
        $this->audit->log('STOCK_TRANSFER_RECEIVED', 'stock_transfer', $transfer->id, null, null, $userId, $device?->id);

        return $transfer;
    }
}
