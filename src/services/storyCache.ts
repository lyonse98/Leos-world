import { Position } from '../hooks/useGeolocation';
import { calculateDistance, offsetPositionByHeading, MovementModeHysteresis, storyReachM, estimateSpeechDurationS } from '../utils/geo';
import { geminiService, StoryRotation } from './gemini';
import { storyCoverage, landmarkSubjectKey, angleFromTopic } from './storyCoverage';
import { storyLibrary } from './storyLibrary';
import { heardStories } from './heardStories';
import { latencyModel } from './latencyModel';
import { analytics } from './analytics';
import { locationTracker } from './locationTracker';
import { audioHealth } from './audioHealth';

export interface CachedStory {
  id: string;
  // Per-story correlation id (Area G, Oct 26, 2026): minted at the
  // generation / prefetch / library-serve DECISION, carried through
  // story_played → story_playback → story_dropped → story_timing so a
  // tell can be joined back to the decision that produced it.
  storyId: string;
  // The projected discovery center this story was fetched for, and the
  // horizon used — the prediction whose error is measured at play
  // time (Area G). Absent for stories with no projection (missed-queue
  // replays, stationary fetches).
  projectedCenter?: { lat: number; lng: number };
  horizonS?: number;
  text: string;
  topic: string;
  lat: number;
  lng: number;
  generatedAt: number;
  played: boolean;
  // Which movement mode the story was written for. Drives both the playback
  // freshness gate and how far the story may be from the listener.
  mode: MovementModeHysteresis;
  // Region-anchored stories (rural/highway) describe an area, not a point,
  // so the "you've driven past it" check does not apply.
  regionAnchored: boolean;
  // The landmark or subject the story is about. Empty for region-level
  // stories that have no single subject. This is what a rating attaches to.
  subject: string;
  // Set when this story took a rotation angle — a return visit to a landmark,
  // or a story about the area itself. Carried so the app can record the
  // coverage at the moment the story actually plays.
  rotation: StoryRotation | null;
  // Curated-library serves: the entry's pre-made audio travels with the
  // story so playback never synthesizes, and the entry's own coordinates
  // (already in lat/lng above) are the queue anchor the gates measure
  // against — where the place IS, not where it was fetched.
  audioUrl?: string;
  fromLibrary?: boolean;
  // Tour thread (Oct 28, 2026): the telling's signature fact,
  // captured by gemini at live generation and carried so the App
  // hearing funnel can record it in the tour telling ledger. Present
  // only on entries whose text was generated live (this session's
  // serves and prefetches); library and shared-cache entries leave
  // it null — their stored data carries no designated lead.
  signatureFact?: string | null;
}

interface QueueEntry {
  position: Position;
  timestamp: number;
}

interface PrefetchTarget {
  lat: number;
  lng: number;
  at: number;
}

const MAX_BUFFER_WALKING = 20;
const MAX_BUFFER_DRIVING = 60;
const QUEUE_MAX_AGE_MS = 10 * 60 * 1000;
const TARGET_TTL_MS = 10 * 60 * 1000;
const TARGET_DEDUPE_M = 400;
const MIN_FETCH_INTERVAL_DRIVING_MS = 4000;
const MIN_FETCH_INTERVAL_WALKING_MS = 5000;
const MIN_FETCH_INTERVAL_STATIONARY_MS = 4000;

// How far a cached story may be from the listener and still play when offline.
// Point-anchored stories (a specific landmark) go stale fast — once you're past
// the block, the story is about somewhere you've left. Region-anchored stories
// (rural/highway prefetches) describe a broad area, so the gate is looser.
const OFFLINE_POINT_MAX_M = 500;
const OFFLINE_REGION_MAX_M = 3000;

// A prefetched story that has been sitting unplayed this long is probably about
// somewhere the listener never reached (they turned, or drove past without the
// queue emptying). Drop it rather than risk a stale narration.
const STALE_PREFETCH_MS = 8 * 60 * 1000;

// How far down the road to stock stories while service is still good.
// Road trips have long dead stretches — the buffer is what covers them.
// Freeway speeds get even farther offsets so the queue stays full at 65+ mph.
const ROUTE_OFFSETS_DRIVING_M = [800, 2500, 5000, 8000];
const ROUTE_OFFSETS_FREWAY_M = [1200, 3500, 7000, 12000];
// Walking/idle: stock stories in a tight radius so the queue fills quickly
// even when the listener isn't moving much.
const ROUTE_OFFSETS_WALKING_M = [150, 300, 500];

class StoryCacheService {
  private static mintStoryId(): string {
    return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }

  private cache: CachedStory[] = [];
  private missedQueue: QueueEntry[] = [];
  // The first serve of a session is RESERVED for the welcome sequence:
  // the canned intro line, then the contextual welcome story, then
  // landmarks. While the opener is pending, no locally cached story may
  // take the slot — the local cache used to be checked first and its
  // opener serve preferred a subject-ful (landmark) story, so a buffer
  // warmed on the landing screen silently replaced the welcome story
  // and the tour opened mid-landmark-hunt. Cleared only by a live serve
  // that actually returns the first story.
  private openerPending = true;
  // The intro context of the reserved opener serve, snapshotted the
  // first time an opener serve's decision comes back as an intro
  // (Pass 1, Oct 27, 2026). The tracker consumes its first-story
  // decision inside getTourNarration BEFORE generation, so when the
  // reserved serve's generation fails, a naive retry sees a consumed
  // decision and deals a landmark as the tour's first story. The
  // snapshot is handed back on the retry (introContextReplay) so the
  // serve replays the intro it was reserved to be. Cleared when an
  // opener serve actually returns a story, and on arm/reset.
  private openerIntroContext: string | null = null;
  private prefetchTargets: PrefetchTarget[] = [];
  // The intro-debt epoch whose cache bypass has been spent (fix
  // stack — see tryGetStoryForPosition). 0 = no bypass spent; real
  // epochs are Date.now() timestamps from the tracker.
  private lastIntroBypassEpoch = 0;
  private isPrefetching = false;
  private isPrefetchingAhead = false;
  private isOnline = true;
  private lastFetchPosition: Position | null = null;
  private lastFetchTime = 0;
  private minFetchIntervalMs = 10000;
  private onNetworkStatusChange?: (online: boolean) => void;
  private onCacheChange?: (cache: CachedStory[]) => void;
  private onMissedQueueChange?: (count: number) => void;
  // The discovery geometry of the most recent live fetch (Area D):
  // which horizon was used and how far ahead of the fetch position the
  // discovery center sat. Read by the app for story_timing's geometry
  // fields (Area G) — the tuning record for the adaptive horizon.
  private lastDiscoveryMeta: { horizonS: number; centerOffsetM: number; projectedCenter: { lat: number; lng: number } } | null = null;

  getLastDiscoveryMeta(): { horizonS: number; centerOffsetM: number; projectedCenter: { lat: number; lng: number } } | null {
    return this.lastDiscoveryMeta;
  }

  // Outcome flags of the most recent tryGetStoryForPosition call
  // (fix stack RC-4/item 9): decisionConsumed — the tracker's
  // movement decision was spent by the serve (a failed serve with
  // this set earns the app a decision refund); designedSilence — an
  // empty result that is the highway doctrine working as designed,
  // not a failure. Reset at the start of every serve call.
  // generationAttempted / emptyReason ride along (pre-publish stack
  // Item 2): the app's starved-cycle diagnostic reads them to tell
  // an attempted-but-empty cycle (Gemini was the holdup) from one
  // that ended having attempted nothing while the queue sat empty.
  private lastServeInfo: {
    decisionConsumed: boolean;
    designedSilence: boolean;
    generationAttempted: boolean;
    emptyReason: string | null;
  } | null = null;

  getLastServeInfo(): {
    decisionConsumed: boolean;
    designedSilence: boolean;
    generationAttempted: boolean;
    emptyReason: string | null;
  } | null {
    return this.lastServeInfo;
  }

  setNetworkStatusCallback(cb: (online: boolean) => void) {
    this.onNetworkStatusChange = cb;
  }

  setCacheChangeCallback(cb: (cache: CachedStory[]) => void) {
    this.onCacheChange = cb;
  }

  setMissedQueueChangeCallback(cb: (count: number) => void) {
    this.onMissedQueueChange = cb;
  }

  // The serve window for one cached story (fix stack RC-6): how far
  // from its anchor the story may be served — the distance the
  // listener covers DURING its telling, from the same duration×speed
  // reach the player applies (utils/geo). The old flat 100m window
  // contradicted the prefetch anchors (800–12,000m ahead): stories
  // were generated for spots the serve window then refused until the
  // listener was nearly on top of them, often after freshness had
  // expired. One geometry now governs fetch, serve, and prune.
  private serveWindowM(position: Position, story: CachedStory): number {
    const speed = position.speed ?? 0;
    const mode: MovementModeHysteresis =
      speed >= 5.5 ? 'driving' : speed > 0.5 ? 'walking' : 'stationary';
    return storyReachM(mode, speed, estimateSpeechDurationS(story.text));
  }

  // True when a story is already sitting in the buffer near this position and
  // can play with no wait. Used to decide whether a latency bridge is needed.
  hasReadyStory(position: Position): boolean {
    return this.cache.some(
      s => !s.played && this.distance(position, { lat: s.lat, lng: s.lng }) <= this.serveWindowM(position, s)
    );
  }

  getCache(): CachedStory[] {
    return [...this.cache];
  }

  getCacheCount(): number {
    return this.cache.filter(s => !s.played).length;
  }

  getMissedQueueCount(): number {
    return this.missedQueue.length;
  }

  isOnlineStatus(): boolean {
    return this.isOnline;
  }

  private maxBuffer(mode: MovementModeHysteresis): number {
    return mode === 'walking' ? MAX_BUFFER_WALKING : MAX_BUFFER_DRIVING;
  }

  private unplayedCount(): number {
    return this.cache.filter(s => !s.played).length;
  }

  private distance(p1: { lat: number; lng: number }, p2: { lat: number; lng: number }): number {
    return calculateDistance(p1.lat, p1.lng, p2.lat, p2.lng);
  }

  private notifyCacheChange() {
    this.onCacheChange?.([...this.cache]);
  }

  private notifyMissedQueueChange() {
    this.onMissedQueueChange?.(this.missedQueue.length);
  }

  setOnline(online: boolean) {
    const wasOffline = !this.isOnline;
    this.isOnline = online;
    this.onNetworkStatusChange?.(online);

    if (online && wasOffline) {
      this.processMissedQueue();
    }
  }

  private addToCache(entry: Omit<CachedStory, 'id' | 'storyId'> & { storyId?: string }) {
    // A story about something already waiting to be heard is not a new story.
    // Route-ahead prefetching asks for several stories before any of them has
    // played, and coverage is only marked when a story actually reaches the
    // listener — so without this the same area story would be queued over and
    // over down the same stretch of road.
    if (this.cache.some(s => !s.played && s.topic === entry.topic)) {
      return;
    }

    this.cache.push({
      ...entry,
      id: `${Date.now()}_${Math.random()}`,
      storyId: entry.storyId ?? StoryCacheService.mintStoryId(),
    });
    const cap = MAX_BUFFER_DRIVING * 2;
    if (this.cache.length > cap) {
      this.cache = this.cache.slice(-cap);
    }
    this.refreshPendingSubjects();
    this.notifyCacheChange();
  }

  // Drop prefetched stories that have aged out — they were generated for a
  // spot the listener was approaching, and if they haven't played by now the
  // listener likely took a different route or drove past. Serving one would
  // narrate a place the listener is no longer near.
  private pruneStalePrefetches(position: Position): void {
    const now = Date.now();
    const before = this.cache.length;
    this.cache = this.cache.filter(s => {
      if (s.played) return true;
      const age = now - s.generatedAt;
      if (age < STALE_PREFETCH_MS) return true;
      // A story still inside its serve window stays, even if old —
      // it's relevant to where they are right now.
      const d = this.distance(position, { lat: s.lat, lng: s.lng });
      if (d <= this.serveWindowM(position, s)) return true;
      return false;
    });
    if (this.cache.length !== before) {
      this.refreshPendingSubjects();
      this.notifyCacheChange();
    }
  }

  async tryGetStoryForPosition(
    position: Position,
    mode: MovementModeHysteresis,
    onChunk?: (text: string) => void,
    // Never-starve ladder (pre-publish stack Item 2): the app passes
    // queueStarved when the player is idle with an empty queue; it
    // threads into the gemini serve, where it arms the forced refill.
    opts?: { queueStarved?: boolean }
  ): Promise<{ story: string; fromCache: boolean; topic: string; subject: string; context: string; rotation: StoryRotation | null; fromLibrary: boolean; audioUrl?: string; anchorLat?: number; anchorLng?: number; corridorSegmentId?: string; major?: boolean; storyId: string; projectedCenter?: { lat: number; lng: number }; horizonS?: number; generatedAt: number; signatureFact?: string | null } | null> {
    this.lastServeInfo = { decisionConsumed: false, designedSilence: false, generationAttempted: false, emptyReason: null };
    this.pruneStalePrefetches(position);
    const openerServe = this.openerPending;
    // While the opener is pending the local cache is not consulted at
    // all — the first story must be generated live as the welcome (see
    // the openerPending note). After the opener, serves are unchanged.
    // Pass 1: the same bypass applies while a mid-tour neighborhood
    // welcome is owed (a chapter break) — a buffered story must not
    // take the serve on which the welcome is due, or the new
    // neighborhood gets entered without ever being introduced.
    // Fix stack (Oct 27, 2026): the bypass is scoped to the FIRST
    // serve attempt of each debt (keyed by the tracker's debt epoch).
    // Pass 1 bypassed on EVERY serve while a welcome was owed; with a
    // debt that could not clear (D1), one stuck welcome disabled the
    // local cache for whole tours. One bypass per debt keeps the
    // welcome's serve fresh without mortgaging the buffer.
    const introEpoch = locationTracker.getPendingIntroEpoch();
    const introOwed =
      !openerServe &&
      locationTracker.hasPendingNeighborhoodIntro() &&
      this.lastIntroBypassEpoch !== introEpoch;
    if (introOwed) this.lastIntroBypassEpoch = introEpoch;
    const cached = openerServe || introOwed ? null : this.findNearestUnplayedCache(position);
    if (cached) {
      const servedKey = cached.rotation?.subjectKey ?? landmarkSubjectKey(cached.topic.split(' — ')[0].trim());
      // Tenant guard (Area C, Oct 26, 2026): a buffered story about a
      // tenant of an untold curated major does not serve from the
      // buffer either — the serve falls through to the live path,
      // whose tenant redirect tells the whole place first. A cached
      // subject that is itself a major is never deferred.
      const tenantAnchor = storyLibrary.containingMajorAnchor(
        cached.lat, cached.lng, cached.topic.split(' — ')[0].trim()
      );
      const tenantAnchorKey = tenantAnchor ? landmarkSubjectKey(tenantAnchor.name) : null;
      const tenantDeferred =
        tenantAnchor !== null &&
        tenantAnchorKey !== null &&
        !storyCoverage.isMajorSubject(servedKey) &&
        !storyCoverage.isSubjectLockedForSession(tenantAnchorKey) &&
        !heardStories.hasHeardSubject(tenantAnchor.name) &&
        // Told-subject ledger (Oct 28, 2026): if the whole place
        // already has a telling committed this tour — queued in the
        // player or delivered — the deferral's purpose is served:
        // the tenant's story queues behind it like any next story
        // instead of the serve falling through to a live path whose
        // redirect would only re-deal the anchor (the NASSCO
        // pattern: three anchor serves for one tenant approach).
        !storyCoverage.hasUnsettledTelling(tenantAnchorKey) &&
        storyCoverage.deliveredTellingCount(tenantAnchorKey) === 0;
      if (tenantDeferred) {
        console.log(`[StoryCache] Tenant serve deferred — "${cached.topic}" waits for whole place "${tenantAnchor!.name}"`);
      } else {
      cached.played = true;
      this.notifyCacheChange();
      this.refreshPendingSubjects();
      // A local serve marks its subject IN-FLIGHT (fix stack RC-2):
      // coverage — session lock, daily tally, heard record, angle
      // coverage — is recorded when the story is HEARD, at the
      // player's delivered settle, through the app's hearing funnel.
      // The in-flight mark is what keeps this layer honest meanwhile:
      // a second buffered angle of the same place cannot serve while
      // the first awaits its settle (isLockedOutWhileMoving checks
      // in-flight), which preserves the old serve-time lock's
      // pile-up protection without burning coverage on stories that
      // go on to die unheard in the player. Moving only, as the old
      // marks were — parked serves keep the dwell rotation freedom.
      // Library serves no longer mark the place major (D4): major
      // status comes from the place rules, not the serve flavor.
      const speed = position.speed ?? null;
      const moving = !(speed !== null && speed < 1.0);
      if (moving) {
        if (servedKey.startsWith('landmark:')) {
          storyCoverage.markSubjectInFlight(servedKey);
        }
      }
      if (onChunk) onChunk(cached.text);
      return {
        story: cached.text,
        fromCache: true,
        topic: cached.topic,
        subject: cached.subject,
        context: 'cache',
        rotation: cached.rotation,
        fromLibrary: !!cached.fromLibrary,
        audioUrl: cached.audioUrl,
        anchorLat: cached.fromLibrary ? cached.lat : undefined,
        anchorLng: cached.fromLibrary ? cached.lng : undefined,
        // A banked major claims the priority lane at serve (Area C):
        // prefetch-chosen library items reach the queue through this
        // branch, so this is where their right-of-way is decided.
        major: cached.fromLibrary ? storyCoverage.isMajorSubject(servedKey) : false,
        // Tour thread: a buffered live generation carries its
        // captured lead to the funnel; a library entry carries none.
        signatureFact: cached.signatureFact ?? null,
        storyId: cached.storyId,
        projectedCenter: cached.projectedCenter,
        horizonS: cached.horizonS,
        // The story's true generation time (fix stack RC-3): the
        // player's freshness age measures from HERE, not from the
        // moment the serve happened to dequeue it.
        generatedAt: cached.generatedAt,
      };
      }
    }

    if (!this.isOnline) {
      this.missedQueue.push({ position, timestamp: Date.now() });
      this.pruneMissedQueue();
      this.notifyMissedQueueChange();
      return null;
    }

    try {
      console.log('[StoryCache] Calling getTourNarration for', position.lat.toFixed(5), position.lng.toFixed(5));
      // Adaptive discovery geometry (Area D, Oct 26, 2026): while
      // driving, the fact pack is gathered around where the listener
      // will BE when this story speaks — current story remaining +
      // measured fetch/synth latency — not around the spot underfoot.
      // The serve itself (tracker, anchors, area) still keys off the
      // real position; only discovery projects.
      const horizonS = latencyModel.horizonS(null);
      const discoveryPosition = mode === 'driving' ? this.anticipatedCenter(position, horizonS) : position;
      this.lastDiscoveryMeta = {
        horizonS: Math.round(horizonS),
        centerOffsetM: Math.round(this.distance(position, discoveryPosition)),
        projectedCenter: { lat: discoveryPosition.lat, lng: discoveryPosition.lng },
      };
      const result = await geminiService.getTourNarration(position, undefined, onChunk, {
        requireWelcomeStory: openerServe,
        discoveryPosition,
        introContextReplay: openerServe ? this.openerIntroContext : null,
        queueStarved: opts?.queueStarved === true,
      });
      // Serve-outcome flags for the app's fetch cycle (fix stack
      // RC-4/item 9): whether the tracker's movement decision was
      // consumed by this serve, and whether an empty result is
      // DESIGNED silence (highway doctrine) rather than a failure.
      // Item 2 adds the attempt record the starved-cycle diagnostic
      // reads.
      this.lastServeInfo = {
        decisionConsumed: result.decisionConsumed === true,
        designedSilence: result.designedSilence === true,
        generationAttempted: result.generationAttempted === true,
        emptyReason: result.emptyReason ?? null,
      };
      console.log('[StoryCache] getTourNarration returned:', { textLen: result.text?.length || 0, subject: result.subject, mode: result.mode });
      // Snapshot the reserved serve's intro decision (Pass 1) — taken
      // even when the text came back empty, because an empty text is
      // exactly the failure the snapshot exists to repair on retry.
      if (
        openerServe &&
        !this.openerIntroContext &&
        (result.context === 'initial' || result.context === 'neighborhood_intro' || result.context === 'welcome_back')
      ) {
        this.openerIntroContext = result.context;
      }
      const story = result.text;
      if (story && story.trim().length > 0) {
        this.openerPending = false;
        this.openerIntroContext = null;
        if (openerServe) {
          // First-serve audit: was the tour's first story the welcome,
          // an area story, or a landmark? Aggregate-only (the daily
          // rollup counts it by its generic trigger) — this is the
          // counter that makes the opener sequence provable in the
          // field instead of arguable.
          const source =
            result.context === 'initial' || result.context === 'neighborhood_intro' || result.context === 'welcome_back'
              ? 'welcome'
              : result.subject && result.subject.trim().length > 0
                ? 'landmark'
                : 'area';
          try {
            analytics.track('first_serve', position, mode, { source });
          } catch { /* a metric must never break a serve */ }
        }
        const topic = result.subject || `Story at ${position.lat.toFixed(4)}, ${position.lng.toFixed(4)}`;
        // The correlation id is minted HERE, at the serve decision
        // (Area G), and the discovery geometry that produced this
        // story rides with it — App and the player join on both.
        const storyId = StoryCacheService.mintStoryId();
        const projectedCenter = this.lastDiscoveryMeta?.projectedCenter;
        const horizonS = this.lastDiscoveryMeta?.horizonS;
        const generatedAt = Date.now();
        this.addToCache({
          text: story,
          topic,
          subject: result.subject,
          rotation: result.rotation,
          lat: result.anchorLat ?? position.lat,
          lng: result.anchorLng ?? position.lng,
          generatedAt,
          played: true,
          mode,
          regionAnchored: mode === 'driving',
          audioUrl: result.audioUrl,
          fromLibrary: result.fromLibrary,
          signatureFact: result.signatureFact ?? null,
          storyId,
          projectedCenter,
          horizonS,
        });
        return { story, fromCache: false, topic, subject: result.subject, context: result.context, rotation: result.rotation, fromLibrary: !!result.fromLibrary, audioUrl: result.audioUrl, anchorLat: result.anchorLat, anchorLng: result.anchorLng, corridorSegmentId: result.corridorSegmentId, major: result.major ?? false, storyId, projectedCenter, horizonS, generatedAt, signatureFact: result.signatureFact ?? null };
      }
    } catch (error) {
      console.error('[StoryCache] Live fetch failed:', error);
      this.missedQueue.push({ position, timestamp: Date.now() });
      this.notifyMissedQueueChange();
    }

    return null;
  }

  // Predictive radial: where the radial prefetch should be centered — the
  // position the listener is ANTICIPATED to reach when the story being
  // fetched would actually speak, projected along their heading by the
  // adaptive horizon (Area D, Oct 26, 2026): the current story's
  // remaining time plus the rolling median of measured fetch+synth
  // latency, replacing the fixed ~90s this used to hard-code. On the
  // Oct 26 drive the fixed horizon aimed discovery at where the
  // listener WAS applying for the job; with 40–60s of cell latency the
  // story landed beside or behind them. At low speed the projection
  // shrinks toward zero and the center converges on the current
  // position, so no mode switching is needed. The distance is capped
  // so a stale or glitchy heading can't throw the center across town.
  private anticipatedCenter(position: Position, horizonS: number): Position {
    const MAX_PROJECTION_M = 4000;
    const speed = position.speed ?? 0;
    const heading = position.heading;
    if (heading === null || isNaN(heading) || speed < 1.5) return position;
    const distance = Math.min(speed * horizonS, MAX_PROJECTION_M);
    if (distance < 50) return position;
    const projected = offsetPositionByHeading(position, heading, distance);
    return { ...position, lat: projected.lat, lng: projected.lng };
  }

  async prefetchForPosition(position: Position, mode: MovementModeHysteresis, horizonS?: number): Promise<void> {
    if (!this.isOnline || this.isPrefetching) return;
    // Storm pause (fix stack RC-6): while the Gemini playback engine
    // is tripped, prefetching spends generation and synthesis on
    // audio that engine currently cannot play — pause until it
    // recovers; banked material already in the buffer still serves.
    if (audioHealth.preferBanked()) return;
    // Trigger at 60% capacity so the buffer starts refilling well before it's
    // empty — this is what keeps at least one story queued during fast driving.
    const triggerThreshold = Math.floor(this.maxBuffer(mode) * 0.6);
    if (this.unplayedCount() >= triggerThreshold) return;
    const minInterval = mode === 'driving' ? MIN_FETCH_INTERVAL_DRIVING_MS
      : mode === 'walking' ? MIN_FETCH_INTERVAL_WALKING_MS
      : MIN_FETCH_INTERVAL_STATIONARY_MS;
    if (Date.now() - this.lastFetchTime < minInterval) return;
    if (this.lastFetchPosition && this.distance(position, this.lastFetchPosition) < 50) return;

    this.isPrefetching = true;
    this.lastFetchPosition = position;
    this.lastFetchTime = Date.now();

    // Generate around the anticipated position, and anchor the cached
    // story there — serve-time distance and freshness checks then measure
    // against where the listener will be, not where they were.
    // Re-anchored to story END (fix stack RC-6): the horizon also
    // carries a typical story's own duration (the latency model's
    // measured median), so the anchor centers where the listener
    // will be when the prefetched story FINISHES — the moment its
    // geometry is judged — not merely when it starts.
    const effectiveHorizonS = (horizonS ?? latencyModel.horizonS(null)) + latencyModel.medians().storyS;
    const center = this.anticipatedCenter(position, effectiveHorizonS);

    try {
      const result = await geminiService.prefetchStory(center);
      if (result.text && result.text.trim().length > 0) {
        this.addToCache({
          text: result.text,
          topic: result.subject || `Story at ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`,
          subject: result.subject,
          rotation: result.rotation,
          lat: result.anchorLat ?? center.lat,
          lng: result.anchorLng ?? center.lng,
          generatedAt: Date.now(),
          played: false,
          mode,
          regionAnchored: mode === 'driving',
          audioUrl: result.audioUrl,
          fromLibrary: result.fromLibrary,
          signatureFact: result.signatureFact ?? null,
          // Prefetch provenance (Area G): this story was fetched FOR
          // the anticipated center under this horizon — play time
          // measures the prediction against reality.
          projectedCenter: { lat: center.lat, lng: center.lng },
          horizonS: Math.round(effectiveHorizonS),
        });
        console.log('[StoryCache] Prefetched story for', center.lat.toFixed(4), center.lng.toFixed(4));
      }
    } catch (error) {
      console.error('[StoryCache] Prefetch failed:', error);
    } finally {
      this.isPrefetching = false;
    }
  }

  // Stocks the buffer with stories for the road AHEAD, while there is still
  // signal. This is what lets Leo keep talking through a dead zone: the
  // stories were already paid for and written before the bars dropped.
  async prefetchRouteAhead(position: Position, mode: MovementModeHysteresis, horizonS?: number): Promise<number> {
    if (!this.isOnline || this.isPrefetchingAhead) return 0;
    // Storm pause (fix stack RC-6): see prefetchForPosition.
    if (audioHealth.preferBanked()) return 0;
    const triggerThreshold = Math.floor(this.maxBuffer(mode) * 0.6);
    if (this.unplayedCount() >= triggerThreshold) return 0;

    // Route-ahead works for both driving and walking. Driving uses heading to
    // project forward; walking uses a tighter radius since the listener covers
    // far less ground.
    if (mode !== 'driving' && mode !== 'walking') return 0;
    if (position.heading === null || isNaN(position.heading)) return 0;

    this.isPrefetchingAhead = true;
    this.prunePrefetchTargets();
    let generated = 0;

    // The radial offsets now start from the ADAPTIVE center (Area D):
    // the road the listener reaches when the current story ends plus
    // pipeline latency — not from the spot underfoot, which the offsets
    // alone used to measure from (double-counting "now" as "ahead").
    // The base horizon is re-anchored to story END like the radial
    // prefetch (fix stack RC-6): + one median story duration.
    const effectiveHorizonS = (horizonS ?? latencyModel.horizonS(null)) + latencyModel.medians().storyS;
    const base = this.anticipatedCenter(position, effectiveHorizonS);

    try {
      // Freeway speeds (>= 25 m/s ~ 56 mph) get wider offsets so the queue
      // stays full when the listener is covering ground fast.
      const isFreeway = mode === 'driving' && position.speed !== null && position.speed >= 25;
      const offsets = mode === 'walking' ? ROUTE_OFFSETS_WALKING_M
        : isFreeway ? ROUTE_OFFSETS_FREWAY_M
        : ROUTE_OFFSETS_DRIVING_M;

      for (const offset of offsets) {
        if (!this.isOnline) break;
        if (this.unplayedCount() >= this.maxBuffer(mode)) break;

        const target = offsetPositionByHeading(base, position.heading as number, offset);

        if (this.wasTargetPrefetched(target)) continue;

        this.prefetchTargets.push({ ...target, at: Date.now() });

        const aheadPosition: Position = { ...position, lat: target.lat, lng: target.lng };
        const result = await geminiService.prefetchStory(aheadPosition);
        if (!result.text || result.text.trim().length === 0) continue;

        this.addToCache({
          text: result.text,
          topic: result.subject || `Story ahead at ${target.lat.toFixed(4)}, ${target.lng.toFixed(4)}`,
          subject: result.subject,
          rotation: result.rotation,
          lat: result.anchorLat ?? target.lat,
          lng: result.anchorLng ?? target.lng,
          generatedAt: Date.now(),
          played: false,
          mode,
          regionAnchored: mode === 'driving',
          audioUrl: result.audioUrl,
          fromLibrary: result.fromLibrary,
          signatureFact: result.signatureFact ?? null,
          projectedCenter: { lat: target.lat, lng: target.lng },
          horizonS: Math.round(effectiveHorizonS),
        });
        generated++;
        console.log(`[StoryCache] Prefetched ahead ${offset}m for ${mode}`);
      }
    } catch (error) {
      console.error('[StoryCache] Route prefetch failed:', error);
    } finally {
      this.isPrefetchingAhead = false;
    }

    return generated;
  }

  private prunePrefetchTargets() {
    const now = Date.now();
    this.prefetchTargets = this.prefetchTargets.filter(t => now - t.at < TARGET_TTL_MS);
  }

  private wasTargetPrefetched(target: { lat: number; lng: number }): boolean {
    return this.prefetchTargets.some(t => this.distance(t, target) < TARGET_DEDUPE_M);
  }

  // Session landmark lockout at the serve layer: a locally cached
  // angle-variant of a landmark already told this session is a retell,
  // and so is a story about a minor subject that has hit the daily
  // telling cap. A subject with a story in the player awaiting its
  // settle is locked out too (fix stack RC-2): its next angle must
  // wait for the hearing, or one place queues twice back to back.
  // Skipped only while moving — parked (speed ~0), rotation serves
  // are the dwell feature and stay available.
  // The minor retell rule (pre-publish stack Item 1, Oct 27, 2026)
  // is the one check that does NOT take the parked exemption: one
  // telling per minor place per tour, full stop — a buffered second
  // angle of a heard minor stays unserved even at a standstill.
  private isLockedOutWhileMoving(story: CachedStory, position: Position): boolean {
    const base = story.topic.split(' — ')[0].trim();
    const key = landmarkSubjectKey(base);
    if (storyCoverage.isMinorRetellBlocked(key)) return true;
    // Told-subject ledger (Oct 28, 2026): bound by the parked
    // exemption too, like the minor rule — a buffered angle of a
    // place with a telling still unsettled in the player, an
    // already-dealt angle, or a Tier-1 past its one retell (or
    // declined) does not serve even at a standstill. This is the
    // check that stops the Oct 28 Temple pattern: a second angle
    // dealt from the buffer while the first telling was still in
    // the queue.
    if (
      storyCoverage.isServeRefusedByToldLedger(
        key,
        story.rotation?.angle ?? angleFromTopic(story.topic)
      )
    ) {
      return true;
    }
    const speed = position.speed ?? null;
    if (speed !== null && speed < 1.0) return false;
    if (storyCoverage.isSubjectLockedForSession(key)) return true;
    if (storyCoverage.isSubjectInFlight(key)) return true;
    if (storyCoverage.isDailyCapped(key) && !storyLibrary.hasPlace(base)) return true;
    return false;
  }

  // Re-derive the pending-subject set from the cache contents: the
  // subjects of every unplayed story currently buffered. Called on
  // every cache mutation so the set cannot drift from reality.
  refreshPendingSubjects(): void {
    const keys = new Set<string>();
    for (const s of this.cache) {
      if (s.played) continue;
      keys.add(s.rotation?.subjectKey ?? landmarkSubjectKey(s.topic.split(' — ')[0].trim()));
    }
    storyCoverage.setPendingSubjects(keys);
  }

  armOpener(): void {
    this.openerPending = true;
    this.openerIntroContext = null;
  }

  private findNearestUnplayedCache(position: Position): CachedStory | null {
    let nearest: CachedStory | null = null;
    let minDistance = Infinity;

    for (const story of this.cache) {
      if (story.played) continue;
      if (this.isLockedOutWhileMoving(story, position)) continue;
      const d = this.distance(position, { lat: story.lat, lng: story.lng });
      // Each story carries its own serve window (fix stack RC-6):
      // the nearest story INSIDE its window wins — a nearer story
      // outside its own window is not servable at all.
      if (d > this.serveWindowM(position, story)) continue;
      if (d < minDistance) {
        minDistance = d;
        nearest = story;
      }
    }

    if (nearest) {
      return nearest;
    }

    // Offline fallback: serve the nearest unplayed story rather than nothing,
    // but only if it's still within a sane distance of the listener. A story
    // generated 5km ago is about a place the listener left long ago — playing
    // it would be worse than silence. Region-anchored stories (rural/highway
    // prefetches) describe a broad area, so the distance gate is loosened for
    // them.
    if (this.unplayedCount() > 0 && !this.isOnline) {
      const offlineFallback = this.cache
        .filter(s => !s.played && !this.isLockedOutWhileMoving(s, position))
        .map(s => ({ s, d: this.distance(position, { lat: s.lat, lng: s.lng }) }))
        .sort((a, b) => a.d - b.d)
        .find(({ s, d }) => s.regionAnchored ? d <= OFFLINE_REGION_MAX_M : d <= OFFLINE_POINT_MAX_M);
      return offlineFallback?.s ?? null;
    }

    return null;
  }

  // Presynth depth 2 (pre-publish stack Item 3, Oct 27, 2026): the
  // buffered story that would serve NEXT after the one already
  // queued — the honest "second story" in this architecture, since
  // the player queue holds at most one waiting location story by
  // design (useVoice MAX_PENDING_LOCATION_STORIES). PEEK semantics:
  // the same serve window and lockout discipline as a real serve
  // (findNearestUnplayedCache's online path), but nothing is marked
  // played and no in-flight mark lands — the entry stays fully
  // servable, and the serve path re-validates it when its turn
  // comes. A story already served into the player is marked played
  // at serve time, so it can never be the peek; the storyId
  // exclusion is belt-and-braces for a serve whose marking has not
  // landed yet. The offline fallback is deliberately not mirrored:
  // depth-2 warming exists to make the NORMAL next serve instant.
  peekNextBufferedStory(position: Position, excludeStoryId?: string): CachedStory | null {
    let nearest: CachedStory | null = null;
    let minDistance = Infinity;
    for (const story of this.cache) {
      if (story.played) continue;
      if (excludeStoryId && story.storyId === excludeStoryId) continue;
      if (this.isLockedOutWhileMoving(story, position)) continue;
      const d = this.distance(position, { lat: story.lat, lng: story.lng });
      if (d > this.serveWindowM(position, story)) continue;
      if (d < minDistance) {
        minDistance = d;
        nearest = story;
      }
    }
    return nearest;
  }

  private pruneMissedQueue() {
    const now = Date.now();
    this.missedQueue = this.missedQueue.filter(
      entry => now - entry.timestamp < QUEUE_MAX_AGE_MS
    );
  }

  async processMissedQueue(): Promise<void> {
    if (!this.isOnline || this.missedQueue.length === 0) return;

    this.pruneMissedQueue();
    const queue = [...this.missedQueue];
    this.missedQueue = [];
    this.notifyMissedQueueChange();

    for (const entry of queue) {
      try {
        const result = await geminiService.prefetchStory(entry.position);
        if (result.text && result.text.trim().length > 0) {
          this.addToCache({
            text: result.text,
            topic: result.subject || `Story at ${entry.position.lat.toFixed(4)}, ${entry.position.lng.toFixed(4)}`,
            subject: result.subject,
            rotation: result.rotation,
            lat: result.anchorLat ?? entry.position.lat,
            lng: result.anchorLng ?? entry.position.lng,
            generatedAt: Date.now(),
            played: false,
            mode: 'walking',
            regionAnchored: false,
            audioUrl: result.audioUrl,
            fromLibrary: result.fromLibrary,
            signatureFact: result.signatureFact ?? null,
          });
        }
      } catch (error) {
        console.error('[StoryCache] Catch-up fetch failed:', error);
        this.missedQueue.push(entry);
        this.notifyMissedQueueChange();
        break;
      }
    }
  }

  reset() {
    this.cache = [];
    this.openerPending = true;
    this.openerIntroContext = null;
    this.lastIntroBypassEpoch = 0;
    this.missedQueue = [];
    this.prefetchTargets = [];
    this.lastFetchPosition = null;
    this.lastFetchTime = 0;
    this.isPrefetching = false;
    this.isPrefetchingAhead = false;
    this.refreshPendingSubjects();
    this.notifyCacheChange();
    this.notifyMissedQueueChange();
  }
}

export const storyCache = new StoryCacheService();
