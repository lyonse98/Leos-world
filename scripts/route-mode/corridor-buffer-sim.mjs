// Corridor buffer calibration sim (Nov 12, 2026 — Erik's Option A
// ruling from the Harbor Drive field note).
//
// Zero live calls: bundles the REAL src/data/corridors.ts and
// evaluates candidate CORRIDOR_BUFFER_M values against the real
// segment geometry three ways:
//
//   (a) HARBOR OVERLAP — Erik's Nov 12 drive (NBSD → SAN airport
//       via Harbor Drive) reconstructed from on-road anchors in
//       the library's own data (OSM street-address point for
//       NASSCO, the banked harbor dr segment pins, waterfront
//       place pins that front the road), resampled at 5 m with
//       the driver's path heading. Per candidate buffer: metres
//       inside ANY heading-compatible I-5 polyline's buffer
//       (geometric — the field audit's metric) and metres where
//       the real matchCorridor() returns an I-5 segment.
//   (b) ON-FREEWAY RETENTION — every segment's polyline densified,
//       displaced laterally by fixed offsets, heading = local
//       bearing. A sample "retains" when matchCorridor returns
//       the same segment or a chained same-freeway / same-
//       direction neighbour. Starved = no match at all. This is
//       the lateral error budget a true on-freeway driver gets.
//   (c) CHORD-BULGE STRESS (the interchange-proximity case) —
//       segment legs are chords laid junction-to-junction; on
//       curves and at stack interchanges the true road bulges
//       off the chord (a 2 km leg on a 3 km-radius curve sags
//       ~170 m). Each leg's midpoint is displaced perpendicular
//       by D and matched: how much bulge can each buffer absorb
//       before a driver ON the freeway stops matching it? Legs
//       passing within 1 km of a DIFFERENT freeway's polyline
//       (crossing / stack zones) are also reported as their own
//       subset.
//
// Usage: node scripts/route-mode/corridor-buffer-sim.mjs
// Exit 0 always (it reports; the harness checks assert).

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const out = join(mkdtempSync(join(tmpdir(), 'corridor-sim-')), 'corridors.mjs');
execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'esbuild'),
  [
    join(repoRoot, 'src', 'data', 'corridors.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    `--outfile=${out}`,
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
);
const C = await import(pathToFileURL(out).href);
const { CORRIDOR_SEGMENTS, matchCorridor } = C;

const CANDIDATES = [450, 300, 250, 200];
const M_PER_DEG_LAT = 111_320;
const mPerDegLng = (lat) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

function distM(a, b) {
  return Math.hypot((b.lat - a.lat) * M_PER_DEG_LAT, (b.lng - a.lng) * mPerDegLng(a.lat));
}
function bearingDeg(a, b) {
  const x = (b.lng - a.lng) * mPerDegLng(a.lat);
  const y = (b.lat - a.lat) * M_PER_DEG_LAT;
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}
function headingDeltaDeg(a, b) {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}
function pointToSegM(pos, a, b) {
  const kx = mPerDegLng(pos.lat);
  const ax = (a.lng - pos.lng) * kx, ay = (a.lat - pos.lat) * M_PER_DEG_LAT;
  const bx = (b.lng - pos.lng) * kx, by = (b.lat - pos.lat) * M_PER_DEG_LAT;
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx - ay * dy) / lenSq));
  return { distanceM: Math.hypot(ax + t * dx, ay + t * dy), t };
}
function offsetM(p, bearing, m) {
  const br = (bearing * Math.PI) / 180;
  return {
    lat: p.lat + (m * Math.cos(br)) / M_PER_DEG_LAT,
    lng: p.lng + (m * Math.sin(br)) / mPerDegLng(p.lat),
  };
}
function densify(polyline, stepM) {
  const pts = [];
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i], b = polyline[i + 1];
    const legM = distM(a, b);
    const n = Math.max(1, Math.round(legM / stepM));
    for (let j = 0; j < n; j++) {
      const t = j / n;
      pts.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
        heading: bearingDeg(a, b),
      });
    }
  }
  const last = polyline[polyline.length - 1];
  const prev = polyline[polyline.length - 2];
  pts.push({ lat: last.lat, lng: last.lng, heading: bearingDeg(prev, last) });
  return pts;
}

// ------------------------------------------------------------ (a) Harbor
// Waypoints in Erik's direction of travel. Anchors marked * are
// coordinates from the library's own records for places ON this
// road; the rest are road-resolution interpolations between them.
const HARBOR_DRIVE = [
  { lat: 32.6848, lng: -117.1308 }, // Harbor Dr at NBSD (32nd St)
  { lat: 32.69093, lng: -117.13387 }, // * NASSCO — OSM point, 2798 E Harbor Dr
  { lat: 32.69389, lng: -117.13801 }, // * BAE Systems frontage
  { lat: 32.70006, lng: -117.13857 }, // * banked harbor dr segment 2 pin
  { lat: 32.70029, lng: -117.14274 }, // * Chicano Park / Cesar Chavez jct
  { lat: 32.7035, lng: -117.1505 },
  { lat: 32.7062, lng: -117.1570 }, // Petco Park foot
  { lat: 32.7059, lng: -117.1615 }, // Convention Center frontage
  { lat: 32.70943, lng: -117.16307 }, // * banked harbor dr segment 1 pin
  { lat: 32.7096, lng: -117.1698 }, // Seaport Village front
  { lat: 32.7133, lng: -117.1749 }, // USS Midway front
  { lat: 32.7165, lng: -117.1745 }, // * Embarcadero
  { lat: 32.7202, lng: -117.1788 },
  { lat: 32.7240, lng: -117.1848 },
  { lat: 32.7268, lng: -117.1898 }, // Harbor Island entrance
  { lat: 32.7285, lng: -117.1955 }, // Spanish Landing
  { lat: 32.7308, lng: -117.2015 }, // airport — N Harbor Dr
];
const harborSamples = densify(HARBOR_DRIVE, 5);
let harborTotalM = 0;
for (let i = 1; i < HARBOR_DRIVE.length; i++) harborTotalM += distM(HARBOR_DRIVE[i - 1], HARBOR_DRIVE[i]);
const i5Segments = CORRIDOR_SEGMENTS.filter((s) => s.freeway === 'I-5');

function geometricInsideI5Buffer(sample, bufferM) {
  for (const seg of i5Segments) {
    for (let i = 0; i < seg.polyline.length - 1; i++) {
      const a = seg.polyline[i], b = seg.polyline[i + 1];
      if (headingDeltaDeg(bearingDeg(a, b), sample.heading) > 50) continue;
      if (pointToSegM(sample, a, b).distanceM <= bufferM) return seg;
    }
  }
  return null;
}

console.log('=== (a) HARBOR OVERLAP — NBSD → airport via Harbor Drive ===');
console.log(`route: ${harborSamples.length} samples, path length ≈ ${harborTotalM.toFixed(0)} m`);
console.log('buffer | geometric inside I-5 buffer | matchCorridor → I-5');
const harborResults = {};
for (const B of CANDIDATES) {
  let geo = 0, matched = 0;
  const perSeg = new Map();
  for (const s of harborSamples) {
    const g = geometricInsideI5Buffer(s, B);
    if (g) {
      geo += 5;
      perSeg.set(g.displayName, (perSeg.get(g.displayName) ?? 0) + 5);
    }
    const m = matchCorridor({ lat: s.lat, lng: s.lng, heading: s.heading }, B);
    if (m && m.segment.freeway === 'I-5') matched += 5;
  }
  harborResults[B] = { geo, matched };
  console.log(
    `${String(B).padStart(4)} m | ${String(geo).padStart(6)} m (${((100 * geo) / harborTotalM).toFixed(1)}%)` +
      ` | ${String(matched).padStart(6)} m (${((100 * matched) / harborTotalM).toFixed(1)}%)`
  );
  if (B === 450 || B === 200) {
    for (const [name, m] of [...perSeg.entries()].sort((a, b2) => b2[1] - a[1])) {
      console.log(`        at ${B} m, by segment: ${name}: ${m} m`);
    }
  }
}

// ------------------------------------------------- (b) on-freeway retention
console.log('\n=== (b) ON-FREEWAY RETENTION — lateral offset sweep ===');
const OFFSETS = [0, 50, 100, 150, 200, 250, 300];
const segmentSamples = new Map();
for (const seg of CORRIDOR_SEGMENTS) segmentSamples.set(seg.id, densify(seg.polyline, 25));
function retained(match, seg) {
  return (
    match !== null &&
    match.segment.freeway === seg.freeway &&
    match.segment.direction === seg.direction
  );
}
console.log('offset | ' + CANDIDATES.map((b) => `${b} m: retained% / starved`).join(' | '));
const retention = {};
for (const off of OFFSETS) {
  const cells = [];
  for (const B of CANDIDATES) {
    let ret = 0, starved = 0, total = 0;
    for (const seg of CORRIDOR_SEGMENTS) {
      for (const s of segmentSamples.get(seg.id)) {
        const side = total % 2 === 0 ? 1 : -1;
        const p = off === 0 ? s : offsetM(s, s.heading + 90, side * off);
        total++;
        const m = matchCorridor({ lat: p.lat, lng: p.lng, heading: s.heading }, B);
        if (!m) starved++;
        else if (retained(m, seg)) ret++;
      }
    }
    retention[`${off}/${B}`] = { ret, starved, total };
    cells.push(`${((100 * ret) / total).toFixed(2)}% / ${starved}`);
  }
  console.log(`${String(off).padStart(4)} m | ${cells.join(' | ')}`);
}

// ------------------------------------------------- (c) chord-bulge stress
console.log('\n=== (c) CHORD-BULGE STRESS — leg midpoints displaced off-chord ===');
// Legs near a different freeway's polyline = crossing/stack zones.
function nearOtherFreeway(seg, mid) {
  for (const other of CORRIDOR_SEGMENTS) {
    if (other.freeway === seg.freeway) continue;
    for (let i = 0; i < other.polyline.length - 1; i++) {
      if (pointToSegM(mid, other.polyline[i], other.polyline[i + 1]).distanceM <= 1000) return true;
    }
  }
  return false;
}
const legs = [];
for (const seg of CORRIDOR_SEGMENTS) {
  for (let i = 0; i < seg.polyline.length - 1; i++) {
    const a = seg.polyline[i], b = seg.polyline[i + 1];
    const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
    legs.push({
      seg,
      mid,
      bearing: bearingDeg(a, b),
      legM: distM(a, b),
      interchange: nearOtherFreeway(seg, mid),
    });
  }
}
const BULGES = [0, 50, 100, 125, 150, 175, 200, 250];
console.log(`legs: ${legs.length} total, ${legs.filter((l) => l.interchange).length} in crossing/stack zones`);
console.log('bulge | ' + CANDIDATES.map((b) => `${b} m: all-legs% / stack-legs%`).join(' | '));
const bulgeResults = {};
for (const D of BULGES) {
  const cells = [];
  for (const B of CANDIDATES) {
    let okAll = 0, nAll = 0, okStack = 0, nStack = 0;
    for (const leg of legs) {
      for (const side of [1, -1]) {
        const p = D === 0 ? leg.mid : offsetM(leg.mid, leg.bearing + 90, side * D);
        const m = matchCorridor({ lat: p.lat, lng: p.lng, heading: leg.bearing }, B);
        const ok = retained(m, leg.seg);
        nAll++;
        if (ok) okAll++;
        if (leg.interchange) {
          nStack++;
          if (ok) okStack++;
        }
      }
    }
    bulgeResults[`${D}/${B}`] = { okAll, nAll, okStack, nStack };
    cells.push(`${((100 * okAll) / nAll).toFixed(2)}% / ${((100 * okStack) / nStack).toFixed(2)}%`);
  }
  console.log(`${String(D).padStart(4)} m | ${cells.join(' | ')}`);
}
// The longest legs are where bulge physically lives; name the worst
// stack-zone legs by length for the report's named case.
const stackLegs = legs
  .filter((l) => l.interchange)
  .sort((a, b) => b.legM - a.legM)
  .slice(0, 6);
console.log('\nlongest stack-zone legs (the named interchange-proximity cases):');
for (const l of stackLegs) {
  console.log(`  ${l.legM.toFixed(0).padStart(5)} m leg — ${l.seg.displayName}`);
}

console.log('\nJSON ' + JSON.stringify({ harborResults, retention, bulgeResults }));
