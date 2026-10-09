<?php

namespace App\Http\Controllers\Api\V1\Concerns;

use App\Services\Sync\HandlerResult;
use App\Services\Sync\RestOperationRunner;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;

trait RunsOperations
{
    /** @param array<string, mixed> $payload */
    protected function runOperation(string $operation, string $entityType, ?string $id, array $payload, int $status = 200, ?int $baseVersion = null): JsonResponse
    {
        /** @var RestOperationRunner $runner */
        $runner = app(RestOperationRunner::class);
        $result = $runner->run($operation, $entityType, $id, $payload, $baseVersion);

        return $this->entityResponse($result, $status);
    }

    protected function entityResponse(HandlerResult $result, int $status = 200): JsonResponse
    {
        $entity = $result->entities[0] ?? null;

        return ApiResponse::ok($entity?->toSyncArray(), null, $status, $result->result ? ['result' => $result->result] : []);
    }
}
