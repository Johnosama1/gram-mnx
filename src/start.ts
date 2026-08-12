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

