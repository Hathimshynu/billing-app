<?php

namespace App\Services\Sync;

use App\Models\SyncModel;

/**
 * Outcome of applying an operation. `entities` are sent straight back to the device in
 * `server_changes` so it can reconcile server-assigned values (e.g. final invoice numbers).
 */
final class HandlerResult
{
    /**
     * @param  array<string, mixed>  $result
     * @param  list<SyncModel>  $entities
     * @param  list<array{field: string, base: mixed, local: mixed, server: mixed}>  $conflictFields
     */
    public function __construct(
        public array $result = [],
        public array $entities = [],
        public array $conflictFields = [],
        public ?string $conflictType = null,
        public ?string $conflictMessage = null,
        public ?SyncModel $conflictEntity = null,
    ) {}

    /** @param list<SyncModel> $entities @param array<string, mixed> $result */
    public static function ok(array $entities = [], array $result = []): self
    {
        return new self($result, $entities);
    }

    public function hasConflict(): bool
    {
        return $this->conflictType !== null;
    }
}
