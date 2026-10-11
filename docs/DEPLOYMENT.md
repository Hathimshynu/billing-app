# Deployment

## Components
- **API**: PHP 8.3+ (extensions: pdo_mysql or pdo_pgsql, mbstring, bcmath, intl, openssl, fileinfo),
  Composer, a web server (nginx + PHP-FPM recommended).
- **Database**: MySQL 8 / MariaDB 10.6+ or PostgreSQL 14+.
- **Redis** (recommended) for cache and queues.
- **Web app**: static files from `apps/web/dist` (any static host or the same nginx).
- **HTTPS is required**: service workers, offline install and secure tokens need a secure origin.

## API

```bash
cd apps/api
composer install --no-dev --optimize-autoloader
cp .env.example .env        # set the values below
php artisan key:generate
php artisan migrate --force
php artisan storage:link
php artisan config:cache && php artisan route:cache
```

Production `.env`:

```dotenv
APP_ENV=production
APP_DEBUG=false
APP_URL=https://shop.example.com
DB_CONNECTION=mysql          # or pgsql
DB_HOST=… DB_DATABASE=shopdesk DB_USERNAME=… DB_PASSWORD=…
CACHE_STORE=redis
QUEUE_CONNECTION=redis
SESSION_DRIVER=redis
CORS_ALLOWED_ORIGINS=https://shop.example.com
SANCTUM_EXPIRATION=43200
LOG_LEVEL=warning
```

Run a queue worker (supervisor/systemd): `php artisan queue:work --tries=3`, and the scheduler
(`* * * * * php artisan schedule:run`).

Do **not** run `migrate:fresh --seed` in production — the seeder creates demo users.

## Web app

```bash
npm ci
npm run build -w @shopdesk/web     # outputs apps/web/dist (includes sw.js)
```

Build-time variables (`apps/web/.env.production`): `VITE_API_URL` (default `/api/v1`, same origin),
`VITE_APP_NAME`.

## nginx (same origin)

```nginx
server {
  listen 443 ssl http2;
  server_name shop.example.com;
  root /srv/shopdesk/apps/web/dist;

  location /api/     { try_files $uri /index.php?$query_string; root /srv/shopdesk/apps/api/public; }
  location /storage/ { root /srv/shopdesk/apps/api/public; }
  location ~ \.php$  { root /srv/shopdesk/apps/api/public; include fastcgi_params;
                       fastcgi_param SCRIPT_FILENAME $document_root/index.php; fastcgi_pass unix:/run/php/php8.3-fpm.sock; }

  location = /sw.js         { add_header Cache-Control "no-cache"; }
  location = /index.html    { add_header Cache-Control "no-cache"; }
  location /assets/         { add_header Cache-Control "public, max-age=31536000, immutable"; }
  location /                { try_files $uri /index.html; }
}
```

`sw.js` and `index.html` must not be cached long, so devices pick up new versions; users get an
"update available" prompt and unsynced data is never lost on update.

## Backups
- Database: nightly dumps + binary logs / WAL archiving; test restores.
- `storage/app/public` (attachments).
- Businesses can also download a full JSON export (Settings → Backup).

## Upgrades
1. Deploy API and run `php artisan migrate --force` (migrations are additive).
2. Deploy the web build. Old app versions keep syncing because the sync protocol is backwards
   compatible within `/api/v1`.
