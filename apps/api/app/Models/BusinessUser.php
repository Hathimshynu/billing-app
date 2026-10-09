<?php

namespace App\Models;

use App\Domain\Auth\Permissions;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Membership of a user in a business (with role). Synced to devices as the `user` entity keyed
 * by user_id so created_by references can be shown with names offline.
 */
class BusinessUser extends SyncModel
{
    protected $casts = ['store_ids' => 'array', 'version' => 'integer'];

    public static function syncEntityType(): string
    {
        return 'user';
    }

    public function syncEntityId(): string
    {
        return (string) $this->user_id;
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return BelongsTo<Role, $this> */
    public function role(): BelongsTo
    {
        return $this->belongsTo(Role::class);
    }

    /** @return list<string> */
    public function effectivePermissions(): array
    {
        $role = $this->role;
        if (! $role) {
            return [];
        }
        if ($role->key === 'owner') {
            return Permissions::all();
        }

        return $role->permissionKeys();
    }

    public function isActive(): bool
    {
        return $this->status === 'active';
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        $this->loadMissing(['user', 'role.permissions']);

        return [
            'id' => $this->user_id,
            'membership_id' => $this->id,
            'business_id' => $this->business_id,
            'name' => $this->user?->name,
            'email' => $this->user?->email,
            'phone' => $this->user?->phone,
            'role_id' => $this->role_id,
            'role_key' => $this->role?->key,
            'role_name' => $this->role?->name,
            'permissions' => $this->effectivePermissions(),
            'status' => $this->status,
            'store_ids' => $this->store_ids,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
