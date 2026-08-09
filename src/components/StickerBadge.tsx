import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import stickerAsset from '@/assets/cap-blue-electro.json.asset.json';

// Module-level caches so stickers never flash/disappear on re-render or remount.
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
        console.error('[StickerBadge] lottie load failed', e);
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
        console.error('[StickerBadge] sticker fetch failed', e);
        dataPromises.delete(url);
        return null;
      });
    dataPromises.set(url, p);
  }
  return p;
}

export default function StickerBadge({ size = 22, src }: { size?: number; src?: string }) {
  const url = src ?? stickerAsset.url;
  const [data, setData] = useState<unknown>(() => dataCache.get(url) ?? null);
  // A React component is a function. Passing it directly to useState makes
  // React execute it as a lazy initializer (without props), which crashes
  // lottie-react while it tries to read props.style. Always wrap the cached
  // component so React stores the function instead of invoking it.
  const [Lottie, setLottie] = useState<ComponentType<any> | null>(() => LottieCache);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!Lottie) loadLottie().then((c) => mounted.current && c && setLottie(() => c));
  }, [Lottie]);

  useEffect(() => {
    const cached = dataCache.get(url);
    if (cached) {
      setData(cached);
      return;
    }
    loadData(url).then((j) => mounted.current && j && setData(j));
  }, [url]);

  if (!data || !Lottie) return <span style={{ width: size, height: size }} className="inline-block" />;

  return (
    <Lottie
      animationData={data}
      loop
      autoplay
      style={{ width: size, height: size }}
      className="inline-block shrink-0 align-middle"
    />
  );
}
