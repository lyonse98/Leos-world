// Route-mode harness (v16.1): pure-function suites for the
// composer, the GPS guards, and the arrival closeout, plus Monte
// Carlo invariants. No live calls anywhere — geocode / Routes /
// Gemini paths are exercised against stub fetches only.
//
// Usage: node scripts/route-mode/run.mjs
// Exit 0 = all checks pass; anything else prints failures.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

// The bundled presence data (Nov 4, 2026): the woven suites
// below pin its shape and its Protected/bound exclusions.
const rpdOut = join(mkdtempSync(join(tmpdir(), 'route-presence-')), 'routePresence.mjs');
execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'esbuild'),
  [
    join(repoRoot, 'src', 'data', 'routePresence.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    `--outfile=${rpdOut}`,
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
);
const rpd = await import(pathToFileURL(rpdOut).href);

// The bundled route tags (Nov 1 tagging + the woven twins'
// inherited topics): the woven-twins data suites below pin
// the two generated maps against each other.
const rtOut = join(mkdtempSync(join(tmpdir(), 'route-tags-')), 'routeTags.mjs');
execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'esbuild'),
  [
    join(repoRoot, 'src', 'data', 'routeTags.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    `--outfile=${rtOut}`,
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
);
const rtg = await import(pathToFileURL(rtOut).href);

// The Color Puck pass (audience coloring, Nov 5, 2026),
// bundled beside routeMode/narration: its suites drive the
// pass directly with stubbed generation — zero live calls.
const rcOut = join(mkdtempSync(join(tmpdir(), 'route-color-')), 'routeColor.mjs');
execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'esbuild'),
  [
    join(repoRoot, 'src', 'core', 'routeColor.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--define:import.meta.env={}',
    `--outfile=${rcOut}`,
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
);
const rc = await import(pathToFileURL(rcOut).href);

// The humor bank data module (Unfiltered, Nov 6, 2026):
// the shipped bank is Erik's reviewed bank (populated
// Nov 6, 2026) — its suites pin the reviewed contents, and
// the draw suites inject fixture banks through the colorize
// deps, never through here.
const hbOut = join(mkdtempSync(join(tmpdir(), 'route-humor-')), 'humorBank.mjs');
execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'esbuild'),
  [
    join(repoRoot, 'src', 'data', 'humorBank.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--define:import.meta.env={}',
    `--outfile=${hbOut}`,
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
);
const hb = await import(pathToFileURL(hbOut).href);

// The bundled memorial data (memorial audit, Nov 7, 2026):
// the audited death/memorial set the narrowed episode-wide
// kill reads — its suite below pins the audit's contents
// (the Soledad split included) against the CSV's calls.
const rmdOut = join(mkdtempSync(join(tmpdir(), 'route-memorial-')), 'routeMemorial.mjs');
execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'esbuild'),
  [
    join(repoRoot, 'src', 'data', 'routeMemorial.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    `--outfile=${rmdOut}`,
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
);
const rmd = await import(pathToFileURL(rmdOut).href);

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

// ---- composer v3.1, commit A: story-level heard granularity ----
// The ledger files tellings by verbatim story text; the route
// derivation (heardKeysForStories) excludes exactly the telling
// whose text was filed. One heard angle no longer kills its
// place — and the sweep seats at most one telling per place
// per plan, so the depth spends across drives.
check('v3.1 heard derivation: filed texts name the exact telling heard — not the place', () => {
  const units = [
    unit('p|landmark_origin', 32.75, { storyText: 'alpha text' }),
    unit('p|landmark_event', 32.75, { storyText: 'beta text' }),
    unit('q|landmark_origin', 32.8, { storyText: null }),
  ];
  const keys = rm.heardKeysForStories(units, new Set(['alpha text', 'a live-generated telling']));
  assert.deepEqual([...keys], ['p|landmark_origin']);
  assert.equal(rm.heardKeysForStories(units, new Set()).size, 0);
});

check('v3.1 granularity: an unheard angle of a heard place is selectable; the heard angle never serves', () => {
  const units = [
    unit('p|landmark_origin', 32.75),
    unit('p|landmark_event', 32.75),
    unit('q|landmark_origin', 32.85),
  ];
  const plan = rm.composeRoutePlan(units, path, dest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] }, { nowMs: NOW, heardKeys: new Set(['p|landmark_origin']), budgetSecOverride: 100000 });
  const ids = plan.items.filter(i => i.kind === 'story').map(i => i.id);
  assert.equal(plan.skippedHeard, 1);
  assert.ok(!ids.includes('p|landmark_origin'));
  assert.ok(ids.includes('p|landmark_event'), 'the unheard angle tiles');
});

check('v3.1 granularity: a heard intro excludes only the intro; intros never compose (welcome demotion)', () => {
  const mk = () => [
    unit('p|neighborhood_intro', 32.75, { angle: 'neighborhood_intro', durationSec: 60 }),
    unit('p|landmark_origin', 32.75),
    unit('q|landmark_origin', 32.85),
  ];
  const input = { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] };
  const introHeard = rm.composeRoutePlan(mk(), path, dest, 'Dest', input, { nowMs: NOW, heardKeys: new Set(['p|neighborhood_intro']), budgetSecOverride: 100000 });
  assert.ok(introHeard.items.some(i => i.id === 'p|landmark_origin' && i.kind === 'story'), 'story serves with its intro heard');
  assert.ok(!introHeard.items.some(i => i.id === 'p|neighborhood_intro'));
  const storyHeard = rm.composeRoutePlan(mk(), path, dest, 'Dest', input, { nowMs: NOW, heardKeys: new Set(['p|landmark_origin']), budgetSecOverride: 100000 });
  assert.ok(!storyHeard.items.some(i => i.id === 'p|landmark_origin'));
  // Welcome demotion (Nov 4, 2026): the unheard intro does NOT
  // open a chapter — intros are not composer candidacy at all;
  // they serve a route only as Coverage Guarantee fill.
  assert.ok(!storyHeard.items.some(i => i.id === 'p|neighborhood_intro'), 'the unheard intro never composes');
});

check('v3.1 one per place: three unheard angles of one place tile exactly once in a plan', () => {
  const units = [
    unit('solo|landmark_origin', 32.75),
    unit('solo|landmark_event', 32.75),
    unit('solo|landmark_people', 32.75),
    unit('b|landmark_origin', 32.78),
    unit('c|landmark_origin', 32.85),
  ];
  const plan = rm.composeRoutePlan(units, path, dest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] }, { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000 });
  assert.equal(plan.items.filter(i => i.kind === 'story' && i.unit.placeKey === 'solo').length, 1);
});

check('v3.1 thread support: unheard angles of a partially heard place count toward the thread', () => {
  const units = [
    unit('p|landmark_origin', 32.75, { topics: ['Coast'] }),
    unit('p|landmark_event', 32.75, { topics: ['Coast'] }),
    unit('p|landmark_people', 32.75, { topics: ['Coast'] }),
    unit('q|landmark_origin', 32.85, { topics: ['Coast'] }),
  ];
  const plan = rm.composeRoutePlan(units, path, dest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] }, { nowMs: NOW, heardKeys: new Set(['p|landmark_origin']), budgetSecOverride: 100000 });
  assert.equal(plan.thread?.topic, 'Coast');
  assert.deepEqual(
    new Set(plan.thread.memberIds),
    new Set(['p|landmark_event', 'p|landmark_people', 'q|landmark_origin']),
  );
});

check('v3.1 rotation r1 × granularity: the prior drive’s place yields at place level despite unheard angles; alone, it still tiles — once', () => {
  const rec = played => ({
    destinationName: 'Dest', destinationPlaceKey: null, threadTopic: null,
    playedSubjects: played, owedSubjects: [], endedAt: NOW,
  });
  const input = { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] };
  const soloAngles = () => [
    unit('solo|landmark_origin', 32.82, { placeName: 'Solo Place' }),
    unit('solo|landmark_event', 32.82, { placeName: 'Solo Place' }),
  ];
  const storyIds = plan => plan.items.filter(i => i.kind === 'story').map(i => i.id);
  // Tight budget (one story seats): the prior drive's place
  // yields to the comparable alternative even though BOTH its
  // angles are unheard — rotation reads subjects, not tellings.
  const rotated = rm.composeRoutePlan(
    [...soloAngles(), unit('new|landmark_origin', 32.85)],
    path, dest, 'Dest', input,
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 130, driveRecords: [rec(['Solo Place'])] },
  );
  assert.deepEqual(storyIds(rotated), ['new|landmark_origin']);
  // Control: no record — the place's first angle wins the seat.
  const control = rm.composeRoutePlan(
    [...soloAngles(), unit('new|landmark_origin', 32.85)],
    path, dest, 'Dest', input,
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 130 },
  );
  assert.deepEqual(storyIds(control), ['solo|landmark_origin']);
  // Alone with room to spare: the yielded place seats via its
  // first unheard angle — and only one telling of it tiles.
  const alone = rm.composeRoutePlan(
    soloAngles(),
    path, dest, 'Dest', input,
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveRecords: [rec(['Solo Place'])] },
  );
  assert.deepEqual(storyIds(alone), ['solo|landmark_origin']);
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

// ---- maps resilience (Nov 4, 2026: Erik's first stationary test) ----
// Tap 1's build died at geocode ~5 s in, classed 'permission';
// tap 2 — the identical call 9 s later — succeeded. The Places
// key's 403 for SearchText is deterministic, so every build
// rides on a later key; one transient failure there merged
// (sticky 'permission') into a fatal class. The retry pass is
// the fix: a non-definitive first walk earns one more.
await checkAsync('geocode: transient failure on the working key → the retry pass recovers (tap 1)', async () => {
  const tried = [];
  let workingCalls = 0;
  const stub = async (url, opts) => {
    const key = keyOf(opts);
    tried.push(key);
    if (key === 'places-blocked-key') return blocked;
    workingCalls += 1;
    if (workingCalls === 1) throw new Error('cold connection');
    return okPlaces('Balboa Park');
  };
  const g = await rm.geocodeDestination('Balboa Park', ['places-blocked-key', 'working-key'], stub, { sleep: async () => {} });
  assert.equal(g.failure, null);
  assert.equal(g.destination.name, 'Balboa Park');
  assert.deepEqual(
    tried,
    ['places-blocked-key', 'working-key', 'places-blocked-key', 'working-key'],
    'one full second walk, same key order',
  );
});
await checkAsync('geocode: every key fails both passes → permission after exactly two walks', async () => {
  let calls = 0;
  const stub = async () => {
    calls += 1;
    return blocked;
  };
  const g = await rm.geocodeDestination('naval base san diego', ['key-a', 'key-b'], stub, { sleep: async () => {} });
  assert.equal(g.destination, null);
  assert.equal(g.failure, 'permission');
  assert.equal(calls, 4, 'two keys × two passes — then the build may die, surfaced');
});
await checkAsync('routes: transient failure on every key → the retry pass recovers', async () => {
  let calls = 0;
  const stub = async () => {
    calls += 1;
    if (calls <= 2) throw new Error('cold connection');
    return okRoute;
  };
  const r = await rm.computeRoute({ lat: 32.7, lng: -117.25 }, dest, ['key-a', 'key-b'], stub, { sleep: async () => {} });
  assert.equal(r.failure, null);
  assert.equal(r.route.durationSec, 900);
  assert.equal(calls, 3, 'the second pass stops at the first key that answers');
});
await checkAsync('resolve: a selected destination resolves locally — zero network, immune to blocked keys', async () => {
  const stub = async () => {
    throw new Error('must not be called');
  };
  const selected = { name: 'Balboa Park', address: null, location: { lat: 32.734, lng: -117.145 } };
  const r = await rm.resolveDestination('Balboa Park', ['key-a', 'key-b'], selected, stub);
  assert.equal(r.failure, null);
  assert.equal(r.source, 'selection');
  assert.deepEqual(r.destination, selected);
});
await checkAsync('resolve: free text delegates to the geocode walk', async () => {
  const stub = async () => okPlaces('Balboa Park');
  const r = await rm.resolveDestination('Balboa Park', ['fake-key'], null, stub);
  assert.equal(r.failure, null);
  assert.equal(r.source, 'places');
  assert.equal(r.destination.name, 'Balboa Park');
});

// ---- route choice (Nov 5, 2026) ----
// The Routes call asks for alternatives; the fork gate
// (competitiveness + shared-length divergence, pure local
// geometry) decides whether the driver is ever asked which
// road the episode composes on. Stubbed fetches only;
// geometry fixtures are synthetic polylines encoded with the
// standard algorithm.
function encodePolyline(points) {
  let out = '';
  let lastLat = 0;
  let lastLng = 0;
  const enc = v => {
    let s = v < 0 ? ~(v << 1) : v << 1;
    let str = '';
    while (s >= 0x20) {
      str += String.fromCharCode((0x20 | (s & 0x1f)) + 63);
      s >>= 5;
    }
    return str + String.fromCharCode(s + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    out += enc(lat - lastLat) + enc(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return out;
}
// Two parallel freeways ~8 km apart, and a trivial variant of
// the first that shares ~90% of its length (a minor wiggle at
// the far end — the same road by any driver's account).
const i5Path = Array.from({ length: 41 }, (_, i) => ({ lat: 32.7 + i * 0.005, lng: -117.25 }));
const i805Path = i5Path.map(p => ({ ...p, lng: -117.16 }));
const trivialPath = i5Path.map((p, i) => (i <= 36 ? p : { ...p, lng: -117.245 }));
const opt = (points, extra = {}) => ({
  path: points,
  distanceMeters: 25750,
  durationSec: 1440,
  description: null,
  routeLabels: [],
  ...extra,
});

check('choice: shared-length fraction — identical ≈ 1, parallel freeways ≈ 0', () => {
  assert.ok(rm.sharedLengthFraction(i5Path, i5Path) > 0.99, 'a road shares itself');
  assert.ok(rm.sharedLengthFraction(i5Path, i805Path) < 0.05, 'parallel freeways share ~nothing');
  const f = rm.sharedLengthFraction(i5Path, trivialPath);
  assert.ok(f > 0.8 && f < 0.98, `the trivial variant shares ≈ 0.9, got ${f.toFixed(3)}`);
  assert.equal(
    rm.sharedLengthFraction(i5Path, trivialPath),
    rm.sharedLengthFraction(trivialPath, i5Path),
    'the fraction is symmetric by construction',
  );
});

check('choice: fork shown — a competitive, divergent alternative qualifies (I-5 vs I-805 shape)', () => {
  const alt = opt(i805Path, { durationSec: 1620, description: 'I-805 N', routeLabels: ['DEFAULT_ROUTE_ALTERNATE'] });
  const q = rm.qualifyingForkAlternatives(opt(i5Path), [alt]);
  assert.equal(q.length, 1);
  assert.equal(q[0], alt);
});

check('choice: fork hidden — same road (shared ≥ 0.75 is never a fork)', () => {
  const alt = opt(trivialPath, { durationSec: 1500 });
  assert.deepEqual(rm.qualifyingForkAlternatives(opt(i5Path), [alt]), []);
});

check('choice: fork hidden — an uncompetitive alternative never qualifies', () => {
  const slow = opt(i805Path, { durationSec: Math.round(1440 * 1.4) }); // +40%
  assert.deepEqual(rm.qualifyingForkAlternatives(opt(i5Path), [slow]), []);
  // The window is max(+5 min, +20%), inclusive at the edge:
  // +300 s on a 24-minute drive qualifies…
  const edge = opt(i805Path, { durationSec: 1740 });
  assert.equal(rm.qualifyingForkAlternatives(opt(i5Path), [edge]).length, 1);
  // …and on an hour's drive the 20% arm rules: +600 s is in,
  // +800 s is out.
  const long = opt(i5Path, { durationSec: 3600 });
  assert.equal(rm.qualifyingForkAlternatives(long, [opt(i805Path, { durationSec: 4200 })]).length, 1);
  assert.deepEqual(rm.qualifyingForkAlternatives(long, [opt(i805Path, { durationSec: 4400 })]), []);
});

check('choice: the picker’s 3-road cap keeps the fastest qualifying alternatives', () => {
  const coastPath = i5Path.map(p => ({ ...p, lng: -117.3 }));
  const midPath = i5Path.map(p => ({ ...p, lng: -117.205 }));
  const q = rm.qualifyingForkAlternatives(opt(i5Path), [
    opt(i805Path, { durationSec: 1620 }),
    opt(coastPath, { durationSec: 1500 }),
    opt(midPath, { durationSec: 1560 }),
  ]);
  assert.deepEqual(q.map(o => o.durationSec), [1500, 1560], 'fastest two qualifying; the third is dropped silently');
});

check('choice: picker labels — description when sane, ordinals when not', () => {
  const base = opt(i5Path, { description: 'I-5 S' });
  assert.equal(rm.routeOptionLabel(base, 0), 'via I-5 S · 24 min · 16 mi');
  assert.equal(rm.routeOptionLabel(opt(i5Path), 0), 'Fastest route · 24 min · 16 mi');
  assert.equal(
    rm.routeOptionLabel(opt(i805Path, { durationSec: 1620, distanceMeters: 27350 }), 1),
    'Route 2 · 27 min · 17 mi',
  );
  assert.equal(
    rm.routeOptionLabel(opt(i5Path, { description: 'x'.repeat(80) }), 1),
    'Route 2 · 24 min · 16 mi',
    'an unusable description falls back to the ordinal — never raw API text',
  );
  assert.equal(rm.routeOptionLabel(opt(i5Path, { description: 'I-5 S', durationSec: 3900 }), 0), 'via I-5 S · 1 hr 5 min · 16 mi');
});

const routesResp = routes => ({ ok: true, status: 200, json: async () => ({ routes }) });
const rawRoute = (points, extra = {}) => ({
  distanceMeters: 25750,
  duration: '1440s',
  polyline: { encodedPolyline: encodePolyline(points) },
  ...extra,
});

await checkAsync('choice: computeRoute asks for alternatives and parses every returned route', async () => {
  let seenBody = null;
  let seenMask = '';
  const stub = async (url, opts) => {
    seenBody = JSON.parse(opts.body);
    seenMask = opts.headers['X-Goog-FieldMask'];
    return routesResp([
      rawRoute(i5Path, { description: 'I-5 N', routeLabels: ['DEFAULT_ROUTE'] }),
      rawRoute(i805Path, { distanceMeters: 27350, duration: '1620s', description: 'I-805 N', routeLabels: ['DEFAULT_ROUTE_ALTERNATE'] }),
    ]);
  };
  const r = await rm.computeRoute({ lat: 32.7, lng: -117.25 }, dest, ['fake-key'], stub);
  assert.equal(r.failure, null);
  assert.equal(seenBody.computeAlternativeRoutes, true, 'the request asks for alternatives');
  assert.ok(seenMask.includes('routes.description') && seenMask.includes('routes.routeLabels'), 'the mask carries the label fields');
  assert.equal(r.options.length, 2);
  assert.equal(r.route, r.options[0], 'routes[0] remains THE route — the same object');
  assert.equal(r.route.durationSec, 1440);
  assert.equal(r.options[1].durationSec, 1620);
  assert.equal(r.options[1].description, 'I-805 N');
  assert.deepEqual(r.options[1].routeLabels, ['DEFAULT_ROUTE_ALTERNATE']);
});

await checkAsync('choice: a broken alternative drops silently — the build proceeds on the default', async () => {
  const stub = async () =>
    routesResp([
      rawRoute(i5Path),
      { distanceMeters: 1000, duration: '1500s' }, // no polyline
      { distanceMeters: 1000, polyline: { encodedPolyline: encodePolyline(i805Path) } }, // no duration
      rawRoute(i805Path, { duration: '1620s' }),
    ]);
  const r = await rm.computeRoute({ lat: 32.7, lng: -117.25 }, dest, ['fake-key'], stub);
  assert.equal(r.failure, null);
  assert.equal(r.options.length, 2, 'only the well-formed alternative survives');
  assert.equal(r.options[1].durationSec, 1620);
});

await checkAsync('choice: a single-route response is exactly the old behavior', async () => {
  const r = await rm.computeRoute({ lat: 32.7, lng: -117.25 }, dest, ['fake-key'], async () => okRoute);
  assert.equal(r.failure, null);
  assert.equal(r.options.length, 1);
  assert.equal(r.options[0], r.route);
  assert.equal(r.options[0].description, null, 'no description in the response → null, never a fabricated name');
});

check('choice: two picks compose two different plans — budgets follow the picked road', () => {
  const bPath = [
    { lat: 32.7, lng: -117.25 },
    { lat: 32.74, lng: -117.205 },
    { lat: 32.78, lng: -117.168 },
    { lat: 32.82, lng: -117.168 },
    { lat: 32.86, lng: -117.205 },
    { lat: 32.9, lng: -117.25 },
  ];
  const units = [
    unit('a-one|landmark_origin', 32.74),
    unit('a-two|landmark_origin', 32.78),
    unit('a-three|landmark_origin', 32.82),
    unit('a-four|landmark_origin', 32.86),
    unit('b-one|landmark_origin', 32.74, { lng: -117.2 }),
    unit('b-two|landmark_origin', 32.78, { lng: -117.165 }),
    unit('b-three|landmark_origin', 32.82, { lng: -117.165 }),
    unit('b-four|landmark_origin', 32.86, { lng: -117.2 }),
  ];
  const input = { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] };
  // The budget rides opts.budgetSecOverride — the App's own
  // seam (budgetSecFor of the picked route's duration).
  const planA = rm.composeRoutePlan(units, i5Path, dest, 'Dest', input, { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: rm.budgetSecFor(1440), driveSec: 1440 });
  const planB = rm.composeRoutePlan(units, bPath, dest, 'Dest', input, { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: rm.budgetSecFor(1620), driveSec: 1620 });
  const idsA = planA.items.filter(i => i.kind === 'story').map(i => i.id);
  const idsB = planB.items.filter(i => i.kind === 'story').map(i => i.id);
  assert.ok(idsA.length >= 3 && idsA.every(id => id.startsWith('a-')), `plan A tells only A-road stories: ${idsA}`);
  assert.ok(idsB.length >= 3 && idsB.every(id => id.startsWith('b-')), `plan B tells only B-road stories: ${idsB}`);
  assert.equal(planA.budgetSec, rm.budgetSecFor(1440));
  assert.equal(planB.budgetSec, rm.budgetSecFor(1620));
  assert.notEqual(planA.budgetSec, planB.budgetSec, 'the budget derives from the picked road');
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

// ---- composer v3.1, commit B: heard-aware fetch window ----
// The fetch walks the fair order in chunks, filing each read
// row heard/unheard by its story text, and reads deeper until
// every decile holds its unheard target (or a ceiling binds).
{
  const fetchPath = Array.from({ length: 21 }, (_, i) => ({ lat: 32.7 + i * 0.01, lng: -117.25 }));
  const fetchDest = { lat: 32.9, lng: -117.25 };
  const fEntry = (key, lat, extra = {}) => ({ place_key: key, angle: 'landmark_origin', lat, lng: -117.25, ...extra });
  const fRows = entries => new Map(entries.map(e => [`${e.place_key}|${e.angle}`, { story_text: `text:${e.place_key}|${e.angle}` }]));
  const fRead = rows => async e => rows.get(`${e.place_key}|${e.angle}`) ?? null;
  const noTopics = () => ({ topics: [] });
  // Decile d's ground: lat 32.71 + 0.02d sits at progress
  // ≈ 0.05 + 0.1d on the 21-point path — decile d exactly.
  const decileEntries = (perDecile, prefix) => {
    const entries = [];
    for (let d = 0; d < 10; d++) {
      const n = typeof perDecile === 'function' ? perDecile(d) : perDecile;
      for (let k = 0; k < n; k++) entries.push(fEntry(`${prefix}${d}-${k}`, 32.71 + 0.02 * d));
    }
    return entries;
  };
  const saturatedScenario = () => {
    const entries = decileEntries(d => (d === 5 ? 9 : 3), 'd');
    const rows = fRows(entries);
    const heardTexts = new Set();
    for (let k = 0; k < 6; k++) heardTexts.add(`text:d5-${k}|landmark_origin`);
    const order = rm.orderFetchCandidates(entries, fetchPath, fetchDest, noTopics, {});
    return rm.fetchHeardAwareCandidates({
      geoOrder: order.geo, portalOrder: order.portals, path: fetchPath,
      readRow: fRead(rows), rowText: r => r.story_text, heardTexts,
      perDecileTarget: 3, chunkSize: 4,
    });
  };

  check('v3.1 fetch order: selectFetchCandidates is the bounded prefix of the fetch order', () => {
    const entries = [...decileEntries(15, 'g'), ...Array.from({ length: 40 }, (_, k) => fEntry(`p${k}`, 32.8, { lng: -117.05 }))];
    const tagsOf = () => ({ topics: ['Coast'] });
    const order = rm.orderFetchCandidates(entries, fetchPath, fetchDest, tagsOf, {});
    assert.equal(order.geo.length, 150);
    assert.equal(order.portals.length, 40);
    assert.deepEqual(
      rm.selectFetchCandidates(entries, fetchPath, fetchDest, tagsOf, {}),
      [...order.geo.slice(0, 120), ...order.portals.slice(0, 30)],
    );
    assert.deepEqual(
      rm.selectFetchCandidates(entries, fetchPath, fetchDest, tagsOf, { geoLimit: 12, portalLimit: 5 }),
      [...order.geo.slice(0, 12), ...order.portals.slice(0, 5)],
    );
  });

  await checkAsync('v3.1 fetch: a heard-saturated decile triggers deeper reads until its unheard target', async () => {
    const res = await saturatedScenario();
    assert.equal(res.stats.decileUnheard[5], 3);
    assert.equal(res.stats.geoUnheard, 30);
    assert.equal(res.stats.geoReads, 36); // 27 clean reads + 9 through the saturated decile (6 heard first)
    assert.equal(res.stats.ceilingHit, false);
  });

  await checkAsync('v3.1 fetch: the read ceiling binds exactly and reports itself', async () => {
    const entries = decileEntries(10, 'h');
    const rows = fRows(entries);
    const heardTexts = new Set([...rows.values()].map(r => r.story_text)); // everything heard
    const order = rm.orderFetchCandidates(entries, fetchPath, fetchDest, noTopics, {});
    const res = await rm.fetchHeardAwareCandidates({
      geoOrder: order.geo, portalOrder: [], path: fetchPath,
      readRow: fRead(rows), rowText: r => r.story_text, heardTexts,
      perDecileTarget: 3, geoCeiling: 25, chunkSize: 12,
    });
    assert.equal(res.stats.geoReads, 25); // never one read past the ceiling
    assert.equal(res.stats.geoUnheard, 0);
    assert.equal(res.stats.ceilingHit, true);
  });

  await checkAsync('v3.1 fetch: a fresh shelf stops at the old caps — no gratuitous over-fetch', async () => {
    const entries = [...decileEntries(15, 'f'), ...Array.from({ length: 40 }, (_, k) => fEntry(`fp${k}`, 32.8, { lng: -117.05 }))];
    const rows = fRows(entries);
    const tagsOf = () => ({ topics: ['Coast'] });
    const order = rm.orderFetchCandidates(entries, fetchPath, fetchDest, tagsOf, {});
    const res = await rm.fetchHeardAwareCandidates({
      geoOrder: order.geo, portalOrder: order.portals, path: fetchPath,
      readRow: fRead(rows), rowText: r => r.story_text, heardTexts: new Set(),
    });
    assert.equal(res.stats.geoReads, 120);
    assert.deepEqual(res.stats.decileUnheard, new Array(10).fill(12));
    assert.equal(res.stats.portalReads, 30);
    assert.equal(res.stats.portalUnheard, 30);
    assert.equal(res.stats.ceilingHit, false);
  });

  await checkAsync('v3.1 fetch: deterministic — same inputs, same reads, same candidate set', async () => {
    const a = await saturatedScenario();
    const b = await saturatedScenario();
    assert.deepEqual(a.stats, b.stats);
    assert.deepEqual(a.geo.map(x => x.entry.place_key), b.geo.map(x => x.entry.place_key));
  });
}

// ---- addendum B (Nov 4, 2026): corridor lifetime cap + landmark radius ----
// A corridor stretch retires at 3 lifetime tellings (counted
// across all its angles from the cross-day ledger); landmark
// candidates are geographic out to ~3 km of the path while
// corridor rows stay bound to 1.5 km.
{
  const bInput = { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] };
  const bIds = plan => plan.items.filter(i => i.kind === 'story').map(i => i.id);
  // ~2 km east of the path at lat 32.8 (1° lng ≈ 93.5 km there):
  // outside the old 1.5 km radius, inside the widened 3 km net,
  // and far from the destination circle.
  const EAST_2KM = -117.25 + 2000 / 93500;
  const EAST_3_2KM = -117.25 + 3200 / 93500;

  check('cap B: a stretch at 2 lifetime tellings still candidated; at 3 it retires', () => {
    const mk = () => [
      unit('stretch|corridor', 32.8, { angle: 'corridor', placeName: 'Stretch' }),
      unit('other|landmark_origin', 32.75),
    ];
    const key = rm.normalizePlaceName('Stretch');
    const at2 = rm.composeRoutePlan(mk(), path, dest, 'Dest', bInput, { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, corridorTellingCounts: new Map([[key, 2]]) });
    assert.ok(bIds(at2).includes('stretch|corridor'), 'two tellings: the stretch still tiles');
    assert.equal(at2.corridorRetiredStretches, 0);
    const at3 = rm.composeRoutePlan(mk(), path, dest, 'Dest', bInput, { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, corridorTellingCounts: new Map([[key, 3]]) });
    assert.ok(!bIds(at3).includes('stretch|corridor'), 'three tellings: the stretch retires');
    assert.ok(bIds(at3).includes('other|landmark_origin'), 'the rest of the plan is unaffected');
    assert.equal(at3.corridorRetiredStretches, 1);
  });

  check('cap B: the count is per place across angles — mixed-angle tellings retire the corridor row; the cap touches corridor rows only', () => {
    // The ledger count for the place totals 3 tellings spread
    // over angles (the map is built from place labels, so it
    // cannot be per-angle by construction). The corridor row
    // retires; a landmark angle of the SAME place — not a
    // corridor row — is not the cap's business and still tiles.
    const units = [
      unit('mix|corridor', 32.8, { angle: 'corridor', placeName: 'Mix' }),
      unit('mix|landmark_origin', 32.8, { placeName: 'Mix' }),
      unit('other|landmark_origin', 32.75),
    ];
    const plan = rm.composeRoutePlan(units, path, dest, 'Dest', bInput, { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, corridorTellingCounts: new Map([[rm.normalizePlaceName('Mix'), 3]]) });
    assert.ok(!bIds(plan).includes('mix|corridor'), 'corridor row retired by the place-level count');
    assert.ok(bIds(plan).includes('mix|landmark_origin'), 'the landmark angle of the same place still tiles');
    assert.equal(plan.corridorRetiredStretches, 1);
  });

  check('cap B: no counts supplied → nothing retires and the plan reports null', () => {
    const units = [unit('stretch|corridor', 32.8, { angle: 'corridor', placeName: 'Stretch' })];
    const plan = rm.composeRoutePlan(units, path, dest, 'Dest', bInput, { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000 });
    assert.ok(bIds(plan).includes('stretch|corridor'));
    assert.equal(plan.corridorRetiredStretches, null);
  });

  check('radius B: in the fetch order, a landmark at ~2 km is geographic; a corridor row at the same distance is not', () => {
    const entries = [
      { place_key: 'near', angle: 'landmark_origin', lat: 32.8, lng: -117.25 },
      { place_key: 'wide-mark', angle: 'landmark_origin', lat: 32.8, lng: EAST_2KM },
      { place_key: 'wide-corr', angle: 'corridor', lat: 32.8, lng: EAST_2KM },
      { place_key: 'far-mark', angle: 'landmark_origin', lat: 32.8, lng: EAST_3_2KM },
    ];
    const dWide = rm.distanceToPathM({ lat: 32.8, lng: EAST_2KM }, path);
    assert.ok(dWide > 1500 && dWide < 3000, `fixture distance ${Math.round(dWide)} m sits between the radii`);
    const order = rm.orderFetchCandidates(entries, path, dest, () => ({ topics: ['Coast'] }), { userTopics: ['Coast'] });
    const geoKeys = order.geo.map(e => e.place_key);
    assert.ok(geoKeys.includes('wide-mark'), 'the widened landmark is a geographic candidate');
    assert.ok(!geoKeys.includes('wide-corr'), 'the corridor row at the same distance is NOT geographic');
    assert.ok(!geoKeys.includes('far-mark'), 'beyond the widened net the landmark leaves the geo order');
    assert.ok(order.portals.map(e => e.place_key).includes('far-mark'), '... and returns to portal treatment');
  });

  check('radius B: in composition, the widened landmark tiles as a geographic story; the corridor row at the same distance does not', () => {
    const mark = rm.composeRoutePlan(
      [unit('anchor|landmark_origin', 32.75), unit('wide|landmark_origin', 32.8, { lng: EAST_2KM })],
      path, dest, 'Dest', bInput, { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000 },
    );
    assert.ok(bIds(mark).includes('wide|landmark_origin'), 'landmark at ~2 km tiles in the geo pool');
    assert.ok(!mark.items.find(i => i.id === 'wide|landmark_origin')?.portal, 'and it is not a portal hop');
    const corr = rm.composeRoutePlan(
      [unit('anchor|landmark_origin', 32.75), unit('wide|corridor', 32.8, { angle: 'corridor', lng: EAST_2KM })],
      path, dest, 'Dest', bInput, { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000 },
    );
    assert.ok(!bIds(corr).includes('wide|corridor'), 'corridor row at ~2 km gains nothing from the widening');
    const corrControl = rm.composeRoutePlan(
      [unit('anchor|landmark_origin', 32.75), unit('wide|corridor', 32.8, { angle: 'corridor' })],
      path, dest, 'Dest', bInput, { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000 },
    );
    assert.ok(bIds(corrControl).includes('wide|corridor'), 'control: the same corridor row on the path tiles');
  });

}

check('v2 weighting: landmark beats corridor at the same anchor (no user topics)', () => {
  const units = [unit('corr|corridor', 32.75, { angle: 'corridor' }), unit('mark|landmark_origin', 32.75)];
  const tight = rm.composeRoutePlan(units, path, dest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: NOW + 130 * 1000, tone: null, topics: [] }, { nowMs: NOW, heardKeys: new Set() });
  assert.deepEqual(storyItems(tight).map(i => i.id), ['mark|landmark_origin']);
  const wide = rm.composeRoutePlan(units, path, dest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] }, { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000 });
  assert.deepEqual(storyItems(wide).map(i => i.id), ['mark|landmark_origin', 'corr|corridor']);
});

check('demotion: intros never seat as chapter furniture; stories tile and bridge adjacently', () => {
  const units = [];
  [32.72, 32.77, 32.82, 32.87].forEach((lat, i) => {
    units.push(unit(`area${i + 1}|neighborhood_intro`, lat, { angle: 'neighborhood_intro', durationSec: 60 }));
    units.push(unit(`area${i + 1}|neighborhood_intro_greet`, lat, { angle: 'neighborhood_intro_greet', durationSec: 60 }));
    units.push(unit(`story${i + 1}|landmark_origin`, lat + 0.005));
  });
  const plan = rm.composeRoutePlan(units, densePath, denseDest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] }, { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000 });
  // No intro of either variant is a plan item, and no item
  // carries the retired opener flag.
  assert.ok(!plan.items.some(i => i.unit && (i.unit.angle === 'neighborhood_intro' || i.unit.angle === 'neighborhood_intro_greet')), 'no intro tiles in a composed plan');
  assert.ok(!plan.items.some(i => 'opener' in i), 'the opener flag is gone from plan items');
  // The four area stories all tile, and consecutive stories are
  // joined by a pair bridge — the seam an opener used to sit on
  // is covered by the bridge between the now-adjacent stories.
  const stories = plan.items.filter(i => i.kind === 'story');
  assert.equal(stories.length, 4);
  for (let k = 0; k + 1 < stories.length; k++) {
    const a = plan.items.indexOf(stories[k]);
    const b = plan.items.indexOf(stories[k + 1]);
    const between = plan.items.slice(a + 1, b);
    assert.ok(between.some(i => i.kind === 'bridge' && i.prevUnitId === stories[k].id && i.nextUnitId === stories[k + 1].id), `a pair bridge joins stories ${k} and ${k + 1}`);
  }
});

check('demotion: a heard intro changes nothing; an unheard intro still never composes', () => {
  const units = [];
  [32.72, 32.77, 32.82, 32.87].forEach((lat, i) => {
    units.push(unit(`area${i + 1}|neighborhood_intro`, lat, { angle: 'neighborhood_intro', durationSec: 60 }));
    units.push(unit(`story${i + 1}|landmark_origin`, lat + 0.005));
  });
  const plan = rm.composeRoutePlan(units, densePath, denseDest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] }, { nowMs: NOW, heardKeys: new Set(['area2|neighborhood_intro']), budgetSecOverride: 100000 });
  assert.ok(!plan.items.some(i => i.unit && i.unit.angle === 'neighborhood_intro'), 'no intro item, heard or not');
  assert.equal(plan.items.filter(i => i.kind === 'story').length, 4, 'all four stories still tile');
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

check('v2 bridges: the anchor gap still stamps the target — but text is honest length (field fix lane 1)', () => {
  const far = rm.composeRoutePlan(
    [unit('f1|landmark_origin', 32.71, { durationSec: 60 }), unit('f2|landmark_origin', 32.85, { durationSec: 60 })],
    densePath, denseDest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] },
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 2000 },
  );
  const farBridge = far.items.find(i => i.kind === 'bridge');
  assert.equal(farBridge.targetDurationSec, 90, 'long gap clamps to the bridge ceiling (bookkeeping)');
  // Lane 1 (Nov 5, 2026) deliberately retires the elastic
  // behavior this suite used to assert: the bridge no longer
  // composes TOWARD the target with connective-bank padding.
  assert.ok(farBridge.durationSec < 30, `a bridge is its pair's facts at honest length, not 90 s of padding (got ${farBridge.durationSec}s)`);
  assert.ok(
    !rm.BRIDGE_CONNECTIVE_LINES.some(l => farBridge.text.includes(l)),
    'no connective-bank line pads the bridge',
  );
  const near = rm.composeRoutePlan(
    [unit('n1|landmark_origin', 32.71, { durationSec: 60 }), unit('n2|landmark_origin', 32.715, { durationSec: 60 })],
    densePath, denseDest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] },
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 2000 },
  );
  const nearBridge = near.items.find(i => i.kind === 'bridge');
  assert.ok(nearBridge.targetDurationSec <= 25, `short gap target ${nearBridge.targetDurationSec}`);
  assert.ok(
    Math.abs(nearBridge.durationSec - farBridge.durationSec) <= 6,
    'near and far bridges are the same honest size — the gap no longer inflates the text',
  );
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
check('no-thread parity: story order holds and EVERY bridge is exactly the seam’s — the preview item carries the framing', () => {
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
  // Field fix (Nov 5, 2026): the seam's contract grew — a
  // bridge is now authored from its context AND the episode
  // ledger, threaded in plan order (lanes 1/1b). Parity is
  // still exact, against the seam called the way the composer
  // calls it.
  const ledger = rm.newBridgeEpisodeState();
  const storyUnitsInOrder = stories.map(s => s.unit);
  bridges.forEach((b, idx) => {
    const prev = units.find(u => u.id === b.prevUnitId);
    const next = units.find(u => u.id === b.nextUnitId);
    const context = rm.buildBridgeContext({
      earlier: storyUnitsInOrder.slice(0, storyUnitsInOrder.indexOf(next)),
      prev,
      next,
      thread: null,
      isClimaxBridge: plan.climaxUnitId !== null && next.id === plan.climaxUnitId,
      climaxLast: plan.climaxMode !== 'natural',
      promiseMade: true,
    });
    const baseline = rm.bridgeTextFor(prev, next, { targetSec: b.targetDurationSec, context, episode: ledger });
    assert.equal(b.text, baseline, `bridge ${idx} is byte-identical to the seam's bridge under the episode ledger`);
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
    // v2 invariants: portal share + adjacency. (Welcome
    // demotion, Nov 4, 2026: the opener-cap invariant became
    // "no intro ever composes".)
    const portals = plan.items.filter(i => i.portal);
    assert.ok(portals.length / Math.max(1, stories) <= 0.25, `portal share ${portals.length}/${stories} exceeds 25%`);
    for (const p of portals) {
      const at = plan.items.indexOf(p);
      const prevStory = [...plan.items.slice(0, at)].reverse().find(i => i.kind === 'story');
      // Lane 2 (Nov 5, 2026) deliberately widens this v2
      // invariant: a hop either directly follows its parent
      // (the standing placement) or directly follows a
      // WINDOWED story that is not its parent — a placement-
      // safety relocation, which only ever seats a hop
      // immediately after the geo story it would otherwise
      // have doomed, with its parent still ahead of it.
      const relocated =
        prevStory &&
        prevStory.id !== p.portalParentId &&
        prevStory.releaseProgress !== undefined &&
        plan.items.slice(0, at).some(i => i.id === p.portalParentId);
      assert.ok(
        prevStory && (prevStory.id === p.portalParentId || relocated),
        'portal neither follows its parent nor sits in a placement-safety relocation',
      );
    }
    assert.ok(!plan.items.some(i => i.unit && (i.unit.angle === 'neighborhood_intro' || i.unit.angle === 'neighborhood_intro_greet')), 'an intro composed');
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

await checkAsync('ambient bed: a bed whose audio layer cannot even construct self-silences, one diag, tour unharmed', async () => {
  // Node has no Audio element: the bed's browser factory throws
  // at channel construction — the extreme case of a broken bed
  // environment. The scope's rule: the bed can never gate, delay,
  // or break a story; any fault self-silences + files one diag.
  const audio = new RealFakeAudio(400);
  const events = [];
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onEvent: (t, p) => events.push({ t, p }),
    bed: {
      assets: { ocean: 'bed://ocean', road: 'bed://road', city: 'bed://city' },
      enabled: true,
      declaredMode: 'driving',
    },
  });
  assert.equal(runner.view().bedOn, true);
  assert.equal(runner.view().bedKind, null);
  runner.setBedEnabled(false);
  assert.equal(runner.view().bedOn, false);
  runner.setBedEnabled(true);
  assert.equal(runner.view().bedOn, true);
  // Stage (manifest hold: nothing has sounded, the gate is
  // shut), feed the drive's context, then begin — the order a
  // real drive produces (GPS flows before the Start tap).
  await runner.stage(qaPlan());
  // Freeway speed on the path's own start point: the road target.
  runner.onPosition({ lat: 32.7, lng: -117.25, speedMps: 29 });
  runner.beginStaged();
  await until(() => audio.played.some(s => s.includes('s1%7Clandmark_origin.wav')), 'first story sounding (bed gate)');
  await until(
    () => events.some(e => e.t === 'pipeline_diag' && e.p.stage === 'ambient_bed'),
    'bed fault diag',
  );
  const diags = events.filter(e => e.t === 'pipeline_diag' && e.p.stage === 'ambient_bed');
  assert.equal(diags.length, 1);
  assert.equal(runner.view().bedOn, false); // faulted = off, surfaced honestly
  assert.equal(runner.view().bedKind, null);
  // Narration proceeds untouched: arrival closeout still fires.
  runner.onPosition(dest);
  await until(() => runner.view().closeoutDone, 'arrival closeout with a faulted bed');
  assert.equal(events.filter(e => e.t === 'pipeline_diag' && e.p.stage === 'ambient_bed').length, 1);
  runner.endTour();
});

await checkAsync('ambient bed: a runner without the bed dep reports no bed', async () => {
  const audio = new RealFakeAudio(400);
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:x/' + t.length,
    onEvent: () => undefined,
  });
  assert.equal(runner.view().bedOn, false);
  assert.equal(runner.view().bedKind, null);
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
  // (Thread re-anchor port, Nov 5, 2026: the context gains
  // the thread's anchor label + class — still plan facts
  // only, still no played data; the wrap-up names where an
  // anchored thread tied off.)
  assert.deepEqual(Object.keys(threaded).sort(), [
    'climaxMode',
    'climaxSubject',
    'destinationName',
    'threadAnchorKind',
    'threadLabel',
    'threadTopic',
  ]);
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
// for the Start tour action — nothing sounds, no window is
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
  runner.beginStaged(); // the Start tour tap
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

await checkAsync('cap B telemetry: route_plan_started decisions carry the retired-stretch count', async () => {
  const plan = rm.composeRoutePlan(
    [unit('stretch|corridor', 32.8, { angle: 'corridor', placeName: 'Stretch' }), unit('other|landmark_origin', 32.75)],
    path, dest, 'Dest', { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] },
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, corridorTellingCounts: new Map([[rm.normalizePlaceName('Stretch'), 4]]) },
  );
  assert.equal(plan.corridorRetiredStretches, 1);
  const events = [];
  const runner = new rp.RoutePlanRunner({
    audio: new RealFakeAudio(250),
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onEvent: (t, p) => events.push({ t, p }),
    onStoryHeard: () => {},
  });
  await runner.start(plan);
  const started = events.find(e => e.t === 'route_plan_started');
  assert.ok(started, 'route_plan_started filed');
  assert.equal(started.p.decisions.corridor_retired_stretches, 1);
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

await checkAsync('gapfill: a plain intro tiles as guarantee fill when no story candidate remains (welcome demotion)', async () => {
  const drive = 2000;
  const plan = mkPlan([storyAtSec('s1|x', 200, 100, drive), storyAtSec('s2|x', 1800, 100, drive)]);
  plan.driveSec = drive;
  plan.budgetSec = drive;
  const intro = unit('nb|neighborhood_intro', 32.8, { angle: 'neighborhood_intro', durationSec: 200 });
  const events = [];
  const filled = await gf.fillRouteGaps(
    plan,
    { fetchedUnits: [intro], heardKeys: new Set(), input: noInput, driveSec: drive },
    { onEvent: e => events.push(e) },
  );
  const fill = filled.items.find(i => i.id === 'nb|neighborhood_intro');
  assert.ok(fill && fill.kind === 'story', 'the plain intro filled the gap as a story item');
  assert.equal(events.length, 1);
  assert.equal(events[0].result, 'shelf');
  assert.equal(events[0].subject, 'nb|neighborhood_intro');
});

await checkAsync('gapfill: a story candidate beats an intro for the same gap; a heard intro never fills', async () => {
  const drive = 2000;
  const mk = () => {
    const p = mkPlan([storyAtSec('s1|x', 200, 100, drive), storyAtSec('s2|x', 1800, 100, drive)]);
    p.driveSec = drive;
    p.budgetSec = drive;
    return p;
  };
  // The story's window covers the whole gap span, so once it
  // seats there is nothing left for the intro to fill.
  const story = unit('mid|landmark_origin', 32.732, { durationSec: 1500 });
  const intro = unit('nb|neighborhood_intro', 32.8, { angle: 'neighborhood_intro', durationSec: 200 });
  const both = await gf.fillRouteGaps(
    mk(),
    { fetchedUnits: [intro, story], heardKeys: new Set(), input: noInput, driveSec: drive },
    { onEvent: () => {} },
  );
  assert.ok(both.items.some(i => i.id === 'mid|landmark_origin'), 'the story filled');
  assert.ok(!both.items.some(i => i.id === 'nb|neighborhood_intro'), 'the intro yielded to the story');
  const heardEvents = [];
  const heardOnly = await gf.fillRouteGaps(
    mk(),
    { fetchedUnits: [intro], heardKeys: new Set(['nb|neighborhood_intro']), input: noInput, driveSec: drive },
    { onEvent: e => heardEvents.push(e) },
  );
  assert.ok(!heardOnly.items.some(i => i.id === 'nb|neighborhood_intro'), 'a heard intro never fills');
  assert.equal(heardEvents[0].result, 'skipped');
});

await checkAsync('gapfill: the greet variant never tiles as fill', async () => {
  const drive = 2000;
  const plan = mkPlan([storyAtSec('s1|x', 200, 100, drive), storyAtSec('s2|x', 1800, 100, drive)]);
  plan.driveSec = drive;
  plan.budgetSec = drive;
  const greet = unit('nb|neighborhood_intro_greet', 32.8, { angle: 'neighborhood_intro_greet', durationSec: 200 });
  const events = [];
  const filled = await gf.fillRouteGaps(
    plan,
    { fetchedUnits: [greet], heardKeys: new Set(), input: noInput, driveSec: drive },
    { onEvent: e => events.push(e) },
  );
  assert.ok(!filled.items.some(i => i.id === 'nb|neighborhood_intro_greet'), 'greet never tiles anywhere in route');
  assert.equal(events[0].result, 'skipped');
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
  // (Thread re-anchor port, Nov 5, 2026: the decisions thread
  // record gains the anchor identity — label, class, key —
  // beside topic + source, and the menu record rides the
  // decisions. The fixture's thread is a topic thread, so the
  // anchor fields read the topic itself.)
  assert.deepEqual(started.p.decisions.thread, {
    topic: 'Navy Century',
    source: 'detected',
    label: 'Navy Century',
    anchor_kind: 'topic',
    anchor_key: 'Navy Century',
  });
  assert.ok(
    started.p.decisions.thread_menu && started.p.decisions.thread_menu.source === 'single-qualifier',
    'the menu record rides the decisions (composer-resolved: this world holds exactly one qualifying thread)',
  );
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
  // (Thread re-anchor port, Nov 5, 2026: threadLabel /
  // threadAnchorKind are thread facts, not fit/pairing
  // machinery — the key set grows by exactly those two.)
  assert.deepEqual(Object.keys(ctx).sort(), [
    'climaxMode',
    'climaxSubject',
    'destinationName',
    'threadAnchorKind',
    'threadLabel',
    'threadTopic',
  ]);
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

// ---- build staging honesty (Nov 4, 2026: Erik's first stationary test) ----
// A dead build used to return silently to the idle form — a
// text-xs status line was the whole failure surface. These
// suites pin the replacement: stage labels tied to real
// milestones, and a failed state with a retry that any stage's
// failure reaches.
check('build ui: stage labels name the phase the staging is actually in', () => {
  assert.equal(rp.ROUTE_BUILD_STAGE_LABELS.route, 'Finding your route…');
  assert.equal(rp.ROUTE_BUILD_STAGE_LABELS.compose, 'Composing your episode…');
  assert.equal(rp.ROUTE_BUILD_STAGE_LABELS.recording, 'Miles is recording the introductions…');
});
check('build ui: stage advance is monotonic — labels never rewind, fast phases may skip', () => {
  assert.equal(rp.advanceRouteBuildStage('route', 'compose'), 'compose');
  assert.equal(rp.advanceRouteBuildStage('compose', 'recording'), 'recording');
  assert.equal(rp.advanceRouteBuildStage('recording', 'compose'), 'recording', 'a late earlier-phase event cannot relabel backwards');
  assert.equal(rp.advanceRouteBuildStage('route', 'recording'), 'recording', 'a skipped label is honest; a faked dwell would not be');
});
check('build ui: failure copy is plain-language and class-aware', () => {
  assert.match(rp.routeBuildFailure('geocode', 'no_results').message, /Couldn’t find that place/);
  assert.match(rp.routeBuildFailure('geocode', 'permission').message, /can’t reach the maps service/);
  assert.match(rp.routeBuildFailure('geocode', 'network').message, /can’t reach the maps service/);
  assert.match(rp.routeBuildFailure('route', 'no_results').message, /Couldn’t find a driving route/);
  assert.match(rp.routeBuildFailure('route', 'permission').message, /can’t reach the maps service/);
  assert.match(rp.routeBuildFailure('build', null).message, /Something went wrong/);
  assert.equal(rp.routeBuildFailure('geocode', 'permission').canRetry, true);
});
check('build ui: a dead build reaches the failed state — never a building label', () => {
  const failure = rp.routeBuildFailure('geocode', 'permission');
  const ui = rp.routeBuildUiState({ building: false, stage: 'route', failure });
  assert.equal(ui.kind, 'failed');
  assert.equal(ui.failure.canRetry, true);
  assert.equal(ui.failure.message, failure.message);
  const building = rp.routeBuildUiState({ building: true, stage: 'compose', failure: null });
  assert.deepEqual(building, { kind: 'building', stage: 'compose', label: 'Composing your episode…' });
  assert.deepEqual(rp.routeBuildUiState({ building: false, stage: 'route', failure: null }), { kind: 'idle' });
});
check('build ui: failure at each later stage surfaces in the same failed state', () => {
  for (const [stage, failure] of [['geocode', 'permission'], ['route', 'network'], ['build', null]]) {
    const ui = rp.routeBuildUiState({ building: false, stage: 'compose', failure: rp.routeBuildFailure(stage, failure) });
    assert.equal(ui.kind, 'failed', `${stage} failure surfaces`);
    assert.equal(ui.failure.stage, stage);
    assert.equal(ui.failure.canRetry, true);
  }
});
check('build ui: retry from the failed state walks the stages in order to a clean settle', () => {
  // The App's exact sequence, replayed against the helpers:
  // failure filed → Try again clears it and restarts at the
  // route stage → milestones advance in staging order (never
  // ahead of the phase the build is in) → settled, no residue.
  let failure = rp.routeBuildFailure('geocode', 'permission');
  assert.equal(rp.routeBuildUiState({ building: false, stage: 'route', failure }).kind, 'failed');
  failure = null; // buildRoute clears the failure at start
  let stage = 'route';
  assert.deepEqual(rp.routeBuildUiState({ building: true, stage, failure }), {
    kind: 'building',
    stage: 'route',
    label: 'Finding your route…',
  });
  stage = rp.advanceRouteBuildStage(stage, 'compose');
  assert.equal(rp.routeBuildUiState({ building: true, stage, failure }).label, 'Composing your episode…');
  stage = rp.advanceRouteBuildStage(stage, 'recording');
  assert.equal(rp.routeBuildUiState({ building: true, stage, failure }).label, 'Miles is recording the introductions…');
  assert.deepEqual(rp.routeBuildUiState({ building: false, stage, failure }), { kind: 'idle' });
});

// ---- composer v3, commit D: start-button readiness ----
{
  const dPlan = () =>
    rm.composeRoutePlan(
      [unit('a|landmark_origin', 32.71), unit('b|landmark_origin', 32.85)],
      path, dest, 'Dest',
      { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] },
      { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 10000 },
    );
  check('readiness: the start button state derives from narrationReady (Erik’s copy)', () => {
    assert.deepEqual(rp.routeStartButtonState({ narrationReady: false }), { label: 'Miles is recording the introductions…', disabled: true });
    assert.deepEqual(rp.routeStartButtonState({ narrationReady: true }), { label: 'Start tour', disabled: false });
  });
  await checkAsync('readiness: narrationReady is false while a narration render is unsettled, true after it settles', async () => {
    let release;
    const gate = new Promise(r => { release = r; });
    const runner = new rp.RoutePlanRunner({
      audio: new RealFakeAudio(250),
      synthUrl: async t => { await gate; return 'blob:audio/' + encodeURIComponent(t.slice(0, 16)); },
      onEvent: () => {},
      onStoryHeard: () => {},
    });
    const staging = runner.stage(dPlan());
    // The hold is already visible (the card's rendering
    // precondition) while the preview/bridge renders hang on
    // the gate — and the button state says so.
    assert.equal(runner.view().phase, 'ready');
    assert.equal(runner.view().narrationReady, false);
    assert.deepEqual(rp.routeStartButtonState(runner.view()), { label: 'Miles is recording the introductions…', disabled: true });
    release();
    await staging;
    assert.equal(runner.view().narrationReady, true);
    assert.deepEqual(rp.routeStartButtonState(runner.view()), { label: 'Start tour', disabled: false });
    runner.endTour();
  });
  await checkAsync('readiness: a failed narration render still settles readiness (skip-fallback)', async () => {
    let calls = 0;
    const runner = new rp.RoutePlanRunner({
      audio: new RealFakeAudio(250),
      synthUrl: async () => {
        calls += 1;
        if (calls === 2) throw new Error('synth down'); // the bridge fails over; the plan still settles
        return 'blob:audio/ok';
      },
      onEvent: () => {},
      onStoryHeard: () => {},
    });
    await runner.stage(dPlan());
    assert.ok(calls >= 2, 'the failing render was attempted');
    assert.equal(runner.view().narrationReady, true);
    assert.equal(runner.view().phase, 'ready');
    runner.endTour();
  });
}

// ---- composer v3, commit C: rotation policy ----
{
  const actPath = Array.from({ length: 11 }, (_, i) => ({ lat: 32.7 + i * 0.02, lng: -117.25 }));
  const actDest = { lat: 32.9, lng: -117.25 };
  const plainInput = { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] };
  const rec = (played, extra = {}) => ({
    destinationName: 'Dest', destinationPlaceKey: null, threadTopic: null,
    playedSubjects: played, owedSubjects: [], endedAt: NOW, ...extra,
  });
  const composeC = (units, budget, records = []) =>
    rm.composeRoutePlan(units, actPath, actDest, 'Dest', plainInput, {
      nowMs: NOW, heardKeys: new Set(), budgetSecOverride: budget, driveSec: 1000, driveRecords: records,
    });
  const storyIds = plan => plan.items.filter(i => i.kind === 'story').map(i => i.id);

  check('rotation r1: a place played on the immediately prior drive yields to a comparable alternative in its act', () => {
    const units = [unit('old|landmark_origin', 32.79), unit('new|landmark_origin', 32.81)];
    assert.deepEqual(storyIds(composeC(units, 130, [rec(['old|landmark_origin'])])), ['new|landmark_origin']);
    assert.deepEqual(storyIds(composeC(units, 130, [])), ['old|landmark_origin']); // control: no record, no rotation
  });
  check('rotation r1: the yielded place still tiles when it is the act’s only feasible candidate', () => {
    const plan = composeC([unit('old|landmark_origin', 32.79)], 10000, [rec(['old|landmark_origin'])]);
    assert.deepEqual(storyIds(plan), ['old|landmark_origin']);
  });
  check('rotation r3: second choice wins when the top was played within the last 3 drives and the margin is small', () => {
    const units = [
      unit('top|landmark_origin', 32.79, { durationSec: 130 }),
      unit('ru|landmark_origin', 32.81, { durationSec: 120 }),
    ];
    // top sounded two drives ago: inside the recency window,
    // but not on the immediately prior drive (rule 1 stays out).
    const records = [rec(['other|landmark_origin']), rec(['top|landmark_origin'])];
    assert.deepEqual(storyIds(composeC(units, 140, records)), ['ru|landmark_origin']);
  });
  check('rotation r3: a clear margin keeps the top candidate', () => {
    const units = [
      unit('top|landmark_origin', 32.79, { durationSec: 130 }),
      unit('ru|landmark_origin', 32.81, { durationSec: 100 }),
    ];
    const records = [rec(['other|landmark_origin']), rec(['top|landmark_origin'])];
    assert.deepEqual(storyIds(composeC(units, 140, records)), ['top|landmark_origin']);
  });
  check('rotation r2 (retired): opener variation is gone — intros never seat, prior-drive records change nothing', () => {
    // Rotation rule 2 lived inside the chapter-opener lane and
    // retired with it (welcome demotion, Nov 4, 2026). The
    // prior drive's intro areas no longer influence anything:
    // with and without the record, no intro composes and the
    // story set is identical.
    const units = [
      unit('s1|landmark_origin', 32.73),
      unit('s2|landmark_origin', 32.81),
      unit('na|neighborhood_intro', 32.71, { angle: 'neighborhood_intro' }),
      unit('nb|neighborhood_intro', 32.79, { angle: 'neighborhood_intro' }),
    ];
    const rotated = composeC(units, 280, [rec(['na|neighborhood_intro'])]);
    const control = composeC(units, 280, []);
    assert.ok(!rotated.items.some(i => i.unit && i.unit.angle === 'neighborhood_intro'));
    assert.ok(!control.items.some(i => i.unit && i.unit.angle === 'neighborhood_intro'));
    assert.deepEqual(storyIds(rotated), storyIds(control));
  });
  check('rotation r4: among near-equal climax candidates, the one with more unheard alternatives wins', () => {
    const plan = composeC([
      unit('alt1|landmark_origin', 32.71, { topics: ['Coast'] }),
      unit('scarce|landmark_origin', 32.85, { durationSec: 200 }),
      unit('plenty|landmark_event', 32.87, { durationSec: 190, topics: ['Coast'] }),
    ], 10000, []);
    assert.equal(plan.climaxUnitId, 'plenty|landmark_event');
  });
  check('rotation r4: outside the ~10% band, raw weight still decides the climax', () => {
    const plan = composeC([
      unit('alt1|landmark_origin', 32.71, { topics: ['Coast'] }),
      unit('scarce|landmark_origin', 32.85, { durationSec: 200 }),
      unit('plenty|landmark_event', 32.87, { durationSec: 150, topics: ['Coast'] }),
    ], 10000, []);
    assert.equal(plan.climaxUnitId, 'scarce|landmark_origin');
  });
}

// ---- composer v3, commit B: act-structured selection ----
// Dense 11-point path: segment midpoints give near-exact
// progress (unit at lat L sits in segment (L-32.7)/0.02, whose
// midpoint progress is (seg+0.5)/10).
{
  const actPath = Array.from({ length: 11 }, (_, i) => ({ lat: 32.7 + i * 0.02, lng: -117.25 }));
  const actDest = { lat: 32.9, lng: -117.25 };
  const plainInput = { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] };
  const composeAct = (units, budget) =>
    rm.composeRoutePlan(units, actPath, actDest, 'Dest', plainInput, {
      nowMs: NOW, heardKeys: new Set(), budgetSecOverride: budget, driveSec: 1000,
    });
  const storyIds = plan => plan.items.filter(i => i.kind === 'story').map(i => i.id);

  check('acts: a corridor candidate yields to a window-feasible landmark in its act (floor substitution)', () => {
    // Budget seats exactly one story. The corridor candidate's
    // bucket is swept first — without the floor it would take
    // the seat and the landmark would be fit-skipped.
    const plan = composeAct([
      unit('corr|corridor', 32.79, { angle: 'corridor' }),
      unit('lm|landmark_origin', 32.81),
    ], 130);
    assert.deepEqual(storyIds(plan), ['lm|landmark_origin']);
    assert.equal(plan.actsSummary.middle.floorSub, true);
    assert.equal(plan.actsSummary.middle.stories, 1);
    assert.equal(plan.actsSummary.middle.landmark, 1);
    assert.equal(plan.actsSummary.middle.corridor, 0);
  });
  check('acts: with no stronger alternative in the act, the corridor candidate seats as before', () => {
    const plan = composeAct([
      unit('ca|corridor', 32.79, { angle: 'corridor' }),
      unit('cb|corridor', 32.81, { angle: 'corridor' }),
    ], 130);
    assert.deepEqual(storyIds(plan), ['ca|corridor']);
    assert.equal(plan.actsSummary.middle.corridor, 1);
    assert.ok(!plan.actsSummary.opening.floorSub && !plan.actsSummary.middle.floorSub && !plan.actsSummary.climax.floorSub);
  });
  check('acts: sparse shelf parity — one feasible candidate per act tiles exactly as before', () => {
    const plan = composeAct([
      unit('o|corridor', 32.71, { angle: 'corridor' }),
      unit('m|corridor', 32.79, { angle: 'corridor' }),
      unit('c|corridor', 32.85, { angle: 'corridor' }),
    ], 10000);
    assert.deepEqual(storyIds(plan), ['o|corridor', 'm|corridor', 'c|corridor']);
    assert.deepEqual(
      [plan.actsSummary.opening.stories, plan.actsSummary.middle.stories, plan.actsSummary.climax.stories],
      [1, 1, 1],
    );
    assert.deepEqual(
      [plan.actsSummary.opening.corridor, plan.actsSummary.middle.corridor, plan.actsSummary.climax.corridor],
      [1, 1, 1],
    );
    assert.ok(!plan.actsSummary.opening.floorSub && !plan.actsSummary.middle.floorSub && !plan.actsSummary.climax.floorSub);
  });
  check('acts: a corridor thread member does not yield (it carries rung-2 strength)', () => {
    const plan = composeAct([
      unit('t1|corridor', 32.75, { angle: 'corridor', topics: ['Coast'] }),
      unit('t2|corridor', 32.77, { angle: 'corridor', topics: ['Coast'] }),
      unit('t3|corridor', 32.79, { angle: 'corridor', topics: ['Coast'] }),
      unit('lm|landmark_origin', 32.81),
    ], 130);
    assert.equal(plan.thread?.topic, 'Coast');
    assert.deepEqual(storyIds(plan), ['t1|corridor']);
    assert.equal(plan.actsSummary.middle.floorSub, false);
  });
  check('acts: the floor defers, never drops — a candidate yielded to a portal alternative seats in the mop-up when the portal never lands', () => {
    const plan = composeAct([
      unit('corr|corridor', 32.79, { angle: 'corridor', topics: ['Coast'] }),
      unit('port|landmark_origin', 32.81, { lng: -117.05, topics: ['Coast'] }),
    ], 10000);
    // The portal unit shares the act + a topic, so the corridor
    // candidate yields in every gated pass; the portal can
    // never hop (portal cap needs >= 3 chosen stories), so the
    // mop-up seats the corridor candidate — same final plan.
    assert.deepEqual(storyIds(plan), ['corr|corridor']);
    assert.equal(plan.actsSummary.middle.corridor, 1);
    assert.equal(plan.actsSummary.middle.floorSub, false); // deferral resolved to the same candidate: no substitution seated
  });
  check('acts: the summary carries no openers tally (welcome demotion shape change)', () => {
    const plan = composeAct([
      unit('n1|neighborhood_intro', 32.79, { angle: 'neighborhood_intro' }),
      unit('s1|landmark_origin', 32.81),
    ], 10000);
    // The intro does not compose, so the middle act holds only
    // the story — and the acts line has no openers field at all
    // (the decisions-record shape changed with the demotion).
    assert.equal(plan.actsSummary.middle.stories, 1);
    for (const line of [plan.actsSummary.opening, plan.actsSummary.middle, plan.actsSummary.climax]) {
      assert.ok(!('openers' in line), 'openers tally retired from the acts summary');
    }
  });
  await checkAsync('acts: the decisions record carries the acts summary', async () => {
    const plan = rm.composeRoutePlan(
      [unit('o|landmark_origin', 32.71), unit('m|landmark_origin', 32.8), unit('c|landmark_origin', 32.88)],
      path, dest, 'Dest', plainInput,
      { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 10000 },
    );
    const events = [];
    const runner = new rp.RoutePlanRunner({
      audio: new RealFakeAudio(250),
      synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
      onEvent: (t, p) => events.push({ t, p }),
      onStoryHeard: () => {},
    });
    await runner.start(plan);
    const started = events.find(e => e.t === 'route_plan_started');
    assert.ok(started, 'route_plan_started filed');
    assert.deepEqual(started.p.decisions.acts, plan.actsSummary);
    const totalStories =
      plan.actsSummary.opening.stories + plan.actsSummary.middle.stories + plan.actsSummary.climax.stories;
    assert.equal(totalStories, plan.items.filter(i => i.kind === 'story').length);
    runner.endTour();
  });
}

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

// ── Audio finish + the produced breath (v3.1, commit D) ─────
// The finish is pure over PCM arrays; the harness drives it
// with synthetic WAVs and zero live calls. The breath decision
// is a pure function; two real-timer runner integrations pin
// the Player seam end to end.
const afOut = join(mkdtempSync(join(tmpdir(), 'route-af-')), 'audioFinish.mjs');
execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'esbuild'),
  [
    join(repoRoot, 'src', 'core', 'audioFinish.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    `--outfile=${afOut}`,
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
);
const af = await import(pathToFileURL(afOut).href);
const sinePcm = (rmsDb, seconds = 0.25, sampleRate = 24000) => {
  const amp = Math.pow(10, rmsDb / 20) * Math.SQRT2;
  const n = Math.floor(seconds * sampleRate);
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = amp * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  return { sampleRate, channels: [ch] };
};
check('audio finish (D): a quiet render is gained up toward the shelf target', () => {
  const quiet = sinePcm(-27); // 6 dB under the −21 target
  assert.equal(af.planLoudnessGainDb(quiet), 6, 'the full distance, at the clamp edge');
  const gained = af.applyGainDb(quiet, af.planLoudnessGainDb(quiet));
  assert.ok(Math.abs(af.measureRmsDb(gained) - -21) < 0.15, `lands on target (got ${af.measureRmsDb(gained)})`);
});
check('audio finish (D): a loud render is gained down, and gain clamps at ±6 dB', () => {
  assert.equal(af.planLoudnessGainDb(sinePcm(-15)), -6, 'a loud render comes down to target');
  assert.equal(af.planLoudnessGainDb(sinePcm(-40)), 6, 'a very quiet render stops at the +6 clamp');
  assert.equal(af.planLoudnessGainDb(sinePcm(-21)), 0, 'an at-target render is untouched');
  assert.equal(af.planLoudnessGainDb({ sampleRate: 24000, channels: [new Float32Array(100)] }), 0, 'silence is never gained');
});
check('audio finish (D): peak protection — a hot peak is never pushed into clipping', () => {
  // A spiky render: rare hot peaks (0.98) over a quiet bed —
  // peak 0.98, RMS ≈ −24. Raw gain would be +3 dB; the peak
  // ceiling (0.99) caps it at ≈ +0.09 dB.
  const n = 24000;
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = i % 250 === 0 ? (i % 500 === 0 ? 0.98 : -0.98) : i % 2 === 0 ? 0.005 : -0.005;
  const hot = { sampleRate: 24000, channels: [ch] };
  assert.ok(Math.abs(af.measureRmsDb(hot) - -24.2) < 0.6, `fixture RMS near −24 (got ${af.measureRmsDb(hot)})`);
  const gain = af.planLoudnessGainDb(hot);
  assert.ok(gain > 0 && gain <= 0.1, `gain capped by the peak, not the target (got ${gain})`);
  const out = af.applyGainDb(hot, gain);
  assert.ok(af.measurePeak(out) <= af.PEAK_CEILING + 1e-9, `peak stays under the ceiling (got ${af.measurePeak(out)})`);
});
check('audio finish (D): WAV encode/decode round-trips samples and rate', () => {
  const src = sinePcm(-24, 0.1);
  const bytes = af.encodeWavPcm16(src);
  const back = af.decodeWavPcm16(bytes);
  assert.ok(back, 'decodes');
  assert.equal(back.sampleRate, 24000);
  assert.equal(back.channels.length, 1);
  assert.equal(back.channels[0].length, src.channels[0].length);
  let maxErr = 0;
  for (let i = 0; i < src.channels[0].length; i++) {
    maxErr = Math.max(maxErr, Math.abs(back.channels[0][i] - src.channels[0][i]));
  }
  assert.ok(maxErr < 1 / 16000, `16-bit round-trip error is quantization only (got ${maxErr})`);
  assert.equal(af.decodeWavPcm16(new Uint8Array([1, 2, 3])), null, 'garbage bytes decode to null, never throw');
});
await checkAsync('audio finish (D): the blob seam finishes a quiet WAV and passes level/undecodable renders through', async () => {
  const decode = async blob => af.decodeWavPcm16(new Uint8Array(await blob.arrayBuffer()));
  const quietBlob = new Blob([af.encodeWavPcm16(sinePcm(-30))], { type: 'audio/wav' });
  const finished = await af.finishLiveRenderBlob(quietBlob, decode);
  assert.notEqual(finished, quietBlob, 'a quiet render is re-rendered at level');
  const out = af.decodeWavPcm16(new Uint8Array(await finished.arrayBuffer()));
  assert.ok(Math.abs(af.measureRmsDb(out) - -24) < 0.3, `gained +6 (the clamp) from −30 toward −21 (got ${af.measureRmsDb(out)})`);
  assert.ok(af.measurePeak(out) <= af.PEAK_CEILING + 1e-9, 'and never clips');
  const levelBlob = new Blob([af.encodeWavPcm16(sinePcm(-21))], { type: 'audio/wav' });
  assert.equal(await af.finishLiveRenderBlob(levelBlob, decode), levelBlob, 'an at-level render returns untouched');
  const junk = new Blob([new Uint8Array([9, 9, 9])], { type: 'audio/wav' });
  assert.equal(await af.finishLiveRenderBlob(junk, async () => null), junk, 'an undecodable render returns untouched — the finish never fails a render');
});
const GAP = 600; // player.GAP_MS — the standing inter-item gap the breath falls back to
const settledStory = { sounded: true, skipped: false, planItem: true };
const nextStory = { planItem: true, expireProgress: null, departure: false };
check('breath (D): back-to-back sounded plan items are separated by the 700 ms breath', () => {
  assert.equal(
    rp.routeInterItemGapMs({ closing: false, lastSettled: settledStory, next: nextStory, lastProgress: 0, progressPerSec: null }),
    rp.ROUTE_BREATH_MS,
  );
  assert.equal(rp.ROUTE_BREATH_MS, 700);
});
check('breath (D): the breath yields — closeout, skips, failures, answers, and empty FIFO keep the standing gap', () => {
  const base = { closing: false, lastSettled: settledStory, next: nextStory, lastProgress: 0, progressPerSec: null };
  assert.equal(rp.routeInterItemGapMs({ ...base, closing: true }), GAP, 'never before the closeout');
  assert.equal(rp.routeInterItemGapMs({ ...base, lastSettled: { ...settledStory, skipped: true } }), GAP, 'after a skip the listener wants the next thing now');
  assert.equal(rp.routeInterItemGapMs({ ...base, lastSettled: { ...settledStory, sounded: false } }), GAP, 'a failed item earns no breath');
  assert.equal(rp.routeInterItemGapMs({ ...base, lastSettled: { ...settledStory, planItem: false } }), GAP);
  assert.equal(rp.routeInterItemGapMs({ ...base, next: { ...nextStory, planItem: false } }), GAP, 'a Q&A answer follows at the standing gap');
  assert.equal(rp.routeInterItemGapMs({ ...base, next: null }), GAP, 'nothing promised — the gap is moot but standing');
  assert.equal(rp.routeInterItemGapMs({ ...base, lastSettled: null }), GAP, 'the first item never waits for a breath');
});
check('breath (D): a window that would close during the breath skips it — and only then', () => {
  const windowed = { planItem: true, expireProgress: 0.435, departure: false };
  // Moving fast: 0.425 + 1.25/s × 0.7 s projects past the window's close.
  assert.equal(
    rp.routeInterItemGapMs({ closing: false, lastSettled: settledStory, next: windowed, lastProgress: 0.425, progressPerSec: 1.25 }),
    GAP,
    'the breath yields to the closing window',
  );
  // Same window, gentle pace: the breath fits comfortably.
  assert.equal(
    rp.routeInterItemGapMs({ closing: false, lastSettled: settledStory, next: windowed, lastProgress: 0.38, progressPerSec: 0.005 }),
    rp.ROUTE_BREATH_MS,
    'a safe window keeps the breath',
  );
  // Stationary or unmeasured: no projection, no risk.
  assert.equal(
    rp.routeInterItemGapMs({ closing: false, lastSettled: settledStory, next: windowed, lastProgress: 0.43, progressPerSec: null }),
    rp.ROUTE_BREATH_MS,
  );
  // The departure story is stale-exempt everywhere, breath included.
  assert.equal(
    rp.routeInterItemGapMs({ closing: false, lastSettled: settledStory, next: { ...windowed, departure: true }, lastProgress: 0.425, progressPerSec: 1.25 }),
    rp.ROUTE_BREATH_MS,
  );
});
await checkAsync('breath (D): runner integration — consecutive plan items start a breath apart', async () => {
  const audio = new RealFakeAudio(200);
  const starts = [];
  const play0 = audio.play.bind(audio);
  audio.play = () => {
    starts.push(Date.now());
    return play0();
  };
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onStoryHeard: () => {},
  });
  await runner.start(anchorPlan());
  await until(() => starts.length >= 3, 'preview, departure story, and its bridge all started');
  const gap1 = starts[1] - starts[0] - 200; // preview → departure story
  const gap2 = starts[2] - starts[1] - 200; // departure story → bridge
  assert.ok(gap1 >= 660, `preview→story gap is the breath (got ${gap1} ms)`);
  assert.ok(gap2 >= 660, `story→bridge gap is the breath (got ${gap2} ms)`);
  runner.endTour();
});
await checkAsync('breath (D): runner integration — a window about to close skips the breath and still plays', async () => {
  const audio = new RealFakeAudio(200);
  const starts = [];
  const play0 = audio.play.bind(audio);
  audio.play = () => {
    starts.push(Date.now());
    return play0();
  };
  const heard = [];
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onStoryHeard: u => heard.push(u.id),
  });
  await runner.start(anchorPlan());
  // During the opening items, drive the progress to just
  // inside story B's window [0.365, 0.435] at speed: the
  // bridge→B gap must then fall back to the standing 600 ms,
  // and B must still sound (fed in-window, never stale).
  await until(() => starts.length >= 2, 'the departure story is playing');
  runner.onPosition({ lat: 32.775, lng: -117.25 }); // progress 0.375
  await new Promise(r => setTimeout(r, 40));
  runner.onPosition({ lat: 32.785, lng: -117.25 }); // progress 0.425 → rate ≈ 1.25/s
  await until(() => heard.includes('b|landmark_origin'), 'story B sounded');
  const bIdx = audio.played.findIndex(u => u.includes('b%7Clandmark_origin'));
  assert.ok(bIdx >= 2, 'B played after its bridge');
  const gap = starts[bIdx] - starts[bIdx - 1] - 200;
  assert.ok(gap < 660 && gap >= 540, `the breath yielded: bridge→B gap is the standing gap (got ${gap} ms)`);
  runner.endTour();
});

// ── Tag regeneration as an ingest-pipeline step (v3.1, E) ───
// The generator is a pure function of story-tags.csv: two runs
// are byte-identical, and the committed routeTags.ts must equal
// a fresh run (a stale bundle is exactly the bug E fixes — if
// this fails, someone updated the CSV without regenerating;
// the run below has already repaired the working tree).
check('tag regen (E): deterministic, and the committed routeTags.ts is in sync with the CSV', () => {
  const tagsPath = join(repoRoot, 'src', 'data', 'routeTags.ts');
  const before = readFileSync(tagsPath, 'utf8');
  const gen = join(repoRoot, 'scripts', 'route-mode', 'build-route-tags.mjs');
  execFileSync(process.execPath, [gen], { stdio: 'pipe' });
  const after1 = readFileSync(tagsPath, 'utf8');
  execFileSync(process.execPath, [gen], { stdio: 'pipe' });
  const after2 = readFileSync(tagsPath, 'utf8');
  assert.equal(after1, after2, 'two runs of the generator produce byte-identical output');
  assert.equal(after1, before, 'the committed routeTags.ts already equals a fresh regeneration');
});
check('tag regen (E): the shared library ingest path carries the regen as its final step', () => {
  const libPath = join(repoRoot, '..', 'repo-avatar', 'scripts', 'library', 'lib.mjs');
  const ingestPath = join(repoRoot, '..', 'repo-avatar', 'scripts', 'library', 'ingest.mjs');
  let lib = null;
  let ingest = null;
  try {
    lib = readFileSync(libPath, 'utf8');
    ingest = readFileSync(ingestPath, 'utf8');
  } catch {
    // The tooling lives outside this repo; where it is absent
    // there is nothing to assert — the check above still pins
    // the generator itself.
    return;
  }
  assert.ok(lib.includes('export function regenRouteTags()'), 'lib.mjs exports the shared regen helper');
  assert.ok(lib.includes('build-route-tags.mjs'), 'the helper runs the repo generator');
  assert.ok(ingest.includes('regenRouteTags()'), 'ingest.mjs calls it as its final step');
  assert.ok(ingest.includes('if (!dryRun) regenRouteTags();'), 'a dry run stays side-effect free');
});

// ── Woven-pool simulation helpers (v3.1, commit F) ──────────
// The battery itself runs via `grader.mjs --woven` (200 builds
// is too heavy for this harness); its moving parts are pinned
// here: pool shape, seeded determinism, share nesting, the
// audit configuration, and the two summary computations.
check('woven sim (F): the county pool is landmark-class and off the route corridor only', () => {
  const world = grader.buildWorld(1103, 'current');
  const pool = grader.wovenPoolUnits(world, 'commute');
  assert.ok(pool.length > 0, 'the county pool is populated');
  assert.ok(pool.every(u => u.angle.startsWith('landmark')), 'landmark class only');
  assert.ok(pool.every(u => !u.placeName.startsWith('Commute ')), 'no commute-corridor places');
  assert.ok(pool.some(u => u.placeName.startsWith('County ')), 'scatter places are in');
});
check('woven sim (F): eligibility is deterministic and flat shares nest', () => {
  const world = grader.buildWorld(1103, 'current');
  const ids = cfg => new Set(grader.wovenEligibleUnits(world, 'commute', cfg).map(u => u.id));
  const e25 = ids({ share: 0.25 });
  const e50 = ids({ share: 0.5 });
  const e75 = ids({ share: 0.75 });
  assert.deepEqual(ids({ share: 0.25 }), e25, 'same seed → same eligible set');
  assert.equal(ids({ share: 0 }).size, 0, '0% is the empty pool');
  assert.ok([...e25].every(id => e50.has(id)), '25% ⊂ 50%');
  assert.ok([...e50].every(id => e75.has(id)), '50% ⊂ 75%');
  const poolSize = grader.wovenPoolUnits(world, 'commute').length;
  assert.ok(Math.abs(e50.size / poolSize - 0.5) < 0.06, `the 50% draw lands near half the pool (got ${e50.size}/${poolSize})`);
});
check('woven sim (F): the audit configuration follows the measured per-topic usable shares', () => {
  const world = grader.buildWorld(1103, 'current');
  const eligible = grader.wovenEligibleUnits(world, 'commute', { audit: true }, 9200);
  assert.ok(eligible.every(u => u.topics.length > 0), 'a topic-less story is never woven material (the audit tagging gap)');
  assert.equal(grader.WOVEN_AUDIT_USABLE['folklore'], 1.0, 'folklore measured 100% usable');
  assert.equal(grader.WOVEN_AUDIT_USABLE['Navy Century'], 0.753, 'the most presence-locked rich thread, as measured');
  assert.ok(eligible.length > 0, 'the audit pool is populated');
});
check('woven sim (F): starvation and overlap math', () => {
  const mk = topics => topics.map(t => ({ threadTopic: t }));
  assert.equal(grader.threadStarvationDrive(mk(['A', 'A', null, null, null, null, null, 'A'])), 3, 'the run of five begins at drive 3');
  assert.equal(grader.threadStarvationDrive(mk(['A', null, null, null, null, 'A', null, null, null, null])), null, 'four-in-a-row twice is not starvation');
  assert.equal(grader.threadStarvationDrive(mk([null, null, null, null, null])), 1, 'starved from the first drive');
  assert.equal(grader.meanConsecutiveOverlap([new Set(['a', 'b']), new Set(['b', 'c'])]), 0.333, 'Jaccard of consecutive sets');
  assert.equal(grader.meanConsecutiveOverlap([new Set(), new Set()]), 1, 'two silent episodes are identically empty');
  assert.equal(grader.meanConsecutiveOverlap([new Set(['a']), new Set()]), 0);
});

// ── Woven SEATED-members helpers (follow-up to commit F) ────
// The battery itself runs via `grader.mjs --woven-seated`
// (360 builds is too heavy for this harness); its seating
// rules are pinned here on hand-computed plans: gap math,
// the seconds cap (climax pre-counted), the member-count
// cap, whole-gap placement, one-telling-per-place, and the
// substantive-starvation summary.
check('woven seated: silent gaps are the complement of story coverage (tissue is not coverage)', () => {
  const items = [
    { kind: 'story', unit: { id: 's1', placeKey: 'P1' }, durationSec: 200, anchorProgress: 0.1 }, // sounds [100, 300]
    { kind: 'story', unit: { id: 's2', placeKey: 'P2' }, durationSec: 999, releaseProgress: 0.5, expireProgress: 0.7 }, // window [500, 700]
    { kind: 'bridge', durationSec: 30, anchorProgress: 0.8 }, // never coverage
  ];
  assert.deepEqual(grader.silentGapsSec(items, 1000), [
    { start: 0, end: 100 },
    { start: 300, end: 500 },
    { start: 700, end: 1000 },
  ]);
  assert.deepEqual(grader.silentGapsSec([], 1000), [{ start: 0, end: 1000 }], 'an empty plan is one gap');
});
check('woven seated: the seconds cap binds TOTAL woven seconds and skips oversize candidates', () => {
  const items = [{ kind: 'story', unit: { id: 'g1', placeKey: 'P0' }, durationSec: 400, anchorProgress: 0 }];
  const candidates = [
    { id: 'c500', placeKey: 'P1', durationSec: 500 },
    { id: 'c300', placeKey: 'P2', durationSec: 300 },
    { id: 'c200', placeKey: 'P3', durationSec: 200 },
  ];
  const seated = grader.seatWovenMembers({
    items, candidates, driveSec: 1000, budgetSec: 1000, capShare: 0.25,
  });
  assert.equal(seated.inserts.length, 1, 'only the candidate that fits the 250s cap seats');
  assert.equal(seated.inserts[0].unit.id, 'c200');
  assert.equal(seated.inserts[0].anchorProgress, 0.4, 'seated at the start of the only gap');
  assert.equal(seated.memberSec, 200);
  const preCounted = grader.seatWovenMembers({
    items, candidates, driveSec: 1000, budgetSec: 1000, capShare: 0.25, wovenSecBefore: 100,
  });
  assert.equal(preCounted.inserts.length, 0, 'a 100s woven climax leaves 150s of cap — nothing seats');
});
check('woven seated: the member-count cap seats strongest first and stops', () => {
  const items = [{ kind: 'story', unit: { id: 'g1', placeKey: 'P0' }, durationSec: 400, anchorProgress: 0 }];
  const candidates = [
    { id: 'b150', placeKey: 'P2', durationSec: 150 },
    { id: 'a200', placeKey: 'P1', durationSec: 200 },
  ];
  const seated = grader.seatWovenMembers({
    items, candidates, driveSec: 1000, budgetSec: 1000, maxMembers: 1,
  });
  assert.equal(seated.inserts.length, 1);
  assert.equal(seated.inserts[0].unit.id, 'a200', 'the longest candidate wins the single seat');
});
check('woven seated: a candidate longer than every gap never seats; an exact fit does', () => {
  const items = [{ kind: 'story', unit: { id: 'g1', placeKey: 'P0' }, durationSec: 400, anchorProgress: 0 }];
  const candidates = [
    { id: 'c700', placeKey: 'P1', durationSec: 700 },
    { id: 'c600', placeKey: 'P2', durationSec: 600 },
    { id: 'c100', placeKey: 'P3', durationSec: 100 },
  ];
  const seated = grader.seatWovenMembers({ items, candidates, driveSec: 1000, budgetSec: 1000 });
  assert.deepEqual(seated.inserts.map(i => i.unit.id), ['c600'], 'the 600s gap takes the 600s story, then no gap remains');
  assert.equal(seated.memberSec, 600);
});
check('woven seated: placement goes to the largest fitting gap', () => {
  const items = [
    { kind: 'story', unit: { id: 'g1', placeKey: 'P0' }, durationSec: 100, anchorProgress: 0 },
    { kind: 'story', unit: { id: 'g2', placeKey: 'P9' }, durationSec: 200, anchorProgress: 0.4 },
  ]; // covered [0,100] + [400,600]; gaps [100,400]=300 and [600,1000]=400
  const seated = grader.seatWovenMembers({
    items,
    candidates: [{ id: 'c250', placeKey: 'P1', durationSec: 250 }],
    driveSec: 1000, budgetSec: 1000,
  });
  assert.equal(seated.inserts.length, 1);
  assert.equal(seated.inserts[0].anchorProgress, 0.6, 'the 400s gap beats the 300s gap');
});
check('woven seated: ids and places already in the plan (or seated) are out — one telling per place', () => {
  const items = [{ kind: 'story', unit: { id: 'x', placeKey: 'PX' }, durationSec: 100, anchorProgress: 0 }];
  const candidates = [
    { id: 'x', placeKey: 'PY', durationSec: 100 }, // same telling
    { id: 'y', placeKey: 'PX', durationSec: 100 }, // same place, other angle
    { id: 'z1', placeKey: 'PZ', durationSec: 100 },
    { id: 'z2', placeKey: 'PZ', durationSec: 90 }, // second angle of the seated place
  ];
  const seated = grader.seatWovenMembers({ items, candidates, driveSec: 1000, budgetSec: 1000 });
  assert.deepEqual(seated.inserts.map(i => i.unit.id), ['z1']);
  const again = grader.seatWovenMembers({ items, candidates, driveSec: 1000, budgetSec: 1000 });
  assert.deepEqual(again, seated, 'seating is deterministic');
});
check('woven seated: substantive starvation counts only substantive drives (silence ≤ 50%)', () => {
  const mk = pairs => pairs.map(([silenceShare, threadTopic], i) => ({ drive: i + 1, silenceShare, threadTopic }));
  assert.deepEqual(
    grader.substantiveThreadStarvation(mk([[0.3, 'A'], [0.3, 'A'], [0.3, 'A'], [0.4, null], [0.2, null], [0.5, null], [0.1, null], [0.49, null], [0.3, 'A']])),
    { starvationDrive: 4, substantiveThreadBefore: 3 },
    'the run of five substantive thread-less drives begins at drive 4',
  );
  assert.deepEqual(
    grader.substantiveThreadStarvation(mk([[0.3, 'A'], [0.9, null], [0.3, null], [0.3, null], [0.3, null], [0.3, null], [0.3, null]])),
    { starvationDrive: 3, substantiveThreadBefore: 1 },
    'a non-substantive drive neither counts nor breaks the run',
  );
  assert.deepEqual(
    grader.substantiveThreadStarvation(mk([[0.3, null], [0.3, null], [0.3, 'A']])),
    { starvationDrive: null, substantiveThreadBefore: 1 },
    'two thread-less substantive drives are not starvation',
  );
});

// ── Woven seated members (Nov 4, 2026) ─────────────────────
// The production seating pass: off-route, woven-eligible
// stories on the plan's through-line thread seat into silent
// gaps as episode members — ≤4, guarantee-first (the pass
// runs after the guarantee in the build staging; here it
// runs on the composed plan directly), strongest-first,
// never displacing sounding material, never the climax,
// heard like everything else. Fixtures: a sacrificial portal
// hop (whop) absorbs the plan's single hop slot so hop
// behavior never pollutes the seating assertions.
const WT = 'Military & Bases';
const wGeo = (id, lat, dur = 120, name) =>
  unit(id, lat, { topics: [WT], placeName: name, durationSec: dur });
const wCand = (id, dur, extra = {}) =>
  unit(id, 32.0, {
    lng: -117.05,
    angle: 'landmark_history',
    topics: [WT],
    durationSec: dur,
    wovenEligible: true,
    ...extra,
  });
const wFixtureUnits = wovenList => [
  wGeo('ga|landmark_origin', 32.71, 120, 'Geo A'),
  wGeo('gb|landmark_origin', 32.72, 120, 'Geo B'),
  wGeo('gc|landmark_origin', 32.73, 120, 'Geo C'),
  wGeo('gd|landmark_origin', 32.88, 500, 'Geo D'),
  unit('whop|landmark_history', 32.0, {
    lng: -117.05,
    topics: [WT],
    placeName: 'Hop Sacrifice',
    durationSec: 60,
    wovenEligible: false,
  }),
  ...wovenList,
];
const wCompose = (units, driveSec) => {
  const plan = rm.composeRoutePlan(
    units,
    path,
    dest,
    'Dest',
    { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] },
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: driveSec, driveSec },
  );
  // The App's staging assignments (post-guarantee), mirrored.
  plan.driveSec = driveSec;
  plan.budgetSec = driveSec;
  return plan;
};
const storyIds = plan => plan.items.filter(i => i.kind === 'story').map(i => i.id);
const memberIds = plan => plan.items.filter(i => i.woven).map(i => i.id);

check('woven data: the bundled presence map pins the audit — Protected excluded whatever its register', () => {
  assert.equal(Object.keys(rpd.ROUTE_PRESENCE).length, 1294, 'one row per shelf story (1,264 audit rows + 30 woven twins)');
  // Kuchamaa is Protected register: even its weave-SAFE
  // telling is never woven material.
  assert.deepEqual(rpd.presenceFor('kuchamaa', 'landmark_origin'), { presence: 'safe', protected: true });
  assert.equal(rpd.wovenEligibleFor('kuchamaa', 'landmark_origin'), false, 'Protected beats safe');
  assert.equal(rpd.wovenEligibleFor('kuchamaa', 'landmark_event'), false);
  // Presence-bound excluded; mixed and safe eligible.
  assert.equal(rpd.wovenEligibleFor('alpine', 'landmark_origin'), false, 'bound is not eligible');
  assert.equal(rpd.wovenEligibleFor('alpine', 'landmark_cultural'), true, 'safe is eligible');
  assert.equal(rpd.wovenEligibleFor('619-as-a-badge', 'filler_hosted'), true, 'mixed is eligible');
  // Unclassified rows are never eligible — the safe direction.
  assert.equal(rpd.presenceFor('no such place', 'landmark_origin'), null);
  assert.equal(rpd.wovenEligibleFor('no such place', 'landmark_origin'), false);
});
check('woven data regen: deterministic, and the committed routePresence.ts is in sync with the CSV', () => {
  const dataPath = join(repoRoot, 'src', 'data', 'routePresence.ts');
  const before = readFileSync(dataPath, 'utf8');
  const gen = join(repoRoot, 'scripts', 'route-mode', 'build-route-presence.mjs');
  execFileSync(process.execPath, [gen], { stdio: 'pipe' });
  const after1 = readFileSync(dataPath, 'utf8');
  execFileSync(process.execPath, [gen], { stdio: 'pipe' });
  const after2 = readFileSync(dataPath, 'utf8');
  assert.equal(after1, after2, 'two runs of the generator produce byte-identical output');
  assert.equal(after1, before, 'the committed routePresence.ts already equals a fresh regeneration');
});

// ── Woven twins, wired (Nov 4, 2026) ──────────────────────
// The tranche's 30 twins (source angle + '-woven-v1') are
// real shelf rows now: the tag map carries them with their
// sources' topics, the presence map classifies them
// weave-safe by construction (derived in the generator, not
// hand-edited), and the lever's index machinery — support
// counting and the member fetch — can reach them.
const TWIN_SUFFIX = '-woven-v1';
const twinKeysOf = map => Object.keys(map).filter(k => k.split('|')[1]?.endsWith(TWIN_SUFFIX));
check('woven twins (data): the tag map carries all 30 twins with topics inherited from their sources', () => {
  assert.equal(Object.keys(rtg.ROUTE_TAGS).length, 1310, 'one tag row per shelf story (1,294 + 16 Wave C-1)');
  const twins = twinKeysOf(rtg.ROUTE_TAGS);
  assert.equal(twins.length, 30, 'the November tranche twins are index-visible');
  let coast = 0;
  for (const k of twins) {
    const [pk, ang] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
    const twin = rtg.tagsFor(pk, ang);
    const source = rtg.tagsFor(pk, ang.slice(0, -TWIN_SUFFIX.length));
    assert.ok(twin.topics.length > 0, `${k} carries topics`);
    assert.deepEqual(twin.topics, source.topics, `${k} inherits its source's topics`);
    if (twin.topics.includes('Coast')) coast += 1;
  }
  assert.equal(coast, 24, 'the Coast tranche landed whole (24 of 30 twins carry Coast)');
});
check('woven twins (data): every twin resolves weave-safe and eligible; its source keeps the audit’s call', () => {
  for (const k of twinKeysOf(rtg.ROUTE_TAGS)) {
    const pk = k.slice(0, k.indexOf('|'));
    const ang = k.slice(k.indexOf('|') + 1);
    assert.deepEqual(rpd.presenceFor(pk, ang), { presence: 'safe', protected: false }, `${k} is safe by construction`);
    assert.equal(rpd.wovenEligibleFor(pk, ang), true, `${k} is woven-eligible`);
    const srcAng = ang.slice(0, -TWIN_SUFFIX.length);
    assert.notEqual(rpd.presenceFor(pk, srcAng), null, `${pk}|${srcAng} still carries its audit class`);
    assert.equal(rpd.presenceFor(pk, srcAng).protected, false, 'a twinned source is never Protected (the generator aborts otherwise)');
  }
  // The audit split for the original rows is untouched by the derivation.
  const split = { bound: 0, mixed: 0, safe: 0 };
  for (const [k, e] of Object.entries(rpd.ROUTE_PRESENCE)) {
    if (!k.split('|')[1]?.endsWith(TWIN_SUFFIX)) split[e.presence] += 1;
  }
  assert.deepEqual(split, { bound: 195, mixed: 567, safe: 502 }, 'the recovered audit split, byte-stable');
});
check('woven twins (data): index support counts the twins, and the member fetch can return them', () => {
  // The REAL shipped index (every tag-map key), all placed on
  // member ground (off the fixture path, away from the
  // destination) so geometry admits whatever class + topic +
  // eligibility admit — the data is the only variable.
  const index = Object.keys(rtg.ROUTE_TAGS).map(k => ({
    place_key: k.slice(0, k.indexOf('|')),
    angle: k.slice(k.indexOf('|') + 1),
    lat: 32.0,
    lng: -117.05,
  }));
  const tagsOf = (pk, ang) => rtg.tagsFor(pk, ang);
  const eligibleOf = (pk, ang) => rpd.wovenEligibleFor(pk, ang);
  const isLandmarkCoast = e =>
    e.angle.startsWith('landmark') && tagsOf(e.place_key, e.angle).topics.includes('Coast');
  const expectedCoast = index.filter(e => isLandmarkCoast(e) && eligibleOf(e.place_key, e.angle)).length;
  const support = rm.wovenIndexSupportByTopic(index, path, dest, tagsOf, eligibleOf, {
    fetchedIds: new Set(),
    heardIds: new Set(),
  });
  assert.equal(support.get('Coast'), expectedCoast, 'support = the eligible landmark Coast depth of the shipped index');
  const noTwins = rm.wovenIndexSupportByTopic(index, path, dest, tagsOf, (pk, ang) => eligibleOf(pk, ang) && !ang.endsWith(TWIN_SUFFIX), {
    fetchedIds: new Set(),
    heardIds: new Set(),
  });
  const landmarkCoastTwins = index.filter(e => isLandmarkCoast(e) && e.angle.endsWith(TWIN_SUFFIX)).length;
  assert.equal(support.get('Coast') - (noTwins.get('Coast') ?? 0), landmarkCoastTwins, 'the twins add exactly their depth to Coast support');
  assert.ok(landmarkCoastTwins > 0, 'landmark Coast twins exist to count');
  // The member fetch: with every non-twin Coast landmark
  // already in hand (the lever's exhausted-local-candidacy
  // case), the read list is the twins and only the twins.
  const inHand = new Set(
    index.filter(e => isLandmarkCoast(e) && !e.angle.endsWith(TWIN_SUFFIX)).map(e => `${e.place_key}|${e.angle}`),
  );
  const fetched = rm.selectMemberFetchEntries(index, {
    topic: 'Coast',
    fetchedIds: inHand,
    path,
    destination: dest,
    tagsOf,
    eligibleOf,
  });
  assert.equal(fetched.length, landmarkCoastTwins, 'every landmark Coast twin is fetchable');
  assert.ok(fetched.every(e => e.angle.endsWith(TWIN_SUFFIX)), 'only twins remain to fetch');
  // Index-order discipline: with nothing in hand the capped
  // read list is originals (twins ride at the index's tail).
  const firstPage = rm.selectMemberFetchEntries(index, {
    topic: 'Coast',
    fetchedIds: new Set(),
    path,
    destination: dest,
    tagsOf,
    eligibleOf,
  });
  assert.equal(firstPage.length, rm.MEMBER_FETCH_READ_CAP, 'the read cap binds');
  assert.ok(firstPage.every(e => !e.angle.endsWith(TWIN_SUFFIX)), 'the first page is originals, in index order');
});
check('woven twins (generator): a Protected source aborts the build; an unclassified source is skipped; an audit row for the twin wins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'presence-twins-'));
  const gen = join(repoRoot, 'scripts', 'route-mode', 'build-route-presence.mjs');
  const presenceCsv = join(dir, 'presence.csv');
  const tagsCsv = join(dir, 'tags.csv');
  const outTs = join(dir, 'out.ts');
  writeFileSync(
    presenceCsv,
    [
      'place_key,angle,presence_class,protected',
      'good place,landmark_origin,bound,0',
      'prot place,landmark_origin,safe,1',
      'audit twin,landmark_event-woven-v1,bound,0',
      '',
    ].join('\n'),
  );
  const tagsHead = 'place_key,angle,topics,tone,tone_secondary,tagged_from';
  writeFileSync(
    tagsCsv,
    [tagsHead, 'good place,landmark_origin-woven-v1,Coast,warm,,t', 'audit twin,landmark_event-woven-v1,Coast,warm,,t', 'ghost place,landmark_origin-woven-v1,Coast,warm,,t', ''].join('\n'),
  );
  execFileSync(process.execPath, [gen, presenceCsv, tagsCsv, outTs], { stdio: 'pipe' });
  const out = readFileSync(outTs, 'utf8');
  assert.ok(out.includes('"good place|landmark_origin-woven-v1": { presence: "safe", protected: false }'), 'the twin of a bound source derives safe');
  assert.ok(out.includes('"audit twin|landmark_event-woven-v1": { presence: "bound", protected: false }'), 'the audit’s own row for a twin key is not overridden');
  assert.ok(!out.includes('ghost place'), 'a twin of an unclassified source is skipped (stays ineligible)');
  writeFileSync(
    tagsCsv,
    [tagsHead, 'prot place,landmark_origin-woven-v1,Coast,warm,,t', ''].join('\n'),
  );
  assert.throws(
    () => execFileSync(process.execPath, [gen, presenceCsv, tagsCsv, outTs], { stdio: 'pipe' }),
    'a twin of a Protected source aborts the build',
  );
});

check('woven seating: members seat strongest-first into the silent gap, climax untouched', () => {
  assert.equal(rm.WOVEN_MEMBER_CAP, 4);
  const units = wFixtureUnits([
    wCand('w1|landmark_history', 300, { placeName: 'Woven One' }),
    wCand('w2|landmark_history', 280, { placeName: 'Woven Two' }),
    wCand('w3|landmark_history', 250, { placeName: 'Woven Three' }),
    wCand('w4|landmark_history', 200, { placeName: 'Woven Four' }),
    wCand('w5|landmark_history', 170, { placeName: 'Woven Five' }),
    wCand('w6|landmark_history', 100, { placeName: 'Woven Six' }),
  ]);
  const plan = wCompose(units, 1800);
  assert.equal(plan.thread?.topic, WT, 'the geo spine alone carries the thread');
  assert.equal(plan.climaxUnitId, 'gd|landmark_origin', 'the strong late geo story is the climax');
  const beforeIds = storyIds(plan);
  const seated = rm.seatWovenMembers(plan, units, { heardKeys: new Set() });
  // The one big mid-drive gap (the departure edge is closed
  // to members): w1 and w2 take it strongest-first; w3/w4 no
  // longer fit the remainder and are skipped on size; w5
  // (170 s) fits what is left; w6 does not.
  assert.deepEqual(memberIds(seated), [
    'w1|landmark_history',
    'w2|landmark_history',
    'w5|landmark_history',
  ]);
  assert.deepEqual(seated.wovenMembers, {
    count: 3,
    topics: [WT],
    unitIds: memberIds(seated),
  });
  // Gap-only, no displacement: the pre-seating story sequence
  // survives verbatim as the non-member subsequence.
  assert.deepEqual(
    seated.items.filter(i => i.kind === 'story' && !i.woven).map(i => i.id),
    beforeIds,
    'no sounding story moved, dropped, or reordered',
  );
  // Members are windowless inserts (they release by plan
  // order) and never carry the climax flag.
  for (const it of seated.items.filter(i => i.woven)) {
    assert.equal(it.releaseProgress, undefined, 'a member is windowless');
    assert.equal(it.climax, undefined, 'a member is never the climax');
  }
  // Every member fits entirely inside a gap of the ORIGINAL
  // plan (the guarantee's own interval model, recomputed).
  const spans = plan.items
    .filter(i => (i.kind === 'story' || i.kind === 'filler') && i.unit)
    .map(i => {
      const a = (i.anchorProgress ?? 0) * 1800;
      const s = i.releaseProgress !== undefined ? i.releaseProgress * 1800 : a;
      const e = i.expireProgress !== undefined ? i.expireProgress * 1800 : s + i.durationSec;
      return [s, e];
    })
    .sort((x, y) => x[0] - y[0]);
  for (const it of seated.items.filter(i => i.woven)) {
    const s = (it.anchorProgress ?? 0) * 1800;
    const e = s + it.durationSec;
    let cursor = 0;
    let inside = false;
    for (const [ss, ee] of spans) {
      if (s >= cursor && e <= ss) inside = true;
      cursor = Math.max(cursor, ee);
    }
    if (s >= cursor && e <= 1800) inside = true;
    assert.ok(inside, `member ${it.id} [${s}, ${e}] sits inside an original silent gap`);
  }
});

check('woven seating: the cap binds even when the gap could hold more', () => {
  const units = wFixtureUnits([
    wCand('w1|landmark_history', 200),
    wCand('w2|landmark_history', 200),
    wCand('w3|landmark_history', 200),
    wCand('w4|landmark_history', 200),
    wCand('w5|landmark_history', 200),
    wCand('w6|landmark_history', 200),
  ]);
  const plan = wCompose(units, 2400);
  const seated = rm.seatWovenMembers(plan, units, { heardKeys: new Set() });
  assert.equal(seated.wovenMembers.count, 4, 'four members and no more, though six would fit');
  assert.deepEqual(memberIds(seated), [
    'w1|landmark_history',
    'w2|landmark_history',
    'w3|landmark_history',
    'w4|landmark_history',
  ]);
  assert.ok(!storyIds(seated).includes('w5|landmark_history'), 'the fifth candidate stays on the shelf');
  // The knob exists for the grader; the production caller
  // never passes it.
  const two = rm.seatWovenMembers(plan, units, { heardKeys: new Set(), maxMembers: 2 });
  assert.equal(two.wovenMembers.count, 2);
});

check('woven seating: the thread gate — no through-line, no members, plan returned untouched', () => {
  const units = [
    unit('ga|landmark_origin', 32.71, { placeName: 'Geo A' }),
    unit('gb|landmark_origin', 32.72, { placeName: 'Geo B' }),
    wCand('w1|landmark_history', 300, { topics: ['Coast'] }),
    wCand('w2|landmark_history', 300, { topics: ['Surf'] }),
    wCand('w3|landmark_history', 300, { topics: ['Rail'] }),
  ];
  const plan = wCompose(units, 1800);
  assert.equal(plan.thread, null, 'no topic reaches thread weight anywhere');
  const seated = rm.seatWovenMembers(plan, units, { heardKeys: new Set() });
  assert.equal(seated, plan, 'the same plan object comes back — a strict no-op');
  assert.equal(seated.wovenMembers.count, 0);
  assert.deepEqual(memberIds(seated), []);
});

// PORTED (thread re-anchor, Nov 5, 2026): the pre-re-anchor
// contract — off-route woven support counts toward thread
// QUALIFICATION — is superseded by the intersection rule
// (scope Decision 1): a topic qualifies only on ≥3 cast
// members in the geo pool in hand; woven/portal units never
// qualify a thread. What survives of the old contract: once
// a thread qualifies on its geo cast, woven carriers join
// its memberIds (imports garnish, they never mint).
check('woven thread support: woven stories garnish a qualified thread but can never qualify one (intersection rule)', () => {
  const twoGeo = [
    wGeo('ga|landmark_origin', 32.71, 120, 'Geo A'),
    wGeo('gb|landmark_origin', 32.72, 120, 'Geo B'),
    wCand('w1|landmark_history', 300),
    wCand('w2|landmark_history', 300),
    wCand('w3|landmark_history', 300),
  ];
  const thin = wCompose(twoGeo, 1800);
  assert.equal(thin.thread, null, 'two geo carriers + three woven carriers → NO thread: woven units cannot qualify a topic');
  const threeGeo = [...twoGeo, wGeo('gc|landmark_origin', 32.73, 120, 'Geo C')];
  const plan = wCompose(threeGeo, 1800);
  assert.equal(plan.thread?.topic, WT, 'three geo carriers qualify the topic thread');
  assert.equal(plan.thread?.anchorKind, 'topic');
  for (const id of ['w1|landmark_history', 'w2|landmark_history', 'w3|landmark_history']) {
    assert.ok(plan.thread.memberIds.includes(id), `the woven carrier ${id} joins the qualified thread's cast`);
  }
});

check('woven seating: eligibility exclusion — bound and unflagged stories never seat', () => {
  const units = wFixtureUnits([
    wCand('wbound|landmark_history', 600, { wovenEligible: false, placeName: 'Bound Giant' }),
    unit('wnoflag|landmark_history', 32.0, {
      lng: -117.05,
      topics: [WT],
      placeName: 'Unflagged Giant',
      durationSec: 550,
    }),
    wCand('wok|landmark_history', 200, { placeName: 'Eligible One' }),
  ]);
  const plan = wCompose(units, 1800);
  const seated = rm.seatWovenMembers(plan, units, { heardKeys: new Set() });
  assert.deepEqual(seated.wovenMembers.unitIds, ['wok|landmark_history'], 'only the eligible story seats');
  assert.ok(
    !seated.items.some(i => i.woven && i.id !== 'wok|landmark_history'),
    'no ineligible story carries the woven flag',
  );
  assert.ok(!storyIds(seated).includes('wnoflag|landmark_history'), 'the unflagged giant never sounds as anything');
});

check('woven seating: a member is never the climax — the portal-climax winner is excluded from seating', () => {
  const units = [
    wGeo('ga|landmark_origin', 32.71, 120, 'Geo A'),
    wGeo('gb|landmark_origin', 32.72, 120, 'Geo B'),
    wGeo('gc|landmark_origin', 32.73, 120, 'Geo C'),
    unit('whop|landmark_history', 32.0, {
      lng: -117.05,
      topics: [WT],
      placeName: 'Hop Sacrifice',
      durationSec: 60,
      wovenEligible: false,
    }),
    wCand('wbig|landmark_history', 400, { placeName: 'Woven Big' }),
    wCand('wmid|landmark_history', 250, { placeName: 'Woven Mid' }),
    wCand('wsmall|landmark_history', 200, { placeName: 'Woven Small' }),
  ];
  const plan = wCompose(units, 1800);
  assert.equal(plan.climaxUnitId, 'wbig|landmark_history', 'with no late geo story, the strongest woven unit takes the portal climax');
  const seated = rm.seatWovenMembers(plan, units, { heardKeys: new Set() });
  const climaxItem = seated.items.find(i => i.climax);
  assert.equal(climaxItem?.id, 'wbig|landmark_history');
  assert.ok(!climaxItem?.woven, 'the climax item is not a member');
  assert.deepEqual(seated.wovenMembers.unitIds, ['wmid|landmark_history', 'wsmall|landmark_history']);
  assert.ok(!seated.wovenMembers.unitIds.includes('wbig|landmark_history'), 'the climax never double-seats as a member');
});

check('woven seating: heard exclusion is story-level — a heard member candidate is skipped, and a played member burns', () => {
  const mk = () =>
    wFixtureUnits([
      wCand('wheard|landmark_history', 400, { placeName: 'Heard One', storyText: 'heard text unique' }),
      wCand('wnext|landmark_history', 300, { placeName: 'Next One', storyText: 'next text unique' }),
      wCand('wthird|landmark_history', 200, { placeName: 'Third One', storyText: 'third text unique' }),
    ]);
  const units1 = mk();
  const plan1 = wCompose(units1, 1800);
  const seated1 = rm.seatWovenMembers(plan1, units1, {
    heardKeys: new Set(['wheard|landmark_history']),
  });
  assert.deepEqual(
    seated1.wovenMembers.unitIds,
    ['wnext|landmark_history', 'wthird|landmark_history'],
    'the heard candidate is skipped; the next strongest seat',
  );
  // The burn: file wnext's text as heard (the ledger's own
  // derivation) and the next build seats a different member.
  const units2 = mk();
  const plan2 = wCompose(units2, 1800);
  const heard2 = rm.heardKeysForStories(units2, new Set(['next text unique']));
  assert.ok(heard2.has('wnext|landmark_history'));
  const seated2 = rm.seatWovenMembers(plan2, units2, { heardKeys: heard2 });
  assert.deepEqual(
    seated2.wovenMembers.unitIds,
    ['wheard|landmark_history', 'wthird|landmark_history'],
    'the burned member is gone next build; the previously heard-keyed slot was only this build’s exclusion',
  );
});

check('woven framing: the bridge into a member ranges along the thread — no proximity language; geo bridges unchanged', () => {
  const units = wFixtureUnits([
    wCand('w1|landmark_history', 400, { placeName: 'Woven One' }),
    wCand('w2|landmark_history', 350, { placeName: 'Woven Two' }),
  ]);
  const plan = wCompose(units, 1800);
  const seated = rm.seatWovenMembers(plan, units, { heardKeys: new Set() });
  assert.ok(memberIds(seated).length >= 1, 'fixture seats at least one member');
  const memberBridge = seated.items.find(i => i.kind === 'bridge' && i.nextUnitId === 'w1|landmark_history');
  assert.ok(memberBridge, 'a bridge introduces the member');
  assert.ok(!/just ahead|on your left|on your right|coming up/i.test(memberBridge.text), `no proximity language: ${memberBridge.text}`);
  assert.ok(memberBridge.text.includes('Woven One'), 'the bridge names the member’s real place');
  assert.ok(memberBridge.text.includes('clear across the county'), 'the range is framed honestly');
  assert.ok(memberBridge.text.includes(WT), 'the bridge names the thread it is following');
  const geoBridge = seated.items.find(i => i.kind === 'bridge' && i.nextUnitId === 'gb|landmark_origin');
  assert.ok(geoBridge && geoBridge.text.includes('just ahead is Geo B'), 'geo bridges keep their proximity framing');
});

await checkAsync('woven telemetry: route_plan_started decisions carry the woven members', async () => {
  const units = wFixtureUnits([wCand('w1|landmark_history', 400, { placeName: 'Woven One' })]);
  const plan = wCompose(units, 1800);
  const seated = rm.seatWovenMembers(plan, units, { heardKeys: new Set() });
  assert.equal(seated.wovenMembers.count, 1);
  const events = [];
  const runner = new rp.RoutePlanRunner({
    audio: new RealFakeAudio(250),
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onEvent: (t, p) => events.push({ t, p }),
    onStoryHeard: () => {},
  });
  await runner.start(seated);
  const started = events.find(e => e.t === 'route_plan_started');
  assert.ok(started, 'route_plan_started filed');
  assert.deepEqual(started.p.decisions.woven_members, { count: 1, topics: [WT] });
  runner.endTour();
});

// ── Member-fetch lever (Nov 4, 2026) ───────────────────────
// The production acceptance at 54ecb95 flagged the supply
// path: detection + candidacy saw only the fetched set and
// starved from ~drive 14 while the county index held the
// depth. The lever: detection counts index support, and a
// short-handed thread declares wovenMembersSeeking for ONE
// bounded member fetch. Fixtures reuse the woven section's
// (WT thread, wCand off-route candidates at lat 32.0).
const leverCompose = (units, driveSec, extraOpts = {}) => {
  const plan = rm.composeRoutePlan(
    units,
    path,
    dest,
    'Dest',
    { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] },
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: driveSec, driveSec, ...extraOpts },
  );
  plan.driveSec = driveSec;
  plan.budgetSec = driveSec;
  return plan;
};
const idxEntryOf = u => ({ place_key: u.placeKey, angle: u.angle, lat: u.lat, lng: u.lng });

check('lever support: the index counter counts only unheard, eligible, landmark, off-corridor depth not in hand', () => {
  const mk = (id, lat, lng, topics, eligible) => ({
    u: { id, placeKey: id.split('|')[0], angle: id.split('|')[1], lat, lng, topics },
    eligible,
  });
  const rows = [
    mk('alpha|landmark_origin', 32.0, -117.05, [WT], true),
    mk('beta|landmark_event', 32.0, -117.05, [WT, 'Coast'], true),
    mk('gamma|landmark_origin', 32.0, -117.05, [WT], true), // heard → out
    mk('delta|landmark_origin', 32.0, -117.05, [WT], true), // already fetched → out
    mk('epsilon|landmark_origin', 32.0, -117.05, [WT], false), // presence-bound → out
    mk('zeta|corridor', 32.0, -117.05, [WT], true), // not landmark-class → out
    mk('eta|landmark_origin', 32.8, -117.25, [WT], true), // on the path → out
    mk('theta|landmark_origin', 32.9, -117.25, [WT], true), // at the destination → out
  ];
  const byId = new Map(rows.map(r => [r.u.id, r.u]));
  const support = rm.wovenIndexSupportByTopic(
    rows.map(r => idxEntryOf(r.u)),
    path,
    dest,
    (pk, ang) => ({ topics: byId.get(`${pk}|${ang}`)?.topics ?? [] }),
    (pk, ang) => rows.find(r => r.u.id === `${pk}|${ang}`)?.eligible ?? false,
    { fetchedIds: new Set(['delta|landmark_origin']), heardIds: new Set(['gamma|landmark_origin']) },
  );
  assert.deepEqual([...support.entries()].sort(), [['Coast', 1], [WT, 2]]);
});

check('lever detection: a thread is detected on index depth with a thin — or empty — fetched cast', () => {
  const two = [wGeo('ga|landmark_origin', 32.71), wGeo('gb|landmark_origin', 32.72)];
  assert.equal(rm.detectRouteThread(two, []), null, 'two in hand is under the bar without the index');
  const t = rm.detectRouteThread(two, [], new Map([[WT, 4]]));
  assert.equal(t?.topic, WT);
  assert.equal(t?.score, 6, 'support = cast in hand + index depth');
  assert.deepEqual(t?.memberIds, ['ga|landmark_origin', 'gb|landmark_origin'], 'member ids stay the real cast');
  const zero = rm.detectRouteThread(
    [unit('gx|landmark_origin', 32.71, { name: 'GX', topics: ['Surf'] })],
    [],
    new Map([[WT, 3]]),
  );
  assert.equal(zero?.topic, WT, 'zero cast, deep index: the exhausted-corridor thread still detects');
  assert.deepEqual(zero?.memberIds, []);
  // Ranking reads support: a deeper-indexed topic beats a thicker fetched cast.
  const mixed = [
    wGeo('a1|landmark_origin', 32.71, 120, 'A1'), wGeo('a2|landmark_origin', 32.72, 120, 'A2'), wGeo('a3|landmark_origin', 32.73, 120, 'A3'),
    unit('b1|landmark_origin', 32.74, { topics: ['Coast'] }), unit('b2|landmark_origin', 32.75, { topics: ['Coast'] }),
  ];
  // a-units carry WT (wGeo), b-units Coast: cast 3 vs 2, index 0 vs 5.
  assert.equal(rm.detectRouteThread(mixed, [], new Map([['Coast', 5]]))?.topic, 'Coast');
  // The user's own picks still govern: support never forces a theme over them.
  assert.equal(rm.detectRouteThread(two, ['Coast'], new Map([[WT, 9]])), null, 'user picked Coast; WT depth is irrelevant');
});

check('lever seeking: fires only when local candidacy is insufficient AND the index promises more', () => {
  const support = new Map([[WT, 9]]);
  // (a) Local candidacy at the applicable NEED → no fetch,
  // however deep the index. The need is the seat count the
  // fetch provisions for (wovenMemberNeed): this fixture's
  // plan sits below the thread-carried floor, so its need
  // is the carried 8 — nine in hand clears any need.
  const rich = wFixtureUnits([
    wCand('w1|landmark_history', 300), wCand('w2|landmark_history', 290),
    wCand('w3|landmark_history', 280), wCand('w4|landmark_history', 270),
    wCand('w5|landmark_history', 260), wCand('w6|landmark_history', 250),
    wCand('w7|landmark_history', 240), wCand('w8|landmark_history', 230),
    wCand('w9|landmark_history', 220),
  ]);
  assert.equal(leverCompose(rich, 1800, { wovenIndexSupport: support }).wovenMembersSeeking, null);
  // (b) One local candidate + index depth → seeking the thread's topic.
  const thin = wFixtureUnits([wCand('w1|landmark_history', 300)]);
  assert.equal(leverCompose(thin, 1800, { wovenIndexSupport: support }).wovenMembersSeeking, WT);
  // (c) Thin local candidacy but NO index support supplied → never seeking (the pre-lever shape).
  assert.equal(leverCompose(thin, 1800).wovenMembersSeeking, null);
  assert.equal(leverCompose(thin, 1800, { wovenIndexSupport: new Map() }).wovenMembersSeeking, null);
  // (d) No thread → no fetch: index depth under the detection
  // bar conjures nothing when the fetched set has no cast.
  const castless = [
    unit('ga|landmark_origin', 32.71, {}), unit('gb|landmark_origin', 32.72, {}),
    wCand('w1|landmark_history', 300, { topics: ['Coast'] }),
  ];
  const noThread = leverCompose(castless, 1800, { wovenIndexSupport: new Map([[WT, 2]]) });
  assert.equal(noThread.thread, null, 'WT depth 2 with zero cast is under the bar');
  assert.equal(noThread.wovenMembersSeeking, null);
  const scattered = [
    unit('ga|landmark_origin', 32.71), unit('gb|landmark_origin', 32.72),
    wCand('w1|landmark_history', 300, { topics: ['Coast'] }),
  ];
  const p = leverCompose(scattered, 1800, { wovenIndexSupport: new Map([['Surf', 2]]) });
  assert.equal(p.thread, null, 'no topic reaches the bar anywhere');
  assert.equal(p.wovenMembersSeeking, null, 'no thread → no member fetch');
});

check('lever fetch: entry selection respects the read cap and the member predicate', () => {
  const valid = [];
  for (let i = 0; i < 30; i++) {
    valid.push({ place_key: `p${i}`, angle: 'landmark_origin', lat: 32.0, lng: -117.05 });
  }
  const poison = [
    { place_key: 'fetched', angle: 'landmark_origin', lat: 32.0, lng: -117.05 },
    { place_key: 'bound', angle: 'landmark_origin', lat: 32.0, lng: -117.05 },
    { place_key: 'offtopic', angle: 'landmark_origin', lat: 32.0, lng: -117.05 },
    { place_key: 'corr', angle: 'corridor', lat: 32.0, lng: -117.05 },
    { place_key: 'onpath', angle: 'landmark_origin', lat: 32.8, lng: -117.25 },
  ];
  const entries = [...poison, ...valid];
  const sel = (cap) =>
    rm.selectMemberFetchEntries(entries, {
      topic: WT,
      fetchedIds: new Set(['fetched|landmark_origin']),
      path,
      destination: dest,
      tagsOf: pk => ({ topics: pk === 'offtopic' ? ['Coast'] : [WT] }),
      eligibleOf: pk => pk !== 'bound',
      ...(cap ? { cap } : {}),
    });
  assert.equal(rm.MEMBER_FETCH_READ_CAP, 24);
  assert.equal(sel().length, 24, 'the read cap binds at 24 of 30 valid entries');
  assert.equal(sel(5).length, 5, 'an explicit smaller cap binds too');
  assert.ok(
    sel().every(e => e.angle.startsWith('landmark') && !['fetched', 'bound', 'offtopic', 'corr', 'onpath'].includes(e.place_key)),
    'every selected entry passes the member predicate',
  );
});

check('lever staging: fetched members seat under every seating rule — cap, climax, place, heard', () => {
  const units = wFixtureUnits([
    wCand('wloc|landmark_history', 300, { placeName: 'Local One' }),
    wCand('wlo2|landmark_history', 290, { placeName: 'Local Two' }),
  ]);
  const plan1 = leverCompose(units, 2400, { wovenIndexSupport: new Map([[WT, 12]]) });
  assert.equal(plan1.wovenMembersSeeking, WT, 'the thin local supply asks for the fetch');
  // The fetch returns its survivors; one is the climax's own
  // place (another angle), one lands in the build's heard set
  // before seating — seating must refuse both.
  const memberUnits = [
    wCand('m1|landmark_history', 350, { placeName: 'Fetched One' }),
    wCand('m2|landmark_history', 320, { placeName: 'Fetched Heard' }),
    wCand('m3|landmark_history', 300, { placeName: 'Fetched Three' }),
    wCand('m4|landmark_history', 280, { placeName: 'Fetched Four' }),
    wCand('m5|landmark_history', 260, { placeName: 'Fetched Five' }),
    wCand('m6|landmark_history', 240, { placeName: 'Fetched Six' }),
    wCand('m7|landmark_history', 220, { placeName: 'Fetched Seven' }),
    wCand('gd|landmark_history', 330, { placeName: 'Climax Place Twin' }),
  ];
  const heardKeys = new Set(['m2|landmark_history']);
  const plan2 = leverCompose(units, 2400, {
    wovenIndexSupport: new Map([[WT, 6]]),
    memberUnits,
    heardKeys,
  });
  assert.equal(plan2.thread?.topic, WT);
  assert.ok(plan2.thread.memberIds.includes('m1|landmark_history'), 'fetched members join the cast in hand');
  assert.equal(plan2.wovenMembersSeeking, null, 'supply in hand (local + fetched seatable) reaches the plan’s need — no second fetch');
  const seated = rm.seatWovenMembers(plan2, [...units, ...memberUnits], { heardKeys });
  const ids = memberIds(seated);
  assert.ok(ids.length >= 2 && ids.length <= rm.WOVEN_MEMBER_CAP, `cap respected (${ids.length} seated)`);
  assert.ok(ids.includes('m1|landmark_history'), 'the strongest fetched member seats');
  assert.ok(!ids.includes('m2|landmark_history'), 'a member in the heard set never seats');
  assert.ok(!ids.includes('gd|landmark_history'), 'the climax’s place is spent — one telling per place');
  assert.ok(!ids.includes(plan2.climaxUnitId), 'a member is never the climax');
  assert.ok(
    seated.items.filter(i => i.woven).every(i => i.climax === undefined && i.releaseProgress === undefined),
    'fetched members are windowless non-climax inserts, like local ones',
  );
});

check('lever no-op: empty or absent index support leaves a composed plan untouched', () => {
  const units = wFixtureUnits([wCand('w1|landmark_history', 300), wCand('w2|landmark_history', 280)]);
  const plain = wCompose(units, 1800);
  const withEmpty = leverCompose(units, 1800, { wovenIndexSupport: new Map() });
  assert.deepEqual(storyIds(withEmpty), storyIds(plain));
  assert.equal(withEmpty.thread?.topic, plain.thread?.topic);
  assert.equal(withEmpty.thread?.score, plain.thread?.score);
  assert.equal(withEmpty.wovenMembersSeeking, null);
  assert.equal(plain.wovenMembersSeeking, null);
});

await checkAsync('lever telemetry: route_plan_started fetch record carries the member fetch', async () => {
  const units = wFixtureUnits([wCand('w1|landmark_history', 400, { placeName: 'Woven One' })]);
  const plan = wCompose(units, 1800);
  const seated = rm.seatWovenMembers(plan, units, { heardKeys: new Set() });
  const baseStats = {
    reads: 100, geoReads: 80, portalReads: 20, unheard: 40, geoUnheard: 30,
    portalUnheard: 10, decileUnheard: Array(10).fill(3), ceilingHit: false,
  };
  const run = async fetchStats => {
    const p = { ...seated, fetchStats };
    const events = [];
    const runner = new rp.RoutePlanRunner({
      audio: new RealFakeAudio(250),
      synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
      onEvent: (t, payload) => events.push({ t, p: payload }),
      onStoryHeard: () => {},
    });
    await runner.start(p);
    runner.endTour();
    return events.find(e => e.t === 'route_plan_started');
  };
  const withFetch = await run({ ...baseStats, memberFetch: { topic: WT, reads: 12, candidates: 5 } });
  assert.deepEqual(withFetch.p.fetch.member_fetch, { topic: WT, reads: 12, candidates: 5 });
  assert.equal(withFetch.p.fetch.reads, 100, 'the departure window’s counts are not folded with the member fetch');
  const without = await run({ ...baseStats });
  assert.equal(without.p.fetch.member_fetch, null, 'no member fetch on the build → null, one telemetry shape');
});

// ── Thread-carried episodes (Nov 4, 2026) ────────────────────
// The exhausted-case rule: when the road itself cannot fill
// roughly half the drive (geo stories + guarantee fills —
// members excluded from the measure), the thread stops
// filling an episode's silence and becomes the episode:
// members anchor along the timeline under a raised cap (8),
// the strongest member takes the climax position when no
// geo climax exists, and the preview says so out loud.

// A geo-healthy spine for this coarse fixture path: four
// long stories whose sounding windows union past half the
// budget even where the sequencer's act anchors cluster.
const healthyGeo = () =>
  [32.71, 32.74, 32.84, 32.88].map((lat, i) =>
    wGeo(`h${i + 1}|landmark_origin`, lat, 700, `Healthy ${i + 1}`),
  );
const carriedCands = () =>
  [350, 330, 310, 290, 270, 250, 230, 210, 190].map((d, i) =>
    wCand(`c${i + 1}|landmark_history`, d, { placeName: `Carried ${i + 1}` }),
  );
// PORTED FIXTURE (thread re-anchor, Nov 5, 2026): under the
// intersection rule a thread needs ≥3 cast members in the
// GEO pool — the pre-anchor fixtures threaded story-less
// plans on woven support alone, which the new contract
// forbids (imports garnish, they never mint). The carried
// fixtures now compose on a GEO-THIN spine: three short
// on-route WT stories (~3 minutes of a 40-minute drive —
// coverage far below the floor), with the member cast
// arriving as memberUnits, exactly as the production lever
// delivers it (member units join woven support; they are
// never geo pool and never portal pool, so the portal
// climax cannot pre-crown the strongest candidate either).
const geoThinCast = () =>
  [32.71, 32.72, 32.73].map((lat, i) => wGeo(`gt${i + 1}|landmark_origin`, lat, 60, `Geo Thin ${i + 1}`));

check('carried predicate: fires below the floor with a thread; never on a healthy plan or without one', () => {
  const healthy = leverCompose([...healthyGeo(), wCand('w1|landmark_history', 300)], 2400);
  const ha = rm.assessThreadCarried(healthy);
  assert.ok(ha.geoCoverageFraction >= rm.THREAD_CARRIED_FLOOR, `healthy fraction ${ha.geoCoverageFraction}`);
  assert.equal(ha.active, false);
  assert.equal(ha.memberCap, rm.WOVEN_MEMBER_CAP, 'the standing cap is the verdict on a healthy plan');
  // A geo-thin plan (ported, thread re-anchor, Nov 5,
  // 2026): a real thread on a 3-story geo spine whose
  // sounding windows cover a sliver of the drive.
  const bare = leverCompose(geoThinCast(), 2400, { memberUnits: carriedCands().slice(0, 3) });
  assert.equal(bare.thread?.topic, WT);
  const ba = rm.assessThreadCarried(bare);
  assert.ok(
    ba.geoCoverageFraction > 0 && ba.geoCoverageFraction < rm.THREAD_CARRIED_FLOOR,
    `thin fraction ${ba.geoCoverageFraction} is above zero (the spine sounds) and below the floor`,
  );
  assert.equal(ba.active, true);
  assert.equal(ba.memberCap, rm.WOVEN_MEMBER_CAP_CARRIED, 'the raised cap is the verdict below the floor');
  // Below the floor with NO thread: nothing can carry it.
  const noThread = leverCompose([unit('x1|landmark_origin', 32.71, { topics: ['Coast'] })], 2400);
  assert.equal(noThread.thread, null);
  assert.equal(rm.assessThreadCarried(noThread).active, false);
});

check('carried sizing: the member fetch scales with the seat need', () => {
  assert.deepEqual(rm.memberFetchSizing(rm.WOVEN_MEMBER_CAP), { readCap: 24, target: 8 });
  assert.deepEqual(rm.memberFetchSizing(rm.WOVEN_MEMBER_CAP_CARRIED), { readCap: 48, target: 16 });
  assert.equal(rm.memberFetchSizing(rm.WOVEN_MEMBER_CAP).readCap, rm.MEMBER_FETCH_READ_CAP);
  assert.equal(rm.memberFetchSizing(rm.WOVEN_MEMBER_CAP).target, rm.MEMBER_FETCH_TARGET);
  const entries = [];
  for (let i = 0; i < 60; i++) {
    entries.push({ place_key: `cap${i}`, angle: 'landmark_origin', lat: 32.0, lng: -117.05 });
  }
  const sel = rm.selectMemberFetchEntries(entries, {
    topic: WT,
    fetchedIds: new Set(),
    path,
    destination: dest,
    tagsOf: () => ({ topics: [WT] }),
    eligibleOf: () => true,
    cap: rm.memberFetchSizing(rm.WOVEN_MEMBER_CAP_CARRIED).readCap,
  });
  assert.equal(sel.length, 48, 'the carried read cap binds the single fetch');
});

check('carried need: below the floor the plan provisions for eight; above it, four suffice', () => {
  const support = new Map([[WT, 12]]);
  const five = [300, 280, 260, 240, 220].map((d, i) =>
    wCand(`n${i + 1}|landmark_history`, d, { placeName: `Need ${i + 1}` }),
  );
  // (Ported, thread re-anchor, Nov 5, 2026: the below-floor
  // case composes on the geo-thin spine — the five candidates
  // alone can no longer mint the thread they provision for.)
  const below = leverCompose([...geoThinCast(), ...five], 2400, { wovenIndexSupport: support });
  assert.equal(below.thread?.topic, WT);
  assert.equal(below.wovenMemberNeed, rm.WOVEN_MEMBER_CAP_CARRIED);
  assert.equal(below.wovenMembersSeeking, WT, 'five in hand cannot fill eight seats — the fetch stays open');
  const above = leverCompose([...healthyGeo(), ...five], 2400, { wovenIndexSupport: support });
  assert.equal(above.wovenMemberNeed, rm.WOVEN_MEMBER_CAP);
  assert.equal(above.wovenMembersSeeking, null, 'five in hand fills the standing need — no fetch');
});

// PORTED (thread re-anchor, Nov 5, 2026): the pre-anchor
// fixture was a STORY-LESS plan threading on woven support
// alone — under the intersection rule that plan has no
// thread at all, so the mode's subject is now the GEO-THIN
// plan: a real thread whose road is nearly silent. The
// claims port with it: normal seating still cannot anchor
// the episode (cap 4, the departure edge closed, no climax
// designation), while the carried pass spreads the member
// cast across the timeline, designates the strongest member
// as the climax the road never crowned, and re-frames the
// preview honestly.
check('carried anchoring: a geo-thin plan composes from the thread — spread, climax position, framing', () => {
  const cands = carriedCands();
  const plan = leverCompose(geoThinCast(), 2400, { memberUnits: cands });
  assert.equal(plan.thread?.topic, WT);
  assert.equal(
    plan.items.filter(i => i.kind === 'story').length,
    3,
    'the composed plan’s whole geo spine is the thin cast',
  );
  assert.equal(plan.climaxUnitId, null, 'the thin cast crowns nothing — the climax designation is open');
  // The standing rule still holds without the mode: normal
  // seating cannot anchor — it stops at the standing cap,
  // never opens the drive, and designates no climax.
  const normal = rm.seatWovenMembers(plan, cands, { heardKeys: new Set() });
  assert.ok(memberIds(normal).length <= 4, 'normal seating stops at the standing cap');
  assert.ok(normal.items.find(i => i.kind === 'story')?.woven !== true, 'a member never opens the drive in normal mode');
  assert.equal(normal.climaxUnitId, null, 'normal seating designates no climax');
  const tc = rm.assessThreadCarried(plan);
  assert.equal(tc.active, true);
  const carried = rm.seatWovenMembers(plan, cands, { heardKeys: new Set(), maxMembers: tc.memberCap, threadCarried: true });
  const members = carried.items.filter(i => i.woven);
  assert.equal(members.length, 8, 'the raised cap binds: 8 of 9 candidates seat');
  assert.equal(carried.wovenMembers?.count, 8);
  const anchors = members.map(i => i.anchorProgress);
  assert.ok(anchors.every((a, j) => j === 0 || a > anchors[j - 1]), 'member anchors increase along the drive');
  // (Ported: the story-less fixture's first member anchored
  // the opening act itself; on the geo-thin spine the
  // opening act is the spine's own — the spread claim is
  // that members sound from early in the drive to its end.)
  assert.ok(anchors[0] < 0.35, `the first member sounds early (anchor ${anchors[0]})`);
  const acts = carried.actsSummary;
  assert.ok(
    acts.opening.stories >= 1 && acts.middle.stories >= 1 && acts.climax.stories >= 1,
    `every act holds stories: ${JSON.stringify(acts)}`,
  );
  // The climax position: the strongest member, final third,
  // ending with the drive, marked as the plan's climax.
  const climaxItems = carried.items.filter(i => i.climax);
  assert.equal(climaxItems.length, 1);
  assert.equal(climaxItems[0].id, 'c1|landmark_history', 'the strongest member (350 s) holds the climax position');
  assert.ok(climaxItems[0].anchorProgress >= 2 / 3, 'the climax member sounds in the final third');
  assert.ok(
    Math.abs((climaxItems[0].anchorProgress ?? 0) + (climaxItems[0].durationSec ?? 0) / 2400 - 1) < 0.01,
    'the designated climax ends where the drive ends',
  );
  assert.equal(carried.climaxUnitId, 'c1|landmark_history');
  assert.equal(carried.climaxMode, 'thread');
  assert.ok(members.every(i => i.releaseProgress === undefined), 'members stay windowless inserts');
  const bridges = carried.items.filter(i => i.kind === 'bridge');
  assert.ok(bridges.length >= members.length - 1, 'adjacent members are bridged — stitched, not stacked');
  // Framing: the rebuild re-authors the preview, and it
  // tells the truth.
  const preview = carried.items.find(i => i.kind === 'preview');
  assert.ok(preview, 'the carried plan carries its preview from the rebuild');
  assert.ok(preview.text.includes('quiet'), 'the preview names the quiet road');
  assert.ok(preview.text.includes(WT), 'the preview names the thread');
  assert.equal(carried.previewFacts?.threadPromised, true, 'the strongest member is the promised peak');
});

check('carried caps: normal mode never exceeds four; the carried top-up never exceeds eight total', () => {
  // (Ported, thread re-anchor, Nov 5, 2026: the geo side
  // carries THREE WT stories — the intersection rule's cast —
  // where the pre-anchor fixture needed only one; the
  // candidates ride the portal pool as before, so the
  // strongest still takes the open climax slot.)
  const units = [
    wGeo('ga|landmark_origin', 32.71, 120, 'Geo A'),
    wGeo('gb|landmark_origin', 32.72, 120, 'Geo B'),
    wGeo('gc|landmark_origin', 32.73, 120, 'Geo C'),
    ...[300, 280, 260, 240, 220, 200, 180, 160, 140, 120].map((d, i) =>
      wCand(`t${i + 1}|landmark_history`, d, { placeName: `Top ${i + 1}` }),
    ),
  ];
  const plan = leverCompose(units, 2400);
  assert.equal(plan.thread?.topic, WT);
  assert.equal(plan.climaxMode, 'portal', 'the strongest candidate takes the open climax slot');
  const normal = rm.seatWovenMembers(plan, units, { heardKeys: new Set() });
  assert.equal(memberIds(normal).length, 4, 'normal seating stops at the standing cap');
  const tc = rm.assessThreadCarried(normal);
  assert.equal(tc.active, true, 'three short geo stories and a portal climax cannot fill half of 2400 s');
  const topped = rm.seatWovenMembers(normal, units, { heardKeys: new Set(), maxMembers: tc.memberCap, threadCarried: true });
  assert.equal(memberIds(topped).length, 8, 'the top-up fills to the carried cap and no further');
  assert.equal(topped.wovenMembers?.count, 8, 'the record counts the plan total');
  assert.equal(topped.climaxUnitId, 't1|landmark_history', 'the portal climax is untouched by the top-up');
  assert.ok(!topped.items.some(i => i.climax && i.woven), 'no member is marked climax');
});

check('carried climax doctrine: an existing geo climax is never displaced, joined, or followed', () => {
  // (Ported, thread re-anchor, Nov 5, 2026: a third geo WT
  // story joins the fixture — the intersection rule's cast —
  // mid-drive, so the destination climax's doctrine is what
  // is tested, not thread existence.)
  const units = [
    wGeo('ga|landmark_origin', 32.71, 120, 'Geo A'),
    wGeo('gm|landmark_origin', 32.75, 120, 'Geo M'),
    wGeo('gz|landmark_origin', 32.895, 500, 'Geo Z'),
    ...[300, 280, 260, 240, 220, 200].map((d, i) =>
      wCand(`g${i + 1}|landmark_history`, d, { placeName: `Guard ${i + 1}` }),
    ),
  ];
  const plan = leverCompose(units, 2400);
  assert.equal(plan.thread?.topic, WT);
  assert.equal(plan.climaxUnitId, 'gz|landmark_origin');
  assert.equal(plan.climaxMode, 'destination');
  const tc = rm.assessThreadCarried(plan);
  assert.equal(tc.active, true);
  const carried = rm.seatWovenMembers(plan, units, { heardKeys: new Set(), maxMembers: tc.memberCap, threadCarried: true });
  assert.ok(memberIds(carried).length >= 4, 'members anchor under the geo climax’s plan');
  assert.equal(carried.climaxUnitId, 'gz|landmark_origin', 'the geo climax stands');
  assert.equal(carried.climaxMode, 'destination');
  assert.ok(!carried.items.some(i => i.climax && i.woven), 'no member is marked climax');
  const climaxItem = carried.items.find(i => i.climax);
  const climaxStart = climaxItem.releaseProgress ?? climaxItem.anchorProgress;
  assert.ok(
    carried.items.filter(i => i.woven).every(i => i.anchorProgress < climaxStart),
    'no member sounds at or after the climax',
  );
});

checkAsync('carried telemetry: route_plan_started decisions carry the thread_carried record', async () => {
  const cands = carriedCands();
  // (Ported, thread re-anchor, Nov 5, 2026: the plan composes
  // on the geo-thin spine with the cast as memberUnits.)
  const plan0 = leverCompose(geoThinCast(), 2400, { memberUnits: cands });
  const tc = rm.assessThreadCarried(plan0);
  assert.equal(tc.active, true);
  const runStarted = async threadCarried => {
    const p = {
      ...rm.seatWovenMembers(plan0, cands, { heardKeys: new Set(), maxMembers: tc.memberCap, threadCarried: true }),
      threadCarried,
      fetchStats: null,
    };
    const events = [];
    const runner = new rp.RoutePlanRunner({
      audio: new RealFakeAudio(250),
      synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
      onEvent: (t, payload) => events.push({ t, p: payload }),
      onStoryHeard: () => {},
    });
    await runner.start(p);
    runner.endTour();
    return events.find(e => e.t === 'route_plan_started');
  };
  const withMode = await runStarted(tc);
  assert.deepEqual(withMode.p.decisions.thread_carried, {
    active: true,
    // (Ported: the geo-thin spine sounds, so the fraction is
    // the assessment's own — above zero, below the floor —
    // filed at the payload's standing 3-decimal rounding.)
    geo_coverage_fraction: Math.round(tc.geoCoverageFraction * 1000) / 1000,
    member_cap: 8,
  });
  assert.ok(tc.geoCoverageFraction > 0 && tc.geoCoverageFraction < rm.THREAD_CARRIED_FLOOR);
  const without = await runStarted(null);
  assert.equal(without.p.decisions.thread_carried, null, 'an unassessed plan files null — one telemetry shape');
});

checkAsync('choice telemetry: route_plan_started decisions carry the route_choice record (Nov 5, 2026)', async () => {
  const plan0 = rm.composeRoutePlan(
    [unit('s1|landmark_origin', 32.71), unit('s2|landmark_origin', 32.78), unit('s3|landmark_origin', 32.86)],
    path,
    dest,
    'Dest',
    { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] },
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000 },
  );
  const runStarted = async routeChoice => {
    const p = { ...plan0, routeChoice, fetchStats: null };
    const events = [];
    const runner = new rp.RoutePlanRunner({
      audio: new RealFakeAudio(250),
      synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
      onEvent: (t, payload) => events.push({ t, p: payload }),
      onStoryHeard: () => {},
    });
    // The App's lifecycle: prime (Build tap) → stage (the
    // manifest hold) → beginStaged (Start tap); the
    // plan-started record files when playback begins.
    runner.prime();
    await runner.stage(p);
    runner.beginStaged();
    await until(() => events.some(e => e.t === 'route_plan_started'), 'route_plan_started');
    const started = events.find(e => e.t === 'route_plan_started');
    runner.endTour();
    return started;
  };
  const picked = await runStarted({
    offered: [
      { description: 'I-5 N', durationSec: 1440, distanceMeters: 25750, routeLabels: ['DEFAULT_ROUTE'] },
      { description: null, durationSec: 1620, distanceMeters: 27350, routeLabels: [] },
    ],
    pickerShown: true,
    pickedIndex: 1,
  });
  assert.deepEqual(picked.p.decisions.route_choice, {
    offered: [
      { description: 'I-5 N', duration_sec: 1440, distance_m: 25750, route_labels: ['DEFAULT_ROUTE'] },
      { description: null, duration_sec: 1620, distance_m: 27350, route_labels: [] },
    ],
    picker_shown: true,
    picked_index: 1,
  });
  const none = await runStarted(null);
  assert.equal(none.p.decisions.route_choice, null, 'a plan with no record files null — one telemetry shape');
});

check('carried framing: the preview text and the manifest card name the quiet road — and only in mode', () => {
  const ctx = {
    threadTopic: WT,
    destinationName: 'Dest',
    storyCount: 8,
    closingSubject: 'Carried 1',
    climaxSubject: 'Carried 1',
    climaxMode: 'thread',
  };
  const carriedText = rn.previewTextFor({ ...ctx, threadCarried: true });
  assert.ok(carriedText.includes("road's quiet today"), carriedText);
  assert.ok(carriedText.includes(WT), 'the carried preview names the thread');
  assert.ok(!rn.previewTextFor(ctx).includes('quiet'), 'the standard thread preview is unchanged without the flag');
  const cands = carriedCands();
  // (Ported, thread re-anchor, Nov 5, 2026: the plan composes
  // on the geo-thin spine with the cast as memberUnits.)
  const plan0 = leverCompose(geoThinCast(), 2400, { memberUnits: cands });
  const tc = rm.assessThreadCarried(plan0);
  const carried = {
    ...rm.seatWovenMembers(plan0, cands, { heardKeys: new Set(), maxMembers: tc.memberCap, threadCarried: true }),
    threadCarried: tc,
  };
  const card = mf.buildManifest(carried, new Set(), { originName: 'Origin' });
  assert.ok(card.threadLine?.includes('quiet'), card.threadLine);
  const plainCard = mf.buildManifest(plan0, new Set(), { originName: 'Origin' });
  assert.equal(plainCard.threadLine, `One thread all the way — ${mf.threadTitle(WT)}`, 'the card’s standard thread line is unchanged without the mode');
});

check('carried no-op: without eligibility the mode cannot engage, however silent the road', () => {
  const units = [300, 280, 260].map((d, i) =>
    unit(`n${i + 1}|landmark_history`, 32.0, {
      lng: -117.05,
      topics: [WT],
      durationSec: d,
      wovenEligible: false,
      placeName: `Bound ${i + 1}`,
    }),
  );
  const plan = leverCompose(units, 2400);
  assert.equal(plan.thread, null, 'ineligible units are not thread support');
  const tc = rm.assessThreadCarried(plan);
  assert.equal(tc.geoCoverageFraction, 0);
  assert.equal(tc.active, false, 'no thread → no mode, even at zero coverage');
  const same = rm.seatWovenMembers(plan, units, { heardKeys: new Set(), threadCarried: true, maxMembers: tc.memberCap });
  assert.equal(same, plan, 'the carried pass returns the plan untouched');
});

// ---- episode capture (Nov 4, 2026) ----
// The plan/outcome rows that carry an episode's full text to
// route_episodes for offline analysis. Assembly is pure
// (episodeCapture.ts, bundled here); the runner suites drive
// the real runner with the capture deps wired; the backend
// suite proves the send is inert without a configured
// backend. No live calls anywhere: inserts are stubs or the
// unconfigured no-op.
const ecOut = join(mkdtempSync(join(tmpdir(), 'episode-capture-')), 'episodeCapture.mjs');
execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'esbuild'),
  [
    join(repoRoot, 'src', 'core', 'episodeCapture.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    `--outfile=${ecOut}`,
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
);
const ec = await import(pathToFileURL(ecOut).href);

const beOut = join(mkdtempSync(join(tmpdir(), 'backend-')), 'backend.mjs');
execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'esbuild'),
  [
    join(repoRoot, 'src', 'core', 'backend.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--define:import.meta.env={}',
    "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    `--outfile=${beOut}`,
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
);
const be = await import(pathToFileURL(beOut).href);

const captureCtx = {
  declaredMode: 'driving',
  destinationText: 'Dest',
  tone: null,
  topics: [],
  stageTimingsMs: { geocode: 120, routes: 340, maps: 510, compose: 4200, recording: 9800, total: 14510 },
  settledAtMs: 1762000000000,
};

check('capture: plan payload covers every item kind with full texts', () => {
  const storyUnit = unit('s1|landmark_origin', 32.71);
  const wovenUnit = unit('w1|landmark_history', 32.8);
  const items = [
    { kind: 'preview', id: 'preview', label: 'Preview', durationSec: 20, text: 'PREVIEW TEXT', ready: true },
    { kind: 'story', id: storyUnit.id, label: 'S1', durationSec: 100, unit: storyUnit, ready: true, anchorProgress: 0.1, releaseProgress: 0.1, expireProgress: 0.3 },
    { kind: 'story', id: 'n1|neighborhood_intro', label: 'N1', durationSec: 60, unit: unit('n1|neighborhood_intro', 32.75, { angle: 'neighborhood_intro' }), ready: true },
    { kind: 'story', id: 'g1|landmark_origin', label: 'G1', durationSec: 90, unit: unit('g1|landmark_origin', 32.77, { audioPath: 'library/g1/landmark_origin-route-gap-v1.wav' }), ready: true },
    { kind: 'story', id: wovenUnit.id, label: 'W1', durationSec: 110, unit: wovenUnit, ready: true, woven: true, anchorProgress: 0.5 },
    { kind: 'story', id: 'c1|landmark_event', label: 'C1', durationSec: 130, unit: unit('c1|landmark_event', 32.85, { angle: 'landmark_event' }), ready: true, climax: true },
    { kind: 'filler', id: 'f1|filler_hosted', label: 'F1', durationSec: 15, unit: unit('f1|filler_hosted', 32.86, { angle: 'filler_hosted' }), ready: true },
    { kind: 'bridge', id: 'bridge-1', label: 'Bridge', durationSec: 8, text: 'BRIDGE TEXT', prevUnitId: storyUnit.id, nextUnitId: wovenUnit.id, ready: true },
    { kind: 'reaction', id: 'reaction-1', label: 'Reaction', durationSec: 5, text: 'REACTION TEXT', ready: true },
  ];
  const plan = {
    destinationName: 'Dest',
    destination: dest,
    path,
    driveSec: 1000,
    budgetSec: 1000,
    items,
    wrapUp: { text: 'WRAP TEXT', audioUrl: 'blob:wrap' },
  };
  const renderedIds = new Set(items.filter(i => i.id !== 'reaction-1').map(i => i.id));
  const sentinel = { destination: 'Dest', decisions: { thread: null } };
  const payload = ec.assemblePlanCapture({
    tourId: 'route-1',
    buildId: 'fresh-test',
    context: captureCtx,
    plan,
    routePlanStarted: sentinel,
    items: ec.assemblePlanItems(plan, renderedIds),
  });
  assert.equal(payload.route_plan_started, sentinel, 'the decisions object rides verbatim (identity, not reconstruction)');
  assert.equal(payload.mode, 'driving');
  assert.equal(payload.budget_sec, 1000);
  assert.equal(payload.route_duration_sec, 1000);
  assert.ok(payload.route_distance_m > 20000, 'path length computed from the route path');
  assert.deepEqual(
    payload.items.map(i => i.kind),
    ['preview', 'story', 'intro', 'gap_fill', 'story', 'story', 'filler', 'bridge', 'bridge', 'wrap_up'],
    'normalized kinds in plan order, wrap-up trailing',
  );
  const byKind = k => payload.items.find(i => i.kind === k);
  assert.equal(byKind('preview').text, 'PREVIEW TEXT');
  assert.equal(byKind('preview').textSource, 'live');
  assert.equal(byKind('story').text, storyUnit.storyText, 'library text verbatim as served');
  assert.equal(byKind('story').textSource, 'library');
  assert.equal(byKind('story').windowStartSec, 100, 'window = release × driveSec (soundingSpans model)');
  assert.equal(byKind('story').windowEndSec, 300, 'window end = expire × driveSec');
  assert.equal(payload.items[2].kind, 'intro', 'neighborhood-intro angle → intro');
  assert.equal(payload.items[3].kind, 'gap_fill', '-route-gap-v1 audio key → gap_fill');
  assert.equal(payload.items[4].woven, true);
  assert.equal(payload.items[4].windowStartSec, 500, 'windowless member sounds at its seated anchor (soundingSpans model)');
  assert.equal(payload.items[4].windowEndSec, 610, 'anchor + its duration');
  assert.equal(byKind('preview').windowStartSec, null, 'tissue sounds by plan order, not by ground — no window');
  assert.equal(payload.items[5].climax, true);
  const bridge = payload.items[7];
  assert.equal(bridge.text, 'BRIDGE TEXT');
  assert.equal(bridge.fromSubject, 's1|landmark_origin', 'bridge from-subject resolved from prevUnitId');
  assert.equal(bridge.toSubject, 'w1|landmark_history', 'bridge to-subject resolved from nextUnitId');
  const reaction = payload.items[8];
  assert.equal(reaction.planKind, 'reaction', 'verbatim plan kind preserved under the normalized kind');
  assert.equal(reaction.rendered, false, 'render failure is visible in the plan row');
  const wrap = payload.items[9];
  assert.equal(wrap.text, 'WRAP TEXT');
  assert.equal(wrap.conditional, 'arrival-plan-ran-out');
  assert.equal(payload.items[1].sequenceStartSec, 20, 'sequence position accumulates durations');
  assert.equal(payload.stage_timings_ms.total, 14510);
  const passenger = ec.assemblePlanCapture({
    tourId: 'route-2',
    buildId: 'fresh-test',
    context: { ...captureCtx, declaredMode: 'passenger' },
    plan,
    routePlanStarted: sentinel,
    items: [],
  });
  assert.equal(passenger.mode, 'passenger-walking', 'passenger maps to the spec vocabulary');
});

check('capture: plan payload — the route-choice record files verbatim, defaults when absent (Nov 5, 2026)', () => {
  const plan = { destinationName: 'Dest', destination: dest, path, driveSec: 1000, budgetSec: 1000, items: [], wrapUp: null };
  const base = { tourId: 'route-1', buildId: 'fresh-test', context: captureCtx, routePlanStarted: null, items: [] };
  const plain = ec.assemblePlanCapture({ ...base, plan });
  assert.deepEqual(plain.route_alternatives_offered, [], 'no record → no offered roads filed');
  assert.equal(plain.route_picker_shown, false);
  assert.equal(plain.route_picked_index, 0);
  const chosen = ec.assemblePlanCapture({
    ...base,
    plan: {
      ...plan,
      routeChoice: {
        offered: [
          { description: 'I-5 N', durationSec: 1440, distanceMeters: 25750, routeLabels: ['DEFAULT_ROUTE'] },
          { description: 'I-805 N', durationSec: 1620, distanceMeters: 27350, routeLabels: ['DEFAULT_ROUTE_ALTERNATE'] },
        ],
        pickerShown: true,
        pickedIndex: 1,
      },
    },
  });
  assert.deepEqual(chosen.route_alternatives_offered, [
    { description: 'I-5 N', duration_sec: 1440, distance_m: 25750, route_labels: ['DEFAULT_ROUTE'] },
    { description: 'I-805 N', duration_sec: 1620, distance_m: 27350, route_labels: ['DEFAULT_ROUTE_ALTERNATE'] },
  ]);
  assert.equal(chosen.route_picker_shown, true);
  assert.equal(chosen.route_picked_index, 1, 'the index names the road the episode composed on');
});

check('capture: outcome assembly — played order, drop reasons, driven discriminator', () => {
  const acc = {
    endReason: 'arrival-owed',
    begun: true,
    planItemIds: ['i0', 'i1', 'i2', 'i3', 'i4', 'i5', 'i6'],
    playedItemIds: ['i0', 'i2'],
    settledUnplayed: new Map([['i1', { skipped: true }]]),
    droppedStaleItemIds: new Set(['i3']),
    gateSkippedItemIds: new Set(['i4']),
    unrenderedItemIds: new Set(['i5']),
    heardUnitIds: ['u0', 'u2'],
    maxDisplacementM: 40,
    maxProgressFraction: 0.5,
    pathLengthM: 10000,
    endedAtMs: 1762000100000,
  };
  const out = ec.assembleOutcomeCapture('route-1', 'fresh-test', acc);
  assert.deepEqual(out.played, [0, 2], 'played as plan indexes, in sounding order');
  assert.deepEqual(
    out.dropped.map(d => `${d.index}:${d.reason}`),
    ['1:skipped', '3:stale-window', '4:parent-dropped', '5:render-failed', '6:unplayed'],
    'every unplayed item carries its reason, in plan order',
  );
  assert.equal(out.driven, false, 'a stationary test stays under the displacement floor');
  assert.equal(out.distance_along_route_m, 5000, 'progress fraction × path length');
  const driven = ec.assembleOutcomeCapture('route-1', 'fresh-test', { ...acc, maxDisplacementM: 450 });
  assert.equal(driven.driven, true, 'a real drive clears the displacement floor');
});

await checkAsync('capture: deliver never throws — insert false, insert throw, insert success', async () => {
  const row = { tourId: 'route-1', kind: 'plan', buildId: 'fresh-test', payload: {} };
  let failures = 0;
  const onFailure = () => {
    failures += 1;
  };
  await ec.deliverEpisodeCapture({ insert: async () => false, row, onFailure });
  assert.equal(failures, 1, 'a missing-table insert (resolved false) files exactly one failure signal');
  await ec.deliverEpisodeCapture({
    insert: async () => {
      throw new Error('network down');
    },
    row,
    onFailure,
  });
  assert.equal(failures, 2, 'a throwing insert is swallowed and still signals once');
  await ec.deliverEpisodeCapture({ insert: async () => true, row, onFailure });
  assert.equal(failures, 2, 'a landed insert signals nothing');
});

await checkAsync('capture: unconfigured backend insert is an inert no-op', async () => {
  const ok = await be.captureRouteEpisode({ tourId: 'route-1', kind: 'plan', buildId: 'fresh-test', payload: {} });
  assert.equal(ok, false, 'no configured backend → nothing lands, nothing throws, no network attempted');
});

await checkAsync('capture: plan row assembles at settle without the tour ever starting', async () => {
  const outcomes = [];
  const runner = new rp.RoutePlanRunner({
    audio: new RealFakeAudio(),
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    episodeIds: { tourId: 'route-capture-1', buildId: 'fresh-test' },
    onEpisodeOutcome: p => outcomes.push(p),
    onEvent: () => {},
  });
  const plan = qaPlan();
  await runner.stage(plan);
  const cap = runner.episodePlanCapture(captureCtx);
  assert.ok(cap, 'capture assembles at settle (the manifest hold)');
  assert.equal(cap.tour_id, 'route-capture-1');
  assert.equal(cap.items.length, plan.items.length, 'no wrap-up was authored for this plan, so no pseudo-item');
  assert.equal(cap.items[0].kind, 'preview', 'the preview item opens the captured episode');
  const story = cap.items.find(i => i.kind === 'story');
  assert.ok(story && story.text && story.text.length > 100, 'story texts ride in full');
  assert.ok(cap.route_plan_started.decisions, 'the decisions record rides verbatim');
  assert.equal(outcomes.length, 0, 'no outcome before any close path runs');
  runner.endTour();
  const bare = new rp.RoutePlanRunner({ audio: new RealFakeAudio(), synthUrl: async () => 'blob:x' });
  await bare.stage(qaPlan());
  assert.equal(bare.episodePlanCapture(captureCtx), null, 'no episodeIds → capture is not wired, by construction');
  bare.endTour();
});

await checkAsync('capture: outcome at arrival close — played, stale drop, heard, once only', async () => {
  const outcomes = [];
  const events = [];
  const runner = new rp.RoutePlanRunner({
    audio: new RealFakeAudio(),
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onStoryHeard: () => {},
    onEvent: (kind, payload) => events.push({ kind, payload }),
    episodeIds: { tourId: 'route-capture-2', buildId: 'fresh-test' },
    onEpisodeOutcome: p => outcomes.push(p),
  });
  const plan = anchorPlan();
  const aItem = plan.items.find(i => i.unit?.id === 'a|landmark_origin');
  const bItem = plan.items.find(i => i.unit?.id === 'b|landmark_origin');
  await runner.start(plan);
  runner.onPosition({ lat: 32.8, lng: -117.25 }); // progress ≈ 0.475 — past B's window end
  await until(() => events.some(e => e.kind === 'story_dropped' && e.payload.subject === 'b|landmark_origin'), 'stale drop event for the outrun story');
  runner.onPosition({ lat: 32.9, lng: -117.25 }); // arrival
  await until(() => runner.view().closeoutDone, 'arrival closeout completed');
  assert.equal(outcomes.length, 1, 'outcome filed exactly once at close');
  const out = outcomes[0];
  assert.equal(out.end_reason, 'arrival-owed');
  assert.equal(out.begun, true);
  assert.equal(out.tour_id, 'route-capture-2');
  const bDrop = out.dropped.find(d => d.id === bItem.id);
  assert.ok(bDrop && bDrop.reason === 'stale-window', `the outrun story's drop is named (dropped: ${JSON.stringify(out.dropped)})`);
  assert.ok(out.played_item_ids.includes(aItem.id), 'the departure story is in the played list (sounded or sounding-at-close)');
  assert.ok(out.heard_unit_ids.includes('a|landmark_origin'), 'the heard list carries the departure unit');
  runner.endTour();
  assert.equal(outcomes.length, 1, 'an End Tour after the closeout files nothing twice');
});

await checkAsync('capture: user end on a staged, never-begun plan files a user-ended outcome', async () => {
  const outcomes = [];
  const runner = new rp.RoutePlanRunner({
    audio: new RealFakeAudio(),
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    episodeIds: { tourId: 'route-capture-3', buildId: 'fresh-test' },
    onEpisodeOutcome: p => outcomes.push(p),
    onEvent: () => {},
  });
  const plan = qaPlan();
  await runner.stage(plan);
  runner.endTour();
  assert.equal(outcomes.length, 1);
  const out = outcomes[0];
  assert.equal(out.end_reason, 'user-ended');
  assert.equal(out.begun, false, 'backed out of the card: the tour never began');
  assert.deepEqual(out.played, [], 'nothing played');
  assert.equal(out.dropped.length, plan.items.length, 'every item accounted for');
  assert.ok(out.dropped.every(d => d.reason === 'unplayed'), 'rendered but never fed → unplayed');
  assert.equal(out.driven, false);
});

await checkAsync('capture: a throwing outcome dep leaves the tour identical', async () => {
  const runner = new rp.RoutePlanRunner({
    audio: new RealFakeAudio(),
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
    onStoryHeard: () => {},
    onEvent: () => {},
    episodeIds: { tourId: 'route-capture-4', buildId: 'fresh-test' },
    onEpisodeOutcome: () => {
      throw new Error('capture sink exploded');
    },
  });
  await runner.start(anchorPlan());
  runner.onPosition({ lat: 32.9, lng: -117.25 }); // arrival
  await until(() => runner.view().closeoutDone, 'arrival closeout completed despite the throwing capture dep');
  assert.equal(runner.view().endedKind, 'arrival-owed', 'the closeout completed exactly as without capture');
});

// ---- render-ahead pipeline (Nov 4, 2026) ----
// Erik's latency ruling: Start flips when the OPENING settles
// (spoken preview + first bridge + departure story); the rest
// renders through a bounded-concurrency queue in plan order,
// starting at plan-fix, and playback never stalls for a late
// piece. These suites drive the real runner with gated synth
// stubs — no live calls anywhere.
const verifier = await import(pathToFileURL(join(here, 'verify-episode-capture.mjs')).href);
const pipePlan = () =>
  rm.composeRoutePlan(
    [unit('a|landmark_origin', 32.71), unit('b|landmark_origin', 32.76), unit('c|landmark_origin', 32.81), unit('d|landmark_origin', 32.86)],
    densePath,
    denseDest,
    'Dest',
    noTopics,
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 2000 },
  );
const tissueOf = plan => plan.items.filter(i => i.kind === 'preview' || i.kind === 'bridge' || i.kind === 'reaction');
const makeGate = () => {
  let resolve;
  const promise = new Promise(r => {
    resolve = r;
  });
  return { promise, resolve };
};
const withTimeout = (p, ms, what) =>
  Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${what}`)), ms)),
  ]);

await checkAsync('pipeline: opening-settle gate — Start readiness needs the preview + first bridge, NOT later pieces', async () => {
  const plan = pipePlan();
  const tissue = tissueOf(plan);
  assert.ok(tissue.length >= 3, `fixture needs preview + 2 bridges, got ${tissue.length} tissue pieces`);
  const gates = new Map(tissue.map(i => [i.text, makeGate()]));
  const started = [];
  const runner = new rp.RoutePlanRunner({
    audio: new RealFakeAudio(250),
    synthUrl: t => {
      started.push(t);
      const g = gates.get(t);
      return g ? g.promise.then(() => 'blob:audio/' + encodeURIComponent(t.slice(0, 16))) : Promise.resolve('blob:audio/x');
    },
    onEvent: () => {},
  });
  let staged = false;
  const staging = runner.stage(plan).then(() => {
    staged = true;
  });
  await new Promise(r => setTimeout(r, 200));
  assert.equal(staged, false, 'stage must not resolve while the opening is still rendering');
  assert.equal(runner.view().narrationReady, false);
  // Release exactly the opening's tissue: the preview + the first bridge.
  gates.get(tissue[0].text).resolve();
  gates.get(tissue[1].text).resolve();
  await withTimeout(staging, 4000, 'stage resolves at the opening settle');
  assert.equal(runner.view().narrationReady, true, 'readiness flipped on the opening alone');
  assert.deepEqual(
    rp.routeStartButtonState(runner.view()),
    { label: 'Start tour', disabled: false },
    'the Start button enables while later pieces are still rendering',
  );
  assert.ok(started.includes(tissue[2].text), 'the queue already reached the third piece (render-ahead, not render-on-demand)');
  for (const g of gates.values()) g.resolve();
  runner.beginStaged();
  await until(() => runner.view().phase === 'playing' || runner.view().phase === 'awaiting', 'tour begins after the gated opening');
  runner.endTour();
});

await checkAsync('pipeline: queue order is plan order under concurrency — bound never exceeded, no piece rendered twice', async () => {
  const plan = pipePlan();
  plan.wrapUp = { text: 'WRAPUP: the whole drive, tied off.', audioUrl: null };
  const tissue = tissueOf(plan);
  const starts = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let completed = 0;
  const track = async t => {
    starts.push(t);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(r => setTimeout(r, 25));
    inFlight -= 1;
    completed += 1;
    return 'blob:audio/' + encodeURIComponent(t.slice(0, 16));
  };
  const runner = new rp.RoutePlanRunner({
    audio: new RealFakeAudio(250),
    synthUrl: track,
    synthFinishedUrl: async t => {
      const url = await track(t);
      return url.replace('blob:audio/', 'blob:wrap/');
    },
    onEvent: () => {},
  });
  await runner.stage(plan);
  const expectedTotal = tissue.length + 1; // tissue + the wrap-up queue item
  await until(() => completed === expectedTotal, 'the whole queue drains during the manifest hold');
  assert.equal(rp.RENDER_CONCURRENCY, 3, 'the concurrency bound is 3');
  assert.ok(maxInFlight <= rp.RENDER_CONCURRENCY, `in-flight peak ${maxInFlight} exceeded the bound`);
  assert.ok(maxInFlight >= 2, `in-flight peak ${maxInFlight}: renders actually overlapped`);
  assert.deepEqual(
    starts,
    [...tissue.map(i => i.text), plan.wrapUp.text],
    'pieces started strictly in plan order, the wrap-up last',
  );
  assert.equal(new Set(starts).size, starts.length, 'no piece was rendered twice');
  runner.endTour();
});

await checkAsync('pipeline: the queue runs while the manifest sits untapped', async () => {
  const plan = pipePlan();
  const tissue = tissueOf(plan);
  let completed = 0;
  const audio = new RealFakeAudio(250);
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => {
      await new Promise(r => setTimeout(r, 10));
      completed += 1;
      return 'blob:audio/' + encodeURIComponent(t.slice(0, 16));
    },
    onEvent: () => {},
  });
  await runner.stage(plan);
  await until(() => completed === tissue.length, 'every piece rendered behind the untapped card');
  assert.equal(audio.played.length, 0, 'nothing sounded while the card sat untapped');
  assert.equal(runner.view().phase, 'ready', 'the hold is intact: rendered, staged, silent');
  runner.beginStaged();
  await until(() => audio.played.length > 0, 'the tour sounds on the Start tap');
  runner.endTour();
});

await checkAsync('pipeline: late bridge — the story sounds without it, the skip is recorded + telemetered, no stall', async () => {
  const plan = pipePlan();
  const cItem = plan.items.find(i => i.unit?.id === 'c|landmark_origin');
  const lateBridge = plan.items.find(i => i.kind === 'bridge' && i.nextUnitId === 'c|landmark_origin');
  assert.ok(lateBridge, 'fixture has a bridge into story c');
  const gate = makeGate();
  const events = [];
  const heard = [];
  const outcomes = [];
  const audio = new RealFakeAudio(250);
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: t =>
      t === lateBridge.text
        ? gate.promise.then(() => 'blob:audio/late-bridge')
        : Promise.resolve('blob:audio/' + encodeURIComponent(t.slice(0, 16))),
    onStoryHeard: u => heard.push(u.id),
    onEvent: (t, p) => events.push({ t, p }),
    episodeIds: { tourId: 'route-pipeline-late', buildId: 'fresh-test' },
    onEpisodeOutcome: p => outcomes.push(p),
  });
  await withTimeout(runner.start(plan), 4000, 'start resolves at the opening settle (the gated bridge is not in the opening)');
  await until(() => heard.includes('a|landmark_origin'), 'story a sounded');
  runner.onPosition({ lat: 32.76, lng: -117.25 });
  await until(() => heard.includes('b|landmark_origin'), 'story b sounded');
  runner.onPosition({ lat: 32.81, lng: -117.25 });
  await until(() => heard.includes('c|landmark_origin'), 'story c sounded WITHOUT its bridge');
  const late = events.filter(e => e.t === 'route_render_late');
  assert.equal(late.length, 1, 'exactly one late-skip was telemetered');
  assert.equal(late[0].p.item_id, lateBridge.id);
  assert.equal(late[0].p.kind, 'bridge');
  assert.equal(typeof late[0].p.ms_since_plan_fix, 'number', 'the event says how long the queue had been running');
  assert.equal(typeof late[0].p.in_flight, 'number', 'the event says what was in flight at the skip');
  assert.equal(typeof late[0].p.queued, 'number', 'the event says how much work was still queued');
  assert.ok(!audio.played.includes('blob:audio/late-bridge'), 'the late bridge never sounded');
  gate.resolve(); // the render completes after its moment: it must be discarded, never fed late
  await new Promise(r => setTimeout(r, 120));
  assert.ok(!audio.played.includes('blob:audio/late-bridge'), 'the completed-late render was discarded, not fed');
  runner.endTour();
  assert.equal(outcomes.length, 1);
  const out = outcomes[0];
  const rr = out.render_results.find(r => r.id === lateBridge.id);
  assert.ok(rr && rr.result === 'skipped-late', `capture render verdict is skipped-late (got ${JSON.stringify(rr)})`);
  const drop = out.dropped.find(d => d.id === lateBridge.id);
  assert.ok(drop && drop.reason === 'skipped-late', `capture drop reason is skipped-late (got ${JSON.stringify(drop)})`);
  assert.ok(out.played_item_ids.includes(cItem.id), 'story c is recorded as played');
});

await checkAsync('pipeline: wrap-up renders mid-tour as a queue item; its failure falls back to the standing closeout', async () => {
  // Mid-tour render, gated so it can only complete after the tour begins.
  {
    const plan = wrapPlan();
    plan.wrapUp = { text: 'WRAPUP: the whole drive, tied off.', audioUrl: null };
    const gate = makeGate();
    const events = [];
    const synthTexts = [];
    const audio = new RealFakeAudio(250);
    const runner = new rp.RoutePlanRunner({
      audio,
      synthUrl: async t => {
        synthTexts.push(t);
        return 'blob:audio/' + encodeURIComponent(t.slice(0, 16));
      },
      synthFinishedUrl: t => gate.promise.then(() => 'blob:wrapup-rendered'),
      onEvent: (t, p) => events.push({ t, p }),
    });
    await runner.start(plan);
    assert.equal(events.filter(e => e.t === 'route_wrap_up' && e.p.wrap_up === 'generated').length, 0, 'not rendered before its queue turn completes');
    gate.resolve();
    await until(() => events.some(e => e.t === 'route_wrap_up' && e.p.wrap_up === 'generated'), 'wrap-up rendered mid-tour');
    await until(() => audio.played.some(u => u.includes('a%7Clandmark_origin')), 'first story on the element');
    runner.onPosition({ lat: 32.78, lng: -117.25 });
    await until(() => audio.played.some(u => u.includes('b%7Clandmark_origin')), 'second story on the element');
    runner.onPosition({ lat: 32.87, lng: -117.25 });
    await until(() => audio.played.some(u => u.includes('c%7Clandmark_origin')), 'final story on the element');
    runner.onPosition(denseDest); // arrival with the plan run out
    await until(() => runner.view().closeoutDone, 'arrival closeout');
    assert.ok(audio.played.includes('blob:wrapup-rendered'), 'the queue-rendered wrap-up played as the closing piece');
    assert.ok(!synthTexts.some(t => t.includes("that's our stop")), "today's closeout line was never synthesized");
    assert.equal(events.filter(e => e.t === 'route_wrap_up' && e.p.wrap_up === 'played').length, 1);
    runner.endTour();
  }
  // Failure variant: the wrap render throws → the standing closeout speaks.
  {
    const plan = wrapPlan();
    plan.wrapUp = { text: 'WRAPUP: the whole drive, tied off.', audioUrl: null };
    const events = [];
    const synthTexts = [];
    const audio = new RealFakeAudio(250);
    const runner = new rp.RoutePlanRunner({
      audio,
      synthUrl: async t => {
        synthTexts.push(t);
        return 'blob:audio/' + encodeURIComponent(t.slice(0, 16));
      },
      synthFinishedUrl: async () => {
        throw new Error('wrap synthesis down');
      },
      onEvent: (t, p) => events.push({ t, p }),
    });
    await runner.start(plan);
    await until(() => events.some(e => e.t === 'route_wrap_up' && e.p.wrap_up === 'failed'), 'wrap-up failure telemetered');
    await until(() => audio.played.some(u => u.includes('a%7Clandmark_origin')), 'first story on the element');
    runner.onPosition({ lat: 32.78, lng: -117.25 });
    await until(() => audio.played.some(u => u.includes('b%7Clandmark_origin')), 'second story on the element');
    runner.onPosition({ lat: 32.87, lng: -117.25 });
    await until(() => audio.played.some(u => u.includes('c%7Clandmark_origin')), 'final story on the element');
    runner.onPosition(denseDest);
    await until(() => runner.view().closeoutDone, 'arrival closeout');
    assert.ok(synthTexts.some(t => t.includes("that's our stop")), "today's closeout line carried the finish after the wrap failure");
    assert.equal(events.filter(e => e.t === 'route_wrap_up' && e.p.wrap_up === 'played').length, 0, 'a failed wrap-up never claims played');
    runner.endTour();
  }
});

await checkAsync('pipeline: a mid-tour render failure degrades per-piece — never a build-failure state', async () => {
  const plan = pipePlan();
  const badBridge = plan.items.find(i => i.kind === 'bridge' && i.nextUnitId === 'c|landmark_origin');
  assert.ok(badBridge, 'fixture has a bridge into story c');
  const events = [];
  const heard = [];
  const outcomes = [];
  const runner = new rp.RoutePlanRunner({
    audio: new RealFakeAudio(250),
    synthUrl: async t => {
      if (t === badBridge.text) throw new Error('synthesis down for one bridge');
      return 'blob:audio/' + encodeURIComponent(t.slice(0, 16));
    },
    onStoryHeard: u => heard.push(u.id),
    onEvent: (t, p) => events.push({ t, p }),
    episodeIds: { tourId: 'route-pipeline-fail', buildId: 'fresh-test' },
    onEpisodeOutcome: p => outcomes.push(p),
  });
  await withTimeout(runner.start(plan), 4000, 'start resolves despite the doomed bridge (it is past the opening)');
  await until(() => heard.includes('a|landmark_origin'), 'story a sounded');
  runner.onPosition({ lat: 32.76, lng: -117.25 });
  await until(() => heard.includes('b|landmark_origin'), 'story b sounded');
  runner.onPosition({ lat: 32.81, lng: -117.25 });
  await until(() => heard.includes('c|landmark_origin'), 'story c sounded without its failed bridge');
  assert.equal(events.filter(e => e.t === 'route_build_failed').length, 0, 'no build-failure event from a mid-tour render failure');
  assert.equal(events.filter(e => e.t === 'route_render_late').length, 0, 'a failed render is not misreported as a late skip');
  runner.endTour();
  const out = outcomes[0];
  const rr = out.render_results.find(r => r.id === badBridge.id);
  assert.ok(rr && rr.result === 'failed', `capture render verdict is failed (got ${JSON.stringify(rr)})`);
  const drop = out.dropped.find(d => d.id === badBridge.id);
  assert.ok(drop && drop.reason === 'render-failed', `capture drop reason is render-failed (got ${JSON.stringify(drop)})`);
});

await checkAsync('pipeline: capture rows stay complete under pipelining — every text at settle, per-item verdicts at close', async () => {
  const plan = pipePlan();
  plan.wrapUp = { text: 'WRAPUP: the whole drive, tied off.', audioUrl: null };
  const bridges = plan.items.filter(i => i.kind === 'bridge');
  const failedBridge = bridges.find(b => b.nextUnitId === 'b|landmark_origin') ?? bridges[0];
  const lastBridge = bridges[bridges.length - 1];
  const lastGate = makeGate();
  const wrapGate = makeGate();
  const events = [];
  const heard = [];
  const outcomes = [];
  const runner = new rp.RoutePlanRunner({
    audio: new RealFakeAudio(250),
    synthUrl: t => {
      if (t === failedBridge.text) return Promise.reject(new Error('one bridge fails'));
      if (t === lastBridge.text) return lastGate.promise.then(() => 'blob:audio/last-bridge');
      return Promise.resolve('blob:audio/' + encodeURIComponent(t.slice(0, 16)));
    },
    synthFinishedUrl: t => wrapGate.promise.then(() => 'blob:wrap-finished'),
    onStoryHeard: u => heard.push(u.id),
    onEvent: (t, p) => events.push({ t, p }),
    episodeIds: { tourId: 'route-pipeline-capture', buildId: 'fresh-test' },
    onEpisodeOutcome: p => outcomes.push(p),
  });
  await withTimeout(runner.stage(plan), 4000, 'stage resolves at the opening settle');
  const cap = runner.episodePlanCapture(captureCtx);
  assert.ok(cap, 'plan capture assembles at opening settle');
  assert.equal(cap.schema, 2, 'the plan row is schema 2');
  assert.equal(cap.items.length, plan.items.length + 1, 'every plan item plus the wrap-up pseudo-item');
  assert.ok(
    cap.items.every(i => typeof i.text === 'string' && i.text.length > 0),
    'EVERY live text is present at opening settle — only synthesis is pipelined, never text',
  );
  const wrapItem = cap.items.find(i => i.kind === 'wrap_up');
  assert.ok(wrapItem && wrapItem.text === plan.wrapUp.text, 'the wrap-up text rides the plan row');
  assert.deepEqual(verifier.validatePlan(cap), [], 'the live verifier accepts the schema-2 plan row');
  assert.deepEqual(
    verifier.validatePlan({ ...cap, schema: 1 }),
    [],
    'the verifier still accepts schema-1 (legacy) plan rows',
  );
  // Finish the wrap render during the hold → its verdict must be 'pre-start'.
  wrapGate.resolve();
  await until(() => events.some(e => e.t === 'route_wrap_up' && e.p.wrap_up === 'generated'), 'wrap rendered during the hold');
  runner.beginStaged();
  await until(() => heard.includes('a|landmark_origin'), 'story a sounded');
  lastGate.resolve(); // the last bridge renders after the tour began, before its moment → 'ahead'
  runner.onPosition({ lat: 32.76, lng: -117.25 });
  await until(() => heard.includes('b|landmark_origin'), 'story b sounded (its bridge failed; the story is load-bearing, the bridge is not)');
  runner.onPosition({ lat: 32.81, lng: -117.25 });
  await until(() => heard.includes('c|landmark_origin'), 'story c sounded');
  runner.onPosition({ lat: 32.86, lng: -117.25 });
  await until(() => heard.includes('d|landmark_origin'), 'story d sounded');
  runner.endTour();
  assert.equal(outcomes.length, 1);
  const out = outcomes[0];
  assert.equal(out.schema, 2, 'the outcome row is schema 2');
  assert.deepEqual(verifier.validateOutcome(out), [], 'the live verifier accepts the schema-2 outcome row');
  assert.deepEqual(
    verifier.validateOutcome({ schema: 1, end_reason: 'user-ended', played: [], dropped: [], driven: false }),
    [],
    'the verifier still accepts schema-1 (legacy) outcome rows',
  );
  assert.equal(out.render_results.length, plan.items.length + 1, 'a render verdict for every item plus the wrap-up');
  const byId = new Map(out.render_results.map(r => [r.id, r.result]));
  assert.equal(byId.get(failedBridge.id), 'failed', 'the failed bridge verdict');
  assert.equal(byId.get(lastBridge.id), 'ahead', 'the post-begin render verdict');
  assert.equal(byId.get('wrap-up'), 'pre-start', 'the hold-rendered wrap-up verdict');
  assert.ok(out.played_item_ids.includes(lastBridge.id), 'the ahead-rendered bridge still sounded');
  assert.equal(typeof out.render_queue_drained_ms, 'number', 'the queue drain time is recorded');
});

await checkAsync('pipeline: time-to-start anatomy — at Start readiness, later pieces have not even started rendering', async () => {
  const plan = pipePlan();
  const tissue = tissueOf(plan);
  assert.ok(tissue.length >= 4, `fixture needs at least 4 tissue pieces, got ${tissue.length}`);
  const gates = new Map(tissue.map(i => [i.text, makeGate()]));
  const started = [];
  const completed = [];
  const runner = new rp.RoutePlanRunner({
    audio: new RealFakeAudio(250),
    synthUrl: t => {
      started.push(t);
      const g = gates.get(t);
      return g
        ? g.promise.then(() => {
            completed.push(t);
            return 'blob:audio/' + encodeURIComponent(t.slice(0, 16));
          })
        : Promise.resolve('blob:audio/x');
    },
    onEvent: () => {},
  });
  let startedDone = false;
  const starting = runner.start(plan).then(() => {
    startedDone = true;
  });
  await new Promise(r => setTimeout(r, 200));
  assert.equal(startedDone, false, 'start() waits for the opening');
  gates.get(tissue[0].text).resolve(); // the preview
  gates.get(tissue[1].text).resolve(); // the first bridge
  await withTimeout(starting, 4000, 'start() resolves at the opening settle');
  assert.equal(runner.view().narrationReady, true);
  // The pre-start critical path, counted in COMPLETED renders:
  // exactly the opening's tissue — every later piece was still
  // in flight or queued when Start flipped (only the two
  // released gates could complete, so this is exact). Under
  // the old sequential settle, completed would have read ALL
  // tissue pieces here: every render sat on the path.
  assert.deepEqual(
    completed,
    [tissue[0].text, tissue[1].text],
    'exactly the opening renders completed before Start readiness',
  );
  assert.deepEqual(
    started.slice(0, rp.RENDER_CONCURRENCY),
    tissue.slice(0, rp.RENDER_CONCURRENCY).map(i => i.text),
    "the queue's first slice is the plan-order prefix",
  );
  for (const g of gates.values()) g.resolve();
  await until(() => runner.view().phase !== 'idle', 'tour underway');
  runner.endTour();
});

// ---- drop coherence (Nov 4, 2026 — adaptive slice, phase 1) ----
// Suppression: a bridge into a story that cannot start before
// its window closes (judged from the recent progress rate) is
// never fed — the story drops stale at the judgment instead of
// after a dangling lead-in. Re-bridge: either drop path
// commissions ONE replacement bridge from the last story that
// SOUNDED into the next viable story, riding the render queue
// as tissue — sounds if rendered in time, skipped late and
// discarded if not; the story never waits. All stubbed.
const latForProgress = p => 32.7 + p * 0.2;
const decodedOf = url =>
  url.startsWith('blob:audio/') ? decodeURIComponent(url.slice('blob:audio/'.length)) : url;
// A fine-grained path for the suppression suites: the
// runner's progress measure reads the nearest segment's
// midpoint, so the coarse 21-point densePath quantizes
// progress to 0.05 steps — a slow creep is invisible on it.
// Two thousand segments make one step ≈ 0.0005 of the route
// (≈11 m — a realistic GPS cadence), so a genuine small
// rate can be sampled. Windows land within ~0.001 of the
// anchorPlan geometry (B [0.365, 0.435], C [0.815, 0.885]).
const finePath = Array.from({ length: 2001 }, (_, i) => ({ lat: 32.7 + i * 0.0001, lng: -117.25 }));
const finePlan = () =>
  rm.composeRoutePlan(
    [unit('a|landmark_origin', 32.71), unit('b|landmark_origin', 32.78), unit('c|landmark_origin', 32.87)],
    finePath,
    { lat: 32.9, lng: -117.25 },
    'Dest',
    { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] },
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 2000 },
  );
// Field fix (Nov 5, 2026): the commission's head now rotates
// with the episode ledger (lane 1b), so the fingerprint is
// structural — a text that speaks from A into C and never
// names the dropped B — instead of one frozen head shape.
const isRebridgeClip = t =>
  t.includes('a|landmark_origin') && t.includes('c|landmark_origin') && !t.includes('b|landmark_origin');
const p1Runner = (audio, events, outcomes, extra = {}) =>
  new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:audio/' + encodeURIComponent(t),
    onEvent: (t, p) => events.push({ t, p }),
    ...(outcomes
      ? {
          episodeIds: { tourId: 'route-phase1', buildId: 'fresh-test' },
          onEpisodeOutcome: p => outcomes.push(p),
        }
      : {}),
    ...extra,
  });

await checkAsync('phase1 (a): fast pace — the doomed lead-in never sounds, B drops + is owed, the re-bridge A→C sounds', async () => {
  const plan = finePlan();
  const bridgeAB = plan.items.find(i => i.kind === 'bridge' && i.nextUnitId === 'b|landmark_origin');
  const bridgeBC = plan.items.find(i => i.kind === 'bridge' && i.nextUnitId === 'c|landmark_origin');
  const audio = new RealFakeAudio(250);
  const events = [];
  const outcomes = [];
  const runner = p1Runner(audio, events, outcomes);
  await runner.start(plan);
  // A sustained, continuous creep: one fine segment (≈0.0005
  // of the route) every ~200 ms ≈ 0.0025 progress/sec — slow
  // as rates go, but with story A's ~2 minutes still to play,
  // B's window (expire ≈0.435) closes long before A ends.
  // Continuous small steps: a usable speed sample, not a jump.
  let lat = 32.76; // progress ≈ 0.30
  runner.onPosition({ lat, lng: -117.25 });
  for (let i = 0; i < 40 && !events.some(e => e.t === 'story_dropped'); i++) {
    await new Promise(r => setTimeout(r, 200));
    lat += 0.0001;
    runner.onPosition({ lat, lng: -117.25 });
  }
  const drops = events.filter(e => e.t === 'story_dropped');
  assert.equal(drops.length, 1, 'exactly one story dropped');
  assert.equal(drops[0].p.subject, 'b|landmark_origin');
  assert.equal(drops[0].p.reason, 'stale-window');
  const fired = events.filter(e => e.t === 'route_rebridge_fired');
  assert.equal(fired.length, 1, 'exactly one commission');
  assert.equal(fired[0].p.via, 'suppression');
  assert.ok(
    fired[0].p.predicted_start_progress > fired[0].p.expire_progress,
    'the fired event carries the prediction that doomed B',
  );
  await until(() => events.some(e => e.t === 'route_rebridge_sounded'), 'the re-bridge sounds');
  const playedTexts = audio.played.map(decodedOf);
  assert.ok(!playedTexts.includes(bridgeAB.text), 'the composed A→B lead-in never sounded');
  assert.ok(!audio.played.some(u => u.includes('b%7Clandmark_origin.wav')), 'story B never sounded');
  const commIdx = playedTexts.findIndex(isRebridgeClip);
  assert.ok(commIdx >= 0, 'the re-bridge A→C sounded');
  runner.onPosition({ lat: 32.87, lng: -117.25 }); // progress 0.825 — inside C's window
  await until(() => audio.played.some(u => u.includes('c%7Clandmark_origin.wav')), 'story C sounds');
  assert.ok(
    audio.played.findIndex(u => u.includes('c%7Clandmark_origin.wav')) > commIdx,
    'C sounds after its re-bridge',
  );
  runner.onPosition({ lat: 32.9, lng: -117.25 }); // arrival
  await until(() => runner.view().closeoutDone, 'arrival closeout');
  assert.equal(runner.view().endedKind, 'arrival-owed');
  assert.ok(runner.view().owed && runner.view().owed.includes('b|landmark_origin'), 'the closeout owes B by name');
  await until(() => outcomes.length === 1, 'outcome filed');
  const out = outcomes[0];
  assert.deepEqual(verifier.validateOutcome(out), [], 'the live verifier accepts the phase-1 outcome row');
  assert.equal(out.commissions.length, 1);
  const comm = out.commissions[0];
  assert.equal(comm.via, 'suppression');
  assert.equal(comm.result, 'sounded');
  assert.equal(comm.for_story_id, 'b|landmark_origin');
  assert.equal(comm.prev_story_id, 'a|landmark_origin');
  assert.equal(comm.next_story_id, 'c|landmark_origin');
  assert.ok(isRebridgeClip(comm.text) && !comm.text.includes('b|landmark_origin'), 'true facts only — B is never named');
  assert.equal(out.dropped.find(d => d.id === 'b|landmark_origin')?.reason, 'stale-window');
  for (const br of [bridgeAB, bridgeBC]) {
    assert.equal(out.dropped.find(d => d.id === br.id)?.reason, 'parent-dropped', `${br.id} resolved as a dependent of the drop`);
  }
  assert.ok(
    out.render_results.every(rr => plan.items[rr.index]?.id === rr.id),
    'render verdicts keep PLAN indexes despite the dynamic commission entry',
  );
  assert.ok(!out.render_results.some(rr => rr.id === comm.id), 'the commission carries no render verdict of its own');
  assert.ok(!out.played_item_ids.includes(comm.id), 'the commission is a pseudo-item, never a played plan item');
  assert.ok(out.played_item_ids.includes('a|landmark_origin') && out.played_item_ids.includes('c|landmark_origin'));
});

await checkAsync('phase1 (b): the commission renders late — C sounds bridgeless, the commission is discarded', async () => {
  const plan = finePlan();
  const audio = new RealFakeAudio(250);
  const events = [];
  const outcomes = [];
  const gate = makeGate();
  const runner = p1Runner(audio, events, outcomes, {
    synthUrl: t =>
      isRebridgeClip(t)
        ? gate.promise.then(() => 'blob:audio/' + encodeURIComponent(t))
        : Promise.resolve('blob:audio/' + encodeURIComponent(t)),
  });
  await runner.start(plan);
  let lat = 32.76;
  runner.onPosition({ lat, lng: -117.25 });
  for (let i = 0; i < 40 && !events.some(e => e.t === 'route_rebridge_fired'); i++) {
    await new Promise(r => setTimeout(r, 200));
    lat += 0.0001;
    runner.onPosition({ lat, lng: -117.25 });
  }
  assert.equal(events.filter(e => e.t === 'route_rebridge_fired').length, 1, 'the commission was authored');
  // C's window opens while the commission is still rendering.
  runner.onPosition({ lat: 32.87, lng: -117.25 });
  await until(() => audio.played.some(u => u.includes('c%7Clandmark_origin.wav')), 'C sounds — bridgeless, never waiting');
  const late = events.filter(e => e.t === 'route_render_late');
  assert.equal(late.length, 1, 'exactly one late-skip');
  assert.equal(late[0].p.item_id, 'rebridge:b|landmark_origin>c|landmark_origin');
  const skipped = events.filter(e => e.t === 'route_rebridge_skipped');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].p.reason, 'late');
  gate.resolve(); // the render lands after its moment: discarded, never fed
  await new Promise(r => setTimeout(r, 150));
  assert.ok(!audio.played.map(decodedOf).some(isRebridgeClip), 'the late commission never sounded');
  runner.endTour();
  assert.equal(outcomes.length, 1);
  assert.deepEqual(verifier.validateOutcome(outcomes[0]), []);
  assert.equal(outcomes[0].commissions.length, 1);
  assert.equal(outcomes[0].commissions[0].result, 'skipped-late');
  assert.equal(outcomes[0].commissions[0].via, 'suppression');
});

await checkAsync('phase1 (c): a gate drop (no prediction) commissions the same repair', async () => {
  const plan = anchorPlan();
  const bridgeAB = plan.items.find(i => i.kind === 'bridge' && i.nextUnitId === 'b|landmark_origin');
  const audio = new RealFakeAudio(250);
  const events = [];
  const outcomes = [];
  const runner = p1Runner(audio, events, outcomes);
  await runner.start(plan);
  await until(() => audio.played.some(u => u.includes('a%7Clandmark_origin.wav')), 'story A sounds');
  // ONE fix, already past B's window: no rate sample exists,
  // so no suppression — the standing behavior plays out (the
  // lead-in sounds, B drops at the gate) and the commission
  // repairs the transition into C.
  runner.onPosition({ lat: 32.795, lng: -117.25 }); // progress 0.475 > B expire 0.435
  await until(() => events.some(e => e.t === 'route_rebridge_sounded'), 'the gate-drop commission sounds');
  const fired = events.filter(e => e.t === 'route_rebridge_fired');
  assert.equal(fired.length, 1);
  assert.equal(fired[0].p.via, 'gate');
  assert.equal(events.filter(e => e.t === 'story_dropped').length, 1);
  const playedTexts = audio.played.map(decodedOf);
  const abIdx = playedTexts.indexOf(bridgeAB.text);
  assert.ok(abIdx >= 0, 'the composed lead-in DID sound — no prediction, standing behavior');
  const commIdx = playedTexts.findIndex(isRebridgeClip);
  assert.ok(commIdx > abIdx, 'the re-bridge followed the lead-in it repairs after');
  runner.onPosition({ lat: 32.87, lng: -117.25 });
  await until(() => audio.played.some(u => u.includes('c%7Clandmark_origin.wav')), 'story C sounds');
  assert.ok(audio.played.findIndex(u => u.includes('c%7Clandmark_origin.wav')) > commIdx, 'C after its re-bridge');
  runner.endTour();
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].commissions.length, 1);
  assert.equal(outcomes[0].commissions[0].via, 'gate');
  assert.equal(outcomes[0].commissions[0].result, 'sounded');
});

await checkAsync('phase1 (d): no usable rate (absent, then zero intervals) — no suppression, standing behavior', async () => {
  const plan = anchorPlan();
  const bridgeAB = plan.items.find(i => i.kind === 'bridge' && i.nextUnitId === 'b|landmark_origin');
  const audio = new RealFakeAudio(250);
  const events = [];
  const runner = p1Runner(audio, events, null);
  await runner.start(plan);
  await until(() => audio.played.some(u => u.includes('a%7Clandmark_origin.wav')), 'story A sounds');
  // Into B's window (progress 0.375 ∈ [0.365, 0.435]): the
  // first fix has no predecessor (no sample at all); the
  // repeats are zero-motion intervals (a stopped driver).
  // Neither may suppress.
  for (let i = 0; i < 3; i++) {
    runner.onPosition({ lat: 32.78, lng: -117.25 });
    await new Promise(r => setTimeout(r, 70));
  }
  await until(() => audio.played.some(u => u.includes('b%7Clandmark_origin.wav')), 'story B sounds');
  assert.equal(events.filter(e => e.t === 'story_dropped').length, 0, 'nothing dropped');
  assert.equal(events.filter(e => e.t.startsWith('route_rebridge')).length, 0, 'no commission activity');
  assert.ok(audio.played.map(decodedOf).includes(bridgeAB.text), 'the lead-in sounded');
  runner.endTour();
});

await checkAsync('phase1 (e): a dropped climax earns no fabricated payoff — a plain mid re-bridge, the owed closeout carries it', async () => {
  const base = anchorPlan();
  const plan = {
    ...base,
    climaxUnitId: 'b|landmark_origin',
    climaxSubject: 'b|landmark_origin',
    climaxMode: 'late',
    items: base.items.map(i =>
      i.id === 'b|landmark_origin' ? { ...i, climax: true } : i.id === 'c|landmark_origin' ? { ...i, climax: false } : i,
    ),
  };
  const audio = new RealFakeAudio(250);
  const events = [];
  const outcomes = [];
  const runner = p1Runner(audio, events, outcomes);
  await runner.start(plan);
  await until(() => audio.played.some(u => u.includes('a%7Clandmark_origin.wav')), 'story A sounds');
  runner.onPosition({ lat: 32.795, lng: -117.25 }); // past the climax's window — gate drop
  await until(() => events.some(e => e.t === 'route_rebridge_sounded'), 'the re-bridge past the climax sounds');
  const commClip = audio.played.map(decodedOf).find(isRebridgeClip);
  assert.ok(commClip, 'a re-bridge into C sounded');
  assert.ok(!commClip.includes('here it is'), 'no payoff language for a climax that never sounded');
  assert.ok(!commClip.includes('pointed at this one'), 'no promise language either');
  runner.onPosition({ lat: 32.87, lng: -117.25 });
  await until(() => audio.played.some(u => u.includes('c%7Clandmark_origin.wav')), 'story C sounds');
  runner.onPosition({ lat: 32.9, lng: -117.25 });
  await until(() => runner.view().closeoutDone, 'arrival closeout');
  assert.equal(runner.view().endedKind, 'arrival-owed');
  assert.ok(runner.view().owed && runner.view().owed.includes('b|landmark_origin'), 'the owed closeout carries the climax');
  await until(() => outcomes.length === 1, 'outcome filed');
  assert.equal(outcomes[0].commissions.length, 1);
  assert.equal(outcomes[0].commissions[0].result, 'sounded');
  assert.ok(!outcomes[0].commissions[0].text.includes('here it is'), 'the captured text is the plain mid bridge');
});

await checkAsync('phase1 (e2): a climax dropped last commissions nothing — the owed accounting is the only repair', async () => {
  const base = anchorPlan();
  const plan = {
    ...base,
    climaxUnitId: 'b|landmark_origin',
    climaxSubject: 'b|landmark_origin',
    climaxMode: 'late',
    items: base.items
      .filter(i => i.id !== 'c|landmark_origin' && !(i.kind === 'bridge' && i.nextUnitId === 'c|landmark_origin'))
      .map(i => (i.id === 'b|landmark_origin' ? { ...i, climax: true } : i)),
  };
  const audio = new RealFakeAudio(250);
  const events = [];
  const outcomes = [];
  const runner = p1Runner(audio, events, outcomes);
  await runner.start(plan);
  await until(() => audio.played.some(u => u.includes('a%7Clandmark_origin.wav')), 'story A sounds');
  runner.onPosition({ lat: 32.795, lng: -117.25 });
  await until(() => events.some(e => e.t === 'story_dropped'), 'the climax drops');
  await new Promise(r => setTimeout(r, 200));
  assert.equal(events.filter(e => e.t === 'route_rebridge_fired').length, 0, 'no commission — nothing follows the climax');
  runner.onPosition({ lat: 32.9, lng: -117.25 }); // arrival (or the plan exhausts first — either closeout is honest)
  await until(() => runner.view().closeoutDone, 'closeout');
  await until(() => outcomes.length === 1, 'outcome filed');
  assert.deepEqual(outcomes[0].commissions, [], 'no commission records');
  assert.equal(outcomes[0].dropped.find(d => d.id === 'b|landmark_origin')?.reason, 'stale-window', 'the climax is owed as a stale drop');
});

await checkAsync('phase1 (f): normal pace — zero commissions, zero suppressions, playback identical to base', async () => {
  const plan = anchorPlan();
  assert.deepEqual(
    plan.items.map(i => i.kind),
    ['preview', 'story', 'bridge', 'story', 'bridge', 'story'],
    'fixture shape',
  );
  const bridgeAB = plan.items.find(i => i.kind === 'bridge' && i.nextUnitId === 'b|landmark_origin');
  const bridgeBC = plan.items.find(i => i.kind === 'bridge' && i.nextUnitId === 'c|landmark_origin');
  const audio = new RealFakeAudio(250);
  const events = [];
  const runner = p1Runner(audio, events, null);
  await runner.start(plan);
  await until(() => audio.played.some(u => u.includes('a%7Clandmark_origin.wav')), 'story A sounds');
  runner.onPosition({ lat: 32.78, lng: -117.25 }); // into B's window
  await new Promise(r => setTimeout(r, 80));
  runner.onPosition({ lat: 32.78, lng: -117.25 }); // re-fed identical: a zero interval can never suppress
  await until(() => audio.played.some(u => u.includes('b%7Clandmark_origin.wav')), 'story B sounds');
  runner.onPosition({ lat: 32.87, lng: -117.25 }); // into C's window (a jump — discontinuous, never a sample)
  await new Promise(r => setTimeout(r, 80));
  runner.onPosition({ lat: 32.87, lng: -117.25 });
  await until(() => audio.played.some(u => u.includes('c%7Clandmark_origin.wav')), 'story C sounds');
  await new Promise(r => setTimeout(r, 60));
  assert.equal(events.filter(e => e.t === 'story_dropped').length, 0);
  assert.equal(events.filter(e => e.t.startsWith('route_rebridge')).length, 0);
  assert.equal(events.filter(e => e.t === 'route_render_late').length, 0);
  const tokens = audio.played.map(u => {
    if (u.includes('a%7Clandmark_origin.wav')) return 'A';
    if (u.includes('b%7Clandmark_origin.wav')) return 'B';
    if (u.includes('c%7Clandmark_origin.wav')) return 'C';
    const t = decodedOf(u);
    if (t === plan.items[0].text) return 'preview';
    if (t === bridgeAB.text) return 'bridgeAB';
    if (t === bridgeBC.text) return 'bridgeBC';
    return `?? ${t.slice(0, 40)}`;
  });
  assert.deepEqual(tokens, ['preview', 'A', 'bridgeAB', 'B', 'bridgeBC', 'C'], 'the exact base playback order');
  runner.endTour();
});

await checkAsync('phase1 (g): the per-tour cap — four commissions sound, the fifth drop is discarded-cap', async () => {
  const gUnit = (n, anchor) => unit(`s${n}|landmark_origin`, 32.7 + anchor * 0.2);
  const gStory = (n, anchor) => {
    const u = gUnit(n, anchor);
    return {
      kind: 'story',
      id: u.id,
      label: u.placeName,
      durationSec: 120,
      unit: u,
      ready: true,
      anchorProgress: anchor,
      releaseProgress: anchor - 0.01,
      expireProgress: anchor + 0.06,
    };
  };
  const gBridge = (a, b) => ({
    kind: 'bridge',
    id: `bridge:s${a}|landmark_origin>s${b}|landmark_origin`,
    label: `Bridge — s${a} to s${b}`,
    durationSec: 10,
    prevUnitId: `s${a}|landmark_origin`,
    nextUnitId: `s${b}|landmark_origin`,
    text: `BRIDGE s${a} to s${b}.`,
    ready: true,
    targetDurationSec: 10,
  });
  const items = [{ kind: 'preview', id: 'preview', label: 'Episode preview', durationSec: 7, text: 'PREVIEW: a hand-built drive.', ready: true }];
  const anchors = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.93];
  anchors.forEach((a, i) => {
    items.push(gStory(i + 1, a));
    if (i < anchors.length - 1) items.push(gBridge(i + 1, i + 2));
  });
  const plan = { ...anchorPlan(), items, climaxUnitId: null, climaxSubject: null, climaxMode: null, thread: null, wrapUp: null };
  const audio = new RealFakeAudio(200);
  const events = [];
  const outcomes = [];
  const runner = p1Runner(audio, events, outcomes);
  await runner.start(plan);
  await until(() => audio.played.some(u => u.includes('s1%7Clandmark_origin.wav')), 'story s1 sounds');
  const fix = p => runner.onPosition({ lat: latForProgress(p), lng: -117.25 });
  const soundedCount = () => events.filter(e => e.t === 'route_rebridge_sounded').length;
  // Each jump lands just past the next story's window: it
  // drops at the gate and the commission into the following
  // story sounds. Jumps are discontinuities — suppression
  // never enters this suite.
  fix(0.27);
  await until(() => soundedCount() === 1, 'commission 1 sounds (s2 dropped)');
  fix(0.42);
  await until(() => soundedCount() === 2, 'commission 2 sounds (s3 dropped)');
  fix(0.57);
  await until(() => soundedCount() === 3, 'commission 3 sounds (s4 dropped)');
  fix(0.72);
  await until(() => soundedCount() === 4, 'commission 4 sounds (s5 dropped)');
  fix(0.87); // s6 drops — the cap is spent
  await until(
    () => events.some(e => e.t === 'route_rebridge_skipped' && e.p.reason === 'cap'),
    'the fifth drop hits the cap',
  );
  fix(0.95);
  await until(() => audio.played.some(u => u.includes('s7%7Clandmark_origin.wav')), 'story s7 sounds, bridgeless');
  assert.equal(events.filter(e => e.t === 'story_dropped').length, 5, 'five stale drops');
  assert.equal(events.filter(e => e.t === 'route_rebridge_fired').length, 4, 'four commissions fired');
  runner.endTour();
  assert.equal(outcomes.length, 1);
  const comms = outcomes[0].commissions;
  assert.equal(comms.length, 5, 'four commissions + the cap record');
  assert.deepEqual(
    comms.map(c => c.result),
    ['sounded', 'sounded', 'sounded', 'sounded', 'discarded-cap'],
  );
  assert.equal(comms[4].text, null, 'a capped commission was never authored');
  assert.deepEqual(verifier.validateOutcome(outcomes[0]), [], 'the cap outcome validates');
});

check('phase1 (h): capture shape — commissions ride the outcome verbatim; verifier accepts them and legacy rows', () => {
  const acc = {
    endReason: 'arrival-owed',
    begun: true,
    planItemIds: ['i0', 'i1', 'i2', 'i3', 'i4', 'i5', 'i6'],
    playedItemIds: ['i0', 'i2'],
    settledUnplayed: new Map([['i1', { skipped: true }]]),
    droppedStaleItemIds: new Set(['i3']),
    gateSkippedItemIds: new Set(['i4']),
    unrenderedItemIds: new Set(['i5']),
    heardUnitIds: ['u0', 'u2'],
    maxDisplacementM: 40,
    maxProgressFraction: 0.5,
    pathLengthM: 10000,
    endedAtMs: 1762000100000,
  };
  const commissions = [
    {
      id: 'rebridge:i3>i4',
      for_story_id: 'i3',
      prev_story_id: 'i2',
      next_story_id: 'i4',
      via: 'suppression',
      text: 'From x we keep rolling.',
      result: 'sounded',
    },
  ];
  const out = ec.assembleOutcomeCapture('route-1', 'fresh-test', { ...acc, commissions });
  assert.deepEqual(out.commissions, commissions, 'commissions carried verbatim');
  assert.deepEqual(verifier.validateOutcome(out), [], 'the verifier accepts a commission verdict');
  const legacy = ec.assembleOutcomeCapture('route-1', 'fresh-test', acc);
  assert.deepEqual(legacy.commissions, [], 'no commissions input → an empty array, never a missing field');
  assert.deepEqual(verifier.validateOutcome(legacy), [], 'commission-less outcomes still validate');
  const bogusResult = { ...out, commissions: [{ ...commissions[0], result: 'vanished' }] };
  assert.ok(verifier.validateOutcome(bogusResult).length > 0, 'a bogus commission result is flagged');
  const bogusVia = { ...out, commissions: [{ ...commissions[0], via: 'magic' }] };
  assert.ok(verifier.validateOutcome(bogusVia).length > 0, 'a bogus commission via is flagged');
});

// ---- field fix stack (Nov 5, 2026) ----
// Built from the first real route drive (tour
// route-1793884720337): bridges padded to their targets and
// repeated each other, a long early portal doomed the geo
// stories behind it, suppression never fired (every drop was
// a gate drop), portal hops spoke in presence register, and
// TTS read raw highway labels. One suite per lane, plus the
// lane-2 field-shaped regression.

check('fieldfix lane 5: spoken forms — highway labels expand in tissue, false positives untouched', () => {
  const f = rn.spokenFormText;
  assert.equal(f('SR-905 West: Brown Field to I-805'), 'State Route 905 West: Brown Field to Interstate 805');
  assert.equal(f('take US-101 past CA-94 and SR-78'), 'take U.S. 101 past State Route 94 and State Route 78');
  assert.equal(f('PCF 816 rides at anchor'), 'P C F 816 rides at anchor');
  // False positives: the pronoun, letter-runs, bare numbers.
  assert.equal(f('I think I saw it'), 'I think I saw it');
  assert.equal(f('the ASR-900 report, an SR of the order'), 'the ASR-900 report, an SR of the order');
  assert.equal(f('exit 805 at mile 12, I- five'), 'exit 805 at mile 12, I- five');
  // Through the seam: a bridge between raw-labeled places
  // speaks (and therefore captures) the normalized form.
  const t = rn.bridgeTextFor(
    { id: 'x|corridor', placeName: 'SR-905 West: Brown Field to I-805' },
    { id: 'y|landmark_origin', placeName: 'PCF 816' },
  );
  assert.ok(t.includes('State Route 905') && t.includes('Interstate 805'), 'bridge text normalized');
  assert.ok(t.includes('P C F 816'), 'the designator normalizes in the next-subject slot');
  assert.ok(!/SR-905|I-805|PCF 816/.test(t), 'no raw label survives in spoken tissue');
});

check("fieldfix lane 1: a bridge is its pair's facts — the elastic target no longer shapes the text", () => {
  const prev = { id: 'p|landmark_origin', placeName: 'Prev Place', storyText: 'word '.repeat(50) };
  const next = { id: 'n|landmark_origin', placeName: 'Next Place', storyText: 'word '.repeat(50) };
  const at8 = rn.bridgeTextFor(prev, next, { targetSec: 8 });
  const at90 = rn.bridgeTextFor(prev, next, { targetSec: 90 });
  assert.equal(at8, at90, 'the target is bookkeeping now — same pair, same bridge');
  assert.ok(!rn.BRIDGE_CONNECTIVE_LINES.some(l => at90.includes(l)), 'no connective-bank line pads it');
  assert.ok(rm.estimateDurationSec(at90) <= 30, `honest length (got ${rm.estimateDurationSec(at90)}s by the composer's estimator)`);
});

check('fieldfix lane 1: maxChars spends the optional sentence first — the head always survives', () => {
  const prev = { id: 'p|landmark_origin', placeName: 'A Very Long Place Name Indeed' };
  const next = { id: 'n|landmark_origin', placeName: 'Another Considerably Long Place Name' };
  const ctx = {
    threadTopic: 'Navy Century',
    prevSubject: 'A Very Long Place Name Indeed',
    prevGist: null,
    nextSubject: 'Another Considerably Long Place Name',
    role: 'mid',
    callbackSubject: 'An Earlier Story With A Long Name',
  };
  const full = rn.bridgeTextFor(prev, next, { context: ctx, episode: rn.newBridgeEpisodeState() });
  assert.ok(full.includes('two ends of the same story'), 'the uncapped bridge carries the callout');
  assert.ok(full.length > 200, `fixture bridge is long (${full.length} chars)`);
  const capped = rn.bridgeTextFor(prev, next, { context: ctx, maxChars: 200, episode: rn.newBridgeEpisodeState() });
  assert.ok(capped.length <= 200, `the cap holds (${capped.length} chars)`);
  assert.ok(capped.startsWith('From A Very Long Place Name Indeed'), 'the head survives the cap');
  assert.ok(!capped.includes('two ends of the same story'), 'the callout was the spend');
});

check('fieldfix lane 1b: one episode, one callout — openings rotate, no bank line repeats', () => {
  const units = [navy('n1', 32.71), navy('n2', 32.75), navy('n3', 32.79), navy('n4', 32.83), navy('n5', 32.87)];
  const plan = rm.composeRoutePlan(
    units, densePath, denseDest, 'Dest',
    { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] },
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 2000 },
  );
  assert.equal(plan.thread?.topic, 'Navy Century', 'fixture carries the thread');
  const bridges = plan.items.filter(i => i.kind === 'bridge');
  assert.ok(bridges.length >= 3, `fixture carries several bridges (got ${bridges.length})`);
  const callouts = bridges.filter(b => b.text.includes('two ends of the same story')).length;
  assert.equal(callouts, 1, 'the thread callout fires exactly once in the episode');
  for (const b of bridges) {
    assert.ok(!rn.BRIDGE_CONNECTIVE_LINES.some(l => b.text.includes(l)), 'no bank line in any bridge');
  }
  const shapeOf = t =>
    t.includes('we range off the road') ? 'portal'
    : t.includes('Next along the road:') ? 'next'
    : t.includes('the road carries us on to') ? 'carries'
    : t.includes('just ahead is') ? 'ahead'
    : /we keep rolling\./.test(t) ? 'rolling' : 'other';
  const shapes = bridges.map(b => shapeOf(b.text));
  for (let i = 1; i < shapes.length; i++) assert.notEqual(shapes[i], shapes[i - 1], 'consecutive bridges open differently');
  assert.ok(new Set(shapes).size >= 2, 'the episode varies its openings');
});

await checkAsync('fieldfix lanes 1/1b (runner): the commission inherits the episode ledger — callout spent at compose, cap honored', async () => {
  const plan = rm.composeRoutePlan(
    [navy('a', 32.71), navy('b', 32.78), navy('c', 32.84), navy('d', 32.88, { durationSec: 300 })],
    finePath, { lat: 32.9, lng: -117.25 }, 'Dest',
    { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] },
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 2000 },
  );
  assert.ok(
    plan.items.some(i => i.kind === 'bridge' && i.text.includes('two ends of the same story')),
    'compose spent the callout (fixture sanity)',
  );
  const audio = new RealFakeAudio(250);
  const events = [];
  const runner = p1Runner(audio, events, []);
  await runner.start(plan);
  let lat = 32.76; // progress ≈ 0.30 — the phase1 (a) creep
  runner.onPosition({ lat, lng: -117.25 });
  for (let i = 0; i < 40 && !events.some(e => e.t === 'story_dropped'); i++) {
    await new Promise(r => setTimeout(r, 200));
    lat += 0.0001;
    runner.onPosition({ lat, lng: -117.25 });
  }
  assert.ok(events.some(e => e.t === 'story_dropped'), 'B dropped under the creep');
  await until(() => events.some(e => e.t === 'route_rebridge_sounded'), 'the A→C commission sounds');
  const fired = events.filter(e => e.t === 'route_rebridge_fired');
  assert.equal(fired.length, 1, 'exactly one commission');
  const text = audio.played.map(decodedOf).find(t => t.startsWith('From a') && t.includes('ahead is c'));
  assert.ok(text, 'the sounded commission text is on the audio record');
  assert.ok(text.length <= rp.REBRIDGE_MAX_CHARS, `commission within the hard cap (${text.length} chars)`);
  assert.ok(!text.includes('two ends of the same story'), 'the spent callout does not repeat in the commission');
  assert.ok(text.includes('runs through c too'), 'the commission still connects — on the alternate thread line');
  runner.endTour();
});

check('fieldfix lane 2: the field shape — a long early portal can no longer doom the geo stories behind it', () => {
  const geoA = unit('ga|landmark_origin', 32.72, { durationSec: 60, topics: ['Harbor'] });
  const geoB = unit('gb|landmark_origin', 32.79, { durationSec: 60 });
  const geoC = unit('gc|landmark_origin', 32.86, { durationSec: 60 });
  const portal = unit('pp|landmark_history', 32.75, { angle: 'landmark_history', lng: -117.05, durationSec: 400, topics: ['Harbor'] });
  const opts = { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 1000 };
  const input = { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] };
  const control = rm.composeRoutePlan([geoA, geoB, geoC], densePath, denseDest, 'Dest', input, opts);
  assert.deepEqual(
    storyItems(control).map(s => s.id),
    ['ga|landmark_origin', 'gb|landmark_origin', 'gc|landmark_origin'],
    'control: all three geo stories seat',
  );
  assert.deepEqual(rm.planDoomedStoryIds(control.items, 1000), [], 'control: the geo plan alone is sound');
  const plan = rm.composeRoutePlan([geoA, geoB, geoC, portal], densePath, denseDest, 'Dest', input, opts);
  const storyIds = storyItems(plan).map(s => s.id);
  for (const id of ['ga|landmark_origin', 'gb|landmark_origin', 'gc|landmark_origin']) {
    assert.ok(storyIds.includes(id), `${id} survives the portal`);
  }
  assert.deepEqual(rm.planDoomedStoryIds(plan.items, 1000), [], 'the repaired plan dooms nothing');
  const pAt = plan.items.findIndex(i => i.id === 'pp|landmark_history');
  if (pAt >= 0) {
    const bAt = plan.items.findIndex(i => i.id === 'gb|landmark_origin');
    assert.ok(pAt > bAt, 'a kept portal sits after the story it would have doomed');
  }
});

check('fieldfix lane 2 (members): woven member seating adds no attributable doom', () => {
  const units = wFixtureUnits([wCand('wm|corridor-woven-v1', 200)]);
  const base = wCompose(units, 1800);
  const seated = rm.seatWovenMembers(base, units, { heardKeys: new Set() });
  assert.ok(seated.items.some(i => i.id === 'wm|corridor-woven-v1'), 'the member seated (fixture sanity)');
  assert.deepEqual(
    rm.planDoomedStoryIds(seated.items, 1800),
    rm.planDoomedStoryIds(base.items, 1800),
    'member seating introduces no new doom — members fit inside bounded gaps, so no repair pass is needed there',
  );
});

check('fieldfix lane 4: portal seats prefer the woven twin; a presence-only hop is framed across the county', () => {
  const geo = [
    unit('ga|landmark_origin', 32.72, { topics: ['Harbor'] }),
    unit('gb|landmark_origin', 32.8),
    unit('gc|landmark_origin', 32.87),
  ];
  const original = unit('pp|landmark_history', 32.75, { angle: 'landmark_history', lng: -117.05, topics: ['Harbor'], durationSec: 150 });
  const twin = unit('pp|landmark_history-woven-v1', 32.75, { angle: 'landmark_history-woven-v1', lng: -117.05, topics: ['Harbor'], durationSec: 140 });
  const withTwin = composeDense([...geo, original, twin]);
  const portalItem = withTwin.items.find(i => i.portal);
  assert.equal(portalItem?.id, 'pp|landmark_history-woven-v1', 'the woven twin takes the portal seat');
  const presenceOnly = composeDense([...geo, original]);
  const p2 = presenceOnly.items.find(i => i.portal);
  assert.equal(p2?.id, 'pp|landmark_history', 'without a twin the original seats');
  const br = presenceOnly.items.find(i => i.kind === 'bridge' && i.nextUnitId === p2.id);
  assert.ok(br, 'the hop has an incoming bridge');
  assert.ok(br.text.includes('clear across the county'), 'the bridge frames the hop as a story told from across the county');
  assert.ok(!/just ahead|a little way off/.test(br.text), 'no proximity language for an off-route story');
});

await checkAsync('fieldfix lane 3: the sound-start stamp gap — suppression fires where the field run could only gate-drop', async () => {
  // The production gap, reproduced: the audio element
  // reports sound start only after play() settles (the
  // Player awaits the play race before stamping), so for the
  // first stretch of every item the gate cannot know the
  // current item's remaining time. At 004f867 the gate read
  // "cannot judge" as "safe" and promised the doomed
  // bridge — a promise is never re-judged. Here play()
  // settles 500 ms late while fixes stream in: the fixed
  // gate HOLDS the bridge until a real judgment exists, and
  // the judgment is doom.
  class DelayedStartAudio extends RealFakeAudio {
    play() {
      this.played.push(this.src);
      this.playingSrc = this.src;
      this.startedAt = Date.now();
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.playingSrc = null;
        if (this.endedCb) this.endedCb();
      }, this.durMs);
      return new Promise(res => setTimeout(res, 500));
    }
  }
  const plan = finePlan();
  const bridgeAB = plan.items.find(i => i.kind === 'bridge' && i.nextUnitId === 'b|landmark_origin');
  const audio = new DelayedStartAudio(2000);
  const events = [];
  const runner = p1Runner(audio, events, []);
  await runner.start(plan);
  let lat = 32.76; // progress ≈ 0.30, advancing 0.001 / 100 ms
  runner.onPosition({ lat, lng: -117.25 });
  for (let i = 0; i < 60 && !events.some(e => e.t === 'story_dropped'); i++) {
    await new Promise(r => setTimeout(r, 100));
    lat += 0.0002;
    runner.onPosition({ lat, lng: -117.25 });
  }
  const drops = events.filter(e => e.t === 'story_dropped');
  assert.equal(drops.length, 1, 'exactly one story dropped');
  assert.equal(drops[0].p.suppression?.fired, true, 'the drop record says suppression fired');
  const fired = events.filter(e => e.t === 'route_rebridge_fired');
  assert.equal(fired.length, 1, 'exactly one commission');
  assert.equal(fired[0].p.via, 'suppression', 'the drop came through suppression, not the gate');
  assert.ok(!audio.played.map(decodedOf).includes(bridgeAB.text), 'the doomed lead-in never sounded');
  runner.endTour();
});

await checkAsync('fieldfix lane 3: a near miss is on the record — judged safe on a real margin, then gate-dropped by a jump', async () => {
  // A custom plan: story A is SHORT (30 s nominal), so at
  // the phase1 (a) creep — one path segment per fix, a
  // usable 0.0025 progress/sec — the judgment that lands
  // while A sounds predicts B starting INSIDE its window:
  // safe, with a real margin. (With A's usual 120 s the same
  // rate predicts doom — that is phase1 (a)'s case.)
  const plan = rm.composeRoutePlan(
    [unit('a|landmark_origin', 32.71, { durationSec: 30 }), unit('b|landmark_origin', 32.78), unit('c|landmark_origin', 32.87)],
    finePath, { lat: 32.9, lng: -117.25 }, 'Dest',
    { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] },
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 2000 },
  );
  const bridgeAB = plan.items.find(i => i.kind === 'bridge' && i.nextUnitId === 'b|landmark_origin');
  const audio = new RealFakeAudio(250);
  const events = [];
  const runner = p1Runner(audio, events, []);
  await runner.start(plan);
  let lat = 32.76; // progress ≈ 0.30 — the phase1 (a) creep
  runner.onPosition({ lat, lng: -117.25 });
  let promised = false;
  for (let i = 0; i < 40 && !promised && !events.some(e => e.t === 'story_dropped'); i++) {
    await new Promise(r => setTimeout(r, 200));
    lat += 0.0001;
    runner.onPosition({ lat, lng: -117.25 });
    promised = audio.played.map(decodedOf).includes(bridgeAB.text);
  }
  assert.ok(promised, 'the lead-in sounded — it was promised on a judged-safe prediction');
  runner.onPosition({ lat: 32.795, lng: -117.25 }); // the jump: B's window is gone
  await until(() => events.some(e => e.t === 'story_dropped'), 'B gate-drops after the jump');
  const drop = events.find(e => e.t === 'story_dropped');
  assert.equal(drop.p.suppression?.fired, false, 'suppression did not fire');
  assert.equal(drop.p.suppression?.reason_not_fired, 'judged_not_doomed', 'it judged — and stood down on the numbers');
  assert.ok(drop.p.suppression.margin_progress > 0, `the recorded margin is positive (${drop.p.suppression.margin_progress})`);
  assert.ok(
    drop.p.suppression.predicted_start_progress < drop.p.suppression.expire_progress,
    'the prediction was inside the window when made',
  );
  runner.endTour();
});

await checkAsync('fieldfix lane 3: a drop suppression never got to judge says why', async () => {
  const plan = finePlan();
  const audio = new RealFakeAudio(250);
  const events = [];
  const runner = p1Runner(audio, events, []);
  await runner.start(plan);
  await until(() => audio.played.some(u => u.includes('a%7Clandmark_origin.wav')), 'story A sounds');
  runner.onPosition({ lat: 32.795, lng: -117.25 }); // one jump fix — no rate ever exists
  await until(() => events.some(e => e.t === 'story_dropped'), 'B gate-drops');
  const drop = events.find(e => e.t === 'story_dropped');
  assert.equal(drop.p.suppression?.fired, false, 'suppression did not fire');
  assert.ok(
    ['no_rate', 'no_remaining', 'not_judged'].includes(drop.p.suppression?.reason_not_fired),
    `the record names the unjudged reason (got ${drop.p.suppression?.reason_not_fired})`,
  );
  assert.equal(drop.p.suppression.predicted_start_progress, null, 'no prediction is fabricated for an unjudged drop');
  runner.endTour();
});

// ── Audience coloring (Nov 5, 2026) ────────────────────────
// Part A: the rating machinery (Standard / Family). Part B:
// Color Puck, the adult second-chair persona that exists
// only in Standard. Zero live calls: color text generation
// is stubbed everywhere below, and the gap-fill suites ride
// the standing stubbed deps.

check('coloring: classification — the hard / gray / clean matrix reads the unit\u2019s own signals', () => {
  const at = extra => unit('x|landmark_origin', 32.7, extra);
  // Hard: never told under Family, at any lane.
  assert.equal(rm.familyClassOf(at({ protectedRegister: true })), 'hard', 'Protected register');
  assert.equal(rm.familyClassOf(at({ tone: 'spooky' })), 'hard', 'spooky primary tone');
  assert.equal(rm.familyClassOf(at({ angle: 'landmark_scandal' })), 'hard', 'scandal angle at any tone');
  assert.equal(
    rm.familyClassOf(at({ angle: 'landmark_scandal', tone: 'warm' })),
    'hard',
    'scandal outranks a warm tone',
  );
  // Gray: told whole, but de-preferred under Family.
  assert.equal(rm.familyClassOf(at({ tone: 'somber' })), 'gray', 'somber primary');
  assert.equal(rm.familyClassOf(at({ toneSecondary: 'spooky' })), 'gray', 'spooky secondary');
  assert.equal(rm.familyClassOf(at({ toneSecondary: 'somber' })), 'gray', 'somber secondary');
  assert.equal(rm.familyClassOf(at({ angle: 'landmark_legends' })), 'gray', 'legends angle');
  assert.equal(rm.familyClassOf(at({ topics: ['folklore'] })), 'gray', 'folklore topic');
  assert.equal(
    rm.familyClassOf(at({ generatedRating: rm.generatedRatingForAudioPath('library/x/landmark_origin-ab12cd-route-gap-v1.wav') })),
    'gray',
    'a Standard-stamped promoted gap story is gray to a Family build',
  );
  // Clean: the warm default, and a Family-stamped promotion.
  assert.equal(rm.familyClassOf(at({})), 'clean');
  assert.equal(
    rm.familyClassOf(at({ generatedRating: rm.generatedRatingForAudioPath('library/x/landmark_origin-ab12cd-route-gap-fam-v1.wav') })),
    'clean',
    'a Family-stamped promoted gap story reads clean',
  );
  // The stamp reader itself.
  assert.equal(rm.generatedRatingForAudioPath('library/x/landmark_origin-ab12cd-route-gap-fam-v1.wav'), 'family');
  assert.equal(rm.generatedRatingForAudioPath('library/x/landmark_origin-ab12cd-route-gap-v1.wav'), 'standard');
  assert.equal(rm.generatedRatingForAudioPath('x/plain.wav'), null, 'a shelf render carries no stamp');
  assert.equal(rm.generatedRatingForAudioPath(null), null);
  // The color-suppression class rides the same signals.
  assert.equal(rm.colorSuppressedFor(at({ tone: 'somber' })), true, 'no color after somber');
  assert.equal(rm.colorSuppressedFor(at({ protectedRegister: true })), true, 'no color after Protected');
  assert.equal(rm.colorSuppressedFor(at({ angle: 'landmark_scandal' })), true, 'no color after scandal');
  assert.equal(rm.colorSuppressedFor(at({})), false, 'a warm story takes color');
  // Family outranks a conflicting tone pick: spooky/somber stand down, others steer.
  assert.equal(rm.effectiveRouteTone({ tone: 'spooky', audience: 'family' }), null);
  assert.equal(rm.effectiveRouteTone({ tone: 'somber', audience: 'family' }), null);
  assert.equal(rm.effectiveRouteTone({ tone: 'reflective', audience: 'family' }), 'reflective');
  assert.equal(rm.effectiveRouteTone({ tone: 'spooky', audience: 'standard' }), 'spooky');
  assert.equal(rm.effectiveRouteTone({ tone: 'spooky' }), 'spooky', 'a legacy input keeps its pick');
});

check('coloring: family hard-exclusion across every composer lane (seeded fixture)', () => {
  const laneUnits = [
    // The thread cast: three clean History stories on the corridor.
    unit('h1|landmark_origin', 32.72, { topics: ['History'] }),
    unit('h2|landmark_origin', 32.76, { topics: ['History'] }),
    unit('h3|landmark_origin', 32.84, { topics: ['History'] }),
    // GEO hard lanes: Protected, spooky-primary, scandal — prime corridor ground.
    unit('prot|landmark_origin', 32.74, { protectedRegister: true }),
    unit('spook|landmark_origin', 32.80, { tone: 'spooky' }),
    unit('scand|landmark_scandal', 32.82, { angle: 'landmark_scandal' }),
    // PORTAL hard lane: ~2.8 km east of the path — portal ground, never corridor.
    unit('pprot|landmark_origin', 32.85, { lng: -117.22, protectedRegister: true }),
    // MEMBER hard + clean lanes: county ground, woven-eligible, on the thread.
    unit('mprot|landmark_origin', 32.60, { lng: -117.02, topics: ['History'], wovenEligible: true, protectedRegister: true }),
    unit('mclean|landmark_origin', 32.62, { lng: -117.04, topics: ['History'], wovenEligible: true }),
  ];
  const climaxOnlyUnits = [
    unit('cscan|landmark_scandal', 32.60, { angle: 'landmark_scandal', lng: -117.0 }),
  ];
  const hardIds = new Set(['prot|landmark_origin', 'spook|landmark_origin', 'scand|landmark_scandal', 'pprot|landmark_origin', 'mprot|landmark_origin', 'cscan|landmark_scandal']);
  const opts = { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 2000, climaxOnlyUnits };
  const famInput = { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [], audience: 'family' };
  const fam = rm.composeRoutePlan(laneUnits, path, dest, 'Dest', famInput, opts);
  assert.equal(fam.audience, 'family');
  assert.ok(fam.items.some(i => i.kind === 'story'), 'the family plan still tells stories (non-vacuous)');
  for (const it of fam.items) {
    if (it.kind === 'story' && it.unit) {
      assert.notEqual(rm.familyClassOf(it.unit), 'hard', `hard story seated under Family: ${it.id}`);
      assert.ok(!hardIds.has(it.id), `hard id in the family plan: ${it.id}`);
    }
    if (it.prevUnitId) assert.ok(!hardIds.has(it.prevUnitId), `a bridge leads out of a hard story: ${it.id}`);
    if (it.nextUnitId) assert.ok(!hardIds.has(it.nextUnitId), `a bridge leads into a hard story: ${it.id}`);
  }
  assert.ok(fam.climaxUnitId === null || !hardIds.has(fam.climaxUnitId), 'the family climax is never a hard unit');
  // The member lane: seating runs on the family plan — the
  // clean member may seat, the Protected one never does.
  const seated = rm.seatWovenMembers(fam, laneUnits, { heardKeys: new Set() });
  for (const it of seated.items) {
    if (it.kind === 'story' && it.unit) assert.notEqual(rm.familyClassOf(it.unit), 'hard', `hard member seated: ${it.id}`);
  }
  // Control: the SAME shelf under Standard seats the geo hard
  // lanes — the exclusion above is the rating working, not a
  // fixture that never seats anything dark.
  const std = rm.composeRoutePlan(laneUnits, path, dest, 'Dest', { ...famInput, audience: 'standard' }, opts);
  const stdStoryIds = new Set(std.items.filter(i => i.kind === 'story').map(i => i.id));
  assert.ok(stdStoryIds.has('prot|landmark_origin'), 'standard seats the Protected corridor story');
  assert.ok(stdStoryIds.has('spook|landmark_origin'), 'standard seats the spooky corridor story');
  assert.ok(stdStoryIds.has('scand|landmark_scandal'), 'standard seats the scandal corridor story');
});

check('coloring battery: no hard-class story is ever seated under Family across grader worlds', () => {
  let standardHardSeated = 0;
  for (const [seed, shape] of [[1103, 'current'], [2207, '2x']]) {
    const world = grader.buildWorld(seed, shape);
    const all = [...world.unitsById.values()];
    // The synthetic shelf carries no presence data of its
    // own: stamp the Protected register onto a deterministic
    // slice (the tone/angle signals are the world's already).
    for (const u of all) {
      if (u.placeKey.endsWith('3') || u.placeKey.endsWith('7')) u.protectedRegister = true;
    }
    for (const routeName of ['tourist', 'hop', 'commute']) {
      const route = world.routes[routeName];
      const base = { destinationText: route.destName, arrivalTimeMs: null, tone: null, topics: [] };
      const opts = { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: route.driveSec };
      const fam = rm.composeRoutePlan(all, route.path, route.dest, route.destName, { ...base, audience: 'family' }, opts);
      for (const it of fam.items) {
        if (it.kind === 'story' && it.unit) {
          assert.notEqual(rm.familyClassOf(it.unit), 'hard', `${shape}/${routeName}: hard story seated under Family: ${it.id}`);
        }
      }
      if (fam.climaxUnitId) {
        const cu = all.find(u => u.id === fam.climaxUnitId);
        assert.ok(cu && rm.familyClassOf(cu) !== 'hard', `${shape}/${routeName}: the family climax is hard`);
      }
      const members = grader
        .wovenEligibleUnits(world, routeName, { share: 0.5 })
        .map(u => ({ ...u, wovenEligible: true }));
      const seated = rm.seatWovenMembers(fam, members, { heardKeys: new Set() });
      for (const it of seated.items) {
        if (it.kind === 'story' && it.unit) {
          assert.notEqual(rm.familyClassOf(it.unit), 'hard', `${shape}/${routeName}: hard member seated under Family: ${it.id}`);
        }
      }
      const std = rm.composeRoutePlan(all, route.path, route.dest, route.destName, { ...base, audience: 'standard' }, opts);
      standardHardSeated += std.items.filter(i => i.kind === 'story' && i.unit && rm.familyClassOf(i.unit) === 'hard').length;
    }
  }
  assert.ok(standardHardSeated > 0, 'non-vacuous: Standard builds seat hard-class stories in these worlds');
});

check('coloring: gray de-preference — the family rank term flips a contested slot; gray alone still seats', () => {
  // Same decile cell, same act, one budget slot (100 s fits
  // exactly one 120 s story by the fit rule). The gray unit
  // WINS the standing order — it alone matches the tone pick —
  // so only the family rank term can flip the seat.
  const gray = unit('gray|landmark_origin', 32.751, { tone: 'reflective', topics: ['folklore'] });
  const clean = unit('clean|landmark_origin', 32.754, { tone: 'warm' });
  const base = { destinationText: 'Dest', arrivalTimeMs: null, tone: 'reflective', topics: [] };
  const opts = { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100 };
  const std = rm.composeRoutePlan([gray, clean], path, dest, 'Dest', { ...base, audience: 'standard' }, opts);
  assert.ok(std.items.some(i => i.id === 'gray|landmark_origin'), 'standard: the tone-matching gray story wins the slot');
  assert.ok(!std.items.some(i => i.id === 'clean|landmark_origin'), 'standard: the clean story is crowded out');
  const fam = rm.composeRoutePlan([gray, clean], path, dest, 'Dest', { ...base, audience: 'family' }, opts);
  assert.ok(fam.items.some(i => i.id === 'clean|landmark_origin'), 'family: the clean story wins the same slot');
  assert.ok(!fam.items.some(i => i.id === 'gray|landmark_origin'), 'family: the gray story is de-preferred out');
  // De-preference is not exclusion: a gray-only shelf still tells its story.
  const grayOnly = rm.composeRoutePlan([gray], path, dest, 'Dest', { ...base, audience: 'family' }, { ...opts, budgetSecOverride: 100000 });
  assert.ok(grayOnly.items.some(i => i.id === 'gray|landmark_origin'), 'family: a gray story seats when nothing cleaner competes');
});

check('coloring: gist rule — family tissue names gray stories without quoting them', () => {
  const gistText = 'The old mill burned down in 1911 and the whole town still talks about it. Then more follows.';
  const grayMid = unit('graymid|landmark_origin', 32.8, { topics: ['folklore'], storyText: gistText });
  const cleanMid = unit('cleanmid|landmark_origin', 32.8, { storyText: gistText });
  const closing = unit('closing|landmark_origin', 32.88);
  const thread = { topic: 'History' };
  const stdCtx = rm.buildPreviewContext({
    thread, destinationName: 'Dest', storyCount: 4, closing, climax: null, mid: grayMid,
    previouslyHeardSubject: null, priorDrive: null, audience: 'standard',
  });
  assert.equal(stdCtx.midSubject, 'graymid|landmark_origin');
  assert.ok(stdCtx.midGist && stdCtx.midGist.includes('burned down'), 'standard preview quotes the mid gist');
  const famCtx = rm.buildPreviewContext({
    thread, destinationName: 'Dest', storyCount: 4, closing, climax: null, mid: grayMid,
    previouslyHeardSubject: null, priorDrive: null, audience: 'family',
  });
  assert.equal(famCtx.midSubject, 'graymid|landmark_origin', 'family preview still NAMES the gray story');
  assert.equal(famCtx.midGist, undefined, 'family preview never QUOTES a gray story');
  const famCleanCtx = rm.buildPreviewContext({
    thread, destinationName: 'Dest', storyCount: 4, closing, climax: null, mid: cleanMid,
    previouslyHeardSubject: null, priorDrive: null, audience: 'family',
  });
  assert.ok(famCleanCtx.midGist && famCleanCtx.midGist.includes('burned down'), 'family preview quotes a CLEAN story freely');
  // The bridge context carries the same rule for the story behind.
  const next = unit('next|landmark_origin', 32.85);
  const famBridge = rm.buildBridgeContext({
    earlier: [], prev: grayMid, next, thread: null, isClimaxBridge: false, climaxLast: false, promiseMade: false, audience: 'family',
  });
  assert.equal(famBridge.prevGist, null, 'family bridge context carries no gray gist');
  const stdBridge = rm.buildBridgeContext({
    earlier: [], prev: grayMid, next, thread: null, isClimaxBridge: false, climaxLast: false, promiseMade: false, audience: 'standard',
  });
  assert.ok(stdBridge.prevGist && stdBridge.prevGist.includes('burned down'), 'standard bridge context quotes as today');
});

check('coloring: standard composition parity — audience standard ≡ the legacy input, item for item', () => {
  const units = [
    unit('h1|landmark_origin', 32.72, { topics: ['History'] }),
    unit('h2|landmark_origin', 32.76, { topics: ['History'], tone: 'grand' }),
    unit('h3|landmark_origin', 32.84, { topics: ['History'] }),
    unit('prot|landmark_origin', 32.74, { protectedRegister: true }),
    unit('spook|landmark_origin', 32.80, { tone: 'spooky' }),
    unit('plain|landmark_origin', 32.78, { topics: ['Food & Drink'] }),
  ];
  const base = { destinationText: 'Dest', arrivalTimeMs: null, tone: 'grand', topics: ['History'] };
  const opts = { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 2000 };
  const legacy = rm.composeRoutePlan(units, path, dest, 'Dest', base, opts);
  const standard = rm.composeRoutePlan(units, path, dest, 'Dest', { ...base, audience: 'standard' }, opts);
  const project = p =>
    p.items.map(i => [i.kind, i.id, i.text ?? null, i.durationSec, i.prevUnitId ?? null, i.nextUnitId ?? null]);
  assert.deepEqual(project(standard), project(legacy), 'same items, same order, same texts');
  assert.equal(standard.budgetSec, legacy.budgetSec, 'same budget');
  assert.equal(standard.totalSec, legacy.totalSec, 'same total');
  assert.equal(standard.climaxUnitId, legacy.climaxUnitId, 'same climax');
  assert.deepEqual(standard.thread, legacy.thread, 'same thread');
  assert.equal(standard.audience, 'standard');
  assert.equal(legacy.audience, 'standard', 'a legacy input composes as Standard — the standing default');
});

await checkAsync('coloring gapfill: family generation is ruled + stamped; a hard subject is never commissioned', async () => {
  const drive = 2000;
  const run = async audience => {
    const plan = mkPlan([storyAtSec('s1|x', 200, 100, drive), storyAtSec('s2|x', 1800, 100, drive)]);
    plan.driveSec = drive;
    plan.budgetSec = drive;
    plan.audience = audience; // compose stamps this in production; mkPlan is a literal
    const prompts = [];
    const ingested = [];
    const filled = await gf.fillRouteGaps(
      plan,
      { fetchedUnits: plan.items.map(i => i.unit), heardKeys: new Set(), input: { ...noInput, audience }, driveSec: drive },
      {
        discoverSubjects: async points => [
          // Protected register (bundled presence data): the
          // story this subject WOULD be generated as is
          // hard-class — under Family it is excluded at
          // discovery and the commission moves to clean ground.
          { name: 'Fort Rosecrans National Cemetery', lat: points[1].lat, lng: points[1].lng, types: ['cemetery'], rating: 4.8, userRatings: 900, address: null, facts: [] },
          { name: 'The Old Mill', lat: points[1].lat, lng: points[1].lng, types: ['museum'], rating: 4.6, userRatings: 1200, address: null, facts: [] },
        ],
        generateStory: async prompt => {
          prompts.push(prompt);
          return cannedStory(subjectFromPrompt(prompt));
        },
        synthesize: async () => new Blob(['fake-audio']),
        ingest: async ({ unit: u }) => {
          ingested.push(u);
          return 'library/stub.wav';
        },
        onEvent: () => {},
      },
    );
    return { filled, prompts, ingested };
  };
  const fam = await run('family');
  assert.equal(fam.prompts.length, 1, 'one generation under Family');
  assert.ok(fam.prompts[0].includes('Tell the story of The Old Mill.'), 'the commission moved to the clean subject');
  assert.ok(!fam.prompts[0].includes('Fort Rosecrans'), 'the Protected subject was never commissioned');
  assert.ok(fam.prompts[0].includes('AUDIENCE: FAMILY'), 'the Family rules block rides the gap prompt');
  const famGen = fam.filled.items.find(i => i.unit && i.unit.generatedRating);
  assert.ok(famGen, 'the generated unit is in the filled plan');
  assert.equal(famGen.unit.generatedRating, 'family', 'the unit carries the generating rating');
  assert.equal(fam.ingested.length, 1);
  assert.equal(fam.ingested[0].generatedRating, 'family', 'promotion receives the family stamp');
  const std = await run('standard');
  assert.equal(std.prompts.length, 1, 'one generation under Standard');
  assert.ok(std.prompts[0].includes('Tell the story of Fort Rosecrans National Cemetery.'), 'standard commissions the first subject as today');
  assert.ok(!std.prompts[0].includes('AUDIENCE: FAMILY'), 'no Family block under Standard');
  assert.equal(std.ingested[0].generatedRating, 'standard', 'promotion receives the standard stamp');
});

await checkAsync('color: the color pass is a strict no-op under Family — the prompt never runs', async () => {
  const fam = rm.composeRoutePlan(
    [unit('a|landmark_origin', 32.72), unit('b|landmark_origin', 32.78), unit('c|landmark_origin', 32.86)],
    path, dest, 'Dest',
    { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [], audience: 'family' },
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000 },
  );
  let calls = 0;
  const out = await rc.colorizeRoutePlan(fam, {
    generateColor: async () => {
      calls += 1;
      return 'This must never be generated.';
    },
  });
  assert.equal(calls, 0, 'zero color generations under Family');
  assert.equal(out, fam, 'the family plan passes through untouched (same object)');
  assert.ok(!out.items.some(i => i.voice === 'color-puck'), 'no color pieces in a family plan');
});

await checkAsync('color: standard plan — slots convert in place, caps bind, story order is untouched', async () => {
  const units = [32.71, 32.74, 32.77, 32.80, 32.83, 32.86, 32.88].map((lat, i) =>
    unit(`s${i + 1}|landmark_origin`, lat),
  );
  const plan = rm.composeRoutePlan(units, path, dest, 'Dest',
    { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] },
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 3000 });
  const storyIdsBefore = plan.items.filter(i => i.kind === 'story').map(i => i.id);
  let calls = 0;
  const out = await rc.colorizeRoutePlan(plan, {
    generateColor: async prompt => {
      calls += 1;
      const subject = prompt.match(/Subject: (.+)\n/)[1];
      return `Color beat for ${subject}.`;
    },
  });
  const pieces = out.items.filter(i => i.voice === 'color-puck');
  assert.equal(pieces.length, rn.COLOR_MAX_PER_EPISODE, 'the per-episode cap binds (7 eligible slots, cap 5)');
  assert.equal(calls, rn.COLOR_MAX_PER_EPISODE, 'generation stops at the cap — no wasted calls');
  for (const p of pieces) {
    assert.ok(p.text.length <= rn.COLOR_MAX_CHARS, `piece within the char cap (${p.text.length})`);
    assert.ok(storyIdsBefore.includes(p.colorForId), 'every piece names the story it riffs on');
    assert.equal(p.kind, 'reaction', 'color rides the reaction surface');
  }
  assert.deepEqual(
    out.items.filter(i => i.kind === 'story').map(i => i.id),
    storyIdsBefore,
    'composition untouched: same stories, same order',
  );
  const converted = pieces.filter(p => p.id.startsWith('reaction'));
  assert.ok(converted.length >= 1, 'reaction slots convert in place (plan ids kept)');
  const closeout = pieces.find(p => p.id === 'color:closeout');
  assert.ok(closeout, 'one closeout line is authored');
  assert.equal(out.items[out.items.length - 1], closeout, 'the closeout is the plan\u2019s last piece');
  assert.equal(out.totalSec, out.items.reduce((s, i) => s + i.durationSec, 0), 'totalSec recomputed over the final items');
});

await checkAsync('color: suppressed stories get no piece; over-cap text is discarded whole', async () => {
  const units = [
    unit('w1|landmark_origin', 32.72),
    unit('w2|landmark_origin', 32.76),
    unit('s3|landmark_origin', 32.80, { tone: 'somber' }),
    unit('w4|landmark_origin', 32.84),
  ];
  const plan = rm.composeRoutePlan(units, path, dest, 'Dest',
    { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] },
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 3000 });
  const out = await rc.colorizeRoutePlan(plan, {
    generateColor: async prompt => {
      const subject = prompt.match(/Subject: (.+)\n/)[1];
      if (subject === 'w1|landmark_origin') return 'x'.repeat(rn.COLOR_MAX_CHARS + 40); // over the cap
      return `Color beat for ${subject}.`;
    },
  });
  const pieces = out.items.filter(i => i.voice === 'color-puck');
  assert.ok(!pieces.some(p => p.colorForId === 's3|landmark_origin'), 'no color on or after the somber story');
  assert.ok(!pieces.some(p => p.colorForId === 'w1|landmark_origin'), 'the over-cap piece was discarded, not truncated');
  assert.ok(pieces.some(p => p.colorForId === 'w2|landmark_origin'), 'clean stories still take color');
  assert.ok(pieces.some(p => p.colorForId === 'w4|landmark_origin'), 'the closeout still lands');
  for (const p of pieces) assert.ok(p.text.length <= rn.COLOR_MAX_CHARS, 'every surviving piece is within the cap');
  // The reaction slot that follows the somber story (when
  // the composer placed one there) keeps its bank line.
  const s3Idx = out.items.findIndex(i => i.id === 's3|landmark_origin');
  const after = out.items[s3Idx + 1];
  if (after && after.kind === 'reaction') {
    assert.equal(after.voice, undefined, 'the reaction after the somber story stays Miles\u2019 bank line');
    assert.ok(rn.REACTION_BANK.includes(after.text), 'bank text verbatim');
  }
});

await checkAsync('color: a piece dies with its story — the runner never sounds color for a dropped story', async () => {
  const plan0 = finePlan();
  const plan = await rc.colorizeRoutePlan(plan0, {
    generateColor: async prompt => `Color beat for ${prompt.match(/Subject: (.+)\n/)[1]}.`,
  });
  const pieceB = plan.items.find(i => i.colorForId === 'b|landmark_origin');
  const pieceC = plan.items.find(i => i.colorForId === 'c|landmark_origin');
  assert.ok(pieceB, 'fixture: story B carries a color piece');
  assert.ok(pieceC, 'fixture: story C carries a color piece');
  const audio = new RealFakeAudio(250);
  const events = [];
  const outcomes = [];
  const runner = p1Runner(audio, events, outcomes);
  await runner.start(plan);
  await until(() => audio.played.some(u => u.includes('a%7Clandmark_origin.wav')), 'story A sounds');
  runner.onPosition({ lat: 32.795, lng: -117.25 }); // one jump fix past B's window — B gate-drops (the lane-3 shape)
  await until(
    () => events.some(e => e.t === 'story_dropped' && e.p.subject === 'b|landmark_origin'),
    'B drops stale',
  );
  runner.onPosition({ lat: 32.87, lng: -117.25 }); // inside C's window
  await until(() => audio.played.some(u => u.includes('c%7Clandmark_origin.wav')), 'story C sounds');
  await until(() => audio.played.map(decodedOf).includes(pieceC.text), 'C\u2019s color piece sounds after C');
  runner.onPosition({ lat: 32.9, lng: -117.25 }); // arrival
  await until(() => runner.view().closeoutDone, 'arrival closeout');
  await until(() => outcomes.length === 1, 'outcome filed');
  const playedTexts = audio.played.map(decodedOf);
  assert.ok(!playedTexts.includes(pieceB.text), 'B\u2019s color piece never sounded');
  const out = outcomes[0];
  assert.deepEqual(verifier.validateOutcome(out), [], 'the live verifier accepts the color outcome row');
  const droppedColor = out.dropped.find(d => d.id === pieceB.id);
  assert.ok(droppedColor, 'the outcome names the color piece among the dropped');
  assert.equal(droppedColor.reason, 'parent-dropped', 'dropped because its story died — the doomed lead-in discipline');
  runner.endTour();
});

check('coloring capture: the rating and the color pieces ride the plan payload (schema stays 2)', () => {
  const storyUnit = unit('s1|landmark_origin', 32.71);
  const items = [
    { kind: 'preview', id: 'preview', label: 'Preview', durationSec: 20, text: 'PREVIEW TEXT', ready: true },
    { kind: 'story', id: storyUnit.id, label: 'S1', durationSec: 100, unit: storyUnit, ready: true, anchorProgress: 0.1, releaseProgress: 0.1, expireProgress: 0.3 },
    { kind: 'reaction', id: 'reaction-0', label: 'Color commentary', durationSec: 12, text: 'COLOR TEXT', voice: 'color-puck', colorForId: storyUnit.id, ready: true },
    { kind: 'reaction', id: 'reaction-1', label: 'Reaction', durationSec: 5, text: 'BANK TEXT', ready: true },
  ];
  const plan = { destinationName: 'Dest', destination: dest, path, driveSec: 1000, budgetSec: 1000, items, wrapUp: null, audience: 'family' };
  const payload = ec.assemblePlanCapture({
    tourId: 'route-1',
    buildId: 'fresh-test',
    context: { ...captureCtx, audience: 'family' },
    plan,
    routePlanStarted: null,
    items: ec.assemblePlanItems(plan, new Set(items.map(i => i.id))),
  });
  assert.equal(payload.schema, 2, 'additive fields only — the schema stays 2');
  assert.equal(payload.audience, 'family', 'the rating rides the plan row');
  assert.equal(payload.color_pieces, 1, 'the color piece count rides the plan row');
  const colorItem = payload.items.find(i => i.id === 'reaction-0');
  assert.equal(colorItem.voice, 'color-puck', 'the piece itself is marked in items[]');
  assert.equal(colorItem.text, 'COLOR TEXT', 'the color text is captured like every tissue text');
  const bankItem = payload.items.find(i => i.id === 'reaction-1');
  assert.equal(bankItem.voice, null, 'Miles-solo pieces carry no voice mark');
});

// ── Unfiltered humor layer (Nov 6, 2026) ─────────────────
// The shipped bank is Erik's REVIEWED bank (populated
// Nov 6, 2026): the first suite pins its contents and its
// lint. The draw suites below inject a FIXTURE bank of
// obviously-test lines through the colorize deps —
// production draws the shipped bank, never a fixture.
// The layer's contract, per the scope + Erik's rulings:
// bank-primary hybrid under the shared 5-piece color cap,
// humor capped at 2, memorial kill episode-wide, adjacency
// suppression on both neighbors, 20-drive cooldown through
// the drive records, and — with no bank draws available —
// PROVABLY inert (an Unfiltered build composes and
// colorizes exactly as Standard, modulo generated color).

const testLine = (id, over = {}) => ({
  id,
  text: `TEST LINE ${id}, plain and simple.`,
  heat: 'warm',
  slots: ['reaction', 'bridge', 'wrap-up', 'preview'],
  ...over,
});
const litUnit = (id, over = {}) => ({
  id,
  placeKey: id.split('|')[0],
  placeName: id,
  angle: 'landmark_origin',
  lat: 32.78,
  lng: -117.25,
  durationSec: 120,
  topics: [],
  tone: 'warm',
  toneSecondary: null,
  protectedRegister: false,
  audioPath: `x/${id}.wav`,
  storyText: 'word '.repeat(60),
  ...over,
});
const litStory = (id, unitOver = {}) => ({
  kind: 'story',
  id,
  label: id,
  durationSec: 120,
  unit: litUnit(id, unitOver),
  ready: true,
});
const litReaction = id => ({ kind: 'reaction', id, label: 'Reaction', durationSec: 5, text: 'Bank reaction line.', ready: true });
const litPlan = (items, over = {}) => ({
  destinationName: 'Dest',
  destination: dest,
  path,
  audience: 'unfiltered',
  driveSec: 1200,
  budgetSec: 1200,
  items,
  totalSec: items.reduce((s, i) => s + i.durationSec, 0),
  thread: null,
  threadSource: 'none',
  climaxUnitId: null,
  routeChoice: null,
  ...over,
});
const genBeat = async () => 'Generated color beat.';
const humorPiecesOf = plan => plan.items.filter(i => i.humor === true);
const colorPiecesOf = plan => plan.items.filter(i => i.voice === 'color-puck');

check('unfiltered: THE REVIEWED BANK — Erik’s approved lines are in, lint-clean, the audit kill applied', () => {
  assert.equal(hb.HUMOR_BANK.length, 149, 'the reviewed bank: 150 drafted lines minus the audit’s one kill');
  assert.ok(!hb.HUMOR_BANK.some(l => l.id === 'T-10'), 'T-10 (the checkpoint line) does NOT ship — the drafter’s expected kill, applied on Erik’s approval');
  assert.deepEqual(hb.validateHumorBank(hb.HUMOR_BANK), [], 'the shipped bank passes the lint');
  assert.equal(hb.HUMOR_MAX_PER_EPISODE, 2, 'the ruled humor cap');
  assert.equal(hb.HUMOR_COOLDOWN_DRIVES, 20, 'the ruled cooldown window');
});

check('unfiltered: the bank lint catches the shapes the review workflow must reject', () => {
  assert.deepEqual(hb.validateHumorBank([testLine('ok-1'), testLine('ok-2')]), [], 'a clean fixture bank passes');
  assert.ok(hb.validateHumorBank([testLine('dup'), testLine('dup')]).some(p => p.includes('duplicate')), 'duplicate ids caught');
  assert.ok(hb.validateHumorBank([testLine('long', { text: 'x'.repeat(201) })]).length > 0, 'over-cap text caught');
  assert.ok(hb.validateHumorBank([testLine('noslot', { slots: [] })]).length > 0, 'empty slots caught');
  assert.ok(hb.validateHumorBank([testLine('badheat', { heat: 'nuclear' })]).length > 0, 'invalid heat caught');
  assert.ok(hb.validateHumorBank([testLine('badexp', { expires: 'next spring' })]).length > 0, 'non-ISO expires caught');
});

await checkAsync('unfiltered: inert with no bank draws available — composition and colorize are Standard-identical', async () => {
  const units = [32.71, 32.74, 32.77, 32.8, 32.83, 32.86, 32.88].map((lat, i) => unit(`s${i + 1}|landmark_origin`, lat));
  const composeAs = aud =>
    rm.composeRoutePlan(units, path, dest, 'Dest',
      { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [], audience: aud },
      { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 3000 });
  const stdPlan = composeAs('standard');
  const unfPlan = composeAs('unfiltered');
  assert.deepEqual(
    unfPlan.items.map(i => [i.kind, i.id]),
    stdPlan.items.map(i => [i.kind, i.id]),
    'composition parity: an Unfiltered build composes the identical plan shape as Standard',
  );
  let stdCalls = 0;
  let unfCalls = 0;
  const stdOut = await rc.colorizeRoutePlan(stdPlan, {
    generateColor: async () => {
      stdCalls += 1;
      return 'Generated color beat.';
    },
  });
  const unfOut = await rc.colorizeRoutePlan(unfPlan, {
    generateColor: async () => {
      unfCalls += 1;
      return 'Generated color beat.';
    },
    // No bank draws available (the pre-population posture):
    // the bank stage finds nothing, the generated stage must
    // behave exactly as Standard's.
    humorBank: [],
  });
  const shape = p => p.items.map(i => [i.kind, i.id, i.text ?? null, i.voice ?? null, i.colorForId ?? null]);
  assert.deepEqual(shape(unfOut), shape(stdOut), 'with no bank draws available, Unfiltered colorizes EXACTLY as Standard');
  assert.equal(unfCalls, stdCalls, 'the generator is called the same number of times');
  assert.equal(humorPiecesOf(unfOut).length, 0, 'zero humor pieces — no draws, no humor');
});

await checkAsync('unfiltered: bank draw basics — a generic line fills a slot, flagged and verbatim', async () => {
  const plan = litPlan([litStory('a|landmark_origin'), litReaction('reaction-0')]);
  const line = testLine('test-basic');
  const out = await rc.colorizeRoutePlan(plan, { generateColor: genBeat, humorBank: [line] });
  const pieces = humorPiecesOf(out);
  assert.equal(pieces.length, 1, 'one humor piece');
  const p = pieces[0];
  assert.equal(p.humorBankId, 'test-basic');
  assert.equal(p.text, line.text, 'the reviewed text, spoken as authored');
  assert.equal(p.voice, 'color-puck', 'bank pieces ride the color chair');
  assert.equal(p.colorForId, 'a|landmark_origin', 'the piece names its story — the drop gate covers it like any color piece');
  assert.equal(p.id, 'reaction-0', 'a reaction slot converts in place');
  assert.equal(colorPiecesOf(out).length, 1, 'the bank piece IS the slot’s color — no generated piece doubles it');
});

await checkAsync('unfiltered: hybrid precedence + shared cap — bank fills first, generator fills the rest, cap 5 binds both', async () => {
  const units = [32.71, 32.74, 32.77, 32.8, 32.83, 32.86, 32.88].map((lat, i) => unit(`s${i + 1}|landmark_origin`, lat));
  const plan = rm.composeRoutePlan(units, path, dest, 'Dest',
    { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [], audience: 'unfiltered' },
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 3000 });
  const bank = [testLine('test-hyb-1'), testLine('test-hyb-2'), testLine('test-hyb-3'), testLine('test-hyb-4')];
  let genCalls = 0;
  const out = await rc.colorizeRoutePlan(plan, {
    generateColor: async () => {
      genCalls += 1;
      return 'Generated color beat.';
    },
    humorBank: bank,
  });
  const humor = humorPiecesOf(out);
  const generated = colorPiecesOf(out).filter(i => i.humor !== true);
  assert.equal(humor.length, 2, 'humor capped at 2 even with a deep bank');
  assert.equal(colorPiecesOf(out).length, rn.COLOR_MAX_PER_EPISODE, 'the shared 5-piece cap binds bank + generated together');
  assert.equal(generated.length, 3, 'the generator fills exactly the slots the bank left');
  assert.equal(genCalls, 3, 'no wasted generations');
  assert.ok(generated.every(i => i.humor === undefined && i.humorBankId === undefined), 'generated pieces are NEVER humor-flagged');
  assert.deepEqual(humor.map(i => i.humorBankId), ['test-hyb-1', 'test-hyb-2'], 'bank order, first eligible lines first');
});

await checkAsync('unfiltered: adjacency suppression — no humor on a somber story, and none immediately before one', async () => {
  // The neighbor is somber in its SECONDARY slot: suppression
  // class (colorSuppressedFor) but NOT memorial class. Since
  // the Nov 7 narrowing, even a somber-PRIMARY story does not
  // trip the episode-wide kill without the audit's flag —
  // only its neighborhood is suppressed (the kill itself is
  // the memorial suite's, below).
  const plan = litPlan([
    litStory('a|landmark_origin'),
    litReaction('reaction-0'),
    litStory('b|landmark_origin', { toneSecondary: 'somber' }),
    litReaction('reaction-1'),
    litStory('c|landmark_origin'),
    litReaction('reaction-2'),
  ]);
  const out = await rc.colorizeRoutePlan(plan, { generateColor: genBeat, humorBank: [testLine('test-adj')] });
  const humor = humorPiecesOf(out);
  assert.equal(humor.length, 1, 'exactly one slot in the plan is humor-eligible');
  assert.equal(humor[0].id, 'reaction-2', 'the draw lands after the clean closing story — not before the somber one');
  const before = out.items.find(i => i.id === 'reaction-0');
  assert.equal(before.voice, 'color-puck', 'generated color may still precede somber ground (its own rule is target-only)');
  assert.ok(before.humor !== true, 'but it is not humor');
  const onSomber = out.items.find(i => i.id === 'reaction-1');
  assert.equal(onSomber.voice, undefined, 'no piece of any kind rides the somber story');
});

check('memorial audit: THE AUDITED SET — the bundled map carries exactly the Nov 7 audit’s memorial rows', () => {
  const keys = Object.keys(rmd.ROUTE_MEMORIAL);
  assert.equal(keys.length, 12, 'twelve audited memorial tellings (of 48 Protected/somber candidates read against their live texts)');
  // The death-event tellings: a real death event is the subject.
  for (const k of [
    'fort rosecrans national cemetery|landmark_origin', // the Bennington explosion, 66 sailors
    'fort rosecrans national cemetery|landmark_people', // the Bennington dead and their obelisk
    'i-805 north: kearny mesa to university city|corridor', // Hickman's 1959 death dive
    'i-805 south: university city to kearny mesa|corridor', // Hickman
    'sr-52 west: kearny mesa to clairemont|corridor', // Hickman
    'sr-52 east: la jolla to clairemont|corridor', // Hickman as the climax
    'cabrillo national monument|landmark_event', // Cabrillo's death, the monument his only headstone
    'junipero serra museum|landmark_people', // the 1775 killing of Fr. Jayme (judgment call)
    'hatfield-the-rainmaker|filler_hosted', // the 1916 flood — 'the disaster claimed lives' (filler angle)
    'poway|neighborhood_intro', // the 2019 Chabad of Poway shooting (intro angle)
    'poway|neighborhood_intro_greet', // the same narration, greet variant
  ]) assert.equal(rmd.ROUTE_MEMORIAL[k], true, `${k} is memorial`);
  // The one memorial-itself call: the telling's subject is the memorial.
  assert.equal(
    rmd.ROUTE_MEMORIAL['mount soledad national veterans memorial|landmark_event'],
    true,
    'the Soledad walls telling: the memorial itself is the subject (the closest call — Erik reviews it)',
  );
  // The exclusions that free the commute and the corridor.
  for (const k of [
    'mount soledad national veterans memorial|landmark_origin', // the cross's legal war, not the memorial
    'mount soledad national veterans memorial|landmark_scandal', // the legal war again
    'i-805 north: lincoln park to north park|corridor', // the Gill text — no 182 narration lives on the shelf here
    'i-805 south: north park to lincoln park|corridor', // 182 is one allusive sentence, not the subject
    'fort rosecrans national cemetery|landmark_surroundings', // whaling surroundings
    'mount hope cemetery|landmark_origin', // cemetery-general civic history
    'el campo santo cemetery|landmark_origin', // uncertain — classified out, promotable on re-audit
    'berkeley ferryboat|landmark_event', // uncertain — classified out, promotable on re-audit
  ]) assert.equal(rmd.ROUTE_MEMORIAL[k], undefined, `${k} is NOT memorial`);
  assert.equal(rmd.memorialFor('mount soledad national veterans memorial', 'landmark_origin'), false);
  assert.equal(rmd.memorialFor('fort rosecrans national cemetery', 'landmark_people'), true);
  assert.equal(rmd.memorialFor('never audited', 'landmark_origin'), false, 'unclassified reads not-memorial — the safe direction');
});

check('unfiltered: memorialClassFor — the audited flag alone, never the register or the tone', () => {
  assert.equal(rm.memorialClassFor(litUnit('x|a', { memorial: true })), true, 'an audited memorial telling is memorial class');
  assert.equal(rm.memorialClassFor(litUnit('x|a', { protectedRegister: true })), false, 'Protected alone no longer kills — the Soledad commute case');
  assert.equal(rm.memorialClassFor(litUnit('x|a', { tone: 'somber' })), false, 'somber primary alone no longer kills');
  assert.equal(rm.memorialClassFor(litUnit('x|a', { protectedRegister: true, tone: 'somber' })), false, 'even Protected + somber together need the audit’s flag');
  assert.equal(rm.memorialClassFor(litUnit('x|a', { toneSecondary: 'somber' })), false, 'somber in the secondary slot only ever suppressed its neighborhood');
  assert.equal(rm.memorialClassFor(litUnit('x|a', { tone: 'spooky' })), false, 'spooky is suppression class, not memorial class');
  assert.equal(rm.memorialClassFor(litUnit('x|a', { angle: 'landmark_scandal' })), false, 'scandal is suppression class, not memorial class');
  assert.equal(rm.memorialClassFor(litUnit('x|a')), false, 'an unflagged story is not memorial class');
});

await checkAsync('unfiltered: the memorial kill is episode-wide — and the Soledad commute case no longer triggers it', async () => {
  const bank = [testLine('test-kill')];
  // The kill case: a unit carrying the audit's memorial flag —
  // a PSA 182-class fixture (a death-event telling).
  const killPlan = litPlan([
    litStory('a|landmark_origin'),
    litReaction('reaction-0'),
    litStory('m|landmark_origin', { memorial: true }),
    litReaction('reaction-1'),
    litStory('c|landmark_origin'),
    litReaction('reaction-2'),
  ]);
  const killed = await rc.colorizeRoutePlan(killPlan, { generateColor: genBeat, humorBank: bank });
  assert.equal(humorPiecesOf(killed).length, 0, 'a memorial telling in the cast: zero humor anywhere in the episode');
  assert.ok(colorPiecesOf(killed).length >= 1, 'generated color still proceeds, as in Standard');

  // The commute case (the Nov 7 narrowing's reason to exist):
  // Erik's NBSD drive carries Mount Soledad's ORIGIN angle,
  // baked exactly as production bakes it — Protected register,
  // reflective tone, and the memorial flag the audit actually
  // assigns it (false: the telling's subject is the cross's
  // legal war, not the memorial). Under the pre-narrowing
  // mechanical reading this cast drew ZERO humor.
  const soledad = 'mount soledad national veterans memorial';
  const commutePlan = litPlan([
    litStory(`${soledad}|landmark_origin`, {
      protectedRegister: true,
      tone: 'reflective',
      memorial: rmd.memorialFor(soledad, 'landmark_origin'),
    }),
    litReaction('reaction-0'),
    litStory('b|landmark_origin'),
    litReaction('reaction-1'),
    litStory('c|landmark_origin'),
    litReaction('reaction-2'),
  ]);
  const commute = await rc.colorizeRoutePlan(commutePlan, { generateColor: genBeat, humorBank: bank });
  const commuteHumor = humorPiecesOf(commute);
  assert.equal(commuteHumor.length, 1, 'a Protected non-memorial cast member no longer silences the episode — humor draws proceed');
  assert.equal(commuteHumor[0].id, 'reaction-1', 'the draw lands past the Protected story’s own suppressed slot, on clean ground');

  // Somber-primary without the audit's flag: no kill either —
  // its neighborhood is suppressed, the episode still laughs.
  const somberPlan = litPlan([
    litStory('a|landmark_origin'),
    litReaction('reaction-0'),
    litStory('m|landmark_origin', { tone: 'somber' }),
    litReaction('reaction-1'),
    litStory('c|landmark_origin'),
    litReaction('reaction-2'),
  ]);
  const somberOut = await rc.colorizeRoutePlan(somberPlan, { generateColor: genBeat, humorBank: bank });
  const somberHumor = humorPiecesOf(somberOut);
  assert.equal(somberHumor.length, 1, 'a somber-primary non-memorial story suppresses only its neighborhood now');
  assert.equal(somberHumor[0].id, 'reaction-2');

  const spookyPlan = litPlan([
    litStory('a|landmark_origin'),
    litReaction('reaction-0'),
    litStory('s|landmark_origin', { tone: 'spooky' }),
    litReaction('reaction-1'),
    litStory('c|landmark_origin'),
    litReaction('reaction-2'),
  ]);
  const out = await rc.colorizeRoutePlan(spookyPlan, { generateColor: genBeat, humorBank: bank });
  const humor = humorPiecesOf(out);
  assert.equal(humor.length, 1, 'a spooky cast member suppresses only its neighborhood — the episode still laughs');
  assert.equal(humor[0].id, 'reaction-2');
});

await checkAsync('unfiltered: spacing — humor targets sit a full story apart; the first-story zone holds one', async () => {
  const plan = litPlan([
    litStory('a|landmark_origin'),
    litReaction('reaction-0'),
    litReaction('reaction-0b'),
    litStory('b|landmark_origin'),
    litReaction('reaction-1'),
    litStory('c|landmark_origin'),
    litReaction('reaction-2'),
  ]);
  const bank = [testLine('test-sp-1'), testLine('test-sp-2'), testLine('test-sp-3')];
  const out = await rc.colorizeRoutePlan(plan, { generateColor: genBeat, humorBank: bank });
  const humor = humorPiecesOf(out);
  assert.deepEqual(humor.map(i => i.id), ['reaction-0', 'reaction-2'], 'one humor piece in the first-story zone, the next a full story later');
  const second = out.items.find(i => i.id === 'reaction-0b');
  assert.equal(second.voice, 'color-puck', 'the second first-zone slot still gets color');
  assert.ok(second.humor !== true, 'generated, not humor — the early zone holds ONE joke');
  const mid = out.items.find(i => i.id === 'reaction-1');
  assert.ok(mid.humor !== true, 'no humor adjacent to a humor target');
});

await checkAsync('unfiltered: heat spacing + the episode ledger — never two roasts, never a repeat', async () => {
  const plan = litPlan([
    litStory('a|landmark_origin'),
    litReaction('reaction-0'),
    litStory('b|landmark_origin'),
    litReaction('reaction-1'),
    litStory('c|landmark_origin'),
    litReaction('reaction-2'),
    litStory('d|landmark_origin'),
    litReaction('reaction-3'),
    litStory('e|landmark_origin'),
    litReaction('reaction-4'),
  ]);
  const bank = [
    testLine('test-roast-1', { heat: 'roast' }),
    testLine('test-roast-2', { heat: 'roast' }),
    testLine('test-warm-1'),
  ];
  const out = await rc.colorizeRoutePlan(plan, { generateColor: genBeat, humorBank: bank });
  assert.deepEqual(
    humorPiecesOf(out).map(i => i.humorBankId),
    ['test-roast-1', 'test-warm-1'],
    'the second draw skips the second roast and takes the warm line',
  );
  const solo = await rc.colorizeRoutePlan(plan, { generateColor: genBeat, humorBank: [testLine('test-solo')] });
  assert.equal(humorPiecesOf(solo).length, 1, 'a single eligible line is drawn at most once across five slots — the ledger holds');
});

await checkAsync('unfiltered: slot surfaces — preview lines only at the first slot, wrap-up lines only at the closeout', async () => {
  const previewLine = testLine('test-preview', { slots: ['preview'] });
  const clean = litPlan([
    litStory('a|landmark_origin'),
    litReaction('reaction-0'),
    litStory('b|landmark_origin'),
    litReaction('reaction-1'),
  ]);
  const outClean = await rc.colorizeRoutePlan(clean, { generateColor: genBeat, humorBank: [previewLine] });
  assert.deepEqual(humorPiecesOf(outClean).map(i => i.id), ['reaction-0'], 'a preview line draws at the episode’s first color slot');
  const blockedFirst = litPlan([
    litStory('s|landmark_origin', { tone: 'spooky' }),
    litReaction('reaction-0'),
    litStory('a|landmark_origin'),
    litReaction('reaction-1'),
    litStory('b|landmark_origin'),
    litReaction('reaction-2'),
  ]);
  const outBlocked = await rc.colorizeRoutePlan(blockedFirst, { generateColor: genBeat, humorBank: [previewLine] });
  assert.equal(humorPiecesOf(outBlocked).length, 0, 'when the first slot is humor-ineligible, a preview line does not migrate later');
  const wrapLine = testLine('test-wrap', { slots: ['wrap-up'] });
  const withCloseout = litPlan([litStory('a|landmark_origin'), litReaction('reaction-0'), litStory('b|landmark_origin')]);
  const outWrap = await rc.colorizeRoutePlan(withCloseout, { generateColor: genBeat, humorBank: [wrapLine] });
  const wrapPieces = humorPiecesOf(outWrap);
  assert.equal(wrapPieces.length, 1, 'a wrap-up line draws when a closeout slot exists');
  assert.equal(wrapPieces[0].id, 'color:closeout');
  assert.equal(outWrap.items[outWrap.items.length - 1], wrapPieces[0], 'the closeout rides the tail');
  const noCloseout = litPlan([litStory('a|landmark_origin'), litReaction('reaction-0'), litStory('b|landmark_origin'), litReaction('reaction-1')]);
  const outNoWrap = await rc.colorizeRoutePlan(noCloseout, { generateColor: genBeat, humorBank: [wrapLine] });
  assert.equal(humorPiecesOf(outNoWrap).length, 0, 'no closeout slot (the closing story is reaction-covered) → no wrap-up draw');
});

await checkAsync('unfiltered: contexts, exclusions, fills, expiry — the draw reads the episode’s real facts', async () => {
  const oneStory = (unitOver = {}, planOver = {}) =>
    litPlan([litStory('x|landmark_origin', unitOver), litReaction('reaction-0')], planOver);
  const draws = async (plan, line) =>
    humorPiecesOf(await rc.colorizeRoutePlan(plan, { generateColor: genBeat, humorBank: [line] })).length === 1;

  assert.ok(await draws(oneStory({ topics: ['Navy Century'] }), testLine('c-topic', { contexts: { topics: ['Navy Century'] } })), 'topic context matches the cast');
  assert.ok(!(await draws(oneStory({ topics: [] }), testLine('c-topic2', { contexts: { topics: ['Navy Century'] } }))), 'topic context fails without the topic');
  assert.ok(await draws(oneStory(), testLine('c-region', { contexts: { regions: ['coast'] } })), 'region context matches the cast’s ground (fixture coast)');
  assert.ok(!(await draws(oneStory(), testLine('c-region2', { contexts: { regions: ['east'] } }))), 'region context fails on other ground');
  assert.ok(await draws(oneStory({ placeKey: 'harbor' }), testLine('c-place', { contexts: { placeKeys: ['harbor'] } })), 'place_key context matches');
  assert.ok(!(await draws(oneStory({ placeKey: 'harbor' }), testLine('c-place2', { contexts: { placeKeys: ['airport'] } }))), 'place_key context fails');
  const threaded = { thread: { topic: 'Navy Century', label: 'Navy Century', anchorKind: 'destination', anchorKey: 'k', memberIds: [], score: 5 } };
  assert.ok(await draws(oneStory({}, threaded), testLine('c-anchor', { contexts: { anchorKinds: ['destination'] } })), 'anchor-kind context matches the thread');
  assert.ok(!(await draws(oneStory({}, threaded), testLine('c-anchor2', { contexts: { anchorKinds: ['origin'] } }))), 'anchor-kind context fails');

  const roadPlan = labels =>
    oneStory({}, {
      routeChoice: { offered: [{ description: 'via the freeway', durationSec: 600, distanceMeters: 9000, routeLabels: labels }], pickerShown: true, pickedIndex: 0 },
    });
  const roadLine = testLine('c-road', { contexts: { roads: ['I-5'] }, text: 'TEST rolling {road} now.' });
  const roadOut = await rc.colorizeRoutePlan(roadPlan(['I-5 S']), { generateColor: genBeat, humorBank: [roadLine] });
  const roadPiece = humorPiecesOf(roadOut)[0];
  assert.ok(roadPiece, 'road context matches the picked route’s labels');
  assert.ok(roadPiece.text.includes('Interstate 5'), 'the {road} fill landed with the route’s real label (spoken-formed for the TTS)');
  assert.ok(!roadPiece.text.includes('{'), 'no unfilled token airs');
  assert.ok(!(await draws(roadPlan(['I-805 S']), roadLine)), 'road context fails on a different road');

  // The PRODUCTION shape (verified live against the Routes API
  // Nov 6, 2026): routeLabels carry only DEFAULT_ROUTE /
  // DEFAULT_ROUTE_ALTERNATE — the road NAME rides the picked
  // route's description. A road-gated line must draw off the
  // description, and the {road} fill must bind it.
  const prodRoadPlan = (description, labels = ['DEFAULT_ROUTE']) =>
    oneStory({}, {
      routeChoice: { offered: [{ description, durationSec: 600, distanceMeters: 9000, routeLabels: labels }], pickerShown: true, pickedIndex: 0 },
    });
  const prodOut = await rc.colorizeRoutePlan(prodRoadPlan('I-5 S'), { generateColor: genBeat, humorBank: [roadLine] });
  const prodPiece = humorPiecesOf(prodOut)[0];
  assert.ok(prodPiece, 'production shape: labels [DEFAULT_ROUTE] + description "I-5 S" — the road-gated line draws off the description');
  assert.ok(prodPiece.text.includes('Interstate 5'), 'the {road} fill binds the description, spoken-formed for the TTS');
  assert.ok(!prodPiece.text.includes('{'), 'no unfilled token airs (production shape)');
  assert.ok(!(await draws(prodRoadPlan('I-805 S', ['DEFAULT_ROUTE_ALTERNATE']), roadLine)), 'production shape: a different road in the description fails the gate');
  const guardLine = testLine('c-road-i8', { contexts: { roads: ['I-8 '] }, text: 'TEST rolling {road} now.' });
  assert.ok(!(await draws(prodRoadPlan('I-805 S'), guardLine)), 'the I-8 trailing-space guard holds against an I-805 description');
  assert.ok(await draws(prodRoadPlan('I-8 E'), guardLine), 'the I-8 gate matches a real I-8 description');

  const fillLine = testLine('c-fill', { text: 'TEST bound for {destination} past {place}.' });
  const fillOut = await rc.colorizeRoutePlan(oneStory({ placeName: 'Harbor' }), { generateColor: genBeat, humorBank: [fillLine] });
  assert.equal(humorPiecesOf(fillOut)[0].text, 'TEST bound for Dest past Harbor.', '{destination} and {place} fill from the plan and the target story');
  assert.ok(!(await draws(oneStory(), testLine('c-bogus', { text: 'TEST {bogus} token.' }))), 'an unfillable token never airs');

  assert.ok(!(await draws(oneStory({ topics: ['Fire & Fault'] }), testLine('c-excl', { exclusions: { topics: ['Fire & Fault'] } }))), 'an exclusion vetoes its line for the episode');
  assert.ok(await draws(oneStory({ topics: [] }), testLine('c-excl2', { exclusions: { topics: ['Fire & Fault'] } })), 'the same line draws when the excluded topic is absent');
  assert.ok(!(await draws(oneStory(), testLine('c-exp', { expires: '2000-01-01' }))), 'an expired line is dead');
  assert.ok(await draws(oneStory(), testLine('c-exp2', { expires: '2999-01-01' })), 'an unexpired line lives');
});

check('unfiltered: the cooldown store — line ids round-trip the drive records, the 20-drive window holds', () => {
  const store = fakeStore();
  rh.saveDriveRecord(store, mkRecord({ humorLineIds: ['test-l1', 'test-l2'] }));
  const loaded = rh.loadDriveRecords(store);
  assert.deepEqual(loaded[0].humorLineIds, ['test-l1', 'test-l2'], 'drawn line ids survive the record store');
  assert.deepEqual([...rh.humorCooldownLineIds(loaded)].sort(), ['test-l1', 'test-l2'], 'the cooldown set derives from the records');
  assert.deepEqual(rh.parseDriveRecords(JSON.stringify([mkRecord({ humorLineIds: 'nope' })])), [], 'a malformed humorLineIds drops the record, like every shape violation');
  const window = [
    mkRecord({ humorLineIds: ['new-line'] }),
    ...Array.from({ length: 19 }, () => mkRecord({})),
    mkRecord({ humorLineIds: ['old-line'] }),
  ];
  const ids = rh.humorCooldownLineIds(window);
  assert.ok(ids.has('new-line'), 'the newest draw is in the window');
  assert.ok(!ids.has('old-line'), 'the 21st-newest record is outside the 20-drive window');
});

await checkAsync('unfiltered: cooldown across drives — drive 1’s draws are drive 2’s exclusions', async () => {
  const plan = () =>
    litPlan([
      litStory('a|landmark_origin'),
      litReaction('reaction-0'),
      litStory('b|landmark_origin'),
      litReaction('reaction-1'),
      litStory('c|landmark_origin'),
      litReaction('reaction-2'),
      litStory('d|landmark_origin'),
      litReaction('reaction-3'),
    ]);
  const bank = [testLine('test-cd-1'), testLine('test-cd-2'), testLine('test-cd-3')];
  const d1 = await rc.colorizeRoutePlan(plan(), { generateColor: genBeat, humorBank: bank });
  const drawn1 = humorPiecesOf(d1).map(i => i.humorBankId);
  assert.deepEqual(drawn1, ['test-cd-1', 'test-cd-2'], 'drive 1 draws the first two lines (slots a and c, spacing between)');
  const store = fakeStore();
  rh.saveDriveRecord(store, mkRecord({ humorLineIds: drawn1 }));
  const d2 = await rc.colorizeRoutePlan(plan(), {
    generateColor: genBeat,
    humorBank: bank,
    humorCooldownIds: rh.humorCooldownLineIds(rh.loadDriveRecords(store)),
  });
  assert.deepEqual(humorPiecesOf(d2).map(i => i.humorBankId), ['test-cd-3'], 'drive 2 skips both cooled lines and draws the fresh one');
  const d3 = await rc.colorizeRoutePlan(plan(), {
    generateColor: genBeat,
    humorBank: bank,
    humorCooldownIds: new Set(['test-cd-1', 'test-cd-3']),
  });
  assert.deepEqual(humorPiecesOf(d3).map(i => i.humorBankId), ['test-cd-2'], 'a cooled first line falls back to the next eligible line');
});

await checkAsync('unfiltered: Family stays a strict no-op even with a bank in hand', async () => {
  const fam = litPlan([litStory('a|landmark_origin'), litReaction('reaction-0')], { audience: 'family' });
  let calls = 0;
  const out = await rc.colorizeRoutePlan(fam, {
    generateColor: async () => {
      calls += 1;
      return 'Generated color beat.';
    },
    humorBank: [testLine('test-fam')],
  });
  assert.equal(out, fam, 'the family plan passes through untouched (same object)');
  assert.equal(calls, 0, 'the generator never runs under Family');
  assert.equal(humorPiecesOf(out).length, 0, 'the bank never draws under Family — there is no sanitized humor');
});

await checkAsync('unfiltered: the runner files drawn humor ids into the drive record; a humorless plan files none', async () => {
  const base = finePlan();
  const storyA = base.items.find(i => i.kind === 'story');
  const humorPiece = {
    kind: 'reaction',
    id: 'humor-injected',
    label: 'Color commentary',
    durationSec: 5,
    text: 'TEST humor beat.',
    voice: 'color-puck',
    colorForId: storyA.id,
    humor: true,
    humorBankId: 'test-line-9',
    ready: true,
  };
  const items = [];
  for (const it of base.items) {
    items.push(it);
    if (it === storyA) items.push(humorPiece);
  }
  const runToRecord = async plan => {
    const records = [];
    const heard = [];
    const runner = new rp.RoutePlanRunner({
      audio: new RealFakeAudio(300),
      synthUrl: async t => 'blob:audio/' + encodeURIComponent(t.slice(0, 16)),
      onStoryHeard: u => heard.push(u.id),
      onDriveRecord: r => records.push(r),
      onEvent: () => {},
    });
    await runner.start(plan);
    await until(() => heard.includes('a|landmark_origin'), 'first story sounded');
    runner.onPosition(denseDest);
    await until(() => runner.view().closeoutDone, 'arrival closeout');
    assert.equal(records.length, 1, 'one drive record filed');
    return records[0];
  };
  const withHumor = await runToRecord({ ...base, items });
  assert.deepEqual(withHumor.humorLineIds, ['test-line-9'], 'the drawn line id rides the record — the cooldown’s evidence');
  const without = await runToRecord(finePlan());
  assert.ok(!('humorLineIds' in without), 'a plan with no draws files no humor field — Standard/Family records keep their exact shape');
});

check('unfiltered capture: audience, humor flags and bank ids ride the plan payload (schema stays 2)', () => {
  const storyUnit = unit('s1|landmark_origin', 32.71);
  const items = [
    { kind: 'preview', id: 'preview', label: 'Preview', durationSec: 20, text: 'PREVIEW TEXT', ready: true },
    { kind: 'story', id: storyUnit.id, label: 'S1', durationSec: 100, unit: storyUnit, ready: true, anchorProgress: 0.1, releaseProgress: 0.1, expireProgress: 0.3 },
    { kind: 'reaction', id: 'reaction-0', label: 'Color commentary', durationSec: 9, text: 'TEST HUMOR TEXT', voice: 'color-puck', colorForId: storyUnit.id, humor: true, humorBankId: 'test-cap-1', ready: true },
    { kind: 'reaction', id: 'reaction-1', label: 'Color commentary', durationSec: 12, text: 'GENERATED TEXT', voice: 'color-puck', colorForId: storyUnit.id, ready: true },
  ];
  const plan = { destinationName: 'Dest', destination: dest, path, driveSec: 1000, budgetSec: 1000, items, wrapUp: null, audience: 'unfiltered' };
  const payload = ec.assemblePlanCapture({
    tourId: 'route-1',
    buildId: 'fresh-test',
    context: { ...captureCtx, audience: 'unfiltered' },
    plan,
    routePlanStarted: null,
    items: ec.assemblePlanItems(plan, new Set(items.map(i => i.id))),
  });
  assert.equal(payload.schema, 2, 'additive fields only — the schema stays 2');
  assert.equal(payload.audience, 'unfiltered', 'the state value rides the plan row');
  assert.equal(payload.color_pieces, 2, 'bank and generated pieces both count as color');
  assert.equal(payload.humor_pieces, 1, 'only the bank draw counts as humor');
  assert.deepEqual(payload.humor_bank_ids, ['test-cap-1'], 'the drawn line ids ride the plan row in order');
  const humorItem = payload.items.find(i => i.id === 'reaction-0');
  assert.equal(humorItem.humor, true);
  assert.equal(humorItem.humorBankId, 'test-cap-1');
  const genItem = payload.items.find(i => i.id === 'reaction-1');
  assert.equal(genItem.humor, false, 'a generated piece is captured as NOT humor');
  assert.equal(genItem.humorBankId, null);
});

await checkAsync('unfiltered gapfill: a gap story generated under Unfiltered is stamped standard (the binary stamp)', async () => {
  const drive = 2000;
  const plan = mkPlan([storyAtSec('s1|x', 200, 100, drive), storyAtSec('s2|x', 1800, 100, drive)]);
  plan.driveSec = drive;
  plan.budgetSec = drive;
  plan.audience = 'unfiltered'; // compose stamps this in production; mkPlan is a literal
  const prompts = [];
  const ingested = [];
  await gf.fillRouteGaps(
    plan,
    { fetchedUnits: plan.items.map(i => i.unit), heardKeys: new Set(), input: { ...noInput, audience: 'unfiltered' }, driveSec: drive },
    {
      discoverSubjects: async points => [
        { name: 'The Old Mill', lat: points[1].lat, lng: points[1].lng, types: ['museum'], rating: 4.6, userRatings: 1200, address: null, facts: [] },
      ],
      generateStory: async prompt => {
        prompts.push(prompt);
        return cannedStory(subjectFromPrompt(prompt));
      },
      synthesize: async () => new Blob(['fake-audio']),
      ingest: async ({ unit: u }) => {
        ingested.push(u);
        return 'library/stub.wav';
      },
      onEvent: () => {},
    },
  );
  assert.equal(prompts.length, 1, 'one gap generation under Unfiltered');
  assert.ok(!prompts[0].includes('AUDIENCE: FAMILY'), 'no Family rules block under Unfiltered — the prompt is Standard’s');
  assert.equal(ingested.length, 1);
  assert.equal(ingested[0].generatedRating, 'standard', 'the stamp stays binary: Unfiltered-generated reads standard');
});

// ── Thread re-anchor + thread menu (Nov 5, 2026) ────────
// The detection redesign: class-ordered geo anchors, the
// intersection rule for topics, the N=3 cooldown, the
// Decision-5 climax bar, and the menu contract (contents,
// sources, pick plumbing). Fixtures ride the module-level
// meridian world (path 32.70 → dest 32.90).

const anchorCompose = (units, driveSec = 2400, extraOpts = {}) =>
  leverCompose(units, driveSec, extraOpts);
const resolutionOf = (units, extra = {}) => {
  const pools = rm.partitionRoutePools(units, path, dest, { heardKeys: new Set() });
  return {
    pools,
    res: rm.resolveThreadCandidates({
      geoPool: pools.geoAll,
      wovenSupport: pools.portalAll.filter(u => u.wovenEligible === true),
      path,
      destination: dest,
      ...extra,
    }),
  };
};

check('re-anchor: a destination anchor qualifies on its own cast and beats a deeper topic', () => {
  const units = [
    unit('harbor|landmark_origin', 32.895, { placeName: 'Harbor Gate', topics: ['Food & Drink'] }),
    unit('harbor|landmark_event', 32.9, { placeName: 'Harbor Gate', topics: ['Food & Drink'] }),
    unit('harbor|landmark_people', 32.905, { placeName: 'Harbor Gate', topics: [] }),
    ...[32.74, 32.78, 32.82, 32.86].map((lat, i) => wGeo(`tw${i + 1}|landmark_origin`, lat, 120, `Topic ${i + 1}`)),
  ];
  const { res } = resolutionOf(units);
  assert.deepEqual(
    res.candidates.map(c => ({ kind: c.kind, key: c.key, label: c.label, count: c.count })),
    [
      { kind: 'destination', key: 'harbor', label: 'Harbor Gate', count: 3 },
      { kind: 'topic', key: WT, label: WT, count: 4 },
    ],
    'class order, not score: the destination (3) outranks the deeper topic (4)',
  );
  assert.equal(res.defaultIndex, 0);
  const plan = anchorCompose(units);
  assert.equal(plan.thread?.anchorKind, 'destination');
  assert.equal(plan.thread?.anchorKey, 'harbor');
  assert.equal(plan.thread?.label, 'Harbor Gate');
  assert.equal(plan.thread?.topic, 'Food & Drink', 'the anchor’s extension topic is its cast’s dominant topic');
  assert.equal(plan.threadMenu?.source, 'default-detected');
  assert.equal(plan.threadMenu?.menuShown, false);
  assert.deepEqual(plan.threadMenu?.offered[0], { kind: 'destination', key: 'harbor', label: 'Harbor Gate', count: 3 });
  assert.equal(plan.previewContext?.threadLabel, 'Harbor Gate');
  assert.equal(plan.previewContext?.threadAnchorKind, 'destination');
  const previewText = rn.previewTextFor(plan.previewContext);
  assert.ok(previewText.includes('Harbor Gate'), previewText);
});

check('re-anchor: an on-route place anchors mid-drive — and a topic-less anchor imports nothing', () => {
  const units = [
    ...[32.76, 32.765, 32.77].map((lat, i) =>
      unit(`oldtown|landmark_${['origin', 'event', 'people'][i]}`, lat, { placeName: 'Old Town Square', topics: [] }),
    ),
    ...[32.72, 32.8, 32.84].map((lat, i) => wGeo(`ow${i + 1}|landmark_origin`, lat, 120, `Other ${i + 1}`)),
  ];
  const plan = anchorCompose(units);
  assert.equal(plan.thread?.anchorKind, 'onroute');
  assert.equal(plan.thread?.anchorKey, 'oldtown');
  assert.equal(plan.thread?.label, 'Old Town Square');
  assert.equal(plan.thread?.topic, null, 'a cast with no topic anchors with a null extension topic');
  assert.equal(plan.wovenMembersSeeking, null, 'a topic-less thread seeks no member fetch');
  const seated = rm.seatWovenMembers(plan, units, { heardKeys: new Set() });
  assert.equal(seated, plan, 'a topic-less thread seats no members — the same plan object comes back');
  assert.equal(plan.previewContext?.threadTopic, null);
  assert.equal(plan.previewContext?.threadLabel, 'Old Town Square');
  const previewText = rn.previewTextFor(plan.previewContext);
  assert.ok(previewText.includes('Old Town Square') && previewText.includes('middle'), previewText);
});

check('re-anchor: the origin anchor is the departure place’s own cast', () => {
  const units = [
    ...[32.702, 32.706, 32.71].map((lat, i) =>
      unit(`campus|landmark_${['origin', 'event', 'people'][i]}`, lat, { placeName: 'Campus Gate', topics: ['Faith'] }),
    ),
    ...[32.78, 32.82, 32.86].map((lat, i) => wGeo(`og${i + 1}|landmark_origin`, lat, 120, `Away ${i + 1}`)),
  ];
  const { res } = resolutionOf(units);
  assert.equal(res.candidates[0].kind, 'origin');
  assert.equal(res.candidates[0].key, 'campus');
  const plan = anchorCompose(units);
  assert.equal(plan.thread?.anchorKind, 'origin');
  assert.equal(plan.thread?.label, 'Campus Gate');
  assert.equal(plan.thread?.topic, 'Faith');
});

check('re-anchor: the road itself is a feature — corridor places never pose as on-route places', () => {
  const units = [
    unit('i5-a|corridor', 32.75, { angle: 'corridor', placeName: 'Interstate 5: Mission Bay to Old Town', topics: [] }),
    unit('i5-b|corridor', 32.8, { angle: 'corridor', placeName: 'Interstate 5: Mission Bay to Old Town', topics: [] }),
    ...[32.72, 32.78, 32.84].map((lat, i) => wGeo(`rd${i + 1}|landmark_origin`, lat, 120, `Roadside ${i + 1}`)),
  ];
  const { res } = resolutionOf(units);
  const feature = res.candidates.find(c => c.kind === 'feature');
  assert.ok(feature, 'the road qualifies as a feature');
  assert.equal(feature.key, 'road:Interstate 5');
  assert.equal(feature.label, 'Interstate 5');
  assert.equal(feature.count, 2);
  assert.ok(!res.candidates.some(c => c.kind === 'onroute'), 'corridor-segment places are the road, not places on it');
  const plan = anchorCompose(units);
  assert.equal(plan.thread?.anchorKind, 'feature');
  assert.equal(rm.threadOptionLabel(feature), 'Interstate 5 · the road itself — 2 stories on this drive');
});

check('re-anchor: a geographic topic is a feature only with presence proof', () => {
  const geoCoast = [32.74, 32.78, 32.82].map((lat, i) =>
    unit(`coast${i + 1}|landmark_origin`, lat, { topics: ['Coast'], placeName: `Coast ${i + 1}` }),
  );
  const wovenCoast = n =>
    Array.from({ length: n }, (_, i) =>
      unit(`wcoast${i + 1}|landmark_history`, 32.0, {
        lng: -117.05,
        topics: ['Coast'],
        placeName: `Woven Coast ${i + 1}`,
        wovenEligible: true,
      }),
    );
  const proven = resolutionOf([...geoCoast, ...wovenCoast(1)]).res;
  assert.equal(proven.candidates[0].kind, 'feature', '3 geo of 4 in hand (75%) is presence proof');
  assert.equal(proven.candidates[0].key, 'geo:Coast');
  const unproven = resolutionOf([...geoCoast, ...wovenCoast(3)]).res;
  assert.ok(!unproven.candidates.some(c => c.kind === 'feature'), '3 geo of 6 in hand (50%) is mostly a county topic, not a feature of this road');
  assert.equal(unproven.candidates[0].kind, 'topic', 'the same cast still qualifies as a topic thread — the intersection is real');
  assert.equal(unproven.candidates[0].key, 'Coast');
});

check('re-anchor: the intersection rule — index depth ranks a topic, it can no longer qualify one', () => {
  const twoGeo = [wGeo('ia|landmark_origin', 32.74, 120, 'Index A'), wGeo('ib|landmark_origin', 32.78, 120, 'Index B')];
  const support = new Map([[WT, 12]]);
  const plan = anchorCompose(twoGeo, 2400, { wovenIndexSupport: support });
  assert.equal(plan.thread, null, 'two geo carriers + a deep index → no thread (the exhausted-corridor mint is closed)');
  assert.equal(plan.threadMenu?.source, 'none');
  assert.deepEqual(plan.threadMenu?.offered, []);
  // The legacy detector keeps its exact contract for its
  // own callers — the intersection rule lives in the
  // resolver, not in detectRouteThread.
  assert.equal(rm.detectRouteThread(twoGeo, [], support)?.topic, WT);
});

check('re-anchor: menu labels speak the anchor tie and the honest cast count', () => {
  const mk = (kind, label, count) => ({ kind, key: 'k', label, topic: null, count, score: count, memberIds: [], cooled: false, lastHeadlineIndex: Infinity });
  assert.equal(rm.threadOptionLabel(mk('destination', 'Harbor Gate', 3)), 'Harbor Gate · your destination — 3 stories on this drive');
  assert.equal(rm.threadOptionLabel(mk('onroute', 'Old Town Square', 5)), 'Old Town Square · on your road — 5 stories on this drive');
  assert.equal(rm.threadOptionLabel(mk('origin', 'Campus Gate', 4)), 'Campus Gate · where you start — 4 stories on this drive');
  assert.equal(rm.threadOptionLabel(mk('feature', 'Interstate 5', 2)), 'Interstate 5 · the road itself — 2 stories on this drive');
  assert.equal(rm.threadOptionLabel(mk('topic', WT, 6)), `${WT} · on this drive — 6 stories on this drive`);
});

check('re-anchor: single- and zero-qualifier drives file their sources and never pause', () => {
  const single = anchorCompose([32.74, 32.78, 32.82].map((lat, i) => wGeo(`sq${i + 1}|landmark_origin`, lat, 120, `Solo ${i + 1}`)));
  assert.equal(single.thread?.anchorKind, 'topic');
  assert.equal(single.threadMenu?.source, 'single-qualifier');
  assert.equal(single.threadMenu?.menuShown, false);
  const zero = anchorCompose([wGeo('zq1|landmark_origin', 32.74, 120, 'Zero 1')]);
  assert.equal(zero.thread, null);
  assert.equal(zero.threadMenu?.source, 'none');
  assert.equal(zero.threadMenu?.pickedKey, null);
});

check('re-anchor: the cooldown demotes a repeat headline below every fresh candidate — and never to no-thread', () => {
  const world = () => [
    ...[32.74, 32.78, 32.82].map((lat, i) => wGeo(`cw${i + 1}|landmark_origin`, lat, 120, `Navy ${i + 1}`)),
    ...[32.75, 32.79, 32.83].map((lat, i) =>
      unit(`cf${i + 1}|landmark_origin`, lat, { topics: ['Food & Drink'], placeName: `Food ${i + 1}` }),
    ),
  ];
  const rec = topic => ({
    destinationName: 'Dest',
    destinationPlaceKey: null,
    threadTopic: topic,
    anchorKey: topic,
    playedSubjects: [],
    owedSubjects: [],
    endedAt: NOW,
  });
  const d1 = anchorCompose(world());
  assert.equal(d1.thread?.topic, 'Food & Drink', 'drive 1: tied scores break by label — Food & Drink headlines');
  const d2 = anchorCompose(world(), 2400, { driveRecords: [rec('Food & Drink')] });
  assert.equal(d2.thread?.topic, WT, 'drive 2: the cooled headline yields to the fresh candidate');
  const { res } = resolutionOf(world(), { driveRecords: [rec('Food & Drink')] });
  const cooledRow = res.candidates.find(c => c.key === 'Food & Drink');
  assert.equal(cooledRow.cooled, true, 'the cooled thread is still a candidate — demoted, never hidden');
  assert.notEqual(res.defaultIndex, res.candidates.indexOf(cooledRow), 'a cooled thread is never the default');
  const d3 = anchorCompose(world(), 2400, { driveRecords: [rec(WT), rec('Food & Drink')] });
  assert.equal(d3.thread?.topic, 'Food & Drink', 'drive 3: all cooled → the least-recently-headlined wins; cooldown never forces no-thread');
  // A menu pick is exempt: the cooled thread, chosen, is the
  // episode's thread in full.
  const pick = anchorCompose(world(), 2400, {
    driveRecords: [rec('Food & Drink')],
    threadChoice: {
      candidate: cooledRow,
      menu: {
        offered: res.candidates.map(c => ({ kind: c.kind, key: c.key, label: c.label, count: c.count })),
        menuShown: true,
        source: 'menu-pick',
        pickedKey: 'Food & Drink',
      },
    },
  });
  assert.equal(pick.thread?.topic, 'Food & Drink', 'the pick composes on the cooled thread — cooldown is detection-only');
  assert.equal(pick.threadSource, 'user');
  assert.equal(pick.threadMenu?.source, 'menu-pick');
});

check('menu: a pick composes exactly like a detection — members seat on it, and "Just the road" composes threadless', () => {
  const geo = () => [
    unit('harbor|landmark_origin', 32.895, { placeName: 'Harbor Gate', topics: ['Food & Drink'] }),
    unit('harbor|landmark_event', 32.9, { placeName: 'Harbor Gate', topics: ['Food & Drink'] }),
    unit('harbor|landmark_people', 32.905, { placeName: 'Harbor Gate', topics: [] }),
    ...[32.74, 32.78, 32.82].map((lat, i) => wGeo(`mp${i + 1}|landmark_origin`, lat, 120, `Pick ${i + 1}`)),
  ];
  const { res } = resolutionOf(geo());
  assert.equal(res.candidates.length, 2);
  const topicRow = res.candidates.find(c => c.kind === 'topic');
  const offered = res.candidates.map(c => ({ kind: c.kind, key: c.key, label: c.label, count: c.count }));
  const picked = anchorCompose(geo(), 2400, {
    threadChoice: { candidate: topicRow, menu: { offered, menuShown: true, source: 'menu-pick', pickedKey: topicRow.key } },
  });
  assert.equal(picked.thread?.anchorKind, 'topic', 'the pick, not the destination default, is the thread');
  assert.equal(picked.thread?.topic, WT);
  assert.equal(picked.threadSource, 'user');
  const member = wCand('mpw|landmark_history', 200, { placeName: 'Picked Member' });
  const seated = rm.seatWovenMembers(picked, [...geo(), member], { heardKeys: new Set() });
  assert.ok(seated.wovenMembers.count >= 1, 'members seat on a picked thread exactly as on a detected one');
  // Family: the rating's exclusion lanes bind a picked
  // thread's members exactly as a detected one's — a
  // Protected member never seats under Family, and seats
  // under Standard.
  const protectedMember = wCand('mpbad|landmark_history', 200, { placeName: 'Protected Member', protectedRegister: true });
  const famPlan = rm.composeRoutePlan(
    geo(),
    path,
    dest,
    'Dest',
    { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [], audience: 'family' },
    {
      nowMs: NOW,
      heardKeys: new Set(),
      budgetSecOverride: 2400,
      driveSec: 2400,
      threadChoice: { candidate: topicRow, menu: { offered, menuShown: true, source: 'menu-pick', pickedKey: topicRow.key } },
    },
  );
  const famSeated = rm.seatWovenMembers(famPlan, [...geo(), member, protectedMember], { heardKeys: new Set() });
  assert.ok(!famSeated.wovenMembers.unitIds.includes('mpbad|landmark_history'), 'Family: the Protected member is excluded from a picked thread');
  const stdSeated = rm.seatWovenMembers(picked, [...geo(), member, protectedMember], { heardKeys: new Set() });
  assert.ok(stdSeated.wovenMembers.unitIds.includes('mpbad|landmark_history'), 'Standard: the same member seats (the lane is the rating’s, not the pick’s)');
  const noThread = anchorCompose(geo(), 2400, {
    threadChoice: { candidate: null, menu: { offered, menuShown: true, source: 'menu-pick', pickedKey: null } },
  });
  assert.equal(noThread.thread, null, '"Just the road" composes with no thread even though two qualified');
  assert.equal(noThread.threadSource, null);
  assert.equal(noThread.threadMenu?.source, 'menu-pick');
});

check('re-anchor: Decision 5 — a thread member takes the climax reservation only by clearing the portal bar against the destination', () => {
  const world = memberSec => [
    wGeo('dm1|landmark_origin', 32.74, 200, 'Member One'),
    wGeo('dm2|landmark_origin', 32.8, 300, 'Member Two'),
    wGeo('dm3|landmark_origin', 32.86, memberSec, 'Member Three'),
    unit('dd1|landmark_origin', 32.895, { placeName: 'Destination Story', topics: ['Food & Drink'], durationSec: 240 }),
  ];
  const weak = anchorCompose(world(260));
  assert.equal(weak.thread?.topic, WT);
  assert.equal(weak.climaxUnitId, 'dd1|landmark_origin', 'a 260 s member does not clear 1.25× the destination’s 240 s — the destination keeps its ending');
  assert.equal(weak.climaxMode, 'destination');
  const strong = anchorCompose(world(320));
  assert.equal(strong.climaxUnitId, 'dm3|landmark_origin', 'a 320 s member clears the bar — the thread earns the close');
});

check('menu capture: the offered set, the shown flag, the source and the final thread ride the plan payload (schema stays 2)', () => {
  const storyUnit = unit('s1|landmark_origin', 32.71);
  const items = [
    { kind: 'story', id: storyUnit.id, label: 'S1', durationSec: 100, unit: storyUnit, ready: true, anchorProgress: 0.1, releaseProgress: 0.1, expireProgress: 0.3 },
  ];
  const plan = {
    destinationName: 'Dest',
    destination: dest,
    path,
    driveSec: 1000,
    budgetSec: 1000,
    items,
    wrapUp: null,
    audience: 'standard',
    thread: { topic: 'Food & Drink', memberIds: ['harbor|landmark_origin'], score: 3, anchorKind: 'destination', anchorKey: 'harbor', label: 'Harbor Gate' },
    threadMenu: {
      offered: [
        { kind: 'destination', key: 'harbor', label: 'Harbor Gate', count: 3 },
        { kind: 'topic', key: WT, label: WT, count: 4 },
      ],
      menuShown: true,
      source: 'menu-pick',
      pickedKey: 'harbor',
    },
  };
  const payload = ec.assemblePlanCapture({
    tourId: 'route-1',
    buildId: 'fresh-test',
    context: captureCtx,
    plan,
    routePlanStarted: null,
    items: ec.assemblePlanItems(plan, new Set()),
  });
  assert.equal(payload.schema, 2);
  assert.deepEqual(payload.thread_alternatives_offered, plan.threadMenu.offered);
  assert.equal(payload.thread_menu_shown, true);
  assert.equal(payload.thread_source, 'menu-pick');
  assert.deepEqual(payload.thread_final, { topic: 'Food & Drink', label: 'Harbor Gate', anchor_kind: 'destination', anchor_key: 'harbor' });
});

// ── Tone suggestion (Nov 7, 2026) ──────────────────────
// Erik's ruling: the intake's blind Mood select is gone;
// tone is SUGGESTED at the seam card from the cast itself —
// the primary-tone distribution over the same geo pool the
// thread resolver sees, a ≥3-carrier bar, the plurality
// qualifier as the suggestion, and the prose ask riding as a
// pre-selected row even off-bar. The suites below pin the
// resolution, the card's section conditions (via the two
// resolutions the App reads), the capture record, no-tone
// parity, and the intake's source shape.

const tonePoolsOf = units => rm.partitionRoutePools(units, path, dest, { heardKeys: new Set() });
const toneResOf = (units, extra = {}) =>
  rm.resolveToneSuggestion({ geoPool: tonePoolsOf(units).geoAll, ...extra });
const toneCast = specs => {
  // specs: [tone, count] pairs laid along the meridian path.
  const units = [];
  let lat = 32.71;
  for (const [tone, n] of specs) {
    for (let i = 0; i < n; i++) {
      units.push(unit(`tc${units.length}|landmark_origin`, lat, { tone }));
      lat += 0.012;
    }
  }
  return units;
};

check('tone suggestion: detection thresholds — ≥3 primary-tone carriers qualify, plurality is suggested, ties break by vocabulary order', () => {
  const res = toneResOf(toneCast([['reflective', 4], ['warm', 3], ['light', 2]]));
  assert.deepEqual(res.alternatives, [
    { tone: 'reflective', castCount: 4 },
    { tone: 'warm', castCount: 3 },
  ]);
  assert.equal(res.suggested, 'reflective', 'the plurality qualifier is the suggestion');
  assert.equal(rm.TONE_QUALIFY_MIN_CAST, 3);
  // Exactly at the bar qualifies; one under does not.
  assert.deepEqual(toneResOf(toneCast([['grand', 3]])).alternatives, [{ tone: 'grand', castCount: 3 }]);
  assert.deepEqual(toneResOf(toneCast([['grand', 2]])).alternatives, []);
  // A tie at the top breaks by the closed vocabulary's order
  // (warm precedes reflective in ROUTE_TONES) — stable menus.
  const tie = toneResOf(toneCast([['reflective', 3], ['warm', 3]]));
  assert.equal(tie.suggested, 'warm');
  assert.deepEqual(tie.alternatives.map(a => a.tone), ['warm', 'reflective']);
  // Secondary tones are NOT votes: four spooky secondaries
  // across a cast whose primaries all sit under the bar
  // qualify nothing.
  const secondaries = toneResOf([
    unit('ts0|landmark_origin', 32.71, { tone: 'light', toneSecondary: 'spooky' }),
    unit('ts1|landmark_origin', 32.73, { tone: 'light', toneSecondary: 'spooky' }),
    unit('ts2|landmark_origin', 32.75, { tone: 'warm', toneSecondary: 'spooky' }),
    unit('ts3|landmark_origin', 32.77, { tone: 'grand', toneSecondary: 'spooky' }),
    unit('ts4|landmark_origin', 32.79, { tone: 'warm' }),
  ]);
  assert.deepEqual(secondaries.alternatives, [], 'the distribution reads PRIMARY tone only');
  assert.equal(secondaries.suggested, null);
});

check('tone suggestion: prose standing — a qualifying ask is carried; an off-bar ask rides as a row but never becomes the suggestion', () => {
  const castUnits = toneCast([['reflective', 4], ['warm', 3]]);
  const qualifying = toneResOf(castUnits, { proseTone: 'warm' });
  assert.equal(qualifying.proseTone, 'warm');
  assert.equal(qualifying.proseQualifies, true);
  assert.equal(qualifying.proseCastCount, 3);
  assert.equal(qualifying.suggested, 'reflective', 'the suggestion stays the cast plurality — the App pre-selects the ask, the resolver does not crown it');
  const offBar = toneResOf([...castUnits, unit('sp1|landmark_origin', 32.87, { tone: 'spooky' })], { proseTone: 'spooky' });
  assert.equal(offBar.proseTone, 'spooky');
  assert.equal(offBar.proseQualifies, false);
  assert.equal(offBar.proseCastCount, 1);
  assert.ok(!offBar.alternatives.some(a => a.tone === 'spooky'), 'an off-bar ask is not an alternative — it joins as an added row at the App seam');
  assert.equal(offBar.suggested, 'reflective');
  // A prose tone outside the closed vocabulary is not an ask.
  const junk = toneResOf(castUnits, { proseTone: 'dark' });
  assert.equal(junk.proseTone, null);
  assert.equal(junk.proseCastCount, 0);
});

check('tone suggestion: no-lean silence — no qualifier and no ask resolves empty, and a no-tone plan files the none record', () => {
  const res = toneResOf(toneCast([['warm', 2], ['light', 2], ['grand', 1]]));
  assert.deepEqual(res.alternatives, []);
  assert.equal(res.suggested, null);
  assert.equal(res.proseTone, null);
  const plan = leverCompose(toneCast([['warm', 2], ['light', 2]]), 2400, {
    toneMenu: { offered: [], menuShown: false, source: 'none', pickedTone: null },
  });
  assert.equal(plan.toneMenu?.source, 'none');
  const payload = ec.assemblePlanCapture({
    tourId: 'route-tone-none',
    buildId: 'fresh-test',
    context: captureCtx,
    plan,
    routePlanStarted: null,
    items: ec.assemblePlanItems(plan, new Set()),
  });
  assert.equal(payload.schema, 2);
  assert.deepEqual(payload.tone_alternatives_offered, []);
  assert.equal(payload.tone_menu_shown, false);
  assert.equal(payload.tone_source, 'none');
  assert.equal(payload.tone_final, null);
});

check('tone suggestion: card coexistence — thread-only, tone-only, and both sections resolve off the same pools', () => {
  const sectionOf = units => {
    const pools = tonePoolsOf(units);
    const threads = rm.resolveThreadCandidates({
      geoPool: pools.geoAll,
      wovenSupport: pools.portalAll.filter(u => u.wovenEligible === true),
      path,
      destination: dest,
    });
    const tones = rm.resolveToneSuggestion({ geoPool: pools.geoAll });
    return { thread: threads.candidates.length >= 2, tone: tones.alternatives.length > 0 };
  };
  // Thread-only: two qualifying threads, every tone at ≤1.
  const threadOnly = sectionOf([
    unit('harbor|landmark_origin', 32.895, { placeName: 'Harbor Gate', topics: ['Food & Drink'], tone: 'warm' }),
    unit('harbor|landmark_event', 32.9, { placeName: 'Harbor Gate', topics: ['Food & Drink'], tone: 'reflective' }),
    unit('harbor|landmark_people', 32.905, { placeName: 'Harbor Gate', topics: [], tone: 'light' }),
    unit('tp1|landmark_origin', 32.74, { topics: [WT], tone: 'grand' }),
    unit('tp2|landmark_origin', 32.78, { topics: [WT], tone: 'somber' }),
    unit('tp3|landmark_origin', 32.82, { topics: [WT], tone: 'reverent' }),
  ]);
  assert.deepEqual(threadOnly, { thread: true, tone: false });
  // Tone-only: no thread qualifies (no anchors, no topics),
  // reflective carries the cast.
  const toneOnly = sectionOf(toneCast([['reflective', 4], ['warm', 2]]));
  assert.deepEqual(toneOnly, { thread: false, tone: true });
  // Both: the harbor world with a leaning cast.
  const both = sectionOf([
    unit('harbor|landmark_origin', 32.895, { placeName: 'Harbor Gate', topics: ['Food & Drink'], tone: 'reflective' }),
    unit('harbor|landmark_event', 32.9, { placeName: 'Harbor Gate', topics: ['Food & Drink'], tone: 'reflective' }),
    unit('harbor|landmark_people', 32.905, { placeName: 'Harbor Gate', topics: [], tone: 'reflective' }),
    ...[32.74, 32.78, 32.82].map((lat, i) => wGeo(`bt${i + 1}|landmark_origin`, lat, 120, `Both ${i + 1}`)),
  ]);
  assert.deepEqual(both, { thread: true, tone: true });
});

check('tone suggestion: no-tone parity — the no-lean plan is the no-tone plan, item for item; a leaned plan keeps the same cast', () => {
  const castUnits = toneCast([['reflective', 4], ['warm', 3], ['light', 2]]);
  const composeWith = (tone, toneMenu) =>
    rm.composeRoutePlan(
      castUnits,
      path,
      dest,
      'Dest',
      { destinationText: 'Dest', arrivalTimeMs: null, tone, topics: [] },
      {
        nowMs: NOW,
        heardKeys: new Set(),
        budgetSecOverride: 2400,
        driveSec: 2400,
        ...(toneMenu ? { toneMenu } : {}),
      },
    );
  const baseline = composeWith(null, null);
  assert.equal(baseline.toneMenu, null, 'a plan composed without the seam record carries none');
  const noLean = composeWith(null, {
    offered: [
      { tone: 'reflective', castCount: 4 },
      { tone: 'warm', castCount: 3 },
    ],
    menuShown: true,
    source: 'menu_pick',
    pickedTone: null,
  });
  assert.deepEqual(
    noLean.items.map(i => `${i.kind}:${i.id}`),
    baseline.items.map(i => `${i.kind}:${i.id}`),
    'no-lean composes the identical plan — the record is filed, nothing steers',
  );
  assert.equal(noLean.thread?.anchorKey ?? null, baseline.thread?.anchorKey ?? null);
  assert.equal(noLean.climaxUnitId, baseline.climaxUnitId);
  assert.equal(noLean.totalSec, baseline.totalSec);
  assert.equal(noLean.toneMenu?.source, 'menu_pick');
  // A leaned plan: tone steers RANK only — the story cast is
  // the same set (tone never filters), and toneMatched reads.
  const leaned = composeWith('reflective', {
    offered: [
      { tone: 'reflective', castCount: 4 },
      { tone: 'warm', castCount: 3 },
    ],
    menuShown: true,
    source: 'detected',
    pickedTone: 'reflective',
  });
  const storyIds = p => p.items.filter(i => i.kind === 'story').map(i => i.id).sort();
  assert.deepEqual(storyIds(leaned), storyIds(baseline), 'a lean reorders within the cast — it never removes a story');
  assert.equal(leaned.toneMatched, true);
  assert.equal(leaned.toneMenu?.pickedTone, 'reflective');
});

check('tone capture: the offered set, the shown flag, the source and the final tone ride the plan payload (schema stays 2)', () => {
  const storyUnit = unit('s1|landmark_origin', 32.71);
  const items = [
    { kind: 'story', id: storyUnit.id, label: 'S1', durationSec: 100, unit: storyUnit, ready: true, anchorProgress: 0.1, releaseProgress: 0.1, expireProgress: 0.3 },
  ];
  const plan = {
    destinationName: 'Dest',
    destination: dest,
    path,
    driveSec: 1000,
    budgetSec: 1000,
    items,
    wrapUp: null,
    audience: 'standard',
    thread: null,
    threadMenu: null,
    toneMenu: {
      offered: [
        { tone: 'reflective', castCount: 9 },
        { tone: 'warm', castCount: 5 },
      ],
      menuShown: true,
      source: 'prose',
      pickedTone: 'warm',
    },
  };
  const payload = ec.assemblePlanCapture({
    tourId: 'route-tone-1',
    buildId: 'fresh-test',
    context: captureCtx,
    plan,
    routePlanStarted: null,
    items: ec.assemblePlanItems(plan, new Set()),
  });
  assert.equal(payload.schema, 2);
  assert.deepEqual(payload.tone_alternatives_offered, plan.toneMenu.offered);
  assert.equal(payload.tone_menu_shown, true);
  assert.equal(payload.tone_source, 'prose');
  assert.equal(payload.tone_final, 'warm', 'the seam record’s settled tone is the final tone');
});

check('tone suggestion: the intake forms carry no tone control; the seam card carries the tone section (App source)', () => {
  const appSrc = readFileSync(join(repoRoot, 'src', 'App.tsx'), 'utf8');
  assert.ok(!appSrc.includes('Mood for the ride'), 'the blind Mood select is gone from both route forms');
  assert.ok(!appSrc.includes('routeTone'), 'no intake tone state survives');
  assert.ok(appSrc.includes('No lean — keep it mixed'), 'the seam card offers the no-lean row');
  assert.ok(appSrc.includes('resolveToneSuggestion'), 'the seam resolves the suggestion from the cast');
});

await checkAsync('thread anchors battery: 100% anchor rate on fresh drives; zero cooldown repeats inside the window', async () => {
  const anchors = await grader.runThreadAnchors({ rm, gf, rh });
  assert.deepEqual(anchors.fresh.misses, [], 'every fresh default is the resolution’s own');
  assert.ok(anchors.fresh.anchorQualified >= 1, 'the battery world qualifies anchors (else it proves nothing)');
  assert.equal(anchors.fresh.anchorRate, 1, 'every drive where an anchor qualified took an anchored thread');
  assert.deepEqual(anchors.repeat.violations, [], 'no detected default repeats a headline inside the cooldown window while a fresh candidate was offered');
  console.log(
    `    [thread anchors] fresh ${anchors.fresh.anchoredTaken}/${anchors.fresh.anchorQualified} anchor-qualified drives anchored; ` +
      `repeat distribution ${JSON.stringify(anchors.repeat.distribution)}, sources ${JSON.stringify(anchors.repeat.sources)}, threadless ${anchors.repeat.threadless}/40`,
  );
});


// ============================================================
// Session arbitration + settle-path split (Nov 6, 2026 —
// field fix lanes A/B/C). Erik's live report: a route build
// that took ~5 minutes landed ON TOP of the freeform tour he
// had started meanwhile, and the color pass's sequential live
// generations were the settle path's unbounded sink. The
// suites below pin the authority mechanics, the handover
// gate, the gap/color phase splits, late adoption, and the
// Lane C transport structure — zero live calls throughout.
// ============================================================

const saOut = join(mkdtempSync(join(tmpdir(), 'session-authority-')), 'sessionAuthority.mjs');
execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'esbuild'),
  [
    join(repoRoot, 'src', 'core', 'sessionAuthority.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--define:import.meta.env={}',
    `--outfile=${saOut}`,
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
);
const sa = await import(pathToFileURL(saOut).href);

check('authority: newest claim wins; a stale release cannot evict its successor', () => {
  const auth = new sa.SessionAuthority();
  const build = auth.claim('route-build', 'route-A');
  assert.equal(auth.isCurrent(build), true);
  const free = auth.claim('freeform-tour', 'freeform-1');
  assert.equal(auth.isCurrent(build), false, 'the freeform claim superseded the build');
  assert.equal(auth.isCurrent(free), true);
  auth.release(build);
  assert.equal(auth.isCurrent(free), true, 'releasing the stale claim left the successor in place');
  assert.equal(auth.current()?.id, 'freeform-1');
  auth.release(free);
  assert.equal(auth.current(), null, 'the current holder can release');
});

check('authority: build A → build B — A is stale at its gate, B unaffected; a build upgrades to its tour claim', () => {
  const auth = new sa.SessionAuthority();
  const a = auth.claim('route-build', 'route-A');
  const b = auth.claim('route-build', 'route-B');
  assert.equal(auth.isCurrent(a), false, 'the newer build superseded the older at START, not completion');
  assert.equal(auth.isCurrent(b), true);
  const bTour = auth.claim('route-tour', 'route-B');
  assert.equal(auth.isCurrent(b), false, 'the handover upgrade replaced the build claim');
  assert.equal(auth.isCurrent(bTour), true);
  assert.equal(auth.current()?.kind, 'route-tour');
});

await checkAsync('arbitration gate: build pending → freeform starts → the build\'s handover refuses and its runner never sounds', async () => {
  const auth = new sa.SessionAuthority();
  const audio = new RealFakeAudio();
  const events = [];
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:x/' + t.length,
    onEvent: (t, p) => events.push({ t, p }),
  });
  const buildClaim = auth.claim('route-build', 'route-A');
  // The driver gives up on the slow build and starts freeform:
  // the newest intent, claimed exactly as App's startTour does.
  auth.claim('freeform-tour', 'freeform-1');
  // The build finally finishes composing and reaches the gate
  // App checks before runner.start():
  let handedOver = false;
  if (auth.isCurrent(buildClaim)) {
    await runner.start(qaPlan());
    handedOver = true;
  }
  assert.equal(handedOver, false, 'the superseded build never handed over');
  runner.dispose();
  assert.equal(audio.played.length, 0, 'nothing ever sounded from the superseded build');
  assert.equal(events.filter(e => e.t === 'route_plan_started').length, 0, 'no plan ever started');
});

await checkAsync('arbitration gate: an uncontested build hands over and starts normally', async () => {
  const auth = new sa.SessionAuthority();
  const audio = new RealFakeAudio();
  const events = [];
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:x/' + t.length,
    onEvent: (t, p) => events.push({ t, p }),
  });
  const buildClaim = auth.claim('route-build', 'route-A');
  assert.equal(auth.isCurrent(buildClaim), true);
  await runner.start(qaPlan());
  assert.equal(events.filter(e => e.t === 'route_plan_started').length, 1, 'the current build started its plan');
  runner.endTour();
});

await checkAsync('gapfill phases: shelf tiles locally and stays silent on a bare gap; generation promotes later', async () => {
  const drive = 2000;
  const bare = () => {
    const p = mkPlan([storyAtSec('s1|x', 200, 100, drive), storyAtSec('s2|x', 1800, 100, drive)]);
    p.driveSec = drive;
    p.budgetSec = drive;
    return p;
  };
  // Shelf phase, nothing to tile with: no live calls at all,
  // and NO event — the bare gap's verdict belongs to the
  // generation phase that runs behind the opening.
  let liveCalls = 0;
  const shelfEvents = [];
  const shelved = await gf.fillRouteGaps(
    bare(),
    { fetchedUnits: [], heardKeys: new Set(), input: noInput, driveSec: drive },
    {
      phase: 'shelf',
      discoverSubjects: async () => { liveCalls += 1; return []; },
      generateStory: async () => { liveCalls += 1; return cannedStory('Never'); },
      onEvent: e => shelfEvents.push(e),
    },
  );
  assert.equal(liveCalls, 0, 'the shelf phase made zero live calls');
  assert.equal(shelfEvents.length, 0, 'a bare gap files no event in the shelf phase');
  assert.equal(shelved.items.length, 2, 'the plan passed through unfilled');
  // Shelf phase with an untiled unit: tiles it, event as today.
  const mid = unit('mid|landmark_origin', 32.776, { topics: [], durationSec: 340 });
  const tileEvents = [];
  const tiled = await gf.fillRouteGaps(
    bare(),
    { fetchedUnits: [mid], heardKeys: new Set(), input: noInput, driveSec: drive },
    { phase: 'shelf', onEvent: e => tileEvents.push(e) },
  );
  assert.ok(tiled.items.some(i => i.id === 'mid|landmark_origin'), 'the shelf unit tiled in the shelf phase');
  assert.equal(tileEvents.length, 1);
  assert.equal(tileEvents[0].result, 'shelf');
  // Generation phase on the still-bare plan: the live chain
  // runs, the story promotes into the shelf (ingest), and its
  // event files — the App discards this phase's returned plan;
  // promotion is its durable product.
  const genEvents = [];
  const ingested = [];
  const generated = await gf.fillRouteGaps(
    bare(),
    { fetchedUnits: [], heardKeys: new Set(), input: noInput, driveSec: drive },
    {
      phase: 'generation',
      discoverSubjects: async () => [
        { name: 'The Old Mill', lat: 32.8, lng: -117.2, types: ['point_of_interest'], rating: 4.6, userRatings: 900, address: null, facts: [] },
      ],
      generateStory: async prompt => cannedStory(subjectFromPrompt(prompt)),
      synthesize: async () => new Blob(['audio']),
      ingest: async rec => { ingested.push(rec); return 'shelf-key'; },
      onEvent: e => genEvents.push(e),
    },
  );
  assert.equal(ingested.length, 1, 'the generated story promoted into the shelf');
  assert.ok(genEvents.some(e => e.result === 'generated'), 'the generation event filed in its own phase');
  assert.ok(generated.items.length > 2, 'the generation pass still returns a filled plan (the App discards it by design)');
});

await checkAsync('color split parity: bank staging + generated-only pieces reproduce the single pass', async () => {
  const genBySubject = async prompt => {
    const subject = prompt.match(/Subject: (.+)\n/)[1];
    return `Color beat for ${subject}.`;
  };
  const mkStandard = () =>
    rm.composeRoutePlan(
      [32.71, 32.74, 32.77, 32.80, 32.83, 32.86, 32.88].map((lat, i) => unit(`s${i + 1}|landmark_origin`, lat)),
      path, dest, 'Dest',
      { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] },
      { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000, driveSec: 3000 },
    );
  const singleStd = await rc.colorizeRoutePlan(mkStandard(), { generateColor: genBySubject });
  const stagedStd = await rc.stageHumorBankDraws(mkStandard(), { generateColor: genBySubject });
  const genStd = await rc.generateColorPiecesOnly(mkStandard(), {
    generateColor: genBySubject,
    skipSlotKeys: stagedStd.takenSlotKeys,
  });
  const stdSinglePieces = singleStd.items.filter(i => i.voice === 'color-puck').map(i => `${i.id}|${i.text}`).sort();
  const stdSplitPieces = genStd.pieces.map(i => `${i.id}|${i.text}`).sort();
  assert.deepEqual(stdSplitPieces, stdSinglePieces, 'standard: the split lands the identical generated piece set');
  // Unfiltered: bank draws stage in the settle path; the
  // generated remainder must match the single pass exactly.
  const line = testLine('test-split');
  const mkUnf = () => {
    const p = mkStandard();
    return { ...p, audience: 'unfiltered' };
  };
  const singleUnf = await rc.colorizeRoutePlan(mkUnf(), { generateColor: genBySubject, humorBank: [line] });
  const stagedUnf = await rc.stageHumorBankDraws(mkUnf(), { generateColor: genBySubject, humorBank: [line] });
  const genUnf = await rc.generateColorPiecesOnly(mkUnf(), {
    generateColor: genBySubject,
    humorBank: [line],
    skipSlotKeys: stagedUnf.takenSlotKeys,
  });
  const unfSingle = singleUnf.items.filter(i => i.voice === 'color-puck').map(i => `${i.id}|${i.text}`).sort();
  const unfSplit = [
    ...stagedUnf.plan.items.filter(i => i.voice === 'color-puck'),
    ...genUnf.pieces,
  ].map(i => `${i.id}|${i.text}`).sort();
  assert.deepEqual(unfSplit, unfSingle, 'unfiltered: bank-staged + generated pieces reproduce the single pass');
  assert.ok(stagedUnf.takenSlotKeys.size >= 1, 'the bank draw claimed its slot in the settle path');
});

await checkAsync('color split: a hanging generated stage cannot hold the opening — staging settles, the plan starts, nothing waits', async () => {
  const plan = rm.composeRoutePlan(
    [unit('s1|landmark_origin', 32.71), unit('s2|landmark_origin', 32.78), unit('s3|landmark_origin', 32.86)],
    path, dest, 'Dest',
    { destinationText: 'Dest', arrivalTimeMs: null, tone: null, topics: [] },
    { nowMs: NOW, heardKeys: new Set(), budgetSecOverride: 100000 },
  );
  const hang = () => new Promise(() => {});
  // The settle path's only color work resolves on local work
  // alone, even with a generator that never answers.
  const staging = await rc.stageHumorBankDraws(plan, { generateColor: hang });
  assert.ok(staging.plan, 'bank staging settled despite the hanging generator');
  let generatedSettled = false;
  void rc.generateColorPiecesOnly(plan, { generateColor: hang }).then(() => { generatedSettled = true; });
  const audio = new RealFakeAudio();
  const events = [];
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:x/' + t.length,
    onEvent: (t, p) => events.push({ t, p }),
  });
  await runner.start(staging.plan);
  await until(() => audio.played.length >= 1, 'the opening sounds');
  assert.equal(events.filter(e => e.t === 'route_plan_started').length, 1, 'the plan started on its opening renders alone');
  assert.equal(generatedSettled, false, 'the generated stage is still hanging — and nothing waited on it');
  runner.endTour();
});

await checkAsync('late adoption: aside splices after its story and sounds; closeout appends; ended/pre-start runners refuse', async () => {
  const drive = 2000;
  const mkAdoptPlan = () =>
    mkPlan([
      { kind: 'preview', id: 'preview', label: 'Preview', durationSec: 5, text: 'Off we go.', ready: true },
      { kind: 'bridge', id: 'bridge:go>s1|x', label: 'Bridge', durationSec: 3, text: 'Bridge to one.', ready: true },
      storyAtSec('s1|x', 100, 60, drive),
      storyAtSec('s2|x', 1500, 60, drive),
    ]);
  const asidePiece = {
    kind: 'reaction', id: 'color:aside:s1|x', label: 'Color commentary', durationSec: 4,
    text: 'Color aside for story one.', voice: 'color-puck', colorForId: 's1|x', ready: true,
  };
  const closeoutPiece = {
    kind: 'reaction', id: 'color:closeout', label: 'Color commentary', durationSec: 4,
    text: 'Color closeout line.', voice: 'color-puck', colorForId: 's2|x', ready: true,
  };
  // Pre-start: no plan, no adoption.
  const cold = new rp.RoutePlanRunner({ audio: new RealFakeAudio(), synthUrl: async t => 'blob:x/' + t.length });
  assert.deepEqual(cold.adoptLateColorPieces([asidePiece]), { adopted: 0, dropped: 1 }, 'a runner with no plan adopts nothing');
  cold.dispose();
  // Live runner: the aside lands behind story one and SOUNDS
  // (story two is window-held far down the drive, so the feed
  // reaches the aside next); the closeout appends at the tail.
  const audio = new RealFakeAudio(250);
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => 'blob:adopt/' + encodeURIComponent(t.slice(0, 18)),
    onEvent: () => {},
  });
  const plan = mkAdoptPlan();
  plan.driveSec = drive;
  plan.budgetSec = drive;
  await runner.start(plan);
  runner.onPosition({ lat: 32.71, lng: -117.25 }); // progress ≈ 0.05 — inside story one's window
  await until(() => audio.played.some(s => s.includes('s1%7Cx')), 'story one sounding or done');
  const res = runner.adoptLateColorPieces([asidePiece, closeoutPiece]);
  assert.deepEqual(res, { adopted: 2, dropped: 0 }, 'aside + closeout adopted into the live plan');
  await until(() => audio.played.some(s => s.includes('Color%20aside')), 'the adopted aside sounds');
  runner.endTour();
  // After the end: everything refuses.
  const late = runner.adoptLateColorPieces([asidePiece]);
  assert.deepEqual(late, { adopted: 0, dropped: 1 }, 'an ended runner adopts nothing');
});

await checkAsync('late adoption: a reaction swap lands only while its render is still queued behind stuck tissue', async () => {
  const drive = 2000;
  const hangTexts = ['Hang bridge one.', 'Hang bridge two.', 'Hang bridge three.'];
  const items = [
    { kind: 'preview', id: 'preview', label: 'Preview', durationSec: 5, text: 'Off we go.', ready: true },
    { kind: 'bridge', id: 'bridge:go>s1|x', label: 'Bridge', durationSec: 3, text: 'Bridge to one.', ready: true },
    storyAtSec('s1|x', 100, 60, drive),
    ...hangTexts.map((text, i) => ({ kind: 'bridge', id: `bridge:hang${i}`, label: 'Bridge', durationSec: 3, text, ready: true })),
    { kind: 'reaction', id: 'reaction:0', label: 'Reaction', durationSec: 5, text: 'Plain reaction text.', ready: true },
    storyAtSec('s2|x', 1500, 60, drive),
  ];
  const plan = mkPlan(items);
  plan.driveSec = drive;
  plan.budgetSec = drive;
  const audio = new RealFakeAudio(250);
  const runner = new rp.RoutePlanRunner({
    audio,
    synthUrl: async t => {
      if (hangTexts.includes(t)) return new Promise(() => {});
      return 'blob:swap/' + encodeURIComponent(t.slice(0, 18));
    },
    onEvent: () => {},
  });
  await runner.start(plan);
  // The three hanging bridges occupy every render slot, so the
  // plain reaction's render has not started: the swap lands.
  const swap = {
    kind: 'reaction', id: 'reaction:0', label: 'Color commentary', durationSec: 4,
    text: 'Color swap text.', voice: 'color-puck', colorForId: 's1|x', ready: true,
  };
  const res = runner.adoptLateColorPieces([swap]);
  assert.deepEqual(res, { adopted: 1, dropped: 0 }, 'the unrendered plain reaction swapped to its color version');
  // A second helping of the same piece is a duplicate: refused.
  const dup = runner.adoptLateColorPieces([swap]);
  assert.deepEqual(dup, { adopted: 0, dropped: 1 }, 'an already-color entry refuses a second swap');
  runner.endTour();
});

check('lane C: both in-tour transport bars wrap at phone widths; in-tour labels never wrap mid-word', () => {
  const appSrc = readFileSync(join(repoRoot, 'src', 'App.tsx'), 'utf8');
  const bars = appSrc.match(/flex flex-wrap items-center gap-2 rounded-\[1\.75rem\] bg-white\/75/g) ?? [];
  assert.equal(bars.length, 2, 'route + freeform transport bars both use the wrapping cluster');
  const nowrap = appSrc.match(/whitespace-nowrap/g) ?? [];
  assert.ok(nowrap.length >= 7, `every in-tour button carries whitespace-nowrap (found ${nowrap.length})`);
});


console.log(`\nroute-mode harness: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
