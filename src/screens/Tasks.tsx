import { useEffect, useState, useCallback } from 'react';
import { cachedFetch, notifyDataChange, onDataChange } from '@/lib/apiCache';
import { CheckCircle2, Circle, ExternalLink, Loader2, Radio, Users, Twitter, Bot, CalendarCheck } from 'lucide-react';
import StickerBadge from '@/components/StickerBadge';
import WatchAdCard from '@/components/WatchAdCard';
import PromoCodeCard from '@/components/PromoCodeCard';
import { runAdGate } from '@/lib/adRewardGate';
import { toast } from 'sonner';

import bookmarkSticker from '@/assets/bookmark-sticker.json.asset.json';
import { telegramApiPost, getInitData, API_BASE } from '@/lib/telegramApi';
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
      // Rewarded video (max 20 per 24h) must complete before crediting.
      const outcome = await runAdGate(t);
      if (outcome !== 'ok') {
        toast.error(
          outcome === 'skip'
            ? t('ad_watch_full_to_claim')
            : t('ad_none_available'),
        );
        return;
      }
      const data = await telegramApiPost<{ ok: boolean; coinsEarned?: number; message?: string }>(
        '/tasks/checkin', {},
      );
      if (data.ok && data.coinsEarned) {
        onCoinsEarned(data.coinsEarned);
        setMsg({ ok: true, text: `✅ +${data.coinsEarned} coin` });
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
    <div
      className="rounded-2xl p-4"
      style={{
        background: 'linear-gradient(135deg, rgba(34,197,94,0.1) 0%, rgba(0,0,0,0.6) 100%)',
        border: '1px solid rgba(34,197,94,0.25)',
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)' }}
          >
            <CalendarCheck className="w-6 h-6 text-green-400" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-sm text-white">{t('tasks_checkin_title')}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {t('tasks_checkin_day', { day: String(displayDay), reward: String(rewards[displayDay - 1] ?? 0) })}
            </div>
          </div>
        </div>

        <button
          onClick={claim}
          disabled={claiming || !canClaim}
          className="flex-shrink-0 px-4 py-2 rounded-xl font-bold text-xs transition-all active:scale-95 flex items-center gap-1.5"
          style={{
            background: canClaim ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' : 'rgba(255,255,255,0.06)',
            color: canClaim ? '#000' : 'rgba(255,255,255,0.3)',
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
                background: claimed ? 'rgba(34,197,94,0.2)' : isNext ? 'rgba(245,166,35,0.18)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${claimed ? 'rgba(34,197,94,0.35)' : isNext ? 'rgba(245,166,35,0.4)' : 'rgba(255,255,255,0.08)'}`,
              }}
            >
              <div className="text-[9px] text-white/40 whitespace-nowrap">{t('tasks_checkin_day_short', { day: String(day) })}</div>
              <div className="text-[11px] font-bold text-white">{r}</div>
            </div>
          );
        })}
      </div>

      {msg && (
        <div
          className="mt-2 text-xs font-medium px-2 py-1 rounded-lg"
          style={{
            background: msg.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            color: msg.ok ? '#4ade80' : '#f87171',
          }}
        >
          {msg.text}
        </div>
      )}
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
    <div
      className="rounded-2xl p-4"
      style={{
        background: isDone
          ? 'linear-gradient(135deg, rgba(34,197,94,0.08) 0%, rgba(0,0,0,0.6) 100%)'
          : 'linear-gradient(135deg, rgba(99,102,241,0.1) 0%, rgba(0,0,0,0.6) 100%)',
        border: `1px solid ${isDone ? 'rgba(34,197,94,0.25)' : 'rgba(99,102,241,0.3)'}`,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: isDone ? 'rgba(34,197,94,0.15)' : 'rgba(99,102,241,0.15)',
              border: `1px solid ${isDone ? 'rgba(34,197,94,0.3)' : 'rgba(99,102,241,0.3)'}`,
            }}
          >
            {isDone
              ? <CheckCircle2 className="w-5 h-5 text-green-400" />
              : <Radio className="w-5 h-5" style={{ color: '#818cf8' }} />}
          </div>
          <div className="min-w-0">
            <div className={`font-bold text-sm truncate ${isDone ? 'text-white/50 line-through' : 'text-white'}`}>
              {task.title}
            </div>
            {task.description && (
              <p className="text-xs text-white/40 mt-0.5 truncate">{task.description}</p>
            )}
            <div className={`text-xs font-black mt-0.5 ${isDone ? 'text-white/30' : 'text-primary'}`}>
              +{task.reward} coin
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
                background: 'rgba(99,102,241,0.2)',
                color: '#a5b4fc',
                border: '1px solid rgba(99,102,241,0.3)',
              }}
            >
              <ExternalLink className="w-3 h-3" /> {t('tasks_join')}
            </button>
            <button
              onClick={onVerify}
              disabled={isCompleting}
              className="px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1 transition-all active:scale-95"
              style={{
                background: 'rgba(245,166,35,0.15)',
                color: '#F5A623',
                border: '1px solid rgba(245,166,35,0.3)',
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
            background: feedback.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            color: feedback.ok ? '#4ade80' : '#f87171',
          }}
        >
          {feedback.msg}
        </div>
      )}
    </div>
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
    <div
      className="rounded-2xl p-4"
      style={{
        background: handle
          ? 'linear-gradient(135deg, rgba(29,161,242,0.10) 0%, rgba(0,0,0,0.6) 100%)'
          : 'linear-gradient(135deg, rgba(29,161,242,0.18) 0%, rgba(0,0,0,0.6) 100%)',
        border: '1px solid rgba(29,161,242,0.35)',
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(29,161,242,0.15)', border: '1px solid rgba(29,161,242,0.3)' }}
        >
          <Twitter className="w-5 h-5" style={{ color: '#1DA1F2' }} />
        </div>
        <div className="min-w-0">
          <div className="font-bold text-sm text-white">{t('tasks_x_account')}</div>
          <p className="text-xs text-white/50 mt-0.5">
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
            className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-primary/50"
          />
          <button
            onClick={link}
            disabled={busy}
            className="px-3 py-2 rounded-xl font-bold text-xs bg-primary text-black disabled:opacity-50 flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : t('tasks_link_btn')}
          </button>
        </div>
      )}

      {msg && (
        <div
          className="text-xs font-medium px-2 py-1 rounded-lg mt-2"
          style={{
            background: msg.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            color: msg.ok ? '#4ade80' : '#f87171',
          }}
        >
          {msg.text}
        </div>
      )}
    </div>
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
  const accent = '#1DA1F2';

  const openLink =
    task.twitterUrl ??
    (task.channelUsername ? `https://t.me/${task.channelUsername.replace('@', '')}` : null);

  const verify = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const err = await onVerify();
    setMsg(err ? { ok: false, text: `❌ ${err}` } : { ok: true, text: `✅ +${task.reward} coin` });
    setBusy(false);
    setTimeout(() => setMsg(null), 5000);
  };

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: isDone
          ? 'linear-gradient(135deg, rgba(34,197,94,0.08) 0%, rgba(0,0,0,0.6) 100%)'
          : `linear-gradient(135deg, ${accent}1a 0%, rgba(0,0,0,0.6) 100%)`,
        border: `1px solid ${isDone ? 'rgba(34,197,94,0.25)' : `${accent}55`}`,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${accent}26`, border: `1px solid ${accent}4d` }}
        >
          {isDone ? (
            <CheckCircle2 className="w-5 h-5 text-green-400" />
          ) : (
            <Twitter className="w-5 h-5" style={{ color: accent }} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className={`font-bold text-sm ${isDone ? 'text-white/50 line-through' : 'text-white'}`}>
            {task.title}
          </div>
          {task.description && <p className="text-xs text-white/40 mt-0.5">{task.description}</p>}
          <div className={`text-xs font-black mt-0.5 ${isDone ? 'text-white/30' : 'text-primary'}`}>
            +{task.reward} coin
          </div>
        </div>
      </div>

      {!isDone && (
        <div className="mt-3 space-y-2">
          {!linkedHandle ? (
            <div className="text-xs px-2 py-1.5 rounded-lg bg-yellow-500/10 text-yellow-400 font-medium">
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
                  className="flex-1 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1"
                  style={{ background: `${accent}26`, color: accent, border: `1px solid ${accent}4d` }}
                >
                  <ExternalLink className="w-3 h-3" /> {t('tasks_open_follow')}
                </a>
              )}
              <button
                onClick={verify}
                disabled={busy || (!!openLink && !opened)}
                className="flex-1 py-2 rounded-xl font-bold text-xs text-black disabled:opacity-50 flex items-center justify-center gap-1"
                style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)' }}
              >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : t('tasks_verify_now')}
              </button>
            </div>
          )}
          {msg && (
            <div
              className="text-xs font-medium px-2 py-1 rounded-lg"
              style={{
                background: msg.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                color: msg.ok ? '#4ade80' : '#f87171',
              }}
            >
              {msg.text}
            </div>
          )}
        </div>
      )}
    </div>
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

  const accent = kind === 'twitter' ? '#1DA1F2' : '#a78bfa';
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
    <div
      className="rounded-2xl p-4"
      style={{
        background: approved
          ? 'linear-gradient(135deg, rgba(34,197,94,0.08) 0%, rgba(0,0,0,0.6) 100%)'
          : `linear-gradient(135deg, ${accent}1a 0%, rgba(0,0,0,0.6) 100%)`,
        border: `1px solid ${approved ? 'rgba(34,197,94,0.25)' : `${accent}55`}`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: `${accent}26`, border: `1px solid ${accent}4d` }}
          >
            {approved ? (
              <CheckCircle2 className="w-5 h-5 text-green-400" />
            ) : kind === 'twitter' ? (
              <Twitter className="w-5 h-5" style={{ color: accent }} />
            ) : (
              <Bot className="w-5 h-5" style={{ color: accent }} />
            )}
          </div>
          <div className="min-w-0">
            <div className={`font-bold text-sm ${approved ? 'text-white/50 line-through' : 'text-white'}`}>{task.title}</div>
            {task.description && <p className="text-xs text-white/40 mt-0.5">{task.description}</p>}
            <div className={`text-xs font-black mt-0.5 ${approved ? 'text-white/30' : 'text-primary'}`}>+{task.reward} coin</div>
          </div>
        </div>
        {openLink && !approved && (
          <a
            href={openLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1"
            style={{ background: `${accent}26`, color: accent, border: `1px solid ${accent}4d` }}
          >
            <ExternalLink className="w-3 h-3" /> {t('tasks_open')}
          </a>
        )}
      </div>

      {!approved && (
        <div className="mt-3 space-y-2">
          {pending ? (
            <div className="text-xs px-2 py-1.5 rounded-lg bg-yellow-500/10 text-yellow-400 font-medium">
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
                  className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-primary/50"
                />
                <button
                  onClick={submit}
                  disabled={busy}
                  className="px-3 py-2 rounded-xl font-bold text-xs bg-primary text-black disabled:opacity-50 flex items-center gap-1"
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
                background: msg.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                color: msg.ok ? '#4ade80' : '#f87171',
              }}
            >
              {msg.text}
            </div>
          )}
        </div>
      )}
    </div>
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
      <div className="rounded-2xl p-4" style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="text-xs text-muted-foreground">{t('tasks_invited_count')}</div>
        <div className="text-3xl font-black text-primary">{count}</div>
      </div>
      {milestones.map((m) => (
        <div
          key={m.id}
          className="rounded-2xl p-3.5 flex items-center justify-between gap-3"
          style={{
            background: m.reached ? 'linear-gradient(135deg, rgba(34,197,94,0.08) 0%, rgba(0,0,0,0.6) 100%)' : 'rgba(0,0,0,0.5)',
            border: `1px solid ${m.reached ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.08)'}`,
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)' }}
            >
              {m.reached ? <CheckCircle2 className="w-5 h-5 text-green-400" /> : <Users className="w-5 h-5" style={{ color: '#818cf8' }} />}
            </div>
            <div className="min-w-0">
              <div className="text-white font-bold text-sm">{t('tasks_invite_n', { n: String(m.inviteCount) })}</div>
              <div className="text-xs text-primary font-black">+{m.rewardCoins} coin</div>
            </div>
          </div>
          <div className="text-xs font-bold flex-shrink-0" style={{ color: m.reached ? '#4ade80' : 'rgba(255,255,255,0.35)' }}>
            {m.reached ? t('tasks_done') : `${count}/${m.inviteCount}`}
          </div>
        </div>
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

  /** Rewarded video must be watched before any task reward is granted. */
  const adGate = async (taskId: number): Promise<boolean> => {
    const outcome = await runAdGate(t);
    if (outcome === 'ok') return true;
    setFeedback({
      id: taskId,
      msg: `❌ ${outcome === 'skip' ? t('ad_watch_full_to_claim') : t('ad_none_available')}`,
      ok: false,
    });
    setTimeout(() => setFeedback(null), 4000);
    return false;
  };

  const markDone = (task: Task) => {
    setCompletions((prev) => new Map(prev).set(task.id, { completedAt: new Date(), isDaily: task.isDaily }));
    if (task.slotLimit)
      setTasks((prev) =>
        prev.map((x) => (x.id === task.id ? { ...x, slotsFilled: (x.slotsFilled ?? 0) + 1 } : x)),
      );
    addCoins(task.reward);
    // Drop stale task/balance caches and re-sync in the background.
    notifyDataChange('tasks', 'balance');
    setFeedback({ id: task.id, msg: `✅ +${task.reward} coin`, ok: true });
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
      if (!(await adGate(task.id))) return;
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
      if (!(await adGate(task.id))) return;
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
      if (!(await adGate(task.id))) return null;
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
      if (!(await adGate(task.id))) return null;
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
      <div className="absolute inset-0 z-0" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }} />

      <div className="relative z-10 mb-3 flex items-center justify-between">
        <h1 className="text-3xl font-black text-white tracking-tight">{t('tasks_header')}</h1>
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
                  background: active ? 'linear-gradient(135deg, #F5A623 0%, #E8920D 100%)' : 'rgba(255,255,255,0.06)',
                  color: active ? '#000' : 'rgba(255,255,255,0.6)',
                  border: `1px solid ${active ? 'transparent' : 'rgba(255,255,255,0.1)'}`,
                }}
              >
                {t(item.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto space-y-3 pb-8">
        {(tab === 'all' || tab === 'daily') && (
          <>
            <DailyCheckInCard onCoinsEarned={(n) => addCoins(n)} />
            <WatchAdCard />
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
              <Users className="w-4 h-4" style={{ color: '#818cf8' }} />
              <span className="text-xs font-black tracking-widest uppercase" style={{ color: '#818cf8' }}>
                {t('tasks_partners')}
              </span>
              <div className="flex-1 h-px" style={{ background: 'rgba(99,102,241,0.25)' }} />
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
                  ? 'linear-gradient(135deg, rgba(34,197,94,0.08) 0%, rgba(0,0,0,0.6) 100%)'
                  : 'rgba(0,0,0,0.5)',
                border: `1px solid ${isDone ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.08)'}`,
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-white/5 border border-white/10">
                    {isDone ? <CheckCircle2 className="w-5 h-5 text-green-400" /> : <Circle className="w-5 h-5 text-white/30" />}
                  </div>
                  <div className="min-w-0">
                    <div className={`font-bold text-sm truncate ${isDone ? 'text-white/50 line-through' : 'text-white'}`}>
                      {task.title}
                    </div>
                    {task.description && <p className="text-xs text-white/40 mt-0.5 truncate">{task.description}</p>}
                    <div className={`text-xs font-black mt-0.5 ${isDone ? 'text-white/30' : 'text-primary'}`}>
                      +{task.reward} coin
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-1 flex-shrink-0 items-end">
                  {slotsFull ? (
                    <div className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-white/40 text-xs font-bold">
                      {t('tasks_full')}
                    </div>
                  ) : isCountingDown ? (
                    <div className="px-3 py-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs font-mono font-bold">
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
                          className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold"
                        >
                          {isCompleting ? '...' : t('tasks_verify')}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleComplete(task)}
                        disabled={isCompleting}
                        className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
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
                    <span className="text-white/40">{t('tasks_joined')}</span>
                    <span className="text-primary">{slotsFilled}/{slotLimit}</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(100, (slotsFilled / slotLimit) * 100)}%`,
                        background: 'linear-gradient(90deg, #fbbf24 0%, #f59e0b 100%)',
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
