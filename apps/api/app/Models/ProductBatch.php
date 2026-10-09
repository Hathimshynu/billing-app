<?php

namespace App\Models;

use Illuminate\Database\Eloquent\SoftDeletes;

class ProductBatch extends SyncModel
{
    use SoftDeletes;

    protected $casts = [
        'mrp' => 'float',
        'purchase_price' => 'float',
        'selling_price' => 'float',
        'version' => 'integer',
    ];

    public static function syncEntityType(): string
    {
        return 'product_batch';
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'product_id' => $this->product_id,
            'variant_id' => $this->variant_id,
            'batch_no' => $this->batch_no,
            'expiry_date' => self::date($this->expiry_date),
            'mfg_date' => self::date($this->mfg_date),
            'mrp' => $this->mrp,
            'purchase_price' => $this->purchase_price,
            'selling_price' => $this->selling_price,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
            'deleted_at' => self::iso($this->deleted_at),
        ];
    }
}
