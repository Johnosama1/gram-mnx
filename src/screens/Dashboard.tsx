import { useState, useRef, useEffect } from 'react';
import { useWallet } from '@/context/WalletContext';
import { useTelegramUser } from '@/context/TelegramUserContext';
import { useLanguage } from '@/context/LanguageContext';
import { useCoins } from '@/context/CoinsContext';
import WalletModal from '@/components/WalletModal';
import StickerBadge from '@/components/StickerBadge';
import MineScene from '@/components/MineScene';
import TonIcon from '@/components/TonIcon';

import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { ChevronDown, Wallet, TrendingUp, Gem } from 'lucide-react';
import { formatGram } from '@/lib/utils';


/** hh:mm:ss countdown for the 24h mining session */
function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export default function Dashboard() {
  const {
    holdingWallet, sessionEarnings, poolWallet, walletAddress,
    isClaiming, claimError, claimEarnings,
    isMiningActive, miningRemainingMs, isStartingMining, miningCoins,
    daily24hEarned, showMiningButton, startMining,
  } = useWallet();
  const { user: tgUser, avatarUrl } = useTelegramUser();
  const { t } = useLanguage();
  const { coins } = useCoins();
  const [showWallet, setShowWallet] = useState(false);

  // Coin-based daily income: 700 coin = 1 gram, 5% daily → gram/day = coins/14000
  // Use the rate coins frozen by the server for the running cycle so the shown
  // 24H value matches exactly what accrues over 86,400 seconds.
  // Single source of truth: the server's per-second rate × 86,400. This is the
  // exact amount that accrues over a full 24h cycle, so the displayed target can
  // never be reached faster than 24 hours.
  const rateCoins = miningCoins > 0 ? miningCoins : coins;
  const dailyIncome = daily24hEarned > 0
    ? daily24hEarned
    : (rateCoins > 0 ? rateCoins / 14_000 : 0);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const userName    = tgUser?.first_name || 'Miner';
  const userInitial = userName[0].toUpperCase();
  const showAvatar  = Boolean(avatarUrl) && !avatarFailed;

  const shortAddress = walletAddress
    ? walletAddress.slice(0, 2) + '...' + walletAddress.slice(-2)
    : null;

  // Detect when a claim finishes (isClaiming: true → false) and play the
  // cart → station → balance animation exactly once for that claim.
  const prevIsClaiming = useRef(false);
  const [claimKey, setClaimKey] = useState(0);
  useEffect(() => {
    if (prevIsClaiming.current && !isClaiming && !claimError) {
      setClaimKey((k) => k + 1);
    }
    prevIsClaiming.current = isClaiming;
  }, [isClaiming, claimError]);

  // Balance ticks up coin by coin instead of jumping to the final value.
  const displayedHolding = useAnimatedNumber(holdingWallet, 1600);
  // Nothing accrued yet → nothing to claim (pure UI guard, claim logic unchanged).
  const canClaim = sessionEarnings > 0;

  // AdsGram policy: essential actions (mining CLAIM) must never be gated by an ad.

  const handleClaim = () => {
    if (isClaiming) return;
    claimEarnings();
  };

  return (
    <div className="h-full min-h-full flex flex-col relative w-full overflow-hidden">
      {/* Shared mine background comes from the app shell — only a soft dark
          layer here so the numbers and buttons stay readable. */}
      <div
        aria-hidden
        className="absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(circle at 50% 55%, rgba(255,190,70,0.08) 0%, rgba(0,0,0,0.30) 45%, rgba(0,0,0,0.62) 100%)',
        }}
      />

      {/* Full-screen mine scene — the only animated screen in the app */}
      <div className="absolute inset-0 z-0">
        <MineScene active={isMiningActive && coins > 0} claimKey={claimKey} />
      </div>



      {/* ── HUD: user strip ── */}
      <div className="px-3 pt-2 relative z-10 shrink-0">
        <div
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-[#d9a544]/35 px-3 py-2 backdrop-blur-md shadow-[0_8px_24px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,224,150,0.12)]"
          style={{ background: 'linear-gradient(180deg, rgba(14,12,8,0.72), rgba(6,6,8,0.82))' }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="w-9 h-9 shrink-0 rounded-full bg-[#d9a544]/15 flex items-center justify-center border border-[#d9a544]/40 relative overflow-hidden">
              {showAvatar ? (
                <img
                  src={avatarUrl!}
                  alt={userName}
                  className="w-full h-full object-cover"
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                <span className="font-bold text-[#e6b95f]">{userInitial}</span>
              )}
              <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-black/80 rounded-full flex items-center justify-center">
                <div className="w-2 h-2 bg-success rounded-full animate-pulse shadow-[0_0_8px_rgba(0,255,136,0.8)]" />
              </div>
            </div>
            <div className="min-w-0">
              <div className="truncate font-bold text-white text-sm flex items-center gap-1">
                {userName}
                <StickerBadge size={20} />
              </div>
              <div className="truncate text-[11px] text-[#e6b95f]/90 font-semibold">
                {tgUser?.username ? `@${tgUser.username}` : `ID: ${tgUser?.id ?? '—'}`}
              </div>
            </div>
          </div>

          <button
            onClick={() => setShowWallet(true)}
            className="shrink-0 flex items-center gap-1.5 bg-black/50 px-3 py-1.5 rounded-full border border-[#d9a544]/40 hover:border-[#e6b95f] transition-colors"
          >
            <span className={`text-[11px] font-mono font-bold ${walletAddress ? 'text-success' : 'text-[#e6b95f]'}`}>
              {shortAddress ?? t('dashboard_connect_wallet')}
            </span>
            <ChevronDown className="w-3 h-3 text-[#c9b892]/70" />
          </button>
        </div>
      </div>

      {/* ── HUD: balances ── */}
      <div className="flex flex-col items-center mt-2.5 relative z-10 px-3 shrink-0">
        <div className="grid grid-cols-2 gap-2.5 w-full max-w-sm">
          {/* Holding wallet */}
          <div
            className="rounded-2xl border border-[#d9a544]/35 px-3 py-2.5 backdrop-blur-md shadow-[0_8px_24px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,224,150,0.1)]"
            style={{ background: 'linear-gradient(180deg, rgba(14,12,8,0.72), rgba(6,6,8,0.82))' }}
          >
            <div className="flex items-center gap-1.5 text-[9px] tracking-[0.16em] text-[#e6b95f]/85 font-bold uppercase">
              <Wallet className="w-3 h-3 shrink-0" />
              <span className="truncate">{t('dashboard_holding_wallet')}</span>
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <TonIcon size={15} className="text-[#e6b95f] shrink-0 translate-y-[1px]" />
              <span className="text-[clamp(1rem,5vw,1.35rem)] font-black text-white leading-none tabular-nums drop-shadow-[0_0_10px_rgba(230,185,95,0.35)]">
                {formatGram(displayedHolding, 3)}
              </span>
            </div>
          </div>

          {/* 24-hour projection */}
          <div
            className="rounded-2xl border border-[#d9a544]/35 px-3 py-2.5 backdrop-blur-md shadow-[0_8px_24px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,224,150,0.1)]"
            style={{ background: 'linear-gradient(180deg, rgba(14,12,8,0.72), rgba(6,6,8,0.82))' }}
          >
            <div className="flex items-center gap-1.5 text-[9px] tracking-[0.16em] text-[#e6b95f]/85 font-bold uppercase">
              <TrendingUp className="w-3 h-3 shrink-0" />
              <span className="truncate">{t('dashboard_24h_label')}</span>
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <TonIcon size={15} className="text-success shrink-0 translate-y-[1px]" />
              <span className="text-[clamp(0.95rem,4.6vw,1.25rem)] font-black text-success leading-none tabular-nums glow-text-success">
                {dailyIncome > 0
                  ? `+${formatGram(dailyIncome, dailyIncome < 0.0001 ? 8 : 6)}`
                  : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── HUD: total earned panel ── */}
      <div className="flex flex-col items-center mt-2.5 relative z-10 px-3 shrink-0 w-full">
        <div
          className="relative w-full max-w-sm rounded-2xl border border-[#d9a544]/45 px-4 py-2.5 text-center backdrop-blur-md shadow-[0_10px_30px_rgba(0,0,0,0.6),0_0_28px_rgba(230,185,95,0.12),inset_0_1px_0_rgba(255,224,150,0.14)]"
          style={{ background: 'linear-gradient(180deg, rgba(16,13,8,0.78), rgba(5,5,7,0.86))' }}
        >
          <div className="text-[9px] tracking-[0.3em] font-bold text-[#e6b95f]/80 uppercase">
            {t('dashboard_total_earned')}
          </div>
          <div className="mt-0.5 flex items-center justify-center gap-2">
            <TonIcon size={18} className="text-success shrink-0" />
            {/* Always 8 decimals so the last digits visibly tick every second */}
            <span className="text-[clamp(1.15rem,5.6vw,1.75rem)] font-black text-success glow-text-success tabular-nums leading-none">
              +{formatGram(sessionEarnings, 8)}
            </span>
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-8 -bottom-px h-[2px]"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(0,255,136,0.7), transparent)', animation: 'hud-sheen 2.6s ease-in-out infinite' }}
          />
        </div>
      </div>

      {/* Spacer that lets the full-screen scene breathe under the UI */}
      <div className="flex-[0.82] min-h-0" />

      {/* Claim row — timer / start-miner sits beside CLAIM on one line */}
      <div className="px-3 mb-0 pb-1.5 relative z-10 shrink-0">
        <div className="flex items-stretch gap-2">
          {showMiningButton && (isMiningActive ? (
            <div
              className="w-[38%] shrink-0 rounded-2xl border border-[#d9a544]/40 flex flex-col items-center justify-center px-1 py-2 backdrop-blur-md"
              style={{ background: 'linear-gradient(180deg, rgba(14,12,8,0.75), rgba(6,6,8,0.85))' }}
            >
              <div className="text-[9px] tracking-widest text-[#c9b892]/75 uppercase leading-none">{t('dashboard_time_left')}</div>
              <div className="text-base font-black text-[#f0cd7e] tabular-nums leading-tight mt-1">
                {formatCountdown(miningRemainingMs)}
              </div>
            </div>
          ) : (
            <button
              onClick={startMining}
              disabled={isStartingMining}
              className="w-[38%] shrink-0 rounded-2xl bg-gradient-to-b from-[#00e070] to-[#009c48] text-black font-black text-sm border border-[#00ff88]/50 shadow-[0_0_22px_rgba(0,255,136,0.3)] active:scale-95 transition-all disabled:opacity-60 px-1"
            >
              {isStartingMining ? '...' : t('dashboard_start_mining')}
            </button>
          ))}
          <button
            onClick={() => { void handleClaim(); }}
            disabled={isClaiming || !canClaim}
            className="flex-1 py-3.5 rounded-2xl border-2 border-[#e6b95f] text-[#f7dfa5] font-black text-xl tracking-[0.14em] flex items-center justify-center gap-2 shadow-[0_0_30px_rgba(230,185,95,0.45),inset_0_1px_0_rgba(255,235,180,0.25),inset_0_0_28px_rgba(230,185,95,0.12)] active:scale-[0.97] active:shadow-[0_0_14px_rgba(230,185,95,0.3)] hover:brightness-110 transition-all disabled:opacity-45 disabled:shadow-none disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(180deg, rgba(58,38,8,0.9), rgba(12,9,4,0.94))' }}
          >
            <TonIcon size={20} className="text-[#f0cd7e]" />
            {isClaiming ? '...' : t('dashboard_claim')}
          </button>
        </div>
        {claimError && (
          <div className="absolute bottom-full left-4 right-4 mb-2 rounded-lg border border-destructive/40 bg-background/95 px-3 py-2 text-center text-xs font-bold text-destructive shadow-lg">
            {claimError === 'MIN_CLAIM'
              ? t('dashboard_min_claim')
              : t('dashboard_claim_failed')}
          </div>
        )}
      </div>


      {showWallet && <WalletModal onClose={() => setShowWallet(false)} />}
    </div>
  );
}
