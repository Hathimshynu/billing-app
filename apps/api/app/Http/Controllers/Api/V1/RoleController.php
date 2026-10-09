<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Auth\Permissions;
use App\Http\Controllers\Controller;
use App\Models\BusinessUser;
use App\Models\Permission;
use App\Models\Role;
use App\Services\Audit\AuditLogger;
use App\Support\ApiResponse;
use App\Support\Tenancy\BusinessLock;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class RoleController extends Controller
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly AuditLogger $audit,
        private readonly BusinessLock $lock,
    ) {}

    public function index(): JsonResponse
    {
        return ApiResponse::ok([
            'roles' => Role::query()->with('permissions')->orderBy('created_at')->get()->map->toSyncArray()->values(),
            'permissions' => Permissions::GROUPS,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:80'],
            'description' => ['nullable', 'string', 'max:200'],
            'permissions' => ['required', 'array'],
            'permissions.*' => [Rule::in(Permissions::all())],
        ]);
        $role = $this->lock->transaction((string) $this->tenant->businessId(), function () use ($data) {
            $role = Role::query()->create([
                'key' => Str::slug($data['name'], '_').'_'.Str::lower(Str::random(4)),
                'name' => $data['name'],
                'description' => $data['description'] ?? null,
                'is_system' => false,
            ]);
            $role->permissions()->sync(Permission::query()->whereIn('key', $data['permissions'])->pluck('id'));
            $role->touch();
            $this->audit->log('ROLE_CREATED', 'role', $role->id, null, ['name' => $role->name, 'permissions' => $data['permissions']]);

            return $role;
        });

        return ApiResponse::created($role->load('permissions')->toSyncArray(), 'Role created.');
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $role = Role::query()->with('permissions')->findOrFail($id);
        if ($role->key === 'owner') {
            return ApiResponse::error('The Owner role always has every permission.', 422);
        }
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:80'],
            'description' => ['nullable', 'string', 'max:200'],
            'permissions' => ['sometimes', 'array'],
            'permissions.*' => [Rule::in(Permissions::all())],
        ]);
        $role = $this->lock->transaction((string) $this->tenant->businessId(), function () use ($role, $data) {
            $old = $role->permissionKeys();
            $role->fill(array_intersect_key($data, array_flip(['name', 'description'])));
            $role->save();
            if (isset($data['permissions'])) {
                $role->permissions()->sync(Permission::query()->whereIn('key', $data['permissions'])->pluck('id'));
                $role->touch();
                // Members' effective permissions changed: re-publish them to devices.
                foreach (BusinessUser::query()->where('role_id', $role->id)->get() as $member) {
                    $member->touch();
                }
                $this->audit->log('PERMISSION_CHANGED', 'role', $role->id, ['permissions' => $old], ['permissions' => $data['permissions']]);
            }

            return $role;
        });

        return ApiResponse::ok($role->refresh()->load('permissions')->toSyncArray(), 'Role updated.');
    }
}
