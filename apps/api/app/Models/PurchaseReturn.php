<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;

class PurchaseReturn extends SyncModel
{
    protected $casts = [
        'occurred_at' => 'datetime',
        'taxable_total' => 'float',
        'tax_total' => 'float',
        'total' => 'float',
        'version' => 'integer',
    ];

    public static function syncEntityType(): string
    {
        return 'purchase_return';
    }

    public function syncStoreId(): ?string
    {
        return $this->store_id;
    }

    /** @return HasMany<PurchaseReturnItem, $this> */
    public function items(): HasMany
    {
        return $this->hasMany(PurchaseReturnItem::class);
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        $this->loadMissing('items');

        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'store_id' => $this->store_id,
            'device_id' => $this->device_id,
            'purchase_id' => $this->purchase_id,
            'supplier_id' => $this->supplier_id,
            'return_number' => $this->return_number,
            'number_status' => $this->number_status,
            'return_date' => self::date($this->return_date),
            'occurred_at' => self::iso($this->occurred_at),
            'items' => $this->items->map(fn (PurchaseReturnItem $i) => [
                'id' => $i->id,
                'purchase_item_id' => $i->purchase_item_id,
                'product_id' => $i->product_id,
                'variant_id' => $i->variant_id,
                'batch_id' => $i->batch_id,
                'name' => $i->name,
                'quantity' => $i->quantity,
                'unit_cost' => $i->unit_cost,
                'taxable' => $i->taxable,
                'tax_total' => $i->tax_total,
                'total' => $i->total,
            ])->values()->all(),
            'taxable_total' => $this->taxable_total,
            'tax_total' => $this->tax_total,
            'total' => $this->total,
            'reason' => $this->reason,
            'created_by' => $this->created_by,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
