// Harness primitives for the fresh-shell verification suite:
// a manual clock, a scripted audio element, and fake backend seams.
// Everything the engine touches (time, audio, network) is fake and
// deterministic; assertions run against the play log, the emitted
// event stream, and the engine's own view.

export class FakeClock {
  constructor() {
    this.t = 0;
    this.nextId = 1;
    this.timers = new Map(); // id -> {at, fn, interval|null}
  }
  now() {
    return this.t;
  }
  setTimeout(fn, ms) {
    const id = this.nextId++;
    this.timers.set(id, { at: this.t + ms, fn, interval: null });
    return id;
  }
  setInterval(fn, ms) {
    const id = this.nextId++;
    this.timers.set(id, { at: this.t + ms, fn, interval: ms });
    return id;
  }
  clearTimeout(id) {
    this.timers.delete(id);
  }
  clearInterval(id) {
    this.timers.delete(id);
  }
  async flush() {
    for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
  }
  /** Advance virtual time, firing timers in order and flushing microtasks. */
  async advance(ms) {
    const target = this.t + ms;
    // Drain already-queued microtasks BEFORE the first timer fires:
    // a resolved promise (e.g. play()) always lands before any
    // timer in a real event loop, however soon that timer is due.
    await this.flush();
    let fires = 0;
    for (;;) {
      if (++fires > 500_000) {
        throw new Error(
          `FakeClock runaway: >500k timer fires advancing to ${target} (stuck at t=${this.t}, ${this.timers.size} timers pending)`,
        );
      }
      let next = null;
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && (next === null || timer.at < next.timer.at)) {
          next = { id, timer };
        }
      }
      if (!next) break;
      this.t = next.timer.at;
      if (next.timer.interval !== null) {
        next.timer.at = this.t + next.timer.interval;
      } else {
        this.timers.delete(next.id);
      }
      next.timer.fn();
      await this.flush();
    }
    this.t = target;
    await this.flush();
  }
}

const namedError = name => Object.assign(new Error(name), { name });

/**
 * Scripted AudioPort. The policy receives {index, src, at} per play()
 * call and returns one of:
 *   {action:'ok', durationMs}   playback starts; 'ended' fires after durationMs
 *   {action:'reject', name}     play() rejects (default NotAllowedError)
 *   {action:'error', afterMs}   playback starts; element error fires after afterMs
 *   {action:'hang'}             play() never settles
 */
export class FakeAudio {
  constructor(clock, policy) {
    this.clock = clock;
    this.policy = policy;
    this.src = null;
    this.log = []; // {index, src, at, action}
    this.callIndex = 0;
    this.playing = null; // {src, startedAt}
    this.endedCb = null;
    this.errorCb = null;
    this.endTimer = null;
    this.errTimer = null;
    this.preempted = null; // {src, cls} of the last sounding cut by load()
    this.onPlay = null; // optional probe(src) at each play() call
  }
  classify(src) {
    if (src === null || src === undefined) return 'none';
    if (src.includes('openers/intros/') || src.includes('miles/intros/')) return 'greeting';
    if (src.includes('stall-phrases/')) return 'stall';
    if (src.includes('fillers/bridges/')) return 'bridge';
    if (src.includes('fillers/audio/')) return 'filler';
    if (src.includes('library/')) return 'library';
    if (src.includes('openers/')) return 'opener';
    if (src.startsWith('blob:')) return blobSizes.get(src) === 3244 ? 'sample-prime' : 'synth';
    if (src.startsWith('data:')) return 'sample-prime';
    return 'other';
  }
  load(src) {
    // Element semantics: loading a new source stops the old one.
    // If something was sounding, record the preemption so probes
    // can judge whether it was legitimate (sample/stall sharing)
    // or a true overlap (one item cutting another).
    if (this.playing && this.playing.src !== src) {
      this.preempted = { src: this.playing.src, cls: this.classify(this.playing.src) };
    }
    this.src = src;
    this.stopTimers();
    this.playing = null;
  }
  play() {
    const src = this.src;
    const index = this.callIndex++;
    const behavior = this.policy({ index, src, at: this.clock.now(), cls: this.classify(src) });
    this.log.push({ index, src, at: this.clock.now(), action: behavior.action, cls: this.classify(src) });
    if (this.onPlay) this.onPlay(src, behavior);
    if (behavior.action === 'reject') {
      return Promise.reject(namedError(behavior.name ?? 'NotAllowedError'));
    }
    if (behavior.action === 'hang') {
      return new Promise(() => {});
    }
    if (behavior.action === 'delay') {
      // play() itself resolves late (a slow prime), then plays.
      return new Promise(resolve => {
        this.clock.setTimeout(() => {
          this.playing = { src, startedAt: this.clock.now() };
          this.endTimer = this.clock.setTimeout(() => {
            this.playing = null;
            if (this.endedCb) this.endedCb();
          }, behavior.durationMs ?? 5000);
          resolve();
        }, behavior.delayMs ?? 10000);
      });
    }
    this.playing = { src, startedAt: this.clock.now() };
    if (behavior.action === 'error') {
      this.errTimer = this.clock.setTimeout(() => {
        this.playing = null;
        if (this.errorCb) this.errorCb();
      }, behavior.afterMs ?? 2000);
    } else {
      this.endTimer = this.clock.setTimeout(() => {
        this.playing = null;
        if (this.endedCb) this.endedCb();
      }, behavior.durationMs ?? 5000);
    }
    return Promise.resolve();
  }
  pause() {
    this.stopTimers();
    this.playing = null;
  }
  seekBy() {}
  timeSec() {
    return this.playing ? (this.clock.now() - this.playing.startedAt) / 1000 : 0;
  }
  setEndedHandler(cb) {
    this.endedCb = cb;
  }
  setErrorHandler(cb) {
    this.errorCb = cb;
  }
  stopTimers() {
    if (this.endTimer !== null) this.clock.clearTimeout(this.endTimer);
    if (this.errTimer !== null) this.clock.clearTimeout(this.errTimer);
    this.endTimer = null;
    this.errTimer = null;
  }
  plays(cls) {
    return this.log.filter(e => e.cls === cls);
  }
}

// Tag blob URLs by size so the sample prime (3244-byte WAV) is
// distinguishable from synthesized speech blobs.
export const blobSizes = new Map();
const realCreate = URL.createObjectURL.bind(URL);
URL.createObjectURL = blob => {
  const url = realCreate(blob);
  blobSizes.set(url, blob.size);
  return url;
};

// In-memory localStorage so backend contract keys work under Node.
const lsStore = new Map();
globalThis.localStorage = {
  getItem: k => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: k => lsStore.delete(k),
};
export function resetLocalStorage() {
  lsStore.clear();
}

let candidateSeq = 0;
export function makeCandidate(name, opts = {}) {
  candidateSeq += 1;
  return {
    name,
    lat: opts.lat ?? 32.853,
    lng: opts.lng ?? -117.18,
    source: opts.source ?? 'places',
    types: opts.types ?? ['point_of_interest'],
    rating: opts.rating ?? 4.5,
    userRatings: opts.userRatings ?? 500,
    address: opts.address ?? '1 Test Way',
    tier1: opts.tier1 ?? false,
    score: opts.score ?? 100 - candidateSeq,
    registry: null,
    distanceM: opts.distanceM ?? 100,
  };
}

const placeKeyOf = name => name.toLowerCase().trim();

/**
 * A "world": fake seams + fixtures + factories bound to one clock.
 * Options: candidates, library (names), fillers (titles), behaviors.
 */
export function makeWorld(Tour, opts = {}) {
  const clock = new FakeClock();
  const events = [];
  const world = {
    clock,
    events,
    candidates: opts.candidates ?? [],
    area: opts.area ?? { neighborhood: 'University City', city: 'San Diego' },
    storyTextSeq: 0,
    answerTextSeq: 0,
    genStoryBehavior: opts.genStoryBehavior ?? null, // fn(prompt) -> text | throw | 'hang'
    genAnswerBehavior: opts.genAnswerBehavior ?? null,
    synthBehavior: opts.synthBehavior ?? null, // fn(text) -> Blob | throw
    ttsQuota: false,
    storyQuota: false,
    cache: new Map(), // audio cache: key -> Blob
    heard: [],
    likes: [],
    cachedStories: [],
    fillerPinFails: opts.fillerPinFails ?? false,
  };

  const libraryRows = new Map();
  const libraryIndex = [];
  for (const entry of opts.library ?? []) {
    const name = typeof entry === 'string' ? entry : entry.name;
    const lat = typeof entry === 'string' ? 32.853 : entry.lat ?? 32.853;
    const lng = typeof entry === 'string' ? -117.18 : entry.lng ?? -117.18;
    const key = placeKeyOf(name);
    libraryIndex.push({ place_key: key, place_name: name, angle: 'story', lat, lng });
    libraryRows.set(`${key}|story`, {
      place_key: key,
      place_name: name,
      angle: 'story',
      story_text: `The library story of ${name}. `.repeat(40),
      audio_path: `library/${key.replace(/\s+/g, '-')}.wav`,
      lat,
      lng,
    });
  }
  const fillerRows = (opts.fillers ?? []).map(title => ({
    place_key: placeKeyOf(title),
    place_name: title,
    angle: 'filler',
    story_text: '',
    audio_path: `fillers/audio/${placeKeyOf(title).replace(/[^a-z0-9]+/g, '-')}.wav`,
    lat: 0,
    lng: 0,
  }));

  const seams = {
    fetchLibraryIndex: async () => libraryIndex,
    fetchLibraryRow: async (key, angle) => libraryRows.get(`${key}|${angle}`) ?? null,
    fetchFillerRows: async () => fillerRows,
    findCachedStory: async () => null,
    putCachedStory: async rec => {
      world.cachedStories.push(rec);
    },
    fetchHeardTopics: async () => [],
    recordHeard: async (_session, topic) => {
      world.heard.push(topic);
    },
    recordLike: async (_session, topic) => {
      world.likes.push(topic);
    },
    emitEvent: async (_session, type, payload, ctx) => {
      // Mirror backend.emitEvent: build_id + tour_id ride every event.
      events.push({ type, payload: { ...payload, build_id: 'fresh-test', tour_id: _session }, ctx, at: clock.now() });
    },
    pinBucketAudio: async path => {
      if (world.fillerPinFails && path.includes('fillers/')) return;
      world.cache.set(path, new Blob(['audio']));
    },
    audioCacheGet: async key => world.cache.get(key) ?? null,
    audioCachePut: async (key, blob) => {
      world.cache.set(key, blob);
    },
    audioCacheHas: async key => world.cache.has(key),
    bucketUrl: path => `https://fake.test/storage/v1/object/public/tts-audio/${path}`,
    synthesize: async text => {
      if (world.synthBehavior) return world.synthBehavior(text);
      return new Blob([`speech:${text.length}`]);
    },
    generateStory: async prompt => {
      if (world.genStoryBehavior) return world.genStoryBehavior(prompt);
      world.storyTextSeq += 1;
      return `A generated story number ${world.storyTextSeq} about the road ahead, told with care and local color. `.repeat(3);
    },
    generatePrefetch: async prompt => {
      world.storyTextSeq += 1;
      void prompt;
      return `A prefetched story number ${world.storyTextSeq} about the road ahead. `.repeat(3);
    },
    generateAnswer: async prompt => {
      if (world.genAnswerBehavior) return world.genAnswerBehavior(prompt);
      world.answerTextSeq += 1;
      return `The answer to your question, number ${world.answerTextSeq}: here is what matters about this place. `.repeat(2);
    },
    ttsQuotaTripped: () => world.ttsQuota,
    storyQuotaTripped: () => world.storyQuota,
    discoverCandidates: async () => world.candidates,
    reverseArea: async () => world.area,
    buildFactPack: async (candidate, area) => ({
      name: candidate.name,
      lat: candidate.lat,
      lng: candidate.lng,
      types: candidate.types ?? [],
      rating: candidate.rating ?? null,
      address: candidate.address ?? null,
      neighborhood: area?.neighborhood ?? null,
      city: area?.city ?? null,
      wikipedia: `Facts about ${candidate.name}.`,
      wikidata: null,
      registryFacts: [],
      nearbyNames: [],
    }),
  };
  world.seams = seams;
  world.makeTour = audio => new Tour({ audio, clock, seams });
  world.eventsOf = type => events.filter(e => e.type === type);
  return world;
}

// Tiny assertion framework.
export const results = [];
let currentSuite = '';
export function suite(name) {
  currentSuite = name;
}
export function check(label, cond, detail = '') {
  results.push({ suite: currentSuite, label, pass: Boolean(cond), detail });
  if (!cond) console.log(`  FAIL ${currentSuite} :: ${label} ${detail}`);
}
export function summarize() {
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILURES:');
    for (const f of failed) console.log(` - ${f.suite} :: ${f.label} ${f.detail}`);
  }
  return failed.length === 0;
}
