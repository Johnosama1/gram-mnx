import { useEffect, useState } from 'react';
import { Ticket, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { useLanguage } from '@/context/LanguageContext';
import { useCoins } from '@/context/CoinsContext';
import { telegramApiPost, getInitData, API_BASE } from '@/lib/telegramApi';
import { showRewardedAd } from '@/lib/adsgram';

/**
 * Promo code redemption card (Tasks tab).
 * Visibility is controlled from the admin panel (`promo_section_enabled`).
 * Reward is credited only after the AdsGram rewarded video is completed.
 */
export default function PromoCodeCard() {
  const { t } = useLanguage();
  const { addCoins } = useCoins();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const initData = getInitData();
        const res = await fetch(`${API_BASE}/api/promo`, {
          headers: initData ? { 'x-init-data': initData } : {},
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as { enabled?: boolean };
        if (alive) setEnabled(data.enabled !== false);
      } catch {
        /* best-effort: keep the card hidden on failure */
      }
    })();
    return () => { alive = false; };
  }, []);

  if (!enabled) return null;

  const errorText = (message: string): string => {
    if (message.includes('already')) return t('promo_already_used');
    if (message.includes('full')) return t('promo_full');
    return t('promo_invalid');
  };

  const handleRedeem = async () => {
    const value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      // 1) Validate first so the user never watches an ad for a bad code.
      await telegramApiPost('/promo', { code: value, check: true });

      // 2) Mandatory rewarded video.
      const outcome = await showRewardedAd();
      if (outcome !== 'reward') {
        toast.error(t('promo_watch_full_ad'));
        return;
      }

      // 3) Credit.
      const data = await telegramApiPost<{ coinsEarned: number }>('/promo', { code: value });
      addCoins(data.coinsEarned);
      setCode('');
      toast.success(t('promo_success', { amount: String(data.coinsEarned) }));
    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
      toast.error(errorText(msg));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3.5 space-y-2.5">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center border border-primary/30">
          <Ticket className="w-4.5 h-4.5 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="font-bold text-sm text-foreground">{t('promo_title')}</div>
          <div className="text-[11px] text-muted-foreground">{t('promo_desc')}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder={t('promo_placeholder')}
          maxLength={32}
          className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-background/40 border border-border text-xs font-bold tracking-wider text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60"
        />
        <button
          onClick={() => { void handleRedeem(); }}
          disabled={busy || !code.trim()}
          className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-bold text-xs active:scale-95 transition-all disabled:opacity-50 flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('promo_redeem')}
        </button>
      </div>
    </div>
  );
}
