<?php

namespace App\Models;

use App\Models\Concerns\BelongsToBusiness;
use Illuminate\Database\Eloquent\Model;

/**
 * Server-side log of every operation pushed by devices. operation_id is unique, which makes
 * pushes idempotent: replaying an operation returns the stored outcome instead of re-applying it.
 */
class SyncOperation extends Model
{
    use BelongsToBusiness;

    protected $guarded = [];

    protected $casts = [
        'payload' => 'array',
        'result' => 'array',
        'client_created_at' => 'datetime',
        'processed_at' => 'datetime',
    ];
}
