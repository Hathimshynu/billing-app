<?php

namespace App\Models;

class CustomerLedgerEntry extends SyncModel
{
    protected $table = 'customer_ledger';

    protected $casts = ['debit' => 'float', 'credit' => 'float', 'points' => 'integer', 'occurred_at' => 'datetime'];

    public static function syncEntityType(): string
    {
        return 'customer_ledger_entry';
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'customer_id' => $this->customer_id,
            'type' => $this->type,
            'reference_type' => $this->reference_type,
            'reference_id' => $this->reference_id,
            'reference_no' => $this->reference_no,
            'debit' => $this->debit,
            'credit' => $this->credit,
            'points' => $this->points,
            'notes' => $this->notes,
            'occurred_at' => self::iso($this->occurred_at),
            'created_by' => $this->created_by,
            'synced' => 1,
        ];
    }
}
