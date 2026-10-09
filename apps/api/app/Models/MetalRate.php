<?php

namespace App\Models;

class MetalRate extends SyncModel
{
    protected $casts = ['rate_per_gram' => 'float', 'effective_from' => 'datetime', 'version' => 'integer'];

    public static function syncEntityType(): string
    {
        return 'metal_rate';
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'metal' => $this->metal,
            'purity' => $this->purity,
            'rate_per_gram' => $this->rate_per_gram,
            'effective_from' => self::iso($this->effective_from),
            'created_by' => $this->created_by,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
