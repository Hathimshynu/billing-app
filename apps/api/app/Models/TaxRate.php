<?php

namespace App\Models;

use Illuminate\Database\Eloquent\SoftDeletes;

class TaxRate extends SyncModel
{
    use SoftDeletes;

    protected $casts = [
        'rate' => 'float',
        'cess_rate' => 'float',
        'components' => 'array',
        'is_default' => 'boolean',
        'active' => 'boolean',
        'version' => 'integer',
    ];

    public static function syncEntityType(): string
    {
        return 'tax_rate';
    }

    /** Snapshot stored on invoice lines so later rate changes never alter past invoices. */
    /** @return array<string, mixed> */
    public function snapshot(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'kind' => $this->kind,
            'rate' => $this->rate,
            'cess_rate' => $this->cess_rate,
            'components' => $this->components,
        ];
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'name' => $this->name,
            'kind' => $this->kind,
            'rate' => $this->rate,
            'cess_rate' => $this->cess_rate,
            'components' => $this->components,
            'is_default' => $this->is_default,
            'active' => $this->active,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
            'deleted_at' => self::iso($this->deleted_at),
        ];
    }
}
