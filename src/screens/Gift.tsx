import { useEffect, useState } from 'react';
import { Gift as GiftIcon, Lock, Loader2 } from 'lucide-react';
import { API_BASE } from '@/lib/telegramApi';

interface GiftStatus {
  enabled: boolean;
  message: string;
}

export default function Gift() {
  const [status, setStatus] = useState<GiftStatus | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/api/gift/status`)
      .then((r) => r.json() as Promise<GiftStatus>)
      .then((d) => { if (alive) setStatus(d); })
      .catch(() => { if (alive) setStatus({ enabled: false, message: '' }); });
    return () => { alive = false; };
  }, []);

  if (!status) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-[#f0cd7e]" />
      </div>
    );
  }

  return (
    <div className="px-4 py-6 space-y-5">
      <div className="flex flex-col items-center text-center gap-3">
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center border border-[#d9a544]/40 bg-[#d9a544]/10 shadow-[0_0_30px_rgba(230,185,95,0.25)]">
          <GiftIcon className="w-10 h-10 text-[#f0cd7e]" />
        </div>
        <h1 className="text-xl font-extrabold text-[#f0cd7e] tracking-wide">GIFT</h1>
      </div>

      {status.enabled ? (
        <div className="rounded-2xl border border-[#d9a544]/30 bg-black/40 p-5 text-center space-y-2">
          <p className="text-sm font-bold text-emerald-400">🟢 GIFT UNLOCKED</p>
          <p className="text-sm text-white/70 whitespace-pre-line">
            {status.message || 'Your gift is available now. Stay tuned for the details!'}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-black/40 p-6 text-center space-y-3">
          <Lock className="w-8 h-8 mx-auto text-white/40" />
          <p className="text-sm font-bold text-white/80">🔒 LOCKED</p>
          <p className="text-sm text-white/60 whitespace-pre-line">
            {status.message || 'This section is locked. It will be opened soon.'}
          </p>
        </div>
      )}
    </div>
  );
}
