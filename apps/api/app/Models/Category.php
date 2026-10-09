<?php

namespace App\Models;

use Illuminate\Database\Eloquent\SoftDeletes;

class Category extends SyncModel
{
    use SoftDeletes;

    protected $casts = ['active' => 'boolean', 'sort_order' => 'integer', 'version' => 'integer'];

    public static function syncEntityType(): string
    {
        return 'category';
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'name' => $this->name,
            'parent_id' => $this->parent_id,
            'color' => $this->color,
            'sort_order' => $this->sort_order,
            'active' => $this->active,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
            'deleted_at' => self::iso($this->deleted_at),
        ];
    }
}
