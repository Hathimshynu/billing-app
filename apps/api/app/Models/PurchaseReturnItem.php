<?php

namespace App\Models;

class PurchaseReturnItem extends TenantModel
{
    protected $casts = [
        'quantity' => 'float',
        'unit_cost' => 'float',
        'taxable' => 'float',
        'tax_total' => 'float',
        'total' => 'float',
    ];
}
