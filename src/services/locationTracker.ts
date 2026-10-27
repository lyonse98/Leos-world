import { Position } from '../hooks/useGeolocation';
import { supabase } from './supabase';
import { storyStore } from './storyStore';
import { heardStories } from './heardStories';
import { storyCoverage, landmarkSubjectKey } from './storyCoverage';
import { calculateDistance, resolveMovementMode, MovementModeHysteresis } from '../utils/geo';
import { AREA_ANGLES } from './storyCoverage';

interface LocationState {
  position: Position;
  landmarkNames: string[];
  timestamp: number;
  lastStoryTopic?: string;
  lastStoryText?: string;
  storyDepthLevel: number;
  depthCycle: number;
  lastNeighborhood?: string | null;
  storiesInNeighborhood: number;
}

// How far the listener may drift and still count as settled in one spot.
const DWELL_MOVE_THRESHOLD_M = 60;

class LocationTracker {
  private lastLocation: LocationState | null = null;
  private toldStories: Set<string> = new Set();
  private sessionId: string = '';
  private recentStoryTexts: string[] = [];
  private lastKnownMode: MovementModeHysteresis = 'stationary';
  private storiesToldCount = 0;
  // The neighborhood whose welcome intro has been DETECTED but not yet
  // HEARD (Pass 1, Oct 27, 2026; hearing semantics from the fix stack,
  // Oct 27, 2026). A neighborhood transition is
  // recorded in lastNeighborhood the moment shouldTellNewStory sees
  // it — if the serve that detected it then fails, redirects, or is
  // pre-empted, the welcome used to be silently consumed and never
  // fired. The debt survives here instead: it is set on every
  // transition (tour start included), re-offered by later decisions
  // for the same neighborhood (bounded by the chapter-break cooldown
  // in shouldTellNewStory), and cleared only when a story about that
  // neighborhood is actually HEARD (recordStoryHeard).
  private pendingIntroNeighborhood: string | null = null;
  // Where and when the listener last settled in one spot. Drives the
  // dwell-triggered deep cuts: stand somewhere long enough and Leo stops
  // giving you the quick hits and starts giving you the full story.
  private dwellAnchor: { lat: number; lng: number; since: number } | null = null;
  private static readonly MAX_RECENT_STORIES = 8;
  private static readonly CALLBACK_INTERVAL = 4;
  private static readonly STORAGE_KEY = 'leo_recent_stories';
  private static readonly STORAGE_TOPICS_KEY = 'leo_told_topics';
  private static readonly DWELL_LEVEL_MS = 180000; // 3 minutes — sooner than before

  constructor() {
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.loadPreviousStories();
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const recent = localStorage.getItem(LocationTracker.STORAGE_KEY);
      if (recent) {
        const parsed = JSON.parse(recent) as string[];
        if (Array.isArray(parsed)) {
          this.recentStoryTexts = parsed.slice(-LocationTracker.MAX_RECENT_STORIES);
        }
      }
      const topics = localStorage.getItem(LocationTracker.STORAGE_TOPICS_KEY);
      if (topics) {
        const parsedTopics = JSON.parse(topics) as string[];
        if (Array.isArray(parsedTopics)) {
          parsedTopics.forEach(t => this.toldStories.add(t.toLowerCase()));
        }
      }
      console.log('[LocationTracker] Loaded', this.recentStoryTexts.length, 'recent stories and', this.toldStories.size, 'topics from storage');
    } catch {
      // storage unavailable or corrupt — start fresh
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem(LocationTracker.STORAGE_KEY, JSON.stringify(this.recentStoryTexts));
      localStorage.setItem(LocationTracker.STORAGE_TOPICS_KEY, JSON.stringify(Array.from(this.toldStories).slice(-60)));
    } catch {
      // storage unavailable — non-critical
    }
  }

  private async loadPreviousStories() {
    try {
      const { data, error } = await supabase
        .from('tour_stories')
        .select('topic')
        .gte('created_at', new Date(Date.now() - 3600000).toISOString());

      if (!error && data) {
        data.forEach(record => this.toldStories.add(record.topic.toLowerCase()));
        console.log('[LocationTracker] Loaded', this.toldStories.size, 'previous stories');
      }
    } catch (error) {
      console.error('[LocationTracker] Error loading stories:', error);
    }
  }

  private getMovementThreshold(speed: number | null): number {
    const mode = resolveMovementMode(speed, this.lastKnownMode);
    this.lastKnownMode = mode;
    if (mode === 'driving') return 500;
    return 10;
  }

  private getStationaryTimer(speed: number | null): number {
    const mode = resolveMovementMode(speed, this.lastKnownMode);
    this.lastKnownMode = mode;
    // Give listeners time to absorb each story. The old 12s walking timer
    // was too aggressive — burned API quota and talked over reflection.
    return mode === 'driving' ? 35000 : 20000;
  }

  private hasMoved(pos1: Position, pos2: Position, speed: number | null): boolean {
    return calculateDistance(pos1.lat, pos1.lng, pos2.lat, pos2.lng) > this.getMovementThreshold(speed);
  }

  private hasNewLandmarks(oldLandmarks: string[], newLandmarks: string[]): boolean {
    if (newLandmarks.length === 0) return false;

    const newUniqueLandmarks = newLandmarks.filter(name => !oldLandmarks.includes(name));
    return newUniqueLandmarks.length > 0;
  }

  shouldTellNewStory(position: Position, landmarkNames: string[], neighborhood?: string | null): { shouldTell: boolean; context: string; depthLevel: number; depthCycle: number; isNeighborhoodIntro?: boolean } {
    if (!this.lastLocation) {
      const hasNeighborhood = !!(neighborhood && neighborhood.trim().length > 0);
      this.lastLocation = { position, landmarkNames, timestamp: Date.now(), storyDepthLevel: 0, depthCycle: 0, lastNeighborhood: neighborhood ?? null, storiesInNeighborhood: 0 };
      if (hasNeighborhood && neighborhood) this.pendingIntroNeighborhood = neighborhood;
      // First story of the tour: if we know the neighborhood, lead with a brief
      // situating intro before diving into landmarks. Otherwise start normally.
      return { shouldTell: true, context: hasNeighborhood ? 'neighborhood_intro' : 'initial', depthLevel: 0, depthCycle: 0, isNeighborhoodIntro: hasNeighborhood };
    }

    const hasMoved = this.hasMoved(this.lastLocation.position, position, position.speed);
    const hasNewLandmarks = this.hasNewLandmarks(this.lastLocation.landmarkNames, landmarkNames);
    const timeSinceLastStory = Date.now() - this.lastLocation.timestamp;
    const stationaryTimer = this.getStationaryTimer(position.speed);

    // Neighborhood transition: entering a new neighborhood gets a brief situating
    // intro before any landmark story. Fires once per neighborhood change.
    const prevNeighborhood = this.lastLocation.lastNeighborhood ?? null;
    const currentNeighborhood = neighborhood ?? null;
    const neighborhoodChanged =
      currentNeighborhood &&
      prevNeighborhood &&
      currentNeighborhood.toLowerCase() !== prevNeighborhood.toLowerCase();

    if (neighborhoodChanged) {
      this.lastLocation = {
        position,
        landmarkNames,
        timestamp: Date.now(),
        storyDepthLevel: this.lastLocation.storyDepthLevel,
        depthCycle: this.lastLocation.depthCycle,
        lastNeighborhood: currentNeighborhood,
        storiesInNeighborhood: 0,
      };
      // The chapter break is owed from this moment (Pass 1): if this
      // serve's welcome never gets generated, later decisions re-offer
      // it instead of the transition having been silently consumed.
      if (currentNeighborhood) this.pendingIntroNeighborhood = currentNeighborhood;
      return { shouldTell: true, context: 'neighborhood_intro', depthLevel: 0, depthCycle: 0, isNeighborhoodIntro: true };
    }

    // Chapter-break re-offer (Pass 1, Oct 27, 2026): the transition was
    // recorded on an earlier call but its welcome was never generated
    // (failed serve, redirect, pre-emption). The listener is still in
    // that neighborhood — offer the welcome again.
    if (
      this.pendingIntroNeighborhood &&
      currentNeighborhood &&
      prevNeighborhood &&
      currentNeighborhood.toLowerCase() === this.pendingIntroNeighborhood.toLowerCase() &&
      prevNeighborhood.toLowerCase() === currentNeighborhood.toLowerCase()
    ) {
      this.lastLocation = {
        position,
        landmarkNames,
        timestamp: Date.now(),
        storyDepthLevel: this.lastLocation.storyDepthLevel,
        depthCycle: this.lastLocation.depthCycle,
        lastNeighborhood: currentNeighborhood,
        storiesInNeighborhood: 0,
      };
      return { shouldTell: true, context: 'neighborhood_intro', depthLevel: 0, depthCycle: 0, isNeighborhoodIntro: true };
    }

    // Track neighborhood even when it hasn't changed, so the first entry is recorded.
    if (currentNeighborhood && !prevNeighborhood) {
      this.lastLocation.lastNeighborhood = currentNeighborhood;
      // Null → known during the opener phase (Pass 1): the tour began
      // before the neighborhood resolved, so the first decision could
      // only return 'initial'. If nothing has been told yet, the
      // neighborhood welcome is still the owed first story — fire it
      // now rather than letting the start area go unwelcomed.
      if (this.storiesToldCount === 0) {
        this.pendingIntroNeighborhood = currentNeighborhood;
        this.lastLocation.position = position;
        this.lastLocation.timestamp = Date.now();
        return { shouldTell: true, context: 'neighborhood_intro', depthLevel: 0, depthCycle: 0, isNeighborhoodIntro: true };
      }
    }

    if (hasMoved || hasNewLandmarks) {
      // Moving to a new spot starts a fresh landmark story, but the depth
      // rotation is a STATIONARY feature — it only advances while parked. A
      // walking tour through a landmark-dense area used to reset depth to 0
      // on every step, so the 12-level neighborhood rotation never advanced
      // and every stop opened with "stationary_landmark". Now depth is
      // preserved across moves and only the timer advances it.
      this.lastLocation = {
        position,
        landmarkNames,
        timestamp: Date.now(),
        storyDepthLevel: this.lastLocation.storyDepthLevel,
        depthCycle: this.lastLocation.depthCycle,
        lastNeighborhood: currentNeighborhood ?? this.lastLocation.lastNeighborhood,
        storiesInNeighborhood: this.lastLocation.storiesInNeighborhood,
      };

      if (hasNewLandmarks && hasMoved) {
        return { shouldTell: true, context: 'new_location_and_landmarks', depthLevel: 0, depthCycle: 0 };
      } else if (hasNewLandmarks) {
        return { shouldTell: true, context: 'new_landmarks', depthLevel: 0, depthCycle: 0 };
      } else if (hasMoved) {
        return { shouldTell: true, context: 'moved', depthLevel: 0, depthCycle: 0 };
      }
    }

    // Tell stories when stationary — timer scales with speed. The depth
    // rotation cycles through 12 angles, then loops with a fresh round. Depth
    // is READ here but ADVANCED only when a story is actually generated — a
    // cache hit serves the same landmark story without spending a depth slot,
    // so a parked listener doesn't burn through all 12 angles on cached hits
    // before ever hearing a fresh one.
    if (timeSinceLastStory > stationaryTimer) {
      const currentDepth = this.lastLocation.storyDepthLevel;
      const currentCycle = this.lastLocation.depthCycle;
      this.lastLocation.timestamp = Date.now();

      // The stationary depth rotation cycles through AREA_ANGLES. The first
      // entry is treated as the landmark angle (stationary_landmark) for dwell
      // depth on landmarks; the rest are area angles.
      const contexts = AREA_ANGLES as readonly string[];

      return { shouldTell: true, context: contexts[currentDepth] || contexts[0], depthLevel: currentDepth, depthCycle: currentCycle };
    }

    return { shouldTell: false, context: 'no_change', depthLevel: this.lastLocation.storyDepthLevel, depthCycle: this.lastLocation.depthCycle };
  }

  // Advance the stationary depth rotation. Called only when a story is actually
  // GENERATED (not served from cache), so cached hits don't burn depth slots.
  commitDepthAdvance(): void {
    if (!this.lastLocation) return;
    const currentDepth = this.lastLocation.storyDepthLevel;
    const currentCycle = this.lastLocation.depthCycle;
    const nextDepth = currentDepth + 1;
    if (nextDepth >= AREA_ANGLES.length) {
      this.lastLocation.storyDepthLevel = 0;
      this.lastLocation.depthCycle = currentCycle + 1;
    } else {
      this.lastLocation.storyDepthLevel = nextDepth;
    }
    this.lastLocation.storiesInNeighborhood++;
  }

  getStoriesInNeighborhood(): number {
    return this.lastLocation?.storiesInNeighborhood ?? 0;
  }

  // Generation/serve-time note (fix stack RC-2, Oct 27, 2026): a
  // story EXISTS — it was generated or served from a shelf — and the
  // prompt-continuity state (last topic/text, recent texts) plus the
  // shared-store publication update here. Coverage does NOT: until
  // this fix the same method also cleared the intro debt, marked the
  // angle told, wrote the durable heard record, and counted the
  // telling — all at generation time, so every story that later died
  // unheard (drop, timeout, displacement, teardown) had already
  // burned its subject. Those effects live in recordStoryHeard now
  // and fire only on a delivered settle. Publication stays here on
  // purpose: a generated story is a valid story for the NEXT listener
  // whether or not this one hears it — coverage is personal, the
  // shelf is shared.
  async updateLastStoryTopic(
    topic: string,
    position: Position,
    storyText?: string,
    context?: string,
    depthLevel?: number,
    versionKey?: string,
    // Set when the story took a rotation angle — carried only so the
    // shared-store save below is tagged with the angle it covered.
    // The angle is marked TOLD in recordStoryHeard, at hearing.
    rotation?: { subjectKey: string; angle: string } | null
  ) {
    if (this.lastLocation) {
      this.lastLocation.lastStoryTopic = topic;
      this.lastLocation.lastStoryText = storyText;

      if (storyText && storyText.trim().length > 0) {
        this.recentStoryTexts.push(storyText.trim());
        if (this.recentStoryTexts.length > LocationTracker.MAX_RECENT_STORIES) {
          this.recentStoryTexts.shift();
        }
      }

      this.saveToStorage();

      // Publish to the shared store so the next person at this spot gets it
      // free. Every story is cached — canonical and rotation alike — tagged
      // with the angle it covered. At lookup time, the listener's already-heard
      // angles are excluded, so a rotation story is only served to someone who
      // has not yet heard that angle. A first-time visitor gets the origin
      // story; a regular gets whichever cached angle they have not heard yet.
      if (storyText && storyText.trim().length > 0) {
        await storyStore.save({
          sessionId: this.sessionId,
          topic,
          lat: position.lat,
          lng: position.lng,
          storyText,
          context,
          depthLevel,
          versionKey,
          angle: rotation?.angle ?? null,
        });
      }
    }
  }

  // THE hearing record (fix stack RC-2 + D1/D6, Oct 27, 2026): called
  // by the app exactly once per served story, from the player's
  // settle callback, and only when the story was DELIVERED (sounded
  // AND completed). Everything that used to be recorded at generation
  // or queue time lands here instead:
  //  - the owed neighborhood welcome is PAID (the D1 fix: the debt
  //    used to clear only inside updateLastStoryTopic's intro-context
  //    branch, which live intros — area targets — never reached, so
  //    the debt survived its own welcome and re-offered forever; a
  //    topic match also pays it, so any serve flavor of the owed
  //    neighborhood's story counts);
  //  - the topic joins the told set the drive arc and the prompt's
  //    do-not-repeat list derive from (D6: the arc can no longer
  //    callback to a story the listener never heard);
  //  - a rotation's angle is marked told (markTold);
  //  - the durable heard record is written (heardStories), so the
  //    story is never told to this listener twice, across tours.
  // The session lock + daily count half lives in
  // storyCoverage.settleSubjectHeard, called alongside this.
  recordStoryHeard(
    topic: string,
    opts: {
      context?: string;
      rotation?: { subjectKey: string; angle: string } | null;
      position?: Position;
      storyText?: string;
    }
  ): void {
    if (!topic) return;

    if (this.pendingIntroNeighborhood) {
      const pending = this.pendingIntroNeighborhood.toLowerCase();
      const topicBase = topic.split(' — ')[0].trim().toLowerCase();
      const introContext =
        opts.context === 'initial' ||
        opts.context === 'neighborhood_intro' ||
        opts.context === 'welcome_back';
      if (introContext || topicBase === pending || topicBase.includes(pending)) {
        this.pendingIntroNeighborhood = null;
      }
    }

    this.toldStories.add(topic.toLowerCase());
    this.storiesToldCount++;
    this.saveToStorage();

    if (opts.rotation) {
      storyCoverage.markTold(opts.rotation.subjectKey, opts.rotation.angle);
      console.log(`[StoryCoverage] Covered "${opts.rotation.angle}" on ${opts.rotation.subjectKey}`);
    }

    if (opts.position && opts.storyText && opts.storyText.trim().length > 0) {
      heardStories.record({
        sessionId: this.sessionId,
        topic,
        storyText: opts.storyText,
        lat: opts.position.lat,
        lng: opts.position.lng,
      });
    }
  }

  getLastStoryTopic(): string | undefined {
    return this.lastLocation?.lastStoryTopic;
  }

  getLastStoryText(): string | undefined {
    return this.lastLocation?.lastStoryText;
  }

  hasAlreadyToldStory(topic: string): boolean {
    return this.toldStories.has(topic.toLowerCase());
  }

  // A neighborhood welcome has been detected but not yet generated
  // (see pendingIntroNeighborhood). storyCache consults this so a
  // buffered story cannot take the serve on which the welcome is due.
  hasPendingNeighborhoodIntro(): boolean {
    return this.pendingIntroNeighborhood !== null;
  }

  // Pass 1 (Oct 27, 2026): a story that was mid-play when the page
  // hid and then settled unheard is released for retelling later in
  // the drive — out of the in-drive told set, out of the session
  // lock, out of the in-memory heard set. Deliberately NOT undone:
  // the durable heard record (Supabase) and the permanent coverage
  // angles. Those are cross-session truth; the release is scoped to
  // this drive, which is exactly the scope the field failure needs.
  releaseInterruptedStory(topic: string): void {
    if (!topic) return;
    this.toldStories.delete(topic.toLowerCase());
    this.saveToStorage();
    const base = topic.split(' — ')[0].trim();
    storyCoverage.unlockSubjectForSession(landmarkSubjectKey(base));
    heardStories.unmarkHeard(topic);
    if (this.lastLocation?.lastStoryTopic === topic) {
      this.lastLocation.lastStoryTopic = undefined;
      this.lastLocation.lastStoryText = undefined;
    }
    console.log(`[LocationTracker] Released interrupted story "${topic}" for retelling`);
  }

  getAllToldStories(): string[] {
    return Array.from(this.toldStories);
  }

  getRecentStoryTexts(): string[] {
    return [...this.recentStoryTexts];
  }

  // Every Nth story, invite a "you know what connects these?" callback moment.
  shouldWeaveCallback(): boolean {
    return this.storiesToldCount > 0 && this.storiesToldCount % LocationTracker.CALLBACK_INTERVAL === 0;
  }

  getStoriesToldCount(): number {
    return this.storiesToldCount;
  }

  // True when the listener has settled in one place long enough that a deeper
  // dive is warranted. Backs off after the first few so a long lunch stop
  // doesn't turn into a lecture.
  getDwellDepthLevel(now = Date.now()): number | null {
    if (!this.dwellAnchor) return null;
    const minutes = (now - this.dwellAnchor.since) / 60000;
    const level = Math.floor((now - this.dwellAnchor.since) / LocationTracker.DWELL_LEVEL_MS);
    if (minutes < 3 || level > 4) return null;
    return level;
  }

  noteDwell(position: Position, now = Date.now()) {
    if (this.lastKnownMode !== 'stationary') {
      this.dwellAnchor = null;
      return;
    }
    if (!this.dwellAnchor) {
      this.dwellAnchor = { lat: position.lat, lng: position.lng, since: now };
      return;
    }
    const moved = calculateDistance(this.dwellAnchor.lat, this.dwellAnchor.lng, position.lat, position.lng);
    if (moved > DWELL_MOVE_THRESHOLD_M) {
      this.dwellAnchor = { lat: position.lat, lng: position.lng, since: now };
    }
  }

  getDwellMinutes(now = Date.now()): number {
    if (!this.dwellAnchor) return 0;
    return Math.floor((now - this.dwellAnchor.since) / 60000);
  }

  reset() {
    this.lastLocation = null;
    this.pendingIntroNeighborhood = null;
    this.dwellAnchor = null;
    // Day-scoped lockout: a tour restart does NOT clear today's
    // landmark locks, aliases, or telling counts (see storyCoverage).
    // Only the calendar rolling over — or the diagnostics full reset —
    // clears them. beginSession just performs the rollover check.
    storyCoverage.beginSession();
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.recentStoryTexts = [];
    this.toldStories = new Set();
    this.storiesToldCount = 0;
    try {
      localStorage.removeItem(LocationTracker.STORAGE_KEY);
      localStorage.removeItem(LocationTracker.STORAGE_TOPICS_KEY);
    } catch {
      // storage unavailable
    }
  }
}

export const locationTracker = new LocationTracker();
