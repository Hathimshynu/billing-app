<?php

namespace App\Models;

use App\Models\Concerns\Syncable;
use App\Models\Contracts\SyncableEntity;

/**
 * A business-owned entity that is replicated to devices through the sync change feed.
 */
abstract class SyncModel extends TenantModel implements SyncableEntity
{
    use Syncable;

    /** Entity type name used in the sync protocol (see packages/shared/src/sync.ts). */
    abstract public static function syncEntityType(): string;

    /**
     * The representation devices store in IndexedDB (snake_case, identical to the TS entity types).
     *
     * @return array<string, mixed>
     */
    abstract public function toSyncArray(): array;
}
