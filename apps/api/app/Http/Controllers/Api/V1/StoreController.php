<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Pricing\PricingEngine;
use App\Http\Controllers\Controller;
use App\Models\Store;
use App\Services\Audit\AuditLogger;
use App\Support\ApiResponse;
use App\Support\Tenancy\BusinessLock;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class StoreController extends Controller
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly AuditLogger $audit,
        private readonly BusinessLock $lock,
    ) {}

    public function index(): JsonResponse
    {
        return ApiResponse::ok(Store::query()->orderByDesc('is_default')->orderBy('name')->get()->map->toSyncArray()->values());
    }

    /** @return array<string, mixed> */
    private function rules(?string $ignoreId = null): array
    {
        return [
            'name' => [$ignoreId ? 'sometimes' : 'required', 'string', 'max:120'],
            'code' => [$ignoreId ? 'sometimes' : 'required', 'string', 'max:10', 'alpha_num',
                Rule::unique('stores', 'code')->where('business_id', $this->tenant->businessId())->ignore($ignoreId)],
            'address' => ['nullable', 'string', 'max:500'],
            'phone' => ['nullable', 'string', 'max:20'],
            'gstin' => ['nullable', 'string', 'size:15', fn ($a, $v, $fail) => $v && ! PricingEngine::isValidGstin($v) ? $fail('The GSTIN is invalid.') : null],
            'state_code' => ['nullable', 'string', 'max:4'],
            'active' => ['sometimes', 'boolean'],
        ];
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate($this->rules());
        $data['code'] = strtoupper($data['code']);
        $store = $this->lock->transaction((string) $this->tenant->businessId(), function () use ($data) {
            $store = Store::query()->create($data + ['is_default' => false]);
            $this->audit->log('STORE_CREATED', 'store', $store->id, null, $data);

            return $store;
        });

        return ApiResponse::created($store->toSyncArray(), 'Store created.');
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $store = Store::query()->findOrFail($id);
        $data = $request->validate($this->rules($id));
        if (isset($data['code'])) {
            $data['code'] = strtoupper($data['code']);
        }
        $store = $this->lock->transaction((string) $this->tenant->businessId(), function () use ($store, $data) {
            $store->fill($data)->save();
            $this->audit->log('STORE_UPDATED', 'store', $store->id, null, $data);

            return $store;
        });

        return ApiResponse::ok($store->toSyncArray(), 'Store updated.');
    }
}
