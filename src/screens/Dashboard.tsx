import { useState, useRef, useEffect } from 'react';
import { useWallet } from '@/context/WalletContext';
import { useTelegramUser } from '@/context/TelegramUserContext';
import { useLanguage } from '@/context/LanguageContext';
import { useCoins } from '@/context/CoinsContext';
import WalletModal from '@/components/WalletModal';
import StickerBadge from '@/components/StickerBadge';
import MineScene from '@/components/MineScene';
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


      {/* User Card */}
      <div className="px-4 pt-2 relative z-10 shrink-0">
        <div className="bg-secondary/40 backdrop-blur-sm border border-white/5 rounded-2xl p-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30 relative overflow-hidden">
              {showAvatar ? (
                <img
                  src={avatarUrl!}
                  alt={userName}
                  className="w-full h-full object-cover"
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                <span className="font-bold text-primary">{userInitial}</span>
              )}
              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-background rounded-full flex items-center justify-center">
                <div className="w-2.5 h-2.5 bg-success rounded-full animate-pulse shadow-[0_0_8px_rgba(0,255,136,0.8)]" />
              </div>
            </div>
            <div>
              <div className="font-semibold text-white flex items-center gap-1">
                {userName}
                <StickerBadge size={22} />
              </div>
              <div className="text-xs text-primary font-bold">
                {tgUser?.username ? `@${tgUser.username}` : `ID: ${tgUser?.id ?? '—'}`}
              </div>
            </div>
          </div>

          <button
            onClick={() => setShowWallet(true)}
            className="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-full border border-white/10 hover:border-primary/30 transition-colors"
          >
            <span className={`text-xs font-mono ${walletAddress ? 'text-success' : 'text-primary'}`}>
              {shortAddress ?? t('dashboard_connect_wallet')}
            </span>
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Balances */}
      <div className="flex flex-col items-center mt-3 relative z-10 px-4 shrink-0">
        <div className="flex gap-3 w-full max-w-sm">
          {/* Holding wallet */}
          <div className="flex-1 bg-black/55 backdrop-blur-sm border border-[#d9a544]/30 rounded-2xl py-2.5 px-3 flex items-center gap-2.5 shadow-[0_6px_20px_rgba(0,0,0,0.5)]">
            <div className="w-8 h-8 rounded-full bg-[#d9a544]/15 border border-[#d9a544]/35 flex items-center justify-center shrink-0">
              <Wallet className="w-4 h-4 text-[#e6b95f]" />
            </div>
            <div className="min-w-0">
              <div className="text-[9px] tracking-wider text-[#c9b892]/80 font-semibold">
                {t('dashboard_holding_wallet')}
              </div>
              <div className="text-base font-black text-white leading-tight tabular-nums">
                {formatGram(displayedHolding, 3)}
              </div>
              <div className="text-[9px] tracking-wider text-[#c9b892]/70 font-semibold">GRAM</div>
            </div>
          </div>
          {/* Coin-based 24-hour mining projection */}
          <div className="flex-1 bg-black/55 backdrop-blur-sm border border-[#d9a544]/30 rounded-2xl py-2.5 px-3 flex items-center gap-2.5 shadow-[0_6px_20px_rgba(0,0,0,0.5)]">
            <div className="w-8 h-8 rounded-full bg-[#d9a544]/15 border border-[#d9a544]/35 flex items-center justify-center shrink-0">
              <TrendingUp className="w-4 h-4 text-[#e6b95f]" />
            </div>
            <div className="min-w-0">
              <div className="text-[9px] tracking-wider text-[#c9b892]/80 font-semibold">
                {t('dashboard_24h_label')}
              </div>
              <div className="text-base font-black text-success leading-tight tabular-nums">
                {dailyIncome > 0
                  ? `+${formatGram(dailyIncome, dailyIncome < 0.0001 ? 8 : 6)}`
                  : '—'}
              </div>
              <div className="text-[9px] tracking-wider text-[#c9b892]/70 font-semibold">GRAM</div>
            </div>
          </div>
        </div>
      </div>

      {/* Session Earnings */}
      <div className="flex flex-col items-center mt-2 relative z-10 px-4 shrink-0">
        <div className="text-[10px] tracking-[0.3em] font-bold text-[#c9b892]/80 mb-0.5">
          {t('dashboard_total_earned')}
        </div>
        <div
          className="relative px-8 py-1.5 border-y border-[#d9a544]/60"
          style={{
            clipPath: 'polygon(4% 0, 96% 0, 100% 50%, 96% 100%, 4% 100%, 0 50%)',
            background: 'linear-gradient(180deg, rgba(0,0,0,0.6), rgba(0,0,0,0.35))',
          }}
        >
          {/* Always 8 decimals so the last digits visibly tick every second
              instead of looking like a frozen number at low mining rates. */}
          <div className="text-[clamp(1.2rem,6vw,1.9rem)] font-black text-success glow-text-success tabular-nums">
            +{formatGram(sessionEarnings, 8)}
          </div>
        </div>
        <div className="mt-0.5 h-[2px] w-32 bg-[#00ff88]/60 blur-[2px]" />
      </div>

      {/* The mine scene — the only animated screen in the app */}
      <div className="flex-[0.82] min-h-0 relative z-10">
        <MineScene active={isMiningActive && coins > 0} claimKey={claimKey} />
      </div>


      {/* Claim row — timer / start-miner sits beside CLAIM on one line */}
      <div className="px-4 mb-0 pb-1 relative z-10 shrink-0">
        <div className="flex items-stretch gap-2">
          {showMiningButton && (isMiningActive ? (
            <div className="w-[38%] shrink-0 rounded-2xl bg-black/55 border border-primary/30 flex flex-col items-center justify-center px-1 py-2">
              <div className="text-[9px] text-muted-foreground leading-none">{t('dashboard_time_left')}</div>
              <div className="text-base font-black text-primary tabular-nums leading-tight mt-0.5">
                {formatCountdown(miningRemainingMs)}
              </div>
            </div>
          ) : (
            <button
              onClick={startMining}
              disabled={isStartingMining}
              className="w-[38%] shrink-0 rounded-2xl bg-gradient-to-r from-[#00c853] to-[#00ff88] text-black font-black text-sm shadow-[0_0_20px_rgba(0,255,136,0.35)] active:scale-95 transition-all disabled:opacity-60 px-1"
            >
              {isStartingMining ? '...' : t('dashboard_start_mining')}
            </button>
          ))}
          <button
            onClick={() => { void handleClaim(); }}
            disabled={isClaiming}
            className="flex-1 py-3.5 rounded-2xl border-2 border-[#e6b95f] text-[#f0cd7e] font-black text-xl tracking-[0.14em] flex items-center justify-center gap-2 shadow-[0_0_28px_rgba(230,185,95,0.45),inset_0_0_28px_rgba(230,185,95,0.12)] active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(180deg, rgba(40,26,6,0.85), rgba(10,8,4,0.9))' }}
          >
            <Gem className="w-5 h-5 text-[#f0cd7e]" />
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
