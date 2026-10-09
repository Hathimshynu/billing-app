<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class SaleReturn extends SyncModel
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
        return 'sale_return';
    }

    public function syncStoreId(): ?string
    {
        return $this->store_id;
    }

    /** @return HasMany<SaleReturnItem, $this> */
    public function items(): HasMany
    {
        return $this->hasMany(SaleReturnItem::class);
    }

    /** @return BelongsTo<Sale, $this> */
    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        $this->loadMissing(['items', 'sale']);

        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'store_id' => $this->store_id,
            'device_id' => $this->device_id,
            'register_id' => $this->register_id,
            'sale_id' => $this->sale_id,
            'sale_number' => $this->sale?->invoice_number,
            'customer_id' => $this->customer_id,
            'return_number' => $this->return_number,
            'number_status' => $this->number_status,
            'return_date' => self::date($this->return_date),
            'occurred_at' => self::iso($this->occurred_at),
            'items' => $this->items->map(fn (SaleReturnItem $i) => [
                'id' => $i->id,
                'sale_item_id' => $i->sale_item_id,
                'product_id' => $i->product_id,
                'variant_id' => $i->variant_id,
                'batch_id' => $i->batch_id,
                'serial_ids' => $i->serial_ids ?? [],
                'name' => $i->name,
                'quantity' => $i->quantity,
                'unit_price' => $i->unit_price,
                'taxable' => $i->taxable,
                'tax_total' => $i->tax_total,
                'total' => $i->total,
                'restock' => $i->restock,
            ])->values()->all(),
            'taxable_total' => $this->taxable_total,
            'tax_total' => $this->tax_total,
            'total' => $this->total,
            'refund_method' => $this->refund_method,
            'reason' => $this->reason,
            'created_by' => $this->created_by,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
