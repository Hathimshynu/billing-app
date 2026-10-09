<?php

namespace App\Services\Sync\Handlers;

use App\Models\SyncModel;
use App\Services\Sync\OperationContext;
use Closure;

/**
 * Describes how a mutable "master data" entity is created/updated/deleted through sync.
 */
final class MasterDefinition
{
    /**
     * @param  class-string<SyncModel>  $model
     * @param  array<string, mixed>  $rules  validation rules for the full entity
     * @param  list<string>  $fields  attributes a device may set
     * @param  (Closure(SyncModel, array<string, mixed>, OperationContext, bool): void)|null  $persist  custom persistence (children etc.)
     * @param  (Closure(SyncModel, array<string, mixed>, OperationContext, bool): void)|null  $after  runs after save (ledger, audit details)
     */
    public function __construct(
        public readonly string $model,
        public readonly string $label,
        public readonly string $createPermission,
        public readonly string $editPermission,
        public readonly string $deletePermission,
        public readonly array $rules,
        public readonly array $fields,
        public readonly ?Closure $persist = null,
        public readonly ?Closure $after = null,
    ) {}
}
