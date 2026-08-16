import { Users, Copy, Share2, CheckCircle2, RefreshCw, Gift, Star, X, Trophy, Clock } from 'lucide-react';
import { cachedFetch } from '@/lib/apiCache';
import { useWallet } from '@/context/WalletContext';
import { useTelegramUser } from '@/context/TelegramUserContext';
import { useLanguage } from '@/context/LanguageContext';
import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { API_BASE, getInitData } from '@/lib/telegramApi';
import StickerBadge from '@/components/StickerBadge';
import medal1 from '@/assets/medal-1.json.asset.json';
import medal2 from '@/assets/medal-2.json.asset.json';
import medal3 from '@/assets/medal-3.json.asset.json';
import contestSticker from '@/assets/contest-sticker.json.asset.json';
import inviteFriendSticker from '@/assets/invite-friend-sticker.json.asset.json';

const MEDALS: Record<number, string> = { 1: medal1.url, 2: medal2.url, 3: medal3.url };

const BOT_USERNAME = 'GRAMMNX1_bot';
const LEADERBOARD_ICON = 'https://vynex-coin1.vercel.app/sad-icon.png';

interface Milestone {
  id: number;
  inviteCount: number;
  rewardCoins: number;
  isEnabled: boolean;
  reached: boolean;
  credited: boolean;
}

interface ReferralRequirements {
  tasksRequired: number;
  totalInvited: number;
  walletCount: number;
  comboCount: number;
  tasksCount: number;
}

interface ReferralData {
  count: number;
  reward: number;
  referralPrice?: number;
  milestones: Milestone[];
  progress: number;
  friends?: InvitedFriend[];
  requirements?: ReferralRequirements;
}

interface InvitedFriend {
  id: number;
  name: string;
  username: string | null;
  confirmed?: boolean;
}

/** One invited friend row: avatar + name + @username + review status. */
function FriendRow({ friend, index }: { friend: InvitedFriend; index: number }) {
  const { t } = useLanguage();
  const [failed, setFailed] = useState(false);
  const showAvatar = friend.id > 0 && !failed;
  const initial = (friend.name.replace('@', '')[0] ?? String.fromCharCode(65 + (index % 26))).toUpperCase();
  const confirmed = Boolean(friend.confirmed);

  return (
    <div
      className="border border-violet-500/20 rounded-xl p-3 flex items-center justify-between"
      style={{ backgroundColor: 'rgba(0,0,0,0.50)' }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm overflow-hidden flex-shrink-0">
          {showAvatar ? (
            <img
              src={`${API_BASE}/api/telegram/avatar/${friend.id}`}
              alt={friend.name}
              className="w-full h-full object-cover"
              onError={() => setFailed(true)}
            />
          ) : (
            initial
          )}
        </div>
        <div className="min-w-0">
          <div className="text-sm text-foreground font-medium truncate">{friend.name}</div>
          {friend.username && (
            <div className="text-[11px] text-muted-foreground truncate">@{friend.username}</div>
          )}
        </div>
      </div>
      <span
        className={`text-[11px] font-bold flex-shrink-0 px-2 py-1 rounded-lg border ${
          confirmed
            ? 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10'
            : 'text-amber-400 border-amber-400/30 bg-amber-400/10'
        }`}
      >
        {confirmed ? t('friends_status_confirmed') : t('friends_status_pending')}
      </span>
    </div>
  );
}


interface LeaderUser {
  rank: number;
  telegramId: number;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  balance: number;
}

interface TournamentPrize { rank: number; coins?: number; gram: number }
interface ActiveTournament {
  id: number;
  title: string;
  topN: number;
  prizes: TournamentPrize[];
  startsAt: string;
  endsAt: string;
  status: string;
  tournamentType?: string;
}

/** Countdown hook — returns formatted string, updates every second */
function useCountdown(endsAt: string | undefined, endedLabel: string) {
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (!endsAt) return;
    const tick = () => {
      const diff = new Date(endsAt).getTime() - Date.now();
      if (diff <= 0) { setLabel(endedLabel); return; }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setLabel(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAt, endedLabel]);
  return label;
}

const avatarFailed = new Set<number>();

function AvatarImg({ telegramId, name, size }: { telegramId: number; name: string; size?: number }) {
  const [failed, setFailed] = useState(() => avatarFailed.has(telegramId));
  const initial = name?.charAt(0)?.toUpperCase() || '?';
  const style = size ? { width: size, height: size } : undefined;

  if (failed) {
    return (
      <div
        className={`${size ? '' : 'w-10 h-10'} rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0`}
        style={style}
      >
        <span className="text-primary font-black text-sm">{initial}</span>
      </div>
    );
  }
  return (
    <img
      src={`${API_BASE}/api/telegram/avatar/${telegramId}`}
      alt={name}
      className={`${size ? '' : 'w-10 h-10'} rounded-full object-cover flex-shrink-0`}
      style={style}
      onError={() => {
        avatarFailed.add(telegramId);
        setFailed(true);
      }}
    />
  );
}

function LeaderboardModal({
  onClose,
  leaderboard,
  loading,
  tournament,
}: {
  onClose: () => void;
  leaderboard: LeaderUser[];
  loading: boolean;
  tournament: ActiveTournament | null;
}) {
  const { t } = useLanguage();
  const countdown = useCountdown(tournament?.endsAt, t('friends_ended'));

  const rankIcon = (r: number) => {
    if (r === 1) return '🥇';
    if (r === 2) return '🥈';
    if (r === 3) return '🥉';
    return r;
  };

  const prizeForRank = (rank: number): number | null => {
    if (!tournament) return null;
    const p = tournament.prizes.find(px => px.rank === rank);
    return p ? (p.coins ?? p.gram ?? 0) : null;
  };

  return (
    // Full-page leaderboard — covers the whole screen above the nav bar.
    <div className="fixed inset-x-0 top-0 z-40 flex flex-col" style={{ bottom: 'var(--nav-height)' }}>
      <div
        className="relative z-10 flex flex-col h-full"
        style={{ backgroundColor: '#0a0b14' }}
      >
        {/* Header */}
        <div className="relative shrink-0 px-5 pt-4 pb-2">
          {/* ambient glow */}
          <div
            className="pointer-events-none absolute left-1/2 top-0 h-40 w-[130%] -translate-x-1/2"
            style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(245,166,35,0.20), transparent 70%)' }}
          />
          <button
            onClick={onClose}
            className="relative z-10 w-8 h-8 rounded-full bg-secondary flex items-center justify-center"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
          <div className="relative z-10 mt-1 flex flex-col items-center">
            <div className="flex items-center gap-2">
              <StickerBadge size={32} src={contestSticker.url} />
              <h2
                className="text-[26px] font-black leading-none tracking-tight"
                style={{
                  background: 'linear-gradient(180deg,#fff7dc,#f5a623)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {tournament ? tournament.title : t('friends_leaderboard')}
              </h2>
            </div>
            <p className="mt-1 text-[10px] font-black tracking-[0.35em] text-muted-foreground uppercase">
              {tournament ? `${t('friends_ends_in')} ${countdown}` : 'THE ELITE 20'}
            </p>
          </div>
        </div>

        {/* Tournament prize banner */}
        {tournament && (
          <div className="mx-5 mb-3 rounded-xl border border-primary/25 p-3" style={{ backgroundColor: 'rgba(245,166,35,0.06)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Trophy className="w-4 h-4 text-primary flex-shrink-0" />
              <span className="text-xs font-black text-primary">{t('friends_contest_prizes')}</span>
              <div className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="w-3 h-3" />
                {countdown}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tournament.prizes.filter(p => (p.coins ?? p.gram) > 0).slice(0, 8).map(p => {
                const val = (p.coins ?? p.gram).toLocaleString();
                const emoji = p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : `#${p.rank}`;
                return (
                  <span key={p.rank} className="text-[10px] bg-primary/10 border border-primary/20 rounded-lg px-2 py-0.5 text-primary font-bold">
                    {emoji} {val}
                  </span>
                );
              })}
              {tournament.prizes.filter(p => (p.coins ?? p.gram) > 0).length > 8 && (
                <span className="text-[10px] text-muted-foreground">+{tournament.prizes.filter(p => (p.coins ?? p.gram) > 0).length - 8} {t('friends_more_ranks')}</span>
              )}
            </div>
          </div>
        )}

        {!tournament && (
          <p className="text-xs text-muted-foreground px-5 pb-3 font-medium">{t('friends_top20')}</p>
        )}

        {/* List */}
        <div className="overflow-y-auto flex-1 px-4 pb-8 space-y-2">
          {loading ? (
            <div className="flex justify-center py-14">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : leaderboard.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-muted-foreground">
              <img src={LEADERBOARD_ICON} alt="" className="w-14 h-14 object-contain opacity-30 mb-3" />
              <p className="text-sm font-semibold">{t('friends_no_data')}</p>
            </div>
          ) : (
            <>
            {/* Podium — 1st on top, 2nd left, 3rd right */}
            <Podium users={leaderboard.slice(0, 3)} prizeForRank={prizeForRank} />
            {leaderboard.slice(3).map((u) => {
              const displayName = [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Miner';
              const prize = prizeForRank(u.rank);
              return (
                <div
                  key={u.telegramId}
                  className="flex items-center gap-3 rounded-2xl px-3 py-2.5 border"
                  style={{
                    backgroundColor:
                      u.rank === 1 ? 'rgba(255,215,0,0.06)'
                      : u.rank === 2 ? 'rgba(192,192,192,0.06)'
                      : u.rank === 3 ? 'rgba(205,127,50,0.06)'
                      : 'rgba(0,0,0,0.45)',
                    borderColor:
                      u.rank === 1 ? 'rgba(255,215,0,0.25)'
                      : u.rank === 2 ? 'rgba(192,192,192,0.18)'
                      : u.rank === 3 ? 'rgba(205,127,50,0.22)'
                      : 'rgba(139,92,246,0.08)',
                  }}
                >
                  {/* Rank */}
                  <div className="w-8 text-center flex-shrink-0">
                    {u.rank <= 3 && MEDALS[u.rank] ? (
                      <span className="inline-flex items-center justify-center">
                        <StickerBadge size={28} src={MEDALS[u.rank]} />
                      </span>
                    ) : (
                      <span className="text-sm font-black text-muted-foreground">{u.rank}</span>
                    )}
                  </div>

                  {/* Avatar */}
                  <AvatarImg telegramId={u.telegramId} name={displayName} />

                  {/* Name + username */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-foreground truncate">{displayName}</div>
                    {u.username ? (
                      <div className="text-[11px] text-muted-foreground truncate">@{u.username}</div>
                    ) : (
                      <div className="text-[11px] text-muted-foreground truncate">#{u.telegramId}</div>
                    )}
                    {prize !== null && prize > 0 && (
                      <div className="text-[10px] text-primary font-bold mt-0.5">
                        🎁 +{prize.toLocaleString()} MNX
                      </div>
                    )}
                  </div>

                  {/* Balance (coins) */}
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-black text-primary">
                      {Math.floor(u.balance).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-semibold">MNX</div>
                  </div>
                </div>
              );
            })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const RING: Record<number, string> = {
  1: '#f5c542',
  2: '#cfd6e0',
  3: '#cd7f32',
};

/** One podium slot — declared at module scope so it never remounts on refresh. */
const PodiumSlot = memo(function PodiumSlot({
  u,
  big,
  prize,
}: {
  u?: LeaderUser;
  big?: boolean;
  prize: number | null;
}) {
  if (!u) return <div className="flex-1" />;
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Miner';
  const ring = RING[u.rank] ?? '#cd7f32';
  const size = big ? 92 : 68;
  return (
    <div className="flex flex-1 flex-col items-center">
      {/* medal floating above */}
      {MEDALS[u.rank] && (
        <div className="-mb-1">
          <StickerBadge size={big ? 28 : 22} src={MEDALS[u.rank]} />
        </div>
      )}
      <div className="relative">
        <div
          className="rounded-full overflow-hidden"
          style={{
            width: size,
            height: size,
            boxShadow: `0 0 0 3px ${ring}, 0 0 ${big ? 26 : 14}px ${ring}55`,
          }}
        >
          <AvatarImg telegramId={u.telegramId} name={name} size={size} />
        </div>
        {/* rank chip on the ring */}
        <div
          className="absolute left-1/2 -translate-x-1/2 -bottom-2 rounded-full px-2 py-[1px] text-[10px] font-black text-primary-foreground"
          style={{ backgroundColor: ring, boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }}
        >
          #{u.rank}
        </div>
      </div>
      <div
        className={`mt-3 w-full truncate text-center font-black leading-tight text-foreground ${big ? 'text-[14px] tracking-[0.12em]' : 'text-[12px]'}`}
      >
        {name}
      </div>
      <div className="w-full truncate text-center text-[10px] text-muted-foreground">
        {u.username ? `@${u.username}` : `#${u.telegramId}`}
      </div>
      <div className={`mt-0.5 font-black text-primary ${big ? 'text-[14px]' : 'text-[11px]'}`}>
        {Math.floor(u.balance).toLocaleString()} <span className="text-[9px] text-muted-foreground">MNX</span>
      </div>
      {prize !== null && prize > 0 && (
        <div className="text-[10px] font-bold text-primary">🎁 +{prize.toLocaleString()}</div>
      )}
    </div>
  );
});

/** Podium block: winner raised on top, runner-up left, third right. */
function Podium({
  users,
  prizeForRank,
}: {
  users: LeaderUser[];
  prizeForRank: (rank: number) => number | null;
}) {
  const byRank = (r: number) => users.find((u) => u.rank === r);
  const first = byRank(1);
  const second = byRank(2);
  const third = byRank(3);

  return (
    <div className="relative pb-4 pt-5">
      {/* 2nd — 1st — 3rd, champion raised */}
      <div className="grid grid-cols-3 items-start justify-items-center gap-1">
        <div className="flex w-full justify-center pt-8">
          <PodiumSlot u={second} prize={second ? prizeForRank(second.rank) : null} />
        </div>
        <div className="flex w-full justify-center -mt-3">
          <PodiumSlot u={first} big prize={first ? prizeForRank(first.rank) : null} />
        </div>
        <div className="flex w-full justify-center pt-8">
          <PodiumSlot u={third} prize={third ? prizeForRank(third.rank) : null} />
        </div>
      </div>

      {/* divider glow */}
      <div
        className="mx-auto mt-4 h-[1px] w-[85%]"
        style={{ background: 'linear-gradient(90deg,transparent,rgba(245,166,35,0.45),transparent)' }}
      />
    </div>
  );
}

export default function Friends() {
  const { referralCode, referralCount, referralBalance, refreshReferrals } = useWallet();
  const { user: tgUser } = useTelegramUser();
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [milestoneData, setMilestoneData] = useState<ReferralData | null>(null);
  const [showTasks, setShowTasks] = useState(false);

  // Leaderboard state
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderUser[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);
  const [coinTournament, setCoinTournament] = useState<ActiveTournament | null>(null);

  const referralLink = `https://t.me/${BOT_USERNAME}?start=${tgUser?.id ?? ''}`;

  const loadMilestones = useCallback(async () => {
    const initData = getInitData();
    if (!initData) return;
    try {
      const res = await cachedFetch(`${API_BASE}/api/telegram/referrals`, {
        headers: { 'x-init-data': initData },
      });
      if (res.ok) {
        const data = await res.json() as ReferralData;
        setMilestoneData(data);
      }
    } catch { /* best-effort */ }
  }, []);

  useEffect(() => {
    loadMilestones();
    // Referrals land through the bot webhook, so poll briefly and refresh when
    // the app regains focus to avoid the "invite appears seconds later" lag.
    const timer = window.setInterval(loadMilestones, 5000);
    const onVisible = () => { if (!document.hidden) loadMilestones(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [loadMilestones]);

  const loadLeaderboard = useCallback(async () => {
    setLoadingLeaderboard(true);
    try {
      const [lbRes, tRes] = await Promise.all([
        cachedFetch(`${API_BASE}/api/leaderboard`),
        cachedFetch(`${API_BASE}/api/tournament/active?type=coin`),
      ]);
      if (lbRes.ok) setLeaderboard(await lbRes.json() as LeaderUser[]);
      if (tRes.ok) {
        const d = await tRes.json() as { tournament: ActiveTournament | null };
        setCoinTournament(d.tournament ?? null);
      }
    } catch { /* best-effort */ }
    finally { setLoadingLeaderboard(false); }
  }, []);

  const handleOpenLeaderboard = () => {
    setShowLeaderboard(true);
    loadLeaderboard();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(referralLink).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = () => {
    const text = t('friends_share_text') + referralLink;
    if (navigator.share) {
      navigator.share({ text });
    } else {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    refreshReferrals();
    await loadMilestones();
    setTimeout(() => setRefreshing(false), 1500);
  };

  const steps = [
    t('friends_step1'),
    t('friends_step2'),
    t('friends_step3'),
    t('friends_step5'),
    t('friends_step4'),
  ];

  const displayCount = milestoneData?.count ?? referralCount;
  const displayReward = milestoneData?.reward ?? referralBalance;
  const milestones = milestoneData?.milestones ?? [];
  const friends = milestoneData?.friends ?? [];
  const invitePrice = Number(milestoneData?.referralPrice ?? 0);

  return (
    <div className="min-h-full flex flex-col relative w-full px-4 pt-6">
      <div className="absolute inset-0 z-0" style={{ backgroundColor: '#FFFFFF' }} />

      {/* Leaderboard Modal */}
      {showLeaderboard && (
        <LeaderboardModal
          onClose={() => setShowLeaderboard(false)}
          leaderboard={leaderboard}
          loading={loadingLeaderboard}
          tournament={coinTournament}
        />
      )}

      {/* Header */}
      <div className="relative z-10 mb-5 flex items-center justify-between">
        <h1 className="text-3xl font-black text-foreground tracking-tight drop-shadow-lg">{t('friends_title')}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center border border-violet-500/20 hover:bg-secondary transition-colors"
          >
            <RefreshCw className={`w-4 h-4 text-foreground ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
            <StickerBadge size={30} src={inviteFriendSticker.url} />
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="relative z-10 flex gap-3 mb-4">
        <div className="flex-1 rounded-2xl p-4 text-center border border-violet-500/20" style={{ backgroundColor: '#FFFFFF' }}>
          <div className="text-2xl font-black text-foreground">{displayCount}</div>
          <div className="text-xs text-muted-foreground mt-1 font-semibold">{t('friends_total_referrals')}</div>
        </div>
        <div className="flex-1 rounded-2xl p-4 text-center border border-primary/30" style={{ backgroundColor: '#FFFFFF' }}>
          <div className="text-2xl font-black text-primary">{Number(displayReward).toFixed(4)}</div>
          <div className="text-xs text-muted-foreground mt-1 font-semibold">{t('friends_gmr_rewards')}</div>
        </div>
        <button
          onClick={() => setShowTasks(true)}
          className="flex-1 rounded-2xl p-4 text-center border border-success/30 hover:border-success/60 transition-colors"
          style={{ backgroundColor: '#FFFFFF' }}
        >
          <div className="text-2xl font-black text-success">
            {milestones.filter(m => m.isEnabled && !m.credited).length}
          </div>
          <div className="text-xs text-muted-foreground mt-1 font-semibold">Tasks</div>
        </button>
      </div>

      {/* Tasks Modal (referral milestones) */}
      {showTasks && (
        <div
          className="fixed inset-x-0 top-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm p-4"
          style={{ bottom: 'var(--nav-height)' }}
          onClick={() => setShowTasks(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-violet-500/20 flex min-h-0 flex-col overflow-hidden"
            style={{ backgroundColor: 'rgba(10,10,10,0.97)', height: 'min(680px, calc(100% - 16px))' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 pb-3 border-b border-violet-500/20 flex-shrink-0">
              <h3 className="text-sm font-black text-muted-foreground flex items-center gap-2">
                <Star className="w-4 h-4 text-primary" />
                {t('friends_milestones')}
              </h3>
              <button onClick={() => setShowTasks(false)} className="text-muted-foreground text-sm font-bold px-2">✕</button>
            </div>

            {/* Scrollable list */}
            <div
              className="min-h-0 flex-1 touch-pan-y overscroll-contain overflow-y-auto p-4"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {milestones.filter(m => m.isEnabled && !m.credited).length === 0 && (
                <div className="text-center text-muted-foreground text-sm py-6">No tasks available</div>
              )}
              <div className="space-y-2 pb-8">
                {milestones.filter(m => m.isEnabled && !m.credited).map(m => {
                  const progressPct = Math.min(100, (displayCount / m.inviteCount) * 100);
                  return (
                    <div
                      key={m.id}
                      className={`rounded-2xl p-3 border flex items-center gap-3 ${
                        m.credited
                          ? 'bg-success/10 border-success/30'
                          : m.reached
                          ? 'bg-primary/10 border-primary/30'
                          : 'bg-secondary border-violet-500/20'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        m.credited ? 'bg-success/20' : m.reached ? 'bg-primary/20' : 'bg-secondary'
                      }`}>
                        <Gift className={`w-5 h-5 ${m.credited ? 'text-success' : m.reached ? 'text-primary' : 'text-muted-foreground'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-bold text-foreground">{m.inviteCount} {t('friends_invites_word')}</span>
                          <span className={`text-xs font-black ${m.credited ? 'text-success' : m.reached ? 'text-primary' : 'text-muted-foreground'}`}>
                            +{m.rewardCoins} MNX
                          </span>
                        </div>
                        <div className="w-full bg-secondary rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full transition-all ${m.credited ? 'bg-success' : 'bg-primary'}`}
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {m.credited
                            ? t('friends_reward_claimed')
                            : m.reached
                            ? t('friends_reward_pending')
                            : `${displayCount}/${m.inviteCount} ${t('friends_invited_word')}`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Invite Card */}
      <div className="relative z-10 backdrop-blur-sm border border-violet-500/20 rounded-3xl p-5 mb-4" style={{ backgroundColor: '#FFFFFF' }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center shadow-[0_0_15px_rgba(245,166,35,0.2)]">
            <StickerBadge size={38} src={inviteFriendSticker.url} />
          </div>
          <div>
            <h2 className="text-lg font-black text-foreground">{t('friends_invite_title')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('friends_invite_desc', { reward: '1' })}
            </p>
          </div>
        </div>

        {/* Referral Link + Leaderboard Button */}
        <div className="flex gap-2 mb-4">
          {/* Referral Link Box */}
          <div className="flex-1 rounded-xl p-3 border border-violet-500/20" style={{ backgroundColor: 'rgba(0,0,0,0.50)' }}>
            <div className="text-[10px] text-muted-foreground mb-1 font-semibold">{t('friends_referral_link')}</div>
            <div className="text-xs text-primary font-mono break-all">{referralLink}</div>
          </div>

          {/* Leaderboard Button */}
          <button
            onClick={handleOpenLeaderboard}
            className="w-[60px] flex-shrink-0 rounded-xl border border-violet-500/20 flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform overflow-hidden"
            style={{ backgroundColor: '#ffffff' }}
          >
            <img
              src={LEADERBOARD_ICON}
              alt="leaderboard"
              className="w-8 h-8 object-contain"
            />
            <span className="text-[9px] text-primary-foreground/70 font-bold leading-tight text-center px-1">
              {t('friends_leaderboard')}
            </span>
          </button>
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleShare}
            className="flex-1 py-3 rounded-xl bg-primary text-primary-foreground font-black flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(245,166,35,0.3)]"
          >
            <Share2 className="w-4 h-4" /> {t('friends_share')}
          </button>
          <button
            onClick={handleCopy}
            className="px-4 py-3 rounded-xl bg-secondary hover:bg-secondary text-foreground flex items-center justify-center gap-2 transition-colors font-bold text-sm border border-violet-500/20"
          >
            {copied ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
            {copied ? t('friends_copied') : t('friends_copy')}
          </button>
        </div>
      </div>

      {/* How it works */}
      <div className="relative z-10 border border-violet-500/20 rounded-2xl p-4 mb-4" style={{ backgroundColor: '#FFFFFF' }}>
        <h3 className="text-sm font-black text-foreground mb-3">{t('friends_how_it_works')}</h3>
        <div className="space-y-2">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary font-black text-xs flex-shrink-0">
                {i + 1}
              </div>
              <span className="text-sm text-muted-foreground font-medium">{step}</span>
            </div>
          ))}
        </div>
      </div>



      {/* Friends List */}
      <div className="relative z-10 flex-1 pb-40">
        <h3 className="text-xs font-black text-muted-foreground mb-3 tracking-widest">
          {t('friends_your_friends', { count: String(friends.length || displayCount) })}
        </h3>
        {(friends.length || displayCount) === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 rounded-2xl border border-violet-500/20 border-dashed" style={{ backgroundColor: 'rgba(0,0,0,0.40)' }}>
            <Users className="w-8 h-8 text-muted-foreground mb-2" />
            <p className="text-sm font-medium text-muted-foreground">{t('friends_no_friends')}</p>
            <p className="text-xs text-muted-foreground mt-1">{t('friends_share_to_earn')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(friends.length
              ? friends
              : Array.from({ length: displayCount }, (_, i) => ({
                  id: -(i + 1),
                  name: `${t('friends_friend_label')} ${i + 1}`,
                  username: null as string | null,
                }))
            ).map((f: InvitedFriend, i: number) => (
              <FriendRow key={f.id} friend={f} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
