<?php

namespace App\Models\Concerns;

use App\Models\Business;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * Tenant isolation for business-owned models: a global scope filters reads and new rows are
 * stamped with the current business. Writing a row for another business is blocked outright.
 */
trait BelongsToBusiness
{
    public static function bootBelongsToBusiness(): void
    {
        static::addGlobalScope(new BusinessScope);

        static::creating(function (Model $model) {
            $tenant = app(TenantContext::class);
            if (! $tenant->hasBusiness()) {
                return;
            }
            if (empty($model->getAttribute('business_id'))) {
                $model->setAttribute('business_id', $tenant->businessId());
            } elseif ($model->getAttribute('business_id') !== $tenant->businessId()) {
                throw new LogicException('Cross-tenant write blocked.');
            }
        });

        static::updating(function (Model $model) {
            $tenant = app(TenantContext::class);
            if ($tenant->hasBusiness() && $model->getOriginal('business_id') !== $tenant->businessId()) {
                throw new LogicException('Cross-tenant write blocked.');
            }
        });
    }

    /** @return BelongsTo<Business, $this> */
    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }
}
