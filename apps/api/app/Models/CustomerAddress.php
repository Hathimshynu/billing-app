<?php

namespace App\Models;

class CustomerAddress extends TenantModel
{
    protected $casts = ['is_default' => 'boolean'];
}
