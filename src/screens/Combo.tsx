import { useState, useEffect } from 'react';
import { notifyDataChange } from '@/lib/apiCache';
import { Sparkles, CheckCircle2, XCircle, Loader2, Trophy, Clock } from 'lucide-react';
import { useCoins } from '@/context/CoinsContext';
import { toast } from 'sonner';
import { useLanguage } from '@/context/LanguageContext';

import { ApiError, telegramApiFetch } from '@/lib/telegramApi';
import StickerBadge from '@/components/StickerBadge';
import sparksSticker from '@/assets/sparks-sticker.json.asset.json';
import { COMBO_ITEMS } from '@/lib/combo-items';
import { showAdsgramAd } from '@/lib/adsgram';


// Max allowed attempts per day
const MAX_DAILY_ATTEMPTS = 1;

type ComboResult = { ok: boolean; success: boolean; reward: number; nextResetAt?: string };

/** hh:mm:ss until the next daily reset */
function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export default function Combo() {
  const { addCoins } = useCoins();
  const { t } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [attemptedToday, setAttempted] = useState(false);
  const [attemptsUsed, setAttemptsUsed] = useState(0);
  const [prevSuccess, setPrevSuccess] = useState<boolean | null>(null);
  const [prevReward, setPrevReward] = useState<number | null>(null);

  const [selected, setSelected] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ComboResult | null>(null);
  const [error, setError] = useState('');
  const [nextReset, setNextReset] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [adEnabled, setAdEnabled] = useState(false);
  const [adsgramBlockId, setAdsgramBlockId] = useState('43843');

  // Tick the countdown every second while a reset time is known
  useEffect(() => {
    if (nextReset === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [nextReset]);

  // ── Load today's status ──────────────────────────────────────────────────
  useEffect(() => {
    telegramApiFetch('/tasks?type=combo')
      .then(r => r.json())
      .then(data => {
        const attempted = data.attemptedToday ?? false;
        setAttempted(attempted);
        setAttemptsUsed(attempted ? MAX_DAILY_ATTEMPTS : 0);
        setPrevSuccess(data.success ?? null);
        setPrevReward(data.reward ?? null);
        if (attempted && Array.isArray(data.correctIds) && data.correctIds.length === 3) {
          setSelected(data.correctIds.map(Number));
        }
        if (data.nextResetAt) setNextReset(new Date(data.nextResetAt).getTime());
        setAdEnabled(Boolean(data.adEnabled));
        if (data.blockId) setAdsgramBlockId(String(data.blockId));
      })
      .catch((err: unknown) => {
        console.error('[combo] status load failed', err);
        setError(err instanceof Error ? err.message : t('combo_error'));
      })
      .finally(() => setLoading(false));
  }, []);

  const attemptsRemaining = Math.max(0, MAX_DAILY_ATTEMPTS - attemptsUsed);

  // ── Toggle card selection (max 3) ────────────────────────────────────────
  function toggleSelect(id: number) {
    if (attemptedToday || result) return;
    setSelected(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 3)  return prev;
      return [...prev, id];
    });
  }

  

  // ── Submit attempt ───────────────────────────────────────────────────────
  async function handleSubmit() {
    if (selected.length !== 3 || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      // Admin-configurable gate: must watch a full AdsGram ad before the
      // combo can be submitted — a skip/close/load failure stops here and no
      // submit request is sent, so today's one attempt is never consumed.
      if (adEnabled) {
        try {
          await showAdsgramAd(adsgramBlockId);
        } catch {
          setError(t('tasks_ads_failed'));
          return;
        }
      }
      // retries: 0 — this is a non-idempotent mutation (consumes today's one
      // attempt), so a stalled request must fail fast instead of silently
      // retrying and doubling how long "Checking..." sits on screen.
      const res = await telegramApiFetch(
        '/tasks?type=combo&action=submit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ selectedIds: selected }),
        },
        { retries: 0 },
      );
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'already_attempted') {
          setAttempted(true);
          setAttemptsUsed(MAX_DAILY_ATTEMPTS);
          setError(t('combo_already_attempted'));
        } else {
          setError(data.error || t('combo_error'));
        }
        return;
      }
      setResult(data);
      setAttempted(true);
      setAttemptsUsed(MAX_DAILY_ATTEMPTS);
      if (data.nextResetAt) setNextReset(new Date(data.nextResetAt).getTime());
      if (data.success && data.reward > 0) addCoins(data.reward);
      notifyDataChange('combo', 'balance');
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 409) {
        setAttempted(true);
        setAttemptsUsed(MAX_DAILY_ATTEMPTS);
        setError(t('combo_already_attempted'));
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || t('combo_submit_failed'));
    } finally {
      setSubmitting(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  const isDone = attemptedToday && !result;
  const showSuccess = result ? result.success : (isDone ? prevSuccess : null);
  const showReward  = result ? result.reward  : (isDone ? prevReward  : null);
  const locked = attemptedToday || !!result;
  const remainingMs = nextReset !== null ? nextReset - now : null;
  const countdown =
    remainingMs !== null && remainingMs > 0 ? formatCountdown(remainingMs) : null;

  return (
    <div className="min-h-full flex flex-col relative w-full">
      <div className="absolute inset-0 z-0" style={{ backgroundColor: 'hsl(var(--background))' }} />

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-4 py-4 border-b border-violet-500/20">
        <div className="flex items-center gap-3">
          <StickerBadge size={36} src={sparksSticker.url} />
          <div>
            <h1 className="text-lg font-black text-foreground">{t('combo_title')}</h1>
            <p className="text-[10px] text-muted-foreground">{t('combo_subtitle')}</p>
          </div>
        </div>
        {/* Attempts status indicator */}
        <div className="flex flex-col items-end">
          <div className="flex items-center gap-1">
            {Array.from({ length: MAX_DAILY_ATTEMPTS }, (_, i) => {
              const used = i < attemptsUsed;
              const statusColor = used
                ? (showSuccess === true ? 'bg-emerald-500' : 'bg-destructive')
                : 'bg-primary';
              return (
                <div
                  key={i}
                  className={`w-3 h-3 rounded-full transition-all ${statusColor}`}
                />
              );
            })}
          </div>
          <span className={`text-[10px] mt-0.5 font-medium ${
            attemptsUsed
              ? (showSuccess === true ? 'text-emerald-400' : 'text-destructive')
              : 'text-muted-foreground'
          }`}>
            {attemptsUsed}/{MAX_DAILY_ATTEMPTS} {t('combo_used')}
          </span>
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto p-4 space-y-5">

        {loading ? (
          <div className="flex justify-center pt-16">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : (
          <>
            {/* ── Top selected slots ─────────────────────────────────── */}
            <div className="relative rounded-2xl border border-violet-500/30 bg-gradient-to-b from-violet-500/10 to-transparent p-3 pt-8">
              {/* Countdown chip (top-right) */}
              {countdown && (
                <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-secondary border border-violet-500/30 px-2 py-1">
                  <Clock className="w-3 h-3 text-primary" />
                  <span className="text-[10px] font-black tabular-nums text-primary">{countdown}</span>
                </div>
              )}
              <span className="absolute top-2.5 left-3 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {t('combo_attempts_today')} · {attemptsUsed}/{MAX_DAILY_ATTEMPTS}
              </span>

              <div className="grid grid-cols-3 gap-2">
                {[0, 1, 2].map(i => {
                  const id = selected[i];
                  const item = COMBO_ITEMS.find(x => x.id === id);
                  const wrong = showSuccess === false;
                  const good = showSuccess === true;
                  return (
                    <button
                      key={i}
                      onClick={() => id && !locked && toggleSelect(id)}
                      disabled={!id || locked}
                      className={`relative aspect-square rounded-xl border-2 border-dashed flex items-center justify-center
                        overflow-hidden transition-all duration-300
                        ${item ? 'border-solid animate-scale-in' : 'bg-secondary'}
                        ${wrong ? 'border-destructive' : good ? 'border-emerald-500' : item ? 'border-violet-500/60' : 'border-violet-500/20'}
                        ${item && !locked ? 'active:scale-95' : ''}`}
                    >
                      {item ? (
                        <img src={item.img} alt={item.name} className="w-full h-full object-cover" draggable={false} />
                      ) : locked ? (
                        <CheckCircle2 className={`w-7 h-7 ${good ? 'text-emerald-400' : 'text-muted-foreground'}`} />
                      ) : (
                        <span className="text-muted-foreground text-lg font-black">{i + 1}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Thin result banner */}
            {(result || isDone) && showSuccess !== null && (
              <div className={`rounded-xl border px-3 py-2 flex items-center justify-center gap-2 text-center animate-fade-in
                ${showSuccess ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-destructive/10 border-destructive/30'}`}
              >
                {showSuccess ? (
                  <>
                    <Trophy className="w-4 h-4 text-violet-300 flex-shrink-0" />
                    <span className="text-xs font-black text-emerald-400">
                      {t('combo_correct_title')} +{showReward} MNX
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                    <span className="text-xs font-black text-destructive">
                      {t('combo_wrong_title')} — {t('combo_wrong_desc')}
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Already used today (and no fresh result yet) */}
            {isDone && showSuccess === null && (
              <div className="rounded-2xl border border-violet-500/20 bg-secondary p-4 flex items-center gap-3">
                <Clock className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                <p className="text-muted-foreground text-sm">
                  {t('combo_used_today', { time: countdown ?? '24:00:00' })}
                </p>
              </div>
            )}

            {/* Instructions */}
            {!isDone && !result && (
              <div className="bg-primary/5 border border-primary/20 rounded-2xl p-3 text-center">
                <p className="text-primary text-sm font-bold">
                  {t('combo_instructions_pre')} <span className="text-foreground font-black">{t('combo_instructions_items')}</span> {t('combo_instructions_post')}
                </p>
                <p className="text-muted-foreground text-xs mt-1">{t('combo_one_per_day')}</p>
              </div>
            )}


            {/* Cards grid */}
            <div className="grid grid-cols-5 gap-2">
              {COMBO_ITEMS.map(item => (
                <ItemCard
                  key={item.id}
                  item={item}
                  selected={selected.includes(item.id)}
                  disabled={locked}
                  onTap={() => toggleSelect(item.id)}
                />
              ))}
            </div>





            {/* Submit button */}
            {!locked && (
              <button
                onClick={handleSubmit}
                disabled={selected.length !== 3 || submitting}
                className="w-full bg-primary text-primary-foreground font-black rounded-2xl py-3.5 text-sm
                           flex items-center justify-center gap-2
                           disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                {submitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> {t('combo_checking')}</>
                ) : (
                  <><Sparkles className="w-4 h-4" /> {t('combo_check')}</>
                )}
              </button>
            )}

            {error && (
              <p className="text-center text-destructive text-sm">{error}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Item Card ───────────────────────────────────────────────────────────────
function ItemCard({
  item, selected, disabled, onTap,
}: {
  item: typeof COMBO_ITEMS[number];
  selected: boolean;
  disabled: boolean;
  onTap: () => void;
}) {
  return (
    <button
      onClick={onTap}
      disabled={disabled}
      className={`
        relative flex flex-col items-center justify-center gap-1
        rounded-2xl border p-1.5 pb-2
        bg-card border-violet-500/30
        transition-all duration-200 touch-manipulation
        ${selected ? 'ring-2 ring-violet-500 border-violet-400 shadow-lg shadow-violet-600/25' : 'opacity-90'}
        ${disabled ? 'cursor-default' : 'active:scale-95'}
      `}
    >
      {selected && (
        <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-violet-500 flex items-center justify-center">
          <CheckCircle2 className="w-3 h-3 text-foreground" />
        </div>
      )}
      <img
        src={item.img}
        alt={item.name}
        className="w-full aspect-square object-contain rounded-xl"
        draggable={false}
      />
      <span className="text-foreground text-[10px] font-bold text-center leading-tight whitespace-pre-line">
        {item.name}
      </span>
    </button>

  );
}
