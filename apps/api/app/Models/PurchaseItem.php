<?php

namespace App\Models;

class PurchaseItem extends TenantModel
{
    protected $casts = [
        'quantity' => 'float',
        'received_qty' => 'float',
        'returned_qty' => 'float',
        'unit_cost' => 'float',
        'mrp' => 'float',
        'selling_price' => 'float',
        'discount_value' => 'float',
        'tax' => 'array',
        'price_includes_tax' => 'boolean',
        'serial_numbers' => 'array',
        'taxable' => 'float',
        'tax_total' => 'float',
        'total' => 'float',
    ];

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'product_id' => $this->product_id,
            'variant_id' => $this->variant_id,
            'name' => $this->name,
            'quantity' => $this->quantity,
            'received_qty' => $this->received_qty,
            'returned_qty' => $this->returned_qty,
            'unit_cost' => $this->unit_cost,
            'mrp' => $this->mrp,
            'selling_price' => $this->selling_price,
            'discount_type' => $this->discount_type,
            'discount_value' => $this->discount_value,
            'tax_rate_id' => $this->tax_rate_id,
            'tax' => $this->tax,
            'price_includes_tax' => $this->price_includes_tax,
            'batch_id' => $this->batch_id,
            'batch_no' => $this->batch_no,
            'expiry_date' => $this->expiry_date ? substr((string) $this->expiry_date, 0, 10) : null,
            'mfg_date' => $this->mfg_date ? substr((string) $this->mfg_date, 0, 10) : null,
            'serial_numbers' => $this->serial_numbers ?? [],
            'taxable' => $this->taxable,
            'tax_total' => $this->tax_total,
            'total' => $this->total,
        ];
    }
}
