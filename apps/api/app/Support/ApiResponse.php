<?php

namespace App\Support;

use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Http\JsonResponse;

/**
 * Consistent response envelopes:
 *   success: { "success": true, "data": ..., "message": "..." }
 *   error:   { "success": false, "message": "...", "errors": {} }
 */
final class ApiResponse
{
    public static function ok(mixed $data = null, ?string $message = null, int $status = 200, array $extra = []): JsonResponse
    {
        return response()->json(array_filter([
            'success' => true,
            'data' => $data,
            'message' => $message,
        ], fn ($v) => $v !== null) + $extra, $status);
    }

    public static function created(mixed $data = null, ?string $message = null): JsonResponse
    {
        return self::ok($data, $message, 201);
    }

    /** @param array<string, mixed> $errors */
    public static function error(string $message, int $status = 422, array $errors = []): JsonResponse
    {
        return response()->json(['success' => false, 'message' => $message, 'errors' => (object) $errors], $status);
    }

    /**
     * @param  LengthAwarePaginator<int, mixed>  $paginator
     * @param  callable(mixed): mixed  $map
     */
    public static function paginated($paginator, callable $map): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => array_map($map, $paginator->items()),
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
                'last_page' => $paginator->lastPage(),
            ],
        ]);
    }
}
