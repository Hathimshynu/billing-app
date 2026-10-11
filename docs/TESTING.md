# Testing

| Suite | Command | Covers |
| --- | --- | --- |
| Shared domain (Vitest, 71 tests) | `npm test -w @shopdesk/shared` | Money math, GST/VAT/inclusive pricing, discounts, round-off, jewellery & old gold, barcodes & scale labels, FEFO, numbering. Shared JSON fixtures (`packages/shared/fixtures/pricing-cases.json`) are also asserted by PHP. |
| Web (Vitest + fake-indexeddb, 32 tests) | `npm test -w @shopdesk/web` | Outbox atomicity & rollback, field-level update payloads, offline sale (stock, movement, provisional/final numbers), credit sale & cancellation, returns, purchases (batches, IMEI, orders, returns, cancel), register totals, payments, transfers, KOT, settings, held bills, Sync Center retry/discard, conflict resolution, backup/restore, CSV/XLSX import, sync engine (offline, push, replay, retryable vs permanent rejections, conflicts, paged pull, expired session). |
| API (PHPUnit, 78 tests / 1045 assertions) | `cd apps/api && php artisan test` | Auth, tenancy & RBAC (incl. forged author ids), cross-tenant isolation, push idempotency, dependency ordering, conflicts, pull feed, numbering (blocks, provisional, per-device series), sales/returns/cancel, purchases, industry flows, pricing parity. |
| Static analysis | `composer analyse`, `composer lint`, `npm run lint`, `npm run typecheck` | PHPStan level 5, Pint, ESLint, TypeScript strict |
| End-to-end (Playwright) | `npm run e2e` | **Critical offline test** below, against the production build with service worker |

## Critical offline E2E (`apps/web/e2e/offline-sync.spec.ts`)

1. Sign in online, open a business, wait for the initial download; service worker controls the page.
2. Go offline (`context.setOffline(true)`).
3. Create a product with barcode and opening stock; create a customer.
4. POS: scan the barcode, change quantity, pick the customer, pay cash, complete; the receipt is
   captured through the print hook.
5. The sale is listed locally; Sync Center shows pending operations.
6. Reload while offline — the app shell loads from the service worker and the data is still there.
7. Reconnect and Sync now → 0 pending; sync again.
8. Through the API: exactly one product, one customer, one sale (total 240, quantity 2, final
   invoice number), and server stock 25 − 2 = 23.

The Playwright config starts its own API (`e2e/start-api.mjs`: fresh SQLite `database/e2e.sqlite`,
migrated and seeded, port 8010) and `vite preview` on port 4173. Install the browser once with
`npm run e2e:install -w @shopdesk/web`, or use an installed browser:
`E2E_CHANNEL=chrome npm run e2e` (or `msedge`).

## Before a release

```bash
npm run lint && npm run typecheck && npm test && npm run build
cd apps/api && php artisan test && composer analyse && composer lint && php artisan migrate:fresh --seed
cd ../.. && npm run e2e
```
