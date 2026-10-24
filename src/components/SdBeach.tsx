// The beach Leo stands on — Coronado-style: a low sun over the water, the
// bridge faint on the horizon, sand under his feet, a palm on one side and
// an umbrella with an empty beach chair on the other. One inline SVG, no
// image weight, silhouettes in currentColor so each screen tints it. It is
// a stage, not a picture: quiet enough that Leo stays the subject.
export default function SdBeach({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1440 150"
      preserveAspectRatio="xMidYMax slice"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* low sun over the water */}
      <circle cx="1152" cy="86" r="17" fill="#f59e0b" fillOpacity="0.45" />
      {/* ocean band + wave lines */}
      <rect x="0" y="100" width="1440" height="18" fill="currentColor" fillOpacity="0.35" />
      <g stroke="#ffffff" strokeOpacity="0.16" strokeWidth="2" strokeLinecap="round" fill="none">
        <path d="M60 107 q 18 -5 36 0 t 36 0 t 36 0" />
        <path d="M420 112 q 18 -5 36 0 t 36 0 t 36 0" />
        <path d="M880 108 q 18 -5 36 0 t 36 0" />
        <path d="M1180 112 q 18 -5 36 0 t 36 0 t 36 0" />
      </g>
      {/* Coronado Bridge, faint on the horizon */}
      <path
        d="M-10 112 Q 300 66 620 92 T 1010 106 L 1010 112 Q 640 100 330 86 Q 140 102 -10 116 Z"
        fill="currentColor"
        fillOpacity="0.3"
      />
      {/* sand */}
      <rect x="0" y="118" width="1440" height="32" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="5" strokeLinecap="round" fill="none">
        {/* palm, left */}
        <path d="M96 144 Q 92 108 104 82" />
        <path d="M104 82 Q 84 66 66 72" />
        <path d="M104 82 Q 100 60 84 52" />
        <path d="M104 82 Q 118 60 136 58" />
        <path d="M104 82 Q 126 70 142 78" />
        <path d="M104 82 Q 110 62 122 50" />
        {/* umbrella pole, right */}
        <path d="M1252 100 L1246 144" />
      </g>
      <g fill="currentColor">
        {/* umbrella canopy */}
        <path d="M1192 102 Q 1252 68 1314 102 Q 1288 92 1272 100 Q 1254 90 1236 100 Q 1216 92 1192 102 Z" />
        {/* empty beach chair beside it */}
        <path d="M1330 144 L1343 114 L1353 114 L1350 128 L1382 128 L1389 144 L1379 144 L1374 134 L1351 134 L1347 144 Z" />
      </g>
    </svg>
  );
}
