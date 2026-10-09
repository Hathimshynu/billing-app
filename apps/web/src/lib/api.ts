import { config } from './config';

/** Error envelope returned by the API: { success: false, message, errors, code? } */
export class ApiError extends Error {
  readonly status: number;
  readonly errors: Record<string, string[]>;
  readonly code: string | null;

  constructor(message: string, status: number, errors: Record<string, string[]> = {}, code: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
    this.code = code;
  }

  /** First validation message for a field, if any. */
  field(name: string): string | undefined {
    return this.errors[name]?.[0];
  }
}

/** The request never reached the server (offline, DNS, CORS, timeout). */
export class NetworkError extends Error {
  readonly timeout: boolean;
  constructor(message: string, timeout = false) {
    super(message);
    this.name = 'NetworkError';
    this.timeout = timeout;
  }
}

export interface ApiContext {
  token?: string | null;
  businessId?: string | null;
  deviceId?: string | null;
}

let context: ApiContext = {};
let onUnauthorized: (() => void) | null = null;

/** Set default auth / tenant / device headers for subsequent requests. */
export function setApiContext(next: ApiContext): void {
  context = { ...context, ...next };
}

export function getApiContext(): ApiContext {
  return context;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  timeoutMs?: number;
  context?: ApiContext;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const ctx = { ...context, ...options.context };
  const url = new URL(`${config.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (ctx.token) headers.Authorization = `Bearer ${ctx.token}`;
  if (ctx.businessId) headers['X-Business-Id'] = ctx.businessId;
  if (ctx.deviceId) headers['X-Device-Id'] = ctx.deviceId;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? config.requestTimeoutMs);
  options.signal?.addEventListener('abort', () => controller.abort());

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers,
      body:
        options.body === undefined
          ? undefined
          : options.body instanceof FormData
            ? options.body
            : JSON.stringify(options.body),
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    throw new NetworkError(aborted ? 'The server did not respond in time.' : 'Unable to reach the server.', aborted);
  } finally {
    window.clearTimeout(timeout);
  }

  const text = await response.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      if (!response.ok) throw new ApiError(`Server error (${response.status}).`, response.status);
      throw new ApiError('The server returned an invalid response.', response.status);
    }
  }
  if (!response.ok) {
    const body = (json ?? {}) as { message?: string; errors?: Record<string, string[]>; code?: string };
    if (response.status === 401) onUnauthorized?.();
    throw new ApiError(body.message || `Request failed (${response.status}).`, response.status, body.errors ?? {}, body.code ?? null);
  }
  return json as T;
}

/** Unwraps the `{ success, data }` envelope. */
export async function apiData<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const result = await apiRequest<{ success: boolean; data: T }>(path, options);
  return result.data;
}

export function isOfflineError(error: unknown): boolean {
  return error instanceof NetworkError || (error instanceof ApiError && error.status >= 500);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof NetworkError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
