<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\Product;
use Illuminate\Support\Str;
use Tests\TestCase;

class TenancyAndRbacTest extends TestCase
{
    public function test_a_user_cannot_access_another_business(): void
    {
        [, $businessA, $tokenA] = $this->createOwner('general', ['name' => 'Shop A']);
        [, $businessB] = $this->createOwner('general', ['name' => 'Shop B']);

        $this->getJson('/api/v1/business', $this->headers($tokenA, $businessB))
            ->assertForbidden()->assertJsonPath('success', false);
        $this->getJson('/api/v1/business', $this->headers($tokenA, $businessA))
            ->assertOk()->assertJsonPath('data.name', 'Shop A');
    }

    public function test_tenant_data_is_isolated_in_rest_and_sync(): void
    {
        [$ownerA, $businessA, $tokenA] = $this->createOwner('general', ['name' => 'Shop A']);
        [$ownerB, $businessB, $tokenB] = $this->createOwner('general', ['name' => 'Shop B']);
        $deviceA = $this->registerDevice($tokenA, $businessA);
        $deviceB = $this->registerDevice($tokenB, $businessB);

        $secret = (string) Str::uuid();
        $this->push($tokenB, $businessB, $deviceB, [
            $this->op('CREATE_CUSTOMER', 'customer', $secret, ['name' => 'Private Customer B', 'credit_limit' => 0, 'opening_balance' => 0, 'active' => true], $ownerB->id),
        ])->assertJsonCount(1, 'accepted');

        // REST: B's customer is invisible to A.
        $this->getJson("/api/v1/customers/{$secret}", $this->headers($tokenA, $businessA))->assertNotFound();
        $this->getJson('/api/v1/customers', $this->headers($tokenA, $businessA))->assertOk()->assertJsonCount(0, 'data');

        // Sync: A's pull never contains B's entities.
        $changes = $this->pull($tokenA, $businessA, $deviceA)->assertOk()->json('changes');
        $this->assertNotContains($secret, array_column($changes, 'entity_id'));
        foreach ($changes as $change) {
            if (isset($change['data']['business_id'])) {
                $this->assertSame($businessA->id, $change['data']['business_id']);
            }
        }

        // A cannot modify B's customer by guessing its id.
        $response = $this->push($tokenA, $businessA, $deviceA, [
            $this->op('UPDATE_CUSTOMER', 'customer', $secret, ['changes' => ['name' => 'Hacked'], 'base' => []], $ownerA->id),
        ]);
        $this->assertSame('dependency_missing', $response->json('rejected.0.code'));
        $this->assertSame('Private Customer B', $this->inTenant($businessB, fn () => Customer::query()->find($secret)->name));
    }

    public function test_forging_another_members_user_id_does_not_escalate_privileges(): void
    {
        [$owner, $business, $ownerToken] = $this->createOwner();
        [$cashier, $cashierToken] = $this->addMember($business, 'cashier');
        $device = $this->registerDevice($cashierToken, $business);

        // A cashier device claims the owner performed a catalogue change the cashier may not make.
        $forged = (string) Str::uuid();
        $response = $this->push($cashierToken, $business, $device, [
            $this->op('CREATE_CATEGORY', 'category', $forged, ['name' => 'Forged', 'sort_order' => 0, 'active' => true], $owner->id),
        ]);
        $response->assertOk()->assertJsonCount(0, 'accepted');
        $this->assertSame('forbidden', $response->json('rejected.0.code'));

        // Work the cashier is allowed to do is still accepted, and a shared till keeps working:
        // the owner signing in later pushes the cashier's offline operation under the cashier's rights.
        $customer = (string) Str::uuid();
        $ownerDevice = $this->registerDevice($ownerToken, $business);
        $this->push($ownerToken, $business, $ownerDevice, [
            $this->op('CREATE_CUSTOMER', 'customer', $customer, ['name' => 'Walk-in Ravi', 'credit_limit' => 0, 'opening_balance' => 0, 'active' => true], $cashier->id),
        ])->assertJsonCount(1, 'accepted');
    }

    public function test_a_device_of_another_business_cannot_sync(): void
    {
        [, $businessA, $tokenA] = $this->createOwner();
        [, $businessB, $tokenB] = $this->createOwner();
        $deviceB = $this->registerDevice($tokenB, $businessB);

        $this->pull($tokenA, $businessA, $deviceB)->assertStatus(409);
    }

    public function test_cashier_permissions_are_enforced_on_rest_and_sync(): void
    {
        [, $business] = $this->createOwner();
        [$cashier, $cashierToken] = $this->addMember($business, 'cashier');
        $device = $this->registerDevice($cashierToken, $business);

        $this->postJson('/api/v1/products', $this->productPayload(), $this->headers($cashierToken, $business))
            ->assertForbidden();

        $response = $this->push($cashierToken, $business, $device, [
            $this->op('CREATE_PRODUCT', 'product', (string) Str::uuid(), $this->productPayload(), $cashier->id),
        ])->assertOk();
        $this->assertSame('forbidden', $response->json('rejected.0.code'));
        $this->assertFalse($response->json('rejected.0.retryable'));
        $this->assertSame(0, $this->inTenant($business, fn () => Product::query()->count()));

        // Cashiers may create customers and sell.
        $this->push($cashierToken, $business, $device, [
            $this->op('CREATE_CUSTOMER', 'customer', (string) Str::uuid(), ['name' => 'Walk-in Regular', 'credit_limit' => 0, 'opening_balance' => 0, 'active' => true], $cashier->id),
        ])->assertJsonCount(1, 'accepted');
    }

    public function test_operations_are_authorized_as_the_user_who_performed_them(): void
    {
        [$owner, $business, $ownerToken] = $this->createOwner();
        [$cashier] = $this->addMember($business, 'cashier');
        $device = $this->registerDevice($ownerToken, $business);

        // Owner's session pushes an op performed by the cashier on a shared counter: cashier rules apply.
        $response = $this->push($ownerToken, $business, $device, [
            $this->op('CREATE_PRODUCT', 'product', (string) Str::uuid(), $this->productPayload(), $cashier->id),
        ]);
        $this->assertSame('forbidden', $response->json('rejected.0.code'));

        // A user who is not a member at all is rejected.
        $response = $this->push($ownerToken, $business, $device, [
            $this->op('CREATE_CUSTOMER', 'customer', (string) Str::uuid(), ['name' => 'X', 'active' => true], (string) Str::uuid()),
        ]);
        $this->assertSame('unknown_user', $response->json('rejected.0.code'));
        $this->assertNotNull($owner);
    }

    public function test_revoked_device_cannot_sync(): void
    {
        [, $business, $token] = $this->createOwner();
        $device = $this->registerDevice($token, $business);
        $this->postJson("/api/v1/devices/{$device}/revoke", [], $this->headers($token, $business))->assertOk();
        $this->pull($token, $business, $device)->assertForbidden()->assertJsonPath('code', 'device_revoked');
    }

    public function test_disabled_member_loses_access(): void
    {
        [, $business, $ownerToken] = $this->createOwner();
        [$cashier, $cashierToken] = $this->addMember($business, 'cashier');
        $this->putJson("/api/v1/members/{$cashier->id}", ['status' => 'disabled'], $this->headers($ownerToken, $business))->assertOk();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/business', $this->headers($cashierToken, $business))->assertUnauthorized();
    }
}
