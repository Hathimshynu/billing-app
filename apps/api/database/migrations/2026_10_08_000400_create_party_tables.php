<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Customers & suppliers with append-only ledgers. Balances are derived from ledger entries
 * (cached in `balance` for fast lookups) so credit sales recorded offline on several devices add up.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->string('name', 150);
            $table->string('phone', 20)->nullable();
            $table->string('email', 190)->nullable();
            $table->string('address', 500)->nullable();
            $table->string('city', 100)->nullable();
            $table->string('state_code', 4)->nullable();
            $table->string('pincode', 12)->nullable();
            $table->string('gstin', 15)->nullable();
            $table->decimal('credit_limit', 15, 2)->default(0);
            $table->decimal('opening_balance', 15, 2)->default(0);
            // Cached receivable (Σ debit − Σ credit of the ledger) and loyalty points.
            $table->decimal('balance', 15, 2)->default(0);
            $table->integer('loyalty_points')->default(0);
            $table->string('tier', 40)->nullable();
            $table->string('notes', 1000)->nullable();
            $table->date('date_of_birth')->nullable();
            $table->boolean('active')->default(true);
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->softDeletes();
            $table->index(['business_id', 'phone']);
            $table->index(['business_id', 'name']);
        });

        Schema::create('customer_addresses', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('customer_id')->constrained()->cascadeOnDelete();
            $table->string('label', 40)->default('Home');
            $table->string('line1', 200);
            $table->string('line2', 200)->nullable();
            $table->string('city', 100)->nullable();
            $table->string('state_code', 4)->nullable();
            $table->string('pincode', 12)->nullable();
            $table->boolean('is_default')->default(false);
            $table->timestamps();
        });

        Schema::create('customer_ledger', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('customer_id')->constrained()->cascadeOnDelete();
            $table->string('type', 20);
            $table->string('reference_type', 40)->nullable();
            $table->uuid('reference_id')->nullable();
            $table->string('reference_no', 64)->nullable();
            $table->decimal('debit', 15, 2)->default(0);
            $table->decimal('credit', 15, 2)->default(0);
            $table->integer('points')->default(0);
            $table->string('notes', 500)->nullable();
            $table->uuid('created_by')->nullable();
            $table->uuid('device_id')->nullable();
            $table->timestamp('occurred_at');
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->index(['business_id', 'customer_id', 'occurred_at']);
            $table->index(['reference_type', 'reference_id']);
        });

        Schema::create('suppliers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->string('name', 150);
            $table->string('phone', 20)->nullable();
            $table->string('email', 190)->nullable();
            $table->string('address', 500)->nullable();
            $table->string('city', 100)->nullable();
            $table->string('state_code', 4)->nullable();
            $table->string('gstin', 15)->nullable();
            $table->decimal('opening_balance', 15, 2)->default(0);
            // Cached payable (Σ credit − Σ debit of the ledger).
            $table->decimal('balance', 15, 2)->default(0);
            $table->unsignedSmallInteger('credit_days')->default(0);
            $table->string('notes', 1000)->nullable();
            $table->boolean('active')->default(true);
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->softDeletes();
            $table->index(['business_id', 'name']);
        });

        Schema::create('supplier_ledger', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('supplier_id')->constrained()->cascadeOnDelete();
            $table->string('type', 20);
            $table->string('reference_type', 40)->nullable();
            $table->uuid('reference_id')->nullable();
            $table->string('reference_no', 64)->nullable();
            $table->decimal('debit', 15, 2)->default(0);
            $table->decimal('credit', 15, 2)->default(0);
            $table->string('notes', 500)->nullable();
            $table->uuid('created_by')->nullable();
            $table->uuid('device_id')->nullable();
            $table->timestamp('occurred_at');
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->index(['business_id', 'supplier_id', 'occurred_at']);
            $table->index(['reference_type', 'reference_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('supplier_ledger');
        Schema::dropIfExists('suppliers');
        Schema::dropIfExists('customer_ledger');
        Schema::dropIfExists('customer_addresses');
        Schema::dropIfExists('customers');
    }
};
