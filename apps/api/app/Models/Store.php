<?php

namespace App\Models;

use Illuminate\Database\Eloquent\SoftDeletes;

class Store extends SyncModel
{
    use SoftDeletes;

    protected $casts = ['is_default' => 'boolean', 'active' => 'boolean', 'version' => 'integer'];

    public static function syncEntityType(): string
    {
        return 'store';
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'name' => $this->name,
            'code' => $this->code,
            'address' => $this->address,
            'phone' => $this->phone,
            'gstin' => $this->gstin,
            'state_code' => $this->state_code,
            'is_default' => $this->is_default,
            'active' => $this->active,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
            'deleted_at' => self::iso($this->deleted_at),
        ];
    }
}
