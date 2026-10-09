<?php

namespace App\Models;

use Illuminate\Database\Eloquent\SoftDeletes;

class ProductVariant extends TenantModel
{
    use SoftDeletes;

    protected $casts = [
        'attributes' => 'array',
        'purchase_price' => 'float',
        'selling_price' => 'float',
        'mrp' => 'float',
        'active' => 'boolean',
        'sort_order' => 'integer',
    ];

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'product_id' => $this->product_id,
            'name' => $this->name,
            'sku' => $this->sku,
            'barcode' => $this->barcode,
            'attributes' => (object) ($this->getAttribute('attributes') ?? []),
            'purchase_price' => $this->purchase_price,
            'selling_price' => $this->selling_price,
            'mrp' => $this->mrp,
            'active' => $this->active,
            'sort_order' => $this->sort_order,
        ];
    }
}
