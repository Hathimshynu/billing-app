# REST API (`/api/v1`)

JSON in and out. Responses use an envelope:

```json
{ "success": true, "data": { }, "message": "optional" }
{ "success": false, "message": "Human readable", "errors": { "field": ["…"] } }
```

Lists are paginated: `data: [...]`, `meta: { current_page, per_page, total, last_page }` (`?page=`, `?per_page=`).

## Headers

| Header | When |
| --- | --- |
| `Authorization: Bearer <token>` | every authenticated request (Sanctum personal access token) |
| `X-Business-Id: <uuid>` | every business-scoped request; membership is verified |
| `X-Device-Id: <uuid>` | sync endpoints (required), others optional; revoked devices are refused |
| `Idempotency-Key: <uuid>` | optional on REST writes; a repeated key returns the original result |

## Endpoints

| Method & path | Permission | Purpose |
| --- | --- | --- |
| `GET /health` | — | Liveness probe used for connectivity detection |
| `POST /auth/register`, `POST /auth/login` | — (rate limited) | Returns `token`, `user`, `businesses[]` |
| `GET /auth/me`, `POST /auth/logout`, `POST /auth/password` | auth | Session |
| `POST /businesses` | auth | Create a business (owner role, default store, settings, taxes, units) |
| `GET /business`, `PUT /business` | member / `settings.manage` | Business profile |
| `POST /devices/register` | member | Register this browser/device, returns device code |
| `POST /sync/push` | device | Push outbox operations → `accepted`, `rejected`, `conflicts`, `server_changes` |
| `POST /sync/pull` | device | `{cursor, limit}` → `changes[]`, `cursor`, `has_more` |
| `GET /sync/status` | device | Pending server-side info for the device |
| `GET /sync/conflicts` | `sync.manage` | Conflicts recorded for the business |
| `POST /devices/number-blocks` | device | Reserve invoice number blocks |
| `GET /devices`, `POST /devices/{id}/revoke` | `devices.manage` | Device management |
| `GET/POST /members`, `PUT /members/{userId}` | `users.manage` | Employees |
| `GET/POST /roles`, `PUT /roles/{id}` | `roles.manage` | Roles & permissions |
| `GET/POST /stores`, `PUT /stores/{id}` | member / `stores.manage` | Stores |
| `GET /audit-logs` | `audit.view` | Audit trail (`?action=`, `?user_id=`, `?from=`) |
| `GET /backup/export` | `backup.manage` | Streamed JSON export of the whole business |
| `POST /attachments` | `expenses.create` | Upload an expense receipt (jpg/png/webp/pdf ≤ 5 MB) |
| `GET/POST /products`, `GET/PUT/DELETE /products/{id}` | `products.*` | Catalogue (`?search=`) |
| `GET/POST /categories` | `products.*` | Categories |
| `GET/POST /{customers|suppliers}`, `GET/PUT/DELETE /{type}/{id}`, `GET /{type}/{id}/ledger` | `customers.*` / `suppliers.*` | Parties |
| `GET/POST /sales`, `GET /sales/{id}`, `POST /sales/{id}/cancel`, `POST /sales/{id}/returns` | `sales.*` | Sales |
| `GET/POST /purchases`, `GET /purchases/{id}`, `POST /purchases/{id}/receive|cancel|returns` | `purchases.*` | Purchases |
| `GET /inventory`, `GET /inventory/{productId}/movements`, `POST /inventory/adjustments|transfers` | `inventory.*` | Stock |
| `GET/POST /expenses` | `expenses.*` | Expenses |
| `GET /reports/dashboard|sales|top-products|payments|tax|profit` | `reports.view` (`profit`: `reports.financial`) | Server-side reports across all stores |

REST writes run through the same operation handlers as sync push, so a sale created via
`POST /sales` and one pushed from an offline device are validated and booked identically.

## Push example

```http
POST /api/v1/sync/push
X-Business-Id: 01J…   X-Device-Id: 01J…

{ "device_id": "01J…", "operations": [ {
    "operation_id": "01J…", "operation": "UPDATE_PRODUCT", "entity_type": "product",
    "entity_id": "01J…", "base_version": 3,
    "payload": { "changes": { "selling_price": 65 }, "base": { "selling_price": 59 } },
    "created_at": "2026-10-09T10:15:00Z", "user_id": "01J…" } ] }
```

```json
{ "success": true,
  "accepted": [ { "operation_id": "01J…", "entity_id": "01J…", "status": "accepted" } ],
  "rejected": [], "conflicts": [], "server_changes": [ { "seq": 812, "entity_type": "product", "entity_id": "01J…", "action": "upsert", "data": { } } ] }
```

Rejections carry `code`, `message`, `errors` and `retryable`.
