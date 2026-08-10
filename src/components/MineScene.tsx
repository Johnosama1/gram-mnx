import { memo, useEffect, useState } from 'react';
import minerIdleAsset from '@/assets/miner_idle_v3.png.asset.json';
import minerUpAsset from '@/assets/miner_up_v3.png.asset.json';
import minerHitAsset from '@/assets/miner_hit_v3.png.asset.json';
import rockAsset from '@/assets/rock_v3.png.asset.json';
import cartAsset from '@/assets/cart_v2.png.asset.json';

type Props = {
  /** Mining Active → the miner swings, sparks + coins appear. */
  active: boolean;
  /** Increment this to play the one-shot claim (cart → station → balance) run. */
  claimKey: number;
};

/** One full swing cycle (raise → strike). Everything else is timed off this. */
const SWING = 1.15;

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
      {/* depth: soft light from above + darker floor so the scene reads full-bleed */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 70% at 50% 18%, rgba(255,214,140,0.16) 0%, transparent 60%), linear-gradient(180deg, transparent 45%, rgba(0,0,0,0.35) 100%)',
        }}
      />

      {/* floating dust motes — cheap ambience */}
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <span
          key={`d${i}`}
          className="absolute rounded-full"
          style={{
            left: `${8 + i * 11}%`,
            bottom: `${10 + (i % 4) * 12}%`,
            width: 3 + (i % 3),
            height: 3 + (i % 3),
            background: 'rgba(255,232,180,0.5)',
            filter: 'blur(0.5px)',
            animation: `dust-float ${7 + (i % 4)}s ease-in-out ${i * 0.6}s infinite`,
          }}
        />
      ))}

      {/* ── Rock ── */}
      <div
        className="absolute"
        style={{
          right: '8%',
          bottom: '14%',
          width: 'min(48%, 260px)',
          animation: active ? `rock-shake ${SWING}s ease-in-out infinite` : 'none',
        }}
      >
        <img src={rockAsset.url} alt="" className="w-full h-auto drop-shadow-[0_18px_24px_rgba(0,0,0,0.45)]" />
        {active && (
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: 'radial-gradient(circle at 35% 55%, rgba(255,196,74,0.35), transparent 60%)',
              animation: `spark-burst ${SWING}s ease-out infinite`,
            }}
          />
        )}
      </div>

      {/* ── Miner ── */}
      <div className="absolute" style={{ left: '6%', bottom: '12%', width: 'min(46%, 240px)' }}>
        {active ? (
          <div className="relative w-full">
            <img
              src={minerUpAsset.url}
              alt=""
              className="w-full h-auto object-contain drop-shadow-[0_16px_20px_rgba(0,0,0,0.45)]"
              style={{ animation: `miner-swing-a ${SWING}s steps(1, end) infinite` }}
            />
            <img
              src={minerHitAsset.url}
              alt=""
              className="absolute inset-0 w-full h-auto object-contain drop-shadow-[0_16px_20px_rgba(0,0,0,0.45)]"
              style={{ animation: `miner-swing-b ${SWING}s steps(1, end) infinite` }}
            />
          </div>
        ) : (
          <img
            src={minerIdleAsset.url}
            alt=""
            className="w-full h-auto object-contain drop-shadow-[0_16px_20px_rgba(0,0,0,0.45)]"
            style={{ animation: 'miner-idle-breathe 3.6s ease-in-out infinite', transformOrigin: '50% 100%' }}
          />
        )}
      </div>

      {/* ── Impact FX at the pickaxe/rock contact point ── */}
      {active && (
        <div className="absolute" style={{ right: '30%', bottom: '30%' }}>
          {/* golden flash */}
          <span
            className="absolute rounded-full"
            style={{
              width: 46,
              height: 46,
              marginLeft: -23,
              marginBottom: -23,
              background: 'radial-gradient(circle, rgba(255,236,170,0.9) 0%, rgba(255,186,60,0.45) 45%, transparent 70%)',
              animation: `spark-burst ${SWING}s ease-out infinite`,
            }}
          />
          {/* sparks / chips */}
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <span
              key={`c${i}`}
              className="absolute rounded-[1px]"
              style={{
                width: 4,
                height: 4,
                background: i % 2 ? '#ffd873' : '#e8dcc2',
                boxShadow: '0 0 6px rgba(255,200,90,0.8)',
                ['--cx' as string]: `${-30 + i * 10}px`,
                ['--cy' as string]: `${-26 - (i % 3) * 8}px`,
                animation: `chip-fly ${SWING}s ease-out ${(i % 3) * 0.04}s infinite`,
              }}
            />
          ))}
          {/* coins knocked out of the rock */}
          {[0, 1, 2].map((i) => (
            <Coin
              key={`k${i}`}
              style={{
                ['--dx' as string]: `${-14 - i * 8}px`,
                animation: `coin-drop ${SWING * 2}s ease-in ${i * 0.35 + SWING * 0.5}s infinite, coin-shine 1.4s ease-in-out infinite`,
              }}
            />
          ))}
        </div>
      )}

      {/* ── Cart on its rail ── */}
      <div className="absolute" style={{ right: '3%', bottom: '3%', width: 'min(24%, 104px)' }}>
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
