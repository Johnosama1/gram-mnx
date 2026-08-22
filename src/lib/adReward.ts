/**
 * Dedicated "ad completed" reporting path.
 *
 * Every rewarded-ad placement (Monetag or AdsGram) funnels its completion
 * callback through here instead of using the generic mutation helper, so:
 *  - the request always carries fresh, valid Telegram initData (an expired or
 *    missing initData used to surface to the user as "Server is busy");
 *  - the specific ad/task id is always sent with the callback;
 *  - a transient server error (429/503/5xx) or network blip is retried once
 *    after 2s instead of losing the reward for an ad the user actually watched;
 *  - the caller gets a typed reason it can turn into a precise message.
 */
import { API_BASE, getUiLang } from './telegramApi';
import { requireTelegramInitData } from './telegram-bootstrap';

export type AdProvider = 'monetag' | 'adsgram';

export class AdRewardError extends Error {
  constructor(
    public readonly reason: 'auth' | 'network' | 'limit' | 'server',
    message: string,
    public readonly status = 0,
  ) {
    super(message);
    this.name = 'AdRewardError';
  }
}

export interface AdCompletionResult {
  ok: boolean;
  coinsEarned?: number;
  remainingToday?: number;
  dailyLimit?: number;
  message?: string;
}

const RETRY_DELAY_MS = 2000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Posts an ad-completion callback for `taskId` to `path`.
 * Retries exactly once, 2s later, on a transient failure.
 */
export async function reportAdCompletion(
  path: string,
  taskId: string,
  provider: AdProvider,
  body: Record<string, unknown> = {},
): Promise<AdCompletionResult> {
  let lastError: AdRewardError | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);

    // Re-resolved on every attempt: initData can be refreshed between tries.
    let initData: string;
    try {
      initData = await requireTelegramInitData();
    } catch {
      lastError = new AdRewardError('auth', 'telegram_auth_unavailable');
      continue;
    }

    let res: Response;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20_000);
      try {
        res = await fetch(`${API_BASE}/api${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-lang': getUiLang(),
            'x-init-data': initData,
          },
          credentials: 'include',
          signal: ctrl.signal,
          body: JSON.stringify({ lang: getUiLang(), taskId, adProvider: provider, ...body }),
        });
      } finally {
        clearTimeout(timer);
      }
    } catch {
      lastError = new AdRewardError('network', 'network_error');
      continue;
    }

    const text = await res.text().catch(() => '');
    let payload: AdCompletionResult = {};
    try {
      payload = text ? (JSON.parse(text) as AdCompletionResult) : {};
    } catch {
      /* non-JSON body — handled by the status checks below */
    }

    if (res.ok) return payload;

    if (res.status === 400 && /limit/i.test(payload.message ?? '')) {
      throw new AdRewardError('limit', payload.message ?? 'daily limit reached', res.status);
    }
    if (res.status === 401 || res.status === 403) {
      lastError = new AdRewardError('auth', payload.message ?? 'unauthorized', res.status);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      lastError = new AdRewardError('network', payload.message ?? 'server_unavailable', res.status);
      continue;
    }
    throw new AdRewardError('server', payload.message ?? `request_failed_${res.status}`, res.status);
  }

  throw lastError ?? new AdRewardError('server', 'ad_report_failed');
}
