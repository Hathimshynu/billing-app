<?php

namespace App\Models;

class OldGoldPurchase extends TenantModel
{
    protected $casts = [
        'gross_weight' => 'float',
        'stone_weight' => 'float',
        'net_weight' => 'float',
        'deduction_percent' => 'float',
        'effective_weight' => 'float',
        'rate_per_gram' => 'float',
        'value' => 'float',
        'occurred_at' => 'datetime',
    ];
}
