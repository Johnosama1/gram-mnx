import { useEffect, useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { Pickaxe, Gift, ClipboardList, Users, User, Shield, Sparkles } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { API_BASE, getInitData } from '@/lib/telegramApi';
import StickerBadge from '@/components/StickerBadge';

type NavGift = { id: number; imageUrl: string | null };


const APP_VERSION = 'v1.0.4';

export default function BottomNav({ showAdmin = false }: { showAdmin?: boolean }) {
  const location = useRouterState({ select: (s) => s.location.pathname });
  const { t } = useLanguage();

  const navItems = [
    { path: '/',        label: t('nav_mine'),    icon: Pickaxe      },
    { path: '/tasks',   label: t('nav_tasks'),   icon: ClipboardList },
    { path: '/combo',   label: t('nav_combo'),   icon: Sparkles     },
    { path: '/friends', label: t('nav_friends'), icon: Users        },
    { path: '/profile', label: t('nav_profile'), icon: User         },
  ];
  const [gifts, setGifts] = useState<NavGift[]>([]);

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/api/gift/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: getInitData() }),
    })
      .then((r) => r.json())
      .then((d: { enabled?: boolean; gifts?: NavGift[] }) => {
        if (alive) setGifts(d.enabled ? (d.gifts ?? []) : []);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const giftCount = gifts.length;
  const giftThumb = gifts.find((g) => g.imageUrl)?.imageUrl ?? null;


  return (
    <div
      className="absolute bottom-0 left-0 right-0 flex flex-col items-center z-50 rounded-t-2xl border-t border-[#d9a544]/30 backdrop-blur-xl shadow-[0_-10px_30px_rgba(0,0,0,0.6)]"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        background: 'linear-gradient(180deg, rgba(14,12,8,0.82), rgba(4,4,6,0.94))',
      }}
    >
      <div className="flex items-center justify-around w-full px-1 min-h-[68px]">
        {navItems.map((item) => {
          const isActive = location === item.path;
          const Icon = item.icon;

          return (
            <Link
              key={item.path}
              to={item.path}
              className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-2 cursor-pointer touch-manipulation"
            >
              <div
                className={`p-1.5 rounded-xl transition-all duration-200 ${
                  isActive
                    ? 'bg-[#d9a544]/18 text-[#f0cd7e] border border-[#d9a544]/45 shadow-[0_0_16px_rgba(230,185,95,0.35)]'
                    : 'text-[#c9b892]/50 border border-transparent'
                }`}
              >
                <Icon className="w-5 h-5" strokeWidth={isActive ? 2.5 : 2} />
              </div>
              <span
                className={`text-[9px] font-bold tracking-wide truncate max-w-full ${
                  isActive ? 'text-[#f0cd7e]' : 'text-[#c9b892]/50'
                }`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}

        <Link
          to="/gift"
          className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-2 cursor-pointer touch-manipulation"
        >
          <div
            className={`relative p-1.5 rounded-xl transition-all duration-200 ${
              location === '/gift'
                ? 'bg-[#d9a544]/18 text-[#f0cd7e] border border-[#d9a544]/45 shadow-[0_0_16px_rgba(230,185,95,0.35)]'
                : 'text-[#c9b892]/50 border border-transparent'
            }`}
          >
            <Gift className="w-5 h-5" strokeWidth={location === '/gift' ? 2.5 : 2} />
            {giftCount > 0 && (
              <span className="absolute -top-1.5 -right-2 flex items-center gap-0.5 rounded-full bg-[#d9a544] px-1 py-[1px] shadow-[0_0_10px_rgba(230,185,95,0.5)]">
                <span className="text-[9px] font-extrabold leading-none text-black">{giftCount}</span>
                {giftThumb &&
                  (giftThumb.toLowerCase().endsWith('.json') ? (
                    <StickerBadge src={giftThumb} size={12} />
                  ) : (
                    <img src={giftThumb} alt="" className="w-3 h-3 rounded-full object-cover" />
                  ))}
              </span>
            )}
          </div>

          <span
            className={`text-[9px] font-bold tracking-wide truncate max-w-full ${
              location === '/gift' ? 'text-[#f0cd7e]' : 'text-[#c9b892]/50'
            }`}
          >
            Gift
          </span>
        </Link>


        {showAdmin && (
          <Link
            to="/admin"
            className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-2 cursor-pointer touch-manipulation"
          >
            <div
              className={`p-1.5 rounded-xl transition-all duration-200 ${
                location === '/admin'
                  ? 'bg-[#d9a544]/18 text-[#f0cd7e] border border-[#d9a544]/45 shadow-[0_0_16px_rgba(230,185,95,0.35)]'
                  : 'text-[#c9b892]/50 border border-transparent'
              }`}
            >
              <Shield className="w-5 h-5" strokeWidth={location === '/admin' ? 2.5 : 2} />
            </div>
            <span
              className={`text-[9px] font-bold tracking-wide truncate max-w-full ${
                location === '/admin' ? 'text-[#f0cd7e]' : 'text-[#c9b892]/50'
              }`}
            >
              {t('nav_admin')}
            </span>
          </Link>
        )}
      </div>
      <div className="text-[8px] text-white/20 font-mono pb-0.5 select-none">{APP_VERSION}</div>
    </div>
  );
}
