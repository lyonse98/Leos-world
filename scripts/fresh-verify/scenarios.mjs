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
  const { CORRIDOR_SEGMENTS, matchCorridor, resolveFillerRegion } = extras;

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
    world.synthBehavior = () =>
      new Promise(res => world.clock.setTimeout(() => res(new Blob(['voice'])), 5_000));
    const audio = new FakeAudio(world.clock, okPolicy({ synth: 8_000 }));
    const { tour } = await healthyOpening(world, audio);
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
    check('the shelf intro was never consulted for the heard area',
      !world.introFetches.includes('Clairemont'), world.introFetches.join(','));
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
    check('the shelf intro was never consulted for the heard area',
      !world.introFetches.includes('Clairemont'), world.introFetches.join(','));
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
}
