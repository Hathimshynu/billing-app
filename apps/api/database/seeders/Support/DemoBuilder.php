<?php

namespace Database\Seeders\Support;

use App\Domain\Pricing\PricingEngine;
use App\Models\Business;
use App\Models\BusinessUser;
use App\Models\Category;
use App\Models\Store;
use App\Models\TaxRate;
use App\Models\Unit;
use App\Models\User;
use App\Services\Sync\OperationContext;
use App\Services\Sync\OperationRegistry;
use App\Support\Tenancy\BusinessLock;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Builds demo data through the real operation handlers (same code path as device sync), so seeded
 * stock, batches, IMEIs, ledgers and invoices are exactly what the app would have produced.
 */
final class DemoBuilder
{
    private TenantContext $tenant;

    private OperationRegistry $registry;

    private BusinessLock $lock;

    public Store $store;

    /** @var array<string, string> category name => id */
    public array $categories = [];

    /** @var array<string, string> unit code => id */
    public array $units = [];

    /** @var array<string, TaxRate> rate => tax */
    public array $taxes = [];

    public function __construct(public readonly Business $business, public readonly User $owner)
    {
        $this->tenant = app(TenantContext::class);
        $this->registry = app(OperationRegistry::class);
        $this->lock = app(BusinessLock::class);
        $this->enter();
        $this->store = Store::query()->where('is_default', true)->firstOrFail();
        $this->categories = Category::query()->pluck('id', 'name')->all();
        $this->units = Unit::query()->pluck('id', 'code')->all();
        foreach (TaxRate::query()->get() as $tax) {
            $this->taxes[(string) (float) $tax->rate] = $tax;
        }
    }

    public function enter(): void
    {
        $member = BusinessUser::query()->withoutGlobalScopes()->with(['user', 'role.permissions'])
            ->where('business_id', $this->business->id)->where('user_id', $this->owner->id)->firstOrFail();
        $this->tenant->set($this->business, $this->owner, $member, $member->effectivePermissions());
    }

    public function leave(): void
    {
        $this->tenant->clear();
    }

    /** @param array<string, mixed> $payload */
    public function op(string $operation, string $entityType, array $payload, ?string $id = null): string
    {
        $id ??= (string) Str::uuid7();
        $ctx = new OperationContext((string) Str::uuid7(), $operation, $entityType, $id, $payload, null, now()->toIso8601String(), $this->owner->id, null);
        $result = $this->lock->transaction($this->business->id, fn () => $this->registry->dispatch($ctx));
        if ($result->hasConflict()) {
            throw new RuntimeException("Unexpected conflict seeding {$operation}");
        }

        return $id;
    }

    public function tax(float $rate): ?TaxRate
    {
        return $this->taxes[(string) $rate] ?? null;
    }

    /**
     * @param  array<string, mixed>  $data
     */
    public function product(array $data, float $openingStock = 0, ?float $cost = null): string
    {
        $tax = isset($data['tax']) ? $this->tax((float) $data['tax']) : null;
        unset($data['tax']);
        $category = $data['category'] ?? null;
        $unit = $data['unit'] ?? 'pcs';
        unset($data['category'], $data['unit']);
        $id = $this->op('CREATE_PRODUCT', 'product', $data + [
            'product_type' => 'standard',
            'category_id' => $category ? ($this->categories[$category] ?? null) : null,
            'unit_id' => $this->units[$unit] ?? null,
            'tax_rate_id' => $tax?->id,
            'price_includes_tax' => true,
            'track_inventory' => true,
            'track_batch' => false,
            'track_serial' => false,
            'track_expiry' => false,
            'has_variants' => false,
            'variants' => [],
            'barcodes' => [],
            'attributes' => [],
            'reorder_level' => 5,
            'purchase_price' => $cost ?? round(($data['selling_price'] ?? 0) * 0.7, 2),
            'active' => true,
        ]);
        if ($openingStock > 0) {
            $this->openingStock($id, $openingStock, $cost ?? round(($data['selling_price'] ?? 0) * 0.7, 2));
        }

        return $id;
    }

    public function openingStock(string $productId, float $qty, float $cost, ?string $variantId = null, ?string $batchId = null): void
    {
        $this->op('CREATE_STOCK_ADJUSTMENT', 'stock_adjustment', [
            'store_id' => $this->store->id,
            'type' => 'opening_stock',
            'reason' => 'Opening stock',
            'occurred_at' => now()->subDays(30)->toIso8601String(),
            'items' => [['id' => (string) Str::uuid7(), 'product_id' => $productId, 'variant_id' => $variantId, 'batch_id' => $batchId, 'quantity' => $qty, 'unit_cost' => $cost]],
        ]);
    }

    /** @param array<string, mixed> $extra */
    public function customer(string $name, ?string $phone = null, array $extra = []): string
    {
        return $this->op('CREATE_CUSTOMER', 'customer', $extra + ['name' => $name, 'phone' => $phone, 'credit_limit' => 0, 'opening_balance' => 0, 'state_code' => $this->business->state_code, 'active' => true]);
    }

    /** @param array<string, mixed> $extra */
    public function supplier(string $name, ?string $phone = null, array $extra = []): string
    {
        return $this->op('CREATE_SUPPLIER', 'supplier', $extra + ['name' => $name, 'phone' => $phone, 'credit_days' => 30, 'opening_balance' => 0, 'state_code' => $this->business->state_code, 'active' => true]);
    }

    /**
     * Create an invoice priced with the real engine.
     *
     * @param  list<array<string, mixed>>  $lines  each: product_id, name, quantity, unit_price, tax (rate), inclusive, batch_id, serial_ids, serial_numbers, jewellery
     * @param  list<array<string, mixed>>|null  $payments
     */
    public function sale(array $lines, ?string $customerId = null, ?Carbon $at = null, ?array $payments = null, array $extra = [], string $method = 'cash'): string
    {
        $at ??= now();
        $items = [];
        foreach ($lines as $line) {
            $tax = isset($line['tax']) ? $this->tax((float) $line['tax']) : null;
            $items[] = [
                'id' => (string) Str::uuid7(),
                'product_id' => $line['product_id'],
                'variant_id' => $line['variant_id'] ?? null,
                'batch_id' => $line['batch_id'] ?? null,
                'serial_ids' => $line['serial_ids'] ?? [],
                'serial_numbers' => $line['serial_numbers'] ?? [],
                'name' => $line['name'],
                'quantity' => $line['quantity'],
                'unit_price' => $line['unit_price'],
                'price_includes_tax' => $line['inclusive'] ?? true,
                'discount_type' => $line['discount_type'] ?? null,
                'discount_value' => $line['discount_value'] ?? null,
                'tax_rate_id' => $tax?->id,
                'tax' => $tax?->snapshot(),
                'cost_price' => $line['cost_price'] ?? null,
                'jewellery' => $line['jewellery'] ?? null,
                'hsn_code' => $line['hsn_code'] ?? null,
            ];
        }
        $pricing = PricingEngine::calculate([
            'lines' => array_map(fn ($i) => ['key' => $i['id'], 'quantity' => $i['quantity'], 'unit_price' => $i['unit_price'], 'price_includes_tax' => $i['price_includes_tax'], 'discount_type' => $i['discount_type'], 'discount_value' => $i['discount_value'], 'tax' => $i['tax']], $items),
            'supply_type' => 'intra',
            'round_off' => '1.00',
        ]);
        foreach ($items as $i => &$item) {
            $item = $item + array_intersect_key($pricing['lines'][$i], array_flip(['gross', 'line_discount', 'bill_discount', 'taxable', 'taxes', 'tax_total', 'total']));
        }
        unset($item);
        $total = $pricing['grand_total'];
        $payments ??= [['method' => $method, 'amount' => $total]];

        return $this->op('CREATE_SALE', 'sale', $extra + [
            'store_id' => $this->store->id,
            'customer_id' => $customerId,
            'doc_type' => 'invoice',
            'invoice_date' => $at->copy()->setTimezone($this->business->timezone)->toDateString(),
            'occurred_at' => $at->toIso8601String(),
            'supply_type' => 'intra',
            'round_off_mode' => '1.00',
            'items' => $items,
            'payments' => array_map(fn ($p) => $p + ['id' => (string) Str::uuid7(), 'occurred_at' => $at->toIso8601String()], $payments),
            'grand_total' => $total,
        ]);
    }

    /**
     * @param  list<array<string, mixed>>  $items  each: product_id, name, quantity, unit_cost, batch_no, expiry_date, serial_numbers, tax
     */
    public function purchase(string $supplierId, array $items, ?Carbon $at = null, float $paid = 0): string
    {
        $at ??= now();
        $rows = array_map(function ($i) {
            $tax = isset($i['tax']) ? $this->tax((float) $i['tax']) : null;

            return [
                'id' => (string) Str::uuid7(),
                'product_id' => $i['product_id'],
                'variant_id' => $i['variant_id'] ?? null,
                'name' => $i['name'],
                'quantity' => $i['quantity'],
                'unit_cost' => $i['unit_cost'],
                'mrp' => $i['mrp'] ?? null,
                'tax_rate_id' => $tax?->id,
                'tax' => $tax?->snapshot(),
                'price_includes_tax' => false,
                'batch_id' => $i['batch_id'] ?? null,
                'batch_no' => $i['batch_no'] ?? null,
                'expiry_date' => $i['expiry_date'] ?? null,
                'serial_numbers' => $i['serial_numbers'] ?? [],
            ];
        }, $items);

        return $this->op('CREATE_PURCHASE', 'purchase', [
            'store_id' => $this->store->id,
            'supplier_id' => $supplierId,
            'doc_type' => 'invoice',
            'purchase_date' => $at->toDateString(),
            'supply_type' => 'intra',
            'items' => $rows,
            'payments' => $paid > 0 ? [['id' => (string) Str::uuid7(), 'method' => 'bank_transfer', 'amount' => $paid]] : [],
        ]);
    }
}
