import { memo, useEffect, useState } from 'react';
import mineCartAsset from '@/assets/mine_cart_v5.jpg.asset.json';

type Props = {
  /** Mining Active → cart rolls, wheels turn, gems sparkle. */
  active: boolean;
  /** Increment this to play the one-shot claim (cart → balance) run. */
  claimKey: number;
  /** Real backend mining rate (Gram/s) — used only for the floating labels. */
  gramPerSec?: number;
};

/** Small TON/MNX-style gem particle. */
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
      <path d="M12 2 2.6 7.2 12 22l9.4-14.8L12 2Zm0 2.9 6.6 3.6L12 18.4 5.4 8.5 12 4.9Z" fill="url(#tonGold)" />
      <path d="M12 4.9 5.4 8.5 12 18.4l6.6-9.9L12 4.9Z" fill="url(#tonGold)" opacity="0.55" />
    </svg>
  </span>
);

/** Sparkle positions over the gold gems sitting inside the cart. */
const GEM_SPARKS = [
  { left: '36%', top: '33%', size: 7, delay: 0 },
  { left: '46%', top: '30%', size: 9, delay: 0.7 },
  { left: '55%', top: '34%', size: 6, delay: 1.3 },
  { left: '42%', top: '37%', size: 8, delay: 1.9 },
  { left: '60%', top: '31%', size: 7, delay: 2.5 },
  { left: '50%', top: '36%', size: 6, delay: 3.1 },
];

function MineSceneBase({ active, claimKey, gramPerSec = 0 }: Props) {
  const [claiming, setClaiming] = useState(false);

  // One-shot claim animation — never re-triggers for the same claim.
  useEffect(() => {
    if (!claimKey) return;
    setClaiming(true);
    const id = setTimeout(() => setClaiming(false), 3000);
    return () => clearTimeout(id);
  }, [claimKey]);

  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none select-none">
      {/* ── Hero mine scene (kept exactly as designed, only gently animated) ── */}
      <div
        className="absolute inset-0"
        style={{
          animation: active ? 'scene-roll 7.5s ease-in-out infinite' : 'scene-rest 12s ease-in-out infinite',
          willChange: 'transform',
        }}
      >
        <img
          src={mineCartAsset.url}
          alt=""
          className="absolute left-1/2 top-1/2 w-[112%] max-w-none -translate-x-1/2 -translate-y-1/2"
          style={{ objectFit: 'contain' }}
        />
      </div>

      {/* soft vignette so HUD text on top stays readable */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 70% at 50% 45%, transparent 40%, rgba(0,0,0,0.45) 100%), linear-gradient(180deg, rgba(0,0,0,0.55) 0%, transparent 22%, transparent 70%, rgba(0,0,0,0.6) 100%)',
        }}
      />

      {/* ── Lantern flicker ── */}
      {[
        { left: '14%', top: '16%', size: 120, dur: 3.4 },
        { left: '41%', top: '10%', size: 90, dur: 4.6 },
      ].map((l) => (
        <span
          key={l.left}
          className="absolute rounded-full"
          style={{
            left: l.left,
            top: l.top,
            width: l.size,
            height: l.size,
            marginLeft: -l.size / 2,
            marginTop: -l.size / 2,
            background: 'radial-gradient(circle, rgba(255,190,90,0.35) 0%, rgba(255,160,50,0.12) 45%, transparent 72%)',
            mixBlendMode: 'screen',
            animation: `lamp-flicker ${l.dur}s ease-in-out infinite`,
          }}
        />
      ))}

      {/* ── Gem sparkles inside the cart ── */}
      {GEM_SPARKS.map((s, i) => (
        <span
          key={`s${i}`}
          className="absolute"
          style={{
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            marginLeft: -s.size / 2,
            marginTop: -s.size / 2,
            background:
              'radial-gradient(circle, rgba(255,255,235,0.95) 0%, rgba(255,208,110,0.6) 40%, transparent 70%)',
            borderRadius: '50%',
            mixBlendMode: 'screen',
            animation: `gem-twinkle ${active ? 2.4 : 5}s ease-in-out ${s.delay}s infinite`,
          }}
        />
      ))}

      {/* ── Rail energy pulses running along the track while mining ── */}
      {active &&
        [0, 1, 2].map((i) => (
          <span
            key={`r${i}`}
            className="absolute rounded-full"
            style={{
              left: '18%',
              top: `${72 - i * 2}%`,
              width: '46%',
              height: 3,
              background: 'linear-gradient(90deg, transparent, rgba(255,205,110,0.75), transparent)',
              filter: 'blur(1.5px)',
              mixBlendMode: 'screen',
              animation: `rail-pulse ${4 + i * 0.8}s linear ${i * 1.3}s infinite`,
            }}
          />
        ))}

      {/* ── Floating dust motes (always on, very subtle) ── */}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
        <span
          key={`d${i}`}
          className="absolute rounded-full"
          style={{
            left: `${6 + i * 10}%`,
            bottom: `${10 + (i % 4) * 14}%`,
            width: 3 + (i % 3),
            height: 3 + (i % 3),
            background: 'rgba(255,232,180,0.45)',
            filter: 'blur(0.5px)',
            animation: `dust-float ${8 + (i % 4)}s ease-in-out ${i * 0.7}s infinite`,
          }}
        />
      ))}

      {/* ── Wheel motion blur under the cart while it rolls ── */}
      {active &&
        [30, 56].map((leftPct) => (
          <span
            key={leftPct}
            className="absolute rounded-full"
            style={{
              left: `${leftPct}%`,
              top: '60%',
              width: '11%',
              aspectRatio: '1 / 1',
              marginLeft: '-5.5%',
              mixBlendMode: 'screen',
              opacity: 0.35,
              animation: 'wheel-turn 1.6s linear infinite',
              background:
                'conic-gradient(from 0deg, rgba(255,206,110,0.35) 0 6deg, transparent 6deg 90deg, rgba(255,206,110,0.35) 90deg 96deg, transparent 96deg 180deg, rgba(255,206,110,0.35) 180deg 186deg, transparent 186deg 270deg, rgba(255,206,110,0.35) 270deg 276deg, transparent 276deg 360deg)',
            }}
          />
        ))}

      {/* ── Floating "+x Gram" numbers rising from the cart ── */}
      {active && gramPerSec > 0 &&
        [0, 1, 2].map((i) => (
          <span
            key={`g${i}`}
            className="absolute text-[10px] font-black tabular-nums text-[#7dffb0]"
            style={{
              left: `${40 + i * 8}%`,
              top: '28%',
              textShadow: '0 0 8px rgba(0,255,136,0.55)',
              ['--gx' as string]: `${-6 + i * 8}px`,
              animation: `gram-float 2.6s ease-out ${i * 0.85}s infinite`,
            }}
          >
            +{gramPerSec.toFixed(6)} Gram
          </span>
        ))}

      {/* ── Claim: gems travelling from the cart up to the balance ── */}
      {claiming &&
        [0, 1, 2, 3, 4, 5].map((i) => (
          <TonGem
            key={i}
            size={14}
            style={{
              left: `${38 + i * 4}%`,
              top: '32%',
              ['--fx' as string]: `${10 + i * 4}px`,
              ['--fy' as string]: '-32vh',
              animation: `coin-to-balance 1.2s ease-in ${i * 0.12}s 1 both`,
            }}
          />
        ))}
    </div>
  );
}

export default memo(MineSceneBase);
