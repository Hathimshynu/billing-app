<?php

namespace App\Models;

class SaleItem extends TenantModel
{
    protected $casts = [
        'serial_ids' => 'array',
        'serial_numbers' => 'array',
        'tax' => 'array',
        'taxes' => 'array',
        'modifiers' => 'array',
        'jewellery' => 'array',
        'quantity' => 'float',
        'unit_price' => 'float',
        'mrp' => 'float',
        'cost_price' => 'float',
        'discount_value' => 'float',
        'gross' => 'float',
        'line_discount' => 'float',
        'bill_discount' => 'float',
        'taxable' => 'float',
        'tax_total' => 'float',
        'total' => 'float',
        'returned_qty' => 'float',
        'price_includes_tax' => 'boolean',
        'warranty_months' => 'integer',
    ];

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'product_id' => $this->product_id,
            'variant_id' => $this->variant_id,
            'batch_id' => $this->batch_id,
            'serial_ids' => $this->serial_ids ?? [],
            'serial_numbers' => $this->serial_numbers ?? [],
            'name' => $this->name,
            'sku' => $this->sku,
            'hsn_code' => $this->hsn_code,
            'unit_code' => $this->unit_code,
            'quantity' => $this->quantity,
            'unit_price' => $this->unit_price,
            'mrp' => $this->mrp,
            'cost_price' => $this->cost_price,
            'price_includes_tax' => $this->price_includes_tax,
            'discount_type' => $this->discount_type,
            'discount_value' => $this->discount_value,
            'tax_rate_id' => $this->tax_rate_id,
            'tax' => $this->tax,
            'gross' => $this->gross,
            'line_discount' => $this->line_discount,
            'bill_discount' => $this->bill_discount,
            'taxable' => $this->taxable,
            'taxes' => $this->taxes ?? [],
            'tax_total' => $this->tax_total,
            'total' => $this->total,
            'returned_qty' => $this->returned_qty,
            'modifiers' => $this->modifiers ?? [],
            'jewellery' => $this->jewellery,
            'warranty_months' => $this->warranty_months,
            'kitchen_order_id' => $this->kitchen_order_id,
            'notes' => $this->notes,
        ];
    }
}
