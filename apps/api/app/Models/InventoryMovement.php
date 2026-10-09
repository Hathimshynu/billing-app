<?php

namespace App\Models;

class InventoryMovement extends SyncModel
{
    protected $casts = [
        'qty_in' => 'float',
        'qty_out' => 'float',
        'unit_cost' => 'float',
        'balance_after' => 'float',
        'occurred_at' => 'datetime',
    ];

    public static function syncEntityType(): string
    {
        return 'inventory_movement';
    }

    public function syncStoreId(): ?string
    {
        return $this->store_id;
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'store_id' => $this->store_id,
            'product_id' => $this->product_id,
            'variant_id' => $this->variant_id,
            'batch_id' => $this->batch_id,
            'type' => $this->type,
            'qty_in' => $this->qty_in,
            'qty_out' => $this->qty_out,
            'unit_cost' => $this->unit_cost,
            'balance_after' => $this->balance_after,
            'reference_type' => $this->reference_type,
            'reference_id' => $this->reference_id,
            'reference_no' => $this->reference_no,
            'notes' => $this->notes,
            'created_by' => $this->created_by,
            'device_id' => $this->device_id,
            'occurred_at' => self::iso($this->occurred_at),
            'synced' => 1,
        ];
    }
}
