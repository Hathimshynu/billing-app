# Security

## Authentication
- Laravel Sanctum bearer tokens (lifetime `SANCTUM_EXPIRATION`, default 30 days so tills can work
  offline for long periods). Passwords are hashed with bcrypt; minimum 8 characters with letters
  and numbers.
- Login is rate limited per email + IP (`throttle:auth`); API 300 req/min per user; sync 240 req/min
  per device.
- Offline sign-in uses a PBKDF2-SHA256 verifier (150 000 iterations, random salt) stored only on
  that device after a successful online sign-in. The plain password is never stored.
- An expired token never blocks billing: work continues locally and a banner asks for re-login.

## Authorization
- Granular permissions (e.g. `sales.discount`, `sales.price_override`, `sales.credit_override`,
  `sales.delete`, `products.view_cost`, `reports.financial`) grouped in roles: Owner, Admin,
  Manager, Cashier, Inventory Manager, Accountant, Pharmacist, Sales Staff, plus custom roles.
- **The server never trusts the client.** Every request is checked by `EnsurePermission`; every
  pushed operation is authorized again. An operation recorded offline by another member of a
  shared till is allowed only for permissions held by both its author and the signed-in user
  pushing it, so a forged author id never grants extra rights. The web app only uses permissions
  to hide controls.
- Offline actions beyond a role's limits (credit beyond limit, discount without permission, expired
  batch) are recorded with `review_flags` and notify managers rather than silently disappearing.

## Server-authoritative money
- Prices, discounts, taxes and totals of every synced sale are recalculated by the server engine;
  stored line and invoice amounts, ledger postings and refunds always use the server figures.
- Loyalty points earned and redeemed are computed on the server from the loyalty settings.
- Anomalies made offline are recorded with `review_flags` (see `docs/SECURITY_AUDIT.md`) and a
  manager notification instead of being rejected.

## Device identity
- Each device receives a random secret at registration; the server stores only its SHA-256 and
  requires it as `X-Device-Secret` on sync requests and to re-register that device id.
- Store-restricted members can only register devices in, and post operations to, their stores.
- A member who is disabled or removed gets `code: business_access_denied`; the app then removes
  the business from that account on the device and deletes the offline sign-in verifier.

## Tenant isolation
- `ResolveTenant` validates `X-Business-Id` membership; `BusinessScope` filters every query;
  `BelongsToBusiness` blocks writes into another business; tests cover cross-tenant reads/writes.
- Devices are bound to a business; revoked devices cannot sync.
- On the device, each business uses a separate IndexedDB database.

## Data handling
- Passwords, tokens and payment card data are never logged. Card payments store only method,
  amount and an optional reference typed by the cashier (no card numbers).
- Audit log (`audit_logs`, append-only) records logins, business/settings/price changes,
  cancellations, returns, permission/role changes, device registration/revocation, conflicts.
- Uploads: expense attachments only, ≤ 5 MB, jpg/png/webp/pdf, stored on the public disk under a
  random name.
- Security headers on API responses: `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, CSP `default-src 'none'` for JSON, HSTS over HTTPS.
- CORS origins come from `CORS_ALLOWED_ORIGINS`; serve web and API from the same origin in
  production where possible.
- Secrets live in `.env` (git-ignored). Never commit `.env`, keys or database files.

## Device risks (by design of offline apps)
Data stored in the browser is readable by anyone using that OS account. Use OS accounts with
passwords, sign out on shared machines (sign-out warns about unsynced work), and revoke lost
devices in Settings → Devices.
