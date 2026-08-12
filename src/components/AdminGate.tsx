import { useState } from 'react';
import { Lock } from 'lucide-react';

const API = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL ?? '');
const KEY = 'gm_admin_gate_ok';

export function isAdminUnlocked(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export default function AdminGate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/admin/gate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-initdata': window.Telegram?.WebApp?.initData ?? '',
        },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError(res.status === 401 ? 'كلمة السر غير صحيحة' : 'تعذر التحقق، حاول مرة أخرى');
        return;
      }
      try { sessionStorage.setItem(KEY, '1'); } catch { /* ignore */ }
      onUnlock();
    } catch {
      setError('تعذر الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4"
      >
        <div className="flex items-center gap-2 text-primary">
          <Lock className="w-5 h-5" />
          <h1 className="text-lg font-bold text-foreground">لوحة الأدمن مقفلة</h1>
        </div>
        <p className="text-sm text-muted-foreground">أدخل كلمة السر للدخول إلى لوحة التحكم.</p>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="كلمة السر"
          className="w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground outline-none focus:ring-2 focus:ring-primary/40"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button
          type="submit"
          disabled={loading || !password}
          className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50"
        >
          {loading ? 'جاري التحقق…' : 'دخول'}
        </button>
      </form>
    </div>
  );
}
