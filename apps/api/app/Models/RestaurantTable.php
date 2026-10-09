<?php

namespace App\Models;

use Illuminate\Database\Eloquent\SoftDeletes;

class RestaurantTable extends SyncModel
{
    use SoftDeletes;

    protected $casts = ['capacity' => 'integer', 'sort_order' => 'integer', 'active' => 'boolean', 'version' => 'integer'];

    public static function syncEntityType(): string
    {
        return 'restaurant_table';
    }

    public function syncStoreId(): ?string
    {
        return $this->store_id;
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'store_id' => $this->store_id,
            'name' => $this->name,
            'area' => $this->area,
            'capacity' => $this->capacity,
            'sort_order' => $this->sort_order,
            'active' => $this->active,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
            'deleted_at' => self::iso($this->deleted_at),
        ];
    }
}
