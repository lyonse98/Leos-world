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
await checkAsync('geocode: stub fetch parses top candidate', async () => {
  const stub = async () => ({
    ok: true,
    json: async () => ({ places: [{ displayName: { text: 'Balboa Park' }, location: { latitude: 32.734, longitude: -117.149 }, formattedAddress: 'San Diego, CA' }] }),
  });
  const g = await rm.geocodeDestination('Balboa Park', 'fake-key', stub);
  assert.equal(g.name, 'Balboa Park');
  assert.equal(g.location.lat, 32.734);
});
await checkAsync('routes: stub fetch decodes polyline + duration', async () => {
  const stub = async () => ({
    ok: true,
    json: async () => ({ routes: [{ distanceMeters: 12000, duration: '900s', polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' } }] }),
  });
  const r = await rm.computeRoute({ lat: 32.7, lng: -117.25 }, dest, 'fake-key', stub);
  assert.equal(r.durationSec, 900);
  assert.equal(r.path.length, 3);
});
await checkAsync('gemini parse: failure falls back to local parse', async () => {
  const failing = async () => {
    throw new Error('no network in harness');
  };
  const p = await rm.parseRouteInput('to Balboa Park by 6pm', NOW, 'fake-key', failing);
  assert.equal(p.destinationText, 'Balboa Park');
  assert.ok(p.arrivalTimeMs !== null);
});

// ---- Monte Carlo invariants ----
check('monte carlo: 200 random plans hold the invariants', () => {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let iter = 0; iter < 200; iter++) {
    const n = 5 + Math.floor(rnd() * 25);
    const units = [];
    for (let i = 0; i < n; i++) {
      units.push(
        unit(`u${i}|landmark_origin`, 32.7 + rnd() * 0.2, {
          durationSec: 60 + Math.floor(rnd() * 240),
          topics: rnd() < 0.4 ? ['Food & Drink'] : [],
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

console.log(`\nroute-mode harness: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
