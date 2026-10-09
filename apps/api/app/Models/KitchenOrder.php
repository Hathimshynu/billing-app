<?php

namespace App\Models;

class KitchenOrder extends SyncModel
{
    protected $casts = ['items' => 'array', 'is_void' => 'boolean', 'guests' => 'integer', 'occurred_at' => 'datetime', 'version' => 'integer'];

    public static function syncEntityType(): string
    {
        return 'kitchen_order';
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
            'device_id' => $this->device_id,
            'table_id' => $this->table_id,
            'order_type' => $this->order_type,
            'kot_number' => $this->kot_number,
            'items' => $this->items ?? [],
            'status' => $this->status,
            'is_void' => $this->is_void,
            'guests' => $this->guests,
            'notes' => $this->notes,
            'sale_id' => $this->sale_id,
            'created_by' => $this->created_by,
            'occurred_at' => self::iso($this->occurred_at),
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
