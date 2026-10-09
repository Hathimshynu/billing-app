/** Runtime configuration (Vite env, with safe defaults for same-origin deployments). */
export const config = {
  appName: (import.meta.env.VITE_APP_NAME as string | undefined) || 'ShopDesk',
  /** Base URL of the API. Same-origin `/api/v1` by default (Vite proxy in dev, reverse proxy in prod). */
  apiBaseUrl: ((import.meta.env.VITE_API_URL as string | undefined) || '/api/v1').replace(/\/$/, ''),
  /** Request timeout for normal API calls. */
  requestTimeoutMs: 15_000,
  /** Health probe timeout used to decide whether we are really online. */
  healthTimeoutMs: 5_000,
  /** Background sync interval while online. */
  syncIntervalMs: 60_000,
  /** Faster interval on screens that need near-real-time data (kitchen display). */
  fastSyncIntervalMs: 8_000,
  pushBatchSize: 50,
  pullPageSize: 500,
  /** Offline password verifier iterations (PBKDF2-SHA256). */
  pbkdf2Iterations: 150_000,
} as const;
