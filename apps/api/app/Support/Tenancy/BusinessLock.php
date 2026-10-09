<?php

namespace App\Support\Tenancy;

use Illuminate\Support\Facades\DB;

/**
 * Per-business write serialization.
 *
 * Devices pull the change feed with an auto-increment cursor. Auto-increment ids are allocated at
 * insert time but become visible at commit time, so two concurrent transactions could commit out
 * of id order and a device could advance its cursor past a change that was not yet visible —
 * missing it forever. Taking a row lock on the business at the start of every write transaction
 * serializes change-feed writes per business, making ids monotonic in commit order.
 * Always acquired first in a transaction to keep a consistent lock order (no deadlocks).
 */
final class BusinessLock
{
    /** @var array<string, int> business id => transaction level the lock was taken at */
    private array $held = [];

    public function acquire(string $businessId): void
    {
        $level = DB::transactionLevel();
        if ($level === 0 || isset($this->held[$businessId])) {
            return;
        }
        DB::table('businesses')->where('id', $businessId)->lockForUpdate()->first(['id']);
        $this->held[$businessId] = $level;
    }

    /** Called when the outermost transaction ends. */
    public function release(): void
    {
        if (DB::transactionLevel() === 0) {
            $this->held = [];
        }
    }

    /**
     * Run a write transaction for a business with the lock taken first.
     *
     * @template T
     *
     * @param  callable(): T  $callback
     * @return T
     */
    public function transaction(string $businessId, callable $callback, int $attempts = 3): mixed
    {
        return DB::transaction(function () use ($businessId, $callback) {
            $this->acquire($businessId);

            return $callback();
        }, $attempts);
    }
}
