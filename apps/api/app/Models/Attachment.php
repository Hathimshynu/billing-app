<?php

namespace App\Models;

class Attachment extends TenantModel
{
    protected $casts = ['size' => 'integer'];
}
