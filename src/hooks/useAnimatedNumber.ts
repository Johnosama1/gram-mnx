import { useEffect, useRef, useState } from 'react';

/**
 * Eases a numeric value toward its target so the balance ticks up coin by coin
 * (100.00 → 100.01 → 100.02 …) instead of snapping to the final number.
 */
export function useAnimatedNumber(target: number, duration = 1400): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    // Big drops (e.g. a reset) shouldn't crawl — only animate increases.
    if (target < from) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = from + (target - from) * eased;
      setValue(next);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = target;
    };
  }, [target, duration]);

  return value;
}
