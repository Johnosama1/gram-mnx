import { json, getSetting } from '@/lib/admin.server';

export type GiftItem = {
  id: number;
  title: string;
  description: string;
  reward: number;
  link: string | null;
};

export type GiftConfig = {
  enabled: boolean;
  message: string;
  gifts: GiftItem[];
};

const DEFAULT_MESSAGE = 'قريباً — الهدايا لسه مش متاحة';

export function parseGifts(raw: string | null): GiftItem[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .map((g) => {
        const item = g as Record<string, unknown>;
        return {
          id: Number(item.id ?? 0),
          title: String(item.title ?? '').slice(0, 120),
          description: String(item.description ?? '').slice(0, 500),
          reward: Number(item.reward ?? 0) || 0,
          link: item.link ? String(item.link).slice(0, 300) : null,
        };
      })
      .filter((g) => g.id > 0 && g.title);
  } catch {
    return [];
  }
}

export async function getGiftConfig(): Promise<GiftConfig> {
  const [enabled, message, gifts] = await Promise.all([
    getSetting('gift_enabled'),
    getSetting('gift_message'),
    getSetting('gifts'),
  ]);
  return {
    enabled: enabled === 'true',
    message: message ?? DEFAULT_MESSAGE,
    gifts: parseGifts(gifts),
  };
}

/** Public gift status endpoint: GET → { enabled, message, gifts } */
export async function handleGiftApi(_request: Request): Promise<Response> {
  const cfg = await getGiftConfig();
  return json(cfg.enabled ? cfg : { enabled: false, message: cfg.message, gifts: [] });
}
