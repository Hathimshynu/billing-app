#!/usr/bin/env node
/**
 * Starts the Laravel API for end-to-end tests on a dedicated SQLite database, freshly migrated and
 * seeded, so E2E runs never touch development data.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'api');
const database = join(apiDir, 'database', 'e2e.sqlite');
const port = process.env.E2E_API_PORT || '8010';

mkdirSync(dirname(database), { recursive: true });
if (existsSync(database)) rmSync(database);
writeFileSync(database, '');

const env = {
  ...process.env,
  APP_ENV: 'local',
  APP_DEBUG: 'false',
  DB_CONNECTION: 'sqlite',
  DB_DATABASE: database,
  CACHE_STORE: 'array',
  SESSION_DRIVER: 'array',
  QUEUE_CONNECTION: 'sync',
  XDEBUG_MODE: 'off',
  LOG_CHANNEL: 'stderr',
  LOG_LEVEL: 'warning',
};

const php = process.env.PHP_BINARY || 'php';
const migrate = spawnSync(php, ['artisan', 'migrate:fresh', '--seed', '--force'], { cwd: apiDir, env, stdio: 'inherit' });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const server = spawn(php, ['artisan', 'serve', '--host=127.0.0.1', `--port=${port}`, '--no-reload'], { cwd: apiDir, env, stdio: 'inherit' });
const stop = () => server.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));
