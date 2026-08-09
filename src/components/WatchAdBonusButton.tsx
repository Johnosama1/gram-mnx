import { useCallback, useEffect, useState } from 'react';
import { PlayCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { telegramApiPost, getInitData, API_BASE } from '@/lib/telegramApi';
import { useRewardedAd } from '@/lib/adsgram';
import { showAdexiumAd } from '@/lib/adexium';
import { useCoins } from '@/context/CoinsContext';
import { useLanguage } from '@/context/LanguageContext';

interface AdStatus {
  enabled?: boolean;
  watchedToday: number;
  remainingToday: number;
  rewardCoins: number;
  dailyLimit: number;
}

/**
 * Optional, user-initiated rewarded ad button.
 * AdsGram clause 3: ads are NEVER forced on essential actions — this button is
 * the only trigger, it clearly states the bonus, and it never blocks the UI.
 */
export default function WatchAdBonusButton() {
  const { t } = useLanguage();
  const { addCoins } = useCoins();
  const { showAd, loading: adLoading, configured } = useRewardedAd();
  const [status, setStatus] = useState<AdStatus | null>(null);
  const [watching, setWatching] = useState(false);

  const loadStatus = useCallback(async () => {
    const initData = getInitData();
    try {
      const res = await fetch(`${API_BASE}/api/ads/status`, {
        headers: initData ? { 'x-init-data': initData } : {},
        cache: 'no-store',
      });
      if (res.ok) setStatus(await res.json() as AdStatus);
    } catch { /* best-effort */ }
  }, []);


  useEffect(() => { loadStatus(); }, [loadStatus]);

  if (status?.enabled === false) return null;

  const reward = status?.rewardCoins ?? 0.5;
  const exhausted = status !== null && status.remainingToday <= 0;

  const handleWatch = async () => {
    if (watching || exhausted) return;
    setWatching(true);
    try {
      if (configured) {
        const outcome = await showAd({
          onSkip: () => toast.error(t('ad_not_completed')),
          onError: () => toast.error(t('ad_none_available')),
        });
        if (outcome !== 'reward') return;
      } else {
        try {
          await showAdexiumAd();
        } catch {
          toast.error(t('ad_none_available'));
          return;
        }
      }

      const data = await telegramApiPost<{ coinsEarned: number; remainingToday?: number; dailyLimit?: number }>('/ads/watched', { credit: true });
      addCoins(data.coinsEarned);
      const dailyLimit = data.dailyLimit ?? status?.dailyLimit ?? 20;
      const watchedNow = dailyLimit - (data.remainingToday ?? 0);
      toast.success(`+${data.coinsEarned} coin`, {
        description: t('ad_progress', { watched: String(watchedNow), limit: String(dailyLimit) }),
      });
      await loadStatus();
    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
      if (msg.includes('limit')) toast.error(t('ad_daily_limit'));
      else toast.error(t('ad_none_available'));
    } finally {
      setWatching(false);
    }
  };

  return (
    <button
      onClick={() => { void handleWatch(); }}
      disabled={watching || adLoading || exhausted}
      className="w-full py-2 rounded-xl border border-[#F5A623]/40 bg-[#F5A623]/10 text-[#F5C46B] font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all disabled:opacity-50"
    >
      {watching || adLoading
        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
        : <><PlayCircle className="w-3.5 h-3.5" />
            {exhausted ? t('ad_done_today') : `${t('ad_watch')} (+${reward} coin)`}
          </>}
    </button>
  );
}
