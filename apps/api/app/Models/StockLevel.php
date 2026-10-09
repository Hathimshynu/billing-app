<?php

namespace App\Models;

/**
 * Running stock per store/product/variant/batch (table `inventory`). Only ever changed by
 * InventoryService::move() from immutable inventory movements.
 */
class StockLevel extends SyncModel
{
    protected $table = 'inventory';

    protected $casts = ['qty' => 'float', 'avg_cost' => 'float', 'version' => 'integer'];

    public static function syncEntityType(): string
    {
        return 'stock_level';
    }

    public function syncStoreId(): ?string
    {
        return $this->store_id;
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'stock_key' => $this->stock_key,
            'id' => $this->id,
            'business_id' => $this->business_id,
            'store_id' => $this->store_id,
            'product_id' => $this->product_id,
            'variant_id' => $this->variant_id,
            'batch_id' => $this->batch_id,
            'qty' => $this->qty,
            'server_qty' => $this->qty,
            'avg_cost' => $this->avg_cost,
            'version' => $this->version,
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
