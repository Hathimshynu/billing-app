<?php

namespace App\Support\Tenancy;

use App\Models\Business;
use App\Models\BusinessUser;
use App\Models\Device;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use LogicException;

/**
 * Request-scoped tenant context: the current business, the authenticated member, their effective
 * permissions and the calling device. Resolved by the ResolveTenant middleware from the
 * X-Business-Id header and used by the BusinessScope global scope for tenant isolation.
 */
final class TenantContext
{
    private ?Business $business = null;

    private ?User $user = null;

    private ?BusinessUser $member = null;

    private ?Device $device = null;

    /** @var list<string> */
    private array $permissions = [];

    /** @param list<string> $permissions */
    public function set(Business $business, User $user, BusinessUser $member, array $permissions, ?Device $device = null): void
    {
        $this->business = $business;
        $this->user = $user;
        $this->member = $member;
        $this->permissions = $permissions;
        $this->device = $device;
    }

    /** Bind only the business (console commands, seeders, jobs). */
    public function setBusiness(?Business $business): void
    {
        $this->business = $business;
    }

    public function setDevice(?Device $device): void
    {
        $this->device = $device;
    }

    public function clear(): void
    {
        $this->business = null;
        $this->user = null;
        $this->member = null;
        $this->device = null;
        $this->permissions = [];
    }

    public function hasBusiness(): bool
    {
        return $this->business !== null;
    }

    public function business(): Business
    {
        return $this->business ?? throw new LogicException('No tenant business resolved for this request.');
    }

    public function businessId(): ?string
    {
        return $this->business?->id;
    }

    public function user(): ?User
    {
        return $this->user;
    }

    public function userId(): ?string
    {
        return $this->user?->id;
    }

    public function member(): ?BusinessUser
    {
        return $this->member;
    }

    public function device(): ?Device
    {
        return $this->device;
    }

    /** @return list<string> */
    public function permissions(): array
    {
        return $this->permissions;
    }

    public function can(string $permission): bool
    {
        return in_array($permission, $this->permissions, true);
    }

    /** Members restricted to certain stores (business_users.store_ids) may only work in those. */
    public function canAccessStore(?string $storeId): bool
    {
        if ($storeId === null || ! $this->member) {
            return true;
        }
        $allowed = $this->member->store_ids;

        return ! is_array($allowed) || $allowed === [] || in_array($storeId, $allowed, true);
    }

    /** @throws AuthorizationException */
    public function authorize(string $permission): void
    {
        if (! $this->can($permission)) {
            throw new AuthorizationException("You do not have permission to perform this action ({$permission}).");
        }
    }

    /**
     * Temporarily act as another member of the same business (sync operations are authorized as
     * the user who performed them on the device, not the user who happens to push them).
     *
     * @template T
     *
     * @param  list<string>  $permissions
     * @param  callable(): T  $callback
     * @return T
     */
    public function actingAs(User $user, BusinessUser $member, array $permissions, callable $callback): mixed
    {
        $previous = [$this->user, $this->member, $this->permissions];
        $this->user = $user;
        $this->member = $member;
        $this->permissions = $permissions;
        try {
            return $callback();
        } finally {
            [$this->user, $this->member, $this->permissions] = $previous;
        }
    }
}
