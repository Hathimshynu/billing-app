<?php

namespace App\Models;

class ProductPrice extends TenantModel
{
    protected $casts = ['min_qty' => 'float', 'price' => 'float'];
}
