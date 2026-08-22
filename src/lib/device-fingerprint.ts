/**
 * A persisted per-device identifier used only as one signal (alongside IP)
 * for the admin-toggleable multi-account protection feature
 * (src/lib/multi-account.server.ts). Generated once and stored in
 * localStorage; an environment signature (userAgent/screen/timezone/
 * language) is folded in as a fallback so the id isn't purely random if
 * storage is ever cleared and regenerated.
 */
const STORAGE_KEY = 'gm_device_id';

function simpleHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function environmentSignature(): string {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : ({} as Navigator);
    const scr = typeof screen !== 'undefined' ? screen : ({} as Screen);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    return [nav.userAgent, nav.language, scr.width, scr.height, scr.colorDepth, tz].join('|');
  } catch {
    return '';
  }
}

let cached: string | null = null;

/** Stable id for this device/browser profile — same value on every call. */
export function getDeviceId(): string {
  if (cached) return cached;
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) {
      cached = existing;
      return existing;
    }
    const random =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const id = `${random}-${simpleHash(environmentSignature())}`;
    localStorage.setItem(STORAGE_KEY, id);
    cached = id;
    return id;
  } catch {
    // Storage blocked (private mode, etc.) — a signature-only id still
    // groups requests from this device within the current session, even
    // though it won't persist across app restarts.
    const id = `env-${simpleHash(environmentSignature())}`;
    cached = id;
    return id;
  }
}
