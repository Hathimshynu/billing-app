<?php

namespace App\Models;

use App\Models\Concerns\BelongsToBusiness;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * Base for every business-owned record. UUID keys (client-generated ids are preserved) and
 * tenant isolation. Mass assignment is open because services only ever pass validated,
 * explicitly whitelisted attributes.
 */
abstract class TenantModel extends Model
{
    use BelongsToBusiness;
    use HasUuids;

    protected $guarded = [];
}
