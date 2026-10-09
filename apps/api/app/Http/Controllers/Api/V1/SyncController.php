<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\SyncChange;
use App\Models\SyncConflict;
use App\Models\SyncOperation;
use App\Services\Sync\SyncPullService;
use App\Services\Sync\SyncPushService;
use App\Support\ApiResponse;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SyncController extends Controller
{
    public function __construct(
        private readonly SyncPushService $pushService,
        private readonly SyncPullService $pullService,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * POST /api/v1/sync/push  { device_id, operations: [...] }
     */
    public function push(Request $request): JsonResponse
    {
        $data = $request->validate([
            'device_id' => ['nullable', 'uuid'],
            'operations' => ['present', 'array', 'max:200'],
        ]);
        $device = $this->tenant->device();
        abort_if(! $device || (isset($data['device_id']) && $data['device_id'] !== $device->id), 409, 'Device mismatch.');

        return response()->json($this->pushService->push($device, $data['operations']));
    }

    /**
     * POST /api/v1/sync/pull  { device_id, cursor, limit }
     */
    public function pull(Request $request): JsonResponse
    {
        $data = $request->validate([
            'device_id' => ['nullable', 'uuid'],
            'cursor' => ['nullable', 'integer', 'min:0'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:'.SyncPullService::MAX_LIMIT],
        ]);
        $device = $this->tenant->device();
        abort_if(! $device || (isset($data['device_id']) && $data['device_id'] !== $device->id), 409, 'Device mismatch.');

        return response()->json($this->pullService->pull($device, $data['cursor'] ?? null, $data['limit'] ?? null));
    }

    public function status(): JsonResponse
    {
        $businessId = $this->tenant->businessId();

        return ApiResponse::ok([
            'latest_cursor' => (int) SyncChange::query()->where('business_id', $businessId)->max('id'),
            'open_conflicts' => SyncConflict::query()->where('status', 'open')->count(),
            'operations_today' => SyncOperation::query()->where('created_at', '>=', now()->startOfDay())->count(),
            'rejected_today' => SyncOperation::query()->where('status', 'rejected')->where('created_at', '>=', now()->startOfDay())->count(),
            'device' => $this->tenant->device()?->toSyncArray(),
            'server_time' => now()->toIso8601ZuluString('millisecond'),
        ]);
    }

    public function conflicts(): JsonResponse
    {
        return ApiResponse::ok(
            SyncConflict::query()->where('status', 'open')->latest()->limit(200)->get()->map->toSyncArray()->values()
        );
    }
}
