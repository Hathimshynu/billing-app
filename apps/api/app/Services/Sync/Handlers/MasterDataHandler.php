<?php

namespace App\Services\Sync\Handlers;

use App\Models\SyncModel;
use App\Services\Audit\AuditLogger;
use App\Services\Sync\Exceptions\SyncRejected;
use App\Services\Sync\HandlerResult;
use App\Services\Sync\OperationContext;
use App\Services\Sync\ValueComparator;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\SoftDeletingScope;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

/**
 * Generic create / update / delete for mutable master data (categories, customers, products...).
 *
 * Updates carry `changes` (new values), `base` (the values the user started editing from) and the
 * entity version they were based on. When the server version moved on, each changed field is
 * checked: if the server value differs from both the base and the new value, someone else changed
 * the same field → conflict (recorded for the Conflict Center). Other fields are merged.
 */
class MasterDataHandler
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly AuditLogger $audit,
    ) {}

    public function create(MasterDefinition $def, OperationContext $op): HandlerResult
    {
        $this->authorize($def->createPermission);
        $modelClass = $def->model;
        /** @var SyncModel|null $existing */
        $existing = $modelClass::query()->withoutGlobalScope(SoftDeletingScope::class)->find($op->entityId);
        if ($existing) {
            // Same entity created again (e.g. replay with a new operation id): idempotent.
            return HandlerResult::ok([$existing], ['duplicate' => true]);
        }

        $data = $this->validate($def, $op->payload, false);
        /** @var SyncModel $model */
        $model = new $modelClass;
        $model->setAttribute('id', $op->entityId);
        $this->persist($def, $model, Arr::only($data, $def->fields), $op, true);
        if ($def->after) {
            ($def->after)($model, $data, $op, true);
        }
        $this->audit->log(Str::upper($def->label).'_CREATED', $model::syncEntityType(), $model->getKey(), null, Arr::only($data, $def->fields), $op->userId, $op->deviceId());

        return HandlerResult::ok([$model->refresh()]);
    }

    public function update(MasterDefinition $def, OperationContext $op): HandlerResult
    {
        $this->authorize($def->editPermission);
        $modelClass = $def->model;
        /** @var SyncModel|null $model */
        $model = $modelClass::query()->withoutGlobalScope(SoftDeletingScope::class)->find($op->entityId);
        if (! $model) {
            throw SyncRejected::dependency(ucfirst($def->label));
        }

        $changes = (array) ($op->payload['changes'] ?? []);
        $base = (array) ($op->payload['base'] ?? []);
        $force = (bool) ($op->payload['force'] ?? false);
        $changes = Arr::only($changes, $def->fields);
        if ($changes === []) {
            return HandlerResult::ok([$model]);
        }
        $changes = Arr::only($this->validate($def, $changes, true), array_keys($changes));

        if (method_exists($model, 'trashed') && $model->trashed() && ! $force) {
            return new HandlerResult(
                conflictFields: [],
                conflictType: 'deleted',
                conflictMessage: ucfirst($def->label).' was deleted on another device while it was being edited here.',
                conflictEntity: $model,
            );
        }

        $conflicts = [];
        if (! $force && $op->baseVersion !== null && (int) $model->getAttribute('version') !== $op->baseVersion) {
            $server = $model->toSyncArray();
            foreach ($changes as $field => $value) {
                if (! array_key_exists($field, $base)) {
                    continue;
                }
                $serverValue = $server[$field] ?? $model->getAttribute($field);
                if (! ValueComparator::equals($serverValue, $base[$field]) && ! ValueComparator::equals($serverValue, $value)) {
                    $conflicts[] = ['field' => $field, 'base' => $base[$field], 'local' => $value, 'server' => $serverValue];
                }
            }
        }

        $apply = Arr::except($changes, array_column($conflicts, 'field'));
        if ($force && method_exists($model, 'trashed') && method_exists($model, 'restore') && $model->trashed()) {
            $model->restore();
        }
        if ($apply !== []) {
            $before = $model->toSyncArray();
            $this->persist($def, $model, $apply, $op, false);
            if ($def->after) {
                ($def->after)($model, $apply, $op, false);
            }
            $this->audit->log(
                $this->updateAction($def, $apply),
                $model::syncEntityType(),
                $model->getKey(),
                Arr::only($before, array_keys($apply)),
                $apply,
                $op->userId,
                $op->deviceId(),
            );
        }

        if ($conflicts !== []) {
            return new HandlerResult(
                entities: [$model->refresh()],
                conflictFields: $conflicts,
                conflictType: 'field',
                conflictMessage: ucfirst($def->label).' was changed on another device: '.implode(', ', array_column($conflicts, 'field')),
                conflictEntity: $model,
            );
        }

        return HandlerResult::ok([$model->refresh()]);
    }

    public function delete(MasterDefinition $def, OperationContext $op): HandlerResult
    {
        $this->authorize($def->deletePermission);
        $modelClass = $def->model;
        /** @var SyncModel|null $model */
        $model = $modelClass::query()->find($op->entityId);
        if (! $model) {
            return HandlerResult::ok([], ['already_deleted' => true]);
        }
        $model->delete();
        $this->audit->log(Str::upper($def->label).'_DELETED', $model::syncEntityType(), $model->getKey(), ['name' => $model->getAttribute('name')], null, $op->userId, $op->deviceId());

        return HandlerResult::ok();
    }

    /** @param array<string, mixed> $values */
    private function persist(MasterDefinition $def, SyncModel $model, array $values, OperationContext $op, bool $creating): void
    {
        if ($def->persist) {
            ($def->persist)($model, $values, $op, $creating);

            return;
        }
        $model->fill($values);
        $model->save();
    }

    /** @param array<string, mixed> $changes */
    private function updateAction(MasterDefinition $def, array $changes): string
    {
        if ($def->label === 'product' && array_intersect(array_keys($changes), ['selling_price', 'mrp', 'purchase_price', 'variants'])) {
            return 'PRICE_CHANGED';
        }

        return Str::upper($def->label).'_UPDATED';
    }

    private function authorize(string $permission): void
    {
        if (! $this->tenant->can($permission)) {
            throw SyncRejected::forbidden($permission);
        }
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function validate(MasterDefinition $def, array $data, bool $partial): array
    {
        $rules = $def->rules;
        if ($partial) {
            $keys = array_keys($data);
            $rules = array_filter($rules, function ($rule, $key) use ($keys) {
                $root = explode('.', $key)[0];

                return in_array($root, $keys, true);
            }, ARRAY_FILTER_USE_BOTH);
        }
        $validator = Validator::make($data, $rules);
        if ($validator->fails()) {
            throw SyncRejected::invalid($validator->errors()->toArray());
        }

        return $validator->validated();
    }
}
