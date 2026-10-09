<?php

namespace App\Models;

use Illuminate\Database\Eloquent\SoftDeletes;

class Unit extends SyncModel
{
    use SoftDeletes;

    protected $casts = ['allow_decimal' => 'boolean', 'version' => 'integer'];

    public static function syncEntityType(): string
    {
        return 'unit';
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'code' => $this->code,
            'name' => $this->name,
            'allow_decimal' => $this->allow_decimal,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
            'deleted_at' => self::iso($this->deleted_at),
        ];
    }
}
