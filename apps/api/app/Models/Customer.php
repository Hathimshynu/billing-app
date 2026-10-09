<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Customer extends SyncModel
{
    use SoftDeletes;

    protected $casts = [
        'credit_limit' => 'float',
        'opening_balance' => 'float',
        'balance' => 'float',
        'loyalty_points' => 'integer',
        'active' => 'boolean',
        'version' => 'integer',
    ];

    public static function syncEntityType(): string
    {
        return 'customer';
    }

    /** @return HasMany<CustomerLedgerEntry, $this> */
    public function ledger(): HasMany
    {
        return $this->hasMany(CustomerLedgerEntry::class);
    }

    /** @return HasMany<CustomerAddress, $this> */
    public function addresses(): HasMany
    {
        return $this->hasMany(CustomerAddress::class);
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
            'pincode' => $this->pincode,
            'gstin' => $this->gstin,
            'credit_limit' => $this->credit_limit,
            'opening_balance' => $this->opening_balance,
            'balance' => $this->balance,
            'loyalty_points' => $this->loyalty_points,
            'tier' => $this->tier,
            'notes' => $this->notes,
            'date_of_birth' => self::date($this->date_of_birth),
            'active' => $this->active,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
            'deleted_at' => self::iso($this->deleted_at),
        ];
    }
}
