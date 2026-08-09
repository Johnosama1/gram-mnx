import { memo, useEffect, useState } from 'react';
import minerIdleAsset from '@/assets/miner_idle_v3.png.asset.json';
import rockAsset from '@/assets/rock_v3.png.asset.json';
import cartAsset from '@/assets/cart_v2.png.asset.json';
import mineLoopAsset from '@/assets/mine-loop-v2.mp4.asset.json';



type Props = {
  /** Mining Active → the miner swings, sparks + coins appear. */
  active: boolean;
  /** Increment this to play the one-shot claim (cart → station → balance) run. */
  claimKey: number;
};

const Coin = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <span
    className={`absolute rounded-full ${className ?? ''}`}
    style={{
      width: 12,
      height: 12,
      background: 'radial-gradient(circle at 32% 28%, #fff3bf 0%, #ffcf4d 35%, #e0a11c 70%, #a86f0c 100%)',
      boxShadow: '0 0 8px rgba(255,200,70,0.75), inset 0 -2px 3px rgba(0,0,0,0.35)',
      ...style,
    }}
  />
);

function MineSceneBase({ active, claimKey }: Props) {
  const [claiming, setClaiming] = useState(false);

  // One-shot claim animation — never re-triggers for the same claim.
  useEffect(() => {
    if (!claimKey) return;
    setClaiming(true);
    const id = setTimeout(() => setClaiming(false), 3400);
    return () => clearTimeout(id);
  }, [claimKey]);

  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none select-none">
      {/* ground haze so the scene reads against the shared background */}
      <div
        className="absolute inset-x-0 bottom-0 h-1/2"
        style={{ background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.28))' }}
      />

      {active ? (
        /* ── Live mining loop ── */
        <video
          className="absolute inset-0 w-full h-full object-cover"
          src={mineLoopAsset.url}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
        />
      ) : (
        <>
          {/* ── Rock ── */}
          <div
            className="absolute"
            style={{ right: '12%', bottom: '12%', width: 'min(42%, 190px)' }}
          >
            <img src={rockAsset.url} alt="" className="w-full h-auto" loading="lazy" />
          </div>

          {/* ── Miner idle ── */}
          <div className="absolute" style={{ left: '8%', bottom: '11%', width: 'min(40%, 170px)' }}>
            <img
              src={minerIdleAsset.url}
              alt=""
              loading="lazy"
              className="w-full h-auto object-contain"
              style={{ animation: 'miner-idle-breathe 3.6s ease-in-out infinite', transformOrigin: '50% 100%' }}
            />
          </div>
        </>
      )}


      {/* ── Cart on its rail ── */}
      <div className="absolute" style={{ right: '3%', bottom: '2%', width: 'min(21%, 86px)' }}>
        <div
          style={{
            ['--cart-travel' as string]: '-190%',
            animation: claiming ? 'cart-run 3.2s cubic-bezier(0.45,0,0.35,1) 1' : 'none',
          }}
        >
          <img src={cartAsset.url} alt="" loading="lazy" className="w-full h-auto" />
        </div>
      </div>

      {/* ── Claim: coins travelling from the station up to the balance ── */}
      {claiming &&
        [0, 1, 2, 3, 4, 5].map((i) => (
          <Coin
            key={i}
            style={{
              left: `${16 + i * 3}%`,
              bottom: '16%',
              ['--fx' as string]: `${10 + i * 4}px`,
              ['--fy' as string]: '-46vh',
              animation: `coin-to-balance 1.1s ease-in ${1.5 + i * 0.12}s 1 both`,
            }}
          />
        ))}
    </div>
  );
}

export default memo(MineSceneBase);
