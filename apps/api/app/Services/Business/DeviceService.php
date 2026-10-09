<?php

namespace App\Services\Business;

use App\Exceptions\ApiException;
use App\Models\Device;
use App\Models\Store;
use App\Services\Audit\AuditLogger;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Device (installation) registration. Each device has a client-generated id (device_id) and a
 * short code (C1, C2 ...) used for per-device invoice series and provisional numbers.
 */
class DeviceService
{
    public function __construct(private readonly TenantContext $tenant, private readonly AuditLogger $audit) {}

    /** @param array<string, mixed> $data */
    public function register(array $data, ?string $userAgent): Device
    {
        return DB::transaction(function () use ($data, $userAgent) {
            $storeId = $data['store_id'] ?? null;
            if ($storeId && ! Store::query()->whereKey($storeId)->exists()) {
                throw new ApiException('Store not found.', 422, ['store_id' => ['Unknown store.']]);
            }

            $device = Device::query()->withoutGlobalScopes()->find($data['device_id']);
            if ($device && $device->business_id !== $this->tenant->businessId()) {
                // The same physical installation may serve several businesses; ids are per business.
                throw new ApiException('This device id is registered to another business. Clear the app data or use a new installation.', 409);
            }
            if ($device) {
                if ($device->status === 'revoked') {
                    throw new ApiException('This device has been revoked by an administrator.', 403);
                }
                $device->fill(array_filter([
                    'name' => $data['name'] ?? null,
                    'store_id' => $storeId ?? $device->store_id,
                    'platform' => $data['platform'] ?? null,
                ], fn ($v) => $v !== null));
                $device->user_agent = $userAgent ? mb_substr($userAgent, 0, 500) : $device->user_agent;
                $device->save();

                return $device;
            }

            $defaultStore = $storeId ?? Store::query()->where('is_default', true)->value('id');
            $device = Device::query()->create([
                'id' => $data['device_id'],
                'store_id' => $defaultStore,
                'registered_by' => $this->tenant->userId(),
                'name' => $data['name'] ?? 'Device',
                'code' => $this->nextCode(),
                'platform' => $data['platform'] ?? null,
                'user_agent' => $userAgent ? mb_substr($userAgent, 0, 500) : null,
                'status' => 'active',
            ]);
            $this->audit->log('DEVICE_REGISTERED', 'device', $device->id, null, ['name' => $device->name, 'code' => $device->code]);

            return $device;
        });
    }

    private function nextCode(): string
    {
        $codes = Device::query()->pluck('code')->all();
        $n = 1;
        while (in_array("C{$n}", $codes, true)) {
            $n++;
        }

        return "C{$n}";
    }

    public function revoke(Device $device): Device
    {
        $device->status = 'revoked';
        $device->save();
        $this->audit->log('DEVICE_REVOKED', 'device', $device->id);

        return $device;
    }
}
