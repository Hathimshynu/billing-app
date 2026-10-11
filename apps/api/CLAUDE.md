# ShopDesk API — working notes

Laravel 13 / PHP 8.3 REST API for the offline-first ShopDesk POS. Read `../../docs/ARCHITECTURE.md`
and `../../docs/OFFLINE_SYNC.md` before changing sync, stock, ledgers or numbering.

## Rules
- All writes (REST and sync push) go through `App\Services\Sync\OperationRegistry`; controllers stay thin.
- Every write transaction acquires `BusinessLock` first (monotonic change feed). Use `$lock->transaction()`.
- Business-owned models extend `TenantModel`/`SyncModel` (UUIDs, `BusinessScope`, change feed).
- Stock changes only via `InventoryService::move()` (immutable `inventory_movements`); balances only via `LedgerService`.
- Never reject financial operations for business-rule anomalies made offline — add `review_flags` and notify.
- Keep `App\Domain\Pricing` and `packages/shared/src/tax.ts` in lockstep; extend `packages/shared/fixtures/pricing-cases.json` for new cases.
- Re-check permissions server side (`permission:` middleware / `TenantContext::authorize`). Never trust the client.
- Never log passwords, tokens or payment details.

## Commands
```bash
export XDEBUG_MODE=off          # WAMP has Xdebug loaded; it slows everything down
php artisan test                # 78 feature/unit tests
composer analyse                # PHPStan level 5 (Larastan)
composer lint                   # Pint (composer format to fix)
php artisan migrate:fresh --seed  # demo data: owner@shopdesk.test / Password123
```

Model casts use the `$casts` property (not the `casts()` method) so Larastan understands them.
Edit PHP with precise edits — no bulk regex replacement across files.
