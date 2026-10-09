<?php

namespace App\Services\Sync;

use App\Models\Contracts\SyncableEntity;
use App\Models\SyncChange;
use App\Support\Tenancy\BusinessLock;

/**
 * Appends entity changes to the per-business change feed that devices pull incrementally.
 * Runs inside the caller's database transaction, so a change becomes visible to devices exactly
 * when the data it describes is committed. The business write lock guarantees feed ids are
 * assigned in commit order (see BusinessLock).
 */
class ChangeLogger
{
    private bool $paused = false;

    public function __construct(private readonly BusinessLock $lock) {}

    public function record(SyncableEntity $model, string $action = 'upsert'): void
    {
        if ($this->paused) {
            return;
        }
        $this->recordRaw($model->syncBusinessId(), $model::syncEntityType(), $model->syncEntityId(), $model->syncStoreId(), $action);
    }

    /** Record a change for an entity identified explicitly. */
    public function recordRaw(string $businessId, string $entityType, string $entityId, ?string $storeId = null, string $action = 'upsert'): void
    {
        if ($this->paused) {
            return;
        }
        $this->lock->acquire($businessId);
        SyncChange::query()->insert([
            'business_id' => $businessId,
            'store_id' => $storeId,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'action' => $action,
            'created_at' => now(),
        ]);
    }

    /**
     * @template T
     *
     * @param  callable(): T  $callback
     * @return T
     */
    public function withoutLogging(callable $callback): mixed
    {
        $previous = $this->paused;
        $this->paused = true;
        try {
            return $callback();
        } finally {
            $this->paused = $previous;
        }
    }
}
