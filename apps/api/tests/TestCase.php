<?php

namespace Tests;

use App\Models\Business;
use App\Models\BusinessUser;
use App\Models\Product;
use App\Models\Role;
use App\Models\StockLevel;
use App\Models\Store;
use App\Models\TaxRate;
use App\Models\User;
use App\Services\Business\BusinessService;
use App\Support\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

abstract class TestCase extends BaseTestCase
{
    use RefreshDatabase;

    /**
     * Every request in a test is a fresh request: forget the guard's cached user so a test can
     * act as several users/devices (in production each request is isolated anyway).
     *
     * {@inheritDoc}
     */
    public function call($method, $uri, $parameters = [], $cookies = [], $files = [], $server = [], $content = null)
    {
        $this->app['auth']->forgetGuards();

        return parent::call($method, $uri, $parameters, $cookies, $files, $server, $content);
    }

    /**
     * Create a user who owns a freshly onboarded business.
     *
     * @param  array<string, mixed>  $overrides
     * @return array{0: User, 1: Business, 2: string}
     */
    protected function createOwner(string $type = 'general', array $overrides = []): array
    {
        $user = User::factory()->create(['password' => 'Password123']);
        $business = app(BusinessService::class)->create($user, $overrides + [
            'name' => 'Test Shop',
            'business_type' => $type,
            'tax_system' => 'gst',
            'state_code' => '32',
        ]);
        app(TenantContext::class)->clear();

        return [$user, $business, $user->createToken('test')->plainTextToken];
    }

    /** @return array{0: User, 1: string} */
    protected function addMember(Business $business, string $roleKey): array
    {
        $user = User::factory()->create(['password' => 'Password123']);
        $this->inTenant($business, function () use ($user, $roleKey) {
            BusinessUser::query()->create([
                'user_id' => $user->id,
                'role_id' => Role::query()->where('key', $roleKey)->value('id'),
                'status' => 'active',
            ]);
        });

        return [$user, $user->createToken('test')->plainTextToken];
    }

    /** @return array<string, string> */
    /** @var array<string, string> device id → device secret issued at registration */
    protected array $deviceSecrets = [];

    protected function headers(string $token, Business $business, ?string $deviceId = null): array
    {
        return array_filter([
            'Authorization' => 'Bearer '.$token,
            'X-Business-Id' => $business->id,
            'X-Device-Id' => $deviceId,
            'X-Device-Secret' => $deviceId ? ($this->deviceSecrets[$deviceId] ?? null) : null,
            'Accept' => 'application/json',
        ]);
    }

    protected function registerDevice(string $token, Business $business, ?string $storeId = null, string $name = 'Counter'): string
    {
        $deviceId = (string) Str::uuid();
        $response = $this->postJson('/api/v1/devices/register', array_filter([
            'device_id' => $deviceId,
            'name' => $name,
            'store_id' => $storeId,
        ]), $this->headers($token, $business))->assertOk();
        $this->deviceSecrets[$deviceId] = (string) $response->json('data.device_secret');

        return $deviceId;
    }

    /** @param list<array<string, mixed>> $operations */
    protected function push(string $token, Business $business, string $deviceId, array $operations): TestResponse
    {
        return $this->postJson('/api/v1/sync/push', ['device_id' => $deviceId, 'operations' => $operations], $this->headers($token, $business, $deviceId));
    }

    protected function pull(string $token, Business $business, string $deviceId, ?int $cursor = null, int $limit = 500): TestResponse
    {
        return $this->postJson('/api/v1/sync/pull', ['device_id' => $deviceId, 'cursor' => $cursor, 'limit' => $limit], $this->headers($token, $business, $deviceId));
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    protected function op(string $operation, string $entityType, string $entityId, array $payload, string $userId, ?int $baseVersion = null, ?string $operationId = null): array
    {
        return [
            'operation_id' => $operationId ?? (string) Str::uuid(),
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'operation' => $operation,
            'payload' => $payload,
            'base_version' => $baseVersion,
            'created_at' => now()->toIso8601String(),
            'user_id' => $userId,
        ];
    }

    /**
     * @template T
     *
     * @param  callable(): T  $callback
     * @return T
     */
    protected function inTenant(Business $business, callable $callback): mixed
    {
        $tenant = app(TenantContext::class);
        $tenant->setBusiness($business);
        try {
            return $callback();
        } finally {
            $tenant->clear();
        }
    }

    protected function defaultStore(Business $business): Store
    {
        return $this->inTenant($business, fn () => Store::query()->where('is_default', true)->firstOrFail());
    }

    protected function gstRate(Business $business, float $rate): TaxRate
    {
        return $this->inTenant($business, fn () => TaxRate::query()->where('rate', $rate)->firstOrFail());
    }

    /** @param array<string, mixed> $overrides @return array<string, mixed> */
    protected function productPayload(array $overrides = []): array
    {
        return $overrides + [
            'name' => 'Test Product',
            'product_type' => 'standard',
            'sku' => 'SKU-'.Str::random(6),
            'barcode' => (string) random_int(10000000, 99999999),
            'barcodes' => [],
            'selling_price' => 100,
            'purchase_price' => 60,
            'mrp' => 120,
            'price_includes_tax' => true,
            'track_inventory' => true,
            'track_batch' => false,
            'track_serial' => false,
            'track_expiry' => false,
            'has_variants' => false,
            'variants' => [],
            'attributes' => [],
            'reorder_level' => 5,
            'active' => true,
        ];
    }

    /** Create a product with opening stock through sync, returns product id. */
    protected function createStockedProduct(string $token, Business $business, string $deviceId, string $userId, float $stock, array $overrides = []): string
    {
        $productId = (string) Str::uuid();
        $store = $this->defaultStore($business);
        $this->push($token, $business, $deviceId, [
            // Same GST 18% rate the sale helper bills, so the server's tax verification agrees.
            $this->op('CREATE_PRODUCT', 'product', $productId, $this->productPayload($overrides + ['tax_rate_id' => $this->gstRate($business, 18)->id]), $userId),
            $this->op('CREATE_STOCK_ADJUSTMENT', 'stock_adjustment', (string) Str::uuid(), [
                'store_id' => $store->id,
                'type' => 'opening_stock',
                'occurred_at' => now()->toIso8601String(),
                'items' => [['id' => (string) Str::uuid(), 'product_id' => $productId, 'quantity' => $stock, 'unit_cost' => 60]],
            ], $userId),
        ])->assertOk()->assertJsonCount(2, 'accepted');

        return $productId;
    }

    /**
     * A simple sale payload (tax-inclusive GST 18%) for one product.
     *
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    protected function salePayload(Business $business, string $productId, float $qty, float $price = 100, array $overrides = []): array
    {
        $store = $this->defaultStore($business);
        $tax = $this->gstRate($business, 18);
        $total = round($qty * $price, 2);

        return array_replace_recursive([
            'store_id' => $store->id,
            'doc_type' => 'invoice',
            'invoice_date' => now('Asia/Kolkata')->toDateString(),
            'occurred_at' => now()->toIso8601String(),
            'supply_type' => 'intra',
            'round_off_mode' => 'none',
            'items' => [[
                'id' => (string) Str::uuid(),
                'product_id' => $productId,
                'name' => 'Test Product',
                'quantity' => $qty,
                'unit_price' => $price,
                'price_includes_tax' => true,
                'tax_rate_id' => $tax->id,
                'tax' => $tax->snapshot(),
                'movement_id' => (string) Str::uuid(),
            ]],
            'payments' => [[
                'id' => (string) Str::uuid(),
                'method' => 'cash',
                'amount' => $total,
                'tendered' => $total,
                'change' => 0,
            ]],
            'grand_total' => $total,
        ], $overrides);
    }

    protected function stockOf(Business $business, string $productId): float
    {
        return $this->inTenant($business, fn () => (float) StockLevel::query()->where('product_id', $productId)->sum('qty'));
    }

    protected function product(Business $business, string $id): Product
    {
        return $this->inTenant($business, fn () => Product::query()->findOrFail($id));
    }
}
