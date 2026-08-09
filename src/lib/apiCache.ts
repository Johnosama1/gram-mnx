// Lightweight client-side request layer for the Mini App.
//
// Goals:
//  - Instant tab navigation: GET responses are cached in memory (SWR style) so
//    revisiting a tab renders from cache immediately instead of waiting on the
//    network.
//  - Never freeze: every request has an abort timeout and network failures are
//    retried once with a short backoff.
//  - Deduplication: concurrent callers of the same URL share a single request.

type Entry = { at: number; status: number; body: string };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();

/** Default freshness window for cached GETs. */
const DEFAULT_TTL = 30_000;
const DEFAULT_TIMEOUT = 12_000;

function keyOf(url: string, init?: RequestInit): string {
  const h = (init?.headers ?? {}) as Record<string, string>;
  // initData is per-user; include a short marker so caches never cross users.
  const id = h['x-init-data'] ? h['x-init-data'].slice(0, 24) : '';
  return `${url}|${id}`;
}

function toResponse(e: Entry): Response {
  return new Response(e.body, {
    status: e.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** fetch() with an abort timeout and one automatic retry on network failure. */
export async function resilientFetch(
  url: string,
  init: RequestInit = {},
  opts: { timeout?: number; retries?: number } = {},
): Promise<Response> {
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  const retries = opts.retries ?? 1;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      // Retry only transient server errors, never 4xx (they are deterministic).
      if (res.status >= 500 && attempt < retries) {
        lastErr = new Error(`HTTP ${res.status}`);
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Network error');
}

async function load(url: string, init: RequestInit, key: string, timeout?: number): Promise<Entry> {
  const res = await resilientFetch(url, init, { timeout });
  const body = await res.text();
  const entry: Entry = { at: Date.now(), status: res.status, body };
  if (res.ok) cache.set(key, entry);
  return entry;
}

/**
 * Cached GET. Returns a Response built from the cache when it is still fresh,
 * otherwise fetches (deduplicating concurrent calls for the same key).
 * `revalidate: true` serves stale data instantly and refreshes in background.
 */
export async function cachedFetch(
  url: string,
  init: RequestInit = {},
  opts: { ttl?: number; timeout?: number; force?: boolean } = {},
): Promise<Response> {
  const ttl = opts.ttl ?? DEFAULT_TTL;
  const key = keyOf(url, init);
  const hit = cache.get(key);

  if (!opts.force && hit) {
    const age = Date.now() - hit.at;
    if (age < ttl) return toResponse(hit);
    // Stale-while-revalidate: hand back stale data now, refresh in background.
    if (!inflight.has(key)) {
      const p = load(url, init, key, opts.timeout).finally(() => inflight.delete(key));
      inflight.set(key, p);
      p.catch(() => undefined);
    }
    return toResponse(hit);
  }

  const existing = inflight.get(key);
  if (existing && !opts.force) return toResponse(await existing);

  const p = load(url, init, key, opts.timeout).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return toResponse(await p);
}

/** Drop cached entries whose URL contains `match` (call after mutations). */
export function invalidateApi(match: string) {
  for (const k of cache.keys()) if (k.includes(match)) cache.delete(k);
}

/** Drop every cached GET (used after destructive admin actions). */
export function invalidateAllApi() {
  cache.clear();
}

// ── Global data-change bus ───────────────────────────────────────────────────
// Mutations announce what changed; contexts/screens refetch their own slice in
// the background so the UI updates instantly without a restart.

export type DataScope = 'user' | 'balance' | 'tasks' | 'combo' | 'wallet' | 'miners' | 'admin';

type Listener = (scopes: DataScope[]) => void;
const listeners = new Set<Listener>();

export function onDataChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Invalidate cached GETs matching the given scopes and notify all subscribers.
 * Always async/non-blocking: listeners run on a microtask, never on the click path.
 */
export function notifyDataChange(...scopes: DataScope[]) {
  const paths: Record<DataScope, string[]> = {
    user: ['/api/telegram/auth'],
    balance: ['/api/telegram/auth', '/api/telegram/swap', '/api/telegram/wallet'],
    tasks: ['/api/tasks'],
    combo: ['/api/tasks?type=combo'],
    wallet: ['/api/telegram/deposit', '/api/telegram/withdraw', '/api/telegram/wallet'],
    miners: ['/api/telegram/miners', '/api/store/settings'],
    admin: [],
  };
  for (const s of scopes) for (const p of paths[s] ?? []) invalidateApi(p);
  if (scopes.includes('admin')) invalidateAllApi();
  queueMicrotask(() => {
    for (const fn of listeners) {
      try { fn(scopes); } catch { /* a broken listener must never break a claim */ }
    }
  });
}

/** Warm the cache for a URL without blocking the caller. */
export function prefetchApi(url: string, init: RequestInit = {}, ttl = DEFAULT_TTL) {
  cachedFetch(url, init, { ttl }).catch(() => undefined);
}

