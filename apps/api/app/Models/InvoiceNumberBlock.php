<?php

namespace App\Models;

class InvoiceNumberBlock extends TenantModel
{
    protected $casts = ['start_number' => 'integer', 'end_number' => 'integer'];
}
