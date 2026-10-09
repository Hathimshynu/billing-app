<?php

namespace App\Models;

class PurchasePayment extends TenantModel
{
    protected $casts = ['amount' => 'float', 'occurred_at' => 'datetime'];
}
