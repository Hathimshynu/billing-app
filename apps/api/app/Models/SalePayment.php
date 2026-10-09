<?php

namespace App\Models;

class SalePayment extends TenantModel
{
    protected $casts = [
        'amount' => 'float',
        'tendered' => 'float',
        'change' => 'float',
        'meta' => 'array',
        'occurred_at' => 'datetime',
    ];

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        $meta = $this->meta ?? [];

        return [
            'id' => $this->id,
            'method' => $this->method,
            'amount' => $this->amount,
            'reference' => $this->reference,
            'tendered' => $this->tendered,
            'change' => $this->change,
            'old_gold' => $meta['old_gold'] ?? null,
            'occurred_at' => $this->occurred_at?->toIso8601ZuluString('millisecond'),
        ];
    }
}
