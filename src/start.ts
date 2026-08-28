import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Global server-side gate for every app API. Requests must carry Telegram
// initData whose HMAC verifies against the bot token; anything else (browser,
// curl, DevTools-crafted request, forged user id) is rejected BEFORE any
// handler, database read, or sensitive payload is produced.
const PUBLIC_API_PREFIXES = [
  "/api/public/", // webhooks + cron, each verifying its own caller
  "/api/telegram/avatar/", // proxied profile photos (no data exposure)
  "/api/gift/media/", // gift artwork used by the Mini App shell
];

// Cuts the per-request is_banned lookup that used to run on every single
// non-admin API call (every tab/page load fires several) — only the "not
// banned" result is cached, and only briefly, so a fresh ban still takes
// effect for that user within a few seconds rather than being trusted
// indefinitely.
const notBannedCache = new Map<number, number>();
const NOT_BANNED_TTL_MS = 10_000;

function isCachedNotBanned(id: number): boolean {
  const expiresAt = notBannedCache.get(id);
  return expiresAt != null && expiresAt > Date.now();
}

function cacheNotBanned(id: number): void {
  if (notBannedCache.size > 5_000) {
    const now = Date.now();
    for (const [cachedId, expiresAt] of notBannedCache) {
      if (expiresAt <= now) notBannedCache.delete(cachedId);
    }
  }
  notBannedCache.set(id, Date.now() + NOT_BANNED_TTL_MS);
}

const telegramApiGuard = createMiddleware().server(async ({ next, request }) => {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/")) return next();
  if (PUBLIC_API_PREFIXES.some((p) => path.startsWith(p))) return next();

  const { authenticateRequest } = await import("@/lib/telegram-auth.server");
  const user = await authenticateRequest(request);
  if (!user) {
    return new Response(
      JSON.stringify({
        error: "UNAUTHORIZED",
        message: "Please open this app from the official Telegram bot.",
      }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }
  // Banned accounts are cut off from every API before any handler runs —
  // except admins, who can never be locked out of the very panel they'd
  // need to fix a false ban from (their own or anyone else's). This is a
  // hard floor independent of whatever any ban path (including the
  // multi-account protection) writes to is_banned.
  try {
    if (path === "/api/telegram/auth") {
      // upsertUser must finish before the handler reads this user's row.
      const { upsertUser } = await import("@/lib/telegram-user.server");
      await upsertUser(user);

      // IP/device recording + the multi-account limit check run detached
      // (Cloudflare's waitUntil, not blocking this response) — awaiting
      // them here serialized ~10 extra DB round-trips onto the app's single
      // hottest endpoint (polled every 15-20s by every open session) ahead
      // of every response, which was enough added latency under load to
      // make the app look hung. The trade-off is a newly-over-the-limit
      // account is now caught on its *next* request rather than this exact
      // one — an acceptable cost next to blocking every user's auth call
      // on it. recordUserIp/recordUserDevice/enforceMultiAccountBan already
      // tolerate running after the response independently of each other.
      const { runDetached } = await import("@/lib/withdraw-sweep.server");
      runDetached(
        "multi-account check",
        async () => {
          const { getClientIp, recordUserIp } = await import("@/lib/withdraw.server");
          const { recordUserDevice } = await import("@/lib/multi-account.server");
          await recordUserIp(user.id, getClientIp(request));
          await recordUserDevice(user.id, request.headers.get("x-device-id"));
        },
        request,
      );
    }

    const { getAllAdminIds } = await import("@/lib/admin.server");
    const adminIds = await getAllAdminIds();
    if (adminIds.includes(user.id)) return next();

    if (!isCachedNotBanned(user.id)) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin
        .from("gm_users")
        .select("is_banned")
        .eq("telegram_id", user.id)
        .maybeSingle();
      if (data?.is_banned) {
        return new Response(
          JSON.stringify({
            error: "BANNED",
            message: "Your account has been banned by the administrators.",
          }),
          { status: 403, headers: { "content-type": "application/json" } },
        );
      }
      cacheNotBanned(user.id);
    }
  } catch {
    /* never lock everyone out on a transient database error */
  }
  return next();
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

// Baseline security headers on every response + no-store for API payloads so
// no proxy or shared cache can retain another user's data.
const securityHeaders = createMiddleware().server(async ({ next, request }) => {
  const result = await next();
  const res = (result as unknown as { response?: Response })?.response;
  const target = res instanceof Response ? res : (result as unknown as Response);
  if (target instanceof Response) {
    try {
      target.headers.set("X-Content-Type-Options", "nosniff");
      target.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      target.headers.set("X-Permitted-Cross-Domain-Policies", "none");
      target.headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()");
      const p = new URL(request.url).pathname;
      const isCacheableAsset =
        p.startsWith("/api/telegram/avatar/") || p.startsWith("/api/gift/media/");
      if (p.startsWith("/api/") && !isCacheableAsset) {
        target.headers.set("Cache-Control", "no-store");
      }
    } catch {
      /* immutable headers on some responses — never break the request */
    }
  }
  return result;
});

export const startInstance = createStart(() => ({
  // No createServerFn in this app (all backend calls go through /api routes),
  // so the Supabase auth attacher is intentionally omitted: it would ship the
  // whole supabase-js client into the browser bundle for nothing.
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, securityHeaders, csrfMiddleware, telegramApiGuard],
}));

