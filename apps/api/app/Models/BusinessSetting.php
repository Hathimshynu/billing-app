<?php

namespace App\Models;

class BusinessSetting extends SyncModel
{
    protected $casts = ['value' => 'array', 'version' => 'integer'];

    public static function syncEntityType(): string
    {
        return 'setting';
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'key' => $this->key,
            'value' => $this->value ?? (object) [],
            'version' => $this->version,
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
