<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Purchasing: purchase orders and purchase invoices (doc_type order|invoice) with partial
 * receiving, batches/expiry/serials per line, purchase payments, returns (debit notes) and
 * standalone supplier payments.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('purchases', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('store_id')->constrained();
            $table->uuid('device_id')->nullable();
            $table->foreignUuid('supplier_id')->constrained();
            $table->string('supplier_name', 150)->nullable();
            $table->string('doc_type', 10)->default('invoice');
            // ordered | partially_received | received | cancelled
            $table->string('status', 20)->default('received');
            $table->string('purchase_number', 64);
            $table->string('number_status', 12)->default('final');
            $table->string('provisional_number', 64)->nullable();
            $table->string('supplier_invoice_no', 64)->nullable();
            $table->date('purchase_date');
            $table->date('expected_date')->nullable();
            $table->string('supply_type', 20)->default('intra');
            $table->string('bill_discount_type', 10)->nullable();
            $table->decimal('bill_discount_value', 15, 3)->nullable();
            $table->decimal('gross_total', 15, 2)->default(0);
            $table->decimal('discount_total', 15, 2)->default(0);
            $table->decimal('taxable_total', 15, 2)->default(0);
            $table->decimal('tax_total', 15, 2)->default(0);
            $table->json('charges')->nullable();
            $table->decimal('charges_total', 15, 2)->default(0);
            $table->decimal('round_off', 15, 2)->default(0);
            $table->decimal('grand_total', 15, 2)->default(0);
            $table->decimal('paid_total', 15, 2)->default(0);
            $table->decimal('balance_due', 15, 2)->default(0);
            $table->decimal('returned_total', 15, 2)->default(0);
            $table->string('payment_status', 10)->default('unpaid');
            $table->string('notes', 1000)->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestamp('received_at')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->unique(['business_id', 'doc_type', 'purchase_number']);
            $table->index(['business_id', 'supplier_id']);
            $table->index(['business_id', 'store_id', 'purchase_date']);
        });

        Schema::create('purchase_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('purchase_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained();
            $table->uuid('variant_id')->nullable();
            $table->string('name', 200);
            $table->decimal('quantity', 15, 3);
            $table->decimal('received_qty', 15, 3)->default(0);
            $table->decimal('returned_qty', 15, 3)->default(0);
            $table->decimal('unit_cost', 15, 2);
            $table->decimal('mrp', 15, 2)->nullable();
            $table->decimal('selling_price', 15, 2)->nullable();
            $table->string('discount_type', 10)->nullable();
            $table->decimal('discount_value', 15, 3)->nullable();
            $table->uuid('tax_rate_id')->nullable();
            $table->json('tax')->nullable();
            $table->boolean('price_includes_tax')->default(false);
            $table->uuid('batch_id')->nullable();
            $table->string('batch_no', 64)->nullable();
            $table->date('expiry_date')->nullable();
            $table->date('mfg_date')->nullable();
            $table->json('serial_numbers')->nullable();
            $table->decimal('taxable', 15, 2)->default(0);
            $table->decimal('tax_total', 15, 2)->default(0);
            $table->decimal('total', 15, 2)->default(0);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();
        });

        Schema::create('purchase_payments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('purchase_id')->constrained()->cascadeOnDelete();
            $table->string('method', 20);
            $table->decimal('amount', 15, 2);
            $table->string('reference', 100)->nullable();
            $table->timestamp('occurred_at');
            $table->timestamps();
        });

        Schema::create('purchase_returns', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('store_id')->constrained();
            $table->uuid('device_id')->nullable();
            $table->foreignUuid('purchase_id')->constrained();
            $table->foreignUuid('supplier_id')->constrained();
            $table->string('return_number', 64);
            $table->string('number_status', 12)->default('final');
            $table->string('provisional_number', 64)->nullable();
            $table->date('return_date');
            $table->timestamp('occurred_at');
            $table->decimal('taxable_total', 15, 2)->default(0);
            $table->decimal('tax_total', 15, 2)->default(0);
            $table->decimal('total', 15, 2)->default(0);
            $table->string('reason', 500)->nullable();
            $table->uuid('created_by')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->unique(['business_id', 'return_number']);
        });

        Schema::create('purchase_return_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('purchase_return_id')->constrained()->cascadeOnDelete();
            $table->uuid('purchase_item_id');
            $table->uuid('product_id');
            $table->uuid('variant_id')->nullable();
            $table->uuid('batch_id')->nullable();
            $table->string('name', 200);
            $table->decimal('quantity', 15, 3);
            $table->decimal('unit_cost', 15, 2);
            $table->decimal('taxable', 15, 2);
            $table->decimal('tax_total', 15, 2);
            $table->decimal('total', 15, 2);
            $table->timestamps();
        });

        Schema::create('supplier_payments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->uuid('store_id')->nullable();
            $table->uuid('device_id')->nullable();
            $table->uuid('register_id')->nullable();
            $table->foreignUuid('supplier_id')->constrained();
            $table->uuid('purchase_id')->nullable();
            $table->string('payment_number', 64);
            $table->decimal('amount', 15, 2);
            $table->string('method', 20);
            $table->string('reference', 100)->nullable();
            $table->date('payment_date');
            $table->string('notes', 500)->nullable();
            $table->uuid('created_by')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->index(['business_id', 'supplier_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('supplier_payments');
        Schema::dropIfExists('purchase_return_items');
        Schema::dropIfExists('purchase_returns');
        Schema::dropIfExists('purchase_payments');
        Schema::dropIfExists('purchase_items');
        Schema::dropIfExists('purchases');
    }
};
