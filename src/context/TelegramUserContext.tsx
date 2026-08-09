import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { API_BASE } from '@/lib/telegramApi';
import { onDataChange } from '@/lib/apiCache';


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
  isAdmin: boolean;
  isLoading: boolean;
  notJoinedChannels: UnsubscribedChannel[];
  maintenance: boolean;
  maintenanceMessage: string;
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
  const cached = typeof window !== 'undefined' ? readSnapshot() : null;

  const [user, setUser] = useState<TelegramUser | null>(cached?.user ?? null);
  const [isVerified, setIsVerified] = useState(Boolean(cached));
  const [isAdmin, setIsAdmin] = useState(cached?.isAdmin ?? false);
  // With a cached snapshot we render instantly and revalidate in the background.
  const [isLoading, setIsLoading] = useState(!cached);
  const [notJoinedChannels, setNotJoinedChannels] = useState<UnsubscribedChannel[]>(
    cached?.notJoinedChannels ?? [],
  );
  // Maintenance is NEVER restored from cache: it must always be re-checked live
  // so a user who once saw the maintenance screen isn't locked out afterwards.
  const [maintenance, setMaintenance] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState(cached?.maintenanceMessage ?? '');
  const lastAuthAt = useRef(0);

  const doAuth = useCallback(async (initData: string) => {
    const res = await fetch(`${API_BASE}/api/telegram/auth?t=${Date.now()}`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify({ initData }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

      writeSnapshot({
        user: data.user,
        isAdmin: data.isAdmin === true,
        notJoinedChannels: channels,
        maintenance: data.maintenance === true,
        maintenanceMessage: String(data.maintenanceMessage ?? ''),
      });
    }
  }, []);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;

    // ── Step 1: show the real name + admin flag IMMEDIATELY from initDataUnsafe
    const ADMIN_IDS = [6145230334, 868999453];
    const unsafeUser = tg?.initDataUnsafe?.user;
    const unsafeId = unsafeUser?.id;
    if (unsafeUser && typeof unsafeId === 'number') {
      setUser((prev) =>
        prev?.id === unsafeId
          ? prev
          : {
              id: unsafeId,
              first_name: unsafeUser.first_name,
              last_name: unsafeUser.last_name,
              username: unsafeUser.username,
              balance: 0,
            },
      );
      setIsAdmin((prev) => prev || ADMIN_IDS.includes(unsafeId));
    }

    // ── Step 2: verify server-side and fetch the persisted DB balance ────────
    const initData = tg?.initData;

    if (!initData) {
      setIsLoading(false);
      return;
    }

    // Safety valve: never leave the user on a loading screen forever.
    const safetyTimer = setTimeout(() => setIsLoading(false), 8000);

    doAuth(initData)
      .catch((err) => {
        console.warn('Telegram auth sync failed (showing cached state):', err);
      })
      .finally(() => {
        clearTimeout(safetyTimer);
        setIsLoading(false);
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
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, [doAuth]);

  // While the maintenance screen is up, keep polling so the app unlocks by
  // itself (no restart / no cache clear) the moment the admin turns it off.
  useEffect(() => {
    if (!maintenance) return;
    const id = setInterval(() => {
      const initData = window.Telegram?.WebApp?.initData;
      if (initData) doAuth(initData).catch(() => undefined);
    }, 15_000);
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
        isAdmin,
        isLoading,
        notJoinedChannels,
        maintenance,
        maintenanceMessage,
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
