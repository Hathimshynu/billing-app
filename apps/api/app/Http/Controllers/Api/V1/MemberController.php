<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\BusinessUser;
use App\Models\Role;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use App\Support\ApiResponse;
use App\Support\Tenancy\BusinessLock;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

/**
 * Employees (business members) and their roles. Online-only administration.
 */
class MemberController extends Controller
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly AuditLogger $audit,
        private readonly BusinessLock $lock,
    ) {}

    public function index(): JsonResponse
    {
        return ApiResponse::ok(BusinessUser::query()->with(['user', 'role.permissions'])->get()->map->toSyncArray()->values());
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'email' => ['required', 'email', 'max:190'],
            'phone' => ['nullable', 'string', 'max:20'],
            'role_id' => ['required', 'uuid'],
            'password' => ['nullable', Password::min(8)->letters()->numbers()],
            'store_ids' => ['nullable', 'array'],
            'store_ids.*' => ['uuid'],
        ]);
        $role = Role::query()->findOrFail($data['role_id']);
        $this->guardOwnerRole($role);

        $member = $this->lock->transaction((string) $this->tenant->businessId(), function () use ($data, $role) {
            $user = User::query()->where('email', strtolower($data['email']))->first();
            if (! $user) {
                if (empty($data['password'])) {
                    abort(response()->json(['success' => false, 'message' => 'Set an initial password for the new employee.', 'errors' => ['password' => ['Password is required for new users.']]], 422));
                }
                $user = User::query()->create([
                    'name' => $data['name'],
                    'email' => strtolower($data['email']),
                    'phone' => $data['phone'] ?? null,
                    'password' => $data['password'],
                ]);
            }
            if (BusinessUser::query()->where('user_id', $user->id)->exists()) {
                abort(response()->json(['success' => false, 'message' => 'This person is already a member of the business.', 'errors' => ['email' => ['Already a member.']]], 422));
            }
            $member = BusinessUser::query()->create([
                'user_id' => $user->id,
                'role_id' => $role->id,
                'status' => 'active',
                'store_ids' => $data['store_ids'] ?? null,
            ]);
            $this->audit->log('USER_CREATED', 'user', $user->id, null, ['email' => $user->email, 'role' => $role->key]);

            return $member;
        });

        return ApiResponse::created($member->load(['user', 'role.permissions'])->toSyncArray(), 'Employee added.');
    }

    public function update(Request $request, string $userId): JsonResponse
    {
        $data = $request->validate([
            'role_id' => ['sometimes', 'uuid'],
            'status' => ['sometimes', Rule::in(['active', 'disabled'])],
            'store_ids' => ['nullable', 'array'],
            'store_ids.*' => ['uuid'],
            'name' => ['sometimes', 'string', 'min:2', 'max:120'],
            'phone' => ['nullable', 'string', 'max:20'],
        ]);
        $member = BusinessUser::query()->where('user_id', $userId)->firstOrFail();
        if ($member->role?->key === 'owner' && $member->business->owner_id === $userId && (isset($data['role_id']) || ($data['status'] ?? 'active') !== 'active')) {
            return ApiResponse::error('The business owner cannot be disabled or demoted.', 422);
        }
        if (isset($data['role_id'])) {
            $this->guardOwnerRole(Role::query()->findOrFail($data['role_id']));
        }

        $member = $this->lock->transaction((string) $this->tenant->businessId(), function () use ($member, $data) {
            $old = ['role_id' => $member->role_id, 'status' => $member->status];
            $member->fill(array_intersect_key($data, array_flip(['role_id', 'status', 'store_ids'])));
            $member->save();
            if (isset($data['name']) || array_key_exists('phone', $data)) {
                $member->user->fill(array_intersect_key($data, array_flip(['name', 'phone'])))->save();
                $member->touch();
            }
            if (isset($data['role_id']) && $data['role_id'] !== $old['role_id']) {
                $this->audit->log('PERMISSION_CHANGED', 'user', $member->user_id, $old, ['role_id' => $member->role_id]);
            }
            if (isset($data['status']) && $data['status'] === 'disabled') {
                // Revoke all sessions of a disabled employee.
                $member->user->tokens()->delete();
                $this->audit->log('USER_DISABLED', 'user', $member->user_id);
            }

            return $member;
        });

        return ApiResponse::ok($member->refresh()->load(['user', 'role.permissions'])->toSyncArray(), 'Employee updated.');
    }

    private function guardOwnerRole(Role $role): void
    {
        if ($role->key === 'owner' && $this->tenant->member()?->role?->key !== 'owner') {
            abort(response()->json(['success' => false, 'message' => 'Only the owner can assign the Owner role.', 'errors' => (object) []], 403));
        }
    }
}
