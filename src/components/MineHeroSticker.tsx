import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';

const STICKER_URL = '/stickers/mine-hero.json';

// Module-level caches so the sticker never re-fetches/flashes across remounts.
let LottieCache: ComponentType<any> | null = null;
let lottiePromise: Promise<ComponentType<any> | null> | null = null;
let dataCache: unknown = null;
let dataPromise: Promise<unknown> | null = null;

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
        console.error('[MineHeroSticker] lottie load failed', e);
        return null;
      });
  }
  return lottiePromise;
}

function loadData() {
  if (dataCache) return Promise.resolve(dataCache);
  if (!dataPromise) {
    dataPromise = fetch(STICKER_URL)
      .then((r) => r.json())
      .then((j) => {
        dataCache = j;
        return j;
      })
      .catch((e) => {
        console.error('[MineHeroSticker] sticker fetch failed', e);
        dataPromise = null;
        return null;
      });
  }
  return dataPromise;
}

/**
 * Mine-screen hero sticker: plays on loop while mining is active, and
 * freezes on its first frame (no coins / mining stopped) otherwise.
 */
export default function MineHeroSticker({ active }: { active: boolean }) {
  const [data, setData] = useState<unknown>(() => dataCache);
  const [Lottie, setLottie] = useState<ComponentType<any> | null>(() => LottieCache);
  const lottieRef = useRef<any>(null);
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
    if (dataCache) {
      setData(dataCache);
      return;
    }
    loadData().then((j) => mounted.current && j && setData(j));
  }, []);

  useEffect(() => {
    const inst = lottieRef.current;
    if (!inst) return;
    if (active) inst.play();
    else inst.goToAndStop(0, true);
  }, [active, data, Lottie]);

  if (!data || !Lottie) {
    return <div className="w-full h-full" aria-hidden />;
  }

  return (
    <Lottie
      lottieRef={lottieRef}
      animationData={data}
      loop={active}
      autoplay={active}
      style={{ width: '100%', height: '100%' }}
      className="w-full h-full"
      aria-label="GRAM MNX mining sticker"
    />
  );
}
