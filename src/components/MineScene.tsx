import { memo, useEffect, useState } from 'react';
import minerIdleAsset from '@/assets/miner_idle_v3.png.asset.json';
import minerUpAsset from '@/assets/miner_up_v3.png.asset.json';
import minerHitAsset from '@/assets/miner_hit_v3.png.asset.json';
import rockAsset from '@/assets/rock_v3.png.asset.json';
import cartAsset from '@/assets/cart_v2.png.asset.json';

type Props = {
  /** Mining Active → the miner swings, sparks + TON particles appear. */
  active: boolean;
  /** Increment this to play the one-shot claim (cart → station → balance) run. */
  claimKey: number;
};

/** One full swing cycle (raise → strike → recover). Everything is timed off this. */
const SWING = 1.25;

/** Small TON-style gem particle. */
const TonGem = ({ size = 14, style }: { size?: number; style?: React.CSSProperties }) => (
  <span className="absolute" style={{ width: size, height: size, ...style }}>
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ filter: 'drop-shadow(0 0 6px rgba(255,196,74,0.85))' }}>
      <defs>
        <linearGradient id="tonGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff2bf" />
          <stop offset="45%" stopColor="#ffcc4d" />
          <stop offset="100%" stopColor="#c9871a" />
        </linearGradient>
      </defs>
      <path
        d="M12 2 2.6 7.2 12 22l9.4-14.8L12 2Zm0 2.9 6.6 3.6L12 18.4 5.4 8.5 12 4.9Z"
        fill="url(#tonGold)"
      />
      <path d="M12 4.9 5.4 8.5 12 18.4l6.6-9.9L12 4.9Z" fill="url(#tonGold)" opacity="0.55" />
    </svg>
  </span>
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
      {/* cinematic light shaft from above + darker floor for depth */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 70% at 50% 12%, rgba(255,214,140,0.18) 0%, transparent 62%), linear-gradient(180deg, transparent 42%, rgba(0,0,0,0.42) 100%)',
        }}
      />

      {/* floating dust motes — cheap ambience */}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
        <span
          key={`d${i}`}
          className="absolute rounded-full"
          style={{
            left: `${6 + i * 10}%`,
            bottom: `${8 + (i % 4) * 13}%`,
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
          right: '6%',
          bottom: '22%',
          width: 'min(46%, 250px)',
          animation: active ? `rock-shake ${SWING}s ease-in-out infinite` : 'none',
        }}
      >
        <img src={rockAsset.url} alt="" className="w-full h-auto drop-shadow-[0_18px_24px_rgba(0,0,0,0.5)]" />
        {active && (
          <div
            className="absolute inset-0"
            style={{
              background: 'radial-gradient(circle at 30% 55%, rgba(255,204,90,0.55), rgba(255,170,40,0.18) 45%, transparent 70%)',
              mixBlendMode: 'screen',
              animation: `rock-glow-pulse ${SWING}s ease-out infinite`,
            }}
          />
        )}
      </div>

      {/* ── Miner: whole body + arms + pickaxe move together (lunge into the strike) ── */}
      <div
        className="absolute"
        style={{
          left: '4%',
          bottom: '20%',
          width: 'min(46%, 235px)',
          transformOrigin: '55% 100%',
          animation: active ? `miner-lunge ${SWING}s cubic-bezier(0.35,0,0.2,1) infinite` : 'none',
        }}
      >
        {active ? (
          <div className="relative w-full">
            {/* raise */}
            <img
              src={minerUpAsset.url}
              alt=""
              className="w-full h-auto object-contain drop-shadow-[0_16px_20px_rgba(0,0,0,0.45)]"
              style={{ animation: `miner-swing-a ${SWING}s steps(1, end) infinite` }}
            />
            {/* strike — pick head on the rock face */}
            <img
              src={minerHitAsset.url}
              alt=""
              className="absolute inset-0 w-full h-auto object-contain drop-shadow-[0_16px_20px_rgba(0,0,0,0.45)]"
              style={{ animation: `miner-swing-b ${SWING}s steps(1, end) infinite` }}
            />
            {/* recover */}
            <img
              src={minerIdleAsset.url}
              alt=""
              className="absolute inset-0 w-full h-auto object-contain drop-shadow-[0_16px_20px_rgba(0,0,0,0.45)]"
              style={{ animation: `miner-swing-c ${SWING}s steps(1, end) infinite` }}
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
        <div className="absolute" style={{ right: '30%', bottom: '40%' }}>
          {/* golden flash exactly on contact */}
          <span
            className="absolute rounded-full"
            style={{
              width: 52,
              height: 52,
              marginLeft: -26,
              marginBottom: -26,
              background: 'radial-gradient(circle, rgba(255,240,190,0.95) 0%, rgba(255,186,60,0.5) 45%, transparent 72%)',
              animation: `spark-burst ${SWING}s ease-out infinite`,
            }}
          />
          {/* sparks / stone chips */}
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <span
              key={`c${i}`}
              className="absolute rounded-[1px]"
              style={{
                width: 4,
                height: 4,
                background: i % 2 ? '#ffd873' : '#e8dcc2',
                boxShadow: '0 0 6px rgba(255,200,90,0.8)',
                ['--cx' as string]: `${-32 + i * 9}px`,
                ['--cy' as string]: `${-26 - (i % 3) * 9}px`,
                animation: `chip-fly ${SWING}s ease-out ${(i % 3) * 0.04}s infinite`,
              }}
            />
          ))}
          {/* TON gems knocked out of the rock, flying up toward the balance HUD */}
          {[0, 1, 2, 3].map((i) => (
            <TonGem
              key={`t${i}`}
              size={12 + (i % 2) * 3}
              style={{
                ['--tx' as string]: `${-40 - i * 26}px`,
                ['--ty' as string]: `${-150 - i * 30}px`,
                animation: `ton-fly ${SWING * 2}s cubic-bezier(0.3,0,0.4,1) ${i * 0.18}s infinite`,
              }}
            />
          ))}
        </div>
      )}

      {/* ── Cart on its rail ── */}
      <div className="absolute" style={{ right: '4%', bottom: '15%', width: 'min(22%, 96px)' }}>
        <div
          style={{
            ['--cart-travel' as string]: '-190%',
            animation: claiming ? 'cart-run 3.2s cubic-bezier(0.45,0,0.35,1) 1' : 'none',
          }}
        >
          <img src={cartAsset.url} alt="" loading="lazy" className="w-full h-auto" />
        </div>
      </div>

      {/* ── Claim: TON gems travelling from the station up to the balance ── */}
      {claiming &&
        [0, 1, 2, 3, 4, 5].map((i) => (
          <TonGem
            key={i}
            size={14}
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
