<?php

namespace App\Services\Business;

use App\Exceptions\ApiException;
use App\Models\Device;
use App\Models\Store;
use App\Services\Audit\AuditLogger;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Device (installation) registration. Each device has a client-generated id (device_id) and a
 * short code (C1, C2 ...) used for per-device invoice series and provisional numbers.
 */
class DeviceService
{
    public function __construct(private readonly TenantContext $tenant, private readonly AuditLogger $audit) {}

    public static function hashSecret(string $secret): string
    {
        return hash('sha256', $secret);
    }

    /**
     * Register (or re-register) a device. Returns the device and, when one was issued now, the
     * plain device secret — it is shown only once and the device must send it as X-Device-Secret.
     *
     * @param  array<string, mixed>  $data
     * @return array{device: Device, secret: ?string}
     */
    public function register(array $data, ?string $userAgent, ?string $presentedSecret = null): array
    {
        return DB::transaction(function () use ($data, $userAgent, $presentedSecret) {
            $storeId = $data['store_id'] ?? null;
            if ($storeId && ! Store::query()->whereKey($storeId)->exists()) {
                throw new ApiException('Store not found.', 422, ['store_id' => ['Unknown store.']]);
            }

            $device = Device::query()->withoutGlobalScopes()->find($data['device_id']);
            if ($device && $device->business_id !== $this->tenant->businessId()) {
                // The same physical installation may serve several businesses; ids are per business.
                throw new ApiException('This device id is registered to another business. Clear the app data or use a new installation.', 409);
            }
            $effectiveStore = $storeId ?? $device->store_id ?? Store::query()->where('is_default', true)->value('id');
            if (! $this->tenant->canAccessStore($effectiveStore)) {
                throw new ApiException('You are not assigned to this store.', 403, ['store_id' => ['Choose one of your stores.']]);
            }
            if ($device) {
                if ($device->status === 'revoked') {
                    throw new ApiException('This device has been revoked by an administrator.', 403);
                }
                // Device ids are not secret; only the holder of the device secret may re-register it.
                if ($device->secret_hash !== null && ($presentedSecret === null || ! hash_equals($device->secret_hash, self::hashSecret($presentedSecret)))) {
                    throw new ApiException('This device id is already registered. Use a new installation (clear the app data) or ask an administrator.', 409, [], 'device_secret_required');
                }
                $secret = null;
                if ($device->secret_hash === null) {
                    // Devices registered before secrets existed receive one on their next registration.
                    $secret = Str::random(48);
                    $device->secret_hash = self::hashSecret($secret);
                }
                $device->fill(array_filter([
                    'name' => $data['name'] ?? null,
                    'store_id' => $storeId ?? $device->store_id,
                    'platform' => $data['platform'] ?? null,
                ], fn ($v) => $v !== null));
                $device->user_agent = $userAgent ? mb_substr($userAgent, 0, 500) : $device->user_agent;
                $device->save();

                return ['device' => $device, 'secret' => $secret];
            }

            $secret = Str::random(48);
            $device = Device::query()->create([
                'id' => $data['device_id'],
                'store_id' => $effectiveStore,
                'registered_by' => $this->tenant->userId(),
                'name' => $data['name'] ?? 'Device',
                'code' => $this->nextCode(),
                'secret_hash' => self::hashSecret($secret),
                'platform' => $data['platform'] ?? null,
                'user_agent' => $userAgent ? mb_substr($userAgent, 0, 500) : null,
                'status' => 'active',
            ]);
            $this->audit->log('DEVICE_REGISTERED', 'device', $device->id, null, ['name' => $device->name, 'code' => $device->code]);

            return ['device' => $device, 'secret' => $secret];
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
