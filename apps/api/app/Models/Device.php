<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Device extends SyncModel
{
    protected $casts = ['last_seen_at' => 'datetime', 'last_sync_at' => 'datetime', 'version' => 'integer'];

    public static function syncEntityType(): string
    {
        return 'device';
    }

    /** @return BelongsTo<Store, $this> */
    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function isActive(): bool
    {
        return $this->status === 'active';
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'store_id' => $this->store_id,
            'name' => $this->name,
            'code' => $this->code,
            'platform' => $this->platform,
            'status' => $this->status,
            'last_seen_at' => self::iso($this->last_seen_at),
            'last_sync_at' => self::iso($this->last_sync_at),
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
