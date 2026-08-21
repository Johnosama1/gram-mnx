import { useCallback, useEffect, useState } from 'react';
import { Gift as GiftIcon, Lock, Loader2, ExternalLink, Users, Copy, Check, Ticket, ArrowRight, PlayCircle } from 'lucide-react';
import { API_BASE, getInitData } from '@/lib/telegramApi';
import { showAdsgramAd } from '@/lib/adsgram';
import StickerBadge from '@/components/StickerBadge';
import { useLanguage } from '@/context/LanguageContext';
import { toast } from 'sonner';

const BOT_USERNAME = 'GRAMMNX1_bot';
/** Must match GIFT_AD_CHANCE_STEP in src/lib/gift.server.ts. */
const AD_CHANCE_STEP = 10;

type GiftEntryMode = 'referral' | 'tasks' | 'ads';

type GiftWinner = { id: number; name: string | null; chances: number | null };

type GiftItem = {
  id: number;
  title: string;
  description: string;
  reward: number;
  link: string | null;
  imageUrl: string | null;
  capacity: number;
  participants: number;
  full: boolean;
  joined: boolean;
  chances: number;
  invitedCount: number;
  adsWatched: number;
  adsToday: number;
  adsDailyLimit: number;
  endsAt: string | null;
  expired: boolean;
  entryMode: GiftEntryMode;
  winnerCount: number;
  winners: GiftWinner[];
  settledAt: string | null;
};

function entryModeHint(mode: GiftEntryMode, t: (key: string) => string): string | null {
  return mode === 'tasks' ? t('gift_entry_hint_tasks') : null;
}

async function postAdsWatch(t: (key: string) => string): Promise<{ justUnlockedChance: boolean }> {
  const res = await fetch(`${API_BASE}/api/gift/ads-watch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: getInitData() }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; justUnlockedChance?: boolean };
  if (!res.ok) throw new Error(data.error || t('gift_ad_watch_failed'));
  return { justUnlockedChance: Boolean(data.justUnlockedChance) };
}

type GiftStatus = {
  enabled: boolean;
  message: string;
  gifts: GiftItem[];
  telegramId?: number | null;
  adminPreview?: boolean;
  blockId?: string;
};

/** Live remaining ms until endsAt — ticks every second while there's a deadline. */
function useCountdown(endsAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  return endsAt ? Math.max(0, Date.parse(endsAt) - now) : Infinity;
}

function formatCountdown(ms: number, daySuffix: string): string {
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const h = String(Math.floor((total % 86400) / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return days > 0 ? `${days}${daySuffix} ${h}:${m}:${s}` : `${h}:${m}:${s}`;
}

/** Small ticking countdown shown on a contest card. */
function GiftCountdown({ endsAt }: { endsAt: string | null }) {
  const { t } = useLanguage();
  const ms = useCountdown(endsAt);
  if (!endsAt) return <>{t('gift_no_deadline')}</>;
  if (ms <= 0) return <>{t('gift_ended')}</>;
  return <span className="font-mono tabular-nums" dir="ltr">{formatCountdown(ms, t('gift_day_short'))}</span>;
}

/** Highlighted banner shown once a contest has been settled and has winners. */
function GiftWinnerBanner({ gift }: { gift: GiftItem }) {
  const { t } = useLanguage();
  if (!gift.winners || gift.winners.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] font-bold text-amber-400 space-y-0.5">
      {gift.winners.map((w) => (
        <div key={w.id} className="flex items-center gap-1.5">
          🏆 {gift.winners.length > 1 ? '' : t('gift_winner_label')}{w.name ?? `#${w.id}`}
          {w.chances ? ` (×${w.chances}${t('gift_chances_suffix')})` : ''}
        </div>
      ))}
    </div>
  );
}

/** Prize artwork — supports Lottie .json files as well as regular images. */
export function GiftMedia({ url, size = 56 }: { url: string | null; size?: number }) {
  if (!url) {
    return (
      <div
        className="rounded-xl bg-[#8b5cf6]/15 border border-[#8b5cf6]/40 flex items-center justify-center shrink-0"
        style={{ width: size, height: size }}
      >
        <GiftIcon className="w-1/2 h-1/2 text-muted-foreground" />
      </div>
    );
  }
  if (url.toLowerCase().endsWith('.json')) return <StickerBadge src={url} size={size} />;
  return (
    <img
      src={url}
      alt="Gift"
      loading="lazy"
      className="rounded-xl object-cover shrink-0 border border-violet-500/25"
      style={{ width: size, height: size }}
    />
  );
}

const REF_KEY = 'gm_gift_ref';

/** Reads the inviter id from every place Telegram may expose the start param. */
function getStartRef(): number | null {
  const parse = (param: string) => {
    const s = param.trim();
    const short = /^g_?(\d+)$/.exec(s);
    if (short) return Number(short[1]);
    const legacy = /^gift_(\d+)_(\d+)$/.exec(s);
    return legacy ? Number(legacy[2]) : null;
  };

  try {
    const wa = window.Telegram?.WebApp as
      | { initDataUnsafe?: { start_param?: string }; initData?: string }
      | undefined;
    const sources: string[] = [];
    if (wa?.initDataUnsafe?.start_param) sources.push(wa.initDataUnsafe.start_param);
    if (wa?.initData) {
      const p = new URLSearchParams(wa.initData).get('start_param');
      if (p) sources.push(p);
    }
    const url = new URLSearchParams(window.location.search);
    for (const key of ['tgWebAppStartParam', 'startapp', 'start', 'ref']) {
      const v = url.get(key);
      if (v) sources.push(v);
    }
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const h = hash.get('tgWebAppStartParam');
    if (h) sources.push(h);

    for (const s of sources) {
      const id = parse(s);
      if (id) {
        try { localStorage.setItem(REF_KEY, String(id)); } catch { /* ignore */ }
        return id;
      }
    }
    const stored = Number(localStorage.getItem(REF_KEY) ?? 0);
    return stored > 0 ? stored : null;
  } catch {
    return null;
  }
}


export default function GiftScreen() {
  const { t } = useLanguage();
  const [state, setState] = useState<GiftStatus | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [adWatching, setAdWatching] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/gift/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: getInitData() }),
      });
      setState((await res.json()) as GiftStatus);
    } catch {
      setState({ enabled: false, message: '', gifts: [] });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const join = async (gift: GiftItem) => {
    setBusy(gift.id);
    try {
      const res = await fetch(`${API_BASE}/api/gift/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: getInitData(), giftId: gift.id, ref: getStartRef() }),
      });
      const data = (await res.json()) as GiftStatus & { error?: string };
      if (!res.ok) throw new Error(data.error || t('gift_join_failed'));
      setState(data);
      setActive(gift.id);
      toast.success(gift.entryMode === 'ads' ? t('gift_joined_ads') : t('gift_joined_referral'));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /** Watches one more ad from inside an already-joined ads-mode contest. */
  const watchMoreAds = async (gift: GiftItem) => {
    if (adWatching) return;
    setAdWatching(true);
    try {
      await showAdsgramAd(state?.blockId || '43843');
      const { justUnlockedChance } = await postAdsWatch(t);
      toast.success(justUnlockedChance ? t('gift_extra_chance') : t('gift_view_recorded'));
      await load();
    } catch (e) {
      toast.error((e as Error).message || t('gift_ad_show_failed'));
    } finally {
      setAdWatching(false);
    }
  };

  const inviteLink = (_giftId: number) =>
    `https://t.me/${BOT_USERNAME}?startapp=g_${state?.telegramId ?? ''}`;


  const copyInvite = async (giftId: number) => {
    const link = inviteLink(giftId);
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      /* clipboard may be blocked inside Telegram */
    }
    setCopied(giftId);
    toast.success(t('gift_link_copied'));
    setTimeout(() => setCopied(null), 2000);
  };

  const activeGift = state?.gifts.find((g) => g.id === active) ?? null;

  if (activeGift) {
    const link = inviteLink(activeGift.id);
    return (
      <div className="h-full overflow-y-auto px-4 pt-5 pb-28">
        <button
          onClick={() => setActive(null)}
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground"
        >
          <ArrowRight className="w-4 h-4" /> {t('gift_back')}
        </button>

        <div className="rounded-2xl border border-violet-500/15 bg-card shadow-[0_4px_18px_rgba(0,0,0,0.35)] p-5 text-center">
          <div className="flex justify-center mb-3">
            <GiftMedia url={activeGift.imageUrl} size={110} />
          </div>
          <h2 className="text-lg font-extrabold text-muted-foreground">{activeGift.title}</h2>
          {activeGift.description && (
            <p className="text-xs text-violet-600/70 mt-1 whitespace-pre-wrap">{activeGift.description}</p>
          )}
          {activeGift.winners.length > 0 ? (
            <div className="mt-3">
              <GiftWinnerBanner gift={activeGift} />
            </div>
          ) : (
            <p className="text-[11px] text-violet-600/70 mt-2">⏱ <GiftCountdown endsAt={activeGift.endsAt} /></p>
          )}
        </div>

        {activeGift.winners.length > 0 ? null : activeGift.entryMode === 'ads' ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-violet-500/15 bg-card shadow-[0_4px_18px_rgba(0,0,0,0.35)] p-2.5 text-center">
                <p className="text-[10px] text-violet-600/70">{t('gift_ads_watched_label')}</p>
                <p className="text-lg font-extrabold text-muted-foreground">{activeGift.adsWatched}</p>
              </div>
              <div className="rounded-2xl border border-violet-500/15 bg-card shadow-[0_4px_18px_rgba(0,0,0,0.35)] p-2.5 text-center">
                <p className="text-[10px] text-violet-600/70">{t('gift_next_chance_label')}</p>
                <p className="text-lg font-extrabold text-muted-foreground">
                  {activeGift.adsWatched % AD_CHANCE_STEP}/{AD_CHANCE_STEP}
                </p>
              </div>
              <div className="rounded-2xl border border-violet-500/15 bg-card shadow-[0_4px_18px_rgba(0,0,0,0.35)] p-2.5 text-center">
                <p className="text-[10px] text-violet-600/70">{t('gift_today_label')}</p>
                <p className="text-lg font-extrabold text-muted-foreground">
                  {activeGift.adsToday}/{activeGift.adsDailyLimit}
                </p>
              </div>
              <div className="rounded-2xl border border-violet-500/15 bg-card shadow-[0_4px_18px_rgba(0,0,0,0.35)] p-2.5 text-center">
                <p className="text-[10px] text-violet-600/70">{t('gift_chances_label')}</p>
                <p className="text-lg font-extrabold text-muted-foreground">×{activeGift.chances}</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-violet-500/15 bg-card shadow-[0_4px_18px_rgba(0,0,0,0.35)] p-4">
              <p className="text-xs text-violet-600/80 mb-3">
                {t('gift_watch_hint', { limit: String(activeGift.adsDailyLimit) })}
              </p>
              <button
                disabled={adWatching || activeGift.adsToday >= activeGift.adsDailyLimit}
                onClick={() => { void watchMoreAds(activeGift); }}
                className="w-full rounded-xl bg-[#8b5cf6] text-primary-foreground font-bold py-2.5 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {adWatching ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                {activeGift.adsToday >= activeGift.adsDailyLimit
                  ? t('gift_daily_limit_reached')
                  : t('gift_watch_ad')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-violet-500/15 bg-card shadow-[0_4px_18px_rgba(0,0,0,0.35)] p-3 text-center">
                <p className="text-[11px] text-violet-600/70">{t('gift_invited_label')}</p>
                <p className="text-xl font-extrabold text-muted-foreground">{activeGift.invitedCount}</p>
              </div>
              <div className="rounded-2xl border border-violet-500/15 bg-card shadow-[0_4px_18px_rgba(0,0,0,0.35)] p-3 text-center">
                <p className="text-[11px] text-violet-600/70">{t('gift_chances_label')}</p>
                <p className="text-xl font-extrabold text-muted-foreground">×{activeGift.chances}</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-violet-500/15 bg-card shadow-[0_4px_18px_rgba(0,0,0,0.35)] p-4">
              <p className="text-xs text-violet-600/80 mb-2">
                {t('gift_invite_hint')}
              </p>
              <p
                dir="ltr"
                className="text-[11px] text-muted-foreground break-all bg-secondary rounded-xl border border-violet-500/20 px-3 py-2"
              >
                {link}
              </p>
              <button
                onClick={() => { void copyInvite(activeGift.id); }}
                className="mt-3 w-full rounded-xl bg-[#8b5cf6] text-primary-foreground font-bold py-2.5 text-sm flex items-center justify-center gap-2"
              >
                {copied === activeGift.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {t('gift_copy_invite')}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (

    <div className="h-full overflow-y-auto px-4 pt-5 pb-28">
      <header className="flex items-center gap-2 mb-5">
        <GiftIcon className="w-6 h-6 text-muted-foreground" />
        <h1 className="text-xl font-extrabold text-muted-foreground">{t('gift_header_title')}</h1>
      </header>

      {!state && (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {state && !state.enabled && (
        <div className="rounded-2xl border border-violet-500/15 bg-card shadow-[0_4px_18px_rgba(0,0,0,0.35)] p-8 text-center">
          <Lock className="w-10 h-10 mx-auto text-violet-600/60 mb-3" />
          <p className="text-muted-foreground font-bold">{state.message || t('gift_coming_soon')}</p>
        </div>
      )}

      {state?.adminPreview && (
        <div className="mb-4 rounded-xl border border-[#8b5cf6]/40 bg-[#8b5cf6]/10 px-3 py-2 text-xs text-muted-foreground">
          {t('gift_admin_preview')}
        </div>
      )}

      {state?.enabled && state.gifts.length === 0 && (
        <div className="rounded-2xl border border-violet-500/15 bg-card shadow-[0_4px_18px_rgba(0,0,0,0.35)] p-8 text-center text-violet-600/70 text-sm">
          {t('gift_no_contests')}
        </div>
      )}

      <div className="space-y-4">
        {state?.enabled &&
          state.gifts.map((g) => {
            const pct = g.capacity > 0 ? Math.min(100, (g.participants / g.capacity) * 100) : 0;
            return (
              <div key={g.id} className="rounded-2xl border border-violet-500/15 bg-card shadow-[0_4px_18px_rgba(0,0,0,0.35)] p-4">
                <div className="flex items-start gap-3">
                  <GiftMedia url={g.imageUrl} size={64} />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-muted-foreground">{g.title}</p>
                    {g.description && (
                      <p className="text-xs text-violet-600/70 mt-1 whitespace-pre-wrap">{g.description}</p>
                    )}
                    {g.link && (
                      <a
                        href={g.link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground mt-1 underline"
                      >
                        {t('gift_open_link')} <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between text-[11px] text-violet-600/70 mb-1">
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" /> {g.participants}
                      {g.capacity > 0 ? ` / ${g.capacity}` : t('gift_participant_suffix')}
                    </span>
                    {g.capacity === 0 && <span>{t('gift_open_unlimited')}</span>}
                  </div>
                  {g.winners.length > 0 ? (
                    <div className="mb-1"><GiftWinnerBanner gift={g} /></div>
                  ) : (
                    <p className="text-[11px] text-violet-600/70 mb-1">⏱ <GiftCountdown endsAt={g.endsAt} /></p>
                  )}
                  {!g.joined && entryModeHint(g.entryMode, t) && (
                    <p className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2 py-1.5 mb-1">
                      {entryModeHint(g.entryMode, t)}
                    </p>
                  )}
                  {g.capacity > 0 && (
                    <div className="h-2 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#8b5cf6] to-[#c4b5fd] transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>

                {g.joined ? (
                  <button
                    onClick={() => setActive(g.id)}
                    className="mt-3 w-full rounded-xl bg-[#8b5cf6] text-primary-foreground font-bold py-2.5 text-sm flex items-center justify-center gap-2"
                  >
                    <Ticket className="w-4 h-4" /> {t('gift_open_page')}
                  </button>
                ) : (
                  <button
                    disabled={busy === g.id || g.full || g.expired}
                    onClick={() => { void join(g); }}
                    className="mt-3 w-full rounded-xl bg-[#8b5cf6] text-primary-foreground font-bold py-2.5 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {busy === g.id && <Loader2 className="w-4 h-4 animate-spin" />}
                    {g.expired ? t('gift_ended') : g.full ? t('gift_full') : t('gift_join')}
                  </button>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
