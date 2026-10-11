# ShopDesk — offline-first billing, POS & inventory

ShopDesk is a billing / point-of-sale / inventory application for many kinds of shops: supermarkets,
pharmacies, jewellery, mobile & electronics stores, clothing, hardware, bakeries, restaurants,
wholesale, services and general retail.

**The app works fully without internet.** Every sale, product, customer, payment, purchase, expense
and stock change is saved on the device first (IndexedDB) together with a sync operation. When the
connection returns, changes are pushed to the server automatically, server changes are pulled, and
nothing is lost or duplicated.

```
apps/api        Laravel 13 REST API (PHP 8.3+, Sanctum, MySQL/PostgreSQL/SQLite)
apps/web        React 19 + TypeScript + Vite PWA (Dexie/IndexedDB, Tailwind 4, shadcn/ui)
packages/shared Shared TypeScript domain: money, GST engine, numbering, schemas, sync contract
docs/           Architecture, offline sync, database, API, security, deployment, testing, manual
```

## Quick start (development)

Requirements: Node 20.19+ (24 recommended), npm 10+, PHP 8.3+ with `pdo_sqlite`, Composer 2.

```bash
# 1. Install
npm install
cd apps/api && composer install && cp .env.example .env && php artisan key:generate

# 2. Database with demo data (SQLite by default)
php artisan migrate:fresh --seed
php artisan serve            # http://127.0.0.1:8000

# 3. Web app (new terminal, repository root)
npm run dev                  # http://127.0.0.1:5173 (proxies /api to :8000)
```

Demo logins (password `Password123`):

| User | Access |
| --- | --- |
| `owner@shopdesk.test` | Owner of 7 demo businesses (supermarket, pharmacy, jewellery, mobile, clothing, electronics, restaurant) |
| `cashier@shopdesk.test` | Cashier in FreshMart Supermarket |

To see offline mode: sign in once online, open a business (data downloads), then switch the browser
to offline (DevTools → Network → Offline) and keep billing. The service worker is active in
production builds (`npm run build -w @shopdesk/web && npm run preview -w @shopdesk/web`).

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests: shared domain (71) + web offline core, repositories, sync engine (32) |
| `npm run lint` | ESLint for all packages + translation file check |
| `npm run typecheck` / `npm run build` | TypeScript project build / production build with service worker |
| `npm run e2e` | Playwright end-to-end offline → sync test (seeds its own API database) |
| `cd apps/api && php artisan test` | Backend feature & unit tests (78 tests) |
| `cd apps/api && composer analyse` | PHPStan (level 5, Larastan) |
| `cd apps/api && composer lint` | Laravel Pint style check |

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — components, data flow, multi-tenancy
- [Offline & sync](docs/OFFLINE_SYNC.md) — outbox, push/pull, conflicts, invoice numbering offline
- [Database](docs/DATABASE.md) — tables and relationships (server and device)
- [API](docs/API.md) — REST endpoints under `/api/v1`
- [Security](docs/SECURITY.md) — auth, permissions, tenant isolation, data handling
- [Security audit](docs/SECURITY_AUDIT.md) — findings, fixes, residual risks (Phase A)
- [Deployment](docs/DEPLOYMENT.md) — production setup (MySQL/PostgreSQL, Redis, queues, HTTPS)
- [Testing](docs/TESTING.md) — test suites and how to run them
- [User manual](docs/USER_MANUAL.md) — for shop owners and cashiers
- [Known limitations](docs/KNOWN_LIMITATIONS.md)
- [Production checklist](docs/PRODUCTION_CHECKLIST.md)
