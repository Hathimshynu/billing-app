<?php

namespace App\Models;

class JewelleryOrder extends SyncModel
{
    protected $casts = [
        'weight' => 'float',
        'estimated_amount' => 'float',
        'advance_paid' => 'float',
        'delivered_at' => 'datetime',
        'version' => 'integer',
    ];

    public static function syncEntityType(): string
    {
        return 'jewellery_order';
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
            'store_id' => $this->store_id,
            'order_number' => $this->order_number,
            'type' => $this->type,
            'customer_id' => $this->customer_id,
            'customer_name' => $this->customer_name,
            'customer_phone' => $this->customer_phone,
            'description' => $this->description,
            'metal' => $this->metal,
            'purity' => $this->purity,
            'weight' => $this->weight,
            'estimated_amount' => $this->estimated_amount,
            'advance_paid' => $this->advance_paid,
            'advance_method' => $this->advance_method,
            'due_date' => self::date($this->due_date),
            'status' => $this->status,
            'delivered_at' => self::iso($this->delivered_at),
            'sale_id' => $this->sale_id,
            'notes' => $this->notes,
            'created_by' => $this->created_by,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
