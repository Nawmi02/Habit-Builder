/**
 * Minimal fetch wrapper for the Habit Builder API.
 *
 * - Adds `Authorization: Bearer <access>` to every request.
 * - On 401, refreshes the access token ONCE (single-flight: ten parallel requests that all
 *   get a 401 share one POST /auth/refresh/) and retries the original request once.
 * - The backend uses ROTATE_REFRESH_TOKENS, so the refresh response contains a NEW refresh
 *   token which must replace the stored one.
 * - If the refresh token is rejected -> tokens are cleared and `onAuthLost` is called.
 * - If the refresh fails because the phone is offline -> the user stays signed in and a
 *   NetworkError is thrown (never log someone out because of bad signal).
 *
 * No React Native imports here on purpose: it runs (and is tested) in plain Node.
 */

import { ApiError, NetworkError, parseApiError } from './errors';

export interface TokenStore {
  getAccess(): Promise<string | null>;
  getRefresh(): Promise<string | null>;
  /** `refresh` is optional because a refresh response might not rotate it. */
  setTokens(tokens: { access: string; refresh?: string }): Promise<void>;
  clear(): Promise<void>;
}

export interface HttpClientOptions {
  baseUrl: string; // e.g. http://10.0.2.2:8000/api   (no trailing slash needed)
  tokens: TokenStore;
  fetchImpl?: typeof fetch;
  onAuthLost?: () => void;
  timeoutMs?: number;
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  body?: unknown;
  query?: Query;
  /** Set false for login/register/refresh. Default true. */
  auth?: boolean;
}

export interface HttpClient {
  get<T>(path: string, opts?: Omit<RequestOptions, 'body'>): Promise<T>;
  post<T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>): Promise<T>;
  patch<T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>): Promise<T>;
  put<T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>): Promise<T>;
  delete<T = void>(path: string, opts?: Omit<RequestOptions, 'body'>): Promise<T>;
}

export function buildQuery(query?: Query): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const { tokens, onAuthLost, timeoutMs = 20000 } = options;
  const doFetch: typeof fetch = options.fetchImpl ?? ((...args) => fetch(...args));
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  const urlFor = (path: string, query?: Query) => {
    // DRF pagination returns absolute `next` URLs - allow passing those straight through.
    const base = /^https?:\/\//i.test(path) ? path : `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    return base + buildQuery(query);
  };

  async function send(method: string, url: string, body: unknown, accessToken: string | null): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await doFetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = controller.signal.aborted;
      throw new NetworkError(aborted ? 'The request timed out' : 'Could not reach the server', aborted);
    } finally {
      clearTimeout(timer);
    }
  }

  async function readBody(res: Response): Promise<unknown> {
    if (res.status === 204) return undefined;
    const text = await res.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text; // e.g. an HTML debug page
    }
  }

  // ----- token refresh (single flight) -----
  type RefreshResult = 'ok' | 'rejected';
  let inFlight: Promise<RefreshResult> | null = null;

  async function doRefresh(): Promise<RefreshResult> {
    const refresh = await tokens.getRefresh();
    if (!refresh) return 'rejected';
    const res = await send('POST', urlFor('/auth/refresh/'), { refresh }, null); // may throw NetworkError
    if (!res.ok) return 'rejected';
    const data = (await readBody(res)) as { access?: string; refresh?: string } | undefined;
    if (!data?.access) return 'rejected';
    await tokens.setTokens({ access: data.access, refresh: data.refresh });
    return 'ok';
  }

  function refreshOnce(): Promise<RefreshResult> {
    if (!inFlight) {
      inFlight = doRefresh().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const useAuth = opts.auth !== false;
    const url = urlFor(path, opts.query);

    let usedAccess = useAuth ? await tokens.getAccess() : null;
    let res = await send(method, url, opts.body, usedAccess);

    if (res.status === 401 && useAuth) {
      // Another request may already have refreshed while we were waiting: if the stored
      // token differs from the one we used, just retry with it.
      const current = await tokens.getAccess();
      let canRetry = !!current && current !== usedAccess;

      if (!canRetry) {
        const result = await refreshOnce(); // NetworkError propagates (stay signed in)
        if (result === 'rejected') {
          await tokens.clear();
          onAuthLost?.();
          throw parseApiError(401, await readBody(res));
        }
        canRetry = true;
      }

      if (canRetry) {
        usedAccess = await tokens.getAccess();
        res = await send(method, url, opts.body, usedAccess);
      }
    }

    const data = await readBody(res);
    if (!res.ok) throw parseApiError(res.status, data);
    return data as T;
  }

  return {
    get: (path, opts) => request('GET', path, opts),
    post: (path, body, opts) => request('POST', path, { ...opts, body: body ?? {} }),
    patch: (path, body, opts) => request('PATCH', path, { ...opts, body: body ?? {} }),
    put: (path, body, opts) => request('PUT', path, { ...opts, body: body ?? {} }),
    delete: (path, opts) => request('DELETE', path, opts),
  };
}

export { ApiError, NetworkError };
