<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Inventory follows ledger principles: stock is never overwritten. Every change is an immutable
 * row in inventory_movements and the `inventory` table holds the running quantity per
 * store/product/variant/batch, updated atomically from those movements. This is what makes
 * concurrent offline sales from several devices converge to the correct stock after sync.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('store_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained()->cascadeOnDelete();
            $table->uuid('variant_id')->nullable();
            $table->uuid('batch_id')->nullable();
            // store|product|variant|batch — same composite key format as the client.
            $table->string('stock_key', 160);
            $table->decimal('qty', 15, 3)->default(0);
            $table->decimal('avg_cost', 15, 4)->default(0);
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->unique(['business_id', 'stock_key']);
            $table->index(['business_id', 'store_id', 'product_id']);
        });

        Schema::create('inventory_movements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('store_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained()->cascadeOnDelete();
            $table->uuid('variant_id')->nullable();
            $table->uuid('batch_id')->nullable();
            // PURCHASE, SALE, SALE_RETURN, PURCHASE_RETURN, ADJUSTMENT, TRANSFER_IN, TRANSFER_OUT,
            // DAMAGE, EXPIRED, OPENING_STOCK
            $table->string('type', 20);
            $table->decimal('qty_in', 15, 3)->default(0);
            $table->decimal('qty_out', 15, 3)->default(0);
            $table->decimal('unit_cost', 15, 4)->default(0);
            $table->decimal('balance_after', 15, 3)->nullable();
            $table->string('reference_type', 40)->nullable();
            $table->uuid('reference_id')->nullable();
            $table->string('reference_no', 64)->nullable();
            $table->string('notes', 500)->nullable();
            $table->uuid('created_by')->nullable();
            $table->uuid('device_id')->nullable();
            $table->timestamp('occurred_at');
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->index(['business_id', 'store_id', 'product_id', 'occurred_at'], 'inv_mov_lookup');
            $table->index(['reference_type', 'reference_id']);
            $table->index(['business_id', 'type', 'occurred_at']);
        });

        Schema::create('stock_adjustments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('store_id')->constrained();
            $table->uuid('device_id')->nullable();
            // adjustment | opening_stock | damage | expired
            $table->string('type', 20);
            $table->string('reason', 500)->nullable();
            $table->json('items');
            $table->uuid('created_by')->nullable();
            $table->timestamp('occurred_at');
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->index(['business_id', 'store_id', 'occurred_at']);
        });

        Schema::create('stock_transfers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('from_store_id')->constrained('stores');
            $table->foreignUuid('to_store_id')->constrained('stores');
            $table->string('transfer_number', 40);
            $table->string('status', 20)->default('in_transit');
            $table->json('items');
            $table->string('notes', 500)->nullable();
            $table->uuid('created_by')->nullable();
            $table->uuid('received_by')->nullable();
            $table->timestamp('sent_at');
            $table->timestamp('received_at')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_transfers');
        Schema::dropIfExists('stock_adjustments');
        Schema::dropIfExists('inventory_movements');
        Schema::dropIfExists('inventory');
    }
};
