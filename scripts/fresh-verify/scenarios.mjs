// Scenario suite for the fresh shell: spec §10's trace set (T8a–c,
// T9a–d), the opening order, queue/freshness rules, the filler lane,
// Q&A serialization (240 cycles + failsafe), the failure storm, and
// player-level settle-once discipline. Expectations come from the
// spec's rules, not from any prior implementation.

import {
  FakeAudio,
  FakeClock,
  makeWorld,
  makeCandidate,
  check,
  suite,
  resetLocalStorage,
} from './harness.mjs';

const UTC = { lat: 32.853, lng: -117.18 };
const BALBOA = { lat: 32.734, lng: -117.144 };

const DUR = {
  greeting: 4600,
  opener: 10000,
  library: 15000,
  synth: 12000,
  bridge: 3000,
  filler: 20000,
  stall: 3000,
  'sample-prime': 200,
};

function clsOf(src) {
  if (src === null || src === undefined) return 'none';
  if (src.includes('openers/intros/')) return 'greeting';
  if (src.includes('stall-phrases/')) return 'stall';
  if (src.includes('fillers/bridges/')) return 'bridge';
  if (src.includes('fillers/audio/')) return 'filler';
  if (src.includes('library/')) return 'library';
  if (src.includes('openers/')) return 'opener';
  if (src.startsWith('blob:')) return 'synth';
  return 'other';
}

/** Policy where everything plays, with per-class durations. */
function okPolicy(dur = {}) {
  return ({ cls }) => ({ action: 'ok', durationMs: dur[cls] ?? DUR[cls] ?? 5000 });
}

/** Compress a tour's sounding history into kind runs via view polling. */
function watchKinds(world, tour) {
  const runs = [];
  let last = undefined;
  world.clock.setInterval(() => {
    const k = tour.view().nowPlaying?.kind ?? null;
    if (k !== last) {
      runs.push({ at: world.clock.now(), kind: k });
      last = k;
    }
  }, 200);
  return runs;
}
const kindSeq = runs => runs.filter(r => r.kind !== null).map(r => r.kind);

/** Poll the tour view and record the sequence of distinct story labels that sound (nowPlaying), in order. */
function watchLabels(world, tour) {
  const labels = [];
  let last = undefined;
  world.clock.setInterval(() => {
    const np = tour.view().nowPlaying;
    const label = np && np.kind === 'story' ? np.label : null;
    if (label !== last) {
      if (label !== null) labels.push(label);
      last = label;
    }
  }, 200);
  return labels;
}

/**
 * §8's terminal events carry no subject (story_playback is
 * {sounded, completed, sounded_ms}; story_dropped is {reason}).
 * Pairing a terminal to its story is by commitment order: the Nth
 * story_played's terminal is the Nth terminal event — valid in the
 * scenarios below, where settle order follows commitment order for
 * the stories under check (a dropped story simply has no playback).
 */
const playbackFor = (world, subject) => {
  const played = world.eventsOf('story_played').map(e => e.payload.subject);
  const idx = played.indexOf(subject);
  if (idx < 0) return undefined;
  return world.eventsOf('story_playback')[idx];
};

async function startAt(world, audio, pos, speed = 8, heading = 180) {
  const tour = world.makeTour(audio);
  tour.onPosition({ ...pos, speedMps: speed, headingDeg: heading });
  tour.start(false);
  return tour;
}

async function healthyOpening(world, audio, pos = UTC, speed = 8) {
  const tour = await startAt(world, audio, pos, speed);
  const runs = watchKinds(world, tour);
  await world.clock.advance(40_000); // greeting + opener + welcome
  return { tour, runs };
}

export async function runScenarios(Tour, extras) {
  const { CORRIDOR_SEGMENTS, matchCorridor, resolveFillerRegion, accessGate, ambience, intro, routeInterItemGapMs } = extras;

  // ---------------------------------------------------------- S-01 healthy start
  suite('S-01 healthy start / opener order');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);
    const runs = watchKinds(world, tour);
    check('first media action is the greeting clip', audio.log[0]?.cls === 'greeting', JSON.stringify(audio.log[0]));
    check('first sound is synchronous with the tap (t=0)', audio.log[0]?.at === 0, `at=${audio.log[0]?.at}`);
    await world.clock.advance(20_000);
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(60_000);
    const seq = kindSeq(runs);
    check('order: greeting → opener → welcome(story)', seq[0] === 'greeting' && seq[1] === 'opener' && seq[2] === 'story', seq.join(','));
    check('landmark story follows', seq[3] === 'story', seq.join(','));
    const ss = world.eventsOf('session_start');
    check('session_start emitted once', ss.length === 1);
    check("session_start carries variant 'fresh'", ss[0]?.payload.variant === 'fresh', JSON.stringify(ss[0]?.payload));
    const os = world.eventsOf('opener_spoken');
    check('opener_spoken {attempts:1, sounded:true}', os.length === 1 && os[0].payload.attempts === 1 && os[0].payload.sounded === true, JSON.stringify(os[0]?.payload));
    const ul = world.eventsOf('unlock_latched');
    check('unlock_latched once, source=prime (tap carrier)', ul.length === 1 && ul[0].payload.source === 'prime', JSON.stringify(ul.map(e => e.payload)));
    const pa = world.eventsOf('prime_attempt');
    check('prime_attempt resolved at the tap', pa.length >= 1 && pa[0].payload.result === 'resolved' && pa[0].payload.source === 'prime', JSON.stringify(pa.map(e => e.payload)));
    const sp = world.eventsOf('story_played').map(e => e.payload.subject);
    check('welcome story_played', sp.some(s => typeof s === 'string' && s.startsWith('welcome:')), sp.join(','));
    check('library story_played', sp.includes('balboa park'), sp.join(','));
    check('zero story drops on the healthy path', world.eventsOf('story_dropped').length === 0);
    tour.endTour();
  }

  // ---------------------------------------------------------- S-02 / T8a delayed prime
  suite('S-02 T8a delayed prime holds stories');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
    });
    let greetingCalls = 0;
    const audio = new FakeAudio(world.clock, ({ cls }) => {
      if (cls === 'greeting' && greetingCalls++ === 0) {
        return { action: 'delay', delayMs: 20_000, durationMs: DUR.greeting };
      }
      return { action: 'ok', durationMs: DUR[cls] ?? 5000 };
    });
    const tour = await startAt(world, audio, UTC);
    await world.clock.advance(2_000);
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(17_000);
    check('no story attempted while the prime is pending', audio.plays('library').length === 0 && audio.plays('synth').length === 0, JSON.stringify(audio.log.map(l => l.cls)));
    check('no story dropped while held', world.eventsOf('story_dropped').length === 0);
    await world.clock.advance(50_000);
    const firstLibrary = audio.plays('library')[0];
    check('story sounds only after the latch (t>24.6s)', firstLibrary && firstLibrary.at > 24_600, `at=${firstLibrary?.at}`);
    check('still zero drops after recovery', world.eventsOf('story_dropped').length === 0);
    check('unlock_latched fired once', world.eventsOf('unlock_latched').length === 1);
    tour.endTour();
  }

  // ---------------------------------------------------------- S-03 / T8b gate expiry + F3 proof
  suite('S-03 T8b dead prime, gate, filler proof flush');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [],
      library: [],
      fillers: ['San Diego Weather Patterns', 'The Kumeyaay Homeland', 'Harbor Seals of La Jolla'],
    });
    const audio = new FakeAudio(world.clock, ({ cls }) => {
      // The platform lock presents as a play() that never settles —
      // until some other sound has played, after which the element
      // behaves (the field failure was a lock, not a broken clip).
      if (cls === 'greeting' && !audio.log.some(l => l.action === 'ok')) {
        return { action: 'hang' };
      }
      if (cls === 'sample-prime') return { action: 'reject' };
      return { action: 'ok', durationMs: DUR[cls] ?? 5000 };
    });
    const tour = await startAt(world, audio, BALBOA);
    const runs = watchKinds(world, tour);
    await world.clock.advance(50_000);
    const pa = world.eventsOf('prime_attempt');
    check('watchdog fails the hung carrier; fallback prime attempted', pa.length === 2 && pa.every(p => p.payload.result === 'rejected'), JSON.stringify(pa.map(p => p.payload)));
    await world.clock.advance(140_000); // past the 180 s gate, into proof silence
    check('opening stands down to failed', tour.view().opening === 'failed', tour.view().opening);
    await world.clock.advance(30_000);
    const seq = kindSeq(runs);
    const bridgeIdx = seq.indexOf('bridge');
    const fillerIdx = seq.indexOf('filler');
    const greetIdx = seq.indexOf('greeting', 1); // second greeting run = the flush
    check('F3 proof pair attempted (bridge → filler)', bridgeIdx >= 0 && fillerIdx === bridgeIdx + 1, seq.join(','));
    check('unlock earned by the proof', world.eventsOf('unlock_latched').length === 1, JSON.stringify(world.eventsOf('unlock_latched').map(e => e.payload)));
    check('debt flushes GREETING first after the proof', greetIdx > fillerIdx, seq.join(','));
    check('no debt item was dropped mid-tour', world.eventsOf('story_dropped').length === 0);
    tour.endTour();
  }

  // ---------------------------------------------------------- S-04 / T8c never unlocks
  suite('S-04 T8c never unlocks');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
    });
    const audio = new FakeAudio(world.clock, () => ({ action: 'reject' }));
    const tour = await startAt(world, audio, UTC);
    for (let i = 0; i < 10; i++) {
      await world.clock.advance(60_000);
      tour.onPosition({ lat: UTC.lat + 0.003 * (i + 1), lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    }
    tour.noteGesture();
    await world.clock.advance(5_000);
    check('zero story attempts in 10 locked minutes', audio.plays('library').length === 0 && audio.plays('synth').length === 0, JSON.stringify(audio.log.map(l => l.cls)));
    check('zero story drops while locked', world.eventsOf('story_dropped').length === 0);
    check('banner is due (blocked)', tour.view().banner === 'blocked', tour.view().banner ?? 'null');
    tour.endTour();
    await world.clock.advance(1_000);
    const os = world.eventsOf('opener_spoken');
    check('greeting debt settles exactly once, at tour end', os.length === 1 && os[0].payload.sounded === false, JSON.stringify(os.map(o => o.payload)));
  }

  // ---------------------------------------------------------- S-05 / T9b gesture re-prime order
  suite('S-05 T9b gesture retries the greeting first');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], library: [] });
    let greetingCalls = 0;
    const audio = new FakeAudio(world.clock, ({ cls }) => {
      if (cls === 'greeting' && greetingCalls++ === 0) return { action: 'reject' };
      if (cls === 'sample-prime') return { action: 'reject' };
      return { action: 'ok', durationMs: DUR[cls] ?? 5000 };
    });
    const tour = await startAt(world, audio, UTC);
    await world.clock.advance(3_000);
    check('banner due after both carriers fail', tour.view().banner === 'blocked');
    const before = audio.log.length;
    tour.noteGesture();
    await world.clock.advance(500);
    const retry = audio.log[before];
    check('gesture re-attempts the GREETING clip first', retry?.cls === 'greeting', JSON.stringify(audio.log.map(l => l.cls)));
    await world.clock.advance(30_000);
    const ul = world.eventsOf('unlock_latched');
    check('unlock_latched source=gesture-retry', ul.length === 1 && ul[0].payload.source === 'gesture-retry', JSON.stringify(ul.map(e => e.payload)));
    tour.endTour();
  }

  // ---------------------------------------------------------- S-06 / T9c latch loss + probe
  suite('S-06 T9c latch loss, probe-only recovery');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park'), makeCandidate('Beta Museum')],
      library: ['Alpha Park', 'Beta Museum'],
    });
    let phase = 'healthy';
    const audio = new FakeAudio(world.clock, ({ cls }) => {
      if (phase === 'burst' && cls === 'library') return { action: 'reject' };
      if (phase === 'burst' && cls === 'sample-prime') return { action: 'reject' };
      return { action: 'ok', durationMs: cls === 'library' ? 40_000 : DUR[cls] ?? 5000 };
    });
    const { tour } = await healthyOpening(world, audio);
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(2_000); // Alpha (40 s) playing; Beta slotted behind it
    phase = 'burst';
    tour.onPosition({ lat: UTC.lat + 0.006, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(30_000);
    check('latch lost after a blocked burst', tour.view().latch === 'lost', tour.view().latch);
    check('unlock_lost emitted once', world.eventsOf('unlock_lost').length === 1);
    const logAtLoss = audio.log.length;
    await world.clock.advance(19_000);
    const during = audio.log.slice(logAtLoss);
    check('during the hold only prime probes attempt', during.every(l => l.cls === 'sample-prime'), JSON.stringify(during.map(l => l.cls)));
    phase = 'healthy'; // probes now succeed
    await world.clock.advance(25_000);
    check('latch restored by a probe', tour.view().latch === 'earned', tour.view().latch);
    await world.clock.advance(50_000);
    const betaRec = playbackFor(world, 'beta museum');
    check('the held story eventually sounds (never burned)', betaRec?.payload.sounded === true, JSON.stringify(world.eventsOf('story_playback').map(e => e.payload)));
    tour.endTour();
  }

  // ---------------------------------------------------------- S-07 Tier-1 position 2 + answer barrier
  suite('S-07 Tier-1 never cuts; answer is a barrier');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park')],
      library: ['Alpha Park', 'Museum of Us'],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 20_000 }));
    const { tour, runs } = await healthyOpening(world, audio);
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(2_000); // Alpha now playing (20 s)
    world.candidates = [makeCandidate('Museum of Us', { tier1: true })];
    tour.onPosition({ lat: UTC.lat + 0.006, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(30_000);
    const played = world.eventsOf('story_played').map(e => e.payload.subject);
    const alphaIdx = played.indexOf('alpha park');
    const tierIdx = played.indexOf('museum of us');
    check('Tier-1 plays immediately after the current story', alphaIdx >= 0 && tierIdx === alphaIdx + 1, played.join(','));
    const alphaRec = playbackFor(world, 'alpha park');
    check('the current story was never cut (completed)', alphaRec?.payload.completed === true, JSON.stringify(alphaRec?.payload));

    // Answer barrier: Tier-1 offered during a Q&A cycle waits for the answer.
    world.candidates = [makeCandidate('Alpha Park')];
    check('question accepted', tour.submitQuestion('What is this place?') === true);
    check('second question refused while locked (A2)', tour.submitQuestion('And this?') === false);
    await world.clock.advance(2_000); // answer generating → promised
    world.candidates = [makeCandidate('Museum of Us', { tier1: true, lat: UTC.lat + 0.009, lng: UTC.lng })];
    tour.onPosition({ lat: UTC.lat + 0.009, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(40_000);
    const seq = kindSeq(runs);
    const answerIdx = seq.lastIndexOf('answer');
    check('answer sounds before the waiting Tier-1', answerIdx >= 0, seq.join(','));
    const releases = world.eventsOf('question_lock_released');
    check('lock released by story resumption', releases.length === 1 && releases[0].payload.reason === 'story-resumed', JSON.stringify(releases.map(r => r.payload)));
    tour.endTour();
  }

  // ---------------------------------------------------------- S-08 displacement rules
  suite('S-08 displacement (Q6/Q7)');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park')],
      library: [
        'Alpha Park',
        { name: 'Willow Site', lat: UTC.lat + 0.006, lng: UTC.lng },
        { name: 'Fresh Plaza', lat: UTC.lat + 0.0095, lng: UTC.lng },
      ],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 25_000 }));
    const { tour } = await healthyOpening(world, audio);
    const soundedLabels = watchLabels(world, tour);
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(2_000); // Alpha playing
    world.candidates = [makeCandidate('Willow Site', { distanceM: 400 })];
    tour.onPosition({ lat: UTC.lat + 0.006, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(1_000); // Willow slotted
    world.candidates = [makeCandidate('Fresh Plaza', { distanceM: 100 })];
    tour.onPosition({ lat: UTC.lat + 0.009, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(2_000);
    const drops = world.eventsOf('story_dropped');
    check('fresher story displaces the waiter', drops.some(d => d.payload.reason === 'displaced-fresher'), JSON.stringify(drops.map(d => d.payload)));
    await world.clock.advance(40_000);
    // "Plays next" is sounding order, not commitment order: the
    // displaced waiter was committed (story_played) but never
    // sounded, so the label watch is the truthful sequence.
    check(
      'the fresher story plays next',
      soundedLabels[soundedLabels.indexOf('Alpha Park') + 1] === 'Fresh Plaza',
      soundedLabels.join(','),
    );
    tour.endTour();
  }

  // ---------------------------------------------------------- S-09 freshness (Q9) + corridor overshoot (Q11)
  suite('S-09 freshness drops');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park')],
      library: ['Alpha Park'],
      // A long text: duration ~100 s+, so the age gate cannot trip
      // first — the distance/behind judge is the one under test.
      genStoryBehavior: () => 'A very long story about a distant ruin, told slowly and in full. '.repeat(24),
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 30_000, synth: 12_000 }));
    const { tour } = await healthyOpening(world, audio);
    const soundedLabels = watchLabels(world, tour);
    // Alpha (30 s) is playing now. Serve the Ruins story into the slot.
    world.candidates = [makeCandidate('Distant Ruins', { lat: UTC.lat, lng: UTC.lng })];
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(2_000); // live story generated + slotted
    // Teleport 3 km north, still heading north: the anchor is astern and out of reach.
    tour.onPosition({ lat: UTC.lat + 0.033, lng: UTC.lng, speedMps: 8, headingDeg: 0 });
    await world.clock.advance(45_000);
    const drops = world.eventsOf('story_dropped');
    check('stale story dropped at dequeue (behind)', drops.some(d => d.payload.reason === 'stale-behind'), JSON.stringify(drops.map(d => d.payload)));
    check('stale story never sounded', !soundedLabels.includes('Distant Ruins'), soundedLabels.join(','));
    tour.endTour();
  }
  {
    resetLocalStorage();
    // Pick a substantial, non-degenerate segment (some through
    // segments loop back on themselves). Overlapping segments share
    // pavement — bank whichever segment the matcher itself returns.
    const segLen = s =>
      s.polyline.reduce((acc, p, i) => (i === 0 ? 0 : acc + Math.hypot((p.lat - s.polyline[i - 1].lat) * 111_320, (p.lng - s.polyline[i - 1].lng) * 88_000)), 0);
    const picked = CORRIDOR_SEGMENTS.filter(s => segLen(s) > 4000).reduce((a, b) => (segLen(a) > segLen(b) ? a : b));
    const start = picked.polyline[0];
    const second = picked.polyline[1];
    const pickedHeading = ((Math.atan2(second.lng - start.lng, second.lat - start.lat) * 180) / Math.PI + 360) % 360;
    const seg = matchCorridor({ lat: start.lat, lng: start.lng, heading: pickedHeading })?.segment ?? picked;
    const end = seg.polyline[seg.polyline.length - 1];
    const prev = seg.polyline[seg.polyline.length - 2];
    const heading = ((Math.atan2(second.lng - start.lng, second.lat - start.lat) * 180) / Math.PI + 360) % 360;
    // 700 m beyond the end, along the segment's own direction.
    const dLat = end.lat - prev.lat;
    const dLng = end.lng - prev.lng;
    const dLen = Math.hypot(dLat * 111_320, dLng * 88_000) || 1;
    const beyond = {
      lat: end.lat + ((dLat * 111_320) / dLen) * (700 / 111_320),
      lng: end.lng + ((dLng * 88_000) / dLen) * (700 / 88_000),
    };
    const world = makeWorld(Tour, {
      candidates: [],
      library: [seg.displayName],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ synth: 30_000 }));
    const tour = world.makeTour(audio);
    tour.onPosition({ lat: start.lat, lng: start.lng, speedMps: 27, headingDeg: heading });
    tour.start(false);
    await world.clock.advance(20_000); // greeting + opener done; welcome (30 s) playing
    // A GPS tick on the segment while the WELCOME plays: the
    // corridor story slots behind it.
    tour.onPosition({ lat: start.lat, lng: start.lng, speedMps: 27, headingDeg: heading });
    await world.clock.advance(2_000);
    // Jump beyond the segment end while the WELCOME still plays.
    tour.onPosition({ lat: beyond.lat, lng: beyond.lng, speedMps: 27, headingDeg: heading });
    await world.clock.advance(60_000);
    const drops = world.eventsOf('story_dropped');
    check('corridor story dropped stale_highway on overshoot', drops.some(d => d.payload.reason === 'stale_highway'), JSON.stringify(drops.map(d => d.payload)));
    tour.endTour();
  }

  // ---------------------------------------------------------- S-10 filler lane
  suite('S-10 filler lane (F1/F2/F5/F9/F10/F12)');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [],
      fillers: ['San Diego Weather Patterns', 'The Kumeyaay Homeland'],
      genStoryBehavior: () => {
        throw new Error('quota');
      },
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour, runs } = await healthyOpening(world, audio, BALBOA);
    // Opening already complete (welcome attempted generation? welcome uses
    // generateStory too — it failed, so the WELCOME is owed; the opening
    // still completes via its own path once debt discharges).
    await world.clock.advance(30_000);
    const fp = world.eventsOf('filler_played');
    check('filler fires after 10 s of true silence', fp.length >= 1, JSON.stringify(fp.map(f => f.payload)));
    if (fp.length >= 1) {
      const expectedRegion = resolveFillerRegion(BALBOA.lat, BALBOA.lng);
      check('filler_played carries the region', fp[0].payload.region === expectedRegion, `region=${fp[0].payload.region} expected=${expectedRegion}`);
      check('filler_played carries matched classification', ['region', 'universal', 'any'].includes(fp[0].payload.matched), `matched=${fp[0].payload.matched}`);
    }
    const seq = kindSeq(runs);
    check('bridge precedes filler (F7)', seq.indexOf('bridge') >= 0 && seq.indexOf('filler') === seq.indexOf('bridge') + 1, seq.join(','));
    await world.clock.advance(45_000);
    const fp2 = world.eventsOf('filler_played');
    check('re-arm: a second pair fires in continued silence', fp2.length >= 2, `count=${fp2.length}`);
    if (fp2.length >= 2) check('no immediate filler repeat (F6)', fp2[0].payload.title !== fp2[1].payload.title, JSON.stringify(fp2.map(f => f.payload.title)));
    await world.clock.advance(90_000);
    const fp3 = world.eventsOf('filler_played');
    check('pool exhausted → lane stands down (F10)', fp3.length === 2, `count=${fp3.length}`);
    tour.endTour();
  }
  {
    // F12: no filler while the opening is still in flight.
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [],
      fillers: ['San Diego Weather Patterns'],
      genStoryBehavior: () => {
        throw new Error('quota');
      },
    });
    const audio = new FakeAudio(world.clock, ({ cls }) => {
      if (cls === 'greeting') return { action: 'delay', delayMs: 25_000, durationMs: DUR.greeting };
      return { action: 'ok', durationMs: DUR[cls] ?? 5000 };
    });
    const tour = await startAt(world, audio, BALBOA);
    const runs = watchKinds(world, tour);
    await world.clock.advance(20_000);
    const seq = kindSeq(runs);
    check('no filler during the opening (F12)', !seq.includes('filler') && !seq.includes('bridge'), seq.join(','));
    tour.endTour();
  }

  // ---------------------------------------------------------- S-11 Q&A serialization ×240 + failsafe
  suite('S-11 Q&A serialization (240 cycles)');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park')],
      library: ['Alpha Park'],
    });
    world.genAnswerBehavior = () =>
      new Promise(res =>
        world.clock.setTimeout(
          () => res(`The answer, number ${world.answerTextSeq + 1}: local color and fact. `.repeat(2)),
          500,
        ),
      );
    const audio = new FakeAudio(world.clock, okPolicy({ synth: 6_000, library: 8_000 }));
    const { tour, runs } = await healthyOpening(world, audio);
    let violations = 0;
    let expectedReleases = 0;
    for (let i = 0; i < 240; i++) {
      const releasesBefore = world.eventsOf('question_lock_released').length;
      if (!tour.submitQuestion(`Question number ${i}?`)) violations++;
      if (tour.submitQuestion('Sneaky second question?')) violations++; // A2
      await world.clock.advance(10_000); // generate (0.5 s) + answer (6 s) + settle
      if (tour.view().qaPhase !== 'awaiting-resume' && tour.view().qaPhase !== 'idle') violations++;
      if (i % 2 === 0) {
        // Story-resume release: move into a fresh area so an area
        // story is served and commits (area subjects are per-area).
        world.candidates = [];
        world.area = { neighborhood: `Zone ${i}`, city: 'San Diego' };
        tour.onPosition({ lat: UTC.lat + 0.003 * (i + 1), lng: UTC.lng, speedMps: 8, headingDeg: 180 });
        await world.clock.advance(20_000);
      } else {
        await world.clock.advance(50_000); // 45 s resume grace
      }
      if (tour.view().qaPhase !== 'idle') violations++;
      const releases = world.eventsOf('question_lock_released');
      if (releases.length !== releasesBefore + 1) violations++;
      else {
        expectedReleases++;
        const reason = releases[releases.length - 1].payload.reason;
        if (i % 2 === 0 && reason !== 'story-resumed') violations++;
        if (i % 2 === 1 && reason !== 'resume-grace') violations++;
      }
    }
    check('240 cycles: zero serialization violations', violations === 0, `violations=${violations}`);
    check('240 lock releases, one per cycle', expectedReleases === 240, `releases=${expectedReleases}`);
    const answerRuns = kindSeq(runs).filter(k => k === 'answer').length;
    check('every cycle produced exactly one answer run', answerRuns === 240, `runs=${answerRuns}`);
    check('answers answered counter', tour.view().diagnostics.questionsAnswered === 240, `=${tour.view().diagnostics.questionsAnswered}`);
    tour.endTour();
  }
  {
    // A4 failsafe: generation hangs; the lock must still release.
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], library: [] });
    world.genAnswerBehavior = () => new Promise(() => {});
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    check('question accepted', tour.submitQuestion('A question with no answer?') === true);
    await world.clock.advance(160_000);
    check('failsafe moved the lock to awaiting-resume', tour.view().qaPhase === 'awaiting-resume', tour.view().qaPhase);
    await world.clock.advance(50_000);
    const releases = world.eventsOf('question_lock_released');
    check('lock released after failsafe + grace', releases.length === 1 && releases[0].payload.reason === 'resume-grace', JSON.stringify(releases.map(r => r.payload)));
    check('input unlocked again', tour.view().qaLocked === false);
    tour.endTour();
  }

  // ---------------------------------------------------------- S-12 failure storm (E3/E7)
  suite('S-12 failure storm');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('One Place'), makeCandidate('Two Place'), makeCandidate('Three Place'), makeCandidate('Four Place')],
      library: [],
      synthBehavior: () => {
        throw new Error('tts down');
      },
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    for (let i = 0; i < 4; i++) {
      tour.onPosition({ lat: UTC.lat + 0.003 * (i + 1), lng: UTC.lng, speedMps: 8, headingDeg: 180 });
      await world.clock.advance(15_000);
    }
    check('storm trips after repeated failures', tour.view().diagnostics.storm === true, JSON.stringify(tour.view().diagnostics));
    check('synthesis failures are not playback attempts (E7)', audio.plays('synth').length === 0, JSON.stringify(audio.log.map(l => l.cls)));
    tour.endTour();
  }

  // ---------------------------------------------------------- S-13 resume start
  suite('S-13 resume within the window');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], library: [] });
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour1 = await startAt(world, audio, UTC);
    await world.clock.advance(20_000);
    check('session marker written', Tour.hasResumableSession() === true);
    // Simulate an app restart: a fresh engine over the same storage.
    const audio2 = new FakeAudio(world.clock, okPolicy());
    const tour2 = world.makeTour(audio2);
    tour2.onPosition({ ...UTC, speedMps: 0, headingDeg: null });
    tour2.start(true);
    await world.clock.advance(500);
    check('resume start plays a resume greeting', audio2.log[0]?.cls === 'greeting' && (audio2.log[0]?.src ?? '').includes('resume-'), JSON.stringify(audio2.log[0]));
    tour2.endTour();
    void tour1;
  }

  // ---------------------------------------------------------- S-14 player unit discipline
  suite('S-14 player settle-once / hold discipline');
  {
    const { Player } = extras;
    const clock = new FakeClock();
    const settles = new Map();
    let seq = 0;
    const mkItem = kind => {
      const id = `${kind}-${++seq}`;
      return {
        id,
        kind,
        label: id,
        source: { kind: 'url', url: `https://x.test/${id}.wav` },
        durationSec: 10,
        attempts: 0,
        settled: false,
        onSettle: () => settles.set(id, (settles.get(id) ?? 0) + 1),
      };
    };
    const hooks = {
      resolveUrl: async item => item.source.url,
      stallSource: () => null,
      emit: () => {},
      onFirstLatch: () => {},
      onPrimeCarrierFailed: () => {},
      onLatchLost: () => {},
      onLatchRestored: () => {},
      onFailureStreak: () => {},
      attemptCap: () => 3,
      judgeStory: () => ({ ok: true }),
      mayDisplace: () => false,
      onSlotEmpty: () => {},
      onCommit: () => {},
      onStoryCommitted: () => {},
      onWaiting: () => {},
      onSoundStart: () => {},
      onState: () => {},
    };
    const audio = new FakeAudio(clock, () => ({ action: 'ok', durationMs: 4000 }));
    const player = new Player(audio, clock, hooks);

    const s0 = mkItem('story');
    player.offerStory(s0, false);
    await clock.advance(10_000);
    check('held story is never attempted while the latch is unearned', audio.log.length === 0, JSON.stringify(audio.log));

    const g = mkItem('greeting');
    player.beginWithItem(g);
    const o = mkItem('opener');
    player.enqueuePromised(o);
    const s1 = mkItem('story');
    const s2 = mkItem('story');
    player.offerStory(s1, false);
    const landed = player.offerStory(s2, false); // slot full, no displacement → buffer
    check("overflow offer returns 'buffer' (ownership never transfers)", landed === 'buffer');
    await clock.advance(5_000); // greeting settles; opener plays
    await clock.advance(5_000); // opener settles; s0 (slot) plays
    player.skipCurrent();
    await clock.advance(1_000); // s1 plays
    player.pauseByUser();
    player.resumeByUser();
    const s3 = mkItem('story');
    player.offerStory(s3, true);
    await clock.advance(2_000);
    player.teardown();
    await clock.advance(1_000);
    for (const item of [g, o, s0, s3]) {
      check(`settled exactly once: ${item.id}`, settles.get(item.id) === 1, `count=${settles.get(item.id) ?? 0}`);
    }
    check("buffered items are not settled by the player", !settles.has(s1.id) && !settles.has(s2.id));
    check('latch earned via the carrier', player.latch === 'earned');
  }

  // ---------------------------------------------------------- S-15 adversarial-review regressions
  suite('S-15 review regressions (M5/M7/M8/M9/M10/M11, C1, corridor gate, filler claim)');
  {
    // M8: the waiting story is presynthesized at slot entry (S11),
    // while the current story still plays — and drives from that
    // warm cache without a second synthesis. Texts are name-tagged
    // so the count isolates Alpha's synthesis from the welcome's
    // and from the prefetch lane's own warmup synthesis.
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [],
      library: ['Bravo Library'],
    });
    world.genStoryBehavior = prompt =>
      prompt.includes('Alpha Live')
        ? 'ALPHA-TEXT a live story of Alpha Live, told at length with local color. '.repeat(16)
        : 'OTHER-TEXT a generated story told at length with local color. '.repeat(3);
    const synthTexts = [];
    world.synthBehavior = text => {
      synthTexts.push(text);
      return new Blob(['voice']);
    };
    const alphaSynths = () => synthTexts.filter(t => t.includes('ALPHA-TEXT')).length;
    const audio = new FakeAudio(world.clock, okPolicy({ library: 25_000, synth: 8_000 }));
    const { tour } = await healthyOpening(world, audio);
    check('welcome synthesized exactly once (presynth/drive dedupe)', synthTexts.length === 1 && alphaSynths() === 0, `synth=${synthTexts.length}`);
    // Candidates appear after the opening: had they been present
    // throughout, the prefetch lane would have warmed Alpha's
    // buffer text during the opening and this check would be
    // measuring the buffer, not the slot-entry presynth.
    world.candidates = [makeCandidate('Bravo Library'), makeCandidate('Alpha Live')];
    tour.onPosition({ lat: UTC.lat + 0.0025, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(3_000); // Bravo served and playing
    // A second movement step triggers the cycle that slots Alpha
    // behind Bravo (serve cycles are movement/slot-event driven).
    tour.onPosition({ lat: UTC.lat + 0.005, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(3_000);
    check('waiting story presynthesized at slot entry', alphaSynths() === 1, `alphaSynth=${alphaSynths()}`);
    await world.clock.advance(24_000); // Bravo (25 s) ends; Alpha takes over from the warm cache
    check('presynth consumed, not re-synthesized', alphaSynths() === 1, `alphaSynth=${alphaSynths()}`);
    check('waiting story sounds from its presynth', tour.view().nowPlaying?.label === 'Alpha Live' || audio.log.filter(e => e.cls === 'synth').length >= 2, tour.view().nowPlaying?.label ?? '-');
    tour.endTour();
  }
  {
    // M9: with a slow synthesis (6 s), the stall phrase sounds
    // DURING the wait (from ~4 s), never after the story lands.
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [makeCandidate('Slow Place')], library: [] });
    world.synthBehavior = () =>
      new Promise(res => world.clock.setTimeout(() => res(new Blob(['voice'])), 6_000));
    const audio = new FakeAudio(world.clock, okPolicy({ synth: 8_000 }));
    const { tour } = await healthyOpening(world, audio);
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(20_000);
    const stallIdx = audio.log.findIndex(e => e.cls === 'stall');
    const synthIdx = audio.log.findIndex(e => e.cls === 'synth');
    check('stall phrase sounds while the story resolves', stallIdx >= 0, JSON.stringify(audio.log.map(e => e.cls)));
    check('stall precedes the story it covers', synthIdx > stallIdx, `stall@${stallIdx} synth@${synthIdx}`);
    tour.endTour();
  }
  {
    // M11: pausing during a slow resolve — no attempt sounds into
    // the pause; resume lets the story play.
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [makeCandidate('Paused Place')], library: [] });
    // The story in flight at pause time is a NAMED place revealed
    // by the move below. (It used to be the generic `area:`
    // fallback — the Nov 1 orientation slot now suppresses that
    // serve once the area's WELCOME has sounded, which is the fix
    // working, not this scenario's subject.)
    world.synthBehavior = () =>
      new Promise(res => world.clock.setTimeout(() => res(new Blob(['voice'])), 5_000));
    const audio = new FakeAudio(world.clock, okPolicy({ synth: 8_000 }));
    const { tour } = await healthyOpening(world, audio);
    world.candidates = [
      makeCandidate('Paused Place'),
      makeCandidate('Late Place', { lat: UTC.lat + 0.003 }),
    ];
    const logBase = audio.log.length; // opening sounds are not this check's business
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(1_000); // story minted, resolve in flight
    tour.pauseByUser();
    await world.clock.advance(10_000); // resolve completes during the pause
    check('no play attempt while paused mid-resolve', audio.log.slice(logBase).every(e => e.cls !== 'synth'), JSON.stringify(audio.log.slice(logBase).map(e => e.cls)));
    tour.resumeByUser();
    await world.clock.advance(12_000);
    check('story sounds after resume', audio.log.slice(logBase).some(e => e.cls === 'synth'), JSON.stringify(audio.log.slice(logBase).map(e => e.cls)));
    tour.endTour();
  }
  {
    // M5: a WELCOME whose generation fails is re-owed (O15), the
    // tour still opens on its other legs, and the welcome is
    // re-served after the cooldown and delivered exactly once.
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [makeCandidate('Alpha Park')], library: ['Alpha Park'] });
    let welcomeAttempts = 0;
    world.genStoryBehavior = prompt => {
      if (prompt.includes('NEIGHBORHOOD WELCOME')) {
        welcomeAttempts += 1;
        if (welcomeAttempts === 1) throw new Error('welcome generation down');
        return 'Welcome to University City — a generated welcome with real local color and history. '.repeat(3);
      }
      return 'A generated story about the road ahead, told with care. '.repeat(3);
    };
    const audio = new FakeAudio(world.clock, okPolicy({ synth: 8_000, library: 10_000 }));
    const tour = world.makeTour(audio);
    const labels = watchLabels(world, tour);
    tour.onPosition({ ...UTC, speedMps: 8, headingDeg: 180 });
    tour.start(false);
    await world.clock.advance(60_000); // opening completes via the debt path; stories flow
    check('tour opens despite the failed welcome', tour.view().nowPlaying !== null || world.eventsOf('story_played').length > 0);
    await world.clock.advance(200_000); // past the 180 s re-owe cooldown
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(30_000);
    const welcomePlays = world.eventsOf('story_played').filter(e => e.payload.subject === 'welcome:university city');
    check('failed welcome re-served exactly once', welcomePlays.length === 1, `plays=${welcomePlays.length} attempts=${welcomeAttempts}`);
    check('re-served welcome sounded', labels.some(l => l.startsWith('Welcome to')), labels.join(','));
    tour.endTour();
  }
  {
    // M7: during a failure economy (here the synthesis stand-down:
    // three consecutive synthesis-failed settles), BANKED
    // (library) stories are preferred — they keep serving and
    // sounding; only live generation stands down. (An autoplay
    // block storm is a different economy — the latch-loss hold —
    // covered by S-03/S-13 territory; M7's fix was about not
    // silencing banked material under the generation economies.)
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], library: ['Banked Place'] });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 10_000, synth: 6_000 }));
    const { tour } = await healthyOpening(world, audio);
    // The failing candidates appear only AFTER the synthesis
    // outage begins — anything presynthesized during the healthy
    // opening would sound from cache and reset the failure streak.
    // (Banked Place's library row exists from the start — the tour
    // fetches the library index once, at init — but it can only
    // serve when it becomes a candidate, below.)
    world.candidates = [makeCandidate('Live One'), makeCandidate('Live Two'), makeCandidate('Live Three')];
    world.synthBehavior = () => {
      throw new Error('tts down');
    };
    // The candidates are anchored at the tour's start point.
    // Serve cycles trigger on >200 m of movement, so step ~245 m
    // at a time; the generated texts are long (~100 s ⇒ ~800 m of
    // reach at this speed) so the anchors stay in reach and pass
    // the behind-cut for the whole sequence — the stories serve,
    // drive, and fail synthesis, which is the failure exercised.
    world.genStoryBehavior = () =>
      'A long generated story about the road ahead, told with care and local color in full. '.repeat(12);
    for (let i = 1; i <= 3; i++) {
      tour.onPosition({ lat: UTC.lat + 0.0022 * i, lng: UTC.lng, speedMps: 8, headingDeg: 0 });
      await world.clock.advance(15_000);
    }
    check('synthesis stand-down engaged', tour.view().diagnostics.storm === true, JSON.stringify(tour.view().diagnostics));
    let generationsAfterStorm = 0;
    world.genStoryBehavior = () => {
      generationsAfterStorm += 1;
      return 'A generated story about the road ahead, told with care. '.repeat(3);
    };
    world.candidates = [makeCandidate('Banked Place'), makeCandidate('Live Four')];
    tour.onPosition({ lat: UTC.lat, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(20_000);
    check('banked library story serves during the stand-down', world.eventsOf('story_played').some(e => e.payload.subject === 'banked place'), JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    check('live generation stood down during the stand-down', generationsAfterStorm === 0, `gen=${generationsAfterStorm}`);
    tour.endTour();
  }
  {
    // M10: ending the tour while a Q&A lock awaits resumption
    // releases the lock exactly once (tour-ended) — the answer's
    // teardown settle must not release it a second time.
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [makeCandidate('Alpha Park')], library: ['Alpha Park'] });
    const audio = new FakeAudio(world.clock, okPolicy({ synth: 5_000, library: 8_000 }));
    const { tour } = await healthyOpening(world, audio);
    check('question accepted', tour.submitQuestion('What is around here?') === true);
    await world.clock.advance(15_000);
    check('lock awaiting resume before end', tour.view().qaPhase === 'awaiting-resume' || tour.view().qaPhase === 'idle', tour.view().qaPhase);
    tour.endTour();
    const releases = world.eventsOf('question_lock_released');
    check('exactly one release at end of tour', releases.length === 1 && releases[0].payload.reason === 'tour-ended', JSON.stringify(releases.map(r => r.payload)));
    await world.clock.advance(60_000);
    check('no second release after teardown settles', world.eventsOf('question_lock_released').length === 1);
  }
  {
    // C1 (player level): a sample prime attempted while another
    // item is mid-drive must not settle or disturb that item —
    // the prime runs isolated, the item sounds and settles once.
    const { Player } = extras;
    const clock = new FakeClock();
    const settles = new Map();
    const mkItem = (kind, url) => ({
      id: `${kind}-c1`, kind, label: `${kind}-c1`,
      source: { kind: 'url', url }, durationSec: 6, attempts: 0, settled: false,
      onSettle: () => settles.set(`${kind}-c1`, (settles.get(`${kind}-c1`) ?? 0) + 1),
    });
    const hooks = {
      resolveUrl: async item => item.source.url,
      stallSource: () => null,
      emit: () => {},
      onFirstLatch: () => {},
      onPrimeCarrierFailed: () => {},
      onLatchLost: () => {},
      onLatchRestored: () => {},
      onFailureStreak: () => {},
      attemptCap: () => 3,
      judgeStory: () => ({ ok: true }),
      mayDisplace: () => false,
      onSlotEmpty: () => {},
      onCommit: () => {},
      onStoryCommitted: () => {},
      onWaiting: () => {},
      onSoundStart: () => {},
      onState: () => {},
    };
    const audio = new FakeAudio(clock, ({ src }) =>
      src.includes('delayed') ? { action: 'delay', delayMs: 8_000, durationMs: 4_000 } : { action: 'ok', durationMs: 200 },
    );
    const player = new Player(audio, clock, hooks);
    const g = mkItem('greeting', 'https://x.test/g.wav');
    player.beginWithItem(g); // earns the latch (fast ok)
    await clock.advance(1_000);
    const s = mkItem('story', 'https://x.test/delayed.wav');
    player.offerStory(s, false); // becomes current; play delayed 8 s
    await clock.advance(1_000); // mid-drive: play() still pending
    player.attemptSamplePrime('prime');
    await clock.advance(3_000); // sample prime completes in isolation
    check('mid-drive item untouched by the sample prime', (settles.get('story-c1') ?? 0) === 0, `settles=${settles.get('story-c1') ?? 0}`);
    await clock.advance(12_000); // delayed play lands; item sounds, ends
    check('mid-drive item settles exactly once, sounded', (settles.get('story-c1') ?? 0) === 1, `settles=${settles.get('story-c1') ?? 0}`);
    player.teardown();
  }
  {
    // Corridor gate (M2): a corridor trigger during the opening —
    // before the WELCOME is handed — banks nothing; the corridor
    // story serves only on a later trigger, behind the welcome.
    resetLocalStorage();
    const segLen = s =>
      s.polyline.reduce((acc, p, i) => (i === 0 ? 0 : acc + Math.hypot((p.lat - s.polyline[i - 1].lat) * 111_320, (p.lng - s.polyline[i - 1].lng) * 88_000)), 0);
    const picked = CORRIDOR_SEGMENTS.filter(s => segLen(s) > 4000).reduce((a, b) => (segLen(a) > segLen(b) ? a : b));
    const start = picked.polyline[0];
    const second = picked.polyline[1];
    const heading = ((Math.atan2(second.lng - start.lng, second.lat - start.lat) * 180) / Math.PI + 360) % 360;
    const seg = matchCorridor({ lat: start.lat, lng: start.lng, heading })?.segment ?? picked;
    const world = makeWorld(Tour, { candidates: [], library: [seg.displayName] });
    const audio = new FakeAudio(world.clock, okPolicy({ synth: 12_000 }));
    const tour = world.makeTour(audio);
    tour.onPosition({ lat: start.lat, lng: start.lng, speedMps: 27, headingDeg: heading });
    tour.start(false);
    await world.clock.advance(3_000); // greeting sounding; welcome not yet handed
    tour.onPosition({ lat: start.lat, lng: start.lng, speedMps: 27, headingDeg: heading });
    await world.clock.advance(2_000);
    const corridorKey = seg.displayName.toLowerCase();
    check(
      'no corridor serve before the welcome is handed',
      !world.eventsOf('story_played').some(e => e.payload.subject === corridorKey),
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)),
    );
    await world.clock.advance(30_000); // welcome handed and playing
    tour.onPosition({ lat: start.lat, lng: start.lng, speedMps: 27, headingDeg: heading });
    await world.clock.advance(10_000);
    check(
      'corridor serves on a later trigger, behind the welcome',
      world.eventsOf('story_played').some(e => e.payload.subject.startsWith('corridor:') && e.payload.source === 'corridor'),
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload)),
    );
    void corridorKey;
    tour.endTour();
  }
  {
    // F3 claim-first (C3): with a SLOW pinned-cache lookup, the
    // silence ticks during the lookup must not fire a second
    // pair — exactly one bridge is enqueued for the window.
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [],
      library: [],
      fillers: ['San Diego Weather Patterns', 'The Kumeyaay Homeland'],
    });
    const origHas = world.seams.audioCacheHas;
    world.seams.audioCacheHas = async key => {
      await new Promise(res => world.clock.setTimeout(res, 3_000));
      return origHas(key);
    };
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    // Watch nowPlaying label transitions: F4 plays bridges from
    // pinned-cache blob URLs, so the audio log's class surface
    // cannot see them — the view can. A duplicate fire would put
    // two bridges back-to-back with no filler between them.
    const transitions = [];
    let lastLabel = undefined;
    world.clock.setInterval(() => {
      const label = tour.view().nowPlaying?.label ?? null;
      if (label !== lastLabel) {
        if (label !== null) transitions.push(label);
        lastLabel = label;
      }
    }, 200);
    await world.clock.advance(90_000); // long true silence; pairs fire
    const bridgeEntrances = transitions.filter(l => l.startsWith('Bridge —')).length;
    const fillerEntrances = transitions.filter(l => l === 'San Diego Weather Patterns' || l === 'The Kumeyaay Homeland').length;
    let doubledBridge = false;
    for (let i = 1; i < transitions.length; i++) {
      if (transitions[i].startsWith('Bridge —') && transitions[i - 1].startsWith('Bridge —')) doubledBridge = true;
    }
    check('pairs fire whole under slow cache checks (one bridge per filler)', bridgeEntrances >= 1 && Math.abs(bridgeEntrances - fillerEntrances) <= 1 && !doubledBridge, `bridges=${bridgeEntrances} fillers=${fillerEntrances} seq=${transitions.join('|')}`);
    tour.endTour();
  }

  // ---------------------------------------------------------- C-01 commentary gate
  suite('C-01 commentary gate: no completed story, no commentary');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], library: [] });
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);
    await world.clock.advance(180_000);
    check('no commentary_played without a completed story', world.eventsOf('commentary_played').length === 0);
    check('no commentary_cut without a completed story', world.eventsOf('commentary_cut').length === 0);
    tour.endTour();
  }

  // ---------------------------------------------------------- C-02/C-03 commentary fire, cap, cut
  suite('C-02 commentary fires into a dry gap; cap holds; C-03 a committing story cuts it');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);
    // Drive until the first story completes, then run the pipeline
    // dry: no candidates, generation and synthesis both failing.
    let completed = false;
    for (let i = 0; i < 48 && !completed; i++) {
      await world.clock.advance(5_000);
      completed = world.eventsOf('story_playback').some(e => e.payload.completed === true);
    }
    check('C-02 precondition: a story completed', completed);
    world.candidates = [];
    world.genStoryBehavior = async () => { throw new Error('dry'); };
    world.synthBehavior = async () => { throw new Error('dry'); };
    // The lane speaks into the idle gap (fillers may interleave).
    let firstFireAt = null;
    for (let i = 0; i < 36 && firstFireAt === null; i++) {
      await world.clock.advance(5_000);
      const cp = world.eventsOf('commentary_played');
      if (cp.length >= 1) firstFireAt = cp[0].at;
      else if (tour.view().nowPlaying?.kind === 'commentary') {
        // Playing but not yet settled; keep advancing to its settle.
      }
    }
    if (firstFireAt === null) {
      // A clip may still be mid-play at the window's end; settle it.
      for (let i = 0; i < 6 && firstFireAt === null; i++) {
        await world.clock.advance(5_000);
        const cp = world.eventsOf('commentary_played');
        if (cp.length >= 1) firstFireAt = cp[0].at;
      }
    }
    check('C-02 commentary fired after the first story, into the dry gap', firstFireAt !== null,
      `played=${world.eventsOf('commentary_played').length} cut=${world.eventsOf('commentary_cut').length}`);
    // Cap: nothing more until ~4 minutes after the fire.
    if (firstFireAt !== null) {
      while (world.clock.now() < firstFireAt + 230_000) {
        await world.clock.advance(10_000);
      }
      check('C-02 cap holds: still exactly one commentary_played inside 230s',
        world.eventsOf('commentary_played').length === 1,
        `count=${world.eventsOf('commentary_played').length}`);
      // C-03: after the cap, wait for the next clip to be PLAYING,
      // then land a fresh story commit on top of it.
      let playing = false;
      for (let i = 0; i < 60 && !playing; i++) {
        await world.clock.advance(2_000);
        playing = tour.view().nowPlaying?.kind === 'commentary';
      }
      check('C-03 precondition: a second clip is playing after the cap', playing);
      if (playing) {
        world.genStoryBehavior = null;
        world.synthBehavior = null;
        world.candidates = [makeCandidate('Cabrillo Point')];
        tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
        for (let i = 0; i < 12; i++) {
          await world.clock.advance(500);
          if (world.eventsOf('commentary_cut').length >= 1) break;
        }
        check('C-03 the committing story cut the commentary (commentary_cut filed)',
          world.eventsOf('commentary_cut').length >= 1,
          `cuts=${world.eventsOf('commentary_cut').length} played=${world.eventsOf('commentary_played').length}`);
        check('C-03 the cut clip did not file commentary_played',
          world.eventsOf('commentary_played').length === 1);
        check('C-03 the new story committed (story_played for the fresh subject)',
          world.eventsOf('story_played').some(e => String(e.payload.subject ?? '').includes('cabrillo')),
          JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
      }
    }
    tour.endTour();
  }

  // ---------------------------------------------------------- P2 opener stack: warmed prime carrier
  suite('P2 warmed prime carrier: the greeting plays from a warmed blob, not the network');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = world.makeTour(audio);
    tour.onPosition({ ...UTC, speedMps: 8, headingDeg: 180 });
    await tour.warmLanding();
    check('landing warm resolved clip blob URLs', tour.clipUrls.size > 0, `size=${tour.clipUrls.size}`);
    tour.start(false);
    const first = audio.log[0];
    check(
      'first media action is the greeting, sourced from a blob URL',
      Boolean(first) && typeof first.src === 'string' && first.src.startsWith('blob:'),
      `first=${first ? first.src : 'none'}`,
    );
    await world.clock.advance(40_000);
    check('tour latched on the warmed carrier', world.eventsOf('unlock_latched').length === 1,
      `latched=${world.eventsOf('unlock_latched').length}`);
    tour.endTour();
  }

  suite('P2 control: an unwarmed start falls back to the bucket URL');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [] });
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);
    const first = audio.log[0];
    check(
      'unwarmed greeting plays from the bucket URL',
      Boolean(first) && typeof first.src === 'string' && first.src.includes('miles/intros/'),
      `first=${first ? first.src : 'none'}`,
    );
    tour.endTour();
  }

  // ---------------------------------------------------------- P1 telemetry depth
  suite('P1 telemetry: opener_clip, first_serve, settle geometry, story_timing, Q&A events, session_end');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);
    await world.clock.advance(60_000); // greeting + opener + welcome + Balboa

    const clips = world.eventsOf('opener_clip');
    check('opener_clip filed for the primary opener', clips.length >= 1 && clips[0].payload.segment === 'primary',
      JSON.stringify(clips.map(c => c.payload.segment)));
    check('opener_clip carries clip identity + length class',
      clips.length >= 1 && typeof clips[0].payload.opener_id === 'string' && clips[0].payload.opener_id.length > 0 &&
      ['short', 'medium', 'long'].includes(clips[0].payload.length_class),
      JSON.stringify(clips[0]?.payload ?? null));
    check('opener_clip sounded truthfully', clips.length >= 1 && clips[0].payload.sounded === true);

    const fs = world.eventsOf('first_serve');
    check('first_serve filed exactly once, source=welcome', fs.length === 1 && fs[0].payload.source === 'welcome',
      JSON.stringify(fs.map(e => e.payload)));

    const playbacks = world.eventsOf('story_playback');
    check('stories settled for the geometry checks', playbacks.length >= 2, `n=${playbacks.length}`);
    const w = playbacks[0]?.payload ?? {};
    check('story_playback carries attempts + engine', typeof w.attempts === 'number' && w.engine === 'gemini',
      JSON.stringify(w));
    check('story_playback carries queue wait + horizon', typeof w.time_in_queue_s === 'number' && typeof w.horizon_s === 'number',
      JSON.stringify({ q: w.time_in_queue_s, h: w.horizon_s }));
    check('story_playback carries told_late (welcome is region-anchored: false)', w.told_late === false,
      JSON.stringify(w.told_late));

    const timings = world.eventsOf('story_timing');
    check('story_timing filed with fetchTextS for the live welcome',
      timings.some(e => typeof e.payload.fetchTextS === 'number'),
      JSON.stringify(timings.map(e => e.payload)));
    check('story_timing carries synthS + cacheHit for a synthesized story',
      timings.some(e => typeof e.payload.synthS === 'number' && e.payload.cacheHit === false),
      JSON.stringify(timings.map(e => e.payload)));

    const asked = tour.submitQuestion('What is this place?');
    check('question accepted', asked === true);
    await world.clock.advance(45_000);
    const qa = world.eventsOf('question_asked');
    check('question_asked filed with the QA model', qa.length === 1 && typeof qa[0].payload.model === 'string' && qa[0].payload.model.length > 0,
      JSON.stringify(qa.map(e => e.payload)));
    const qp = world.eventsOf('question_playback');
    check('question_playback filed, completed', qp.length >= 1 && qp[0].payload.completed === true,
      JSON.stringify(qp.map(e => e.payload)));

    tour.endTour();
    const se = world.eventsOf('session_end');
    check('session_end filed once at tour end', se.length === 1 && se[0].payload.ms_from_tour_start > 0,
      JSON.stringify(se.map(e => e.payload)));
  }

  suite('P1 audio_blocked is countable; generation failure files pipeline_diag');
  {
    resetLocalStorage();
    const blockedWorld = makeWorld(Tour, { candidates: [] });
    const blockedAudio = new FakeAudio(blockedWorld.clock, () => ({ action: 'reject', name: 'NotAllowedError' }));
    const blockedTour = await startAt(blockedWorld, blockedAudio, UTC);
    await blockedWorld.clock.advance(10_000);
    const ab = blockedWorld.eventsOf('audio_blocked');
    check('audio_blocked filed on platform refusal', ab.length >= 1 && ab[0].payload.kind === 'blocked',
      `n=${ab.length}`);
    blockedTour.endTour();

    resetLocalStorage();
    const failWorld = makeWorld(Tour, {
      candidates: [makeCandidate('Fail Place')],
      library: [],
      genStoryBehavior: async prompt => {
        if (prompt.includes('Fail Place')) throw new Error('boom');
        return 'A story about the neighborhood, told well and at length for the listener. '.repeat(3);
      },
    });
    // Starve the prefetch lane (its fake ignores genStoryBehavior and
    // would buffer the failing candidate, hiding the live failure):
    // discovery ahead of the car returns nothing, so the candidate
    // can only be served by a live generation — which fails.
    failWorld.seams.discoverCandidates = async pt =>
      Math.abs(pt.lat - UTC.lat) > 0.001 || Math.abs(pt.lng - UTC.lng) > 0.001
        ? []
        : failWorld.candidates;
    const failAudio = new FakeAudio(failWorld.clock, okPolicy());
    const failTour = await startAt(failWorld, failAudio, UTC);
    await failWorld.clock.advance(90_000);
    const diags = failWorld.eventsOf('pipeline_diag');
    check('pipeline_diag filed for the failed generation (stage=text)',
      diags.some(e => e.payload.stage === 'text' && e.payload.reason === 'generation-failed'),
      JSON.stringify(diags.map(e => e.payload)));
    failTour.endTour();
  }

  // ---------------------------------------------------------- P3 tour-thread prompt feed
  suite('P3 tour thread: delivered tellings feed later generation prompts');
  {
    resetLocalStorage();
    const prompts = [];
    const world = makeWorld(Tour, {
      candidates: [
        makeCandidate('Balboa Park'),
        makeCandidate('Live Place'),
        makeCandidate('Third Place'),
      ],
      library: ['Balboa Park'],
      genStoryBehavior: async prompt => {
        prompts.push(prompt);
        if (prompt.includes('Tell the story of Live Place.')) {
          return 'Live Place hides a 1911 powerhouse behind its eucalyptus grove. ' +
            'The rest of the tale unfolds slowly, the way all good local stories do, with care. '.repeat(3);
        }
        return 'A generated story about the road ahead, told with care and local color. '.repeat(3);
      },
    });
    // Starve prefetch (same trick as the P1 diag world): discovery
    // answers only at the car's exact position — prefetch asks
    // ahead of the car and gets nothing — so every story generates
    // live, at serve time, and its prompt is observable.
    world.seams.discoverCandidates = async pt =>
      Math.abs(pt.lat - UTC.lat) < 0.0001 && Math.abs(pt.lng - UTC.lng) < 0.0001
        ? world.candidates
        : [];
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);

    const playedCount = () => world.eventsOf('story_playback').filter(e => e.payload.completed).length;
    // Welcome + Balboa (library) deliver first.
    for (let i = 0; i < 30 && playedCount() < 2; i++) await world.clock.advance(5_000);
    check('P3 precondition: welcome + Balboa delivered', playedCount() >= 2, `played=${playedCount()}`);
    check('first generation prompt (the welcome) has NO thread block',
      prompts.length >= 1 && !prompts[0].includes('TOUR THREAD SO FAR'),
      `prompts=${prompts.length}`);

    // The settle-chained serve cycle generates Live Place next,
    // with the thread aboard.
    for (let i = 0; i < 30 && !prompts.some(p => p.includes('Tell the story of Live Place.')); i++) {
      await world.clock.advance(2_000);
    }
    const livePrompt = prompts.find(p => p.includes('Tell the story of Live Place.'));
    check('Live Place generated live after Balboa delivered', Boolean(livePrompt), `prompts=${prompts.length}`);
    check('its prompt carries the TOUR THREAD block', Boolean(livePrompt) && livePrompt.includes('TOUR THREAD SO FAR'));
    check('the thread names the delivered Balboa telling',
      Boolean(livePrompt) && livePrompt.includes('Balboa Park'));
    check('the welcome is NOT a thread entry',
      Boolean(livePrompt) && !livePrompt.includes('Welcome to University City'));

    // Live Place delivers; Third Place's prompt must carry its
    // captured signature fact, quoted, under Live Place's line.
    for (let i = 0; i < 30 && playedCount() < 3; i++) await world.clock.advance(5_000);
    check('P3 precondition: Live Place delivered', playedCount() >= 3, `played=${playedCount()}`);
    for (let i = 0; i < 30 && !prompts.some(p => p.includes('Tell the story of Third Place.')); i++) {
      await world.clock.advance(2_000);
    }
    const thirdPrompt = prompts.find(p => p.includes('Tell the story of Third Place.'));
    check('Third Place generated live', Boolean(thirdPrompt), `prompts=${prompts.length}`);
    check('its thread carries Live Place\u2019s signature fact, quoted',
      Boolean(thirdPrompt) &&
        thirdPrompt.includes('"Live Place hides a 1911 powerhouse behind its eucalyptus grove."'),
      thirdPrompt ? thirdPrompt.slice(thirdPrompt.indexOf('TOUR THREAD'), thirdPrompt.indexOf('TOUR THREAD') + 400) : 'none');
    tour.endTour();
  }

  // ---------------------------------------------------------- P4 cross-day heard-topics
  suite('P4 cross-day heard ledger: yesterday\u2019s stories do not re-serve today');
  {
    resetLocalStorage();
    let seamKey = null;
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park'), makeCandidate('Cabrillo Point')],
      library: ['Balboa Park', 'Cabrillo Point'],
    });
    world.seams.fetchHeardTopics = async userKey => {
      seamKey = userKey;
      return [' balboa PARK ']; // as recorded: a display name, messy case/space
    };
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);
    // Welcome + Cabrillo deliver; Balboa must never even commit.
    for (let i = 0; i < 30 && !world.eventsOf('story_playback').some(e => e.payload.subject === 'cabrillo point'); i++) {
      await world.clock.advance(5_000);
    }
    check('the seam was called with the device key', typeof seamKey === 'string' && seamKey.startsWith('leo-'),
      `key=${seamKey}`);
    check('the cross-day-heard subject never committed',
      !world.eventsOf('story_played').some(e => e.payload.subject === 'balboa park'),
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    check('the unheard subject served normally',
      world.eventsOf('story_playback').some(e => e.payload.subject === 'cabrillo point'));
    tour.endTour();

    // Control: an empty ledger changes nothing.
    resetLocalStorage();
    const control = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
    });
    const controlAudio = new FakeAudio(control.clock, okPolicy());
    const controlTour = await startAt(control, controlAudio, UTC);
    await control.clock.advance(60_000);
    check('control: with an empty ledger the same subject serves',
      control.eventsOf('story_played').some(e => e.payload.subject === 'balboa park'),
      JSON.stringify(control.eventsOf('story_played').map(e => e.payload.subject)));
    controlTour.endTour();
  }

  suite('P4 guard: the in-tour Tier-1 retell (Q14) survives the heard filter');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Grand Place', { tier1: true })],
      library: [],
    });
    // Starve prefetch so both tellings generate live at serve time.
    world.seams.discoverCandidates = async pt =>
      Math.abs(pt.lat - UTC.lat) < 0.0001 && Math.abs(pt.lng - UTC.lng) < 0.0001
        ? world.candidates
        : [];
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);
    const commits = () =>
      world.eventsOf('story_played').filter(e => e.payload.subject === 'grand place').length;
    for (let i = 0; i < 40 && commits() < 2; i++) await world.clock.advance(5_000);
    check('Tier-1 place told, then retold once in-tour (Q14 intact)',
      commits() === 2, `commits=${commits()}`);
    tour.endTour();
  }

  // ---------------------------------------------------------- W: mid-tour shelf welcomes (Erik, Oct 30)
  // The owed (area-entry) WELCOME serves the banked neighborhood
  // intro when the shelf holds one; live generation is the fallback.
  // A cross-day-heard intro earns a LIVE alternate instead of
  // silence (W-04b/c). The OPENING welcome tries live first and
  // falls back to the stored intro on failure or deadline (W2).

  const welcomePromptsFor = (world, name) =>
    world.genStoryPrompts.filter(p => p.includes('NEIGHBORHOOD WELCOME') && p.includes(name));
  const welcomePlayed = (world, subject) =>
    world.eventsOf('story_played').filter(e => e.payload.subject === subject);

  suite('W-01 mid-tour welcome: shelf intro serves, zero welcome generation');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: ['Clairemont'] });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    world.area = { neighborhood: 'Clairemont', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(60_000);
    check('the shelf was asked for the entered area', world.introFetches.join(',') === 'Clairemont',
      world.introFetches.join(','));
    const played = welcomePlayed(world, 'welcome:clairemont');
    check('welcome committed exactly once', played.length === 1, `n=${played.length}`);
    check('welcome source is the library', played[0]?.payload.source === 'library',
      JSON.stringify(played[0]?.payload));
    check('welcome angle is neighborhood_intro', played[0]?.payload.angle === 'neighborhood_intro',
      JSON.stringify(played[0]?.payload));
    check('the banked intro audio is what played',
      audio.log.some(e => typeof e.src === 'string' && e.src.endsWith('library/clairemont/neighborhood_intro.wav')),
      JSON.stringify(audio.log.map(e => e.src)));
    check('zero generation calls for the mid-tour welcome', welcomePromptsFor(world, 'Clairemont').length === 0,
      `prompts=${welcomePromptsFor(world, 'Clairemont').length}`);
    check('the only welcome generation all tour was the opening',
      world.genStoryPrompts.filter(p => p.includes('NEIGHBORHOOD WELCOME')).length === 1);
    check('welcome sounded to completion in the terminal pair',
      world.eventsOf('story_playback').some(e => e.payload.subject === 'welcome:clairemont' && e.payload.sounded === true));
    check('heard ledger filed the welcome like a live one', world.heard.includes('Welcome to Clairemont'),
      world.heard.join(' | '));
    tour.endTour();
  }

  suite('W-02 mid-tour welcome: no shelf row → live generation fallback');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: [] });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    world.area = { neighborhood: 'Clairemont', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(60_000);
    check('the shelf was asked first', world.introFetches.join(',') === 'Clairemont',
      world.introFetches.join(','));
    check('live welcome generated for the uncovered area', welcomePromptsFor(world, 'Clairemont').length === 1,
      `prompts=${welcomePromptsFor(world, 'Clairemont').length}`);
    const played = welcomePlayed(world, 'welcome:clairemont');
    check('welcome committed once, sourced live', played.length === 1 && played[0]?.payload.source === 'live',
      JSON.stringify(played.map(e => e.payload)));
    tour.endTour();
  }

  suite('W-03 opening welcome: stays live even when the shelf holds the start area');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: ['University City'] });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    check('the opening welcome was generated', welcomePromptsFor(world, 'University City').length === 1,
      `prompts=${welcomePromptsFor(world, 'University City').length}`);
    const played = welcomePlayed(world, 'welcome:university city');
    check('opening welcome committed once, sourced live',
      played.length === 1 && played[0]?.payload.source === 'live', JSON.stringify(played.map(e => e.payload)));
    check('the shelf was never consulted for the opening', world.introFetches.length === 0,
      world.introFetches.join(','));
    check('the banked intro audio never played',
      !audio.log.some(e => typeof e.src === 'string' && e.src.includes('neighborhood_intro.wav')),
      JSON.stringify(audio.log.map(e => e.src)));
    tour.endTour();
  }

  suite('W-04a heard/welcomed discipline: re-entering a welcomed area serves nothing');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: ['Clairemont', 'Linda Vista'] });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    world.area = { neighborhood: 'Clairemont', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(60_000);
    world.area = { neighborhood: 'Linda Vista', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.008, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(60_000);
    world.area = { neighborhood: 'Clairemont', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(60_000);
    check('Clairemont welcomed exactly once across two entries',
      welcomePlayed(world, 'welcome:clairemont').length === 1,
      `n=${welcomePlayed(world, 'welcome:clairemont').length}`);
    check('the shelf was asked for Clairemont exactly once',
      world.introFetches.filter(n => n === 'Clairemont').length === 1, world.introFetches.join(','));
    check('no live welcome was generated for Clairemont either',
      welcomePromptsFor(world, 'Clairemont').length === 0);
    tour.endTour();
  }

  suite('W-04b heard discipline: a cross-day-heard area gets the LIVE alternate welcome');
  {
    // Erik's doctrine extension (Oct 30) supersedes the original
    // W-04b: a heard intro is not silence — the alternate version
    // is a fresh live generation. The shelf row (the heard
    // version) is never re-served.
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: ['Clairemont'] });
    // As recorded on a previous day: a telling labeled with the
    // area's own name — the P4 ledger keys it 'clairemont'.
    world.seams.fetchHeardTopics = async () => ['Clairemont'];
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    world.area = { neighborhood: 'Clairemont', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(60_000);
    const played = welcomePlayed(world, 'welcome:clairemont');
    check('the alternate welcome committed exactly once', played.length === 1,
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    check('the alternate is sourced live, not the heard shelf version',
      played[0]?.payload.source === 'live', JSON.stringify(played[0]?.payload));
    check('a live welcome was generated for the heard area',
      welcomePromptsFor(world, 'Clairemont').length === 1,
      `prompts=${welcomePromptsFor(world, 'Clairemont').length}`);
    // (Nov 1: the engine now consults the shelf once to learn
    // whether a greeting variant exists — none here — so the
    // doctrine is asserted at the speaker: the heard shelf
    // version never PLAYED.)
    check('the heard shelf version never played',
      !audio.log.some(e => typeof e.src === 'string' && e.src.endsWith('library/clairemont/neighborhood_intro.wav')),
      JSON.stringify(audio.log.map(e => e.src)));
    check('the alternate sounded to completion',
      world.eventsOf('story_playback').some(e => e.payload.subject === 'welcome:clairemont' && e.payload.sounded === true));
    check('the tour itself is unharmed', tour.view().phase === 'active', tour.view().phase);
    tour.endTour();
  }

  suite('W-04c heard discipline: cross-day-heard + live down → silence, owed discharged');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: ['Clairemont'] });
    world.seams.fetchHeardTopics = async () => ['Clairemont'];
    // Live is down (the tripped-breaker shape): every generation throws.
    world.genStoryBehavior = () => {
      throw new Error('story quota tripped');
    };
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    world.area = { neighborhood: 'Clairemont', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(60_000);
    check('no welcome of either kind committed for the heard area',
      welcomePlayed(world, 'welcome:clairemont').length === 0,
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    check('the live alternate was attempted exactly once',
      welcomePromptsFor(world, 'Clairemont').length === 1,
      `prompts=${welcomePromptsFor(world, 'Clairemont').length}`);
    check('the heard shelf version never played',
      !audio.log.some(e => typeof e.src === 'string' && e.src.endsWith('library/clairemont/neighborhood_intro.wav')),
      JSON.stringify(audio.log.map(e => e.src)));
    await world.clock.advance(240_000); // far past the 180 s welcome cooldown
    check('the owed record was discharged — no cooldown retry mints a second attempt',
      welcomePromptsFor(world, 'Clairemont').length === 1,
      `prompts=${welcomePromptsFor(world, 'Clairemont').length}`);
    check('still no welcome after the cooldown window',
      welcomePlayed(world, 'welcome:clairemont').length === 0);
    check('the tour itself is unharmed', tour.view().phase === 'active', tour.view().phase);
    tour.endTour();
  }

  // ---------------------------------------------------------- W2: opening deadline fallback (Erik, Oct 30)
  // The OPENING welcome tries live first — custom, ear-catching —
  // but races WELCOME_LIVE_DEADLINE_MS (12 s): on a miss or an
  // outright failure the stored shelf intro serves in its place.
  // (W-03 above remains the instant-live case: shelf never asked.)

  suite('W-05 opening welcome: live misses the deadline → shelf intro serves, late live discarded');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: ['University City'] });
    // Live generation takes 20 s — past the 12 s deadline.
    world.genStoryBehavior = () =>
      new Promise(res =>
        world.clock.setTimeout(
          () => res('A slow welcome to the neighborhood, arriving after its moment. '.repeat(3)),
          20_000,
        ),
      );
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);
    await world.clock.advance(11_000); // deadline (12 s) not yet reached
    check('nothing served before the deadline — live still has the floor',
      welcomePlayed(world, 'welcome:university city').length === 0);
    check('the shelf has not been consulted yet', world.introFetches.length === 0,
      world.introFetches.join(','));
    await world.clock.advance(60_000); // deadline fires; shelf serves; late live lands at ~20 s
    const played = welcomePlayed(world, 'welcome:university city');
    check('exactly one welcome committed', played.length === 1, `n=${played.length}`);
    check('the committed welcome is the stored intro', played[0]?.payload.source === 'library',
      JSON.stringify(played[0]?.payload));
    check('welcome angle is neighborhood_intro', played[0]?.payload.angle === 'neighborhood_intro',
      JSON.stringify(played[0]?.payload));
    check('the banked intro audio is what played',
      audio.log.some(e => typeof e.src === 'string' && e.src.endsWith('library/university-city/neighborhood_intro.wav')),
      JSON.stringify(audio.log.map(e => e.src)));
    check('the shelf was consulted exactly once, for the fallback',
      world.introFetches.join(',') === 'University City', world.introFetches.join(','));
    check('the live attempt was made (and its late result discarded)',
      welcomePromptsFor(world, 'University City').length === 1,
      `prompts=${welcomePromptsFor(world, 'University City').length}`);
    check('the stored welcome sounded to completion',
      world.eventsOf('story_playback').some(e => e.payload.subject === 'welcome:university city' && e.payload.sounded === true));
    tour.endTour();
  }

  suite('W-06 opening welcome: live inside the deadline wins — shelf never fetched');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: ['University City'] });
    // Live generation takes 5 s — inside the 12 s deadline.
    world.genStoryBehavior = () =>
      new Promise(res =>
        world.clock.setTimeout(
          () => res('A prompt welcome to the neighborhood, generated fresh. '.repeat(3)),
          5_000,
        ),
      );
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    const played = welcomePlayed(world, 'welcome:university city');
    check('the live welcome committed exactly once', played.length === 1, `n=${played.length}`);
    check('the committed welcome is sourced live', played[0]?.payload.source === 'live',
      JSON.stringify(played[0]?.payload));
    check('the shelf was never fetched for the fallback', world.introFetches.length === 0,
      world.introFetches.join(','));
    check('the banked intro audio never played',
      !audio.log.some(e => typeof e.src === 'string' && e.src.includes('neighborhood_intro.wav')),
      JSON.stringify(audio.log.map(e => e.src)));
    tour.endTour();
  }

  suite('W-07 opening welcome: live fails outright → shelf intro serves');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: ['University City'] });
    world.genStoryBehavior = () => {
      throw new Error('story quota tripped');
    };
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    const played = welcomePlayed(world, 'welcome:university city');
    check('exactly one welcome committed', played.length === 1, `n=${played.length}`);
    check('the committed welcome is the stored intro', played[0]?.payload.source === 'library',
      JSON.stringify(played[0]?.payload));
    check('the shelf was consulted exactly once, for the fallback',
      world.introFetches.join(',') === 'University City', world.introFetches.join(','));
    check('the live attempt was made first', welcomePromptsFor(world, 'University City').length === 1,
      `prompts=${welcomePromptsFor(world, 'University City').length}`);
    tour.endTour();
  }

  suite('W-08 opening welcome: live fails + no shelf row → owed/cooldown behavior preserved');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: [] });
    world.genStoryBehavior = () => {
      throw new Error('story quota tripped');
    };
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    check('no welcome committed when neither live nor shelf can serve',
      welcomePlayed(world, 'welcome:university city').length === 0,
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    check('the fallback still consulted the shelf before giving up',
      world.introFetches.join(',') === 'University City', world.introFetches.join(','));
    check('the opening live attempt was made', welcomePromptsFor(world, 'University City').length === 1,
      `prompts=${welcomePromptsFor(world, 'University City').length}`);
    await world.clock.advance(200_000); // cross the 180 s owed cooldown
    check('the owed welcome retried after its cooldown (owed behavior intact)',
      welcomePromptsFor(world, 'University City').length >= 2,
      `prompts=${welcomePromptsFor(world, 'University City').length}`);
    check('still no welcome while live stays down',
      welcomePlayed(world, 'welcome:university city').length === 0);
    check('the tour itself is unharmed', tour.view().phase === 'active', tour.view().phase);
    tour.endTour();
  }

  // ---------------------------------------------------------- SL story-landing fixes (Nov 1)
  // The Nov 1 field drive (Costa Verde / University City): a
  // landmark generated twice and dropped twice behind stacked
  // welcome + area serves, nested areas firing two welcome
  // routines. Five fixes, one suite each.
  const playbacksFor = (world, subject) =>
    world.eventsOf('story_playback').filter(e => e.payload.subject === subject);
  const dropsFor = (world, subject) =>
    world.eventsOf('story_dropped').filter(e => e.payload.subject === subject);
  const promptsFor = (world, fragment) =>
    world.genStoryPrompts.filter(p => p.includes(fragment));

  suite('SL-01 landmark displaces a WAITING welcome (deferral, not a drop)');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park')],
      library: ['Alpha Park'],
      intros: [],
    });
    // The Tier-1 text is long, as befits a marquee telling (and so
    // the freshness judge still honors it after the queue drains —
    // the fit check is SL-05's subject, not this suite's).
    world.genStoryBehavior = prompt =>
      prompt.includes('Tier Tower')
        ? 'A very long story about a tall tower, told slowly and in full. '.repeat(24)
        : 'A generated story about the road ahead, told with care and local color. '.repeat(3);
    const audio = new FakeAudio(world.clock, okPolicy({ library: 45_000, synth: 12_000 }));
    const { tour } = await healthyOpening(world, audio);
    const labels = watchLabels(world, tour);
    // Alpha (45 s library) is playing. Enter Clairemont: its live
    // welcome takes the WAITING slot behind Alpha.
    world.area = { neighborhood: 'Clairemont', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(3_000);
    check('the mid-tour welcome waits behind the playing story',
      tour.view().upNext === 'Welcome to Clairemont', `upNext=${tour.view().upNext}`);
    // A Tier-1 landmark appears: it must take the waiting slot.
    world.candidates = [makeCandidate('Tier Tower', { tier1: true, lat: UTC.lat + 0.004 })];
    tour.onPosition({ lat: UTC.lat + 0.0075, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(1_000);
    check('the Tier-1 landmark takes the waiting slot',
      tour.view().upNext === 'Tier Tower', `upNext=${tour.view().upNext}`);
    check('the playing story is never cut', labels.join(',') === 'Alpha Park', labels.join(','));
    check('the deferred welcome filed no story_dropped',
      dropsFor(world, 'welcome:clairemont').length === 0,
      JSON.stringify(dropsFor(world, 'welcome:clairemont').map(d => d.payload)));
    check('the deferred welcome is not heard-marked',
      !world.heard.includes('Welcome to Clairemont'), world.heard.join(' | '));
    await world.clock.advance(120_000);
    check('play order: Alpha completes, landmark next, welcome after',
      labels.slice(0, 3).join(',') === 'Alpha Park,Tier Tower,Welcome to Clairemont', labels.join(','));
    check('Alpha sounded to completion (never cut)',
      playbacksFor(world, 'alpha park').some(e => e.payload.completed === true),
      JSON.stringify(playbacksFor(world, 'alpha park').map(e => e.payload)));
    check('the welcome later serves and sounds exactly once',
      playbacksFor(world, 'welcome:clairemont').filter(e => e.payload.sounded === true).length === 1,
      JSON.stringify(playbacksFor(world, 'welcome:clairemont').map(e => e.payload)));
    check('the welcome is heard only after it sounds',
      world.heard.includes('Welcome to Clairemont'), world.heard.join(' | '));
    tour.endTour();
  }

  suite('SL-02 one orientation slot: a sounded welcome closes the area fallback');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: ['Clairemont'] });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    world.area = { neighborhood: 'Clairemont', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(90_000);
    check('the welcome sounded for the entered area',
      playbacksFor(world, 'welcome:clairemont').some(e => e.payload.sounded === true),
      JSON.stringify(playbacksFor(world, 'welcome:clairemont').map(e => e.payload)));
    check('no generic area story is ever committed for that area on this pass',
      world.eventsOf('story_played').filter(e => e.payload.subject === 'area:clairemont').length === 0,
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    tour.endTour();
  }

  suite('SL-03 one orientation slot: an area story first discharges the entry welcome');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: [] });
    let clairemontWelcomeAttempts = 0;
    world.genStoryBehavior = prompt => {
      if (prompt.includes('NEIGHBORHOOD WELCOME') && prompt.includes('Clairemont')) {
        clairemontWelcomeAttempts += 1;
        throw new Error('welcome generation down');
      }
      return 'A generated story about the road ahead, told with care and local color. '.repeat(3);
    };
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    world.area = { neighborhood: 'Clairemont', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(2_000);
    // A fresh serve cycle (the owed step stands down on its
    // cooldown) is what reaches the generic area story.
    tour.onPosition({ lat: UTC.lat + 0.007, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(30_000);
    check('the failed entry welcome was attempted once and re-owed',
      clairemontWelcomeAttempts === 1, `attempts=${clairemontWelcomeAttempts}`);
    check('the generic area story sounded in its place',
      playbacksFor(world, 'area:clairemont').some(e => e.payload.sounded === true),
      JSON.stringify(playbacksFor(world, 'area:clairemont').map(e => e.payload)));
    await world.clock.advance(200_000); // cross the 180 s welcome cooldown
    check('past the cooldown, the entry welcome is discharged — never retried',
      clairemontWelcomeAttempts === 1, `attempts=${clairemontWelcomeAttempts}`);
    check('the welcome never commits',
      world.eventsOf('story_played').filter(e => e.payload.subject === 'welcome:clairemont').length === 0);
    tour.endTour();
  }

  suite('SL-04 nested areas: parent welcome deferred, matures on parent-only dwell');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [],
      intros: ['Costa Verde', 'University City'],
    });
    // The parent's generic area lane is down for this drive, so
    // the deferred WELCOME is the orientation voice under test
    // (the area-first composition is the next block).
    world.genStoryBehavior = prompt => {
      if (prompt.includes('University City') && !prompt.includes('NEIGHBORHOOD WELCOME')) {
        throw new Error('area lane down for University City');
      }
      return 'A generated story about the road ahead, told with care and local color. '.repeat(3);
    };
    world.area = { neighborhood: 'La Jolla', city: 'San Diego' };
    const audio = new FakeAudio(world.clock, okPolicy({ library: 20_000 }));
    const tour = world.makeTour(audio);
    tour.onPosition({ lat: 32.85, lng: -117.25, speedMps: 8, headingDeg: 180 });
    tour.start(false);
    await world.clock.advance(40_000); // opening welcome (La Jolla, live) done
    // Enter the child (Costa Verde) at the fixture anchor: its
    // shelf welcome sounds and becomes the nesting anchor.
    world.area = { neighborhood: 'Costa Verde', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(40_000);
    check('the child welcome sounded',
      playbacksFor(world, 'welcome:costa verde').some(e => e.payload.sounded === true),
      JSON.stringify(playbacksFor(world, 'welcome:costa verde').map(e => e.payload)));
    // Enter the parent ~890 m from the child anchor: nested —
    // the parent welcome must NOT fire.
    world.area = { neighborhood: 'University City', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.008, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(30_000);
    check('the parent shelf was never consulted inside the child footprint',
      !world.introFetches.includes('University City'), world.introFetches.join(','));
    check('no parent welcome committed during the deferral',
      welcomePlayed(world, 'welcome:university city').length === 0,
      JSON.stringify(welcomePlayed(world, 'welcome:university city').map(e => e.payload)));
    // Move beyond the child radius (~1.34 km from the anchor),
    // still in the parent, and dwell past 75 s from entry.
    tour.onPosition({ lat: UTC.lat + 0.012, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(60_000);
    await world.clock.advance(45_000);
    check('after parent-only dwell, the parent welcome serves from the shelf',
      world.introFetches.includes('University City'), world.introFetches.join(','));
    check('the parent welcome sounds exactly once',
      playbacksFor(world, 'welcome:university city').filter(e => e.payload.sounded === true).length === 1,
      JSON.stringify(playbacksFor(world, 'welcome:university city').map(e => e.payload)));
    tour.endTour();
  }
  {
    // Composition with fix 2: if the parent's generic area story
    // DOES sound during the deferral window, it spends the
    // orientation slot and the deferred welcome is discharged —
    // one orientation voice for the entry, never two. (Nov 2:
    // University City carries NO intro in this block — since the
    // Clairemont/Bay Ho fix, an area WITH a shelf intro never
    // generates the generic area story at all, so this
    // composition now lives in the no-intro population, which is
    // where area stories still exist.)
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [],
      intros: ['Costa Verde'],
    });
    world.area = { neighborhood: 'La Jolla', city: 'San Diego' };
    const audio = new FakeAudio(world.clock, okPolicy({ library: 20_000 }));
    const tour = world.makeTour(audio);
    tour.onPosition({ lat: 32.85, lng: -117.25, speedMps: 8, headingDeg: 180 });
    tour.start(false);
    await world.clock.advance(40_000);
    world.area = { neighborhood: 'Costa Verde', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(40_000);
    world.area = { neighborhood: 'University City', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.008, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(30_000);
    check('the generic area story sounded during the deferral window',
      playbacksFor(world, 'area:university city').some(e => e.payload.sounded === true),
      JSON.stringify(playbacksFor(world, 'area:university city').map(e => e.payload)));
    tour.onPosition({ lat: UTC.lat + 0.012, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(120_000); // dwell matures — but the slot is spent
    check('the deferred welcome never fires after the area story sounded',
      welcomePlayed(world, 'welcome:university city').length === 0,
      JSON.stringify(welcomePlayed(world, 'welcome:university city').map(e => e.payload)));
    check('the parent shelf was never consulted',
      !world.introFetches.includes('University City'), world.introFetches.join(','));
    tour.endTour();
  }

  suite('SL-05 fit check: no generation spent on a story that cannot land');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park')],
      library: ['Alpha Park'],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 100_000, synth: 12_000 }));
    const { tour } = await healthyOpening(world, audio);
    // Alpha (100 s library) is playing with most of its run left.
    // Heading south: the Ruin is 3 km astern (already unlandable
    // at the projected start), the Plaza ~530 m ahead (landable).
    world.candidates = [
      makeCandidate('Alpha Park'),
      makeCandidate('Doomed Ruin', { lat: UTC.lat + 0.027 }),
      makeCandidate('Good Plaza', { lat: UTC.lat - 0.0048 }),
    ];
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(30_000);
    check('zero generation calls spent on the unlandable candidate',
      promptsFor(world, 'Doomed Ruin').length === 0,
      `prompts=${promptsFor(world, 'Doomed Ruin').length}`);
    check('the landable candidate is generated instead',
      promptsFor(world, 'Good Plaza').length >= 1,
      `prompts=${promptsFor(world, 'Good Plaza').length}`);
    check('the landable candidate commits',
      world.eventsOf('story_played').some(e => e.payload.subject === 'good plaza'),
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    tour.endTour();
  }

  suite('SL-06 salvage: a judge-dropped live story serves later from its banked text');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park')],
      library: ['Alpha Park'],
      // A long text (~100 s+ estimated): the distance judge, not
      // the age gate, is the one that drops it (S-09's shape).
      genStoryBehavior: () => 'A very long story about a fine old house, told slowly and in full. '.repeat(24),
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 30_000, synth: 12_000 }));
    const { tour } = await healthyOpening(world, audio);
    const labels = watchLabels(world, tour);
    // Alpha (30 s) is playing. The Munk House story generates and
    // slots behind it.
    world.candidates = [makeCandidate('Munk House', { lat: UTC.lat, lng: UTC.lng })];
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(2_000);
    check('the live story was generated once',
      promptsFor(world, 'Munk House').length === 1, `prompts=${promptsFor(world, 'Munk House').length}`);
    // Teleport 3 km north, heading away: at dequeue the judge
    // drops the story stale-behind, unheard.
    tour.onPosition({ lat: UTC.lat + 0.033, lng: UTC.lng, speedMps: 8, headingDeg: 0 });
    await world.clock.advance(45_000);
    check('the story was judge-dropped stale-behind',
      dropsFor(world, 'munk house').some(d => d.payload.reason === 'stale-behind'),
      JSON.stringify(dropsFor(world, 'munk house').map(d => d.payload)));
    check('the dropped story never sounded', !labels.includes('Munk House'), labels.join(','));
    check('the dropped subject is not in the heard set',
      !world.heard.includes('Munk House'), world.heard.join(' | '));
    // Re-approach the anchor: the banked text serves — no second
    // generation spend.
    tour.onPosition({ lat: UTC.lat + 0.001, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(30_000);
    check('no second generation on re-approach',
      promptsFor(world, 'Munk House').length === 1, `prompts=${promptsFor(world, 'Munk House').length}`);
    check('the salvaged story sounds on re-approach',
      playbacksFor(world, 'munk house').some(e => e.payload.sounded === true),
      JSON.stringify(playbacksFor(world, 'munk house').map(e => e.payload)));
    check('the subject joins the heard set only once it sounds',
      world.heard.includes('Munk House'), world.heard.join(' | '));
    tour.endTour();
  }

  // ---------------------------------------------------------- WV two-variant welcomes (Nov 1)
  // First entry serves the GREETING intro; re-entries serve the
  // PLAIN intro. The plain rows are untouched; the greeting rows
  // are siblings at angle 'neighborhood_intro_greet'.
  suite('WV-01 first entry: the greeting variant serves, zero live generation');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [],
      intros: ['Clairemont'],
      greetIntros: ['Clairemont'],
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    world.area = { neighborhood: 'Clairemont', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(60_000);
    const played = welcomePlayed(world, 'welcome:clairemont');
    check('welcome committed exactly once', played.length === 1, `n=${played.length}`);
    check('the served variant is the greeting row (telemetry angle)',
      played[0]?.payload.angle === 'neighborhood_intro_greet', JSON.stringify(played[0]?.payload));
    check('the greeting audio is what played',
      audio.log.some(e => typeof e.src === 'string' && e.src.endsWith('library/clairemont/neighborhood_intro-greet-v1.wav')),
      JSON.stringify(audio.log.map(e => e.src)));
    check('zero live generation for the first-entry welcome',
      welcomePromptsFor(world, 'Clairemont').length === 0,
      `prompts=${welcomePromptsFor(world, 'Clairemont').length}`);
    check('the greeting welcome sounded to completion',
      playbacksFor(world, 'welcome:clairemont').some(e => e.payload.sounded === true));
    tour.endTour();
  }

  suite('WV-02 re-entry: a cross-day-heard area with both variants serves PLAIN');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [],
      intros: ['Clairemont'],
      greetIntros: ['Clairemont'],
    });
    world.seams.fetchHeardTopics = async () => ['Clairemont'];
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    world.area = { neighborhood: 'Clairemont', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(60_000);
    const played = welcomePlayed(world, 'welcome:clairemont');
    check('welcome committed exactly once', played.length === 1, `n=${played.length}`);
    check('the served variant is the plain row (telemetry angle)',
      played[0]?.payload.angle === 'neighborhood_intro', JSON.stringify(played[0]?.payload));
    check('the plain audio is what played',
      audio.log.some(e => typeof e.src === 'string' && e.src.endsWith('library/clairemont/neighborhood_intro.wav')),
      JSON.stringify(audio.log.map(e => e.src)));
    check('the greeting audio never played for the heard area',
      !audio.log.some(e => typeof e.src === 'string' && e.src.endsWith('neighborhood_intro-greet-v1.wav')),
      JSON.stringify(audio.log.map(e => e.src)));
    check('zero live generation — no alternate is minted when the plain row serves',
      welcomePromptsFor(world, 'Clairemont').length === 0,
      `prompts=${welcomePromptsFor(world, 'Clairemont').length}`);
    tour.endTour();
  }

  suite('WV-03 heard area WITHOUT a greeting variant: live alternate preserved');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: ['Clairemont'] });
    world.seams.fetchHeardTopics = async () => ['Clairemont'];
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    world.area = { neighborhood: 'Clairemont', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(60_000);
    const played = welcomePlayed(world, 'welcome:clairemont');
    check('the alternate welcome committed exactly once, sourced live',
      played.length === 1 && played[0]?.payload.source === 'live',
      JSON.stringify(played.map(e => e.payload)));
    check('a live welcome was generated for the heard area',
      welcomePromptsFor(world, 'Clairemont').length === 1,
      `prompts=${welcomePromptsFor(world, 'Clairemont').length}`);
    tour.endTour();
  }

  suite('WV-04 guard: an intro row never serves as a landmark story');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      // A place candidate whose key equals the area's key: the
      // library index carries the intro rows under that key, and
      // the generic candidate path must refuse them.
      candidates: [makeCandidate('Clairemont')],
      library: [],
      intros: ['Clairemont'],
      greetIntros: ['Clairemont'],
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(60_000);
    const landmarkCommits = world
      .eventsOf('story_played')
      .filter(e => e.payload.subject === 'clairemont');
    check('no library-sourced landmark serve of the intro row',
      landmarkCommits.every(e => e.payload.source !== 'library'),
      JSON.stringify(landmarkCommits.map(e => e.payload)));
    check('no intro angle ever files under the place subject',
      landmarkCommits.every(
        e => e.payload.angle !== 'neighborhood_intro' && e.payload.angle !== 'neighborhood_intro_greet',
      ),
      JSON.stringify(landmarkCommits.map(e => e.payload)));
    check('no intro audio ever played as a place story',
      !audio.log.some(e => typeof e.src === 'string' && e.src.endsWith('neighborhood_intro-greet-v1.wav')),
      JSON.stringify(audio.log.map(e => e.src)));
    tour.endTour();
  }

  suite('WV-05 two days: a greet serve files the area heard; day two serves plain');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [],
      intros: ['Clairemont'],
      greetIntros: ['Clairemont'],
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    world.area = { neighborhood: 'Clairemont', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(60_000);
    check('day one served the greeting variant',
      welcomePlayed(world, 'welcome:clairemont').some(
        e => e.payload.angle === 'neighborhood_intro_greet',
      ),
      JSON.stringify(welcomePlayed(world, 'welcome:clairemont').map(e => e.payload)));
    check('the greet telling is filed in the heard ledger under its welcome label',
      world.heard.includes('Welcome to Clairemont'), world.heard.join(' | '));
    tour.endTour();
    // Day two: a fresh tour; the cross-day ledger is yesterday's
    // recordHeard output, verbatim.
    resetLocalStorage();
    world.seams.fetchHeardTopics = async () => [...world.heard];
    world.area = { neighborhood: 'University City', city: 'San Diego' };
    const audio2 = new FakeAudio(world.clock, okPolicy());
    const tour2 = world.makeTour(audio2);
    tour2.onPosition({ ...UTC, speedMps: 8, headingDeg: 180 });
    tour2.start(false);
    await world.clock.advance(40_000);
    const promptsBefore = world.genStoryPrompts.length;
    const commitsBefore = welcomePlayed(world, 'welcome:clairemont').length;
    world.area = { neighborhood: 'Clairemont', city: 'San Diego' };
    tour2.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(60_000);
    const dayTwo = welcomePlayed(world, 'welcome:clairemont').slice(commitsBefore);
    check('day two commits the welcome exactly once', dayTwo.length === 1,
      JSON.stringify(dayTwo.map(e => e.payload)));
    check('day two serves the PLAIN variant',
      dayTwo[0]?.payload.angle === 'neighborhood_intro', JSON.stringify(dayTwo[0]?.payload));
    check('day two spends zero live generation on the welcome',
      world.genStoryPrompts.slice(promptsBefore).filter(p => p.includes('NEIGHBORHOOD WELCOME') && p.includes('Clairemont')).length === 0,
      `prompts=${world.genStoryPrompts.length - promptsBefore}`);
    tour2.endTour();
  }

  suite('WV-06 opening fallback: unheard start area serves the greeting variant');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [],
      intros: ['University City'],
      greetIntros: ['University City'],
    });
    // Live generation is down: the opening welcome must fall back
    // to the shelf — and the shelf's first-entry voice is the
    // greeting variant.
    world.genStoryBehavior = prompt => {
      if (prompt.includes('NEIGHBORHOOD WELCOME')) throw new Error('welcome generation down');
      return 'A generated story about the road ahead, told with care and local color. '.repeat(3);
    };
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    const played = welcomePlayed(world, 'welcome:university city');
    check('the opening welcome committed from the shelf',
      played.length === 1 && played[0]?.payload.source === 'library',
      JSON.stringify(played.map(e => e.payload)));
    check('the fallback variant is the greeting row',
      played[0]?.payload.angle === 'neighborhood_intro_greet', JSON.stringify(played[0]?.payload));
    check('the opening welcome sounded',
      playbacksFor(world, 'welcome:university city').some(e => e.payload.sounded === true));
    tour.endTour();
  }

  suite('WV-07 opening fallback: heard start area with variants serves PLAIN');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [],
      intros: ['University City'],
      greetIntros: ['University City'],
    });
    world.seams.fetchHeardTopics = async () => ['University City'];
    world.genStoryBehavior = prompt => {
      if (prompt.includes('NEIGHBORHOOD WELCOME')) throw new Error('welcome generation down');
      return 'A generated story about the road ahead, told with care and local color. '.repeat(3);
    };
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    const played = welcomePlayed(world, 'welcome:university city');
    check('the opening welcome committed from the shelf',
      played.length === 1 && played[0]?.payload.source === 'library',
      JSON.stringify(played.map(e => e.payload)));
    check('the fallback variant is the plain row for a heard intro',
      played[0]?.payload.angle === 'neighborhood_intro', JSON.stringify(played[0]?.payload));
    check('the opening welcome sounded (no owed/cooldown detour)',
      playbacksFor(world, 'welcome:university city').some(e => e.payload.sounded === true));
    await world.clock.advance(200_000); // past the welcome cooldown
    check('no owed retry ever minted a second live attempt',
      welcomePromptsFor(world, 'University City').length === 1,
      `prompts=${welcomePromptsFor(world, 'University City').length}`);
    tour.endTour();
  }

  // ---------------------------------------------------------- Q&A discharge + playback-failure rest (Nov 1 follow-on)
  // The Nov 1 evening drives: a Liberty Station question answered,
  // then the owed Liberty Station welcome firing one second
  // behind the answer (same subject twice); and Alice Clark
  // House served three times in ~2.5 minutes on failing audio.

  suite('QA-1 a question naming the area discharges its owed welcome');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park')],
      library: ['Alpha Park'],
      intros: ['Liberty Station'],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 45_000, synth: 12_000 }));
    const { tour } = await healthyOpening(world, audio);
    const labels = watchLabels(world, tour);
    // Alpha (45 s library) is playing. Enter Liberty Station: its
    // shelf welcome takes the WAITING slot behind Alpha.
    world.area = { neighborhood: 'Liberty Station', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(3_000);
    check('the owed welcome waits behind the playing story',
      tour.view().upNext === 'Welcome to Liberty Station', `upNext=${tour.view().upNext}`);
    // The listener asks about the very place whose welcome waits.
    check('the question is accepted', tour.submitQuestion('What is Liberty Station?') === true);
    check('the waiting welcome is withdrawn at submission',
      tour.view().upNext !== 'Welcome to Liberty Station', `upNext=${tour.view().upNext}`);
    await world.clock.advance(180_000);
    check('the answer sounded', world.eventsOf('question_playback').some(e => e.payload.completed === true && e.payload.voice === 'gemini'),
      JSON.stringify(world.eventsOf('question_playback').map(e => e.payload)));
    check('the discharged welcome never sounds',
      !labels.includes('Welcome to Liberty Station'), labels.join(','));
    check('the discharged welcome never reaches the element',
      !audio.log.some(e => typeof e.src === 'string' && e.src.includes('liberty-station/neighborhood_intro.wav')),
      JSON.stringify(audio.log.map(e => e.src)));
    check('the withdrawal filed no story_dropped for the welcome',
      dropsFor(world, 'welcome:liberty station').length === 0,
      JSON.stringify(dropsFor(world, 'welcome:liberty station').map(d => d.payload)));
    check('no generic area story stacks behind the answer either',
      world.eventsOf('story_played').filter(e => e.payload.subject === 'area:liberty station').length === 0,
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    check('the welcome is not in the heard ledger (it was never told)',
      !world.heard.includes('Welcome to Liberty Station'), world.heard.join(' | '));
    tour.endTour();
  }

  suite('QA-2 a question naming an unrelated place leaves the owed welcome standing');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park')],
      library: ['Alpha Park'],
      intros: ['Liberty Station'],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 45_000, synth: 12_000 }));
    const { tour } = await healthyOpening(world, audio);
    const labels = watchLabels(world, tour);
    world.area = { neighborhood: 'Liberty Station', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(3_000);
    check('the owed welcome waits behind the playing story',
      tour.view().upNext === 'Welcome to Liberty Station', `upNext=${tour.view().upNext}`);
    check('the question is accepted', tour.submitQuestion('What is Balboa Park known for?') === true);
    check('the welcome still waits after an unrelated question',
      tour.view().upNext === 'Welcome to Liberty Station', `upNext=${tour.view().upNext}`);
    await world.clock.advance(240_000);
    check('the answer sounded', world.eventsOf('question_playback').some(e => e.payload.completed === true && e.payload.voice === 'gemini'));
    check('the welcome serves and sounds normally afterward',
      labels.includes('Welcome to Liberty Station'), labels.join(','));
    check('the welcome completes and is heard-filed as usual',
      playbacksFor(world, 'welcome:liberty station').some(e => e.payload.sounded === true) &&
        world.heard.includes('Welcome to Liberty Station'),
      world.heard.join(' | '));
    tour.endTour();
  }

  suite('QA-3 a question naming the area does not cut its PLAYING welcome');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [],
      intros: ['Liberty Station'],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 30_000, synth: 12_000 }));
    const { tour } = await healthyOpening(world, audio);
    world.area = { neighborhood: 'Liberty Station', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(5_000);
    check('the welcome is playing when the question lands',
      tour.view().nowPlaying?.label === 'Welcome to Liberty Station',
      `nowPlaying=${tour.view().nowPlaying?.label}`);
    check('the question is accepted', tour.submitQuestion('Tell me about Liberty Station') === true);
    check('the playing welcome is not cut by the submission',
      tour.view().nowPlaying?.label === 'Welcome to Liberty Station',
      `nowPlaying=${tour.view().nowPlaying?.label}`);
    await world.clock.advance(180_000);
    check('the playing welcome completed',
      playbacksFor(world, 'welcome:liberty station').some(e => e.payload.completed === true),
      JSON.stringify(playbacksFor(world, 'welcome:liberty station').map(e => e.payload)));
    check('the welcome committed exactly once (no second orientation serve)',
      world.eventsOf('story_played').filter(e => e.payload.subject === 'welcome:liberty station').length === 1,
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    check('no generic area story follows it on this pass',
      world.eventsOf('story_played').filter(e => e.payload.subject === 'area:liberty station').length === 0);
    check('the answer sounded behind the welcome',
      world.eventsOf('question_playback').some(e => e.payload.completed === true && e.payload.voice === 'gemini'));
    tour.endTour();
  }

  suite('AF-1 an attempts-exhausted drop rests the subject until the driver moves on');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Fragile House'), makeCandidate('Steady Park')],
      library: ['Fragile House', 'Steady Park'],
    });
    let failFragile = true;
    const audio = new FakeAudio(world.clock, ({ cls, src }) =>
      failFragile && cls === 'library' && typeof src === 'string' && src.includes('fragile-house')
        ? { action: 'reject', name: 'NotSupportedError' }
        : { action: 'ok', durationMs: DUR[cls] ?? 5000 });
    const { tour } = await healthyOpening(world, audio);
    await world.clock.advance(30_000);
    check('the failing story dropped attempts-exhausted',
      dropsFor(world, 'fragile house').some(d => d.payload.reason === 'attempts-exhausted'),
      JSON.stringify(dropsFor(world, 'fragile house').map(d => d.payload)));
    check('the rested subject was committed exactly once at this spot',
      world.eventsOf('story_played').filter(e => e.payload.subject === 'fragile house').length === 1,
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    check('the other candidate served in its place',
      playbacksFor(world, 'steady park').some(e => e.payload.sounded === true),
      JSON.stringify(playbacksFor(world, 'steady park').map(e => e.payload)));
    check('the failed subject is not heard-filed',
      !world.heard.includes('Fragile House'), world.heard.join(' | '));
    // A nudge that triggers serve cycles but stays inside the
    // 250 m rest radius: the subject must remain rested.
    tour.onPosition({ lat: UTC.lat + 0.002, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(30_000);
    check('still rested after in-radius serve cycles',
      world.eventsOf('story_played').filter(e => e.payload.subject === 'fragile house').length === 1,
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    // Beyond the radius, with the failure gone, the subject is
    // eligible again and lands.
    failFragile = false;
    tour.onPosition({ lat: UTC.lat + 0.005, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(60_000);
    check('past the radius the subject serves again',
      world.eventsOf('story_played').filter(e => e.payload.subject === 'fragile house').length === 2,
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    check('the recovered serve sounds to completion',
      playbacksFor(world, 'fragile house').some(e => e.payload.sounded === true),
      JSON.stringify(playbacksFor(world, 'fragile house').map(e => e.payload)));
    check('the subject is heard-filed only after it sounds',
      world.heard.includes('Fragile House'), world.heard.join(' | '));
    tour.endTour();
  }

  // ---------------------------------------------------------- HF hosted filler tier (Nov 2, 2026)
  suite('HF-1 hosted preferred when pinned and ready; legacy pair is the fallback after');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [],
      fillers: ['San Diego Weather Patterns'],
      hostedFillers: ['The Table Stories', 'Water Stories'],
      genStoryBehavior: () => {
        throw new Error('quota');
      },
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour, runs } = await healthyOpening(world, audio, BALBOA);
    await world.clock.advance(30_000);
    const fp = world.eventsOf('filler_played');
    check('a filler fires in silence with hosted rows present', fp.length >= 1, JSON.stringify(fp.map(f => f.payload)));
    if (fp.length >= 1) {
      check('the first fire is a HOSTED segment (matched=hosted)', fp[0].payload.matched === 'hosted', JSON.stringify(fp[0].payload));
      check('the hosted title is one of the hosted pool', ['The Table Stories', 'Water Stories'].includes(fp[0].payload.title), fp[0].payload.title);
      check('hosted files region=null (location-agnostic)', fp[0].payload.region === null, `region=${fp[0].payload.region}`);
    }
    const seq = kindSeq(runs);
    const firstFiller = seq.indexOf('filler');
    check('no bridge precedes the hosted segment (it carries its own lead-in)',
      firstFiller >= 0 && !seq.slice(0, firstFiller).includes('bridge'), seq.join(','));
    await world.clock.advance(150_000);
    const fpAll = world.eventsOf('filler_played');
    check('both hosted segments serve before any legacy filler', fpAll.length >= 3 && fpAll[0].payload.matched === 'hosted' && fpAll[1].payload.matched === 'hosted', JSON.stringify(fpAll.map(f => f.payload)));
    if (fpAll.length >= 3) {
      check('once the hosted pool is spent, the legacy pair takes over', fpAll[2].payload.title === 'San Diego Weather Patterns' && fpAll[2].payload.matched !== 'hosted', JSON.stringify(fpAll[2].payload));
    }
    tour.endTour();
  }

  suite('HF-2 legacy fallback when no hosted segment is ready (pins failed)');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [],
      fillers: ['San Diego Weather Patterns', 'The Kumeyaay Homeland'],
      hostedFillers: ['The Table Stories'],
      hostedPinFails: true,
      genStoryBehavior: () => {
        throw new Error('quota');
      },
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour, runs } = await healthyOpening(world, audio, BALBOA);
    await world.clock.advance(30_000);
    const fp = world.eventsOf('filler_played');
    check('a filler still fires when hosted pins fail', fp.length >= 1, JSON.stringify(fp.map(f => f.payload)));
    if (fp.length >= 1) {
      check('the fire is the legacy pair, not hosted', fp[0].payload.matched !== 'hosted' && ['San Diego Weather Patterns', 'The Kumeyaay Homeland'].includes(fp[0].payload.title), JSON.stringify(fp[0].payload));
    }
    const seq = kindSeq(runs);
    check('the legacy pair keeps its bridge', seq.indexOf('bridge') >= 0 && seq.indexOf('filler') === seq.indexOf('bridge') + 1, seq.join(','));
    check('no hosted audio reached the device', ![...world.cache.keys()].some(k => k.includes('fillers/hosted/')), [...world.cache.keys()].join(','));
    tour.endTour();
  }

  suite('HF-3 hosted never cuts a playing story');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
      fillers: [],
      hostedFillers: ['The Table Stories'],
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    await world.clock.advance(120_000);
    const pb = playbackFor(world, 'balboa park');
    check('the library story sounded to completion (never cut by the hosted lane)',
      pb !== undefined && pb.payload.sounded === true && pb.payload.completed === true, JSON.stringify(pb?.payload));
    const playedIdx = world.eventsOf('story_played').map(e => e.payload.subject).indexOf('balboa park');
    const pbEvent = world.eventsOf('story_playback')[playedIdx];
    const fp = world.eventsOf('filler_played');
    check('the hosted lane did fire later, into genuine silence', fp.length >= 1 && fp[0].payload.matched === 'hosted', JSON.stringify(fp.map(f => f.payload)));
    if (fp.length >= 1 && pbEvent) {
      check('the first hosted fire starts only after the story settled', fp[0].at >= pbEvent.at, `filler_at=${fp[0].at} story_settled_at=${pbEvent.at}`);
    }
    tour.endTour();
  }

  suite('HF-4 silence trigger timing unchanged with the hosted tier armed (10 s)');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [],
      fillers: [],
      hostedFillers: ['The Table Stories', 'Water Stories'],
      genStoryBehavior: () => {
        throw new Error('quota');
      },
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, BALBOA);
    // Measure the F9 re-arm window: from the last poll where the
    // first hosted segment was still sounding to the first poll
    // where the second one starts. That window is pure true
    // silence, so it isolates the 10 s trigger from opening
    // transaction timing.
    let firstLabel = null;
    let secondStartAt = null;
    let lastBusyAt = null;
    world.clock.setInterval(() => {
      const np = tour.view().nowPlaying;
      if (np === null) return;
      if (np.kind === 'filler') {
        if (firstLabel === null) {
          firstLabel = np.label;
        } else if (np.label !== firstLabel && secondStartAt === null) {
          secondStartAt = world.clock.now();
          return;
        }
      }
      if (secondStartAt === null) lastBusyAt = world.clock.now();
    }, 200);
    for (let i = 0; i < 300 && secondStartAt === null; i++) {
      await world.clock.advance(1_000);
    }
    check('a second hosted segment fires after the first (re-arm path exercised)', secondStartAt !== null, `secondStartAt=${secondStartAt}`);
    if (secondStartAt !== null && lastBusyAt !== null) {
      const gapMs = secondStartAt - lastBusyAt;
      check('the fire waits ~10 s of true silence (not sooner, not doubled)', gapMs >= 9_500 && gapMs <= 13_500, `gap=${gapMs}ms`);
    }
    tour.endTour();
  }

  suite('HF-5 hosted spent discipline, working-set pin cap, background top-up');
  {
    // No immediate repeat, then stand-down when the hosted pool is spent.
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [],
      fillers: [],
      hostedFillers: ['The Table Stories', 'Water Stories', 'Lost San Diego Stories'],
      genStoryBehavior: () => {
        throw new Error('quota');
      },
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio, BALBOA);
    await world.clock.advance(180_000);
    const fp = world.eventsOf('filler_played');
    check('all three hosted segments serve', fp.length === 3, JSON.stringify(fp.map(f => f.payload.title)));
    check('no hosted subject repeats', new Set(fp.map(f => f.payload.title)).size === fp.length, JSON.stringify(fp.map(f => f.payload.title)));
    await world.clock.advance(60_000);
    check('hosted pool spent → lane stands down', world.eventsOf('filler_played').length === 3, `count=${world.eventsOf('filler_played').length}`);
    tour.endTour();
  }
  {
    // Pin cap: 20 hosted rows, only the ~14-segment working set is
    // pinned at start; spending below the ready floor tops up.
    resetLocalStorage();
    const titles = Array.from({ length: 20 }, (_, i) => `Hosted Segment ${i + 1}`);
    const world = makeWorld(Tour, {
      candidates: [],
      fillers: [],
      hostedFillers: titles,
      genStoryBehavior: () => {
        throw new Error('quota');
      },
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio, BALBOA);
    const hostedCached = () => [...world.cache.keys()].filter(k => k.includes('fillers/hosted/')).length;
    check('working set pinned at tour start is the capped slice (14 of 20)', hostedCached() === 14, `cached=${hostedCached()}`);
    await world.clock.advance(300_000);
    const fp = world.eventsOf('filler_played');
    check('hosted segments keep serving from the working set', fp.length >= 9, `count=${fp.length}`);
    check('background top-up pinned beyond the initial working set', hostedCached() === 20, `cached=${hostedCached()}`);
    tour.endTour();
  }

  // ---------------------------------------------------------- AG-01 tester access gate
  // The gate is a UI-layer concern (App renders the shell only after
  // it passes — the harness has no React/bootstrap seam), but its
  // decision module is pure and lives in src/core, so its semantics
  // are exercised here against the harness's fake localStorage:
  // locked by default, wrong/case-mangled/empty codes rejected and
  // persisting nothing, the shared code unlocking + persisting.
  suite('AG-01 tester access gate: locked by default, code unlocks + persists');
  {
    const { isTesterUnlocked, tryTesterUnlock, TESTER_ACCESS_CODE } = accessGate;
    resetLocalStorage();
    check('locked on a fresh device', isTesterUnlocked() === false);
    check('wrong code rejected', tryTesterUnlock('wrong-code') === false);
    check('wrong code persists nothing (still locked)', isTesterUnlocked() === false);
    check('code is case-sensitive (Coast619 rejected)', tryTesterUnlock('Coast619') === false);
    check('empty code rejected', tryTesterUnlock('') === false);
    check('shared code is the spec value', TESTER_ACCESS_CODE === 'coast619', TESTER_ACCESS_CODE);
    check('correct code unlocks (paste whitespace tolerated)', tryTesterUnlock(' coast619 ') === true);
    check('unlock persists on the device', isTesterUnlocked() === true);
    resetLocalStorage();
    check('cleared storage locks again', isTesterUnlocked() === false);
  }

  // ---------------------------------------------------------- A: Clairemont / Bay Ho fixes (Nov 2)
  // Field evidence (published build, Nov 2 afternoon): in
  // Clairemont — whose shelf is intro + greeting variant ONLY —
  // the library welcome completed and a LIVE generic area story
  // ('The story of Clairemont') completed two minutes later: the
  // same overview twice, the area story having been generated
  // 146 s before the welcome served. And in Bay Ho — ZERO shelf
  // rows — the live welcome's ~85 s pipeline at 21.6 m/s sounded
  // 1,616 m past its subject. Three fixes: (1) no generic live
  // area story for an area that HAS a shelf intro; (2) a queued
  // live area story whose area's orientation slot a welcome has
  // since spent is discharged at dequeue, its text salvaged;
  // (3) live welcomes are fit-gated (pre-generation projection +
  // play-time reach), shelf welcomes exempt.

  suite('A1 shelf-intro area: zero live area-story generation (unheard + cross-day heard)');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: ['Clairemont'] });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    world.area = { neighborhood: 'Clairemont', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(90_000);
    check('the shelf welcome sounded for the entered area',
      playbacksFor(world, 'welcome:clairemont').some(e => e.payload.sounded === true),
      JSON.stringify(playbacksFor(world, 'welcome:clairemont').map(e => e.payload)));
    check('zero live area-story generation calls for the intro area',
      promptsFor(world, 'AREA STORY').length === 0,
      `prompts=${promptsFor(world, 'AREA STORY').length}`);
    check('no area story ever committed for the area',
      world.eventsOf('story_played').filter(e => e.payload.subject === 'area:clairemont').length === 0);
    tour.endTour();
  }
  {
    // Heard state is not a back door: a cross-day-heard intro
    // area (greeting variant on the shelf, so the re-entry
    // welcome is the plain row) still gets NO generic area
    // story — and spends no generation on the area at all.
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [],
      intros: ['Clairemont'],
      greetIntros: ['Clairemont'],
    });
    world.seams.fetchHeardTopics = async () => ['Clairemont'];
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    world.area = { neighborhood: 'Clairemont', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(90_000);
    check('the re-entry (plain) welcome sounded for the heard area',
      playbacksFor(world, 'welcome:clairemont').some(e => e.payload.sounded === true),
      JSON.stringify(playbacksFor(world, 'welcome:clairemont').map(e => e.payload)));
    check('zero live area-story generation calls for the heard intro area',
      promptsFor(world, 'AREA STORY').length === 0,
      `prompts=${promptsFor(world, 'AREA STORY').length}`);
    check('zero welcome generation calls either (the plain row served)',
      welcomePromptsFor(world, 'Clairemont').length === 0,
      `prompts=${welcomePromptsFor(world, 'Clairemont').length}`);
    tour.endTour();
  }

  suite('A2 orientation race: queued area story discharged at dequeue, text salvaged + re-served from the bank');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: [] });
    const AREA_TEXT = 'AREA-TEXT the whole story of the Clairemont mesa, its grids and its canyons. '.repeat(2);
    world.genStoryBehavior = prompt => {
      if (prompt.includes('NEIGHBORHOOD WELCOME') && prompt.includes('Clairemont')) {
        // The welcome's generation is SLOW (6 s): the window in
        // which the race opens. The text is a full paragraph
        // (~54 s of speech, as a real generated welcome runs):
        // at 8 m/s its reach still covers the ground the ship
        // covers while it is being made, so it lands and sounds.
        return new Promise(res =>
          world.clock.setTimeout(
            () => res('A generated welcome to Clairemont, told warmly at the curb. '.repeat(12)),
            6_000,
          ),
        );
      }
      if (prompt.includes('AREA STORY')) {
        // The area story's generation is SLOWER (22 s): it
        // completes into a world where the welcome has sounded.
        return new Promise(res => world.clock.setTimeout(() => res(AREA_TEXT), 22_000));
      }
      return 'A generated story about the road ahead, told with care and local color. '.repeat(3);
    };
    const audio = new FakeAudio(world.clock, okPolicy());
    // Enter Clairemont the moment the opening welcome has
    // sounded: the player is idle but the silence lane has not
    // yet fired a filler into the window the race needs.
    const tour = await startAt(world, audio, UTC);
    for (
      let i = 0;
      i < 40 &&
      !world.eventsOf('story_playback').some(
        e => e.payload.subject === 'welcome:university city' && e.payload.sounded,
      );
      i++
    ) {
      await world.clock.advance(1_000);
    }
    world.area = { neighborhood: 'Clairemont', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    // Let the area update land and the welcome's generation
    // begin (it completes at +6 s), then a >200 m movement step
    // (the serve cycle's trigger threshold) inside that window
    // reaches the area fallback: the generic area story starts
    // generating while the welcome is still being made — the
    // field race's exact shape.
    await world.clock.advance(1_000);
    tour.onPosition({ lat: UTC.lat + 0.007, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(60_000);
    check('the welcome sounded (it won the orientation slot)',
      playbacksFor(world, 'welcome:clairemont').some(e => e.payload.sounded === true),
      JSON.stringify(playbacksFor(world, 'welcome:clairemont').map(e => e.payload)));
    check('the area story was generated exactly once (no regeneration loop)',
      world.genStoryPrompts.filter(p => p.includes('AREA STORY') && p.includes('Clairemont')).length === 1,
      `prompts=${world.genStoryPrompts.filter(p => p.includes('AREA STORY') && p.includes('Clairemont')).length}`);
    check('the area story never sounded on the welcome’s pass',
      !playbacksFor(world, 'area:clairemont').some(e => e.payload.sounded === true),
      JSON.stringify(playbacksFor(world, 'area:clairemont').map(e => e.payload)));
    check('the area story filed story_dropped as orientation-spent',
      dropsFor(world, 'area:clairemont').length === 1 &&
        dropsFor(world, 'area:clairemont')[0]?.payload.reason === 'orientation-spent',
      JSON.stringify(dropsFor(world, 'area:clairemont').map(e => e.payload)));
    check('the area subject stayed unheard',
      !world.heard.includes('The story of Clairemont'), world.heard.join(' | '));
    check('the generated text was salvaged into the private buffer',
      tour['buffer'].get('area:clairemont')?.text === AREA_TEXT,
      tour['buffer'].get('area:clairemont')?.text?.slice(0, 40) ?? 'none');
    // A later pass (leave, return — each leg >300 m, the area
    // re-resolution threshold): the area is welcomed already, so
    // no new welcome is owed; the slot is open again and the
    // BANKED text voices the area story — no second generation.
    world.area = { neighborhood: 'University City', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.011, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(10_000);
    world.area = { neighborhood: 'Clairemont', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(90_000);
    check('on the return pass the banked area text sounds, sourced buffered',
      world.eventsOf('story_played').some(
        e => e.payload.subject === 'area:clairemont' && e.payload.source === 'buffered',
      ) &&
        playbacksFor(world, 'area:clairemont').some(e => e.payload.sounded === true),
      JSON.stringify(world.eventsOf('story_played').filter(e => e.payload.subject === 'area:clairemont').map(e => e.payload)));
    check('still exactly one Clairemont area-story generation (the bank paid, not a new spend)',
      world.genStoryPrompts.filter(p => p.includes('AREA STORY') && p.includes('Clairemont')).length === 1,
      `prompts=${world.genStoryPrompts.filter(p => p.includes('AREA STORY') && p.includes('Clairemont')).length}`);
    tour.endTour();
  }

  suite('A3 Bay Ho acceptance: live welcome outrun at freeway speed discharges silently');
  {
    resetLocalStorage();
    const LJ = { lat: 32.85, lng: -117.25 };
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park', { lat: LJ.lat, lng: LJ.lng })],
      library: [{ name: 'Alpha Park', lat: LJ.lat, lng: LJ.lng }],
      intros: [],
    });
    world.genStoryBehavior = prompt => {
      if (prompt.includes('NEIGHBORHOOD WELCOME') && prompt.includes('Bay Ho')) {
        // The field pipeline: ~25 s of text generation (the
        // field case measured 26.7 s fetch + 25.8 s synth).
        return new Promise(res =>
          world.clock.setTimeout(
            () =>
              res(
                'Welcome to Bay Ho, a small bayside neighborhood above the bay, ' +
                  'where the streets step down toward the water and the evening light comes in low over the marina.',
              ),
            25_000,
          ),
        );
      }
      return 'A generated story about the road ahead, told with care and local color. '.repeat(3);
    };
    const audio = new FakeAudio(world.clock, okPolicy({ library: 60_000, synth: 12_000 }));
    const { tour } = await healthyOpening(world, audio, LJ);
    // Enter Bay Ho at 21.6 m/s (the field speed) with Alpha
    // (60 s) still playing: the welcome generates into the
    // waiting slot and is judged only when Alpha ends — by then
    // the ship is ~900 m past the anchor, beyond the reach of a
    // ~30 s telling at this speed.
    world.area = { neighborhood: 'Bay Ho', city: 'San Diego' };
    let lat = LJ.lat + 0.01;
    tour.onPosition({ lat, lng: LJ.lng, speedMps: 21.6, headingDeg: 180 });
    for (let i = 0; i < 48; i++) {
      await world.clock.advance(5_000);
      lat += 0.00097; // 21.6 m/s × 5 s ≈ 108 m per step
      tour.onPosition({ lat, lng: LJ.lng, speedMps: 21.6, headingDeg: 180 });
    }
    check('the live welcome was generated exactly once (no retry loop after discharge)',
      welcomePromptsFor(world, 'Bay Ho').length === 1,
      `prompts=${welcomePromptsFor(world, 'Bay Ho').length}`);
    check('the outrun welcome never sounded',
      !playbacksFor(world, 'welcome:bay ho').some(e => e.payload.sounded === true),
      JSON.stringify(playbacksFor(world, 'welcome:bay ho').map(e => e.payload)));
    check('the discharge filed no story_dropped for the welcome',
      dropsFor(world, 'welcome:bay ho').length === 0,
      JSON.stringify(dropsFor(world, 'welcome:bay ho').map(e => e.payload)));
    check('the welcome is not heard-marked',
      !world.heard.includes('Welcome to Bay Ho'), world.heard.join(' | '));
    tour.endTour();
  }

  suite('A4 long-tail lane intact: live welcome for a zero-row area still lands at low speed');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: [] });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    world.area = { neighborhood: 'Bay Ho', city: 'San Diego' };
    let lat = UTC.lat + 0.004;
    tour.onPosition({ lat, lng: UTC.lng, speedMps: 1.2, headingDeg: 180 });
    for (let i = 0; i < 12; i++) {
      await world.clock.advance(5_000);
      lat += 0.00005; // 1.2 m/s × 5 s = 6 m per step — dwelling pace
      tour.onPosition({ lat, lng: UTC.lng, speedMps: 1.2, headingDeg: 180 });
    }
    check('the live welcome generated once and sounded',
      welcomePromptsFor(world, 'Bay Ho').length === 1 &&
        playbacksFor(world, 'welcome:bay ho').some(e => e.payload.sounded === true),
      `prompts=${welcomePromptsFor(world, 'Bay Ho').length} played=${JSON.stringify(playbacksFor(world, 'welcome:bay ho').map(e => e.payload))}`);
    check('the welcome completed (not cut by its own gate)',
      playbacksFor(world, 'welcome:bay ho').some(e => e.payload.completed === true),
      JSON.stringify(playbacksFor(world, 'welcome:bay ho').map(e => e.payload)));
    tour.endTour();
  }

  suite('A5 fit gate scope: shelf welcome exempt at speed; opening doctrine unchanged');
  {
    // The A3 geometry with a SHELF welcome: it waits behind the
    // same 60 s story at the same 21.6 m/s and is judged ~900 m
    // from its pin — and sounds, because a shelf welcome is
    // instant and anchored; the gate binds live generation only.
    resetLocalStorage();
    const LJ = { lat: 32.85, lng: -117.25 };
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park', { lat: LJ.lat, lng: LJ.lng })],
      library: [{ name: 'Alpha Park', lat: LJ.lat, lng: LJ.lng }],
      intros: ['Clairemont'],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 60_000, synth: 12_000 }));
    const { tour } = await healthyOpening(world, audio, LJ);
    world.area = { neighborhood: 'Clairemont', city: 'San Diego' };
    let lat = LJ.lat + 0.01;
    tour.onPosition({ lat, lng: LJ.lng, speedMps: 21.6, headingDeg: 180 });
    for (let i = 0; i < 24; i++) {
      await world.clock.advance(5_000);
      lat += 0.00097;
      tour.onPosition({ lat, lng: LJ.lng, speedMps: 21.6, headingDeg: 180 });
    }
    check('the shelf welcome sounded under the geometry that discharges a live one',
      playbacksFor(world, 'welcome:clairemont').some(
        e => e.payload.sounded === true && e.payload.source === 'library',
      ),
      JSON.stringify(playbacksFor(world, 'welcome:clairemont').map(e => e.payload)));
    tour.endTour();
  }
  {
    // Opening doctrine, zero-row start area: live is attempted
    // first and sounds (the gate does not reach the opening's
    // live attempt at the origin).
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: [] });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    check('the opening welcome attempted live generation for the zero-row start area',
      welcomePromptsFor(world, 'University City').length >= 1,
      `prompts=${welcomePromptsFor(world, 'University City').length}`);
    check('the opening welcome sounded, sourced live',
      playbacksFor(world, 'welcome:university city').some(
        e => e.payload.sounded === true && e.payload.source === 'live',
      ),
      JSON.stringify(playbacksFor(world, 'welcome:university city').map(e => e.payload)));
    tour.endTour();
  }
  {
    // Opening doctrine, shelf start area with live generation
    // down: the stored intro is the fallback and sounds.
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: ['University City'] });
    world.genStoryBehavior = prompt => {
      if (prompt.includes('NEIGHBORHOOD WELCOME')) throw new Error('welcome generation down');
      return 'A generated story about the road ahead, told with care and local color. '.repeat(3);
    };
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    check('the opening welcome fell back to the shelf intro and sounded',
      playbacksFor(world, 'welcome:university city').some(
        e => e.payload.sounded === true && e.payload.source === 'library',
      ),
      JSON.stringify(playbacksFor(world, 'welcome:university city').map(e => e.payload)));
    tour.endTour();
  }

  // ---------------------------------------------------------- PB: pass-by conversion (Nov 5)
  // Field evidence (tour 8b65691c, Nov 5): the live Bay Ho
  // welcome took ~71 s to generate, waited 83 s in queue, and
  // sounded 2,308 m past its anchor — arrival language for a
  // ~65 s freeway pass. The fix is measured-exit conversion:
  // when the area resolves onward at freeway speed before the
  // telling lands (generation start / text landing / while
  // waiting), the welcome is re-told as a short past-tense
  // PASS-BY (20 s class), never as an arrival. Below freeway
  // speed nothing converts; shelf welcomes never convert.
  // A3 re-check (recorded per the scope): A3's world never
  // resolves a SECOND area while its welcome waits — the area
  // stays Bay Ho for the whole run — so no checkpoint can
  // fire there and A3 stands UNCHANGED above (discharge, not
  // conversion, remains its expectation).

  const passbyPromptsFor = (world, name) =>
    world.genStoryPrompts.filter(p => p.includes('NEIGHBORHOOD PASS-BY') && p.includes(name));
  const countPacksFor = (world, name) => {
    let n = 0;
    const orig = world.seams.buildFactPack;
    world.seams.buildFactPack = async (candidate, area, nearby) => {
      if (candidate?.name === name) n += 1;
      return orig(candidate, area, nearby);
    };
    return () => n;
  };
  const PB_ARRIVAL =
    'Bay Ho began as a bayside grid of small lots stepped above Mission Bay. ' +
    'Its streets were cut for families who wanted the water close and the city closer, and the neighborhood grew up quiet between the freeway and the shore. '.repeat(2);
  const PB_PASSBY =
    'That was Bay Ho — the little bayside grid above Mission Bay, gone in about a minute at this speed. ' +
    'It grew up quiet between the freeway and the shore. The road is already into what comes next.';
  const pbBehavior = world => prompt => {
    if (prompt.includes('AREA STORY')) {
      // The generic area lane stays out of these scenarios:
      // its generation hangs (never lands an item).
      return new Promise(res =>
        world.clock.setTimeout(
          () => res('A generated area story that lands far too late to matter. '.repeat(3)),
          600_000,
        ),
      );
    }
    if (prompt.includes('NEIGHBORHOOD PASS-BY') && prompt.includes('Bay Ho')) {
      return new Promise(res => world.clock.setTimeout(() => res(PB_PASSBY), 2_000));
    }
    if (prompt.includes('NEIGHBORHOOD WELCOME') && prompt.includes('Bay Ho')) {
      // The field pipeline's shape: ~30 s of text generation.
      return new Promise(res => world.clock.setTimeout(() => res(PB_ARRIVAL), 30_000));
    }
    return 'A generated story about the road ahead, told with care and local color. '.repeat(3);
  };

  suite('PB-1 Nov 5 replay: exit during the queue converts the waiting welcome; the pass-by sounds and completes');
  {
    resetLocalStorage();
    const LJ = { lat: 32.85, lng: -117.25 };
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park', { lat: LJ.lat, lng: LJ.lng })],
      library: [{ name: 'Alpha Park', lat: LJ.lat, lng: LJ.lng }],
      intros: [],
    });
    const packsForBayHo = countPacksFor(world, 'Bay Ho');
    world.genStoryBehavior = pbBehavior(world);
    const audio = new FakeAudio(world.clock, okPolicy({ library: 90_000, synth: 12_000 }));
    const { tour } = await healthyOpening(world, audio, LJ);
    // Enter Bay Ho at 29.8 m/s with Alpha (90 s) occupying the
    // channel: the welcome generates (~30 s) into the waiting
    // slot behind it — the field case's shape.
    world.area = { neighborhood: 'Bay Ho', city: 'San Diego' };
    let lat = LJ.lat + 0.01;
    tour.onPosition({ lat, lng: LJ.lng, speedMps: 29.8, headingDeg: 180 });
    await world.clock.advance(35_000); // the arrival text has landed; the item waits
    tour.onPosition({ lat: (lat += 0.004), lng: LJ.lng, speedMps: 29.8, headingDeg: 180 });
    check('before the exit: one arrival generation, no pass-by generation',
      welcomePromptsFor(world, 'Bay Ho').length === 1 && passbyPromptsFor(world, 'Bay Ho').length === 0,
      `arrival=${welcomePromptsFor(world, 'Bay Ho').length} passby=${passbyPromptsFor(world, 'Bay Ho').length}`);
    // The exit: the area resolves onward while the welcome
    // waits — checkpoint 3 withdraws it and re-tells it.
    world.area = { neighborhood: 'University City', city: 'San Diego' };
    tour.onPosition({ lat: (lat += 0.004), lng: LJ.lng, speedMps: 29.8, headingDeg: 180 });
    for (let i = 0; i < 16; i++) {
      await world.clock.advance(10_000);
      tour.onPosition({ lat: (lat += 0.0027), lng: LJ.lng, speedMps: 29.8, headingDeg: 180 });
    }
    check('exactly one pass-by re-roll followed the exit',
      passbyPromptsFor(world, 'Bay Ho').length === 1,
      `passby=${passbyPromptsFor(world, 'Bay Ho').length}`);
    check('the re-roll reused the arrival fact pack (one pack build for Bay Ho)',
      packsForBayHo() === 1, `packs=${packsForBayHo()}`);
    const played = welcomePlayed(world, 'welcome:bay ho');
    check('the welcome committed twice: the arrival item, then the converted one',
      played.length === 2 && played[0]?.payload.framing === null && played[1]?.payload.framing === 'passby',
      JSON.stringify(played.map(e => e.payload)));
    const pbs = playbacksFor(world, 'welcome:bay ho');
    check('exactly one welcome playback: the pass-by, sounded and completed',
      pbs.length === 1 && pbs[0]?.payload.sounded === true && pbs[0]?.payload.completed === true &&
        pbs[0]?.payload.framing === 'passby',
      JSON.stringify(pbs.map(e => e.payload)));
    check('no story_dropped filed for the welcome (withdrawal + conversion are silent)',
      dropsFor(world, 'welcome:bay ho').length === 0,
      JSON.stringify(dropsFor(world, 'welcome:bay ho').map(e => e.payload)));
    check('the pass counts as welcomed (the converted telling was heard)',
      world.heard.includes('Welcome to Bay Ho'), world.heard.join(' | '));
    tour.endTour();
  }

  suite('PB-2 exit during generation: checkpoint 2 re-rolls once, from the same pack');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: [] });
    const packsForBayHo = countPacksFor(world, 'Bay Ho');
    world.genStoryBehavior = prompt => {
      if (prompt.includes('AREA STORY')) {
        return new Promise(res =>
          world.clock.setTimeout(() => res('A generated area story that lands far too late. '.repeat(3)), 600_000),
        );
      }
      if (prompt.includes('NEIGHBORHOOD PASS-BY') && prompt.includes('Bay Ho')) {
        return new Promise(res => world.clock.setTimeout(() => res(PB_PASSBY), 2_000));
      }
      if (prompt.includes('NEIGHBORHOOD WELCOME') && prompt.includes('Bay Ho')) {
        return new Promise(res => world.clock.setTimeout(() => res(PB_ARRIVAL), 20_000));
      }
      return 'A generated story about the road ahead, told with care and local color. '.repeat(3);
    };
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    world.area = { neighborhood: 'Bay Ho', city: 'San Diego' };
    let lat = UTC.lat + 0.01;
    tour.onPosition({ lat, lng: UTC.lng, speedMps: 29.8, headingDeg: 180 });
    await world.clock.advance(8_000); // generation in flight (lands at +20 s)
    // The exit lands mid-generation.
    world.area = { neighborhood: 'University City', city: 'San Diego' };
    tour.onPosition({ lat: (lat += 0.004), lng: UTC.lng, speedMps: 29.8, headingDeg: 180 });
    await world.clock.advance(60_000);
    check('one arrival generation + exactly one pass-by re-roll',
      welcomePromptsFor(world, 'Bay Ho').length === 1 && passbyPromptsFor(world, 'Bay Ho').length === 1,
      `arrival=${welcomePromptsFor(world, 'Bay Ho').length} passby=${passbyPromptsFor(world, 'Bay Ho').length}`);
    check('the re-roll reused the same fact pack (one pack build for Bay Ho)',
      packsForBayHo() === 1, `packs=${packsForBayHo()}`);
    const pbs = playbacksFor(world, 'welcome:bay ho');
    check('the converted pass-by sounded and completed; no arrival playback exists',
      pbs.length === 1 && pbs[0]?.payload.sounded === true && pbs[0]?.payload.completed === true &&
        pbs[0]?.payload.framing === 'passby',
      JSON.stringify(pbs.map(e => e.payload)));
    check('the pass counts as welcomed',
      world.heard.includes('Welcome to Bay Ho'), world.heard.join(' | '));
    tour.endTour();
  }

  suite('PB-3 still-inside control: no exit, no conversion, the arrival welcome sounds verbatim');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: [] });
    world.genStoryBehavior = prompt => {
      if (prompt.includes('NEIGHBORHOOD WELCOME') && prompt.includes('Bay Ho')) {
        return new Promise(res => world.clock.setTimeout(() => res(PB_ARRIVAL), 5_000));
      }
      return 'A generated story about the road ahead, told with care and local color. '.repeat(3);
    };
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    world.area = { neighborhood: 'Bay Ho', city: 'San Diego' };
    let lat = UTC.lat + 0.01;
    tour.onPosition({ lat, lng: UTC.lng, speedMps: 29.8, headingDeg: 180 });
    for (let i = 0; i < 10; i++) {
      await world.clock.advance(10_000);
      tour.onPosition({ lat: (lat += 0.0027), lng: UTC.lng, speedMps: 29.8, headingDeg: 180 });
    }
    check('zero pass-by generations on the normal path (no spend regression)',
      passbyPromptsFor(world, 'Bay Ho').length === 0,
      `passby=${passbyPromptsFor(world, 'Bay Ho').length}`);
    const pbs = playbacksFor(world, 'welcome:bay ho');
    check('the arrival welcome sounded and completed, unframed',
      pbs.length === 1 && pbs[0]?.payload.sounded === true && pbs[0]?.payload.completed === true &&
        pbs[0]?.payload.framing === null,
      JSON.stringify(pbs.map(e => e.payload)));
    tour.endTour();
  }

  suite('PB-4 walking-speed control: a boundary crossing below freeway speed never converts');
  {
    resetLocalStorage();
    const LJ = { lat: 32.85, lng: -117.25 };
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park', { lat: LJ.lat, lng: LJ.lng })],
      library: [{ name: 'Alpha Park', lat: LJ.lat, lng: LJ.lng }],
      intros: [],
    });
    // The arrival text is LONG (~410 s by the speech
    // estimate): at 1.4 m/s the standing fit gate's reach
    // (duration × speed ≈ 570 m) must cover the ~390 m of
    // drift this scenario walks (the ≥300 m an area
    // re-resolution requires, plus trailing steps) with real
    // margin, or the gate — not conversion — would own the
    // outcome and the control would test nothing. The length
    // is a fixture for the gate's math, nothing more.
    const PB_ARRIVAL_LONG = PB_ARRIVAL + ' And the telling goes on, street by street, in no hurry at all. '.repeat(76);
    world.genStoryBehavior = prompt => {
      if (prompt.includes('AREA STORY')) {
        return new Promise(res =>
          world.clock.setTimeout(() => res('A generated area story that lands far too late. '.repeat(3)), 600_000),
        );
      }
      if (prompt.includes('NEIGHBORHOOD WELCOME') && prompt.includes('Bay Ho')) {
        return new Promise(res => world.clock.setTimeout(() => res(PB_ARRIVAL_LONG), 10_000));
      }
      return 'A generated story about the road ahead, told with care and local color. '.repeat(3);
    };
    const audio = new FakeAudio(world.clock, okPolicy({ library: 90_000, synth: 12_000 }));
    const { tour } = await healthyOpening(world, audio, LJ);
    // Enter Bay Ho at walking pace with Alpha (90 s) occupying
    // the channel: the welcome generates into the waiting slot.
    world.area = { neighborhood: 'Bay Ho', city: 'San Diego' };
    let lat = LJ.lat + 0.01;
    tour.onPosition({ lat, lng: LJ.lng, speedMps: 1.4, headingDeg: 180 });
    await world.clock.advance(20_000); // the arrival text has landed; the item waits
    // The boundary crossing, at walking pace — three small
    // steps whose cumulative drift crosses the 300 m
    // re-resolution threshold while the welcome waits: the
    // speed gate holds and no checkpoint converts.
    world.area = { neighborhood: 'University City', city: 'San Diego' };
    for (let i = 0; i < 3; i++) {
      tour.onPosition({ lat: (lat += 0.001), lng: LJ.lng, speedMps: 1.4, headingDeg: 180 });
      await world.clock.advance(2_000);
    }
    for (let i = 0; i < 12; i++) {
      await world.clock.advance(10_000);
      tour.onPosition({ lat: (lat += 0.0001), lng: LJ.lng, speedMps: 1.4, headingDeg: 180 });
    }
    check('zero pass-by generations below freeway speed',
      passbyPromptsFor(world, 'Bay Ho').length === 0,
      `passby=${passbyPromptsFor(world, 'Bay Ho').length}`);
    const pbs = playbacksFor(world, 'welcome:bay ho');
    check('the arrival welcome sounded and completed, unframed',
      pbs.length === 1 && pbs[0]?.payload.sounded === true && pbs[0]?.payload.completed === true &&
        pbs[0]?.payload.framing === null,
      `played=${JSON.stringify(welcomePlayed(world, 'welcome:bay ho').map(e => e.payload))} drops=${JSON.stringify(dropsFor(world, 'welcome:bay ho').map(e => e.payload))} pbs=${JSON.stringify(pbs.map(e => e.payload))}`);
    tour.endTour();
  }

  suite('PB-5 re-roll failure: silent discharge, no re-arm — and the exited area survives as fold-in salvage');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: [] });
    world.genStoryBehavior = prompt => {
      if (prompt.includes('AREA STORY')) {
        return new Promise(res =>
          world.clock.setTimeout(() => res('A generated area story that lands far too late. '.repeat(3)), 600_000),
        );
      }
      if (prompt.includes('NEIGHBORHOOD PASS-BY') && prompt.includes('Bay Ho')) {
        throw new Error('pass-by generation down');
      }
      if (prompt.includes('NEIGHBORHOOD WELCOME') && prompt.includes('Bay Ho')) {
        return new Promise(res => world.clock.setTimeout(() => res(PB_ARRIVAL), 10_000));
      }
      if (prompt.includes('NEIGHBORHOOD WELCOME') && prompt.includes('Rose Canyon')) {
        return new Promise(res =>
          world.clock.setTimeout(
            () => res('Welcome to Rose Canyon, where the canyon cuts green through the middle of the city. '.repeat(3)),
            5_000,
          ),
        );
      }
      return 'A generated story about the road ahead, told with care and local color. '.repeat(3);
    };
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    world.area = { neighborhood: 'Bay Ho', city: 'San Diego' };
    let lat = UTC.lat + 0.01;
    tour.onPosition({ lat, lng: UTC.lng, speedMps: 29.8, headingDeg: 180 });
    await world.clock.advance(5_000); // generation in flight (lands at +10 s)
    world.area = { neighborhood: 'University City', city: 'San Diego' };
    tour.onPosition({ lat: (lat += 0.004), lng: UTC.lng, speedMps: 29.8, headingDeg: 180 });
    await world.clock.advance(60_000);
    check('one arrival generation + one failed pass-by attempt',
      welcomePromptsFor(world, 'Bay Ho').length === 1 && passbyPromptsFor(world, 'Bay Ho').length === 1,
      `arrival=${welcomePromptsFor(world, 'Bay Ho').length} passby=${passbyPromptsFor(world, 'Bay Ho').length}`);
    check('nothing for Bay Ho was ever offered or sounded',
      welcomePlayed(world, 'welcome:bay ho').length === 0 && playbacksFor(world, 'welcome:bay ho').length === 0,
      `played=${welcomePlayed(world, 'welcome:bay ho').length}`);
    check('the pass counts as spent (welcomed) but NOT heard',
      tour['welcomed'].has('bay ho') && !world.heard.includes('Welcome to Bay Ho'),
      `welcomed=${[...tour['welcomed']].join(',')} heard=${world.heard.join(' | ')}`);
    check('the discharged welcome filed no story_dropped',
      dropsFor(world, 'welcome:bay ho').length === 0,
      JSON.stringify(dropsFor(world, 'welcome:bay ho').map(e => e.payload)));
    // No re-arm loop: keep driving in the new area.
    for (let i = 0; i < 6; i++) {
      await world.clock.advance(10_000);
      tour.onPosition({ lat: (lat += 0.0027), lng: UTC.lng, speedMps: 29.8, headingDeg: 180 });
    }
    check('no retry loop after the discharge (prompt counts unchanged)',
      welcomePromptsFor(world, 'Bay Ho').length === 1 && passbyPromptsFor(world, 'Bay Ho').length === 1,
      `arrival=${welcomePromptsFor(world, 'Bay Ho').length} passby=${passbyPromptsFor(world, 'Bay Ho').length}`);
    // Fold-in salvage: the NEXT area's welcome carries Bay
    // Ho's lead fact as a "just passed" line — the place's
    // only mention on this drive.
    world.area = { neighborhood: 'Rose Canyon', city: 'San Diego' };
    tour.onPosition({ lat: (lat += 0.004), lng: UTC.lng, speedMps: 29.8, headingDeg: 180 });
    await world.clock.advance(60_000);
    const rcPrompts = world.genStoryPrompts.filter(
      p => p.includes('NEIGHBORHOOD WELCOME') && p.includes('Rose Canyon'),
    );
    check('the next welcome’s prompt carries the banked Bay Ho fact as a just-passed line',
      rcPrompts.length === 1 && rcPrompts[0].includes('JUST PASSED') && rcPrompts[0].includes('Bay Ho began as a bayside grid'),
      JSON.stringify(rcPrompts.map(p => p.slice(0, 200))));
    check('the next welcome sounded',
      playbacksFor(world, 'welcome:rose canyon').some(e => e.payload.sounded === true),
      JSON.stringify(playbacksFor(world, 'welcome:rose canyon').map(e => e.payload)));
    tour.endTour();
  }

  suite('PB-6 shelf-area control: a banked intro on the same fast pass never converts');
  {
    resetLocalStorage();
    const LJ = { lat: 32.85, lng: -117.25 };
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park', { lat: LJ.lat, lng: LJ.lng })],
      library: [{ name: 'Alpha Park', lat: LJ.lat, lng: LJ.lng }],
      intros: ['Clairemont'],
    });
    world.genStoryBehavior = pbBehavior(world);
    const audio = new FakeAudio(world.clock, okPolicy({ library: 90_000, synth: 12_000 }));
    const { tour } = await healthyOpening(world, audio, LJ);
    world.area = { neighborhood: 'Clairemont', city: 'San Diego' };
    let lat = LJ.lat + 0.01;
    tour.onPosition({ lat, lng: LJ.lng, speedMps: 29.8, headingDeg: 180 });
    await world.clock.advance(20_000); // the shelf item waits behind Alpha
    // The same exit that converts a live welcome in PB-1.
    world.area = { neighborhood: 'University City', city: 'San Diego' };
    tour.onPosition({ lat: (lat += 0.004), lng: LJ.lng, speedMps: 29.8, headingDeg: 180 });
    // The shelf item sounds after Alpha and itself plays at
    // the library class's 90 s — the loop must outlast both.
    for (let i = 0; i < 22; i++) {
      await world.clock.advance(10_000);
      tour.onPosition({ lat: (lat += 0.0027), lng: LJ.lng, speedMps: 29.8, headingDeg: 180 });
    }
    check('zero welcome generation of any kind for the shelf area',
      welcomePromptsFor(world, 'Clairemont').length === 0 && passbyPromptsFor(world, 'Clairemont').length === 0,
      `arrival=${welcomePromptsFor(world, 'Clairemont').length} passby=${passbyPromptsFor(world, 'Clairemont').length}`);
    const pbs = playbacksFor(world, 'welcome:clairemont');
    check('the shelf welcome sounded unchanged, sourced library, unframed',
      pbs.length === 1 && pbs[0]?.payload.sounded === true && pbs[0]?.payload.source === 'library' &&
        pbs[0]?.payload.framing === null,
      JSON.stringify(pbs.map(e => e.payload)));
    tour.endTour();
  }

  // ---------------------------------------------------------- ET: entry-position telemetry (Nov 7)
  // A live welcome's subject_lat/lng are sampled when its text
  // is generated, but its area NAME was resolved earlier, at the
  // entry fix — the Nov 5 Bay Ho welcome's record pinned an I-5
  // point in University City for exactly this reason. Erik ruled
  // Nov 7: record both. entry_lat/entry_lng carry the entry fix
  // (captured where the area resolves, carried with the owed
  // record through generation and through a pass-by conversion);
  // the payload stays additive and every other story files null.

  suite('ET-1 live welcome: telemetry carries BOTH the entry fix and the generation-time anchor');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: [] });
    world.genStoryBehavior = prompt => {
      if (prompt.includes('NEIGHBORHOOD WELCOME') && prompt.includes('Bay Ho')) {
        return new Promise(res => world.clock.setTimeout(() => res(PB_ARRIVAL), 5_000));
      }
      return 'A generated story about the road ahead, told with care and local color. '.repeat(3);
    };
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    // The opening welcome's entry fix is its resolution position
    // (the tour's start fix): both fields are that same point.
    const opening = playbacksFor(world, 'welcome:university city');
    check('the opening welcome carries its resolution fix as the entry position',
      opening.length === 1 && opening[0]?.payload.entry_lat === UTC.lat && opening[0]?.payload.entry_lng === UTC.lng,
      JSON.stringify(opening.map(e => e.payload)));
    // Enter Bay Ho at the entry fix E — then move ~445 m deeper
    // in the SAME synchronous breath, before the owed serve's
    // generation samples the current position as its anchor.
    // The two samples must land in the record as two positions.
    const E = { lat: UTC.lat + 0.01, lng: UTC.lng };
    const G = { lat: UTC.lat + 0.014, lng: UTC.lng };
    world.area = { neighborhood: 'Bay Ho', city: 'San Diego' };
    tour.onPosition({ lat: E.lat, lng: E.lng, speedMps: 8, headingDeg: 180 });
    tour.onPosition({ lat: G.lat, lng: G.lng, speedMps: 8, headingDeg: 180 });
    for (let i = 0; i < 10; i++) {
      await world.clock.advance(10_000);
      tour.onPosition({ lat: G.lat, lng: G.lng, speedMps: 8, headingDeg: 180 });
    }
    check('the welcome generated live, exactly once',
      welcomePromptsFor(world, 'Bay Ho').length === 1,
      `arrival=${welcomePromptsFor(world, 'Bay Ho').length}`);
    const played = welcomePlayed(world, 'welcome:bay ho');
    check('story_played pairs the entry fix (entry_*) with the generation position (subject_*)',
      played.length === 1 &&
        played[0]?.payload.entry_lat === E.lat && played[0]?.payload.entry_lng === E.lng &&
        played[0]?.payload.subject_lat === G.lat && played[0]?.payload.subject_lng === G.lng,
      JSON.stringify(played.map(e => e.payload)));
    const pbs = playbacksFor(world, 'welcome:bay ho');
    check('story_playback carries the same pair, sounded and completed',
      pbs.length === 1 && pbs[0]?.payload.sounded === true && pbs[0]?.payload.completed === true &&
        pbs[0]?.payload.entry_lat === E.lat && pbs[0]?.payload.entry_lng === E.lng &&
        pbs[0]?.payload.subject_lat === G.lat && pbs[0]?.payload.subject_lng === G.lng,
      JSON.stringify(pbs.map(e => e.payload)));
    tour.endTour();
  }

  suite('ET-2 pass-by conversion: the converted telling keeps the ORIGINAL entry fix');
  {
    resetLocalStorage();
    const LJ = { lat: 32.85, lng: -117.25 };
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park', { lat: LJ.lat, lng: LJ.lng })],
      library: [{ name: 'Alpha Park', lat: LJ.lat, lng: LJ.lng }],
      intros: [],
    });
    world.genStoryBehavior = pbBehavior(world);
    const audio = new FakeAudio(world.clock, okPolicy({ library: 90_000, synth: 12_000 }));
    const { tour } = await healthyOpening(world, audio, LJ);
    // PB-1's shape: enter Bay Ho at E with Alpha occupying the
    // channel; the arrival item generates and waits.
    const E = { lat: LJ.lat + 0.01, lng: LJ.lng };
    world.area = { neighborhood: 'Bay Ho', city: 'San Diego' };
    let lat = E.lat;
    tour.onPosition({ lat, lng: LJ.lng, speedMps: 29.8, headingDeg: 180 });
    await world.clock.advance(35_000);
    // The freeway exit converts the waiting welcome (checkpoint 3).
    world.area = { neighborhood: 'University City', city: 'San Diego' };
    tour.onPosition({ lat: (lat += 0.004), lng: LJ.lng, speedMps: 29.8, headingDeg: 180 });
    for (let i = 0; i < 16; i++) {
      await world.clock.advance(10_000);
      tour.onPosition({ lat: (lat += 0.0027), lng: LJ.lng, speedMps: 29.8, headingDeg: 180 });
    }
    const played = welcomePlayed(world, 'welcome:bay ho');
    check('both commits — the arrival item and the converted one — carry the Bay Ho entry fix',
      played.length === 2 &&
        played.every(e => e.payload.entry_lat === E.lat && e.payload.entry_lng === E.lng),
      JSON.stringify(played.map(e => e.payload)));
    const pbs = playbacksFor(world, 'welcome:bay ho');
    check('the pass-by playback names the entry fix, not the conversion position',
      pbs.length === 1 && pbs[0]?.payload.framing === 'passby' &&
        pbs[0]?.payload.entry_lat === E.lat && pbs[0]?.payload.entry_lng === E.lng &&
        pbs[0]?.payload.subject_lat !== E.lat,
      JSON.stringify(pbs.map(e => e.payload)));
    tour.endTour();
  }

  // ---------------------------------------------------------- WT: woven twins (Nov 4, 2026)
  // The woven tranche's twins ride the shelf as sibling rows
  // (source angle + '-woven-v1') RESERVED for route mode:
  // freeform serves the presence originals. A twin must never
  // be selected — above all when its original was already
  // dealt this tour (the generic find would otherwise hand
  // the twin out as the place's next telling), and never by
  // a corridor serve whose index happens to sort it first.
  suite('WT-1 woven twins: original serves; with the original dealt, the retell is generated — never the twin');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Twin Place', { tier1: true })],
      library: [{ name: 'Twin Place', angles: ['landmark_origin', 'landmark_origin-woven-v1'] }],
    });
    // Starve prefetch so both tellings resolve at serve time (P4's discipline).
    world.seams.discoverCandidates = async pt =>
      Math.abs(pt.lat - UTC.lat) < 0.0001 && Math.abs(pt.lng - UTC.lng) < 0.0001
        ? world.candidates
        : [];
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);
    const tellings = () =>
      world.eventsOf('story_played').filter(e => e.payload.subject === 'twin place');
    for (let i = 0; i < 80 && tellings().length < 2; i++) await world.clock.advance(5_000);
    const t = tellings();
    check('the place was told twice (original + in-tour retell)', t.length === 2, `n=${t.length}`);
    check('first telling is the library original',
      t[0]?.payload.source === 'library' && t[0]?.payload.angle === 'landmark_origin',
      JSON.stringify(t[0]?.payload));
    check('the original audio is what played',
      audio.log.some(e => typeof e.src === 'string' && e.src.endsWith('library/twin-place/landmark_origin.wav')),
      JSON.stringify(audio.log.map(e => e.src)));
    check('second telling is generated live, not the twin',
      t[1]?.payload.source === 'live' && t[1]?.payload.angle === null,
      JSON.stringify(t[1]?.payload));
    check('no telling anywhere carries a twin angle',
      !world.eventsOf('story_played').some(e => typeof e.payload.angle === 'string' && e.payload.angle.endsWith('-woven-v1')),
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.angle)));
    check('the twin audio never played',
      !audio.log.some(e => typeof e.src === 'string' && e.src.includes('-woven-v1')),
      JSON.stringify(audio.log.map(e => e.src)));
    tour.endTour();
  }

  suite('WT-2 woven twins: a corridor serve takes the original even when the twin sorts first in the index');
  {
    resetLocalStorage();
    // S-09's segment discipline: a substantial, non-degenerate
    // segment, banked under whichever segment the matcher returns.
    const segLen = s =>
      s.polyline.reduce((acc, p, i) => (i === 0 ? 0 : acc + Math.hypot((p.lat - s.polyline[i - 1].lat) * 111_320, (p.lng - s.polyline[i - 1].lng) * 88_000)), 0);
    const picked = CORRIDOR_SEGMENTS.filter(s => segLen(s) > 4000).reduce((a, b) => (segLen(a) > segLen(b) ? a : b));
    const start = picked.polyline[0];
    const second = picked.polyline[1];
    const pickedHeading = ((Math.atan2(second.lng - start.lng, second.lat - start.lat) * 180) / Math.PI + 360) % 360;
    const seg = matchCorridor({ lat: start.lat, lng: start.lng, heading: pickedHeading })?.segment ?? picked;
    const world = makeWorld(Tour, {
      candidates: [],
      // The twin row FIRST in the index: row order is not a
      // guarantee the shelf makes, so the serve must refuse
      // the twin on its angle, not on its position.
      library: [{ name: seg.displayName, angles: ['corridor-woven-v1', 'corridor'] }],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ synth: 30_000 }));
    const tour = world.makeTour(audio);
    tour.onPosition({ lat: start.lat, lng: start.lng, speedMps: 27, headingDeg: pickedHeading });
    tour.start(false);
    await world.clock.advance(20_000); // greeting + opener done; welcome (30 s) playing
    // A GPS tick on the segment while the WELCOME plays: the
    // corridor story slots behind it (S-09's flow).
    tour.onPosition({ lat: start.lat, lng: start.lng, speedMps: 27, headingDeg: pickedHeading });
    for (let i = 0; i < 24 && audio.plays('library').length === 0; i++) await world.clock.advance(5_000);
    const libPlays = audio.plays('library');
    check('the corridor story served from the shelf', libPlays.length >= 1, JSON.stringify(audio.log.map(e => e.src)));
    check('the corridor ORIGINAL is what played',
      libPlays.some(e => typeof e.src === 'string' && e.src.endsWith('/corridor.wav')),
      JSON.stringify(libPlays.map(e => e.src)));
    check('the twin audio never played',
      !audio.log.some(e => typeof e.src === 'string' && e.src.includes('-woven-v1')),
      JSON.stringify(audio.log.map(e => e.src)));
    check('the corridor story_played fired for the segment',
      world.eventsOf('story_played').some(e => e.payload.subject === `corridor:${seg.id}`),
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    tour.endTour();
  }

  // ---------------------------------------------------------- AM ambient bed (Nov 5, 2026 scope)
  // The bed is a parallel layer beside the Player: resolver
  // fixtures, the start gate, the duck engine, hysteresis +
  // adoption, pause/kill follows, fault self-silence, teardown.
  // Fake bed factory — no DOM, no network, zero live calls.
  class FakeBedChannel {
    constructor() {
      this.src = null; this.level = 0; this.playing = false;
      this.disposed = false; this.playCalls = 0; this.failWith = null; this.errorCb = null;
    }
    load(src) { this.src = src; }
    play() {
      this.playCalls++;
      // A refusal is a property of the attempt (no gesture yet),
      // not of the element: fail once, then behave.
      const fail = this.failWith;
      this.failWith = null;
      if (fail) return Promise.reject(fail);
      this.playing = true;
      return Promise.resolve();
    }
    pause() { this.playing = false; }
    setLevel(v) { this.level = v; }
    dispose() { this.disposed = true; this.playing = false; }
    setOnError(cb) { this.errorCb = cb; }
    fireError() { this.errorCb?.(); }
  }
  class FakeBedFactory {
    constructor() { this.channels = []; this.failNextPlayWith = null; }
    get mode() { return 'volume'; }
    async decide() { return 'volume'; }
    resume() {}
    createChannel() {
      const ch = new FakeBedChannel();
      if (this.failNextPlayWith) { ch.failWith = this.failNextPlayWith; this.failNextPlayWith = null; }
      this.channels.push(ch);
      return ch;
    }
  }
  const BED_ASSETS = { ocean: 'bed://ocean', road: 'bed://road', city: 'bed://city', street: 'bed://street', canyon: 'bed://canyon' };
  const MISSION_BAY = { lat: 32.78, lng: -117.235 };
  const DOWNTOWN = { lat: 32.715, lng: -117.16 };
  const UNIVERSITY_CITY = { lat: 32.853, lng: -117.18 };
  const RANCHO_BERNARDO = { lat: 33.02, lng: -117.08 };
  const CHULA_VISTA = { lat: 32.64, lng: -117.08 };
  const OUTSIDE_COUNTY = { lat: 33.6, lng: -117.7 };
  const JULIAN = { lat: 33.078, lng: -116.6 };
  const EL_CAJON = { lat: 32.794, lng: -116.962 };
  const bedCtx = (pos, speedMps, extra = {}) => ({ ...pos, speedMps, walking: false, urban: false, ...extra });
  function makeBed(clock, factory, diags, enabled = true) {
    return new ambience.AmbientBedController({
      assets: BED_ASSETS, enabled, factory, clock, onDiag: r => diags.push(r),
    });
  }

  suite('AM-1 resolver fixtures: context, precedence, walking');
  {
    const R = ambience.resolveAmbientBed;
    check('coast band at surface speed -> ocean', R(bedCtx(MISSION_BAY, 8)) === 'ocean');
    check('coast band at freeway speed -> road (precedence)', R(bedCtx(MISSION_BAY, 29)) === 'road');
    check('urban core at surface speed -> city-air', R(bedCtx(DOWNTOWN, 8, { urban: true })) === 'city');
    check('central without the urban signal -> quiet-street (v1.2 wired)', R(bedCtx(DOWNTOWN, 8)) === 'street');
    check('residential central -> quiet-street', R(bedCtx(UNIVERSITY_CITY, 8)) === 'street');
    check('north suburbs -> quiet-street', R(bedCtx(RANCHO_BERNARDO, 8)) === 'street');
    check('south suburbs -> quiet-street', R(bedCtx(CHULA_VISTA, 8)) === 'street');
    check('backcountry -> canyon wind', R(bedCtx(JULIAN, 8)) === 'canyon');
    check('east county canyon belt -> canyon wind', R(bedCtx(EL_CAJON, 8)) === 'canyon');
    check('walking -> none even on the coast', R(bedCtx(MISSION_BAY, 1.2, { walking: true })) === null);
    check('walking -> none in the backcountry', R(bedCtx(JULIAN, 1.2, { walking: true })) === null);
    check('walking -> none even at the urban core', R(bedCtx(DOWNTOWN, 1.2, { walking: true, urban: true })) === null);
    check('walking -> none in a residential context', R(bedCtx(UNIVERSITY_CITY, 1.2, { walking: true })) === null);
    check('freeway speed anywhere -> road', R(bedCtx(JULIAN, 29)) === 'road');
    check('freeway speed outranks quiet-street', R(bedCtx(UNIVERSITY_CITY, 29)) === 'road');
    check('outside the county -> none', R(bedCtx(OUTSIDE_COUNTY, 8)) === null);
    check('urban names: Gaslamp Quarter matches', ambience.isUrbanAreaName('Gaslamp Quarter') === true);
    check('urban names: Barrio Logan matches', ambience.isUrbanAreaName('Barrio Logan') === true);
    check('urban names: Clairemont does not match', ambience.isUrbanAreaName('Clairemont') === false);
    check('urban names: null does not match', ambience.isUrbanAreaName(null) === false);
  }

  suite('AM-2 start gate: nothing before the first proven sound');
  {
    const clock = new FakeClock();
    const factory = new FakeBedFactory();
    const diags = [];
    const bed = makeBed(clock, factory, diags);
    bed.updateContext(bedCtx(MISSION_BAY, 8));
    await clock.advance(30_000);
    check('no channel exists before the gate', factory.channels.length === 0);
    bed.noteFirstSound();
    await clock.flush();
    check('the gate opens the ocean bed', factory.channels.length === 1 && factory.channels[0].src === 'bed://ocean');
    await clock.advance(4_000);
    const ch = factory.channels[0];
    check('bed faded in to full level', ch.level > ambience.FULL * 0.8, `level=${ch.level}`);
    check('bed element is playing', ch.playing === true);
    check('controller reports the ocean kind', bed.kind === 'ocean');
    bed.dispose();
  }

  suite('AM-3 duck + release: 0.5 s attack, breath never blooms, 2.5 s release');
  {
    const clock = new FakeClock();
    const factory = new FakeBedFactory();
    const bed = makeBed(clock, factory, []);
    bed.updateContext(bedCtx(MISSION_BAY, 8));
    bed.noteFirstSound();
    await clock.flush();
    await clock.advance(4_000);
    const ch = factory.channels[0];
    bed.noteSounding(true);
    await clock.advance(600);
    check('ducked to ~-19 dB within ~0.5 s of a sound start', ch.level <= ambience.DUCK + 0.01, `level=${ch.level}`);
    bed.noteSounding(false);
    await clock.advance(800); // the standing breath
    check('the 700 ms breath does not bloom the bed', ch.level < ambience.FULL * 0.5, `level=${ch.level}`);
    await clock.advance(3_000);
    check('a real gap releases back to full', ch.level >= ambience.FULL - 0.005, `level=${ch.level}`);
    bed.dispose();
  }

  suite('AM-4 hysteresis: flip-flop never adopts; a held target adopts at grace or boundary');
  {
    const clock = new FakeClock();
    const factory = new FakeBedFactory();
    const bed = makeBed(clock, factory, []);
    bed.updateContext(bedCtx(MISSION_BAY, 8));
    bed.noteFirstSound();
    await clock.flush();
    await clock.advance(4_000);
    // Polygon-edge / speed flip-flop for 40 s: no adoption.
    for (let i = 0; i < 10; i++) {
      bed.updateContext(bedCtx(MISSION_BAY, 29));
      await clock.advance(2_000);
      bed.updateContext(bedCtx(MISSION_BAY, 8));
      await clock.advance(2_000);
    }
    check('flip-flop produced no adoption', factory.channels.length === 1 && bed.kind === 'ocean');
    // A held road target: hysteresis, then the boundary grace expires -> crossfade.
    bed.updateContext(bedCtx(MISSION_BAY, 29));
    await clock.advance(15_000);
    check('hysteresis alone does not adopt mid-story', factory.channels.length === 1);
    await clock.advance(3_000);
    check('grace expiry adopts the road bed', factory.channels.length === 2 && factory.channels[1].src === 'bed://road');
    await clock.advance(6_000);
    check('the ocean channel retired after the crossfade', factory.channels[0].disposed === true && bed.kind === 'road');
    // Back to ocean: adoption lands AT a story boundary inside the grace.
    bed.updateContext(bedCtx(MISSION_BAY, 8));
    await clock.advance(15_500);
    bed.noteStoryBoundary();
    await clock.flush();
    check('a story boundary inside the grace adopts immediately', factory.channels.length === 3 && factory.channels[2].src === 'bed://ocean');
    bed.dispose();
  }

  suite('AM-5 pause follow + kill switch');
  {
    const clock = new FakeClock();
    const factory = new FakeBedFactory();
    const bed = makeBed(clock, factory, []);
    bed.updateContext(bedCtx(MISSION_BAY, 8));
    bed.noteFirstSound();
    await clock.flush();
    await clock.advance(4_000);
    const ch = factory.channels[0];
    bed.notePaused(true);
    await clock.advance(1_200);
    check('pause fades the bed out in ~1 s', ch.level <= 0.001, `level=${ch.level}`);
    check('pause parks the element', ch.playing === false);
    bed.notePaused(false);
    await clock.advance(1_200);
    check('resume restores the bed', ch.playing === true && ch.level > ambience.FULL * 0.8, `level=${ch.level}`);
    bed.setEnabled(false);
    await clock.advance(700);
    check('kill switch silences the bed', ch.level <= 0.001 && bed.enabled === false, `level=${ch.level}`);
    bed.setEnabled(true);
    await clock.advance(1_200);
    check('re-enable restores the bed', ch.level > ambience.FULL * 0.8 && bed.enabled === true, `level=${ch.level}`);
    bed.dispose();
  }

  suite('AM-6 faults self-silence with one diag; NotAllowedError is not a fault');
  {
    const clock = new FakeClock();
    const factory = new FakeBedFactory();
    const diags = [];
    factory.failNextPlayWith = Object.assign(new Error('decode'), { name: 'NotSupportedError' });
    const bed = makeBed(clock, factory, diags);
    bed.updateContext(bedCtx(MISSION_BAY, 8));
    bed.noteFirstSound();
    await clock.flush();
    await clock.advance(500);
    check('a play fault files exactly one diag', diags.length === 1, JSON.stringify(diags));
    check('the faulted bed is silent and channel-less', bed.kind === null && bed.isFaulted === true);
    bed.updateContext(bedCtx(MISSION_BAY, 29));
    await clock.advance(60_000);
    check('a faulted bed never retries', factory.channels.length === 1 && diags.length === 1);
    bed.dispose();

    const clock2 = new FakeClock();
    const factory2 = new FakeBedFactory();
    const diags2 = [];
    const bed2 = makeBed(clock2, factory2, diags2);
    bed2.updateContext(bedCtx(MISSION_BAY, 8));
    bed2.noteFirstSound();
    await clock2.flush();
    await clock2.advance(500);
    factory2.channels[0].fireError();
    check('an element error self-silences with one diag', diags2.length === 1 && bed2.isFaulted === true);
    bed2.dispose();

    const clock3 = new FakeClock();
    const factory3 = new FakeBedFactory();
    const diags3 = [];
    factory3.failNextPlayWith = Object.assign(new Error('gesture'), { name: 'NotAllowedError' });
    const bed3 = makeBed(clock3, factory3, diags3);
    bed3.updateContext(bedCtx(MISSION_BAY, 8));
    bed3.noteFirstSound();
    await clock3.flush();
    await clock3.advance(500);
    check('NotAllowedError files no diag', diags3.length === 0 && bed3.isFaulted === false);
    bed3.noteGesture();
    await clock3.flush();
    check('the next gesture retries the play', factory3.channels[0].playCalls >= 2 && factory3.channels[0].playing === true);
    bed3.dispose();
  }

  suite('AM-7 teardown: stop fades then disposes; walking never starts a bed');
  {
    const clock = new FakeClock();
    const factory = new FakeBedFactory();
    const bed = makeBed(clock, factory, []);
    bed.updateContext(bedCtx(MISSION_BAY, 8));
    bed.noteFirstSound();
    await clock.flush();
    await clock.advance(4_000);
    bed.stop(1500);
    await clock.advance(1_700);
    check('stop(1500) disposes the channel', factory.channels[0].disposed === true && bed.kind === null);

    const clock2 = new FakeClock();
    const factory2 = new FakeBedFactory();
    const bed2 = makeBed(clock2, factory2, []);
    bed2.updateContext(bedCtx(MISSION_BAY, 1.2, { walking: true }));
    bed2.noteFirstSound();
    await clock2.flush();
    await clock2.advance(10_000);
    check('a walking context never starts a bed', factory2.channels.length === 0);
    bed2.dispose();
  }

  suite('AM-8 v1.1 bed: canyon gate opens in the backcountry; held freeway speed adopts road');
  {
    const clock = new FakeClock();
    const factory = new FakeBedFactory();
    const bed = makeBed(clock, factory, []);
    bed.updateContext(bedCtx(JULIAN, 8));
    bed.noteFirstSound();
    await clock.flush();
    check('the gate opens the canyon bed in the backcountry', factory.channels.length === 1 && factory.channels[0].src === 'bed://canyon');
    await clock.advance(4_000);
    bed.updateContext(bedCtx(JULIAN, 29));
    await clock.advance(18_000);
    check('held freeway speed adopts road over canyon', factory.channels.length === 2 && factory.channels[1].src === 'bed://road');
    await clock.advance(6_000);
    check('the canyon channel retired after the crossfade', factory.channels[0].disposed === true && bed.kind === 'road');
    bed.dispose();
  }

  suite('AM-9 v1.2 bed: quiet-street gate opens in residential central; the urban signal promotes to city-air');
  {
    const clock = new FakeClock();
    const factory = new FakeBedFactory();
    const bed = makeBed(clock, factory, []);
    bed.updateContext(bedCtx(UNIVERSITY_CITY, 8));
    bed.noteFirstSound();
    await clock.flush();
    check('the gate opens the quiet-street bed in residential central', factory.channels.length === 1 && factory.channels[0].src === 'bed://street');
    await clock.advance(4_000);
    // Same ground, urban episode geography: city-air outranks quiet-street.
    bed.updateContext(bedCtx(UNIVERSITY_CITY, 8, { urban: true }));
    await clock.advance(18_000);
    check('the urban signal adopts city-air over quiet-street', factory.channels.length === 2 && factory.channels[1].src === 'bed://city');
    await clock.advance(6_000);
    check('the quiet-street channel retired after the crossfade', factory.channels[0].disposed === true && bed.kind === 'city');
    bed.dispose();
  }

  // ---------------------------------------------------------- S-Z zombie seal
  // Nov 6, 2026 (lane A): the ended freeform tour 585db03c filed
  // a generation_attempt 33 s AFTER its own session_end — its
  // generation loop outlived the tour. The Tour's emit sink is
  // now sealed at end: no event of any type may file after
  // session_end, even when an in-flight generation lands later.
  suite('S-Z ended tour files nothing further (zombie seal)');
  {
    resetLocalStorage();
    let releaseGen = null;
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: [],
      genStoryBehavior: () =>
        new Promise(resolve => {
          releaseGen = () =>
            resolve('A generated story about Balboa Park, told at length and with care. '.repeat(6));
        }),
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);
    // Drive time forward until a generation is genuinely in
    // flight (its promise still pending), then end the tour.
    for (let i = 0; i < 12 && world.genStoryPrompts.length === 0; i += 1) {
      await world.clock.advance(10_000);
    }
    check(
      'a generation was in flight when the tour ended',
      world.genStoryPrompts.length >= 1,
      `prompts=${world.genStoryPrompts.length}`,
    );
    tour.endTour();
    const endIdx = world.events.map(e => e.type).lastIndexOf('session_end');
    check('session_end filed', endIdx >= 0);
    const filedAtEnd = world.events.length;
    // The in-flight generation lands after the end; timers run
    // on for five more minutes of tour time. Nothing may file.
    if (releaseGen) releaseGen();
    await world.clock.advance(300_000);
    check(
      'zero events of any type after session_end',
      world.events.length === filedAtEnd,
      `extra=${JSON.stringify(world.events.slice(filedAtEnd).map(e => e.type))}`,
    );
  }

  // ---------------------------------------------------------- IB-01 intro-form pure helpers
  suite('IB-01 intro forms: daypart, rotation pool, callback composer, hook validation');
  {
    check('daypart bands from the device clock', intro.daypartOf(new Date(2026, 10, 11, 7, 30)) === 'early' &&
      intro.daypartOf(new Date(2026, 10, 11, 12, 0)) === 'midday' &&
      intro.daypartOf(new Date(2026, 10, 11, 17, 15)) === 'golden' &&
      intro.daypartOf(new Date(2026, 10, 11, 23, 40)) === 'night' &&
      intro.daypartOf(new Date(2026, 10, 11, 3, 5)) === 'night');
    const base = { recentForms: [], daypartGreeting: false, hookFailed: false, regular: false };
    check('fresh pool offers plain/wandering/hook', JSON.stringify(intro.eligibleIntroForms(base)) === JSON.stringify(['plain', 'wandering', 'hook-question']),
      JSON.stringify(intro.eligibleIntroForms(base)));
    check('a form served within 3 starts leaves the pool',
      !intro.eligibleIntroForms({ ...base, recentForms: ['x', 'plain', 'wandering'] }).includes('plain'));
    check('day-aware needs the daypart greeting', intro.eligibleIntroForms({ ...base, daypartGreeting: true })[0] === 'day-aware' &&
      !intro.eligibleIntroForms(base).includes('day-aware'));
    check('regulars-short needs recency', intro.eligibleIntroForms({ ...base, regular: true }).includes('regulars-short') &&
      !intro.eligibleIntroForms(base).includes('regulars-short'));
    check('a failed hook leaves the pool', !intro.eligibleIntroForms({ ...base, hookFailed: true }).includes('hook-question'));
    check('exhausted pool falls back to the least-recently-served form',
      intro.fallbackIntroForm({ recentForms: ['plain', 'wandering', 'hook-question'], daypartGreeting: false, hookFailed: true, regular: false }) === 'plain');
    const owed = intro.composeCallbackText({ areaName: 'University City', lastStoryLabel: 'Balboa Park', owedName: 'North Park', endedAt: 0 });
    check('callback: an owed welcome outranks a plain memory', typeof owed === 'string' && owed.includes('North Park') && owed.includes("haven't forgotten"), owed ?? 'null');
    const memory = intro.composeCallbackText({ areaName: 'University City', lastStoryLabel: 'Balboa Park', owedName: null, endedAt: 0 });
    check('callback: composed from recorded facts only', typeof memory === 'string' && memory.includes('University City') && memory.includes('Balboa Park'), memory ?? 'null');
    check('callback: an empty record composes nothing', intro.composeCallbackText({ areaName: null, lastStoryLabel: null, owedName: null, endedAt: 0 }) === null);
    check('callback asset freshness window (14 days)',
      intro.callbackAssetFresh({ text: 'Welcome back.', record: {}, createdAt: 1_000_000 }, 1_000_000 + 13 * 24 * 3600_000) === true &&
      intro.callbackAssetFresh({ text: 'Welcome back.', record: {}, createdAt: 1_000_000 }, 1_000_000 + 15 * 24 * 3600_000) === false &&
      intro.callbackAssetFresh(null, 0) === false);
    check('hook validation: one honest question passes',
      intro.validateHookText('Why does the old ferry landing still lean toward the bay?') !== null);
    check('hook validation: statements, multi-questions and rambling fail',
      intro.validateHookText('The ferry landing leans toward the bay.') === null &&
      intro.validateHookText('Why is it old? And why here?') === null &&
      intro.validateHookText('Short?') === null);
  }

  // ---------------------------------------------------------- IB-02 form rotation across starts
  suite('IB-02 intro forms: rotation never repeats a form within 3 starts');
  {
    resetLocalStorage();
    const forms = [];
    for (let n = 0; n < 6; n += 1) {
      // The callback asset is cleared per start: this suite
      // isolates the ROTATION (the callback holds priority
      // outside it and is exercised in IB-03).
      localStorage.removeItem('leo_callback_next');
      const world = makeWorld(Tour, {
        candidates: [makeCandidate('Balboa Park')],
        library: ['Balboa Park'],
      });
      const audio = new FakeAudio(world.clock, okPolicy());
      const tour = await startAt(world, audio, UTC);
      await world.clock.advance(60_000);
      const primaries = world.eventsOf('opener_clip').filter(e => e.payload.segment === 'primary' || e.payload.segment === 'none');
      check(`start ${n + 1}: exactly one opener form served`, primaries.length === 1, JSON.stringify(world.eventsOf('opener_clip').map(e => e.payload)));
      if (primaries.length === 1) forms.push(primaries[0].payload.form);
      check(`start ${n + 1}: the welcome still sounds`, world.eventsOf('story_played').some(e => typeof e.payload.subject === 'string' && e.payload.subject.startsWith('welcome:')));
      tour.endTour();
    }
    let rotationOk = forms.length === 6;
    for (let i = 0; i + 2 < forms.length; i += 1) {
      const window3 = forms.slice(i, i + 3);
      if (new Set(window3).size !== 3) rotationOk = false;
    }
    check('no form repeats within any 3 consecutive starts', rotationOk, forms.join(','));
    check('forms carry the axis + rung telemetry', forms.every(f => typeof f === 'string' && f.length > 0), forms.join(','));
  }

  // ---------------------------------------------------------- IB-03 callback: closeout → next start
  suite('IB-03 intro forms: callback pre-rendered at closeout, spent once at the next start');
  {
    resetLocalStorage();
    const world1 = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
    });
    const audio1 = new FakeAudio(world1.clock, okPolicy());
    const tour1 = await startAt(world1, audio1, UTC);
    await world1.clock.advance(60_000);
    const cacheBeforeEnd = new Set(world1.cache.keys());
    tour1.endTour();
    await world1.clock.advance(5_000); // the closeout pre-render lands
    const raw = localStorage.getItem('leo_callback_next');
    const asset = raw ? JSON.parse(raw) : null;
    check('closeout wrote a callback asset', asset !== null && typeof asset.text === 'string', raw ?? 'null');
    check('the callback line speaks only recorded facts (area + last story)',
      asset !== null && asset.text.includes('University City') && asset.text.includes('Balboa Park'), asset?.text ?? 'null');
    const newSynthKeys = [...world1.cache.keys()].filter(k => k.startsWith('synth-') && !cacheBeforeEnd.has(k));
    check('the callback clip was pre-rendered into the audio cache at closeout',
      newSynthKeys.length >= 1, JSON.stringify(newSynthKeys));

    const world2 = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
    });
    const audio2 = new FakeAudio(world2.clock, okPolicy());
    const tour2 = await startAt(world2, audio2, UTC);
    const runs2 = watchKinds(world2, tour2);
    await world2.clock.advance(60_000);
    const cb = world2.eventsOf('opener_clip').filter(e => e.payload.form === 'callback');
    check('the next start serves the callback form', cb.length === 1 && cb[0].payload.opener_id === 'callback-next' && cb[0].payload.sounded === true,
      JSON.stringify(world2.eventsOf('opener_clip').map(e => e.payload)));
    const seq2 = kindSeq(runs2);
    check('order preserved: greeting → callback opener → welcome', seq2[0] === 'greeting' && seq2[1] === 'opener' && seq2[2] === 'story', seq2.join(','));
    check('the asset is spent once — gone after the start that used it', localStorage.getItem('leo_callback_next') === null);
    tour2.endTour();
  }

  // ---------------------------------------------------------- IB-04 hook-question: served / late-discarded
  suite('IB-04 intro forms: hook-question races its slot — served when ready, discarded when late');
  {
    resetLocalStorage();
    const realRandom = Math.random;
    Math.random = () => 0.99; // standard greeting axis; the pool's last entry is the hook
    try {
      const world = makeWorld(Tour, {
        candidates: [makeCandidate('Balboa Park')],
        library: ['Balboa Park'],
        genStoryBehavior: prompt =>
          prompt.includes('HOOK QUESTION')
            ? 'Why does the old ferry landing still lean toward the bay?'
            : 'A generated story about the road ahead, told with care and local color. '.repeat(3),
      });
      const audio = new FakeAudio(world.clock, okPolicy());
      const tour = await startAt(world, audio, UTC);
      await world.clock.advance(60_000);
      const hooks = world.eventsOf('opener_clip').filter(e => e.payload.form === 'hook-question');
      check('a ready hook serves as the primary opener', hooks.length === 1 && hooks[0].payload.segment === 'primary' && hooks[0].payload.sounded === true,
        JSON.stringify(world.eventsOf('opener_clip').map(e => e.payload)));
      check('the hook was commissioned from the welcome fact pack', world.genStoryPrompts.some(p => p.includes('HOOK QUESTION') && p.includes('FACT PACK')));
      tour.endTour();
    } finally {
      Math.random = realRandom;
    }

    resetLocalStorage();
    Math.random = () => 0.99;
    try {
      const world = makeWorld(Tour, {
        candidates: [makeCandidate('Balboa Park')],
        library: ['Balboa Park'],
        genStoryBehavior: prompt =>
          prompt.includes('HOOK QUESTION')
            ? new Promise(() => {}) // the hook never lands inside its slot
            : 'A generated story about the road ahead, told with care and local color. '.repeat(3),
      });
      const audio = new FakeAudio(world.clock, okPolicy());
      const tour = await startAt(world, audio, UTC);
      await world.clock.advance(90_000);
      const clips = world.eventsOf('opener_clip');
      check('a late hook is discarded — never served', !clips.some(e => e.payload.form === 'hook-question'), JSON.stringify(clips.map(e => e.payload)));
      const fb = clips.filter(e => e.payload.segment === 'primary');
      check('the displaced bank clip serves one rung down (hook-late)', fb.length === 1 && fb[0].payload.form === 'wandering' && fb[0].payload.fallback_rung === 'hook-late' && fb[0].payload.sounded === true,
        JSON.stringify(clips.map(e => e.payload)));
      check('the welcome still sounds behind the degraded opener', world.eventsOf('story_played').some(e => typeof e.payload.subject === 'string' && e.payload.subject.startsWith('welcome:')));
      tour.endTour();
    } finally {
      Math.random = realRandom;
    }
  }

  // ---------------------------------------------------------- IB-05 greeting-only (R2)
  suite('IB-05 intro forms: greeting-only start — regular, every form on cooldown');
  {
    resetLocalStorage();
    localStorage.setItem('leo_intro_form_history', JSON.stringify(['callback', 'plain', 'wandering', 'regulars-short']));
    localStorage.setItem('leo_last_tour_start_at', JSON.stringify(Date.now() - 3600_000));
    const realRandom = Math.random;
    Math.random = () => 0.99; // standard greeting axis (no day-aware in the pool)
    try {
      const world = makeWorld(Tour, {
        candidates: [makeCandidate('Balboa Park')],
        library: ['Balboa Park'],
        genStoryBehavior: prompt => {
          if (prompt.includes('HOOK QUESTION')) throw new Error('hook generation down');
          return 'A generated story about the road ahead, told with care and local color. '.repeat(3);
        },
      });
      const audio = new FakeAudio(world.clock, okPolicy());
      const tour = await startAt(world, audio, UTC);
      const runs = watchKinds(world, tour);
      await world.clock.advance(60_000);
      const clips = world.eventsOf('opener_clip');
      check('greeting-only files its opener_clip record (segment none)', clips.length === 1 && clips[0].payload.segment === 'none' && clips[0].payload.form === 'greeting-only',
        JSON.stringify(clips.map(e => e.payload)));
      const seq = kindSeq(runs);
      check('no opener sounds: greeting → welcome directly', seq[0] === 'greeting' && seq[1] === 'story' && !seq.includes('opener'), seq.join(','));
      tour.endTour();
    } finally {
      Math.random = realRandom;
    }
  }

  // ---------------------------------------------------------- IB-06 freeform planned silence (R1)
  suite('IB-06 planned silence: freeform corridor beat — guarded, telemetered, filler stands down');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park'), makeCandidate('North Park'), makeCandidate('Coronado'), makeCandidate('Ocean Beach')],
      library: ['Balboa Park', 'North Park', 'Coronado', 'Ocean Beach'],
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC, 25); // freeway speed: a corridor stretch
    const runs = watchKinds(world, tour);
    for (let n = 0; n < 10; n += 1) {
      tour.onPosition({ lat: UTC.lat + 0.004 * (n + 1), lng: UTC.lng, speedMps: 25, headingDeg: 180 });
      await world.clock.advance(20_000);
    }
    const silences = world.eventsOf('planned_silence').filter(e => e.payload.mode === 'freeform');
    check('a planned silence sounded on the corridor stretch', silences.length >= 1, `count=${silences.length}`);
    check('the beat is the composed 3 s (R1 limit)', silences.every(e => e.payload.duration_s === 3), JSON.stringify(silences.map(e => e.payload)));
    const firstSilence = runs.find(r => r.kind === 'silence');
    check('never in the first 60 s', firstSilence !== undefined && firstSilence.at >= 60_000, `at=${firstSilence?.at}`);
    check('the beat occupies the slot as a silence item', firstSilence !== undefined, JSON.stringify(runs.slice(0, 12)));
    check('at most 3 beats in the tour', silences.length <= 3, `count=${silences.length}`);
    tour.endTour();
  }

  // ---------------------------------------------------------- IB-07 route breath vs planned silence
  suite('IB-07 planned silence: the produced breath never stacks on a silence');
  {
    const breath = routeInterItemGapMs({
      closing: false,
      lastSettled: { sounded: true, skipped: false, planItem: true },
      next: { planItem: true, expireProgress: null, departure: false },
      lastProgress: 0.2,
      progressPerSec: null,
    });
    const intoSilence = routeInterItemGapMs({
      closing: false,
      lastSettled: { sounded: true, skipped: false, planItem: true },
      next: { planItem: true, expireProgress: null, departure: false, silence: true },
      lastProgress: 0.2,
      progressPerSec: null,
    });
    const outOfSilence = routeInterItemGapMs({
      closing: false,
      lastSettled: { sounded: true, skipped: false, planItem: true, silence: true },
      next: { planItem: true, expireProgress: null, departure: false },
      lastProgress: 0.2,
      progressPerSec: null,
    });
    check('a back-to-back plan transition breathes (700 ms)', breath === 700, `breath=${breath}`);
    check('into a silence: standing gap only — the silence is the beat', intoSilence === 600, `gap=${intoSilence}`);
    check('out of a silence: standing gap only', outOfSilence === 600, `gap=${outOfSilence}`);
  }
}
