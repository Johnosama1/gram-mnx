import { resilientFetch } from './apiCache';

// Shared helpers for talking to the API server from the Mini App.
//
// In development (Vite dev server), always use relative paths so requests
// go through the Vite proxy (/api → localhost:8080). VITE_API_URL is ignored
// in dev to avoid pointing at an old/wrong deployment URL.
// In production, VITE_API_URL can point at the API server's absolute origin
// when the frontend and API are hosted separately.
export const API_BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL ?? '');

/** Language currently applied to the document (set by LanguageContext). */
export function getUiLang(): 'en' | 'ar' | 'ru' {
  const l = typeof document !== 'undefined' ? document.documentElement.lang : '';
  return l === 'ar' || l === 'ru' ? l : 'en';
}

export function getInitData(): string {
  return window.Telegram?.WebApp?.initData ?? '';
}

/** POSTs to an /api/telegram/* endpoint, always including the raw initData
 *  so the Backend can verify the caller's Telegram identity server-side. */
export async function telegramApiPost<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  // Mutations are never auto-retried (they are not idempotent) but they do get
  // an abort timeout so the UI can never hang forever on a stalled connection.
  const res = await resilientFetch(`${API_BASE}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-lang': getUiLang() },
    body: JSON.stringify({ initData: getInitData(), lang: getUiLang(), ...body }),
  }, { timeout: 25_000, retries: 0 });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text;
    try {
      const payload = JSON.parse(text) as { message?: unknown };
      if (typeof payload.message === 'string') message = payload.message;
    } catch {
      // Keep a plain-text server error as-is.
    }
    throw new Error(message || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}
