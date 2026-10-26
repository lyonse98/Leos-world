import { Position } from '../hooks/useGeolocation';
import { calculateDistance, offsetPositionByHeading, MovementModeHysteresis } from '../utils/geo';
import { geminiService, StoryRotation } from './gemini';
import { storyCoverage, landmarkSubjectKey } from './storyCoverage';
import { analytics } from './analytics';

export interface CachedStory {
  id: string;
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
const CACHE_DISTANCE_THRESHOLD_M = 100;
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
  private prefetchTargets: PrefetchTarget[] = [];
  private isPrefetching = false;
  private isPrefetchingAhead = false;
  private isOnline = true;
  private lastFetchPosition: Position | null = null;
  private lastFetchTime = 0;
  private minFetchIntervalMs = 10000;
  private onNetworkStatusChange?: (online: boolean) => void;
  private onCacheChange?: (cache: CachedStory[]) => void;
  private onMissedQueueChange?: (count: number) => void;

  setNetworkStatusCallback(cb: (online: boolean) => void) {
    this.onNetworkStatusChange = cb;
  }

  setCacheChangeCallback(cb: (cache: CachedStory[]) => void) {
    this.onCacheChange = cb;
  }

  setMissedQueueChangeCallback(cb: (count: number) => void) {
    this.onMissedQueueChange = cb;
  }

  // True when a story is already sitting in the buffer near this position and
  // can play with no wait. Used to decide whether a latency bridge is needed.
  hasReadyStory(position: Position): boolean {
    return this.cache.some(
      s => !s.played && this.distance(position, { lat: s.lat, lng: s.lng }) <= CACHE_DISTANCE_THRESHOLD_M
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

  private addToCache(entry: Omit<CachedStory, 'id'>) {
    // A story about something already waiting to be heard is not a new story.
    // Route-ahead prefetching asks for several stories before any of them has
    // played, and coverage is only marked when a story actually reaches the
    // listener — so without this the same area story would be queued over and
    // over down the same stretch of road.
    if (this.cache.some(s => !s.played && s.topic === entry.topic)) {
      return;
    }

    this.cache.push({ ...entry, id: `${Date.now()}_${Math.random()}` });
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
      // A story still close to the listener stays, even if old — it's relevant
      // to where they are right now.
      const d = this.distance(position, { lat: s.lat, lng: s.lng });
      if (d <= CACHE_DISTANCE_THRESHOLD_M) return true;
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
    onChunk?: (text: string) => void
  ): Promise<{ story: string; fromCache: boolean; topic: string; subject: string; context: string; rotation: StoryRotation | null; fromLibrary: boolean; audioUrl?: string; anchorLat?: number; anchorLng?: number } | null> {
    this.pruneStalePrefetches(position);
    const openerServe = this.openerPending;
    // While the opener is pending the local cache is not consulted at
    // all — the first story must be generated live as the welcome (see
    // the openerPending note). After the opener, serves are unchanged.
    const cached = openerServe ? null : this.findNearestUnplayedCache(position);
    if (cached) {
      cached.played = true;
      this.notifyCacheChange();
      this.refreshPendingSubjects();
      // A local serve is a telling, so it marks what it tells — this
      // layer used to only CHECK the lock, and since prefetched stories
      // are recorded nowhere at generation, a session could serve the
      // same place from the buffer all day with the lock set staying
      // empty. While moving, serving a landmark locks its subject and
      // counts toward the daily tally (rotation stories count later,
      // at play, through App's recordRotationStory funnel; library
      // serves also mark the place major/cap-exempt).
      const speed = position.speed ?? null;
      const moving = !(speed !== null && speed < 1.0);
      if (moving) {
        const servedKey = cached.rotation?.subjectKey ?? landmarkSubjectKey(cached.topic.split(' — ')[0].trim());
        if (servedKey.startsWith('landmark:')) {
          storyCoverage.lockSubjectForSession(servedKey);
          if (!cached.rotation) storyCoverage.recordDailyTelling(servedKey);
          if (cached.fromLibrary) storyCoverage.markMajorSubject(servedKey);
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
      };
    }

    if (!this.isOnline) {
      this.missedQueue.push({ position, timestamp: Date.now() });
      this.pruneMissedQueue();
      this.notifyMissedQueueChange();
      return null;
    }

    try {
      console.log('[StoryCache] Calling getTourNarration for', position.lat.toFixed(5), position.lng.toFixed(5));
      const result = await geminiService.getTourNarration(position, undefined, onChunk, {
        requireWelcomeStory: openerServe,
      });
      console.log('[StoryCache] getTourNarration returned:', { textLen: result.text?.length || 0, subject: result.subject, mode: result.mode });
      const story = result.text;
      if (story && story.trim().length > 0) {
        this.openerPending = false;
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
        this.addToCache({
          text: story,
          topic,
          subject: result.subject,
          rotation: result.rotation,
          lat: result.anchorLat ?? position.lat,
          lng: result.anchorLng ?? position.lng,
          generatedAt: Date.now(),
          played: true,
          mode,
          regionAnchored: mode === 'driving',
          audioUrl: result.audioUrl,
          fromLibrary: result.fromLibrary,
        });
        return { story, fromCache: false, topic, subject: result.subject, context: result.context, rotation: result.rotation, fromLibrary: !!result.fromLibrary, audioUrl: result.audioUrl, anchorLat: result.anchorLat, anchorLng: result.anchorLng };
      }
    } catch (error) {
      console.error('[StoryCache] Live fetch failed:', error);
      this.missedQueue.push({ position, timestamp: Date.now() });
      this.notifyMissedQueueChange();
    }

    return null;
  }

  // Predictive radial: where the radial prefetch should be centered — the
  // position the listener is ANTICIPATED to reach, projected along their
  // heading by ~90 seconds of travel. The radial machinery itself is
  // unchanged; only its center moves. At low speed the projection shrinks
  // toward zero and the center converges on the current position, so no
  // mode switching is needed. The distance is capped so a stale or
  // glitchy heading can't throw the center across town.
  private anticipatedCenter(position: Position): Position {
    const LOOKAHEAD_S = 90;
    const MAX_PROJECTION_M = 2500;
    const speed = position.speed ?? 0;
    const heading = position.heading;
    if (heading === null || isNaN(heading) || speed < 1.5) return position;
    const distance = Math.min(speed * LOOKAHEAD_S, MAX_PROJECTION_M);
    if (distance < 50) return position;
    const projected = offsetPositionByHeading(position, heading, distance);
    return { ...position, lat: projected.lat, lng: projected.lng };
  }

  async prefetchForPosition(position: Position, mode: MovementModeHysteresis): Promise<void> {
    if (!this.isOnline || this.isPrefetching) return;
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
    const center = this.anticipatedCenter(position);

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
  async prefetchRouteAhead(position: Position, mode: MovementModeHysteresis): Promise<number> {
    if (!this.isOnline || this.isPrefetchingAhead) return 0;
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

        const target = offsetPositionByHeading(position, position.heading as number, offset);

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
  // telling cap. Skipped only while moving — parked (speed ~0),
  // rotation serves are the dwell feature and stay available.
  private isLockedOutWhileMoving(story: CachedStory, position: Position): boolean {
    const speed = position.speed ?? null;
    if (speed !== null && speed < 1.0) return false;
    const base = story.topic.split(' — ')[0].trim();
    const key = landmarkSubjectKey(base);
    if (storyCoverage.isSubjectLockedForSession(key)) return true;
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
  }

  private findNearestUnplayedCache(position: Position): CachedStory | null {
    let nearest: CachedStory | null = null;
    let minDistance = Infinity;

    for (const story of this.cache) {
      if (story.played) continue;
      if (this.isLockedOutWhileMoving(story, position)) continue;
      const d = this.distance(position, { lat: story.lat, lng: story.lng });
      if (d < minDistance) {
        minDistance = d;
        nearest = story;
      }
    }

    if (nearest && minDistance <= CACHE_DISTANCE_THRESHOLD_M) {
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
