<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sales documents (invoices, quotations, estimates, proforma, delivery challans), returns
 * (credit notes), invoice numbering and customer receipts.
 *
 * Offline invoice numbering: devices reserve blocks of numbers (invoice_number_blocks) from a
 * sequence (invoice_sequences) while online. Every final number that is issued is recorded in the
 * `invoices` document register so gaps and cancellations are auditable.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('invoice_sequences', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->string('document_type', 30);
            // '' for a business-wide series, the device code for per-device series ({DEVICE} formats).
            $table->string('series_key', 20)->default('');
            $table->string('period', 20);
            $table->string('format', 60);
            $table->unsignedBigInteger('next_number')->default(1);
            $table->timestamps();
            $table->unique(['business_id', 'document_type', 'series_key', 'period'], 'inv_seq_unique');
        });

        Schema::create('invoice_number_blocks', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('sequence_id')->constrained('invoice_sequences')->cascadeOnDelete();
            $table->foreignUuid('device_id')->constrained()->cascadeOnDelete();
            $table->string('document_type', 30);
            $table->string('period', 20);
            $table->string('format', 60);
            $table->unsignedBigInteger('start_number');
            $table->unsignedBigInteger('end_number');
            $table->timestamps();
            $table->index(['device_id', 'document_type', 'period']);
        });

        Schema::create('invoices', function (Blueprint $table) {
            // Document register: one row per issued final number.
            $table->id();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->string('document_type', 30);
            $table->string('number', 64);
            $table->unsignedBigInteger('sequence_number')->nullable();
            $table->string('period', 20)->nullable();
            $table->string('entity_type', 40);
            $table->uuid('entity_id');
            $table->uuid('device_id')->nullable();
            $table->uuid('block_id')->nullable();
            $table->string('provisional_number', 64)->nullable();
            $table->string('status', 20)->default('issued');
            $table->timestamp('issued_at');
            $table->timestamps();
            $table->unique(['business_id', 'document_type', 'number']);
            $table->index(['entity_type', 'entity_id']);
        });

        Schema::create('coupons', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->string('code', 32);
            $table->string('description', 200)->nullable();
            $table->string('discount_type', 10);
            $table->decimal('discount_value', 15, 2);
            $table->decimal('min_amount', 15, 2)->default(0);
            $table->decimal('max_discount', 15, 2)->nullable();
            $table->date('valid_from')->nullable();
            $table->date('valid_to')->nullable();
            $table->unsignedInteger('usage_limit')->nullable();
            $table->unsignedInteger('used_count')->default(0);
            $table->boolean('active')->default(true);
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->softDeletes();
            $table->unique(['business_id', 'code']);
        });

        Schema::create('sales', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('store_id')->constrained();
            $table->uuid('device_id')->nullable()->index();
            $table->uuid('register_id')->nullable()->index();
            $table->foreignUuid('customer_id')->nullable()->constrained()->nullOnDelete();
            $table->string('customer_name', 150)->nullable();
            $table->string('customer_phone', 20)->nullable();
            $table->string('customer_gstin', 15)->nullable();
            // invoice | quotation | estimate | proforma | delivery_challan
            $table->string('doc_type', 20)->default('invoice');
            // completed | cancelled | draft | converted
            $table->string('status', 20)->default('completed');
            $table->string('invoice_number', 64);
            $table->string('number_status', 12)->default('final');
            $table->uuid('number_block_id')->nullable();
            $table->string('provisional_number', 64)->nullable();
            $table->date('invoice_date');
            $table->timestamp('occurred_at');
            $table->date('due_date')->nullable();
            $table->string('supply_type', 20)->default('intra');
            $table->string('place_of_supply', 4)->nullable();
            $table->string('order_type', 20)->default('retail');
            $table->uuid('table_id')->nullable();
            $table->json('kitchen_order_ids')->nullable();
            $table->string('bill_discount_type', 10)->nullable();
            $table->decimal('bill_discount_value', 15, 3)->nullable();
            $table->string('round_off_mode', 6)->default('none');
            $table->decimal('gross_total', 15, 2)->default(0);
            $table->decimal('line_discount_total', 15, 2)->default(0);
            $table->decimal('bill_discount_total', 15, 2)->default(0);
            $table->decimal('discount_total', 15, 2)->default(0);
            $table->decimal('taxable_total', 15, 2)->default(0);
            $table->decimal('tax_total', 15, 2)->default(0);
            $table->json('charges')->nullable();
            $table->decimal('charges_total', 15, 2)->default(0);
            $table->decimal('round_off', 15, 2)->default(0);
            $table->decimal('grand_total', 15, 2)->default(0);
            $table->decimal('paid_total', 15, 2)->default(0);
            $table->decimal('change_due', 15, 2)->default(0);
            $table->decimal('balance_due', 15, 2)->default(0);
            $table->decimal('returned_total', 15, 2)->default(0);
            $table->string('payment_status', 10)->default('paid');
            $table->json('tax_breakup')->nullable();
            $table->string('coupon_code', 32)->nullable();
            $table->integer('loyalty_points_earned')->default(0);
            $table->integer('loyalty_points_redeemed')->default(0);
            $table->uuid('converted_from_id')->nullable();
            $table->uuid('converted_to_id')->nullable();
            $table->date('valid_until')->nullable();
            $table->string('notes', 1000)->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->uuid('cancelled_by')->nullable();
            $table->string('cancel_reason', 500)->nullable();
            $table->json('review_flags')->nullable();
            $table->json('meta')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->unique(['business_id', 'doc_type', 'invoice_number']);
            $table->index(['business_id', 'store_id', 'invoice_date']);
            $table->index(['business_id', 'customer_id']);
            $table->index(['business_id', 'status', 'invoice_date']);
        });

        Schema::create('sale_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('sale_id')->constrained()->cascadeOnDelete();
            $table->uuid('product_id')->nullable()->index();
            $table->uuid('variant_id')->nullable();
            $table->uuid('batch_id')->nullable();
            $table->json('serial_ids')->nullable();
            $table->json('serial_numbers')->nullable();
            $table->string('name', 200);
            $table->string('sku', 64)->nullable();
            $table->string('hsn_code', 10)->nullable();
            $table->string('unit_code', 16)->nullable();
            $table->decimal('quantity', 15, 3);
            $table->decimal('unit_price', 15, 2);
            $table->decimal('mrp', 15, 2)->nullable();
            $table->decimal('cost_price', 15, 4)->default(0);
            $table->boolean('price_includes_tax')->default(true);
            $table->string('discount_type', 10)->nullable();
            $table->decimal('discount_value', 15, 3)->nullable();
            $table->uuid('tax_rate_id')->nullable();
            $table->json('tax')->nullable();
            $table->decimal('gross', 15, 2);
            $table->decimal('line_discount', 15, 2)->default(0);
            $table->decimal('bill_discount', 15, 2)->default(0);
            $table->decimal('taxable', 15, 2);
            $table->json('taxes')->nullable();
            $table->decimal('tax_total', 15, 2)->default(0);
            $table->decimal('total', 15, 2);
            $table->decimal('returned_qty', 15, 3)->default(0);
            $table->json('modifiers')->nullable();
            $table->json('jewellery')->nullable();
            $table->unsignedSmallInteger('warranty_months')->nullable();
            $table->uuid('kitchen_order_id')->nullable();
            $table->string('notes', 500)->nullable();
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();
        });

        Schema::create('sale_payments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('sale_id')->constrained()->cascadeOnDelete();
            $table->string('method', 20);
            $table->decimal('amount', 15, 2);
            $table->string('reference', 100)->nullable();
            $table->decimal('tendered', 15, 2)->nullable();
            $table->decimal('change', 15, 2)->nullable();
            $table->json('meta')->nullable();
            $table->timestamp('occurred_at');
            $table->timestamps();
            $table->index(['business_id', 'method', 'occurred_at']);
        });

        Schema::create('sale_returns', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('store_id')->constrained();
            $table->uuid('device_id')->nullable();
            $table->uuid('register_id')->nullable();
            $table->foreignUuid('sale_id')->constrained();
            $table->foreignUuid('customer_id')->nullable()->constrained()->nullOnDelete();
            $table->string('return_number', 64);
            $table->string('number_status', 12)->default('final');
            $table->string('provisional_number', 64)->nullable();
            $table->date('return_date');
            $table->timestamp('occurred_at');
            $table->decimal('taxable_total', 15, 2)->default(0);
            $table->decimal('tax_total', 15, 2)->default(0);
            $table->decimal('total', 15, 2)->default(0);
            // cash | upi | card | bank_transfer | store_credit | exchange
            $table->string('refund_method', 20);
            $table->string('reason', 500)->nullable();
            $table->uuid('created_by')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->unique(['business_id', 'return_number']);
            $table->index(['business_id', 'store_id', 'return_date']);
        });

        Schema::create('sale_return_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('sale_return_id')->constrained()->cascadeOnDelete();
            $table->uuid('sale_item_id');
            $table->uuid('product_id')->nullable();
            $table->uuid('variant_id')->nullable();
            $table->uuid('batch_id')->nullable();
            $table->json('serial_ids')->nullable();
            $table->string('name', 200);
            $table->decimal('quantity', 15, 3);
            $table->decimal('unit_price', 15, 2);
            $table->decimal('taxable', 15, 2);
            $table->decimal('tax_total', 15, 2);
            $table->decimal('total', 15, 2);
            $table->boolean('restock')->default(true);
            $table->timestamps();
        });

        Schema::create('customer_payments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->uuid('store_id')->nullable();
            $table->uuid('device_id')->nullable();
            $table->uuid('register_id')->nullable();
            $table->foreignUuid('customer_id')->constrained();
            $table->uuid('sale_id')->nullable();
            $table->string('receipt_number', 64);
            $table->decimal('amount', 15, 2);
            $table->string('method', 20);
            $table->string('reference', 100)->nullable();
            $table->date('payment_date');
            $table->string('notes', 500)->nullable();
            $table->uuid('created_by')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->index(['business_id', 'customer_id']);
            $table->index(['business_id', 'payment_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_payments');
        Schema::dropIfExists('sale_return_items');
        Schema::dropIfExists('sale_returns');
        Schema::dropIfExists('sale_payments');
        Schema::dropIfExists('sale_items');
        Schema::dropIfExists('sales');
        Schema::dropIfExists('coupons');
        Schema::dropIfExists('invoices');
        Schema::dropIfExists('invoice_number_blocks');
        Schema::dropIfExists('invoice_sequences');
    }
};
