<?php

namespace App\Models;

use App\Models\Concerns\Syncable;
use App\Models\Contracts\SyncableEntity;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Facades\Storage;

class Business extends Model implements SyncableEntity
{
    use HasUuids, SoftDeletes, Syncable;

    protected $guarded = [];

    protected $casts = [
        'modules' => 'array',
        'currency_decimals' => 'integer',
        'fy_start_month' => 'integer',
        'version' => 'integer',
    ];

    public static function syncEntityType(): string
    {
        return 'business';
    }

    public function syncBusinessId(): string
    {
        return (string) $this->id;
    }

    /** @return BelongsTo<User, $this> */
    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    /** @return HasMany<Store, $this> */
    public function stores(): HasMany
    {
        return $this->hasMany(Store::class)->withoutGlobalScopes();
    }

    /** @return HasMany<BusinessUser, $this> */
    public function members(): HasMany
    {
        return $this->hasMany(BusinessUser::class)->withoutGlobalScopes();
    }

    public function hasModule(string $module): bool
    {
        return in_array($module, $this->modules ?? [], true);
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'legal_name' => $this->legal_name,
            'business_type' => $this->business_type,
            'modules' => array_values($this->modules ?? []),
            'country' => $this->country,
            'currency' => $this->currency,
            'currency_decimals' => $this->currency_decimals,
            'locale' => $this->locale,
            'timezone' => $this->timezone,
            'date_format' => $this->date_format,
            'tax_system' => $this->tax_system,
            'gstin' => $this->gstin,
            'state_code' => $this->state_code,
            'fy_start_month' => $this->fy_start_month,
            'phone' => $this->phone,
            'email' => $this->email,
            'address' => $this->address,
            'city' => $this->city,
            'pincode' => $this->pincode,
            'logo_url' => $this->logo_path ? Storage::disk('public')->url($this->logo_path) : null,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
