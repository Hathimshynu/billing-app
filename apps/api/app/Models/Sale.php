<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Sales document aggregate (invoice / quotation / estimate / proforma / delivery challan) with
 * its items and payments. Created with a device-generated UUID; never deleted, only cancelled.
 */
class Sale extends SyncModel
{
    protected $casts = [
        'occurred_at' => 'datetime',
        'cancelled_at' => 'datetime',
        'kitchen_order_ids' => 'array',
        'charges' => 'array',
        'tax_breakup' => 'array',
        'review_flags' => 'array',
        'meta' => 'array',
        'bill_discount_value' => 'float',
        'gross_total' => 'float',
        'line_discount_total' => 'float',
        'bill_discount_total' => 'float',
        'discount_total' => 'float',
        'taxable_total' => 'float',
        'tax_total' => 'float',
        'charges_total' => 'float',
        'round_off' => 'float',
        'grand_total' => 'float',
        'paid_total' => 'float',
        'change_due' => 'float',
        'balance_due' => 'float',
        'returned_total' => 'float',
        'loyalty_points_earned' => 'integer',
        'loyalty_points_redeemed' => 'integer',
        'version' => 'integer',
    ];

    public static function syncEntityType(): string
    {
        return 'sale';
    }

    public function syncStoreId(): ?string
    {
        return $this->store_id;
    }

    /** @return HasMany<SaleItem, $this> */
    public function items(): HasMany
    {
        return $this->hasMany(SaleItem::class)->orderBy('sort_order');
    }

    /** @return HasMany<SalePayment, $this> */
    public function payments(): HasMany
    {
        return $this->hasMany(SalePayment::class)->orderBy('occurred_at');
    }

    /** @return BelongsTo<Customer, $this> */
    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    /** @return BelongsTo<User, $this> */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function isInvoice(): bool
    {
        return $this->doc_type === 'invoice';
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        $this->loadMissing(['items', 'payments', 'creator']);

        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'store_id' => $this->store_id,
            'device_id' => $this->device_id,
            'register_id' => $this->register_id,
            'customer_id' => $this->customer_id,
            'customer_name' => $this->customer_name,
            'customer_phone' => $this->customer_phone,
            'customer_gstin' => $this->customer_gstin,
            'doc_type' => $this->doc_type,
            'status' => $this->status,
            'invoice_number' => $this->invoice_number,
            'number_status' => $this->number_status,
            'number_block_id' => $this->number_block_id,
            'provisional_number' => $this->provisional_number,
            'invoice_date' => self::date($this->invoice_date),
            'occurred_at' => self::iso($this->occurred_at),
            'due_date' => self::date($this->due_date),
            'supply_type' => $this->supply_type,
            'place_of_supply' => $this->place_of_supply,
            'order_type' => $this->order_type,
            'table_id' => $this->table_id,
            'kitchen_order_ids' => $this->kitchen_order_ids ?? [],
            'items' => $this->items->map(fn (SaleItem $i) => $i->toSyncArray())->values()->all(),
            'payments' => $this->payments->map(fn (SalePayment $p) => $p->toSyncArray())->values()->all(),
            'charges' => $this->charges ?? [],
            'bill_discount_type' => $this->bill_discount_type,
            'bill_discount_value' => $this->bill_discount_value,
            'round_off_mode' => $this->round_off_mode,
            'gross_total' => $this->gross_total,
            'line_discount_total' => $this->line_discount_total,
            'bill_discount_total' => $this->bill_discount_total,
            'discount_total' => $this->discount_total,
            'taxable_total' => $this->taxable_total,
            'tax_total' => $this->tax_total,
            'charges_total' => $this->charges_total,
            'round_off' => $this->round_off,
            'grand_total' => $this->grand_total,
            'paid_total' => $this->paid_total,
            'change_due' => $this->change_due,
            'balance_due' => $this->balance_due,
            'returned_total' => $this->returned_total,
            'payment_status' => $this->payment_status,
            'tax_breakup' => $this->tax_breakup ?? [],
            'coupon_code' => $this->coupon_code,
            'loyalty_points_earned' => $this->loyalty_points_earned,
            'loyalty_points_redeemed' => $this->loyalty_points_redeemed,
            'converted_from_id' => $this->converted_from_id,
            'converted_to_id' => $this->converted_to_id,
            'valid_until' => self::date($this->valid_until),
            'notes' => $this->notes,
            'created_by' => $this->created_by,
            'created_by_name' => $this->creator?->name,
            'cancelled_at' => self::iso($this->cancelled_at),
            'cancelled_by' => $this->cancelled_by,
            'cancel_reason' => $this->cancel_reason,
            'review_flags' => $this->review_flags ?? [],
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
