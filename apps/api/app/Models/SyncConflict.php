<?php

namespace App\Models;

class SyncConflict extends SyncModel
{
    protected $casts = [
        'fields' => 'array',
        'server_data' => 'array',
        'local_payload' => 'array',
        'resolved_at' => 'datetime',
        'version' => 'integer',
    ];

    public static function syncEntityType(): string
    {
        return 'sync_conflict';
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'operation_id' => $this->operation_id,
            'entity_type' => $this->entity_type,
            'entity_id' => $this->entity_id,
            'conflict_type' => $this->conflict_type,
            'fields' => $this->fields ?? [],
            'server_data' => $this->server_data,
            'local_payload' => $this->local_payload,
            'message' => $this->message,
            'status' => $this->status,
            'resolution' => $this->resolution,
            'created_at' => self::iso($this->created_at),
            'resolved_at' => self::iso($this->resolved_at),
            'version' => $this->version,
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
