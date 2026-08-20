import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Pickaxe, Gift, ClipboardList, Users, User, Shield, Puzzle } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

const APP_VERSION = 'v1.0.4';

export default function BottomNav({ showAdmin = false }: { showAdmin?: boolean }) {
  const location = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { t } = useLanguage();
  // The Mine/dashboard screen uses a dark glassmorphism theme — match the nav
  // to it there, keep the light nav everywhere else.
  const dark = location === '/';

  const navItems = [
    { path: '/',        label: t('nav_mine'),    icon: Pickaxe       },
    { path: '/gift',    label: 'Gift',           icon: Gift          },
    { path: '/tasks',   label: t('nav_tasks'),   icon: ClipboardList },
    { path: '/combo',   label: t('nav_combo'),   icon: Puzzle        },
    { path: '/friends', label: t('nav_friends'), icon: Users         },
    { path: '/profile', label: t('nav_profile'), icon: User          },
    ...(showAdmin ? [{ path: '/admin', label: t('nav_admin'), icon: Shield }] : []),
  ];

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 px-3 pb-2 max-w-[640px] mx-auto"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}
    >
      <div
        className="flex items-center w-full rounded-3xl border px-1 py-1.5"
        style={
          dark
            ? {
                background: 'rgba(255,255,255,0.05)',
                borderColor: '#2A3A5C',
                backdropFilter: 'blur(20px)',
                boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
              }
            : {
                background: '#fff',
                borderColor: 'hsl(var(--border))',
                boxShadow: '0 10px 30px rgba(88,44,180,0.12)',
              }
        }
      >
        {navItems.map((item) => {
          const isActive = location === item.path;
          const Icon = item.icon;
          const activeColor = dark ? '#F5B342' : 'hsl(var(--primary))';
          const inactiveColor = dark ? '#8A9BB5' : 'hsl(var(--muted-foreground))';

          return (
            // A real <a href> here is exactly what makes Android show its
            // native "open/download/copy link" menu on long-press — a
            // button with no href never triggers it, and navigation still
            // works identically via the router.
            <button
              key={item.path}
              type="button"
              onClick={() => navigate({ to: item.path })}
              className="flex-1 min-w-0 basis-0 flex flex-col items-center justify-center gap-0.5 rounded-2xl py-1.5 px-0.5 cursor-pointer touch-manipulation transition-colors"
              style={
                isActive
                  ? { background: dark ? 'rgba(245,179,66,0.12)' : 'hsl(var(--secondary))' }
                  : undefined
              }
            >
              <Icon
                className="w-5 h-5 shrink-0"
                style={{ color: isActive ? activeColor : inactiveColor }}
                strokeWidth={isActive ? 2.4 : 1.9}
              />
              <span
                className="text-[9px] leading-none font-semibold w-full truncate text-center"
                style={{ color: isActive ? activeColor : inactiveColor }}
              >
                {item.label}
              </span>
            </button>
          );
        })}

      </div>
      <div
        className="text-center text-[8px] font-mono pt-1 select-none"
        style={{ color: dark ? 'rgba(138,155,181,0.6)' : undefined }}
      >
        <span className={dark ? undefined : 'text-muted-foreground/50'}>{APP_VERSION}</span>
      </div>
    </div>
  );
}
