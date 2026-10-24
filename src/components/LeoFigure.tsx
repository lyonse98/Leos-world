// Leo himself, standing in the screen. Pure presence, no function: still
// portraits of the same character, one per thing he can be doing, swapped
// with a short crossfade. No animation engine, no canvas — a pose change
// alone reads as movement, the way sprites work in a visual novel. All
// five poses share one canvas and one foot line, so a swap never makes
// him jump or resize. Total weight of all five: under 200 KB, cached
// after first load.
export type LeoPose = 'idle' | 'speaking' | 'listening' | 'thinking' | 'wave' | 'pointing' | 'liked';

const POSES: LeoPose[] = ['idle', 'speaking', 'listening', 'thinking', 'wave', 'pointing', 'liked'];

export default function LeoFigure({
  pose,
  className = '',
}: {
  pose: LeoPose;
  className?: string;
}) {
  return (
    <div
      className={`relative ${className}`}
      style={{ aspectRatio: '480 / 916' }}
      aria-hidden="true"
    >
      {/* soft ground shadow so he stands IN the scene, not on it */}
      <div className="absolute bottom-[1%] left-1/2 -translate-x-1/2 w-[72%] h-[3.5%] bg-black/55 blur-md rounded-[100%]" />
      {POSES.map((p) => (
        <img
          key={p}
          src={`/leo/leo-${p}.webp`}
          alt=""
          draggable={false}
          className={`absolute inset-0 h-full w-full object-contain object-bottom transition-opacity duration-300 ${
            p === pose ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ))}
    </div>
  );
}
