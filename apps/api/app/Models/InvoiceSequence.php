<?php

namespace App\Models;

class InvoiceSequence extends TenantModel
{
    protected $casts = ['next_number' => 'integer'];
}
