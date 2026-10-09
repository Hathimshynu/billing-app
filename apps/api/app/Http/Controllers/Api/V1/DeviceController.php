<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Numbering\DocumentNumberFormatter;
use App\Http\Controllers\Controller;
use App\Models\Device;
use App\Services\Business\DeviceService;
use App\Services\Numbering\NumberingService;
use App\Support\ApiResponse;
use App\Support\Tenancy\BusinessLock;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class DeviceController extends Controller
{
    public function __construct(
        private readonly DeviceService $devices,
        private readonly NumberingService $numbering,
        private readonly TenantContext $tenant,
        private readonly BusinessLock $lock,
    ) {}

    public function index(): JsonResponse
    {
        return ApiResponse::ok(Device::query()->orderBy('code')->get()->map->toSyncArray()->values());
    }

    public function register(Request $request): JsonResponse
    {
        $data = $request->validate([
            'device_id' => ['required', 'uuid'],
            'name' => ['required', 'string', 'max:100'],
            'store_id' => ['nullable', 'uuid'],
            'platform' => ['nullable', 'string', 'max:60'],
        ]);
        $device = $this->lock->transaction((string) $this->tenant->businessId(), fn () => $this->devices->register($data, $request->userAgent()));

        return ApiResponse::ok($device->toSyncArray(), 'Device registered.');
    }

    public function revoke(string $id): JsonResponse
    {
        $device = Device::query()->findOrFail($id);
        $device = $this->lock->transaction((string) $this->tenant->businessId(), fn () => $this->devices->revoke($device));

        return ApiResponse::ok($device->toSyncArray(), 'Device revoked.');
    }

    /**
     * Reserve blocks of document numbers so the device can issue final numbers while offline.
     */
    public function numberBlocks(Request $request): JsonResponse
    {
        $data = $request->validate([
            'requests' => ['required', 'array', 'min:1', 'max:20'],
            'requests.*.document_type' => ['required', Rule::in(array_keys(DocumentNumberFormatter::DEFAULT_FORMATS))],
            'requests.*.date' => ['required', 'date_format:Y-m-d'],
            'requests.*.size' => ['nullable', 'integer', 'min:1', 'max:500'],
        ]);
        $device = $this->tenant->device();
        abort_if(! $device, 409, 'Device not registered.');

        $blocks = $this->lock->transaction((string) $this->tenant->businessId(), function () use ($data, $device) {
            $out = [];
            foreach ($data['requests'] as $req) {
                $block = $this->numbering->reserveBlock($device, $req['document_type'], $req['date'], (int) ($req['size'] ?? 50));
                $out[] = [
                    'id' => $block->id,
                    'document_type' => $block->document_type,
                    'period' => $block->period,
                    'format' => $block->format,
                    'start_number' => $block->start_number,
                    'end_number' => $block->end_number,
                    'next_number' => $block->start_number,
                    'device_code' => $device->code,
                ];
            }

            return $out;
        });

        return ApiResponse::ok($blocks);
    }
}
