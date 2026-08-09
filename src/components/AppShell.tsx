import React, { useEffect } from 'react';
import { Outlet, useRouter } from '@tanstack/react-router';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import BottomNav from './BottomNav';
import ScreenErrorBoundary from './ScreenErrorBoundary';
import { WalletProvider } from '@/context/WalletContext';
import { prefetchApi } from '@/lib/apiCache';
import { API_BASE, getInitData } from '@/lib/telegramApi';
import { TelegramUserProvider, useTelegramUser } from '@/context/TelegramUserContext';
import { LanguageProvider } from '@/context/LanguageContext';
import { useLanguage } from '@/context/LanguageContext';
import { CoinsProvider } from '@/context/CoinsContext';
import { MinersProvider } from '@/context/MinersContext';
import mineBgAsset from '@/assets/mine-scene.png.asset.json';
const mineBgImg = mineBgAsset.url;

const manifestUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/tonconnect-manifest.json`;

function useAppHeight() {
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    tg?.ready?.();
    tg?.expand?.();

    let lastApplied = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const measure = () => {
      const stable = tg?.viewportStableHeight ?? 0;
      const current = tg?.viewportHeight ?? 0;
      const inner = window.innerHeight ?? 0;
      // Prefer the stable height; ignore transient values reported while the
      // mini app is being restored (Telegram briefly reports a collapsed size).
      const candidates = [stable, current, inner].filter((v) => v > 200);
      return candidates.length ? Math.max(...candidates) : 0;
    };

    const applyHeight = () => {
      // While hidden Telegram reports stale sizes — skip and re-apply on resume.
      if (document.visibilityState === 'hidden') return;
      const h = measure();
      if (h > 200 && Math.abs(h - lastApplied) > 1) {
        lastApplied = h;
        document.documentElement.style.setProperty('--app-height', `${h}px`);
      }
    };

    // Several passes: Telegram settles its viewport a few hundred ms after resume.
    const scheduleBurst = () => {
      applyHeight();
      requestAnimationFrame(applyHeight);
      [60, 180, 350, 700, 1200].forEach((ms) => timers.push(setTimeout(applyHeight, ms)));
    };

    const onResume = () => {
      if (document.visibilityState !== 'visible') return;
      tg?.expand?.();
      lastApplied = 0; // force re-write so the layout is recalculated
      scheduleBurst();
    };

    scheduleBurst();

    tg?.onEvent?.('viewportChanged', applyHeight);
    window.addEventListener('resize', applyHeight);
    window.addEventListener('orientationchange', onResume);
    window.addEventListener('focus', onResume);
    window.addEventListener('pageshow', onResume);
    document.addEventListener('visibilitychange', onResume);

    return () => {
      timers.forEach(clearTimeout);
      tg?.offEvent?.('viewportChanged', applyHeight);
      window.removeEventListener('resize', applyHeight);
      window.removeEventListener('orientationchange', onResume);
      window.removeEventListener('focus', onResume);
      window.removeEventListener('pageshow', onResume);
      document.removeEventListener('visibilitychange', onResume);
    };
  }, []);

}

function AppWithLanguage({ children }: { children: React.ReactNode }) {
  const { user } = useTelegramUser();
  return <LanguageProvider userId={user?.id}>{children}</LanguageProvider>;
}

export function LoadingScreen() {
  return (
    <div
      className="flex flex-col items-center justify-center h-full w-full min-h-screen gap-4"
      style={{ backgroundColor: '#0a0b14' }}
    >
      <div className="w-16 h-16 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      <span className="text-primary font-bold text-lg tracking-widest animate-pulse">GRAM MNX</span>
    </div>
  );
}

function ChannelGate() {
  const { notJoinedChannels, recheckChannels } = useTelegramUser();
  const { t } = useLanguage();
  const [checking, setChecking] = React.useState(false);

  const handleRecheck = async () => {
    setChecking(true);
    try {
      await recheckChannels();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      className="flex flex-col items-center justify-center h-full w-full px-6 gap-5"
      style={{ backgroundColor: '#0a0b14' }}
    >
      <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
        <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185z"
          />
        </svg>
      </div>

      <div className="text-center">
        <h2 className="text-white font-black text-xl mb-1">{t('gate_title')}</h2>
        <p className="text-muted-foreground text-sm">{t('gate_desc')}</p>
      </div>

      <div className="w-full space-y-2.5">
        {notJoinedChannels.map((ch) => (
          <a
            key={ch.channelUsername}
            href={`https://t.me/${ch.channelUsername}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3.5 hover:border-primary/40 hover:bg-white/10 transition-all group"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-primary" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.88 13.47l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.834.95-.001 0-.001.001-.002.001l.466-.002z" />
                </svg>
              </div>
              <span className="text-white font-bold text-sm">{ch.channelName || `@${ch.channelUsername}`}</span>
            </div>
            <span className="text-primary text-xs font-bold group-hover:translate-x-0.5 transition-transform">{t('gate_subscribe')}</span>
          </a>
        ))}
      </div>

      <button
        onClick={handleRecheck}
        disabled={checking}
        className="w-full bg-primary text-black font-black rounded-2xl py-3.5 text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-opacity"
      >
        {checking ? (
          <>
            <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
            {t('gate_checking')}
          </>
        ) : (
          t('gate_recheck')
        )}
      </button>
    </div>
  );
}

function MaintenanceScreen({ message }: { message: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center h-full w-full px-8 gap-4 text-center"
      style={{ backgroundColor: '#0a0b14' }}
    >
      <div className="text-5xl">🔧</div>
      <h2 className="text-white font-black text-xl">GRAM MNX</h2>
      <p className="text-muted-foreground text-sm whitespace-pre-line">{message}</p>
    </div>
  );
}

function Shell() {
  const { isAdmin, isLoading, notJoinedChannels, maintenance, maintenanceMessage } =
    useTelegramUser();
  const router = useRouter();

  // Warm up tab chunks + their read-only data once the first screen is idle so
  // switching tabs renders from cache instead of waiting on the network.
  const ready = !isLoading && !maintenance && notJoinedChannels.length === 0;
  useEffect(() => {
    if (!ready) return;
    const run = () => {
      const tabs = ['/', '/miners', '/tasks', '/combo', '/friends', '/profile'] as const;
      tabs.forEach((to) => { void router.preloadRoute({ to }).catch(() => undefined); });

      const initData = getInitData();
      const headers = initData ? { 'x-init-data': initData } : undefined;
      prefetchApi(`${API_BASE}/api/tasks`);
      prefetchApi(`${API_BASE}/api/store/settings`);
      prefetchApi(`${API_BASE}/api/telegram/deposit/config`);
      prefetchApi(`${API_BASE}/api/leaderboard`);
      if (headers) {
        prefetchApi(`${API_BASE}/api/tasks/completed`, { headers });
        prefetchApi(`${API_BASE}/api/tasks/checkin`, { headers });
        prefetchApi(`${API_BASE}/api/telegram/referrals`, { headers });
      }
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const id = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 3000 }) : window.setTimeout(run, 1200);
    return () => {
      const cancel = (window as Window & { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (cancel) cancel(id); else clearTimeout(id);
    };
  }, [ready, router]);

  // Block text selection / copy / long-press menu everywhere except inputs.
  useEffect(() => {
    const isEditable = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    const block = (e: Event) => {
      if (!isEditable(e.target)) e.preventDefault();
    };
    document.addEventListener('contextmenu', block);
    document.addEventListener('copy', block);
    document.addEventListener('cut', block);
    document.addEventListener('selectstart', block);
    return () => {
      document.removeEventListener('contextmenu', block);
      document.removeEventListener('copy', block);
      document.removeEventListener('cut', block);
      document.removeEventListener('selectstart', block);
    };
  }, []);

  return (
    <div
      className="app-shell flex flex-col w-full max-w-[640px] mx-auto relative shadow-2xl overflow-hidden"
      style={{
        backgroundImage: `url(${mineBgImg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'scroll',
      }}
    >
      {/* Static dark veil so cards, text and buttons stay readable on every screen */}
      <div
        aria-hidden
        className="absolute inset-0 z-0 pointer-events-none"
        style={{ background: 'linear-gradient(180deg, rgba(6,8,14,0.62), rgba(6,8,14,0.78))' }}
      />

      {isLoading ? (
        <LoadingScreen />
      ) : maintenance && !isAdmin ? (
        <MaintenanceScreen
          message={maintenanceMessage || '🔧 The app is under maintenance, please try again later.'}
        />
      ) : notJoinedChannels.length > 0 ? (
        <ChannelGate />
      ) : (
        <>
          <div
            className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain relative z-10 [-webkit-overflow-scrolling:touch]"
            style={{
              paddingTop: 'env(safe-area-inset-top, 0px)',
              paddingBottom: 'var(--nav-height)',
            }}
          >
            <ScreenErrorBoundary>
              <Outlet />
            </ScreenErrorBoundary>
          </div>
          <BottomNav showAdmin={isAdmin} />
        </>
      )}
    </div>
  );
}

export default function AppShell() {
  useAppHeight();

  return (
    <TonConnectUIProvider manifestUrl={manifestUrl}>
      <TelegramUserProvider>
        <AppWithLanguage>
          <CoinsProvider>
            <WalletProvider>
              <MinersProvider>
                <div className="app-shell bg-black flex items-center justify-center overflow-hidden">
                  <Shell />
                </div>
              </MinersProvider>
            </WalletProvider>
          </CoinsProvider>
        </AppWithLanguage>
      </TelegramUserProvider>
    </TonConnectUIProvider>
  );
}
