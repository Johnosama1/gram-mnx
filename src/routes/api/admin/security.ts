import { createFileRoute } from '@tanstack/react-router';
import { json, requireAdmin } from '@/lib/admin.server';
import {
  clearPayoutSecretOverride,
  clearSecurityEvents,
  logSecurityEvent,
  readSecurityEvents,
  riskLabel,
  riskScore,
  setPayoutSecretOverride,
  clientIp,
} from '@/lib/security.server';

async function handle({ request }: { request: Request }) {
  const guard = await requireAdmin(request);
  if (guard instanceof Response) return guard;

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (request.method === 'GET') {
    const events = await readSecurityEvents();
    const score = riskScore(events);
    const { getPayoutWalletAddress, hasPayoutWallet } = await import('@/lib/ton.server');
    const { getSetting } = await import('@/lib/admin.server');
    const custom = Boolean(await getSetting('payout_secret_enc'));
    return json({
      score,
      label: riskLabel(score),
      events: events.slice(0, 50),
      wallet: {
        configured: await hasPayoutWallet(),
        custom,
        address: await getPayoutWalletAddress().catch(() => null),
      },
    });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, any>;

  if (request.method === 'DELETE' || action === 'clear') {
    await clearSecurityEvents();
    return json({ ok: true });
  }

  if (action === 'rotate-wallet') {
    const secret = String(body.secret ?? '').trim();
    if (secret.length < 16) return json({ error: 'المفتاح/العبارة غير صالحة' }, 400);
    await setPayoutSecretOverride(secret);
    const { getPayoutWalletAddress } = await import('@/lib/ton.server');
    const address = await getPayoutWalletAddress().catch(() => null);
    if (!address) {
      await clearPayoutSecretOverride();
      return json({ error: 'تعذر اشتقاق محفظة من هذا المفتاح — تم التراجع' }, 400);
    }
    await logSecurityEvent({
      type: 'تغيير مفاتيح محفظة الدفع',
      severity: 'high',
      telegramId: guard.user.id,
      username: guard.user.username ?? null,
      ip: clientIp(request),
      detail: `المحفظة الجديدة: ${address}`,
      path: '/api/admin/security',
    });
    return json({ ok: true, address });
  }

  if (action === 'reset-wallet') {
    await clearPayoutSecretOverride();
    const { getPayoutWalletAddress } = await import('@/lib/ton.server');
    await logSecurityEvent({
      type: 'استرجاع مفاتيح المحفظة الأصلية',
      severity: 'medium',
      telegramId: guard.user.id,
      username: guard.user.username ?? null,
      ip: clientIp(request),
      path: '/api/admin/security',
    });
    return json({ ok: true, address: await getPayoutWalletAddress().catch(() => null) });
  }

  return json({ error: 'إجراء غير معروف' }, 400);
}

export const Route = createFileRoute('/api/admin/security')({
  server: { handlers: { GET: handle, POST: handle, DELETE: handle } },
});
