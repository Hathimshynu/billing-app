<?php

namespace App\Services\Sync;

use App\Exceptions\ApiException;
use App\Models\SyncOperation;
use App\Support\Tenancy\BusinessLock;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Lets REST endpoints (online clients, integrations, a future mobile app) apply writes through the
 * exact same operation handlers as offline sync. Supports the `Idempotency-Key` header: retrying a
 * request with the same key returns the original result instead of creating a duplicate.
 */
class RestOperationRunner
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OperationRegistry $registry,
        private readonly BusinessLock $lock,
    ) {}

    /** @param array<string, mixed> $payload */
    public function run(string $operation, string $entityType, ?string $entityId, array $payload, ?int $baseVersion = null): HandlerResult
    {
        $key = (string) request()->header('Idempotency-Key', '');
        $operationId = Str::isUuid($key) ? $key : (string) Str::uuid7();
        $entityId ??= (string) Str::uuid7();

        $previous = SyncOperation::query()->withoutGlobalScopes()->where('operation_id', $operationId)->first();
        if ($previous) {
            if ($previous->business_id !== $this->tenant->businessId() || $previous->operation !== $operation) {
                throw new ApiException('Idempotency-Key was already used for a different request.', 409);
            }
            if ($previous->status !== 'accepted') {
                throw new ApiException((string) ($previous->error_message ?: 'The original request failed.'), 422);
            }
            $entity = SyncEntityMap::load($previous->entity_type, [$previous->entity_id])[$previous->entity_id] ?? null;

            return HandlerResult::ok($entity ? [$entity] : [], ($previous->result ?? []) + ['duplicate' => true]);
        }

        $ctx = new OperationContext(
            operationId: $operationId,
            operation: $operation,
            entityType: $entityType,
            entityId: $entityId,
            payload: $payload,
            baseVersion: $baseVersion,
            clientCreatedAt: Carbon::now()->toIso8601String(),
            userId: (string) $this->tenant->userId(),
            device: $this->tenant->device(),
        );

        return $this->lock->transaction((string) $this->tenant->businessId(), function () use ($ctx) {
            $record = SyncOperation::query()->create([
                'operation_id' => $ctx->operationId,
                'device_id' => $ctx->deviceId(),
                'user_id' => $ctx->userId,
                'entity_type' => $ctx->entityType,
                'entity_id' => $ctx->entityId,
                'operation' => $ctx->operation,
                'payload' => $ctx->payload,
                'status' => 'processing',
                'client_created_at' => now(),
            ]);
            $result = $this->registry->dispatch($ctx);
            if ($result->hasConflict()) {
                throw new ApiException((string) $result->conflictMessage, 409, ['conflicts' => array_map(fn ($f) => $f['field'], $result->conflictFields)]);
            }
            $record->update(['status' => 'accepted', 'result' => $result->result, 'processed_at' => now()]);

            return $result;
        });
    }
}
