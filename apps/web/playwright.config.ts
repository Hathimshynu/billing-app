import { defineConfig, devices } from '@playwright/test';

const API_PORT = process.env.E2E_API_PORT || '8010';
const WEB_PORT = process.env.E2E_WEB_PORT || '4173';

/**
 * End-to-end tests run against the production build (service worker included) served by
 * `vite preview`, proxying /api to a freshly seeded Laravel API on a separate SQLite database.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'allow',
  },
  // E2E_CHANNEL=chrome|msedge runs against an installed browser instead of Playwright's bundled Chromium.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}) } }],
  webServer: [
    {
      command: 'node e2e/start-api.mjs',
      url: `http://127.0.0.1:${API_PORT}/api/v1/health`,
      timeout: 240_000,
      reuseExistingServer: false,
      env: { E2E_API_PORT: API_PORT },
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `npx vite build && npx vite preview --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      timeout: 240_000,
      reuseExistingServer: false,
      env: { VITE_API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
