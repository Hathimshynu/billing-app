<?php

namespace App\Models;

class SaleReturnItem extends TenantModel
{
    protected $casts = [
        'serial_ids' => 'array',
        'quantity' => 'float',
        'unit_price' => 'float',
        'taxable' => 'float',
        'tax_total' => 'float',
        'total' => 'float',
        'restock' => 'boolean',
    ];
}
