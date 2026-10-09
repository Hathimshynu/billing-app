<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Synchronization (operation log for idempotency, conflict records, per-business change feed),
 * audit trail, notifications and file attachments.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sync_operations', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            // Idempotency key generated on the device. A replayed operation returns the stored result.
            $table->uuid('operation_id')->unique();
            $table->uuid('device_id')->nullable()->index();
            $table->uuid('user_id')->nullable();
            $table->string('entity_type', 40);
            $table->uuid('entity_id');
            $table->string('operation', 40);
            $table->json('payload')->nullable();
            // processing | accepted | rejected | conflict
            $table->string('status', 12);
            $table->json('result')->nullable();
            $table->string('error_code', 40)->nullable();
            $table->string('error_message', 1000)->nullable();
            $table->timestamp('client_created_at')->nullable();
            $table->timestamp('processed_at')->nullable();
            $table->timestamps();
            $table->index(['business_id', 'entity_type', 'entity_id']);
        });

        Schema::create('sync_conflicts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->uuid('operation_id')->index();
            $table->uuid('device_id')->nullable();
            $table->uuid('user_id')->nullable();
            $table->string('entity_type', 40);
            $table->uuid('entity_id');
            // field | serial_double_sale | deleted | other
            $table->string('conflict_type', 30);
            $table->json('fields')->nullable();
            $table->json('server_data')->nullable();
            $table->json('local_payload')->nullable();
            $table->string('message', 500);
            $table->string('status', 12)->default('open');
            $table->string('resolution', 20)->nullable();
            $table->uuid('resolved_by')->nullable();
            $table->timestamp('resolved_at')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->index(['business_id', 'status']);
        });

        Schema::create('sync_changes', function (Blueprint $table) {
            // Monotonic change feed. `id` is the cursor devices use for incremental pulls.
            $table->id();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            // null = business-wide entity, otherwise only devices of this store need it.
            $table->uuid('store_id')->nullable();
            $table->string('entity_type', 40);
            $table->uuid('entity_id');
            $table->string('action', 10);
            $table->timestamp('created_at')->nullable();
            $table->index(['business_id', 'id']);
            $table->index(['business_id', 'entity_type', 'entity_id']);
        });

        Schema::create('audit_logs', function (Blueprint $table) {
            $table->id();
            $table->uuid('business_id')->nullable()->index();
            $table->uuid('user_id')->nullable();
            $table->string('action', 40);
            $table->string('entity_type', 40)->nullable();
            $table->uuid('entity_id')->nullable();
            $table->json('old_values')->nullable();
            $table->json('new_values')->nullable();
            $table->uuid('device_id')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent', 500)->nullable();
            $table->timestamp('created_at')->nullable();
            $table->index(['business_id', 'created_at']);
            $table->index(['entity_type', 'entity_id']);
            $table->index(['business_id', 'action']);
        });

        // Named app_notifications to stay clear of Laravel's built-in database notifications table.
        Schema::create('app_notifications', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->uuid('user_id')->nullable();
            $table->string('type', 40);
            $table->string('title', 200);
            $table->string('body', 1000)->nullable();
            $table->string('severity', 10)->default('info');
            $table->string('entity_type', 40)->nullable();
            $table->uuid('entity_id')->nullable();
            $table->timestamp('read_at')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->index(['business_id', 'created_at']);
        });

        Schema::create('attachments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('business_id')->constrained()->cascadeOnDelete();
            $table->string('entity_type', 40);
            $table->uuid('entity_id');
            $table->string('path');
            $table->string('filename', 200);
            $table->string('mime', 100);
            $table->unsignedInteger('size');
            $table->uuid('created_by')->nullable();
            $table->timestamps();
            $table->index(['entity_type', 'entity_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('attachments');
        Schema::dropIfExists('app_notifications');
        Schema::dropIfExists('audit_logs');
        Schema::dropIfExists('sync_changes');
        Schema::dropIfExists('sync_conflicts');
        Schema::dropIfExists('sync_operations');
    }
};
