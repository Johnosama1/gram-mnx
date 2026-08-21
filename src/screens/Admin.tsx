import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Shield, BarChart3, MessageSquare, ClipboardList, Radio, DollarSign,
  Users, Plus, Trash2, Eye, EyeOff, Ban, Coins, AlertTriangle,
  ChevronDown, ChevronUp, Send, Wrench, Settings, Pickaxe, ArrowDownUp,
  UserPlus, Search, Check, X, ArrowUp, Sparkles, Trophy, Clock, Flame,
  ShoppingBag, Wallet, Ticket, MessageCircle,
} from 'lucide-react';
import arTranslations from '@/locales/ar.json';
import { notifyDataChange } from '@/lib/apiCache';
import { GiftMedia } from '@/screens/Gift';
import { COMBO_ITEM_NAME, COMBO_ITEM_EMOJI } from '@/lib/combo-items';

/**
 * Admin panel is Arabic-only: shadow the app-wide language hook with a
 * fixed Arabic translator so the panel never follows the user's language.
 */
function useLanguage() {
  const map = arTranslations as Record<string, string>;
  const t = (key: string, vars?: Record<string, string>): string => {
    let str = map[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, v);
    return str;
  };
  return { t, lang: 'ar' as const };
}

// In dev, always use relative paths so the Vite proxy forwards to the API server.
// In production, use VITE_API_URL if the frontend and API are on different origins.
const API = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL ?? '');

function initData(): string { return window.Telegram?.WebApp?.initData ?? ''; }
function adminHeaders(): HeadersInit {
  return { 'Content-Type': 'application/json', 'x-telegram-initdata': initData() };
}
async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  // Never let a request hang forever — a stalled fetch used to leave the panel
  // stuck on "loading" with no way to tell what went wrong.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let res: Response;
  try {
    res = await fetch(`${API}/api${path}`, {
      method,
      headers: adminHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    throw new Error(
      (e as Error)?.name === 'AbortError'
        ? 'انتهت مهلة الاتصال بالخادم (20 ثانية)'
        : `تعذر الاتصال بالخادم: ${(e as Error)?.message ?? 'network error'}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    // The server may answer with an HTML error page; showing the raw markup
    // filled the panel with unreadable code, so surface a short message instead.
    let detail = txt.trim();
    if (/^\s*</.test(detail) || detail.length > 300) {
      try {
        detail = String(JSON.parse(detail).error ?? '');
      } catch {
        detail = 'خطأ في الخادم، حاول تحديث الصفحة';
      }
    } else {
      try {
        detail = String(JSON.parse(detail).error ?? detail);
      } catch {
        /* keep plain text */
      }
    }
    throw new Error(`${res.status} ${detail}`.trim());
  }
  return res.json() as Promise<T>;

}

// ─── Types ─────────────────────────────────────────────────────────────────
interface Stats { totalUsers: number; blockedUsers: number; activeUsers: number }
interface Task  { id: number; title: string; description: string; reward: number; isDaily: boolean; isHidden: boolean; channelUsername?: string | null; category?: string | null; botUsername?: string | null; twitterUrl?: string | null; slotLimit?: number | null; slotsFilled?: number; iconUrl?: string | null }
interface Withdrawal { id: number; telegram_id: number; first_name: string | null; username: string | null; wallet_address: string; amount: number; status: string; created_at: string; tx_hash: string | null; rejection_reason: string | null }
interface Deposit { id: number; telegram_id: number; first_name: string | null; username: string | null; wallet_address: string | null; amount: number; status: string; created_at: string; tx_hash: string | null; rejection_reason: string | null }
interface Channel { id: number; channelUsername: string; channelName: string }
interface User { id: number; telegramId: number; username: string|null; firstName: string|null; lastName: string|null; balance: number; coins: number; isBanned: boolean; restrictWithdrawal: boolean; blockedBot: boolean; ips?: string[]; referralCount?: number; ipSiblingCount?: number; ipSiblings?: number[] }
interface UserDetails extends User {
  walletAddress: string|null; referredBy: number|null; language: string|null;
  createdAt: string|null; lastActiveAt: string|null;
  withdrawalsCount: number; depositsCount: number; tasksCompleted: number;
  siblings: User[];
}
interface Miner { id: number; name: string; baseCost: number; dailyPct: number; description: string }
interface SubAdmin { telegramId: number; username: string; permissions: string[] }

const ALL_PERMISSIONS = [
  { key: 'stats',       labelKey: 'admin_perm_stats' },
  { key: 'broadcast',   labelKey: 'admin_perm_broadcast' },
  { key: 'maintenance', labelKey: 'admin_perm_maintenance' },
  { key: 'welcome',     labelKey: 'admin_perm_welcome' },
  { key: 'tasks',       labelKey: 'admin_perm_tasks' },
  { key: 'referral',    labelKey: 'admin_perm_referral' },
  { key: 'users',       labelKey: 'admin_perm_users' },
  { key: 'miners',      labelKey: 'admin_perm_miners' },
  { key: 'limits',      labelKey: 'admin_perm_limits' },
  { key: 'channels',    labelKey: 'admin_perm_channels' },
];

// ─── Shared UI ─────────────────────────────────────────────────────────────
function Section({ title, icon: Icon, children, defaultOpen = false }: {
  title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-secondary/40 border border-violet-500/20 rounded-2xl overflow-hidden mb-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3.5 text-left"
      >
        <div className="flex items-center gap-2.5">
          <Icon className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="font-black text-foreground text-sm">{title}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-4 pb-4 space-y-3 border-t border-violet-500/20 pt-3">{children}</div>}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-secondary border border-violet-500/20 rounded-xl px-3 py-2 text-foreground text-sm focus:outline-none focus:border-primary/50 ${props.className ?? ''}`}
    />
  );
}

function Btn({ children, onClick, variant = 'primary', size = 'md', disabled, className = '' }: {
  children: React.ReactNode; onClick?: () => void;
  variant?: 'primary'|'danger'|'ghost'|'success'; size?: 'sm'|'md';
  disabled?: boolean; className?: string;
}) {
  const colors = {
    primary: 'bg-primary text-primary-foreground hover:opacity-90',
    danger:  'bg-destructive/20 text-destructive hover:bg-destructive/30',
    ghost:   'bg-secondary text-foreground hover:bg-secondary',
    success: 'bg-success/20 text-success hover:bg-success/30',
  };
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2.5 text-sm' };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${colors[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  );
}

function StatusMsg({ msg, isError }: { msg: string; isError?: boolean }) {
  if (!msg) return null;
  return <div className={`text-xs text-center py-1 ${isError ? 'text-destructive' : 'text-success'}`}>{msg}</div>;
}

// ─── 1. Statistics ─────────────────────────────────────────────────────────
interface BlockedUser { telegramId: number; username: string|null; firstName: string|null; lastName: string|null; reason: 'banned'|'blocked_bot' }

function StatsSection() {
  const { t } = useLanguage();
  const [stats, setStats] = useState<Stats|null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<BlockedUser[]|null>(null);
  const [listErr, setListErr] = useState('');
  // Auto-refresh stats every 5s
  useEffect(() => {
    const load = () => api<Stats>('GET', '/admin/general?type=stats').then(setStats).catch(e => setErr(e.message));
    void load();
    const id = setInterval(load, 5_000);
    return () => clearInterval(id);
  }, []);

  const fetchList = useCallback(() => {
    api<BlockedUser[]>('GET', '/admin/general?type=blocked-users')
      .then((d) => { setList(d); setListErr(''); })
      .catch(e => setListErr(e.message));
  }, []);

  // Auto-refresh the blocked list every 5s while the modal is open
  useEffect(() => {
    if (!open) return;
    const id = setInterval(fetchList, 5_000);
    return () => clearInterval(id);
  }, [open, fetchList]);

  const openBlocked = () => {
    setOpen(true);
    fetchList();
  };


  if (err) return <div className="text-destructive text-sm">{err}</div>;
  if (!stats) return <div className="text-muted-foreground text-sm">{t('admin_loading')}</div>;

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: t('admin_stat_total'), value: stats.totalUsers, color: 'text-primary', onClick: undefined as (() => void)|undefined },
          { label: t('admin_stat_active'), value: stats.activeUsers, color: 'text-success', onClick: undefined },
          { label: t('admin_stat_blocked'), value: stats.blockedUsers, color: 'text-destructive', onClick: openBlocked },
        ].map(c => (
          <button
            key={c.label}
            type="button"
            onClick={c.onClick}
            disabled={!c.onClick}
            className="bg-secondary rounded-xl p-3 text-center border border-violet-500/20 disabled:cursor-default"
          >
            <div className={`text-2xl font-black ${c.color}`}>{c.value}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{c.label}</div>
          </button>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-3" onClick={() => setOpen(false)}>
          <div className="bg-card w-full max-w-md max-h-[75vh] rounded-2xl border border-violet-500/20 p-4 overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm">{t('admin_stat_blocked')} · {stats.blockedUsers}</h3>
              <button className="text-xs text-muted-foreground" onClick={() => setOpen(false)}>✕</button>
            </div>
            {listErr && <div className="text-destructive text-xs">{listErr}</div>}
            {!list && !listErr && <div className="text-muted-foreground text-xs">{t('admin_loading')}</div>}
            <div className="space-y-2">
              {(list ?? []).map(u => (
                <div key={u.telegramId} className="flex items-center justify-between gap-2 bg-secondary rounded-xl px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate">
                      {u.firstName || u.username || u.telegramId}
                      {u.username && <span className="text-muted-foreground font-normal"> @{u.username}</span>}
                    </div>
                    <div className="text-[10px] text-muted-foreground">ID: {u.telegramId}</div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap ${u.reason === 'banned' ? 'bg-destructive/20 text-destructive' : 'bg-warning/20 text-warning'}`}>
                    {u.reason === 'banned' ? t('admin_reason_banned') : t('admin_reason_blocked_bot')}
                  </span>
                </div>
              ))}
              {list && list.length === 0 && <div className="text-muted-foreground text-xs">—</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── 2. Broadcast ──────────────────────────────────────────────────────────
function BroadcastSection() {
  const { t } = useLanguage();
  const [msg, setMsg] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const openPremiumBroadcast = () => {
    const url = 'https://t.me/GRAMMNX1_bot?start=broadcast';
    const tg = (window as any)?.Telegram?.WebApp;
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, '_blank');
  };

  const send = async () => {
    if (!msg.trim()) return;
    setLoading(true); setStatus('');
    try {
      const { sent, failed, total } = await api<{ sent: number; failed: number; total: number }>(
        'POST', '/admin/general?type=broadcast', { message: msg }
      );
      setStatus(t('admin_broadcast_sent', { sent: String(sent), total: String(total), failed: String(failed) }));
      setMsg('');
    } catch (e: any) { setStatus(`❌ ${e.message}`); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t('admin_broadcast_html_hint')}</p>
      <textarea
        value={msg}
        onChange={e => setMsg(e.target.value)}
        rows={5}
        placeholder={t('admin_broadcast_placeholder')}
        className="w-full bg-secondary border border-violet-500/20 rounded-xl p-3 text-foreground text-sm resize-none focus:outline-none focus:border-primary/50"
      />
      <StatusMsg msg={status} isError={status.startsWith('❌')} />
      <Btn onClick={send} disabled={loading || !msg.trim()} className="w-full">
        <Send className="w-3.5 h-3.5" />{loading ? t('admin_sending') : t('admin_broadcast_send_all')}
      </Btn>
      <button
        type="button"
        onClick={openPremiumBroadcast}
        className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/20 transition"
      >
        <Sparkles className="w-3.5 h-3.5" />
        {t('admin_broadcast_premium')}
      </button>
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        {t('admin_broadcast_premium_hint')}
      </p>
    </div>
  );
}

// ─── 3. Maintenance Mode ───────────────────────────────────────────────────
function MaintenanceSection() {
  const { t } = useLanguage();
  const [status, setStatus] = useState('');
  // `on` = bot is running (maintenance OFF). Toggle off => maintenance mode.
  const [on, setOn] = useState(true);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<Record<string, string>>('GET', '/admin/general?type=settings')
      .then((s) => {
        setOn(s['maintenance_mode'] !== 'true');
        setMessage(s['maintenance_message'] ?? t('admin_maintenance_default'));
      })
      .catch((e: any) => setStatus(`❌ ${e.message}`))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (nextOn: boolean, nextMessage: string) => {
    setSaving(true); setStatus('');
    try {
      await api('POST', '/admin/general?type=settings', {
        key: 'maintenance_mode',
        value: nextOn ? 'false' : 'true',
      });
      await api('POST', '/admin/general?type=settings', {
        key: 'maintenance_message',
        value: nextMessage,
      });
      // Confirm against the database so the switch never lies.
      const s = await api<Record<string, string>>('GET', '/admin/general?type=settings');
      setOn(s['maintenance_mode'] !== 'true');
      setStatus(t('admin_saved'));
      setTimeout(() => setStatus(''), 2000);
    } catch (e: any) {
      setStatus(`❌ ${e.message}`);
      try {
        const s = await api<Record<string, string>>('GET', '/admin/general?type=settings');
        setOn(s['maintenance_mode'] !== 'true');
      } catch { /* keep the optimistic value */ }
    } finally {
      setSaving(false);
    }
  };


  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between bg-secondary rounded-xl px-4 py-3">
        <span className="text-foreground font-bold text-sm">{t('admin_maintenance_mode')}</span>
        <button
          type="button"
          disabled={loading || saving}
          onClick={() => { const next = !on; setOn(next); void save(next, message); }}
          aria-pressed={on}
          aria-label={t('admin_maintenance_mode')}
          className={`w-12 h-6 rounded-full relative transition-colors ${on ? 'bg-emerald-500' : 'bg-destructive'} disabled:opacity-50`}
        >
          <div
            className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${on ? 'left-7' : 'left-1'}`}
          />
        </button>
      </div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        placeholder={t('admin_maintenance_placeholder')}
        className="w-full bg-secondary border border-violet-500/20 rounded-xl p-3 text-foreground text-sm resize-none focus:outline-none focus:border-primary/50"
      />
      <StatusMsg msg={status} isError={status.startsWith('❌')} />
      <Btn onClick={() => void save(on, message)} disabled={loading || saving} className="w-full">
        <Wrench className="w-3.5 h-3.5" />{saving ? t('admin_loading') : t('admin_save_settings')}
      </Btn>
    </div>
  );
}


// ─── 4. Welcome Message ────────────────────────────────────────────────────
function AdsSection() {
  const [enabled, setEnabled] = useState(true);
  const [reward, setReward] = useState('0.5');
  const [limit, setLimit] = useState('10');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{ watchedToday: number; coinsPaidToday: number } | null>(null);

  useEffect(() => {
    api<Record<string, string>>('GET', '/admin/general?type=settings')
      .then((s) => {
        setEnabled(s['ads_task_enabled'] !== 'false');
        setReward(s['ad_reward_coins'] ?? '0.5');
        setLimit(s['ad_daily_limit'] ?? '10');
      })
      .finally(() => setLoading(false));
    api<{ watchedToday: number; coinsPaidToday: number }>('GET', '/admin/general?type=ads-stats')
      .then(setStats)
      .catch(() => undefined);
  }, []);

  const save = async () => {
    try {
      await Promise.all([
        api('POST', '/admin/general?type=settings', {
          key: 'ads_task_enabled',
          value: String(enabled),
        }),
        api('POST', '/admin/general?type=settings', { key: 'ad_reward_coins', value: reward }),
        api('POST', '/admin/general?type=settings', { key: 'ad_daily_limit', value: limit }),
      ]);
      notifyDataChange('admin', 'tasks');
      setStatus('✅ تم الحفظ');
    } catch {
      setStatus('❌ فشل الحفظ');
    }
    setTimeout(() => setStatus(''), 2000);
  };


  if (loading) return <div className="text-muted-foreground text-sm">جاري التحميل…</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between bg-secondary rounded-xl px-4 py-3">
        <span className="text-foreground font-bold text-sm">إظهار مهمة الإعلانات</span>
        <button
          onClick={() => setEnabled((v) => !v)}
          className={`w-12 h-6 rounded-full transition-colors relative ${enabled ? 'bg-primary' : 'bg-secondary'}`}
        >
          <div
            className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${enabled ? 'right-1' : 'left-1'}`}
          />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-muted-foreground">
          مكافأة الإعلان (MNX)
          <input
            value={reward}
            onChange={(e) => setReward(e.target.value)}
            className="mt-1 w-full bg-secondary border border-violet-500/20 rounded-xl p-2 text-foreground text-sm"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          الحد اليومي
          <input
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="mt-1 w-full bg-secondary border border-violet-500/20 rounded-xl p-2 text-foreground text-sm"
          />
        </label>
      </div>
      <div className="flex items-center justify-between bg-secondary rounded-xl px-4 py-2.5 text-xs">
        <span className="text-muted-foreground">مصدر الإعلان</span>
        <span className="text-foreground font-bold">Monetag · Zone 11590639</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-secondary rounded-xl px-3 py-2.5 text-center">
          <div className="text-[10px] text-muted-foreground">مشاهدات اليوم</div>
          <div className="text-sm font-black text-foreground mt-0.5">{stats?.watchedToday ?? '—'}</div>
        </div>
        <div className="bg-secondary rounded-xl px-3 py-2.5 text-center">
          <div className="text-[10px] text-muted-foreground">مكافآت اليوم (MNX)</div>
          <div className="text-sm font-black text-foreground mt-0.5">{stats?.coinsPaidToday ?? '—'}</div>
        </div>
      </div>
      <StatusMsg msg={status} isError={status.startsWith('❌')} />
      <Btn onClick={save} className="w-full">
        <Sparkles className="w-3.5 h-3.5" />حفظ إعدادات الإعلانات
      </Btn>
    </div>
  );
}

type GiftEntryMode = 'referral' | 'tasks' | 'ads';

type GiftWinner = { id: number; name: string | null; chances: number | null };

type GiftItem = {
  id: number; title: string; description: string; reward: number; link: string | null;
  imageUrl: string | null; capacity: number; endsAt?: string | null; participants?: number;
  entryMode?: GiftEntryMode;
  winnerCount?: number; winners?: GiftWinner[];
  settledAt?: string | null;
};

const ENTRY_MODE_OPTIONS: { value: GiftEntryMode; label: string }[] = [
  { value: 'referral', label: 'إحالات فقط' },
  { value: 'tasks', label: 'مهام / كومبو' },
  { value: 'ads', label: 'مشاهدة إعلانات' },
];

const ENTRY_MODE_LABEL: Record<GiftEntryMode, string> = {
  referral: 'إحالات فقط',
  tasks: 'مهام / كومبو',
  ads: 'مشاهدة إعلانات',
};

function GiftSection() {
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [gifts, setGifts] = useState<GiftItem[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [link, setLink] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [capacity, setCapacity] = useState('$&');
  const [winnerCount, setWinnerCount] = useState('1');
  const [durationDays, setDurationDays] = useState<number | null>(null);
  const [endHour, setEndHour] = useState(6);
  const [entryMode, setEntryMode] = useState<GiftEntryMode>('referral');
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [diag, setDiag] = useState<Record<string, unknown> | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);


  const load = useCallback(async () => {
    try {
      const data = await api<{ enabled: boolean; message: string; gifts: GiftItem[] }>(
        'GET', '/admin/general?type=gift',
      );
      setEnabled(data.enabled);
      setMessage(data.message ?? '');
      setGifts(data.gifts ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveSettings = async (nextEnabled = enabled, nextMessage = message) => {
    try {
      await api('POST', '/admin/general?type=gift&action=settings', {
        enabled: nextEnabled,
        message: nextMessage,
      });
      setStatus('✅ تم الحفظ');
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`);
    }
    setTimeout(() => setStatus(''), 2000);
  };

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    await saveSettings(next, message);
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('تعذر قراءة الملف'));
        reader.readAsDataURL(file);
      });
      const res = await api<{ url: string }>('POST', '/admin/general?type=gift&action=upload', {
        filename: file.name,
        data,
      });
      setImageUrl(res.url);
      setStatus('✅ تم رفع الملف');
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`);
    } finally {
      setUploading(false);
      setTimeout(() => setStatus(''), 2500);
    }
  };

  const addGift = async () => {
    try {
      // "$&" (or empty) means unlimited participants → stored as 0.
      const cap = capacity.trim() === '$&' || capacity.trim() === '' ? 0 : Math.max(0, Number(capacity) || 0);
      // Duration in whole days + the exact hour it ends, e.g. 20 days from
      // now at 06:00 sharp — not a raw date/time picker.
      let endsAtIso: string | null = null;
      if (durationDays) {
        const end = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
        end.setHours(endHour, 0, 0, 0);
        endsAtIso = end.toISOString();
      }
      await api('POST', '/admin/general?type=gift', {
        title,
        description,
        reward: 0,
        link: link || null,
        imageUrl: imageUrl || null,
        capacity: cap,
        endsAt: endsAtIso,
        entryMode,
        winnerCount: Math.max(1, Number(winnerCount) || 1),
      });
      setTitle(''); setDescription(''); setLink(''); setImageUrl(''); setCapacity('$&');
      setWinnerCount('1');
      setDurationDays(null); setEndHour(6); setEntryMode('referral');

      setStatus('✅ تم إضافة الهدية');
      await load();
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`);
    }
    setTimeout(() => setStatus(''), 2500);
  };

  const removeGift = async (id: number) => {
    await api('DELETE', `/admin/general?type=gift&id=${id}`).catch(() => undefined);
    await load();
  };

  const runDiag = async () => {
    setDiagBusy(true);
    setDiag(null);
    try {
      const data = await api<Record<string, unknown>>('GET', '/admin/general?type=gift-ads-diag');
      setDiag(data);
    } catch (e) {
      setDiag({ error: (e as Error).message });
    } finally {
      setDiagBusy(false);
    }
  };

  if (loading) return <div className="text-muted-foreground text-sm">جاري التحميل…</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between bg-secondary rounded-xl px-4 py-3">
        <span className="text-foreground font-bold text-sm">فتح قسم الهدايا للمستخدمين</span>
        <button
          onClick={() => { void toggle(); }}
          className={`w-12 h-6 rounded-full transition-colors relative ${enabled ? 'bg-primary' : 'bg-secondary'}`}
        >
          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${enabled ? 'right-1' : 'left-1'}`} />
        </button>
      </div>

      <label className="text-xs text-muted-foreground block">
        رسالة القفل (تظهر عندما يكون القسم مغلق)
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onBlur={() => { void saveSettings(); }}
          placeholder="قريباً — الهدايا لسه مش متاحة"
          className="mt-1 w-full bg-secondary border border-violet-500/20 rounded-xl p-2 text-foreground text-sm"
        />
      </label>

      <div className="space-y-2 bg-secondary rounded-xl p-3 border border-violet-500/20">
        <p className="text-foreground font-bold text-sm">إضافة مسابقة / هدية</p>

        <label className="text-[11px] text-muted-foreground block">
          1) اسم الهدية
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="اسم الهدية في المسابقة"
            className="mt-1 w-full bg-secondary border border-violet-500/20 rounded-xl p-2 text-foreground text-sm"
          />
        </label>

        <label className="text-[11px] text-muted-foreground block">
          2) الوصف
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="وصف المسابقة"
            rows={2}
            className="mt-1 w-full bg-secondary border border-violet-500/20 rounded-xl p-2 text-foreground text-sm"
          />
        </label>

        <label className="text-[11px] text-muted-foreground block">
          3) عدد المستخدمين (اكتب $&amp; للعدد اللا نهائي)
          <input
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="$& = بدون حد"
            className="mt-1 w-full bg-secondary border border-violet-500/20 rounded-xl p-2 text-foreground text-sm"
          />
        </label>

        <label className="text-[11px] text-muted-foreground block">
          4) عدد الفائزين بالجائزة
          <input
            type="number"
            min={1}
            value={winnerCount}
            onChange={(e) => setWinnerCount(e.target.value)}
            placeholder="1"
            className="mt-1 w-full bg-secondary border border-violet-500/20 rounded-xl p-2 text-foreground text-sm"
          />
          <p className="text-[10px] text-muted-foreground/70 mt-1">
            لما المسابقة تخلص، هيتسحب العدد ده من الفائزين عشوائيًا — واللي عنده فرص أكتر (إحالات/إعلانات) بتبقى نسبته أعلى في السحب.
          </p>
        </label>

        <div className="text-[11px] text-muted-foreground block">
          5) مدة المسابقة وميعاد انتهائها
          <div className="mt-1 grid grid-cols-2 gap-2">
            <select
              value={durationDays ?? ''}
              onChange={(e) => setDurationDays(e.target.value ? Number(e.target.value) : null)}
              className="w-full bg-secondary border border-violet-500/20 rounded-xl p-2 text-foreground text-sm"
            >
              <option value="">بدون وقت محدد</option>
              {Array.from({ length: 20 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d} يوم</option>
              ))}
            </select>
            <select
              value={endHour}
              disabled={!durationDays}
              onChange={(e) => setEndHour(Number(e.target.value))}
              className="w-full bg-secondary border border-violet-500/20 rounded-xl p-2 text-foreground text-sm disabled:opacity-50"
            >
              {Array.from({ length: 24 }, (_, h) => h).map((h) => (
                <option key={h} value={h}>الساعة {String(h).padStart(2, '0')}:00</option>
              ))}
            </select>
          </div>
          {durationDays && (
            <p className="text-[10px] text-muted-foreground/70 mt-1">
              هتنتهي بعد {durationDays} يوم الساعة {String(endHour).padStart(2, '0')}:00 —{' '}
              {new Date(
                new Date(Date.now() + durationDays * 86400000).setHours(endHour, 0, 0, 0),
              ).toLocaleString('ar-EG')}
            </p>
          )}
        </div>

        <div className="text-[11px] text-muted-foreground block">
          6) طريقة الاشتراك في المسابقة
          <div className="mt-1 grid grid-cols-3 gap-1.5">
            {ENTRY_MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setEntryMode(opt.value)}
                className={`rounded-xl py-2 text-[11px] font-bold border transition-colors ${
                  entryMode === opt.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-secondary text-muted-foreground border-violet-500/20'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground/70 mt-1">
            {entryMode === 'referral' && 'أي مستخدم يقدر يشترك، وكل إحالة تزود فرصته.'}
            {entryMode === 'tasks' && 'المستخدم ومن يدعوهم لازم يكملوا مهمة أو كومبو قبل الاشتراك.'}
            {entryMode === 'ads' && 'المستخدم ومن يدعوهم لازم يشاهدوا إعلان قبل الاشتراك.'}
          </p>
        </div>

        <label className="text-[11px] text-muted-foreground block">
          7) ملف الهدية (يدعم .json لوتي و png/jpg/webp/gif)
          <input
            type="file"
            accept=".json,image/*"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f); }}
            className="mt-1 w-full bg-secondary border border-violet-500/20 rounded-xl p-2 text-foreground text-xs"
          />
        </label>
        {uploading && <p className="text-[11px] text-muted-foreground">جاري رفع الملف…</p>}
        {imageUrl && (
          <div className="flex items-center gap-2">
            <GiftMedia url={imageUrl} size={40} />
            <span className="text-[11px] text-muted-foreground truncate flex-1" dir="ltr">{imageUrl}</span>
            <button onClick={() => setImageUrl('')} className="text-destructive text-xs">حذف</button>
          </div>
        )}
        <input
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="أو ضع رابط الصورة/الملف مباشرة"
          dir="ltr"
          className="w-full bg-secondary border border-violet-500/20 rounded-xl p-2 text-foreground text-sm"
        />

        <div className="grid grid-cols-1 gap-2">
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="رابط (اختياري)"
            className="w-full bg-secondary border border-violet-500/20 rounded-xl p-2 text-foreground text-sm"
          />
        </div>

        <button
          onClick={() => { void addGift(); }}
          className="w-full bg-primary text-primary-foreground font-bold rounded-xl py-2 text-sm flex items-center justify-center gap-1"
        >
          <Plus className="w-4 h-4" /> إضافة
        </button>
      </div>

      <div className="space-y-2">
        {gifts.map((g) => (
          <div key={g.id} className="flex items-center justify-between bg-secondary rounded-xl px-3 py-2 gap-2">
            <GiftMedia url={g.imageUrl} size={40} />
            <div className="min-w-0 flex-1">
              <p className="text-foreground text-sm font-bold truncate">{g.title}</p>
              <p className="text-muted-foreground text-xs truncate">{g.description}</p>
              <p className="text-muted-foreground text-[11px]">
                👥 {g.participants ?? 0}{g.capacity > 0 ? ` / ${g.capacity}` : ' (بدون حد)'}
              </p>
              <p className="text-muted-foreground text-[11px]">
                ⏱ {g.endsAt ? new Date(g.endsAt).toLocaleString() : 'بدون وقت محدد'}
              </p>
              <p className="text-muted-foreground text-[11px]">
                🔑 {ENTRY_MODE_LABEL[g.entryMode ?? 'referral']}
              </p>
              <p className="text-muted-foreground text-[11px]">
                🏆 عدد الفائزين: {g.winnerCount ?? 1}
              </p>
              {g.winners && g.winners.length > 0 && (
                <div className="text-[11px] font-bold text-primary space-y-0.5">
                  {g.winners.map((w) => (
                    <p key={w.id}>
                      🏆 {w.name ?? `#${w.id}`} (×{w.chances ?? '?'} فرصة)
                    </p>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => { void removeGift(g.id); }} className="text-destructive p-2">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {gifts.length === 0 && <p className="text-muted-foreground text-xs">لا توجد مسابقات مضافة</p>}
      </div>

      <div className="bg-secondary rounded-xl p-3 border border-violet-500/20 space-y-2">
        <p className="text-foreground font-bold text-sm">تشخيص Gift Ads (gm_gift_ad_views)</p>
        <button
          onClick={() => { void runDiag(); }}
          disabled={diagBusy}
          className="w-full bg-primary text-primary-foreground font-bold rounded-xl py-2 text-sm disabled:opacity-50"
        >
          {diagBusy ? 'جاري الفحص…' : 'فحص الاتصال بالجدول'}
        </button>
        {diag && (
          <pre dir="ltr" className="text-[10px] bg-black/80 text-emerald-300 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all">
            {JSON.stringify(diag, null, 2)}
          </pre>
        )}
      </div>

      {status && <p className="text-xs text-foreground">{status}</p>}
    </div>
  );
}


type PromoCode = {
  id: number;
  code: string;
  rewardCoins: number;
  maxUses: number;
  currentUses: number;
  isActive: boolean;
};

function PromoSection() {
  const [enabled, setEnabled] = useState(true);
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [code, setCode] = useState('');
  const [reward, setReward] = useState('100');
  const [maxUses, setMaxUses] = useState('50');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api<{ enabled: boolean; codes: PromoCode[] }>(
        'GET', '/admin/general?type=promo',
      );
      setEnabled(data.enabled);
      setCodes(data.codes ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleVisibility = async () => {
    const next = !enabled;
    setEnabled(next);
    try {
      await api('POST', '/admin/general?type=promo&action=visibility', { enabled: next });
      notifyDataChange('admin', 'tasks');
    } catch {
      setEnabled(!next);
      setStatus('❌ فشل الحفظ');
      setTimeout(() => setStatus(''), 2000);
    }
  };

  const addCode = async () => {
    try {
      await api('POST', '/admin/general?type=promo', {
        code,
        rewardCoins: Number(reward) || 0,
        maxUses: Number(maxUses) || 0,
      });
      setCode('');
      setStatus('✅ تم إنشاء الكود');
      await load();
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`);
    }
    setTimeout(() => setStatus(''), 2500);
  };

  const toggleCode = async (id: number) => {
    await api('POST', `/admin/general?type=promo&action=toggle&id=${id}`).catch(() => undefined);
    await load();
  };

  const removeCode = async (id: number) => {
    await api('DELETE', `/admin/general?type=promo&id=${id}`).catch(() => undefined);
    await load();
  };

  if (loading) return <div className="text-muted-foreground text-sm">جاري التحميل…</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between bg-secondary rounded-xl px-4 py-3">
        <span className="text-foreground font-bold text-sm">إظهار قسم أكواد الخصم للمستخدمين</span>
        <button
          onClick={() => { void toggleVisibility(); }}
          className={`w-12 h-6 rounded-full transition-colors relative ${enabled ? 'bg-primary' : 'bg-secondary'}`}
        >
          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${enabled ? 'right-1' : 'left-1'}`} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs text-muted-foreground col-span-3">
          الكود
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="SUMMER2026"
            className="mt-1 w-full bg-secondary border border-violet-500/20 rounded-xl p-2 text-foreground text-sm tracking-wider"
          />
        </label>
        <label className="text-xs text-muted-foreground col-span-1">
          المكافأة (MNX)
          <input
            value={reward}
            onChange={(e) => setReward(e.target.value)}
            className="mt-1 w-full bg-secondary border border-violet-500/20 rounded-xl p-2 text-foreground text-sm"
          />
        </label>
        <label className="text-xs text-muted-foreground col-span-2">
          الحد الأقصى للمستخدمين
          <input
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            className="mt-1 w-full bg-secondary border border-violet-500/20 rounded-xl p-2 text-foreground text-sm"
          />
        </label>
      </div>
      <StatusMsg msg={status} isError={status.startsWith('❌')} />
      <Btn onClick={addCode} className="w-full">
        <Plus className="w-3.5 h-3.5" />إنشاء كود
      </Btn>

      <div className="space-y-2">
        {codes.length === 0 && (
          <div className="text-muted-foreground text-xs text-center py-2">لا توجد أكواد</div>
        )}
        {codes.map((c) => {
          const full = c.maxUses > 0 && c.currentUses >= c.maxUses;
          const label = full ? 'مكتمل' : c.isActive ? 'نشط' : 'مخفي';
          return (
            <div key={c.id} className="bg-secondary rounded-xl px-3 py-2 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-foreground font-bold text-sm tracking-wider truncate">{c.code}</div>
                <div className="text-[11px] text-muted-foreground">
                  {c.rewardCoins} MNX • {c.currentUses} / {c.maxUses || '∞'} •{' '}
                  <span className={full ? 'text-amber-400' : c.isActive ? 'text-emerald-400' : 'text-muted-foreground'}>
                    {label}
                  </span>
                </div>
              </div>
              <button
                onClick={() => { void toggleCode(c.id); }}
                className="p-2 rounded-lg bg-secondary text-muted-foreground"
                title={c.isActive ? 'إخفاء' : 'تفعيل'}
              >
                {c.isActive ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => { void removeCode(c.id); }}
                className="p-2 rounded-lg bg-red-500/10 text-red-400"
                title="حذف"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}


function WelcomeSection() {
  const { t } = useLanguage();
  const [msg, setMsg] = useState('');
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Record<string, string>>('GET', '/admin/general?type=settings')
      .then(s => setMsg(s['welcome_message'] || ''))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    try {
      await api('POST', '/admin/general?type=settings', { key: 'welcome_message', value: msg });
      setStatus(t('admin_saved'));
    } catch { setStatus(t('admin_failed')); }
    setTimeout(() => setStatus(''), 2000);
  };

  if (loading) return <div className="text-muted-foreground text-sm">{t('admin_loading')}</div>;
  if (err) return <div className="text-destructive text-sm">{err}</div>;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t('admin_welcome_hint_pre')} <code className="text-primary">{'{first_name}'}</code> {t('admin_welcome_hint_post')}</p>
      <textarea
        value={msg}
        onChange={e => setMsg(e.target.value)}
        rows={6}
        placeholder={t('admin_welcome_placeholder')}
        className="w-full bg-secondary border border-violet-500/20 rounded-xl p-3 text-foreground text-sm resize-none focus:outline-none focus:border-primary/50"
      />
      <StatusMsg msg={status} isError={status.startsWith('❌')} />
      <Btn onClick={save} className="w-full"><MessageSquare className="w-3.5 h-3.5" />{t('admin_save_message')}</Btn>
    </div>
  );
}

// ─── 5. Tasks ──────────────────────────────────────────────────────────────
function TasksSection() {
  const { t: tr } = useLanguage();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [form, setForm] = useState({
    title: '', description: '', reward: '', isDaily: false, channelUsername: '',
    category: 'general', botUsername: '', twitterUrl: '', slotLimit: '', iconUrl: '',
  });
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState('');

  const load = useCallback(() => { api<Task[]>('GET', '/admin/tasks').then(setTasks).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  // Live progress for limited-slot tasks
  useEffect(() => {
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const add = async () => {
    if (!form.title.trim()) return;
    try {
      await api('POST', '/admin/tasks', {
        title: form.title,
        description: form.description,
        reward: Number(form.reward) || 0,
        isDaily: form.isDaily || form.category === 'daily',
        category: form.category,
        botUsername: form.botUsername.replace(/^@/, '') || null,
        twitterUrl: form.twitterUrl || null,
        channelUsername: form.channelUsername.replace(/^@/, '') || null,
        slotLimit: form.slotLimit ? Number(form.slotLimit) : null,
        iconUrl: form.iconUrl.trim() || null,
      });
      setForm({ title: '', description: '', reward: '', isDaily: false, channelUsername: '', category: 'general', botUsername: '', twitterUrl: '', slotLimit: '', iconUrl: '' });
      load(); setStatus(tr('admin_added_f'));
    } catch { setStatus(tr('admin_failed')); }
    setTimeout(() => setStatus(''), 2000);
  };
  const del = async (id: number) => { await api('DELETE', `/admin/tasks?id=${id}`); load(); };
  /** Uploads a picture and stores its served URL on the form. */
  const uploadIcon = async (file: File) => {
    setUploading(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      const res = await api<{ url: string }>('POST', '/admin/tasks?action=upload', {
        data,
        filename: file.name,
      });
      setForm(f => ({ ...f, iconUrl: res.url }));
      setStatus('✅ تم رفع الصورة');
    } catch {
      setStatus('❌ فشل رفع الصورة');
    }
    setUploading(false);
    setTimeout(() => setStatus(''), 2500);
  };
  const toggle = async (t: Task) => { await api('PATCH', `/admin/tasks?id=${t.id}`, { isHidden: !t.isHidden }); load(); };
  const setLimit = async (t: Task) => {
    const current = t.slotLimit ? String(t.slotLimit) : '';
    const value = window.prompt('عدد المقاعد (عدد المنضمين المطلوب) — اتركه فارغًا لإلغاء الحد:', current);
    if (value === null) return;
    await api('PATCH', `/admin/tasks?id=${t.id}`, { slotLimit: value.trim() ? Number(value) : null });
    load();
  };

  return (
    <div className="space-y-3">
      <div className="bg-secondary rounded-xl p-3 space-y-2 border border-violet-500/20">
        <div>
          <label className="text-xs text-muted-foreground">قسم المهمة</label>
          <select
            value={form.category}
            onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            className="w-full mt-1 bg-secondary border border-violet-500/20 rounded-xl px-3 py-2 text-foreground text-sm focus:outline-none focus:border-primary/50"
          >
            <option value="general">عام (كل المهام)</option>
            <option value="channels">القنوات (تحقق تلقائي)</option>
            <option value="daily">يومي وإعلانات</option>
            <option value="friends">دعوة الأصدقاء</option>
            <option value="twitter">تويتر (X)</option>
            <option value="bots">البوتات</option>
          </select>
        </div>
        <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder={tr('admin_task_title_ph')} />
        <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder={tr('admin_desc_optional')} />
        <Input value={form.reward} onChange={e => setForm(f => ({ ...f, reward: e.target.value }))} type="number" placeholder={tr('admin_reward_gram')} />
        {form.category !== 'twitter' && form.category !== 'bots' && (
          <>
            <Input value={form.channelUsername} onChange={e => setForm(f => ({ ...f, channelUsername: e.target.value }))} placeholder={tr('admin_channel_user_ph')} dir="ltr" />
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full overflow-hidden flex-shrink-0 bg-secondary border border-violet-500/20 flex items-center justify-center">
                {form.iconUrl
                  ? <img src={form.iconUrl} alt="" className="w-full h-full object-cover" />
                  : <span className="text-[10px] text-muted-foreground">صورة</span>}
              </div>
              <div className="flex-1 space-y-1.5">
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadIcon(f); e.target.value = ''; }}
                  className="block w-full text-xs text-muted-foreground file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-primary/20 file:text-primary file:text-xs file:font-bold"
                />
                <Input
                  value={form.iconUrl}
                  onChange={e => setForm(f => ({ ...f, iconUrl: e.target.value }))}
                  placeholder="أو الصق رابط صورة القناة (اختياري)"
                  dir="ltr"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {uploading ? '... جاري رفع الصورة' : 'صورة القناة هتظهر للمستخدم على شكل دائرة جنب اسم المهمة.'}
            </p>
            {form.category === 'channels' && (
              <>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  اكتب يوزر القناة بدون @ (مثال: GRAM MNXNews). لازم تضيف البوت كـ«أدمن» في القناة
                  حتى يتحقق تلقائيًا من انضمام المستخدم.
                </p>
                <Input
                  value={form.slotLimit}
                  onChange={e => setForm(f => ({ ...f, slotLimit: e.target.value }))}
                  type="number"
                  placeholder="عدد المقاعد (مثال: 50 أو 100 أو 1000) — اختياري"
                  dir="ltr"
                />
                <div className="flex gap-1.5">
                  {[50, 100, 500, 1000].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, slotLimit: String(n) }))}
                      className="px-2.5 py-1 rounded-lg bg-secondary border border-violet-500/20 text-xs text-muted-foreground hover:bg-secondary"
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  لو حددت عدد مقاعد، هتكون مهمة «محدودة»: يظهر للمستخدمين شريط تقدّم (مثال 0/50)
                  والمهمة تتقفل تلقائيًا لما العدد يكتمل. لو سيبته فاضي هتكون مهمة قناة عادية.
                </p>
              </>
            )}
          </>
        )}
        {form.category === 'twitter' && (
          <Input value={form.twitterUrl} onChange={e => setForm(f => ({ ...f, twitterUrl: e.target.value }))} placeholder="رابط حساب/قناة تويتر (X)" dir="ltr" />
        )}
        {form.category === 'bots' && (
          <Input value={form.botUsername} onChange={e => setForm(f => ({ ...f, botUsername: e.target.value }))} placeholder="يوزر البوت المطلوب (بدون @)" dir="ltr" />
        )}
        <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
          <input type="checkbox" checked={form.isDaily} onChange={e => setForm(f => ({ ...f, isDaily: e.target.checked }))} className="w-4 h-4 accent-primary" />
          {tr('admin_daily_task')}
        </label>
        <StatusMsg msg={status} isError={status.startsWith('❌')} />
        <Btn onClick={add} className="w-full"><Plus className="w-3.5 h-3.5" />{tr('admin_add_task')}</Btn>
      </div>
      <div className="space-y-2">
        {tasks.map(t => (
          <div key={t.id} className={`bg-secondary rounded-xl p-3 border border-violet-500/20 flex items-start justify-between gap-2 ${t.isHidden ? 'opacity-50' : ''}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {t.iconUrl && (
                  <img src={t.iconUrl} alt="" className="w-8 h-8 rounded-full object-cover border border-violet-500/20 flex-shrink-0" />
                )}
                <div className="font-bold text-foreground text-sm truncate">{t.title}</div>
              </div>
              <div className="text-xs text-muted-foreground">
                {t.reward} MNX
                {t.category && t.category !== 'general'
                  ? ` · ${t.category === 'channels' ? (t.slotLimit ? 'قناة محدودة' : 'قناة') : t.category}`
                  : ''}
                {t.isDaily ? ` · ${tr('admin_daily_word')}` : ''}
                {t.channelUsername ? ` · 📢 @${t.channelUsername}` : ''}
                {t.botUsername ? ` · 🤖 @${t.botUsername}` : ''}
              </div>
              {t.slotLimit ? (
                <div className="mt-1">
                  <div className="text-[11px] text-primary font-bold mb-0.5">
                    المقاعد: {t.slotsFilled ?? 0}/{t.slotLimit}
                    {(t.slotsFilled ?? 0) >= t.slotLimit ? ' · مكتملة' : ''}
                  </div>
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${Math.min(100, ((t.slotsFilled ?? 0) / t.slotLimit) * 100)}%` }}
                    />
                  </div>
                </div>
              ) : null}
              {t.description && <div className="text-xs text-muted-foreground/70 mt-0.5 truncate">{t.description}</div>}
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <button onClick={() => setLimit(t)} className="p-1.5 rounded-lg text-primary bg-primary/10 hover:bg-primary/20 text-[10px] font-bold">
                {t.slotLimit ?? '∞'}
              </button>
              <button onClick={() => toggle(t)} className="p-1.5 rounded-lg text-muted-foreground bg-secondary hover:text-foreground">
                {t.isHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => del(t.id)} className="p-1.5 rounded-lg text-destructive bg-destructive/10 hover:bg-destructive/20">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
        {tasks.length === 0 && <div className="text-center text-muted-foreground text-sm py-4">{tr('admin_no_tasks')}</div>}
      </div>
    </div>
  );
}

// ─── 6. Referral Settings ──────────────────────────────────────────────────
interface TaskSubmission {
  id: number; telegramId: number; taskId: number; taskTitle: string;
  kind: string; payload: string; status: string; rejectReason?: string | null;
  firstName?: string | null; username?: string | null; createdAt: string;
}

function TaskSubmissionsSection() {
  const [rows, setRows] = useState<TaskSubmission[]>([]);
  const [filter, setFilter] = useState('pending');
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    api<TaskSubmission[]>('GET', `/admin/task-submissions${filter ? `?status=${filter}` : ''}`)
      .then(setRows).catch(() => {});
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const act = async (id: number, action: 'approve' | 'reject') => {
    const reason = action === 'reject' ? (prompt('سبب الرفض؟') ?? 'تم الرفض من الإدارة') : undefined;
    try {
      await api('POST', `/admin/task-submissions?id=${id}&action=${action}`, { reason });
      setStatus(action === 'approve' ? '✅ تم القبول' : '✅ تم الرفض');
      load();
    } catch { setStatus('❌ فشل'); }
    setTimeout(() => setStatus(''), 2000);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {[['pending', 'قيد المراجعة'], ['approved', 'مقبولة'], ['rejected', 'مرفوضة'], ['', 'الكل']].map(([v, label]) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold ${filter === v ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}
          >{label}</button>
        ))}
      </div>
      <StatusMsg msg={status} isError={status.startsWith('❌')} />
      {rows.map(r => (
        <div key={r.id} className="bg-secondary rounded-xl p-3 border border-violet-500/20 space-y-1.5">
          <div className="text-foreground text-sm font-bold">{r.taskTitle}</div>
          <div className="text-xs text-muted-foreground">
            {r.kind === 'twitter' ? '🐦 تويتر' : '🤖 بوت'} · {r.firstName ?? ''} {r.username ? `@${r.username}` : `#${r.telegramId}`}
          </div>
          <div className="text-xs text-primary break-all" dir="ltr">{r.payload}</div>
          <div className="text-[10px] text-muted-foreground">{r.status}{r.rejectReason ? ` · ${r.rejectReason}` : ''}</div>
          {r.status === 'pending' && (
            <div className="flex gap-2 pt-1">
              <Btn onClick={() => act(r.id, 'approve')} className="flex-1">قبول</Btn>
              <button onClick={() => act(r.id, 'reject')} className="flex-1 rounded-xl bg-destructive/15 text-destructive text-xs font-bold py-2">رفض</button>
            </div>
          )}
        </div>
      ))}
      {rows.length === 0 && <div className="text-center text-muted-foreground text-sm py-4">لا توجد طلبات</div>}
    </div>
  );
}

function ReferralSection() {
  const { t } = useLanguage();
  const [price, setPrice] = useState('0.01');
  const [desc, setDesc]   = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Record<string, string>>('GET', '/admin/general?type=settings').then(s => {
      setPrice(s['referral_price'] || '1');
      setDesc(s['referral_description'] || t('admin_referral_desc_default'));
    }).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    try {
      await Promise.all([
        api('POST', '/admin/general?type=settings', { key: 'referral_price', value: price }),
        api('POST', '/admin/general?type=settings', { key: 'referral_description', value: desc }),
      ]);
      setStatus(t('admin_saved'));
    } catch { setStatus(t('admin_failed')); }
    setTimeout(() => setStatus(''), 2000);
  };

  if (loading) return <div className="text-muted-foreground text-sm">{t('admin_loading')}</div>;
  return (
    <div className="space-y-2">
      <label className="text-xs text-muted-foreground">{t('admin_referral_price_label')}</label>
      <Input value={price} onChange={e => setPrice(e.target.value)} type="number" step="0.001" min="0" className="text-center text-xl font-black" />
      <label className="text-xs text-muted-foreground">{t('admin_referral_desc_label')}</label>
      <textarea
        value={desc}
        onChange={e => setDesc(e.target.value)}
        rows={3}
        className="w-full bg-secondary border border-violet-500/20 rounded-xl p-3 text-foreground text-sm resize-none focus:outline-none focus:border-primary/50"
      />
      <StatusMsg msg={status} isError={status.startsWith('❌')} />
      <Btn onClick={save} className="w-full"><DollarSign className="w-3.5 h-3.5" />{t('admin_save')}</Btn>
    </div>
  );
}

// ─── 6b. Referral Milestones ───────────────────────────────────────────────
interface Milestone {
  id: number;
  inviteCount: number;
  rewardCoins: number;
  isEnabled: boolean;
}

function MilestonesSection() {
  const { t } = useLanguage();
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading]       = useState(true);
  const [status, setStatus]         = useState('');

  // Add form
  const [newCount,  setNewCount]  = useState('');
  const [newReward, setNewReward] = useState('');

  // Inline-edit state: id → draft values
  const [editing, setEditing] = useState<Record<number, { inviteCount: string; rewardCoins: string }>>({});

  const load = useCallback(async () => {
    try {
      const data = await api<Milestone[]>('GET', '/admin/referral-milestones');
      setMilestones(data);
    } catch (e: any) { setStatus(`❌ ${e.message}`); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (msg: string) => { setStatus(msg); setTimeout(() => setStatus(''), 2500); };

  // ── Add ──────────────────────────────────────────────────────────────────
  const add = async () => {
    const ic = parseInt(newCount, 10);
    const rc = parseInt(newReward, 10);
    if (!ic || ic <= 0 || isNaN(rc) || rc < 0) {
      flash(t('admin_milestone_invalid_input')); return;
    }
    try {
      await api('POST', '/admin/referral-milestones', { inviteCount: ic, rewardCoins: rc });
      setNewCount(''); setNewReward('');
      await load(); flash(t('admin_added_done'));
    } catch (e: any) { flash(`❌ ${e.message}`); }
  };

  // ── Toggle enabled ────────────────────────────────────────────────────────
  const toggleEnabled = async (m: Milestone) => {
    try {
      await api('PATCH', `/admin/referral-milestones/${m.id}`, { isEnabled: !m.isEnabled });
      await load();
    } catch (e: any) { flash(`❌ ${e.message}`); }
  };

  // ── Save inline edit ──────────────────────────────────────────────────────
  const saveEdit = async (id: number) => {
    const draft = editing[id];
    if (!draft) return;
    const ic = parseInt(draft.inviteCount, 10);
    const rc = parseInt(draft.rewardCoins, 10);
    if (!ic || ic <= 0 || isNaN(rc) || rc < 0) { flash(t('admin_invalid_values')); return; }
    try {
      await api('PATCH', `/admin/referral-milestones/${id}`, { inviteCount: ic, rewardCoins: rc });
      setEditing(prev => { const n = { ...prev }; delete n[id]; return n; });
      await load(); flash(t('admin_saved'));
    } catch (e: any) { flash(`❌ ${e.message}`); }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const del = async (id: number) => {
    if (!window.confirm(t('admin_milestone_delete_confirm'))) return;
    try {
      await api('DELETE', `/admin/referral-milestones/${id}`);
      await load(); flash(t('admin_deleted'));
    } catch (e: any) { flash(`❌ ${e.message}`); }
  };

  const startEdit = (m: Milestone) =>
    setEditing(prev => ({ ...prev, [m.id]: { inviteCount: String(m.inviteCount), rewardCoins: String(m.rewardCoins) } }));

  const cancelEdit = (id: number) =>
    setEditing(prev => { const n = { ...prev }; delete n[id]; return n; });

  if (loading) return <div className="text-muted-foreground text-sm">{t('admin_loading')}</div>;

  return (
    <div className="space-y-3">

      {/* ── Add form ── */}
      <div className="bg-secondary rounded-xl p-3 border border-primary/20 space-y-2">
        <p className="text-xs text-primary font-black uppercase tracking-widest">{t('admin_milestone_new')}</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block">{t('admin_invite_count')}</label>
            <Input
              value={newCount}
              onChange={e => setNewCount(e.target.value)}
              type="number" min="1" placeholder={t('admin_eg_50')}
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block">{t('admin_reward_coin')}</label>
            <Input
              value={newReward}
              onChange={e => setNewReward(e.target.value)}
              type="number" min="0" placeholder={t('admin_eg_250')}
            />
          </div>
        </div>
        <Btn onClick={add} className="w-full" disabled={!newCount || !newReward}>
          <Plus className="w-3.5 h-3.5" />{t('admin_add_milestone')}
        </Btn>
      </div>

      <StatusMsg msg={status} isError={status.startsWith('❌')} />

      {/* ── Milestone list ── */}
      {milestones.length === 0 && (
        <div className="text-center text-muted-foreground text-sm py-4">{t('admin_no_milestones')}</div>
      )}

      {milestones.map(m => {
        const isEdit = Boolean(editing[m.id]);
        const draft  = editing[m.id];

        return (
          <div
            key={m.id}
            className={`bg-secondary rounded-xl p-3 border transition-colors ${
              m.isEnabled ? 'border-violet-500/20' : 'border-violet-500/20 opacity-50'
            }`}
          >
            {isEdit ? (
              /* ── Edit mode ── */
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground mb-1 block">{t('admin_invites_word')}</label>
                    <Input
                      value={draft.inviteCount}
                      onChange={e => setEditing(p => ({ ...p, [m.id]: { ...p[m.id], inviteCount: e.target.value } }))}
                      type="number" min="1"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground mb-1 block">{t('admin_reward_word')}</label>
                    <Input
                      value={draft.rewardCoins}
                      onChange={e => setEditing(p => ({ ...p, [m.id]: { ...p[m.id], rewardCoins: e.target.value } }))}
                      type="number" min="0"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Btn size="sm" variant="success" className="flex-1" onClick={() => saveEdit(m.id)}>
                    <Check className="w-3 h-3" />{t('admin_save')}
                  </Btn>
                  <Btn size="sm" variant="ghost" className="flex-1" onClick={() => cancelEdit(m.id)}>
                    <X className="w-3 h-3" />{t('admin_cancel')}
                  </Btn>
                </div>
              </div>
            ) : (
              /* ── View mode ── */
              <div className="flex items-center justify-between gap-3">
                {/* Badge */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <Users className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <div className="text-foreground font-black text-sm">{m.inviteCount.toLocaleString()} {t('admin_invite_word')}</div>
                    <div className="text-primary text-xs font-bold">+{m.rewardCoins.toLocaleString()} MNX</div>
                  </div>
                  {!m.isEnabled && (
                    <span className="text-[10px] bg-secondary text-muted-foreground px-2 py-0.5 rounded-full font-bold">{t('admin_hidden')}</span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {/* Toggle visibility */}
                  <button
                    onClick={() => toggleEnabled(m)}
                    title={m.isEnabled ? t('admin_hide') : t('admin_enable')}
                    className="p-1.5 rounded-lg text-muted-foreground bg-secondary hover:text-foreground transition-colors"
                  >
                    {m.isEnabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>

                  {/* Edit */}
                  <button
                    onClick={() => startEdit(m)}
                    className="p-1.5 rounded-lg text-muted-foreground bg-secondary hover:text-primary transition-colors"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => del(m.id)}
                    className="p-1.5 rounded-lg text-destructive bg-destructive/10 hover:bg-destructive/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── 7. User Search & Management ──────────────────────────────────────────
function UsersSection() {
  const { t } = useLanguage();
  const [query, setQuery]   = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<User|null>(null);
  const [amount, setAmount] = useState('');
  const [coinAmount, setCoinAmount] = useState('');
  const [warnMsg, setWarnMsg] = useState('');
  const [privateMsg, setPrivateMsg] = useState('');
  const [status, setStatus] = useState('');
  const [details, setDetails] = useState<UserDetails|null>(null);

  // Full account dossier whenever a user is opened.
  useEffect(() => {
    setDetails(null);
    if (!selected) return;
    let alive = true;
    api<UserDetails>('GET', `/admin/users?action=details&id=${selected.telegramId}`)
      .then(d => { if (alive) setDetails(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [selected?.telegramId]);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true); setStatus(''); setSelected(null);
    try {
      const users = await api<User[]>('GET', `/admin/users?action=search&q=${encodeURIComponent(query)}`);
      setResults(users);
      if (!users.length) setStatus(t('admin_no_results'));
    } catch (e: any) { setStatus(`❌ ${e.message}`); }
    finally { setLoading(false); }
  };

  const act = async (path: string, body: unknown, successMsg: string) => {
    try {
      await api('POST', path, body);
      setStatus(`✅ ${successMsg}`);
      // Refresh
      const users = await api<User[]>('GET', `/admin/users?action=search&q=${encodeURIComponent(query)}`);
      setResults(users);
      const updated = users.find(u => u.telegramId === selected?.telegramId);
      if (updated) setSelected(updated);
    } catch (e: any) { setStatus(`❌ ${e.message}`); }
    setTimeout(() => setStatus(''), 3000);
  };

  const u = selected;
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          placeholder={t('admin_user_search_ph')} dir="ltr" />
        <button onClick={search} disabled={loading} className="flex-shrink-0 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-black text-sm flex items-center gap-1 disabled:opacity-60">
          <Search className="w-4 h-4" />
        </button>
      </div>
      <StatusMsg msg={status} isError={status.startsWith('❌')} />

      {/* Results list */}
      {!u && results.map(r => (
        <button key={r.id} onClick={() => setSelected(r)}
          className="w-full text-left bg-secondary rounded-xl p-3 border border-violet-500/20 hover:border-primary/30 transition-colors">
          <div className="font-bold text-foreground text-sm">{r.firstName ?? r.username ?? t('admin_unknown')}</div>
          <div className="text-xs text-muted-foreground font-mono">ID: {r.telegramId} {r.username && `· @${r.username}`}</div>
          <div className="text-xs text-primary font-bold mt-0.5">{Number(r.balance).toFixed(4)} gram</div>
          <div className="text-xs text-amber-400 font-bold">{Number(r.coins ?? 0).toLocaleString()} MNX</div>
          <div className="flex flex-wrap gap-1.5 mt-1">
            <span className="text-[10px] bg-secondary text-muted-foreground px-2 py-0.5 rounded-full font-bold">إحالات: {r.referralCount ?? 0}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${(r.ipSiblingCount ?? 0) > 0 ? 'bg-destructive/20 text-destructive' : 'bg-secondary text-muted-foreground'}`}>نفس الـ IP: {r.ipSiblingCount ?? 0}</span>
            {r.isBanned && <span className="text-[10px] bg-destructive/20 text-destructive px-2 py-0.5 rounded-full font-bold">محظور</span>}
          </div>
        </button>
      ))}

      {/* Selected user panel */}
      {u && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setSelected(null)} className="p-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground">
              <ChevronDown className="w-4 h-4 rotate-90" />
            </button>
            <div>
              <div className="font-bold text-foreground">{u.firstName ?? u.username ?? t('admin_unknown')}</div>
              <div className="text-xs text-muted-foreground font-mono">ID: {u.telegramId}</div>
            </div>
            <div className="ml-auto flex gap-1.5">
              {u.isBanned && <span className="text-[10px] bg-destructive/20 text-destructive px-2 py-0.5 rounded-full font-bold">{t('admin_banned')}</span>}
              {u.restrictWithdrawal && <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full font-bold">{t('admin_withdraw_restricted')}</span>}
            </div>
          </div>

          <div className="bg-secondary rounded-xl p-3 text-center space-y-1">
            <div className="text-2xl font-black text-primary">{Number(u.balance).toFixed(4)} gram</div>
            <div className="text-base font-black text-amber-400">{Number(u.coins ?? 0).toLocaleString()} MNX</div>
          </div>

          {/* Full account info */}
          <div className="bg-secondary rounded-xl p-3 space-y-1.5 border border-violet-500/20">
            <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">معلومات الحساب</p>
            {!details ? (
              <div className="text-xs text-muted-foreground">جاري التحميل…</div>
            ) : (
              <div className="text-xs text-muted-foreground space-y-1 font-mono">
                <div>ID: {details.telegramId}</div>
                <div>Username: {details.username ? `@${details.username}` : '—'}</div>
                <div>الاسم: {[details.firstName, details.lastName].filter(Boolean).join(' ') || '—'}</div>
                <div>اللغة: {details.language ?? '—'}</div>
                <div>المحفظة: <span className="break-all">{details.walletAddress ?? '—'}</span></div>
                <div>عدد الإحالات: <span className="text-primary font-black">{details.referralCount ?? 0}</span></div>
                <div>مدعو بواسطة: {details.referredBy ?? '—'}</div>
                <div>المهام المكتملة: {details.tasksCompleted}</div>
                <div>الإيداعات: {details.depositsCount} · السحوبات: {details.withdrawalsCount}</div>
                <div>تاريخ التسجيل: {details.createdAt ? new Date(details.createdAt).toLocaleString() : '—'}</div>
                <div>آخر نشاط: {details.lastActiveAt ? new Date(details.lastActiveAt).toLocaleString() : '—'}</div>
                <div>حظر البوت: {details.blockedBot ? 'نعم' : 'لا'}</div>
                <div className="break-all">IPs: {details.ips?.length ? details.ips.join(', ') : '—'}</div>
                <div className={`font-black ${(details.ipSiblingCount ?? 0) > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                  حسابات بنفس الـ IP: {details.ipSiblingCount ?? 0}
                </div>
                {details.siblings?.length > 0 && (
                  <div className="pt-1 space-y-1 border-t border-violet-500/20">
                    {details.siblings.map(s => (
                      <button key={s.telegramId} onClick={() => setSelected(s)}
                        className="w-full text-left text-[11px] text-muted-foreground hover:text-foreground">
                        · {s.telegramId} {s.username ? `@${s.username}` : ''} {s.isBanned ? '🚫' : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Coins adjustment */}
          <div className="bg-secondary rounded-xl p-3 space-y-2">
            <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">تعديل MNX</p>
            <Input value={coinAmount} onChange={e => setCoinAmount(e.target.value)} type="number" placeholder="عدد MNX" />
            <div className="flex gap-2">
              <Btn variant="success" size="sm" className="flex-1"
                onClick={() => act(`/admin/users?action=coins&id=${u.telegramId}`, { amount: Number(coinAmount) }, 'تمت إضافة MNX')}>
                <Coins className="w-3 h-3" />إضافة
              </Btn>
              <Btn variant="danger" size="sm" className="flex-1"
                onClick={() => act(`/admin/users?action=coins&id=${u.telegramId}`, { amount: -Number(coinAmount) }, 'تم خصم MNX')}>
                <Coins className="w-3 h-3" />خصم
              </Btn>
            </div>
            <div className="pt-1 border-t border-violet-500/20">
              <p className="text-[10px] text-amber-400 font-bold mb-1.5">تعيين رصيد MNX مباشرة</p>
              <Btn variant="ghost" size="sm" className="w-full"
                onClick={() => {
                  if (!window.confirm(`تعيين MNX ${u.firstName ?? u.telegramId} إلى ${coinAmount}؟`)) return;
                  act(`/admin/users?action=coins_set&id=${u.telegramId}`, { value: Number(coinAmount) }, 'تم تعيين MNX');
                }}>
                <Check className="w-3 h-3" />تعيين
              </Btn>
            </div>
          </div>

          {/* Balance adjustment */}
          <div className="bg-secondary rounded-xl p-3 space-y-2">
            <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">{t('admin_adjust_balance')}</p>
            <Input value={amount} onChange={e => setAmount(e.target.value)} type="number" placeholder={t('admin_amount')} />
            <div className="flex gap-2">
              <Btn variant="success" size="sm" className="flex-1"
                onClick={() => act(`/admin/users?action=balance&id=${u.telegramId}`, { amount: Number(amount) }, t('admin_balance_added'))}>
                <Coins className="w-3 h-3" />{t('admin_add')}
              </Btn>
              <Btn variant="danger" size="sm" className="flex-1"
                onClick={() => act(`/admin/users?action=balance&id=${u.telegramId}`, { amount: -Number(amount) }, t('admin_balance_deducted'))}>
                <Coins className="w-3 h-3" />{t('admin_deduct')}
              </Btn>
            </div>
            {/* Direct balance correction — overwrites the stored value entirely */}
            <div className="pt-1 border-t border-violet-500/20">
              <p className="text-[10px] text-amber-400 font-bold mb-1.5">{t('admin_balance_correct')}</p>
              <div className="flex gap-2">
                <Input value={amount} onChange={e => setAmount(e.target.value)} type="number"
                  placeholder={t('admin_correct_value')} className="flex-1" />
                <Btn variant="ghost" size="sm"
                  onClick={() => {
                    if (!window.confirm(t('admin_balance_set_confirm', { name: String(u.firstName ?? u.telegramId), amount: String(amount) }))) return;
                    act(`/admin/users?action=balance_set&id=${u.telegramId}`, { value: Number(amount) }, t('admin_balance_set_done', { amount: String(amount) }));
                  }}>
                  <Check className="w-3 h-3" />{t('admin_set')}
                </Btn>
              </div>
            </div>
          </div>

          {/* Warning message */}
          <div className="bg-secondary rounded-xl p-3 space-y-2">
            <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">{t('admin_send_warning')}</p>
            <textarea
              value={warnMsg}
              onChange={e => setWarnMsg(e.target.value)}
              rows={2}
              placeholder={t('admin_warning_text')}
              className="w-full bg-secondary border border-violet-500/20 rounded-xl p-2 text-foreground text-sm resize-none focus:outline-none"
            />
            <Btn variant="ghost" size="sm" className="w-full"
              onClick={() => act(`/admin/users?action=warn&id=${u.telegramId}`, { message: warnMsg }, t('admin_sent'))}>
              <AlertTriangle className="w-3 h-3 text-amber-400" />{t('admin_send_warning_only')}
            </Btn>
          </div>

          {/* Private message to this user only */}
          <div className="bg-secondary rounded-xl p-3 space-y-2 border border-primary/30">
            <p className="text-xs text-primary font-bold uppercase tracking-widest">إرسال رسالة خاصة</p>
            <textarea
              value={privateMsg}
              onChange={e => setPrivateMsg(e.target.value)}
              rows={3}
              placeholder="اكتب الرسالة التي ستصل لهذا المستخدم فقط…"
              className="w-full bg-secondary border border-primary/20 rounded-xl p-2 text-foreground text-sm resize-none focus:outline-none focus:border-primary/50"
            />
            <div className="flex gap-2">
              <Btn variant="success" size="sm" className="flex-1"
                onClick={async () => {
                  const msg = privateMsg.trim();
                  if (!msg) { setStatus('❌ اكتب الرسالة أولاً'); setTimeout(() => setStatus(''), 3000); return; }
                  await act(
                    `/admin/users?action=message&id=${u.telegramId}`,
                    { message: `📩 <b>[Admin Message]</b>\n\n${msg}` },
                    'تم إرسال الرسالة بنجاح!',
                  );
                  setPrivateMsg('');
                }}>
                <Send className="w-3 h-3" />إرسال الرسالة
              </Btn>
              <Btn variant="ghost" size="sm" className="flex-1"
                onClick={() => {
                  const url = u.username
                    ? `https://t.me/${String(u.username).replace(/^@/, '')}`
                    : `tg://user?id=${u.telegramId}`;
                  const tg = (window as any)?.Telegram?.WebApp;
                  if (u.username && tg?.openTelegramLink) tg.openTelegramLink(url);
                  else if (tg?.openLink && u.username) tg.openLink(url);
                  else window.open(url, '_blank');
                }}>
                <MessageCircle className="w-3 h-3 text-primary" />فتح محادثة 💬
              </Btn>
            </div>
            <Btn variant="ghost" size="sm" className="w-full"
              onClick={() => {
                const url = `https://t.me/GRAMMNX1_bot?start=dm_${u.telegramId}`;
                const tg = (window as any)?.Telegram?.WebApp;
                if (tg?.openTelegramLink) tg.openTelegramLink(url);
                else window.open(url, '_blank');
              }}>
              ✨ رسالة بإيموجي مميز لهذا المستخدم
            </Btn>
          </div>



          {/* Quick actions */}
          <div className="flex flex-wrap gap-2">
            <Btn variant={u.isBanned ? 'success' : 'danger'} size="sm"
              onClick={() => act(`/admin/users?action=ban&id=${u.telegramId}`, { ban: !u.isBanned }, u.isBanned ? t('admin_unbanned') : t('admin_banned_done'))}>
              <Ban className="w-3 h-3" />{u.isBanned ? t('admin_unban_user') : t('admin_ban_user')}
            </Btn>
            <Btn variant="danger" size="sm"
              onClick={() => {
                const n = (details?.ipSiblingCount ?? u.ipSiblingCount ?? 0) + 1;
                if (!window.confirm(`حظر كل الحسابات المرتبطة بنفس الـ IP (${n} حساب)؟`)) return;
                act(`/admin/users?action=ban_ip&id=${u.telegramId}`, { ban: true }, `تم حظر ${n} حساب`);
              }}>
              <Ban className="w-3 h-3" />حظر كل حسابات نفس الـ IP
            </Btn>
            <Btn variant="success" size="sm"
              onClick={() => act(`/admin/users?action=ban_ip&id=${u.telegramId}`, { ban: false }, 'تم فك الحظر عن حسابات نفس الـ IP')}>
              <Check className="w-3 h-3" />فك حظر نفس الـ IP
            </Btn>
            <Btn variant={u.restrictWithdrawal ? 'success' : 'ghost'} size="sm"
              onClick={() => act(`/admin/users?action=restrict&id=${u.telegramId}`, { restrict: !u.restrictWithdrawal }, u.restrictWithdrawal ? t('admin_restrict_lifted') : t('admin_restrict_done'))}>
              <ArrowDownUp className="w-3 h-3" />{u.restrictWithdrawal ? t('admin_lift_restrict') : t('admin_restrict_withdraw')}
            </Btn>
            <Btn variant="danger" size="sm"
              onClick={async () => {
                if (!window.confirm(t('admin_delete_account_confirm', { name: String(u.firstName ?? u.telegramId) }))) return;
                try {
                  await api('DELETE', `/admin/users?id=${u.telegramId}`, undefined);
                  setStatus(t('admin_account_deleted'));
                  setSelected(null);
                  setResults(prev => prev.filter(r => r.telegramId !== u.telegramId));
                } catch (e: any) { setStatus(`❌ ${e.message}`); }
                setTimeout(() => setStatus(''), 3000);
              }}>
              <Trash2 className="w-3 h-3" />{t('admin_delete_account')}
            </Btn>
          </div>
          <StatusMsg msg={status} isError={status.startsWith('❌')} />
        </div>
      )}
    </div>
  );
}

// ─── 8. Miners Management ──────────────────────────────────────────────────
function MinersSection() {
  const { t } = useLanguage();
  const [miners, setMiners] = useState<Miner[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [newMiner, setNewMiner] = useState({ name: '', baseCost: '', dailyPct: '', description: '' });

  useEffect(() => {
    api<Miner[]>('GET', '/admin/general?type=miners').then(setMiners).finally(() => setLoading(false));
  }, []);

  const save = async (updated: Miner[]) => {
    try {
      await api('POST', '/admin/general?type=miners', { miners: updated });
      setMiners(updated);
      setStatus(t('admin_saved'));
    } catch { setStatus(t('admin_failed')); }
    setTimeout(() => setStatus(''), 2000);
  };

  const update = (id: number, field: keyof Miner, val: string | number) => {
    setMiners(prev => prev.map(m => m.id === id ? { ...m, [field]: field === 'name' || field === 'description' ? val : Number(val) } as Miner : m));
  };

  const addMiner = async () => {
    if (!newMiner.name.trim()) return;
    const next = { id: Math.max(0, ...miners.map(m => m.id)) + 1, name: newMiner.name, baseCost: Number(newMiner.baseCost) || 0, dailyPct: Number(newMiner.dailyPct) || 0.05, description: newMiner.description };
    await save([...miners, next]);
    setNewMiner({ name: '', baseCost: '', dailyPct: '', description: '' });
  };

  const removeMiner = async (id: number) => { await save(miners.filter(m => m.id !== id)); };

  if (loading) return <div className="text-muted-foreground text-sm">{t('admin_loading')}</div>;

  return (
    <div className="space-y-3">
      {miners.map(m => (
        <div key={m.id} className="bg-secondary rounded-xl p-3 border border-violet-500/20 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-primary font-bold text-xs">{t('admin_miner_hash')} #{m.id}</span>
            <button onClick={() => removeMiner(m.id)} className="p-1 rounded-lg text-destructive bg-destructive/10 hover:bg-destructive/20">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
          <Input value={m.name} onChange={e => update(m.id, 'name', e.target.value)} placeholder={t('admin_name')} />
          <div className="grid grid-cols-2 gap-2">
            <Input value={m.baseCost} onChange={e => update(m.id, 'baseCost', e.target.value)} type="number" placeholder={t('admin_cost')} />
            <Input value={m.dailyPct} onChange={e => update(m.id, 'dailyPct', e.target.value)} type="number" step="0.01" placeholder={t('admin_daily_pct')} />
          </div>
          <Input value={m.description} onChange={e => update(m.id, 'description', e.target.value)} placeholder={t('admin_desc_optional')} />
        </div>
      ))}

      {/* Add new */}
      <div className="bg-secondary rounded-xl p-3 border border-primary/20 space-y-2">
        <p className="text-xs text-primary font-bold uppercase tracking-widest">{t('admin_add_miner')}</p>
        <Input value={newMiner.name} onChange={e => setNewMiner(n => ({ ...n, name: e.target.value }))} placeholder={t('admin_name_required')} />
        <div className="grid grid-cols-2 gap-2">
          <Input value={newMiner.baseCost} onChange={e => setNewMiner(n => ({ ...n, baseCost: e.target.value }))} type="number" placeholder={t('admin_cost')} />
          <Input value={newMiner.dailyPct} onChange={e => setNewMiner(n => ({ ...n, dailyPct: e.target.value }))} type="number" step="0.01" placeholder={t('admin_pct_005')} />
        </div>
        <Input value={newMiner.description} onChange={e => setNewMiner(n => ({ ...n, description: e.target.value }))} placeholder={t('admin_description')} />
        <Btn onClick={addMiner} size="sm" className="w-full"><Plus className="w-3.5 h-3.5" />{t('admin_add')}</Btn>
      </div>

      <StatusMsg msg={status} isError={status.startsWith('❌')} />
      <Btn onClick={() => save(miners)} className="w-full"><Check className="w-3.5 h-3.5" />{t('admin_save_all')}</Btn>
    </div>
  );
}

// ─── Withdrawals ────────────────────────────────────────────────────────────
function WithdrawalsSection() {
  const { t, lang } = useLanguage();
  const [items, setItems] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api<Withdrawal[]>('GET', '/admin/general?type=withdrawals').then(setItems).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const approve = async (id: number) => {
    setStatus(t('admin_sending_progress'));
    try {
      await api('POST', `/admin/general?type=withdrawals&action=approve&id=${id}`, {});
      setStatus(t('admin_withdraw_approved'));
      load();
    } catch (e: any) { setStatus(`❌ ${e.message}`); }
    setTimeout(() => setStatus(''), 4000);
  };

  const reject = async (id: number) => {
    try {
      await api('POST', `/admin/general?type=withdrawals&action=reject&id=${id}`, { reason: rejectReason || t('admin_rejected_by_admin') });
      setStatus(t('admin_withdraw_rejected'));
      setRejectId(null); setRejectReason('');
      load();
    } catch (e: any) { setStatus(`❌ ${e.message}`); }
    setTimeout(() => setStatus(''), 3000);
  };

  const statusColor = (s: string) =>
    s === 'approved' ? 'text-green-400' : s === 'rejected' ? 'text-red-400' : 'text-yellow-400';
  const statusLabel = (s: string) =>
    s === 'approved' ? t('admin_status_approved') : s === 'rejected' ? t('admin_status_rejected') : t('admin_status_pending');

  if (loading) return <div className="text-muted-foreground text-sm">{t('admin_loading')}</div>;

  return (
    <div className="space-y-3">
      <StatusMsg msg={status} isError={status.startsWith('❌')} />
      <Btn onClick={load} variant="ghost" size="sm" className="w-full">{t('admin_refresh')}</Btn>
      {items.length === 0 && <div className="text-center text-muted-foreground text-sm py-4">{t('admin_no_requests')}</div>}
      {items.map(w => (
        <div key={w.id} className="bg-secondary rounded-xl p-3 border border-violet-500/20 space-y-2">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-bold text-foreground text-sm">{w.first_name ?? w.username ?? w.telegram_id}</div>
              <div className="text-xs text-muted-foreground font-mono">ID: {w.telegram_id}</div>
              <div className="text-primary font-black text-sm mt-0.5">{Number(w.amount).toFixed(4)} gram</div>
              <div className="text-[10px] font-mono text-muted-foreground break-all mt-0.5">{w.wallet_address}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{new Date(w.created_at).toLocaleString(lang)}</div>
            </div>
            <span className={`text-xs font-bold ${statusColor(w.status)}`}>{statusLabel(w.status)}</span>
          </div>
          {w.status === 'pending' && (
            <div className="flex gap-2">
              <Btn size="sm" variant="success" onClick={() => approve(w.id)} className="flex-1">
                <Check className="w-3 h-3" />{t('admin_approve_send')}
              </Btn>
              <Btn size="sm" variant="danger" onClick={() => setRejectId(w.id)} className="flex-1">
                <X className="w-3 h-3" />{t('admin_reject')}
              </Btn>
            </div>
          )}
          {rejectId === w.id && (
            <div className="space-y-2">
              <Input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder={t('admin_reject_reason_ph')} />
              <div className="flex gap-2">
                <Btn size="sm" variant="danger" onClick={() => reject(w.id)} className="flex-1">{t('admin_confirm_reject')}</Btn>
                <Btn size="sm" variant="ghost" onClick={() => { setRejectId(null); setRejectReason(''); }} className="flex-1">{t('admin_cancel')}</Btn>
              </div>
            </div>
          )}
          {w.tx_hash && <div className="text-[10px] font-mono text-green-400 break-all">TX: {w.tx_hash}</div>}
          {w.rejection_reason && <div className="text-xs text-red-400">{t('admin_reason_label')}: {w.rejection_reason}</div>}
        </div>
      ))}
    </div>
  );
}

// ─── Deposits: view + manual-credit fallback for anything the automatic
// on-chain matcher didn't catch (e.g. a scan-window/wallet-match miss) ──────
function DepositsSection() {
  const { lang } = useLanguage();
  const [items, setItems] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [creditingId, setCreditingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<Deposit[]>('GET', '/admin/general?type=deposits').then(setItems).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const credit = async (id: number) => {
    setCreditingId(id);
    setStatus('');
    try {
      const res = await api<{ ok: boolean; message: string }>('POST', `/admin/general?type=deposits&action=credit&id=${id}`, {});
      setStatus(`✅ ${res.message}`);
      load();
    } catch (e: any) { setStatus(`❌ ${e.message}`); }
    finally { setCreditingId(null); }
    setTimeout(() => setStatus(''), 4000);
  };

  const statusColor = (s: string) =>
    s === 'confirmed' ? 'text-green-400' : s === 'rejected' ? 'text-red-400' : 'text-yellow-400';

  if (loading) return <div className="text-muted-foreground text-sm">جاري التحميل…</div>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        لو إيداع فضل عالق على "قيد الانتظار" رغم إنه وصل فعليًا على البلوكتشين (اتأكد منه بنفسك أولاً)، تقدر تصرف مكافأته يدويًا من هنا.
      </p>
      <StatusMsg msg={status} isError={status.startsWith('❌')} />
      <Btn onClick={load} variant="ghost" size="sm" className="w-full">تحديث</Btn>
      {items.length === 0 && <div className="text-center text-muted-foreground text-sm py-4">لا توجد طلبات</div>}
      {items.map(d => (
        <div key={d.id} className="bg-secondary rounded-xl p-3 border border-violet-500/20 space-y-2">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-bold text-foreground text-sm">{d.first_name ?? d.username ?? d.telegram_id}</div>
              <div className="text-xs text-muted-foreground font-mono">ID: {d.telegram_id}</div>
              <div className="text-primary font-black text-sm mt-0.5">{Number(d.amount).toFixed(4)} GRAM</div>
              {d.wallet_address && (
                <div className="text-[10px] font-mono text-muted-foreground break-all mt-0.5">{d.wallet_address}</div>
              )}
              <div className="text-xs text-muted-foreground mt-0.5">{new Date(d.created_at).toLocaleString(lang)}</div>
            </div>
            <span className={`text-xs font-bold ${statusColor(d.status)}`}>{d.status}</span>
          </div>
          {d.status === 'pending' && (
            <Btn size="sm" variant="success" onClick={() => credit(d.id)} disabled={creditingId === d.id} className="w-full">
              <Check className="w-3 h-3" />{creditingId === d.id ? '...' : 'صرف يدويًا'}
            </Btn>
          )}
          {d.tx_hash && !d.tx_hash.startsWith('pending:') && !d.tx_hash.startsWith('signed:') && (
            <div className="text-[10px] font-mono text-green-400 break-all">TX: {d.tx_hash}</div>
          )}
          {d.rejection_reason && <div className="text-xs text-red-400">السبب: {d.rejection_reason}</div>}
        </div>
      ))}
    </div>
  );
}

// ─── Sending currencies visibility ────────────────────────────────────────
function SendCurrenciesSection() {
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<Record<string, string>>('GET', '/admin/general?type=settings')
      .then((s) => setEnabled(s['send_currencies_visible'] !== 'false'))
      .catch((e: any) => setStatus(`❌ ${e.message}`))
      .finally(() => setLoading(false));
  }, []);

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    try {
      await api('POST', '/admin/general?type=settings', {
        key: 'send_currencies_visible',
        value: next ? 'true' : 'false',
      });
      notifyDataChange('admin', 'user');
    } catch (e: any) {
      setEnabled(!next);
      setStatus(`❌ ${e.message}`);
      setTimeout(() => setStatus(''), 2000);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-muted-foreground text-sm">جاري التحميل…</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between bg-secondary rounded-xl px-4 py-3">
        <span className="text-foreground font-bold text-sm">إظهار زر "Sending currencies" للمستخدمين</span>
        <button
          type="button"
          disabled={saving}
          onClick={() => { void toggle(); }}
          aria-pressed={enabled}
          aria-label="إظهار زر Sending currencies للمستخدمين"
          className={`w-12 h-6 rounded-full relative transition-colors ${enabled ? 'bg-primary' : 'bg-secondary'} disabled:opacity-50`}
        >
          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${enabled ? 'right-1' : 'left-1'}`} />
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        لما يكون مقفول، زرار "Sending currencies" هيختفي من صفحة البروفايل لكل المستخدمين، ويفضل ظاهر للأدمن بس.
      </p>
      <StatusMsg msg={status} isError={status.startsWith('❌')} />
    </div>
  );
}

// ─── 9 & 10. Withdrawal & Deposit Limits ──────────────────────────────────
function LimitsSection() {
  const { t } = useLanguage();
  const [vals, setVals] = useState({ minWithdraw: '', maxWithdraw: '', minDeposit: '', maxDeposit: '' });
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Record<string, string>>('GET', '/admin/general?type=settings').then(s => {
      setVals({ minWithdraw: s['min_withdrawal'] || '0.1', maxWithdraw: s['max_withdrawal'] || '1000', minDeposit: s['min_deposit'] || '0.1', maxDeposit: s['max_deposit'] || '10000' });
    }).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    try {
      await Promise.all([
        api('POST', '/admin/general?type=settings', { key: 'min_withdrawal', value: vals.minWithdraw }),
        api('POST', '/admin/general?type=settings', { key: 'max_withdrawal', value: vals.maxWithdraw }),
        api('POST', '/admin/general?type=settings', { key: 'min_deposit',    value: vals.minDeposit }),
        api('POST', '/admin/general?type=settings', { key: 'max_deposit',    value: vals.maxDeposit }),
      ]);
      setStatus(t('admin_saved'));
    } catch { setStatus(t('admin_failed')); }
    setTimeout(() => setStatus(''), 2000);
  };

  if (loading) return <div className="text-muted-foreground text-sm">{t('admin_loading')}</div>;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{t('admin_withdraw_limits')}</p>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs text-muted-foreground">{t('admin_min')}</label><Input value={vals.minWithdraw} onChange={e => setVals(v => ({ ...v, minWithdraw: e.target.value }))} type="number" step="0.1" /></div>
          <div><label className="text-xs text-muted-foreground">{t('admin_max')}</label><Input value={vals.maxWithdraw} onChange={e => setVals(v => ({ ...v, maxWithdraw: e.target.value }))} type="number" /></div>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{t('admin_deposit_limits')}</p>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs text-muted-foreground">{t('admin_min')}</label><Input value={vals.minDeposit} onChange={e => setVals(v => ({ ...v, minDeposit: e.target.value }))} type="number" step="0.1" /></div>
          <div><label className="text-xs text-muted-foreground">{t('admin_max')}</label><Input value={vals.maxDeposit} onChange={e => setVals(v => ({ ...v, maxDeposit: e.target.value }))} type="number" /></div>
        </div>
      </div>
      <StatusMsg msg={status} isError={status.startsWith('❌')} />
      <Btn onClick={save} className="w-full"><ArrowDownUp className="w-3.5 h-3.5" />{t('admin_save_limits')}</Btn>
    </div>
  );
}

// ─── Channels (mandatory subscription) ────────────────────────────────────
function ChannelsSection() {
  const { t } = useLanguage();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [username, setUsername] = useState('');
  const [name, setName]         = useState('');
  const [status, setStatus]     = useState('');

  const load = useCallback(() => { api<Channel[]>('GET', '/admin/channels').then(setChannels).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!username.trim()) return;
    try {
      await api('POST', '/admin/channels', { channelUsername: username.replace(/^@/, ''), channelName: name || username });
      setUsername(''); setName(''); load(); setStatus(t('admin_added_f'));
    } catch { setStatus(t('admin_failed')); }
    setTimeout(() => setStatus(''), 2000);
  };
  const del = async (id: number) => { await api('DELETE', `/admin/channels?id=${id}`); load(); };

  return (
    <div className="space-y-3">
      <div className="bg-secondary rounded-xl p-3 space-y-2 border border-violet-500/20">
        <Input value={username} onChange={e => setUsername(e.target.value)} placeholder="@channelUsername *" dir="ltr" />
        <Input value={name} onChange={e => setName(e.target.value)} placeholder={t('admin_display_name')} />
        <StatusMsg msg={status} isError={status.startsWith('❌')} />
        <Btn onClick={add} className="w-full"><Plus className="w-3.5 h-3.5" />{t('admin_add_channel')}</Btn>
      </div>
      {channels.map(c => (
        <div key={c.id} className="bg-secondary rounded-xl p-3 border border-violet-500/20 flex items-center justify-between">
          <div>
            <div className="font-bold text-foreground text-sm">{c.channelName || c.channelUsername}</div>
            <div className="text-xs text-muted-foreground font-mono">@{c.channelUsername}</div>
          </div>
          <button onClick={() => del(c.id)} className="p-1.5 rounded-lg text-destructive bg-destructive/10 hover:bg-destructive/20"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      ))}
      {channels.length === 0 && <div className="text-center text-muted-foreground text-sm py-2">{t('admin_no_channels')}</div>}
    </div>
  );
}

// ─── Sub-Admin Management ──────────────────────────────────────────────────
function AdminsSection() {
  const { t } = useLanguage();
  const [admins, setAdmins]     = useState<SubAdmin[]>([]);
  const [tid, setTid]           = useState('');
  const [uname, setUname]       = useState('');
  const [perms, setPerms]       = useState<string[]>([]);
  const [status, setStatus]     = useState('');
  const [loading, setLoading]   = useState(true);

  const load = useCallback(() => { api<SubAdmin[]>('GET', '/admin/admins').then(setAdmins).finally(() => setLoading(false)); }, []);
  useEffect(() => { load(); }, [load]);

  const togglePerm = (key: string) => setPerms(p => p.includes(key) ? p.filter(x => x !== key) : [...p, key]);
  const allSelected = perms.length === ALL_PERMISSIONS.length;
  const toggleAll = () => setPerms(allSelected ? [] : ALL_PERMISSIONS.map(p => p.key));

  const add = async () => {
    if (!tid.trim()) return;
    try {
      await api('POST', '/admin/admins', { telegramId: Number(tid), username: uname, permissions: perms });
      setTid(''); setUname(''); setPerms([]);
      load(); setStatus(t('admin_added_m'));
    } catch { setStatus(t('admin_failed')); }
    setTimeout(() => setStatus(''), 2000);
  };

  const remove = async (telegramId: number) => {
    await api('DELETE', `/admin/admins?id=${telegramId}`, undefined);
    load();
  };

  if (loading) return <div className="text-muted-foreground text-sm">{t('admin_loading')}</div>;

  return (
    <div className="space-y-3">
      <div className="bg-secondary rounded-xl p-3 space-y-2 border border-violet-500/20">
        <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">{t('admin_add_new_admin')}</p>
        <Input value={tid} onChange={e => setTid(e.target.value)} placeholder="معرّف تيليجرام (ID) *" type="number" dir="ltr" />
        <Input value={uname} onChange={e => setUname(e.target.value)} placeholder={t('admin_username_optional')} dir="ltr" />

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t('admin_permissions')}</span>
            <button onClick={toggleAll} className="text-xs text-primary font-bold">{allSelected ? t('admin_deselect_all') : t('admin_select_all')}</button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {ALL_PERMISSIONS.map(p => (
              <label key={p.key} className="flex items-center gap-1.5 cursor-pointer text-xs text-foreground bg-secondary rounded-lg px-2 py-1.5">
                <input type="checkbox" checked={perms.includes(p.key)} onChange={() => togglePerm(p.key)} className="w-3.5 h-3.5 accent-primary" />
                {t(p.labelKey)}
              </label>
            ))}
          </div>
        </div>

        <StatusMsg msg={status} isError={status.startsWith('❌')} />
        <Btn onClick={add} className="w-full"><UserPlus className="w-3.5 h-3.5" />{t('admin_add_admin')}</Btn>
      </div>

      {admins.map(a => (
        <div key={a.telegramId} className="bg-secondary rounded-xl p-3 border border-violet-500/20">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="font-bold text-foreground text-sm">{a.username ? `@${a.username}` : `ID: ${a.telegramId}`}</div>
              <div className="text-xs text-muted-foreground font-mono">{a.telegramId}</div>
            </div>
            <button onClick={() => remove(a.telegramId)} className="p-1.5 rounded-lg text-destructive bg-destructive/10 hover:bg-destructive/20"><X className="w-3.5 h-3.5" /></button>
          </div>
          <div className="flex flex-wrap gap-1">
            {a.permissions.length === ALL_PERMISSIONS.length
              ? <span className="text-[10px] bg-primary/20 text-primary px-2 py-0.5 rounded-full">{t('admin_all_permissions')}</span>
              : a.permissions.map(p => {
                const found = ALL_PERMISSIONS.find(x => x.key === p);
                return <span key={p} className="text-[10px] bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">{found ? t(found.labelKey) : p}</span>;
              })
            }
          </div>
        </div>
      ))}
      {admins.length === 0 && <div className="text-center text-muted-foreground text-sm py-2">{t('admin_no_subadmins')}</div>}
    </div>
  );
}

// ─── Daily Combo (read-only view) ─────────────────────────────────────────
// Item id → name/emoji comes from the same shared list the user-facing
// Combo screen renders (src/lib/combo-items.ts), so this display can never
// drift out of sync with what the user actually sees and selects.

function ComboDailySection() {
  return <ComboDailySectionInner />;
}

// ─── Daily mining percentage ──────────────────────────────────────────────
function MiningPctSection() {
  const [pct, setPct] = useState('5');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api<Record<string, string>>('GET', '/admin/general?type=settings')
      .then(s => setPct(String(s?.mining_daily_pct ?? '5')))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setMsg('');
    const n = Number(pct);
    if (!Number.isFinite(n) || n < 0) { setMsg('نسبة غير صحيحة'); return; }
    try {
      await api('POST', '/admin/general?type=settings', { key: 'mining_daily_pct', value: String(n) });
      setMsg('تم الحفظ ✅ النسبة الجديدة مطبقة على كل المستخدمين');
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  if (loading) return <div className="text-muted-foreground text-sm">جارٍ التحميل…</div>;

  return (
    <div className="space-y-3" dir="rtl">
      <div className="text-xs text-muted-foreground">
        نسبة التعدين اليومية من رصيد MNX (الافتراضي 5%). مثال: 700 MNX = 1 جرام، وبنسبة 5% يعدّن المستخدم 0.05 جرام يوميًا لكل 700 MNX.
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          step="0.1"
          min="0"
          value={pct}
          onChange={e => setPct(e.target.value)}
          className="flex-1 bg-secondary border border-violet-500/20 rounded-lg px-3 py-2 text-sm text-foreground"
        />
        <span className="text-sm text-muted-foreground">% / يوم</span>
      </div>
      <Btn onClick={save} className="w-full">حفظ نسبة التعدين</Btn>
      {msg && <div className="text-xs text-primary">{msg}</div>}
    </div>
  );
}

// ─── StartMiner button visibility ─────────────────────────────────────────
function MiningButtonSection() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api<Record<string, string>>('GET', '/admin/general?type=settings')
      .then(s => setEnabled((s?.mining_button_enabled ?? '1') !== '0'))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setMsg('');
    try {
      await api('POST', '/admin/general?type=settings', {
        key: 'mining_button_enabled',
        value: next ? '1' : '0',
      });
      setMsg(next ? 'الزر ظاهر للمستخدمين ✅' : 'الزر مخفي والتعدين يعمل تلقائيًا ✅');
    } catch (e: any) {
      setEnabled(!next);
      setMsg(e.message);
    }
  }

  if (loading) return <div className="text-muted-foreground text-sm">جارٍ التحميل…</div>;

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        عند الإخفاء، لا يحتاج المستخدم للضغط على زر التعدين وتُحسب الأرباح تلقائيًا.
      </div>
      <button
        onClick={toggle}
        className={`w-full py-3 rounded-xl font-bold text-sm ${
          enabled
            ? 'bg-primary/20 border border-primary/40 text-white'
            : 'bg-destructive/20 border border-destructive/40 text-white'
        }`}
      >
        {enabled ? 'زر StartMiner: ظاهر — اضغط للإخفاء' : 'زر StartMiner: مخفي — اضغط للإظهار'}
      </button>
      {msg && <div className="text-xs text-primary">{msg}</div>}
    </div>
  );
}

function ComboDailySectionInner() {
  return <ComboDailyInner />;
}

function DailyCheckinSection() {
  const [vals, setVals] = useState<string[]>(['2', '3', '4', '5', '6', '7', '10']);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api<Record<string, string>>('GET', '/admin/general?type=settings')
      .then(s => {
        const raw = s?.daily_checkin_rewards;
        if (raw) {
          try {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr) && arr.length) setVals(arr.map((n: unknown) => String(n)));
          } catch { /* keep defaults */ }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setMsg('');
    const nums = vals.map(v => Number(v) || 0);
    try {
      await api('POST', '/admin/general?type=settings', {
        key: 'daily_checkin_rewards',
        value: JSON.stringify(nums),
      });
      setMsg('تم الحفظ ✅');
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  if (loading) return <div className="text-muted-foreground text-sm">جارٍ التحميل…</div>;

  return (
    <div className="space-y-3" dir="rtl">
      <div className="text-xs text-muted-foreground">
        مكافأة كل يوم من أيام التسجيل اليومي (بالكوين). لو المستخدم فوّت يومًا تبدأ السلسلة من اليوم الأول.
      </div>
      <div className="grid grid-cols-4 gap-2">
        {vals.map((v, i) => (
          <div key={i}>
            <div className="text-[10px] text-muted-foreground mb-1">اليوم {i + 1}</div>
            <input
              type="number"
              step="0.5"
              value={v}
              onChange={e => setVals(prev => prev.map((x, j) => (j === i ? e.target.value : x)))}
              className="w-full bg-secondary border border-violet-500/20 rounded-lg px-2 py-2 text-sm text-foreground"
            />
          </div>
        ))}
      </div>
      <Btn onClick={save} className="w-full">حفظ مكافآت التسجيل اليومي</Btn>
      {msg && <div className="text-xs text-primary">{msg}</div>}
    </div>
  );
}

const COMBO_REWARD_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function ComboDailyInner() {
  const { t } = useLanguage();
  const [combo, setCombo] = useState<{ date: string|null; correctIds: number[] } | null>(null);
  const [rewardMin, setRewardMin] = useState('1');
  const [rewardMax, setRewardMax] = useState('10');
  const [savingRange, setSavingRange] = useState(false);
  const [weights, setWeights] = useState<Record<string, string>>(
    Object.fromEntries(COMBO_REWARD_VALUES.map(v => [String(v), '0']))
  );
  const [savingWeights, setSavingWeights] = useState(false);
  const [err, setErr]     = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [reward, setReward] = useState('5000');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const weightsTotal = COMBO_REWARD_VALUES.reduce((s, v) => s + (Number(weights[String(v)]) || 0), 0);

  useEffect(() => {
    api<{ date: string|null; correctIds: number[]; rewardMin?: number; rewardMax?: number; rewardWeights?: Record<string, number> }>(
      'GET', '/admin/general?type=combo'
    ).then(c => {
      setCombo(c);
      setSelected(c.correctIds ?? []);
      if (c.rewardMin !== undefined) setRewardMin(String(c.rewardMin));
      if (c.rewardMax !== undefined) setRewardMax(String(c.rewardMax));
      if (c.rewardWeights) {
        setWeights(Object.fromEntries(
          COMBO_REWARD_VALUES.map(v => [String(v), String(c.rewardWeights?.[String(v)] ?? 0)])
        ));
      }
    }).catch(e => setErr(e.message));
  }, []);

  async function saveWeights() {
    setSavingWeights(true); setMsg('');
    try {
      const payload: Record<string, number> = {};
      for (const v of COMBO_REWARD_VALUES) payload[String(v)] = Math.max(0, Number(weights[String(v)]) || 0);
      await api('POST', '/admin/general?type=combo', { rewardWeights: payload });
      setMsg('تم حفظ نسب مكافآت الكومبو ✅');
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setSavingWeights(false);
    }
  }

  async function saveRange() {
    setSavingRange(true); setMsg('');
    try {
      const min = Math.max(0, Number(rewardMin) || 0);
      const max = Math.max(min, Number(rewardMax) || min);
      await api('POST', '/admin/general?type=combo', { rewardMin: min, rewardMax: max });
      setRewardMin(String(min)); setRewardMax(String(max));
      setMsg(`تم حفظ نطاق مكافأة الكومبو: ${min} – ${max} MNX ✅`);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setSavingRange(false);
    }
  }


  function toggle(id: number) {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : prev.length >= 3 ? prev : [...prev, id]
    );
  }

  async function save() {
    if (selected.length !== 3) { setMsg('اختر 3 عناصر بالضبط'); return; }
    setSaving(true); setMsg('');
    try {
      await api('POST', '/admin/general?type=combo', {
        correctIds: selected,
        reward: Number(reward) || 0,
      });
      const fresh = await api<{ date: string|null; correctIds: number[] }>(
        'GET', '/admin/general?type=combo'
      );
      setCombo(fresh);
      setMsg('تم حفظ كومبو اليوم ✅');
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (err)   return <div className="text-destructive text-sm">{err}</div>;
  if (!combo) return <div className="text-muted-foreground text-sm">{t('admin_loading')}</div>;

  return (
    <div className="space-y-3">
      {combo.date ? (
        <>
          <div className="text-xs text-muted-foreground">{t('admin_combo_today_date')} <span className="text-foreground font-bold">{combo.date}</span></div>
          <div className="text-xs text-muted-foreground mb-1">{t('admin_combo_correct')}</div>
          <div className="flex gap-2 flex-wrap">
            {combo.correctIds.map(id => (
              <div key={id} className="flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-xl px-3 py-2">
                <span className="text-lg">{COMBO_ITEM_EMOJI[id]}</span>
                <span className="text-foreground font-bold text-xs">{COMBO_ITEM_NAME[id]}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="text-muted-foreground text-sm">{t('admin_combo_none')}</div>
      )}

      <div className="pt-2 border-t border-violet-500/20 space-y-2">
        <div className="text-xs text-muted-foreground">نطاق مكافأة الكومبو اليومي (عشوائي بين الحدين)</div>
        <div className="flex items-center gap-2">
          <input
            value={rewardMin}
            onChange={e => setRewardMin(e.target.value)}
            inputMode="numeric"
            placeholder="أقل مكافأة"
            className="flex-1 bg-secondary border border-violet-500/20 rounded-xl px-3 py-2 text-sm text-foreground"
          />
          <span className="text-muted-foreground text-xs">–</span>
          <input
            value={rewardMax}
            onChange={e => setRewardMax(e.target.value)}
            inputMode="numeric"
            placeholder="أعلى مكافأة"
            className="flex-1 bg-secondary border border-violet-500/20 rounded-xl px-3 py-2 text-sm text-foreground"
          />
          <button
            onClick={saveRange}
            disabled={savingRange}
            className="bg-primary text-primary-foreground font-bold text-sm rounded-xl px-4 py-2 disabled:opacity-50"
          >
            {savingRange ? '...' : 'حفظ'}
          </button>
        </div>
        <div className="text-[10px] text-muted-foreground">يُستخدم فقط لو كل النسب بالأسفل = 0.</div>
      </div>

      <div className="pt-2 border-t border-violet-500/20 space-y-2">
        <div className="text-xs text-muted-foreground">
          نسبة ظهور كل مكافأة (%) — المكافأة اللي نسبتها 0% لن تظهر لأي مستخدم
        </div>
        <div className="space-y-1.5">
          {COMBO_REWARD_VALUES.map(v => (
            <div key={v} className="flex items-center gap-2">
              <span className="w-16 text-xs font-bold text-foreground">{v} MNX</span>
              <input
                value={weights[String(v)] ?? '0'}
                onChange={e => setWeights(prev => ({ ...prev, [String(v)]: e.target.value }))}
                inputMode="numeric"
                className="flex-1 bg-secondary border border-violet-500/20 rounded-xl px-3 py-1.5 text-sm text-foreground"
              />
              <span className="text-xs text-muted-foreground w-4">%</span>
            </div>
          ))}
        </div>
        <div className="text-[10px] text-muted-foreground">
          مجموع النسب الحالي: {weightsTotal}% (لا يشترط 100 — تُوزَّع نسبياً)
        </div>
        <Btn onClick={saveWeights} className="w-full">
          {savingWeights ? '...' : 'حفظ نسب مكافآت الكومبو'}
        </Btn>
      </div>


      <div className="pt-2 border-t border-violet-500/20 space-y-2">
        <div className="text-xs text-muted-foreground">اختر 3 عناصر لكومبو اليوم ({selected.length}/3)</div>
        <div className="flex gap-2 flex-wrap">
          {[1, 2, 3, 4, 5].map(id => (
            <button
              key={id}
              onClick={() => toggle(id)}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 border text-xs font-bold transition ${
                selected.includes(id)
                  ? 'bg-primary/20 border-primary/50 text-white'
                  : 'bg-secondary border-violet-500/20 text-muted-foreground'
              }`}
            >
              <span className="text-lg">{COMBO_ITEM_EMOJI[id]}</span>
              {COMBO_ITEM_NAME[id]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={reward}
            onChange={e => setReward(e.target.value)}
            inputMode="numeric"
            placeholder="المكافأة (MNX)"
            className="flex-1 bg-secondary border border-violet-500/20 rounded-xl px-3 py-2 text-sm text-foreground"
          />
          <button
            onClick={save}
            disabled={saving}
            className="bg-primary text-primary-foreground font-bold text-sm rounded-xl px-4 py-2 disabled:opacity-50"
          >
            {saving ? '...' : 'حفظ'}
          </button>
        </div>
        {msg && <div className="text-xs text-primary">{msg}</div>}
      </div>
    </div>
  );
}

// ─── Shared tournament helpers ─────────────────────────────────────────────
interface Tournament {
  id: number;
  title: string;
  topN: number;
  prizes: { rank: number; gram: number; coins?: number }[];
  startsAt: string;
  endsAt: string;
  status: string;
  settledAt?: string;
  tournamentType?: string;
}

function TournamentSection() {
  const { t: tr, lang } = useLanguage();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading]         = useState(true);
  const [status, setStatus]           = useState('');
  const [settling, setSettling]       = useState<number | null>(null);

  // Create form state
  const [title, setTitle]         = useState('');
  const [topN, setTopN]           = useState(10);
  const [durationH, setDurationH] = useState(24);
  // prizes: rank 1..topN each with a gram value
  const [prizeValues, setPrizeValues] = useState<Record<number, string>>({
    1: '1000', 2: '500', 3: '250', 4: '100', 5: '50',
  });

  const load = useCallback(async () => {
    try {
      const data = await api<Tournament[]>('GET', '/admin/general?type=tournament');
      setTournaments(data);
    } catch (e: any) { setStatus(`❌ ${e.message}`); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rankLabel = (r: number) => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `#${r}`;

  const create = async () => {
    if (!title.trim()) { setStatus(tr('admin_trn_enter_name')); return; }
    const prizes = Array.from({ length: topN }, (_, i) => ({
      rank: i + 1,
      gram: Number(prizeValues[i + 1] ?? 0),
    })).filter(p => p.gram > 0);
    try {
      setStatus('');
      await api('POST', '/admin/general?type=tournament', { title, topN, durationHours: durationH, prizes });
      setStatus(tr('admin_trn_created'));
      setTitle('');
      await load();
    } catch (e: any) { setStatus(`❌ ${e.message}`); }
    setTimeout(() => setStatus(''), 3000);
  };

  const cancel = async (id: number) => {
    if (!confirm(tr('admin_trn_cancel_confirm'))) return;
    try {
      await api('DELETE', `/admin/general?type=tournament&id=${id}`);
      setStatus(tr('admin_trn_cancelled'));
      await load();
    } catch (e: any) { setStatus(`❌ ${e.message}`); }
    setTimeout(() => setStatus(''), 2000);
  };

  const settle = async (id: number) => {
    if (!confirm(tr('admin_trn_settle_confirm'))) return;
    setSettling(id);
    try {
      await api('POST', `/admin/general?type=tournament&action=settle&id=${id}`);
      setStatus(tr('admin_trn_settled'));
      await load();
    } catch (e: any) { setStatus(`❌ ${e.message}`); }
    finally { setSettling(null); }
    setTimeout(() => setStatus(''), 3000);
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' });

  const timeLeft = (endsAt: string) => {
    const diff = new Date(endsAt).getTime() - Date.now();
    if (diff <= 0) return tr('admin_trn_ended');
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return tr('admin_trn_hm', { h: String(h), m: String(m) });
  };

  const active = tournaments.filter(t => t.status === 'active');
  const past   = tournaments.filter(t => t.status !== 'active');

  const DURATION_OPTIONS = [
    { v: 1, l: tr('admin_dur_1h') }, { v: 6, l: tr('admin_dur_6h') }, { v: 12, l: tr('admin_dur_12h') },
    { v: 24, l: tr('admin_dur_24h') }, { v: 48, l: tr('admin_dur_48h') }, { v: 72, l: tr('admin_dur_72h') },
    { v: 168, l: tr('admin_dur_week') },
  ];

  return (
    <div className="space-y-4">
      {/* ── Create form ── */}
      <div className="bg-secondary rounded-xl p-3 space-y-3 border border-violet-500/20">
        <p className="text-xs font-black text-muted-foreground flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5 text-primary" /> {tr('admin_trn_create_new')}
        </p>

        <Input
          placeholder={tr('admin_trn_name_ph')}
          value={title}
          onChange={e => setTitle(e.target.value)}
        />

        <div className="flex gap-2">
          <div className="flex-1">
            <p className="text-[10px] text-muted-foreground mb-1">{tr('admin_trn_ranks_count')}</p>
            <select
              value={topN}
              onChange={e => setTopN(Number(e.target.value))}
              className="w-full bg-secondary border border-violet-500/20 rounded-xl px-3 py-2 text-foreground text-sm focus:outline-none"
            >
              {[3,5,10,20,30,50].map(n => <option key={n} value={n}>{tr('admin_trn_ranks_n', { n: String(n) })}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <p className="text-[10px] text-muted-foreground mb-1">{tr('admin_trn_duration')}</p>
            <select
              value={durationH}
              onChange={e => setDurationH(Number(e.target.value))}
              className="w-full bg-secondary border border-violet-500/20 rounded-xl px-3 py-2 text-foreground text-sm focus:outline-none"
            >
              {DURATION_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
        </div>

        {/* Prize inputs — show up to first 10 or topN */}
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground">{tr('admin_trn_prizes_gram')}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {Array.from({ length: Math.min(topN, 10) }, (_, i) => (
              <div key={i + 1} className="flex items-center gap-2 bg-secondary rounded-xl px-2 py-1.5">
                <span className="text-xs font-bold text-muted-foreground w-7 flex-shrink-0">{rankLabel(i + 1)}</span>
                <input
                  type="number"
                  min={0}
                  placeholder="0"
                  value={prizeValues[i + 1] ?? ''}
                  onChange={e => setPrizeValues(p => ({ ...p, [i + 1]: e.target.value }))}
                  className="w-full bg-transparent text-foreground text-sm focus:outline-none"
                />
                <span className="text-[10px] text-muted-foreground flex-shrink-0">gram</span>
              </div>
            ))}
          </div>
          {topN > 10 && (
            <p className="text-[10px] text-muted-foreground">
              {tr('admin_trn_ranks_noprize', { topN: String(topN) })}
            </p>
          )}
        </div>

        <StatusMsg msg={status} isError={status.startsWith('❌')} />
        <Btn onClick={create} disabled={!title.trim()} className="w-full">
          <Trophy className="w-3.5 h-3.5" /> {tr('admin_trn_create_btn')}
        </Btn>
      </div>

      {/* ── Active tournaments ── */}
      {loading ? (
        <div className="text-muted-foreground text-sm">{tr('admin_loading')}</div>
      ) : active.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-black text-success flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5" /> {tr('admin_trn_active_count', { n: String(active.length) })}
          </p>
          {active.map(t => (
            <div key={t.id} className="bg-success/10 border border-success/30 rounded-xl p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-foreground font-black text-sm">{t.title}</p>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3" /> {tr('admin_trn_ends')}: {formatDate(t.endsAt)} · {tr('admin_trn_remaining')}: {timeLeft(t.endsAt)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {tr('admin_trn_top_users', { n: String(t.topN) })} · {tr('admin_trn_prizes_count', { n: String(t.prizes.filter(p => p.gram > 0).length) })}
                  </p>
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => settle(t.id)}
                    disabled={settling === t.id}
                    className="bg-primary/20 text-primary text-[10px] font-bold rounded-lg px-2 py-1 border border-primary/30"
                  >
                    {settling === t.id ? '...' : tr('admin_trn_settle_now')}
                  </button>
                  <button
                    onClick={() => cancel(t.id)}
                    className="bg-destructive/20 text-destructive text-[10px] font-bold rounded-lg px-2 py-1 border border-destructive/30"
                  >
                    {tr('admin_cancel')}
                  </button>
                </div>
              </div>
              {/* Prize summary */}
              <div className="flex flex-wrap gap-1.5">
                {t.prizes.filter(p => p.gram > 0).slice(0, 5).map(p => (
                  <span key={p.rank} className="text-[10px] bg-secondary rounded-lg px-2 py-0.5 text-muted-foreground">
                    {rankLabel(p.rank)} {p.gram}g
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-2">{tr('admin_trn_no_active')}</p>
      )}

      {/* ── Past tournaments ── */}
      {past.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-black text-muted-foreground">{tr('admin_trn_past', { n: String(past.length) })}</p>
          {past.slice(0, 5).map(t => (
            <div key={t.id} className="bg-secondary border border-violet-500/20 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground font-bold text-sm">{t.title}</p>
                <span className={`text-[10px] rounded-full px-2 py-0.5 font-bold ${
                  t.status === 'settled' ? 'bg-success/20 text-success' : 'bg-secondary text-muted-foreground'
                }`}>
                  {t.status === 'settled' ? tr('admin_trn_finished') : tr('admin_trn_cancelled_status')}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">{formatDate(t.endsAt)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Coin Tournament Section ───────────────────────────────────────────────
// Default prize structure (editable in UI)
const COIN_TRN_DEFAULT_TITLE = 'GRAM MNX Coin Tournament';

const DEFAULT_COIN_PRIZES: Record<number, string> = {
  1: '3500', 2: '2500', 3: '2000',
  4: '1000', 5: '1000', 6: '1000',
  7: '500', 8: '500', 9: '500', 10: '500',
  11: '500', 12: '500', 13: '500', 14: '500', 15: '500',
  16: '300', 17: '300', 18: '300', 19: '300', 20: '300',
};

function CoinTournamentSection() {
  const { t: tr, lang } = useLanguage();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading]         = useState(true);
  const [status, setStatus]           = useState('');
  const [settling, setSettling]       = useState<number | null>(null);
  const [title, setTitle]             = useState(COIN_TRN_DEFAULT_TITLE);
  const [durationH, setDurationH]     = useState(15 * 24); // 15 days
  const [prizeValues, setPrizeValues] = useState<Record<number, string>>({ ...DEFAULT_COIN_PRIZES });

  const topN = 20; // fixed for coin tournament

  const load = useCallback(async () => {
    try {
      const data = await api<Tournament[]>('GET', '/admin/general?type=tournament&tournamentType=coin');
      setTournaments(data.filter(t => t.tournamentType === 'coin'));
    } catch (e: any) { setStatus(`❌ ${e.message}`); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rankLabel = (r: number) => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `#${r}`;

  const flash = (msg: string) => { setStatus(msg); setTimeout(() => setStatus(''), 3000); };

  const create = async () => {
    if (!title.trim()) { flash(tr('admin_trn_enter_name')); return; }
    const prizes = Array.from({ length: topN }, (_, i) => ({
      rank: i + 1,
      gram: 0,
      coins: Number(prizeValues[i + 1] ?? 0),
    })).filter(p => p.coins > 0);
    try {
      setStatus('');
      await api('POST', '/admin/general?type=tournament', {
        title: title.trim(),
        topN,
        durationHours: durationH,
        prizes,
        tournamentType: 'coin',
      });
      flash(tr('admin_trn_created'));
      await load();
    } catch (e: any) { flash(`❌ ${e.message}`); }
  };

  const cancel = async (id: number) => {
    if (!confirm(tr('admin_trn_cancel_forever'))) return;
    try {
      await api('DELETE', `/admin/general?type=tournament&id=${id}`);
      flash(tr('admin_trn_cancelled'));
      await load();
    } catch (e: any) { flash(`❌ ${e.message}`); }
  };

  const settle = async (id: number) => {
    if (!confirm(tr('admin_trn_settle_now_confirm'))) return;
    setSettling(id);
    try {
      await api('POST', `/admin/general?type=tournament&action=settle&id=${id}`);
      flash(tr('admin_trn_distributed'));
      await load();
    } catch (e: any) { flash(`❌ ${e.message}`); }
    finally { setSettling(null); }
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' });

  const timeLeft = (endsAt: string) => {
    const diff = new Date(endsAt).getTime() - Date.now();
    if (diff <= 0) return tr('admin_trn_ended');
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    return d > 0 ? tr('admin_trn_dh', { d: String(d), h: String(h) }) : tr('admin_trn_hm', { h: String(h), m: String(Math.floor((diff % 3600000) / 60000)) });
  };

  const DURATION_OPTIONS = [
    { v: 1 / 60,  l: tr('admin_dur_1min') },
    { v: 2 / 60,  l: tr('admin_dur_2min') },
    { v: 24,      l: tr('admin_dur_1day') },
    { v: 3 * 24,  l: tr('admin_dur_3days') },
    { v: 7 * 24,  l: tr('admin_dur_week') },
    { v: 15 * 24, l: tr('admin_dur_15days') },
    { v: 30 * 24, l: tr('admin_dur_30days') },
  ];


  const active = tournaments.filter(t => t.status === 'active');
  const past   = tournaments.filter(t => t.status !== 'active');
  const hasActive = active.length > 0;

  return (
    <div className="space-y-4">
      {/* ── Active tournament card ── */}
      {loading ? (
        <div className="text-muted-foreground text-sm">{tr('admin_loading')}</div>
      ) : hasActive ? (
        <div className="space-y-2">
          {active.map(t => (
            <div key={t.id} className="bg-primary/10 border border-primary/30 rounded-xl p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-foreground font-black text-sm">{t.title}</p>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3" /> {tr('admin_trn_ends')}: {formatDate(t.endsAt)} · {tr('admin_trn_remaining')}: {timeLeft(t.endsAt)}
                  </p>
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => settle(t.id)}
                    disabled={settling === t.id}
                    className="bg-primary/20 text-primary text-[10px] font-bold rounded-lg px-2 py-1 border border-primary/30"
                  >
                    {settling === t.id ? '...' : tr('admin_trn_distribute_now')}
                  </button>
                  <button
                    onClick={() => cancel(t.id)}
                    className="bg-destructive/20 text-destructive text-[10px] font-bold rounded-lg px-2 py-1 border border-destructive/30"
                  >
                    {tr('admin_cancel')}
                  </button>
                </div>
              </div>
              {/* Prize preview */}
              <div className="flex flex-wrap gap-1">
                {t.prizes.filter(p => (p.coins ?? p.gram) > 0).slice(0, 6).map(p => (
                  <span key={p.rank} className="text-[10px] bg-secondary rounded-lg px-2 py-0.5 text-primary font-bold">
                    {rankLabel(p.rank)} {(p.coins ?? p.gram).toLocaleString()} MNX
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* ── Create / Restart form ── */}
      <div className="bg-secondary rounded-xl p-3 space-y-3 border border-violet-500/20">
        <p className="text-xs font-black text-muted-foreground flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5 text-primary" />
          {hasActive ? tr('admin_coin_new_cycle') : tr('admin_coin_create_new')}
        </p>

        <Input
          placeholder={tr('admin_trn_name_simple')}
          value={title}
          onChange={e => setTitle(e.target.value)}
        />

        <div>
          <p className="text-[10px] text-muted-foreground mb-1">{tr('admin_trn_duration_full')}</p>
          <select
            value={durationH}
            onChange={e => setDurationH(Number(e.target.value))}
            className="w-full bg-secondary border border-violet-500/20 rounded-xl px-3 py-2 text-foreground text-sm focus:outline-none"
          >
            {DURATION_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </div>

        {/* Prize editor */}
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground">{tr('admin_trn_prizes_coin')}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {Array.from({ length: topN }, (_, i) => (
              <div key={i + 1} className="flex items-center gap-2 bg-secondary rounded-xl px-2 py-1.5">
                <span className="text-xs font-bold text-muted-foreground w-7 flex-shrink-0">{rankLabel(i + 1)}</span>
                <input
                  type="number"
                  min={0}
                  placeholder="0"
                  value={prizeValues[i + 1] ?? ''}
                  onChange={e => setPrizeValues(p => ({ ...p, [i + 1]: e.target.value }))}
                  className="w-full bg-transparent text-foreground text-sm focus:outline-none"
                />
                <span className="text-[10px] text-primary/60 flex-shrink-0">MNX</span>
              </div>
            ))}
          </div>
        </div>

        <button
          className="text-[10px] text-primary underline"
          onClick={() => setPrizeValues({ ...DEFAULT_COIN_PRIZES })}
        >
          {tr('admin_reset_defaults')}
        </button>

        <StatusMsg msg={status} isError={status.startsWith('❌')} />
        <Btn onClick={create} disabled={!title.trim()} className="w-full">
          <Trophy className="w-3.5 h-3.5" />
          {hasActive ? tr('admin_coin_new_cycle_btn') : tr('admin_coin_launch')}
        </Btn>
      </div>

      {/* ── Past coin tournaments ── */}
      {past.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-black text-muted-foreground">{tr('admin_trn_past', { n: String(past.length) })}</p>
          {past.slice(0, 5).map(t => (
            <div key={t.id} className="bg-secondary border border-violet-500/20 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground font-bold text-sm">{t.title}</p>
                <span className={`text-[10px] rounded-full px-2 py-0.5 font-bold ${
                  t.status === 'settled' ? 'bg-success/20 text-success' : 'bg-secondary text-muted-foreground'
                }`}>
                  {t.status === 'settled' ? tr('admin_trn_finished') : tr('admin_trn_cancelled_status')}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">{formatDate(t.endsAt)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Admin Page ───────────────────────────────────────────────────────
export default function Admin() {
  const { t } = useLanguage();
  return (
    <div className="min-h-full flex flex-col relative w-full" dir="rtl">
      <div className="absolute inset-0 z-0" style={{ backgroundColor: 'hsl(var(--background))' }} />

      {/* Header */}
      <div className="relative z-10 flex items-center gap-3 px-4 py-4 border-b border-violet-500/20">
        <div className="w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center">
          <Shield className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-black text-foreground">{t('admin_dashboard')}</h1>
          <p className="text-[10px] text-muted-foreground">لوحة إدارة GRAM MNX</p>
        </div>
      </div>

      {/* Stacked sections */}
      <div className="relative z-10 flex-1 p-3 pb-24">
        <Section title={t('admin_sec_stats')} icon={BarChart3} defaultOpen>
          <StatsSection />
        </Section>
        <Section title={t('admin_sec_broadcast')} icon={Send}>
          <BroadcastSection />
        </Section>
        <Section title={t('admin_sec_maintenance')} icon={Wrench}>
          <MaintenanceSection />
        </Section>
        <Section title={t('admin_sec_welcome')} icon={MessageSquare}>
          <WelcomeSection />
        </Section>
        <Section title={t('admin_sec_tasks')} icon={ClipboardList}>
          <TasksSection />
        </Section>
        <Section title="مراجعة إثباتات المهام" icon={ClipboardList}>
          <TaskSubmissionsSection />
        </Section>
        <Section title={t('admin_sec_referral')} icon={DollarSign}>
          <ReferralSection />
        </Section>
        <Section title={t('admin_sec_milestones')} icon={UserPlus}>
          <MilestonesSection />
        </Section>
        <Section title={t('admin_sec_users')} icon={Users}>
          <UsersSection />
        </Section>
        <Section title={t('admin_sec_miners')} icon={Pickaxe}>
          <MinersSection />
        </Section>
        <Section title={t('admin_sec_limits')} icon={ArrowDownUp}>
          <LimitsSection />
        </Section>
        <Section title={t('admin_sec_channels')} icon={Radio}>
          <ChannelsSection />
        </Section>
        <Section title={t('admin_sec_withdrawals')} icon={ArrowUp}>
          <WithdrawalsSection />
        </Section>
        <Section title="الإيداعات" icon={Wallet}>
          <DepositsSection />
        </Section>
        <Section title="إرسال العملات (Sending currencies)" icon={Send}>
          <SendCurrenciesSection />
        </Section>
        <Section title={t('admin_sec_subadmins')} icon={UserPlus}>
          <AdminsSection />
        </Section>
        <Section title="نسبة التعدين اليومية" icon={Sparkles}>
          <MiningPctSection />
        </Section>
        <Section title="زر StartMiner" icon={Sparkles}>
          <MiningButtonSection />
        </Section>
        <Section title="التسجيل اليومي" icon={Sparkles}>
          <DailyCheckinSection />
        </Section>
        <Section title="مهمة الإعلانات (Monetag)" icon={Sparkles}>
          <AdsSection />
        </Section>
        <Section title="قسم الهدايا (Gift)" icon={Sparkles}>
          <GiftSection />
        </Section>
        <Section title="أكواد الخصم (Promo Codes)" icon={Ticket}>

          <PromoSection />
        </Section>
        <Section title={t('admin_sec_combo')} icon={Sparkles}>
          <ComboDailySection />
        </Section>
        <Section title={t('admin_sec_coin_tournament')} icon={Coins}>
          <CoinTournamentSection />
        </Section>
        <Section title={t('admin_sec_gram_tournament')} icon={Trophy}>
          <TournamentSection />
        </Section>

        <Section title="دول المستخدمين" icon={BarChart3}>
          <CountriesSection />
        </Section>
        <Section title="تصفير كل النقاط (Coins)" icon={Coins}>
          <ResetCoinsSection />
        </Section>
        <Section title="تصفير كل الأرصدة (Gram)" icon={Wallet}>
          <ResetGramSection />
        </Section>
        <Section title="الأمان ومفاتيح المحفظة" icon={Shield}>
          <SecuritySection />
        </Section>
      </div>

    </div>
  );
}


// ─── Store Settings Section ────────────────────────────────────────────────
function StoreSettingsSection() {
  const { t } = useLanguage();
  const [coinsPerGram, setCoinsPerGram]   = useState('700');
  const [dailyGram,    setDailyGram]      = useState('0.05');
  const [monthlyGram,  setMonthlyGram]    = useState('1.50');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Record<string, string>>('GET', '/admin/general?type=settings').then(s => {
      if (s['store_coins_per_gram'])  setCoinsPerGram(s['store_coins_per_gram']);
      if (s['store_daily_gram'])      setDailyGram(s['store_daily_gram']);
      if (s['store_monthly_gram'])    setMonthlyGram(s['store_monthly_gram']);
    }).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    const cpg = Number(coinsPerGram);
    const dg  = Number(dailyGram);
    const mg  = Number(monthlyGram);
    if (!cpg || cpg <= 0) { setStatus(t('admin_store_rate_positive')); setTimeout(() => setStatus(''), 2500); return; }
    if (!dg  || dg  <= 0) { setStatus(t('admin_store_daily_positive'));   setTimeout(() => setStatus(''), 2500); return; }
    if (!mg  || mg  <= 0) { setStatus(t('admin_store_monthly_positive'));   setTimeout(() => setStatus(''), 2500); return; }
    try {
      await Promise.all([
        api('POST', '/admin/general?type=settings', { key: 'store_coins_per_gram', value: String(cpg) }),
        api('POST', '/admin/general?type=settings', { key: 'store_daily_gram',     value: String(dg)  }),
        api('POST', '/admin/general?type=settings', { key: 'store_monthly_gram',   value: String(mg)  }),
      ]);
      setStatus(t('admin_store_saved'));
    } catch { setStatus(t('admin_save_failed')); }
    setTimeout(() => setStatus(''), 2500);
  };

  if (loading) return <div className="text-muted-foreground text-sm">{t('admin_loading')}</div>;

  const dailyCoins   = Math.round(Number(dailyGram)   * Number(coinsPerGram));
  const monthlyCoins = Math.round(Number(monthlyGram) * Number(coinsPerGram));

  return (
    <div className="space-y-4">
      {/* Exchange rate */}
      <div className="bg-secondary rounded-xl p-3 space-y-2">
        <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider">{t('admin_exchange_rate')}</p>
        <div className="flex items-center gap-2">
          <input
            type="number" min="1" step="1" value={coinsPerGram}
            onChange={e => setCoinsPerGram(e.target.value)}
            className="flex-1 bg-secondary border border-violet-500/20 rounded-xl px-3 py-2 text-foreground text-sm focus:outline-none focus:border-primary/50"
          />
          <span className="text-muted-foreground text-sm font-bold whitespace-nowrap">MNX = 1 gram</span>
        </div>
      </div>

      {/* Daily plan */}
      <div className="bg-secondary rounded-xl p-3 space-y-2">
        <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider">{t('admin_daily_plan')}</p>
        <div className="flex items-center gap-2">
          <input
            type="number" min="0.001" step="0.001" value={dailyGram}
            onChange={e => setDailyGram(e.target.value)}
            className="flex-1 bg-secondary border border-violet-500/20 rounded-xl px-3 py-2 text-foreground text-sm focus:outline-none focus:border-primary/50"
          />
          <span className="text-muted-foreground text-sm font-bold whitespace-nowrap">gram</span>
        </div>
        <p className="text-xs text-primary/70">= {dailyCoins} MNX {t('admin_base_plan_700')}</p>
      </div>

      {/* Monthly plan */}
      <div className="bg-secondary rounded-xl p-3 space-y-2">
        <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider">{t('admin_monthly_plan')}</p>
        <div className="flex items-center gap-2">
          <input
            type="number" min="0.001" step="0.001" value={monthlyGram}
            onChange={e => setMonthlyGram(e.target.value)}
            className="flex-1 bg-secondary border border-violet-500/20 rounded-xl px-3 py-2 text-foreground text-sm focus:outline-none focus:border-primary/50"
          />
          <span className="text-muted-foreground text-sm font-bold whitespace-nowrap">gram</span>
        </div>
        <p className="text-xs text-primary/70">= {monthlyCoins} MNX {t('admin_base_plan_700')}</p>
      </div>

      <StatusMsg msg={status} isError={status.startsWith('❌')} />
      <Btn onClick={save} className="w-full"><ShoppingBag className="w-3.5 h-3.5" />{t('admin_save_store')}</Btn>
    </div>
  );
}

// ─── User Countries (IP based) ─────────────────────────────────────────────
type CountryStat = { code: string; name: string; users: number; percent: number };

function flagOf(code: string) {
  if (!/^[A-Za-z]{2}$/.test(code)) return '🌐';
  return String.fromCodePoint(...code.toUpperCase().split('').map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function CountriesSection() {
  const [data, setData] = useState<{ countries: CountryStat[]; known: number; unknown: number; totalUsers: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    setLoading(true); setErr('');
    try { setData(await api('GET', '/admin/general?type=countries')); }
    catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (loading && !data) return <div className="text-muted-foreground text-sm">جاري التحليل…</div>;
  if (err) return <div className="text-destructive text-sm">{err}</div>;
  if (!data) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>تم التعرّف على {data.known} مستخدم من {data.totalUsers} • غير معروف: {data.unknown}</span>
        <Btn size="sm" variant="ghost" onClick={load} disabled={loading}>{loading ? '...' : 'تحديث'}</Btn>
      </div>
      {data.countries.length === 0 ? (
        <div className="text-xs text-muted-foreground">لا توجد بيانات بعد — سيتم تجميعها مع دخول المستخدمين.</div>
      ) : (
        <div className="space-y-2">
          {data.countries.map(c => (
            <div key={c.code} className="bg-secondary rounded-xl p-2.5 border border-violet-500/20">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-foreground font-bold">{flagOf(c.code)} {c.name}</span>
                <span className="text-primary font-black">{c.percent}% <span className="text-muted-foreground font-normal">({c.users})</span></span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${Math.max(2, c.percent)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Reset all coins ───────────────────────────────────────────────────────
function ResetCoinsSection() {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const reset = async () => {
    setLoading(true); setStatus('');
    try {
      const r = await api<{ reset: number }>('POST', '/admin/general?type=reset_coins', {});
      notifyDataChange('admin', 'balance');
      setStatus(`✅ تم تصفير النقاط لـ ${r.reset} مستخدم`);
      setConfirming(false);
    } catch (e: any) { setStatus(`❌ ${e.message}`); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        هيتم تصفير رصيد الـ MNX لكل مستخدمي البوت (يرجع 0). الإجراء ده لا يمكن التراجع عنه.
      </p>
      <StatusMsg msg={status} isError={status.startsWith('❌')} />
      {!confirming ? (
        <Btn variant="danger" className="w-full" onClick={() => setConfirming(true)}>
          <Coins className="w-3.5 h-3.5" />تصفير كل النقاط
        </Btn>
      ) : (
        <div className="flex gap-2">
          <Btn variant="danger" className="flex-1" onClick={reset} disabled={loading}>
            {loading ? 'جاري التصفير…' : 'تأكيد التصفير'}
          </Btn>
          <Btn variant="ghost" className="flex-1" onClick={() => setConfirming(false)}>إلغاء</Btn>
        </div>
      )}
    </div>
  );
}

// ─── Reset all gram balances ───────────────────────────────────────────────
function ResetGramSection() {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const reset = async () => {
    setLoading(true); setStatus('');
    try {
      const r = await api<{ reset: number }>('POST', '/admin/general?type=reset_gram', {});
      notifyDataChange('admin', 'balance');
      setStatus(`✅ تم تصفير رصيد الجرام لـ ${r.reset} مستخدم`);
      setConfirming(false);
    } catch (e: any) { setStatus(`❌ ${e.message}`); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        هيتم تصفير رصيد الـ gram لكل مستخدمي البوت (يرجع 0). الإجراء ده لا يمكن التراجع عنه.
      </p>
      <StatusMsg msg={status} isError={status.startsWith('❌')} />
      {!confirming ? (
        <Btn variant="danger" className="w-full" onClick={() => setConfirming(true)}>
          <Wallet className="w-3.5 h-3.5" />تصفير كل الأرصدة
        </Btn>
      ) : (
        <div className="flex gap-2">
          <Btn variant="danger" className="flex-1" onClick={reset} disabled={loading}>
            {loading ? 'جاري التصفير…' : 'تأكيد التصفير'}
          </Btn>
          <Btn variant="ghost" className="flex-1" onClick={() => setConfirming(false)}>إلغاء</Btn>
        </div>
      )}
    </div>
  );
}

// ─── Security & wallet key rotation ────────────────────────────────────────
type SecurityEvent = {
  id: string; at: string; type: string; severity: 'low'|'medium'|'high'|'critical';
  telegramId?: number|null; username?: string|null; ip?: string|null; detail?: string|null; path?: string|null;
};
type SecurityData = {
  score: number; label: string; events: SecurityEvent[];
  wallet: { configured: boolean; custom: boolean; address: string|null };
};

const SEV_COLOR: Record<string, string> = {
  low: 'text-muted-foreground',
  medium: 'text-primary',
  high: 'text-orange-400',
  critical: 'text-destructive',
};

function SecuritySection() {
  const [data, setData]       = useState<SecurityData|null>(null);
  const [err, setErr]         = useState('');
  const [status, setStatus]   = useState('');
  const [busy, setBusy]       = useState(false);
  const [secret, setSecret]   = useState('');
  const [showKey, setShowKey] = useState(false);

  const load = useCallback(() => {
    api<SecurityData>('GET', '/admin/security')
      .then(d => { setData(d); setErr(''); })
      .catch(e => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  const clearLog = async () => {
    setBusy(true);
    try { await api('DELETE', '/admin/security'); setStatus('تم مسح السجل'); load(); }
    catch (e) { setStatus((e as Error).message); }
    finally { setBusy(false); }
  };

  const rotate = async () => {
    if (secret.trim().length < 16) { setStatus('اكتب عبارة الاسترداد (24 كلمة) أو المفتاح السري'); return; }
    setBusy(true);
    try {
      const r = await api<{ address: string }>('POST', '/admin/security?action=rotate-wallet', { secret });
      setSecret('');
      setStatus(`تم تغيير مفاتيح المحفظة ✅ العنوان الجديد: ${r.address}`);
      load();
    } catch (e) { setStatus((e as Error).message); }
    finally { setBusy(false); }
  };

  const resetKeys = async () => {
    setBusy(true);
    try { await api('POST', '/admin/security?action=reset-wallet', {}); setStatus('تم الرجوع للمفاتيح الأصلية'); load(); }
    catch (e) { setStatus((e as Error).message); }
    finally { setBusy(false); }
  };

  if (err) return <div className="text-destructive text-sm">{err}</div>;
  if (!data) return <div className="text-muted-foreground text-sm">جاري التحميل…</div>;

  const barColor = data.score >= 55 ? 'bg-destructive' : data.score >= 30 ? 'bg-orange-400' : 'bg-success';

  return (
    <div className="space-y-4">
      {/* Risk meter */}
      <div className="bg-secondary rounded-xl p-3 border border-violet-500/20">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">نسبة الخطر (آخر 24 ساعة)</span>
          <span className="text-sm font-black text-foreground">{data.score}% · {data.label}</span>
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden">
          <div className={`h-full ${barColor} transition-all`} style={{ width: `${data.score}%` }} />
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
          أي محاولة دخول للوحة الأدمن من حساب غير مصرح أو بجلسة مزوّرة تتسجّل هنا وتوصلك رسالة فورية على تيليجرام بالبيانات (الآي دي، اليوزر، الـIP، الوقت).
        </p>
      </div>

      <div className="flex gap-2">
        <Btn size="sm" variant="ghost" onClick={load} disabled={busy}>تحديث</Btn>
        <Btn size="sm" variant="danger" onClick={clearLog} disabled={busy}>مسح السجل</Btn>
      </div>

      {/* Events */}
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {data.events.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-3">لا توجد محاولات مسجّلة ✅</div>
        )}
        {data.events.map(e => (
          <div key={e.id} className="bg-secondary rounded-xl p-3 border border-violet-500/20 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className={`font-bold ${SEV_COLOR[e.severity] ?? 'text-foreground'}`}>{e.type}</span>
              <span className="text-[10px] text-muted-foreground">{new Date(e.at).toLocaleString('ar-EG')}</span>
            </div>
            {e.detail && <div className="text-muted-foreground">{e.detail}</div>}
            <div className="text-[10px] text-muted-foreground flex flex-wrap gap-x-3">
              {e.telegramId ? <span>ID: {e.telegramId}</span> : null}
              {e.username ? <span>@{e.username}</span> : null}
              {e.ip ? <span>IP: {e.ip}</span> : null}
              {e.path ? <span>{e.path}</span> : null}
            </div>
          </div>
        ))}
      </div>

      {/* Wallet keys */}
      <div className="bg-secondary rounded-xl p-3 border border-violet-500/20 space-y-2">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-primary" />
          <span className="text-sm font-black text-foreground">مفاتيح محفظة الدفع</span>
        </div>
        <div className="text-[11px] text-muted-foreground break-all">
          الحالة: {data.wallet.configured ? 'مفعّلة' : 'غير مضبوطة'} · المصدر: {data.wallet.custom ? 'مفتاح مُغيَّر من اللوحة' : 'المفتاح الأصلي'}
          {data.wallet.address ? <><br />العنوان: {data.wallet.address}</> : null}
        </div>
        <div className="relative">
          <Input
            type={showKey ? 'text' : 'password'}
            value={secret}
            onChange={e => setSecret(e.target.value)}
            placeholder="عبارة الاسترداد (24 كلمة) أو المفتاح السري الجديد"
          />
          <button
            type="button"
            onClick={() => setShowKey(v => !v)}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <div className="flex gap-2">
          <Btn size="sm" onClick={rotate} disabled={busy}>تغيير المفاتيح</Btn>
          <Btn size="sm" variant="ghost" onClick={resetKeys} disabled={busy}>رجوع للمفاتيح الأصلية</Btn>
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          المفتاح يتخزن مشفّر بالكامل (AES-256) ومش بيظهر لأي حد، والسحوبات بتتحوّل فورًا للمحفظة الجديدة.
        </p>
      </div>

      <StatusMsg msg={status} isError={status.includes('تعذر') || status.includes('غير')} />
    </div>
  );
}
