/**
 * Client-side plumbing (NOT a security control): makes sure every request to
 * an /api/* endpoint carries the raw Telegram initData string so the server
 * can verify the caller's identity. The actual enforcement happens on the
 * server; this only ensures legitimate Mini App traffic is authenticated.
 */
const PATCH_FLAG = '__gmApiAuthPatched';

export function installApiAuth(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Record<string, unknown>;
  if (w[PATCH_FLAG]) return;
  w[PATCH_FLAG] = true;

  const original = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      const isApi = /^\/api\//.test(url) || /^https?:\/\/[^/]+\/api\//.test(url);
      if (isApi) {
        const initData = window.Telegram?.WebApp?.initData ?? '';
        if (initData) {
          const headers = new Headers(
            init?.headers ?? (input instanceof Request ? input.headers : undefined),
          );
          if (!headers.has('x-init-data')) headers.set('x-init-data', initData);
          return original(input as RequestInfo, { ...init, headers, credentials: 'include' });
        }
      }
    } catch {
      /* fall through to a plain fetch */
    }
    return original(input as RequestInfo, init);
  }) as typeof window.fetch;
}
