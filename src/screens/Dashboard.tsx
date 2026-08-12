import { useState } from 'react';
import { useWallet } from '@/context/WalletContext';
import { useTelegramUser } from '@/context/TelegramUserContext';
import { useLanguage } from '@/context/LanguageContext';
import { useCoins } from '@/context/CoinsContext';
import WalletModal from '@/components/WalletModal';
import StickerBadge from '@/components/StickerBadge';
import crystalGem from '@/assets/crystal-gem.png';
import crystalBase from '@/assets/crystal-base.png';
import capWingsSticker from '@/assets/cap-wings.json.asset.json';

import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { ChevronDown, Wallet, TrendingUp, Gem, ChevronRight } from 'lucide-react';
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
    holdingWallet, sessionEarnings, walletAddress,
    isClaiming, claimError, claimEarnings,
    isMiningActive, miningRemainingMs, isStartingMining,
    daily24hEarned, showMiningButton, startMining,
  } = useWallet();
  const { user: tgUser, avatarUrl } = useTelegramUser();
  const { t } = useLanguage();
  const { coins } = useCoins();
  const [showWallet, setShowWallet] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const dailyIncome = daily24hEarned;

  const userName    = tgUser?.first_name || 'Miner';
  const userInitial = userName[0].toUpperCase();
  const showAvatar  = Boolean(avatarUrl) && !avatarFailed;

  const shortAddress = walletAddress
    ? walletAddress.slice(0, 2) + '...' + walletAddress.slice(-2)
    : null;

  const displayedHolding = useAnimatedNumber(holdingWallet, 1600);
  const canClaim = sessionEarnings > 0;
  const mining = isMiningActive && coins > 0;

  const handleClaim = () => {
    if (isClaiming) return;
    claimEarnings();
  };

  const card = 'rounded-2xl bg-white border border-border shadow-[0_6px_18px_rgba(88,44,180,0.07)]';

  return (
    <div className="h-full min-h-full flex flex-col relative w-full overflow-y-auto px-3 pt-3 pb-2">
      {/* ── user strip ── */}
      <div className={`${card} flex items-center justify-between gap-3 px-3 py-2.5 shrink-0`}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="w-11 h-11 shrink-0 rounded-full bg-secondary flex items-center justify-center overflow-hidden">
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
          </div>
          <div className="min-w-0">
            <div className="truncate font-bold text-foreground text-[15px] flex items-center gap-1">
              {userName} <StickerBadge src={capWingsSticker.url} size={20} />
            </div>
            <div className="truncate text-[12px] text-primary font-medium">
              {tgUser?.username ? `@${tgUser.username}` : `ID: ${tgUser?.id ?? '—'}`}
            </div>
          </div>
        </div>

        <button
          onClick={() => setShowWallet(true)}
          className="shrink-0 flex items-center gap-1.5 rounded-full border border-primary/40 px-3 py-2 text-primary active:scale-95 transition-transform"
        >
          <Wallet className="w-4 h-4" />
          <span className="text-[12px] font-bold">
            {shortAddress ?? t('dashboard_connect_wallet')}
          </span>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── balances ── */}
      <div className="grid grid-cols-2 gap-2.5 mt-3 shrink-0">
        <div className={`${card} flex items-center gap-2.5 px-3 py-2.5`}>
          <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center shrink-0">
            <Gem className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] tracking-[0.12em] font-bold uppercase text-muted-foreground truncate">
              {t('dashboard_holding_wallet')}
            </div>
            <div className="text-[17px] font-black text-foreground tabular-nums leading-tight">
              {formatGram(displayedHolding, 3)} <span className="text-[11px] text-primary font-bold">Gram</span>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground/60 shrink-0" />
        </div>

        <div className={`${card} flex items-center gap-2.5 px-3 py-2.5`}>
          <div className="w-9 h-9 rounded-full bg-success/10 flex items-center justify-center shrink-0">
            <TrendingUp className="w-4 h-4 text-success" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] tracking-[0.12em] font-bold uppercase text-muted-foreground truncate">
              {t('dashboard_24h_label')}
            </div>
            <div className="text-[15px] font-black text-success tabular-nums leading-tight truncate">
              {dailyIncome > 0 ? `+${formatGram(dailyIncome, 7)}` : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* ── total earned ── */}
      <div className="mt-3 shrink-0 rounded-2xl bg-secondary border border-primary/15 px-4 py-3 flex items-center gap-3">
        <div className="w-11 h-11 rounded-full bg-white/70 flex items-center justify-center shrink-0">
          <Gem className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] tracking-[0.18em] font-bold uppercase text-muted-foreground">
            {t('dashboard_total_earned')}
          </div>
          <div className="text-[clamp(1.2rem,6vw,1.7rem)] font-black text-primary tabular-nums leading-none mt-0.5 truncate">
            +{formatGram(sessionEarnings, 8)}
          </div>
        </div>
      </div>

      {/* ── crystal hero ── */}
      <div className="flex-1 min-h-[180px] flex items-center justify-center relative">
        <div
          aria-hidden
          className="absolute w-[70%] aspect-square rounded-full"
          style={{ background: 'radial-gradient(circle, hsl(262 90% 92%) 0%, transparent 70%)' }}
        />
        <div className={`relative w-[78%] max-w-[320px] ${mining ? '' : 'opacity-80 saturate-50'}`} style={{ perspective: '900px' }}>
          <img
            src={crystalGem}
            alt="GRAM MNX mining crystal"
            width={1024}
            height={660}
            className={`w-full object-contain drop-shadow-[0_18px_30px_rgba(124,58,237,0.25)] ${mining ? 'animate-[gem-spin-3d_7s_cubic-bezier(0.45,0,0.55,1)_infinite]' : ''}`}
            style={{ transformStyle: 'preserve-3d' }}
          />
          <img
            src={crystalBase}
            alt=""
            aria-hidden
            width={1024}
            height={384}
            className="w-full object-contain -mt-[7%]"
          />
        </div>
      </div>

      {/* ── claim row ── */}
      <div className="shrink-0 relative mb-6">
        <div className="flex items-stretch gap-2">
          {showMiningButton && (isMiningActive ? (
            <div className={`${card} w-[36%] shrink-0 flex flex-col items-center justify-center px-1 py-2`}>
              <div className="text-[9px] tracking-widest text-muted-foreground uppercase leading-none">
                {t('dashboard_time_left')}
              </div>
              <div className="text-base font-black text-primary tabular-nums leading-tight mt-1">
                {formatCountdown(miningRemainingMs)}
              </div>
            </div>
          ) : (
            <button
              onClick={startMining}
              disabled={isStartingMining}
              className="w-[36%] shrink-0 rounded-2xl bg-success text-white font-black text-sm active:scale-95 transition-transform disabled:opacity-60 px-1"
            >
              {isStartingMining ? '...' : t('dashboard_start_mining')}
            </button>
          ))}
          <button
            onClick={() => { void handleClaim(); }}
            disabled={isClaiming || !canClaim}
            className="flex-1 py-4 rounded-2xl text-primary-foreground font-black text-lg tracking-[0.2em] flex items-center justify-center gap-2 shadow-[0_10px_24px_rgba(124,58,237,0.35)] active:scale-[0.97] transition-transform disabled:opacity-45 disabled:shadow-none"
            style={{ background: 'linear-gradient(90deg, hsl(262 83% 62%), hsl(272 85% 68%))' }}
          >
            <Gem className="w-5 h-5" />
            {isClaiming ? '...' : t('dashboard_claim')}
          </button>
        </div>
        {claimError && (
          <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-destructive/30 bg-white px-3 py-2 text-center text-xs font-bold text-destructive shadow-lg">
            {claimError === 'MIN_CLAIM' ? t('dashboard_min_claim') : t('dashboard_claim_failed')}
          </div>
        )}
      </div>

      {showWallet && <WalletModal onClose={() => setShowWallet(false)} />}
    </div>
  );
}
