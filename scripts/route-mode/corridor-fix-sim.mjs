// Corridor fixes 1+2 sims (Nov 14, 2026 — Erik-approved fixes for
// the I-8 / SR-163 shutout diagnosis).
//
//   CF-1 (geometry half) — the corridor item's anchor: on a real
//     long segment, a mid-segment driver's entry-anchor distance
//     provably fails the 'fresher' inequality against a 500 m
//     waiter while the shipped nearest-point anchor passes it.
//     (The end-to-end displacement flip through the real Tour is
//     fresh-verify's CF-1 scenario; this is the arithmetic on the
//     real geometry.)
//   CF-2 — the densified SR-163: road traces (Catmull-Rom splines
//     through the road-path control points the densified
//     polylines were generated from, sampled every ~10 m) offset
//     laterally by 0 / 100 / 200 m must match SR-163 southbound
//     continuously through the REAL matchCorridor at the
//     production 250 m buffer; traces on the parallel surface
//     streets (Park Blvd, Florida St, Pershing Dr) must never
//     match an SR-163 segment. The pre-fix polylines are embedded
//     below as a fixture and measured with a distance replica
//     (the same pattern as corridor-buffer-sim's geometric
//     check) for the before/after evidence.
//   CF-3 — no regression: I-5 / SR-52 segment traces (each
//     segment's own polyline densified, offsets 0 / 100 / 200 m)
//     keep matching their own freeway + direction.
//
// Zero live calls. Usage: node scripts/route-mode/corridor-fix-sim.mjs
// Exit 0 = all checks pass; 1 = a check failed.

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const out = join(mkdtempSync(join(tmpdir(), 'corridor-fix-')), 'corridors.mjs');
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
const { CORRIDOR_SEGMENTS, CORRIDOR_BUFFER_M, matchCorridor, nearestPointOnSegment } = C;

const M_PER_DEG_LAT = 111_320;
const mPerDegLng = (lat) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
const P = (lat, lng) => ({ lat, lng });
function distM(a, b) {
  return Math.hypot((b.lat - a.lat) * M_PER_DEG_LAT, (b.lng - a.lng) * mPerDegLng(a.lat));
}
function bearingDeg(a, b) {
  const x = (b.lng - a.lng) * mPerDegLng(a.lat);
  const y = (b.lat - a.lat) * M_PER_DEG_LAT;
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
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
function distToPolylineM(pos, polyline) {
  let best = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    best = Math.min(best, pointToSegM(pos, polyline[i], polyline[i + 1]).distanceM);
  }
  return best;
}
function offsetM(p, bearing, m) {
  const br = (bearing * Math.PI) / 180;
  return {
    lat: p.lat + (m * Math.cos(br)) / M_PER_DEG_LAT,
    lng: p.lng + (m * Math.sin(br)) / mPerDegLng(p.lat),
  };
}
function catmullRom(pts, samplesPerSpan = 60) {
  const ext = [pts[0], ...pts, pts[pts.length - 1]];
  const out = [];
  for (let i = 1; i < ext.length - 2; i++) {
    const p0 = ext[i - 1], p1 = ext[i], p2 = ext[i + 1], p3 = ext[i + 2];
    for (let j = 0; j < samplesPerSpan; j++) {
      const t = j / samplesPerSpan, t2 = t * t, t3 = t2 * t;
      out.push(P(
        0.5 * ((2 * p1.lat) + (-p0.lat + p2.lat) * t + (2 * p0.lat - 5 * p1.lat + 4 * p2.lat - p3.lat) * t2 + (-p0.lat + 3 * p1.lat - 3 * p2.lat + p3.lat) * t3),
        0.5 * ((2 * p1.lng) + (-p0.lng + p2.lng) * t + (2 * p0.lng - 5 * p1.lng + 4 * p2.lng - p3.lng) * t2 + (-p0.lng + 3 * p1.lng - 3 * p2.lng + p3.lng) * t3),
      ));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
/** A road trace: spline samples ~evenly spaced, each with its local bearing and along-track fraction. */
function traceOf(controlPts, stepM = 10) {
  const spline = catmullRom(controlPts);
  const samples = [];
  let acc = 0;
  let total = 0;
  for (let i = 1; i < spline.length; i++) total += distM(spline[i - 1], spline[i]);
  for (let i = 0; i < spline.length; i++) {
    if (i > 0) acc += distM(spline[i - 1], spline[i]);
    const next = spline[Math.min(i + 1, spline.length - 1)];
    const prev = spline[Math.max(i - 1, 0)];
    samples.push({ lat: spline[i].lat, lng: spline[i].lng, heading: bearingDeg(prev, next), frac: total ? acc / total : 0 });
  }
  return samples.filter((_, i) => i % Math.max(1, Math.round(stepM / 2)) === 0 || i === samples.length - 1);
}

const failures = [];
function check(label, cond, detail = '') {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures.push(label);
}

// ---------------------------------------------------------- CF-1
console.log('=== CF-1 anchor geometry (longest segment, mid-segment driver) ===');
{
  const segLen = (s) => s.polyline.reduce((acc, p, i) => (i === 0 ? 0 : acc + distM(p, s.polyline[i - 1])), 0);
  const seg = CORRIDOR_SEGMENTS.filter((s) => segLen(s) > 4000).reduce((a, b) => (segLen(a) > segLen(b) ? a : b));
  // Walk to ~50% along-track, then step 30 m off the road.
  let acc = 0;
  const total = segLen(seg);
  let mid = seg.polyline[0];
  let midBearing = 0;
  for (let i = 1; i < seg.polyline.length; i++) {
    const a = seg.polyline[i - 1], b = seg.polyline[i];
    const leg = distM(b, a);
    if (acc + leg >= total / 2) {
      const t = (total / 2 - acc) / leg;
      mid = P(a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t);
      midBearing = bearingDeg(a, b);
      break;
    }
    acc += leg;
  }
  const driver = offsetM(mid, midBearing + 90, 30);
  const waiter = offsetM(mid, midBearing + 90, -500); // a waiter anchored 500 m the other way
  const dw = distM(driver, waiter);
  const dnOld = distM(driver, seg.polyline[0]);
  const anchorNew = nearestPointOnSegment(seg, driver);
  const dnNew = distM(driver, anchorNew);
  console.log(`  segment ${seg.id} (${Math.round(total)} m): dnOld=${Math.round(dnOld)} dnNew=${Math.round(dnNew)} dw=${Math.round(dw)}`);
  check('entry anchor fails the fresher test (dnOld + 150 >= dw)', dnOld + 150 >= dw);
  check('nearest-point anchor passes it (dnNew + 150 < dw)', dnNew + 150 < dw);
  check('nearest point is the driver\'s own ground (dnNew <= 35 m)', dnNew <= 35, `dnNew=${Math.round(dnNew)}`);
}

// ---------------------------------------------------------- CF-2
console.log('\n=== CF-2 densified SR-163: continuous match, no street bleed ===');
// The road-path control points the densified polylines were
// generated from (the trace spline runs through them; the shipped
// polyline is a ~190 m resample of the same path, so the
// trace-to-polyline gap is pure chord sagitta).
const TRACE_SB_MVH = [
  P(32.781, -117.168), P(32.7790, -117.1668), P(32.7765, -117.1653),
  P(32.7742, -117.1641), P(32.772, -117.163), P(32.7699, -117.1619),
  P(32.7675, -117.1608), P(32.7651, -117.1598), P(32.7627, -117.1587),
  P(32.7602, -117.1576), P(32.7578, -117.1566), P(32.756, -117.156),
];
const TRACE_SB_HD = [
  P(32.756, -117.156), P(32.7536, -117.1550), P(32.7512, -117.1535),
  P(32.7489, -117.1519), P(32.7466, -117.1510), P(32.7443, -117.1507),
  P(32.7420, -117.1505), P(32.740, -117.151), P(32.7372, -117.1512),
  P(32.7348, -117.1514), P(32.7325, -117.1516), P(32.730, -117.152),
  P(32.7272, -117.1533), P(32.7252, -117.1549), P(32.7234, -117.1566),
  P(32.721, -117.158),
];
// Pre-fix (Nov 14) polylines, embedded for the before/after measure.
const OLD_163 = {
  'sr-163-sb-mission-valley-hillcrest': [P(32.781, -117.168), P(32.772, -117.163), P(32.756, -117.156)],
  'sr-163-sb-hillcrest-downtown': [P(32.756, -117.156), P(32.74, -117.151), P(32.73, -117.152), P(32.721, -117.158)],
};
const SB_LEGS = [
  { id: 'sr-163-sb-mission-valley-hillcrest', trace: TRACE_SB_MVH },
  { id: 'sr-163-sb-hillcrest-downtown', trace: TRACE_SB_HD },
];
for (const leg of SB_LEGS) {
  const samples = traceOf(leg.trace, 10);
  const seg = CORRIDOR_SEGMENTS.find((s) => s.id === leg.id);
  for (const off of [0, 100, 200]) {
    for (const side of [1, -1]) {
      let n = 0, sb163 = 0, core = 0, coreTarget = 0;
      for (const s of samples) {
        const p = off === 0 ? s : offsetM(s, s.heading + 90, side * off);
        const m = matchCorridor({ lat: p.lat, lng: p.lng, heading: s.heading });
        n++;
        if (m && m.segment.freeway === 'SR-163' && m.segment.direction === 'southbound') sb163++;
        if (s.frac >= 0.15 && s.frac <= 0.85) {
          core++;
          if (m && m.segment.id === leg.id) coreTarget++;
        }
      }
      const tag = `${leg.id} offset ${off} m side ${side > 0 ? 'E' : 'W'}`;
      check(`${tag}: SR-163 SB matched >=99%`, sb163 / n >= 0.99, `${sb163}/${n}`);
      check(`${tag}: leg core matches the target segment >=99%`, coreTarget / core >= 0.99, `${coreTarget}/${core}`);
    }
  }
  // Before/after: how much of the road trace sat outside the
  // buffer of the OLD polyline vs the NEW one (distance replica,
  // both offset sides — the road bows east of the old chords, so
  // the east side is where the old geometry starved).
  {
    let maxOld = 0, maxNew = 0;
    for (const s of samples) {
      maxOld = Math.max(maxOld, distToPolylineM(s, OLD_163[leg.id]));
      maxNew = Math.max(maxNew, distToPolylineM(s, seg.polyline));
    }
    console.log(`  info ${leg.id}: max trace-to-polyline distance old=${Math.round(maxOld)} m new=${Math.round(maxNew)} m`);
    check(`${leg.id}: new polyline hugs the road (max distance <=60 m)`, maxNew <= 60, `max=${Math.round(maxNew)}`);
  }
  for (const off of [0, 200]) {
    for (const side of [1, -1]) {
      let starvedOld = 0, starvedNew = 0, n = 0;
      for (const s of samples) {
        const p = off === 0 ? s : offsetM(s, s.heading + 90, side * off);
        n++;
        if (distToPolylineM(p, OLD_163[leg.id]) > CORRIDOR_BUFFER_M) starvedOld++;
        if (distToPolylineM(p, seg.polyline) > CORRIDOR_BUFFER_M) starvedNew++;
      }
      console.log(`  info ${leg.id} offset ${off} m side ${side > 0 ? 'E' : 'W'}: outside-buffer old=${starvedOld}/${n} new=${starvedNew}/${n}`);
      check(`${leg.id} offset ${off} m side ${side > 0 ? 'E' : 'W'}: new polyline never outside its own buffer`, starvedNew === 0, `${starvedNew}/${n}`);
    }
  }
}
// Parallel surface streets must never match an SR-163 segment.
const STREETS = {
  'Park Blvd': [P(32.7495, -117.1468), P(32.7460, -117.1470), P(32.7420, -117.1473), P(32.7375, -117.1477), P(32.7330, -117.1479), P(32.7313, -117.1480), P(32.7270, -117.1476), P(32.7230, -117.1473)],
  'Florida St': [P(32.7585, -117.1467), P(32.7555, -117.1467), P(32.7520, -117.1466), P(32.7488, -117.1466)],
  'Pershing Dr': [P(32.7350, -117.1448), P(32.7300, -117.1444), P(32.7250, -117.1440), P(32.7200, -117.1436), P(32.7160, -117.1433)],
};
for (const [name, pts] of Object.entries(STREETS)) {
  const samples = traceOf(pts, 10);
  let hits163 = 0;
  const others = new Map();
  for (const s of samples) {
    const m = matchCorridor({ lat: s.lat, lng: s.lng, heading: s.heading });
    if (m) {
      if (m.segment.freeway === 'SR-163') hits163++;
      else others.set(m.segment.id, (others.get(m.segment.id) ?? 0) + 1);
    }
  }
  check(`${name}: never matches SR-163`, hits163 === 0, `samples=${samples.length}${others.size ? ` other matches: ${[...others.keys()].join(',')}` : ''}`);
}

// ---------------------------------------------------------- CF-3
console.log('\n=== CF-3 no regression: I-5 / SR-52 self-traces ===');
{
  const segs = CORRIDOR_SEGMENTS.filter((s) => s.freeway === 'I-5' || s.freeway === 'SR-52');
  function densify(polyline, stepM) {
    const pts = [];
    for (let i = 0; i < polyline.length - 1; i++) {
      const a = polyline[i], b = polyline[i + 1];
      const legM = distM(a, b);
      const n = Math.max(1, Math.round(legM / stepM));
      for (let j = 0; j < n; j++) {
        const t = j / n;
        pts.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t, heading: bearingDeg(a, b) });
      }
    }
    const last = polyline[polyline.length - 1];
    const prev = polyline[polyline.length - 2];
    pts.push({ lat: last.lat, lng: last.lng, heading: bearingDeg(prev, last) });
    return pts;
  }
  for (const off of [0, 100, 200]) {
    let total = 0, retained = 0, starved = 0;
    for (const seg of segs) {
      for (const s of densify(seg.polyline, 25)) {
        const side = total % 2 === 0 ? 1 : -1;
        const p = off === 0 ? s : offsetM(s, s.heading + 90, side * off);
        total++;
        const m = matchCorridor({ lat: p.lat, lng: p.lng, heading: s.heading });
        if (!m) starved++;
        else if (m.segment.freeway === seg.freeway && m.segment.direction === seg.direction) retained++;
      }
    }
    console.log(`  info offset ${off} m: retained ${retained}/${total}, starved ${starved}`);
    if (off < 200) check(`I-5/SR-52 offset ${off} m: nothing starved`, starved === 0, `${starved}/${total}`);
    check(`I-5/SR-52 offset ${off} m: retained >=98%`, retained / total >= 0.98, `${retained}/${total}`);
  }
}

console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `FAILURES: ${failures.length}`}`);
process.exit(failures.length === 0 ? 0 : 1);
