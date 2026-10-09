<?php

namespace App\Models;

class AppNotification extends SyncModel
{
    protected $table = 'app_notifications';

    protected $casts = ['read_at' => 'datetime', 'version' => 'integer'];

    public static function syncEntityType(): string
    {
        return 'notification';
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'type' => $this->type,
            'title' => $this->title,
            'body' => $this->body,
            'severity' => $this->severity,
            'entity_type' => $this->entity_type,
            'entity_id' => $this->entity_id,
            'read_at' => self::iso($this->read_at),
            'created_at' => self::iso($this->created_at),
            'version' => $this->version,
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
