<?php

namespace App\Models;

class StockTransfer extends SyncModel
{
    protected $casts = ['items' => 'array', 'sent_at' => 'datetime', 'received_at' => 'datetime', 'version' => 'integer'];

    public static function syncEntityType(): string
    {
        return 'stock_transfer';
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'from_store_id' => $this->from_store_id,
            'to_store_id' => $this->to_store_id,
            'transfer_number' => $this->transfer_number,
            'status' => $this->status,
            'items' => $this->items ?? [],
            'notes' => $this->notes,
            'created_by' => $this->created_by,
            'sent_at' => self::iso($this->sent_at),
            'received_at' => self::iso($this->received_at),
            'received_by' => $this->received_by,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
