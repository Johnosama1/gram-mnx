import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';

// Module-level caches, keyed by URL, so a sticker never re-fetches/flashes
// across remounts. Mirrors the same lazy-load pattern as StickerBadge and
// MineHeroSticker, just generalized to any /stickers/*.json path.
let LottieCache: ComponentType<any> | null = null;
let lottiePromise: Promise<ComponentType<any> | null> | null = null;
const dataCache = new Map<string, unknown>();
const dataPromises = new Map<string, Promise<unknown>>();

function loadLottie() {
  if (LottieCache) return Promise.resolve(LottieCache);
  if (!lottiePromise) {
    lottiePromise = import('lottie-react')
      .then((mod: any) => {
        const cands = [mod?.default?.default, mod?.default, mod?.Lottie];
        const Comp = cands.find(
          (c: any) => typeof c === 'function' || (c && typeof c === 'object' && '$$typeof' in c),
        );
        LottieCache = (Comp ?? null) as ComponentType<any> | null;
        return LottieCache;
      })
      .catch((e) => {
        console.error('[PublicSticker] lottie load failed', e);
        return null;
      });
  }
  return lottiePromise;
}

function loadData(url: string) {
  if (dataCache.has(url)) return Promise.resolve(dataCache.get(url));
  let p = dataPromises.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.json())
      .then((j) => {
        dataCache.set(url, j);
        return j;
      })
      .catch((e) => {
        console.error('[PublicSticker] fetch failed', e);
        dataPromises.delete(url);
        return null;
      });
    dataPromises.set(url, p);
  }
  return p;
}

/** A simple, always-looping Lottie sticker served from /public/stickers. */
export default function PublicSticker({ src, size = 96 }: { src: string; size?: number }) {
  const [data, setData] = useState<unknown>(() => dataCache.get(src) ?? null);
  const [Lottie, setLottie] = useState<ComponentType<any> | null>(() => LottieCache);

  useEffect(() => {
    let alive = true;
    if (!Lottie) loadLottie().then((c) => alive && c && setLottie(() => c));
    return () => {
      alive = false;
    };
  }, [Lottie]);

  useEffect(() => {
    let alive = true;
    const cached = dataCache.get(src);
    if (cached) {
      setData(cached);
      return;
    }
    loadData(src).then((j) => alive && j && setData(j));
    return () => {
      alive = false;
    };
  }, [src]);

  if (!data || !Lottie) return <div style={{ width: size, height: size }} aria-hidden />;

  return (
    <Lottie
      animationData={data}
      loop
      autoplay
      style={{ width: size, height: size }}
      className="inline-block shrink-0"
    />
  );
}
