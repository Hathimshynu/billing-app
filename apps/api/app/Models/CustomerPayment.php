<?php

namespace App\Models;

class CustomerPayment extends SyncModel
{
    protected $casts = ['amount' => 'float', 'version' => 'integer'];

    public static function syncEntityType(): string
    {
        return 'customer_payment';
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'store_id' => $this->store_id,
            'device_id' => $this->device_id,
            'register_id' => $this->register_id,
            'customer_id' => $this->customer_id,
            'sale_id' => $this->sale_id,
            'receipt_number' => $this->receipt_number,
            'amount' => $this->amount,
            'method' => $this->method,
            'reference' => $this->reference,
            'payment_date' => self::date($this->payment_date),
            'notes' => $this->notes,
            'created_by' => $this->created_by,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
