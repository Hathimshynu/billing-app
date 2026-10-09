<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Facades\Storage;

/**
 * Product aggregate root: variants, additional barcodes and quantity price tiers are saved and
 * synced together with the product (one version for the aggregate).
 */
class Product extends SyncModel
{
    use SoftDeletes;

    protected $casts = [
        'purchase_price' => 'float',
        'selling_price' => 'float',
        'mrp' => 'float',
        'min_selling_price' => 'float',
        'reorder_level' => 'float',
        'price_includes_tax' => 'boolean',
        'track_inventory' => 'boolean',
        'track_batch' => 'boolean',
        'track_serial' => 'boolean',
        'track_expiry' => 'boolean',
        'has_variants' => 'boolean',
        'active' => 'boolean',
        'variant_attributes' => 'array',
        'attributes' => 'array',
        'custom_fields' => 'array',
        'modifiers' => 'array',
        'warranty_months' => 'integer',
        'version' => 'integer',
    ];

    public static function syncEntityType(): string
    {
        return 'product';
    }

    /** @return HasMany<ProductVariant, $this> */
    public function variants(): HasMany
    {
        return $this->hasMany(ProductVariant::class)->orderBy('sort_order');
    }

    /** @return HasMany<ProductBarcode, $this> */
    public function extraBarcodes(): HasMany
    {
        return $this->hasMany(ProductBarcode::class);
    }

    /** @return HasMany<ProductPrice, $this> */
    public function priceTiers(): HasMany
    {
        return $this->hasMany(ProductPrice::class)->orderBy('min_qty');
    }

    /** @return BelongsTo<TaxRate, $this> */
    public function taxRate(): BelongsTo
    {
        return $this->belongsTo(TaxRate::class);
    }

    /** @return BelongsTo<Unit, $this> */
    public function unit(): BelongsTo
    {
        return $this->belongsTo(Unit::class);
    }

    /** @return BelongsTo<Category, $this> */
    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        $this->loadMissing(['variants', 'extraBarcodes', 'priceTiers']);

        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'name' => $this->name,
            'product_type' => $this->product_type,
            'sku' => $this->sku,
            'barcode' => $this->barcode,
            'barcodes' => $this->extraBarcodes->pluck('barcode')->values()->all(),
            'plu_code' => $this->plu_code,
            'category_id' => $this->category_id,
            'brand_id' => $this->brand_id,
            'unit_id' => $this->unit_id,
            'description' => $this->description,
            'hsn_code' => $this->hsn_code,
            'purchase_price' => $this->purchase_price,
            'selling_price' => $this->selling_price,
            'mrp' => $this->mrp,
            'min_selling_price' => $this->min_selling_price,
            'tax_rate_id' => $this->tax_rate_id,
            'price_includes_tax' => $this->price_includes_tax,
            'reorder_level' => $this->reorder_level,
            'track_inventory' => $this->track_inventory,
            'track_batch' => $this->track_batch,
            'track_serial' => $this->track_serial,
            'track_expiry' => $this->track_expiry,
            'has_variants' => $this->has_variants,
            'variant_attributes' => $this->variant_attributes ?? [],
            'variants' => $this->variants->map(fn (ProductVariant $v) => $v->toSyncArray())->values()->all(),
            'attributes' => (object) ($this->getAttribute('attributes') ?? []),
            'custom_fields' => (object) ($this->custom_fields ?? []),
            'modifiers' => $this->modifiers ?? [],
            'price_tiers' => $this->priceTiers->map(fn (ProductPrice $p) => ['min_qty' => (float) $p->min_qty, 'price' => (float) $p->price])->values()->all(),
            'warranty_months' => $this->warranty_months,
            'image_url' => $this->image_path ? Storage::disk('public')->url($this->image_path) : null,
            'active' => $this->active,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
            'deleted_at' => self::iso($this->deleted_at),
        ];
    }
}
