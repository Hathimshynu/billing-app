<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Business\BusinessTypes;
use App\Domain\Pricing\PricingEngine;
use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use App\Services\Business\BusinessService;
use App\Support\ApiResponse;
use App\Support\Tenancy\BusinessLock;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Validation\Rule;

class BusinessController extends Controller
{
    public function __construct(
        private readonly BusinessService $businesses,
        private readonly TenantContext $tenant,
        private readonly AuditLogger $audit,
        private readonly BusinessLock $lock,
    ) {}

    /** @return array<string, mixed> */
    private function rules(bool $creating): array
    {
        $required = $creating ? 'required' : 'sometimes';

        return [
            'name' => [$required, 'string', 'min:2', 'max:150'],
            'legal_name' => ['nullable', 'string', 'max:200'],
            'business_type' => [$required, Rule::in(BusinessTypes::TYPES)],
            'modules' => ['nullable', 'array'],
            'modules.*' => [Rule::in(BusinessTypes::MODULES)],
            'country' => ['sometimes', 'string', 'size:2'],
            'currency' => ['sometimes', 'string', 'size:3'],
            'currency_decimals' => ['sometimes', 'integer', 'between:0,3'],
            'locale' => ['sometimes', 'string', 'max:10'],
            'timezone' => ['sometimes', 'timezone'],
            'date_format' => ['sometimes', Rule::in(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'])],
            'tax_system' => ['sometimes', Rule::in(['gst', 'vat', 'simple', 'none'])],
            'gstin' => ['nullable', 'string', 'size:15', function ($attribute, $value, $fail) {
                if ($value && ! PricingEngine::isValidGstin($value)) {
                    $fail('The GSTIN is invalid.');
                }
            }],
            'state_code' => ['nullable', 'string', 'max:4'],
            'fy_start_month' => ['sometimes', 'integer', 'between:1,12'],
            'phone' => ['nullable', 'string', 'max:20'],
            'email' => ['nullable', 'email', 'max:190'],
            'address' => ['nullable', 'string', 'max:500'],
            'city' => ['nullable', 'string', 'max:100'],
            'pincode' => ['nullable', 'string', 'max:12'],
            'store_name' => ['nullable', 'string', 'max:120'],
        ];
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate($this->rules(true));
        /** @var User $user */
        $user = $request->user();
        $business = $this->businesses->create($user, $data);

        return ApiResponse::created(['business' => $business->toSyncArray(), 'role_key' => 'owner'], 'Business created.');
    }

    public function show(): JsonResponse
    {
        return ApiResponse::ok($this->tenant->business()->toSyncArray());
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate(Arr::except($this->rules(false), ['store_name']));
        $business = $this->lock->transaction($this->tenant->businessId() ?? '', function () use ($data) {
            /** @var Business $business */
            $business = Business::query()->lockForUpdate()->findOrFail($this->tenant->businessId());
            $old = Arr::only($business->toSyncArray(), array_keys($data));
            $business->fill($data);
            $business->save();
            $this->audit->log('BUSINESS_UPDATED', 'business', $business->id, $old, $data);

            return $business;
        });

        return ApiResponse::ok($business->toSyncArray(), 'Business updated.');
    }
}
