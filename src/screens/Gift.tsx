import { useCallback, useEffect, useState } from 'react';
import { Gift as GiftIcon, Lock, Loader2, ExternalLink, Users, Copy, Check, Ticket } from 'lucide-react';
import { API_BASE, getInitData } from '@/lib/telegramApi';
import StickerBadge from '@/components/StickerBadge';
import { toast } from 'sonner';

const BOT_USERNAME = 'GRAM MNX1_Bot';

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
};

type GiftStatus = { enabled: boolean; message: string; gifts: GiftItem[]; telegramId?: number | null };

/** Prize artwork — supports Lottie .json files as well as regular images. */
export function GiftMedia({ url, size = 56 }: { url: string | null; size?: number }) {
  if (!url) {
    return (
      <div
        className="rounded-xl bg-[#d9a544]/15 border border-[#d9a544]/40 flex items-center justify-center shrink-0"
        style={{ width: size, height: size }}
      >
        <GiftIcon className="w-1/2 h-1/2 text-[#f0cd7e]" />
      </div>
    );
  }
  if (url.toLowerCase().endsWith('.json')) return <StickerBadge src={url} size={size} />;
  return (
    <img
      src={url}
      alt="Gift"
      loading="lazy"
      className="rounded-xl object-cover shrink-0 border border-[#d9a544]/30"
      style={{ width: size, height: size }}
    />
  );
}

function getStartRef(): number | null {
  try {
    const param = window.Telegram?.WebApp?.initDataUnsafe?.start_param ?? '';
    const match = /^gift_\d+_(\d+)$/.exec(param);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

export default function GiftScreen() {
  const [state, setState] = useState<GiftStatus | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

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
      if (!res.ok) throw new Error(data.error || 'فشل الاشتراك');
      setState(data);
      toast.success('تم اشتراكك 🎉 ادعُ أصدقاءك لمضاعفة فرصتك في الفوز');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const inviteLink = (giftId: number) =>
    `https://t.me/${BOT_USERNAME}?startapp=gift_${giftId}_${state?.telegramId ?? ''}`;

  const copyInvite = async (giftId: number) => {
    const link = inviteLink(giftId);
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      /* clipboard may be blocked inside Telegram */
    }
    setCopied(giftId);
    toast.success('تم نسخ رابطك الخاص');
    setTimeout(() => setCopied(null), 2000);
  };

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
          لا توجد مسابقات متاحة حالياً
        </div>
      )}

      <div className="space-y-4">
        {state?.enabled &&
          state.gifts.map((g) => {
            const pct = g.capacity > 0 ? Math.min(100, (g.participants / g.capacity) * 100) : 0;
            return (
              <div key={g.id} className="rounded-2xl border border-[#d9a544]/30 bg-black/40 p-4">
                <div className="flex items-start gap-3">
                  <GiftMedia url={g.imageUrl} size={64} />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-[#f0cd7e]">{g.title}</p>
                    {g.description && (
                      <p className="text-xs text-[#c9b892]/70 mt-1 whitespace-pre-wrap">{g.description}</p>
                    )}
                    {g.reward > 0 && (
                      <p className="text-xs font-bold text-[#f0cd7e] mt-1">+{g.reward} MNX</p>
                    )}
                    {g.link && (
                      <a
                        href={g.link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-[#f0cd7e] mt-1 underline"
                      >
                        فتح <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between text-[11px] text-[#c9b892]/70 mb-1">
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" /> {g.participants}
                      {g.capacity > 0 ? ` / ${g.capacity}` : ' مشترك'}
                    </span>
                    {g.capacity === 0 && <span>مسابقة مفتوحة — بدون حد</span>}
                  </div>
                  {g.capacity > 0 && (
                    <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#d9a544] to-[#f0cd7e] transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>

                {g.joined ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between rounded-xl bg-[#d9a544]/10 border border-[#d9a544]/30 px-3 py-2">
                      <span className="text-xs text-[#c9b892]/80 flex items-center gap-1">
                        <Ticket className="w-3.5 h-3.5 text-[#f0cd7e]" /> فرصك في الفوز
                      </span>
                      <span className="text-sm font-extrabold text-[#f0cd7e]">×{g.chances}</span>
                    </div>
                    <p className="text-[11px] text-[#c9b892]/70">
                      ادعُ أصدقاءك برابطك الخاص — كل صديق ينضم يزوّد فرصتك (دعوت {g.invitedCount})
                    </p>
                    <button
                      onClick={() => { void copyInvite(g.id); }}
                      className="w-full rounded-xl bg-[#d9a544] text-black font-bold py-2 text-sm flex items-center justify-center gap-2"
                    >
                      {copied === g.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      نسخ رابط الدعوة
                    </button>
                  </div>
                ) : (
                  <button
                    disabled={busy === g.id || g.full}
                    onClick={() => { void join(g); }}
                    className="mt-3 w-full rounded-xl bg-[#d9a544] text-black font-bold py-2.5 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {busy === g.id && <Loader2 className="w-4 h-4 animate-spin" />}
                    {g.full ? 'اكتمل العدد' : 'اشترك في المسابقة'}
                  </button>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
