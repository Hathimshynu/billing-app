<?php

namespace App\Models;

class StockAdjustment extends SyncModel
{
    protected $casts = ['items' => 'array', 'occurred_at' => 'datetime', 'version' => 'integer'];

    public static function syncEntityType(): string
    {
        return 'stock_adjustment';
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
            'type' => $this->type,
            'reason' => $this->reason,
            'items' => $this->items ?? [],
            'occurred_at' => self::iso($this->occurred_at),
            'created_by' => $this->created_by,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
