import { useEffect, useState } from 'react';
import { Gift as GiftIcon, Lock, Loader2, ExternalLink } from 'lucide-react';
import { API_BASE } from '@/lib/telegramApi';

type GiftItem = {
  id: number;
  title: string;
  description: string;
  reward: number;
  link: string | null;
};

type GiftStatus = { enabled: boolean; message: string; gifts: GiftItem[] };

export default function GiftScreen() {
  const [state, setState] = useState<GiftStatus | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/api/gift/status`)
      .then((r) => r.json())
      .then((d: GiftStatus) => { if (alive) setState(d); })
      .catch(() => { if (alive) setState({ enabled: false, message: '', gifts: [] }); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="h-full overflow-y-auto px-4 pt-5 pb-28">
      <header className="flex items-center gap-2 mb-5">
        <GiftIcon className="w-6 h-6 text-[#f0cd7e]" />
        <h1 className="text-xl font-extrabold text-[#f0cd7e]">Gifts</h1>
      </header>

      {!state && (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-[#f0cd7e]" />
        </div>
      )}

      {state && !state.enabled && (
        <div className="rounded-2xl border border-[#d9a544]/30 bg-black/40 p-8 text-center">
          <Lock className="w-10 h-10 mx-auto text-[#c9b892]/60 mb-3" />
          <p className="text-[#f0cd7e] font-bold">{state.message || 'قريباً'}</p>
        </div>
      )}

      {state?.enabled && state.gifts.length === 0 && (
        <div className="rounded-2xl border border-[#d9a544]/30 bg-black/40 p-8 text-center text-[#c9b892]/70 text-sm">
          لا توجد هدايا متاحة حالياً
        </div>
      )}

      <div className="space-y-3">
        {state?.enabled &&
          state.gifts.map((g) => (
            <div
              key={g.id}
              className="rounded-2xl border border-[#d9a544]/30 bg-black/40 p-4 flex items-start gap-3"
            >
              <div className="p-2 rounded-xl bg-[#d9a544]/15 border border-[#d9a544]/40">
                <GiftIcon className="w-5 h-5 text-[#f0cd7e]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[#f0cd7e]">{g.title}</p>
                {g.description && (
                  <p className="text-xs text-[#c9b892]/70 mt-1 whitespace-pre-wrap">{g.description}</p>
                )}
                {g.reward > 0 && (
                  <p className="text-xs font-bold text-[#f0cd7e] mt-2">+{g.reward} MNX</p>
                )}
                {g.link && (
                  <a
                    href={g.link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-[#f0cd7e] mt-2 underline"
                  >
                    فتح <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
