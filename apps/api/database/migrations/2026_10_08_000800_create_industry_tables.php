<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Industry modules: restaurant (tables, KOT) and jewellery (metal rates, repair/custom orders,
 * old gold purchases & exchanges). Pharmacy (batches/expiry) and mobile (IMEI/warranty) use the
 * catalogue tables product_batches and product_serials.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('restaurant_tables', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('store_id')->constrained();
            $table->string('name', 40);
            $table->string('area', 40)->nullable();
            $table->unsignedSmallInteger('capacity')->default(4);
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('active')->default(true);
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->softDeletes();
        });

        Schema::create('kitchen_orders', function (Blueprint $table) {
            // KOTs are append-only: adding items to a running table creates a new KOT, so waiters
            // on different devices never conflict. Status changes are last-writer-wins.
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('store_id')->constrained();
            $table->uuid('device_id')->nullable();
            $table->uuid('table_id')->nullable()->index();
            $table->string('order_type', 20)->default('dine_in');
            $table->string('kot_number', 40);
            $table->json('items');
            $table->string('status', 20)->default('pending');
            $table->boolean('is_void')->default(false);
            $table->unsignedSmallInteger('guests')->nullable();
            $table->string('notes', 500)->nullable();
            $table->uuid('sale_id')->nullable()->index();
            $table->uuid('created_by')->nullable();
            $table->timestamp('occurred_at');
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->index(['business_id', 'store_id', 'status']);
        });

        Schema::create('metal_rates', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->string('metal', 20);
            $table->string('purity', 16);
            $table->decimal('rate_per_gram', 15, 2);
            $table->timestamp('effective_from');
            $table->uuid('created_by')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->index(['business_id', 'metal', 'purity', 'effective_from']);
        });

        Schema::create('jewellery_orders', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('store_id')->constrained();
            $table->string('order_number', 64);
            $table->string('type', 10);
            $table->foreignUuid('customer_id')->nullable()->constrained()->nullOnDelete();
            $table->string('customer_name', 150);
            $table->string('customer_phone', 20)->nullable();
            $table->string('description', 1000);
            $table->string('metal', 20)->nullable();
            $table->string('purity', 16)->nullable();
            $table->decimal('weight', 12, 3)->nullable();
            $table->decimal('estimated_amount', 15, 2)->default(0);
            $table->decimal('advance_paid', 15, 2)->default(0);
            $table->string('advance_method', 20)->nullable();
            $table->date('due_date')->nullable();
            $table->string('status', 20)->default('received');
            $table->timestamp('delivered_at')->nullable();
            $table->uuid('sale_id')->nullable();
            $table->string('notes', 1000)->nullable();
            $table->uuid('created_by')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->index(['business_id', 'status']);
        });

        Schema::create('old_gold_purchases', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->uuid('store_id')->nullable();
            $table->uuid('sale_id')->nullable()->index();
            $table->uuid('customer_id')->nullable();
            $table->string('description', 300)->nullable();
            $table->string('metal', 20);
            $table->string('purity', 16);
            $table->decimal('gross_weight', 12, 3);
            $table->decimal('stone_weight', 12, 3)->default(0);
            $table->decimal('net_weight', 12, 3);
            $table->decimal('deduction_percent', 8, 3)->default(0);
            $table->decimal('effective_weight', 12, 3);
            $table->decimal('rate_per_gram', 15, 2);
            $table->decimal('value', 15, 2);
            $table->timestamp('occurred_at');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('old_gold_purchases');
        Schema::dropIfExists('jewellery_orders');
        Schema::dropIfExists('metal_rates');
        Schema::dropIfExists('kitchen_orders');
        Schema::dropIfExists('restaurant_tables');
    }
};
