// Route-mode harness (v16.1): pure-function suites for the
// composer, the GPS guards, and the arrival closeout, plus Monte
// Carlo invariants. No live calls anywhere — geocode / Routes /
// Gemini paths are exercised against stub fetches only.
//
// Usage: node scripts/route-mode/run.mjs
// Exit 0 = all checks pass; anything else prints failures.

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
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
  await runner.start(qaPlan());
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

console.log(`\nroute-mode harness: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
