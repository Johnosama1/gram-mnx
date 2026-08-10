import { memo, useEffect, useState } from 'react';
import mineBg from '@/assets/mine_bg_v6.jpg';
import cartSprite from '@/assets/cart_sprite_v6.png';

type Props = {
  /** Mining Active → cart travels the rails, wheels turn, gems sparkle. */
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

/** Sparkles over the gold gems sitting inside the cart (cart-local coords). */
const GEM_SPARKS = [
  { left: '30%', top: '12%', size: 9, delay: 0 },
  { left: '46%', top: '8%', size: 11, delay: 0.7 },
  { left: '62%', top: '13%', size: 8, delay: 1.3 },
  { left: '38%', top: '18%', size: 9, delay: 1.9 },
  { left: '70%', top: '10%', size: 8, delay: 2.5 },
];

const TRAVEL_SEC = 18;

function MineSceneBase({ active, claimKey, gramPerSec = 0 }: Props) {
  const [claiming, setClaiming] = useState(false);

  // One-shot claim animation — never re-triggers for the same claim.
  useEffect(() => {
    if (!claimKey) return;
    setClaiming(true);
    const id = setTimeout(() => setClaiming(false), 3000);
    return () => clearTimeout(id);
  }, [claimKey]);

  const pathAnim = active ? `cart-path ${TRAVEL_SEC}s ease-in-out infinite` : 'none';

  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none select-none">
      {/* ── Stage: exactly matches the background image box (object-cover math),
             so every % coordinate below maps 1:1 onto the photo. ── */}
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          aspectRatio: '1200 / 896',
          minWidth: '100%',
          minHeight: '100%',
          width: 'auto',
          height: 'auto',
          transform: 'translate(-53%, -50%)',
        }}
      >
        {/* ── Fixed cave / rails plate (never moves) ── */}
        <img src={mineBg} alt="" className="block h-full w-full object-cover" />

      {/* ── The cart: travels along the rail path (translate = % of scene) ── */}
      <div className="absolute inset-0" style={{ animation: pathAnim, willChange: 'transform' }}>
        {/* Perspective and steering are anchored at the wheel/rail contact line. */}
        <div
          className="absolute"
          style={{
            left: '51.7%',
            top: '72.5%',
            width: '34%',

            transform: 'translate(-50%, -100%)',
            transformOrigin: '50% 100%',
            animation: active ? `cart-scale ${TRAVEL_SEC}s ease-in-out infinite` : 'none',
            willChange: 'transform',
          }}
        >

          {/* Cart and wheels stay rigidly locked together; no vertical bounce. */}
          <div>
            <div className="relative">
              <img src={cartSprite} alt="" className="block w-full" style={{ filter: 'drop-shadow(0 10px 18px rgba(0,0,0,0.65))' }} />

              {/* rotating wheel spokes sitting exactly over the sprite wheels */}
              {active &&
                [
                  { left: '13.5%', top: '70%', w: '15%' },
                  { left: '61%', top: '69%', w: '20%' },
                ].map((w) => (
                  <span
                    key={w.left}
                    className="absolute rounded-full"
                    style={{
                      left: w.left,
                      top: w.top,
                      width: w.w,
                      aspectRatio: '1 / 1',
                      opacity: 0.45,
                      mixBlendMode: 'screen',
                      animation: 'wheel-turn 1.05s linear infinite',
                      background:
                        'conic-gradient(from 0deg, rgba(255,206,110,0.4) 0 5deg, transparent 5deg 60deg, rgba(255,206,110,0.4) 60deg 65deg, transparent 65deg 120deg, rgba(255,206,110,0.4) 120deg 125deg, transparent 125deg 180deg, rgba(255,206,110,0.4) 180deg 185deg, transparent 185deg 240deg, rgba(255,206,110,0.4) 240deg 245deg, transparent 245deg 300deg, rgba(255,206,110,0.4) 300deg 305deg, transparent 305deg 360deg)',
                    }}
                  />
                ))}

              {/* gem sparkles riding with the cart */}
              {GEM_SPARKS.map((s, i) => (
                <span
                  key={`s${i}`}
                  className="absolute rounded-full"
                  style={{
                    left: s.left,
                    top: s.top,
                    width: s.size,
                    height: s.size,
                    marginLeft: -s.size / 2,
                    marginTop: -s.size / 2,
                    background:
                      'radial-gradient(circle, rgba(255,255,235,0.95) 0%, rgba(255,208,110,0.6) 40%, transparent 70%)',
                    mixBlendMode: 'screen',
                    animation: `gem-twinkle ${active ? 2.4 : 5}s ease-in-out ${s.delay}s infinite`,
                  }}
                />
              ))}

              {/* dust kicked up behind the wheels */}
              {active &&
                [0, 1, 2, 3].map((i) => (
                  <span
                    key={`td${i}`}
                    className="absolute rounded-full"
                    style={{
                      left: `${6 + i * 6}%`,
                      top: '92%',
                      width: 10 + i * 3,
                      height: 10 + i * 3,
                      background: 'radial-gradient(circle, rgba(255,225,170,0.35) 0%, transparent 70%)',
                      animation: `trail-dust ${2.2 + i * 0.4}s ease-out ${i * 0.5}s infinite`,
                    }}
                  />
                ))}

              {/* floating "+x Gram" numbers rising from the cart */}
              {active && gramPerSec > 0 &&
                [0, 1, 2].map((i) => (
                  <span
                    key={`g${i}`}
                    className="absolute text-[10px] font-black tabular-nums text-[#7dffb0]"
                    style={{
                      left: `${34 + i * 14}%`,
                      top: '2%',
                      textShadow: '0 0 8px rgba(0,255,136,0.55)',
                      ['--gx' as string]: `${-6 + i * 8}px`,
                      animation: `gram-float 2.6s ease-out ${i * 0.85}s infinite`,
                    }}
                  >
                    +{gramPerSec.toFixed(6)} Gram
                  </span>
                ))}
            </div>
          </div>
        </div>
      </div>

      {/* soft vignette so HUD text on top stays readable */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 70% at 50% 45%, transparent 40%, rgba(0,0,0,0.45) 100%), linear-gradient(180deg, rgba(0,0,0,0.55) 0%, transparent 22%, transparent 70%, rgba(0,0,0,0.6) 100%)',
        }}
      />

      {/* ── Lantern flicker (fixed to the cave) ── */}
      {[
        { left: '15%', top: '15%', size: 120, dur: 3.4 },
        { left: '41%', top: '9%', size: 90, dur: 4.6 },
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
            background: 'radial-gradient(circle, rgba(255,190,90,0.32) 0%, rgba(255,160,50,0.1) 45%, transparent 72%)',
            mixBlendMode: 'screen',
            animation: `lamp-flicker ${l.dur}s ease-in-out infinite`,
          }}
        />
      ))}
      </div>


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

      {/* ── Claim: gems travelling from the cart up to the balance ── */}
      {claiming &&
        [0, 1, 2, 3, 4, 5].map((i) => (
          <TonGem
            key={i}
            size={14}
            style={{
              left: `${38 + i * 4}%`,
              top: '42%',
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
