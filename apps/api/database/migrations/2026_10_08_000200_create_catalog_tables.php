<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Product catalogue. Industry specific fields (pharmacy, jewellery, mobile, clothing...) are kept
 * in the `attributes` JSON column instead of dozens of sparse columns; batches, serials/IMEIs and
 * variants get proper tables because they carry their own stock.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('categories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->uuid('parent_id')->nullable()->index();
            $table->string('name', 120);
            $table->string('color', 20)->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('active')->default(true);
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->softDeletes();
            $table->index(['business_id', 'name']);
        });

        Schema::create('brands', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->string('name', 120);
            $table->boolean('active')->default(true);
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->softDeletes();
            $table->index(['business_id', 'name']);
        });

        Schema::create('units', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->string('code', 16);
            $table->string('name', 60);
            $table->boolean('allow_decimal')->default(false);
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->softDeletes();
            $table->index(['business_id', 'code']);
        });

        Schema::create('tax_rates', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->string('name', 80);
            // gst | vat | simple | custom | exempt — components resolved by supply type at billing.
            $table->string('kind', 12);
            $table->decimal('rate', 8, 3)->default(0);
            $table->decimal('cess_rate', 8, 3)->default(0);
            $table->json('components')->nullable();
            $table->boolean('is_default')->default(false);
            $table->boolean('active')->default(true);
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->softDeletes();
        });

        Schema::create('products', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('category_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('brand_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('unit_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('tax_rate_id')->nullable()->constrained()->nullOnDelete();
            $table->string('name', 200);
            $table->string('product_type', 20)->default('standard');
            $table->string('sku', 64)->nullable();
            $table->string('barcode', 64)->nullable();
            $table->string('plu_code', 16)->nullable();
            $table->text('description')->nullable();
            $table->string('hsn_code', 10)->nullable();
            $table->decimal('purchase_price', 15, 2)->default(0);
            $table->decimal('selling_price', 15, 2)->default(0);
            $table->decimal('mrp', 15, 2)->nullable();
            $table->decimal('min_selling_price', 15, 2)->nullable();
            $table->boolean('price_includes_tax')->default(true);
            $table->decimal('reorder_level', 15, 3)->default(0);
            $table->boolean('track_inventory')->default(true);
            $table->boolean('track_batch')->default(false);
            $table->boolean('track_serial')->default(false);
            $table->boolean('track_expiry')->default(false);
            $table->boolean('has_variants')->default(false);
            $table->json('variant_attributes')->nullable();
            $table->json('attributes')->nullable();
            $table->json('custom_fields')->nullable();
            $table->json('modifiers')->nullable();
            $table->unsignedSmallInteger('warranty_months')->nullable();
            $table->string('image_path')->nullable();
            $table->boolean('active')->default(true);
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->softDeletes();
            $table->index(['business_id', 'sku']);
            $table->index(['business_id', 'barcode']);
            $table->index(['business_id', 'plu_code']);
            $table->index(['business_id', 'name']);
        });

        Schema::create('product_variants', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained()->cascadeOnDelete();
            $table->string('name', 120);
            $table->string('sku', 64)->nullable();
            $table->string('barcode', 64)->nullable();
            $table->json('attributes')->nullable();
            $table->decimal('purchase_price', 15, 2)->nullable();
            $table->decimal('selling_price', 15, 2)->nullable();
            $table->decimal('mrp', 15, 2)->nullable();
            $table->boolean('active')->default(true);
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
            $table->softDeletes();
            $table->index(['business_id', 'barcode']);
            $table->index(['business_id', 'sku']);
        });

        Schema::create('product_barcodes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained()->cascadeOnDelete();
            $table->uuid('variant_id')->nullable();
            $table->string('barcode', 64);
            $table->timestamps();
            $table->index(['business_id', 'barcode']);
        });

        Schema::create('product_prices', function (Blueprint $table) {
            // Quantity based price tiers / wholesale price lists.
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained()->cascadeOnDelete();
            $table->uuid('variant_id')->nullable();
            $table->string('price_list', 30)->default('tier');
            $table->decimal('min_qty', 15, 3)->default(1);
            $table->decimal('price', 15, 2);
            $table->timestamps();
            $table->index(['product_id', 'min_qty']);
        });

        Schema::create('product_batches', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained()->cascadeOnDelete();
            $table->uuid('variant_id')->nullable();
            $table->string('batch_no', 64);
            $table->date('expiry_date')->nullable();
            $table->date('mfg_date')->nullable();
            $table->decimal('mrp', 15, 2)->nullable();
            $table->decimal('purchase_price', 15, 2)->nullable();
            $table->decimal('selling_price', 15, 2)->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->softDeletes();
            $table->index(['business_id', 'product_id', 'batch_no']);
            $table->index(['business_id', 'expiry_date']);
        });

        Schema::create('product_serials', function (Blueprint $table) {
            // Serial numbers / IMEIs. One row per physical unit.
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained()->cascadeOnDelete();
            $table->uuid('variant_id')->nullable();
            $table->foreignUuid('store_id')->constrained();
            $table->string('serial_no', 64);
            $table->string('imei1', 20)->nullable();
            $table->string('imei2', 20)->nullable();
            $table->string('status', 20)->default('in_stock');
            $table->decimal('cost_price', 15, 2)->nullable();
            $table->uuid('purchase_id')->nullable()->index();
            $table->uuid('sale_id')->nullable()->index();
            $table->uuid('sale_item_id')->nullable();
            $table->uuid('customer_id')->nullable()->index();
            $table->unsignedSmallInteger('warranty_months')->nullable();
            $table->timestamp('sold_at')->nullable();
            $table->date('warranty_expires_at')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->unique(['business_id', 'serial_no']);
            $table->index(['business_id', 'imei1']);
            $table->index(['business_id', 'imei2']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_serials');
        Schema::dropIfExists('product_batches');
        Schema::dropIfExists('product_prices');
        Schema::dropIfExists('product_barcodes');
        Schema::dropIfExists('product_variants');
        Schema::dropIfExists('products');
        Schema::dropIfExists('tax_rates');
        Schema::dropIfExists('units');
        Schema::dropIfExists('brands');
        Schema::dropIfExists('categories');
    }
};
