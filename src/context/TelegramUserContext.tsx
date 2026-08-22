import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { API_BASE } from '@/lib/telegramApi';
import { onDataChange } from '@/lib/apiCache';
import { initializeTelegramWebApp } from '@/lib/telegram-bootstrap';
import { getDeviceId } from '@/lib/device-fingerprint';


type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  /** gram balance persisted in the DB, as of the last /telegram/auth sync. */
  balance?: number;
  /** coin balance persisted in the DB (used for miner purchases). */
  coins?: number;
};

export type UnsubscribedChannel = {
  channelUsername: string;
  channelName: string;
};

type TelegramUserContextType = {
  user: TelegramUser | null;
  avatarUrl: string | null;
  isVerified: boolean;
  /** Server said this Telegram account is banned (403 from the API guard). */
  isBanned: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  notJoinedChannels: UnsubscribedChannel[];
  maintenance: boolean;
  maintenanceMessage: string;
  /** Admin-controlled visibility of the "Sending currencies" section on Profile. */
  sendCurrenciesVisible: boolean;
  recheckChannels: () => Promise<void>;
  /** Re-sync user (balance, admin flag, maintenance) from the server. */
  refreshUser: () => Promise<void>;
};


const TelegramUserContext = createContext<TelegramUserContextType | null>(null);

/** Cached auth snapshot so re-opening the mini app never shows a loading screen. */
type AuthSnapshot = {
  user: TelegramUser;
  isAdmin: boolean;
  notJoinedChannels: UnsubscribedChannel[];
  maintenance: boolean;
  maintenanceMessage: string;
  sendCurrenciesVisible: boolean;
  savedAt: number;
};

const CACHE_PREFIX = 'gm_auth_cache_';

function cacheKey(): string | null {
  const id =
    typeof window !== 'undefined' ? window.Telegram?.WebApp?.initDataUnsafe?.user?.id : null;
  return id ? `${CACHE_PREFIX}${id}` : null;
}

function readSnapshot(): AuthSnapshot | null {
  try {
    const key = cacheKey();
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSnapshot;
    return parsed?.user?.id ? parsed : null;
  } catch {
    return null;
  }
}

function writeSnapshot(snap: Omit<AuthSnapshot, 'savedAt'>) {
  try {
    const key = cacheKey();
    if (key) localStorage.setItem(key, JSON.stringify({ ...snap, savedAt: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function TelegramUserProvider({ children }: { children: React.ReactNode }) {
  // Cached data is display-only. It never marks a Telegram identity as verified;
  // authenticated providers and API calls wait for the server handshake below.
  const cached = typeof window !== 'undefined' ? readSnapshot() : null;

  const [user, setUser] = useState<TelegramUser | null>(cached?.user ?? null);
  const [isVerified, setIsVerified] = useState(false);
  const [isBanned, setIsBanned] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  // With a cached snapshot we render instantly and revalidate in the background.
  const [isLoading, setIsLoading] = useState(true);
  const [notJoinedChannels, setNotJoinedChannels] = useState<UnsubscribedChannel[]>(
    cached?.notJoinedChannels ?? [],
  );
  // Maintenance is NEVER restored from cache: it must always be re-checked live
  // so a user who once saw the maintenance screen isn't locked out afterwards.
  const [maintenance, setMaintenance] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState(cached?.maintenanceMessage ?? '');
  const [sendCurrenciesVisible, setSendCurrenciesVisible] = useState(
    cached?.sendCurrenciesVisible ?? true,
  );
  const lastAuthAt = useRef(0);

  const doAuth = useCallback(async (initData: string) => {
    const res = await fetch(`${API_BASE}/api/telegram/auth?t=${Date.now()}`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'x-device-id': getDeviceId(),
      },
      credentials: 'include',
      body: JSON.stringify({ initData }),
    });
    if (res.status === 403) {
      setIsBanned(true);
      setIsVerified(false);
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setIsBanned(false);
    const data = await res.json();
    if (data?.user) {
      const channels = Array.isArray(data.notJoinedChannels) ? data.notJoinedChannels : [];
      const admin = data.isAdmin === true;
      lastAuthAt.current = Date.now();
      setUser(data.user);
      setIsVerified(true);
      setIsAdmin(admin);
      setNotJoinedChannels(channels);
      // Admins can never be locked out by maintenance mode.
      setMaintenance(!admin && data.maintenance === true);
      setMaintenanceMessage(String(data.maintenanceMessage ?? ''));
      setSendCurrenciesVisible(data.sendCurrenciesVisible !== false);

      writeSnapshot({
        user: data.user,
        isAdmin: data.isAdmin === true,
        notJoinedChannels: channels,
        maintenance: data.maintenance === true,
        maintenanceMessage: String(data.maintenanceMessage ?? ''),
        sendCurrenciesVisible: data.sendCurrenciesVisible !== false,
      });
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    void initializeTelegramWebApp()
      .then(async (bootstrap) => {
        if (disposed || bootstrap.status !== 'ready') return;
        await doAuth(bootstrap.initData);
      })
      .catch((err) => {
        console.error('[telegram-auth] initialization failed', err);
        if (!disposed) {
          setUser(null);
          setIsVerified(false);
          setIsAdmin(false);
        }
      })
      .finally(() => {
        if (!disposed) setIsLoading(false);
      });

    // ── Step 3: silent background refresh when the app returns to foreground ─
    // No page reload: the React state stays alive, we only revalidate the data
    // and only when it's actually stale (older than 60 s).
    const REVALIDATE_AFTER = 60_000;

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastAuthAt.current < REVALIDATE_AFTER) return;
      const currentInitData = window.Telegram?.WebApp?.initData;
      if (currentInitData) doAuth(currentInitData).catch(() => {});
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, [doAuth]);

  // Keep the user's balance/coins fresh on their own while the app stays
  // open — a task reward, a deposit the background scanner just credited, an
  // admin action, etc. all happen server-side with nothing on this client to
  // trigger onDataChange, so without this the user would have to background
  // and refocus (or hard-reload) the app to see it. Only polls while the tab
  // is actually visible. During maintenance this also doubles as the
  // "unlock the moment the admin turns it back on" check, so it runs faster.
  useEffect(() => {
    const intervalMs = maintenance ? 15_000 : 20_000;
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const initData = window.Telegram?.WebApp?.initData;
      if (initData) doAuth(initData).catch(() => undefined);
    }, intervalMs);
    return () => clearInterval(id);
  }, [maintenance, doAuth]);

  /** Re-calls auth endpoint; used by the channel gate "Check again" button. */
  const recheckChannels = useCallback(async () => {
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData) return;
    await doAuth(initData);
  }, [doAuth]);

  const refreshUser = useCallback(async () => {
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData) return;
    await doAuth(initData).catch(() => undefined);
  }, [doAuth]);

  // Any mutation that touches the user (task claim, combo, deposit/withdraw,
  // admin reset) re-syncs the profile in the background — never blocking the UI.
  useEffect(() => onDataChange((scopes) => {
    if (scopes.some((s) => s === 'user' || s === 'balance' || s === 'admin' || s === 'wallet')) {
      refreshUser();
    }
  }), [refreshUser]);

  const avatarUrl = user?.id ? `${API_BASE}/api/telegram/avatar/${user.id}` : null;

  return (
    <TelegramUserContext.Provider
      value={{
        user,
        avatarUrl,
        isVerified,
        isBanned,
        isAdmin,
        isLoading,
        notJoinedChannels,
        maintenance,
        maintenanceMessage,
        sendCurrenciesVisible,
        recheckChannels,
        refreshUser,
      }}
    >

      {children}
    </TelegramUserContext.Provider>
  );
}

export function useTelegramUser() {
  const ctx = useContext(TelegramUserContext);
  if (!ctx) throw new Error('useTelegramUser must be used within TelegramUserProvider');
  return ctx;
}
