// CORRIDOR ARM — STEP ZERO overlap fixture (EVIDENCE ONLY, Nov 25, 2026).
//
// Question: with the 100 offset segments banked alongside their parents,
// does the driver get ONE corridor telling per stretch of road — the one
// whose trigger zone he entered — never parent and offset twin back-to-back
// over the same ground?
//
// This fixture drives simulated traces through the REAL matchCorridor from
// this branch's corridors.ts (410 segments: 310 banked + 100 offsets
// appended at the end of CORRIDOR_SEGMENTS), applying tour.ts's trigger
// rules as read Nov 25, 2026:
//   - per fix: match = matchCorridor(pos, heading) (nearest leg, 250 m
//     buffer, 50° heading tolerance; ties keep the EARLIER array entry);
//   - a matched, unconsumed segment serves when the lane is free; when the
//     item sounds, its segment id joins corridorConsumed for the tour;
//   - NO cross-segment suppression exists in the shipped code.
// Nominal telling 120 s at 26.8 m/s (60 mph) => a serve occupies ~3.2 km.
//
// FINDING (see corridor-arm-report-2026-11-25.md, step zero):
//   - As committed (offsets appended last), parents win every tie and the
//     offsets never serve in freeform: zero overlaps, but the offset
//     tellings are inert until a seating rule lands.
//   - If offsets were inserted right after their parents instead, they
//     would hijack the chain and produce same-ground overlaps (measured
//     in the arm workdir's step-zero-fixture.log: 3 overlaps on the
//     through-drive, 2 for the mid-stretch joiner).
//   - The DESIGNED RULE modelled below — candidate fall-through +
//     covered-ground suppression + entry recency — yields the parent
//     chain for the through-driver and the offset telling for the
//     mid-stretch joiner, with zero overlaps. IT IS NOT SHIPPED in this
//     branch; it is flagged for the parent's review before any seating
//     change is built.
//
// Usage: node scripts/corridor-arm-overlap-fixture.mjs
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(path.join(ROOT, 'node_modules/.bin/esbuild'),
  [path.join(ROOT, 'src/data/corridors.ts'), '--bundle', '--format=esm', '--outfile=/tmp/corridor-arm-bank.mjs'],
  { stdio: 'pipe' });
const bank = await import('/tmp/corridor-arm-bank.mjs');
console.log(`bank: ${bank.CORRIDOR_SEGMENTS.length} segments (${bank.CORRIDOR_SEGMENTS.filter(s => s.id.endsWith('-offset')).length} offsets)`);

const R = 6371000;
const hav = (a, b) => { const dLa = (b.lat - a.lat) * Math.PI / 180, dLo = (b.lng - a.lng) * Math.PI / 180; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const bearing = (a, b) => (Math.atan2((b.lng - a.lng) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat) * 180 / Math.PI + 360) % 360;

function buildTrace() {
  const byId = new Map(bank.CORRIDOR_SEGMENTS.map(s => [s.id, s]));
  const chainIds = ['i-5-sb-la-jolla-pacific-beach', 'i-5-sb-pacific-beach-mission-bay', 'i-5-sb-mission-bay-old-town', 'i-5-sb-old-town-mission-hills'];
  const pts = [];
  for (const id of chainIds) { const s = byId.get(id); for (const p of s.polyline) if (!pts.length || hav(pts[pts.length - 1], p) > 5) pts.push(p); }
  const trace = [];
  let dist = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]; const leg = hav(a, b); const steps = Math.max(1, Math.round(leg / 75));
    for (let k = (trace.length ? 1 : 0); k <= steps; k++) {
      const t = k / steps; const p = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
      if (trace.length) dist += hav(trace[trace.length - 1], p);
      trace.push({ ...p, distM: dist, headingDeg: bearing(a, b) });
    }
  }
  return { trace, byId };
}
function spanOnTrace(seg, trace) {
  let lo = 1e18, hi = -1;
  for (const p of seg.polyline) { let bd = 1e18, bdM = 0; for (const t of trace) { const d = hav(p, t); if (d < bd) { bd = d; bdM = t.distM; } } lo = Math.min(lo, bdM); hi = Math.max(hi, bdM); }
  return [Math.round(lo), Math.round(hi)];
}
function report(label, serves) {
  console.log(`\n== ${label} ==`);
  for (const s of serves) console.log(`  serve @${s.atM}m  ${s.name}  (segment span ${s.span[0]}-${s.span[1]}m)`);
  let violations = 0;
  for (let i = 0; i < serves.length; i++) for (let j = i + 1; j < serves.length; j++) {
    const lo = Math.max(serves[i].span[0], serves[j].span[0]), hi = Math.min(serves[i].span[1], serves[j].span[1]);
    if (hi > lo) { violations++; console.log(`  !! SAME-GROUND OVERLAP ${hi - lo}m: "${serves[i].name}" vs "${serves[j].name}"`); }
  }
  console.log(`  serves: ${serves.length}, same-ground overlaps: ${violations}`);
  return violations;
}

const SPEED = 26.8, TELL_S = 120, OCC_M = SPEED * TELL_S;
function runCurrent(trace, startM, label) {
  const consumed = new Set();
  let busyUntil = -1; const serves = [];
  for (const fix of trace) {
    if (fix.distM < startM) continue;
    const m = bank.matchCorridor({ lat: fix.lat, lng: fix.lng, heading: fix.headingDeg });
    if (!m) continue;
    const seg = m.segment;
    if (fix.distM < busyUntil) continue;
    if (consumed.has(seg.id)) continue;
    consumed.add(seg.id);
    busyUntil = fix.distM + OCC_M;
    serves.push({ id: seg.id, name: seg.displayName, atM: Math.round(fix.distM), span: spanOnTrace(seg, trace) });
  }
  return report(label, serves);
}

// DESIGNED RULE (modelled, NOT shipped): all-candidate matcher with the
// same geometry as matchCorridor, then (1) drop candidates whose span
// intersects ground already sounded this tour; (2) among survivors, the
// segment whose ENTRY the driver passed most recently wins; (3) a sounded
// telling's span joins the covered set.
function allCandidates(pos) {
  const out = [];
  for (const segment of bank.CORRIDOR_SEGMENTS) {
    for (let i = 0; i < segment.polyline.length - 1; i++) {
      const a = segment.polyline[i], b = segment.polyline[i + 1];
      const kx = 111320 * Math.cos(a.lat * Math.PI / 180), ky = 110540;
      const px = (pos.lng - a.lng) * kx, py = (pos.lat - a.lat) * ky;
      const bx = (b.lng - a.lng) * kx, by = (b.lat - a.lat) * ky;
      const L2 = bx * bx + by * by; const t = L2 ? Math.max(0, Math.min(1, (px * bx + py * by) / L2)) : 0;
      const d = Math.hypot(px - t * bx, py - t * by);
      if (d > 250) continue;
      const brg = (Math.atan2(bx, by) * 180 / Math.PI + 360) % 360;
      let dd = Math.abs(brg - pos.headingDeg) % 360; if (dd > 180) dd = 360 - dd;
      if (dd > 50) continue;
      out.push({ segment, distanceM: d });
      break;
    }
  }
  return out;
}
function runDesigned(trace, startM, label) {
  const spanCache = new Map();
  const span = (s) => { if (!spanCache.has(s.id)) spanCache.set(s.id, spanOnTrace(s, trace)); return spanCache.get(s.id); };
  const covered = []; const consumed = new Set();
  let busyUntil = -1; const serves = [];
  for (const fix of trace) {
    if (fix.distM < startM || fix.distM < busyUntil) continue;
    const cands = allCandidates(fix)
      .filter(c => !consumed.has(c.segment.id))
      .filter(c => { const sp = span(c.segment); return !covered.some(([a, b]) => sp[0] < b && sp[1] > a); })
      .filter(c => span(c.segment)[0] <= fix.distM + 30);
    if (!cands.length) continue;
    cands.sort((x, y) => (span(y.segment)[0] - span(x.segment)[0]) || (x.distanceM - y.distanceM));
    const seg = cands[0].segment;
    consumed.add(seg.id); covered.push(span(seg));
    busyUntil = fix.distM + OCC_M;
    serves.push({ id: seg.id, name: seg.displayName, atM: Math.round(fix.distM), span: span(seg) });
  }
  return report(label, serves);
}

const { trace, byId } = buildTrace();
const pbSpan = spanOnTrace(byId.get('i-5-sb-pacific-beach-mission-bay'), trace);
const joinM = Math.round((pbSpan[0] + pbSpan[1]) / 2);
console.log(`trace ${trace[trace.length - 1].distM.toFixed(0)}m; PB->MB span ${pbSpan}; mid-join at ${joinM}m`);
runCurrent(trace, 0, 'CURRENT RULES (as committed) — through-driver (enters at La Jolla)');
runCurrent(trace, joinM, 'CURRENT RULES (as committed) — mid-stretch joiner (enters at PB->MB midpoint)');
runDesigned(trace, 0, 'DESIGNED RULE (not shipped) — through-driver');
runDesigned(trace, joinM, 'DESIGNED RULE (not shipped) — mid-stretch joiner');
