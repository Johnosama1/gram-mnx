import { Link, useRouterState } from '@tanstack/react-router';
import { Pickaxe, Gift, ClipboardList, Users, User, Shield, Sparkles } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

const APP_VERSION = 'v1.0.4';

export default function BottomNav({ showAdmin = false }: { showAdmin?: boolean }) {
  const location = useRouterState({ select: (s) => s.location.pathname });
  const { t } = useLanguage();

  const navItems = [
    { path: '/',        label: t('nav_mine'),    icon: Pickaxe      },
    { path: '/gift',    label: 'Gift',           icon: Gift         },
    { path: '/tasks',   label: t('nav_tasks'),   icon: ClipboardList },
    { path: '/combo',   label: t('nav_combo'),   icon: Sparkles     },
    { path: '/friends', label: t('nav_friends'), icon: Users        },
    { path: '/profile', label: t('nav_profile'), icon: User         },
    ...(showAdmin ? [{ path: '/admin', label: t('nav_admin'), icon: Shield }] : []),
  ];

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
      </div>
      <div className="text-[8px] text-white/20 font-mono pb-0.5 select-none">{APP_VERSION}</div>
    </div>
  );
}

