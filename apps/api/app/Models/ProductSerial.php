<?php

namespace App\Models;

class ProductSerial extends SyncModel
{
    protected $casts = [
        'cost_price' => 'float',
        'warranty_months' => 'integer',
        'sold_at' => 'datetime',
        'version' => 'integer',
    ];

    public static function syncEntityType(): string
    {
        return 'product_serial';
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
            'product_id' => $this->product_id,
            'variant_id' => $this->variant_id,
            'store_id' => $this->store_id,
            'serial_no' => $this->serial_no,
            'imei1' => $this->imei1,
            'imei2' => $this->imei2,
            'status' => $this->status,
            'cost_price' => $this->cost_price,
            'purchase_id' => $this->purchase_id,
            'sale_id' => $this->sale_id,
            'customer_id' => $this->customer_id,
            'warranty_months' => $this->warranty_months,
            'sold_at' => self::iso($this->sold_at),
            'warranty_expires_at' => self::date($this->warranty_expires_at),
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
