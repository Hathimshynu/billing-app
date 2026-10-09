<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Business;
use App\Models\Role;
use App\Models\Store;
use App\Models\TaxRate;
use App\Models\Unit;
use App\Models\User;
use Tests\TestCase;

class AuthTest extends TestCase
{
    public function test_user_can_register_and_receives_a_token(): void
    {
        $response = $this->postJson('/api/v1/auth/register', [
            'name' => 'Anitha Menon',
            'email' => 'anitha@example.com',
            'password' => 'Secret123',
            'password_confirmation' => 'Secret123',
        ]);

        $response->assertCreated()
            ->assertJsonPath('success', true)
            ->assertJsonStructure(['data' => ['token', 'user' => ['id', 'name', 'email'], 'businesses']]);
        $this->assertDatabaseHas('users', ['email' => 'anitha@example.com']);
        $this->assertNotSame('Secret123', User::query()->first()->password, 'Password must be hashed');
    }

    public function test_registration_validates_input_with_standard_error_format(): void
    {
        $this->postJson('/api/v1/auth/register', ['email' => 'not-an-email', 'password' => 'short'])
            ->assertStatus(422)
            ->assertJsonPath('success', false)
            ->assertJsonStructure(['success', 'message', 'errors' => ['name', 'email', 'password']]);
    }

    public function test_login_logout_and_me(): void
    {
        [$user] = $this->createOwner();

        $login = $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'Password123'])
            ->assertOk()
            ->assertJsonCount(1, 'data.businesses')
            ->assertJsonPath('data.businesses.0.role_key', 'owner');
        $token = $login->json('data.token');

        $this->getJson('/api/v1/auth/me', ['Authorization' => "Bearer {$token}"])
            ->assertOk()->assertJsonPath('data.user.email', $user->email);

        $this->postJson('/api/v1/auth/logout', [], ['Authorization' => "Bearer {$token}"])->assertOk();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/auth/me', ['Authorization' => "Bearer {$token}"])->assertUnauthorized();
        $this->assertTrue(AuditLog::query()->where('action', 'LOGIN')->where('user_id', $user->id)->exists());
    }

    public function test_wrong_password_is_rejected(): void
    {
        [$user] = $this->createOwner();
        $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'wrong-password'])
            ->assertStatus(422)->assertJsonPath('success', false);
    }

    public function test_login_is_rate_limited(): void
    {
        [$user] = $this->createOwner();
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'nope']);
        }
        $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'nope'])->assertStatus(429);
    }

    public function test_onboarding_creates_business_with_industry_defaults(): void
    {
        $user = User::factory()->create();
        $token = $user->createToken('t')->plainTextToken;

        $response = $this->postJson('/api/v1/businesses', [
            'name' => 'HealthCare Pharmacy',
            'business_type' => 'pharmacy',
            'country' => 'IN',
            'currency' => 'INR',
            'timezone' => 'Asia/Kolkata',
            'tax_system' => 'gst',
            'gstin' => '27AAPFU0939F1ZV',
        ], ['Authorization' => "Bearer {$token}"]);

        $response->assertCreated()->assertJsonPath('data.business.business_type', 'pharmacy');
        $business = Business::query()->firstOrFail();
        $this->assertContains('batches', $business->modules);
        $this->assertSame('27', $business->state_code);

        $this->inTenant($business, function () {
            $this->assertSame(8, Role::query()->count());
            $this->assertTrue(Store::query()->where('is_default', true)->exists());
            $this->assertTrue(Unit::query()->where('code', 'strip')->exists());
            $this->assertTrue(TaxRate::query()->where('rate', 12)->where('kind', 'gst')->exists());
        });
    }

    public function test_onboarding_rejects_invalid_gstin(): void
    {
        $user = User::factory()->create();
        $this->postJson('/api/v1/businesses', [
            'name' => 'Shop', 'business_type' => 'general', 'gstin' => '27AAPFU0939F1ZX',
        ], ['Authorization' => 'Bearer '.$user->createToken('t')->plainTextToken])
            ->assertStatus(422)->assertJsonValidationErrors('gstin');
    }

    public function test_security_headers_are_present(): void
    {
        $this->getJson('/api/v1/health')
            ->assertOk()
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('X-Frame-Options', 'DENY');
    }
}
