<?php

namespace App\Services\Notifications;

use App\Models\AppNotification;
use Illuminate\Support\Facades\Log;

/**
 * Server-generated notifications (synced to every device of the business). Stock and expiry
 * alerts are computed on devices from local data, so they work offline.
 */
class NotificationService
{
    public function notify(string $type, string $title, ?string $body = null, string $severity = 'warning', ?string $entityType = null, ?string $entityId = null): AppNotification
    {
        Log::channel('sync')->info('notification', ['type' => $type, 'title' => $title, 'entity' => $entityType.':'.$entityId]);

        return AppNotification::query()->create([
            'type' => $type,
            'title' => mb_substr($title, 0, 200),
            'body' => $body ? mb_substr($body, 0, 1000) : null,
            'severity' => $severity,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
        ]);
    }
}
