<?php

namespace App\Services\Sync;

use App\Models\Device;
use App\Models\SyncChange;
use App\Support\Tenancy\TenantContext;

/**
 * Incremental download of server changes using a cursor (the change feed id).
 *
 * Only entities the device needs are returned: business-wide entities plus those of the device's
 * store (devices without a store — e.g. the owner's laptop — receive every store). Several changes
 * to the same entity in one page collapse into its latest snapshot.
 */
class SyncPullService
{
    public const DEFAULT_LIMIT = 500;

    public const MAX_LIMIT = 2000;

    public function __construct(private readonly TenantContext $tenant) {}

    /** @return array<string, mixed> */
    public function pull(Device $device, ?int $cursor, ?int $limit = null): array
    {
        $cursor = max(0, (int) $cursor);
        $limit = max(1, min($limit ?? self::DEFAULT_LIMIT, self::MAX_LIMIT));

        $query = SyncChange::query()
            ->where('business_id', $this->tenant->businessId())
            ->where('id', '>', $cursor);
        if ($device->store_id) {
            $query->where(fn ($q) => $q->whereNull('store_id')->orWhere('store_id', $device->store_id));
        }
        $rows = $query->orderBy('id')->limit($limit + 1)->get(['id', 'entity_type', 'entity_id', 'action']);
        $hasMore = $rows->count() > $limit;
        $rows = $rows->take($limit)->values();
        $nextCursor = $rows->isEmpty() ? $cursor : (int) $rows->last()->id;

        // Keep only the latest change per entity within the page, preserving feed order.
        $latest = [];
        foreach ($rows as $row) {
            $key = $row->entity_type.':'.$row->entity_id;
            unset($latest[$key]);
            $latest[$key] = $row;
        }

        $idsByType = [];
        foreach ($latest as $row) {
            $idsByType[$row->entity_type][] = $row->entity_id;
        }
        $models = [];
        foreach ($idsByType as $type => $ids) {
            $models[$type] = SyncEntityMap::load($type, array_values(array_unique($ids)));
        }

        $changes = [];
        foreach ($latest as $row) {
            $model = $models[$row->entity_type][$row->entity_id] ?? null;
            if ($row->entity_type === 'business' && $row->entity_id !== $this->tenant->businessId()) {
                continue;
            }
            if ($model === null || $row->action === 'delete' && ! method_exists($model, 'trashed')) {
                $changes[] = ['seq' => (int) $row->id, 'entity_type' => $row->entity_type, 'entity_id' => $row->entity_id, 'action' => 'delete', 'data' => null];

                continue;
            }
            $changes[] = [
                'seq' => (int) $row->id,
                'entity_type' => $row->entity_type,
                'entity_id' => $row->entity_id,
                'action' => 'upsert',
                'data' => $model->toSyncArray(),
            ];
        }

        Device::query()->withoutGlobalScopes()->whereKey($device->id)->update(['last_seen_at' => now(), 'last_sync_at' => now()]);

        return [
            'success' => true,
            'changes' => $changes,
            'cursor' => $nextCursor,
            'has_more' => $hasMore,
            'server_time' => now()->toIso8601ZuluString('millisecond'),
        ];
    }
}
