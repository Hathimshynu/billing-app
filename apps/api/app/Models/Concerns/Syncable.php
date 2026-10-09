<?php

namespace App\Models\Concerns;

use App\Models\Contracts\SyncableEntity;
use App\Services\Sync\ChangeLogger;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;

/**
 * Entities that devices download. Every create/update/delete:
 *  - bumps `version` (optimistic concurrency / conflict detection)
 *  - appends a row to the per-business change feed (sync_changes) inside the same transaction
 */
trait Syncable
{
    public static function bootSyncable(): void
    {
        static::creating(function (Model $model) {
            if (! $model->getAttribute('version')) {
                $model->setAttribute('version', 1);
            }
        });

        static::updating(function (Model $model) {
            if ($model->isDirty() && ! $model->isDirty('version')) {
                $model->setAttribute('version', ((int) $model->getOriginal('version')) + 1);
            }
        });

        static::saved(fn (SyncableEntity $model) => app(ChangeLogger::class)->record($model));
        static::deleted(fn (SyncableEntity $model) => app(ChangeLogger::class)->record($model, 'delete'));

        if (in_array(SoftDeletes::class, class_uses_recursive(static::class), true)) {
            static::registerModelEvent('restored', fn (SyncableEntity $model) => app(ChangeLogger::class)->record($model));
        }
    }

    /** Store the entity belongs to; null means every device of the business needs it. */
    public function syncStoreId(): ?string
    {
        return null;
    }

    public function syncBusinessId(): string
    {
        return (string) $this->getAttribute('business_id');
    }

    public function syncEntityId(): string
    {
        return (string) $this->getKey();
    }

    protected static function iso(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (! $value instanceof \DateTimeInterface) {
            $value = Carbon::parse((string) $value);
        }

        return Carbon::instance($value)->utc()->toIso8601ZuluString('millisecond');
    }

    protected static function num(mixed $value): ?float
    {
        return $value === null ? null : (float) $value;
    }

    protected static function date(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d');
        }

        return substr((string) $value, 0, 10);
    }
}
