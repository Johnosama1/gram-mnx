import { useEffect, useState, useCallback } from 'react';
import { cachedFetch, notifyDataChange, onDataChange } from '@/lib/apiCache';
import { CheckCircle2, Circle, ExternalLink, Loader2, Radio, Users, Twitter, Bot, CalendarCheck, PlayCircle } from 'lucide-react';
import StickerBadge from '@/components/StickerBadge';
import PromoCodeCard from '@/components/PromoCodeCard';
import { toast } from 'sonner';

import bookmarkSticker from '@/assets/bookmark-sticker.json.asset.json';
import { telegramApiPost, getInitData, API_BASE } from '@/lib/telegramApi';
import { showMonetagAd } from '@/lib/monetag';
import { showAdsgramAd } from '@/lib/adsgram';
import { useWallet } from '@/context/WalletContext';
import { useCoins } from '@/context/CoinsContext';
import { useLanguage } from '@/context/LanguageContext';

const API = API_BASE;

interface Task {
  id: number;
  title: string;
  description: string;
  reward: number;
  isDaily: boolean;
  channelUsername?: string | null;
  taskType?: string | null;
  joinLink?: string | null;
  category?: string | null;
  botUsername?: string | null;
  twitterUrl?: string | null;
  slotLimit?: number | null;
  slotsFilled?: number;
  iconUrl?: string | null;
}

interface CompletionInfo {
  completedAt: Date | null;
  isDaily: boolean;
}

/** Format milliseconds as HH:MM:SS */
function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const DAILY_MS = 24 * 60 * 60 * 1000;

// ─── Daily Check-in Card ──────────────────────────────────────────────────────
interface CheckinState {
  rewards: number[];
  streakDay: number;
  nextDay: number;
  reward: number;
  canClaim: boolean;
  nextAvailableAt: string | null;
  adEnabled?: boolean;
}

function DailyCheckInCard({ onCoinsEarned }: { onCoinsEarned: (n: number) => void }) {
  const { t } = useLanguage();
  const [state, setState] = useState<CheckinState | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    const initData = getInitData();
    if (!initData) return;
    try {
      const res = await cachedFetch(`${API_BASE}/api/tasks/checkin`, { headers: { 'x-init-data': initData } });
      if (res.ok) setState((await res.json()) as CheckinState);
    } catch { /* best-effort */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const claim = async () => {
    if (claiming || !state?.canClaim) return;
    setClaiming(true);
    setMsg(null);
    try {
      // Admin-configurable gate (Monetag): must watch a full ad before the
      // daily reward can be claimed — a skip/close/load failure rejects and
      // no claim request is sent. Disabled entirely when the admin turns
      // this placement off.
      if (state?.adEnabled !== false) {
        try {
          await showMonetagAd();
        } catch {
          setMsg({ ok: false, text: t('tasks_ads_failed') });
          return;
        }
      }
      const data = await telegramApiPost<{ ok: boolean; coinsEarned?: number; message?: string }>(
        '/tasks/checkin', {},
      );
      if (data.ok && data.coinsEarned) {
        onCoinsEarned(data.coinsEarned);
        setMsg({ ok: true, text: `✅ +${data.coinsEarned} MNX` });
        notifyDataChange('balance', 'tasks');
      } else {
        setMsg({ ok: false, text: t('tasks_checkin_already') });
      }
      await load();
    } catch (e: unknown) {
      setMsg({ ok: false, text: `❌ ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setClaiming(false);
      setTimeout(() => setMsg(null), 3500);
    }
  };

  const rewards = state?.rewards ?? [2, 3, 4, 5, 6, 7, 10];
  const nextDay = state?.nextDay ?? 1;
  const canClaim = state?.canClaim ?? false;
  // When the day is already claimed, show the day that was just claimed (not the upcoming one).
  const displayDay = canClaim ? nextDay : Math.max(1, nextDay - 1);
  const remaining = state?.nextAvailableAt ? new Date(state.nextAvailableAt).getTime() - now : 0;

  return (
    <TaskCard>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <TaskIconBox>
            <CalendarCheck className="w-6 h-6 text-primary" />
          </TaskIconBox>
          <div className="min-w-0">
            <div className="font-bold text-sm text-foreground">{t('tasks_checkin_title')}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {t('tasks_checkin_day', { day: String(displayDay), reward: String(rewards[displayDay - 1] ?? 0) })}
            </div>
            {canClaim && <div className="text-[10px] text-violet-500 mt-0.5">{t('tasks_checkin_ad_hint')}</div>}
          </div>
        </div>

        <button
          onClick={claim}
          disabled={claiming || !canClaim}
          className="flex-shrink-0 px-4 py-2 rounded-xl font-bold text-xs transition-all active:scale-95 flex items-center gap-1.5"
          style={{
            background: canClaim ? 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)' : 'rgba(139,92,246,0.10)',
            color: canClaim ? '#fff' : '#9a97ad',
            cursor: canClaim ? 'pointer' : 'not-allowed',
          }}
        >
          {claiming
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : canClaim
              ? t('tasks_checkin_claim')
              : formatCountdown(remaining)}
        </button>
      </div>

      <div className="flex gap-1.5 mt-3">
        {rewards.map((r, i) => {
          const day = i + 1;
          const claimed = day < nextDay;
          const isNext = canClaim && day === nextDay;
          return (
            <div
              key={day}
              className="flex-1 rounded-lg py-1.5 text-center"
              style={{
                background: claimed ? 'rgba(139,92,246,0.2)' : isNext ? 'rgba(139,92,246,0.18)' : 'rgba(139,92,246,0.06)',
                border: `1px solid ${claimed ? 'rgba(139,92,246,0.35)' : isNext ? 'rgba(139,92,246,0.4)' : 'rgba(139,92,246,0.15)'}`,
              }}
            >
              <div className="text-[9px] text-muted-foreground whitespace-nowrap">{t('tasks_checkin_day_short', { day: String(day) })}</div>
              <div className="text-[11px] font-bold text-foreground">{r}</div>
            </div>
          );
        })}
      </div>

      {msg && (
        <div
          className="mt-2 text-xs font-medium px-2 py-1 rounded-lg"
          style={{
            background: msg.ok ? 'rgba(139,92,246,0.1)' : 'rgba(239,68,68,0.1)',
            color: msg.ok ? '#a78bfa' : '#f87171',
          }}
        >
          {msg.text}
        </div>
      )}
    </TaskCard>
  );
}

// ─── Watch & Earn Ad Card (Monetag, zone 11590639) ───────────────────────────
interface AdsStatus {
  enabled: boolean;
  watchedToday: number;
  remainingToday: number;
  rewardCoins: number;
  dailyLimit: number;
}

function WatchAdCard({ onCoinsEarned }: { onCoinsEarned: (n: number) => void }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<AdsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const initData = getInitData();
    if (!initData) return;
    try {
      const res = await cachedFetch(`${API_BASE}/api/tasks/ads-status`, {
        headers: { 'x-init-data': initData },
      });
      if (res.ok) setStatus((await res.json()) as AdsStatus);
    } catch {
      /* best-effort — the card just stays hidden/disabled until the next load */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const canWatch = !!status?.enabled && status.remainingToday > 0;

  const watch = async () => {
    // Guards against a double-tap or reopening the ad firing a second reward.
    if (busy || !canWatch) return;
    setBusy(true);
    setMsg(null);
    try {
      // Resolves only once the ad was watched to completion; a skip/close/
      // load failure rejects and no reward is requested below.
      await showMonetagAd();
      const data = await telegramApiPost<{ ok: boolean; coinsEarned?: number }>(
        '/tasks/ads-watched',
        { credit: true },
      );
      if (data.ok && data.coinsEarned) {
        onCoinsEarned(data.coinsEarned);
        setMsg({ ok: true, text: `✅ +${data.coinsEarned} MNX` });
        notifyDataChange('balance', 'tasks');
      } else {
        setMsg({ ok: false, text: t('tasks_ads_limit_reached') });
      }
      await load();
    } catch {
      setMsg({ ok: false, text: t('tasks_ads_failed') });
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 3500);
    }
  };

  if (!status?.enabled) return null;

  return (
    <TaskCard>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <TaskIconBox>
            <PlayCircle className="w-6 h-6 text-primary" />
          </TaskIconBox>
          <div className="min-w-0">
            <div className="font-bold text-sm text-foreground">{t('tasks_ads_title')}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {t('tasks_ads_desc', { reward: String(status.rewardCoins) })}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {t('tasks_ads_progress', {
                watched: String(status.watchedToday),
                limit: String(status.dailyLimit),
              })}
            </div>
          </div>
        </div>

        <button
          onClick={watch}
          disabled={busy || !canWatch}
          className="flex-shrink-0 px-4 py-2 rounded-xl font-bold text-xs transition-all active:scale-95 flex items-center gap-1.5"
          style={{
            background: canWatch ? 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)' : 'rgba(139,92,246,0.10)',
            color: canWatch ? '#fff' : '#9a97ad',
            cursor: busy || !canWatch ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : !canWatch ? (
            t('tasks_ads_limit_reached')
          ) : (
            t('tasks_ads_watch')
          )}
        </button>
      </div>

      {msg && (
        <div
          className="mt-2 text-xs font-medium px-2 py-1 rounded-lg"
          style={{
            background: msg.ok ? 'rgba(139,92,246,0.1)' : 'rgba(239,68,68,0.1)',
            color: msg.ok ? '#a78bfa' : '#f87171',
          }}
        >
          {msg.text}
        </div>
      )}
    </TaskCard>
  );
}

// ─── Bonus Ad Card (AdsGram) ──────────────────────────────────────────────────
interface BonusAdStatus {
  enabled: boolean;
  watchedToday: number;
  remainingToday: number;
  rewardCoins: number;
  dailyLimit: number;
  taskClaimAdEnabled: boolean;
  blockId: string;
}

function BonusAdCard({
  onCoinsEarned,
  onConfig,
}: {
  onCoinsEarned: (n: number) => void;
  onConfig: (taskClaimAdEnabled: boolean) => void;
}) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<BonusAdStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const initData = getInitData();
    if (!initData) return;
    try {
      const res = await cachedFetch(`${API_BASE}/api/tasks/bonus-ads-status`, {
        headers: { 'x-init-data': initData },
      });
      if (res.ok) {
        const data = (await res.json()) as BonusAdStatus;
        setStatus(data);
        onConfig(data.taskClaimAdEnabled);
      }
    } catch {
      /* best-effort — the card just stays hidden/disabled until the next load */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const canWatch = !!status?.enabled && status.remainingToday > 0;

  const watch = async () => {
    // Guards against a double-tap or reopening the ad firing a second reward.
    if (busy || !canWatch || !status) return;
    setBusy(true);
    setMsg(null);
    try {
      // Resolves only once the ad was watched to completion; a skip/close/
      // load failure rejects and no reward is requested below.
      await showAdsgramAd(status.blockId);
      const data = await telegramApiPost<{ ok: boolean; coinsEarned?: number }>(
        '/tasks/bonus-ads-watched',
        {},
      );
      if (data.ok && data.coinsEarned) {
        onCoinsEarned(data.coinsEarned);
        setMsg({ ok: true, text: `✅ +${data.coinsEarned} MNX` });
        notifyDataChange('balance', 'tasks');
      } else {
        setMsg({ ok: false, text: t('tasks_ads_limit_reached') });
      }
      await load();
    } catch {
      setMsg({ ok: false, text: t('tasks_ads_failed') });
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 3500);
    }
  };

  if (!status?.enabled) return null;

  return (
    <TaskCard>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <TaskIconBox>
            <PlayCircle className="w-6 h-6 text-primary" />
          </TaskIconBox>
          <div className="min-w-0">
            <div className="font-bold text-sm text-foreground">{t('tasks_bonus_ad_title')}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{t('tasks_bonus_ad_desc')}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {t('tasks_ads_progress', {
                watched: String(status.watchedToday),
                limit: String(status.dailyLimit),
              })}
            </div>
          </div>
        </div>

        <button
          onClick={watch}
          disabled={busy || !canWatch}
          className="flex-shrink-0 px-4 py-2 rounded-xl font-bold text-xs transition-all active:scale-95 flex items-center gap-1.5"
          style={{
            background: canWatch ? 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)' : 'rgba(139,92,246,0.10)',
            color: canWatch ? '#fff' : '#9a97ad',
            cursor: busy || !canWatch ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : !canWatch ? (
            t('tasks_ads_limit_reached')
          ) : (
            t('tasks_bonus_ad_watch')
          )}
        </button>
      </div>

      {msg && (
        <div
          className="mt-2 text-xs font-medium px-2 py-1 rounded-lg"
          style={{
            background: msg.ok ? 'rgba(139,92,246,0.1)' : 'rgba(239,68,68,0.1)',
            color: msg.ok ? '#a78bfa' : '#f87171',
          }}
        >
          {msg.text}
        </div>
      )}
    </TaskCard>
  );
}

/**
 * Round task icon: shows the channel picture as a circle when the admin sets
 * one, otherwise the default icon.
 */
function TaskAvatar({
  task,
  isDone,
  fallback,
}: {
  task: Task;
  isDone: boolean;
  fallback: React.ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  const src = task.iconUrl && !broken ? task.iconUrl : null;

  if (src) {
    return (
      <div className="relative w-11 h-11 flex-shrink-0">
        <img
          src={src}
          alt={task.title}
          loading="lazy"
          onError={() => setBroken(true)}
          className={`w-11 h-11 rounded-full object-cover border ${
            isDone ? 'border-violet-500/30 opacity-60' : 'border-violet-500/40'
          }`}
        />
        {isDone && (
          <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-black p-0.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-violet-400" />
          </span>
        )}
      </div>
    );
  }

  return (
    <TaskIconBox>
      {isDone ? <CheckCircle2 className="w-5 h-5 text-primary" /> : fallback}
    </TaskIconBox>
  );
}

function TaskCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`w-full bg-card border border-violet-500/15 shadow-[0_4px_18px_rgba(0,0,0,0.35)] rounded-2xl p-4 text-right ${className ?? ''}`}>
      {children}
    </div>
  );
}

function TaskIconBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-primary/15 text-primary">
      {children}
    </div>
  );
}

// ─── Partner Task Card ────────────────────────────────────────────────────────
function PartnerTaskCard({
  task,
  isDone,
  isCompleting,
  feedback,
  onJoin,
  onVerify,
}: {
  task: Task;
  isDone: boolean;
  isCompleting: boolean;
  feedback: { msg: string; ok: boolean } | null;
  onJoin: () => void;
  onVerify: () => void;
}) {
  const { t } = useLanguage();
  return (
    <TaskCard>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <TaskAvatar
            task={task}
            isDone={isDone}
            fallback={<Radio className="w-5 h-5 text-primary" />}
          />
          <div className="min-w-0">
            <div className={`font-bold text-sm truncate ${isDone ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
              {task.title}
            </div>
            {task.description && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{task.description}</p>
            )}
            <div className={`text-xs font-black mt-0.5 ${isDone ? 'text-muted-foreground' : 'text-primary'}`}>
              +{task.reward} MNX
            </div>
          </div>
        </div>

        {!isDone && (
          <div className="flex flex-col gap-1.5 flex-shrink-0 items-end">
            <button
              onClick={onJoin}
              disabled={isCompleting}
              className="px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1 transition-all active:scale-95"
              style={{
                background: 'rgba(139,92,246,0.2)',
                color: '#c4b5fd',
                border: '1px solid rgba(139,92,246,0.3)',
              }}
            >
              <ExternalLink className="w-3 h-3" /> {t('tasks_join')}
            </button>
            <button
              onClick={onVerify}
              disabled={isCompleting}
              className="px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1 transition-all active:scale-95"
              style={{
                background: 'rgba(139,92,246,0.15)',
                color: '#8b5cf6',
                border: '1px solid rgba(139,92,246,0.3)',
              }}
            >
              {isCompleting ? <Loader2 className="w-3 h-3 animate-spin" /> : t('tasks_verify_check')}
            </button>
          </div>
        )}
      </div>

      {feedback && (
        <div
          className="mt-2 text-xs font-medium px-2 py-1 rounded-lg"
          style={{
            background: feedback.ok ? 'rgba(139,92,246,0.1)' : 'rgba(239,68,68,0.1)',
            color: feedback.ok ? '#a78bfa' : '#f87171',
          }}
        >
          {feedback.msg}
        </div>
      )}
    </TaskCard>
  );
}

// ─── X (Twitter) account linking ─────────────────────────────────────────────
function TwitterLinkCard({
  handle,
  onLinked,
}: {
  handle: string | null;
  onLinked: (h: string) => void;
}) {
  const { t } = useLanguage();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const link = async () => {
    if (busy || !value.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const data = await telegramApiPost<{ ok: boolean; handle?: string; message?: string }>(
        '/tasks/twitter-link',
        { handle: value.trim() },
      );
      if (data.ok && data.handle) {
        onLinked(data.handle);
        setValue('');
        setMsg({ ok: true, text: t('tasks_x_linked_ok') });
      } else {
        const errors: Record<string, string> = {
          invalid_handle: t('err_invalid_handle'),
          handle_already_linked: t('err_handle_taken'),
        };
        setMsg({ ok: false, text: `❌ ${errors[data.message ?? ''] ?? t('err_link_failed')}` });
      }
    } catch (e: unknown) {
      setMsg({ ok: false, text: `❌ ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 5000);
    }
  };

  return (
    <TaskCard>
      <div className="flex items-center gap-3">
        <TaskIconBox>
          <Twitter className="w-5 h-5 text-primary" />
        </TaskIconBox>
        <div className="min-w-0">
          <div className="font-bold text-sm text-foreground">{t('tasks_x_account')}</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {handle ? t('tasks_x_linked', { handle }) : t('tasks_x_link_hint')}
          </p>
        </div>
      </div>

      {!handle && (
        <div className="flex gap-2 mt-3">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            dir="ltr"
            placeholder={t('tasks_x_placeholder')}
            className="flex-1 min-w-0 bg-secondary border border-violet-500/20 rounded-xl px-3 py-2 text-foreground text-xs focus:outline-none focus:border-primary/50"
          />
          <button
            onClick={link}
            disabled={busy}
            className="px-3 py-2 rounded-xl font-bold text-xs bg-primary text-primary-foreground disabled:opacity-50 flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : t('tasks_link_btn')}
          </button>
        </div>
      )}

      {msg && (
        <div
          className="text-xs font-medium px-2 py-1 rounded-lg mt-2"
          style={{
            background: msg.ok ? 'rgba(139,92,246,0.1)' : 'rgba(239,68,68,0.1)',
            color: msg.ok ? '#a78bfa' : '#f87171',
          }}
        >
          {msg.text}
        </div>
      )}
    </TaskCard>
  );
}

/** X task: link account once → open the page and follow → verify. */
function TwitterTaskCard({
  task,
  isDone,
  linkedHandle,
  onVerify,
}: {
  task: Task;
  isDone: boolean;
  linkedHandle: string | null;
  onVerify: () => Promise<string | null>;
}) {
  const { t } = useLanguage();
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const openLink =
    task.twitterUrl ??
    (task.channelUsername ? `https://t.me/${task.channelUsername.replace('@', '')}` : null);

  const verify = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const err = await onVerify();
    setMsg(err ? { ok: false, text: `❌ ${err}` } : { ok: true, text: `✅ +${task.reward} MNX` });
    setBusy(false);
    setTimeout(() => setMsg(null), 5000);
  };

  return (
    <TaskCard>
      <div className="flex items-start gap-3">
        <TaskIconBox>
          {isDone ? (
            <CheckCircle2 className="w-5 h-5 text-primary" />
          ) : (
            <Twitter className="w-5 h-5 text-primary" />
          )}
        </TaskIconBox>
        <div className="min-w-0 flex-1">
          <div className={`font-bold text-sm ${isDone ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
            {task.title}
          </div>
          {task.description && <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>}
          <div className={`text-xs font-black mt-0.5 ${isDone ? 'text-muted-foreground' : 'text-primary'}`}>
            +{task.reward} MNX
          </div>
        </div>
      </div>

      {!isDone && (
        <div className="mt-3 space-y-2">
          {!linkedHandle ? (
            <div className="text-xs px-2 py-1.5 rounded-lg bg-violet-500/10 text-violet-400 font-medium">
              {t('tasks_link_x_first_warn')}
            </div>
          ) : (
            <div className="flex gap-2">
              {openLink && (
                <a
                  href={openLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpened(true)}
                  className="flex-1 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1 bg-primary/20 text-primary border border-primary/30"
                >
                  <ExternalLink className="w-3 h-3" /> {t('tasks_open_follow')}
                </a>
              )}
              <button
                onClick={verify}
                disabled={busy || (!!openLink && !opened)}
                className="flex-1 py-2 rounded-xl font-bold text-xs text-primary-foreground disabled:opacity-50 flex items-center justify-center gap-1"
                style={{ background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)' }}
              >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : t('tasks_verify_now')}
              </button>
            </div>
          )}
          {msg && (
            <div
              className="text-xs font-medium px-2 py-1 rounded-lg"
              style={{
                background: msg.ok ? 'rgba(139,92,246,0.1)' : 'rgba(239,68,68,0.1)',
                color: msg.ok ? '#a78bfa' : '#f87171',
              }}
            >
              {msg.text}
            </div>
          )}
        </div>
      )}
    </TaskCard>
  );
}

// ─── Submission Task Card (Twitter / Bot) ────────────────────────────────────
type SubStatus = { status: 'pending' | 'approved' | 'rejected'; payload: string; rejectReason?: string | null };

function SubmissionTaskCard({
  task,
  kind,
  isDone,
  submission,
  onSubmit,
}: {
  task: Task;
  kind: 'twitter' | 'bot';
  isDone: boolean;
  submission?: SubStatus;
  onSubmit: (value: string) => Promise<string | null>;
}) {
  const { t } = useLanguage();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const openLink =
    kind === 'twitter'
      ? task.twitterUrl ?? (task.channelUsername ? `https://t.me/${task.channelUsername.replace('@', '')}` : null)
      : task.botUsername
        ? `https://t.me/${task.botUsername.replace('@', '')}`
        : task.joinLink ?? null;

  const approved = isDone || submission?.status === 'approved';
  const pending = !approved && submission?.status === 'pending';

  const submit = async () => {
    if (busy || !value.trim()) return;
    setBusy(true);
    setMsg(null);
    const err = await onSubmit(value.trim());
    setMsg(err ? { ok: false, text: err } : { ok: true, text: kind === 'bot' ? t('tasks_link_verified') : t('tasks_proof_sent') });
    if (!err) setValue('');
    setBusy(false);
    setTimeout(() => setMsg(null), 5000);
  };

  return (
    <TaskCard>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <TaskIconBox>
            {approved ? (
              <CheckCircle2 className="w-5 h-5 text-primary" />
            ) : kind === 'twitter' ? (
              <Twitter className="w-5 h-5 text-primary" />
            ) : (
              <Bot className="w-5 h-5 text-primary" />
            )}
          </TaskIconBox>
          <div className="min-w-0">
            <div className={`font-bold text-sm ${approved ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{task.title}</div>
            {task.description && <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>}
            <div className={`text-xs font-black mt-0.5 ${approved ? 'text-muted-foreground' : 'text-primary'}`}>+{task.reward} MNX</div>
          </div>
        </div>
        {openLink && !approved && (
          <a
            href={openLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1 bg-primary/20 text-primary border border-primary/30"
          >
            <ExternalLink className="w-3 h-3" /> {t('tasks_open')}
          </a>
        )}
      </div>

      {!approved && (
        <div className="mt-3 space-y-2">
          {pending ? (
            <div className="text-xs px-2 py-1.5 rounded-lg bg-violet-500/10 text-violet-400 font-medium">
              {t('tasks_proof_pending', { payload: String(submission?.payload ?? '') })}
            </div>
          ) : (
            <>
              {submission?.status === 'rejected' && (
                <div className="text-xs px-2 py-1.5 rounded-lg bg-red-500/10 text-red-400">
                  {t('tasks_proof_rejected', { reason: submission.rejectReason ?? t('tasks_try_again') })}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  dir="ltr"
                  placeholder={kind === 'twitter' ? t('tasks_x_placeholder') : 'https://t.me/bot?start=...'}
                  className="flex-1 min-w-0 bg-secondary border border-violet-500/20 rounded-xl px-3 py-2 text-foreground text-xs focus:outline-none focus:border-primary/50"
                />
                <button
                  onClick={submit}
                  disabled={busy}
                  className="px-3 py-2 rounded-xl font-bold text-xs bg-primary text-primary-foreground disabled:opacity-50 flex items-center gap-1"
                >
                  {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : t('tasks_send')}
                </button>
              </div>
            </>
          )}
          {msg && (
            <div
              className="text-xs font-medium px-2 py-1 rounded-lg"
              style={{
                background: msg.ok ? 'rgba(139,92,246,0.1)' : 'rgba(239,68,68,0.1)',
                color: msg.ok ? '#a78bfa' : '#f87171',
              }}
            >
              {msg.text}
            </div>
          )}
        </div>
      )}
    </TaskCard>
  );
}

// ─── Friends milestones tab ─────────────────────────────────────────────────
type Milestone = { id: number; inviteCount: number; rewardCoins: number; reached: boolean; credited: boolean };

function FriendsMilestones() {
  const { t } = useLanguage();
  const [data, setData] = useState<{ count: number; milestones: Milestone[] } | null>(null);

  useEffect(() => {
    const initData = getInitData();
    if (!initData) return;
    cachedFetch(`${API}/api/telegram/referrals`, { headers: { 'x-init-data': initData } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d))
      .catch(() => {});
  }, []);

  const count = data?.count ?? 0;
  const milestones = data?.milestones ?? [];

  return (
    <div className="space-y-2">
      <TaskCard className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <TaskIconBox>
            <Users className="w-5 h-5 text-primary" />
          </TaskIconBox>
          <div>
            <div className="text-xs text-muted-foreground">{t('tasks_invited_count')}</div>
            <div className="text-3xl font-black text-primary">{count}</div>
          </div>
        </div>
      </TaskCard>
      {milestones.map((m) => (
        <TaskCard key={m.id} className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <TaskIconBox>
              {m.reached ? <CheckCircle2 className="w-5 h-5 text-primary" /> : <Users className="w-5 h-5 text-primary" />}
            </TaskIconBox>
            <div className="min-w-0">
              <div className="text-foreground font-bold text-sm">{t('tasks_invite_n', { n: String(m.inviteCount) })}</div>
              <div className="text-xs text-primary font-black">+{m.rewardCoins} MNX</div>
            </div>
          </div>
          <div className={`text-xs font-bold flex-shrink-0 ${m.reached ? 'text-primary' : 'text-muted-foreground'}`}>
            {m.reached ? t('tasks_done') : `${count}/${m.inviteCount}`}
          </div>
        </TaskCard>
      ))}
      {milestones.length === 0 && (
        <div className="text-center text-muted-foreground text-sm py-6">{t('tasks_no_invite_rewards')}</div>
      )}
    </div>
  );
}

// ─── Main Tasks Page ──────────────────────────────────────────────────────────
type TabKey = 'all' | 'channels' | 'daily' | 'friends' | 'twitter' | 'bots';

const TABS: Array<{ key: TabKey; labelKey: string }> = [
  { key: 'all', labelKey: 'tasks_tab_all' },
  { key: 'channels', labelKey: 'tasks_tab_channels' },
  { key: 'daily', labelKey: 'tasks_tab_daily' },
  { key: 'twitter', labelKey: 'tasks_tab_twitter' },
  { key: 'bots', labelKey: 'tasks_tab_bots' },
];

export default function Tasks() {
  const { addCoins } = useCoins();
  const { t } = useLanguage();
  const [tab, setTab] = useState<TabKey>(() => {
    if (typeof window === 'undefined') return 'all';
    const saved = window.localStorage.getItem('gm_tasks_tab') as TabKey | null;
    return saved && TABS.some((x) => x.key === saved) ? saved : 'all';
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('gm_tasks_tab', tab);
    } catch { /* ignore */ }
  }, [tab]);
  const [twitterHandle, setTwitterHandle] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [completions, setCompletions] = useState<Map<number, CompletionInfo>>(new Map());
  const [submissions, setSubmissions] = useState<Map<number, SubStatus>>(new Map());
  const [completing, setCompleting] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ id: number; msg: string; ok: boolean } | null>(null);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Admin-configurable gate: show a Monetag ad before a task reward is
  // claimed. Sourced from BonusAdCard's own status load (same settings,
  // one fetch) rather than a second request for the same data.
  const [taskClaimAdEnabled, setTaskClaimAdEnabled] = useState(false);
  const ensureClaimAd = useCallback(async (): Promise<boolean> => {
    if (!taskClaimAdEnabled) return true;
    try {
      await showMonetagAd();
      return true;
    } catch {
      return false;
    }
  }, [taskClaimAdEnabled]);

  const loadCompleted = useCallback(async () => {
    const initData = getInitData();
    if (!initData) return;
    try {
      const [doneRes, subRes, twRes] = await Promise.all([
        cachedFetch(`${API}/api/tasks/completed`, { headers: { 'x-init-data': initData } }),
        cachedFetch(`${API}/api/tasks/submissions`, { headers: { 'x-init-data': initData } }),
        cachedFetch(`${API}/api/tasks/twitter-link`, { headers: { 'x-init-data': initData } }),
      ]);
      if (twRes.ok) {
        const tw = (await twRes.json()) as { handle: string | null };
        setTwitterHandle(tw.handle ?? null);
      }
      if (doneRes.ok) {
        const data = (await doneRes.json()) as Array<{ taskId: number; completedAt: string | null; isDaily: boolean }>;
        setCompletions(new Map(data.map((i) => [i.taskId, { completedAt: i.completedAt ? new Date(i.completedAt) : null, isDaily: i.isDaily }])));
      }
      if (subRes.ok) {
        const subs = (await subRes.json()) as Array<{ taskId: number; status: SubStatus['status']; payload: string; rejectReason: string | null }>;
        setSubmissions(new Map(subs.map((s) => [s.taskId, { status: s.status, payload: s.payload, rejectReason: s.rejectReason }])));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([cachedFetch(`${API}/api/tasks`).then((r) => r.json()), loadCompleted()])
      .then(([taskData]) => {
        if (Array.isArray(taskData)) setTasks(taskData as Task[]);
      })
      .catch(() => setError(t('tasks_load_failed')))
      .finally(() => setLoading(false));
  }, [loadCompleted, t]);

  // React instantly to task/balance changes triggered anywhere in the app.
  useEffect(() => onDataChange((scopes) => {
    if (scopes.some((s) => s === 'tasks' || s === 'admin')) void loadCompleted();
  }), [loadCompleted]);

  const markDone = (task: Task) => {
    setCompletions((prev) => new Map(prev).set(task.id, { completedAt: new Date(), isDaily: task.isDaily }));
    if (task.slotLimit)
      setTasks((prev) =>
        prev.map((x) => (x.id === task.id ? { ...x, slotsFilled: (x.slotsFilled ?? 0) + 1 } : x)),
      );
    addCoins(task.reward);
    // Drop stale task/balance caches and re-sync in the background.
    notifyDataChange('tasks', 'balance');
    setFeedback({ id: task.id, msg: `✅ +${task.reward} MNX`, ok: true });
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleComplete = async (task: Task) => {
    if (completing !== null) return;
    setCompleting(task.id);
    try {
      if (task.channelUsername && task.channelUsername.trim()) {
        const handle = task.channelUsername.replace('@', '');
        window.open(task.joinLink ?? `https://t.me/${handle}`, '_blank');
        return;
      }
      if (!(await ensureClaimAd())) {
        setFeedback({ id: task.id, msg: `❌ ${t('tasks_ads_failed')}`, ok: false });
        return;
      }
      const data = await telegramApiPost<{ ok: boolean; message?: string }>('/tasks/complete', { taskId: task.id });
      if (data.ok) markDone(task);
      else setFeedback({ id: task.id, msg: `❌ ${data.message ?? t('tasks_error')}`, ok: false });
    } catch (e: unknown) {
      setFeedback({ id: task.id, msg: `❌ ${e instanceof Error ? e.message : String(e)}`, ok: false });
    } finally {
      setCompleting(null);
      setTimeout(() => setFeedback(null), 4000);
    }
  };

  const handleChannelVerify = async (task: Task) => {
    if (completing !== null) return;
    setCompleting(task.id);
    try {
      if (!(await ensureClaimAd())) {
        setFeedback({ id: task.id, msg: `❌ ${t('tasks_ads_failed')}`, ok: false });
        return;
      }
      const data = await telegramApiPost<{ ok: boolean; message?: string }>('/tasks/verify-channel', { taskId: task.id });
      if (data.ok) markDone(task);
      else
        setFeedback({
          id: task.id,
          msg:
            data.message === 'slots_full'
              ? `❌ ${t('tasks_slots_full')}`
              : `❌ ${data.message ?? t('tasks_not_verified')}`,
          ok: false,
        });
    } catch (e: unknown) {
      setFeedback({ id: task.id, msg: `❌ ${e instanceof Error ? e.message : String(e)}`, ok: false });
    } finally {
      setCompleting(null);
      setTimeout(() => setFeedback(null), 4000);
    }
  };

  const verifyTwitter = async (task: Task): Promise<string | null> => {
    try {
      if (!(await ensureClaimAd())) return t('tasks_ads_failed');
      const data = await telegramApiPost<{ ok: boolean; message?: string }>('/tasks/verify-twitter', {
        taskId: task.id,
      });
      const errors: Record<string, string> = {
        twitter_not_linked: t('err_twitter_not_linked'),
        already_completed: t('err_already_completed'),
        task_not_found: t('err_task_not_found'),
      };
      if (!data.ok) return errors[data.message ?? ''] ?? data.message ?? t('err_verify_failed');
      markDone(task);
      return null;
    } catch (e: unknown) {
      return e instanceof Error ? e.message : String(e);
    }
  };

  const submitProof = async (task: Task, kind: 'twitter' | 'bot', value: string): Promise<string | null> => {
    try {
      const data = await telegramApiPost<{ ok: boolean; message?: string; status?: SubStatus['status'] }>(
        kind === 'twitter' ? '/tasks/submit-twitter' : '/tasks/submit-bot',
        kind === 'twitter' ? { taskId: task.id, handle: value } : { taskId: task.id, link: value },
      );
      const errors: Record<string, string> = {
        invalid_handle: t('err_invalid_handle'),
        invalid_link: t('err_invalid_link'),
        wrong_bot: t('err_wrong_bot'),
        link_already_used: t('err_link_used'),
        already_submitted: t('err_already_submitted'),
        already_completed: t('err_already_completed'),
      };
      if (!data.ok) return errors[data.message ?? ''] ?? data.message ?? t('err_send_failed');
      setSubmissions((prev) => new Map(prev).set(task.id, { status: data.status ?? 'pending', payload: value }));
      if (data.status === 'approved') markDone(task);
      return null;
    } catch (e: unknown) {
      return e instanceof Error ? e.message : String(e);
    }
  };

  const visible = tasks.filter((task) => {
    // Completed tasks disappear (daily ones come back after their 24h reset).
    const completion = completions.get(task.id);
    if (completion) {
      const isDailyTask = task.isDaily || completion.isDaily;
      if (!isDailyTask) return false;
      const resetAt = completion.completedAt ? completion.completedAt.getTime() + DAILY_MS : 0;
      if (resetAt > now) return false;
    }
    if (tab === 'all') return true;
    if (tab === 'channels')
      return task.category === 'channels' || task.category === 'limited_channel' || !!task.channelUsername;
    if (tab === 'daily') return task.category === 'daily' || task.isDaily;
    if (tab === 'friends') return task.category === 'friends';
    if (tab === 'twitter') return task.category === 'twitter';
    return task.category === 'bots';
  });

  const partnerTasks = visible.filter((x) => x.category !== 'twitter' && x.category !== 'bots' && x.taskType === 'partner');
  const twitterTasks = visible.filter((x) => x.category === 'twitter');
  const botTasks = visible.filter((x) => x.category === 'bots');
  const regularTasks = visible.filter(
    (x) => x.category !== 'twitter' && x.category !== 'bots' && x.taskType !== 'partner',
  );

  return (
    <div className="min-h-full flex flex-col relative w-full px-4 pt-6">
      <div className="absolute inset-0 z-0" style={{ backgroundColor: 'hsl(var(--background))' }} />

      <div className="relative z-10 mb-3 flex items-center justify-between">
        <h1 className="text-3xl font-black text-foreground tracking-tight">{t('tasks_header')}</h1>
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
          <StickerBadge size={30} src={bookmarkSticker.url} />
        </div>
      </div>

      {/* Tabs bar */}
      <div className="relative z-10 -mx-4 px-4 mb-3 overflow-x-auto [-webkit-overflow-scrolling:touch]">
        <div className="flex gap-2 w-max pb-1">
          {TABS.map((item) => {
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className="px-3.5 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all active:scale-95"
                style={{
                  background: active ? 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)' : 'rgba(139,92,246,0.10)',
                  color: active ? '#fff' : '#6b6880',
                  border: `1px solid ${active ? 'transparent' : 'rgba(139,92,246,0.20)'}`,
                }}
              >
                {t(item.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative z-10 flex-1 space-y-3 pb-24">
        {(tab === 'all' || tab === 'daily') && (
          <>
            <DailyCheckInCard onCoinsEarned={(n) => addCoins(n)} />
            <WatchAdCard onCoinsEarned={(n) => addCoins(n)} />
            <BonusAdCard onCoinsEarned={(n) => addCoins(n)} onConfig={setTaskClaimAdEnabled} />
            <PromoCodeCard />
          </>
        )}


        {tab === 'friends' && <FriendsMilestones />}

        {loading && (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}
        {error && <div className="text-center text-red-400 text-sm py-4">{error}</div>}

        {(twitterTasks.length > 0 || tab === 'twitter') && (
          <TwitterLinkCard handle={twitterHandle} onLinked={(h) => setTwitterHandle(h)} />
        )}

        {twitterTasks.map((task) => (
          <TwitterTaskCard
            key={task.id}
            task={task}
            isDone={completions.has(task.id)}
            linkedHandle={twitterHandle}
            onVerify={() => verifyTwitter(task)}
          />
        ))}

        {botTasks.map((task) => (
          <SubmissionTaskCard
            key={task.id}
            task={task}
            kind="bot"
            isDone={completions.has(task.id)}
            submission={submissions.get(task.id)}
            onSubmit={(v) => submitProof(task, 'bot', v)}
          />
        ))}

        {partnerTasks.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 pt-1">
              <Users className="w-4 h-4" style={{ color: '#a78bfa' }} />
              <span className="text-xs font-black tracking-widest uppercase" style={{ color: '#a78bfa' }}>
                {t('tasks_partners')}
              </span>
              <div className="flex-1 h-px" style={{ background: 'rgba(139,92,246,0.25)' }} />
            </div>
            {partnerTasks.map((task) => (
              <PartnerTaskCard
                key={task.id}
                task={task}
                isDone={completions.has(task.id)}
                isCompleting={completing === task.id}
                feedback={feedback?.id === task.id ? feedback : null}
                onJoin={() => handleComplete(task)}
                onVerify={() => handleChannelVerify(task)}
              />
            ))}
          </div>
        )}

        {regularTasks.map((task) => {
          const completion = completions.get(task.id);
          const isDone = completion !== undefined;
          const isChannel = Boolean(task.channelUsername && task.channelUsername.trim());
          const isCompleting = completing === task.id;
          const fb = feedback?.id === task.id ? feedback : null;
          const msLeft =
            isDone && completion?.isDaily && completion.completedAt
              ? completion.completedAt.getTime() + DAILY_MS - now
              : 0;
          const isCountingDown = msLeft > 0;
          const slotLimit = task.slotLimit ?? 0;
          const slotsFilled = Math.min(task.slotsFilled ?? 0, slotLimit || Infinity);
          const slotsFull = slotLimit > 0 && slotsFilled >= slotLimit && !isDone;

          return (
            <div
              key={task.id}
              className="rounded-2xl p-4"
              style={{
                background: isDone
                  ? 'linear-gradient(135deg, rgba(139,92,246,0.18) 0%, hsl(var(--card)) 100%)'
                  : 'hsl(var(--card))',
                border: `1px solid ${isDone ? 'rgba(139,92,246,0.25)' : 'rgba(139,92,246,0.15)'}`,
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <TaskAvatar
                    task={task}
                    isDone={isDone}
                    fallback={<Circle className="w-5 h-5 text-muted-foreground" />}
                  />
                  <div className="min-w-0">
                    <div className={`font-bold text-sm truncate ${isDone ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                      {task.title}
                    </div>
                    {task.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{task.description}</p>}
                    <div className={`text-xs font-black mt-0.5 ${isDone ? 'text-muted-foreground' : 'text-primary'}`}>
                      +{task.reward} MNX
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-1 flex-shrink-0 items-end">
                  {slotsFull ? (
                    <div className="px-3 py-1.5 rounded-full bg-secondary border border-violet-500/20 text-muted-foreground text-xs font-bold">
                      {t('tasks_full')}
                    </div>
                  ) : isCountingDown ? (
                    <div className="px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs font-mono font-bold">
                      ⏱ {formatCountdown(msLeft)}
                    </div>
                  ) : !isDone ? (
                    isChannel ? (
                      <>
                        <button
                          onClick={() => handleComplete(task)}
                          disabled={isCompleting}
                          className="px-3 py-1.5 rounded-full bg-primary/20 border border-primary/30 text-primary text-xs font-bold flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" /> {t('tasks_join')}
                        </button>
                        <button
                          onClick={() => handleChannelVerify(task)}
                          disabled={isCompleting}
                          className="px-3 py-1.5 rounded-full bg-secondary hover:bg-secondary text-foreground text-xs font-bold"
                        >
                          {isCompleting ? '...' : t('tasks_verify')}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleComplete(task)}
                        disabled={isCompleting}
                        className="px-4 py-2 rounded-full bg-secondary hover:bg-secondary text-foreground text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {isCompleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
                        {t('tasks_complete')}
                      </button>
                    )
                  ) : null}
                </div>
              </div>

              {slotLimit > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-[11px] font-bold mb-1">
                    <span className="text-muted-foreground">{t('tasks_joined')}</span>
                    <span className="text-primary">{slotsFilled}/{slotLimit}</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(100, (slotsFilled / slotLimit) * 100)}%`,
                        background: 'linear-gradient(90deg, #8b5cf6 0%, #a78bfa 100%)',
                      }}
                    />
                  </div>
                </div>
              )}

              {fb && (
                <div className={`mt-2 text-xs font-medium px-2 py-1 rounded-lg ${fb.ok ? 'text-success bg-success/10' : 'text-red-400 bg-red-500/10'}`}>
                  {fb.msg}
                </div>
              )}
            </div>
          );
        })}

        {!loading && visible.length === 0 && tab !== 'friends' && (
          <div className="text-center text-muted-foreground text-sm py-8">{t('tasks_empty_section')}</div>
        )}
      </div>
    </div>
  );
}
