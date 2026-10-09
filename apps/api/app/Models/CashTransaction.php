<?php

namespace App\Models;

class CashTransaction extends SyncModel
{
    protected $casts = ['amount' => 'float', 'occurred_at' => 'datetime', 'version' => 'integer'];

    public static function syncEntityType(): string
    {
        return 'cash_transaction';
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
            'register_id' => $this->register_id,
            'store_id' => $this->store_id,
            'type' => $this->type,
            'amount' => $this->amount,
            'reason' => $this->reason,
            'occurred_at' => self::iso($this->occurred_at),
            'created_by' => $this->created_by,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
