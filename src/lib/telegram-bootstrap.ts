export type TelegramBootstrapResult =
  | { status: 'ready'; initData: string; unsafeUserId: number | null }
  | { status: 'unavailable'; initData: ''; unsafeUserId: null };

let bootstrapPromise: Promise<TelegramBootstrapResult> | null = null;

function loadTelegramSdk(): void {
  if (document.querySelector('script[data-telegram-web-app-sdk]')) return;
  const script = document.createElement('script');
  script.src = 'https://telegram.org/js/telegram-web-app.js';
  script.async = true;
  script.dataset.telegramWebAppSdk = 'true';
  document.head.appendChild(script);
}

/** Waits for Telegram's bridge before any authenticated API request is made. */
export function initializeTelegramWebApp(timeoutMs = 15_000): Promise<TelegramBootstrapResult> {
  if (typeof window === 'undefined') {
    return Promise.resolve({ status: 'unavailable', initData: '', unsafeUserId: null });
  }
  if (bootstrapPromise) return bootstrapPromise;

  const promise = new Promise<TelegramBootstrapResult>((resolve) => {
    const startedAt = Date.now();
    let sdkInjected = false;

    const finish = () => {
      const webApp = window.Telegram?.WebApp;
      const initData = webApp?.initData ?? '';
      if (webApp && initData) {
        webApp.ready?.();
        webApp.expand?.();
        resolve({
          status: 'ready',
          initData,
          unsafeUserId:
            typeof webApp.initDataUnsafe?.user?.id === 'number'
              ? webApp.initDataUnsafe.user.id
              : null,
        });
        return true;
      }

      if (!sdkInjected && Date.now() - startedAt > 1_000) {
        sdkInjected = true;
        loadTelegramSdk();
      }
      if (Date.now() - startedAt >= timeoutMs) {
        // Never cache a failure: the SDK may still arrive (slow network, cold
        // start), and the retry button re-runs this without a page reload.
        bootstrapPromise = null;
        resolve({ status: 'unavailable', initData: '', unsafeUserId: null });
        return true;
      }
      return false;
    };

    if (finish()) return;
    const timer = window.setInterval(() => {
      if (finish()) window.clearInterval(timer);
    }, 100);
  });

  bootstrapPromise = promise;
  return promise;
}

/** Drops any cached bootstrap state so the Telegram bridge is probed again. */
export function resetTelegramBootstrap(): void {
  bootstrapPromise = null;
}

export async function requireTelegramInitData(): Promise<string> {
  const result = await initializeTelegramWebApp();
  if (result.status !== 'ready') {
    throw new Error('TELEGRAM_AUTH_REQUIRED');
  }
  return result.initData;
}
