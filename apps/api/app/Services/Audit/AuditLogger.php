<?php

namespace App\Services\Audit;

use App\Models\AuditLog;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Arr;

/**
 * Append-only audit trail: who did what to which record, from which device and IP.
 * Sensitive attributes are never written to the log.
 */
class AuditLogger
{
    private const REDACTED = ['password', 'remember_token', 'token', 'pin'];

    public function __construct(private readonly TenantContext $tenant) {}

    /**
     * @param  array<string, mixed>|null  $old
     * @param  array<string, mixed>|null  $new
     */
    public function log(
        string $action,
        ?string $entityType = null,
        ?string $entityId = null,
        ?array $old = null,
        ?array $new = null,
        ?string $userId = null,
        ?string $deviceId = null,
        ?string $businessId = null,
    ): void {
        $request = app()->runningInConsole() ? null : request();
        AuditLog::query()->create([
            'business_id' => $businessId ?? $this->tenant->businessId(),
            'user_id' => $userId ?? $this->tenant->userId(),
            'action' => $action,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'old_values' => $old ? Arr::except($old, self::REDACTED) : null,
            'new_values' => $new ? Arr::except($new, self::REDACTED) : null,
            'device_id' => $deviceId ?? $this->tenant->device()?->id,
            'ip_address' => $request?->ip(),
            'user_agent' => $request ? mb_substr((string) $request->userAgent(), 0, 500) : null,
            'created_at' => now(),
        ]);
    }

    /** Log only the attributes that changed on a model. */
    public function logModelChange(string $action, Model $model, string $entityType, ?string $userId = null, ?string $deviceId = null): void
    {
        $changes = $model->getChanges();
        unset($changes['updated_at'], $changes['version']);
        if ($changes === []) {
            return;
        }
        $old = array_intersect_key($model->getOriginal(), $changes);
        $this->log($action, $entityType, (string) $model->getKey(), $old, $changes, $userId, $deviceId);
    }
}
