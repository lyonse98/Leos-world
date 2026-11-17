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
  const { CORRIDOR_SEGMENTS, CORRIDOR_BUFFER_M, matchCorridor, resolveFillerRegion, accessGate, ambience, intro, routeInterItemGapMs, profile, profileRank, facts, partners, freshness, currentEvents, suggestions, proposals, placeMemory, liveSpend, composeRoutePlan, hashString } = extras;

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

  // ---------------------------------------------------------- CF-1 corridor anchor (fix 1, Nov 14, 2026)
  // The 'fresher' displacement test measures a newcomer from its
  // anchor. A corridor item used to anchor at its segment's ENTRY:
  // mid-segment that reads 1–3 km stale, so a corridor story the
  // driver is physically ON lost to nearly any nearby waiter (the
  // I-8 / SR-163 shutout's mechanism #3). The item now anchors at
  // the driver's nearest point on the segment. This fixture holds
  // every other fresher input fixed — the waiter is ~500 m away
  // and was minted seconds before the corridor item, so the
  // recency clause cannot decide it — and shows the SAME fixture
  // flipping on the anchor alone: the entry-anchor arithmetic
  // provably fails the test the shipped behaviour passes.
  suite('CF-1 corridor anchor: mid-segment fresher displacement');
  {
    resetLocalStorage();
    const MPD_LAT = 111_320;
    const mpdLng = lat => MPD_LAT * Math.cos((lat * Math.PI) / 180);
    const distM = (a, b) => Math.hypot((b.lat - a.lat) * MPD_LAT, (b.lng - a.lng) * mpdLng(a.lat));
    const segLen = s => s.polyline.reduce((acc, p, i) => (i === 0 ? 0 : acc + distM(p, s.polyline[i - 1])), 0);
    const seg = CORRIDOR_SEGMENTS.filter(s => segLen(s) > 4000).reduce((a, b) => (segLen(a) > segLen(b) ? a : b));
    // The point at ~50% along-track, with its leg's bearing.
    const alongPoint = (s, frac) => {
      const total = segLen(s);
      let acc = 0;
      for (let i = 1; i < s.polyline.length; i++) {
        const a = s.polyline[i - 1];
        const b = s.polyline[i];
        const leg = distM(b, a);
        if (acc + leg >= total * frac) {
          const t = (total * frac - acc) / leg;
          return {
            lat: a.lat + (b.lat - a.lat) * t,
            lng: a.lng + (b.lng - a.lng) * t,
            heading: ((Math.atan2((b.lng - a.lng) * mpdLng(a.lat), (b.lat - a.lat) * MPD_LAT) * 180) / Math.PI + 360) % 360,
          };
        }
        acc += leg;
      }
      const last = s.polyline[s.polyline.length - 1];
      return { lat: last.lat, lng: last.lng, heading: 180 };
    };
    const mid = alongPoint(seg, 0.5);
    // The waiter: a shelf story anchored 500 m east of the mid point.
    const waiterPos = { lat: mid.lat, lng: mid.lng + 500 / mpdLng(mid.lat) };
    const dnOld = distM(mid, seg.polyline[0]);
    const dw = distM(mid, waiterPos);
    check('fixture: the entry anchor loses the fresher distance test', dnOld + 150 >= dw, `dnOld=${Math.round(dnOld)} dw=${Math.round(dw)}`);
    check('fixture: a nearest-point anchor (~0 m) wins it', 150 < dw, `dw=${Math.round(dw)}`);

    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park', { lat: seg.polyline[0].lat, lng: seg.polyline[0].lng, distanceM: 100 })],
      library: [
        { name: 'Alpha Park', lat: seg.polyline[0].lat, lng: seg.polyline[0].lng },
        seg.displayName,
        { name: 'Waiter Place', lat: waiterPos.lat, lng: waiterPos.lng },
      ],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 90_000 }));
    const tour = await startAt(world, audio, seg.polyline[0], 8, mid.heading);
    const soundedLabels = watchLabels(world, tour);
    await world.clock.advance(40_000); // greeting + opener + welcome; Alpha playing (90 s)
    // Slot the waiter behind Alpha: the driver waits at the
    // waiter's own anchor, 500 m off the segment — outside the
    // corridor buffer, so no corridor trigger fires while it mints.
    world.candidates = [makeCandidate('Waiter Place', { lat: waiterPos.lat, lng: waiterPos.lng, distanceM: 60 })];
    tour.onPosition({ lat: waiterPos.lat, lng: waiterPos.lng, speedMps: 8, headingDeg: mid.heading });
    await world.clock.advance(3_000);
    const committed1 = world.eventsOf('story_played').map(e => e.payload.subject);
    check('waiter slotted behind the playing story', committed1.includes('waiter place'), committed1.join(','));
    // Step onto the segment at its midpoint at freeway speed: the
    // corridor trigger fires and the offer meets the waiter.
    tour.onPosition({ lat: mid.lat, lng: mid.lng, speedMps: 27, headingDeg: mid.heading });
    await world.clock.advance(3_000);
    const drops = world.eventsOf('story_dropped');
    // Nov 15, 2026 (speed-regime priority): at 27 m/s this
    // offer is priority-class, so the displacement now files
    // as displaced-priority — the anchor arithmetic above is
    // still the fixture's math, and FP-6b re-proves the
    // fresher/anchor path behaviorally below the regime line,
    // where the offer is judged exactly as it was when this
    // suite was written.
    check('corridor item displaces the waiter (displaced-priority at speed)', drops.some(d => d.payload.reason === 'displaced-priority'), JSON.stringify(drops.map(d => d.payload)));
    const committed2 = world.eventsOf('story_played');
    const corridorCommit = committed2.find(e => e.payload.subject === `corridor:${seg.id}`);
    check('corridor story committed', Boolean(corridorCommit), committed2.map(e => e.payload.subject).join(','));
    const waiterCommit = committed2.find(e => e.payload.subject === 'waiter place');
    check(
      'recency could not have decided it (mints <30 s apart)',
      Boolean(waiterCommit && corridorCommit) && corridorCommit.at - waiterCommit.at < 30_000,
      `gap=${corridorCommit && waiterCommit ? corridorCommit.at - waiterCommit.at : 'n/a'}`,
    );
    await world.clock.advance(120_000); // Alpha ends; the corridor story sounds
    check('corridor story sounds after the playing story', soundedLabels.includes(seg.displayName), soundedLabels.join(','));
    check('displaced waiter never sounded', !soundedLabels.includes('Waiter Place'), soundedLabels.join(','));
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
      // The parent's intro is pinned on the parent's own entry
      // ground (+0.008, where this drive enters University
      // City), NOT at the shared default point: the Nov 16,
      // 2026 Day-12 correction judges a shelf welcome by
      // duration × speed from its pin, and the old fixture
      // conflated the child anchor and the parent pin at one
      // point — at maturity the driver is ~1,336 m from that
      // point, beyond a ~148 s telling's reach at 8 m/s
      // (~1,181 m), so the reach gate discharged a welcome the
      // deferral doctrine exists to serve. The deferral's
      // geometry is distance-from-CHILD (the nesting radius);
      // the parent pin belongs on parent ground. (The sharp
      // edge is real and recorded in the Day-12 report: a
      // production parent pin sitting on the child's ground
      // would expose the same discharge at surface pace.)
      intros: ['Costa Verde', { name: 'University City', lat: UTC.lat + 0.008, lng: UTC.lng }],
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

  // (Fixture renamed Nov 14, 2026: the subject was "Munk
  // House" — under portal-or-nothing a house-named live
  // subject with no unheard payload in range must NOT
  // generate at all, which is a different suite's claim
  // (HP-4). The salvage mechanics tested here are
  // name-independent.)
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
    // Alpha (30 s) is playing. The Munk Observatory story generates and
    // slots behind it.
    world.candidates = [makeCandidate('Munk Observatory', { lat: UTC.lat, lng: UTC.lng })];
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(2_000);
    check('the live story was generated once',
      promptsFor(world, 'Munk Observatory').length === 1, `prompts=${promptsFor(world, 'Munk Observatory').length}`);
    // Teleport 3 km north, heading away: at dequeue the judge
    // drops the story stale-behind, unheard.
    tour.onPosition({ lat: UTC.lat + 0.033, lng: UTC.lng, speedMps: 8, headingDeg: 0 });
    await world.clock.advance(45_000);
    check('the story was judge-dropped stale-behind',
      dropsFor(world, 'munk observatory').some(d => d.payload.reason === 'stale-behind'),
      JSON.stringify(dropsFor(world, 'munk observatory').map(d => d.payload)));
    check('the dropped story never sounded', !labels.includes('Munk Observatory'), labels.join(','));
    check('the dropped subject is not in the heard set',
      !world.heard.includes('Munk Observatory'), world.heard.join(' | '));
    // Re-approach the anchor: the banked text serves — no second
    // generation spend.
    tour.onPosition({ lat: UTC.lat + 0.001, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(30_000);
    check('no second generation on re-approach',
      promptsFor(world, 'Munk Observatory').length === 1, `prompts=${promptsFor(world, 'Munk Observatory').length}`);
    check('the salvaged story sounds on re-approach',
      playbacksFor(world, 'munk observatory').some(e => e.payload.sounded === true),
      JSON.stringify(playbacksFor(world, 'munk observatory').map(e => e.payload)));
    check('the subject joins the heard set only once it sounds',
      world.heard.includes('Munk Observatory'), world.heard.join(' | '));
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

  // (Fixture renamed Nov 14, 2026: the subject was "Fragile
  // House" — under portal-or-nothing its re-serve past the
  // rest radius would need an unheard payload, and its only
  // shelf neighbor is spent by then, so the recovery this
  // suite tests could never happen. The rest-radius
  // mechanics are name-independent.)
  suite('AF-1 an attempts-exhausted drop rests the subject until the driver moves on');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Fragile Tower'), makeCandidate('Steady Park')],
      library: ['Fragile Tower', 'Steady Park'],
    });
    let failFragile = true;
    const audio = new FakeAudio(world.clock, ({ cls, src }) =>
      failFragile && cls === 'library' && typeof src === 'string' && src.includes('fragile-tower')
        ? { action: 'reject', name: 'NotSupportedError' }
        : { action: 'ok', durationMs: DUR[cls] ?? 5000 });
    const { tour } = await healthyOpening(world, audio);
    await world.clock.advance(30_000);
    check('the failing story dropped attempts-exhausted',
      dropsFor(world, 'fragile tower').some(d => d.payload.reason === 'attempts-exhausted'),
      JSON.stringify(dropsFor(world, 'fragile tower').map(d => d.payload)));
    check('the rested subject was committed exactly once at this spot',
      world.eventsOf('story_played').filter(e => e.payload.subject === 'fragile tower').length === 1,
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    check('the other candidate served in its place',
      playbacksFor(world, 'steady park').some(e => e.payload.sounded === true),
      JSON.stringify(playbacksFor(world, 'steady park').map(e => e.payload)));
    check('the failed subject is not heard-filed',
      !world.heard.includes('Fragile Tower'), world.heard.join(' | '));
    // A nudge that triggers serve cycles but stays inside the
    // 250 m rest radius: the subject must remain rested.
    tour.onPosition({ lat: UTC.lat + 0.002, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(30_000);
    check('still rested after in-radius serve cycles',
      world.eventsOf('story_played').filter(e => e.payload.subject === 'fragile tower').length === 1,
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    // Beyond the radius, with the failure gone, the subject is
    // eligible again and lands.
    failFragile = false;
    tour.onPosition({ lat: UTC.lat + 0.005, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(60_000);
    check('past the radius the subject serves again',
      world.eventsOf('story_played').filter(e => e.payload.subject === 'fragile tower').length === 2,
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    check('the recovered serve sounds to completion',
      playbacksFor(world, 'fragile tower').some(e => e.payload.sounded === true),
      JSON.stringify(playbacksFor(world, 'fragile tower').map(e => e.payload)));
    check('the subject is heard-filed only after it sounds',
      world.heard.includes('Fragile Tower'), world.heard.join(' | '));
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

  suite('A5 fit gate scope: shelf welcome judged by the same reach as a live one — inside it at this geometry; opening doctrine unchanged');
  {
    // The A3 geometry with a SHELF welcome: it waits behind the
    // same 60 s story at the same 21.6 m/s and is judged >1 km
    // from its pin — and sounds. As built in Nov 2 the doctrine
    // was exemption ("a shelf welcome is instant and anchored;
    // the fit gate binds live generation only"); Nov 16, 2026
    // (Day-12 correction) replaced exemption with ONE reach
    // geometry for every welcome: this fixture's ~136 s telling
    // at 21.6 m/s reaches ~2,940 m, so the welcome is judged by
    // the same test that discharges a live one and is inside
    // it. (391e470's flat 1,600 m cut would also have passed
    // it; D12-1/D12-4 pin where the two rules differ.) The
    // intro is pinned at the entry point, on the driven
    // ground, so this fixture judges the welcome inside its
    // reach.
    resetLocalStorage();
    const LJ = { lat: 32.85, lng: -117.25 };
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park', { lat: LJ.lat, lng: LJ.lng })],
      library: [{ name: 'Alpha Park', lat: LJ.lat, lng: LJ.lng }],
      intros: [{ name: 'Clairemont', lat: LJ.lat + 0.01, lng: LJ.lng }],
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
    check('the staleness gate never fired (inside its reach)',
      world.eventsOf('welcome_stale_dropped').length === 0,
      JSON.stringify(world.eventsOf('welcome_stale_dropped').map(e => e.payload)));
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
    // Scope pin for the Day-12 correction's pierce (Nov 16,
    // 2026): production constructs reserved:true at exactly
    // two sites, both welcomes (the live item and the shelf
    // item in tour.ts), so no non-welcome reserved item exists
    // to simulate — the pierce is keyed on the welcome subject
    // and the non-passby framing, and this reserved item,
    // sounding ~5 km past its anchor under the pass-by
    // framing, is the constructible proof that the reserved
    // exemption still governs everything the pierce does not
    // name: the staleness arm never fired on it.
    check('the staleness pierce never fired on the reserved pass-by item',
      world.eventsOf('welcome_stale_dropped').length === 0,
      JSON.stringify(world.eventsOf('welcome_stale_dropped').map(e => e.payload)));
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
      // The intro is pinned on the driven ground, inside its
      // reach when it sounds (Nov 16, 2026, Day-12 correction:
      // a shelf welcome is judged by duration × speed — this
      // ~136 s telling at 29.8 m/s reaches ~4,060 m — and
      // beyond reach it meets the staleness gate, D12-1;
      // conversion was never its risk, and still is not).
      intros: [{ name: 'Clairemont', lat: LJ.lat + 0.018, lng: LJ.lng }],
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

  // ---------------------------------------------------------- SCF: short cuts (Nov 12, 2026)
  // A base angle's second LENGTH rides the shelf as angle +
  // ' (short cut)'. Freeform's version rule is the route
  // doctrine's freeform form ("density sets the cut"): the
  // cut serves when the ground inside the serve radius is
  // dense (≥6 canonical stories, twins deduped to their
  // base); sparse ground serves the full version. The two
  // lengths are ONE story: the rotation never picks a twin
  // as an angle, and dealing either deals both.

  suite('SCF-1 short cuts: dense ground serves the cut; the retell is generated — never the other length');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Cut Place', { tier1: true })],
      library: [
        { name: 'Cut Place', angles: ['landmark_origin', 'landmark_origin (short cut)'] },
        // Five more canonical stories banked at the same
        // spot: with Cut Place's pair deduped to one story,
        // the serve radius holds 6 canonical stories —
        // dense by the freeform line. Only Cut Place is a
        // candidate, so the neighbors never serve; they are
        // pure density.
        ...['Dense One', 'Dense Two', 'Dense Three', 'Dense Four', 'Dense Five'].map(name => ({
          name,
          angles: ['landmark_origin'],
        })),
      ],
    });
    // Starve prefetch so both tellings resolve at serve time (P4's discipline).
    world.seams.discoverCandidates = async pt =>
      Math.abs(pt.lat - UTC.lat) < 0.0001 && Math.abs(pt.lng - UTC.lng) < 0.0001
        ? world.candidates
        : [];
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);
    const tellings = () =>
      world.eventsOf('story_played').filter(e => e.payload.subject === 'cut place');
    for (let i = 0; i < 80 && tellings().length < 2; i++) await world.clock.advance(5_000);
    const t = tellings();
    check('the place was told twice (cut + in-tour retell)', t.length === 2, `n=${t.length}`);
    check('first telling is the SHORT CUT',
      t[0]?.payload.source === 'library' && t[0]?.payload.angle === 'landmark_origin (short cut)',
      JSON.stringify(t[0]?.payload));
    check('the cut audio is what played',
      audio.log.some(e => typeof e.src === 'string' && e.src.includes('landmark_origin (short cut)')),
      JSON.stringify(audio.log.map(e => e.src)));
    check('second telling is generated live, not the full version',
      t[1]?.payload.source === 'live' && t[1]?.payload.angle === null,
      JSON.stringify(t[1]?.payload));
    check('the full version never played',
      !audio.log.some(e => typeof e.src === 'string' && e.src.endsWith('library/cut-place/landmark_origin.wav')),
      JSON.stringify(audio.log.map(e => e.src)));
    tour.endTour();
  }

  suite('SCF-2 short cuts: sparse ground serves the full version');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Cut Place', { tier1: true })],
      library: [{ name: 'Cut Place', angles: ['landmark_origin', 'landmark_origin (short cut)'] }],
    });
    world.seams.discoverCandidates = async pt =>
      Math.abs(pt.lat - UTC.lat) < 0.0001 && Math.abs(pt.lng - UTC.lng) < 0.0001
        ? world.candidates
        : [];
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);
    const tellings = () =>
      world.eventsOf('story_played').filter(e => e.payload.subject === 'cut place');
    for (let i = 0; i < 80 && tellings().length < 1; i++) await world.clock.advance(5_000);
    const t = tellings();
    check('the place was told', t.length >= 1, `n=${t.length}`);
    check('the telling is the FULL version (one canonical story in radius is sparse)',
      t[0]?.payload.source === 'library' && t[0]?.payload.angle === 'landmark_origin',
      JSON.stringify(t[0]?.payload));
    check('the cut audio never played',
      !audio.log.some(e => typeof e.src === 'string' && e.src.includes('(short cut)')),
      JSON.stringify(audio.log.map(e => e.src)));
    tour.endTour();
  }

  suite('SCF-3 short cuts: a corridor serve takes the full original even when the twin sorts first in the index');
  {
    resetLocalStorage();
    // WT-2's segment discipline, verbatim.
    const segLen = s =>
      s.polyline.reduce((acc, p, i) => (i === 0 ? 0 : acc + Math.hypot((p.lat - s.polyline[i - 1].lat) * 111_320, (p.lng - s.polyline[i - 1].lng) * 88_000)), 0);
    const picked = CORRIDOR_SEGMENTS.filter(s => segLen(s) > 4000).reduce((a, b) => (segLen(a) > segLen(b) ? a : b));
    const start = picked.polyline[0];
    const second = picked.polyline[1];
    const pickedHeading = ((Math.atan2(second.lng - start.lng, second.lat - start.lat) * 180) / Math.PI + 360) % 360;
    const seg = matchCorridor({ lat: start.lat, lng: start.lng, heading: pickedHeading })?.segment ?? picked;
    const world = makeWorld(Tour, {
      candidates: [],
      // The twin row FIRST in the index: the corridor lane
      // makes no version decision — it serves the presence
      // original at full length, on its angle, not its
      // position.
      library: [{ name: seg.displayName, angles: ['corridor (short cut)', 'corridor'] }],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ synth: 30_000 }));
    const tour = world.makeTour(audio);
    tour.onPosition({ lat: start.lat, lng: start.lng, speedMps: 27, headingDeg: pickedHeading });
    tour.start(false);
    await world.clock.advance(20_000); // greeting + opener done; welcome (30 s) playing
    tour.onPosition({ lat: start.lat, lng: start.lng, speedMps: 27, headingDeg: pickedHeading });
    for (let i = 0; i < 24 && audio.plays('library').length === 0; i++) await world.clock.advance(5_000);
    const libPlays = audio.plays('library');
    check('the corridor story served from the shelf', libPlays.length >= 1, JSON.stringify(audio.log.map(e => e.src)));
    check('the corridor ORIGINAL is what played',
      libPlays.some(e => typeof e.src === 'string' && e.src.endsWith('/corridor.wav')),
      JSON.stringify(libPlays.map(e => e.src)));
    check('the twin audio never played',
      !audio.log.some(e => typeof e.src === 'string' && e.src.includes('(short cut)')),
      JSON.stringify(audio.log.map(e => e.src)));
    tour.endTour();
  }

  // ---------------------------------------------------------- HP: houses are portal-or-nothing (Erik's ruling, Nov 14, 2026)
  // Day 10's afternoon session served Alice Lee Residence
  // (library) and A.H. Sweet Residences (live) back-to-back —
  // F1's demotion never governed the serve decision. The rule
  // now does: a house candidate serves ONLY when an unheard,
  // non-house shelf story the linkage ties to it (subject
  // link, or its own ground within 1,000 m) is in serve range,
  // and that payload is then queued immediately after it via
  // the portal obligation. No payload → no serve, in every
  // lane (library, live, cache, prefetch).
  const storySubjects = world =>
    world
      .eventsOf('story_played')
      .map(e => e.payload.subject)
      .filter(
        s =>
          typeof s === 'string' &&
          !s.startsWith('welcome:') &&
          !s.startsWith('area:') &&
          !s.startsWith('corridor:'),
      );
  const starvePrefetch = world => {
    world.seams.discoverCandidates = async pt =>
      Math.abs(pt.lat - UTC.lat) < 0.0001 && Math.abs(pt.lng - UTC.lng) < 0.0001
        ? world.candidates
        : [];
  };

  suite('HP-1 portal-or-nothing: a house with a payload serves, and the payload is the very next story');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Gill House'), makeCandidate('Grand Museum')],
      library: [
        { name: 'Gill House', angles: ['landmark_origin'] },
        { name: 'Grand Museum', angles: ['landmark_origin'] },
      ],
    });
    starvePrefetch(world);
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);
    for (let i = 0; i < 80 && storySubjects(world).length < 2; i++) await world.clock.advance(5_000);
    await world.clock.advance(45_000); // let both stories actually sound (15 s apiece)
    const subjects = storySubjects(world);
    check('the house served (a payload stands on its ground)', subjects.includes('gill house'),
      JSON.stringify(subjects));
    check('the payload sounds immediately after the house — no story between them',
      subjects.indexOf('gill house') >= 0 && subjects.indexOf('grand museum') === subjects.indexOf('gill house') + 1,
      JSON.stringify(subjects));
    check('the house audio is what played first of the pair',
      audio.plays('library').some(e => typeof e.src === 'string' && e.src.includes('library/gill-house/landmark_origin.wav')),
      JSON.stringify(audio.plays('library').map(e => e.src)));
    check('the payload audio played too',
      audio.plays('library').some(e => typeof e.src === 'string' && e.src.includes('library/grand-museum/landmark_origin.wav')),
      JSON.stringify(audio.plays('library').map(e => e.src)));
    tour.endTour();
  }

  suite('HP-2 portal-or-nothing: a house with no reachable payload does not serve; the slot goes to the next candidate');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Lonely House'), makeCandidate('Open Park')],
      // The house IS on the shelf — its absence from the tour
      // is the gate's doing, not a missing row. Nothing else
      // is on the shelf: no payload exists anywhere.
      library: [{ name: 'Lonely House', angles: ['landmark_origin'] }],
    });
    starvePrefetch(world);
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);
    for (let i = 0; i < 60 && !storySubjects(world).includes('open park'); i++) {
      await world.clock.advance(5_000);
    }
    await world.clock.advance(60_000); // room for the house to misbehave late
    check('the next eligible non-house candidate took the slot (live)',
      storySubjects(world).includes('open park'), JSON.stringify(storySubjects(world)));
    check('the house never committed',
      !world.eventsOf('story_played').some(e => e.payload.subject === 'lonely house'),
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    check('the house audio never played',
      !audio.log.some(e => typeof e.src === 'string' && e.src.includes('lonely-house')),
      JSON.stringify(audio.log.map(e => e.src)));
    tour.endTour();
  }

  suite('HP-3 portal-or-nothing: a house whose only payload is already heard (cross-day) does not serve');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Gill House'), makeCandidate('Other Place')],
      library: [
        { name: 'Gill House', angles: ['landmark_origin'] },
        { name: 'Grand Museum', angles: ['landmark_origin'] },
      ],
    });
    // The payload stands on the house's ground — but the
    // listener heard it on a previous day. A heard payload
    // is no payload: the follow-on cannot play, so the
    // house cannot either.
    world.seams.fetchHeardTopics = async () => ['Grand Museum'];
    starvePrefetch(world);
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);
    for (let i = 0; i < 60 && !storySubjects(world).includes('other place'); i++) {
      await world.clock.advance(5_000);
    }
    await world.clock.advance(60_000);
    check('the ordinary candidate served instead',
      storySubjects(world).includes('other place'), JSON.stringify(storySubjects(world)));
    check('the house never committed',
      !world.eventsOf('story_played').some(e => e.payload.subject === 'gill house'),
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    check('the heard payload never committed either',
      !world.eventsOf('story_played').some(e => e.payload.subject === 'grand museum'),
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    tour.endTour();
  }

  suite('HP-4 portal-or-nothing: the live lane refuses a house subject when portal conditions fail');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Spec House'), makeCandidate('Open Park')],
      library: [],
    });
    starvePrefetch(world);
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);
    for (let i = 0; i < 60 && !storySubjects(world).includes('open park'); i++) {
      await world.clock.advance(5_000);
    }
    await world.clock.advance(60_000);
    check('no generation was ever commissioned for the house',
      !world.genStoryPrompts.some(p => p.includes('Spec House')),
      JSON.stringify(world.genStoryPrompts.map(p => p.slice(0, 60))));
    check('the house never committed',
      !world.eventsOf('story_played').some(e => e.payload.subject === 'spec house'),
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    check('the non-house candidate generated and served live instead',
      world.eventsOf('story_played').some(e => e.payload.subject === 'open park' && e.payload.source === 'live'),
      JSON.stringify(world.eventsOf('story_played').map(e => [e.payload.subject, e.payload.source])));
    tour.endTour();
  }

  suite('HP-4b houses are shelf-only: a live house WITH a shelf payload no longer serves (Nov 16, 2026 — the Day-12 reversal of the A.H. Sweet license)');
  {
    // The Nov 14 license let a house with a payload mint a LIVE
    // telling. Day 12 (Nov 16) showed the cost: two live houses
    // generated in a drive's first minutes, displaced within
    // seconds — pure churn. Erik's ruling the same day: houses
    // are shelf-only. The portal gate still passes this house
    // (its payload stands on its ground); serveCandidate's live
    // lane is where the commission dies. Portal-or-nothing
    // continues to govern SHELF house serves (HP-1) unchanged.
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Spec House')],
      library: [{ name: 'Grand Museum', angles: ['landmark_origin'] }],
    });
    starvePrefetch(world);
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);
    for (let i = 0; i < 80; i++) await world.clock.advance(5_000);
    check('no generation was ever commissioned for the house (payload notwithstanding)',
      !world.genStoryPrompts.some(p => p.includes('Tell the story of Spec House')),
      JSON.stringify(world.genStoryPrompts.map(p => p.slice(0, 60))));
    check('the house never committed',
      !world.eventsOf('story_played').some(e => e.payload.subject === 'spec house'),
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    check('the payload never committed as a portal follow-on (no house serve, no obligation)',
      !world.eventsOf('story_played').some(e => e.payload.subject === 'grand museum'),
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    tour.endTour();
  }

  suite('HP-5 portal-or-nothing: back-to-back houses are impossible — the second house has no unheard payload left');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha House'), makeCandidate('Beta House')],
      library: [
        { name: 'Alpha House', angles: ['landmark_origin'] },
        { name: 'Beta House', angles: ['landmark_origin'] },
        { name: 'Grand Museum', angles: ['landmark_origin'] },
      ],
    });
    starvePrefetch(world);
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);
    for (let i = 0; i < 100 && storySubjects(world).length < 2; i++) await world.clock.advance(5_000);
    await world.clock.advance(60_000); // room for Beta to misbehave late
    check('the tour told exactly the house and its payload, in order',
      JSON.stringify(storySubjects(world)) === JSON.stringify(['alpha house', 'grand museum']),
      JSON.stringify(storySubjects(world)));
    check('the second house never committed',
      !world.eventsOf('story_played').some(e => e.payload.subject === 'beta house'),
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    check('the second house audio never played',
      !audio.log.some(e => typeof e.src === 'string' && e.src.includes('beta-house')),
      JSON.stringify(audio.log.map(e => e.src)));
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
  suite('IB-01 intro forms: daypart, rotation pool, hook validation');
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
    check('the rotation pool never contains the killed callback form',
      !intro.eligibleIntroForms(base).includes('callback') &&
      !intro.eligibleIntroForms({ ...base, regular: true, daypartGreeting: true }).includes('callback'));
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
    check('the killed callback form is never selected', !forms.includes('callback'), forms.join(','));
    check('forms carry the axis + rung telemetry', forms.every(f => typeof f === 'string' && f.length > 0), forms.join(','));
  }

  // ---------------------------------------------------------- IB-03 callback: KILLED (Nov 16, 2026)
  // Erik's Day-12 verdict on the recap opener: "a little weird…
  // I'd rather just start from fresh." The form is out of the
  // rotation, closeout no longer composes or pre-renders a
  // callback clip (no render spend on a form that can never
  // play), and an asset already sitting in a device's storage
  // is simply never selected — no migration, it just dies
  // unread. These checks pin all three.
  suite('IB-03 intro forms: callback killed — closeout commissions nothing, a planted asset is never selected');
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
    await world1.clock.advance(5_000); // any closeout commission would land here
    check('closeout wrote NO callback asset', localStorage.getItem('leo_callback_next') === null,
      localStorage.getItem('leo_callback_next') ?? 'null');
    const newCacheKeys = [...world1.cache.keys()].filter(k => !cacheBeforeEnd.has(k));
    check('closeout commissioned NO render (no new audio cache entries after end)',
      newCacheKeys.length === 0, JSON.stringify(newCacheKeys));

    // A device that still holds a fresh, valid asset from
    // before the kill: the next start ignores it entirely.
    localStorage.setItem('leo_callback_next', JSON.stringify({
      text: 'Welcome back. Last time out we were around University City, and Balboa Park was the story that stuck. Let\'s see what today\'s streets have got.',
      record: { areaName: 'University City', lastStoryLabel: 'Balboa Park', owedName: null, endedAt: Date.now() },
      createdAt: Date.now(),
    }));
    const world2 = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
    });
    const audio2 = new FakeAudio(world2.clock, okPolicy());
    const tour2 = await startAt(world2, audio2, UTC);
    const runs2 = watchKinds(world2, tour2);
    await world2.clock.advance(60_000);
    const clips2 = world2.eventsOf('opener_clip');
    check('opener_clip never reports the callback form',
      !clips2.some(e => e.payload.form === 'callback'),
      JSON.stringify(clips2.map(e => e.payload)));
    const primaries = clips2.filter(e => e.payload.segment === 'primary' || e.payload.segment === 'none');
    check('a rotation form (or the greeting-only floor) served instead',
      primaries.length === 1 && primaries[0].payload.form !== 'callback',
      JSON.stringify(clips2.map(e => e.payload)));
    const seq2 = kindSeq(runs2);
    check('order preserved: greeting → opener → welcome', seq2[0] === 'greeting' && seq2[1] === 'opener' && seq2[2] === 'story', seq2.join(','));
    check('the welcome still sounds (the start is fresh, not broken)',
      world2.eventsOf('story_played').some(e => typeof e.payload.subject === 'string' && e.payload.subject.startsWith('welcome:')));
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

  // ---------------------------------------------------------- CB corridor buffer
  // Buffer calibration (Nov 12, 2026 — Erik's Option A ruling after
  // the Harbor Drive field note; sim: scripts/route-mode/
  // corridor-buffer-sim.mjs). The buffer tightened 450 → 250 m:
  // at 450, ~62% of a Harbor Drive drive sat inside a northbound
  // I-5 segment's buffer and an I-5 story served on Harbor Drive.
  // 200 m was rejected on evidence: at a 200 m chord bulge / lateral
  // offset the on-freeway retention collapses (~49%), while at
  // 250 m every tested case retains exactly as at 450.
  suite('CB-01 corridor buffer: shipped value is the calibrated 250 m');
  {
    check('CORRIDOR_BUFFER_M is 250', CORRIDOR_BUFFER_M === 250, `buffer=${CORRIDOR_BUFFER_M}`);
  }
  suite('CB-02 corridor buffer: Harbor Drive no longer matches I-5 at 285 m cross-track');
  {
    // On the Harbor Drive alignment by the NBSD gate; the app's
    // I-5 North: National City to Barrio Logan polyline runs 285 m
    // east of this point, heading-compatible (Harbor heading ~338°,
    // segment bearing ~320°, inside the 50° tolerance). This is
    // Erik's Nov 12 serve geometry in miniature.
    const pt = { lat: 32.68555, lng: -117.13117, heading: 338 };
    const at450 = matchCorridor(pt, 450);
    check(
      'at the old 450 m buffer the point matched I-5 North: National City to Barrio Logan',
      at450?.segment.displayName === 'I-5 North: National City to Barrio Logan',
      `got ${at450?.segment.displayName ?? 'null'} @ ${at450?.distanceM?.toFixed(0)}m`,
    );
    const atShipped = matchCorridor(pt);
    check(
      'at the shipped buffer the point matches no I-5 segment',
      atShipped === null || atShipped.segment.freeway !== 'I-5',
      `got ${atShipped?.segment.displayName ?? 'null'}`,
    );
  }
  suite('CB-03 corridor buffer: interchange-proximity — a driver bulged off a stack-zone chord still matches');
  {
    // The longest stack-zone leg in the dataset: I-805 North,
    // Mission Valley to Kearny Mesa (2,737 m, through the SR-52
    // stack). Its midpoint displaced 175 m perpendicular — the
    // chord-bulge a driver on the true curve legitimately carries
    // there — must still match the segment at the shipped buffer.
    const seg = CORRIDOR_SEGMENTS.find(s => s.displayName === 'I-805 North: Mission Valley to Kearny Mesa');
    check('the named stack-zone segment exists', !!seg, 'I-805 North: Mission Valley to Kearny Mesa');
    const MLAT = 111_320;
    const mlng = la => MLAT * Math.cos((la * Math.PI) / 180);
    const dM = (a, b) => Math.hypot((b.lat - a.lat) * MLAT, (b.lng - a.lng) * mlng(a.lat));
    const bear = (a, b) => ((Math.atan2((b.lng - a.lng) * mlng(a.lat), (b.lat - a.lat) * MLAT) * 180) / Math.PI + 360) % 360;
    const off = (p, brg, m) => {
      const r = (brg * Math.PI) / 180;
      return { lat: p.lat + (m * Math.cos(r)) / MLAT, lng: p.lng + (m * Math.sin(r)) / mlng(p.lat) };
    };
    let leg = null;
    for (let i = 0; i < seg.polyline.length - 1; i++) {
      const L = dM(seg.polyline[i], seg.polyline[i + 1]);
      if (!leg || L > leg.L) leg = { a: seg.polyline[i], b: seg.polyline[i + 1], L };
    }
    const mid = { lat: (leg.a.lat + leg.b.lat) / 2, lng: (leg.a.lng + leg.b.lng) / 2 };
    const brg = bear(leg.a, leg.b);
    for (const side of [1, -1]) {
      const p = off(mid, brg + 90, side * 175);
      const m = matchCorridor({ lat: p.lat, lng: p.lng, heading: brg });
      check(
        `175 m bulge (side ${side > 0 ? '+' : '−'}) still matches I-805 northbound`,
        !!m && m.segment.freeway === 'I-805' && m.segment.direction === 'northbound',
        `got ${m?.segment.displayName ?? 'null'}`,
      );
    }
    // Boundary discipline at the same midpoint: 240 m retains the
    // segment itself; 260 m (beyond the shipped buffer) does not.
    const p240 = off(mid, brg + 90, 240);
    const m240 = matchCorridor({ lat: p240.lat, lng: p240.lng, heading: brg });
    check('240 m off-chord retains the segment itself', m240?.segment === seg, `got ${m240?.segment.displayName ?? 'null'}`);
    const p260 = off(mid, brg + 90, 260);
    const m260 = matchCorridor({ lat: p260.lat, lng: p260.lng, heading: brg });
    check('260 m off-chord no longer returns the segment', m260?.segment !== seg, `got ${m260?.segment.displayName ?? 'null'}`);
  }

  // ---------------------------------------------------------- PF user profile
  // The personalization tool (Nov 13, 2026): these suites drive
  // the SHIPPED default store (the harness's localStorage shim)
  // end to end — the pure-logic depth (decay clocks, inference
  // math, vocab filters) is proven in the route harness's PF
  // suites through the store seam.
  suite('PF-01 profile (shipped store): seed save persists to localStorage and reads back');
  {
    resetLocalStorage();
    check('a fresh device offers the seed card', profile.shouldOfferSeed() === true);
    profile.setDeclaredTaste('cuisines', ['seafood'], 'seed-card');
    profile.setDeclaredConstraint('alcoholOk', true, 'seed-card');
    profile.setSeedState('completed');
    check(
      'the profile document is in localStorage under its key',
      typeof localStorage.getItem(profile.PROFILE_STORAGE_KEY) === 'string',
    );
    const view = profile.getProfile();
    check('declared tastes read back', view.tastes.cuisines.join() === 'seafood', JSON.stringify(view.tastes));
    check('declared constraints read back', profile.getConstraints().alcoholOk === true);
    check('a completed seed is not re-offered', profile.shouldOfferSeed() === false);
  }
  suite('PF-02 profile (shipped store): inference lands through the default store; pause empties the reads');
  {
    resetLocalStorage();
    profile.observeThreadPick('Coast');
    profile.observeStoryOutcome({ topics: ['Coast'], completed: true, soundedMs: 60000 });
    const inputs = profile.matchInputs();
    check(
      'thread pick + completion surface as one inferred Coast weight',
      inputs.topics.length === 1 && inputs.topics[0].topic === 'Coast' && inputs.topics[0].source === 'inferred',
      JSON.stringify(inputs.topics),
    );
    profile.setPaused(true);
    check('paused match inputs are empty', profile.matchInputs().topics.length === 0);
    check('paused constraints are empty', profile.getConstraints().budgetComfort === null);
    profile.setPaused(false);
    check('resuming restores the reads', profile.matchInputs().topics.length === 1);
  }
  suite('PF-03 profile (shipped store): export → wipe → import round-trips; a tainted import is rejected');
  {
    resetLocalStorage();
    profile.setDeclaredTaste('activities', ['live-music', 'markets'], 'seed-card');
    const exported = profile.exportProfile();
    profile.wipeProfile();
    check('wipe clears the stored document', localStorage.getItem(profile.PROFILE_STORAGE_KEY) === null);
    check('the export imports', profile.importProfile(exported).ok === true);
    check(
      'values survive the round trip exactly',
      JSON.stringify(JSON.parse(profile.exportProfile())) === JSON.stringify(JSON.parse(exported)),
    );
    const tainted = JSON.stringify({ ...JSON.parse(exported), income: 120000 });
    check('an import carrying a forbidden key is rejected whole', profile.importProfile(tainted).ok === false);
    check(
      'the rejected import changed nothing',
      profile.getProfile().tastes.activities.join() === 'live-music,markets',
    );
  }

  // ---------------------------------------------------------- FP: the freeform priority package (Erik's ruling, Nov 15, 2026)
  // Three changes, one package:
  //  (1) Houses out of Tier-1 — discovery no longer lets a
  //      National Register listing confer Tier-1 on a
  //      house-class candidate; the curated destination-house
  //      exceptions (tier1HouseExceptions) keep it. The portal
  //      gate is unchanged: a house may still serve, as a
  //      portal — it just carries no tier privilege.
  //  (2) Speed-regime priority — at or above FREEWAY_MPS a
  //      corridor offer is priority-class against ordinary
  //      waiters, and a 'buffer' landing is retained one-deep
  //      (corridor-pending) for promotion at the next story
  //      transition, ahead of uncommitted Tier-1 pendings,
  //      while the driver is still on-segment at speed. Below
  //      the line the corridor lane is byte-identical to the
  //      Nov 5 ruling's shape. (Absorbs corridor fix 3.)
  //  (3) The welcome lane shares the serve cycle's
  //      density-sets-the-cut rule via versionedEntry: where
  //      an intro twin exists and the ground is dense, the
  //      cut is the welcome that serves.
  const fpMpdLat = 111_320;
  const fpMpdLng = lat => fpMpdLat * Math.cos((lat * Math.PI) / 180);
  const fpDistM = (a, b) => Math.hypot((b.lat - a.lat) * fpMpdLat, (b.lng - a.lng) * fpMpdLng(a.lat));
  const fpSegLen = s => s.polyline.reduce((acc, p, i) => (i === 0 ? 0 : acc + fpDistM(p, s.polyline[i - 1])), 0);
  // The longest real segment, resolved through the matcher
  // itself (overlapping segments share pavement — bank
  // whichever segment the matcher returns at the start point).
  const fpPickSeg = () => {
    const picked = CORRIDOR_SEGMENTS.filter(s => fpSegLen(s) > 4000).reduce((a, b) => (fpSegLen(a) > fpSegLen(b) ? a : b));
    const start = picked.polyline[0];
    const second = picked.polyline[1];
    const heading = ((Math.atan2((second.lng - start.lng) * fpMpdLng(start.lat), (second.lat - start.lat) * fpMpdLat) * 180) / Math.PI + 360) % 360;
    const seg = matchCorridor({ lat: start.lat, lng: start.lng, heading })?.segment ?? picked;
    return { seg, start: seg.polyline[0], heading };
  };
  const fpAlong = (s, frac) => {
    const total = fpSegLen(s);
    let acc = 0;
    for (let i = 1; i < s.polyline.length; i++) {
      const a = s.polyline[i - 1];
      const b = s.polyline[i];
      const leg = fpDistM(b, a);
      if (acc + leg >= total * frac) {
        const t = (total * frac - acc) / leg;
        return {
          lat: a.lat + (b.lat - a.lat) * t,
          lng: a.lng + (b.lng - a.lng) * t,
          heading: ((Math.atan2((b.lng - a.lng) * fpMpdLng(a.lat), (b.lat - a.lat) * fpMpdLat) * 180) / Math.PI + 360) % 360,
        };
      }
      acc += leg;
    }
    const last = s.polyline[s.polyline.length - 1];
    return { lat: last.lat, lng: last.lng, heading: 180 };
  };
  // Places is the one live-shaped seam inside discovery; stub
  // fetch so the suite makes zero network calls (the registry
  // half of discovery is bundled data and runs for real).
  const fpStubFetch = places => {
    const real = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ places }) });
    return () => {
      globalThis.fetch = real;
    };
  };
  const fpPlace = (name, lat, lng) => ({
    displayName: { text: name },
    location: { latitude: lat, longitude: lng },
    rating: 4.8,
    userRatingCount: 120,
    types: ['tourist_attraction'],
    formattedAddress: '1 Test Way',
  });

  suite('FP-1 houses out of Tier-1: a national house is not Tier-1 in discovery; a non-house national landmark still is');
  {
    resetLocalStorage();
    const restore = fpStubFetch([]);
    try {
      // Radius 100: Sweet's ground is isolated at that range
      // (the nearest other record is 102 m out), so the
      // candidate is Sweet's own, unfolded.
      const around = await facts.discoverCandidates({ lat: 32.738374, lng: -117.167262 }, 100);
      const sweet = around.find(c => c.name === 'A.H. Sweet Residences');
      check('the national house candidate is discovered', Boolean(sweet), around.map(c => c.name).join(','));
      check('A.H. Sweet Residences (national, house) is NOT Tier-1', sweet?.tier1 === false, `tier1=${sweet?.tier1}`);
      check('its registry record still rides the candidate (the boost path is untouched)', Boolean(sweet?.registry));
      // The Gaslamp cluster folds several national non-house
      // records onto one candidate; whichever name it carries,
      // that ground is Tier-1.
      const downtown = await facts.discoverCandidates({ lat: 32.714025, lng: -117.161348 }, 250);
      const theatre =
        downtown.find(c => c.registry?.name === 'Balboa Theatre') ??
        downtown.reduce((best, c) =>
          !best || fpDistM(c, { lat: 32.714025, lng: -117.161348 }) < fpDistM(best, { lat: 32.714025, lng: -117.161348 }) ? c : best, null);
      check('the non-house national landmark ground is discovered', Boolean(theatre), downtown.map(c => c.name).join(','));
      check('Balboa Theatre ground (national, not a house) is still Tier-1', theatre?.tier1 === true, `tier1=${theatre?.tier1}`);
    } finally {
      restore();
    }
  }

  suite('FP-2 houses out of Tier-1: the curated tour-importance exception keeps Tier-1 (both discovery paths)');
  {
    resetLocalStorage();
    const restore = fpStubFetch([]);
    try {
      // Radius 100 keeps each house's ground unfolded (the
      // nearest neighbours are 102 m+ out for both).
      const around = await facts.discoverCandidates({ lat: 32.741362, lng: -117.157981 }, 100);
      const marston = around.find(c => c.name === 'George Marston House');
      check('the Marston candidate is discovered', Boolean(marston), around.map(c => c.name).join(','));
      check('George Marston House (excepted, tour-important) keeps Tier-1', marston?.tier1 === true, `tier1=${marston?.tier1}`);
      // Burnham-Marston flipped when the exception list grew to
      // the full Nov 15 audits: struck under the withdrawn
      // visitability bar, kept under tour importance (the
      // Prairie School landmark in the Gill/Waterman/Marston
      // cluster). It now keeps Tier-1 on its own ground.
      const burnhamAround = await facts.discoverCandidates({ lat: 32.742716, lng: -117.157343 }, 100);
      const burnham = burnhamAround.find(c => c.name === 'Burnham-Marston House');
      check('Burnham-Marston House is discovered on its own ground', Boolean(burnham), burnhamAround.map(c => c.name).join(','));
      check('Burnham-Marston (national house, excepted under the v2 list) keeps Tier-1', burnham?.tier1 === true, `tier1=${burnham?.tier1}`);
      // The negative control moved to Brawn: a national house
      // the v2 list struck (audit DEAD WEIGHT), alone on its
      // Vista ground — no fold partners within 100 m.
      const brawnAround = await facts.discoverCandidates({ lat: 33.186239, lng: -117.248023 }, 100);
      const brawn = brawnAround.find(c => c.name === 'Brawn, Charles A., House');
      check('Brawn, Charles A., House is discovered on its own ground', Boolean(brawn), brawnAround.map(c => c.name).join(','));
      check('Brawn (national house, NOT excepted) is not Tier-1', brawn?.tier1 === false, `tier1=${brawn?.tier1}`);
      check('the predicate names an exception', facts.isTier1HouseException('George Marston House') === true);
      check('the predicate names nothing else on the street', facts.isTier1HouseException('A.H. Sweet Residences') === false);
    } finally {
      restore();
    }
    // The Places-fold path: a Places candidate merged with the
    // registry record must reach the same verdict — including
    // when Google's display name carries the middle initial
    // and only the registry's own name matches the key.
    const restore2 = fpStubFetch([
      fpPlace('A.H. Sweet Residences', 32.738374, -117.167262),
      fpPlace('George W. Marston House', 32.741362, -117.157981),
    ]);
    try {
      const sweet = (await facts.discoverCandidates({ lat: 32.738374, lng: -117.167262 }, 250)).find(
        c => c.name === 'A.H. Sweet Residences',
      );
      check('the Places-folded national house is not Tier-1 either', sweet?.tier1 === false, `tier1=${sweet?.tier1}`);
      const marston = (await facts.discoverCandidates({ lat: 32.741362, lng: -117.157981 }, 250)).find(
        c => c.name === 'George W. Marston House',
      );
      check('the Places-folded Marston (W. form) keeps Tier-1 via the registry name', marston?.tier1 === true, `tier1=${marston?.tier1}`);
    } finally {
      restore2();
    }
  }

  suite('FP-3 houses out of Tier-1: no pending-lane claim and no displacement protection for a national house');
  {
    resetLocalStorage();
    // The candidate below is exactly what discovery returns
    // for a national house after FP-1 (tier1: false) — the
    // fixture house is A.H. Sweet Residences, FP-1's own case
    // (Burnham-Marston held the role until the v2 exception
    // list made it Tier-1; FP-2 pins that flip). Its payload
    // stands on its ground — the gate would license the serve
    // if it could take a slot.
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park')],
      library: [
        'Alpha Park',
        { name: 'Waiter Place', lat: UTC.lat + 0.004, lng: UTC.lng },
        { name: 'A.H. Sweet Residences', lat: UTC.lat + 0.0045, lng: UTC.lng },
        { name: 'Grand Museum', lat: UTC.lat + 0.0045, lng: UTC.lng },
        // The part-2 displacer rides the shelf: a live
        // candidate would be refused by the generation fit
        // gate (the queue ahead of it is minutes long), never
        // reaching the displacement ruling under test.
        { name: 'Fresh Plaza', lat: UTC.lat, lng: UTC.lng },
      ],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 90_000 }));
    const { tour } = await healthyOpening(world, audio);
    const soundedLabels = watchLabels(world, tour);
    // Part 1: an ordinary waiter holds the slot. A Tier-1
    // house would displace it by priority or wait it out in
    // the pending lane; a non-Tier-1 house can do neither —
    // the fresher test is its only road in, and it fails it:
    // the waiter sits on the driver's own ground (~0 m), the
    // house ~55 m off, and the mint gap is seconds, not 30 s.
    world.candidates = [makeCandidate('Waiter Place', { lat: UTC.lat + 0.004, lng: UTC.lng, distanceM: 60 })];
    tour.onPosition({ lat: UTC.lat + 0.002, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(3_000); // waiter slotted behind Alpha
    world.candidates = [makeCandidate('A.H. Sweet Residences', { tier1: false, lat: UTC.lat + 0.0045, lng: UTC.lng })];
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(6_000); // the house is offered and lands 'buffer', repeatedly
    check('the national house never committed behind an ordinary waiter',
      !world.eventsOf('story_played').some(e => e.payload.subject === 'a.h. sweet residences'),
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    // Part 2: with the slot free the house MAY slot (portal
    // license in hand) — but it waits unprotected: a fresher
    // ordinary newcomer displaces it like any ordinary story.
    world.candidates = [];
    await world.clock.advance(100_000); // Alpha ends; the waiter sounds (90 s)
    world.candidates = [makeCandidate('A.H. Sweet Residences', { tier1: false, lat: UTC.lat + 0.0045, lng: UTC.lng })];
    // A >200 m move so the serve cycle actually runs (the
    // house's own anchor is its row, not the driver's feet).
    tour.onPosition({ lat: UTC.lat + 0.009, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(3_000); // the house slots behind the waiter
    check('the house slotted once the slot was free (the gate licenses it)',
      world.eventsOf('story_played').some(e => e.payload.subject === 'a.h. sweet residences'),
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    // A fresh ordinary candidate at the driver's feet is the
    // displacer (the waiter itself is already told).
    world.candidates = [makeCandidate('Fresh Plaza', { lat: UTC.lat, lng: UTC.lng, distanceM: 10 })];
    tour.onPosition({ lat: UTC.lat, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(4_000);
    const drops = world.eventsOf('story_dropped');
    check('a fresher ordinary newcomer displaces the waiting house (no tier protection)',
      drops.some(d => d.payload.reason === 'displaced-fresher'),
      JSON.stringify(drops.map(d => d.payload)));
    check('the displaced house never sounded', !soundedLabels.includes('A.H. Sweet Residences'), soundedLabels.join(','));
    check('its payload never sounded either (the obligation died with the commit)',
      !soundedLabels.includes('Grand Museum'), soundedLabels.join(','));
    tour.endTour();
  }

  suite('FP-4 speed regime: an at-speed corridor offer displaces an ordinary waiter by priority (fresher cannot decide it)');
  {
    resetLocalStorage();
    const { seg, start, heading } = fpPickSeg();
    const mid = fpAlong(seg, 0.5);
    // Fixture math: the waiter sits ON the midpoint — its
    // anchor is ~0 m from the driver, the corridor item's
    // nearest-point anchor is ~0 m too, and the waiter was
    // minted seconds before the offer. Both fresher prongs
    // (150 m closer, 30 s newer) fail by construction; only
    // priority can move this waiter.
    check('fixture: the fresher distance prong cannot decide it', !(0 + 150 < 0), 'dn≈0 dw≈0');
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park', { lat: start.lat, lng: start.lng, distanceM: 100 })],
      library: [
        { name: 'Alpha Park', lat: start.lat, lng: start.lng },
        seg.displayName,
        { name: 'Waiter Place', lat: mid.lat, lng: mid.lng },
      ],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 90_000 }));
    const tour = await startAt(world, audio, start, 8, heading);
    const soundedLabels = watchLabels(world, tour);
    await world.clock.advance(40_000); // greeting + opener + welcome; Alpha playing (90 s)
    world.candidates = [makeCandidate('Waiter Place', { lat: mid.lat, lng: mid.lng, distanceM: 0 })];
    tour.onPosition({ lat: mid.lat, lng: mid.lng, speedMps: 8, headingDeg: mid.heading });
    await world.clock.advance(3_000); // waiter slotted behind Alpha
    check('waiter slotted behind the playing story',
      world.eventsOf('story_played').some(e => e.payload.subject === 'waiter place'),
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    tour.onPosition({ lat: mid.lat, lng: mid.lng, speedMps: 27, headingDeg: mid.heading });
    await world.clock.advance(3_000); // the at-speed corridor offer meets the waiter
    const drops = world.eventsOf('story_dropped');
    check('the waiter is displaced by priority, not fresher',
      drops.some(d => d.payload.reason === 'displaced-priority') &&
        !drops.some(d => d.payload.reason === 'displaced-fresher'),
      JSON.stringify(drops.map(d => d.payload)));
    check('the corridor story committed',
      world.eventsOf('story_played').some(e => e.payload.subject === `corridor:${seg.id}`),
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    await world.clock.advance(150_000); // Alpha ends; the corridor story sounds
    check('the corridor story sounds after the playing story', soundedLabels.includes(seg.displayName), soundedLabels.join(','));
    check('the displaced waiter never sounded', !soundedLabels.includes('Waiter Place'), soundedLabels.join(','));
    tour.endTour();
  }

  suite('FP-5 speed regime: a buffered at-speed corridor item is retained and promoted ahead of a Tier-1 pending');
  {
    resetLocalStorage();
    const { seg, start, heading } = fpPickSeg();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park', { lat: start.lat, lng: start.lng, distanceM: 100 })],
      library: [
        { name: 'Alpha Park', lat: start.lat, lng: start.lng },
        seg.displayName,
        { name: 'Tier One Museum', lat: start.lat, lng: start.lng },
        { name: 'Tier Two Castle', lat: start.lat, lng: start.lng },
      ],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 45_000 }));
    const tour = await startAt(world, audio, start, 8, heading);
    const soundedLabels = watchLabels(world, tour);
    await world.clock.advance(40_000); // opening done; Alpha playing (45 s)
    const p1 = fpAlong(seg, 0.05);
    world.candidates = [makeCandidate('Tier One Museum', { tier1: true, lat: start.lat, lng: start.lng })];
    tour.onPosition({ lat: p1.lat, lng: p1.lng, speedMps: 8, headingDeg: p1.heading });
    await world.clock.advance(3_000); // Tier One slotted as the waiter
    const p2 = fpAlong(seg, 0.12);
    world.candidates = [makeCandidate('Tier Two Castle', { tier1: true, lat: start.lat, lng: start.lng })];
    tour.onPosition({ lat: p2.lat, lng: p2.lng, speedMps: 8, headingDeg: p2.heading });
    await world.clock.advance(3_000); // Tier Two offered → pending lane
    check('Tier Two waits in the pending lane (not committed)',
      !world.eventsOf('story_played').some(e => e.payload.subject === 'tier two castle'),
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    // The at-speed corridor offer meets the Tier-1 waiter:
    // priority cannot displace it, so the item is retained.
    tour.onPosition({ lat: start.lat, lng: start.lng, speedMps: 27, headingDeg: heading });
    await world.clock.advance(3_000);
    check('the corridor item is not committed yet (retained, not slotted)',
      !world.eventsOf('story_played').some(e => e.payload.subject === `corridor:${seg.id}`),
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    check('no corridor-pending marker has fired yet',
      world.eventsOf('corridor_pending_promoted').length === 0 && world.eventsOf('corridor_pending_dropped').length === 0,
      JSON.stringify([...world.eventsOf('corridor_pending_promoted'), ...world.eventsOf('corridor_pending_dropped')].map(e => e.payload)));
    // Alpha ends → Tier One dequeues → the refill promotes
    // the retained corridor item into the slot AHEAD of the
    // pending Tier Two.
    await world.clock.advance(45_000);
    const promoted = world.eventsOf('corridor_pending_promoted');
    check('the promotion marker fired for this segment',
      promoted.length === 1 && promoted[0].payload.segment_id === seg.id,
      JSON.stringify(promoted.map(e => e.payload)));
    const commits = world.eventsOf('story_played').map(e => e.payload.subject);
    check('the corridor item committed before the pending Tier Two',
      commits.indexOf(`corridor:${seg.id}`) >= 0 &&
        (commits.indexOf('tier two castle') === -1 || commits.indexOf(`corridor:${seg.id}`) < commits.indexOf('tier two castle')),
      commits.join(','));
    await world.clock.advance(200_000); // everything plays out
    const order = ['Alpha Park', 'Tier One Museum', seg.displayName, 'Tier Two Castle'].map(l => soundedLabels.indexOf(l));
    check('sounding order: Alpha → Tier One → corridor → Tier Two',
      order.every(i => i >= 0) && order[0] < order[1] && order[1] < order[2] && order[2] < order[3],
      soundedLabels.join(','));
    tour.endTour();
  }

  suite('FP-5b speed regime: the retained item is dropped on segment exit');
  {
    resetLocalStorage();
    const { seg, start, heading } = fpPickSeg();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park', { lat: start.lat, lng: start.lng, distanceM: 100 })],
      library: [
        { name: 'Alpha Park', lat: start.lat, lng: start.lng },
        seg.displayName,
        { name: 'Tier One Museum', lat: start.lat, lng: start.lng },
      ],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 45_000 }));
    const tour = await startAt(world, audio, start, 8, heading);
    const soundedLabels = watchLabels(world, tour);
    await world.clock.advance(40_000);
    const p1 = fpAlong(seg, 0.05);
    world.candidates = [makeCandidate('Tier One Museum', { tier1: true, lat: start.lat, lng: start.lng })];
    tour.onPosition({ lat: p1.lat, lng: p1.lng, speedMps: 8, headingDeg: p1.heading });
    await world.clock.advance(3_000); // Tier One slotted
    tour.onPosition({ lat: start.lat, lng: start.lng, speedMps: 27, headingDeg: heading });
    await world.clock.advance(3_000); // corridor offer buffers → retained
    // Drive off the segment (4+ km perpendicular), still fast.
    tour.onPosition({ lat: start.lat, lng: start.lng + 0.05, speedMps: 27, headingDeg: heading });
    await world.clock.advance(2_000);
    const dropped = world.eventsOf('corridor_pending_dropped');
    check('the drop marker fired with reason segment-exit',
      dropped.length === 1 && dropped[0].payload.segment_id === seg.id && dropped[0].payload.reason === 'segment-exit',
      JSON.stringify(dropped.map(e => e.payload)));
    await world.clock.advance(200_000);
    check('no promotion ever fired', world.eventsOf('corridor_pending_promoted').length === 0);
    check('the corridor story never committed or sounded',
      !world.eventsOf('story_played').some(e => e.payload.subject === `corridor:${seg.id}`) &&
        !soundedLabels.includes(seg.displayName),
      soundedLabels.join(','));
    tour.endTour();
  }

  suite('FP-5c speed regime: the retained item is dropped when speed falls below the line');
  {
    resetLocalStorage();
    const { seg, start, heading } = fpPickSeg();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park', { lat: start.lat, lng: start.lng, distanceM: 100 })],
      library: [
        { name: 'Alpha Park', lat: start.lat, lng: start.lng },
        seg.displayName,
        { name: 'Tier One Museum', lat: start.lat, lng: start.lng },
      ],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 45_000 }));
    const tour = await startAt(world, audio, start, 8, heading);
    const soundedLabels = watchLabels(world, tour);
    await world.clock.advance(40_000);
    const p1 = fpAlong(seg, 0.05);
    world.candidates = [makeCandidate('Tier One Museum', { tier1: true, lat: start.lat, lng: start.lng })];
    tour.onPosition({ lat: p1.lat, lng: p1.lng, speedMps: 8, headingDeg: p1.heading });
    await world.clock.advance(3_000); // Tier One slotted
    tour.onPosition({ lat: start.lat, lng: start.lng, speedMps: 27, headingDeg: heading });
    await world.clock.advance(3_000); // corridor offer buffers → retained
    // Slow down ON the segment: the regime ends, the item dies.
    tour.onPosition({ lat: start.lat, lng: start.lng, speedMps: 8, headingDeg: heading });
    await world.clock.advance(2_000);
    const dropped = world.eventsOf('corridor_pending_dropped');
    check('the drop marker fired with reason speed',
      dropped.length === 1 && dropped[0].payload.segment_id === seg.id && dropped[0].payload.reason === 'speed',
      JSON.stringify(dropped.map(e => e.payload)));
    // Leave the ground so no ordinary-lane re-serve can occur.
    tour.onPosition({ lat: start.lat, lng: start.lng + 0.05, speedMps: 8, headingDeg: heading });
    await world.clock.advance(200_000);
    check('no promotion ever fired', world.eventsOf('corridor_pending_promoted').length === 0);
    check('the corridor story never committed or sounded',
      !world.eventsOf('story_played').some(e => e.payload.subject === `corridor:${seg.id}`) &&
        !soundedLabels.includes(seg.displayName),
      soundedLabels.join(','));
    tour.endTour();
  }

  suite('FP-6 speed regime: below the line the corridor lane is unchanged (buffer drops, no retention, segment unconsumed)');
  {
    resetLocalStorage();
    const { seg, start, heading } = fpPickSeg();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park', { lat: start.lat, lng: start.lng, distanceM: 100 })],
      library: [
        { name: 'Alpha Park', lat: start.lat, lng: start.lng },
        seg.displayName,
        { name: 'Tier One Museum', lat: start.lat, lng: start.lng },
      ],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 45_000 }));
    const tour = world.makeTour(audio);
    const soundedLabels = watchLabels(world, tour);
    tour.onPosition({ lat: start.lat, lng: start.lng, speedMps: 8, headingDeg: heading });
    tour.start(false);
    // Earn eligibility with a fast tick while the opening gate
    // still bars corridor serves (the serve aborts, the
    // eligibility banks) — the only way to reach a below-speed
    // offer on an eligible segment.
    tour.onPosition({ lat: start.lat, lng: start.lng, speedMps: 27, headingDeg: heading });
    await world.clock.advance(2_000);
    await world.clock.advance(40_000); // opening done; Alpha playing
    const p1 = fpAlong(seg, 0.05);
    world.candidates = [makeCandidate('Tier One Museum', { tier1: true, lat: start.lat, lng: start.lng })];
    // Slot Tier One from OFF the segment: the segment is
    // already eligible (banked above), so an on-segment nudge
    // would fire serveCorridor into the still-empty slot
    // before the cycle can stock the waiter.
    tour.onPosition({ lat: p1.lat, lng: p1.lng + 0.005, speedMps: 8, headingDeg: p1.heading });
    await world.clock.advance(3_000); // Tier One slotted
    world.candidates = [];
    // The below-speed offer meets the Tier-1 waiter and lands
    // 'buffer' — historically the end of it.
    tour.onPosition({ lat: start.lat, lng: start.lng, speedMps: 8, headingDeg: heading });
    await world.clock.advance(3_000);
    check('no corridor-pending marker fired below the line',
      world.eventsOf('corridor_pending_promoted').length === 0 && world.eventsOf('corridor_pending_dropped').length === 0,
      JSON.stringify([...world.eventsOf('corridor_pending_promoted'), ...world.eventsOf('corridor_pending_dropped')].map(e => e.payload)));
    await world.clock.advance(150_000); // Alpha and Tier One play out
    check('the buffered corridor story never committed or sounded (no retention below the line)',
      !world.eventsOf('story_played').some(e => e.payload.subject === `corridor:${seg.id}`) &&
        !soundedLabels.includes(seg.displayName),
      soundedLabels.join(','));
    // The segment was never consumed by the drop: a later
    // at-speed pass serves it through the ordinary lane.
    tour.onPosition({ lat: start.lat, lng: start.lng, speedMps: 27, headingDeg: heading });
    await world.clock.advance(3_000);
    check('the segment serves on a later pass (the buffer drop consumed nothing)',
      world.eventsOf('story_played').some(e => e.payload.subject === `corridor:${seg.id}`),
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    await world.clock.advance(60_000);
    check('and it sounds', soundedLabels.includes(seg.displayName), soundedLabels.join(','));
    tour.endTour();
  }

  suite('FP-6b speed regime: below the line the fresher/anchor law still governs displacement (corridor fix 1, unregimented)');
  {
    resetLocalStorage();
    const { seg, start, heading } = fpPickSeg();
    const mid = fpAlong(seg, 0.5);
    const waiterPos = { lat: mid.lat, lng: mid.lng + 500 / fpMpdLng(mid.lat) };
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park', { lat: start.lat, lng: start.lng, distanceM: 100 })],
      library: [
        { name: 'Alpha Park', lat: start.lat, lng: start.lng },
        seg.displayName,
        { name: 'Waiter Place', lat: waiterPos.lat, lng: waiterPos.lng },
      ],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 90_000 }));
    const tour = world.makeTour(audio);
    const soundedLabels = watchLabels(world, tour);
    tour.onPosition({ lat: start.lat, lng: start.lng, speedMps: 8, headingDeg: mid.heading });
    tour.start(false);
    // Bank eligibility during the gated opening, as in FP-6.
    tour.onPosition({ lat: start.lat, lng: start.lng, speedMps: 27, headingDeg: mid.heading });
    await world.clock.advance(2_000);
    await world.clock.advance(40_000); // opening done; Alpha playing (90 s)
    world.candidates = [makeCandidate('Waiter Place', { lat: waiterPos.lat, lng: waiterPos.lng, distanceM: 60 })];
    tour.onPosition({ lat: waiterPos.lat, lng: waiterPos.lng, speedMps: 8, headingDeg: mid.heading });
    await world.clock.advance(3_000); // waiter slotted (off-segment: no trigger fires)
    // Step onto the midpoint BELOW the line: the offer is the
    // historical one — fresher, measured from the nearest
    // point on the segment (fix 1), and it wins.
    tour.onPosition({ lat: mid.lat, lng: mid.lng, speedMps: 8, headingDeg: mid.heading });
    await world.clock.advance(3_000);
    const drops = world.eventsOf('story_dropped');
    check('below the line the corridor item displaces by fresher, not priority',
      drops.some(d => d.payload.reason === 'displaced-fresher') &&
        !drops.some(d => d.payload.reason === 'displaced-priority'),
      JSON.stringify(drops.map(d => d.payload)));
    check('the corridor story committed',
      world.eventsOf('story_played').some(e => e.payload.subject === `corridor:${seg.id}`),
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    await world.clock.advance(150_000);
    check('the corridor story sounds after the playing story', soundedLabels.includes(seg.displayName), soundedLabels.join(','));
    tour.endTour();
  }

  suite('FP-7 welcome versions: on dense ground the welcome lane serves the intro short cut');
  {
    resetLocalStorage();
    const pos2 = { lat: UTC.lat + 0.004, lng: UTC.lng };
    const density = ['Density One', 'Density Two', 'Density Three', 'Density Four', 'Density Five', 'Density Six', 'Density Seven'].map(
      name => ({ name, lat: pos2.lat, lng: pos2.lng }),
    );
    const world = makeWorld(Tour, {
      candidates: [],
      intros: ['Kearny Mesa'],
      library: [{ name: 'Kearny Mesa', angles: ['neighborhood_intro (short cut)'], lat: pos2.lat, lng: pos2.lng }, ...density],
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    world.area = { neighborhood: 'Kearny Mesa', city: 'San Diego' };
    tour.onPosition({ lat: pos2.lat, lng: pos2.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(60_000);
    const played = welcomePlayed(world, 'welcome:kearny mesa');
    check('welcome committed exactly once', played.length === 1, `n=${played.length}`);
    check('the served welcome is the short cut (telemetry angle)',
      played[0]?.payload.angle === 'neighborhood_intro (short cut)', JSON.stringify(played[0]?.payload));
    check('the cut audio is what played',
      audio.log.some(e => typeof e.src === 'string' && e.src.includes('neighborhood_intro (short cut).wav')),
      JSON.stringify(audio.log.map(e => e.src)));
    check('the full intro audio never played',
      !audio.log.some(e => typeof e.src === 'string' && e.src.endsWith('/neighborhood_intro.wav')),
      JSON.stringify(audio.log.map(e => e.src)));
    tour.endTour();
  }

  suite('FP-8 welcome versions: on thin ground the full intro serves even when a cut exists; without a cut, dense ground changes nothing');
  {
    resetLocalStorage();
    const pos2 = { lat: UTC.lat + 0.004, lng: UTC.lng };
    const world = makeWorld(Tour, {
      candidates: [],
      intros: ['Kearny Mesa'],
      library: [
        { name: 'Kearny Mesa', angles: ['neighborhood_intro (short cut)'], lat: pos2.lat, lng: pos2.lng },
        { name: 'Density One', lat: pos2.lat, lng: pos2.lng },
        { name: 'Density Two', lat: pos2.lat, lng: pos2.lng },
      ],
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    world.area = { neighborhood: 'Kearny Mesa', city: 'San Diego' };
    tour.onPosition({ lat: pos2.lat, lng: pos2.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(60_000);
    const played = welcomePlayed(world, 'welcome:kearny mesa');
    check('thin ground: the FULL intro serves', played[0]?.payload.angle === 'neighborhood_intro', JSON.stringify(played[0]?.payload));
    check('thin ground: the cut audio never played',
      !audio.log.some(e => typeof e.src === 'string' && e.src.includes('(short cut)')),
      JSON.stringify(audio.log.map(e => e.src)));
    tour.endTour();
  }
  {
    resetLocalStorage();
    const pos2 = { lat: UTC.lat + 0.004, lng: UTC.lng };
    const density = ['Density One', 'Density Two', 'Density Three', 'Density Four', 'Density Five', 'Density Six', 'Density Seven'].map(
      name => ({ name, lat: pos2.lat, lng: pos2.lng }),
    );
    const world = makeWorld(Tour, {
      candidates: [],
      intros: ['Kearny Mesa'],
      library: [...density],
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    world.area = { neighborhood: 'Kearny Mesa', city: 'San Diego' };
    tour.onPosition({ lat: pos2.lat, lng: pos2.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(60_000);
    const played = welcomePlayed(world, 'welcome:kearny mesa');
    check('dense ground, no cut on the shelf: the full intro serves exactly as before',
      played[0]?.payload.angle === 'neighborhood_intro', JSON.stringify(played[0]?.payload));
    tour.endTour();
  }

  suite('FP-9 portal regression: a national house serves only as a portal, payload next (the gate is unchanged by the tier change)');
  {
    resetLocalStorage();
    // A.H. Sweet Residences is a national house whose
    // discovery candidate is tier1: false (FP-1). The
    // gate never consulted the tier: licensed by its payload,
    // it serves — and the payload is the very next story,
    // exactly as HP-1 proved for an ordinary house.
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('A.H. Sweet Residences', { tier1: false }), makeCandidate('Grand Museum')],
      library: [
        { name: 'A.H. Sweet Residences', angles: ['landmark_origin'] },
        { name: 'Grand Museum', angles: ['landmark_origin'] },
      ],
    });
    starvePrefetch(world);
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);
    for (let i = 0; i < 80 && storySubjects(world).length < 2; i++) await world.clock.advance(5_000);
    await world.clock.advance(45_000);
    const subjects = storySubjects(world);
    check('the national house served (a payload stands on its ground)', subjects.includes('a.h. sweet residences'),
      JSON.stringify(subjects));
    check('the payload sounds immediately after the house — no story between them',
      subjects.indexOf('a.h. sweet residences') >= 0 &&
        subjects.indexOf('grand museum') === subjects.indexOf('a.h. sweet residences') + 1,
      JSON.stringify(subjects));
    tour.endTour();
  }

  // ---------------------------------------------------------------
  // HI suites (Nov 15, 2026): importance-ordered house scoring.
  // The flat F1 −50 could not tell houses apart; the penalty is
  // now graduated by the tour-importance audits (SOLID −30,
  // unaudited −50 exact, DEAD WEIGHT −70), with Tier-1 exception
  // houses untouched at the flat −50. Synthetic candidates feed
  // applyHouseDemotion directly (it reads name/registry/score
  // only); discovery suites stub Places like the FP suites.
  const hiCandidate = (name, score = 100) => ({
    name, lat: 0, lng: 0, source: 'registry', types: ['historic_site'],
    rating: null, userRatings: null, address: null, tier1: false, score, registry: null, distanceM: 0,
  });

  suite('HI-1 graduated penalty: at equal base, solid beats unaudited beats dead weight');
  {
    const solid = hiCandidate('Lillie and James North Houses');
    const unaudited = hiCandidate('A.H. Sweet Residences');
    const dead = hiCandidate('Alice Lee Residence');
    facts.applyHouseDemotion([solid, unaudited, dead]);
    check('the penalty constants are the ruled steps (30 / 50 / 70)',
      facts.HOUSE_SCORE_PENALTY_SOLID === 30 && facts.HOUSE_SCORE_PENALTY === 50 && facts.HOUSE_SCORE_PENALTY_DEAD === 70,
      `${facts.HOUSE_SCORE_PENALTY_SOLID}/${facts.HOUSE_SCORE_PENALTY}/${facts.HOUSE_SCORE_PENALTY_DEAD}`);
    check('a SOLID audited house loses only 30', solid.score === 70, `score=${solid.score}`);
    check('an unaudited house loses exactly the flat 50', unaudited.score === 50, `score=${unaudited.score}`);
    check('a DEAD WEIGHT house loses 70 — last resort among houses', dead.score === 30, `score=${dead.score}`);
    check('the order at equal base is solid > unaudited > dead',
      solid.score > unaudited.score && unaudited.score > dead.score,
      `${solid.score}/${unaudited.score}/${dead.score}`);
  }

  suite('HI-2 no silence desert: a dead-weight house alone in range is still discovered and returned');
  {
    resetLocalStorage();
    const restore = fpStubFetch([]);
    try {
      // Brawn is a named portal-desert house (v2): no story
      // places within 1,000 m. Discovery must still return it —
      // the graduated penalty orders, it never filters.
      const around = await facts.discoverCandidates({ lat: 33.186239, lng: -117.248023 }, 100);
      const brawn = around.find(c => c.name === 'Brawn, Charles A., House');
      check('the dead-weight house is discovered on its desert ground', Boolean(brawn), around.map(c => c.name).join(','));
      check('it is the only candidate in range (the desert is real)', around.length === 1, `${around.length}`);
      check('its score carries the full dead-weight step (20 + 45 national − 70 − distance)',
        Boolean(brawn) && Math.abs(brawn.score - (65 - 70 - brawn.distanceM / 90)) < 0.01,
        `score=${brawn?.score} distanceM=${brawn?.distanceM}`);
      const lone = hiCandidate('Brawn, Charles A., House');
      const list = [lone];
      facts.applyHouseDemotion(list);
      check('demotion never removes a candidate — the list still holds it', list.length === 1 && list[0] === lone && lone.score === 30,
        `len=${list.length} score=${lone.score}`);
    } finally {
      restore();
    }
  }

  suite('HI-3 unaudited houses are byte-identical to the flat-F1 world');
  {
    const sweet = hiCandidate('A.H. Sweet Residences');
    const invented = hiCandidate('Zzyzx Family House');
    const marston = hiCandidate('George Marston House');
    facts.applyHouseDemotion([sweet, invented, marston]);
    check('A.H. Sweet Residences (in neither audit — it fell between the two populations when the plural fix widened the national count) loses exactly 50',
      sweet.score === 50, `score=${sweet.score}`);
    check('a wholly unaudited house name loses exactly 50', invented.score === 50, `score=${invented.score}`);
    check('an exception house is untouched by the graduation — its flat 50 stands', marston.score === 50, `score=${marston.score}`);
    resetLocalStorage();
    const restore = fpStubFetch([]);
    try {
      // Discovery-level identity: Sweet on its own ground,
      // Places stubbed — 20 base + 45 national boost − 50 flat,
      // distance 0. The exact pre-graduation number.
      const around = await facts.discoverCandidates({ lat: 32.738374, lng: -117.167262 }, 100);
      const found = around.find(c => c.name === 'A.H. Sweet Residences');
      check('Sweet’s discovered score is exactly the flat-F1 score (15)',
        Boolean(found) && Math.abs(found.score - 15) < 1e-9, `score=${found?.score}`);
    } finally {
      restore();
    }
  }

  suite('HI-4 a PROMOTE exception is Tier-1 via the exception list even on a local register (the Whaley case)');
  {
    check('the predicate names the Whaley House under both dialects',
      facts.isTier1HouseException('Whaley House Museum') === true && facts.isTier1HouseException('Whaley House') === true);
    check('the importance data carries the Whaley promote',
      facts.houseImportanceFor('Whaley House Museum')?.verdict === 'PROMOTE');
    resetLocalStorage();
    const restore = fpStubFetch([]);
    try {
      // The registry carries the Whaley House as LOCAL-only
      // (the dataset anomaly the audit flagged) — before the
      // exception list grew, no local house could be Tier-1.
      // Its ground folds with the Derby-Pendleton House 6 m
      // away; whichever record headlines the candidate, the
      // Whaley record rides it and the exception confers.
      const around = await facts.discoverCandidates({ lat: 32.752816, lng: -117.194421 }, 250);
      const whaley = around.find(c => c.name.includes('Whaley') || c.registry?.name.includes('Whaley'));
      check('the Whaley ground is discovered', Boolean(whaley), around.map(c => c.name).join(','));
      check('the Whaley candidate is Tier-1 via the exception (local register notwithstanding)',
        whaley?.tier1 === true, `tier1=${whaley?.tier1}`);
      check('no other candidate on that Old Town ground is Tier-1',
        around.filter(c => c !== whaley).every(c => c.tier1 === false),
        around.map(c => `${c.name}:${c.tier1}`).join(','));
    } finally {
      restore();
    }
  }

  suite('HI-5 the two Alice Lees: the people are the difference');
  {
    // At equal base, synthetic and exact: the Gill/Waterman
    // Alice Lee is a PROMOTE exception (flat −50, untouched);
    // the plain Alice Lee Residence is audit DEAD WEIGHT (−70);
    // the nearby solid North Houses take the reduced −30.
    const deadAlice = hiCandidate('Alice Lee Residence');
    const gillAlice = hiCandidate('Alice Lee/ Irving J. Gill/ Hazel Wood Waterman House');
    const solid = hiCandidate('Lillie and James North Houses');
    facts.applyHouseDemotion([deadAlice, gillAlice, solid]);
    check('the dead Alice Lee loses 70', deadAlice.score === 30, `score=${deadAlice.score}`);
    check('the Gill/Waterman Alice Lee is PROMOTE in the data and keeps the flat 50 as an exception',
      facts.houseImportanceFor('Alice Lee/ Irving J. Gill/ Hazel Wood Waterman House')?.verdict === 'PROMOTE' && gillAlice.score === 50,
      `score=${gillAlice.score}`);
    check('the order is solid > Gill/Waterman > dead Alice Lee',
      solid.score > gillAlice.score && gillAlice.score > deadAlice.score,
      `${solid.score}/${gillAlice.score}/${deadAlice.score}`);
    resetLocalStorage();
    const restore = fpStubFetch([]);
    try {
      // On the real ground the two Alice Lees (31 m apart) and
      // Teats House No. 1 (59 m) fold into ONE discovery
      // candidate — GPS cannot tell houses 31 m apart apart
      // either. The fold pins the shared-ground doctrine: the
      // Gill record's exception confers the tier at fold time;
      // the headline name (the dead Alice Lee Residence, first
      // record on the ground) carries the dead-weight penalty.
      // Score: 20 + 25×3 folded boosts − 70, distance 0.
      const around = await facts.discoverCandidates({ lat: 32.742967, lng: -117.158709 }, 100);
      const alice = around.find(c => c.name === 'Alice Lee Residence');
      check('the shared Alice Lee ground is one folded candidate', Boolean(alice), around.map(c => c.name).join(','));
      check('the folded candidate is Tier-1 (the Gill/Waterman exception governs the ground)',
        alice?.tier1 === true, `tier1=${alice?.tier1}`);
      check('its score carries the headline name’s dead-weight step (95 − 70 = 25)',
        Boolean(alice) && Math.abs(alice.score - 25) < 0.01, `score=${alice?.score}`);
    } finally {
      restore();
    }
  }

  // ---------------------------------------------------------- D12: Day-12 field fixes (Nov 16, 2026)
  // Field evidence (tour 2186c515, Nov 16): the LIBRARY welcome
  // to Old Town committed at 12:04:39 PST and sounded at
  // 12:08:38, 7,525 m past its subject — 93 s in queue at
  // 35 m/s behind a ~150 s telling, then served stale at full
  // length, cutting the I-5 corridor story's tail 1 s later.
  // Library welcomes were judge-exempt at dequeue (reserved +
  // region-anchored, and the Nov 2 fit gate is live-only): no
  // test measured the distance at sound time. The gate now
  // does, with the judge's own reach geometry — duration ×
  // speed: beyond its reach a shelf welcome drops at dequeue,
  // discharged like a fit-gate welcome (never heard, no
  // story_dropped) but filed as welcome_stale_dropped so the
  // field can see it. Converted pass-by welcomes are exempt
  // (PB-1/PB-2 pin that lane: its converted telling sounds
  // ~5 km past its anchor and must keep sounding).
  //
  // Correction (same day, Erik's ruling): 391e470 first built
  // this gate as a flat 1,600 m cut. That number is the serve
  // cycle's candidate-DISCOVERY radius, not a serve window —
  // no such constant existed — and the flat cut discharged
  // the deferral doctrine's own case (D12-4: a welcome owed
  // behind two long stories at surface pace, ~1,900 m out
  // with a ~2,100 m reach). The flat gate was removed within
  // the day. D12-1 replays the field geometry; D12-4 pins the
  // case the flat rule killed; D12-6 pins that a live welcome
  // is judged once, by the outrun arm alone.

  suite('D12-1 welcome staleness gate: the Day-12 replay — a library welcome held in queue beyond its reach drops at sound time');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [],
      library: [
        { name: 'Balboa Park', lat: UTC.lat + 0.003, lng: UTC.lng },
        { name: 'Grand Museum', lat: UTC.lat + 0.035, lng: UTC.lng },
      ],
      // The field telling ran ~1,950 chars ≈ 150 s. The
      // fixture body is the banked sentence repeated 34×
      // (1,938 chars → ~149 s by chars/13), so at the field
      // speed the sim's reach is the field's reach:
      // ~149 × 35 ≈ 5,220 m (field: 150 × 35 = 5,250 m).
      intros: [{
        name: 'Old Town',
        text: 'The banked intro to Old Town, its streets and its story. '.repeat(34),
      }],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 90_000, synth: 12_000 }));
    const { tour } = await healthyOpening(world, audio);
    // A long library story takes the channel (a >200 m move is
    // what makes the serve cycle fire).
    world.candidates = [makeCandidate('Balboa Park', { lat: UTC.lat + 0.003, lng: UTC.lng })];
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    for (let i = 0; i < 24 && tour.view().nowPlaying?.label !== 'Balboa Park'; i++) {
      await world.clock.advance(5_000);
    }
    check('the long story is playing', tour.view().nowPlaying?.label === 'Balboa Park',
      tour.view().nowPlaying?.label ?? 'none');
    world.candidates = [];
    // Enter Old Town beside its intro anchor (the fixture banks
    // the intro at UTC): the entry welcome registers owed and is
    // held behind Balboa (the deferral the field drive showed).
    world.area = { neighborhood: 'Old Town', city: 'San Diego' };
    tour.onPosition({ lat: UTC.lat + 0.004, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(3_000);
    // The Day-12 move, at the field's own numbers: when the
    // welcome's turn comes the driver is 7,525 m past its
    // anchor at 35 m/s (0.0676° of latitude ≈ 7,525 m) — beyond
    // the ~5,220 m reach of its ~149 s telling.
    tour.onPosition({ lat: UTC.lat + 0.0676, lng: UTC.lng, speedMps: 35, headingDeg: 0 });
    await world.clock.advance(180_000); // Balboa ends; the welcome is offered and reaches dequeue
    check('the Old Town welcome committed (it took the waiting slot)',
      welcomePlayed(world, 'welcome:old town').length === 1,
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    const stale = world.eventsOf('welcome_stale_dropped').filter(e => e.payload.subject === 'welcome:old town');
    check('welcome_stale_dropped fired exactly once', stale.length === 1,
      JSON.stringify(world.eventsOf('welcome_stale_dropped').map(e => e.payload)));
    check('the telemetry carries the sound-time distance, beyond the telling\'s reach (~5,250 m at 35 m/s)',
      (stale[0]?.payload.distance_m ?? 0) > 5250, `distance_m=${stale[0]?.payload.distance_m}`);
    check('the welcome never sounded (no sounded playback for it)',
      !playbacksFor(world, 'welcome:old town').some(p => p.payload.sounded),
      JSON.stringify(playbacksFor(world, 'welcome:old town').map(p => p.payload)));
    check('no story_dropped filed for the welcome (discharge discipline, as with welcome-outrun)',
      dropsFor(world, 'welcome:old town').length === 0,
      JSON.stringify(dropsFor(world, 'welcome:old town').map(d => d.payload)));
    check('the banked intro audio never played',
      !audio.log.some(e => typeof e.src === 'string' && e.src.includes('old-town')),
      JSON.stringify(audio.log.map(e => e.src)));
    check('the place was NOT marked heard', !world.heard.includes('Welcome to Old Town'),
      world.heard.join(' | '));
    // The freed slot serves the next story, which plays through
    // uncut — the Day-12 corridor story's fate, reversed. (The
    // >200 m step is what makes the serve cycle fire.)
    world.candidates = [makeCandidate('Grand Museum', { lat: UTC.lat + 0.035, lng: UTC.lng })];
    tour.onPosition({ lat: UTC.lat + 0.035, lng: UTC.lng, speedMps: 25, headingDeg: 0 });
    await world.clock.advance(120_000);
    const gm = playbacksFor(world, 'grand museum');
    check('the story behind it plays through uncut (sounded + completed)',
      gm.some(p => p.payload.sounded && p.payload.completed),
      JSON.stringify(gm.map(p => p.payload)));
    tour.endTour();
  }

  suite('D12-2 welcome staleness gate: a welcome still inside its reach at sound time plays normally');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [],
      library: [{ name: 'Balboa Park', lat: UTC.lat + 0.003, lng: UTC.lng }],
      intros: ['Old Town'],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 30_000, synth: 12_000 }));
    const { tour } = await healthyOpening(world, audio);
    world.candidates = [makeCandidate('Balboa Park', { lat: UTC.lat + 0.003, lng: UTC.lng })];
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    for (let i = 0; i < 24 && tour.view().nowPlaying?.label !== 'Balboa Park'; i++) {
      await world.clock.advance(5_000);
    }
    check('the long story is playing', tour.view().nowPlaying?.label === 'Balboa Park',
      tour.view().nowPlaying?.label ?? 'none');
    world.candidates = [];
    world.area = { neighborhood: 'Old Town', city: 'San Diego' };
    // A ≥300 m step from the last area resolution is what makes
    // the entry register; the driver ends ~779 m from the intro
    // anchor — inside the fixture telling's reach (~131 s at
    // 8 m/s ≈ 1,052 m).
    tour.onPosition({ lat: UTC.lat + 0.007, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    // No teleport: the driver stays there while Balboa ends and
    // the held welcome's turn comes.
    await world.clock.advance(120_000);
    check('the Old Town welcome committed (it took the waiting slot)',
      welcomePlayed(world, 'welcome:old town').length === 1,
      JSON.stringify(world.eventsOf('story_played').map(e => e.payload.subject)));
    const pb = playbacksFor(world, 'welcome:old town');
    check('the welcome sounded', pb.some(p => p.payload.sounded),
      JSON.stringify(pb.map(p => p.payload)));
    check('it sounded inside its reach (~779 m < ~1,052 m = ~131 s × 8 m/s)',
      pb.some(p => p.payload.sounded && (p.payload.distance_m ?? Infinity) < 1052),
      JSON.stringify(pb.map(p => p.payload)));
    check('the heard ledger filed it', world.heard.includes('Welcome to Old Town'),
      world.heard.join(' | '));
    check('the gate never fired', world.eventsOf('welcome_stale_dropped').length === 0,
      JSON.stringify(world.eventsOf('welcome_stale_dropped').map(e => e.payload)));
    tour.endTour();
  }

  suite('D12-3 welcome staleness gate: the reserved opening welcome at tour start (~0 m) is unaffected');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, { candidates: [], intros: [] });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    const played = welcomePlayed(world, 'welcome:university city');
    check('the opening welcome committed', played.length === 1,
      JSON.stringify(played.map(e => e.payload)));
    const pb = playbacksFor(world, 'welcome:university city');
    check('the opening welcome sounded', pb.some(p => p.payload.sounded),
      JSON.stringify(pb.map(p => p.payload)));
    check('the gate never fired', world.eventsOf('welcome_stale_dropped').length === 0,
      JSON.stringify(world.eventsOf('welcome_stale_dropped').map(e => e.payload)));
    tour.endTour();
  }

  suite('D12-4 welcome reach gate: the deferral case — a welcome owed behind two long stories at surface pace SERVES beyond the old flat cut');
  {
    // The case 391e470's flat 1,600 m gate killed, and the
    // correction exists for. A shelf welcome registers beside
    // its anchor; a Tier-1 landmark defers it (SL-01's
    // mechanics); behind a 120 s library story and a 120 s
    // landmark telling the driver covers ~1.9 km at 10 m/s
    // before its turn comes. The welcome's own telling runs
    // ~211 s (the fixture body is the banked sentence repeated
    // 48×: 2,736 chars ≈ 211 s), so its reach is ~2,110 m: it
    // SERVES. Under the flat cut (1,900 > 1,600) it discharged.
    // The witness is the driver's own position when the
    // welcome takes the channel, asserted inside (1,600,
    // 2,110) — beyond the flat cut, inside the reach. That
    // interval is the demonstrated difference between the two
    // rules. (story_playback's distance_m is settle-time —
    // measured when the telling ENDS — so it cannot witness
    // the dequeue geometry; the step loop captures the sound
    // moment instead.)
    //
    // The landmark is a BANKED Tier-1 (it carries a shelf
    // row): displacement is the player's ruling and is
    // source-agnostic, but a GENERATED challenger never gets
    // minted behind a long waiter — generationWouldLand
    // projects the waiting story whole into a candidate's
    // start, so the fit gate refuses the spend before the
    // player can rule. Banked-first is the shelf's doctrine
    // anyway; the fixture follows it.
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park', { lat: UTC.lat, lng: UTC.lng })],
      library: [
        { name: 'Balboa Park', lat: UTC.lat, lng: UTC.lng },
        { name: 'Tier Tower', lat: UTC.lat + 0.004, lng: UTC.lng },
      ],
      intros: [{
        name: 'Old Town',
        lat: UTC.lat + 0.004,
        lng: UTC.lng,
        text: 'The banked intro to Old Town, its streets and its story. '.repeat(48),
      }],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 120_000, synth: 120_000 }));
    const { tour } = await healthyOpening(world, audio);
    const labels = watchLabels(world, tour);
    // Balboa (120 s library) takes the channel (it waits out
    // the opening welcome first).
    for (let i = 0; i < 40 && tour.view().nowPlaying?.label !== 'Balboa Park'; i++) {
      await world.clock.advance(5_000);
    }
    check('the first long story is playing', tour.view().nowPlaying?.label === 'Balboa Park',
      tour.view().nowPlaying?.label ?? 'none');
    // Drive north at surface pace (5 s steps of 50 m at
    // 10 m/s). Nine steps in, the driver is 450 m from the
    // opening's resolution point — far enough for the Old Town
    // entry to register, on the intro's own pinned ground.
    // Offers land on serve cycles, and a cycle fires on >200 m
    // of movement (tour.ts onPosition), so each wait below
    // steps until the slot actually shows the item.
    let lat = UTC.lat;
    const step = async () => {
      await world.clock.advance(5_000);
      lat += 0.00045;
      tour.onPosition({ lat, lng: UTC.lng, speedMps: 10, headingDeg: 0 });
    };
    for (let i = 0; i < 9; i++) await step();
    world.area = { neighborhood: 'Old Town', city: 'San Diego' };
    tour.onPosition({ lat, lng: UTC.lng, speedMps: 10, headingDeg: 0 });
    for (let i = 0; i < 10 && tour.view().upNext !== 'Welcome to Old Town'; i++) await step();
    check('the welcome waits behind the playing story',
      tour.view().upNext === 'Welcome to Old Town', `upNext=${tour.view().upNext}`);
    // A Tier-1 landmark on the same ground takes the waiting
    // slot — the welcome is deferred, not dropped (SL-01).
    world.candidates = [makeCandidate('Tier Tower', { tier1: true, lat: UTC.lat + 0.004, lng: UTC.lng })];
    for (let i = 0; i < 10 && tour.view().upNext !== 'Tier Tower'; i++) await step();
    check('the landmark takes the waiting slot; the welcome defers',
      tour.view().upNext === 'Tier Tower', `upNext=${tour.view().upNext}`);
    world.candidates = [];
    // Keep driving: the two stories burn ~240 s of clock from
    // Balboa's start; the welcome's turn comes with the driver
    // ~1.9 km past the welcome's anchor. Capture the driver's
    // position at the moment the welcome takes the channel —
    // the dequeue the gate judged.
    let soundDist = -1;
    for (let i = 0; i < 56 && tour.view().nowPlaying?.label !== 'Welcome to Old Town'; i++) {
      await step();
      if (tour.view().nowPlaying?.label === 'Welcome to Old Town') {
        soundDist = Math.round((lat - (UTC.lat + 0.004)) * 111_320);
      }
    }
    check('the deferred welcome took the channel', soundDist >= 0,
      `nowPlaying=${tour.view().nowPlaying?.label ?? 'none'}`);
    // Let the telling finish without moving, so its playback
    // files (the settle also files the heard ledger).
    await world.clock.advance(240_000);
    const order = labels.slice(labels.indexOf('Balboa Park'), labels.indexOf('Balboa Park') + 3).join(',');
    check('play order: library story, landmark, then the deferred welcome',
      order === 'Balboa Park,Tier Tower,Welcome to Old Town', labels.join(','));
    // The deferred welcome commits twice (offer, deferral,
    // re-offer), so commitment-order pairing mis-assigns its
    // playback; select it by the subject its payload carries.
    const pb = world.eventsOf('story_playback').filter(e => e.payload.subject === 'welcome:old town');
    check('the deferred welcome sounded', pb.some(p => p.payload.sounded),
      JSON.stringify(pb.map(p => p.payload)));
    check('it sounded beyond the old flat cut (1,600 m) but inside its reach (~2,110 m) — the demonstrated difference',
      soundDist > 1600 && soundDist < 2110, `sound distance ≈ ${soundDist} m`);
    check('the staleness gate never fired', world.eventsOf('welcome_stale_dropped').length === 0,
      JSON.stringify(world.eventsOf('welcome_stale_dropped').map(e => e.payload)));
    check('the heard ledger filed it', world.heard.includes('Welcome to Old Town'),
      world.heard.join(' | '));
    tour.endTour();
  }

  suite('D12-5 welcome reach gate: walking pace — a queued shelf welcome serves inside its reach');
  {
    // At walking speed the reach shrinks with the pace — and
    // the binding wait is the serve cycle's, not a story's:
    // offers ride cycles, and a cycle fires on >200 m of
    // movement (tour.ts onPosition), so at 1.2 m/s a walking
    // welcome's first dequeue can sit ~200 m past its anchor
    // whatever it waited behind. Duration × speed must clear
    // that granularity for the serve to hold. This fixture's
    // telling runs ~175 s (the banked sentence repeated 40×:
    // 2,280 chars ≈ 175 s), reach ~210 m: judged ~168 m past
    // its pin (the position captured when it takes the
    // channel), it SERVES. The boundary is the formula's, not
    // the fixture's, and it is recorded honestly: this suite's
    // first run used the default ~131 s fixture body (reach
    // ~158 m) in the identical construction, the welcome was
    // judged at the same ~165 m, and the gate DISCHARGED it —
    // a short walking telling whose reach is smaller than the
    // cycle granularity can be turned away on foot. (The
    // Day-12 report carries the qualification.)
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [],
      library: [{ name: 'Balboa Park', lat: UTC.lat + 0.004, lng: UTC.lng }],
      intros: [{
        name: 'Old Town',
        lat: UTC.lat + 0.004,
        lng: UTC.lng,
        text: 'The banked intro to Old Town, its streets and its story. '.repeat(40),
      }],
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 45_000, synth: 12_000 }));
    const { tour } = await healthyOpening(world, audio);
    // Walk north at 1.2 m/s (5 s steps of 6 m). Balboa is
    // offered as the walker nears its ground; the Old Town
    // entry registers at +0.004 (445 m from the opening's
    // resolution point, past the ≥300 m entry step) with
    // Balboa playing.
    let lat = UTC.lat;
    let offered = false;
    let soundDist = -1;
    for (let i = 0; i < 130 && !playbacksFor(world, 'welcome:old town').some(p => p.payload.sounded); i++) {
      await world.clock.advance(5_000);
      lat += 0.000054;
      if (!offered && lat >= UTC.lat + 0.0038) {
        world.candidates = [makeCandidate('Balboa Park', { lat: UTC.lat + 0.004, lng: UTC.lng })];
        offered = true;
      }
      if (lat >= UTC.lat + 0.004 && world.area?.neighborhood !== 'Old Town') {
        world.area = { neighborhood: 'Old Town', city: 'San Diego' };
      }
      tour.onPosition({ lat, lng: UTC.lng, speedMps: 1.2, headingDeg: 0 });
      if (soundDist < 0 && tour.view().nowPlaying?.label === 'Welcome to Old Town') {
        soundDist = Math.round((lat - (UTC.lat + 0.004)) * 111_320);
      }
    }
    const pb = playbacksFor(world, 'welcome:old town');
    check('the walking welcome sounded', pb.some(p => p.payload.sounded),
      JSON.stringify(pb.map(p => p.payload)));
    check('it took the channel inside the long telling\'s reach (~168 m observed; ~210 m = ~175 s × 1.2 m/s) — past a short telling\'s ~158 m, where the identical construction discharged',
      soundDist > 158 && soundDist < 210, `sound distance ≈ ${soundDist} m`);
    check('the staleness gate never fired', world.eventsOf('welcome_stale_dropped').length === 0,
      JSON.stringify(world.eventsOf('welcome_stale_dropped').map(e => e.payload)));
    check('the heard ledger filed it', world.heard.includes('Welcome to Old Town'),
      world.heard.join(' | '));
    tour.endTour();
  }

  suite('D12-6 welcome reach gate: a live welcome is judged once, by the outrun arm alone');
  {
    // A3's shape with the channel held twice as long, so the
    // live welcome is judged ~2 km past its anchor — the
    // ground where 391e470's flat gate (which sat in front of
    // the live arm and applied to every welcome) stole the
    // verdict and filed it as welcome_stale_dropped. Under
    // the merged gate the live arm owns the item: the outrun
    // discharge is silent, and the stale filing never fires.
    // The discharge files no playback, so the geometry
    // witness is the driver's own position at the moment the
    // channel frees — the only moment the waiting welcome can
    // be judged — captured from the step loop below.
    resetLocalStorage();
    const LJ = { lat: 32.85, lng: -117.25 };
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Alpha Park', { lat: LJ.lat, lng: LJ.lng })],
      library: [{ name: 'Alpha Park', lat: LJ.lat, lng: LJ.lng }],
      intros: [],
    });
    world.genStoryBehavior = prompt => {
      if (prompt.includes('NEIGHBORHOOD WELCOME') && prompt.includes('Bay Ho')) {
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
    const audio = new FakeAudio(world.clock, okPolicy({ library: 120_000, synth: 12_000 }));
    const { tour } = await healthyOpening(world, audio, LJ);
    world.area = { neighborhood: 'Bay Ho', city: 'San Diego' };
    let lat = LJ.lat + 0.01;
    tour.onPosition({ lat, lng: LJ.lng, speedMps: 21.6, headingDeg: 180 });
    // Step until Alpha Park leaves the channel: that
    // transition is the waiting welcome's dequeue moment.
    let sawAlpha = false;
    let judgeLat = lat;
    for (let i = 0; i < 48; i++) {
      await world.clock.advance(5_000);
      lat += 0.00097; // 21.6 m/s × 5 s ≈ 108 m per step
      tour.onPosition({ lat, lng: LJ.lng, speedMps: 21.6, headingDeg: 180 });
      if (tour.view().nowPlaying?.label === 'Alpha Park') sawAlpha = true;
      else if (sawAlpha) { judgeLat = lat; break; }
    }
    for (let i = 0; i < 6; i++) {
      await world.clock.advance(5_000);
      lat += 0.00097;
      tour.onPosition({ lat, lng: LJ.lng, speedMps: 21.6, headingDeg: 180 });
    }
    check('the live welcome was generated exactly once (no retry loop after discharge)',
      welcomePromptsFor(world, 'Bay Ho').length === 1,
      `prompts=${welcomePromptsFor(world, 'Bay Ho').length}`);
    check('the outrun welcome never sounded',
      !playbacksFor(world, 'welcome:bay ho').some(e => e.payload.sounded === true),
      JSON.stringify(playbacksFor(world, 'welcome:bay ho').map(e => e.payload)));
    check('it was judged beyond the old flat cut (driver > 1,600 m past the anchor when the channel freed)',
      (judgeLat - (LJ.lat + 0.01)) * 111_320 > 1600,
      `judge distance ≈ ${Math.round((judgeLat - (LJ.lat + 0.01)) * 111_320)} m`);
    check('the stale filing never fired — the live arm owned the verdict',
      world.eventsOf('welcome_stale_dropped').length === 0,
      JSON.stringify(world.eventsOf('welcome_stale_dropped').map(e => e.payload)));
    check('the discharge filed no story_dropped for the welcome',
      dropsFor(world, 'welcome:bay ho').length === 0,
      JSON.stringify(dropsFor(world, 'welcome:bay ho').map(e => e.payload)));
    check('the welcome is not heard-marked',
      !world.heard.includes('Welcome to Bay Ho'), world.heard.join(' | '));
    tour.endTour();
  }

  // ---------------------------------------------------------------
  // PN suites (Nov 16, 2026): partner class, v16.2 Slice 1. The
  // partner offer (Erik, Nov 16): a partner's PRE-APPROVED
  // tellings of its own property win their serve class near the
  // partner's site, and the approved set is FROZEN — drift
  // against live rows is detectable. The shipped registry holds
  // ONE dormant prospect (the Gaslamp Museum): dormant means
  // zero effect anywhere, and PN-1/PN-2 pin that as a tested
  // property, not a hope. Fixture partners exercise the active
  // paths. Direct-function suites follow the HI pattern;
  // PN-2 composes real plans (the composer's seat under a
  // one-story budget is the observable the rank term moves).
  const pnPartner = (over = {}) => ({
    id: 'pn-test-museum',
    name: 'PN Test Museum',
    status: 'active',
    site: { placeKeys: ['davis-horton house'], lat: 32.7106, lng: -117.160751 },
    serveRadiusM: 400,
    approvedStories: [
      { unitId: 'davis-horton house|landmark_origin', audioPath: 'library/davis-horton house/landmark_origin-approved.wav' },
    ],
    ...over,
  });
  const pnCandidate = (name, distanceM, over = {}) => ({
    name, lat: 32.7106, lng: -117.160751, source: 'registry', types: ['historic_site'],
    rating: null, userRatings: null, address: null, tier1: false, partnerId: null, score: 50,
    registry: null, distanceM, ...over,
  });

  suite('PN-1 partner class (freeform): an active partner site inside its radius earns Tier-1; outside, dormant, and non-partner ground do not');
  {
    const inside = pnCandidate('Davis-Horton House', 150);
    facts.applyPartnerBoost([inside], [pnPartner()]);
    check('the partner site at 150 m (radius 400) is Tier-1', inside.tier1 === true, `tier1=${inside.tier1}`);
    check('it carries the partner id', inside.partnerId === 'pn-test-museum', `partnerId=${inside.partnerId}`);

    const outside = pnCandidate('Davis-Horton House', 900);
    facts.applyPartnerBoost([outside], [pnPartner()]);
    check('the same site at 900 m is untouched — the boost is radius-bounded', outside.tier1 === false && outside.partnerId === null,
      `tier1=${outside.tier1} partnerId=${outside.partnerId}`);

    const bystander = pnCandidate('Balboa Theatre', 100);
    facts.applyPartnerBoost([bystander], [pnPartner()]);
    check('a non-partner candidate near the driver is untouched', bystander.tier1 === false && bystander.partnerId === null);

    const viaRegistry = pnCandidate('Davis Horton Museum', 100, { registry: { name: 'Davis-Horton House' } });
    facts.applyPartnerBoost([viaRegistry], [pnPartner()]);
    check('the registry-name dialect matches when the display name does not', viaRegistry.tier1 === true && viaRegistry.partnerId === 'pn-test-museum',
      `tier1=${viaRegistry.tier1}`);

    const dormant = pnCandidate('Davis-Horton House', 100);
    facts.applyPartnerBoost([dormant], [pnPartner({ status: 'dormant' })]);
    check('a DORMANT partner confers nothing, even at 100 m', dormant.tier1 === false && dormant.partnerId === null);

    const shipped = pnCandidate('Davis-Horton House', 100);
    facts.applyPartnerBoost([shipped]);
    check('the SHIPPED registry is inert in discovery (one dormant prospect, no active partners)',
      shipped.tier1 === false && shipped.partnerId === null && partners.activePartners().length === 0,
      `active=${partners.activePartners().length}`);
    check('the shipped registry holds exactly the dormant Gaslamp prospect',
      partners.PARTNERS.length === 1 && partners.PARTNERS[0].id === 'gaslamp-museum' && partners.PARTNERS[0].status === 'dormant',
      JSON.stringify(partners.PARTNERS.map(p => `${p.id}:${p.status}`)));
  }

  suite('PN-2 partner class (route): the approved telling takes the contested seat near the site; far site, dormant, and shipped registry leave the seat to the baseline');
  {
    const SITE = { lat: 32.7106, lng: -117.160751 };
    const pnUnit = (id, placeKey, placeName) => ({
      id, placeKey, placeName, angle: 'landmark_origin', lat: SITE.lat, lng: SITE.lng,
      durationSec: 150, topics: [], tone: 'warm', toneSecondary: null,
      audioPath: `library/${placeKey}/landmark_origin.wav`, storyText: 'x'.repeat(400),
    });
    const alpha = () => pnUnit('alpha museum|landmark_origin', 'alpha museum', 'Alpha Museum');
    const mango = () => pnUnit('mango museum|landmark_origin', 'mango museum', 'Mango Museum');
    const path = [{ lat: 32.7050, lng: SITE.lng }, { lat: 32.7160, lng: SITE.lng }];
    const dest = { lat: 32.7160, lng: SITE.lng };
    const input = { destinationText: 'North End', arrivalTimeMs: null, tone: null, topics: [], audience: 'standard' };
    // A one-story budget over two same-class, same-ground
    // candidates: exactly one seat exists, and the bucket's
    // rank order decides who takes it (verified shape, Nov 16).
    const seat = (partnerOpts) =>
      composeRoutePlan([alpha(), mango()], path, dest, 'North End', input, {
        nowMs: 0, heardKeys: new Set(), budgetSecOverride: 170, driveSec: null, ...partnerOpts,
      }).items.filter(i => i.kind === 'story').map(i => i.id);
    const mangoPartner = (over = {}) => ({
      id: 'pn-route-museum', name: 'PN Route Museum', status: 'active',
      site: { placeKeys: ['mango museum'], lat: SITE.lat, lng: SITE.lng },
      serveRadiusM: 400,
      approvedStories: [{ unitId: 'mango museum|landmark_origin', audioPath: 'library/mango museum/landmark_origin-approved.wav' }],
      ...over,
    });

    check('baseline (no partners): the baseline candidate takes the seat',
      JSON.stringify(seat({ partners: [] })) === JSON.stringify(['alpha museum|landmark_origin']),
      JSON.stringify(seat({ partners: [] })));
    check('partner active + path through the site: the APPROVED telling takes the seat',
      JSON.stringify(seat({ partners: [mangoPartner()] })) === JSON.stringify(['mango museum|landmark_origin']),
      JSON.stringify(seat({ partners: [mangoPartner()] })));
    check('partner active but the site is 10 km off the path: no effect — radius-bounded',
      JSON.stringify(seat({ partners: [mangoPartner({ site: { placeKeys: ['mango museum'], lat: 32.8000, lng: SITE.lng } })] })) === JSON.stringify(['alpha museum|landmark_origin']),
      JSON.stringify(seat({ partners: [mangoPartner({ site: { placeKeys: ['mango museum'], lat: 32.8000, lng: SITE.lng } })] })));
    check('partner DORMANT: no effect',
      JSON.stringify(seat({ partners: [mangoPartner({ status: 'dormant' })] })) === JSON.stringify(['alpha museum|landmark_origin']));
    check('shipped registry (no partners opt): composition is the baseline — the feature ships inert',
      JSON.stringify(seat({})) === JSON.stringify(['alpha museum|landmark_origin']));
  }

  suite('PN-3 frozen sets: drift against live rows is detected — audio moved, row missing, text changed; a clean set files nothing');
  {
    const frozenText = 'The approved telling, word for word.';
    const frozen = pnPartner({
      approvedStories: [
        { unitId: 'davis-horton house|landmark_origin', audioPath: 'library/davis-horton house/landmark_origin-approved.wav', textHash: hashString(frozenText) },
        { unitId: 'davis-horton house|landmark_people', audioPath: 'library/davis-horton house/landmark_people-approved.wav' },
      ],
    });
    const cleanRows = new Map([
      ['davis-horton house|landmark_origin', { audioPath: 'library/davis-horton house/landmark_origin-approved.wav', storyText: frozenText }],
      ['davis-horton house|landmark_people', { audioPath: 'library/davis-horton house/landmark_people-approved.wav', storyText: 'People text.' }],
    ]);
    check('a live set matching every pin files no drift',
      partners.checkFrozenSets([frozen], cleanRows).length === 0,
      JSON.stringify(partners.checkFrozenSets([frozen], cleanRows)));

    const movedRows = new Map(cleanRows);
    movedRows.set('davis-horton house|landmark_people', { audioPath: 'library/davis-horton house/landmark_people-swap-2027.wav', storyText: 'People text.' });
    const moved = partners.checkFrozenSets([frozen], movedRows);
    check('a re-rendered telling (the swap signature: audio_path moved) is flagged',
      moved.length === 1 && moved[0].kind === 'audio-moved' && moved[0].unitId === 'davis-horton house|landmark_people',
      JSON.stringify(moved));

    const missingRows = new Map(cleanRows);
    missingRows.delete('davis-horton house|landmark_origin');
    const missing = partners.checkFrozenSets([frozen], missingRows);
    check('a vanished row is flagged missing',
      missing.length === 1 && missing[0].kind === 'missing' && missing[0].actual === null,
      JSON.stringify(missing));

    const editedRows = new Map(cleanRows);
    editedRows.set('davis-horton house|landmark_origin', { audioPath: 'library/davis-horton house/landmark_origin-approved.wav', storyText: 'A quietly edited telling.' });
    const edited = partners.checkFrozenSets([frozen], editedRows);
    check('a text edit under the same audio is flagged when the pin recorded a text hash',
      edited.length === 1 && edited[0].kind === 'text-changed',
      JSON.stringify(edited));

    check('the shipped registry (empty approved set) cannot drift',
      partners.checkFrozenSets(partners.PARTNERS, new Map()).length === 0);
  }

  suite('PN-4 serve preference + unit-id helpers: the approved angle resolves for an active partner only');
  {
    check('unit ids split on the last pipe (corridor keys carry colons, never pipes)',
      partners.unitPlaceKey('sr-905 west: brown field to i-805|corridor') === 'sr-905 west: brown field to i-805' &&
      partners.unitAngle('sr-905 west: brown field to i-805|corridor') === 'corridor');
    check('an ACTIVE partner yields its approved angle for the place',
      partners.partnerApprovedAngleFor('davis-horton house', [pnPartner()]) === 'landmark_origin',
      `${partners.partnerApprovedAngleFor('davis-horton house', [pnPartner()])}`);
    check('a DORMANT partner yields no preference',
      partners.partnerApprovedAngleFor('davis-horton house', [pnPartner({ status: 'dormant' })]) === null);
    check('an unrelated place yields no preference',
      partners.partnerApprovedAngleFor('balboa park', [pnPartner()]) === null);
    check('the SHIPPED registry yields no preference anywhere (dormant)',
      partners.partnerApprovedAngleFor('davis-horton house') === null);
    check('partnerForUnit finds the owner of an approved story',
      partners.partnerForUnit('davis-horton house|landmark_origin', [pnPartner()])?.id === 'pn-test-museum');
    check('partnerForPlaceName matches on the normalized key (either dialect)',
      partners.partnerForPlaceName('Davis-Horton House', [pnPartner()])?.id === 'pn-test-museum' &&
      partners.partnerForPlaceName('davis-horton house', [pnPartner()])?.id === 'pn-test-museum');
  }

  // ---------------------------------------------------------------
  // CE suites (Nov 16, 2026): the current-events layer v1, v16.2
  // Slice 2. The freshness standard (stack plan ◆3, LEAN-ADOPT)
  // is enforced as pure gates: no known hours = no
  // recommendation, hours cached ≤ 7 days, "open now" computed
  // only from source periods, event times need a dated source
  // ≤ 48 h old. CE-1/CE-2 pin the gates, CE-3 the event gate,
  // CE-4 the discovery pipeline against a fixture provider,
  // CE-5 the Tour wiring (the harness seam fakes only the
  // network edge), CE-6 the shipped defaults. Fixture clock:
  // Wed Nov 18, 2026, 19:00 UTC = 11:00 in San Diego (UTC−8).
  const CE_NOW = Date.UTC(2026, 10, 18, 19, 0, 0);
  const CE_DAY_MS = 24 * 60 * 60 * 1000;
  const ceDaily = (openH, closeH) =>
    Array.from({ length: 7 }, (_, day) => ({ open: { day, hour: openH, minute: 0 }, close: { day, hour: closeH, minute: 0 } }));
  const ceHours = (over = {}) => ({
    periods: ceDaily(9, 21),
    utcOffsetMinutes: -480,
    businessStatus: 'OPERATIONAL',
    hoursKind: 'regular',
    fetchedAt: CE_NOW - 60_000,
    source: 'places',
    ...over,
  });
  const ceRaw = (over = {}) => ({
    placeId: 'ce-place-1',
    name: 'Ce Test Tacos',
    lat: 32.853,
    lng: -117.18,
    types: ['mexican_restaurant', 'restaurant'],
    rating: 4.6,
    userRatings: 800,
    address: '1 Test Way',
    editorial: null,
    servesVegetarianFood: null,
    hours: ceHours(),
    ...over,
  });
  const CE_ANCHOR = { lat: 32.853, lng: -117.18, kind: 'position' };
  const ceProvider = places => ({ fetchPlaces: async () => places });
  const CE_NO_MATCH = { topics: [], cuisines: [], drinks: [], activities: [], dietary: [] };
  const CE_NO_CONSTRAINTS = {
    budgetComfort: null, maxDetourMinutes: null, alcoholOk: null, usuallyWithKids: null,
    dogFriendly: null, walkingTolerance: null, surpriseTolerance: null, dietary: [],
  };
  const ceDiscover = (places, over = {}) =>
    currentEvents.discoverEventCandidates([CE_ANCHOR], {
      nowMs: CE_NOW, provider: ceProvider(places), match: CE_NO_MATCH,
      constraints: CE_NO_CONSTRAINTS, cache: null, ...over,
    });
  const ceMemStore = () => {
    let v = null;
    return { read: () => v, write: s => { v = s; }, clear: () => { v = null; } };
  };

  suite('CE-1 freshness gates (hours): fresh known hours pass; stale, unknown, missing, and non-operational records are silently ineligible');
  {
    const fresh = freshness.assessHours(ceHours(), CE_NOW);
    check('fresh daily hours (fetched 1 min ago) are eligible', fresh.eligible === true, JSON.stringify(fresh.failures));
    check('open-now is computed from the periods: Wed 11:00 inside 09:00–21:00 is open', fresh.openNow === true);
    check('the containing close is derived: closes 10 h after 11:00', fresh.closesAtMs === CE_NOW + 10 * 60 * 60 * 1000,
      `${fresh.closesAtMs} vs ${CE_NOW + 10 * 60 * 60 * 1000}`);

    const boundary = freshness.assessHours(ceHours({ fetchedAt: CE_NOW - 7 * CE_DAY_MS }), CE_NOW);
    check('hours cached exactly 7 days are still eligible (the standard is ≤ 7 days)', boundary.eligible === true);
    const stale = freshness.assessHours(ceHours({ fetchedAt: CE_NOW - 7 * CE_DAY_MS - 60_000 }), CE_NOW);
    check('hours cached 7 days + 1 minute are stale — ineligible', stale.eligible === false && stale.failures.includes('hours-stale'),
      JSON.stringify(stale.failures));
    check('a stale record leaks NO open-now claim (null, not a guess)', stale.openNow === null);
    const future = freshness.assessHours(ceHours({ fetchedAt: CE_NOW + 60_000 }), CE_NOW);
    check('a record dated in the future is corrupt, judged stale', future.eligible === false && future.failures.includes('hours-stale'));

    const missing = freshness.assessHours(null, CE_NOW);
    check('no record at all → no-hours-record', missing.eligible === false && missing.failures.includes('no-hours-record'));
    const noPeriods = freshness.assessHours(ceHours({ periods: null }), CE_NOW);
    check('a source that returned no hours → hours-unknown, no recommendation', noPeriods.eligible === false && noPeriods.failures.includes('hours-unknown') && noPeriods.openNow === null);
    const emptyPeriods = freshness.assessHours(ceHours({ periods: [] }), CE_NOW);
    check('an empty period list is unknown hours too', emptyPeriods.eligible === false && emptyPeriods.failures.includes('hours-unknown'));
    const noOffset = freshness.assessHours(ceHours({ utcOffsetMinutes: null }), CE_NOW);
    check('periods without a UTC offset cannot ground a time claim → hours-unknown', noOffset.eligible === false && noOffset.failures.includes('hours-unknown'));
    const malformed = freshness.assessHours(ceHours({ periods: [{ open: { day: 3 } }] }), CE_NOW);
    check('a malformed period (no hour) is not usable hours', malformed.eligible === false && malformed.failures.includes('hours-unknown'));

    const permClosed = freshness.assessHours(ceHours({ businessStatus: 'CLOSED_PERMANENTLY' }), CE_NOW);
    check('a permanently closed place is ineligible however fresh its hours', permClosed.eligible === false && permClosed.failures.includes('not-operational'));

    const closedNow = freshness.assessHours(ceHours({ periods: ceDaily(13, 21) }), CE_NOW);
    check('freshness is not open-now: a 13:00–21:00 place at 11:00 is ELIGIBLE and honestly closed',
      closedNow.eligible === true && closedNow.openNow === false, JSON.stringify(closedNow));
    check('its next opening is derived: opens 2 h after 11:00', closedNow.opensAtMs === CE_NOW + 2 * 60 * 60 * 1000);
  }

  suite('CE-2 open-now computation: overnight periods, the week wrap, the 24 h shape, and closed means closed');
  {
    // Friday 22:00 → Saturday 02:00 (the close carries Saturday's number).
    const friNight = [{ open: { day: 5, hour: 22, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }];
    const sat0130 = Date.UTC(2026, 10, 21, 9, 30, 0); // Sat 01:30 San Diego
    const overnight = freshness.assessHours(ceHours({ periods: friNight, fetchedAt: sat0130 - 1000 }), sat0130);
    check('an overnight period holds at Sat 01:30', overnight.eligible === true && overnight.openNow === true, JSON.stringify(overnight));
    check('its close is 30 minutes out', overnight.closesAtMs === sat0130 + 30 * 60_000);

    // Saturday 22:00 → Sunday 02:00: the close is next-cycle ground.
    const satNight = [{ open: { day: 6, hour: 22, minute: 0 }, close: { day: 0, hour: 2, minute: 0 } }];
    const sun0100 = Date.UTC(2026, 10, 22, 9, 0, 0); // Sun 01:00 San Diego
    const wrap = freshness.assessHours(ceHours({ periods: satNight, fetchedAt: sun0100 - 1000 }), sun0100);
    check('a period closing across the week boundary still holds at Sun 01:00', wrap.eligible === true && wrap.openNow === true, JSON.stringify(wrap));
    check('its close is 60 minutes out', wrap.closesAtMs === sun0100 + 60 * 60_000);

    const always = freshness.assessHours(ceHours({ periods: [{ open: { day: 0, hour: 0, minute: 0 } }] }), CE_NOW);
    check('the 24 h shape (one open, no close) is open — with NO fabricated close', always.openNow === true && always.closesAtMs === null,
      JSON.stringify(always));

    const wed2300 = Date.UTC(2026, 10, 19, 7, 0, 0); // Wed 23:00 San Diego
    const night = freshness.assessHours(ceHours({ fetchedAt: wed2300 - 1000 }), wed2300);
    check('the same 09:00–21:00 schedule computes CLOSED at 23:00 — computed, never assumed', night.openNow === false);
    check('the next opening is derived across midnight: Thu 09:00, 10 h out', night.opensAtMs === wed2300 + 10 * 60 * 60 * 1000);
  }

  suite('CE-3 freshness gates (events): a named event needs a dated source ≤ 48 h old and a future start');
  {
    const ev = (over = {}) => ({ title: 'Ce Fest', startsAtMs: CE_NOW + 2 * 60 * 60 * 1000, sourceAtMs: CE_NOW - 60 * 60 * 1000, sourceName: 'ce-feed', ...over });
    check('a dated (1 h), future event is eligible', freshness.assessEvent(ev(), CE_NOW).eligible === true);
    check('a dated (47 h) event is still inside the window', freshness.assessEvent(ev({ sourceAtMs: CE_NOW - 47 * 60 * 60 * 1000 }), CE_NOW).eligible === true);
    const undated = freshness.assessEvent(ev({ sourceAtMs: null }), CE_NOW);
    check('an undated event is ineligible however plausible', undated.eligible === false && undated.failures.includes('event-undated'));
    const stale = freshness.assessEvent(ev({ sourceAtMs: CE_NOW - 49 * 60 * 60 * 1000 }), CE_NOW);
    check('a 49 h-old source is stale', stale.eligible === false && stale.failures.includes('event-source-stale'));
    const future = freshness.assessEvent(ev({ sourceAtMs: CE_NOW + 60_000 }), CE_NOW);
    check('a source dated in the future is corrupt, not fresh', future.eligible === false && future.failures.includes('event-source-future'));
    const past = freshness.assessEvent(ev({ startsAtMs: CE_NOW - 60_000 }), CE_NOW);
    check('an already-started event is ineligible', past.eligible === false && past.failures.includes('event-past'));

    const feed = { fetchEvents: async () => [ev(), ev({ title: 'Undated', sourceAtMs: null }), ev({ title: 'Stale', sourceAtMs: CE_NOW - 72 * 60 * 60 * 1000 })] };
    const served = await currentEvents.discoverFeedEvents([CE_ANCHOR], { nowMs: CE_NOW, eventsFeed: feed });
    check('the feed path serves only the gate-passing event', served.length === 1 && served[0].title === 'Ce Fest', JSON.stringify(served.map(e => e.title)));
    const none = await currentEvents.discoverFeedEvents([CE_ANCHOR], { nowMs: CE_NOW });
    check('the shipped NO_EVENTS_FEED serves nothing', none.length === 0);
  }

  suite('CE-4 discovery pipeline: only freshness-passing eat/drink/do candidates are ranked; profile, constraints, shelf, and cache shape the pool');
  {
    const barPeriods = Array.from({ length: 7 }, (_, day) => ({
      open: { day, hour: 17, minute: 0 },
      close: { day: (day + 1) % 7, hour: 2, minute: 0 },
    }));
    const ceBar = (over = {}) => ceRaw({
      placeId: 'ce-bar', name: 'Ce Test Bar', types: ['bar'],
      hours: ceHours({ periods: barPeriods }), ...over,
    });

    const pool = await ceDiscover([
      ceRaw(),
      ceRaw({ placeId: 'ce-stale', name: 'Ce Stale Cafe', hours: ceHours({ fetchedAt: CE_NOW - 8 * CE_DAY_MS }) }),
      ceRaw({ placeId: 'ce-nohours', name: 'Ce No-Hours Bakery', types: ['bakery'], hours: ceHours({ periods: null }) }),
      ceBar(),
      ceRaw({ placeId: 'ce-permclosed', name: 'Ce Gone', hours: ceHours({ businessStatus: 'CLOSED_PERMANENTLY' }) }),
      ceRaw({ placeId: 'ce-gas', name: 'Ce Gas', types: ['gas_station'] }),
    ]);
    check('stale hours, no hours, permanently closed, and non-eat/drink/do supply are all silently excluded',
      JSON.stringify(pool.map(c => c.placeId)) === JSON.stringify(['ce-place-1', 'ce-bar']),
      JSON.stringify(pool.map(c => c.placeId)));
    check('the open-now candidate outranks the verifiably closed one', pool[0].placeId === 'ce-place-1' && pool[0].openNow === true && pool[1].openNow === false);
    check('kinds classify from types', pool[0].kind === 'eat' && pool[1].kind === 'drink');
    check('candidates carry their freshness provenance', pool[0].hoursFetchedAt === CE_NOW - 60_000 && pool[0].detourMinutes === null);

    const far = await ceDiscover([ceRaw({ placeId: 'ce-far', name: 'Ce Far', lat: 32.898, lng: -117.18 })]);
    check('a place beyond the radius is not a candidate', far.length === 0);

    const dedup = await currentEvents.discoverEventCandidates(
      [CE_ANCHOR, { lat: 32.9, lng: -117.18, kind: 'destination' }],
      { nowMs: CE_NOW, provider: ceProvider([ceRaw()]), match: CE_NO_MATCH, constraints: CE_NO_CONSTRAINTS, cache: null },
    );
    check('a place found from two anchors is kept once, from the nearest', dedup.length === 1 && dedup[0].anchorKind === 'position');

    const shelf = await ceDiscover([ceRaw()], { shelfKeys: new Set(['ce test tacos']) });
    const noShelf = await ceDiscover([ceRaw()]);
    check('a shelf story for the place is ranking color: flagged, and worth points',
      shelf[0].hasShelfStory === true && noShelf[0].hasShelfStory === false && shelf[0].score > noShelf[0].score,
      `shelf=${shelf[0].score} plain=${noShelf[0].score}`);

    const italian = ceRaw({ placeId: 'ce-italian', name: 'Ce Italian', types: ['italian_restaurant', 'restaurant'], rating: 4.7 });
    const neutral = await ceDiscover([italian, ceRaw()]);
    check('neutral ranking follows popularity: the 4.7 Italian leads the 4.6 Mexican',
      neutral[0].placeId === 'ce-italian', JSON.stringify(neutral.map(c => `${c.placeId}:${c.score.toFixed(1)}`)));
    const matched = await ceDiscover([italian, ceRaw()], {
      match: { ...CE_NO_MATCH, cuisines: ['tacos-mexican'] },
    });
    check('a declared cuisine match lifts its place above a more popular non-match (the profile is consumed)',
      matched[0].placeId === 'ce-place-1', JSON.stringify(matched.map(c => `${c.placeId}:${c.score.toFixed(1)}`)));

    const noAlcohol = await ceDiscover([ceBar()], { constraints: { ...CE_NO_CONSTRAINTS, alcoholOk: false } });
    check('alcoholOk=false filters alcohol-primary places out', noAlcohol.length === 0);
    const withKids = await ceDiscover([ceBar()], { constraints: { ...CE_NO_CONSTRAINTS, usuallyWithKids: true } });
    check('usually-with-kids filters bars out', withKids.length === 0);
    const vegBlocked = await ceDiscover([ceRaw({ servesVegetarianFood: false })], {
      constraints: { ...CE_NO_CONSTRAINTS, dietary: ['vegetarian'] },
    });
    check('a declared vegetarian need drops a place the source says does not serve vegetarian food', vegBlocked.length === 0);
    const vegUnknown = await ceDiscover([ceRaw({ servesVegetarianFood: null })], {
      constraints: { ...CE_NO_CONSTRAINTS, dietary: ['vegetarian'] },
    });
    check('unknown dietary data never filters a place out (no guessing, either direction)', vegUnknown.length === 1);

    const defaulted = await currentEvents.discoverEventCandidates([CE_ANCHOR], {
      nowMs: CE_NOW, provider: ceProvider([ceRaw()]), cache: null,
    });
    check('the default profile reads (the live matchInputs/getConstraints) stay neutral on an empty profile',
      defaulted.length === 1 && defaulted[0].placeId === 'ce-place-1');

    // Cache: a fetch writes it; a provider-empty day can still
    // serve from it — gated at serve time, like any fetch.
    const store = ceMemStore();
    const fetched = await ceDiscover([ceRaw()], { cache: store });
    check('a successful fetch populates the hours cache', fetched.length === 1 && currentEvents.loadHoursCache(store).has('ce-place-1'));
    const fromCache = await ceDiscover([], { provider: ceProvider([]), cache: store });
    check('a provider-empty discovery falls back to fresh cached records, provenance intact',
      fromCache.length === 1 && fromCache[0].hoursFetchedAt === CE_NOW - 60_000, JSON.stringify(fromCache.map(c => c.placeId)));
    const staleStore = ceMemStore();
    staleStore.write(JSON.stringify({ v: 1, entries: { 'ce-place-1': ceRaw({ hours: ceHours({ fetchedAt: CE_NOW - 8 * CE_DAY_MS }) }) } }));
    const staleCache = await ceDiscover([], { provider: ceProvider([]), cache: staleStore });
    check('a stale cached record is exactly as ineligible as a stale fetch', staleCache.length === 0);
  }

  suite('CE-5 tour wiring: the serve cycle refreshes the pool, diagnostics + telemetry report it, and the cadence gate holds');
  {
    const ceFixture = (over = {}) => ({
      placeId: 'ce-tour-1', name: 'Ce Tour Tacos', lat: 32.853, lng: -117.18, kind: 'eat',
      types: ['restaurant'], rating: 4.5, userRatings: 100, address: null, editorial: null,
      distanceM: 50, anchorKind: 'position', openNow: true, closesAtMs: null, opensAtMs: null,
      hoursFetchedAt: CE_NOW, hasShelfStory: false, score: 40, detourMinutes: null, event: null, ...over,
    });
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
      eventCandidates: [ceFixture(), ceFixture({ placeId: 'ce-tour-2', name: 'Ce Tour Bar', openNow: false })],
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);
    await world.clock.advance(40_000);
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(10_000);
    check('a serve cycle asks the layer for candidates', world.eventCandidateCalls.length >= 1, `calls=${world.eventCandidateCalls.length}`);
    check('the ask is anchored on the driver, with the shelf key set injected',
      world.eventCandidateCalls[0].anchors[0].kind === 'position' && world.eventCandidateCalls[0].opts.shelfKeys instanceof Set);
    check('the pool holds what the layer returned', tour.currentEventCandidates().length === 2);
    check('diagnostics report the pool size', tour.view().diagnostics.eventCandidates === 2, `${tour.view().diagnostics.eventCandidates}`);
    const poolEvents = world.eventsOf('current_events_pool');
    check('current_events_pool telemetry files the count + open-now count',
      poolEvents.length >= 1 && poolEvents[0].payload.count === 2 && poolEvents[0].payload.open_now === 1,
      JSON.stringify(poolEvents.map(e => e.payload)));
    const callsBefore = world.eventCandidateCalls.length;
    tour.onPosition({ lat: UTC.lat + 0.006, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(10_000);
    check('a second cycle inside the ground cell + window does not re-ask', world.eventCandidateCalls.length === callsBefore,
      `calls=${world.eventCandidateCalls.length} before=${callsBefore}`);

    resetLocalStorage();
    const plain = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
    });
    const plainAudio = new FakeAudio(plain.clock, okPolicy());
    const plainTour = await startAt(plain, plainAudio, UTC);
    await plain.clock.advance(40_000);
    plainTour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await plain.clock.advance(10_000);
    check('the default world still asks — and the pool simply stays empty',
      plain.eventCandidateCalls.length >= 1 && plainTour.currentEventCandidates().length === 0 &&
      plainTour.view().diagnostics.eventCandidates === 0);
  }

  suite('CE-6 shipped defaults: the standard is the proposed standard, the feed is absent, kinds classify');
  {
    check('the standard is exactly the proposed floor (7 d hours / 48 h events / known-hours required / source-only open-now)',
      freshness.FRESHNESS_STANDARD.hoursMaxCacheAgeMs === 7 * CE_DAY_MS &&
      freshness.FRESHNESS_STANDARD.eventMaxSourceAgeMs === 48 * 60 * 60 * 1000 &&
      freshness.FRESHNESS_STANDARD.requireKnownHours === true &&
      freshness.FRESHNESS_STANDARD.openNowFromSourceOnly === true,
      JSON.stringify(freshness.FRESHNESS_STANDARD));
    check('kind classification: restaurant → eat, bar → drink, coffee shop → drink, museum → do, gas station → none',
      currentEvents.kindForTypes(['mexican_restaurant']) === 'eat' &&
      currentEvents.kindForTypes(['bar']) === 'drink' &&
      currentEvents.kindForTypes(['coffee_shop']) === 'drink' &&
      currentEvents.kindForTypes(['museum']) === 'do' &&
      currentEvents.kindForTypes(['gas_station']) === null);
    check('an alcohol type wins the kind over food (a bar-restaurant is a drink candidate)',
      currentEvents.kindForTypes(['restaurant', 'bar']) === 'drink');
  }

  // CE-7 (Nov 17, 2026, v16.2 audit fix): the key walk. The
  // layer's Places calls walk every configured key — a 403
  // restriction block (or any failure) moves to the next key,
  // a key that answers is definitive, and a no-answer walk
  // earns one retry pass after the maps backoff — the
  // route-mode discipline. Before the fix the provider took
  // a single key and returned [] on its first error, so a
  // restriction-blocked first key silently emptied the pool.
  // The spend pins: the whole walk for one anchor is ONE
  // metered ask — key attempts are not separate dispatches.
  suite('CE-7 the key walk: a blocked key moves to the next, an answering key is definitive, one retry pass, one charge per ask');
  {
    const ce7Wire = {
      id: 'ce7-place', displayName: { text: 'Ce7 Walk Tacos' },
      location: { latitude: 32.853, longitude: -117.18 },
      rating: 4.5, userRatingCount: 100, types: ['restaurant'],
      formattedAddress: '1 Walk Way', businessStatus: 'OPERATIONAL',
      utcOffsetMinutes: -480,
      regularOpeningHours: { periods: ceDaily(9, 21) },
    };
    const ce7Res = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    const ce7Fetch = behavior => {
      const calls = [];
      const fn = async (url, init) => {
        const key = init.headers['X-Goog-Api-Key'];
        calls.push(key);
        return behavior(key, calls.filter(k => k === key).length);
      };
      fn.calls = calls;
      return fn;
    };
    const noSleep = async () => {};

    const walk1 = ce7Fetch(key => (key === 'key-blocked' ? ce7Res(403, { error: { status: 'PERMISSION_DENIED' } }) : ce7Res(200, { places: [ce7Wire] })));
    const walked = await currentEvents.fetchPlacesWithKeyWalk(CE_ANCHOR, 1200, ['key-blocked', 'key-open', 'key-third'], walk1, { sleep: noSleep });
    check('a 403 on the first key moves to the next key, whose answer serves the call',
      walked.length === 1 && walked[0].name === 'Ce7 Walk Tacos', JSON.stringify(walked.map(p => p.placeId)));
    check('the walk stops at the answering key (the third key is never tried)',
      JSON.stringify(walk1.calls) === JSON.stringify(['key-blocked', 'key-open']), JSON.stringify(walk1.calls));

    const walk2 = ce7Fetch(() => ce7Res(200, { places: [] }));
    const empty = await currentEvents.fetchPlacesWithKeyWalk(CE_ANCHOR, 1200, ['key-a', 'key-b'], walk2, { sleep: noSleep });
    check('a key that answers with zero places is definitive — no further keys, no retry pass',
      empty.length === 0 && walk2.calls.length === 1, JSON.stringify(walk2.calls));

    const sleeps = [];
    const walk3 = ce7Fetch((key, nth) => {
      if (key === 'key-open') return nth >= 2 ? ce7Res(200, { places: [ce7Wire] }) : ce7Res(500);
      if (key === 'key-blocked') return ce7Res(403);
      throw new Error('transport down');
    });
    const retried = await currentEvents.fetchPlacesWithKeyWalk(CE_ANCHOR, 1200, ['key-blocked', 'key-open', 'key-throws'], walk3, {
      sleep: async ms => { sleeps.push(ms); },
    });
    check('when no key answers, one retry pass after the 1.2 s maps backoff finds the recovered key',
      retried.length === 1 && JSON.stringify(sleeps) === JSON.stringify([1200]) && walk3.calls.length === 5,
      `places=${retried.length} sleeps=${JSON.stringify(sleeps)} calls=${walk3.calls.length}`);

    const walk4 = ce7Fetch(() => ce7Res(403));
    const dead = await currentEvents.fetchPlacesWithKeyWalk(CE_ANCHOR, 1200, ['key-a', 'key-b'], walk4, { sleep: noSleep });
    check('every key failing both passes fails soft to empty — never an exception',
      dead.length === 0 && walk4.calls.length === 4, `calls=${walk4.calls.length}`);

    const walk5 = ce7Fetch(() => ce7Res(200, { places: [ce7Wire] }));
    const noKeys = await currentEvents.fetchPlacesWithKeyWalk(CE_ANCHOR, 1200, [], walk5, { sleep: noSleep });
    check('no configured keys never walks at all', noKeys.length === 0 && walk5.calls.length === 0);

    // The shipped provider through discovery, with the
    // bundle's env keys (fake-places → fake-maps →
    // fake-gemini): the first is restriction-blocked, the
    // second answers. Two HTTP attempts, ONE metered ask.
    const realFetch = globalThis.fetch;
    const envCalls = [];
    globalThis.fetch = async (url, init) => {
      const key = init.headers['X-Goog-Api-Key'];
      envCalls.push(key);
      if (key === 'fake-places') return ce7Res(403, { error: { status: 'PERMISSION_DENIED' } });
      if (key === 'fake-maps') return ce7Res(200, { places: [ce7Wire] });
      throw new Error('the walk should never reach the third key');
    };
    try {
      const spendStore = ceMemStore();
      const spendEvents = [];
      const pool = await currentEvents.discoverEventCandidates([CE_ANCHOR], {
        nowMs: CE_NOW, match: CE_NO_MATCH, constraints: CE_NO_CONSTRAINTS, cache: null,
        spendStore, onSpendEvent: (type, payload) => spendEvents.push({ type, payload }),
      });
      check('through discovery, the shipped provider walks past the blocked env key and the pool is NOT empty',
        pool.length === 1 && pool[0].placeId === 'ce7-place', JSON.stringify(pool.map(c => c.placeId)));
      check('the walk made exactly two HTTP attempts and stopped at the answering key',
        JSON.stringify(envCalls) === JSON.stringify(['fake-places', 'fake-maps']), JSON.stringify(envCalls));
      const asks = spendEvents.filter(e => e.type === 'live_spend_ask');
      check('the whole walk is ONE metered ask: one live_spend_ask, one $0.040 charge for the anchor',
        asks.length === 1 && liveSpend.monthSpend(spendStore, CE_NOW).microUsd === 40_000 &&
        liveSpend.monthSpend(spendStore, CE_NOW).asks === 1,
        JSON.stringify(spendEvents.map(e => e.type)));
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  // ---------------------------------------------------------------
  // PC suites (Nov 16, 2026): profile in the composer, v16.2
  // Slice 3. The stored taste profile (declared + inferred
  // story-topic affinities, profile.ts) becomes a SOFT ranking
  // signal: freeform discovery gains a capped score boost
  // (facts.applyProfileBoost), the route composer's bucket
  // chain and climax tie-break gain a rank term seated under
  // tone (profileRank.ts owns the doctrine). The fences pinned
  // here: selection-only; parity with no / empty / paused
  // profile; inferred strictly weaker than declared; no
  // crossing of a class boundary (the structural score steps
  // in freeform, the house class and this drive's tone steer
  // in route); declared constraints never leak into the
  // signal. PC-1/PC-2 follow the PN-1 direct-function pattern,
  // PC-5/PC-7 the PN-2 contested-seat pattern.
  const pcCandidate = (name, score, over = {}) => ({
    name, lat: 32.7157, lng: -117.1611, source: 'major', types: [],
    rating: null, userRatings: null, address: null, tier1: false, partnerId: null, score,
    registry: null, distanceM: 300, ...over,
  });
  const pcDeclared = topic => [{ topic, weight: 1, source: 'declared' }];
  const pcInferred = (topic, weight) => [{ topic, weight, source: 'inferred' }];

  suite('PC-1 profile boost (freeform): declared topics add the capped boost, inferred add proportionally less, empty input is a no-op');
  {
    check('candidate topics resolve from the shelf tags (Balboa Stadium carries Sport; Allied Gardens carries San Diego River)',
      facts.candidateTopics(pcCandidate('Balboa Stadium', 0)).includes('Sport') &&
      facts.candidateTopics(pcCandidate('Allied Gardens', 0)).includes('San Diego River'),
      JSON.stringify(facts.candidateTopics(pcCandidate('Balboa Stadium', 0))));

    const park = pcCandidate('Balboa Park', 50);
    const stadium = pcCandidate('Balboa Stadium', 50);
    const gardens = pcCandidate('Allied Gardens', 50);
    facts.applyProfileBoost([park, stadium, gardens], pcDeclared('Sport'));
    check('a declared affinity adds exactly the cap (8) to a matching candidate',
      stadium.score === 58, `score=${stadium.score}`);
    check('non-matching candidates are untouched', park.score === 50 && gardens.score === 50,
      `${park.score}/${gardens.score}`);

    const stadiumInf = pcCandidate('Balboa Stadium', 50);
    facts.applyProfileBoost([stadiumInf], pcInferred('Sport', 0.5));
    check('an inferred affinity at 0.5 adds half the cap — strictly weaker than declared',
      stadiumInf.score === 54, `score=${stadiumInf.score}`);

    const untouched = pcCandidate('Balboa Stadium', 50);
    facts.applyProfileBoost([untouched], []);
    check('an empty topic list is an exact no-op', untouched.score === 50);
  }

  suite('PC-2 profile boost (freeform order): near-ties swap within reach of the cap, structural steps never do');
  {
    const order = list => [...list].sort((a, b) => b.score - a.score).map(c => c.name);

    const a1 = pcCandidate('Balboa Park', 55);
    const b1 = pcCandidate('Balboa Stadium', 50);
    facts.applyProfileBoost([a1, b1], pcDeclared('Sport'));
    check('declared: a 5-point deficit flips (50 + 8 > 55)',
      JSON.stringify(order([a1, b1])) === JSON.stringify(['Balboa Stadium', 'Balboa Park']),
      JSON.stringify(order([a1, b1])));

    const a2 = pcCandidate('Balboa Park', 55);
    const b2 = pcCandidate('Balboa Stadium', 50);
    facts.applyProfileBoost([a2, b2], pcInferred('Sport', 0.5));
    check('inferred 0.5: the same deficit holds (50 + 4 < 55)',
      JSON.stringify(order([a2, b2])) === JSON.stringify(['Balboa Park', 'Balboa Stadium']),
      JSON.stringify(order([a2, b2])));

    const a3 = pcCandidate('Balboa Park', 70);
    const b3 = pcCandidate('Balboa Stadium', 50);
    facts.applyProfileBoost([a3, b3], pcDeclared('Sport'));
    check('a 20-point structural step (the house-importance graduation) is never bridged (50 + 8 < 70)',
      JSON.stringify(order([a3, b3])) === JSON.stringify(['Balboa Park', 'Balboa Stadium']),
      JSON.stringify(order([a3, b3])));
  }

  suite('PC-3 profile boost (freeform, shipped store): the default read path honors the profile — and its pause');
  {
    profile.wipeProfile();
    const fresh = pcCandidate('Balboa Stadium', 50);
    facts.applyProfileBoost([fresh]);
    check('no profile on the device: the default path is an exact no-op', fresh.score === 50);

    profile.setDeclaredTaste('storyTopics', ['Sport'], 'pc-sim');
    const declared = pcCandidate('Balboa Stadium', 50);
    facts.applyProfileBoost([declared]);
    check('a declared story-topic on the device feeds the default path (+8)',
      declared.score === 58, `score=${declared.score}`);

    profile.setPaused(true);
    const paused = pcCandidate('Balboa Stadium', 50);
    facts.applyProfileBoost([paused]);
    check('paused: the default path is an exact no-op again (pause means pause)', paused.score === 50);
    profile.wipeProfile();
  }

  suite('PC-4 profile rank seam: weights resolve strongest-topic, declared over inferred, none is neutral');
  {
    const empty = profileRank.profileWeightMap(undefined);
    check('no weights: every rank reads the neutral 1',
      profileRank.profileRankOf(['Sport'], empty) === 1 && profileRank.profileRankOf([], empty) === 1);
    const mixed = profileRank.profileWeightMap([
      { topic: 'Sport', weight: 1, source: 'declared' },
      { topic: 'Film', weight: 0.3, source: 'inferred' },
    ]);
    check('a declared match ranks 0; an inferred match lands strictly between; a miss reads 1',
      profileRank.profileRankOf(['Sport'], mixed) === 0 &&
      Math.abs(profileRank.profileRankOf(['Film'], mixed) - 0.7) < 1e-9 &&
      profileRank.profileRankOf(['Coast'], mixed) === 1);
    check('a multi-topic unit takes its strongest topic',
      profileRank.profileRankOf(['Coast', 'Film', 'Sport'], mixed) === 0);
    check('the score form is the cap times the weight, and the cap is 8',
      profileRank.profileScoreBoost(['Film'], mixed) === profileRank.PROFILE_FREEFORM_BOOST_MAX * 0.3 &&
      profileRank.PROFILE_FREEFORM_BOOST_MAX === 8);
  }

  // PC-5/PC-6 share the contested-seat fixture (the PN-2 shape):
  // two same-class, same-ground candidates, a one-story budget,
  // the bucket's rank order decides the seat.
  const PC_SITE = { lat: 32.7106, lng: -117.160751 };
  const pcUnit = (id, placeKey, placeName, topics, over = {}) => ({
    id, placeKey, placeName, angle: 'landmark_origin', lat: PC_SITE.lat, lng: PC_SITE.lng,
    durationSec: 150, topics, tone: 'warm', toneSecondary: null,
    audioPath: `library/${placeKey}/landmark_origin.wav`, storyText: 'x'.repeat(400), ...over,
  });
  const pcAlpha = () => pcUnit('alpha museum|landmark_origin', 'alpha museum', 'Alpha Museum', ['Film']);
  const pcMango = () => pcUnit('mango museum|landmark_origin', 'mango museum', 'Mango Museum', ['Sport']);
  const pcPath = [{ lat: 32.7050, lng: PC_SITE.lng }, { lat: 32.7160, lng: PC_SITE.lng }];
  const pcDest = { lat: 32.7160, lng: PC_SITE.lng };
  const pcInput = { destinationText: 'North End', arrivalTimeMs: null, tone: null, topics: [], audience: 'standard' };
  const pcSeat = (opts = {}, units = [pcAlpha(), pcMango()], inp = pcInput) =>
    composeRoutePlan(units, pcPath, pcDest, 'North End', inp, {
      nowMs: 0, heardKeys: new Set(), budgetSecOverride: 170, driveSec: null, ...opts,
    }).items.filter(i => i.kind === 'story').map(i => i.id);

  suite('PC-5 profile rank (route): the seat follows declared over inferred over none; tone and house class stay senior');
  {
    check('no profile opt: the baseline candidate takes the seat (parity)',
      JSON.stringify(pcSeat()) === JSON.stringify(['alpha museum|landmark_origin']),
      JSON.stringify(pcSeat()));
    check('explicitly empty weights: still the baseline (parity)',
      JSON.stringify(pcSeat({ profileTopics: [] })) === JSON.stringify(['alpha museum|landmark_origin']));
    check('a declared affinity takes the seat',
      JSON.stringify(pcSeat({ profileTopics: pcDeclared('Sport') })) === JSON.stringify(['mango museum|landmark_origin']),
      JSON.stringify(pcSeat({ profileTopics: pcDeclared('Sport') })));
    check('an inferred affinity takes the seat when nothing competes',
      JSON.stringify(pcSeat({ profileTopics: pcInferred('Sport', 0.4) })) === JSON.stringify(['mango museum|landmark_origin']));
    check('declared beats inferred head-to-head (Film declared vs Sport inferred 0.99)',
      JSON.stringify(pcSeat({ profileTopics: [...pcDeclared('Film'), ...pcInferred('Sport', 0.99)] })) === JSON.stringify(['alpha museum|landmark_origin']));
    check('and the mirror: Sport declared beats Film inferred 0.99',
      JSON.stringify(pcSeat({ profileTopics: [...pcInferred('Film', 0.99), ...pcDeclared('Sport')] })) === JSON.stringify(['mango museum|landmark_origin']));

    const mangoGrand = () => pcUnit('mango museum|landmark_origin', 'mango museum', 'Mango Museum', ['Sport'], { tone: 'grand' });
    check("this drive's tone steer stays senior to the stored profile (tone-matched alpha beats profile-matched mango)",
      JSON.stringify(pcSeat({ profileTopics: pcDeclared('Sport') }, [pcAlpha(), mangoGrand()], { ...pcInput, tone: 'warm' })) === JSON.stringify(['alpha museum|landmark_origin']),
      JSON.stringify(pcSeat({ profileTopics: pcDeclared('Sport') }, [pcAlpha(), mangoGrand()], { ...pcInput, tone: 'warm' })));

    const mangoHouseClass = () => pcUnit('mango museum|landmark_origin', 'mango museum', 'Mango Museum', ['Sport', 'Architecture']);
    check('the house class stays senior: a declared affinity cannot promote a house-class story across the boundary',
      JSON.stringify(pcSeat({ profileTopics: pcDeclared('Sport') }, [pcAlpha(), mangoHouseClass()])) === JSON.stringify(['alpha museum|landmark_origin']),
      JSON.stringify(pcSeat({ profileTopics: pcDeclared('Sport') }, [pcAlpha(), mangoHouseClass()])));
  }

  suite('PC-6 profile rank (route, shipped store): matchInputs feeds the composer; pause restores parity');
  {
    profile.wipeProfile();
    profile.setDeclaredTaste('storyTopics', ['Sport'], 'pc-sim');
    const live = profile.matchInputs().topics;
    check('the store read path yields the declared weight',
      live.length === 1 && live[0].topic === 'Sport' && live[0].weight === 1 && live[0].source === 'declared',
      JSON.stringify(live));
    check('composer + store weights: the affinity takes the seat',
      JSON.stringify(pcSeat({ profileTopics: live })) === JSON.stringify(['mango museum|landmark_origin']),
      JSON.stringify(pcSeat({ profileTopics: live })));
    profile.setPaused(true);
    check('paused: matchInputs empties and the seat returns to the baseline',
      profile.matchInputs().topics.length === 0 &&
      JSON.stringify(pcSeat({ profileTopics: profile.matchInputs().topics })) === JSON.stringify(['alpha museum|landmark_origin']));
    profile.wipeProfile();
  }

  suite('PC-7 profile rank (climax): the tie-break hears the profile; without it the longer story closes');
  {
    const climaxUnit = (id, placeKey, placeName, topics, durationSec) => ({
      id, placeKey, placeName, angle: 'landmark_origin', lat: pcDest.lat, lng: pcDest.lng,
      durationSec, topics, tone: 'warm', toneSecondary: null,
      audioPath: `library/${placeKey}/landmark_origin.wav`, storyText: 'x'.repeat(400),
    });
    const alpha = () => climaxUnit('alpha museum|landmark_origin', 'alpha museum', 'Alpha Museum', ['Film'], 200);
    const mango = () => climaxUnit('mango museum|landmark_origin', 'mango museum', 'Mango Museum', ['Sport'], 120);
    const planIds = (opts = {}) =>
      composeRoutePlan([alpha(), mango()], pcPath, pcDest, 'North End', pcInput, {
        nowMs: 0, heardKeys: new Set(), budgetSecOverride: 400, driveSec: null, ...opts,
      }).items.filter(i => i.kind === 'story').map(i => i.id);

    const base = planIds();
    check('both stories seat under the wide budget', base.length === 2, JSON.stringify(base));
    check('no profile: the longer story closes the drive (climax by duration)',
      base[base.length - 1] === 'alpha museum|landmark_origin', JSON.stringify(base));
    const boosted = planIds({ profileTopics: pcDeclared('Sport') });
    check('a declared affinity takes the climax slot for the shorter matched story',
      boosted[boosted.length - 1] === 'mango museum|landmark_origin', JSON.stringify(boosted));
  }

  suite('PC-8 constraints stay out of the ranking signal (and keep reading back as hard values)');
  {
    profile.wipeProfile();
    profile.setDeclaredConstraint('budgetComfort', 'splurge', 'pc-sim');
    profile.setDeclaredConstraint('dietary', ['vegetarian'], 'pc-sim');
    profile.setDeclaredTaste('cuisines', ['seafood'], 'pc-sim');
    const inputs = profile.matchInputs();
    check('a constraints-and-cuisines profile yields NO story-topic weights',
      inputs.topics.length === 0, JSON.stringify(inputs.topics));
    const c = pcCandidate('Balboa Stadium', 50);
    facts.applyProfileBoost([c], inputs.topics);
    check('and discovery is untouched by it', c.score === 50);
    check('the constraints themselves still read back verbatim for their own consumers',
      profile.getConstraints().budgetComfort === 'splurge' && profile.getConstraints().dietary.join() === 'vegetarian');
    profile.wipeProfile();
  }

  // ---------------------------------------------------------------
  // SG suites (Nov 16, 2026): solicited suggestions, v16.2
  // Slice 4. The channel: a Passenger/Walking listener asks for
  // a stop; the answer is composed from the Slice 2 pool by the
  // pure composer (suggestions.ts) under the adopted policy
  // form. SG-1 pins the mode gate at the engine, SG-2 the
  // spoken form, SG-3 the honest no-suggestion answers, SG-4
  // the constraint filters at answer time, SG-5 the freeform
  // channel end to end (boundary delivery, logging, outcomes,
  // the two-pick cap), SG-6 the one-interruption rule shared
  // with Q&A. Story Q&A itself is untouched by every check
  // here — this is suggestions only.
  const SG_NOW = Date.UTC(2026, 10, 18, 19, 0, 0);
  const SG_DAY_MS = 24 * 60 * 60 * 1000;
  const sgCandidate = (over = {}) => ({
    placeId: 'sg-tacos', name: 'Sg Test Tacos', lat: 32.853, lng: -117.18, kind: 'eat',
    types: ['mexican_restaurant', 'restaurant'], rating: 4.2, userRatings: 300, address: null,
    editorial: null, distanceM: 900, anchorKind: 'position', openNow: true,
    closesAtMs: SG_NOW + 5 * 60 * 60 * 1000, opensAtMs: null, hoursFetchedAt: SG_NOW - 60_000,
    hasShelfStory: false, score: 40, detourMinutes: null, event: null, ...over,
  });
  const SG_NO_MATCH = { topics: [], cuisines: [], drinks: [], activities: [], dietary: [] };
  const SG_NO_CONSTRAINTS = {
    budgetComfort: null, maxDetourMinutes: null, alcoholOk: null, usuallyWithKids: null,
    dogFriendly: null, walkingTolerance: null, surpriseTolerance: null, dietary: [],
  };
  const sgCompose = (pool, over = {}) =>
    suggestions.composeSuggestion(pool, {
      intent: 'any', nowMs: SG_NOW, match: SG_NO_MATCH, constraints: SG_NO_CONSTRAINTS, ...over,
    });

  suite('SG-1 the mode gate: no declared mode or a Driving declaration closes the channel; Passenger/Walking opens it');
  {
    // Absent dep: a Tour constructed the pre-Slice-4 way has
    // no gate input at all — closed by construction.
    resetLocalStorage();
    const bareWorld = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
      eventCandidates: [sgCandidate()],
    });
    const bareAudio = new FakeAudio(bareWorld.clock, okPolicy());
    const bare = new Tour({ audio: bareAudio, clock: bareWorld.clock, seams: bareWorld.seams });
    bare.onPosition({ ...UTC, speedMps: 8, headingDeg: 180 });
    bare.start(false);
    await bareWorld.clock.advance(40_000);
    check('a Tour with no declaredMode dep reports the channel unavailable',
      bare.suggestionAvailable() === false && bare.view().suggestion.available === false);
    check('and refuses the ask', bare.submitSuggestionAsk('food') === false);
    check('filing nothing', bareWorld.eventsOf('suggestion_asked').length === 0);
    bare.endTour();

    // Driving declared: the gate reads the declaration, and
    // the declaration is no.
    resetLocalStorage();
    const driveWorld = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
      eventCandidates: [sgCandidate()],
      declaredMode: 'driving',
    });
    const driveAudio = new FakeAudio(driveWorld.clock, okPolicy());
    const driveTour = await startAt(driveWorld, driveAudio, UTC);
    await driveWorld.clock.advance(40_000);
    check('a Driving ride reports the channel unavailable',
      driveTour.suggestionAvailable() === false && driveTour.view().suggestion.available === false);
    check('and refuses the ask even with a full pool standing',
      driveTour.submitSuggestionAsk('food') === false && driveWorld.eventsOf('suggestion_asked').length === 0);
    driveTour.endTour();

    // Passenger/Walking declared: the gate opens (the ask
    // itself is exercised end to end in SG-5).
    resetLocalStorage();
    const passWorld = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
      declaredMode: 'passenger',
    });
    const passAudio = new FakeAudio(passWorld.clock, okPolicy());
    const passTour = await startAt(passWorld, passAudio, UTC);
    check('a Passenger/Walking ride reports the channel available',
      passTour.suggestionAvailable() === true && passTour.view().suggestion.available === true);
    passTour.endTour();
  }

  suite('SG-2 the spoken form: reason + time fact in the recommendation, an off-ramp in every answer, labels and detours only when real');
  {
    const matched = sgCompose([sgCandidate()], {
      intent: 'food',
      match: { ...SG_NO_MATCH, cuisines: ['tacos-mexican'] },
    });
    check('a gate-passing candidate composes a pick', matched.kind === 'pick', JSON.stringify(matched));
    check('the primary reason is the profile match, named from the actual taste',
      matched.primaryReason === 'profile-match' && matched.text.includes('matches your Tacos & Mexican pick'),
      matched.text);
    check('the time fact comes from the source hours', matched.text.includes('open until'), matched.text);
    check('the recommendation names the real place', matched.recommendation.startsWith('Try Sg Test Tacos — '), matched.recommendation);
    check('the off-ramp rides every answer', matched.text.includes('Ask for another'), matched.text);
    check('no detour was computed, so no detour is claimed',
      matched.detourMinutes === null && !matched.text.includes('minutes off your way'), matched.text);
    check('nothing is sponsored in v1', matched.sponsored === false && !matched.text.startsWith('Sponsored'));

    const hooked = sgCompose([sgCandidate()], { detourMinutesFor: () => 6 });
    check('a caller-computed detour is spoken as a number',
      hooked.kind === 'pick' && hooked.detourMinutes === 6 && hooked.text.includes('about 6 minutes off your way'),
      hooked.kind === 'pick' ? hooked.text : hooked.kind);
    const capped = sgCompose([sgCandidate()], {
      detourMinutesFor: () => 6,
      constraints: { ...SG_NO_CONSTRAINTS, maxDetourMinutes: 5 },
    });
    check('a known detour beyond the declared cap excludes the place — the cap is never approximated around',
      capped.kind === 'none' && capped.reasonCodes[0] === 'constraints-excluded', JSON.stringify(capped.reasonCodes));

    const sponsored = sgCompose([sgCandidate()], { sponsoredPlaceIds: new Set(['sg-tacos']) });
    check('the sponsored hook renders the label at the head of the spoken text',
      sponsored.kind === 'pick' && sponsored.sponsored === true && sponsored.text.startsWith('Sponsored — '),
      sponsored.kind === 'pick' ? sponsored.text : sponsored.kind);

    const soon = sgCompose([sgCandidate({
      closesAtMs: SG_NOW + 30 * 60 * 1000, rating: 4.9, hasShelfStory: true, distanceM: 100,
    })]);
    check('reason priority: closes-soon outranks shelf-story, top-rated, and nearby — and all are filed',
      soon.kind === 'pick' && soon.primaryReason === 'closes-soon' &&
      JSON.stringify(soon.reasonCodes) === JSON.stringify(['closes-soon', 'shelf-story', 'top-rated', 'nearby', 'open-now']),
      soon.kind === 'pick' ? JSON.stringify(soon.reasonCodes) : soon.kind);

    const alternate = sgCompose(
      [sgCandidate(), sgCandidate({ placeId: 'sg-other', name: 'Sg Other', score: 30 })],
      { excludePlaceIds: new Set(['sg-tacos']), picksUsed: 1 },
    );
    check('the second pick is the alternate, with the closing off-ramp',
      alternate.kind === 'pick' && alternate.candidate.placeId === 'sg-other' && alternate.turn === 2 &&
      alternate.text.includes("the other one I'd stand behind"),
      alternate.kind === 'pick' ? alternate.text : alternate.kind);
    const cappedTurns = sgCompose([sgCandidate()], { picksUsed: 2 });
    check('a third pick is refused by the two-pick cap, honestly',
      cappedTurns.kind === 'none' && cappedTurns.reasonCodes[0] === 'turn-cap', JSON.stringify(cappedTurns.reasonCodes));
  }

  suite('SG-3 honest no-suggestion answers: stale, closed, unverifiable, and empty pools never produce a pick');
  {
    const empty = sgCompose([]);
    check('an empty pool answers pool-empty', empty.kind === 'none' && empty.reasonCodes[0] === 'pool-empty');
    const stale = sgCompose([sgCandidate({ hoursFetchedAt: SG_NOW - 8 * SG_DAY_MS })]);
    check('hours that were fresh at discovery are stale at answer time 8 days on — all-stale, no pick',
      stale.kind === 'none' && stale.reasonCodes[0] === 'all-stale' && stale.text.includes('too old to trust'),
      JSON.stringify(stale.reasonCodes));
    const closed = sgCompose([sgCandidate({ openNow: false, closesAtMs: null })]);
    check('a verifiably closed place is never the pick', closed.kind === 'none' && closed.reasonCodes[0] === 'none-open');
    const unknown = sgCompose([sgCandidate({ openNow: null, closesAtMs: null })]);
    check('unknown open-now is not a claim: none-open, not a guess',
      unknown.kind === 'none' && unknown.reasonCodes[0] === 'none-open');
    const justClosed = sgCompose([sgCandidate({ closesAtMs: SG_NOW - 60_000 })]);
    check('a place whose close has passed since discovery is none-open at answer time',
      justClosed.kind === 'none' && justClosed.reasonCodes[0] === 'none-open');
    const wrongKind = sgCompose([sgCandidate({ kind: 'do', types: ['museum'] })], { intent: 'food' });
    check('an ask the pool cannot match answers intent-unmatched',
      wrongKind.kind === 'none' && wrongKind.reasonCodes[0] === 'intent-unmatched');
  }

  suite('SG-4 constraints at answer time: with-kids and no-alcohol filter the pool the composer actually sees');
  {
    const bar = sgCandidate({ placeId: 'sg-bar', name: 'Sg Bar', kind: 'drink', types: ['bar'], score: 99 });
    const cafe = sgCandidate({ placeId: 'sg-cafe', name: 'Sg Cafe', types: ['cafe', 'coffee_shop'], score: 10 });
    const kids = sgCompose([bar, cafe], { constraints: { ...SG_NO_CONSTRAINTS, usuallyWithKids: true } });
    check('with-kids excludes the bar-primary place even ranked first — the cafe is the pick',
      kids.kind === 'pick' && kids.candidate.placeId === 'sg-cafe',
      kids.kind === 'pick' ? kids.candidate.placeId : JSON.stringify(kids.reasonCodes));
    const kidsOnly = sgCompose([bar], { constraints: { ...SG_NO_CONSTRAINTS, usuallyWithKids: true } });
    check('with-kids and only a bar: constraints-excluded, honestly',
      kidsOnly.kind === 'none' && kidsOnly.reasonCodes[0] === 'constraints-excluded');
    const noAlcohol = sgCompose([bar], {
      intent: 'drink',
      constraints: { ...SG_NO_CONSTRAINTS, alcoholOk: false },
    });
    check('no-alcohol excludes the bar from a drink ask too',
      noAlcohol.kind === 'none' && noAlcohol.reasonCodes[0] === 'constraints-excluded');
    const neutral = sgCompose([bar, cafe]);
    check('with no constraints declared the higher-ranked bar is the pick (no phantom filtering)',
      neutral.kind === 'pick' && neutral.candidate.placeId === 'sg-bar');
  }

  suite('SG-5 the freeform channel end to end: boundary delivery, the full event trail, outcomes, and the cap');
  {
    resetLocalStorage();
    profile.setDeclaredTaste('cuisines', ['tacos-mexican'], 'sg-sim');
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
      eventCandidates: [
        sgCandidate({ hoursFetchedAt: 0, closesAtMs: 10 * 60 * 60 * 1000 }),
        sgCandidate({ placeId: 'sg-other', name: 'Sg Other Tacos', score: 30, hoursFetchedAt: 0, closesAtMs: 10 * 60 * 60 * 1000 }),
      ],
      declaredMode: 'passenger',
    });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 20_000 }));
    const { tour } = await healthyOpening(world, audio);
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    // The boundary check needs its precondition honestly: a
    // story actually sounding when the ask lands. Poll the
    // fake clock forward until one is (serve cycles along the
    // way also land the pool refresh).
    for (let i = 0; i < 60 && tour.view().nowPlaying?.kind !== 'story'; i++) {
      await world.clock.advance(500);
    }
    check('the pool stands ready before the ask', tour.currentEventCandidates().length === 2,
      `${tour.currentEventCandidates().length}`);
    check('setup: a story is playing when the ask lands', tour.view().nowPlaying?.kind === 'story',
      JSON.stringify(tour.view().nowPlaying));
    const playbacksBefore = world.eventsOf('story_playback').length;
    check('the ask is accepted', tour.submitSuggestionAsk('food') === true);
    check('a second ask while the answer is in flight is refused', tour.submitSuggestionAsk('food') === false);
    const asked = world.eventsOf('suggestion_asked');
    check('suggestion_asked filed with intent + turn', asked.length === 1 && asked[0].payload.intent === 'food' && asked[0].payload.turn === 1,
      JSON.stringify(asked.map(e => e.payload)));
    const answered = world.eventsOf('suggestion_answered');
    check('suggestion_answered files the pick with its reason codes (profile match rides the seeded taste)',
      answered.length === 1 && answered[0].payload.outcome === 'pick' && answered[0].payload.place_id === 'sg-tacos' &&
      answered[0].payload.reason_codes.includes('profile-match') && answered[0].payload.sponsored === false,
      JSON.stringify(answered.map(e => e.payload)));
    check('the pick is pending in the view, by name',
      tour.view().suggestion.pending?.placeId === 'sg-tacos' && tour.view().suggestion.pending?.name === 'Sg Test Tacos');
    await world.clock.advance(60_000);
    const storyEvent = world.eventsOf('story_playback')[playbacksBefore];
    const suggEvent = world.eventsOf('suggestion_playback')[0];
    check('the answer sounded only after the playing story settled (the boundary fence)',
      !!storyEvent && !!suggEvent && world.events.indexOf(storyEvent) < world.events.indexOf(suggEvent),
      `story@${storyEvent ? world.events.indexOf(storyEvent) : -1} suggestion@${suggEvent ? world.events.indexOf(suggEvent) : -1}`);
    check('and the story it waited behind completed — it was never cut',
      storyEvent?.payload.completed === true,
      JSON.stringify(storyEvent?.payload));
    check('suggestion_playback filed its settle truth',
      world.eventsOf('suggestion_playback').length === 1 && world.eventsOf('suggestion_playback')[0].payload.completed === true &&
      world.eventsOf('suggestion_playback')[0].payload.place_id === 'sg-tacos');
    check('diagnostics count the sounded pick', tour.view().diagnostics.suggestionsAnswered === 1);
    check('the outcome tap files accepted, once',
      tour.resolveSuggestion('accepted') === true && tour.resolveSuggestion('accepted') === false &&
      world.eventsOf('suggestion_outcome').length === 1 &&
      world.eventsOf('suggestion_outcome')[0].payload.outcome === 'accepted' &&
      world.eventsOf('suggestion_outcome')[0].payload.place_id === 'sg-tacos',
      JSON.stringify(world.eventsOf('suggestion_outcome').map(e => e.payload)));
    check('the pending pick cleared', tour.view().suggestion.pending === null);

    // The alternate, then the cap — with asked-another filed
    // by the third ask itself.
    check('the second ask is accepted', tour.submitSuggestionAsk('food') === true);
    await world.clock.advance(60_000);
    const answered2 = world.eventsOf('suggestion_answered');
    check('the alternate is a different place (the first pick is excluded)',
      answered2.length === 2 && answered2[1].payload.place_id === 'sg-other' && answered2[1].payload.turn === 2,
      JSON.stringify(answered2.map(e => e.payload)));
    check('the third ask is accepted as an ask (it carries the outcome + the cap answer)',
      tour.submitSuggestionAsk('food') === true);
    const outcomes = world.eventsOf('suggestion_outcome');
    check('asking over the pending alternate filed asked-another for it',
      outcomes.length === 2 && outcomes[1].payload.outcome === 'asked-another' && outcomes[1].payload.place_id === 'sg-other',
      JSON.stringify(outcomes.map(e => e.payload)));
    const answered3 = world.eventsOf('suggestion_answered');
    check('and the cap answer is an honest none (turn-cap), spoken like any answer',
      answered3.length === 3 && answered3[2].payload.outcome === 'none' && answered3[2].payload.primary_reason === 'turn-cap',
      JSON.stringify(answered3.map(e => e.payload)));
    await world.clock.advance(60_000);
    tour.endTour();
    profile.wipeProfile();

    // A pick pending at tour end files no outcome.
    resetLocalStorage();
    const endWorld = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
      eventCandidates: [sgCandidate({ hoursFetchedAt: 0, closesAtMs: 10 * 60 * 60 * 1000 })],
      declaredMode: 'passenger',
    });
    const endAudio = new FakeAudio(endWorld.clock, okPolicy());
    const endTour = await startAt(endWorld, endAudio, UTC);
    await endWorld.clock.advance(40_000);
    check('setup: the ask lands a pick', endTour.submitSuggestionAsk('any') === true);
    endTour.endTour();
    check('tour end with a pick pending files NO outcome (a dismissal is never inferred)',
      endWorld.eventsOf('suggestion_outcome').length === 0,
      JSON.stringify(endWorld.eventsOf('suggestion_outcome').map(e => e.payload)));
  }

  suite('SG-6 one spoken interruption at a time: a suggestion ask waits out a Q&A cycle, and vice versa the channel stays separate');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
      eventCandidates: [sgCandidate({ hoursFetchedAt: 0, closesAtMs: 10 * 60 * 60 * 1000 })],
      declaredMode: 'passenger',
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    check('the question is accepted', tour.submitQuestion('What is this place?') === true);
    check('a suggestion ask during the Q&A cycle is refused', tour.submitSuggestionAsk('food') === false);
    await world.clock.advance(10_000); // the answer sounds and settles; the lock awaits resume
    check('still refused while the Q&A lock awaits resume', tour.submitSuggestionAsk('food') === false);
    await world.clock.advance(50_000); // the 45 s resume grace releases the lock
    check('once the lock is idle the suggestion ask is accepted', tour.submitSuggestionAsk('food') === true);
    await world.clock.advance(30_000);
    check('and its answer filed normally', world.eventsOf('suggestion_answered').length === 1);
    tour.endTour();
  }

  // SG-7 (Nov 17, 2026, v16.2 audit fix): the RECIPROCAL
  // direction of SG-6's rule. The ask side has refused during
  // a Q&A cycle since Slice 4, but submitQuestion checked
  // only its own phase — a question could be submitted over
  // a sounding suggestion answer or a pick still awaiting
  // its verdict. Now the slot is shared symmetrically: Q&A
  // refuses while the suggestion channel owns it (answer in
  // flight OR pick pending, solicited or proposed), the
  // view's qaLocked mirrors the same condition, and resolving
  // the pick frees the channel.
  suite('SG-7 the reciprocal direction: a question waits out the suggestion channel — sounding answer and pending pick alike');
  {
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
      eventCandidates: [sgCandidate({ hoursFetchedAt: 0, closesAtMs: 10 * 60 * 60 * 1000 })],
      declaredMode: 'passenger',
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const { tour } = await healthyOpening(world, audio);
    check('the ask is accepted', tour.submitSuggestionAsk('food') === true);
    check('a question while the suggestion answer is in flight is refused',
      tour.submitQuestion('What is this place?') === false);
    check('and the form lock shows it (qaLocked mirrors the channel)', tour.view().qaLocked === true);
    await world.clock.advance(60_000);
    check('the answer sounded and its pick stands pending',
      world.eventsOf('suggestion_playback').length === 1 && tour.view().suggestion.pending?.placeId === 'sg-tacos',
      JSON.stringify(tour.view().suggestion.pending));
    check('a question while the pick awaits its verdict is still refused',
      tour.submitQuestion('What is this place?') === false);
    check('no question was ever filed', world.eventsOf('question_asked').length === 0);
    check('resolving the pick frees the channel',
      tour.resolveSuggestion('accepted') === true && tour.view().qaLocked === false);
    check('and the question is accepted', tour.submitQuestion('What is this place?') === true);
    await world.clock.advance(60_000);
    tour.endTour();

    // A PROPOSED pick (Slice 5) holds the slot the same way.
    resetLocalStorage();
    const propWorld = makeWorld(Tour, {
      candidates: ['Alpha Park', 'Beta Museum', 'Gamma Pier', 'Delta Fort'].map(n => makeCandidate(n)),
      library: ['Alpha Park', 'Beta Museum', 'Gamma Pier', 'Delta Fort'],
      eventCandidates: [sgCandidate({ placeId: 'sg-proposed', name: 'Sg Proposed Tacos', hoursFetchedAt: 0, closesAtMs: 10 * 60 * 60 * 1000 })],
      declaredMode: 'passenger',
    });
    const propAudio = new FakeAudio(propWorld.clock, okPolicy({ library: 15_000 }));
    const { tour: propTour } = await healthyOpening(propWorld, propAudio);
    propTour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    for (let i = 0; i < 80 && propTour.view().diagnostics.proposalsSpoken !== 1; i++) {
      await propWorld.clock.advance(5_000);
    }
    check('setup: the proposal sounded and its pick stands pending, tagged proposed',
      propTour.view().suggestion.pending?.placeId === 'sg-proposed' && propTour.view().suggestion.pending?.source === 'proposed',
      JSON.stringify(propTour.view().suggestion.pending));
    check('a question while the PROPOSED pick awaits its verdict is refused',
      propTour.submitQuestion('What is this place?') === false && propTour.view().qaLocked === true);
    check('resolving it frees the channel for the question',
      propTour.resolveSuggestion('dismissed') === true && propTour.submitQuestion('What is this place?') === true);
    await propWorld.clock.advance(60_000);
    propTour.endTour();
  }

  // SG-8 (Nov 17, 2026, v16.2 audit fix): max-detour honesty.
  // Production never computes a suggestion's detour minutes
  // (Slice 4's designed deferral — no ask-time Routes call),
  // so the stored max-detour constraint cannot fire — and the
  // profile editor's control that set it is no longer
  // rendered, because a control that cannot take effect is a
  // false promise. The constraint stays in the profile
  // document and round-trips untouched through editor saves,
  // ready for the day detour costing lands.
  suite('SG-8 max-detour honesty: no enforcement without costing, no control rendered, the stored value round-trips untouched');
  {
    const uncosted = sgCompose([sgCandidate()], {
      constraints: { ...SG_NO_CONSTRAINTS, maxDetourMinutes: 5 },
    });
    check('with detour minutes uncomputed (the production reality), the stored cap excludes nothing and claims nothing',
      uncosted.kind === 'pick' && uncosted.detourMinutes === null && !uncosted.text.includes('minutes off your way'),
      uncosted.kind === 'pick' ? uncosted.text : uncosted.kind);

    const React = await import('react');
    const { renderToString } = await import('react-dom/server');
    resetLocalStorage();
    const html = renderToString(React.createElement(profileUi.ProfileEditor, {
      form: profileUi.formFromProfile(profile.loadProfile()),
      onChange: () => {},
    }));
    check('the profile editor renders its real controls but no detour control',
      html.includes('A good stop usually costs') && !/detour/i.test(html),
      html.slice(0, 200));

    profile.setDeclaredConstraint('maxDetourMinutes', 10, 'sg-sim');
    const form = profileUi.formFromProfile(profile.loadProfile());
    check('a stored max-detour value reads into the editor form', form.maxDetourMinutes === 10);
    form.budgetComfort = 'splurge';
    profileUi.saveDeclaredForm(form, 'sg-sim');
    check('an editor save for other fields leaves the stored max-detour value untouched',
      profile.loadProfile().constraints.maxDetourMinutes?.value === 10 &&
      profile.getConstraints().maxDetourMinutes === 10,
      JSON.stringify(profile.loadProfile().constraints.maxDetourMinutes));
    resetLocalStorage();
  }

  // ---------------------------------------------------------------
  // UP suites (Nov 16, 2026): unsolicited seam proposals +
  // the arrival tray, v16.2 Slice 5. Passenger/Walking ONLY —
  // the Driving absence is pinned as hard as the presence.
  // UP-1 pins every timing fence at the seam judge, UP-2 the
  // speak-time freshness re-judgment + the tray lifecycle
  // store, UP-3 the freeform engine end to end (two-boundary
  // arm/speak, the per-drive cap, the proposal outcome
  // vocabulary), UP-4 the total absence in Driving and in a
  // gateless Tour, UP-5 the silent speak-time staleness drop,
  // UP-6 the tray carry at tour end, UP-7 the channel-busy
  // suppression + drop in-engine. The demotion rule is
  // measurement only in v1 — these suites pin the events it
  // will read, not any automatic behavior.
  const UP_NOW = Date.UTC(2026, 10, 18, 19, 0, 0);
  const UP_DAY_MS = 24 * 60 * 60 * 1000;
  const upCandidate = (over = {}) => ({
    placeId: 'up-tacos', name: 'Up Test Tacos', lat: 32.853, lng: -117.18, kind: 'eat',
    types: ['mexican_restaurant', 'restaurant'], rating: 4.2, userRatings: 300, address: null,
    editorial: null, distanceM: 900, anchorKind: 'position', openNow: true,
    closesAtMs: UP_NOW + 5 * 60 * 60 * 1000, opensAtMs: null, hoursFetchedAt: UP_NOW - 60_000,
    hasShelfStory: false, score: 40, detourMinutes: null, event: null, ...over,
  });
  const UP_SEAM_BASE = {
    seam: 'story-boundary', tourAgeMs: 300_000, remainingMs: 600_000,
    prevSolemn: false, nextSolemn: false, interchangeNear: false,
    proposalsUsed: 0, channelBusy: false,
  };
  const PROPOSAL_EVENT_TYPES = [
    'proposal_offered', 'proposal_playback', 'proposal_suppressed',
    'proposal_dropped', 'proposal_trayed', 'proposal_outcome',
  ];
  const proposalEvents = world => PROPOSAL_EVENT_TYPES.flatMap(t => world.eventsOf(t));
  // A four-subject shelf: story boundaries keep flowing for
  // the whole sim (a one-story shelf exhausts after the
  // opening and the seam engine would starve — the engine is
  // not broken, the world is just quiet).
  const UP_SUBJECTS = ['Alpha Park', 'Beta Museum', 'Gamma Pier', 'Delta Fort'];
  const upWorld = (over = {}) => makeWorld(Tour, {
    candidates: UP_SUBJECTS.map(n => makeCandidate(n)),
    library: [...UP_SUBJECTS],
    eventCandidates: [upCandidate({ hoursFetchedAt: 0, closesAtMs: 10 * 60 * 60 * 1000 })],
    declaredMode: 'passenger',
    ...over,
  });

  suite('UP-1 the seam judge: every adopted timing fence, the per-drive cap, and the legal seams');
  {
    check('the cap is the plan value: one unsolicited proposal per drive',
      proposals.MAX_UNSOLICITED_PROPOSALS_PER_DRIVE === 1);
    check('a clean mid-drive story boundary is legal',
      proposals.judgeProposalSeam(UP_SEAM_BASE).ok === true);
    check('the cap blocks the second proposal of the drive',
      proposals.judgeProposalSeam({ ...UP_SEAM_BASE, proposalsUsed: 1 }).reason === 'cap');
    check('the cap outranks even the first-minute fence (judgment order is pinned)',
      proposals.judgeProposalSeam({ ...UP_SEAM_BASE, proposalsUsed: 1, tourAgeMs: 0 }).reason === 'cap');
    check('never in the first 60 seconds',
      proposals.judgeProposalSeam({ ...UP_SEAM_BASE, tourAgeMs: 59_999 }).reason === 'first-minute' &&
      proposals.judgeProposalSeam({ ...UP_SEAM_BASE, tourAgeMs: 60_000 }).ok === true);
    check('never in the last 2 minutes — and an unknown remainder cannot trigger the fence',
      proposals.judgeProposalSeam({ ...UP_SEAM_BASE, remainingMs: 119_999 }).reason === 'last-minutes' &&
      proposals.judgeProposalSeam({ ...UP_SEAM_BASE, remainingMs: 120_000 }).ok === true &&
      proposals.judgeProposalSeam({ ...UP_SEAM_BASE, remainingMs: null }).ok === true);
    check('never right after memorial or climax material',
      proposals.judgeProposalSeam({ ...UP_SEAM_BASE, prevSolemn: true }).reason === 'after-solemn');
    check('never right before memorial or climax material',
      proposals.judgeProposalSeam({ ...UP_SEAM_BASE, nextSolemn: true }).reason === 'before-solemn');
    check('never during a complex interchange',
      proposals.judgeProposalSeam({ ...UP_SEAM_BASE, interchangeNear: true }).reason === 'interchange');
    check('never into a busy channel (an ask or question owns the interruption slot)',
      proposals.judgeProposalSeam({ ...UP_SEAM_BASE, channelBusy: true }).reason === 'channel-busy');
    check('the pre-drive preview is a legal seam even at tour age zero',
      proposals.judgeProposalSeam({ ...UP_SEAM_BASE, seam: 'preview', tourAgeMs: 0 }).ok === true);
    check('arrival is always legal — every fence yields there',
      proposals.judgeProposalSeam({
        seam: 'arrival', tourAgeMs: 0, remainingMs: 0, prevSolemn: true, nextSolemn: true,
        interchangeNear: true, proposalsUsed: 1, channelBusy: true,
      }).ok === true);
  }

  suite('UP-2 speak-time freshness + the tray lifecycle store: re-judged, expiring, resolving');
  {
    check('a fresh, open candidate passes the speak-time re-judgment',
      proposals.judgeCandidateAtSpeak(upCandidate(), UP_NOW).ok === true);
    check('hours older than the freshness standard at speak time drop it as stale',
      proposals.judgeCandidateAtSpeak(upCandidate({ hoursFetchedAt: UP_NOW - 8 * UP_DAY_MS }), UP_NOW).reason === 'stale-at-speak');
    check('a place the source now reports closed drops as closed, never stale',
      proposals.judgeCandidateAtSpeak(upCandidate({ openNow: false }), UP_NOW).reason === 'closed-at-speak');
    check('unknown open-state at speak time is stale — "open now" is never assumed',
      proposals.judgeCandidateAtSpeak(upCandidate({ openNow: null, closesAtMs: null }), UP_NOW).reason === 'stale-at-speak');
    check('a closing time that passed since selection drops as closed',
      proposals.judgeCandidateAtSpeak(upCandidate({ closesAtMs: UP_NOW - 1 }), UP_NOW).reason === 'closed-at-speak');

    resetLocalStorage();
    const store = proposals.localProposalStore;
    const rec = (over = {}) => ({
      placeId: 'up-tacos', name: 'Up Test Tacos', kind: 'eat', primaryReason: 'open-now',
      closesAtMs: UP_NOW + 3_600_000, hoursFetchedAt: UP_NOW - 60_000, offeredAt: UP_NOW,
      sessionId: 'up-sim', state: 'spoken', ...over,
    });
    proposals.recordProposal(store, rec());
    check('a spoken proposal stands in the tray, actionable while its window stands',
      proposals.trayEntries(store, UP_NOW).length === 1 &&
      proposals.trayEntries(store, UP_NOW)[0].judgment.actionable === true);
    proposals.recordProposal(store, rec({ offeredAt: UP_NOW + 1000 }));
    check('a re-offer of the same place replaces its older record (one entry per place)',
      proposals.loadProposalRecords(store).length === 1 &&
      proposals.loadProposalRecords(store)[0].offeredAt === UP_NOW + 1000);
    check('past its closing time the entry renders expired — visible, never actionable',
      (() => { const j = proposals.judgeTrayRecord(rec(), UP_NOW + 3_600_001); return j.visible && j.expired && !j.actionable; })());
    check('aged-out hours expire the entry the same way',
      (() => { const j = proposals.judgeTrayRecord(rec({ closesAtMs: null, hoursFetchedAt: UP_NOW - 8 * UP_DAY_MS }), UP_NOW); return j.visible && j.expired && !j.actionable; })());
    check('accepting resolves the record to saved: still shown, no longer actionable',
      proposals.resolveProposalRecord(store, 'up-tacos', 'accepted') === true &&
      proposals.loadProposalRecords(store)[0].state === 'accepted' &&
      proposals.trayEntries(store, UP_NOW)[0].judgment.actionable === false);
    proposals.recordProposal(store, rec({ placeId: 'up-other', name: 'Up Other' }));
    check('dismissing removes the entry from the tray entirely',
      proposals.resolveProposalRecord(store, 'up-other', 'dismissed') === true &&
      proposals.trayEntries(store, UP_NOW).every(e => e.record.placeId !== 'up-other'));
    resetLocalStorage();
    for (let i = 0; i < 25; i++) proposals.recordProposal(store, rec({ placeId: `up-p${i}`, name: `Up P${i}`, offeredAt: UP_NOW + i }));
    check('the tray ledger is bounded (newest 20 stand)',
      proposals.loadProposalRecords(store).length === 20 &&
      proposals.loadProposalRecords(store)[0].placeId === 'up-p24');
  }

  suite('UP-3 freeform end to end: arm at one boundary, speak at the next, exactly one per drive, proposal outcomes');
  {
    resetLocalStorage();
    const world = upWorld();
    const audio = new FakeAudio(world.clock, okPolicy({ library: 15_000 }));
    const { tour } = await healthyOpening(world, audio);
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    for (let i = 0; i < 80 && tour.view().diagnostics.proposalsSpoken !== 1; i++) {
      await world.clock.advance(5_000);
    }
    const offered = world.eventsOf('proposal_offered');
    check('exactly one proposal was offered across many boundaries (the per-drive cap)',
      offered.length === 1 && offered[0].payload.place_id === 'up-tacos',
      JSON.stringify(offered.map(e => e.payload)));
    check('the offer never sounded inside the first minute (the fence, in-engine)',
      offered.length === 1 && offered[0].at >= 60_000, `at=${offered[0]?.at}`);
    check('any earlier speak attempt was suppressed, never spoken (first-minute drop, then re-selection)',
      world.eventsOf('proposal_suppressed').every(e => e.payload.reason === 'first-minute'),
      JSON.stringify(world.eventsOf('proposal_suppressed').map(e => e.payload)));
    check('proposal_playback filed its settle truth',
      world.eventsOf('proposal_playback').length === 1 &&
      world.eventsOf('proposal_playback')[0].payload.completed === true &&
      world.eventsOf('proposal_playback')[0].payload.place_id === 'up-tacos');
    check('the pending pick is the proposal, tagged by source',
      tour.view().suggestion.pending?.placeId === 'up-tacos' && tour.view().suggestion.pending?.source === 'proposed',
      JSON.stringify(tour.view().suggestion.pending));
    check('the lifecycle record stands in the tray store as spoken',
      proposals.loadProposalRecords(proposals.localProposalStore).length === 1 &&
      proposals.loadProposalRecords(proposals.localProposalStore)[0].state === 'spoken');
    check('resolving files proposal_outcome on its own channel — never suggestion_outcome',
      tour.resolveSuggestion('accepted') === true &&
      world.eventsOf('proposal_outcome').length === 1 &&
      world.eventsOf('proposal_outcome')[0].payload.outcome === 'accepted' &&
      world.eventsOf('proposal_outcome')[0].payload.surface === 'drive' &&
      world.eventsOf('suggestion_outcome').length === 0,
      JSON.stringify(world.eventsOf('proposal_outcome').map(e => e.payload)));
    check('and the tray record resolves with the verdict',
      proposals.loadProposalRecords(proposals.localProposalStore)[0].state === 'accepted');
    await world.clock.advance(120_000);
    check('the cap holds for the rest of the drive (no second offer, ever)',
      world.eventsOf('proposal_offered').length === 1);
    tour.endTour();
  }

  suite('UP-4 Driving and gateless tours: total absence — no offers, no events, no tray records');
  {
    resetLocalStorage();
    const driveWorld = upWorld({ declaredMode: 'driving' });
    const driveAudio = new FakeAudio(driveWorld.clock, okPolicy({ library: 15_000 }));
    const driveTour = await startAt(driveWorld, driveAudio, UTC);
    driveTour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await driveWorld.clock.advance(240_000);
    check('setup: story boundaries really happened on the Driving ride (the absence is not vacuous)',
      driveWorld.eventsOf('story_playback').length >= 3,
      `${driveWorld.eventsOf('story_playback').length}`);
    check('a Driving ride files zero proposal events across many story boundaries',
      proposalEvents(driveWorld).length === 0,
      JSON.stringify(proposalEvents(driveWorld).map(e => e.type)));
    check('and writes no tray records', proposals.loadProposalRecords(proposals.localProposalStore).length === 0);
    driveTour.endTour();

    resetLocalStorage();
    const bareWorld = makeWorld(Tour, {
      candidates: UP_SUBJECTS.map(n => makeCandidate(n)),
      library: [...UP_SUBJECTS],
      eventCandidates: [upCandidate({ hoursFetchedAt: 0, closesAtMs: 10 * 60 * 60 * 1000 })],
    });
    const bareAudio = new FakeAudio(bareWorld.clock, okPolicy({ library: 15_000 }));
    const bare = new Tour({ audio: bareAudio, clock: bareWorld.clock, seams: bareWorld.seams });
    bare.onPosition({ ...UTC, speedMps: 8, headingDeg: 180 });
    bare.start(false);
    await bareWorld.clock.advance(240_000);
    check('a Tour with no declaredMode dep (closed by construction) is equally silent',
      proposalEvents(bareWorld).length === 0 &&
      proposals.loadProposalRecords(proposals.localProposalStore).length === 0);
    bare.endTour();
  }

  suite('UP-5 speak-time staleness: a place that closes between selection and speech is dropped silently, cap unspent');
  {
    resetLocalStorage();
    // The candidate stands open when the second selection
    // composes (~60 s in) and closed by its speak boundary
    // (~75 s in): closesAtMs sits between the two.
    const world = upWorld({ eventCandidates: [upCandidate({ hoursFetchedAt: 0, closesAtMs: 70_000 })] });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 15_000 }));
    const { tour } = await healthyOpening(world, audio);
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(180_000);
    const dropped = world.eventsOf('proposal_dropped');
    check('the stale-at-speak drop filed, with its reason',
      dropped.length === 1 && dropped[0].payload.reason === 'closed-at-speak' && dropped[0].payload.place_id === 'up-tacos',
      JSON.stringify(dropped.map(e => e.payload)));
    check('nothing was offered or sounded — the drop is silent by construction',
      world.eventsOf('proposal_offered').length === 0 && world.eventsOf('proposal_playback').length === 0 &&
      tour.view().diagnostics.proposalsSpoken === 0);
    check('no tray record was written for a proposal never spoken',
      proposals.loadProposalRecords(proposals.localProposalStore).length === 0);
    tour.endTour();
  }

  suite('UP-6 the tray carry: an undecided proposal trays at tour end; a solicited pick still files nothing');
  {
    resetLocalStorage();
    const world = upWorld();
    const audio = new FakeAudio(world.clock, okPolicy({ library: 15_000 }));
    const { tour } = await healthyOpening(world, audio);
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    for (let i = 0; i < 80 && tour.view().diagnostics.proposalsSpoken !== 1; i++) {
      await world.clock.advance(5_000);
    }
    check('setup: the proposal sounded and stands undecided',
      tour.view().suggestion.pending?.source === 'proposed');
    tour.endTour();
    check('tour end trays the undecided proposal (exactly one trayed event, no outcome inferred)',
      world.eventsOf('proposal_trayed').length === 1 &&
      world.eventsOf('proposal_trayed')[0].payload.place_id === 'up-tacos' &&
      world.eventsOf('proposal_outcome').length === 0,
      JSON.stringify(world.eventsOf('proposal_trayed').map(e => e.payload)));
    check('the tray entry stands actionable for the stopped-state decision',
      proposals.trayEntries(proposals.localProposalStore, world.clock.now()).length === 1 &&
      proposals.trayEntries(proposals.localProposalStore, world.clock.now())[0].judgment.actionable === true);

    // Control: the Slice 4 rule is untouched — a SOLICITED
    // pick pending at tour end files nothing and trays nothing.
    resetLocalStorage();
    const askWorld = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
      eventCandidates: [sgCandidate({ hoursFetchedAt: 0, closesAtMs: 10 * 60 * 60 * 1000 })],
      declaredMode: 'passenger',
    });
    const askAudio = new FakeAudio(askWorld.clock, okPolicy());
    const askTour = await startAt(askWorld, askAudio, UTC);
    await askWorld.clock.advance(40_000);
    check('control setup: the solicited ask lands a pick', askTour.submitSuggestionAsk('any') === true);
    askTour.endTour();
    check('a solicited pick at tour end files no outcome and no tray carry',
      askWorld.eventsOf('suggestion_outcome').length === 0 && askWorld.eventsOf('proposal_trayed').length === 0);
  }

  suite('UP-7 channel-busy in-engine: a speak attempt into an owned channel suppresses and drops, then the channel frees');
  {
    resetLocalStorage();
    const world = upWorld();
    const audio = new FakeAudio(world.clock, okPolicy({ library: 15_000 }));
    const { tour } = await healthyOpening(world, audio);
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    // A selection armed at the welcome boundary (~30 s). The
    // listener asks a question; its answer cycle owns the
    // channel when the next story boundary arrives, so the
    // speak attempt must suppress as channel-busy and drop.
    check('the question is accepted', tour.submitQuestion('What is this place?') === true);
    for (let i = 0; i < 40 && tour.view().qaPhase === 'idle'; i++) {
      await world.clock.advance(500);
    }
    check('setup: the Q&A cycle owns the channel', tour.view().qaPhase !== 'idle', tour.view().qaPhase);
    await world.clock.advance(30_000);
    const suppressed = world.eventsOf('proposal_suppressed');
    check('the speak attempt into the busy channel suppressed and dropped the selection',
      suppressed.some(e => e.payload.reason === 'channel-busy') &&
      world.eventsOf('proposal_offered').length === 0,
      JSON.stringify(suppressed.map(e => e.payload)));
    // The Q&A cycle ends, the resume grace releases the lock,
    // and the engine re-selects and speaks on later boundaries
    // — the drop cost a cycle, never the drive's one proposal.
    await world.clock.advance(60_000);
    for (let i = 0; i < 80 && tour.view().diagnostics.proposalsSpoken !== 1; i++) {
      await world.clock.advance(5_000);
    }
    check('after the channel frees, the proposal still lands — exactly once',
      world.eventsOf('proposal_offered').length === 1 && tour.view().diagnostics.proposalsSpoken === 1,
      JSON.stringify(world.eventsOf('proposal_offered').map(e => e.payload)));
    tour.endTour();
  }

  // ---------------------------------------------------------------
  // PM suites (Nov 16, 2026): place-memory callbacks, v16.2
  // Slice 6 — ONE flavor of the Slice 5 proposal channel, not
  // a new channel and not the killed callback opener (nothing
  // here touches a tour start). PM-1 pins the pure derivation
  // (passed = owed on a concluded drive; discharged by the
  // heard ledger or a newer record's played list), the line,
  // and the speak-time heard judge; PM-2 the tray record's
  // heard-based expiry; PM-3 the freeform engine end to end;
  // PM-4 the priority rule (a place proposal outranks a
  // callback; both spend the same one cap); PM-5 the Driving
  // absence with the flavor wired; PM-6 the heard-at-speak
  // drop in-engine.
  const PM_NOW = Date.UTC(2026, 10, 18, 19, 0, 0);
  const pmRecord = (over = {}) => ({
    destinationName: 'Old Town', destinationPlaceKey: null, threadTopic: null,
    playedSubjects: [], owedSubjects: ['Echo Observatory'], endedAt: 0, ...over,
  });

  suite('PM-1 derivation: passed-but-unheard only, discharged by hearing, newest pass wins; the line; the speak judge');
  {
    const T_OLD = Date.UTC(2026, 8, 5, 18, 0, 0);
    const T_NEW = Date.UTC(2026, 9, 20, 18, 0, 0);
    const records = [
      pmRecord({ endedAt: T_NEW, playedSubjects: ['Alpha Park'], owedSubjects: ['Gamma Pier'] }),
      pmRecord({ endedAt: T_OLD, playedSubjects: [], owedSubjects: ['Beta Museum', 'Alpha Park', 'Gamma Pier'] }),
    ];
    const derived = placeMemory.deriveCallbackCandidates(records, new Set(), PM_NOW);
    check('owed-and-unheard places derive, newest pass first, one candidate per place',
      derived.length === 2 && derived[0].name === 'Gamma Pier' && derived[1].name === 'Beta Museum',
      JSON.stringify(derived.map(c => c.name)));
    check('the candidate carries the newest owing record\'s pass date (the memory the line speaks)',
      derived[0].lastPassedAt === T_NEW && derived[1].lastPassedAt === T_OLD);
    check('a place played on a NEWER drive is discharged — heard since it was owed',
      derived.every(c => c.name !== 'Alpha Park'));
    check('the place id is the namespaced normalized name',
      derived[0].placeId === 'memory:gamma pier' && derived[1].placeId === 'memory:beta museum');
    check('the heard ledger discharges at derivation: a heard place is never a candidate',
      placeMemory.deriveCallbackCandidates(records, new Set(['beta museum']), PM_NOW)
        .every(c => c.name !== 'Beta Museum'));
    check('places already proposed this drive are excluded by id',
      placeMemory.deriveCallbackCandidates(records, new Set(), PM_NOW, { excludePlaceIds: new Set(['memory:gamma pier']) })
        .every(c => c.name !== 'Gamma Pier'));
    check('no records — or no owed subjects — derive nothing',
      placeMemory.deriveCallbackCandidates([], new Set(), PM_NOW).length === 0 &&
      placeMemory.deriveCallbackCandidates([pmRecord({ owedSubjects: [] })], new Set(), PM_NOW).length === 0);
    check('the line speaks the pass month, same-year',
      placeMemory.composeCallbackLine('Beta Museum', Date.UTC(2026, 9, 14, 18, 0, 0), PM_NOW) ===
        "You passed Beta Museum back in October — its story's still unheard.");
    check('the line speaks a same-month pass plainly',
      placeMemory.composeCallbackLine('Beta Museum', Date.UTC(2026, 10, 3, 18, 0, 0), PM_NOW) ===
        "You passed Beta Museum earlier this month — its story's still unheard.");
    check('the line carries the year when the pass was last year',
      placeMemory.composeCallbackLine('Beta Museum', Date.UTC(2025, 11, 25, 18, 0, 0), PM_NOW) ===
        "You passed Beta Museum back in December 2025 — its story's still unheard.");
    const cand = derived[0];
    check('the speak-time judge passes an unheard callback',
      placeMemory.judgeCallbackAtSpeak(cand, new Set()).ok === true);
    check('the speak-time judge drops a callback heard since selection, as heard-at-speak',
      placeMemory.judgeCallbackAtSpeak(cand, new Set(['gamma pier'])).reason === 'heard-at-speak');
  }

  suite('PM-2 the tray record: a callback expires on heard evidence, never on hours; legacy records read as place flavor');
  {
    resetLocalStorage();
    const store = proposals.localProposalStore;
    proposals.recordProposal(store, {
      placeId: 'memory:beta museum', name: 'Beta Museum', kind: 'story', primaryReason: 'place-memory',
      closesAtMs: null, hoursFetchedAt: UP_NOW, offeredAt: UP_NOW, sessionId: 'pm-sim', state: 'spoken',
      flavor: 'place-memory', passedAt: UP_NOW - 40 * UP_DAY_MS,
    });
    check('a spoken callback stands in the tray, actionable while its story is unheard',
      proposals.trayEntries(store, UP_NOW).length === 1 &&
      proposals.trayEntries(store, UP_NOW)[0].judgment.actionable === true);
    check('no hours claim can expire it: months later, still unheard, still actionable',
      proposals.trayEntries(store, UP_NOW + 90 * UP_DAY_MS)[0].judgment.actionable === true);
    check('heard since — the entry renders expired: visible, never actionable',
      (() => {
        const j = proposals.judgeTrayRecord(
          proposals.loadProposalRecords(store)[0], UP_NOW, new Set(['beta museum']));
        return j.visible && j.expired && !j.actionable;
      })());
    check('an unrelated heard set leaves it actionable',
      proposals.judgeTrayRecord(proposals.loadProposalRecords(store)[0], UP_NOW, new Set(['other place']))
        .actionable === true);
    proposals.recordProposal(store, {
      placeId: 'pm-tacos', name: 'Beta Museum', kind: 'eat', primaryReason: 'open-now',
      closesAtMs: UP_NOW + 3_600_000, hoursFetchedAt: UP_NOW - 60_000, offeredAt: UP_NOW,
      sessionId: 'pm-sim', state: 'spoken', flavor: 'place', passedAt: null,
    });
    check('a PLACE entry is never expired by heard evidence — its hours alone judge it',
      (() => {
        const rec = proposals.loadProposalRecords(store).find(r => r.placeId === 'pm-tacos');
        const j = proposals.judgeTrayRecord(rec, UP_NOW, new Set(['beta museum']));
        return j.expired === false && j.actionable === true;
      })());
    store.write(JSON.stringify([{
      placeId: 'legacy-place', name: 'Legacy', kind: 'eat', primaryReason: 'open-now',
      closesAtMs: null, hoursFetchedAt: UP_NOW, offeredAt: UP_NOW, sessionId: null, state: 'spoken',
    }]));
    check('a pre-flavor record (no flavor / passedAt fields) reads back as a place record',
      proposals.loadProposalRecords(store).length === 1 &&
      proposals.loadProposalRecords(store)[0].flavor === 'place' &&
      proposals.loadProposalRecords(store)[0].passedAt === null);
    resetLocalStorage();
  }

  suite('PM-3 freeform end to end: an empty pool arms a callback; it speaks once, trays, and resolves on the proposal vocabulary');
  {
    resetLocalStorage();
    const world = upWorld({ eventCandidates: [], driveRecords: [pmRecord()] });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 15_000 }));
    const { tour } = await healthyOpening(world, audio);
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    for (let i = 0; i < 80 && tour.view().diagnostics.proposalsSpoken !== 1; i++) {
      await world.clock.advance(5_000);
    }
    const offered = world.eventsOf('proposal_offered');
    check('exactly one proposal was offered — the callback, flavor-tagged in the shared vocabulary',
      offered.length === 1 && offered[0].payload.place_id === 'memory:echo observatory' &&
      offered[0].payload.flavor === 'place-memory' && offered[0].payload.primary_reason === 'place-memory' &&
      offered[0].payload.candidate_kind === 'story' && offered[0].payload.sponsored === false &&
      offered[0].payload.detour_minutes === null,
      JSON.stringify(offered.map(e => e.payload)));
    check('the offer never sounded inside the first minute (the seam fences bind callbacks identically)',
      offered.length === 1 && offered[0].at >= 60_000, `at=${offered[0]?.at}`);
    check('proposal_playback filed with the flavor tag',
      world.eventsOf('proposal_playback').length === 1 &&
      world.eventsOf('proposal_playback')[0].payload.flavor === 'place-memory' &&
      world.eventsOf('proposal_playback')[0].payload.completed === true);
    check('the pending pick is the callback, tagged by source',
      tour.view().suggestion.pending?.placeId === 'memory:echo observatory' &&
      tour.view().suggestion.pending?.source === 'proposed');
    const records = proposals.loadProposalRecords(proposals.localProposalStore);
    check('the lifecycle record stands as a place-memory entry carrying the pass date',
      records.length === 1 && records[0].flavor === 'place-memory' && records[0].kind === 'story' &&
      records[0].passedAt === 0 && records[0].state === 'spoken',
      JSON.stringify(records));
    check('the tray entry is actionable while unheard, expired once heard',
      proposals.trayEntries(proposals.localProposalStore, world.clock.now())[0].judgment.actionable === true &&
      proposals.trayEntries(proposals.localProposalStore, world.clock.now(), new Set(['echo observatory']))[0]
        .judgment.expired === true);
    check('resolving files proposal_outcome with the flavor — never suggestion_outcome',
      tour.resolveSuggestion('accepted') === true &&
      world.eventsOf('proposal_outcome').length === 1 &&
      world.eventsOf('proposal_outcome')[0].payload.flavor === 'place-memory' &&
      world.eventsOf('proposal_outcome')[0].payload.surface === 'drive' &&
      world.eventsOf('suggestion_outcome').length === 0);
    await world.clock.advance(120_000);
    check('the shared cap holds: the callback spent the drive\'s one proposal',
      world.eventsOf('proposal_offered').length === 1);
    tour.endTour();
  }

  suite('PM-4 the priority rule: with both flavors standing, the place proposal arms and the callback never fires');
  {
    resetLocalStorage();
    const world = upWorld({ driveRecords: [pmRecord()] });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 15_000 }));
    const { tour } = await healthyOpening(world, audio);
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    for (let i = 0; i < 80 && tour.view().diagnostics.proposalsSpoken !== 1; i++) {
      await world.clock.advance(5_000);
    }
    const offered = world.eventsOf('proposal_offered');
    check('the offered proposal is the place pick, flavor place',
      offered.length === 1 && offered[0].payload.place_id === 'up-tacos' &&
      offered[0].payload.flavor === 'place',
      JSON.stringify(offered.map(e => e.payload)));
    check('resolving the place pick is accepted', tour.resolveSuggestion('accepted') === true);
    await world.clock.advance(120_000);
    check('no callback follows — one cap, spent by the place (a callback is evergreen; it waits for a later drive)',
      world.eventsOf('proposal_offered').length === 1);
    tour.endTour();
  }

  suite('PM-5 Driving with the flavor wired: total absence — no offers, no events, no tray records');
  {
    resetLocalStorage();
    const world = upWorld({ declaredMode: 'driving', eventCandidates: [], driveRecords: [pmRecord()] });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 15_000 }));
    const tour = await startAt(world, audio, UTC);
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(240_000);
    check('setup: story boundaries really happened on the Driving ride (the absence is not vacuous)',
      world.eventsOf('story_playback').length >= 3,
      `${world.eventsOf('story_playback').length}`);
    check('a Driving ride files zero proposal events even with drive records standing',
      proposalEvents(world).length === 0,
      JSON.stringify(proposalEvents(world).map(e => e.type)));
    check('and writes no tray records', proposals.loadProposalRecords(proposals.localProposalStore).length === 0);
    tour.endTour();
  }

  suite('PM-6 heard-at-speak in-engine: the callback place\'s own story sounds between selection and speech — dropped silently, cap unspent');
  {
    resetLocalStorage();
    // Gamma Pier is the shelf's third subject: armed at the
    // boundary before its own settle (after a first-minute
    // suppression cycle), its story sounds AT the speak
    // boundary — the settle files it heard before the seam
    // judges, so the re-judgment must drop the callback.
    const world = upWorld({ eventCandidates: [], driveRecords: [pmRecord({ owedSubjects: ['Gamma Pier'] })] });
    const audio = new FakeAudio(world.clock, okPolicy({ library: 15_000 }));
    const { tour } = await healthyOpening(world, audio);
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(240_000);
    const dropped = world.eventsOf('proposal_dropped').filter(e => e.payload.flavor === 'place-memory');
    check('the heard-at-speak drop filed exactly once, with its reason and place',
      dropped.length === 1 && dropped[0].payload.reason === 'heard-at-speak' &&
      dropped[0].payload.place_id === 'memory:gamma pier',
      JSON.stringify(world.eventsOf('proposal_dropped').map(e => e.payload)));
    check('nothing was offered or sounded — the drop is silent by construction',
      world.eventsOf('proposal_offered').length === 0 && tour.view().diagnostics.proposalsSpoken === 0);
    check('no tray record was written for a callback never spoken',
      proposals.loadProposalRecords(proposals.localProposalStore).length === 0);
    tour.endTour();
  }

  // ---------------------------------------------------------------
  // SP suites (Nov 16, 2026): the live-spend sub-cap, v16.2
  // Slice 8. The suggestion / current-events layer's Places
  // asks are charged an estimate against an on-device monthly
  // ledger; at the $10 pilot cap the asks stop and discovery
  // degrades to the hours cache — never silence, never a
  // fabricated claim. SP-1 pins the ledger + the shipped
  // constants, SP-2 governance at discovery under budget,
  // SP-3 the cap trip and the degraded serve, SP-4 the
  // crossing ask (in-flight completes) and the tour wiring.
  const SP_EST = liveSpend.LIVE_SPEND_POLICY.placesSearchNearbyMicroUsd;
  const SP_CAP = liveSpend.LIVE_SPEND_POLICY.monthlyCapMicroUsd;
  const spFill = (store, nowMs, microUsd, asks) =>
    store.write(JSON.stringify({ v: 1, months: { [liveSpend.spendMonthKey(nowMs)]: { microUsd, asks } } }));
  const spEvents = () => {
    const list = [];
    return { list, sink: (type, payload) => list.push({ type, payload }) };
  };

  suite('SP-1 the ledger: estimates accumulate, persist across governors, roll over with the month; the shipped constants are the pilot numbers');
  {
    check('the cap is the brief\'s $10/mo pilot sub-cap, in micro-USD', SP_CAP === 10_000_000, `${SP_CAP}`);
    check('one Places ask is estimated at the Enterprise + Atmosphere list: $0.040', SP_EST === 40_000, `${SP_EST}`);

    const NOV = new Date(2026, 10, 15, 12, 0, 0).getTime();
    const DEC = new Date(2026, 11, 15, 12, 0, 0).getTime();
    check('the month key is the device-local calendar month', liveSpend.spendMonthKey(NOV) === '2026-11' && liveSpend.spendMonthKey(DEC) === '2026-12');

    const store = ceMemStore();
    const gov = liveSpend.createSpendGovernor({ store, nowMs: NOV });
    const first = gov.beginPlacesAsk();
    check('a first ask dispatches and charges the estimate', first !== null && first.monthMicroUsd === SP_EST && first.monthAsks === 1);
    const second = gov.beginPlacesAsk();
    check('asks accumulate in integer micro-USD', second !== null && second.monthMicroUsd === 2 * SP_EST && second.monthAsks === 2);
    check('the month reads back through the ledger API', (() => {
      const m = liveSpend.monthSpend(store, NOV);
      return m.microUsd === 2 * SP_EST && m.asks === 2 && m.monthKey === '2026-11';
    })());

    const nextSession = liveSpend.createSpendGovernor({ store, nowMs: NOV });
    check('a new governor over the same store sees the standing total (persistence across sessions)',
      nextSession.monthMicroUsd() === 2 * SP_EST && nextSession.degraded() === false);

    spFill(store, NOV, SP_CAP, 250);
    check('a month standing at the cap is degraded, and further asks are refused',
      liveSpend.spendCapReached(store, NOV) === true && gov.beginPlacesAsk() === null);
    check('rollover: the new month starts at zero under the same ledger', (() => {
      const m = liveSpend.monthSpend(store, DEC);
      return m.microUsd === 0 && m.asks === 0 && liveSpend.spendCapReached(store, DEC) === false;
    })());
    const decGov = liveSpend.createSpendGovernor({ store, nowMs: DEC });
    check('rollover: December asks dispatch again, charged to December',
      decGov.beginPlacesAsk() !== null && liveSpend.monthSpend(store, DEC).microUsd === SP_EST &&
      liveSpend.monthSpend(store, NOV).microUsd === SP_CAP);

    const corrupt = ceMemStore();
    corrupt.write('not a ledger {');
    check('a corrupt ledger reads as empty and never blocks an ask',
      liveSpend.monthSpend(corrupt, NOV).microUsd === 0 &&
      liveSpend.createSpendGovernor({ store: corrupt, nowMs: NOV }).beginPlacesAsk() !== null);
  }

  suite('SP-2 governance at discovery: under budget the cap is invisible — asks dispatch, each is charged and filed');
  {
    const spendStore = ceMemStore();
    const ev = spEvents();
    let calls = 0;
    const counting = { fetchPlaces: async () => { calls += 1; return [ceRaw()]; } };
    const pool = await currentEvents.discoverEventCandidates([CE_ANCHOR], {
      nowMs: CE_NOW, provider: counting, match: CE_NO_MATCH, constraints: CE_NO_CONSTRAINTS,
      cache: null, spendStore, onSpendEvent: ev.sink,
    });
    check('the candidate still arrives, exactly as ungoverned discovery serves it', pool.length === 1 && pool[0].placeId === 'ce-place-1');
    check('one anchor is one dispatched ask', calls === 1, `calls=${calls}`);
    const asks = ev.list.filter(e => e.type === 'live_spend_ask');
    check('the ask is filed with its estimate and the running monthly total',
      asks.length === 1 && asks[0].payload.est_micro_usd === SP_EST && asks[0].payload.month_micro_usd === SP_EST &&
      asks[0].payload.cap_micro_usd === SP_CAP && asks[0].payload.surface === 'places-search-nearby',
      JSON.stringify(ev.list));
    check('no cap or degraded event fires under budget', ev.list.every(e => e.type === 'live_spend_ask'));
    check('the ledger holds the charge', liveSpend.monthSpend(spendStore, CE_NOW).microUsd === SP_EST);

    const two = await currentEvents.discoverEventCandidates(
      [CE_ANCHOR, { lat: 32.9, lng: -117.18, kind: 'destination' }],
      { nowMs: CE_NOW, provider: counting, match: CE_NO_MATCH, constraints: CE_NO_CONSTRAINTS, cache: null, spendStore, onSpendEvent: ev.sink },
    );
    check('a two-anchor discovery is two asks — the total is three estimates',
      calls === 3 && two.length === 1 && liveSpend.monthSpend(spendStore, CE_NOW).microUsd === 3 * SP_EST,
      `calls=${calls}`);
  }

  suite('SP-3 the cap trip: asks stop dispatching, discovery degrades to the freshness-gated cache, and the none-answer stays honest');
  {
    // Prime a cache through a live fetch on a solvent ledger.
    const cacheStore = ceMemStore();
    const solvent = ceMemStore();
    const primed = await currentEvents.discoverEventCandidates([CE_ANCHOR], {
      nowMs: CE_NOW, provider: ceProvider([ceRaw()]), match: CE_NO_MATCH, constraints: CE_NO_CONSTRAINTS,
      cache: cacheStore, spendStore: solvent,
    });
    check('the priming fetch lands a candidate and writes the cache', primed.length === 1 && currentEvents.loadHoursCache(cacheStore).has('ce-place-1'));

    // The same road on an exhausted ledger: the provider would
    // return a DIFFERENT place — it must never be asked.
    const capped = ceMemStore();
    spFill(capped, CE_NOW, SP_CAP, 250);
    const ev = spEvents();
    let calls = 0;
    const other = { fetchPlaces: async () => { calls += 1; return [ceRaw({ placeId: 'ce-other', name: 'Ce Other Eats' })]; } };
    const degraded = await currentEvents.discoverEventCandidates([CE_ANCHOR], {
      nowMs: CE_NOW, provider: other, match: CE_NO_MATCH, constraints: CE_NO_CONSTRAINTS,
      cache: cacheStore, spendStore: capped, onSpendEvent: ev.sink,
    });
    check('at the cap the provider is never dispatched', calls === 0, `calls=${calls}`);
    check('degradation serves the cached candidate — the channel keeps answering from what it has',
      degraded.length === 1 && degraded[0].placeId === 'ce-place-1', JSON.stringify(degraded.map(c => c.placeId)));
    check('the cap-trip is filed, and the degraded serve is filed once with its reason code',
      ev.list.filter(e => e.type === 'live_spend_capped').length === 1 &&
      ev.list.filter(e => e.type === 'live_spend_degraded').length === 1 &&
      ev.list.find(e => e.type === 'live_spend_degraded').payload.reason === 'spend-cap',
      JSON.stringify(ev.list));
    check('no ask is charged for a dispatch that never happened', liveSpend.monthSpend(capped, CE_NOW).microUsd === SP_CAP);

    // Degraded with nothing cached: an empty pool, and the
    // composer's honest none — never an invented place.
    const ev2 = spEvents();
    const empty = await currentEvents.discoverEventCandidates([CE_ANCHOR], {
      nowMs: CE_NOW, provider: other, match: CE_NO_MATCH, constraints: CE_NO_CONSTRAINTS,
      cache: ceMemStore(), spendStore: capped, onSpendEvent: ev2.sink,
    });
    const noneAnswer = suggestions.composeSuggestion(empty, { intent: 'food', nowMs: CE_NOW });
    check('an empty degraded pool composes the honest pool-empty none-answer',
      empty.length === 0 && noneAnswer.kind === 'none' && noneAnswer.reasonCodes[0] === 'pool-empty');

    // Degraded with only STALE cache: freshness still binds —
    // the cap never licenses a stale "open now".
    const staleCache = ceMemStore();
    staleCache.write(JSON.stringify({
      v: 1,
      entries: { 'ce-place-1': ceRaw({ hours: ceHours({ fetchedAt: CE_NOW - 8 * CE_DAY_MS }) }) },
    }));
    const stale = await currentEvents.discoverEventCandidates([CE_ANCHOR], {
      nowMs: CE_NOW, provider: other, match: CE_NO_MATCH, constraints: CE_NO_CONSTRAINTS,
      cache: staleCache, spendStore: capped,
    });
    check('a stale cached record stays ineligible in degradation — no fabricated open-now', stale.length === 0);
  }

  suite('SP-4 the crossing ask: an ask dispatched under the cap completes and counts; the next is refused — and the tour files spend on its emit path');
  {
    // One ask of headroom left in the month.
    const spendStore = ceMemStore();
    spFill(spendStore, CE_NOW, SP_CAP - SP_EST, 249);
    const ev = spEvents();
    let calls = 0;
    const counting = { fetchPlaces: async () => { calls += 1; return [ceRaw()]; } };
    const pool = await currentEvents.discoverEventCandidates(
      [CE_ANCHOR, { lat: 32.9, lng: -117.18, kind: 'destination' }],
      { nowMs: CE_NOW, provider: counting, match: CE_NO_MATCH, constraints: CE_NO_CONSTRAINTS, cache: null, spendStore, onSpendEvent: ev.sink },
    );
    check('the crossing ask dispatches and its results serve — in-flight is never recalled',
      calls === 1 && pool.length === 1 && pool[0].placeId === 'ce-place-1', `calls=${calls}`);
    check('the crossing charge lands: the month stands exactly at the cap',
      liveSpend.monthSpend(spendStore, CE_NOW).microUsd === SP_CAP);
    check('the second anchor is refused at dispatch and the degraded serve is filed',
      ev.list.filter(e => e.type === 'live_spend_capped').length === 1 &&
      ev.list.filter(e => e.type === 'live_spend_degraded').length === 1,
      JSON.stringify(ev.list));
    const gov = liveSpend.createSpendGovernor({ store: spendStore, nowMs: CE_NOW });
    check('from the cap on, the governor reports degraded and refuses every further ask',
      gov.degraded() === true && gov.beginPlacesAsk() === null);

    // The freeform wiring: the pool refresh hands discovery a
    // spend sink on the engine's own emit path (the harness
    // seam fakes the network edge, so the wiring is what is
    // pinned here; discovery-level filing is SP-2/SP-3).
    resetLocalStorage();
    const world = makeWorld(Tour, {
      candidates: [makeCandidate('Balboa Park')],
      library: ['Balboa Park'],
      eventCandidates: [],
    });
    const audio = new FakeAudio(world.clock, okPolicy());
    const tour = await startAt(world, audio, UTC);
    await world.clock.advance(40_000);
    tour.onPosition({ lat: UTC.lat + 0.003, lng: UTC.lng, speedMps: 8, headingDeg: 180 });
    await world.clock.advance(10_000);
    const sink = world.eventCandidateCalls[0]?.opts.onSpendEvent;
    check('the refresh passes a spend-event sink into discovery', typeof sink === 'function',
      JSON.stringify(Object.keys(world.eventCandidateCalls[0]?.opts ?? {})));
    sink('live_spend_ask', { surface: 'places-search-nearby', est_micro_usd: SP_EST, month_micro_usd: SP_EST, cap_micro_usd: SP_CAP });
    check('the sink files on the tour\'s emit path, payload intact',
      world.eventsOf('live_spend_ask').length === 1 && world.eventsOf('live_spend_ask')[0].payload.month_micro_usd === SP_EST);
    tour.endTour();
  }
}
