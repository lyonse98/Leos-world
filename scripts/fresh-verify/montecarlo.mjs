// Monte Carlo invariant runs across the standard cells. Every run
// asserts the shell's safety invariants continuously (probed at each
// play() call), and per-cell aggregates are reported for comparison
// against the avatar build's published baselines.

import { FakeAudio, makeWorld, makeCandidate, check, suite, resetLocalStorage, blobSizes } from './harness.mjs';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DUR = { greeting: 4600, opener: 10000, library: 15000, synth: 12000, bridge: 3000, filler: 20000, stall: 3000 };
function clsOf(src) {
  if (!src) return 'none';
  if (src.includes('openers/intros/')) return 'greeting';
  if (src.includes('stall-phrases/')) return 'stall';
  if (src.includes('fillers/bridges/')) return 'bridge';
  if (src.includes('fillers/audio/')) return 'filler';
  if (src.includes('library/')) return 'library';
  if (src.includes('openers/')) return 'opener';
  if (src.startsWith('blob:')) return 'synth';
  return 'other';
}
const okDur = src => ({ action: 'ok', durationMs: DUR[clsOf(src)] ?? 5000 });

const LIB = ['Alpha Park', 'Beta Museum', 'Gamma Garden', 'Delta Pier', 'Epsilon Hall', 'Zeta Tower'];
const DROP_VOCAB = new Set(['displaced-priority', 'displaced-fresher', 'stale-age', 'stale-behind', 'out-of-reach', 'stale_highway', 'attempts-exhausted', 'teardown']);

async function runCell(Tour, extras, cell, runIdx) {
  resetLocalStorage();
  const rng = mulberry32(cell.seed * 1000 + runIdx);
  const world = makeWorld(Tour, {
    candidates: LIB.map(n => makeCandidate(n)),
    library: LIB,
    fillers: ['San Diego Weather Patterns', 'The Kumeyaay Homeland', 'Harbor Seals of La Jolla', 'Old Town Adobe Stories'],
    fillerPinFails: cell.fillerPinFails ?? false,
  });
  if (cell.synthFailRate) {
    world.synthBehavior = () => {
      if (rng() < cell.synthFailRate) throw new Error('tts fail');
      return new Blob(['speech']);
    };
  }
  if (cell.genFail) world.genStoryBehavior = () => { throw new Error('gen fail'); };

  let playCount = 0;
  const policy = cell.policy(rng, () => playCount, world);
  const audio = new FakeAudio(world.clock, c => {
    playCount++;
    return policy(c);
  });
  const tour = world.makeTour(audio);

  const inv = {
    overlap: 0,
    heldAttempts: 0,
    proofViolations: 0,
    dropVocab: 0,
    answerOverlap: 0,
    attemptsPerSrc: new Map(),
    ttfs: null,
    soundedKinds: [],
  };
  let lastSoundingKind = null;
  const ITEM_CLS = new Set(['library', 'synth', 'bridge', 'filler', 'greeting', 'opener']);
  audio.onPlay = (src, behavior) => {
    if (behavior.action !== 'ok' && behavior.action !== 'delay') return;
    const v = tour.view();
    const kind = v.nowPlaying?.kind ?? null;
    // True overlap = an item's sound cut by another ITEM's load.
    // Sample primes and stall clips share the element by design.
    if (audio.preempted && ITEM_CLS.has(audio.preempted.cls)) {
      const newCls = audio.classify(src);
      if (ITEM_CLS.has(newCls)) inv.overlap++;
    }
    audio.preempted = null;
    if (kind === 'story' || kind === 'answer') {
      if (v.latch !== 'earned') inv.heldAttempts++;
      if (lastSoundingKind === 'answer' && kind === 'answer') inv.answerOverlap++;
    }
    // Filler-pair items play from the pinned cache (in this fake
    // world: 5-byte blobs). A pair item attempting on an unearned
    // latch is legal only inside the failed-opening exception (F3).
    // Classified by the play's OWN source — the current item at
    // probe time may be an unrelated held item.
    const ownCls = src.startsWith('blob:') && blobSizes.get(src) === 5 ? 'pair-item' : audio.classify(src);
    if (ownCls === 'pair-item' && v.latch !== 'earned' && v.opening !== 'failed') {
      inv.proofViolations++;
    }
    if (kind) {
      inv.soundedKinds.push(kind);
      lastSoundingKind = kind;
    }
    if (inv.ttfs === null) inv.ttfs = world.clock.now();
    inv.attemptsPerSrc.set(src, (inv.attemptsPerSrc.get(src) ?? 0) + 1);
  };

  let lat = 32.853;
  let lng = -117.18;
  const speed = cell.speed;
  tour.onPosition({ lat, lng, speedMps: speed, headingDeg: 180 });
  if (cell.resume) {
    // Prime a marker with a first engine, then restart as resumed.
    tour.start(false);
    await world.clock.advance(30_000);
    const audio2 = new FakeAudio(world.clock, c => policy(c));
    audio2.onPlay = audio.onPlay;
    const tour2 = world.makeTour(audio2);
    tour2.onPosition({ lat, lng, speedMps: 0, headingDeg: null });
    tour2.start(true);
    return finishRun(world, tour2, audio2, inv, cell);
  }
  tour.start(false);

  const minutes = cell.minutes ?? 12;
  const steps = minutes * 12; // 5 s steps
  let qaTimer = 0;
  let submissions = 0;
  for (let s = 0; s < steps; s++) {
    await world.clock.advance(5_000);
    // Move: southward at cell speed (freeway follows its corridor).
    const dist = speed * 5;
    lat -= dist / 111_320;
    if (cell.moveEvery && s % cell.moveEvery === 0) {
      world.candidates = LIB.map(n => makeCandidate(n, { lat, lng }));
    }
    tour.onPosition({ lat, lng, speedMps: speed, headingDeg: 180 });
    if (cell.qaEverySec) {
      qaTimer += 5;
      if (qaTimer >= cell.qaEverySec) {
        qaTimer = 0;
        if (tour.submitQuestion(`Monte Carlo question ${s}?`)) submissions++;
      }
    }
    if (cell.gestureAt && world.clock.now() === cell.gestureAt) tour.noteGesture();
  }
  inv.submissions = submissions;
  return finishRun(world, tour, audio, inv, cell);
}

function finishRun(world, tour, audio, inv, cell) {
  for (const d of world.eventsOf('story_dropped')) {
    if (!DROP_VOCAB.has(d.payload.reason)) inv.dropVocab++;
  }
  const maxAttempts = Math.max(0, ...inv.attemptsPerSrc.values());
  const agg = {
    storiesSounded: world.eventsOf('story_playback').filter(e => e.payload.sounded).length,
    storiesDropped: world.eventsOf('story_dropped').length,
    fillers: world.eventsOf('filler_played').length,
    releases: world.eventsOf('question_lock_released').length,
    submissions: inv.submissions ?? 0,
    unlocked: world.eventsOf('unlock_latched').length > 0,
    maxAttempts,
    ttfs: inv.ttfs,
    firstKinds: inv.soundedKinds.slice(0, 3).join('>'),
  };
  tour.endTour();
  return { inv, agg };
}

export async function runMonteCarlo(Tour, extras) {
  const cells = [
    { name: 'healthy', seed: 1, speed: 8, policy: () => c => okDur(c.src) },
    { name: 'degraded', seed: 2, speed: 8, policy: rng => ({ src }) => {
        const r = rng();
        if (r < 0.12) return { action: 'reject' };
        if (r < 0.2) return { action: 'error', afterMs: 1500 };
        if (r < 0.3) return { action: 'delay', delayMs: 3000 + rng() * 9000, durationMs: DUR[clsOf(src)] ?? 5000 };
        return okDur(src);
      } },
    { name: 'storm', seed: 3, speed: 8, synthFailRate: 0.8, policy: () => c => okDur(c.src) },
    { name: 'blocked-start', seed: 4, speed: 8, gestureAt: 120_000, policy: (rng, count) => c => (count() <= 4 ? { action: 'reject' } : okDur(c.src)) },
    { name: 'never-unlock', seed: 5, speed: 8, policy: () => () => ({ action: 'reject' }) },
    { name: 'latch-loss', seed: 6, speed: 8, policy: (rng, count, world) => ({ src, cls }) => {
        const t = world.clock.now();
        if (t > 300_000 && t < 345_000 && (cls === 'library' || cls === 'sample-prime')) return { action: 'reject' };
        return okDur(src);
      } },
    { name: 'freeway', seed: 7, speed: 27, policy: () => c => okDur(c.src) },
    { name: 'walking', seed: 8, speed: 1.4, policy: () => c => okDur(c.src) },
    { name: 'qa-heavy', seed: 9, speed: 8, qaEverySec: 90, policy: () => c => okDur(c.src) },
    { name: 'filler-outage', seed: 10, speed: 8, fillerPinFails: true, genFail: true, policy: () => c => okDur(c.src) },
    { name: 'resume', seed: 11, speed: 8, resume: true, policy: () => c => okDur(c.src) },
  ];
  const RUNS = 10;
  for (const cell of cells) {
    suite(`MC ${cell.name}`);
    const totals = { overlap: 0, heldAttempts: 0, proofViolations: 0, dropVocab: 0, answerOverlap: 0, maxAttempts: 0, unlockedRuns: 0, orderOk: 0, storyAttemptsInLocked: 0 };
    const aggs = [];
    for (let i = 0; i < RUNS; i++) {
      const { inv, agg } = await runCell(Tour, extras, cell, i);
      totals.overlap += inv.overlap;
      totals.heldAttempts += inv.heldAttempts;
      totals.proofViolations += inv.proofViolations;
      totals.dropVocab += inv.dropVocab;
      totals.answerOverlap += inv.answerOverlap;
      totals.maxAttempts = Math.max(totals.maxAttempts, agg.maxAttempts);
      if (agg.unlocked) totals.unlockedRuns++;
      if (agg.firstKinds === 'greeting>opener>story') totals.orderOk++;
      if (cell.name === 'never-unlock') totals.storyAttemptsInLocked += inv.heldAttempts;
      aggs.push(agg);
    }
    const sum = k => aggs.reduce((a, g) => a + g[k], 0);
    console.log(
      `  MC ${cell.name}: sounded=${sum('storiesSounded')} dropped=${sum('storiesDropped')} fillers=${sum('fillers')} qaReleases=${sum('releases')} unlocked=${totals.unlockedRuns}/${RUNS} orderOk=${totals.orderOk}/${RUNS}`,
    );
    check('no overlapping playback', totals.overlap === 0, `overlap=${totals.overlap}`);
    check('no story/answer attempts while the latch is unearned', totals.heldAttempts === 0, `held=${totals.heldAttempts}`);
    check('filler proof only inside the failed-opening exception', totals.proofViolations === 0, `proof=${totals.proofViolations}`);
    check('drop reasons stay inside the §8 vocabulary', totals.dropVocab === 0, `vocab=${totals.dropVocab}`);
    check('attempts per item ≤ cap (3)', totals.maxAttempts <= 3, `max=${totals.maxAttempts}`);
    if (cell.qaEverySec) {
      // Serialization accounting: every accepted question releases
      // exactly once; at most one cycle per run may still be in
      // flight when the run ends. (Temporal overlap of answers is
      // impossible on one element; the lock discipline itself is
      // proven exhaustively by S-11's 240 cycles.)
      check(
        'every accepted question releases exactly once',
        sum('releases') <= sum('submissions') && sum('releases') >= sum('submissions') - RUNS,
        `releases=${sum('releases')} submissions=${sum('submissions')}`,
      );
    }
    if (cell.name === 'healthy' || cell.name === 'freeway' || cell.name === 'walking' || cell.name === 'qa-heavy' || cell.name === 'resume') {
      check('unlock in every run', totals.unlockedRuns === RUNS, `${totals.unlockedRuns}/${RUNS}`);
      check('opener order in every run', totals.orderOk === RUNS, `${totals.orderOk}/${RUNS}`);
    }
    if (cell.name === 'never-unlock') {
      check('never unlocks, and nothing is burned trying', totals.unlockedRuns === 0 && sum('storiesSounded') === 0);
    }
    if (cell.name === 'blocked-start') {
      check('blocked start recovers after the gesture in most runs', totals.unlockedRuns >= RUNS / 2, `${totals.unlockedRuns}/${RUNS}`);
    }
    if (cell.name === 'filler-outage') {
      check('filler outage: zero filler plays, no crash', sum('fillers') === 0);
    }
    void extras;
  }
}
