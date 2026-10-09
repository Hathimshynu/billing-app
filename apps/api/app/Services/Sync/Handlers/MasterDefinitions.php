<?php

namespace App\Services\Sync\Handlers;

use App\Domain\Business\BusinessTypes;
use App\Domain\Pricing\PricingEngine;
use App\Models\Brand;
use App\Models\Category;
use App\Models\Coupon;
use App\Models\Customer;
use App\Models\ExpenseCategory;
use App\Models\JewelleryOrder;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\ProductBatch;
use App\Models\ProductPrice;
use App\Models\ProductVariant;
use App\Models\RestaurantTable;
use App\Models\Store;
use App\Models\Supplier;
use App\Models\SyncModel;
use App\Models\TaxRate;
use App\Models\Unit;
use App\Services\Ledger\LedgerService;
use App\Services\Sync\Exceptions\SyncRejected;
use App\Services\Sync\OperationContext;
use Illuminate\Support\Arr;
use Illuminate\Validation\Rule;

/**
 * Validation rules, permissions and persistence hooks for every master-data entity that devices
 * may create or edit offline.
 */
class MasterDefinitions
{
    /** @var array<string, MasterDefinition> */
    private array $definitions = [];

    public function __construct(private readonly LedgerService $ledger) {}

    public function get(string $entityType): MasterDefinition
    {
        return $this->definitions[$entityType] ??= $this->build($entityType);
    }

    private function build(string $type): MasterDefinition
    {
        $gstin = fn (string $attribute, mixed $value, \Closure $fail) => $value && ! PricingEngine::isValidGstin((string) $value) ? $fail('The GSTIN is invalid.') : null;

        return match ($type) {
            'category' => new MasterDefinition(
                Category::class, 'category', 'products.create', 'products.edit', 'products.delete',
                [
                    'name' => ['required', 'string', 'max:120'],
                    'parent_id' => ['nullable', 'uuid'],
                    'color' => ['nullable', 'string', 'max:20'],
                    'sort_order' => ['nullable', 'integer', 'min:0'],
                    'active' => ['boolean'],
                ],
                ['name', 'parent_id', 'color', 'sort_order', 'active'],
            ),
            'brand' => new MasterDefinition(
                Brand::class, 'brand', 'products.create', 'products.edit', 'products.delete',
                ['name' => ['required', 'string', 'max:120'], 'active' => ['boolean']],
                ['name', 'active'],
            ),
            'unit' => new MasterDefinition(
                Unit::class, 'unit', 'products.create', 'products.edit', 'products.delete',
                ['code' => ['required', 'string', 'max:16'], 'name' => ['required', 'string', 'max:60'], 'allow_decimal' => ['boolean']],
                ['code', 'name', 'allow_decimal'],
            ),
            'tax_rate' => new MasterDefinition(
                TaxRate::class, 'tax_rate', 'settings.manage', 'settings.manage', 'settings.manage',
                [
                    'name' => ['required', 'string', 'max:80'],
                    'kind' => ['required', Rule::in(['gst', 'vat', 'simple', 'custom', 'exempt'])],
                    'rate' => ['required', 'numeric', 'min:0', 'max:100'],
                    'cess_rate' => ['nullable', 'numeric', 'min:0', 'max:100'],
                    'components' => ['nullable', 'array', 'max:6'],
                    'components.*.code' => ['required', 'string', 'max:16'],
                    'components.*.name' => ['required', 'string', 'max:40'],
                    'components.*.rate' => ['required', 'numeric', 'min:0', 'max:100'],
                    'is_default' => ['boolean'],
                    'active' => ['boolean'],
                ],
                ['name', 'kind', 'rate', 'cess_rate', 'components', 'is_default', 'active'],
                after: function (SyncModel $model, array $data) {
                    if (! empty($data['is_default'])) {
                        TaxRate::query()->whereKeyNot($model->getKey())->where('is_default', true)->get()
                            ->each(fn (TaxRate $t) => $t->forceFill(['is_default' => false])->save());
                    }
                },
            ),
            'expense_category' => new MasterDefinition(
                ExpenseCategory::class, 'expense_category', 'expenses.create', 'expenses.create', 'expenses.delete',
                ['name' => ['required', 'string', 'max:80'], 'active' => ['boolean']],
                ['name', 'active'],
            ),
            'restaurant_table' => new MasterDefinition(
                RestaurantTable::class, 'restaurant_table', 'restaurant.manage', 'restaurant.manage', 'restaurant.manage',
                [
                    'store_id' => ['required', 'uuid'],
                    'name' => ['required', 'string', 'max:40'],
                    'area' => ['nullable', 'string', 'max:40'],
                    'capacity' => ['nullable', 'integer', 'min:1', 'max:100'],
                    'sort_order' => ['nullable', 'integer', 'min:0'],
                    'active' => ['boolean'],
                ],
                ['store_id', 'name', 'area', 'capacity', 'sort_order', 'active'],
                persist: function (SyncModel $model, array $values) {
                    if (isset($values['store_id']) && ! Store::query()->whereKey($values['store_id'])->exists()) {
                        throw SyncRejected::invalid(['store_id' => ['Unknown store.']]);
                    }
                    $model->fill($values)->save();
                },
            ),
            'coupon' => new MasterDefinition(
                Coupon::class, 'coupon', 'settings.manage', 'settings.manage', 'settings.manage',
                [
                    'code' => ['required', 'string', 'max:32', 'regex:/^[A-Z0-9_-]+$/i'],
                    'description' => ['nullable', 'string', 'max:200'],
                    'discount_type' => ['required', Rule::in(['percent', 'amount'])],
                    'discount_value' => ['required', 'numeric', 'gt:0'],
                    'min_amount' => ['nullable', 'numeric', 'min:0'],
                    'max_discount' => ['nullable', 'numeric', 'min:0'],
                    'valid_from' => ['nullable', 'date_format:Y-m-d'],
                    'valid_to' => ['nullable', 'date_format:Y-m-d'],
                    'usage_limit' => ['nullable', 'integer', 'min:1'],
                    'active' => ['boolean'],
                ],
                ['code', 'description', 'discount_type', 'discount_value', 'min_amount', 'max_discount', 'valid_from', 'valid_to', 'usage_limit', 'active'],
                persist: function (SyncModel $model, array $values) {
                    if (isset($values['code'])) {
                        $values['code'] = strtoupper($values['code']);
                    }
                    $model->fill($values)->save();
                },
            ),
            'customer' => new MasterDefinition(
                Customer::class, 'customer', 'customers.create', 'customers.edit', 'customers.delete',
                [
                    'name' => ['required', 'string', 'max:150'],
                    'phone' => ['nullable', 'string', 'max:20'],
                    'email' => ['nullable', 'email', 'max:190'],
                    'address' => ['nullable', 'string', 'max:500'],
                    'city' => ['nullable', 'string', 'max:100'],
                    'state_code' => ['nullable', 'string', 'max:4'],
                    'pincode' => ['nullable', 'string', 'max:12'],
                    'gstin' => ['nullable', 'string', 'size:15', $gstin],
                    'credit_limit' => ['nullable', 'numeric', 'min:0'],
                    'opening_balance' => ['nullable', 'numeric'],
                    'tier' => ['nullable', 'string', 'max:40'],
                    'notes' => ['nullable', 'string', 'max:1000'],
                    'date_of_birth' => ['nullable', 'date_format:Y-m-d'],
                    'active' => ['boolean'],
                    'opening_entry_id' => ['nullable', 'uuid'],
                ],
                ['name', 'phone', 'email', 'address', 'city', 'state_code', 'pincode', 'gstin', 'credit_limit', 'opening_balance', 'tier', 'notes', 'date_of_birth', 'active'],
                after: function (SyncModel $model, array $data, OperationContext $op, bool $creating) {
                    if ($model instanceof Customer && array_key_exists('opening_balance', $data) && ($creating ? (float) $data['opening_balance'] != 0.0 : true)) {
                        $this->ledger->setCustomerOpeningBalance($model, (float) ($data['opening_balance'] ?? 0), $op->payload['opening_entry_id'] ?? null, $op->userId, $op->deviceId());
                    }
                },
            ),
            'supplier' => new MasterDefinition(
                Supplier::class, 'supplier', 'suppliers.create', 'suppliers.edit', 'suppliers.delete',
                [
                    'name' => ['required', 'string', 'max:150'],
                    'phone' => ['nullable', 'string', 'max:20'],
                    'email' => ['nullable', 'email', 'max:190'],
                    'address' => ['nullable', 'string', 'max:500'],
                    'city' => ['nullable', 'string', 'max:100'],
                    'state_code' => ['nullable', 'string', 'max:4'],
                    'gstin' => ['nullable', 'string', 'size:15', $gstin],
                    'opening_balance' => ['nullable', 'numeric'],
                    'credit_days' => ['nullable', 'integer', 'min:0', 'max:365'],
                    'notes' => ['nullable', 'string', 'max:1000'],
                    'active' => ['boolean'],
                    'opening_entry_id' => ['nullable', 'uuid'],
                ],
                ['name', 'phone', 'email', 'address', 'city', 'state_code', 'gstin', 'opening_balance', 'credit_days', 'notes', 'active'],
                after: function (SyncModel $model, array $data, OperationContext $op, bool $creating) {
                    if ($model instanceof Supplier && array_key_exists('opening_balance', $data) && ($creating ? (float) $data['opening_balance'] != 0.0 : true)) {
                        $this->ledger->setSupplierOpeningBalance($model, (float) ($data['opening_balance'] ?? 0), $op->payload['opening_entry_id'] ?? null, $op->userId, $op->deviceId());
                    }
                },
            ),
            'product' => $this->productDefinition(),
            'product_batch' => new MasterDefinition(
                ProductBatch::class, 'product_batch', 'products.edit', 'products.edit', 'products.delete',
                [
                    'product_id' => ['required', 'uuid'],
                    'variant_id' => ['nullable', 'uuid'],
                    'batch_no' => ['required', 'string', 'max:64'],
                    'expiry_date' => ['nullable', 'date_format:Y-m-d'],
                    'mfg_date' => ['nullable', 'date_format:Y-m-d'],
                    'mrp' => ['nullable', 'numeric', 'min:0'],
                    'purchase_price' => ['nullable', 'numeric', 'min:0'],
                    'selling_price' => ['nullable', 'numeric', 'min:0'],
                ],
                ['product_id', 'variant_id', 'batch_no', 'expiry_date', 'mfg_date', 'mrp', 'purchase_price', 'selling_price'],
                persist: function (SyncModel $model, array $values) {
                    if (isset($values['product_id']) && ! Product::withTrashed()->whereKey($values['product_id'])->exists()) {
                        throw SyncRejected::dependency('Product');
                    }
                    $model->fill($values)->save();
                },
            ),
            'jewellery_order' => new MasterDefinition(
                JewelleryOrder::class, 'jewellery_order', 'jewellery.orders', 'jewellery.orders', 'jewellery.orders',
                [
                    'store_id' => ['required', 'uuid'],
                    'order_number' => ['required', 'string', 'max:64'],
                    'type' => ['required', Rule::in(['repair', 'custom'])],
                    'customer_id' => ['nullable', 'uuid'],
                    'customer_name' => ['required', 'string', 'max:150'],
                    'customer_phone' => ['nullable', 'string', 'max:20'],
                    'description' => ['required', 'string', 'max:1000'],
                    'metal' => ['nullable', 'string', 'max:20'],
                    'purity' => ['nullable', 'string', 'max:16'],
                    'weight' => ['nullable', 'numeric', 'min:0'],
                    'estimated_amount' => ['nullable', 'numeric', 'min:0'],
                    'advance_paid' => ['nullable', 'numeric', 'min:0'],
                    'advance_method' => ['nullable', Rule::in(BusinessTypes::PAYMENT_METHODS)],
                    'due_date' => ['nullable', 'date_format:Y-m-d'],
                    'status' => ['required', Rule::in(['received', 'in_progress', 'ready', 'delivered', 'cancelled'])],
                    'delivered_at' => ['nullable', 'date'],
                    'sale_id' => ['nullable', 'uuid'],
                    'notes' => ['nullable', 'string', 'max:1000'],
                ],
                ['store_id', 'order_number', 'type', 'customer_id', 'customer_name', 'customer_phone', 'description', 'metal', 'purity', 'weight', 'estimated_amount', 'advance_paid', 'advance_method', 'due_date', 'status', 'delivered_at', 'sale_id', 'notes'],
                persist: function (SyncModel $model, array $values, OperationContext $op, bool $creating) {
                    if ($creating) {
                        $model->setAttribute('created_by', $op->userId);
                    }
                    $model->fill($values)->save();
                },
            ),
            default => throw new SyncRejected('unknown_entity', "Unsupported entity type {$type}."),
        };
    }

    private function productDefinition(): MasterDefinition
    {
        $fields = [
            'name', 'product_type', 'sku', 'barcode', 'plu_code', 'category_id', 'brand_id', 'unit_id', 'description',
            'hsn_code', 'purchase_price', 'selling_price', 'mrp', 'min_selling_price', 'tax_rate_id', 'price_includes_tax',
            'reorder_level', 'track_inventory', 'track_batch', 'track_serial', 'track_expiry', 'has_variants',
            'variant_attributes', 'attributes', 'custom_fields', 'modifiers', 'warranty_months', 'active',
            'variants', 'barcodes', 'price_tiers',
        ];

        return new MasterDefinition(
            Product::class, 'product', 'products.create', 'products.edit', 'products.delete',
            [
                'name' => ['required', 'string', 'max:200'],
                'product_type' => ['required', Rule::in(['standard', 'service', 'jewellery', 'weighed'])],
                'sku' => ['nullable', 'string', 'max:64'],
                'barcode' => ['nullable', 'string', 'max:64'],
                'barcodes' => ['nullable', 'array', 'max:20'],
                'barcodes.*' => ['string', 'max:64'],
                'plu_code' => ['nullable', 'string', 'max:16'],
                'category_id' => ['nullable', 'uuid'],
                'brand_id' => ['nullable', 'uuid'],
                'unit_id' => ['nullable', 'uuid'],
                'description' => ['nullable', 'string', 'max:2000'],
                'hsn_code' => ['nullable', 'string', 'max:10'],
                'purchase_price' => ['nullable', 'numeric', 'min:0'],
                'selling_price' => ['required', 'numeric', 'min:0'],
                'mrp' => ['nullable', 'numeric', 'min:0'],
                'min_selling_price' => ['nullable', 'numeric', 'min:0'],
                'tax_rate_id' => ['nullable', 'uuid'],
                'price_includes_tax' => ['boolean'],
                'reorder_level' => ['nullable', 'numeric', 'min:0'],
                'track_inventory' => ['boolean'],
                'track_batch' => ['boolean'],
                'track_serial' => ['boolean'],
                'track_expiry' => ['boolean'],
                'has_variants' => ['boolean'],
                'variant_attributes' => ['nullable', 'array'],
                'variant_attributes.*.name' => ['required', 'string', 'max:40'],
                'variant_attributes.*.values' => ['required', 'array'],
                'variant_attributes.*.values.*' => ['string', 'max:40'],
                'variants' => ['nullable', 'array', 'max:500'],
                'variants.*.id' => ['required', 'uuid'],
                'variants.*.name' => ['required', 'string', 'max:120'],
                'variants.*.sku' => ['nullable', 'string', 'max:64'],
                'variants.*.barcode' => ['nullable', 'string', 'max:64'],
                'variants.*.attributes' => ['nullable', 'array'],
                'variants.*.purchase_price' => ['nullable', 'numeric', 'min:0'],
                'variants.*.selling_price' => ['nullable', 'numeric', 'min:0'],
                'variants.*.mrp' => ['nullable', 'numeric', 'min:0'],
                'variants.*.active' => ['boolean'],
                'variants.*.sort_order' => ['nullable', 'integer'],
                'attributes' => ['nullable', 'array'],
                'custom_fields' => ['nullable', 'array'],
                'modifiers' => ['nullable', 'array'],
                'price_tiers' => ['nullable', 'array', 'max:20'],
                'price_tiers.*.min_qty' => ['required', 'numeric', 'gt:0'],
                'price_tiers.*.price' => ['required', 'numeric', 'min:0'],
                'warranty_months' => ['nullable', 'integer', 'min:0', 'max:240'],
                'active' => ['boolean'],
            ],
            $fields,
            persist: function (SyncModel $model, array $values) {
                if (! $model instanceof Product) {
                    throw new \LogicException('Product definition used with '.$model::class);
                }
                foreach (['category_id' => Category::class, 'brand_id' => Brand::class, 'unit_id' => Unit::class, 'tax_rate_id' => TaxRate::class] as $key => $class) {
                    if (! empty($values[$key]) && ! $class::withTrashed()->whereKey($values[$key])->exists()) {
                        throw SyncRejected::dependency(class_basename($class));
                    }
                }
                $children = Arr::only($values, ['variants', 'barcodes', 'price_tiers']);
                $attributes = Arr::except($values, ['variants', 'barcodes', 'price_tiers']);
                foreach ($attributes as $key => $value) {
                    $model->setAttribute($key, $value);
                }
                if (! $model->exists && ! array_key_exists('attributes', $attributes)) {
                    $model->setAttribute('attributes', []);
                }
                $model->save();

                if (array_key_exists('variants', $children)) {
                    $keep = [];
                    foreach (array_values($children['variants'] ?? []) as $i => $variant) {
                        $keep[] = $variant['id'];
                        $row = ProductVariant::withTrashed()->find($variant['id']) ?? new ProductVariant(['id' => $variant['id']]);
                        if ($row->trashed()) {
                            $row->restore();
                        }
                        $row->forceFill([
                            'id' => $variant['id'],
                            'product_id' => $model->id,
                            'name' => $variant['name'],
                            'sku' => $variant['sku'] ?? null,
                            'barcode' => $variant['barcode'] ?? null,
                            'attributes' => $variant['attributes'] ?? [],
                            'purchase_price' => $variant['purchase_price'] ?? null,
                            'selling_price' => $variant['selling_price'] ?? null,
                            'mrp' => $variant['mrp'] ?? null,
                            'active' => $variant['active'] ?? true,
                            'sort_order' => $variant['sort_order'] ?? $i,
                        ])->save();
                    }
                    ProductVariant::query()->where('product_id', $model->id)->whereNotIn('id', $keep)->delete();
                }
                if (array_key_exists('barcodes', $children)) {
                    ProductBarcode::query()->where('product_id', $model->id)->delete();
                    foreach (array_unique($children['barcodes'] ?? []) as $code) {
                        ProductBarcode::query()->create(['product_id' => $model->id, 'barcode' => $code]);
                    }
                }
                if (array_key_exists('price_tiers', $children)) {
                    ProductPrice::query()->where('product_id', $model->id)->delete();
                    foreach ($children['price_tiers'] ?? [] as $tier) {
                        ProductPrice::query()->create(['product_id' => $model->id, 'min_qty' => $tier['min_qty'], 'price' => $tier['price']]);
                    }
                }
                if ($children !== []) {
                    // Children changed without touching product columns: still bump the aggregate.
                    if (! $model->wasChanged() && ! $model->wasRecentlyCreated) {
                        $model->touch();
                    }
                    $model->unsetRelation('variants')->unsetRelation('extraBarcodes')->unsetRelation('priceTiers');
                }
            },
        );
    }
}
