import { useState } from 'react';
import { useWallet } from '@/context/WalletContext';
import { useTelegramUser } from '@/context/TelegramUserContext';
import { useLanguage } from '@/context/LanguageContext';
import { useCoins } from '@/context/CoinsContext';
import WalletModal from '@/components/WalletModal';

import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { Gem, Wallet } from 'lucide-react';
import { formatGram } from '@/lib/utils';

const GOLD = '#F5B342';
const CYAN = '#00E5FF';
const TEXT_PRIMARY = '#FFFFFF';
const TEXT_SECONDARY = '#8A9BB5';
const BORDER = '#2A3A5C';
const GLASS_BG = 'rgba(255,255,255,0.05)';

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

  const handleClaim = () => {
    if (isClaiming) return;
    claimEarnings();
  };

  const glass = 'rounded-[20px] backdrop-blur-xl border';
  const glassStyle = { background: GLASS_BG, borderColor: BORDER };

  return (
    <div
      className="h-full flex flex-col relative w-full overflow-hidden"
      style={{ background: 'linear-gradient(180deg, #0B0F1C 0%, #141B2D 100%)' }}
    >
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-4 pt-4 pb-2 gap-3">

        {/* header */}
        <div className="flex items-center justify-between shrink-0">
          <div className="font-black tracking-[0.08em] text-[16px] leading-none">
            <span style={{ color: GOLD }}>GRAM</span> <span style={{ color: CYAN }}>MNX</span>
          </div>

          <button onClick={() => setShowWallet(true)} className="flex items-center gap-2">
            <div className="text-right leading-tight">
              <div className="text-[12px] font-bold" style={{ color: TEXT_PRIMARY }}>{userName}</div>
              <div className="text-[10px] font-mono" style={{ color: TEXT_SECONDARY }}>
                {tgUser?.username ? `@${tgUser.username}` : `ID: ${tgUser?.id ?? '—'}`}
              </div>
            </div>
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center overflow-hidden shrink-0"
              style={{ background: GLASS_BG, border: `1px solid ${BORDER}` }}
            >
              {showAvatar ? (
                <img
                  src={avatarUrl!}
                  alt={userName}
                  className="w-full h-full object-cover"
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                <span className="font-bold text-[13px]" style={{ color: GOLD }}>{userInitial}</span>
              )}
            </div>
          </button>
        </div>

        {/* balance card */}
        <div
          className={`${glass} px-4 py-4 shrink-0`}
          style={{ ...glassStyle, boxShadow: '0 0 28px rgba(0,229,255,0.08)' }}
        >
          <button
            onClick={() => setShowWallet(true)}
            className="flex items-center gap-1.5 mb-3"
          >
            <Wallet className="w-3.5 h-3.5" style={{ color: TEXT_SECONDARY }} />
            <span className="text-[11px] font-mono" style={{ color: TEXT_SECONDARY }}>
              {shortAddress ?? t('dashboard_connect_wallet')}
            </span>
          </button>

          <div className="flex items-end gap-1.5 mb-4">
            <span className="balance-shimmer text-[34px] font-black tabular-nums leading-none" style={{ color: CYAN }}>
              {coins.toLocaleString()}
            </span>
            <span className="text-[13px] font-bold mb-1" style={{ color: CYAN }}>MNX</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[9px] tracking-[0.14em] font-bold uppercase" style={{ color: TEXT_SECONDARY }}>
                {t('dashboard_holding_wallet')}
              </div>
              <div className="text-[15px] font-black tabular-nums mt-0.5" style={{ color: TEXT_PRIMARY }}>
                {formatGram(displayedHolding, 3)}
              </div>
            </div>
            <div>
              <div className="text-[9px] tracking-[0.14em] font-bold uppercase" style={{ color: TEXT_SECONDARY }}>
                {t('dashboard_24h_label')}
              </div>
              <div className="text-[14px] font-black tabular-nums mt-0.5" style={{ color: GOLD }}>
                {dailyIncome > 0 ? `+${formatGram(dailyIncome, 7)}` : '—'}
              </div>
            </div>
          </div>

          <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
            <div className="text-[9px] tracking-[0.18em] font-bold uppercase" style={{ color: TEXT_SECONDARY }}>
              {t('dashboard_total_earned')}
            </div>
            <div className="text-[19px] font-black tabular-nums mt-0.5" style={{ color: GOLD }}>
              +{formatGram(sessionEarnings, 8)}
            </div>
          </div>
        </div>

        {/* mining status + claim */}
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3">
          {claimError && (
            <div
              className="rounded-xl px-3 py-2 text-center text-xs font-bold"
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#FF6B6B' }}
            >
              {claimError === 'MIN_CLAIM' ? t('dashboard_min_claim') : t('dashboard_claim_failed')}
            </div>
          )}

          {/* min-h reserves this row's space up front so the Claim button below
              never jumps once the mining-state fetch resolves. */}
          <div className="min-h-[34px] flex items-center justify-center">
            {showMiningButton && (isMiningActive ? (
              <div className={`${glass} px-4 py-1.5 flex items-center gap-2`} style={glassStyle}>
                <span className="text-[9px] tracking-widest uppercase" style={{ color: TEXT_SECONDARY }}>
                  {t('dashboard_time_left')}
                </span>
                <span className="text-[13px] font-black tabular-nums" style={{ color: CYAN }}>
                  {formatCountdown(miningRemainingMs)}
                </span>
              </div>
            ) : (
              <button
                onClick={startMining}
                disabled={isStartingMining}
                className="rounded-full px-5 py-1.5 text-[12px] font-black disabled:opacity-60 active:scale-95 transition-transform"
                style={{ background: 'rgba(0,229,255,0.12)', border: `1px solid ${CYAN}`, color: CYAN }}
              >
                {isStartingMining ? '...' : t('dashboard_start_mining')}
              </button>
            ))}
          </div>

          <button
            onClick={() => { void handleClaim(); }}
            disabled={isClaiming || !canClaim}
            className="claim-glow-pulse w-36 h-36 rounded-full flex flex-col items-center justify-center gap-1 active:scale-[0.97] transition-transform disabled:opacity-45 disabled:[animation:none]"
            style={{
              background: 'radial-gradient(circle at 35% 30%, #FFD98A 0%, #F5B342 55%, #C9891F 100%)',
            }}
          >
            <Gem className="w-7 h-7" style={{ color: '#141B2D' }} />
            <span className="font-black text-[15px] tracking-[0.18em]" style={{ color: '#141B2D' }}>
              {isClaiming ? '...' : t('dashboard_claim')}
            </span>
          </button>
        </div>
      </div>

      {showWallet && <WalletModal onClose={() => setShowWallet(false)} />}
    </div>
  );
}
