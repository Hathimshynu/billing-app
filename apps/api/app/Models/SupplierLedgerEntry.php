<?php

namespace App\Models;

class SupplierLedgerEntry extends SyncModel
{
    protected $table = 'supplier_ledger';

    protected $casts = ['debit' => 'float', 'credit' => 'float', 'occurred_at' => 'datetime'];

    public static function syncEntityType(): string
    {
        return 'supplier_ledger_entry';
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'supplier_id' => $this->supplier_id,
            'type' => $this->type,
            'reference_type' => $this->reference_type,
            'reference_id' => $this->reference_id,
            'reference_no' => $this->reference_no,
            'debit' => $this->debit,
            'credit' => $this->credit,
            'notes' => $this->notes,
            'occurred_at' => self::iso($this->occurred_at),
            'created_by' => $this->created_by,
            'synced' => 1,
        ];
    }
}
