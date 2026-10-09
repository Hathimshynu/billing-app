<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Multi-tenancy: businesses, their stores, members, roles/permissions (RBAC) and devices.
 * Every business-owned table elsewhere carries business_id and is isolated by a global scope.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('businesses', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('owner_id')->constrained('users');
            $table->string('name', 150);
            $table->string('legal_name', 200)->nullable();
            $table->string('business_type', 30);
            $table->json('modules')->nullable();
            $table->char('country', 2)->default('IN');
            $table->char('currency', 3)->default('INR');
            $table->unsignedTinyInteger('currency_decimals')->default(2);
            $table->string('locale', 10)->default('en-IN');
            $table->string('timezone', 64)->default('Asia/Kolkata');
            $table->string('date_format', 12)->default('DD/MM/YYYY');
            $table->string('tax_system', 10)->default('gst');
            $table->string('gstin', 15)->nullable();
            $table->string('state_code', 4)->nullable();
            $table->unsignedTinyInteger('fy_start_month')->default(4);
            $table->string('phone', 20)->nullable();
            $table->string('email', 190)->nullable();
            $table->string('address', 500)->nullable();
            $table->string('city', 100)->nullable();
            $table->string('pincode', 12)->nullable();
            $table->string('logo_path')->nullable();
            $table->string('status', 20)->default('active');
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->softDeletes();
        });

        Schema::create('business_settings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->string('key', 60);
            $table->json('value');
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->unique(['business_id', 'key']);
        });

        Schema::create('permissions', function (Blueprint $table) {
            $table->id();
            $table->string('key', 80)->unique();
            $table->string('group', 40);
            $table->string('description', 150);
            $table->timestamps();
        });

        Schema::create('roles', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->string('key', 60);
            $table->string('name', 80);
            $table->string('description', 200)->nullable();
            $table->boolean('is_system')->default(false);
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->unique(['business_id', 'key']);
        });

        Schema::create('permission_role', function (Blueprint $table) {
            $table->foreignUuid('role_id')->constrained()->cascadeOnDelete();
            $table->foreignId('permission_id')->constrained()->cascadeOnDelete();
            $table->primary(['role_id', 'permission_id']);
        });

        Schema::create('stores', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->string('name', 120);
            $table->string('code', 10);
            $table->string('address', 500)->nullable();
            $table->string('phone', 20)->nullable();
            $table->string('gstin', 15)->nullable();
            $table->string('state_code', 4)->nullable();
            $table->boolean('is_default')->default(false);
            $table->boolean('active')->default(true);
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->softDeletes();
            $table->unique(['business_id', 'code']);
        });

        Schema::create('business_users', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('role_id')->constrained();
            $table->string('status', 20)->default('active');
            // null = access to all stores
            $table->json('store_ids')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->unique(['business_id', 'user_id']);
        });

        Schema::create('devices', function (Blueprint $table) {
            // The id is generated on the device itself and persisted locally (device_id).
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('store_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('registered_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('name', 100);
            // Short code (C1, C2...) used for per-device invoice series and provisional numbers.
            $table->string('code', 10);
            $table->string('platform', 60)->nullable();
            $table->string('user_agent', 500)->nullable();
            $table->string('status', 20)->default('active');
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamp('last_sync_at')->nullable();
            $table->string('last_ip', 45)->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->unique(['business_id', 'code']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('devices');
        Schema::dropIfExists('business_users');
        Schema::dropIfExists('stores');
        Schema::dropIfExists('permission_role');
        Schema::dropIfExists('roles');
        Schema::dropIfExists('permissions');
        Schema::dropIfExists('business_settings');
        Schema::dropIfExists('businesses');
    }
};
