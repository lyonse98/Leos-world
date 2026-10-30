import { supabase, SUPABASE_CONFIGURED } from './supabase';
import { storyLibrary } from './storyLibrary';
import { geminiAudio } from './geminiAudio';
import { analytics, trackDiag } from './analytics';
import {
  resolveFillerRegion,
  fillerTagsForTitle,
  fillerMatchFor,
  orderFillersForRegion,
  type FillerRegion,
  type FillerMatch,
} from '../data/fillerRegions';

// ---------------------------------------------------------------------------
// Silence fillers (Oct 28, 2026) — Erik's feature, spec:
// ~/workspace/leos-world/silence-fillers-v1.md.
//
// A bank of pre-rendered, county-general San Diego stories (leo-v14,
// angle 'filler' in story_library) served when TRUE silence stretches
// too long — coverage starvation, dead zones, TTS/breaker storms,
// quota trips: the audited silence causes. The lane's rules, settled:
//
//  - Trigger: 10 s of TRUE silence — nothing playing, the waiting
//    queue empty, the opening settled, no Q&A lock, no user pause.
//    A bridge clip opens the pair (first-filler bridge for a new
//    episode, continuation bridge for the next link), then one ~30 s
//    filler plays. A filler, once started, FINISHES — never cut;
//    a queue that recovers mid-filler plays next (Tier-1 behind the
//    filler per the warm-head rule, like any banked head).
//  - Chain: a filler that ends into still-empty queue re-arms for
//    another 10 s of silence, then the next link fires. Each filler
//    at most ONCE per tour; pool exhaustion stands the lane down to
//    honest silence — no repeats, no loops.
//  - Delivery — the dead-zone condition: the whole pool (fillers
//    + bridges; 72 + 51 since filler batch v2, Oct 30, 2026) is
//    PINNED ON-DEVICE at tour start, into the TTS
//    cache (geminiAudio's Blob store, keyed by exact text). A true
//    dead zone cannot fetch; a pinned clip resolves as an ordinary
//    cache hit, so the pair plays with zero network. A pair fires
//    only when BOTH clips are pinned — the filler never starts
//    cold (no bridge, no telling) and never in the wrong voice.
//  - Stall phrases own the first seconds of an IN-PLAYER wait; they
//    exist only while a location story synthesizes in the player,
//    a state this watcher's conditions exclude by construction —
//    the handoff is structural: one device per silence, never two
//    talking at once.
//  - Fillers are not place stories: they never touch the
//    told-subject ledger (storyCoverage), never mark a place told,
//    and do not interact with corridor expiry.
//  - Region-first pick (Oct 28, Erik approved): ONE lane, a
//    smarter pick — not a parallel watcher. At fire time the
//    driver's position resolves to a coarse region
//    (data/fillerRegions.ts, whose source of truth is
//    filler-regions.json); unplayed fillers tagged with that
//    region go first, then unplayed universals, then any
//    unplayed, the per-tour shuffle preserved within each tier.
//    The choice is made entirely on-device from the pinned pool —
//    GPS needs no network, and the region map ships in the app.
//    Outside the county (or with no fix yet) the region is null
//    and the pick is exactly the pre-region rotation.
//
// The watcher reads the world through the host the app registers
// (App owns tour state, the Q&A lock, and the player); playback goes
// back through the player's own queue as scripted items, so the
// settle guarantee, the attempt economy, and the never-cut courtesy
// are the player's, not a second implementation's.
// ---------------------------------------------------------------------------

export interface FillerSettleInfo {
  sounded: boolean;
  completed: boolean;
  soundedMs: number;
}

export interface FillerHostSnapshot {
  tourActive: boolean;
  // The Item 8 machine has finished the opening ('open', or 'failed'
  // — expired on the record with the tour proceeding). While the
  // greeting debt or the welcome is outstanding, silence belongs to
  // the opening, never to this lane.
  openingSettled: boolean;
  playing: boolean;
  queueLength: number;
  // A Q&A cycle is in flight (question submitted, answer not yet
  // fully played and stories not yet resumed).
  questionLocked: boolean;
  // Playback suspended pending the listener: the blocked banner, the
  // tap-to-resume state, or an active mute.
  userPaused: boolean;
  // The driver's latest fix, when one exists. Used only to resolve
  // the filler region at fire time; null leaves the pick general.
  position: { lat: number; lng: number } | null;
}

export interface FillerHost {
  snapshot(): FillerHostSnapshot;
  // Enqueue bridge (may be null) + filler as scripted player items;
  // onSettle fires exactly once with the filler's settle truth.
  // Returns false when the player refused the pair (muted race).
  play(
    bridge: { text: string } | null,
    filler: { text: string; title: string },
    onSettle: (info: FillerSettleInfo) => void
  ): boolean;
}

interface FillerClip {
  id: string; // the row's audio_path — unique per clip
  title: string; // place_name — the display/Media Session title
  text: string; // story_text, verbatim — the TTS-cache pin key
  audioPath: string;
}

interface BridgeClip {
  slug: string;
  kind: 'first' | 'continuation';
  text: string;
  bucketKey: string;
}

// Bridge manifest — mirrors filler-corpus-v1/bridges-manifest.json
// (built by scripts/library/build-fillers.mjs). Transcripts are the
// exact synthesized texts: the pin key, like every clip here.
const BRIDGES: BridgeClip[] = [
  {
    slug: 'bridge-first-1',
    kind: 'first',
    text: "While we've got a quiet stretch of road here — let me tell you something about this town most people never hear.",
    bucketKey: 'fillers/bridges/bridge-first-1.wav',
  },
  {
    slug: 'bridge-first-2',
    kind: 'first',
    text: 'This is a good spot for a story that belongs to the whole county, not just one corner of it.',
    bucketKey: 'fillers/bridges/bridge-first-2.wav',
  },
  {
    slug: 'bridge-first-3',
    kind: 'first',
    text: "Give me thirty seconds on this one. It's worth it.",
    bucketKey: 'fillers/bridges/bridge-first-3.wav',
  },
  {
    slug: 'bridge-next-1',
    kind: 'continuation',
    text: "And since we've got the road to ourselves a little longer — here's another one.",
    bucketKey: 'fillers/bridges/bridge-next-1.wav',
  },
  {
    slug: 'bridge-next-2',
    kind: 'continuation',
    text: 'One more, while the town catches up with us.',
    bucketKey: 'fillers/bridges/bridge-next-2.wav',
  },

  // v2 batch (Erik-approved Oct 30, 2026; rendered + ingested with
  // filler batch v2 — see filler-batch-v2/render-report.md). Mirrors
  // B's BRIDGE_CLIPS list and kind mapping exactly, translated to
  // A's kinds: settling-in + quiet-stretch -> 'first' (17),
  // time/pivot/return/weather -> 'continuation' (29).
  {
    slug: 'v2-settle-1',
    kind: 'first',
    text: "Settle in — I've got one that's pure San Diego.",
    bucketKey: 'fillers/bridges/v2-settle-1.wav',
  },
  {
    slug: 'v2-settle-2',
    kind: 'first',
    text: "Alright, my pick this time. And it's a good one.",
    bucketKey: 'fillers/bridges/v2-settle-2.wav',
  },
  {
    slug: 'v2-settle-3',
    kind: 'first',
    text: "Here's a story I never get tired of telling.",
    bucketKey: 'fillers/bridges/v2-settle-3.wav',
  },
  {
    slug: 'v2-settle-4',
    kind: 'first',
    text: "Quiet stretch? Perfect. Let me tell you one about the whole county.",
    bucketKey: 'fillers/bridges/v2-settle-4.wav',
  },
  {
    slug: 'v2-settle-5',
    kind: 'first',
    text: "This next one doesn't belong to any single place. It belongs to everywhere around here.",
    bucketKey: 'fillers/bridges/v2-settle-5.wav',
  },
  {
    slug: 'v2-settle-6',
    kind: 'first',
    text: "Give me a minute with this one. It pays off.",
    bucketKey: 'fillers/bridges/v2-settle-6.wav',
  },
  {
    slug: 'v2-settle-7',
    kind: 'first',
    text: "Okay. A story with no address — it rides along anywhere.",
    bucketKey: 'fillers/bridges/v2-settle-7.wav',
  },
  {
    slug: 'v2-settle-8',
    kind: 'first',
    text: "I've been saving this one for exactly this kind of moment.",
    bucketKey: 'fillers/bridges/v2-settle-8.wav',
  },
  {
    slug: 'v2-settle-9',
    kind: 'first',
    text: "No landmark needed for this one. Just a county truth.",
    bucketKey: 'fillers/bridges/v2-settle-9.wav',
  },
  {
    slug: 'v2-settle-10',
    kind: 'first',
    text: "Let me take the conversation for a stretch.",
    bucketKey: 'fillers/bridges/v2-settle-10.wav',
  },
  {
    slug: 'v2-time-1',
    kind: 'continuation',
    text: "Miles go down smoother with a story riding on them.",
    bucketKey: 'fillers/bridges/v2-time-1.wav',
  },
  {
    slug: 'v2-time-2',
    kind: 'continuation',
    text: "A few more minutes of road calls for a few more minutes of story.",
    bucketKey: 'fillers/bridges/v2-time-2.wav',
  },
  {
    slug: 'v2-time-3',
    kind: 'continuation',
    text: "Time passes differently when somebody's talking.",
    bucketKey: 'fillers/bridges/v2-time-3.wav',
  },
  {
    slug: 'v2-time-4',
    kind: 'continuation',
    text: "Let's spend the next stretch on something worth knowing.",
    bucketKey: 'fillers/bridges/v2-time-4.wav',
  },
  {
    slug: 'v2-time-5',
    kind: 'continuation',
    text: "Nothing to hurry about. There's time, and I have material.",
    bucketKey: 'fillers/bridges/v2-time-5.wav',
  },
  {
    slug: 'v2-time-6',
    kind: 'continuation',
    text: "We've got road ahead, and I've got stories. Fair trade.",
    bucketKey: 'fillers/bridges/v2-time-6.wav',
  },
  {
    slug: 'v2-time-7',
    kind: 'continuation',
    text: "A long drive is just small stories stacked up. Here's another for the pile.",
    bucketKey: 'fillers/bridges/v2-time-7.wav',
  },
  {
    slug: 'v2-time-8',
    kind: 'continuation',
    text: "While the miles tick by — here's something to tick along with them.",
    bucketKey: 'fillers/bridges/v2-time-8.wav',
  },
  {
    slug: 'v2-pivot-1',
    kind: 'continuation',
    text: "Different subject entirely. Trust me on the turn.",
    bucketKey: 'fillers/bridges/v2-pivot-1.wav',
  },
  {
    slug: 'v2-pivot-2',
    kind: 'continuation',
    text: "Change of subject — and I promise it's a promotion.",
    bucketKey: 'fillers/bridges/v2-pivot-2.wav',
  },
  {
    slug: 'v2-pivot-3',
    kind: 'continuation',
    text: "Now for something the guidebooks walk right past.",
    bucketKey: 'fillers/bridges/v2-pivot-3.wav',
  },
  {
    slug: 'v2-pivot-4',
    kind: 'continuation',
    text: "Let me change lanes, subject-wise.",
    bucketKey: 'fillers/bridges/v2-pivot-4.wav',
  },
  {
    slug: 'v2-pivot-5',
    kind: 'continuation',
    text: "New topic, same county.",
    bucketKey: 'fillers/bridges/v2-pivot-5.wav',
  },
  {
    slug: 'v2-pivot-6',
    kind: 'continuation',
    text: "Here's a left turn worth taking.",
    bucketKey: 'fillers/bridges/v2-pivot-6.wav',
  },
  {
    slug: 'v2-pivot-7',
    kind: 'continuation',
    text: "Pivoting — because this one's too good to leave in the glovebox.",
    bucketKey: 'fillers/bridges/v2-pivot-7.wav',
  },
  {
    slug: 'v2-pivot-8',
    kind: 'continuation',
    text: "Forget the famous stuff for a minute. Try this instead.",
    bucketKey: 'fillers/bridges/v2-pivot-8.wav',
  },
  {
    slug: 'v2-quiet-1',
    kind: 'first',
    text: "Quiet roads deserve their own kind of story. This is one of those.",
    bucketKey: 'fillers/bridges/v2-quiet-1.wav',
  },
  {
    slug: 'v2-quiet-2',
    kind: 'first',
    text: "Since it's just us and the road for a bit —",
    bucketKey: 'fillers/bridges/v2-quiet-2.wav',
  },
  {
    slug: 'v2-quiet-3',
    kind: 'first',
    text: "A stretch like this is made for a story like this.",
    bucketKey: 'fillers/bridges/v2-quiet-3.wav',
  },
  {
    slug: 'v2-quiet-4',
    kind: 'first',
    text: "Nothing needs our attention for a moment. Good. Listen to this.",
    bucketKey: 'fillers/bridges/v2-quiet-4.wav',
  },
  {
    slug: 'v2-quiet-5',
    kind: 'first',
    text: "Here's one for the empty miles.",
    bucketKey: 'fillers/bridges/v2-quiet-5.wav',
  },
  {
    slug: 'v2-quiet-6',
    kind: 'first',
    text: "Slow moment? I know a cure.",
    bucketKey: 'fillers/bridges/v2-quiet-6.wav',
  },
  {
    slug: 'v2-quiet-7',
    kind: 'first',
    text: "Let the quiet have a little company.",
    bucketKey: 'fillers/bridges/v2-quiet-7.wav',
  },
  {
    slug: 'v2-return-1',
    kind: 'continuation',
    text: "And while that one settles — here's another.",
    bucketKey: 'fillers/bridges/v2-return-1.wav',
  },
  {
    slug: 'v2-return-2',
    kind: 'continuation',
    text: "One story leads to another around here. This way.",
    bucketKey: 'fillers/bridges/v2-return-2.wav',
  },
  {
    slug: 'v2-return-3',
    kind: 'continuation',
    text: "Before the road takes us somewhere new — a word about everywhere.",
    bucketKey: 'fillers/bridges/v2-return-3.wav',
  },
  {
    slug: 'v2-return-4',
    kind: 'continuation',
    text: "That was one place. This one's the whole picture.",
    bucketKey: 'fillers/bridges/v2-return-4.wav',
  },
  {
    slug: 'v2-return-5',
    kind: 'continuation',
    text: "Staying with you — and widening out for a minute.",
    bucketKey: 'fillers/bridges/v2-return-5.wav',
  },
  {
    slug: 'v2-return-6',
    kind: 'continuation',
    text: "Good. Now let me show you the frame around that picture.",
    bucketKey: 'fillers/bridges/v2-return-6.wav',
  },
  {
    slug: 'v2-return-7',
    kind: 'continuation',
    text: "There's more where that came from — broader, this time.",
    bucketKey: 'fillers/bridges/v2-return-7.wav',
  },
  {
    slug: 'v2-sky-1',
    kind: 'continuation',
    text: "Rain or shine, gray or gold — this one's true either way.",
    bucketKey: 'fillers/bridges/v2-sky-1.wav',
  },
  {
    slug: 'v2-sky-2',
    kind: 'continuation',
    text: "Morning, noon, or midnight — this story holds.",
    bucketKey: 'fillers/bridges/v2-sky-2.wav',
  },
  {
    slug: 'v2-sky-3',
    kind: 'continuation',
    text: "Some things about this county don't change with the light. This is one of them.",
    bucketKey: 'fillers/bridges/v2-sky-3.wav',
  },
  {
    slug: 'v2-sky-4',
    kind: 'continuation',
    text: "The sky does its thing. The county does this. Listen.",
    bucketKey: 'fillers/bridges/v2-sky-4.wav',
  },
  {
    slug: 'v2-sky-5',
    kind: 'continuation',
    text: "Any hour will do for this one. It's always true here.",
    bucketKey: 'fillers/bridges/v2-sky-5.wav',
  },
  {
    slug: 'v2-sky-6',
    kind: 'continuation',
    text: "Daylight version, headlights version — same story either way.",
    bucketKey: 'fillers/bridges/v2-sky-6.wav',
  },
];

// Erik's trigger (silence-fillers-v1.md, revised 20:28): 10 seconds
// of true silence starts a pair; a filler that ends into an empty
// queue earns the next pair after another 10 seconds.
const SILENCE_TRIGGER_MS = 10_000;
const WATCH_INTERVAL_MS = 1_000;

class FillerLaneService {
  private host: FillerHost | null = null;

  // Pool state: rows are loaded once per app session (the shelf
  // does not change under a tour); the PLAY ORDER is shuffled per
  // tour so consecutive tours do not open their outages with the
  // same first filler.
  private poolRows: FillerClip[] | null = null;
  private poolLoadPromise: Promise<FillerClip[] | null> | null = null;
  private poolUnavailableFiled = false;
  private playOrder: FillerClip[] = [];

  // Per-tour state.
  private playedIds = new Set<string>();
  private chainCount = 0; // links fired in the current silence episode
  private stoodDown = false; // pool exhausted this tour
  private active: {
    clip: FillerClip;
    bridgeSlug: string | null;
    silenceS: number;
    recovered: boolean;
    // The region resolved at fire time and how this clip matched
    // it — carried into the filler_played event, the pick's record.
    region: FillerRegion | null;
    matched: FillerMatch;
  } | null = null;

  // Watcher state.
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private silenceSince: number | null = null;
  private firing = false;
  private lastBridgeSlug: string | null = null;

  setHost(host: FillerHost): void {
    this.host = host;
  }

  // Tour start: reset the per-tour rotation, start the watcher, and
  // PIN THE POOL — the downloads ARE the tour-start job, fired
  // without blocking the opening (the opening itself runs ~30 s+,
  // and a first outage cannot complete its 10 s of true silence
  // before the pins land in any healthy tour). After the first tour
  // ever, every clip is already in the on-device cache and pinning
  // is a round of local reads.
  beginTour(): void {
    this.resetTourState();
    void this.loadPool().then(pool => {
      if (pool) void this.pinAll(pool);
    });
    if (this.watchTimer === null) {
      this.watchTimer = setInterval(this.tick, WATCH_INTERVAL_MS);
    }
  }

  // Tour end: the watcher stops and the rotation resets. A filler
  // mid-play settles through the player's own teardown (its settle
  // fires undelivered, the clip un-spends) — endTour does not need
  // to settle anything itself.
  endTour(): void {
    if (this.watchTimer !== null) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
    this.resetTourState();
  }

  private resetTourState(): void {
    this.playedIds.clear();
    this.chainCount = 0;
    this.stoodDown = false;
    this.active = null;
    this.silenceSince = null;
    this.firing = false;
    // Fresh play order for the tour (rows may already be loaded).
    if (this.poolRows) this.playOrder = shuffled(this.poolRows);
  }

  // The app queues a real story (a serve landing, or the catch-up
  // batch on reconnect): the current episode is over — if a filler
  // is on air it records the recovery for its filler_played event,
  // and the next outage, whenever it comes, opens with a first
  // bridge again rather than continuing a sequence that ended.
  noteStoryQueued(): void {
    if (this.active) this.active.recovered = true;
    this.chainCount = 0;
  }

  // ------------------------------------------------------------ pool

  private loadPool(): Promise<FillerClip[] | null> {
    if (this.poolRows) return Promise.resolve(this.poolRows);
    if (this.poolLoadPromise) return this.poolLoadPromise;
    this.poolLoadPromise = (async () => {
      const rows = await storyLibrary.loadFillerRows();
      if (!rows) {
        if (!this.poolUnavailableFiled) {
          this.poolUnavailableFiled = true;
          trackDiag('pipeline', 'filler-pool-unavailable', 'filler rows could not be loaded — the silence lane is inert this session');
        }
        this.poolLoadPromise = null; // a later tour may retry
        return null;
      }
      this.poolRows = rows.map(r => ({
        id: r.audioPath,
        title: r.placeName,
        text: r.text,
        audioPath: r.audioPath,
      }));
      this.playOrder = shuffled(this.poolRows);
      return this.poolRows;
    })();
    return this.poolLoadPromise;
  }

  // Download one clip's audio into the on-device TTS cache under
  // its exact text, unless it is already there. True when the clip
  // is playable offline by the end of the call.
  private async ensurePinned(text: string, audioPath: string): Promise<boolean> {
    try {
      if (await geminiAudio.hasPinnedAudio(text)) return true;
      if (!SUPABASE_CONFIGURED) return false;
      const { data, error } = await supabase.storage.from('tts-audio').download(audioPath);
      if (error || !data) return false;
      const blob = data as Blob;
      if (blob.size === 0 || !blob.type.startsWith('audio')) return false;
      await geminiAudio.pinAudio(text, blob);
      return true;
    } catch {
      return false;
    }
  }

  private async pinAll(pool: FillerClip[]): Promise<void> {
    const jobs: Array<{ text: string; audioPath: string; label: string }> = [
      ...pool.map(c => ({ text: c.text, audioPath: c.audioPath, label: c.title })),
      ...BRIDGES.map(b => ({ text: b.text, audioPath: b.bucketKey, label: b.slug })),
    ];
    // Small parallel batches: 25 clips land quickly without
    // stampeding the connection the pipeline is also using.
    for (let i = 0; i < jobs.length; i += 4) {
      await Promise.all(
        jobs.slice(i, i + 4).map(async j => {
          const ok = await this.ensurePinned(j.text, j.audioPath);
          if (!ok) {
            trackDiag('pipeline', 'filler-pin-failed', `could not pin "${j.label}" on-device — it will be retried at fire time`);
          }
        })
      );
    }
  }

  // First pinnable bridge of the wanted kind, in RANDOMIZED
  // candidate order, avoiding an immediate repeat of the last
  // bridge used. Null when no bridge of the kind can be made
  // playable — the pair then does not fire at all (the filler
  // never starts cold). The randomization (Erik-approved
  // Oct 30, 2026) is what makes the 51-clip bank real: in
  // manifest order the picker ping-ponged the first two clips
  // of each kind forever. B's picker randomizes the same way.
  // The last-used demotion is unchanged — the previous bridge
  // still sorts to the end of the shuffled order.
  private async pickBridge(kind: 'first' | 'continuation'): Promise<BridgeClip | null> {
    const ofKind = BRIDGES.filter(b => b.kind === kind);
    const shuffled = [...ofKind];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const ordered = [
      ...shuffled.filter(b => b.slug !== this.lastBridgeSlug),
      ...shuffled.filter(b => b.slug === this.lastBridgeSlug),
    ];
    for (const bridge of ordered) {
      if (await this.ensurePinned(bridge.text, bridge.bucketKey)) return bridge;
    }
    return null;
  }

  // ------------------------------------------------------------ watch

  private tick = (): void => {
    const host = this.host;
    if (!host) return;
    const snap = host.snapshot();
    if (!snap.tourActive) {
      this.silenceSince = null;
      return;
    }
    // Our own pair is in the player or the queue — that is sound,
    // not silence, and its settle (not this watcher) owns what
    // happens next.
    if (this.active) return;
    const blocked =
      !snap.openingSettled ||
      snap.playing ||
      snap.queueLength > 0 ||
      snap.questionLocked ||
      snap.userPaused;
    if (blocked) {
      this.silenceSince = null;
      return;
    }
    const now = Date.now();
    if (this.silenceSince === null) {
      this.silenceSince = now;
      return;
    }
    if (now - this.silenceSince >= SILENCE_TRIGGER_MS) {
      void this.tryFire((now - this.silenceSince) / 1000);
    }
  };

  private async tryFire(silenceS: number): Promise<void> {
    if (this.firing) return;
    this.firing = true;
    try {
      const pool = await this.loadPool();
      if (!pool) return; // no shelf — the lane is inert (diag filed at load)
      // Region-first pick: resolve where the driver is NOW (the
      // snapshot is synchronous; GPS works offline and the map is
      // in the bundle, so the choice never leaves the phone). A
      // null region — outside the county, or no fix yet — leaves
      // the shuffled play order untouched: the pre-region pick.
      const position = this.host ? this.host.snapshot().position : null;
      const region = position ? resolveFillerRegion(position.lat, position.lng) : null;
      const ordered =
        region === null
          ? this.playOrder
          : orderFillersForRegion(this.playOrder, region, c => fillerTagsForTitle(c.title));
      const next = ordered.find(c => !this.playedIds.has(c.id));
      if (!next) {
        if (!this.stoodDown) {
          this.stoodDown = true;
          trackDiag(
            'pipeline',
            'filler-pool-exhausted',
            `all ${pool.length} silence fillers played this tour — the lane stands down to honest silence`
          );
        }
        return;
      }
      if (!(await this.ensurePinned(next.text, next.audioPath))) {
        // The clip is unreachable AND not on-device (a first tour
        // that went offline before its pins landed). silenceSince
        // stays armed: the next tick retries, and the pair fires
        // whole the moment the clip is pinnable.
        return;
      }
      const bridge = await this.pickBridge(this.chainCount === 0 ? 'first' : 'continuation');
      if (!bridge) return; // no doorway, no telling — retry next tick

      const host = this.host;
      if (!host) return;
      // The awaits above spanned real time: re-check the world
      // before spending the pair, so a story that arrived during
      // pinning is never jumped by a filler decided in its absence.
      const snap = host.snapshot();
      if (
        !snap.tourActive ||
        !snap.openingSettled ||
        snap.playing ||
        snap.queueLength > 0 ||
        snap.questionLocked ||
        snap.userPaused ||
        this.active
      ) {
        return;
      }

      this.playedIds.add(next.id);
      this.chainCount += 1;
      this.lastBridgeSlug = bridge.slug;
      this.active = {
        clip: next,
        bridgeSlug: bridge.slug,
        silenceS: Math.round(silenceS * 10) / 10,
        recovered: false,
        region,
        matched: fillerMatchFor(fillerTagsForTitle(next.title), region),
      };
      const ok = host.play(
        { text: bridge.text },
        { text: next.text, title: next.title },
        info => this.onFillerSettle(info)
      );
      if (!ok) {
        // The player refused (a mute landed in the race window):
        // un-spend everything and re-arm the silence clock.
        this.playedIds.delete(next.id);
        this.chainCount = Math.max(0, this.chainCount - 1);
        this.active = null;
        this.silenceSince = Date.now();
      }
    } finally {
      this.firing = false;
    }
  }

  private onFillerSettle(info: FillerSettleInfo): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    if (!info.sounded) {
      // Never reached the ear (blocked past its attempts, torn
      // down, skipped before sounding): the telling did not
      // happen — un-spend the clip, the hearing doctrine the rest
      // of the app runs on. A clip that SOUNDED stays spent even
      // if it was cut short: the listener heard it, and a repeat
      // this tour would be a repeat.
      this.playedIds.delete(active.clip.id);
      this.chainCount = Math.max(0, this.chainCount - 1);
    }
    try {
      analytics.track('filler_played', null, undefined, {
        filler: active.clip.title,
        // Explicit title key (Oct 29, 2026): region + matched have
        // ridden this event since the region picker's build, but
        // the clip's name only ever travelled as 'filler' — a
        // field diagnosis reading for region/matched/title found
        // none of the three. All three now ride under their own
        // names at the call site.
        title: active.clip.title,
        filler_id: active.clip.id,
        bridge: active.bridgeSlug,
        region: active.region,
        matched: active.matched,
        silence_s: active.silenceS,
        recovered_during: active.recovered,
        sounded: info.sounded,
        completed: info.completed,
        sounded_ms: info.soundedMs,
      });
    } catch { /* a metric must never break the lane */ }
    // The next link of a chain earns its own 10 s: the clock
    // restarts from this settle, per Erik's re-arm rule.
    this.silenceSince = null;
  }
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const fillerLane = new FillerLaneService();
