<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;

class CashRegister extends SyncModel
{
    protected $casts = [
        'opened_at' => 'datetime',
        'closed_at' => 'datetime',
        'opening_cash' => 'float',
        'cash_sales' => 'float',
        'cash_refunds' => 'float',
        'cash_in' => 'float',
        'cash_out' => 'float',
        'cash_expenses' => 'float',
        'expected_cash' => 'float',
        'closing_cash' => 'float',
        'difference' => 'float',
        'denominations' => 'array',
        'version' => 'integer',
    ];

    public static function syncEntityType(): string
    {
        return 'cash_register';
    }

    public function syncStoreId(): ?string
    {
        return $this->store_id;
    }

    /** @return HasMany<CashTransaction, $this> */
    public function transactions(): HasMany
    {
        return $this->hasMany(CashTransaction::class, 'register_id');
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'store_id' => $this->store_id,
            'device_id' => $this->device_id,
            'status' => $this->status,
            'opened_by' => $this->opened_by,
            'opened_at' => self::iso($this->opened_at),
            'opening_cash' => $this->opening_cash,
            'closed_by' => $this->closed_by,
            'closed_at' => self::iso($this->closed_at),
            'cash_sales' => $this->cash_sales,
            'cash_refunds' => $this->cash_refunds,
            'cash_in' => $this->cash_in,
            'cash_out' => $this->cash_out,
            'cash_expenses' => $this->cash_expenses,
            'expected_cash' => $this->expected_cash,
            'closing_cash' => $this->closing_cash,
            'difference' => $this->difference,
            'denominations' => $this->denominations,
            'notes' => $this->notes,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
