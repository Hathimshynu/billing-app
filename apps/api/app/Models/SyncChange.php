<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Per-business change feed. The auto-increment id is the pull cursor.
 */
class SyncChange extends Model
{
    public $timestamps = false;

    protected $guarded = [];

    protected $casts = ['created_at' => 'datetime'];
}
