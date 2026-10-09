<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Role extends SyncModel
{
    protected $casts = ['is_system' => 'boolean', 'version' => 'integer'];

    public static function syncEntityType(): string
    {
        return 'role';
    }

    /** @return BelongsToMany<Permission, $this> */
    public function permissions(): BelongsToMany
    {
        return $this->belongsToMany(Permission::class);
    }

    /** @return list<string> */
    public function permissionKeys(): array
    {
        return $this->permissions->pluck('key')->values()->all();
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'key' => $this->key,
            'name' => $this->name,
            'description' => $this->description,
            'permissions' => $this->permissionKeys(),
            'is_system' => $this->is_system,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
