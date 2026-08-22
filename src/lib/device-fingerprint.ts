/**
 * Device fingerprint for the admin-toggleable multi-account protection
 * (src/lib/multi-account.server.ts). Combines several signals so it
 * survives more than a plain persisted id would on its own:
 *  - a random id persisted in localStorage — the strongest signal for one
 *    install, but wiped by clearing app storage;
 *  - a canvas rendering fingerprint — varies by GPU/driver/font stack,
 *    stable for the same device+browser, unaffected by storage clears;
 *  - an audio-processing fingerprint — varies by audio hardware/driver
 *    stack, same stability property as the canvas one.
 * All signals are SHA-256 hashed together into one id. None of this claims
 * to be bulletproof against a determined attacker — it only needs to be
 * meaningfully harder to reset than clearing localStorage, which is what a
 * plain persisted id alone would reduce to.
 */
const STORAGE_KEY = 'gm_device_id';

async function sha256(input: string): Promise<string> {
  try {
    const buf = new TextEncoder().encode(input);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    // SubtleCrypto unavailable (very old WebView) — a weak but still
    // deterministic hash beats failing the fingerprint outright.
    let h = 0;
    for (let i = 0; i < input.length; i++) h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
}

function persistedLocalId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    // Storage blocked (private mode, etc.) — won't persist across
    // restarts, but the canvas/audio signals below still do.
    return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** Canvas rendering fingerprint — the same device+browser draws pixel-identical output. */
async function canvasFingerprint(): Promise<string> {
  try {
    const c = document.createElement('canvas');
    c.width = 220;
    c.height = 40;
    const ctx = c.getContext('2d');
    if (!ctx) return 'NA';
    ctx.textBaseline = 'top';
    ctx.font = '16px Arial';
    ctx.fillText('Fingerprint Canvas Test', 4, 4);
    return await sha256(c.toDataURL());
  } catch {
    return 'NA';
  }
}

/** Audio-processing fingerprint — varies by audio hardware/driver stack. */
async function audioFingerprint(): Promise<string> {
  try {
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return 'NA';
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const analyser = ctx.createAnalyser();
    osc.type = 'triangle';
    osc.frequency.value = 111;
    osc.connect(analyser);
    osc.start();
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    osc.stop();
    await ctx.close();
    return await sha256(Array.from(data).join(','));
  } catch {
    return 'NA';
  }
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

let cached: Promise<string> | null = null;

/** Stable id for this device/browser profile — same value on every call within a session. */
export function getDeviceId(): Promise<string> {
  if (!cached) {
    cached = (async () => {
      const [canvas, audio] = await Promise.all([canvasFingerprint(), audioFingerprint()]);
      const raw = [persistedLocalId(), environmentSignature(), canvas, audio].join('|');
      return sha256(raw);
    })();
  }
  return cached;
}
