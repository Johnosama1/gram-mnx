
import {
  DEFAULT_MINERS,
  getAdminDb,
  getBotToken,
  getSetting,
  invalidateAdminIdsCache,
  json,
  mapChannel,
  mapTask,
  requireAdmin,
  setSetting,
} from '@/lib/admin.server';

type Ctx = { request: Request; forcedType?: string };

export async function handleAdminGeneral(request: Request, forcedType?: string): Promise<Response> {
  const guard = await requireAdmin(request);
  if (guard instanceof Response) return guard;

  const url = new URL(request.url);
  const type = forcedType ?? url.searchParams.get('type');
  const action = url.searchParams.get('action');
  const idParam = url.searchParams.get('id');
  const id = idParam ? Number(idParam) : undefined;
  const method = request.method;
  const body =
    method === 'GET' || method === 'DELETE'
      ? {}
      : ((await request.json().catch(() => ({}))) as Record<string, any>);

  const db = (await getAdminDb()) as any;

  try {
    if (type === 'stats') {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      // Three independent counts on the same table — one round trip each,
      // fired together instead of one after another.
      const [total, blocked, active] = await Promise.all([
        db.from('gm_users').select('id', { count: 'exact', head: true }),
        db
          .from('gm_users')
          .select('id', { count: 'exact', head: true })
          .or('blocked_bot.eq.true,is_banned.eq.true'),
        db.from('gm_users').select('id', { count: 'exact', head: true }).gte('last_active_at', fiveMinAgo),
      ]);
      if (total.error) return json({ error: total.error.message }, 500);
      return json({
        totalUsers: total.count ?? 0,
        blockedUsers: blocked.count ?? 0,
        activeUsers: active.count ?? 0,
      });
    }


    // One-off diagnostic: proves — from inside the app's own live connection,
    // not a guess — which Supabase project it's actually talking to at
    // runtime, and whether that connection can see gm_gift_ad_views right
    // now. Safe to leave in; it never mutates anything.
    if (type === 'gift-ads-diag') {
      const supabaseUrl = process.env['SUPABASE_URL'] ?? null;
      const projectRef = supabaseUrl ? new URL(supabaseUrl).hostname.split('.')[0] : null;
      const probe = await db.from('gm_gift_ad_views').select('id', { count: 'exact', head: true });
      return json({
        runtimeSupabaseUrl: supabaseUrl,
        runtimeProjectRef: projectRef,
        expectedProjectRef: 'hgldaqpbsusfinqlywgc',
        projectMatches: projectRef === 'hgldaqpbsusfinqlywgc',
        tableVisibleToApp: !probe.error,
        rowCount: probe.error ? null : (probe.count ?? 0),
        rawError: probe.error ? { message: probe.error.message, code: (probe.error as any).code ?? null } : null,
      });
    }

    if (type === 'ads-stats') {
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const { data, error } = await db
        .from('gm_ad_views')
        .select('coins')
        .gte('created_at', dayStart.toISOString());
      if (error) return json({ error: error.message }, 500);
      const rows = (data ?? []) as { coins: number | null }[];
      const coinsPaidToday = rows.reduce((sum: number, r: { coins: number | null }) => sum + Number(r.coins ?? 0), 0);
      return json({ watchedToday: rows.length, coinsPaidToday });
    }

    if (type === 'blocked-users') {
      const { data, error } = await db
        .from('gm_users')
        .select('telegram_id,username,first_name,last_name,blocked_bot,is_banned,last_active_at')
        .or('blocked_bot.eq.true,is_banned.eq.true')
        .order('last_active_at', { ascending: false })
        .limit(500);
      if (error) return json({ error: error.message }, 500);
      return json(
        (data ?? []).map((u: any) => ({
          telegramId: Number(u.telegram_id),
          username: u.username ?? null,
          firstName: u.first_name ?? null,
          lastName: u.last_name ?? null,
          reason: u.is_banned ? 'banned' : 'blocked_bot',
          lastActiveAt: u.last_active_at ?? null,
        })),
      );
    }

    if (type === 'settings') {
      if (method === 'GET') {
        const { data, error } = await db.from('gm_settings').select('key,value');
        if (error) return json({ error: error.message }, 500);
        const out: Record<string, string> = {};
        for (const r of data ?? []) out[r.key] = r.value;
        return json(out);
      }
      const { key, value } = body;
      if (!key || value === undefined) return json({ error: 'key and value required' }, 400);
      if (String(key) === 'mining_daily_pct') {
        // Settles pending earnings at the old rate, then applies the new percentage to everyone.
        const pct = Math.max(0, Number(value));
        if (!Number.isFinite(pct)) return json({ error: 'invalid percentage' }, 400);
        const { error } = await db.rpc('gm_set_mining_daily_pct', { _pct: pct });
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, key: 'mining_daily_pct', value: String(pct) });
      }
      await setSetting(String(key), String(value));
      // Read the value back so the UI always reflects what is actually stored.
      const saved = await getSetting(String(key));
      if (saved !== String(value)) {
        return json({ error: `Setting "${key}" did not persist` }, 500);
      }
      return json({ ok: true, key: String(key), value: saved });

    }


    if (type === 'broadcast') {
      const token = getBotToken();
      if (!token) return json({ error: 'BOT_TOKEN not set' }, 503);
      const message = String(body.message ?? '').trim();
      if (!message) return json({ error: 'message is required' }, 400);
      const { data: users } = await db
        .from('gm_users')
        .select('telegram_id')
        .eq('blocked_bot', false);
      let sent = 0;
      let failed = 0;
      for (const u of users ?? []) {
        try {
          const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: u.telegram_id, text: message, parse_mode: 'HTML' }),
          });
          if (r.ok) sent++;
          else {
            failed++;
            const d = (await r.json().catch(() => ({}))) as { error_code?: number };
            if (d.error_code === 403)
              await db
                .from('gm_users')
                .update({ blocked_bot: true })
                .eq('telegram_id', u.telegram_id);
          }
        } catch {
          failed++;
        }
      }
      return json({ ok: true, sent, failed, total: (users ?? []).length });
    }

    if (type === 'tasks') {
      // Upload a task/channel picture (shown as a round avatar in the app).
      if (method === 'POST' && action === 'upload') {
        const raw = String(body.data ?? '');
        const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
        if (!base64) return json({ error: 'الملف مطلوب' }, 400);
        const original = String(body.filename ?? 'file.png');
        const ext = (original.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
        const name = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const { error: upErr } = await supabaseAdmin.storage
          .from('gift-media')
          .upload(name, bytes, {
            contentType: ext === 'json' ? 'application/json' : `image/${ext === 'jpg' ? 'jpeg' : ext}`,
            upsert: false,
          });
        if (upErr) return json({ error: upErr.message }, 500);
        return json({ url: `/api/gift/media/${name}` });
      }
      if (method === 'GET') {
        const { data } = await db.from('gm_tasks').select('*').order('created_at');
        const rows = data ?? [];
        const limited = rows.filter((t: any) => Number(t.slot_limit ?? 0) > 0);
        const counts = new Map<number, number>();
        if (limited.length) {
          const { data: comps } = await db
            .from('gm_task_completions')
            .select('task_id')
            .in('task_id', limited.map((t: any) => t.id));
          for (const c of comps ?? []) {
            const key = Number(c.task_id);
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        }
        return json(
          rows.map((t: any) => ({ ...mapTask(t), slotsFilled: counts.get(Number(t.id)) ?? 0 })),
        );
      }
      if (method === 'POST') {
        if (!body.title) return json({ error: 'title required' }, 400);
        const { data, error } = await db
          .from('gm_tasks')
          .insert({
            title: body.title,
            description: body.description ?? '',
            reward: body.reward ?? 0,
            is_daily: body.isDaily ?? false,
            category: body.category ?? 'general',
            bot_username: body.botUsername
              ? String(body.botUsername).replace(/^@/, '')
              : null,
            twitter_url: body.twitterUrl ? String(body.twitterUrl) : null,
            join_link: body.joinLink ? String(body.joinLink) : null,
            channel_username: body.channelUsername
              ? String(body.channelUsername).replace(/^@/, '')
              : null,
            icon_url: body.iconUrl ? String(body.iconUrl).slice(0, 500) : null,
            slot_limit:
              body.slotLimit === undefined || body.slotLimit === null || body.slotLimit === ''
                ? null
                : Math.max(1, Number(body.slotLimit)) || null,
          })
          .select('*')
          .single();
        if (error) return json({ error: error.message }, 400);
        return json(mapTask(data));
      }
      if (method === 'PATCH' && id) {
        const updates: Record<string, unknown> = {};
        if (body.isHidden !== undefined) updates.is_hidden = body.isHidden;
        if (body.isDaily !== undefined) updates.is_daily = body.isDaily;
        if (body.title !== undefined) updates.title = body.title;
        if (body.description !== undefined) updates.description = body.description;
        if (body.reward !== undefined) updates.reward = body.reward;
        if (body.category !== undefined) updates.category = body.category;
        if (body.botUsername !== undefined)
          updates.bot_username = body.botUsername
            ? String(body.botUsername).replace(/^@/, '')
            : null;
        if (body.twitterUrl !== undefined) updates.twitter_url = body.twitterUrl || null;
        if (body.joinLink !== undefined) updates.join_link = body.joinLink || null;
        if (body.channelUsername !== undefined)
          updates.channel_username = body.channelUsername
            ? String(body.channelUsername).replace(/^@/, '')
            : null;
        if (body.iconUrl !== undefined)
          updates.icon_url = body.iconUrl ? String(body.iconUrl).slice(0, 500) : null;
        if (body.slotLimit !== undefined)
          updates.slot_limit =
            body.slotLimit === null || body.slotLimit === ''
              ? null
              : Math.max(1, Number(body.slotLimit)) || null;
        const { data } = await db
          .from('gm_tasks')
          .update(updates)
          .eq('id', id)
          .select('*')
          .single();
        return json(data ? mapTask(data) : { ok: true });
      }
      if (method === 'DELETE' && id) {
        await db.from('gm_tasks').delete().eq('id', id);
        return json({ ok: true });
      }
      return json({ error: 'Invalid method or missing id' }, 400);
    }

    if (type === 'channels') {
      if (method === 'GET') {
        const { data } = await db.from('gm_channels').select('*').order('created_at');
        return json((data ?? []).map(mapChannel));
      }
      if (method === 'POST') {
        if (!body.channelUsername) return json({ error: 'channelUsername required' }, 400);
        const { data, error } = await db
          .from('gm_channels')
          .insert({
            channel_username: String(body.channelUsername).replace(/^@/, ''),
            channel_name: body.channelName ?? '',
          })
          .select('*')
          .single();
        if (error) return json({ error: error.message }, 400);
        return json(mapChannel(data));
      }
      if (method === 'DELETE' && id) {
        await db.from('gm_channels').delete().eq('id', id);
        return json({ ok: true });
      }
      return json({ error: 'Invalid method or missing id' }, 400);
    }

    if (type === 'miners') {
      if (method === 'GET') {
        const value = await getSetting('miners_config');
        return json(value ? JSON.parse(value) : DEFAULT_MINERS);
      }
      if (method === 'POST') {
        if (!Array.isArray(body.miners)) return json({ error: 'miners array required' }, 400);
        await setSetting('miners_config', JSON.stringify(body.miners));
        return json({ ok: true });
      }
      return json({ error: 'Method not allowed' }, 405);
    }

    if (type === 'withdrawals') {
      if (method === 'GET') {
        const { data } = await db
          .from('gm_withdrawals')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);
        const rows = data ?? [];
        const ids = [...new Set(rows.map((r: any) => r.telegram_id))];
        let names: Record<string, any> = {};
        if (ids.length) {
          const { data: users } = await db
            .from('gm_users')
            .select('telegram_id,first_name,username')
            .in('telegram_id', ids);
          for (const u of users ?? []) names[String(u.telegram_id)] = u;
        }
        return json(
          rows.map((r: any) => ({
            ...r,
            telegram_id: Number(r.telegram_id),
            first_name: names[String(r.telegram_id)]?.first_name ?? null,
            username: names[String(r.telegram_id)]?.username ?? null,
          })),
        );
      }
      if (method === 'POST' && (action === 'approve' || action === 'reject') && id) {
        const { reviewWithdrawal } = await import('@/lib/withdraw-review.server');
        const result = await reviewWithdrawal(
          Number(id),
          action,
          action === 'reject' ? String(body.reason ?? '') : undefined,
        );
        if (!result.ok) return json({ error: result.message }, 400);
        return json({ ok: true, message: result.message });
      }
      return json({ error: 'Invalid method or missing action/id' }, 400);
    }

    if (type === 'deposits') {
      if (method === 'GET') {
        const { data } = await db
          .from('gm_deposits')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);
        const rows = data ?? [];
        const ids = [...new Set(rows.map((r: any) => r.telegram_id))];
        let names: Record<string, any> = {};
        if (ids.length) {
          const { data: users } = await db
            .from('gm_users')
            .select('telegram_id,first_name,username')
            .in('telegram_id', ids);
          for (const u of users ?? []) names[String(u.telegram_id)] = u;
        }
        return json(
          rows.map((r: any) => ({
            ...r,
            telegram_id: Number(r.telegram_id),
            first_name: names[String(r.telegram_id)]?.first_name ?? null,
            username: names[String(r.telegram_id)]?.username ?? null,
          })),
        );
      }
      if (method === 'POST' && action === 'credit' && id) {
        const { manuallyCreditDeposit } = await import('@/lib/deposit-scan.server');
        const result = await manuallyCreditDeposit(Number(id));
        if (!result.ok) return json({ error: result.message }, 400);
        return json({ ok: true, message: result.message });
      }
      return json({ error: 'Invalid method or missing action/id' }, 400);
    }

    if (type === 'admins') {
      const raw = await getSetting('sub_admins');
      const admins: any[] = raw ? JSON.parse(raw) : [];
      if (method === 'GET') return json(admins);
      if (method === 'POST') {
        if (!body.telegramId) return json({ error: 'telegramId required' }, 400);
        if (!admins.find((a) => a.telegramId === Number(body.telegramId))) {
          admins.push({
            telegramId: Number(body.telegramId),
            username: body.username ?? '',
            permissions: body.permissions ?? [],
          });
        }
        await setSetting('sub_admins', JSON.stringify(admins));
        invalidateAdminIdsCache();
        return json({ ok: true });
      }
      if (method === 'DELETE' && id) {
        await setSetting(
          'sub_admins',
          JSON.stringify(admins.filter((a) => a.telegramId !== id)),
        );
        invalidateAdminIdsCache();
        return json({ ok: true });
      }
      return json({ error: 'Invalid method or missing id' }, 400);
    }

    if (type === 'tournament') {
      if (method === 'GET') {
        const filterType = url.searchParams.get('tournamentType');
        let q = db
          .from('gm_tournaments')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);
        if (filterType) q = q.eq('tournament_type', filterType);
        const { data } = await q;
        return json(
          (data ?? []).map((r: any) => ({
            id: r.id,
            title: r.title,
            topN: r.top_n,
            prizes: JSON.parse(r.prizes ?? '[]'),
            startsAt: r.starts_at,
            endsAt: r.ends_at,
            status: r.status,
            settledAt: r.settled_at,
            tournamentType: r.tournament_type ?? 'gram',
          })),
        );
      }
      if (method === 'POST' && !action) {
        const title = String(body.title ?? '').trim();
        const durationHours = Number(body.durationHours ?? 0);
        if (!title) return json({ error: 'title required' }, 400);
        if (!durationHours || durationHours <= 0)
          return json({ error: 'durationHours must be > 0' }, 400);
        const now = new Date();
        const { data, error } = await db
          .from('gm_tournaments')
          .insert({
            title,
            top_n: Math.min(50, Math.max(1, Number(body.topN ?? 10))),
            prizes: JSON.stringify(Array.isArray(body.prizes) ? body.prizes : []),
            starts_at: now.toISOString(),
            ends_at: new Date(now.getTime() + durationHours * 3600 * 1000).toISOString(),
            status: 'active',
            tournament_type: body.tournamentType === 'coin' ? 'coin' : 'gram',
          })
          .select('id')
          .single();
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true, id: data.id });
      }
      if (method === 'POST' && action === 'settle' && id) {
        await db
          .from('gm_tournaments')
          .update({ status: 'settled', settled_at: new Date().toISOString() })
          .eq('id', id);
        return json({ ok: true });
      }
      if (method === 'DELETE' && id) {
        await db
          .from('gm_tournaments')
          .update({ status: 'cancelled' })
          .eq('id', id)
          .eq('status', 'active');
        return json({ ok: true });
      }
      return json({ error: 'Invalid tournament request' }, 400);
    }

    if (type === 'combo') {
      const today = new Date().toISOString().slice(0, 10);
      if (method === 'GET') {
        // Auto-rotates every 24h: 3 random items + weighted random reward.
        const { ensureDailyCombo, getComboRewardRange, getComboRewardWeights } = await import('@/lib/combo.server');
        const daily = await ensureDailyCombo();
        const range = await getComboRewardRange();
        const weights = await getComboRewardWeights();
        const correctIds = daily.correctIds;
        return json({
          date: today,
          correctIds,
          reward: daily.reward,
          rewardMin: range.min,
          rewardMax: range.max,
          rewardWeights: weights,
        });
      }
      if (method === 'POST') {
        // Per-value chances (%) can be saved on their own.
        if (body.rewardWeights !== undefined) {
          const { setComboRewardWeights } = await import('@/lib/combo.server');
          const saved = await setComboRewardWeights(body.rewardWeights ?? {});
          if (body.correctIds === undefined) return json({ ok: true, rewardWeights: saved });
        }
        // Reward range can be saved on its own (without changing today's combo).
        if (body.rewardMin !== undefined || body.rewardMax !== undefined) {
          const min = Math.max(0, Math.floor(Number(body.rewardMin ?? 1)) || 0);
          const max = Math.max(min, Math.floor(Number(body.rewardMax ?? min)) || min);
          await setSetting('combo_reward_min', String(min));
          await setSetting('combo_reward_max', String(max));
          if (body.correctIds === undefined) return json({ ok: true, rewardMin: min, rewardMax: max });
        }
        const correctIds = body.correctIds;
        if (!Array.isArray(correctIds) || correctIds.length === 0)
          return json({ error: 'correctIds required' }, 400);
        await setSetting('combo_date', today);
        await setSetting('combo_answer', JSON.stringify(correctIds));
        if (body.reward !== undefined) await setSetting('combo_reward', String(body.reward));
        return json({ ok: true });
      }
      return json({ error: 'Method not allowed' }, 405);
    }

    // ── Gifts ───────────────────────────────────────────────────────────────
    if (type === 'gift') {
      const { getGiftConfig, parseGifts, normalizeEntryMode, settleExpiredGifts } = await import(
        '@/lib/gift.server'
      );
      if (method === 'GET') {
        const cfg = await getGiftConfig();
        const settledGifts = await settleExpiredGifts(cfg.gifts);
        const { data: entries } = await db
          .from('gm_gift_entries')
          .select('gift_id')
          .in('gift_id', settledGifts.map((g) => g.id).concat([0]));
        const counts = new Map<number, number>();
        for (const r of (entries ?? []) as any[])
          counts.set(Number(r.gift_id), (counts.get(Number(r.gift_id)) ?? 0) + 1);
        return json({
          ...cfg,
          gifts: settledGifts.map((g) => ({ ...g, participants: counts.get(g.id) ?? 0 })),
        });
      }

      // Upload a prize file (Lottie .json / .tgs sticker or image) to private storage.
      if (method === 'POST' && action === 'upload') {
        const raw = String(body.data ?? '');
        const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
        if (!base64) return json({ error: 'الملف مطلوب' }, 400);
        const original = String(body.filename ?? 'file');
        const ext = (original.split('.').pop() ?? 'json').toLowerCase().replace(/[^a-z0-9]/g, '');
        const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const { error: upErr } = await supabaseAdmin.storage
          .from('gift-media')
          .upload(name, bytes, {
            contentType: ext === 'json' ? 'application/json' : `image/${ext === 'jpg' ? 'jpeg' : ext}`,
            upsert: false,
          });
        if (upErr) return json({ error: upErr.message }, 500);
        return json({ url: `/api/gift/media/${name}` });
      }

      if (method === 'POST' && action === 'settings') {
        await setSetting('gift_enabled', body.enabled === true ? 'true' : 'false');
        if (typeof body.message === 'string')
          await setSetting('gift_message', body.message.slice(0, 300));
        return json({ ok: true });
      }

      if (method === 'POST') {
        const title = String(body.title ?? '').trim();
        if (!title) return json({ error: 'العنوان مطلوب' }, 400);
        const gifts = parseGifts(await getSetting('gifts'));
        gifts.unshift({
          id: Date.now(),
          title: title.slice(0, 120),
          description: String(body.description ?? '').slice(0, 500),
          reward: Math.max(0, Number(body.reward ?? 0) || 0),
          link: body.link ? String(body.link).slice(0, 300) : null,
          imageUrl: body.imageUrl ? String(body.imageUrl).slice(0, 500) : null,
          capacity: Math.max(0, Number(body.capacity ?? 0) || 0),
          endsAt: body.endsAt ? String(body.endsAt).slice(0, 40) : null,
          entryMode: normalizeEntryMode(body.entryMode),
          winnerCount: Math.max(1, Number(body.winnerCount ?? 1) || 1),
          winners: [],
          settledAt: null,
        });
        await setSetting('gifts', JSON.stringify(gifts.slice(0, 100)));
        return json({ ok: true });
      }

      if (method === 'DELETE' && id) {
        const gifts = parseGifts(await getSetting('gifts')).filter((g) => g.id !== id);
        await setSetting('gifts', JSON.stringify(gifts));
        await db.from('gm_gift_entries').delete().eq('gift_id', id);
        return json({ ok: true });
      }
      return json({ error: 'Invalid gift request' }, 400);
    }


    // ── Promo codes ─────────────────────────────────────────────────────────
    if (type === 'promo') {
      const { mapPromoCode, isPromoSectionEnabled } = await import('@/lib/promo.server');
      if (method === 'GET') {
        const { data, error } = await db
          .from('gm_promo_codes')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200);
        if (error) return json({ error: error.message }, 500);
        return json({
          enabled: await isPromoSectionEnabled(),
          codes: (data ?? []).map(mapPromoCode),
        });
      }
      if (method === 'POST' && action === 'visibility') {
        await setSetting('promo_section_enabled', body.enabled === false ? 'false' : 'true');
        return json({ ok: true, enabled: body.enabled !== false });
      }
      if (method === 'POST' && action === 'toggle' && id) {
        const { data: row } = await db
          .from('gm_promo_codes')
          .select('is_active')
          .eq('id', id)
          .maybeSingle();
        if (!row) return json({ error: 'not found' }, 404);
        await db.from('gm_promo_codes').update({ is_active: !row.is_active }).eq('id', id);
        return json({ ok: true, isActive: !row.is_active });
      }
      if (method === 'POST') {
        const code = String(body.code ?? '').trim().toUpperCase();
        if (!/^[A-Z0-9_-]{3,32}$/.test(code))
          return json({ error: 'كود غير صالح (3-32 حرف/رقم)' }, 400);
        const rewardCoins = Math.max(0, Number(body.rewardCoins ?? 0) || 0);
        const maxUses = Math.max(0, Math.floor(Number(body.maxUses ?? 0) || 0));
        const { error } = await db
          .from('gm_promo_codes')
          .insert({ code, reward_coins: rewardCoins, max_uses: maxUses, is_active: true });
        if (error)
          return json(
            { error: error.message.includes('duplicate') ? 'الكود موجود بالفعل' : error.message },
            400,
          );
        return json({ ok: true });
      }
      if (method === 'DELETE' && id) {
        const { error } = await db.from('gm_promo_codes').delete().eq('id', id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }
      return json({ error: 'Invalid promo request' }, 400);
    }



    // ── User country distribution (from stored IPs) ─────────────────────────
    if (type === 'countries') {
      const { getCountryStats } = await import('@/lib/geo.server');
      return json(await getCountryStats());
    }

    // ── Reset every user's coin balance to zero ─────────────────────────────
    if (type === 'reset_coins') {
      if (method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      const { count } = await db
        .from('gm_users')
        .select('id', { count: 'exact', head: true })
        .gt('coins', 0);
      const { error } = await db.from('gm_users').update({ coins: 0 }).gt('coins', -1);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, reset: count ?? 0 });
    }

    // ── Reset every user's gram balance to zero ─────────────────────────────
    if (type === 'reset_gram') {
      if (method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      const { count } = await db
        .from('gm_users')
        .select('id', { count: 'exact', head: true })
        .gt('balance', 0);
      const { error } = await db.from('gm_users').update({ balance: 0 }).gt('balance', -1);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, reset: count ?? 0 });
    }

    return json({ error: `Unknown type: ${type ?? '(none)'}` }, 400);

  } catch (err) {
    console.error('[admin/general]', type, action, err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message || 'Internal server error' }, 500);
  }
}

