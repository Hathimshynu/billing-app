# Production checklist

## Before go-live
- [ ] HTTPS with a valid certificate; web and API on the same origin (or CORS restricted to it).
- [ ] `APP_ENV=production`, `APP_DEBUG=false`, unique `APP_KEY`, `.env` not in version control.
- [ ] MySQL 8 / PostgreSQL 14+ with backups (nightly dump + point-in-time recovery) and a tested restore.
- [ ] Redis for cache/queue/sessions; queue worker and scheduler supervised.
- [ ] `php artisan migrate --force` (never `migrate:fresh --seed` — it creates demo users).
- [ ] `storage:link`, `config:cache`, `route:cache`; storage directory writable, attachments backed up.
- [ ] `sw.js` and `index.html` served with `Cache-Control: no-cache`; `/assets/*` immutable.
- [ ] Log rotation; `LOG_LEVEL=warning`; monitoring of 5xx rates, queue length and disk.
- [ ] Release checks pass: `npm run lint && npm run typecheck && npm test && npm run build`,
      `php artisan test`, `composer analyse`, `composer lint`, `npm run e2e`.

## Per business
- [ ] Business details, GSTIN and state (decides CGST/SGST vs IGST).
- [ ] Tax rates, units, categories; invoice number formats and the reserved block size.
- [ ] UPI ID, receipt paper (58/80 mm/A4), print-after-sale, terms and footer.
- [ ] Employees with the least-privilege role; owner account protected by a strong password.
- [ ] Each till opened once **online** (registers the device and reserves invoice numbers).
- [ ] Test offline: disconnect, make a sale, reconnect, confirm it syncs (Sync Center → 0 pending).
- [ ] Opening stock imported or entered; a test purchase and return done.

## Operations
- [ ] Daily: check Sync Center on each till (no failed operations), close the cash register.
- [ ] Weekly: review flagged invoices (Sales → Flagged for review) and conflicts.
- [ ] Revoke lost or retired devices (Settings → Devices).
- [ ] Download a full server export periodically (Settings → Backup).
