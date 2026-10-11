<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Device ids are visible to every member (they appear on pulled sales), so they cannot act as a
 * credential. Each device receives a random secret at registration; only its SHA-256 is stored.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('devices', function (Blueprint $table) {
            $table->string('secret_hash', 64)->nullable()->after('code');
        });
    }

    public function down(): void
    {
        Schema::table('devices', function (Blueprint $table) {
            $table->dropColumn('secret_hash');
        });
    }
};
