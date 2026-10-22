import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpClient, buildQuery, type TokenStore } from '../src/api/http';
import { ApiError, NetworkError, parseApiError } from '../src/api/errors';

// ---------- helpers ----------
function memoryTokens(access: string | null, refresh: string | null) {
  const state = { access, refresh };
  const store: TokenStore & { state: typeof state } = {
    state,
    getAccess: async () => state.access,
    getRefresh: async () => state.refresh,
    setTokens: async (t) => {
      state.access = t.access;
      if (t.refresh) state.refresh = t.refresh;
    },
    clear: async () => {
      state.access = null;
      state.refresh = null;
    },
  };
  return store;
}

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Call {
  url: string;
  method: string;
  auth: string | null;
  body: unknown;
}

/** Fake server: `handler` decides the response. Records every call. */
function fakeFetch(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    const call: Call = {
      url,
      method: init.method ?? 'GET',
      auth: headers.Authorization ?? null,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const BASE = 'http://api.test/api';

// ---------- tests ----------

test('adds the bearer token and parses JSON', async () => {
  const tokens = memoryTokens('A1', 'R1');
  const f = fakeFetch(() => json(200, { hello: 'world' }));
  const http = createHttpClient({ baseUrl: BASE + '/', tokens, fetchImpl: f.impl });
  const res = await http.get<{ hello: string }>('/users/me/');
  assert.deepEqual(res, { hello: 'world' });
  assert.equal(f.calls[0].url, 'http://api.test/api/users/me/'); // no double slash
  assert.equal(f.calls[0].auth, 'Bearer A1');
});

test('401 -> refreshes once -> retries with the new token and stores the ROTATED refresh token', async () => {
  const tokens = memoryTokens('OLD', 'R1');
  const f = fakeFetch((c) => {
    if (c.url.endsWith('/auth/refresh/')) return json(200, { access: 'NEW', refresh: 'R2' });
    return c.auth === 'Bearer NEW' ? json(200, { ok: true }) : json(401, { detail: 'expired', code: 'token_not_valid' });
  });
  const http = createHttpClient({ baseUrl: BASE, tokens, fetchImpl: f.impl });
  assert.deepEqual(await http.get('/habits/'), { ok: true });
  assert.equal(tokens.state.access, 'NEW');
  assert.equal(tokens.state.refresh, 'R2', 'rotated refresh token must replace the old one');
  assert.equal(f.calls.filter((c) => c.url.endsWith('/auth/refresh/')).length, 1);
  assert.deepEqual(f.calls.find((c) => c.url.endsWith('/auth/refresh/'))?.body, { refresh: 'R1' });
});

test('five parallel 401s share exactly ONE refresh call (single-flight)', async () => {
  const tokens = memoryTokens('OLD', 'R1');
  const f = fakeFetch(async (c) => {
    if (c.url.endsWith('/auth/refresh/')) {
      await new Promise((r) => setTimeout(r, 30)); // slow refresh so the others pile up behind it
      return json(200, { access: 'NEW', refresh: 'R2' });
    }
    return c.auth === 'Bearer NEW' ? json(200, { ok: true }) : json(401, { detail: 'expired' });
  });
  const http = createHttpClient({ baseUrl: BASE, tokens, fetchImpl: f.impl });
  const results = await Promise.all([1, 2, 3, 4, 5].map((i) => http.get(`/habits/${i}/`)));
  assert.equal(results.length, 5);
  assert.equal(f.calls.filter((c) => c.url.endsWith('/auth/refresh/')).length, 1);
});

test('a request that 401s with a stale token retries with the already-refreshed one (no 2nd refresh)', async () => {
  const tokens = memoryTokens('OLD', 'R1');
  const f = fakeFetch(async (c) => {
    if (c.url.endsWith('/auth/refresh/')) return json(200, { access: 'X', refresh: 'X' });
    if (c.auth === 'Bearer OLD') {
      // meanwhile another request finished refreshing:
      tokens.state.access = 'FRESH';
      return json(401, { detail: 'expired' });
    }
    return json(200, { ok: true });
  });
  const http = createHttpClient({ baseUrl: BASE, tokens, fetchImpl: f.impl });
  await http.get('/habits/');
  assert.equal(f.calls.filter((c) => c.url.endsWith('/auth/refresh/')).length, 0);
  assert.equal(f.calls[1].auth, 'Bearer FRESH');
});

test('refresh REJECTED -> tokens cleared, onAuthLost called, 401 thrown', async () => {
  const tokens = memoryTokens('OLD', 'DEAD');
  let lost = 0;
  const f = fakeFetch((c) =>
    c.url.endsWith('/auth/refresh/') ? json(401, { detail: 'Token is invalid or expired', code: 'token_not_valid' }) : json(401, { detail: 'expired' }),
  );
  const http = createHttpClient({ baseUrl: BASE, tokens, fetchImpl: f.impl, onAuthLost: () => lost++ });
  await assert.rejects(http.get('/habits/'), (e: unknown) => e instanceof ApiError && e.status === 401);
  assert.equal(lost, 1);
  assert.equal(tokens.state.access, null);
  assert.equal(tokens.state.refresh, null);
});

test('OFFLINE during refresh -> user is NOT logged out', async () => {
  const tokens = memoryTokens('OLD', 'R1');
  let lost = 0;
  let first = true;
  const f = fakeFetch((c) => {
    if (c.url.endsWith('/auth/refresh/')) throw new TypeError('Network request failed');
    if (first) {
      first = false;
      return json(401, { detail: 'expired' });
    }
    return json(200, {});
  });
  const http = createHttpClient({ baseUrl: BASE, tokens, fetchImpl: f.impl, onAuthLost: () => lost++ });
  await assert.rejects(http.get('/habits/'), (e: unknown) => e instanceof NetworkError);
  assert.equal(lost, 0, 'bad signal must never sign the user out');
  assert.equal(tokens.state.refresh, 'R1', 'refresh token must be kept');
});

test('login with wrong password: no refresh attempt, message comes from `detail`', async () => {
  const tokens = memoryTokens(null, null);
  const f = fakeFetch(() => json(401, { detail: 'No active account found with the given credentials' }));
  const http = createHttpClient({ baseUrl: BASE, tokens, fetchImpl: f.impl });
  await assert.rejects(http.post('/auth/login/', { email: 'a@b.c', password: 'x' }, { auth: false }), (e: unknown) => {
    assert.ok(e instanceof ApiError);
assert.equal(
  e instanceof Error ? e.message : String(e),
  'No active account found with the given credentials',
);
    return true;
  });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].auth, null);
});

test('204 No Content resolves to undefined', async () => {
  const f = fakeFetch(() => new Response(null, { status: 204 }));
  const http = createHttpClient({ baseUrl: BASE, tokens: memoryTokens('A', 'R'), fetchImpl: f.impl });
  assert.equal(await http.post('/devices/unregister/', { push_token: 't' }), undefined);
});

test('timeout surfaces as NetworkError(timeout)', async () => {
  const impl = ((_u: string, init: RequestInit) =>
    new Promise((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;
  const http = createHttpClient({ baseUrl: BASE, tokens: memoryTokens('A', 'R'), fetchImpl: impl, timeoutMs: 25 });
  await assert.rejects(http.get('/habits/'), (e: unknown) => e instanceof NetworkError && e.timeout === true);
});

test('buildQuery skips empty values and encodes the rest; absolute `next` URLs pass through', async () => {
  assert.equal(buildQuery({ a: 1, b: '', c: undefined, d: 'x y' }), '?a=1&d=x%20y');
  assert.equal(buildQuery({}), '');
  const f = fakeFetch(() => json(200, {}));
  const http = createHttpClient({ baseUrl: BASE, tokens: memoryTokens('A', 'R'), fetchImpl: f.impl });
  await http.get('http://api.test/api/habits/?page=2');
  assert.equal(f.calls[0].url, 'http://api.test/api/habits/?page=2');
});

// ---------- DRF error shapes ----------

test('parseApiError: list-style field errors', () => {
  const e = parseApiError(400, { email: ['user with this email already exists.'], password: ['Too short.', 'Too common.'] });
  assert.equal(e.field('email'), 'user with this email already exists.');
  assert.deepEqual(e.fieldErrors.password, ['Too short.', 'Too common.']);
  assert.equal(e.message, 'user with this email already exists.');
});

test('parseApiError: plain-string value (ValidationError({"status": "..."}))', () => {
  const e = parseApiError(400, { status: 'Only pending occurrences can be completed.' });
  assert.equal(e.field('status'), 'Only pending occurrences can be completed.');
  assert.equal(e.message, 'Only pending occurrences can be completed.');
});

test('parseApiError: nested serializer errors are flattened with dots', () => {
  const e = parseApiError(400, { schedule: { weekdays: 'Select at least one weekday.' } });
  assert.equal(e.field('schedule.weekdays'), 'Select at least one weekday.');
});

test('parseApiError: non_field_errors, simplejwt detail, HTML 500, unknown', () => {
  assert.equal(parseApiError(400, { non_field_errors: ['Nope.'] }).message, 'Nope.');
  const jwt = parseApiError(401, { detail: 'Given token not valid', code: 'token_not_valid', messages: [{ x: 1 }] });
  assert.equal(jwt.code, 'token_not_valid');
  assert.equal(jwt.message, 'Given token not valid');
  assert.deepEqual(jwt.fieldErrors, {}, 'detail/code/messages must not leak into fieldErrors');
  const html = parseApiError(500, '<html><body>Server Error (500)</body></html>');
  assert.ok(!html.message.includes('<'), 'raw HTML must never become a user-facing message');
  assert.match(html.message, /something went wrong/i);
  assert.match(parseApiError(404, undefined).message, /could not find/i);
});
