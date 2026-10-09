<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\SyncConflict;
use Illuminate\Support\Str;
use Tests\TestCase;

class ConflictAndPullTest extends TestCase
{
    public function test_concurrent_edits_of_the_same_field_raise_a_conflict(): void
    {
        [$owner, $business, $token] = $this->createOwner('mobile');
        $deviceA = $this->registerDevice($token, $business);
        $deviceB = $this->registerDevice($token, $business);
        $productId = (string) Str::uuid();
        $this->push($token, $business, $deviceA, [
            $this->op('CREATE_PRODUCT', 'product', $productId, $this->productPayload(['name' => 'Samsung Galaxy A55', 'selling_price' => 30999, 'mrp' => 35999]), $owner->id),
        ])->assertJsonCount(1, 'accepted');

        // Device A changes the price first (based on version 1).
        $this->push($token, $business, $deviceA, [
            $this->op('UPDATE_PRODUCT', 'product', $productId, ['changes' => ['selling_price' => 32499], 'base' => ['selling_price' => 30999]], $owner->id, 1),
        ])->assertJsonCount(1, 'accepted');

        // Device B edited offline from version 1: different price + an unrelated field.
        $response = $this->push($token, $business, $deviceB, [
            $this->op('UPDATE_PRODUCT', 'product', $productId, [
                'changes' => ['selling_price' => 31999, 'hsn_code' => '8517'],
                'base' => ['selling_price' => 30999, 'hsn_code' => null],
            ], $owner->id, 1),
        ])->assertOk();

        $response->assertJsonCount(0, 'accepted')->assertJsonCount(1, 'conflicts');
        $conflict = $response->json('conflicts.0');
        $this->assertSame('field', $conflict['conflict_type']);
        $this->assertSame('selling_price', $conflict['fields'][0]['field']);
        $this->assertEquals(31999, $conflict['fields'][0]['local']);
        $this->assertEquals(32499, $conflict['fields'][0]['server']);

        $product = $this->inTenant($business, fn () => Product::query()->find($productId));
        $this->assertSame(32499.0, $product->selling_price, 'Server value is kept until a user resolves the conflict');
        $this->assertSame('8517', $product->hsn_code, 'Non-conflicting fields are merged');
        $this->assertSame(1, $this->inTenant($business, fn () => SyncConflict::query()->where('status', 'open')->count()));

        // "Keep local" from the Conflict Center: forced update + resolution.
        $this->push($token, $business, $deviceB, [
            $this->op('UPDATE_PRODUCT', 'product', $productId, ['changes' => ['selling_price' => 31999], 'base' => ['selling_price' => 32499], 'force' => true], $owner->id, $product->version),
            $this->op('RESOLVE_CONFLICT', 'sync_conflict', $conflict['conflict_id'], ['resolution' => 'keep_local'], $owner->id),
        ])->assertJsonCount(2, 'accepted');
        $this->assertSame(31999.0, $this->product($business, $productId)->selling_price);
        $this->assertSame(0, $this->inTenant($business, fn () => SyncConflict::query()->where('status', 'open')->count()));
    }

    public function test_edits_of_different_fields_merge_without_conflict(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $device = $this->registerDevice($token, $business);
        $customerId = (string) Str::uuid();
        $this->push($token, $business, $device, [
            $this->op('CREATE_CUSTOMER', 'customer', $customerId, ['name' => 'Meera', 'phone' => '9847000001', 'active' => true], $owner->id),
            $this->op('UPDATE_CUSTOMER', 'customer', $customerId, ['changes' => ['phone' => '9847000002'], 'base' => ['phone' => '9847000001']], $owner->id, 1),
            $this->op('UPDATE_CUSTOMER', 'customer', $customerId, ['changes' => ['email' => 'meera@example.com'], 'base' => ['email' => null]], $owner->id, 1),
        ])->assertJsonCount(3, 'accepted')->assertJsonCount(0, 'conflicts');
    }

    public function test_initial_and_incremental_pull_with_cursor(): void
    {
        [$owner, $business, $token] = $this->createOwner('supermarket');
        $device = $this->registerDevice($token, $business);

        $initial = $this->pull($token, $business, $device)->assertOk();
        $types = array_unique(array_column($initial->json('changes'), 'entity_type'));
        foreach (['business', 'store', 'role', 'user', 'setting', 'unit', 'tax_rate', 'category', 'device'] as $type) {
            $this->assertContains($type, $types, "Initial sync should contain {$type}");
        }
        $cursor = $initial->json('cursor');
        $this->assertGreaterThan(0, $cursor);

        // Nothing new: empty incremental pull.
        $this->pull($token, $business, $device, $cursor)->assertJsonCount(0, 'changes')->assertJsonPath('has_more', false);

        $this->push($token, $business, $device, [
            $this->op('CREATE_CUSTOMER', 'customer', (string) Str::uuid(), ['name' => 'New', 'active' => true], $owner->id),
        ]);
        $next = $this->pull($token, $business, $device, $cursor)->assertOk();
        $this->assertSame(['customer'], array_values(array_unique(array_column($next->json('changes'), 'entity_type'))));
    }

    public function test_pull_paginates_with_has_more(): void
    {
        [, $business, $token] = $this->createOwner('supermarket');
        $device = $this->registerDevice($token, $business);

        $cursor = null;
        $pages = 0;
        $seen = [];
        do {
            $page = $this->pull($token, $business, $device, $cursor, 5)->assertOk();
            foreach ($page->json('changes') as $change) {
                $seen[$change['entity_type'].':'.$change['entity_id']] = true;
            }
            $cursor = $page->json('cursor');
            $pages++;
        } while ($page->json('has_more') && $pages < 100);

        $this->assertGreaterThan(1, $pages);
        $full = $this->pull($token, $business, $device)->json('changes');
        $this->assertCount(count($full), $seen, 'Paged pulls see exactly the same entities as one big pull');
    }

    public function test_store_scoped_entities_only_go_to_devices_of_that_store(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $storeB = $this->postJson('/api/v1/stores', ['name' => 'Branch', 'code' => 'BR2'], $this->headers($token, $business))->assertCreated()->json('data.id');
        $mainDevice = $this->registerDevice($token, $business);
        $branchDevice = $this->registerDevice($token, $business, $storeB);
        $productId = $this->createStockedProduct($token, $business, $mainDevice, $owner->id, 10);

        $cursor = $this->pull($token, $business, $branchDevice)->json('cursor');
        $this->push($token, $business, $mainDevice, [
            $this->op('CREATE_SALE', 'sale', (string) Str::uuid(), $this->salePayload($business, $productId, 1), $owner->id),
        ])->assertJsonCount(1, 'accepted');

        $branchTypes = array_column($this->pull($token, $business, $branchDevice, $cursor)->json('changes'), 'entity_type');
        $this->assertNotContains('sale', $branchTypes);
        $this->assertNotContains('stock_level', $branchTypes);

        $mainTypes = array_column($this->pull($token, $business, $mainDevice, $cursor)->json('changes'), 'entity_type');
        $this->assertContains('sale', $mainTypes);
        $this->assertContains('stock_level', $mainTypes);
    }
}
