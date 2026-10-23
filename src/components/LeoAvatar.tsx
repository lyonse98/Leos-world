import { useEffect, useRef, useState } from 'react';

type AvatarState = 'idle' | 'speaking' | 'thinking';

interface LeoAvatarProps {
  state: AvatarState;
  size?: number;
}

/**
 * 2D Leo avatar — a stylized explorer's face rendered in SVG.
 * Reacts to tour state with pure CSS animations. No API calls,
 * no video generation, zero added latency.
 */
export default function LeoAvatar({ state, size = 96 }: LeoAvatarProps) {
  // Random blink timer — eyes close briefly every few seconds.
  // Driven by JS rather than CSS so the timing is unpredictable.
  const [blinking, setBlinking] = useState(false);
  const blinkTimer = useRef<number | null>(null);

  useEffect(() => {
    const scheduleBlink = () => {
      const delay = 2500 + Math.random() * 3500;
      blinkTimer.current = window.setTimeout(() => {
        setBlinking(true);
        window.setTimeout(() => {
          setBlinking(false);
          scheduleBlink();
        }, 140);
      }, delay);
    };
    scheduleBlink();
    return () => {
      if (blinkTimer.current !== null) clearTimeout(blinkTimer.current);
    };
  }, []);

  const glowClass =
    state === 'speaking'
      ? 'bg-blue-500/25'
      : state === 'thinking'
        ? 'bg-amber-500/25'
        : 'bg-cyan-500/10';

  const ringClass =
    state === 'speaking'
      ? 'border-blue-400/30'
      : state === 'thinking'
        ? 'border-amber-400/30'
        : 'border-slate-500/25';

  const orbGradient =
    state === 'speaking'
      ? 'from-blue-900/60 to-slate-900 border-blue-600/50'
      : state === 'thinking'
        ? 'from-amber-900/60 to-slate-900 border-amber-600/50'
        : 'from-slate-800 to-slate-900 border-slate-600/50';

  // Mouth shape changes with state:
  // idle    → gentle closed smile
  // speaking → open mouth with animated lip flap
  // thinking → small "o" shape
  const mouthPath =
    state === 'speaking'
      ? 'M 36 58 Q 50 66 64 58'   // open — animated by CSS below
      : state === 'thinking'
        ? 'M 44 58 Q 50 62 56 58'  // small o
        : 'M 38 57 Q 50 63 62 57'; // smile

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Leo is ${state}`}
    >
      {/* Ambient glow */}
      <div
        className={`absolute rounded-full blur-2xl transition-colors duration-700 ${glowClass}`}
        style={{ width: size * 0.85, height: size * 0.85 }}
      />

      {/* Pulsing rings (decorative) */}
      <div
        className={`absolute rounded-full border leo-ring ${ringClass}`}
        style={{ width: size, height: size }}
      />
      <div
        className={`absolute rounded-full border leo-ring-delay ${ringClass}`}
        style={{ width: size, height: size }}
      />

      {/* Main orb container */}
      <div
        className={`relative rounded-full bg-gradient-to-br border flex items-center justify-center shadow-2xl transition-colors duration-500 overflow-hidden ${orbGradient}`}
        style={{ width: size * 0.78, height: size * 0.78 }}
      >
        <svg
          viewBox="0 0 100 100"
          width={size * 0.6}
          height={size * 0.6}
          className="relative z-10"
        >
          {/* Hat brim — a wide flat explorer hat */}
          <ellipse
            cx="50"
            cy="26"
            rx="32"
            ry="6"
            fill="currentColor"
            className={state === 'speaking' ? 'text-blue-400/80' : state === 'thinking' ? 'text-amber-400/80' : 'text-slate-500/70'}
            opacity="0.6"
          />
          {/* Hat crown */}
          <rect
            x="36"
            y="14"
            width="28"
            height="14"
            rx="4"
            fill="currentColor"
            className={state === 'speaking' ? 'text-blue-500/70' : state === 'thinking' ? 'text-amber-500/70' : 'text-slate-600/60'}
          />

          {/* Face circle */}
          <circle
            cx="50"
            cy="50"
            r="22"
            fill="#1e293b"
            stroke="currentColor"
            strokeWidth="1.5"
            className={state === 'speaking' ? 'text-blue-400/40' : state === 'thinking' ? 'text-amber-400/40' : 'text-slate-500/30'}
          />

          {/* Eyes — blink by scaling Y */}
          <g
            style={{
              transform: blinking ? 'scaleY(0.1)' : 'scaleY(1)',
              transformOrigin: 'center',
              transition: 'transform 80ms ease-out',
            }}
          >
            <ellipse cx="42" cy="46" rx="3.5" ry="4.5" fill="currentColor" className={state === 'speaking' ? 'text-blue-300' : state === 'thinking' ? 'text-amber-300' : 'text-slate-300'} />
            <ellipse cx="58" cy="46" rx="3.5" ry="4.5" fill="currentColor" className={state === 'speaking' ? 'text-blue-300' : state === 'thinking' ? 'text-amber-300' : 'text-slate-300'} />
            {/* Eye glints */}
            <circle cx="43" cy="45" r="1" fill="white" opacity="0.6" />
            <circle cx="59" cy="45" r="1" fill="white" opacity="0.6" />
          </g>

          {/* Nose hint */}
          <path d="M 50 48 L 48 53 L 52 53 Z" fill="currentColor" className="text-slate-600/40" />

          {/* Mouth */}
          {state === 'speaking' ? (
            <g className="leo-mouth-flap">
              <path
                d={mouthPath}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                className="text-blue-300"
              />
            </g>
          ) : (
            <path
              d={mouthPath}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className={state === 'thinking' ? 'text-amber-300/70' : 'text-slate-400/60'}
            />
          )}

          {/* Compass icon on hat — Leo's signature */}
          <circle
            cx="50"
            cy="21"
            r="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className={state === 'speaking' ? 'text-cyan-300/50' : 'text-amber-400/40'}
          />
          <line
            x1="50" y1="19" x2="50" y2="23"
            stroke="currentColor"
            strokeWidth="0.8"
            className={state === 'speaking' ? 'text-cyan-300/50' : 'text-amber-400/40'}
          />
        </svg>
      </div>
    </div>
  );
}
