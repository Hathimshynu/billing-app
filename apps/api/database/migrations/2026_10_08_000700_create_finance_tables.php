<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('expense_categories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->string('name', 80);
            $table->boolean('active')->default(true);
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->softDeletes();
        });

        Schema::create('expenses', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->uuid('store_id')->nullable();
            $table->uuid('device_id')->nullable();
            $table->uuid('register_id')->nullable();
            $table->foreignUuid('category_id')->nullable()->constrained('expense_categories')->nullOnDelete();
            $table->string('category_name', 80)->nullable();
            $table->string('expense_number', 64);
            $table->decimal('amount', 15, 2);
            $table->string('payment_method', 20);
            $table->date('expense_date');
            $table->string('reference', 100)->nullable();
            $table->string('notes', 1000)->nullable();
            $table->string('attachment_path')->nullable();
            $table->string('status', 10)->default('active');
            $table->uuid('created_by')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->index(['business_id', 'expense_date']);
        });

        Schema::create('cash_registers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('store_id')->constrained();
            $table->uuid('device_id')->nullable();
            $table->string('status', 10)->default('open');
            $table->uuid('opened_by')->nullable();
            $table->timestamp('opened_at');
            $table->decimal('opening_cash', 15, 2)->default(0);
            $table->uuid('closed_by')->nullable();
            $table->timestamp('closed_at')->nullable();
            $table->decimal('cash_sales', 15, 2)->default(0);
            $table->decimal('cash_refunds', 15, 2)->default(0);
            $table->decimal('cash_in', 15, 2)->default(0);
            $table->decimal('cash_out', 15, 2)->default(0);
            $table->decimal('cash_expenses', 15, 2)->default(0);
            $table->decimal('expected_cash', 15, 2)->nullable();
            $table->decimal('closing_cash', 15, 2)->nullable();
            $table->decimal('difference', 15, 2)->nullable();
            $table->json('denominations')->nullable();
            $table->string('notes', 1000)->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->index(['business_id', 'store_id', 'opened_at']);
        });

        Schema::create('cash_transactions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('register_id')->constrained('cash_registers')->cascadeOnDelete();
            $table->foreignUuid('store_id')->constrained();
            $table->string('type', 10);
            $table->decimal('amount', 15, 2);
            $table->string('reason', 500)->nullable();
            $table->timestamp('occurred_at');
            $table->uuid('created_by')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cash_transactions');
        Schema::dropIfExists('cash_registers');
        Schema::dropIfExists('expenses');
        Schema::dropIfExists('expense_categories');
    }
};
