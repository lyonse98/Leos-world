// San Diego on the horizon — a single dark silhouette strip: the Coronado
// Bridge sweeping in from the left, downtown towers on the right, palms at
// both ends. Pure SVG, no image weight, coloured with currentColor so each
// screen can tint it. Deliberately quiet: it is the ground Leo stands on,
// not a picture competing with him.
export default function SdSkyline({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1440 150"
      preserveAspectRatio="xMidYMax slice"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <g fill="currentColor">
        {/* ground line */}
        <rect x="0" y="138" width="1440" height="12" />
        {/* Coronado Bridge — long low arc, two pylons */}
        <path d="M-10 128 Q 300 62 620 92 T 1010 118 L 1010 126 Q 640 100 330 84 Q 140 108 -10 136 Z" />
        <rect x="330" y="92" width="7" height="46" />
        <rect x="648" y="88" width="7" height="50" />
        {/* downtown towers */}
        <g>
          <rect x="1064" y="78" width="26" height="60" />
          <rect x="1096" y="58" width="20" height="80" />
          <rect x="1122" y="88" width="30" height="50" />
          <rect x="1158" y="44" width="24" height="94" />
          <rect x="1158" y="36" width="24" height="8" />
          <rect x="1188" y="70" width="18" height="68" />
          <rect x="1212" y="92" width="34" height="46" />
          <rect x="1252" y="62" width="22" height="76" />
          <rect x="1280" y="84" width="28" height="54" />
          <rect x="1314" y="100" width="36" height="38" />
        </g>
        {/* One America Plaza-style pointed top */}
        <path d="M1158 44 L1170 22 L1182 44 Z" />
      </g>
      <g stroke="currentColor" strokeWidth="5" strokeLinecap="round" fill="none">
        {/* palm left */}
        <path d="M96 138 Q 92 104 104 78" />
        <path d="M104 78 Q 84 62 66 68" />
        <path d="M104 78 Q 100 56 84 48" />
        <path d="M104 78 Q 118 56 136 54" />
        <path d="M104 78 Q 126 66 142 74" />
        <path d="M104 78 Q 110 58 122 46" />
        {/* palm right */}
        <path d="M1396 138 Q 1392 108 1402 84" />
        <path d="M1402 84 Q 1384 68 1366 74" />
        <path d="M1402 84 Q 1398 62 1382 54" />
        <path d="M1402 84 Q 1416 62 1434 60" />
        <path d="M1402 84 Q 1422 72 1438 80" />
      </g>
    </svg>
  );
}
