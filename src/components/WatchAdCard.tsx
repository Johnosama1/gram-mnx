import { useEffect, useState } from 'react';
import { Gift } from 'lucide-react';
import WatchAdBonusButton from './WatchAdBonusButton';
import { useLanguage } from '@/context/LanguageContext';
import { getInitData, API_BASE } from '@/lib/telegramApi';
import { onDataChange } from '@/lib/apiCache';

/**
 * Visible, user-initiated "Watch & Earn" task card (AdsGram rewarded video).
 * Never auto-triggers — the user must tap the button inside it.
 * Visibility is controlled from the admin panel (`ads_task_enabled`).
 */
export default function WatchAdCard() {
  const { t } = useLanguage();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [reward, setReward] = useState(0.5);
  const [limit, setLimit] = useState(20);
  const [watched, setWatched] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const initData = getInitData();
      try {
        const res = await fetch(`${API_BASE}/api/ads/status`, {
          headers: initData ? { 'x-init-data': initData } : {},
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as { enabled?: boolean; rewardCoins?: number; dailyLimit?: number; watchedToday?: number };
        if (!alive) return;
        setEnabled(data.enabled !== false);
        if (typeof data.rewardCoins === 'number') setReward(data.rewardCoins);
        if (typeof data.dailyLimit === 'number') setLimit(data.dailyLimit);
        if (typeof data.watchedToday === 'number') setWatched(data.watchedToday);
      } catch {
        /* best-effort: keep the card hidden on failure */
      }
    };
    void load();
    const off = onDataChange(() => { void load(); });
    return () => { alive = false; off(); };
  }, []);

  if (!enabled) return null;

  return (
    <div className="rounded-2xl border border-[#F5A623]/30 bg-[#F5A623]/5 p-3.5 space-y-2.5">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-full bg-[#F5A623]/15 flex items-center justify-center border border-[#F5A623]/30">
          <Gift className="w-4.5 h-4.5 text-[#F5C46B]" />
        </div>
        <div className="min-w-0">
          <div className="font-bold text-sm text-white">{t('ad_watch_earn')}</div>
          <div className="text-[11px] text-white/50">{t('ad_watch_earn_desc')} (+{reward} coin)</div>
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-[#F5C46B]/80">{t('ad_quota_note', { limit: String(limit) })}</span>
        <span className="text-white/50">{watched}/{limit}</span>
      </div>
      <WatchAdBonusButton />
    </div>
  );
}
