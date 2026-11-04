// Route-mode harness (v16.1): pure-function suites for the
// composer, the GPS guards, and the arrival closeout, plus Monte
// Carlo invariants. No live calls anywhere — geocode / Routes /
// Gemini paths are exercised against stub fetches only.
//
// Usage: node scripts/route-mode/run.mjs
// Exit 0 = all checks pass; anything else prints failures.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const out = join(mkdtempSync(join(tmpdir(), 'route-mode-')), 'routeMode.mjs');

execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'esbuild'),
  [
    join(repoRoot, 'src', 'core', 'routeMode.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    `--outfile=${out}`,
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
);

const rm = await import(pathToFileURL(out).href);

// The narration seam module (addendum 5), bundled beside
// routeMode: its text builders are exercised directly by the
// wrap-up / preview suites below.
const rnOut = join(mkdtempSync(join(tmpdir(), 'route-narration-')), 'narration.mjs');
execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'esbuild'),
  [
    join(repoRoot, 'src', 'core', 'narration.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--define:import.meta.env={}',
    `--outfile=${rnOut}`,
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
);
const rn = await import(pathToFileURL(rnOut).href);

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${name}: ${err.message}`);
  }
}
async function checkAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${name}: ${err.message}`);
  }
}

// ---- fixtures: a straight northbound path, stories along it ----
const path = [
  { lat: 32.7, lng: -117.25 },
  { lat: 32.8, lng: -117.25 },
  { lat: 32.9, lng: -117.25 },
];
const dest = { lat: 32.9, lng: -117.25 };
const unit = (id, lat, extra = {}) => ({
  id,
  placeKey: id.split('|')[0],
  placeName: id,
  angle: 'landmark_origin',
  lat,
  lng: -117.25,
  durationSec: 120,
  topics: [],
  tone: 'warm',
  toneSecondary: null,
  audioPath: `x/${id}.wav`,
  storyText: 'word '.repeat(300),
  ...extra,
});
const NOW = Date.parse('2026-11-02T22:00:00-08:00');

// ---- tiling vs time-of-arrival budget ----
check('tiling: arrival budget caps the plan', () => {
  const units = [unit('a|landmark_origin', 32.71), unit('b|landmark_origin', 32.75), unit('c|landmark_origin', 32.85), unit('d|landmark_origin', 32.88)];
  const plan = rm.composeRoutePlan(units, path, dest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: NOW + 300 * 1000, tone: null, topics: [] }, { nowMs: NOW, heardKeys: new Set() });
  assert.equal(plan.budgetSec, 300);
  const stories = plan.items.filter(i => i.kind === 'story');
  assert.ok(stories.length >= 2 && stories.length <= 3, `expected 2-3 stories, got ${stories.length}`);
  assert.ok(plan.totalSec <= 450, `total ${plan.totalSec} exceeds 1.5x budget`);
  // Route order: progress nondecreasing along the plan.
  const progresses = stories.map(s => rm.progressAlongPath({ lat: s.unit.lat, lng: s.unit.lng }, path));
  for (let i = 1; i < progresses.length; i++) assert.ok(progresses[i] >= progresses[i - 1] - 0.02);
});

// ---- topics / tone honored ----
check('tiling: topic matches preferred over non-matches', () => {
  const units = [
    unit('plain|landmark_origin', 32.71),
    unit('food|landmark_origin', 32.72, { topics: ['Food & Drink'] }),
    unit('plain2|landmark_origin', 32.73),
  ];
  const plan = rm.composeRoutePlan(units, path, dest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: ['Food & Drink'] }, { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 10000 });
  assert.equal(plan.topicsMatched, true);
  assert.ok(plan.items.some(i => i.unit?.topics.includes('Food & Drink')));
});
check('tiling: tone match reported', () => {
  const units = [unit('g|landmark_origin', 32.71, { tone: 'spooky' })];
  const plan = rm.composeRoutePlan(units, path, dest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: null, tone: 'spooky', topics: [] }, { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 10000 });
  assert.equal(plan.toneMatched, true);
});

// ---- heard exclusion ----
check('tiling: heard stories never served', () => {
  const units = [unit('heard|landmark_origin', 32.71), unit('fresh|landmark_origin', 32.75)];
  const plan = rm.composeRoutePlan(units, path, dest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] }, { nowMs: NOW, heardKeys: new Set(['heard|landmark_origin']), budgetSecOverride: 10000 });
  assert.equal(plan.skippedHeard, 1);
  assert.ok(!plan.items.some(i => i.id === 'heard|landmark_origin'));
});

// ---- bridge skip-fallback ----
check('bridge skip-fallback: unready bridge drops, stories stay', () => {
  const units = [unit('a|landmark_origin', 32.71), unit('b|landmark_origin', 32.85)];
  const plan = rm.composeRoutePlan(units, path, dest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] }, { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 10000 });
  assert.ok(plan.items.some(i => i.kind === 'bridge'), 'expected a bridge');
  const broken = { ...plan, items: plan.items.map(i => (i.kind === 'bridge' ? { ...i, ready: false } : i)) };
  const fixed = rm.applyBridgeFallback(broken);
  assert.ok(!fixed.items.some(i => i.kind === 'bridge'));
  assert.equal(fixed.items.filter(i => i.kind === 'story').length, 2);
  assert.equal(fixed.totalSec, fixed.items.reduce((s, i) => s + i.durationSec, 0));
});

// ---- off-corridor pause ----
check('guard: off-corridor beyond 200 m, on-corridor within', () => {
  assert.equal(rm.isOffCorridor({ lat: 32.8, lng: -117.25 }, path), false);
  assert.equal(rm.isOffCorridor({ lat: 32.8, lng: -117.22 }, path), true); // ~2.8 km east
  assert.equal(rm.isOffCorridor({ lat: 32.8, lng: -117.252 }, path), false); // ~190 m
});

// ---- arrival closeout + overrun ----
check('closeout: arrival with plan remaining → owed tease', () => {
  const next = unit('next|landmark_origin', 32.88);
  const c = rm.decideCloseout({ arrived: true, planExhausted: false, unplayedPlanUnits: [next], unheardShelfUnits: [] });
  assert.equal(c.kind, 'arrival-owed');
  assert.equal(c.teaseUnitId, 'next|landmark_origin');
  assert.equal(c.freeformTail, false);
  assert.equal(rm.owedLine(c.teaseLabel), 'Miles owes you: next|landmark_origin — next ride.');
});
check('closeout: arrival after exhaustion → sign-off + shelf tease', () => {
  const shelf = unit('shelf|landmark_origin', 32.6);
  const c = rm.decideCloseout({ arrived: true, planExhausted: true, unplayedPlanUnits: [], unheardShelfUnits: [shelf] });
  assert.equal(c.kind, 'arrival-signoff');
  assert.equal(c.teaseUnitId, 'shelf|landmark_origin');
});
check('closeout: plan exhausted before arrival → overrun handoff', () => {
  const c = rm.decideCloseout({ arrived: false, planExhausted: true, unplayedPlanUnits: [], unheardShelfUnits: [] });
  assert.equal(c.kind, 'overrun');
  assert.equal(c.freeformTail, true);
});
check('closeout: mid-plan, not arrived → null (keeps playing)', () => {
  assert.equal(rm.decideCloseout({ arrived: false, planExhausted: false, unplayedPlanUnits: [], unheardShelfUnits: [] }), null);
});
check('closeout: arrival radius + progress', () => {
  assert.equal(rm.hasArrived({ lat: 32.9, lng: -117.25 }, dest, path), true);
  assert.equal(rm.hasArrived({ lat: 32.71, lng: -117.25 }, dest, path), false);
});

// ---- polyline + local parse ----
check('polyline: Google example decodes', () => {
  const pts = rm.decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.equal(pts.length, 3);
  assert.ok(Math.abs(pts[0].lat - 38.5) < 0.001 && Math.abs(pts[0].lng + 120.2) < 0.001);
});
check('local parse: destination, arrival, tone, topics', () => {
  const p = rm.parseRouteInputLocal('drive to Balboa Park by 6:30pm, spooky ghost stories', NOW);
  assert.equal(p.destinationText, 'Balboa Park');
  assert.ok(p.arrivalTimeMs !== null && p.arrivalTimeMs > NOW);
  assert.equal(p.tone, 'spooky');
  assert.ok(p.topics.includes('folklore'));
});

// ---- stubbed live APIs (no network) ----
// Outcome-shaped results + per-key fallback (Nov 3, 2026): the
// bundle's keys carry different API-restriction lists, so each
// maps call walks the configured key list until one answers.
const okPlaces = name => ({
  ok: true,
  status: 200,
  json: async () => ({ places: [{ displayName: { text: name }, location: { latitude: 32.734, longitude: -117.149 }, formattedAddress: 'San Diego, CA' }] }),
});
const okRoute = {
  ok: true,
  status: 200,
  json: async () => ({ routes: [{ distanceMeters: 12000, duration: '900s', polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' } }] }),
};
const blocked = {
  ok: false,
  status: 403,
  json: async () => ({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'Requests to this API are blocked.' } }),
};
const keyOf = opts => opts.headers['X-Goog-Api-Key'];

await checkAsync('geocode: stub fetch parses top candidate', async () => {
  const stub = async () => okPlaces('Balboa Park');
  const g = await rm.geocodeDestination('Balboa Park', ['fake-key'], stub);
  assert.equal(g.failure, null);
  assert.equal(g.destination.name, 'Balboa Park');
  assert.equal(g.destination.location.lat, 32.734);
});
await checkAsync('routes: stub fetch decodes polyline + duration', async () => {
  const stub = async () => okRoute;
  const r = await rm.computeRoute({ lat: 32.7, lng: -117.25 }, dest, ['fake-key'], stub);
  assert.equal(r.failure, null);
  assert.equal(r.route.durationSec, 900);
  assert.equal(r.route.path.length, 3);
});
await checkAsync('geocode: first key 403-blocked → second key succeeds (the NBSD case)', async () => {
  const tried = [];
  const stub = async (url, opts) => {
    tried.push(keyOf(opts));
    return keyOf(opts) === 'places-blocked-key' ? blocked : okPlaces('Naval Base San Diego');
  };
  const g = await rm.geocodeDestination('naval base san diego', ['places-blocked-key', 'working-key'], stub);
  assert.deepEqual(tried, ['places-blocked-key', 'working-key'], 'keys tried in order');
  assert.equal(g.failure, null);
  assert.equal(g.destination.name, 'Naval Base San Diego');
});
await checkAsync('split keys: Places answers on key B, Routes on key A → the build sequence succeeds', async () => {
  // Places (New) is blocked on key A but open on key B; Routes is
  // open on key A. The App passes the same list to both calls;
  // per-call selection must land each on its working key.
  const used = { places: null, routes: null };
  const stub = async (url, opts) => {
    const key = keyOf(opts);
    if (url.includes('places:searchText')) {
      used.places = key;
      return key === 'key-a' ? blocked : okPlaces('Naval Base San Diego');
    }
    used.routes = key;
    return okRoute;
  };
  const g = await rm.geocodeDestination('naval base san diego', ['key-a', 'key-b'], stub);
  assert.equal(g.failure, null);
  assert.equal(used.places, 'key-b');
  const r = await rm.computeRoute({ lat: 32.7, lng: -117.25 }, g.destination.location, ['key-a', 'key-b'], stub);
  assert.equal(r.failure, null);
  assert.equal(used.routes, 'key-a', 'routes succeeded on the first key — no need to walk');
  assert.equal(r.route.durationSec, 900);
});
await checkAsync('geocode: all keys blocked → permission failure class (never "no results")', async () => {
  const stub = async () => blocked;
  const g = await rm.geocodeDestination('naval base san diego', ['key-a', 'key-b'], stub);
  assert.equal(g.destination, null);
  assert.equal(g.failure, 'permission');
  const r = await rm.computeRoute({ lat: 32.7, lng: -117.25 }, dest, ['key-a', 'key-b'], stub);
  assert.equal(r.route, null);
  assert.equal(r.failure, 'permission');
});
await checkAsync('geocode: an answering key with zero places is definitive no_results (later keys untried)', async () => {
  let calls = 0;
  const stub = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({ places: [] }) };
  };
  const g = await rm.geocodeDestination('the middle of nowhere', ['key-a', 'key-b'], stub);
  assert.equal(g.destination, null);
  assert.equal(g.failure, 'no_results');
  assert.equal(calls, 1, 'a definitive empty answer does not burn more keys');
});
await checkAsync('geocode: no keys configured → no_keys, fetch never called', async () => {
  const stub = async () => {
    throw new Error('must not be called');
  };
  const g = await rm.geocodeDestination('Balboa Park', [], stub);
  assert.equal(g.destination, null);
  assert.equal(g.failure, 'no_keys');
  const r = await rm.computeRoute({ lat: 32.7, lng: -117.25 }, dest, ['', '  '], stub);
  assert.equal(r.route, null);
  assert.equal(r.failure, 'no_keys');
});

// ---- ride-duration budget (Nov 3, 2026: Arrive-by removed) ----
check('budget: the Routes drive estimate is the sole source', () => {
  assert.equal(rm.budgetSecFor(1440), 1440);
  assert.equal(rm.budgetSecFor(20), 60, 'floor of one minute');
  assert.equal(rm.budgetSecFor(null), 1800, 'no estimate → 30-minute tile');
});
check('budget: a caller drive budget overrides any parsed arrival time', () => {
  const units = [unit('a|landmark_origin', 32.71), unit('b|landmark_origin', 32.75)];
  const plan = rm.composeRoutePlan(units, path, dest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: NOW + 3600 * 1000, tone: null, topics: [] }, { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: rm.budgetSecFor(600) });
  assert.equal(plan.budgetSec, 600, 'drive budget wins over the (parser-only) arrival time');
});
check('ride estimate line: plain words for the building state', () => {
  assert.equal(rm.rideEstimateLine(1440), 'About 24 minutes of driving — Miles will fill the ride.');
  assert.equal(rm.rideEstimateLine(3900), 'About 1 hour 5 minutes of driving — Miles will fill the ride.');
  assert.equal(rm.rideEstimateLine(45), 'About 1 minute of driving — Miles will fill the ride.');
});
await checkAsync('gemini parse: failure falls back to local parse', async () => {
  const failing = async () => {
    throw new Error('no network in harness');
  };
  const p = await rm.parseRouteInput('to Balboa Park by 6pm', NOW, 'fake-key', failing);
  assert.equal(p.destinationText, 'Balboa Park');
  assert.ok(p.arrivalTimeMs !== null);
});

// ---- composer v2 (Nov 3, 2026): fairness, weighting, openers, portals, windows, elastic bridges ----
// A dense path (21 points) so progress is fine-grained; on the
// 3-point fixture every point collapses to a segment midpoint.
const densePath = Array.from({ length: 21 }, (_, i) => ({ lat: 32.7 + i * 0.01, lng: -117.25 }));
const denseDest = { lat: 32.9, lng: -117.25 };
const storyItems = plan => plan.items.filter(i => i.kind === 'story');

check('v2 fairness: dense start cannot crowd out later buckets', () => {
  const units = [];
  for (let i = 0; i < 10; i++) units.push(unit(`dense${i}|landmark_origin`, 32.7 + i * 0.001));
  units.push(unit('mid|landmark_origin', 32.81));
  units.push(unit('end|landmark_origin', 32.895));
  const plan = rm.composeRoutePlan(units, densePath, denseDest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: NOW + 370 * 1000, tone: null, topics: [] }, { nowMs: NOW, heardKeys: new Set() });
  const ids = storyItems(plan).map(i => i.id);
  assert.ok(ids.includes('mid|landmark_origin'), 'mid-route bucket contributed');
  assert.ok(ids.includes('end|landmark_origin'), 'final bucket contributed');
  assert.ok(ids.filter(id => id.startsWith('dense')).length <= 2, `early bucket took ${ids.filter(id => id.startsWith('dense')).length} slots`);
});

check('v2 fetch fairness: selectFetchCandidates round-robins buckets under the bound', () => {
  const entries = [];
  for (let i = 0; i < 30; i++) entries.push({ place_key: `geo${i}`, angle: 'landmark_origin', lat: 32.7005 + i * 0.0003, lng: -117.25 });
  for (let i = 0; i < 5; i++) entries.push({ place_key: `late${i}`, angle: 'landmark_origin', lat: 32.845 + i * 0.0002, lng: -117.25 });
  entries.push({ place_key: 'port1', angle: 'landmark_origin', lat: 32.8, lng: -117.05 });
  entries.push({ place_key: 'port2', angle: 'landmark_origin', lat: 32.8, lng: -117.05 });
  const tagsOf = pk => ({ topics: pk === 'port2' ? ['Sport'] : ['Coast'] });
  const picked = rm.selectFetchCandidates(entries, densePath, denseDest, tagsOf, { geoLimit: 12 });
  const geoPicked = picked.filter(e => e.place_key.startsWith('geo') || e.place_key.startsWith('late'));
  assert.equal(geoPicked.length, 12);
  assert.equal(geoPicked.filter(e => e.place_key.startsWith('late')).length, 5, 'all late-bucket entries made the bounded cut');
  assert.ok(picked.some(e => e.place_key === 'port1'), 'topic-connected portal candidate fetched');
  assert.ok(!picked.some(e => e.place_key === 'port2'), 'unconnected portal candidate not fetched');
});

check('v2 weighting: landmark beats corridor at the same anchor (no user topics)', () => {
  const units = [unit('corr|corridor', 32.75, { angle: 'corridor' }), unit('mark|landmark_origin', 32.75)];
  const tight = rm.composeRoutePlan(units, path, dest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: NOW + 130 * 1000, tone: null, topics: [] }, { nowMs: NOW, heardKeys: new Set() });
  assert.deepEqual(storyItems(tight).map(i => i.id), ['mark|landmark_origin']);
  const wide = rm.composeRoutePlan(units, path, dest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] }, { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000 });
  assert.deepEqual(storyItems(wide).map(i => i.id), ['mark|landmark_origin', 'corr|corridor']);
});

check('v2 openers: chapter heads cap at 3 and precede their area stories', () => {
  const units = [];
  [32.72, 32.77, 32.82, 32.87].forEach((lat, i) => {
    units.push(unit(`area${i + 1}|neighborhood_intro`, lat, { angle: 'neighborhood_intro', durationSec: 60 }));
    units.push(unit(`story${i + 1}|landmark_origin`, lat + 0.005));
  });
  const plan = rm.composeRoutePlan(units, densePath, denseDest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] }, { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000 });
  const openers = plan.items.filter(i => i.opener);
  assert.equal(openers.length, 3, 'opener cap is 3 per plan');
  for (const op of openers) {
    const at = plan.items.indexOf(op);
    const nextStory = plan.items.slice(at + 1).find(i => i.kind === 'story');
    assert.ok(nextStory && nextStory.anchorProgress >= op.anchorProgress - 0.001, 'opener precedes its area story');
  }
});

check('v2 openers: heard intro is excluded, cap does not bind the rest', () => {
  const units = [];
  [32.72, 32.77, 32.82, 32.87].forEach((lat, i) => {
    units.push(unit(`area${i + 1}|neighborhood_intro`, lat, { angle: 'neighborhood_intro', durationSec: 60 }));
    units.push(unit(`story${i + 1}|landmark_origin`, lat + 0.005));
  });
  const plan = rm.composeRoutePlan(units, densePath, denseDest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] }, { nowMs: NOW, heardKeys: new Set(['area2|neighborhood_intro']), budgetSecOverride: 100000 });
  const openerIds = plan.items.filter(i => i.opener).map(i => i.id);
  assert.deepEqual(openerIds, ['area1|neighborhood_intro', 'area3|neighborhood_intro', 'area4|neighborhood_intro']);
});

const portalUnits = heardP1 => {
  const units = [
    unit('g1|landmark_origin', 32.72, { topics: ['Coast'] }),
    unit('g2|landmark_origin', 32.77, { topics: ['Food & Drink', 'Coast'] }),
    unit('g3|landmark_origin', 32.82, { topics: ['Coast'] }),
    unit('g4|landmark_origin', 32.87, { topics: ['Sport'] }),
    unit('p1|landmark_origin', 32.8, { lng: -117.05, topics: ['Food & Drink', 'Coast'] }),
    unit('p2|landmark_origin', 32.8, { lng: -117.05, topics: ['Coast'] }),
    unit('p3|landmark_origin', 32.8, { lng: -117.05, topics: ['Music'] }),
  ];
  const heard = new Set(heardP1 ? ['p1|landmark_origin'] : []);
  return rm.composeRoutePlan(units, densePath, denseDest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] }, { nowMs: NOW, heardKeys: heard, budgetSecOverride: 100000 });
};
check('v2 portals: cap ≤25%, best connection wins, portal directly follows its parent', () => {
  const plan = portalUnits(false);
  const stories = storyItems(plan);
  const portals = plan.items.filter(i => i.portal);
  assert.equal(portals.length, 1, 'floor(4 geo / 3) = 1 portal');
  assert.ok(portals.length / stories.length <= 0.25, 'portal share within cap');
  assert.equal(portals[0].id, 'p1|landmark_origin');
  assert.equal(portals[0].portalParentId, 'g2|landmark_origin');
  const storyOrder = stories.map(i => i.id);
  assert.equal(storyOrder.indexOf('p1|landmark_origin'), storyOrder.indexOf('g2|landmark_origin') + 1, 'portal directly follows parent among stories');
  assert.ok(!plan.items.some(i => i.id === 'p3|landmark_origin'), 'unconnected candidate never hops');
});
check('v2 portals: heard portal candidate is never picked', () => {
  const plan = portalUnits(true);
  const portals = plan.items.filter(i => i.portal);
  assert.equal(portals.length, 1);
  assert.equal(portals[0].id, 'p2|landmark_origin');
  assert.equal(portals[0].portalParentId, 'g1|landmark_origin');
  assert.ok(!plan.items.some(i => i.id === 'p1|landmark_origin'), 'heard portal absent entirely');
});

check('v2 windows: storyWindow math + composer stamps the window on story items', () => {
  const w = rm.storyWindow(0.5, 120, 1000);
  assert.ok(Math.abs(w.release - 0.48) < 1e-9 && Math.abs(w.expire - 0.62) < 1e-9, `window ${JSON.stringify(w)}`);
  const plan = rm.composeRoutePlan([unit('w|landmark_origin', 32.8)], densePath, denseDest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] }, { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 1000 });
  const item = storyItems(plan)[0];
  assert.ok(item.releaseProgress >= 0.43 && item.releaseProgress <= 0.48, `release ${item.releaseProgress}`);
  assert.ok(item.expireProgress >= 0.57 && item.expireProgress <= 0.62, `expire ${item.expireProgress}`);
});

check('v2 bridges: elastic target follows the anchor gap', () => {
  const far = rm.composeRoutePlan(
    [unit('f1|landmark_origin', 32.71, { durationSec: 60 }), unit('f2|landmark_origin', 32.85, { durationSec: 60 })],
    densePath, denseDest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] },
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 2000 },
  );
  const farBridge = far.items.find(i => i.kind === 'bridge');
  assert.equal(farBridge.targetDurationSec, 90, 'long gap clamps to the bridge ceiling');
  assert.ok(farBridge.durationSec >= 40, `elastic text composed toward the target (got ${farBridge.durationSec}s)`);
  const near = rm.composeRoutePlan(
    [unit('n1|landmark_origin', 32.71, { durationSec: 60 }), unit('n2|landmark_origin', 32.715, { durationSec: 60 })],
    densePath, denseDest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] },
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 2000 },
  );
  const nearBridge = near.items.find(i => i.kind === 'bridge');
  assert.ok(nearBridge.targetDurationSec <= 25, `short gap target ${nearBridge.targetDurationSec}`);
  assert.ok(nearBridge.durationSec < farBridge.durationSec, 'elastic bridges actually differ in length');
});

// ---- through-line (route differentiator 2, Nov 3, 2026): thread
// detection, the rank nudge, the reserved climax, bridge contexts
// (the first bridge is the spoken episode preview), the
// "Previously on Miles" nod, and the closeout thread wrap ----
const navy = (id, lat, extra = {}) => unit(id, lat, { topics: ['Navy Century'], ...extra });
const noTopics = { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] };
const composeDense = (units, input = noTopics, opts = {}) =>
  rm.composeRoutePlan(units, densePath, denseDest, 'Dest', input, {
    nowMs: NOW,
    heardKeys: new Set(),
    budgetSecOverride: 100000,
    driveSec: 2000,
    ...opts,
  });

check('thread: three members along the path sustain a thread', () => {
  const plan = composeDense([navy('n1|landmark_origin', 32.72), navy('n2|landmark_origin', 32.76), navy('n3|landmark_origin', 32.82)]);
  assert.equal(plan.thread?.topic, 'Navy Century');
  assert.deepEqual([...plan.thread.memberIds].sort(), ['n1|landmark_origin', 'n2|landmark_origin', 'n3|landmark_origin']);
  assert.equal(plan.thread.score, 3);
});
check('thread: two members do not reach the threshold', () => {
  const plan = composeDense([navy('n1|landmark_origin', 32.72), navy('n2|landmark_origin', 32.76), unit('x|landmark_origin', 32.82)]);
  assert.equal(plan.thread, null);
  assert.equal(rm.detectRouteThread([navy('a|landmark_origin', 32.72), navy('b|landmark_origin', 32.76)], []), null);
});
check('thread (addendum 4): members count once each, wherever they sit — no destination weighting', () => {
  const shore = navy('shore|landmark_origin', 32.75);
  const gate = navy('gate|landmark_origin', 32.895); // ~550 m from the pin — worth 1 now, not 2
  assert.equal(rm.detectRouteThread([shore, gate], []), null, 'two members are two members, even at the destination');
  const mid = rm.detectRouteThread(
    [navy('a|landmark_origin', 32.72), navy('b|landmark_origin', 32.76), navy('c|landmark_origin', 32.8)],
    [],
  );
  assert.ok(mid, 'three members ending mid-corridor sustain a thread');
  assert.equal(mid.score, 3);
  const plan = composeDense([navy('n1|landmark_origin', 32.72), navy('n2|landmark_origin', 32.76), navy('n3|landmark_origin', 32.8)]);
  assert.equal(plan.thread?.topic, 'Navy Century', 'a thread with no destination member is used, not discarded');
});
check('thread: a user-chosen topic wins over a stronger unpicked thread', () => {
  const units = [
    unit('c1|landmark_origin', 32.72, { topics: ['Coast'] }),
    unit('c2|landmark_origin', 32.76, { topics: ['Coast'] }),
    unit('c3|landmark_origin', 32.8, { topics: ['Coast'] }),
    unit('f1|landmark_origin', 32.73, { topics: ['Food & Drink'] }),
    unit('f2|landmark_origin', 32.77, { topics: ['Food & Drink'] }),
    unit('f3|landmark_origin', 32.81, { topics: ['Food & Drink'] }),
    unit('f4|landmark_origin', 32.84, { topics: ['Food & Drink'] }),
  ];
  const plan = composeDense(units, { ...noTopics, topics: ['Coast', 'Food & Drink'] });
  assert.equal(plan.thread?.topic, 'Coast', "the user's first qualifying pick wins");
});
check('thread: topics picked but none qualify → no forced theme', () => {
  const units = [unit('c1|landmark_origin', 32.72, { topics: ['Coast'] }), unit('c2|landmark_origin', 32.76, { topics: ['Coast'] }), unit('c3|landmark_origin', 32.8, { topics: ['Coast'] })];
  const forced = composeDense(units, { ...noTopics, topics: ['Sport'] });
  assert.equal(forced.topicsMatched, false);
  assert.equal(forced.thread, null, 'a qualifying unpicked thread is not substituted');
  const free = composeDense(units);
  assert.equal(free.thread?.topic, 'Coast', 'the same shelf threads freely when nothing was picked');
});
check('thread: membership nudges selection inside a bucket (landmark class does not outrank the thread)', () => {
  // plain + member share one progress segment (same bucket, same
  // anchor); maxStories leaves room for only one of them.
  const threaded = composeDense(
    [
      unit('plain|landmark_origin', 32.721),
      unit('member|corridor', 32.724, { topics: ['Navy Century'] }),
      navy('m2|landmark_origin', 32.76),
      navy('m3|landmark_origin', 32.82),
    ],
    noTopics,
    { maxStories: 3 },
  );
  const threadedIds = storyItems(threaded).map(s => s.id);
  assert.ok(threadedIds.includes('member|corridor'), 'the thread member wins its bucket');
  assert.ok(!threadedIds.includes('plain|landmark_origin'), 'the non-member yields under the cap');
  const control = composeDense(
    [
      unit('plain|landmark_origin', 32.721),
      unit('member|corridor', 32.724),
      unit('m2|landmark_origin', 32.76),
      unit('m3|landmark_origin', 32.82),
    ],
    noTopics,
    { maxStories: 3 },
  );
  assert.equal(control.thread, null);
  const controlIds = storyItems(control).map(s => s.id);
  assert.ok(controlIds.includes('plain|landmark_origin'), 'without a thread, angle class decides as in v2');
  assert.ok(!controlIds.includes('member|corridor'));
});
check('climax (addendum 4): the destination-strongest case — an unheard destination flagship wins and sequences last', () => {
  const units = [
    unit('m1|landmark_origin', 32.72),
    unit('m2|landmark_origin', 32.78),
    unit('hq|landmark_origin', 32.887, { durationSec: 300 }),
    unit('annex|landmark_origin', 32.897),
  ];
  const plan = composeDense(units);
  assert.equal(plan.climaxUnitId, 'hq|landmark_origin');
  assert.equal(plan.climaxMode, 'destination');
  assert.equal(plan.climaxSubject, 'hq|landmark_origin');
  assert.equal(plan.climaxDistanceKm, null, 'an in-corridor climax carries no off-route distance');
  assert.equal(plan.portalClimaxSeeking, null, 'no thread and no chosen topic → the portal slot never opens');
  const stories = storyItems(plan);
  const last = stories[stories.length - 1];
  assert.equal(last.id, 'hq|landmark_origin', 'the flagship closes the plan, not the later-anchored annex');
  assert.equal(last.climax, true);
  assert.ok(last.anchorProgress >= 0.75, `flagship anchored in the final stretch (got ${last.anchorProgress})`);
  assert.ok(last.releaseProgress >= 0.7, 'its window opens in the approach');
  assert.ok(!stories.some(s => s.climax && s.id !== 'hq|landmark_origin'), 'exactly one climax');
});
check('climax (addendum 4): sequencing-infeasible → natural order + mode natural (coverage beats drama)', () => {
  const loopPath = [
    { lat: 32.7, lng: -117.25 },
    { lat: 32.9, lng: -117.25 },
    { lat: 32.78, lng: -117.2 },
  ];
  const loopDest = { lat: 32.9, lng: -117.25 };
  const hq = unit('hq|landmark_origin', 32.895, { durationSec: 300 });
  hq.lng = -117.25;
  const late = unit('late|landmark_origin', 32.8, {});
  late.lng = -117.2;
  const released = rm.composeRoutePlan([hq, late], loopPath, loopDest, 'Dest', noTopics, {
    nowMs: NOW,
    heardKeys: new Set(),
    budgetSecOverride: 100000,
    driveSec: 2000,
  });
  assert.equal(released.climaxUnitId, 'hq|landmark_origin', 'the winner is still named');
  assert.equal(released.climaxMode, 'natural', 'but nothing was repositioned');
  const stories = storyItems(released);
  assert.equal(stories[stories.length - 1].id, 'late|landmark_origin', 'natural order kept — the winner stays on its own early ground');
  assert.equal(stories.find(s => s.id === 'hq|landmark_origin').climax, true, 'the winner carries the climax mark in every mode');
  // Control: one more early story and the same geometry sequences it last.
  const mid = unit('mid|landmark_origin', 32.78, {});
  const held = rm.composeRoutePlan([hq, mid, late], loopPath, loopDest, 'Dest', noTopics, {
    nowMs: NOW,
    heardKeys: new Set(),
    budgetSecOverride: 100000,
    driveSec: 2000,
  });
  assert.equal(held.climaxMode, 'destination');
  assert.equal(storyItems(held)[storyItems(held).length - 1].id, 'hq|landmark_origin');
});
check('climax (addendum 4): commute-shaped — the destination shelf is heard out, so the strongest late-corridor story closes', () => {
  const units = [
    unit('home|landmark_origin', 32.72),
    unit('mid|landmark_origin', 32.78),
    unit('lateweak|corridor', 32.85, { angle: 'corridor' }),
    unit('late|landmark_origin', 32.87, { durationSec: 300 }),
    unit('tail|corridor', 32.88, { angle: 'corridor', durationSec: 60 }),
    unit('work1|landmark_origin', 32.895),
    unit('work2|landmark_origin', 32.897),
  ];
  const plan = composeDense(units, noTopics, {
    heardKeys: new Set(['work1|landmark_origin', 'work2|landmark_origin']),
  });
  assert.equal(plan.climaxUnitId, 'late|landmark_origin', 'the late landmark beats the later corridor tail on weight');
  assert.equal(plan.climaxMode, 'late');
  assert.equal(plan.climaxSubject, 'late|landmark_origin');
  const stories = storyItems(plan);
  assert.equal(stories[stories.length - 1].id, 'late|landmark_origin', 'sequenced last, past the tail that anchors later');
  assert.equal(stories[stories.length - 1].climax, true);
  assert.ok(!stories.some(s => s.id.startsWith('work')), 'heard destination units never enter the plan');
});
check('climax (consolidation §3 — the fit cut): declared tone/topics no longer bend the pick — standing weight decides', () => {
  const units = [
    unit('open|landmark_origin', 32.72),
    unit('heavy|landmark_origin', 32.85, { durationSec: 320, topics: ['Coast'], tone: 'warm' }),
    unit('fit|corridor', 32.87, { angle: 'corridor', durationSec: 300, topics: ['Coast'], tone: 'light' }),
  ];
  const declared = composeDense(units, { ...noTopics, tone: 'light', topics: ['Coast'] });
  assert.equal(
    declared.climaxUnitId,
    'heavy|landmark_origin',
    'the fitting corridor story no longer outranks the heavier landmark — the fit-term is gone',
  );
  assert.equal(declared.climaxMode, 'late');
  const undeclared = composeDense(units);
  assert.equal(undeclared.climaxUnitId, 'heavy|landmark_origin', 'declared or not, the same winner — addendum 4 parity');
  assert.ok(
    !('climaxFit' in declared) && !('bookend' in declared) && !('bookendTopic' in declared),
    'the plan shape carries no fit/pairing fields at all',
  );
});
check('preview (addendum 4 + consolidation §2): a threaded plan promises its late-corridor climax by name — in the preview item', () => {
  const units = [
    navy('n1|landmark_origin', 32.72),
    navy('n2|landmark_origin', 32.78),
    navy('n3|landmark_origin', 32.84),
    unit('tail|corridor', 32.88, { angle: 'corridor', durationSec: 60 }),
  ];
  const plan = composeDense(units);
  assert.equal(plan.thread?.topic, 'Navy Century');
  assert.equal(plan.climaxUnitId, 'n3|landmark_origin');
  assert.equal(plan.climaxMode, 'late');
  assert.equal(storyItems(plan)[storyItems(plan).length - 1].id, 'n3|landmark_origin', 'the climax sequences past the later tail');
  const preview = plan.items.find(i => i.kind === 'preview');
  assert.ok(preview, 'the plan carries a preview item');
  assert.equal(plan.items[0], preview, 'the preview item stands first, before the departure story');
  assert.ok(preview.text.includes("I'll tell you about n3|landmark_origin"), 'the preview teases the actual (late) climax');
  assert.ok(
    !plan.items.some(i => i.kind === 'bridge' && i.text.includes("I'll tell you about")),
    'no bridge carries the preview’s job anymore — bridges are pair-connective only',
  );
});
check('narration seam (addendum 5): route logic never reaches the generation layer directly — one seam, stubbed once', () => {
  const read = p => readFileSync(join(repoRoot, p), 'utf8');
  for (const p of ['src/core/routeMode.ts', 'src/core/routePlayback.ts', 'src/core/routeGapFill.ts']) {
    const src = read(p);
    assert.ok(!src.includes("from './gemini'"), `${p} must not import the generation layer`);
    assert.ok(!/synthesizeSpeech\(|generateStoryText\(/.test(src), `${p} must not call generation directly — deps only`);
  }
  const narration = read('src/core/narration.ts');
  assert.ok(narration.includes('export function bridgeTextFor'), 'bridge text is authored in the narration layer');
  assert.ok(narration.includes('export function wrapUpTextFor'), 'wrap-up text is authored in the narration layer');
  assert.ok(!read('src/core/routeMode.ts').includes('export function bridgeTextFor'), 'routeMode composes facts; it does not author narration');
  assert.ok(read('src/App.tsx').includes('const narration: NarrationDeps'), 'the App builds ONE narration deps object per route build');
});
check('no-thread parity: story order and EVERY bridge are exactly composer v2 — the preview item carries the framing', () => {
  const units = [
    unit('a|landmark_origin', 32.72),
    unit('b|landmark_origin', 32.76, { topics: ['Coast'] }),
    unit('c|landmark_origin', 32.8, { topics: ['Coast'] }),
    unit('d|landmark_origin', 32.86),
  ];
  const plan = composeDense(units);
  assert.equal(plan.thread, null, 'two Coast members are below the thread threshold');
  const stories = storyItems(plan);
  const anchors = stories.map(s => s.anchorProgress);
  for (let i = 1; i < anchors.length; i++) assert.ok(anchors[i] >= anchors[i - 1], 'story order is progress order, as in v2');
  const bridges = plan.items.filter(i => i.kind === 'bridge');
  assert.ok(bridges.length >= 2, 'fixture carries several bridges');
  bridges.forEach((b, idx) => {
    const prev = units.find(u => u.id === b.prevUnitId);
    const next = units.find(u => u.id === b.nextUnitId);
    const baseline = rm.bridgeTextFor(prev, next, { targetSec: b.targetDurationSec });
    assert.equal(b.text, baseline, `bridge ${idx} is byte-identical to the context-free v2 bridge`);
  });
  const preview = plan.items.find(i => i.kind === 'preview');
  assert.ok(preview, 'the plan still opens with its framing — as an item now');
  assert.ok(preview.text.includes('stories between here and there'), 'no-thread preview states the story count');
  assert.ok(preview.text.includes('the last of them is'), 'no-thread preview names the closing story');
});
check('preview (thread): the preview item names the thread, the destination, the closing story, and one mid-drive hook', () => {
  const units = [
    navy('n1|landmark_origin', 32.72),
    navy('n2|landmark_origin', 32.78),
    navy('n3|landmark_origin', 32.84),
    navy('hq|landmark_origin', 32.887, { durationSec: 300 }),
  ];
  const plan = composeDense(units);
  assert.equal(plan.thread?.topic, 'Navy Century');
  const preview = plan.items.find(i => i.kind === 'preview');
  assert.ok(preview.text.includes('Navy Century'), 'preview names the thread');
  assert.ok(preview.text.includes('reach Dest'), 'preview names the destination');
  assert.ok(preview.text.includes('hq|landmark_origin'), 'preview teases the closing flagship by subject');
  assert.ok(preview.text.includes('halfway there'), 'preview hooks one mid-drive subject');
  assert.ok(preview.text.includes('n2|landmark_origin'), 'the hook is the mid-drive story');
  const payoff = plan.items.filter(i => i.kind === 'bridge').find(b => b.nextUnitId === 'hq|landmark_origin');
  assert.ok(payoff, 'a bridge leads into the flagship');
  assert.ok(payoff.text.includes('I pointed at this one when we set out'), 'the bridge into the flagship pays off the preview promise');
});
check('bridge/preview contexts: bridge facts name only the pair and earlier items; the preview context is the one whole-plan view', () => {
  const u1 = navy('u1|landmark_origin', 32.72);
  const u2 = navy('u2|landmark_origin', 32.76);
  const u3 = navy('u3|landmark_origin', 32.8);
  const u4 = navy('u4|landmark_origin', 32.86);
  const thread = { topic: 'Navy Century', memberIds: [u1.id, u2.id, u3.id, u4.id], score: 4 };
  const mid = rm.buildBridgeContext({ earlier: [u1, u2], prev: u2, next: u3, thread, isClimaxBridge: false, promiseMade: true });
  assert.equal(mid.role, 'mid');
  assert.ok(mid.callbackSubject === u1.placeName || mid.callbackSubject === u2.placeName, 'callback is an earlier item');
  assert.ok(!JSON.stringify(mid).includes(u4.placeName), 'a later item never appears in a bridge context');
  assert.equal(mid.offRouteSubject, undefined, 'no off-route flag on an ordinary bridge');
  const payoff = rm.buildBridgeContext({
    earlier: [u1, u2, u3],
    prev: u3,
    next: u4,
    thread,
    isClimaxBridge: true,
    climaxLast: true,
    promiseMade: true,
    offRoute: true,
  });
  assert.equal(payoff.role, 'payoff');
  assert.equal(payoff.offRouteSubject, u4.placeName, 'the off-route flag names the climax subject');
  const preview = rm.buildPreviewContext({
    thread,
    destinationName: 'Dest',
    storyCount: 4,
    closing: u4,
    climax: { subject: u4.placeName, mode: 'late', sequenced: true },
    mid: null,
  });
  assert.equal(preview.closingSubject, u4.placeName, 'the preview names the closing story by design');
  assert.equal(preview.previouslyHeardSubject, undefined, 'no nod without heard input');
  const nod = rm.buildPreviewContext({
    thread,
    destinationName: 'Dest',
    storyCount: 4,
    closing: u4,
    climax: null,
    mid: null,
    previouslyHeardSubject: 'Old Fort',
  });
  assert.equal(nod.previouslyHeardSubject, 'Old Fort', 'the nod appears only when the heard input carries it');
  assert.equal(
    rm.buildPreviewContext({ thread: null, destinationName: 'Dest', storyCount: 0, closing: null, climax: null, mid: null }),
    null,
    'no closing story → no preview context',
  );
});
check('previously on Miles: the nod names a real heard subject on this ground — and only then', () => {
  const heardOnRoute = unit('old|landmark_origin', 32.8);
  const heardOffRoute = unit('far|landmark_origin', 32.8, { lng: -117.05 });
  const fresh = [navy('n1|landmark_origin', 32.72), navy('n2|landmark_origin', 32.78), navy('n3|landmark_origin', 32.84)];
  const withNod = composeDense([...fresh, heardOnRoute], noTopics, { heardKeys: new Set(['old|landmark_origin']) });
  const previewItem = withNod.items.find(i => i.kind === 'preview');
  assert.ok(previewItem.text.includes('Last time we came this way'), 'the preview item carries the continuity nod');
  assert.ok(previewItem.text.includes('old|landmark_origin'), 'the nod names the heard subject');
  const noNod = composeDense([...fresh, heardOffRoute], noTopics, { heardKeys: new Set(['far|landmark_origin']) });
  assert.ok(!noNod.items.some(i => i.text && i.text.includes('Last time we came this way')), 'a heard subject off this ground earns no nod');
  const clean = composeDense(fresh);
  assert.ok(!clean.items.some(i => i.text && i.text.includes('Last time we came this way')), 'no heard input, no nod — never invented');
});
check('previously on Miles: a destination-area heard subject is the nod when several qualify', () => {
  const corridorHeard = unit('corridor-old|landmark_origin', 32.74);
  const destHeard = unit('dest-old|landmark_origin', 32.89);
  const fresh = [navy('n1|landmark_origin', 32.72), navy('n2|landmark_origin', 32.78), navy('n3|landmark_origin', 32.84)];
  const plan = composeDense([...fresh, corridorHeard, destHeard], noTopics, {
    heardKeys: new Set(['corridor-old|landmark_origin', 'dest-old|landmark_origin']),
  });
  const previewItem = plan.items.find(i => i.kind === 'preview');
  assert.ok(previewItem.text.includes('dest-old|landmark_origin'), 'the destination-area subject carries the nod');
  assert.ok(!previewItem.text.includes('corridor-old|landmark_origin'), 'exactly one nod subject');
});
check('closeout accounting (post addendum 3): kinds and owed tease are exactly as before', () => {
  const owed = rm.decideCloseout({ arrived: true, planExhausted: false, unplayedPlanUnits: [unit('z|landmark_origin', 32.88)], unheardShelfUnits: [] });
  assert.equal(owed.kind, 'arrival-owed');
  assert.equal(owed.teaseUnitId, 'z|landmark_origin', 'the owed tease proceeds as usual');
  assert.equal(owed.threadLine, undefined, 'the played-count thread wrap is gone — the wrap-up replaced it');
});
check('gist: first sentence, capped; no text, no gist', () => {
  assert.equal(rm.storyGist(unit('g|landmark_origin', 32.7, { storyText: 'First sentence here. Second follows.' })), 'First sentence here.');
  assert.equal(rm.storyGist(unit('g|landmark_origin', 32.7, { storyText: null })), null);
});

// ---- Monte Carlo invariants ----
check('monte carlo: 200 random plans hold the invariants', () => {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const angleCycle = ['landmark_origin', 'landmark_origin', 'landmark_origin', 'corridor', 'neighborhood_intro'];
  const topicSets = [[], ['Coast'], ['Food & Drink'], ['Coast', 'Food & Drink']];
  for (let iter = 0; iter < 200; iter++) {
    const n = 5 + Math.floor(rnd() * 25);
    const units = [];
    for (let i = 0; i < n; i++) {
      const angle = angleCycle[Math.floor(rnd() * angleCycle.length)];
      const offPath = rnd() < 0.25;
      units.push(
        unit(`u${i}|${angle}`, 32.7 + rnd() * 0.2, {
          angle,
          lng: offPath ? -117.05 : -117.25,
          durationSec: 60 + Math.floor(rnd() * 240),
          topics: topicSets[Math.floor(rnd() * topicSets.length)],
          tone: rnd() < 0.5 ? 'warm' : 'light',
        }),
      );
    }
    const heard = new Set(units.filter(() => rnd() < 0.2).map(u => u.id));
    const budget = 300 + Math.floor(rnd() * 1800);
    const plan = rm.composeRoutePlan(
      units,
      path,
      dest,
      'Dest',
      { destinationText: 'Dest', arrivalTimeMs: NOW + budget * 1000, tone: 'warm', topics: ['Food & Drink'] },
      { nowMs: NOW, heardKeys: heard },
    );
    for (const it of plan.items) {
      if (it.kind === 'story') assert.ok(!heard.has(it.id), `heard unit served: ${it.id}`);
      if (it.kind === 'bridge') {
        assert.ok(it.text && it.text.includes('From '), 'bridge must be pair-specific text');
      }
    }
    assert.equal(plan.totalSec, plan.items.reduce((s, i) => s + i.durationSec, 0));
    const stories = plan.items.filter(i => i.kind === 'story').length;
    const reactions = plan.items.filter(i => i.kind === 'reaction').length;
    assert.ok(reactions <= Math.ceil(stories / 3), `too many reactions: ${reactions} for ${stories} stories`);
    const bridges = plan.items.filter(i => i.kind === 'bridge').length;
    assert.ok(bridges <= Math.max(0, stories - 1), 'bridge count exceeds story pairs');
    // v2 invariants: portal share + adjacency, opener cap.
    const portals = plan.items.filter(i => i.portal);
    assert.ok(portals.length / Math.max(1, stories) <= 0.25, `portal share ${portals.length}/${stories} exceeds 25%`);
    for (const p of portals) {
      const at = plan.items.indexOf(p);
      const prevStory = [...plan.items.slice(0, at)].reverse().find(i => i.kind === 'story');
      assert.ok(prevStory && prevStory.id === p.portalParentId, 'portal does not directly follow its parent');
    }
    assert.ok(plan.items.filter(i => i.opener).length <= 3, 'chapter opener cap exceeded');
  }
});

// ---- phase 2: Q&A behind the declared mode (Nov 3, 2026) ----
// Gate truth table — the App-layer composition both tour types
// mount under: (a) driving exposes no Q&A; (d) flag-off exposes
// none regardless of mode; passenger + flag is the only open cell.
check('qa gate: driving mode is closed', () => {
  assert.equal(rm.routeQaAvailable('driving'), false);
  assert.equal(rm.qaGateOpen(true, 'driving'), false);
});
check('qa gate: flag off is closed regardless of mode', () => {
  assert.equal(rm.qaGateOpen(false, 'passenger'), false);
  assert.equal(rm.qaGateOpen(false, 'driving'), false);
});
check('qa gate: passenger + flag on is the only open cell', () => {
  assert.equal(rm.routeQaAvailable('passenger'), true);
  assert.equal(rm.qaGateOpen(true, 'passenger'), true);
});

// Runner-level Q&A: bundle routePlayback (the backend's env reads
// are defined away; no network is touched — synth + answer
// generation are stubs, the audio port is a real-timer fake).
const rpOut = join(mkdtempSync(join(tmpdir(), 'route-playback-')), 'routePlayback.mjs');
execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'esbuild'),
  [
    join(repoRoot, 'src', 'core', 'routePlayback.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--define:import.meta.env={}',
    "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    `--outfile=${rpOut}`,
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
);
const rp = await import(pathToFileURL(rpOut).href);

class RealFakeAudio {
  constructor(durMs = 400) {
    this.durMs = durMs;
    this.src = null;
    this.played = [];
    this.endedCb = null;
    this.errorCb = null;
    this.timer = null;
    this.startedAt = 0;
    this.playingSrc = null;
  }
  load(src) {
    this.src = src;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.playingSrc = null;
  }
  play() {
    const src = this.src;
    this.played.push(src);
    this.playingSrc = src;
    this.startedAt = Date.now();
    this.timer = setTimeout(() => {
      this.playingSrc = null;
      if (this.endedCb) this.endedCb();
    }, this.durMs);
    return Promise.resolve();
  }
  pause() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.playingSrc = null;
  }
  seekBy() {}
  timeSec() {
    return this.playingSrc ? (Date.now() - this.startedAt) / 1000 : 0;
  }
  setEndedHandler(cb) {
    this.endedCb = cb;
  }
  setErrorHandler(cb) {
    this.errorCb = cb;
  }
}
const until = async (fn, what, timeoutMs = 9000) => {
  const start = Date.now();
  for (;;) {
    if (fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await new Promise(r => setTimeout(r, 15));
  }
};
const qaPlan = () =>
  rm.composeRoutePlan(
    [unit('s1|landmark_origin', 32.71), unit('s2|landmark_origin', 32.78), unit('s3|landmark_origin', 32.86)],
    path,
    dest,
    'Dest',
    { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] },
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000 },
  );

await checkAsync('qa runner: no generator dep (driving) → question refused, nothing filed', async () => {
  const audio = new RealFakeAudio();
  const events = [];
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:x/' + t.length,
    onEvent: (t, p) => events.push({ t, p }),
  });
  await runner.start(qaPlan());
  assert.equal(runner.submitQuestion('What is this place?'), false);
  assert.equal(events.filter(e => e.t === 'question_asked').length, 0);
  runner.endTour();
});

await checkAsync('qa runner: passenger question → answer after current item, plan resumes, arrival closeout fires', async () => {
  const audio = new RealFakeAudio(400);
  const events = [];
  const heard = [];
  let promptSeen = '';
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    generateAnswer: async prompt => {
      promptSeen = prompt;
      return 'ANSWER: the tower was built in 1915.';
    },
    answerModelLabel: 'test-model',
    onEvent: (t, p) => events.push({ t, p }),
    onStoryHeard: u => heard.push(u.id),
  });
  await runner.start(qaPlan());
  // The preview item opens the plan now (consolidation §2):
  // wait until the first STORY is the current item, so the
  // question is asked over a story, as the suite intends.
  await until(() => audio.played.some(s => s.includes('s1%7Clandmark_origin.wav')), 'first story sounding');
  assert.equal(runner.submitQuestion('When was the tower built?'), true);
  assert.equal(runner.submitQuestion('And a second one?'), false); // one at a time
  assert.ok(promptSeen.includes('When was the tower built?'), 'generator received the question');
  const asked = events.filter(e => e.t === 'question_asked');
  assert.equal(asked.length, 1);
  assert.equal(asked[0].p.model, 'test-model');
  await until(
    () => runner.view().qaPhase === 'idle' && runner.view().questionsAnswered === 1,
    'answer to sound and settle',
  );
  const qp = events.filter(e => e.t === 'question_playback');
  assert.equal(qp.length, 1);
  assert.equal(qp[0].p.completed, true);
  // Order: the answer sounded after the first story and before
  // the last plan story — the plan resumed behind it, in order.
  const played = audio.played;
  const answerIdx = played.findIndex(s => s.includes('ANSWER'));
  const s1Idx = played.findIndex(s => s.includes('s1%7Clandmark_origin.wav')); // bucket URL encodes |
  const s3Idx = played.findIndex(s => s.includes('s3%7Clandmark_origin.wav'));
  assert.ok(s1Idx >= 0 && answerIdx > s1Idx, 'answer after the current (first) story');
  assert.ok(s3Idx === -1 || answerIdx < s3Idx, 'answer before the last plan story');
  assert.equal(heard[0], 's1|landmark_origin');
  // Arrival with plan remaining → closeout still fires, carrying
  // the question count and an owed tease.
  runner.onPosition(dest);
  await until(() => runner.view().closeoutDone, 'arrival closeout');
  assert.equal(runner.view().endedKind, 'arrival-owed');
  assert.ok(runner.view().owed && runner.view().owed.includes('Miles owes you'));
  const ended = events.filter(e => e.t === 'route_plan_ended');
  assert.equal(ended.length, 1);
  assert.equal(ended[0].p.questions, 1);
  runner.endTour();
});

// ---- composer v2 runner: position-anchored release (real timers, dense path) ----
const anchorPlan = () =>
  rm.composeRoutePlan(
    [
      unit('a|landmark_origin', 32.71),
      unit('b|landmark_origin', 32.78),
      unit('c|landmark_origin', 32.87),
    ],
    densePath,
    { lat: 32.9, lng: -117.25 },
    'Dest',
    { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] },
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 2000 },
  );
await checkAsync('v2 runner: a story does not sound before its window opens', async () => {
  const audio = new RealFakeAudio();
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onStoryHeard: () => {},
  });
  await runner.start(anchorPlan());
  await new Promise(r => setTimeout(r, 1600)); // story A (~400ms) + its bridge settle with progress still 0
  assert.ok(audio.played.some(u => u.includes('a%7Clandmark_origin')), 'departure story played');
  assert.ok(!audio.played.some(u => u.includes('b%7Clandmark_origin')), 'story B sounded before its window');
  runner.onPosition({ lat: 32.78, lng: -117.25 }); // progress ≈ 0.375, inside B's window [0.365, 0.435]
  await until(() => audio.played.some(u => u.includes('b%7Clandmark_origin')), 'story B released once its window opened');
  await runner.endTour();
});
await checkAsync('v2 runner: an outrun story drops stale and the closeout still owes it', async () => {
  const audio = new RealFakeAudio();
  const events = [];
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onStoryHeard: () => {},
    onEvent: (kind, payload) => events.push({ kind, payload }),
  });
  await runner.start(anchorPlan());
  runner.onPosition({ lat: 32.8, lng: -117.25 }); // progress ≈ 0.475 — past B's window end, short of C's window
  await until(() => events.some(e => e.kind === 'story_dropped' && e.payload.subject === 'b|landmark_origin'), 'stale drop event for the outrun story');
  assert.ok(!audio.played.some(u => u.includes('b%7Clandmark_origin')), 'outrun story never sounded');
  runner.onPosition({ lat: 32.9, lng: -117.25 }); // arrival
  await until(() => runner.view().closeoutDone, 'arrival closeout completed');
  assert.equal(runner.view().endedKind, 'arrival-owed');
  assert.ok(runner.view().owed && runner.view().owed.includes('b|landmark_origin'), `owed tease names the dropped story (got: ${runner.view().owed})`);
});

// ---- through-line runner: the closeout wrap is earned by played members ----
const threadPlan = () =>
  rm.composeRoutePlan(
    [navy('n1|landmark_origin', 32.71), navy('n2|landmark_origin', 32.78), navy('n3|landmark_origin', 32.87)],
    densePath,
    denseDest,
    'Dest',
    noTopics,
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 2000 },
  );
// ---- the wrap-up (addendum 3) + the narration seam (addendum 5) ----
// ONE closing narration, authored at preparation from plan
// facts only, played ONLY on arrival with the plan run out.
// The runner's closeout kinds label its accounting; the
// wrap-up gate reads the run-out accounting itself (every
// story sounded, or the last one on the element now) — an
// early end, an overrun, or a genuinely-owed arrival speaks
// today's closeout line instead.
check('narration seam: requests stamp kind + the default solo voice; context passes through untouched', () => {
  const ctx = { destinationName: 'Dest', threadTopic: null };
  const req = rn.narrationRequest('wrapup', ctx);
  assert.equal(req.kind, 'wrapup');
  assert.equal(req.voice, 'miles-solo', 'voice defaults to Miles solo');
  assert.equal(rn.DEFAULT_NARRATION_VOICE, 'miles-solo');
  assert.equal(req.context, ctx, 'the seam carries structured facts, not prose');
  assert.equal(rn.narrationRequest('bridge', ctx, 'miles-solo').kind, 'bridge', 'one uniform shape across kinds');
});
check('wrap-up context: plan facts only — destination + thread + climax, and no played data anywhere', () => {
  const threaded = rm.buildWrapUpContext(threadPlan());
  assert.deepEqual(Object.keys(threaded).sort(), ['climaxMode', 'climaxSubject', 'destinationName', 'threadTopic']);
  assert.equal(threaded.destinationName, 'Dest');
  assert.equal(threaded.threadTopic, 'Navy Century');
  assert.equal(threaded.climaxMode, 'late', 'the thread plan\'s climax is its late-corridor final member (addendum 4)');
  assert.equal(threaded.climaxSubject, 'n3|landmark_origin');
  assert.ok(!JSON.stringify(threaded).toLowerCase().includes('played'), 'the context cannot carry a played set');
  const plain = rm.buildWrapUpContext(qaPlan());
  assert.equal(plain.destinationName, 'Dest');
  assert.equal(plain.threadTopic, null, 'no thread → null, not an invented theme');
  assert.ok(!('bookend' in plain), 'the pairing machinery is gone from the context shape (consolidation §3)');
});
check('wrap-up text: destination + thread + sign-off — and never a played-recap claim', () => {
  const t = rn.wrapUpTextFor({ destinationName: 'Dest', threadTopic: 'Navy Century' });
  assert.ok(t.includes('Dest'), 'the arrival beat names the destination');
  assert.ok(t.includes('Navy Century'), 'the thread payoff rides as arc language');
  assert.ok(t.includes('This is Miles'), 'Miles signs off');
  assert.ok(!t.toLowerCase().includes('you heard'), 'no "you heard X" recap is ever asserted');
  const bare = rn.wrapUpTextFor({ destinationName: 'Dest', threadTopic: null });
  assert.ok(bare.includes('Dest') && bare.includes('This is Miles'), 'a threadless plan still gets a full wrap-up');
  assert.ok(!bare.toLowerCase().includes('you heard'));
});

const wrapPlan = (withWrapUp = true) => {
  const plan = rm.composeRoutePlan(
    [unit('a|landmark_origin', 32.71), unit('b|landmark_origin', 32.78), unit('c|landmark_origin', 32.87)],
    densePath,
    denseDest,
    'Dest',
    noTopics,
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 2000 },
  );
  if (withWrapUp) plan.wrapUp = { text: 'WRAPUP: the whole drive, tied off.', audioUrl: 'blob:wrapup' };
  return plan;
};
const wrapRunner = (heard, synthTexts, events) => {
  const audio = new RealFakeAudio(300);
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => {
      synthTexts.push(t);
      return 'blob:audio/' + encodeURIComponent(t.slice(0, 16));
    },
    onStoryHeard: u => heard.push(u.id),
    onEvent: (t, p) => events.push({ t, p }),
  });
  return { audio, runner };
};
await checkAsync('wrap-up runner: arrival with the plan run out plays the prepared wrap-up, not the sign-off line', async () => {
  const heard = [];
  const synthTexts = [];
  const events = [];
  const { audio, runner } = wrapRunner(heard, synthTexts, events);
  await runner.start(wrapPlan());
  await until(() => heard.includes('a|landmark_origin'), 'first story sounded');
  runner.onPosition({ lat: 32.78, lng: -117.25 });
  await until(() => heard.includes('b|landmark_origin'), 'second story sounded');
  runner.onPosition({ lat: 32.87, lng: -117.25 });
  await until(() => audio.played.some(u => u.includes('c%7Clandmark_origin')), 'final story on the element');
  runner.onPosition(denseDest); // arrival while the final story sounds: the plan has run out
  await until(() => runner.view().closeoutDone, 'arrival closeout');
  assert.ok(audio.played.includes('blob:wrapup'), 'the prepared wrap-up audio played as the closing piece');
  assert.ok(!synthTexts.some(t => t.includes("that's our stop")), "today's closeout line was never synthesized");
  const played = events.filter(e => e.t === 'route_wrap_up' && e.p.wrap_up === 'played');
  assert.equal(played.length, 1, 'route_wrap_up {wrap_up: played} filed once it sounded');
  runner.endTour();
});
await checkAsync('wrap-up runner: an arrival that still owes stories speaks today\'s closeout — the wrap-up stays unused', async () => {
  const heard = [];
  const synthTexts = [];
  const events = [];
  const { audio, runner } = wrapRunner(heard, synthTexts, events);
  await runner.start(wrapPlan());
  await until(() => heard.includes('a|landmark_origin'), 'first story sounded');
  runner.onPosition(denseDest); // arrival with b and c genuinely unplayed
  await until(() => runner.view().closeoutDone, 'arrival closeout');
  assert.equal(runner.view().endedKind, 'arrival-owed');
  assert.ok(!audio.played.includes('blob:wrapup'), 'the wrap-up never plays on a cut-short drive');
  assert.ok(synthTexts.some(t => t.includes("I'll hold the rest for next time")), "today's owed line was synthesized");
  assert.equal(events.filter(e => e.t === 'route_wrap_up').length, 0, 'no wrap-up telemetry on the owed path');
  runner.endTour();
});
await checkAsync('wrap-up runner: overrun handoff and early End Tour never play it', async () => {
  const heard = [];
  const synthTexts = [];
  const events = [];
  const { audio, runner } = wrapRunner(heard, synthTexts, events);
  await runner.start(wrapPlan());
  await until(() => heard.includes('a|landmark_origin'), 'first story sounded');
  runner.onPosition({ lat: 32.78, lng: -117.25 });
  await until(() => heard.includes('b|landmark_origin'), 'second story sounded');
  runner.onPosition({ lat: 32.87, lng: -117.25 });
  await until(() => runner.view().closeoutDone, 'overrun closeout after the plan exhausts');
  assert.equal(runner.view().endedKind, 'overrun');
  assert.ok(!audio.played.includes('blob:wrapup'), 'no wrap-up on the overrun handoff');
  assert.ok(synthTexts.some(t => t.includes('freeform')), "today's handoff line was synthesized");
  const early = wrapRunner([], [], []);
  await early.runner.start(wrapPlan());
  early.runner.endTour();
  await new Promise(r => setTimeout(r, 100));
  assert.ok(!early.audio.played.includes('blob:wrapup'), 'no wrap-up on an early End Tour');
});
await checkAsync('wrap-up runner: a plan without a wrap-up (generation failed at build) falls back to today\'s closeout exactly', async () => {
  const heard = [];
  const synthTexts = [];
  const events = [];
  const { audio, runner } = wrapRunner(heard, synthTexts, events);
  await runner.start(wrapPlan(false));
  await until(() => heard.includes('a|landmark_origin'), 'first story sounded');
  runner.onPosition({ lat: 32.78, lng: -117.25 });
  await until(() => heard.includes('b|landmark_origin'), 'second story sounded');
  runner.onPosition({ lat: 32.87, lng: -117.25 });
  await until(() => audio.played.some(u => u.includes('c%7Clandmark_origin')), 'final story on the element');
  runner.onPosition(denseDest);
  await until(() => runner.view().closeoutDone, 'arrival closeout');
  assert.ok(synthTexts.some(t => t.includes("that's our stop")), "today's closeout line carries the finish, as before");
  assert.equal(events.filter(e => e.t === 'route_wrap_up').length, 0);
  runner.endTour();
});

// ---- first-sound discipline (Nov 3, 2026): prime at the tap, honest state ----
// Erik's stationary route test on the pre-fix build: the plan
// built, he hit start, the UI showed speaking, and nothing
// sounded — telemetry showed audio_blocked (playback) +
// prime_attempt and NO unlock_latched for the route session.
// The route player was constructed and primed only after the
// whole async build, outside the tap's gesture window, whereas
// freeform primes synchronously in its tap. GateFakeAudio models
// WebKit transient activation: play() is refused with
// NotAllowedError until `activated` is set.
class GateFakeAudio extends RealFakeAudio {
  constructor(durMs = 300) {
    super(durMs);
    this.activated = true;
    this.refusals = 0;
  }
  play() {
    if (!this.activated) {
      this.refusals += 1;
      return Promise.reject(
        Object.assign(new Error("play() failed because the user didn't interact with the document first"), {
          name: 'NotAllowedError',
        }),
      );
    }
    return super.play();
  }
}

await checkAsync('first sound: the tap prime is attempted synchronously and earns unlock_latched before item 1', async () => {
  const audio = new GateFakeAudio(300);
  const events = [];
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onEvent: (t, p) => events.push({ t, p }),
  });
  // The Start tap: prime() must attempt play() INSIDE the call —
  // synchronously, before any await (and therefore before the
  // async build the tap goes on to run). A prime deferred past
  // the gesture is the bug being fixed.
  runner.prime();
  assert.equal(audio.played.length, 1, 'the prime attempted synchronously within the tap call');
  assert.ok(audio.played[0].startsWith('blob:'), 'the tap carrier is the local sample prime');
  await new Promise(r => setTimeout(r, 25)); // let the prime's proof land
  assert.equal(runner.view().latch, 'earned', 'tap prime earned the latch inside the gesture window');
  const latched = events.filter(e => e.t === 'unlock_latched');
  assert.equal(latched.length, 1, 'unlock_latched filed for the route session');
  assert.equal(latched[0].p.source, 'prime');
  // The build lands; the plan is handed to the same runner.
  // Item 1 is the preview item now (consolidation §2) — it
  // begins inside start(); the first story follows it.
  await runner.start(qaPlan());
  await until(() => audio.played.some(u => u.includes('s1%7Clandmark_origin')), 'first story sounded after the tap prime');
  const firstStoryAt = audio.played.findIndex(u => u.includes('s1%7Clandmark_origin'));
  assert.ok(firstStoryAt > 0, 'item 1 sounded after the tap prime');
  await until(() => runner.view().nowPlaying !== null, 'now-playing once sound flows');
  assert.equal(runner.view().awaitingGesture, false);
  assert.equal(runner.view().phase, 'playing');
  runner.endTour();
});

await checkAsync('first sound: a refused first play holds at tap-to-hear (never "playing"); a gesture retry begins item 1', async () => {
  const audio = new GateFakeAudio(300);
  audio.activated = false; // the pre-fix world: the attempt happens with no activation live
  const events = [];
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onEvent: (t, p) => events.push({ t, p }),
    onStoryHeard: () => {},
  });
  await runner.start(qaPlan());
  await new Promise(r => setTimeout(r, 150)); // the refusal chain settles (carrier → fallback prime)
  const held = runner.view();
  assert.equal(held.phase, 'awaiting', `a refused first play must hold at awaiting, got ${held.phase}`);
  assert.equal(held.nowPlaying, null, 'no speaking claim over silence');
  assert.equal(held.awaitingGesture, true);
  assert.equal(held.latch, 'unearned');
  assert.ok(events.some(e => e.t === 'prime_attempt' && e.p.result === 'rejected'), 'prime refusal on the record');
  assert.ok(events.some(e => e.t === 'audio_blocked'), 'audio_blocked on the record');
  assert.equal(events.filter(e => e.t === 'unlock_latched').length, 0, 'latch never earned');
  assert.equal(audio.played.length, 0, 'nothing sounded');
  // The tap-to-hear gesture: activation present, item 1 rides it
  // as the prime carrier and begins.
  audio.activated = true;
  runner.noteGesture();
  await until(() => runner.view().latch === 'earned', 'gesture retry earns the latch');
  const latched = events.filter(e => e.t === 'unlock_latched');
  assert.equal(latched.length, 1);
  assert.equal(latched[0].p.source, 'gesture-retry');
  await until(() => audio.played.some(u => u.includes('s1%7Clandmark_origin')), 'item 1 sounds after the gesture');
  await until(() => runner.view().nowPlaying !== null, 'now-playing appears only once sound flows');
  assert.equal(runner.view().phase, 'playing');
  assert.equal(runner.view().awaitingGesture, false);
  runner.endTour();
});

// ---- manifest hold (differentiator 3): the staged runner waits
// for the Start listening action — nothing sounds, no window is
// fed, no guard fires while the episode card is up ----
await checkAsync('manifest: a staged plan does not start until the start action fires', async () => {
  const audio = new GateFakeAudio(300);
  const events = [];
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onEvent: (t, p) => events.push({ t, p }),
    onStoryHeard: () => {},
  });
  runner.prime(); // the Build tap, as in the App
  await new Promise(r => setTimeout(r, 25));
  assert.equal(runner.view().latch, 'earned');
  const playedAfterPrime = audio.played.length;
  await runner.stage(qaPlan());
  assert.equal(runner.view().phase, 'ready', 'the staged plan presents as ready, not playing');
  assert.equal(runner.view().awaitingGesture, false, 'no tap-to-hear while the card is up — the card IS the gesture surface');
  assert.equal(audio.played.length, playedAfterPrime, 'nothing sounded while the card is up');
  assert.equal(events.filter(e => e.t === 'route_plan_started').length, 0, 'the tour has not started');
  runner.onPosition({ lat: 32.78, lng: -117.25 }); // the driver rolls while reading the card
  assert.equal(runner.view().phase, 'ready', 'position updates do not start a held plan');
  assert.equal(runner.view().endedKind, null, 'no guard closeout fires during the hold');
  assert.equal(runner.submitQuestion('too early?'), false, 'no Q&A before the start action');
  assert.equal(audio.played.length, playedAfterPrime, 'still nothing sounded');
  runner.beginStaged(); // the Start listening tap
  await until(() => audio.played.some(u => u.includes('s1%7Clandmark_origin')), 'item 1 begins on the start action');
  assert.equal(events.filter(e => e.t === 'route_plan_started').length, 1, 'route_plan_started files at the real start');
  assert.equal(runner.view().phase, 'playing');
  runner.endTour();
});
await checkAsync('manifest: an empty staged plan ends as the standing overrun (no card could hold it)', async () => {
  const audio = new RealFakeAudio(300);
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onStoryHeard: () => {},
  });
  const empty = rm.composeRoutePlan(
    [unit('solo|landmark_origin', 32.75)],
    path,
    dest,
    'Dest',
    noTopics,
    { nowMs: NOW, heardKeys: new Set(['solo|landmark_origin']), budgetSecOverride: 100000 },
  );
  assert.equal(empty.items.filter(i => i.kind === 'story').length, 0, 'fixture plan is empty');
  await runner.stage(empty);
  assert.equal(runner.view().phase, 'ended');
  assert.equal(runner.view().endedKind, 'overrun');
  assert.equal(runner.view().freeformTail, true);
  runner.endTour();
});

// ---- drive record (addendum 2): the runner files ONE record
// when a route tour's accounting finalizes — closeout or an
// early End Tour on a begun tour; never twice, never for a
// staged plan backed out of, and (by construction of the dep
// seam — freeform's engine has no such dep) never for freeform.
await checkAsync('drive record: an arrival closeout files the record with the real played and owed lists', async () => {
  const records = [];
  const audio = new RealFakeAudio(300);
  const heard = [];
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onStoryHeard: u => heard.push(u.id),
    onDriveRecord: r => records.push(r),
    onEvent: () => {},
  });
  await runner.start(threadPlan());
  await until(() => heard.includes('n1|landmark_origin'), 'first story sounded');
  runner.onPosition({ lat: 32.78, lng: -117.25 });
  await until(() => heard.includes('n2|landmark_origin'), 'second story sounded');
  runner.onPosition(denseDest); // arrival with n3 unplayed
  await until(() => runner.view().closeoutDone, 'arrival closeout');
  assert.equal(records.length, 1, 'exactly one record');
  const rec = records[0];
  assert.equal(rec.destinationName, 'Dest');
  assert.equal(rec.destinationPlaceKey, null, 'the runner cannot know the place key — the App enriches it');
  assert.equal(rec.threadTopic, 'Navy Century');
  assert.deepEqual(rec.playedSubjects, ['n1|landmark_origin', 'n2|landmark_origin']);
  assert.deepEqual(rec.owedSubjects, ['n3|landmark_origin'], "the closeout's actual owed list");
  assert.ok(typeof rec.endedAt === 'number' && rec.endedAt > 0);
  runner.endTour(); // the App's End after a closeout must not double-file
  assert.equal(records.length, 1, 'no second record after the closeout');
});
await checkAsync('drive record: an early End Tour on a begun tour files it; a staged plan backed out of files nothing', async () => {
  const records = [];
  const audio = new RealFakeAudio(300);
  const heard = [];
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onStoryHeard: u => heard.push(u.id),
    onDriveRecord: r => records.push(r),
    onEvent: () => {},
  });
  await runner.start(qaPlan());
  await until(() => heard.includes('s1|landmark_origin'), 'first story sounded');
  runner.endTour();
  assert.equal(records.length, 1, 'the early end still concludes a drive');
  assert.deepEqual(records[0].playedSubjects, ['s1|landmark_origin']);
  assert.deepEqual(records[0].owedSubjects, ['s2|landmark_origin', 's3|landmark_origin']);
  const stagedRecords = [];
  const staged = new rp.RoutePlanRunner({
    audio: new RealFakeAudio(300),
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onDriveRecord: r => stagedRecords.push(r),
    onEvent: () => {},
  });
  await staged.stage(qaPlan());
  staged.endTour(); // backed out of the manifest card — no drive ever ran
  assert.equal(stagedRecords.length, 0, 'a never-begun plan files nothing');
});

// ---- Coverage Guarantee (Nov 3, 2026): gap geometry, library-first
// fill, generation cap/failure discipline, shelf promotion seams ----
// Everything live is stubbed — discovery, generation, TTS and ingest
// are injected fakes; zero network anywhere in these suites.
const gfOut = join(mkdtempSync(join(tmpdir(), 'route-gap-')), 'routeGapFill.mjs');
execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'esbuild'),
  [
    join(repoRoot, 'src', 'core', 'routeGapFill.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--define:import.meta.env={}',
    `--outfile=${gfOut}`,
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
);
const gf = await import(pathToFileURL(gfOut).href);

const mkPlan = items => ({
  destinationName: 'Dest',
  destination: denseDest,
  path: densePath,
  driveSec: 3000,
  budgetSec: 3000,
  items,
  totalSec: items.reduce((s, i) => s + i.durationSec, 0),
  skippedHeard: 0,
  topicsMatched: false,
  toneMatched: false,
});
const storyAtSec = (id, anchorSec, durSec, driveSec) => {
  const w = rm.storyWindow(anchorSec / driveSec, durSec, driveSec);
  return {
    kind: 'story',
    id,
    label: id,
    durationSec: durSec,
    unit: unit(id, 32.7 + (anchorSec / driveSec) * 0.2),
    ready: true,
    anchorProgress: anchorSec / driveSec,
    releaseProgress: w.release,
    expireProgress: w.expire,
  };
};
const noInput = { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] };

check('gap geometry: stretches at or under 180 s are not gaps', () => {
  const drive = 600;
  const plan = mkPlan([storyAtSec('s1|x', 150, 120, drive), storyAtSec('s2|x', 390, 120, drive)]);
  // windows [130,270] and [370,510]: departure 130, middle 100, arrival 90 — all ≤ 180.
  assert.deepEqual(gf.detectStoryGaps(plan, drive), []);
});

check('gap geometry: a gap is measured between story windows — bridges and reactions do not close it', () => {
  const drive = 2000;
  const s1 = storyAtSec('s1|x', 200, 100, drive); // window [180, 300]
  const s2 = storyAtSec('s2|x', 1800, 100, drive); // window [1780, 1900]
  const bridge = { kind: 'bridge', id: 'bridge:s1|x>s2|x', label: 'Bridge', durationSec: 60, text: 'From s1 we keep rolling.', ready: true };
  const reaction = { kind: 'reaction', id: 'reaction:0', label: 'Reaction', durationSec: 10, text: 'Still with me?', ready: true };
  const gaps = gf.detectStoryGaps(mkPlan([s1, bridge, reaction, s2]), drive);
  assert.equal(gaps.length, 1, `expected exactly the mid-drive gap, got ${JSON.stringify(gaps)}`);
  assert.ok(Math.abs(gaps[0].gapSec - 1480) < 1, `gap ${gaps[0].gapSec} != 1480 (1780 - 300)`);
  assert.ok(Math.abs(gaps[0].startSec - 300) < 1 && Math.abs(gaps[0].endSec - 1780) < 1);
});

check('gap geometry: departure and arrival edges count, ranked largest-first; exactly 180 s is not a gap', () => {
  const drive = 2000;
  const only = storyAtSec('only|x', 1000, 100, drive); // window [980, 1100]
  const gaps = gf.detectStoryGaps(mkPlan([only]), drive);
  assert.deepEqual(gaps.map(g => Math.round(g.gapSec)), [980, 900], 'departure edge 980, arrival edge 900, largest first');
  const boundary = gf.detectStoryGaps(
    mkPlan([storyAtSec('b1|x', 200, 100, 1000), storyAtSec('b2|x', 850, 100, 1000)]),
    1000,
  );
  // windows [180,300] and [830,950]: departure is exactly 180 → not a gap; middle 530 is.
  assert.equal(boundary.length, 1);
  assert.ok(Math.abs(boundary[0].gapSec - 530) < 1);
});

check('gap style gate: clean text passes; the hard-fail classes reject', () => {
  const good =
    'The Old Mill has ground grain on this creek since the railroad came through. The miller, a stubborn Scot named Abernathy, once refused to sell flour to the railroad itself during a rate fight. I think about that every time I pass the place. The wheel still turns when the creek runs high, and the whole building hums like a held note. Abernathy lost the fight in the end, but the mill outlived the railroad that beat him.';
  assert.equal(gf.gapStoryStyleGate(good, 'The Old Mill'), true);
  assert.equal(gf.gapStoryStyleGate(good.replace('has ground grain', 'is coming up on your left and has ground grain'), 'The Old Mill'), false, 'relative direction rejects');
  assert.equal(gf.gapStoryStyleGate(`# The Old Mill\n${good}`, 'The Old Mill'), false, 'markdown rejects');
  const unnamed =
    'The lighthouse has watched over this harbor since the eighteen eighties, when its keeper lit the lamp by hand every single night. The keeper, a former whaler named Okafor, once rowed out in a gale to pull three sailors off a wreck on the bar. I think about that row every time the fog comes in thick. The light still turns, the fog still argues with it, and the harbor still answers.';
  assert.equal(gf.gapStoryStyleGate(unnamed, 'The Old Mill'), false, 'subject unnamed in the first two sentences rejects');
  assert.equal(gf.gapStoryStyleGate('The Old Mill is old. It is quiet.', 'The Old Mill'), false, 'too thin rejects');
  assert.equal(gf.gapStoryStyleGate('', 'The Old Mill'), false, 'empty rejects');
});

/** A gate-passing canned story that names its subject in sentence one. */
const cannedStory = name =>
  `${name} has watched this road change for a hundred years. The building went up when the streetcars still ran past its door, and the family that built it refused three offers to tear it down. I drive past it and think about the stubbornness that keeps a place standing. Inside, the original counter still runs the length of the room, scarred by a century of elbows and coffee cups. The story goes that the mayor himself tried to buy it in 1962 and walked out with nothing but a sandwich. It is still there, still open, still stubborn — and the road is better for it.`;
const subjectFromPrompt = prompt => prompt.match(/Tell the story of (.+)\./)[1];

await checkAsync('gapfill: library first — an untiled fetched unit tiles the gap, zero discovery/generation calls', async () => {
  const drive = 900;
  const sA = unit('sa|landmark_origin', 32.716, { topics: ['Coast'], durationSec: 90 });
  const sB = unit('sb|landmark_origin', 32.884, { topics: ['Coast'], durationSec: 90 });
  const mid = unit('mid|landmark_origin', 32.776, { topics: [], durationSec: 340 });
  // The topic pool restriction leaves `mid` fetched but untiled —
  // a real production shape (the composer tiles the topic pool).
  const plan = rm.composeRoutePlan([sA, sB, mid], densePath, denseDest, 'Dest', { ...noInput, topics: ['Coast'] }, { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: drive });
  assert.ok(!plan.items.some(i => i.id === 'mid|landmark_origin'), 'fixture: mid starts untiled');
  let discoverCalls = 0;
  let generateCalls = 0;
  const events = [];
  const filled = await gf.fillRouteGaps(
    plan,
    { fetchedUnits: [sA, sB, mid], heardKeys: new Set(), input: { ...noInput, topics: ['Coast'] }, driveSec: drive },
    {
      discoverSubjects: async () => {
        discoverCalls += 1;
        return [];
      },
      generateStory: async () => {
        generateCalls += 1;
        return cannedStory('Should Never Generate');
      },
      onEvent: e => events.push(e),
    },
  );
  assert.ok(filled.items.some(i => i.id === 'mid|landmark_origin'), 'the untiled shelf unit was tiled into the gap');
  assert.equal(discoverCalls, 0, 'discovery never ran');
  assert.equal(generateCalls, 0, 'generation never ran — the shelf beat it');
  assert.equal(events.length, 1);
  assert.equal(events[0].result, 'shelf');
  assert.equal(events[0].subject, 'mid|landmark_origin');
  assert.ok(events[0].gap_sec > 500 && events[0].gap_sec < 750, `gap_sec ${events[0].gap_sec}`);
});

await checkAsync('gapfill: a fetched off-corridor (portal) candidate is never a gap fill — geographic only', async () => {
  const drive = 2000;
  const plan = mkPlan([storyAtSec('s1|x', 200, 100, drive), storyAtSec('s2|x', 1800, 100, drive)]);
  plan.driveSec = drive;
  plan.budgetSec = drive;
  const offPathUnit = unit('off|landmark_origin', 32.8, { lng: -117.05 }); // projects mid-gap, ~18 km off the path
  const events = [];
  const filled = await gf.fillRouteGaps(
    plan,
    { fetchedUnits: [offPathUnit], heardKeys: new Set(), input: noInput, driveSec: drive },
    { onEvent: e => events.push(e) }, // no generation deps at all: the lane is closed
  );
  assert.ok(!filled.items.some(i => i.id === 'off|landmark_origin'), 'portal candidate not tiled');
  assert.equal(events.length, 1);
  assert.equal(events[0].result, 'skipped');
});

await checkAsync('gapfill: cap — 3 qualifying gaps get exactly 2 generated fills, largest first', async () => {
  const drive = 3000;
  const plan = mkPlan([
    storyAtSec('s1|x', 150, 100, drive),
    storyAtSec('s2|x', 770, 100, drive),
    storyAtSec('s3|x', 1770, 100, drive),
    storyAtSec('s4|x', 2650, 300, drive),
  ]);
  plan.driveSec = drive;
  plan.budgetSec = drive;
  // gaps: [250→750]=500, [870→1750]=880, [1870→2630]=760 — three qualify.
  const names = ['Cap Subject One', 'Cap Subject Two', 'Cap Subject Three'];
  let discoverCalls = 0;
  const ingested = [];
  const events = [];
  const filled = await gf.fillRouteGaps(
    plan,
    { fetchedUnits: plan.items.map(i => i.unit), heardKeys: new Set(), input: noInput, driveSec: drive },
    {
      discoverSubjects: async points => {
        const name = names[discoverCalls];
        discoverCalls += 1;
        return [{ name, lat: points[1].lat, lng: points[1].lng, types: ['museum'], rating: 4.6, userRatings: 1200, address: null, facts: [] }];
      },
      generateStory: async prompt => cannedStory(subjectFromPrompt(prompt)),
      synthesize: async () => new Blob(['fake-audio']),
      ingest: async ({ unit: u, text }) => {
        ingested.push({ id: u.id, text });
        return `library/${u.placeKey}/${u.angle}-zz-route-gap-v1.wav`;
      },
      onEvent: e => events.push(e),
    },
  );
  const generated = filled.items.filter(i => i.kind === 'story' && i.unit && i.unit.audioPath && i.unit.audioPath.includes('-route-gap-v1'));
  assert.equal(generated.length, 2, 'exactly two generated stories in the plan');
  assert.equal(ingested.length, 2, 'both were shelf-promoted');
  assert.ok(generated.every(i => i.portal === undefined), 'gap fills are geographic, never portals');
  assert.ok(generated.every(i => i.releaseProgress !== undefined && i.expireProgress !== undefined), 'gap fills carry anchored windows');
  assert.deepEqual(events.map(e => e.result), ['generated', 'generated', 'skipped']);
  assert.deepEqual(events.map(e => e.gap_sec), [880, 760, 500], 'largest gaps filled first');
  assert.equal(events[0].subject, 'Cap Subject One');
  assert.equal(events[1].subject, 'Cap Subject Two');
});

await checkAsync('gapfill: generation failure → the plan ships intact, telemetry records failed', async () => {
  const drive = 2000;
  const plan = mkPlan([storyAtSec('s1|x', 200, 100, drive), storyAtSec('s2|x', 1800, 100, drive)]);
  plan.driveSec = drive;
  plan.budgetSec = drive;
  const events = [];
  const filled = await gf.fillRouteGaps(
    plan,
    { fetchedUnits: [], heardKeys: new Set(), input: noInput, driveSec: drive },
    {
      discoverSubjects: async points => [
        { name: 'Fail Subject', lat: points[1].lat, lng: points[1].lng, types: ['museum'], rating: 4.5, userRatings: 800, address: null, facts: [] },
      ],
      generateStory: async () => {
        throw new Error('quota or network — the lane is down');
      },
      onEvent: e => events.push(e),
    },
  );
  assert.deepEqual(filled.items.map(i => i.id), plan.items.map(i => i.id), 'plan untouched');
  assert.equal(filled.totalSec, plan.totalSec);
  assert.deepEqual(events.map(e => e.result), ['failed']);
  assert.equal(events[0].gap_sec, 1480);
});

await checkAsync('gapfill: generation timeout → the plan ships intact, telemetry records failed', async () => {
  const drive = 2000;
  const plan = mkPlan([storyAtSec('s1|x', 200, 100, drive), storyAtSec('s2|x', 1800, 100, drive)]);
  plan.driveSec = drive;
  plan.budgetSec = drive;
  const events = [];
  const filled = await gf.fillRouteGaps(
    plan,
    { fetchedUnits: [], heardKeys: new Set(), input: noInput, driveSec: drive },
    {
      discoverSubjects: async points => [
        { name: 'Slow Subject', lat: points[1].lat, lng: points[1].lng, types: ['museum'], rating: 4.5, userRatings: 800, address: null, facts: [] },
      ],
      generateStory: () => new Promise(r => setTimeout(() => r(cannedStory('Slow Subject')), 250)),
      timeoutMs: 40,
      onEvent: e => events.push(e),
    },
  );
  assert.deepEqual(filled.items.map(i => i.id), plan.items.map(i => i.id), 'plan untouched');
  assert.deepEqual(events.map(e => e.result), ['failed']);
});

await checkAsync('gapfill: a style-gate reject is discarded entirely — not served, not ingested', async () => {
  const drive = 2000;
  const plan = mkPlan([storyAtSec('s1|x', 200, 100, drive), storyAtSec('s2|x', 1800, 100, drive)]);
  plan.driveSec = drive;
  plan.budgetSec = drive;
  let ingestCalls = 0;
  let synthCalls = 0;
  const events = [];
  const filled = await gf.fillRouteGaps(
    plan,
    { fetchedUnits: [], heardKeys: new Set(), input: noInput, driveSec: drive },
    {
      discoverSubjects: async points => [
        { name: 'Gate Subject', lat: points[1].lat, lng: points[1].lng, types: ['museum'], rating: 4.5, userRatings: 800, address: null, facts: [] },
      ],
      // Names the subject early and is long enough — but carries a
      // banned relative direction, so the gate must kill it.
      generateStory: async () =>
        'Gate Subject is coming up on your left, and it has a story worth hearing. The family that built it refused to sell for sixty years. I think about that stubbornness every time I pass. The counter inside still runs the length of the room, scarred by a century of coffee cups and elbows. It is still open, still stubborn, and still the best seat on this whole road.',
      synthesize: async () => {
        synthCalls += 1;
        return new Blob(['x']);
      },
      ingest: async () => {
        ingestCalls += 1;
        return 'library/gate/x-route-gap-v1.wav';
      },
      onEvent: e => events.push(e),
    },
  );
  assert.deepEqual(filled.items.map(i => i.id), plan.items.map(i => i.id), 'rejected text never entered the plan');
  assert.equal(synthCalls, 0, 'rejected text never reached TTS');
  assert.equal(ingestCalls, 0, 'rejected text was never ingested');
  assert.deepEqual(events.map(e => e.result), ['failed']);
});

await checkAsync('gapfill: ingest failure never affects the tour — the item serves from its text', async () => {
  const drive = 2000;
  const plan = mkPlan([storyAtSec('s1|x', 200, 100, drive), storyAtSec('s2|x', 1800, 100, drive)]);
  plan.driveSec = drive;
  plan.budgetSec = drive;
  const events = [];
  const filled = await gf.fillRouteGaps(
    plan,
    { fetchedUnits: [], heardKeys: new Set(), input: noInput, driveSec: drive },
    {
      discoverSubjects: async points => [
        { name: 'Orphan Subject', lat: points[1].lat, lng: points[1].lng, types: ['museum'], rating: 4.5, userRatings: 800, address: null, facts: [] },
      ],
      generateStory: async prompt => cannedStory(subjectFromPrompt(prompt)),
      synthesize: async () => new Blob(['fake-audio']),
      ingest: async () => null, // the shelf write failed — the tour must not care
      onEvent: e => events.push(e),
    },
  );
  const item = filled.items.find(i => i.unit && i.unit.placeName === 'Orphan Subject');
  assert.ok(item, 'the generated story is in the plan despite the ingest failure');
  assert.equal(item.unit.audioPath, null, 'no bucket path — the runner synthesizes from text');
  assert.ok(item.unit.storyText && item.unit.storyText.includes('Orphan Subject'), 'text rides the unit for the runner synth fallback');
  assert.deepEqual(events.map(e => e.result), ['generated']);
});

await checkAsync('gapfill: a plan with no gaps is returned untouched, with no events', async () => {
  const drive = 600;
  const plan = mkPlan([storyAtSec('s1|x', 150, 120, drive), storyAtSec('s2|x', 390, 120, drive)]);
  plan.driveSec = drive;
  plan.budgetSec = drive;
  const events = [];
  const filled = await gf.fillRouteGaps(
    plan,
    { fetchedUnits: [], heardKeys: new Set(), input: noInput, driveSec: drive },
    { onEvent: e => events.push(e) },
  );
  assert.equal(filled, plan, 'same plan object — the pass stood down entirely');
  assert.equal(events.length, 0);
});

await checkAsync('gapfill discovery: the Places walk tries every key — first blocked, second answers', async () => {
  const tried = [];
  const stub = async (url, opts) => {
    tried.push(opts.headers['X-Goog-Api-Key']);
    if (opts.headers['X-Goog-Api-Key'] === 'blocked-key') {
      return { ok: false, status: 403, json: async () => ({ error: { status: 'PERMISSION_DENIED' } }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        places: [
          {
            displayName: { text: 'Gap Museum' },
            location: { latitude: 32.8, longitude: -117.25 },
            rating: 4.7,
            userRatingCount: 2100,
            types: ['museum', 'tourist_attraction'],
            formattedAddress: '1 Gap Way, San Diego, CA',
          },
        ],
      }),
    };
  };
  const subjects = await gf.discoverGapSubjects([{ lat: 32.8, lng: -117.25 }], ['blocked-key', 'working-key'], stub);
  assert.deepEqual(tried.slice(0, 2), ['blocked-key', 'working-key'], 'keys walked in order');
  assert.ok(subjects.some(s => s.name === 'Gap Museum'), 'the subject from the working key was discovered');
});

await checkAsync('gapfill runner: a generated item obeys window / drop / owed semantics', async () => {
  const composed = rm.composeRoutePlan(
    [unit('a|landmark_origin', 32.71), unit('b|landmark_origin', 32.78), unit('c|landmark_origin', 32.87)],
    densePath,
    denseDest,
    'Dest',
    noInput,
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 2000 },
  );
  composed.driveSec = 2000;
  composed.budgetSec = 2000;
  const names = ['Runner Subject One', 'Runner Subject Two'];
  let discoverCalls = 0;
  const filled = await gf.fillRouteGaps(
    composed,
    { fetchedUnits: composed.items.map(i => i.unit).filter(Boolean), heardKeys: new Set(), input: noInput, driveSec: 2000 },
    {
      discoverSubjects: async points => {
        const name = names[discoverCalls];
        discoverCalls += 1;
        return [{ name, lat: points[1].lat, lng: points[1].lng, types: ['museum'], rating: 4.6, userRatings: 900, address: null, facts: [] }];
      },
      generateStory: async prompt => cannedStory(subjectFromPrompt(prompt)),
      synthesize: async () => new Blob(['fake-audio']),
      ingest: async ({ unit: u }) => `library/${u.placeKey}/${u.angle}-zz-route-gap-v1.wav`,
    },
  );
  const generatedItems = filled.items.filter(i => i.unit && i.unit.audioPath && i.unit.audioPath.includes('-route-gap-v1'));
  assert.equal(generatedItems.length, 2, 'fixture: both composed gaps generated a fill');
  const target = generatedItems.reduce((a, b) => (a.anchorProgress <= b.anchorProgress ? a : b));
  const audio = new RealFakeAudio(400);
  const events = [];
  const heard = [];
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onEvent: (t, p) => events.push({ t, p }),
    onStoryHeard: u => heard.push(u.id),
  });
  await runner.start(filled);
  await until(() => heard.includes('a|landmark_origin'), 'the departure story sounded');
  // Jump past the generated item's window without sounding it.
  const jumpProgress = Math.min(0.97, target.expireProgress + 0.1);
  runner.onPosition({ lat: 32.7 + jumpProgress * 0.2, lng: -117.25 });
  await until(
    () => events.some(e => e.t === 'story_dropped' && e.p.subject === target.unit.placeName),
    'the generated item dropped stale at the feed gate',
  );
  assert.ok(!heard.includes(target.unit.id), 'the dropped generated story was never heard-recorded');
  runner.onPosition(denseDest); // arrival with the dropped story unplayed → it is owed
  await until(() => runner.view().closeoutDone, 'arrival closeout');
  assert.equal(runner.view().endedKind, 'arrival-owed');
  assert.ok(
    runner.view().owed && runner.view().owed.includes(target.unit.placeName),
    `owed tease names the dropped generated story (got: ${runner.view().owed})`,
  );
  runner.endTour();
});

// ---- manifest (route differentiator 3): the episode card is
// read off the real plan — counts, closing story, thread title,
// the new-to-you count against the heard ledger ----
const mfOut = join(mkdtempSync(join(tmpdir(), 'route-manifest-')), 'routeManifest.mjs');
execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'esbuild'),
  [
    join(repoRoot, 'src', 'core', 'routeManifest.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    `--outfile=${mfOut}`,
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
);
const mf = await import(pathToFileURL(mfOut).href);

check('manifest: a threaded plan reads as an episode card', () => {
  const plan = composeDense([
    navy('n1|landmark_origin', 32.72),
    navy('n2|landmark_origin', 32.78),
    navy('n3|landmark_origin', 32.84),
    navy('hq|landmark_origin', 32.887, { durationSec: 300 }),
  ]);
  plan.driveSec = 1500; // the App stamps the Routes estimate on the final plan
  const m = mf.buildManifest(plan, new Set(['n1']), { originName: 'Originville' });
  assert.equal(m.title, 'The Navy Century: Originville to Dest');
  assert.equal(m.runtimeLine, 'About 25 minutes of driving');
  assert.equal(m.storyCount, 4, 'the count is the plan’s own story items');
  assert.equal(m.newCount, 3, 'n1’s place is in the heard ledger — every other place is new');
  assert.equal(m.closingStoryName, 'hq|landmark_origin', 'the closing story is the plan’s actual final story (the reserved flagship)');
  assert.equal(m.threadLine, 'One thread all the way — The Navy Century');
});
check('manifest: no thread → plain origin-to-destination title, no thread line', () => {
  const plan = composeDense([unit('a|landmark_origin', 32.72), unit('b|landmark_origin', 32.8)]);
  plan.driveSec = 1500;
  const m = mf.buildManifest(plan, new Set(), { originName: 'Originville' });
  assert.equal(m.title, 'Originville to Dest');
  assert.equal(m.threadLine, null);
  assert.equal(m.storyCount, 2);
  assert.equal(m.newCount, 2);
  assert.equal(m.closingStoryName, 'b|landmark_origin');
});
check('manifest: an unmapped topic falls back to its raw tag; runtime spans format in words', () => {
  assert.equal(mf.threadTitle('Coast'), 'The Coast');
  assert.equal(mf.threadTitle('Some New Topic'), 'Some New Topic');
  assert.equal(mf.driveTimeLine(60), 'About 1 minute of driving');
  assert.equal(mf.driveTimeLine(3600), 'About 1 hour of driving');
  assert.equal(mf.driveTimeLine(3900), 'About 1 hour 5 minutes of driving');
  const plan = {
    destinationName: 'Dest',
    destination: denseDest,
    path: densePath,
    driveSec: 900,
    budgetSec: 900,
    items: [{ kind: 'story', id: 'x|landmark_origin', label: 'x', durationSec: 120, unit: unit('x|landmark_origin', 32.7), ready: true }],
    totalSec: 120,
    skippedHeard: 0,
    topicsMatched: false,
    toneMatched: false,
    thread: { topic: 'Some New Topic', memberIds: ['x|landmark_origin'], score: 3 },
    threadSource: 'detected',
    climaxUnitId: null,
    climaxMode: 'natural',
    climaxSubject: null,
    climaxDistanceKm: null,
    portalClimaxSeeking: null,
    previewFacts: null,
    openingSubject: null,
  };
  const m = mf.buildManifest(plan, new Set(), { originName: 'Here' });
  assert.equal(m.title, 'Some New Topic: Here to Dest', 'unmapped thread titles degrade to the tag itself');
});
check('manifest: an empty plan still builds a card (no closing story, zero counts)', () => {
  const plan = {
    destinationName: 'Dest',
    destination: denseDest,
    path: densePath,
    driveSec: null,
    budgetSec: 1800,
    items: [],
    totalSec: 0,
    skippedHeard: 0,
    topicsMatched: false,
    toneMatched: false,
    thread: null,
    threadSource: null,
    climaxUnitId: null,
    climaxMode: 'natural',
    climaxSubject: null,
    climaxDistanceKm: null,
    portalClimaxSeeking: null,
    previewFacts: null,
    openingSubject: null,
  };
  const m = mf.buildManifest(plan, new Set(), { originName: 'Here' });
  assert.equal(m.storyCount, 0);
  assert.equal(m.newCount, 0);
  assert.equal(m.closingStoryName, null);
  assert.equal(m.runtimeLine, 'About 30 minutes of driving', 'runtime falls back to the budget when no estimate rides the plan');
});
check('manifest: the origin area names itself from the nearest fetched unit, else the fallback', () => {
  const units = [unit('near|landmark_origin', 32.71), unit('far|landmark_origin', 32.85)];
  assert.equal(mf.originAreaName(units, { lat: 32.7, lng: -117.25 }, 'Fallback'), 'near|landmark_origin');
  assert.equal(mf.originAreaName(units, { lat: 32.2, lng: -117.25 }, 'Fallback'), 'Fallback', 'nothing fetched is the origin’s ground from 50 km away');
});

// ---- drive record store + matching (addendum 2) ----
const rhOut = join(mkdtempSync(join(tmpdir(), 'route-history-')), 'routeHistory.mjs');
execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'esbuild'),
  [join(repoRoot, 'src', 'core', 'routeHistory.ts'), '--bundle', '--format=esm', '--platform=node', `--outfile=${rhOut}`, '--log-level=warning'],
  { stdio: 'inherit' },
);
const rh = await import(pathToFileURL(rhOut).href);
const mkRecord = (over = {}) => ({
  destinationName: 'Dest',
  destinationPlaceKey: null,
  threadTopic: null,
  playedSubjects: [],
  owedSubjects: [],
  endedAt: 1000,
  ...over,
});
const fakeStore = () => {
  let data = null;
  return { read: () => data, write: v => { data = v; }, raw: () => data };
};

check('drive record store: round-trip through the seam; the cap evicts the oldest', () => {
  const store = fakeStore();
  for (let i = 1; i <= 21; i++) rh.saveDriveRecord(store, mkRecord({ destinationName: `D${i}`, endedAt: i }));
  const loaded = rh.loadDriveRecords(store);
  assert.equal(loaded.length, 20, 'the store is capped at 20 records');
  assert.equal(loaded[0].destinationName, 'D21', 'newest first');
  assert.equal(loaded[loaded.length - 1].destinationName, 'D2', 'the 21st save evicted D1');
});
check('drive record store: corruption, wrong shapes and oversize all read as no records', () => {
  assert.deepEqual(rh.parseDriveRecords('{oops'), []);
  assert.deepEqual(rh.parseDriveRecords('{"x":1}'), []);
  assert.deepEqual(rh.parseDriveRecords('[{"destinationName":42}]'), [], 'shape-invalid entries are dropped');
  assert.deepEqual(rh.parseDriveRecords('x'.repeat(70000)), [], 'an oversized store is corruption, not history');
  assert.deepEqual(rh.loadDriveRecords({ read: () => { throw new Error('denied'); }, write: () => {} }), [], 'a throwing read degrades silently');
  assert.deepEqual(rh.loadDriveRecords(fakeStore()), [], 'an empty store is no records');
});
check('prior drive match: destination beats topic, place_key beats name, newest wins inside a tier', () => {
  const topicNewer = mkRecord({ destinationName: 'Elsewhere', threadTopic: 'Coast', endedAt: 2000 });
  const destOlder = mkRecord({ destinationName: 'Dest', threadTopic: 'Navy Century', endedAt: 1000 });
  const hit = rh.selectPriorDrive([topicNewer, destOlder], { destinationPlaceKey: null, destinationName: 'Dest', threadTopic: 'Coast' });
  assert.equal(hit, destOlder, 'a destination match outranks a newer topic match');
  const byNameRec = mkRecord({ destinationName: 'Dest', destinationPlaceKey: 'other-place' });
  const byKeyRec = mkRecord({ destinationName: 'A Different Name Entirely', destinationPlaceKey: 'dest-key' });
  const keyHit = rh.selectPriorDrive([byNameRec, byKeyRec], { destinationPlaceKey: 'dest-key', destinationName: 'Dest', threadTopic: null });
  assert.equal(keyHit, byKeyRec, 'a place_key match outranks a name match');
  const nameHit = rh.selectPriorDrive([topicNewer], { destinationPlaceKey: null, destinationName: 'elsewhere', threadTopic: null });
  assert.equal(nameHit, topicNewer, 'name matching is normalized (case/spacing)');
  const threadHit = rh.selectPriorDrive([topicNewer], { destinationPlaceKey: null, destinationName: 'Dest', threadTopic: 'Coast' });
  assert.equal(threadHit, topicNewer, 'the topic tier catches what the destination tiers miss');
  assert.equal(rh.selectPriorDrive([topicNewer], { destinationPlaceKey: null, destinationName: 'Dest', threadTopic: 'Navy Century' }), null, 'no tier matches → no prior drive');
  assert.equal(rh.selectPriorDrive([], { destinationPlaceKey: null, destinationName: 'Dest', threadTopic: 'Coast' }), null);
});
check('still-owed: the current heard ledger discharges its share; the preview carries at most two', () => {
  const rec = mkRecord({ owedSubjects: ['Alpha', 'Beta', 'Gamma', 'Delta'] });
  assert.deepEqual(rh.stillOwedSubjects(rec, new Set(['beta'])), ['Alpha', 'Gamma'], 'heard since (any case) is discharged, order kept');
  assert.deepEqual(rh.stillOwedSubjects(rec, new Set()), ['Alpha', 'Beta'], 'capped at two');
  assert.deepEqual(rh.stillOwedSubjects(rec, new Set(['Alpha', 'Beta', 'Gamma', 'Delta'])), [], 'fully discharged → nothing owed');
});
check('preview: a matched prior drive feeds the preview item — its thread and its still-owed subjects', () => {
  const records = [
    mkRecord({ destinationName: 'Dest', threadTopic: 'Coast', owedSubjects: ['Owed Place'], endedAt: 5000 }),
  ];
  const plan = composeDense(
    [navy('n1|landmark_origin', 32.72), navy('n2|landmark_origin', 32.78), navy('n3|landmark_origin', 32.84)],
    noTopics,
    { driveRecords: records },
  );
  const previewItem = plan.items.find(i => i.kind === 'preview');
  assert.ok(previewItem.text.includes('the thread was Coast'), 'the prior drive’s thread is named');
  assert.ok(previewItem.text.includes('Miles still owes you Owed Place'), 'the still-owed subject is named (the caller pre-filtered it against the heard ledger)');
  const byThread = composeDense(
    [navy('n1|landmark_origin', 32.72), navy('n2|landmark_origin', 32.78), navy('n3|landmark_origin', 32.84)],
    noTopics,
    { driveRecords: [mkRecord({ destinationName: 'Elsewhere', threadTopic: 'Navy Century', owedSubjects: [], endedAt: 5000 })] },
  );
  assert.ok(byThread.items.find(i => i.kind === 'preview').text.includes('the thread was Navy Century'), 'a thread-tier match feeds the preview too');
  const noMatch = composeDense(
    [navy('n1|landmark_origin', 32.72), navy('n2|landmark_origin', 32.78), navy('n3|landmark_origin', 32.84)],
    noTopics,
    { driveRecords: [mkRecord({ destinationName: 'Elsewhere', threadTopic: 'Coast', owedSubjects: ['Owed Place'], endedAt: 5000 })] },
  );
  assert.ok(!noMatch.items.some(i => i.text && i.text.includes('still owes you')), 'no matched record → the preview is addendum-1’s, untouched');
});
check('preview: the drive nod takes the continuity slot over the subject-level nod', () => {
  const heardOnRoute = unit('old|landmark_origin', 32.8);
  const plan = composeDense(
    [navy('n1|landmark_origin', 32.72), navy('n2|landmark_origin', 32.78), navy('n3|landmark_origin', 32.84), heardOnRoute],
    noTopics,
    {
      heardKeys: new Set(['old|landmark_origin']),
      driveRecords: [mkRecord({ destinationName: 'Dest', threadTopic: null, owedSubjects: ['Owed Place'], endedAt: 5000 })],
    },
  );
  const previewItem = plan.items.find(i => i.kind === 'preview');
  assert.ok(previewItem.text.includes('Miles still owes you Owed Place'), 'the drive nod renders');
  assert.ok(!previewItem.text.includes('today, new ground'), 'the subject-level nod stands down — one nod, not two');
});

// ---- consolidation (Nov 3, 2026): the priority ladder made
// auditable (§1), the preview as its own plan item (§2), the
// fit/pairing cuts (§3), the off-route portal climax (§4), and
// the owed-line wart fix (§5) ----
check('ladder (§1): the plan records its decisions — thread source and preview facts', () => {
  const detected = composeDense([navy('n1|landmark_origin', 32.72), navy('n2|landmark_origin', 32.78), navy('n3|landmark_origin', 32.84)]);
  assert.equal(detected.threadSource, 'detected', 'a shelf-found thread is recorded as detected');
  assert.deepEqual(detected.previewFacts, { threadPromised: true, previouslyDrive: false, previouslySubject: false });
  const userPicked = composeDense(
    [
      unit('c1|landmark_origin', 32.72, { topics: ['Coast'] }),
      unit('c2|landmark_origin', 32.76, { topics: ['Coast'] }),
      unit('c3|landmark_origin', 32.8, { topics: ['Coast'] }),
    ],
    { ...noTopics, topics: ['Coast'] },
  );
  assert.equal(userPicked.thread?.topic, 'Coast');
  assert.equal(userPicked.threadSource, 'user', "the listener's own pick is recorded as user-sourced");
  const none = composeDense([unit('a|landmark_origin', 32.72), unit('b|landmark_origin', 32.78), unit('c|landmark_origin', 32.86)]);
  assert.equal(none.threadSource, null);
  assert.deepEqual(none.previewFacts, { threadPromised: false, previouslyDrive: false, previouslySubject: false });
  const heardOnRoute = unit('old|landmark_origin', 32.8);
  const nod = composeDense(
    [navy('n1|landmark_origin', 32.72), navy('n2|landmark_origin', 32.78), navy('n3|landmark_origin', 32.84), heardOnRoute],
    noTopics,
    { heardKeys: new Set(['old|landmark_origin']) },
  );
  assert.equal(nod.previewFacts.previouslySubject, true, 'the facts record the subject-level nod the preview carries');
  assert.equal(nod.previewFacts.previouslyDrive, false);
});
await checkAsync('ladder (§1): route_plan_started carries the auditable decisions record', async () => {
  const audio = new RealFakeAudio(200);
  const events = [];
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onEvent: (t, p) => events.push({ t, p }),
    onStoryHeard: () => {},
  });
  await runner.start(threadPlan());
  const started = events.find(e => e.t === 'route_plan_started');
  assert.ok(started, 'the plan-started event filed');
  assert.deepEqual(started.p.decisions.thread, { topic: 'Navy Century', source: 'detected' });
  assert.deepEqual(started.p.decisions.climax, { mode: started.p.climax.mode, subject: started.p.climax.subject });
  assert.equal(started.p.decisions.climax.mode, 'late');
  assert.deepEqual(started.p.decisions.preview, { threadPromised: true, previouslyDrive: false, previouslySubject: false });
  assert.ok(!JSON.stringify(started.p).includes('bookend'), 'no pairing fields ride the telemetry');
  assert.ok(!JSON.stringify(started.p).includes('"fit"'), 'no fit fields ride the telemetry');
  runner.endTour();
});
check('preview item (§2): first in the plan, not a story, invisible to the manifest counts', () => {
  const plan = composeDense([
    unit('a|landmark_origin', 32.72),
    unit('b|landmark_origin', 32.76),
    unit('c|landmark_origin', 32.8),
    unit('d|landmark_origin', 32.86),
  ]);
  const preview = plan.items[0];
  assert.equal(preview.kind, 'preview', 'the plan opens with the preview item');
  assert.equal(preview.unit, undefined, 'the preview carries no library unit — it is not a story');
  assert.equal(preview.releaseProgress, undefined, 'no window: it cannot drop stale if the tour starts late');
  assert.equal(preview.expireProgress, undefined);
  const m = mf.buildManifest(plan, new Set(), { originName: 'Here' });
  assert.equal(m.storyCount, storyItems(plan).length, 'the manifest counts stories only — the preview is not one of them');
  const empty = composeDense([]);
  assert.ok(!empty.items.some(i => i.kind === 'preview'), 'no stories → no preview item');
});
await checkAsync('preview item (§2): plays first, is never heard-recorded, and its failure never wedges the plan', async () => {
  const audio = new RealFakeAudio(200);
  const events = [];
  const heard = [];
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onEvent: (t, p) => events.push({ t, p }),
    onStoryHeard: u => heard.push(u.id),
  });
  await runner.start(anchorPlan());
  await until(() => heard.length >= 1, 'departure story heard after the preview');
  assert.ok(audio.played[0].includes("We're%20headed"), 'the preview sounded first');
  assert.ok(events.some(e => e.t === 'route_preview' && e.p.preview === 'generated'), 'preview generation on the record');
  assert.ok(events.some(e => e.t === 'route_preview' && e.p.preview === 'played'), 'preview play on the record');
  assert.equal(heard[0], 'a|landmark_origin', 'the first heard entry is the departure story — the preview is never heard-recorded');
  runner.endTour();
  const audio2 = new RealFakeAudio(200);
  const events2 = [];
  const heard2 = [];
  const runner2 = new rp.RoutePlanRunner({
    audio: audio2,
    synthUrl: async t => {
      if (t.includes("We're headed")) throw new Error('synth down');
      return 'blob:audio/' + encodeURIComponent(t.slice(0, 16));
    },
    onEvent: (t, p) => events2.push({ t, p }),
    onStoryHeard: u => heard2.push(u.id),
  });
  await runner2.start(anchorPlan());
  await until(() => heard2.length >= 1, 'departure story still sounds without a preview');
  assert.ok(events2.some(e => e.t === 'route_preview' && e.p.preview === 'failed'), 'preview failure on the record');
  assert.equal(heard2[0], 'a|landmark_origin', 'the plan proceeds — the departure story is first, exactly as before');
  runner2.endTour();
});
check('cuts (§3): no fit/pairing fields survive in plan shapes, narration text, or source', () => {
  const plan = composeDense([navy('n1|landmark_origin', 32.72), navy('n2|landmark_origin', 32.78), navy('n3|landmark_origin', 32.84)]);
  for (const k of ['climaxFit', 'bookend', 'bookendTopic']) assert.ok(!(k in plan), `plan.${k} is gone`);
  const ctx = rm.buildWrapUpContext(plan);
  assert.deepEqual(Object.keys(ctx).sort(), ['climaxMode', 'climaxSubject', 'destinationName', 'threadTopic']);
  const read = p => readFileSync(join(repoRoot, p), 'utf8');
  for (const p of ['src/core/routeMode.ts', 'src/core/narration.ts', 'src/core/routePlayback.ts']) {
    const src = read(p);
    assert.ok(!src.includes('bookend'), `${p} carries no pairing machinery`);
    assert.ok(!src.includes('climaxFit'), `${p} carries no fit machinery`);
  }
  const paired = composeDense([
    unit('dawn|landmark_origin', 32.72, { topics: ['Harbor Lights'] }),
    unit('mid|landmark_origin', 32.78),
    unit('heavy|landmark_origin', 32.85, { durationSec: 320 }),
    unit('dusk|corridor', 32.87, { angle: 'corridor', topics: ['Harbor Lights'] }),
  ]);
  assert.ok(
    !paired.items.some(i => i.text && (i.text.includes('hold onto') || i.text.includes('explains the beginning'))),
    'no loop language in the preview, the bridges, or anywhere else',
  );
});
const portalShelf = farSec => [
  navy('n1|landmark_origin', 32.72),
  navy('n2|landmark_origin', 32.78),
  navy('n3|landmark_origin', 32.84, { durationSec: 240 }),
  unit('far|landmark_origin', 32.8, { lng: -117.05, topics: ['Navy Century'], durationSec: farSec }),
];
check('portal climax (§4): a county-wide landmark that clearly beats the road takes the slot — sequenced last, framed honestly', () => {
  const plan = composeDense(portalShelf(500)); // in-corridor best is 240 s; the bar is 300 s
  assert.equal(plan.climaxMode, 'portal');
  assert.equal(plan.climaxUnitId, 'far|landmark_origin');
  assert.equal(plan.climaxSubject, 'far|landmark_origin');
  assert.ok(plan.climaxDistanceKm > 10, `its distance from the route rides the plan (got ${plan.climaxDistanceKm} km)`);
  assert.equal(plan.portalClimaxSeeking, null, 'the slot is decided — no additional fetch is asked for');
  const stories = storyItems(plan);
  const last = stories[stories.length - 1];
  assert.equal(last.id, 'far|landmark_origin', 'the portal climax is the last story before the wrap-up');
  assert.equal(last.climax, true);
  assert.equal(last.portalClimax, true);
  assert.equal(last.releaseProgress, undefined, 'windowless: released by sequence position, exempt from stale-drop');
  assert.ok(last.anchorProgress >= 2 / 3, 'its synthetic anchor sits in the final stretch');
  const bridge = plan.items.filter(i => i.kind === 'bridge').find(b => b.nextUnitId === 'far|landmark_origin');
  assert.ok(bridge, 'a bridge leads into it');
  assert.ok(bridge.text.includes("isn't on our road at all"), 'the bridge frames the hop honestly');
  assert.ok(bridge.text.includes('clear across the county'), 'the distance is stated, not hidden');
  assert.ok(!bridge.text.includes('just ahead is far|landmark_origin'), 'no proximity language for an off-route story (A14)');
  const preview = plan.items.find(i => i.kind === 'preview');
  assert.ok(preview.text.includes('far|landmark_origin'), 'the preview teases the actual climax — even across the county');
});
check('portal climax (§4): bar missed → the in-corridor climax stands, and the slot stays open for one bounded fetch', () => {
  const plan = composeDense(portalShelf(280)); // 280 < 240 × 1.25 = 300
  assert.equal(plan.climaxUnitId, 'n3|landmark_origin', 'the road’s own best keeps the slot');
  assert.equal(plan.climaxMode, 'late');
  assert.equal(plan.climaxDistanceKm, null);
  assert.equal(plan.portalClimaxSeeking, 'Navy Century', 'the open slot names its topic for the App’s one additional fetch');
});
check('portal climax (§4): with no late candidate on the road, the strongest unit on the topic takes the open slot', () => {
  const plan = composeDense([
    navy('e1|landmark_origin', 32.71),
    navy('e2|landmark_origin', 32.74),
    navy('e3|landmark_origin', 32.77),
    unit('far|landmark_origin', 32.8, { lng: -117.05, topics: ['Navy Century'], durationSec: 400 }),
  ]);
  assert.equal(plan.climaxMode, 'portal');
  assert.equal(plan.climaxUnitId, 'far|landmark_origin');
  assert.equal(storyItems(plan)[storyItems(plan).length - 1].id, 'far|landmark_origin');
});
check('portal climax (§4): no thread and no chosen topic → the slot never opens', () => {
  const plan = composeDense([
    unit('a|landmark_origin', 32.72),
    unit('b|landmark_origin', 32.78),
    unit('c|landmark_origin', 32.87),
    unit('far|landmark_origin', 32.8, { lng: -117.05, topics: ['Navy Century'], durationSec: 500 }),
  ]);
  assert.notEqual(plan.climaxMode, 'portal');
  assert.equal(plan.portalClimaxSeeking, null);
});
check('portal climax (§4): a user topic with no thread still opens the slot; climax-only units can take it and nothing else', () => {
  const far = unit('far|landmark_origin', 32.8, { lng: -117.05, topics: ['Coast'], durationSec: 500 });
  const base = [
    unit('a|landmark_origin', 32.72),
    unit('b|landmark_origin', 32.78),
    unit('c|landmark_origin', 32.87, { durationSec: 240 }),
  ];
  const plan = composeDense(base, { ...noTopics, topics: ['Coast'] }, { climaxOnlyUnits: [far] });
  assert.equal(plan.thread, null, 'one Coast unit is no thread');
  assert.equal(plan.climaxMode, 'portal', 'the user’s first topic opens the slot');
  assert.equal(plan.climaxUnitId, 'far|landmark_origin');
  const farItems = plan.items.filter(i => i.id === 'far|landmark_origin');
  assert.equal(farItems.length, 1, 'the climax-only unit appears exactly once — as the climax');
  assert.equal(farItems[0].portalClimax, true);
  assert.equal(farItems[0].portal, undefined, 'it is not a portal hop and consumed no portal budget');
  const missed = composeDense(
    base,
    { ...noTopics, topics: ['Coast'] },
    { climaxOnlyUnits: [unit('far|landmark_origin', 32.8, { lng: -117.05, topics: ['Coast'], durationSec: 200 })] },
  );
  assert.notEqual(missed.climaxMode, 'portal', 'under the bar (200 < 300), the road keeps its climax');
  assert.ok(!missed.items.some(i => i.id === 'far|landmark_origin'), 'a climax-only unit that misses the bar appears nowhere in the plan');
});
await checkAsync('portal climax (§4): unplayed at the close, it is owed like any story and named in the drive record', async () => {
  const plan = composeDense(portalShelf(500));
  assert.equal(plan.climaxMode, 'portal');
  const audio = new RealFakeAudio(200);
  const heard = [];
  const records = [];
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onEvent: () => {},
    onStoryHeard: u => heard.push(u.id),
    onDriveRecord: r => records.push(r),
  });
  await runner.start(plan);
  await until(() => heard.length >= 1, 'departure story sounded');
  runner.onPosition(denseDest); // arrival with most of the plan unplayed
  await until(() => runner.view().closeoutDone, 'arrival closeout');
  assert.ok(runner.view().owed && runner.view().owed.includes('Miles owes you'), 'the owed line stands');
  assert.equal(records.length, 1, 'one drive record filed');
  assert.ok(records[0].owedSubjects.includes('far|landmark_origin'), 'the drive record names the unplayed portal climax as owed');
  runner.endTour();
});
await checkAsync('wart (§5): arrival during the final story — it plays to completion and is NOT owed', async () => {
  const audio = new RealFakeAudio(250);
  const heard = [];
  const records = [];
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onEvent: () => {},
    onStoryHeard: u => heard.push(u.id),
    onDriveRecord: r => records.push(r),
  });
  await runner.start(anchorPlan());
  await until(() => heard.includes('a|landmark_origin'), 'a sounded');
  runner.onPosition({ lat: 32.78, lng: -117.25 });
  await until(() => heard.includes('b|landmark_origin'), 'b sounded');
  runner.onPosition({ lat: 32.87, lng: -117.25 });
  await until(() => audio.played.some(u => u.includes('c%7Clandmark_origin')), 'c sounding');
  runner.onPosition(denseDest); // arrival while the final story is on the element
  await until(() => runner.view().closeoutDone, 'closeout completed');
  assert.ok(heard.includes('c|landmark_origin'), 'the final story played to completion');
  assert.ok(!(runner.view().owed ?? '').includes('c|landmark_origin'), `the completed climax is not named owed (got: ${runner.view().owed})`);
  assert.equal(records.length, 1);
  assert.ok(!records[0].owedSubjects.includes('c|landmark_origin'), 'nor does the drive record owe it');
  runner.endTour();
});
await checkAsync('wart (§5): the exclusion is surgical — a genuinely dropped story is still owed', async () => {
  const audio = new RealFakeAudio(250);
  const heard = [];
  const records = [];
  const events = [];
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onEvent: (t, p) => events.push({ t, p }),
    onStoryHeard: u => heard.push(u.id),
    onDriveRecord: r => records.push(r),
  });
  await runner.start(anchorPlan());
  await until(() => heard.includes('a|landmark_origin'), 'a sounded');
  runner.onPosition({ lat: 32.8, lng: -117.25 }); // progress ≈ 0.475 — past b's window
  await until(() => events.some(e => e.t === 'story_dropped' && e.p.subject === 'b|landmark_origin'), 'b dropped stale');
  runner.onPosition({ lat: 32.87, lng: -117.25 }); // c's window
  await until(() => audio.played.some(u => u.includes('c%7Clandmark_origin')), 'c sounding');
  runner.onPosition(denseDest); // arrival while c sounds; b was genuinely dropped
  await until(() => runner.view().closeoutDone, 'closeout completed');
  assert.ok((runner.view().owed ?? '').includes('b|landmark_origin'), `the dropped story is still owed (got: ${runner.view().owed})`);
  assert.ok(!(runner.view().owed ?? '').includes('c|landmark_origin'), 'the sounding completer is not owed');
  assert.ok(records[0].owedSubjects.includes('b|landmark_origin'), 'the drive record owes the dropped story');
  assert.ok(!records[0].owedSubjects.includes('c|landmark_origin'), 'and not the completer');
  runner.endTour();
});

// ---- composer v3, commit A: grader metric correctness ----
// The grader (grader.mjs) is scored, not gated — but its metric
// computations are pinned here against hand-computed plans.
const grader = await import('./grader.mjs');
{
  const gu = (id, placeKey, angle, durationSec) => ({
    id, placeKey, placeName: placeKey, angle,
    lat: 0, lng: 0, durationSec, topics: [], tone: null, toneSecondary: null,
    audioPath: 'x', storyText: null,
  });
  // driveSec 1000. Sounding intervals: A [0,300] (window),
  // B [500,600] (windowless, anchor), C [600,700] (window),
  // P [780,920] (window, portal, climax). Covered = 640.
  const handPlan = {
    items: [
      { kind: 'preview', id: 'preview', durationSec: 30 },
      { kind: 'story', id: 'a|landmark_origin', durationSec: 300, anchorProgress: 0, releaseProgress: 0, expireProgress: 0.3, unit: gu('a|landmark_origin', 'pk-a', 'landmark_origin', 300) },
      { kind: 'bridge', id: 'br1', durationSec: 20 },
      { kind: 'story', id: 'b|landmark_event', durationSec: 100, anchorProgress: 0.5, unit: gu('b|landmark_event', 'pk-b', 'landmark_event', 100) },
      { kind: 'story', id: 'c|corridor', durationSec: 90, anchorProgress: 0.65, releaseProgress: 0.6, expireProgress: 0.7, unit: gu('c|corridor', 'pk-c', 'corridor', 90) },
      { kind: 'story', id: 'p|landmark_people', durationSec: 120, anchorProgress: 0.8, releaseProgress: 0.78, expireProgress: 0.92, portal: true, climax: true, unit: gu('p|landmark_people', 'pk-p', 'landmark_people', 120) },
    ],
    thread: { topic: 'Coast', memberIds: [], score: 3 },
    climaxUnitId: 'p|landmark_people',
    climaxMode: 'late',
    budgetSec: 1000,
  };
  const pool = [100, 200, 300, 120].map((d, i) => gu(`pool${i}|landmark_origin`, `pk-pool${i}`, 'landmark_origin', d));
  const m = grader.planMetrics(handPlan, { driveSec: 1000, climaxPool: pool });
  check('grader metrics: silence share counts story-covered seconds only (bridges/preview are not coverage)', () => {
    assert.equal(m.silenceSec, 360);
    assert.equal(m.silenceShare, 0.36);
    const overlap = { items: [
      { kind: 'story', id: 'x', durationSec: 300, anchorProgress: 0, releaseProgress: 0, expireProgress: 0.3, unit: gu('x', 'pk-x', 'landmark_origin', 300) },
      { kind: 'story', id: 'y', durationSec: 300, anchorProgress: 0.2, releaseProgress: 0.2, expireProgress: 0.5, unit: gu('y', 'pk-y', 'landmark_origin', 300) },
    ] };
    assert.equal(grader.coveredStorySec(overlap, 1000), 500); // union, not sum
  });
  check('grader metrics: thread, climax presence/mode/winner class read off the plan', () => {
    assert.equal(m.threadTopic, 'Coast');
    assert.equal(m.climaxPresent, true);
    assert.equal(m.climaxMode, 'late');
    assert.equal(m.climaxWinnerClass, 'landmark');
  });
  check('grader metrics: climax percentile counts pool members below + half the ties', () => {
    assert.equal(m.climaxPercentile, 0.375); // (1 below + 0.5 × 1 tie) / 4
    assert.equal(grader.weightPercentile([], pool[0]), null);
    assert.equal(grader.weightPercentile(pool, null), null);
  });
  check('grader metrics: stale-drop risk = window slack under a quarter of the telling', () => {
    assert.equal(m.atRisk, 3); // A (slack 0), C (10 < 22.5), P (20 < 30); windowless B skipped
  });
  check('grader metrics: portal share and distinct places', () => {
    assert.equal(m.portalShare, 0.25);
    assert.equal(m.distinctPlaces, 4);
    assert.equal(m.stories, 4);
  });
  check('grader worlds: seeded generation is deterministic and census-shaped', () => {
    const w1 = grader.buildWorld(1103, 'current');
    const w2 = grader.buildWorld(1103, 'current');
    assert.equal(w1.census, w2.census);
    assert.equal(w1.topicLessShare, w2.topicLessShare);
    assert.ok(Math.abs(w1.census - 1264) / 1264 < 0.05, `census ${w1.census} within 5% of 1264`);
    assert.ok(w1.topicLessShare > 0.2 && w1.topicLessShare < 0.42, `topic-less share ${w1.topicLessShare}`);
    const r1 = grader.mulberry32(7);
    const r2 = grader.mulberry32(7);
    assert.deepEqual([r1(), r1(), r1()], [r2(), r2(), r2()]);
  });
}

console.log(`\nroute-mode harness: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
