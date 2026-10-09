<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Supplier extends SyncModel
{
    use SoftDeletes;

    protected $casts = [
        'opening_balance' => 'float',
        'balance' => 'float',
        'credit_days' => 'integer',
        'active' => 'boolean',
        'version' => 'integer',
    ];

    public static function syncEntityType(): string
    {
        return 'supplier';
    }

    /** @return HasMany<SupplierLedgerEntry, $this> */
    public function ledger(): HasMany
    {
        return $this->hasMany(SupplierLedgerEntry::class);
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'name' => $this->name,
            'phone' => $this->phone,
            'email' => $this->email,
            'address' => $this->address,
            'city' => $this->city,
            'state_code' => $this->state_code,
            'gstin' => $this->gstin,
            'opening_balance' => $this->opening_balance,
            'balance' => $this->balance,
            'credit_days' => $this->credit_days,
            'notes' => $this->notes,
            'active' => $this->active,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
            'deleted_at' => self::iso($this->deleted_at),
        ];
    }
}
