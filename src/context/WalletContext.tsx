import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { cachedFetch, notifyDataChange, onDataChange } from '@/lib/apiCache';
import { telegramApiPost, API_BASE, getInitData } from '@/lib/telegramApi';
import { useTelegramUser } from './TelegramUserContext';

type WalletContextType = {
  holdingWallet: number;
  poolWallet: number;
  sessionEarnings: number;
  referralBalance: number;
  walletAddress: string | null;
  minerLevel: number;
  referralCode: string;
  referralCount: number;
  isClaiming: boolean;
  claimError: string | null;
  /** True while a 24h mining session is running */
  isMiningActive: boolean;
  /** Seconds left in the current 24h mining session */
  miningRemainingMs: number;
  isStartingMining: boolean;
  /** Coin balance frozen at the start of the current cycle (drives the 24h rate) */
  miningCoins: number;
  /** Server-authoritative gram/second rate (= 24h target / 86,400) */
  miningRatePerSecond: number;
  miningDailyPct: number;
  /** Exact gram amount that accrues over a full 24h cycle at the current rate */
  daily24hEarned: number;
  /** Admin switch — hides the StartMiner button when false */
  showMiningButton: boolean;
  startMining: () => void;
  claimEarnings: () => void;
  connectWallet: (address: string) => void;
  addReferral: () => void;
  refreshReferrals: () => void;
  addClickEarning: (amount: number) => void;
  syncBalance: (balance: number) => void;
};

const WalletContext = createContext<WalletContextType | null>(null);

/** Returns a per-user localStorage key so different Telegram accounts
 *  stored on the same device never share the same balance. */
function getLsKey(suffix: string): string {
  const tgId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  return tgId ? `gmr_${suffix}_${tgId}` : `gmr_${suffix}`;
}

function getStoredBalance(): number {
  try {
    const v = localStorage.getItem(getLsKey('holding_balance'));
    if (v === null) return 0;
    const n = Number(v);
    // Guard: Number("NaN") = NaN, Number("null") = NaN, Number("undefined") = NaN
    // isFinite rejects NaN, +Infinity, -Infinity — all invalid balances.
    return Number.isFinite(n) ? n : 0;
  } catch { return 0; }
}

/** Write-through helper. Silently drops writes where val is not a valid finite
 *  number — this is the single choke-point that prevents "NaN" / "null" /
 *  "undefined" strings from ever entering localStorage and becoming permanent. */
function storeBalance(val: number) {
  try {
    if (!Number.isFinite(val)) return; // never write NaN / Infinity
    localStorage.setItem(getLsKey('holding_balance'), String(val));
  } catch {}
}

function getStoredWallet(): string | null {
  try { return localStorage.getItem(getLsKey('wallet_address')); } catch { return null; }
}

function storeWallet(addr: string | null) {
  try {
    if (addr) localStorage.setItem(getLsKey('wallet_address'), addr);
    else localStorage.removeItem(getLsKey('wallet_address'));
  } catch {}
}

/** Last accrued mining value, cached per user so reopening the app never
 *  flashes 0 before the server response arrives. */
function getStoredAccrued(): number {
  try {
    const n = Number(localStorage.getItem(getLsKey('session_accrued')));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return 0; }
}

function storeAccrued(val: number) {
  try {
    if (!Number.isFinite(val) || val < 0) return;
    localStorage.setItem(getLsKey('session_accrued'), String(val));
  } catch {}
}

/** Referral code is just the Telegram user ID (plain number string).
 *  Format: https://t.me/BotName?start=<userId>
 *  This is the canonical format — gram address, no prefix required. */
function generateCode(): string {
  const tgId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  return tgId ? String(tgId) : '';
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { user, isVerified } = useTelegramUser();

  const [holdingWallet, setHoldingWalletRaw] = useState<number>(getStoredBalance);
  const [poolWallet]       = useState(0);
  const [sessionEarnings, setSessionEarnings] = useState<number>(getStoredAccrued);

  const [referralBalance, setReferralBalance] = useState(0);
  const [walletAddress, setWalletAddressState] = useState<string | null>(getStoredWallet);
  const [minerLevel]     = useState(1);
  const [referralCode]   = useState(() => generateCode());
  const [referralCount, setReferralCount] = useState(0);
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [isMiningActive, setIsMiningActive] = useState(false);
  const [miningRemainingMs, setMiningRemainingMs] = useState(0);
  const [isStartingMining, setIsStartingMining] = useState(false);
  const [miningCoins, setMiningCoins] = useState(0);
  const [miningRatePerSecond, setMiningRatePerSecond] = useState(0);
  const [miningDailyPct, setMiningDailyPct] = useState(5);
  const miningDailyPctRef = useRef(5);
  // Hidden until the server confirms it should be visible — prevents the
  // button from flashing on app open when the admin has it turned off.
  const [showMiningButton, setShowMiningButton] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('gm_mining_button_enabled') === '1';
  });

  // Write-through: state + localStorage in sync.
  // Sanitises the value before writing: NaN / Infinity can slip in from a
  // null/undefined API response (typeof null === 'object', typeof NaN === 'number')
  // so we clamp to 0 here as the single choke-point for the entire context.
  const setHoldingWallet = useCallback((val: number) => {
    const safe = Number.isFinite(val) ? val : 0;
    storeBalance(safe);
    setHoldingWalletRaw(safe);
  }, []);

  const connectWallet = useCallback((address: string) => {
    const addr = address || null;
    storeWallet(addr);
    setWalletAddressState(addr);
  }, []);

  // Sync with server balance whenever auth resolves (on mount and on every
  // visibility-change re-auth so the balance stays fresh after the app is
  // re-opened from the background).
  // The server is always the authoritative source of truth. Never merge a
  // locally cached balance into the spendable balance: a previous withdrawal
  // may already have reduced the DB balance while localStorage still contains
  // the old value, which would make the UI advertise money that cannot be
  // withdrawn. Live mining is displayed separately as sessionEarnings and is
  // settled by the server before a withdrawal.
  const seededFromServer = useRef(false);
  useEffect(() => {
    if (!isVerified) return;
    // typeof NaN === 'number' is TRUE — we must use isFinite, not typeof.
    const serverBalance = Number(user?.balance);
    if (!Number.isFinite(serverBalance)) return;
    seededFromServer.current = true;
    setHoldingWallet(serverBalance);
  }, [isVerified, user?.balance, setHoldingWallet]);

  // Load referrals from server
  const fetchReferrals = useCallback(async () => {
    const initData = getInitData();
    if (!initData) return;
    try {
      const res = await cachedFetch(`${API_BASE}/api/telegram/referrals`, {
        headers: { 'x-init-data': initData },
      });
      if (!res.ok) return;
      const data = await res.json() as { count: number; reward: number };
      setReferralCount(data.count ?? 0);
      setReferralBalance(data.reward ?? 0);
    } catch { /* best-effort */ }
  }, []);

  useEffect(() => {
    if (isVerified) fetchReferrals();
  }, [isVerified, fetchReferrals]);

  // Passive earnings — CONTINUOUS coin-based mining:
  //   daily_income (gram) = coins / 14_000   (700 coin = 1 gram, 5 % daily)
  //   per-second          = daily / 86_400
  //   0 coins → 0 mining (no tick increments balance)
  //
  // Accrual is TIME-based and continues even while the app is closed. The
  // server is the source of truth for lastMiningAt: on auth we fetch the
  // server-computed accrued value (elapsed since last claim, capped at 24h),
  // seed sessionEarnings with it, and then the 1s ticker keeps incrementing
  // ONLY until total elapsed reaches 24h — after which mining freezes until the
  // user claims (which resets the cycle on the server).
  //
  const MINING_CAP_SECONDS = 86_400; // 24h cap — mining stops here until claim

  // Tracks elapsed accrual seconds since the last claim (seeded from server).
  // Used to freeze the ticker once we hit the 24h cap.
  const elapsedSecondsRef = useRef(0);
  // Server-authoritative coins used for the accrual rate. localStorage can be
  // empty on a fresh WebView, which used to freeze the ticker at zero.
  const serverCoinsRef = useRef(0);
  const serverMiningRateRef = useRef(0);
  const hasServerMiningBaselineRef = useRef(false);

  // Pull the server-authoritative accrued value. This captures earnings while
  // the app is closed and also re-syncs when Telegram restores a kept-alive WebView.
  const refreshAccrued = useCallback(async () => {
    const initData = getInitData();
    if (!initData) return;
    try {
      const res = await fetch(`${API_BASE}/api/telegram/mining/accrued`, {
        headers: { 'x-init-data': initData },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json() as {
        accrued: number;
        elapsedSeconds: number;
        cappedAt24h: boolean;
        miningActive?: boolean;
        remainingSeconds?: number;
        miningButtonEnabled?: boolean;
        coins?: number;
        miningRate?: number;
        miningDailyPct?: number;
      };
      const accrued = Number(data?.accrued);
      const elapsed = Number(data?.elapsedSeconds);
      const serverCoins = Number(data?.coins);
      const serverRate = Number(data?.miningRate);
      const serverPct = Number(data?.miningDailyPct);
      if (Number.isFinite(serverPct) && serverPct >= 0) {
        miningDailyPctRef.current = serverPct;
        setMiningDailyPct(serverPct);
      }
      serverCoinsRef.current = Number.isFinite(serverCoins) ? Math.max(0, serverCoins) : 0;
      serverMiningRateRef.current = Number.isFinite(serverRate) ? Math.max(0, serverRate) : 0;
      setMiningCoins(serverCoinsRef.current);
      setMiningRatePerSecond(serverMiningRateRef.current);
      elapsedSecondsRef.current = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
      if (Number.isFinite(accrued)) {
        setSessionEarnings(Math.max(0, accrued));
        hasServerMiningBaselineRef.current = true;
      }
      setIsMiningActive(Boolean(data?.miningActive));
      const buttonEnabled = data?.miningButtonEnabled !== false;
      setShowMiningButton(buttonEnabled);
      try {
        window.localStorage.setItem('gm_mining_button_enabled', buttonEnabled ? '1' : '0');
      } catch { /* storage unavailable */ }
      const remaining = Number(data?.remainingSeconds);
      setMiningRemainingMs(Number.isFinite(remaining) ? Math.max(0, remaining) * 1000 : 0);
    } catch { /* best-effort — ticker keeps the current value */ }
  }, []);

  // Re-sync mining/balance state whenever anything else in the app changes it.
  useEffect(() => onDataChange((scopes) => {
    if (scopes.some((s) => s === 'balance' || s === 'admin' || s === 'wallet')) {
      void refreshAccrued();
    }
  }), [refreshAccrued]);

  /** Starts a fresh 24h mining session on the server. */
  const startMining = useCallback(() => {
    if (isStartingMining) return;
    setIsStartingMining(true);
    telegramApiPost<{ miningActive?: boolean; remainingSeconds?: number }>(
      '/telegram/mining/start', {},
    )
      .then(() => refreshAccrued())
      .catch(() => {})
      .finally(() => setIsStartingMining(false));
  }, [isStartingMining, refreshAccrued]);

  useEffect(() => {
    if (!isVerified) return;
    void refreshAccrued();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refreshAccrued();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    // Periodic re-sync so the displayed accrual never drifts or looks frozen.
    const sync = setInterval(() => { void refreshAccrued(); }, 30_000);
    return () => {
      clearInterval(sync);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isVerified, refreshAccrued]);

  // 1s visual ticker. The backend remains authoritative; locally we stop at
  // the same 24h storage cap and re-sync on visibility changes/periodically.
  useEffect(() => {
    const interval = setInterval(() => {
      // Lifetime mining: the counter never freezes — it keeps accruing until
      // the user chooses to claim.
      if (!hasServerMiningBaselineRef.current) return;
      elapsedSecondsRef.current += 1;
      const perSecond = serverMiningRateRef.current;
      if (perSecond <= 0) return;
      setSessionEarnings(prev =>
        Math.round((prev + perSecond) * 1_000_000_000_000) / 1_000_000_000_000,
      );
    }, 1_000);
    return () => clearInterval(interval);
  }, []);


  // Keep a stable ref to the latest sessionEarnings so async handlers always
  // read the current value without stale-closure issues.
  const sessionEarningsRef = useRef(sessionEarnings);
  useEffect(() => {
    sessionEarningsRef.current = sessionEarnings;
    storeAccrued(sessionEarnings);
  }, [sessionEarnings]);

  // Prevent concurrent claims racing each other.
  const isSavingRef = useRef(false);

  /**
   * Claim — settles the continuous mining accrual on the server.
   *
   * The server IGNORES any client-sent amount and credits its own
   * server-computed accrued value (elapsed since last claim × per-second rate,
   * capped at 24h), then resets last_mining_at to NOW() — restarting the cycle.
   * On success we set sessionEarnings=0, reset the local elapsed counter, and
   * adopt the server's authoritative balance.
   */
  const claimEarnings = useCallback(() => {
    if (isSavingRef.current) return;
    // Nothing to claim if there are no session earnings and no pool balance.
    // Keep enough precision for low mining rates. At 6 decimals an amount like
    // 0.000000041 became zero and the request was never sent.
    const pending = +(poolWallet + sessionEarningsRef.current).toFixed(12);

    isSavingRef.current = true;
    setIsClaiming(true);
    setClaimError(null);

    // Sending `amount` is harmless (server ignores it) — kept for backwards compat.
    telegramApiPost<{ balance: number; claimed?: number }>('/telegram/claim', {
      amount: pending,
    })
      .then((data) => {
        const serverBalance = Number(data?.balance);
        if (Number.isFinite(serverBalance)) {
          setHoldingWallet(serverBalance); // setHoldingWallet is NaN-safe
        }
        // Reset the visual baseline only after the atomic server settlement.
        setSessionEarnings(0);
        storeAccrued(0);
        elapsedSecondsRef.current = 0;
        serverMiningRateRef.current =
          (serverCoinsRef.current / 700) * (miningDailyPctRef.current / 100) / MINING_CAP_SECONDS;
        setMiningRatePerSecond(serverMiningRateRef.current);
        hasServerMiningBaselineRef.current = true;
        setMiningRemainingMs(MINING_CAP_SECONDS * 1000);
        // Mining continues right after a claim — the server starts a fresh
        // session, so we re-sync instead of stopping the ticker.
        setIsMiningActive(true);
        void refreshAccrued();
        notifyDataChange('balance');
      })
      .catch((err: unknown) => {
        const msg = String((err as Error)?.message ?? '');
        setClaimError(msg.includes('MIN_CLAIM') ? 'MIN_CLAIM' : 'FAILED');
      })
      .finally(() => {
        isSavingRef.current = false;
        setIsClaiming(false);
      });
  }, [poolWallet, setHoldingWallet, refreshAccrued]);

  const addReferral = () => {
    setReferralCount(prev => prev + 1);
    setReferralBalance(prev => prev + 1);
  };

  const refreshReferrals = () => { fetchReferrals(); };

  /**
   * Add gram earnings from OTHER sources (e.g. miner clicks in Miners.tsx).
   * Credits the server via the lightweight /telegram/credit route which does
   * NOT touch last_mining_at (so it never interferes with mining accrual).
   * Falls back to local accumulation if the API is unavailable so earnings
   * survive a refresh. Amount must be finite, > 0, and <= 100 (server-enforced).
   */
  const addClickEarning = useCallback(async (amount: number) => {
    const amt = Math.round(Number(amount) * 1_000_000) / 1_000_000;
    if (!Number.isFinite(amt) || amt <= 0 || amt > 100) return;
    try {
      const data = await telegramApiPost<{ balance: number }>('/telegram/credit', { amount: amt });
      const serverBalance = Number(data?.balance);
      if (Number.isFinite(serverBalance)) {
        setHoldingWallet(serverBalance);
      } else {
        setHoldingWallet(getStoredBalance() + amt);
      }
    } catch {
      // API unavailable — accumulate locally so earnings survive a refresh.
      setHoldingWallet(getStoredBalance() + amt); // setHoldingWallet is NaN-safe
    }
  }, [setHoldingWallet]);

  return (
    <WalletContext.Provider value={{
      holdingWallet, poolWallet, sessionEarnings,
      referralBalance, walletAddress, minerLevel,
      referralCode, referralCount, isClaiming, claimError,
      isMiningActive, miningRemainingMs, isStartingMining, miningCoins,
      miningRatePerSecond,
      miningDailyPct,
      daily24hEarned: Math.round(miningRatePerSecond * MINING_CAP_SECONDS * 1_000_000_000_000) / 1_000_000_000_000,
      showMiningButton, startMining,
      claimEarnings, connectWallet, addReferral, refreshReferrals, addClickEarning,
      syncBalance: setHoldingWallet,
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}
