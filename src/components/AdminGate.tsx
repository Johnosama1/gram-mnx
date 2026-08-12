import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { ApiError, telegramApiFetch } from '@/lib/telegramApi';

/**
 * Asks the SERVER whether this browser holds a valid admin session cookie.
 * There is no client-side flag any more: sessionStorage cannot unlock anything.
 */
export async function checkAdminSession(): Promise<boolean> {
  try {
    const res = await telegramApiFetch('/admin/gate', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    return data?.ok === true;
  } catch {
    return false;
  }
}

export default function AdminGate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;
    checkAdminSession().then((ok) => {
      if (!alive) return;
      setChecking(false);
      if (ok) onUnlock();
    });
    return () => {
      alive = false;
    };
  }, [onUnlock]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await telegramApiFetch('/admin/gate', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError(
          res.status === 401
            ? 'كلمة السر غير صحيحة'
            : res.status === 403
              ? 'ليس لديك صلاحية الدخول'
              : 'تعذر التحقق، حاول مرة أخرى',
        );
        return;
      }
      onUnlock();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setError('كلمة السر غير صحيحة');
      } else if (error instanceof ApiError && error.status === 403) {
        setError('ليس لديك صلاحية الدخول');
      } else {
        setError('تعذر الاتصال بالخادم');
      }
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        …
      </div>
    );
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
