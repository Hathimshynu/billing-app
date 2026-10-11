<?php

namespace App\Services\Sync;

use App\Models\BusinessUser;
use App\Models\Contracts\SyncableEntity;
use App\Models\Device;
use App\Models\SyncConflict;
use App\Models\SyncOperation;
use App\Services\Audit\AuditLogger;
use App\Services\Sync\Exceptions\SyncRejected;
use App\Support\Tenancy\BusinessLock;
use App\Support\Tenancy\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Throwable;

/**
 * Applies operations pushed by a device.
 *
 *  - Idempotent: operation_id is unique; a replay returns the stored outcome (duplicate prevention).
 *  - Each operation runs in its own transaction (partial batches are fine; one failure never rolls
 *    back other operations).
 *  - Authorized as the user who performed the operation on the device, with that user's current
 *    role permissions in this business.
 *  - Conflicts are recorded (sync_conflicts) and returned; non-conflicting fields are still applied.
 */
class SyncPushService
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OperationRegistry $registry,
        private readonly BusinessLock $lock,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * @param  list<mixed>  $operations  untrusted device input; each element is validated here
     * @return array<string, mixed>
     */
    public function push(Device $device, array $operations): array
    {
        $businessId = (string) $this->tenant->businessId();
        $accepted = $rejected = $conflicts = $serverChanges = [];
        /** @var array<string, array{0: BusinessUser|null, 1: list<string>}> $members */
        $members = [];

        foreach ($operations as $raw) {
            $envelope = Validator::make(is_array($raw) ? $raw : [], [
                'operation_id' => ['required', 'uuid'],
                'entity_type' => ['required', 'string', 'max:40'],
                'entity_id' => ['required', 'uuid'],
                'operation' => ['required', 'string', 'max:40'],
                'payload' => ['present', 'array'],
                'base_version' => ['nullable', 'integer'],
                'created_at' => ['nullable', 'date'],
                'user_id' => ['required', 'uuid'],
            ]);
            if ($envelope->fails()) {
                $rejected[] = [
                    'operation_id' => is_array($raw) ? (string) ($raw['operation_id'] ?? '') : '',
                    'code' => 'invalid_envelope',
                    'message' => 'The operation envelope is invalid.',
                    'errors' => $envelope->errors()->toArray(),
                    'retryable' => false,
                ];

                continue;
            }
            $opId = $raw['operation_id'];

            $existing = SyncOperation::query()->withoutGlobalScopes()->where('operation_id', $opId)->first();
            if ($existing && $existing->status === 'rejected' && $existing->business_id === $businessId) {
                // A rejected operation changed nothing, so a retry (after the data or a permission
                // was corrected) is evaluated again. The earlier rejection stays in the audit log.
                $this->audit->log('SYNC_RETRY', $existing->entity_type, $existing->entity_id, ['error_code' => $existing->error_code, 'error' => $existing->error_message], ['operation_id' => $opId]);
                $existing->delete();
                $existing = null;
            }
            if ($existing) {
                $this->replay($existing, $businessId, $accepted, $rejected, $conflicts, $serverChanges);

                continue;
            }

            $userId = $raw['user_id'];
            if (! array_key_exists($userId, $members)) {
                $member = BusinessUser::query()->with(['user', 'role.permissions'])->where('user_id', $userId)->first();
                $authorPermissions = $member ? $member->effectivePermissions() : [];
                // The author id comes from the device and cannot be trusted on its own: an operation
                // recorded by another member on a shared till is allowed only for permissions that
                // BOTH its author and the authenticated user pushing it hold. Forging another
                // user's id therefore never grants more than the pushing user already has.
                $permissions = $userId === $this->tenant->userId()
                    ? $authorPermissions
                    : array_values(array_intersect($authorPermissions, $this->tenant->permissions()));
                $members[$userId] = [$member, $permissions];
            }
            [$member, $permissions] = $members[$userId];

            $ctx = new OperationContext(
                operationId: $opId,
                operation: $raw['operation'],
                entityType: $raw['entity_type'],
                entityId: $raw['entity_id'],
                payload: $raw['payload'],
                baseVersion: isset($raw['base_version']) ? (int) $raw['base_version'] : null,
                clientCreatedAt: $raw['created_at'] ?? null,
                userId: $userId,
                device: $device,
            );

            try {
                if (! $member || ! $member->user) {
                    throw new SyncRejected('unknown_user', 'The user who performed this operation is not a member of this business.');
                }
                $outcome = $this->lock->transaction($businessId, function () use ($ctx, $member, $permissions) {
                    $record = SyncOperation::query()->create([
                        'operation_id' => $ctx->operationId,
                        'device_id' => $ctx->deviceId(),
                        'user_id' => $ctx->userId,
                        'entity_type' => $ctx->entityType,
                        'entity_id' => $ctx->entityId,
                        'operation' => $ctx->operation,
                        'payload' => $ctx->payload,
                        'status' => 'processing',
                        'client_created_at' => $ctx->clientCreatedAt ? Carbon::parse($ctx->clientCreatedAt) : null,
                    ]);
                    $result = $this->tenant->actingAs($member->user, $member, $permissions, fn () => $this->registry->dispatch($ctx));

                    if ($result->hasConflict()) {
                        $entity = $result->conflictEntity;
                        $conflict = SyncConflict::query()->create([
                            'operation_id' => $ctx->operationId,
                            'device_id' => $ctx->deviceId(),
                            'user_id' => $ctx->userId,
                            'entity_type' => $ctx->entityType,
                            'entity_id' => $ctx->entityId,
                            'conflict_type' => $result->conflictType,
                            'fields' => $result->conflictFields,
                            'server_data' => $entity?->toSyncArray(),
                            'local_payload' => $ctx->payload,
                            'message' => (string) $result->conflictMessage,
                            'status' => 'open',
                        ]);
                        $info = [
                            'operation_id' => $ctx->operationId,
                            'conflict_id' => $conflict->id,
                            'entity_type' => $ctx->entityType,
                            'entity_id' => $ctx->entityId,
                            'conflict_type' => $result->conflictType,
                            'fields' => $result->conflictFields,
                            'server_version' => (int) ($entity?->getAttribute('version') ?? 0),
                            'server_data' => $entity?->toSyncArray(),
                            'message' => $conflict->message,
                        ];
                        $record->update(['status' => 'conflict', 'result' => $info, 'processed_at' => now()]);

                        return ['type' => 'conflict', 'info' => $info, 'entities' => $result->entities];
                    }

                    $record->update(['status' => 'accepted', 'result' => $result->result, 'processed_at' => now()]);

                    return ['type' => 'accepted', 'result' => $result->result, 'entities' => $result->entities];
                });

                foreach ($outcome['entities'] as $entity) {
                    $serverChanges[] = $this->snapshot($entity);
                }
                if ($outcome['type'] === 'conflict') {
                    $conflicts[] = $outcome['info'];
                } else {
                    $accepted[] = [
                        'operation_id' => $ctx->operationId,
                        'entity_type' => $ctx->entityType,
                        'entity_id' => $ctx->entityId,
                        'duplicate' => (bool) ($outcome['result']['duplicate'] ?? false),
                        'result' => $outcome['result'] ?: null,
                    ];
                }
            } catch (SyncRejected $e) {
                $this->reject($ctx, $e->errorCode, $e->getMessage(), $e->errors, $e->retryable, $rejected);
            } catch (AuthorizationException $e) {
                $this->reject($ctx, 'forbidden', $e->getMessage(), null, false, $rejected);
            } catch (UniqueConstraintViolationException $e) {
                // A concurrent push of the same operation won the race: return its stored outcome.
                $winner = SyncOperation::query()->withoutGlobalScopes()->where('operation_id', $opId)->first();
                if ($winner) {
                    $this->replay($winner, $businessId, $accepted, $rejected, $conflicts, $serverChanges);
                } else {
                    Log::channel('sync')->error('Unique violation while applying operation', ['operation_id' => $opId, 'error' => $e->getMessage()]);
                    $this->reject($ctx, 'server_error', 'Temporary server error. The operation will be retried.', null, true, $rejected);
                }
            } catch (Throwable $e) {
                report($e);
                Log::channel('sync')->error('Operation failed', ['operation_id' => $opId, 'operation' => $ctx->operation, 'error' => $e->getMessage()]);
                $this->reject($ctx, 'server_error', 'Temporary server error. The operation will be retried.', null, true, $rejected);
            }
        }

        Device::query()->withoutGlobalScopes()->whereKey($device->id)->update(['last_sync_at' => now(), 'last_seen_at' => now()]);
        Log::channel('sync')->info('push', [
            'business' => $businessId,
            'device' => $device->id,
            'accepted' => count($accepted),
            'rejected' => count($rejected),
            'conflicts' => count($conflicts),
        ]);

        return [
            'success' => true,
            'accepted' => $accepted,
            'rejected' => $rejected,
            'conflicts' => $conflicts,
            'server_changes' => $serverChanges,
        ];
    }

    /**
     * @param  array<string, list<string>>|null  $errors
     * @param  list<array<string, mixed>>  $rejected
     */
    private function reject(OperationContext $ctx, string $code, string $message, ?array $errors, bool $retryable, array &$rejected): void
    {
        if (! $retryable) {
            try {
                SyncOperation::query()->create([
                    'operation_id' => $ctx->operationId,
                    'device_id' => $ctx->deviceId(),
                    'user_id' => $ctx->userId,
                    'entity_type' => $ctx->entityType,
                    'entity_id' => $ctx->entityId,
                    'operation' => $ctx->operation,
                    'payload' => $ctx->payload,
                    'status' => 'rejected',
                    'result' => ['errors' => $errors],
                    'error_code' => $code,
                    'error_message' => mb_substr($message, 0, 1000),
                    'client_created_at' => $ctx->clientCreatedAt ? Carbon::parse($ctx->clientCreatedAt) : null,
                    'processed_at' => now(),
                ]);
            } catch (Throwable) {
                // Already recorded by a concurrent request.
            }
        }
        $rejected[] = [
            'operation_id' => $ctx->operationId,
            'code' => $code,
            'message' => $message,
            'errors' => $errors,
            'retryable' => $retryable,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $accepted
     * @param  list<array<string, mixed>>  $rejected
     * @param  list<array<mixed>>  $conflicts  conflict payloads (stored JSON)
     * @param  list<array<string, mixed>>  $serverChanges
     */
    private function replay(SyncOperation $existing, string $businessId, array &$accepted, array &$rejected, array &$conflicts, array &$serverChanges): void
    {
        if ($existing->business_id !== $businessId) {
            $rejected[] = ['operation_id' => $existing->operation_id, 'code' => 'operation_id_reused', 'message' => 'Operation id already used by another business.', 'errors' => null, 'retryable' => false];

            return;
        }
        if ($existing->status === 'rejected') {
            $rejected[] = [
                'operation_id' => $existing->operation_id,
                'code' => (string) $existing->error_code,
                'message' => (string) $existing->error_message,
                'errors' => $existing->result['errors'] ?? null,
                'retryable' => false,
            ];

            return;
        }
        if ($existing->status === 'conflict') {
            $conflicts[] = is_array($existing->result) ? $existing->result : [
                'operation_id' => $existing->operation_id,
                'conflict_id' => null,
                'entity_type' => $existing->entity_type,
                'entity_id' => $existing->entity_id,
                'conflict_type' => 'other',
                'fields' => [],
                'server_version' => 0,
                'server_data' => null,
                'message' => 'This change conflicted with a change made on another device.',
            ];

            return;
        }
        $accepted[] = [
            'operation_id' => $existing->operation_id,
            'entity_type' => $existing->entity_type,
            'entity_id' => $existing->entity_id,
            'duplicate' => true,
            'result' => $existing->result ?: null,
        ];
        $current = SyncEntityMap::load($existing->entity_type, [$existing->entity_id])[$existing->entity_id] ?? null;
        if ($current) {
            $serverChanges[] = $this->snapshot($current);
        }
    }

    /** @return array<string, mixed> */
    private function snapshot(SyncableEntity $entity): array
    {
        return [
            'seq' => 0,
            'entity_type' => $entity::syncEntityType(),
            'entity_id' => $entity->syncEntityId(),
            'action' => 'upsert',
            'data' => $entity->toSyncArray(),
        ];
    }
}
