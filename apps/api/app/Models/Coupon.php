<?php

namespace App\Models;

use Illuminate\Database\Eloquent\SoftDeletes;

class Coupon extends SyncModel
{
    use SoftDeletes;

    protected $casts = [
        'discount_value' => 'float',
        'min_amount' => 'float',
        'max_discount' => 'float',
        'usage_limit' => 'integer',
        'used_count' => 'integer',
        'active' => 'boolean',
        'version' => 'integer',
    ];

    public static function syncEntityType(): string
    {
        return 'coupon';
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'code' => $this->code,
            'description' => $this->description,
            'discount_type' => $this->discount_type,
            'discount_value' => $this->discount_value,
            'min_amount' => $this->min_amount,
            'max_discount' => $this->max_discount,
            'valid_from' => self::date($this->valid_from),
            'valid_to' => self::date($this->valid_to),
            'usage_limit' => $this->usage_limit,
            'used_count' => $this->used_count,
            'active' => $this->active,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
            'deleted_at' => self::iso($this->deleted_at),
        ];
    }
}
