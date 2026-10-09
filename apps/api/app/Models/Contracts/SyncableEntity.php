<?php

namespace App\Models\Contracts;

/**
 * An entity replicated to devices through the per-business change feed.
 */
interface SyncableEntity
{
    /** Entity type name in the sync protocol (packages/shared/src/sync.ts). */
    public static function syncEntityType(): string;

    public function syncBusinessId(): string;

    public function syncEntityId(): string;

    /** Store the entity belongs to; null = every device of the business. */
    public function syncStoreId(): ?string;

    /** @return array<string, mixed> */
    public function toSyncArray(): array;
}
