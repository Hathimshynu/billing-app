<?php

namespace App\Http\Middleware;

use App\Models\Device;
use App\Support\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Sync endpoints require a registered, active device of the current business (X-Device-Id).
 * Revoked devices can no longer push or pull.
 */
class ResolveDevice
{
    public function __construct(private readonly TenantContext $tenant) {}

    public function handle(Request $request, Closure $next, string $mode = 'required'): Response
    {
        $deviceId = (string) $request->header('X-Device-Id', '');
        $device = $deviceId !== '' && preg_match('/^[0-9a-f-]{36}$/i', $deviceId) ? Device::query()->find($deviceId) : null;

        if (! $device && $mode === 'required') {
            return response()->json(['success' => false, 'message' => 'This device is not registered. Register it first.', 'errors' => (object) [], 'code' => 'device_not_registered'], 409);
        }
        if ($device && ! $device->isActive()) {
            return response()->json(['success' => false, 'message' => 'This device has been revoked by an administrator.', 'errors' => (object) [], 'code' => 'device_revoked'], 403);
        }
        $this->tenant->setDevice($device);
        if ($device) {
            Device::query()->whereKey($device->id)->update(['last_seen_at' => now(), 'last_ip' => $request->ip()]);
        }

        return $next($request);
    }
}
