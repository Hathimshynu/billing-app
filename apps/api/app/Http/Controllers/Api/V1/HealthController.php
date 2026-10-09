<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

class HealthController extends Controller
{
    /** Lightweight connectivity probe used by devices to detect real online status. */
    public function __invoke(): JsonResponse
    {
        return response()->json([
            'success' => true,
            'status' => 'ok',
            'server_time' => now()->toIso8601ZuluString('millisecond'),
            'api_version' => 'v1',
        ])->header('Cache-Control', 'no-store');
    }
}
