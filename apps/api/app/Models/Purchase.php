<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;

class Purchase extends SyncModel
{
    protected $casts = [
        'charges' => 'array',
        'bill_discount_value' => 'float',
        'gross_total' => 'float',
        'discount_total' => 'float',
        'taxable_total' => 'float',
        'tax_total' => 'float',
        'charges_total' => 'float',
        'round_off' => 'float',
        'grand_total' => 'float',
        'paid_total' => 'float',
        'balance_due' => 'float',
        'returned_total' => 'float',
        'received_at' => 'datetime',
        'version' => 'integer',
    ];

    public static function syncEntityType(): string
    {
        return 'purchase';
    }

    public function syncStoreId(): ?string
    {
        return $this->store_id;
    }

    /** @return HasMany<PurchaseItem, $this> */
    public function items(): HasMany
    {
        return $this->hasMany(PurchaseItem::class)->orderBy('sort_order');
    }

    /** @return HasMany<PurchasePayment, $this> */
    public function payments(): HasMany
    {
        return $this->hasMany(PurchasePayment::class)->orderBy('occurred_at');
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        $this->loadMissing(['items', 'payments']);

        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'store_id' => $this->store_id,
            'device_id' => $this->device_id,
            'supplier_id' => $this->supplier_id,
            'supplier_name' => $this->supplier_name,
            'doc_type' => $this->doc_type,
            'status' => $this->status,
            'purchase_number' => $this->purchase_number,
            'number_status' => $this->number_status,
            'supplier_invoice_no' => $this->supplier_invoice_no,
            'purchase_date' => self::date($this->purchase_date),
            'expected_date' => self::date($this->expected_date),
            'supply_type' => $this->supply_type,
            'items' => $this->items->map(fn (PurchaseItem $i) => $i->toSyncArray())->values()->all(),
            'charges' => $this->charges ?? [],
            'bill_discount_type' => $this->bill_discount_type,
            'bill_discount_value' => $this->bill_discount_value,
            'gross_total' => $this->gross_total,
            'discount_total' => $this->discount_total,
            'taxable_total' => $this->taxable_total,
            'tax_total' => $this->tax_total,
            'charges_total' => $this->charges_total,
            'round_off' => $this->round_off,
            'grand_total' => $this->grand_total,
            'paid_total' => $this->paid_total,
            'balance_due' => $this->balance_due,
            'returned_total' => $this->returned_total,
            'payment_status' => $this->payment_status,
            'payments' => $this->payments->map(fn (PurchasePayment $p) => [
                'id' => $p->id,
                'method' => $p->method,
                'amount' => $p->amount,
                'reference' => $p->reference,
                'occurred_at' => self::iso($p->occurred_at),
            ])->values()->all(),
            'notes' => $this->notes,
            'created_by' => $this->created_by,
            'received_at' => self::iso($this->received_at),
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
