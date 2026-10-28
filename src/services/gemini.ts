import { GoogleGenAI } from '@google/genai';
import type { Position } from '../hooks/useGeolocation';
import { placesService, NearbyPlace, AreaInfo } from './placesService';
import { locationTracker } from './locationTracker';
import { storyLookup } from './storyLookup';
import { storyLibrary } from './storyLibrary';
import type { CachedStoryResult } from './storyLookup';
import { heardStories } from './heardStories';
import { pickStorySubject, StorySubject } from './relevance';
import { tasteProfile } from './tasteProfile';
import { deriveTags, isInterestTag } from './storyTags';
import { storyCoverage, AREA_ANGLES, LANDMARK_ANGLES, describeAngle, describeArea, areaSubjectKey, landmarkSubjectKey, isRotationAngle, angleFromTopic } from './storyCoverage';
// Highway Corridor Library (Item 6): segment matching for the
// banked freeway narration — see src/data/corridors.ts.
import { matchCorridor } from '../data/corridors';
import { driveArc } from './driveArc';
import { resolveMovementMode, MovementModeHysteresis, calculateDistance } from '../utils/geo';
import { hashString } from '../utils/hash';
import { LEO_MODEL_ID, LEO_QA_MODEL_ID, LEO_QA_MAX_OUTPUT_TOKENS, LEO_PERSONA_VERSION, LEO_SYSTEM_INSTRUCTION } from './leoPersona';
import { wikipedia } from './wikipedia';
import { seasonal } from './seasonal';
import { osmService } from './osmService';
import { quotaGuard } from './quotaGuard';
import { wikidata } from './wikidata';
import { historicRegistry } from './historicRegistry';
import { majorPlaces } from './majorPlaces';
import { analytics, trackDiag } from './analytics';
import { latencyModel } from './latencyModel';
import { audioHealth } from './audioHealth';

export interface QAContext {
  lastSpokenSentences: string;
  nearbyLandmarks: string[];
}

export type StoryMode = 'walking' | 'driving' | 'highway' | 'rural';

export interface StoryFactPack {
  places: NearbyPlace[];
  areaInfo: AreaInfo;
  mode: StoryMode;
  isRural: boolean;
  wikiContext: string;
  osmContext: string;
  wikidataContext: string;
  registryContext: string;
}

export interface StoryRotation {
  subjectKey: string;
  angle: string;
}

export interface NarrationResult {
  text: string;
  subject: string;
  context: string;
  mode: StoryMode;
  rotation: StoryRotation | null;
  // Set only when the story came from the curated library: pre-made
  // audio the voice layer plays instead of synthesizing, and the
  // entry's own coordinates — the serve anchor the freshness gates
  // measure against, not the position the story was fetched at.
  audioUrl?: string;
  anchorLat?: number;
  anchorLng?: number;
  // Banked corridor serves only (Item 6): the matched segment's id,
  // threaded through the app into the player's queue item so the
  // dequeue gate can judge the story against its SEGMENT rather
  // than the library row's anchor (corridor expiry, Oct 28, 2026).
  // Absent on every other serve.
  corridorSegmentId?: string;
  fromLibrary?: boolean;
  // Tour thread (Oct 28, 2026): the telling's signature fact — its
  // lead, captured verbatim at generation (see leadFactFromText).
  // Set ONLY on results whose text was generated live by this
  // service; library, corridor-bank, and ephemeral-cache results
  // leave it absent, because their stored data carries no designated
  // lead and the thread never derives one after the fact. Threaded
  // storyCache → App hearing funnel → the tour telling ledger, where
  // it surfaces (if the telling is delivered) in later prompts'
  // TOUR THREAD block.
  signatureFact?: string | null;
  // The served subject is a major (Tier-1 landmark / marked major
  // subject) — the app gives such serves the priority queue lane
  // identically whatever their source (Area C, Oct 26, 2026).
  major?: boolean;
  // Fix stack (RC-4 / item 9, Oct 27, 2026): whether this serve
  // consumed the tracker's movement decision (a FAILED serve with
  // this set earns the app a decision refund, so the next chance
  // doesn't need another 500m), and whether an empty result is
  // DESIGNED silence under the highway doctrine rather than a
  // failure. Absent = false.
  decisionConsumed?: boolean;
  designedSilence?: boolean;
  // Never-starve ladder (pre-publish stack Item 2, Oct 27, 2026):
  // whether this serve actually attempted a live generation, and —
  // when the text comes back EMPTY — which rung of the ladder the
  // cycle stopped on. The app reads them to tell paced emptiness
  // (decision declined, but the player is busy) from STARVED
  // emptiness (idle player, nothing attempted): only the second is
  // a defect, and it is telemetered by reason ('starved-cycle').
  generationAttempted?: boolean;
  emptyReason?: string;
}

const EMPTY_NARRATION: NarrationResult = { text: '', subject: '', context: '', mode: 'walking', rotation: null };

// Retell gate (Erik's disparateness doctrine, Oct 28, 2026): the
// one permitted second telling of a Tier-1 place within a tour.
// Assembled when a live generation targets a Tier-1 subject with
// exactly one delivered telling this tour (storyCoverage's
// canRetellTier1): the first telling's text rides into the prompt
// as a binding exclusion list, and the model may answer with the
// decline sentinel instead of a story when no disjoint story can
// be filled from the fact pack. See buildStoryPrompt (the gate
// block) and the decline handling in getTourNarration.
interface RetellGate {
  subjectKey: string;
  subjectName: string;
  angle: string | null;
  firstText: string;
}

// The decline sentinel is the ENTIRE response — a story that
// merely opens with the word is not a decline.
const DECLINE_TEXT_RE = /^decline[.!]?$/i;

// Tour thread signature fact (Oct 28, 2026): a live telling's lead,
// captured verbatim at generation time. The live fact pack
// designates no single lead fact — the WOW-gate discipline lives in
// the persona, whose hook rules make the story open on its most
// compelling beat — so the telling's own first sentence IS the lead
// the brief selected, and capturing it quotes the telling rather
// than inventing a designation the fact pack never made. Only a
// clean, complete first sentence of moderate length qualifies; an
// abbreviation-shattered fragment ("The U.") fails the length floor
// and an over-long opener fails the cap — both record NO fact rather
// than a mangled one.
const MAX_SIGNATURE_FACT_CHARS = 170;
const MIN_SIGNATURE_FACT_CHARS = 30;
function leadFactFromText(text: string): string | null {
  const clean = text.replace(/\s+/g, ' ').trim();
  const match = clean.match(/^[^.!?]+[.!?]/);
  if (!match) return null;
  const sentence = match[0].trim();
  if (sentence.length < MIN_SIGNATURE_FACT_CHARS || sentence.length > MAX_SIGNATURE_FACT_CHARS) {
    return null;
  }
  return sentence;
}

// Latency-adaptive length floor (pre-publish stack Item 5, Oct 27,
// 2026). LATENCY_BASELINE_S is the pipeline latency the ruled length
// bands were tuned around — identically latencyModel's healthy
// fallbacks (6s fetch + 6s synth), which is also what the model
// reports before any measurement lands, so a cold tour sees NO lift
// until real samples say the pipeline is slow; no pessimistic default
// is invented. SENTENCE_RUNWAY_S is the speaking time one more
// sentence buys (~100 chars at Leo's ~13 chars/sec) — the lift asks
// for roughly one sentence of story per sentence of excess latency,
// so the story on air covers the measured cost of producing the
// next one.
const LATENCY_BASELINE_S = 12;
const SENTENCE_RUNWAY_S = 7.5;

interface StoryTarget {
  kind: 'landmark' | 'area';
  subject: StorySubject | null;
  rotation: StoryRotation | null;
  areaName: string;
  displayTopic: string;
  // The exact angle chosen for this target — the serve path asks the
  // library for THIS angle. Null when no angle applies; the library
  // holds no entries for those.
  angle: string | null;
  // Significance (Area E, Oct 26, 2026): a Tier-1 / marked-major
  // landmark, or an area inside a major named district. Threaded into
  // buildStoryPrompt, where it overrides the length bands — story
  // length follows SIGNIFICANCE as well as speed and density.
  significance?: 'major-landmark' | 'major-area';
}

const MIN_REQUEST_INTERVAL_MS = 3000;
// Honest bounded retry (fix stack RC-4, Oct 27, 2026): ONE retry,
// spent only on a fast, non-quota, non-timeout failure — the cases a
// retry can actually cure. RETRY_BASE_DELAY_MS is the real delay
// between the attempts. (For years these constants claimed 3
// retries at a 5s base delay while the loop rethrew on the first
// failure in both catch branches — the retry did not exist.)
const MAX_RETRIES = 1;
const RETRY_BASE_DELAY_MS = 750;
const RETRY_FAST_FAIL_MS = 8000;
const REQUEST_TIMEOUT_MS = 30000;

// Fail-fast bounds (Oct 25 field wedge): a story request once stalled
// ~149 s, and because every generation shares this one lane, the whole
// session wedged behind it until a full relaunch. The old bounds only
// timed out the initial request (30 s) and the gaps BETWEEN stream
// chunks (30 s each, unbounded in count) — a stream dribbling a chunk
// every 29 s could hold the lane for minutes — and the fact pack had
// no bound at all. Now: one hard overall deadline per generation
// attempt (request + full stream), a bound on the fact pack, and a
// bound on WAITING for the lane, so a hang fails in seconds and the
// pipeline moves on instead of dying quietly. Quota semantics are
// untouched: quota errors still trip the breaker and are never
// retried — a deadline expiry is a plain failure, not a quota signal.
const GEN_DEADLINE_MS = 20000;
const FACTPACK_TIMEOUT_MS = 12000;
const WIKIDATA_TIMEOUT_MS = 6000;
const SLOT_WAIT_TIMEOUT_MS = 90000;

const MAX_TOLD_TOPICS_IN_PROMPT = 15;
const MAX_PREVIOUS_STORY_CHARS = 300;
const MAX_RECENT_STORY_CHARS = 200;

const STATIONARY_CONTEXTS: Record<string, string> = {
  stationary_landmark: 'Tell a story about a LANDMARK here — the specific building, monument, or site nearby.',
  stationary_neighborhood: 'Tell a story about NEIGHBORHOOD history here — what shaped this area, who lived here, how it changed.',
  stationary_region: 'Tell a story about REGIONAL history — the bigger story of this area.',
  stationary_figures: 'Tell a story about NOTABLE FIGURES connected to this area — people who lived, worked, or made history here.',
  stationary_culture: 'Tell a story about LOCAL CULTURE and traditions here — how people lived, celebrated, and shaped this place.',
  stationary_streets: 'Tell a story about STREET NAMES and the GRID here — why streets are named what they are, how the layout was designed, the original plan.',
  stationary_architecture: 'Tell a story about ARCHITECTURE and BUILDING STYLES here — what era the buildings are from, what styles dominate, what that says about development.',
  stationary_nature: 'Tell a story about NATURAL FEATURES and LANDSCAPE — what the land was like before development, old trees, creeks, hills, wetlands, how geography shaped the neighborhood.',
  stationary_transport: 'Tell a story about TRANSPORTATION HISTORY here — how roads, highways, railroads, or transit shaped this area.',
  stationary_demographics: 'Tell a story about DEMOGRAPHIC SHIFTS here — who lived here over time, waves of immigration, how the community changed.',
  stationary_geology: 'Tell a story about GEOLOGY and TERRAIN — the rocks, soil, elevation, and natural history beneath this area.',
  stationary_folklore: 'Tell a story about LOCAL FOLKLORE and MYTHS here — legends, ghost stories, urban myths, weird trivia with real history behind them.',
  stationary_economy: 'Tell a story about the ECONOMY of this area — what people did for work, how industries rose and fell, how money shaped this place.',
  stationary_food: 'Tell a story about FOOD CULTURE here — old markets, long-gone restaurants, what people ate, how the food scene reflects the community.',
  stationary_conflict: 'Tell a story about CONFLICT and SCANDAL here — disputes, strikes, protests, corruption, moments of friction that shaped this place.',
  stationary_names: 'Tell a story about NAMES here — why things are called what they are, the origin of place and street names, what the names reveal about who was here first.',
  stationary_music: 'Tell a story about MUSIC HISTORY here — bands, venues, scenes, sounds, and the music culture of this area.',
  stationary_crime: 'Tell a story about CRIME and LAW here — notorious cases, the justice system, law enforcement history, and how the law shaped this place.',
  stationary_education: 'Tell a story about EDUCATION HISTORY here — schools, colleges, academies, and how learning shaped this area.',
  stationary_women: "Tell a story about WOMEN'S HISTORY here — the women who shaped this area, their struggles, achievements, and stories.",
  stationary_infrastructure: 'Tell a story about INFRASTRUCTURE here — the hidden systems beneath the street: water, sewer, power, transit tunnels, and the engineering nobody notices.',
  stationary_sports: 'Tell a story about SPORTS HISTORY here — teams, games, arenas, athletic legends, and the sports culture of this area.',
  stationary_events: 'Tell a story about BIG CULTURAL EVENTS here — fairs, expos, festivals, protests, and moments that defined this area.',
  stationary_lives: 'Tell a story about FAMOUS LIVES here — notable births, deaths, residents, and the people who lived or died connected to this place.',
};

const MOVEMENT_CONTEXTS: Record<string, string> = {
  new_location_and_landmarks: 'You are somewhere new AND the landmarks have changed. Tell the best story about the new landmarks ahead.',
  new_landmarks: 'New landmarks have come into range. Tell the best story about these new landmarks.',
  moved: "You've moved. Tell the best story about what's here now.",
  initial: 'FIRST STORY OF THE TOUR: Welcome the listener, and name the city and neighborhood. Then make this intro a STORY, not a preamble: tell one of the most compelling true stories of this neighborhood — what this place is about and how it got that way, the story a local would tell a friend first to explain where they are. Set the scene like the opening of a podcast episode: orient them, ground them, make them want to keep listening. This intro is exempt from the mode length caps — take 10-12 sentences if the neighborhood earns it (the intro band: a floor-raising exemption, combined with any significance band by MAX, never a replacement). Tell a NEIGHBORHOOD story, not a specific landmark story — landmarks get their own turns starting with the next stop.',
  prefetch: 'Tell the best story about what is here now.',
  neighborhood_intro: 'NEIGHBORHOOD INTRO: The listener just entered a new neighborhood, and this intro is not a preamble — it IS a story. Tell one of the most compelling true stories of this neighborhood: what this place is about and how it got that way. If this listener has heard an intro to this neighborhood before, tell a DIFFERENT defining story — rotate to a fresh angle on the place rather than repeating the orientation they already know. This intro is exempt from the mode length caps — take 10-12 sentences if the neighborhood earns it (the intro band: a floor-raising exemption, combined with any significance band by MAX, never a replacement). Make it complete on its own: do not bolt a separate landmark story onto the end of it. Landmarks here get their own turns after this.',
  welcome_back: 'WELCOME BACK: The listener has been to this neighborhood before on a previous tour. Acknowledge their return briefly — "welcome back to [area]" or similar — then tell them something they probably do NOT know about this area yet. Skip the basic orientation; they have heard it before. Go straight to a fresh angle or a deeper cut.'
};

class GeminiService {
  private ai: GoogleGenAI | null = null;
  private lastRequestTime = 0;
  private requestInProgress = false;
  private requestCounter = 0;
  private lastKnownMode: MovementModeHysteresis = 'stationary';
  private lastError: string | null = null;

  issueRequestToken(): number {
    return ++this.requestCounter;
  }

  cancelAllRequests(): void {
    this.requestCounter++;
  }

  currentRequestToken(): number {
    return this.requestCounter;
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  // Generation-lane priority (fix stack RC-4, Oct 27, 2026): the
  // single shared lane used to be a boolean + 200ms poll — FIFO by
  // arrival, so during a gap the route-ahead prefetcher (four
  // sequential generations) held the lane exactly when a live serve
  // was waiting, and a waiting live serve polled behind all of them.
  // The lane is now an explicit priority queue: live story (0) beats
  // Q&A (1) beats prefetch (2), FIFO within a priority. A caller
  // already IN the lane is never preempted (a generation is
  // deadline-bound, ≤ ~30s), but no waiter ever queues behind a
  // lower-priority waiter again.
  private laneWaiters: Array<{ priority: number; seq: number; resolve: () => void }> = [];
  private laneSeq = 0;
  private lastLaneWaitMs = 0;

  private async acquireSlot(priority: number): Promise<void> {
    if (!this.requestInProgress) {
      this.requestInProgress = true;
      this.lastLaneWaitMs = 0;
      return;
    }
    // Bounded wait: the lane's holder is itself deadline-bound (worst
    // case ~40 s for a Q&A primary + fallback), so a wait past this
    // bound means the holder is gone, not slow. Fail the call instead
    // of queueing behind a corpse forever — the callers all degrade
    // (cache, designed silence, an honest error line) rather than hang.
    const waitStartedAt = Date.now();
    await new Promise<void>((resolve, reject) => {
      const waiter = {
        priority,
        seq: this.laneSeq++,
        resolve: () => { /* replaced below */ },
      };
      const timer = setTimeout(() => {
        const idx = this.laneWaiters.indexOf(waiter);
        if (idx >= 0) this.laneWaiters.splice(idx, 1);
        reject(new Error('Gemini lane busy — a previous request never released the slot'));
      }, SLOT_WAIT_TIMEOUT_MS);
      waiter.resolve = () => {
        clearTimeout(timer);
        resolve();
      };
      this.laneWaiters.push(waiter);
    });
    this.lastLaneWaitMs = Date.now() - waitStartedAt;
    this.requestInProgress = true;
  }

  private releaseSlot(): void {
    // Ownership transfers directly to the highest-priority waiter —
    // the lane never goes idle while work waits, and
    // requestInProgress stays true across the handoff so no new
    // caller can slip into the gap.
    if (this.laneWaiters.length === 0) {
      this.requestInProgress = false;
      return;
    }
    this.laneWaiters.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    const next = this.laneWaiters.shift()!;
    next.resolve();
  }

  // Attempt-level generation timing (fix stack RC-1, Oct 27, 2026):
  // until now only SUCCESSES carried timing (story_timing merges),
  // so a drive full of 20s timeouts looked, in the data, like a
  // drive of slow successes. Every attempt now files one event —
  // model, kind, attempt index, duration, outcome (ok / timeout /
  // quota / error / lane-timeout), and the lane wait that preceded
  // it — so the next drive can answer WHY generations time out:
  // long attempts point at the API/connection, lane-timeout and big
  // lane_wait_ms point at contention, quota at the wall.
  private emitGenerationAttempt(
    modelId: string,
    kind: 'story' | 'answer',
    attempt: number,
    durationMs: number,
    outcome: 'ok' | 'timeout' | 'quota' | 'error' | 'lane-timeout'
  ): void {
    try {
      analytics.track('generation_attempt', null, undefined, {
        model: modelId,
        kind,
        attempt,
        duration_ms: Math.round(durationMs),
        outcome,
        lane_wait_ms: attempt === 0 ? Math.round(this.lastLaneWaitMs) : null,
      });
    } catch { /* a metric must never break a generation */ }
  }

  private isQuotaError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    return msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED');
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Gemini request timed out')), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async withRetry<T>(modelId: string, fn: () => Promise<T>, kind: 'story' | 'answer' = 'story'): Promise<T> {
    // Circuit breaker: while this model is tripped, do not call the API at
    // all — callers degrade to cache / designed silence instead of spending
    // requests against a quota wall.
    if (quotaGuard.isTripped('text', modelId)) {
      throw new Error(`Gemini quota cooldown active for ${modelId} — request skipped`);
    }
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const attemptStartedAt = Date.now();
      try {
        await this.enforceRateLimit();
        const result = await fn();
        this.emitGenerationAttempt(modelId, kind, attempt, Date.now() - attemptStartedAt, 'ok');
        return result;
      } catch (error) {
        lastError = error;
        const durationMs = Date.now() - attemptStartedAt;
        if (this.isQuotaError(error)) {
          // Never retry a quota error: against a per-minute wall the retry
          // lands inside the same window; against a per-day wall it is
          // pure waste. Trip the breaker for this model and degrade.
          this.emitGenerationAttempt(modelId, kind, attempt, durationMs, 'quota');
          quotaGuard.trip('text', modelId);
          throw error;
        }
        const msg = error instanceof Error ? error.message : String(error);
        const isTimeout =
          msg.includes('timed out') || msg.includes('deadline') || msg.includes('stalled');
        this.emitGenerationAttempt(modelId, kind, attempt, durationMs, isTimeout ? 'timeout' : 'error');
        // The bounded retry (see MAX_RETRIES): spent only where it
        // can help — a FAST ordinary failure is likely transient; a
        // slow one has already eaten the deadline's budget, and a
        // timeout will simply time out again inside the same serve.
        const mayRetry = attempt < MAX_RETRIES && !isTimeout && durationMs < RETRY_FAST_FAIL_MS;
        if (!mayRetry) throw error;
        await new Promise(resolve => setTimeout(resolve, RETRY_BASE_DELAY_MS));
      }
    }
    throw lastError;
  }

  initialize() {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      throw new Error('Gemini API key is missing. Please add VITE_GEMINI_API_KEY to your .env file.');
    }

    this.ai = new GoogleGenAI({ apiKey });
  }

  resolveMode(position: Position, factPack?: { isRural: boolean }): StoryMode {
    const movement = resolveMovementMode(position.speed, this.lastKnownMode);
    this.lastKnownMode = movement;
    if (movement !== 'driving') return 'walking';
    if (factPack?.isRural) return 'rural';
    if (position.speed !== null && position.speed > 15) return 'highway';
    return 'driving';
  }

  async gatherFactPack(position: Position, discoveryPosition?: Position): Promise<StoryFactPack> {
    let places: NearbyPlace[] = [];
    let areaInfo: AreaInfo = { neighborhood: null, city: null, district: null, street: null };
    let wikiContext = '';
    let osmContext = '';
    let wikiTopTitle = '';
    const deepMode = locationTracker.getDwellDepthLevel() !== null;
    // Discovery geometry (Area D, Oct 26, 2026): PLACES discovery runs
    // around the projected center — where the listener will be when
    // this story speaks — so candidates enter the pipeline while still
    // AHEAD. Area identity, Wikipedia and OSM enrichment stay at the
    // real position: they describe where the listener IS, and the
    // tracker keys neighborhood crossings off them. The places service
    // still adds its own small heading look-ahead on top.
    const discovery = discoveryPosition ?? position;
    try {
      // Bounded: on a half-dead connection any one of these sources can
      // hang far longer than a story is worth. On timeout the pack
      // proceeds with whatever defaults stand (the sources' own caches
      // still warm in the background for the next fetch).
      const [placesResult, areaResult, wikiResult, osmResult] = await this.withTimeout(
        Promise.all([
          placesService.getNearbyLandmarks(discovery, 100),
          placesService.getAreaInfo(position),
          wikipedia.getNearbyArticles(position, deepMode),
          osmService.getNearbyFeatures(position, position.speed),
        ]),
        FACTPACK_TIMEOUT_MS
      );
      places = placesResult;
      areaInfo = areaResult;
      wikiContext = wikipedia.formatForPrompt(wikiResult);
      osmContext = osmService.formatForPrompt(osmResult);
      wikiTopTitle = wikiResult?.[0]?.title || '';
    } catch (error) {
      console.error('Error fetching fact pack:', error);
    }

    // Historic-registry candidates (Level 2): designated places with
    // verified coordinates join the shared candidate pool as the
    // 'historic_registry' tier, so a designated place Google doesn't
    // list is still story-eligible. They flow through the same heard
    // set, session lockout and angle coverage as Google candidates —
    // resolveSubject makes no distinction — with a capped score
    // (relevance.ts) and no Tier-1 eligibility (placesService). A
    // registry record that duplicates a Google candidate by name is
    // dropped: the Google entry carries rating/types and wins. Local
    // dataset lookup — synchronous, no network; wrapped so it can
    // never break the pack.
    try {
      const registryCandidates = historicRegistry.candidatesAsPlaces(discovery, 500);
      const extras: NearbyPlace[] = [];
      for (const rc of registryCandidates) {
        // Same place under a matching name: the Google entry carries
        // rating/types and wins — but the two names are linked as
        // session aliases, so a lock earned under either name binds
        // both spellings (subject-identity hardening).
        const nameTwin = places.find(p => historicRegistry.namesMatch(p.name, rc.name));
        if (nameTwin) {
          storyCoverage.linkSubjectAliases(landmarkSubjectKey(nameTwin.name), landmarkSubjectKey(rc.name));
          continue;
        }
        // Same ground under unrelated names (the registry's "Naval
        // Training Station" vs Google's "Liberty Station"): a verified
        // registry point within 150 m of a Google candidate is that
        // candidate's designation, not a rival subject. Fold it in as
        // a designation boost on the Google entry (kept OUT of
        // historicalScore, so it can never mint Tier-1 eligibility)
        // and link the names as aliases.
        const nearTwin =
          rc.lat !== undefined && rc.lng !== undefined
            ? places.find(
                p =>
                  p.lat !== undefined &&
                  p.lng !== undefined &&
                  calculateDistance(p.lat, p.lng, rc.lat as number, rc.lng as number) <= 150
              )
            : undefined;
        if (nearTwin) {
          const boost = rc.historicalScore >= 85 ? 40 : 25;
          nearTwin.designationBoost = Math.max(nearTwin.designationBoost ?? 0, boost);
          storyCoverage.linkSubjectAliases(landmarkSubjectKey(nearTwin.name), landmarkSubjectKey(rc.name));
          continue;
        }
        extras.push(rc);
      }
      if (extras.length > 0) {
        // Appended after the Google candidates (which keep their own
        // ranking order); relevance scoring, not list position, decides
        // the subject. With no Google candidates, the nearest registry
        // place becomes the lead subject for fact enrichment below.
        places = [...places, ...extras];
      }
    } catch (error) {
      console.warn('[Gemini] Registry candidate merge failed (continuing without):', error);
    }

    // Curated major places (Area F, Oct 26, 2026): the audit-confirmed
    // class of majors the generic sources under-rank or misname
    // (services/majorPlaces — every pin a verified registry record).
    // A curated entry that proves to be the same ground as a pool
    // candidate (name match, or ≤150 m) folds into it: the names are
    // alias-linked, and a tier1 entry marks the twin a major subject —
    // lifting a capped registry candidate ("California Quadrangle")
    // into the major treatment its public name (Museum of Us) earns.
    // With no twin, the entry stands as the candidate itself. Local
    // and synchronous, like the registry merge; fails to nothing.
    try {
      for (const curated of majorPlaces.candidatesAsPlaces(discovery, 1500)) {
        const nameTwin = places.find(p => historicRegistry.namesMatch(p.name, curated.place.name));
        const nearTwin =
          !nameTwin && curated.place.lat !== undefined && curated.place.lng !== undefined
            ? places.find(
                p =>
                  p.lat !== undefined &&
                  p.lng !== undefined &&
                  calculateDistance(p.lat, p.lng, curated.place.lat as number, curated.place.lng as number) <= 150
              )
            : undefined;
        const twin = nameTwin ?? nearTwin;
        if (twin) {
          storyCoverage.linkSubjectAliases(landmarkSubjectKey(twin.name), landmarkSubjectKey(curated.place.name));
          if (curated.tier1) {
            storyCoverage.markMajorSubject(landmarkSubjectKey(twin.name));
            storyCoverage.markMajorSubject(landmarkSubjectKey(curated.place.name));
          }
          continue;
        }
        if (curated.tier1) {
          storyCoverage.markMajorSubject(landmarkSubjectKey(curated.place.name));
        }
        places = [...places, curated.place];
      }
    } catch (error) {
      console.warn('[Gemini] Curated major-places merge failed (continuing without):', error);
    }

    // Wikidata verified facts for the lead subject (top place, else top
    // Wikipedia article). Enrichment only — fails to '' silently.
    let wikidataContext = '';
    const subjectName = places[0]?.name || wikiTopTitle;
    if (subjectName) {
      wikidataContext = await this.withTimeout(
        wikidata.getFactsForPlace(subjectName, position),
        WIKIDATA_TIMEOUT_MS
      ).catch(() => '');
    }

    // Historic-registry facts for the same lead subject (Level 1):
    // designation status/year/significance as hard fact, name- and
    // proximity-verified in historicRegistry. Enrichment only, like
    // Wikidata — fails to '' silently and is excluded from the fact
    // pack hash below, so facts ride first-writer-wins.
    let registryContext = '';
    if (subjectName) {
      registryContext = historicRegistry.factsForSubject(subjectName, position.lat, position.lng);
    }

    const movement = resolveMovementMode(position.speed, this.lastKnownMode);
    const isRural =
      movement === 'driving' && !areaInfo.neighborhood && !areaInfo.city && places.length === 0;
    const mode = this.resolveMode(position, { isRural });

    return { places, areaInfo, mode, isRural, wikiContext, osmContext, wikidataContext, registryContext };
  }

  factPackHash(factPack: StoryFactPack): string {
    // Registry candidates are excluded from the hash, same doctrine as
    // the wikidata/registry fact blocks: enrichment rides
    // first-writer-wins and must not mint new cache identities.
    const placeKey = factPack.places
      .filter(p => p.source !== 'historic_registry')
      .slice(0, 10)
      .map(p => `${p.name}|${p.types.slice(0, 2).join(',')}|${Math.round(p.distance / 50)}`)
      .join(';');
    const areaKey = [factPack.areaInfo.neighborhood, factPack.areaInfo.city, factPack.areaInfo.street]
      .filter(Boolean)
      .join(',');
    return hashString(`${placeKey}#${areaKey}#${factPack.mode}`);
  }

  storyVersionKey(factPackHash: string): string {
    return `${LEO_PERSONA_VERSION}|${LEO_MODEL_ID}|${factPackHash}`;
  }

  // Tier-1 places in the pool are majors — cap-exempt by definition.
  // Marking them as they are evaluated is what lets the topic-only
  // serve layers (which hold no candidate object) honor the exemption
  // — and lets a later library serve of the same place claim the
  // priority queue lane (Area C). The Tier-1 mark proper rides along
  // (pre-publish stack Item 1, Oct 27, 2026): the retell policy —
  // per-angle session lock, scan eligibility — is Tier-1-specific
  // and reads its own set, not the majors set at large.
  private markTier1Majors(factPack: StoryFactPack): void {
    for (const place of factPack.places) {
      if (placesService.isTier1Landmark(place)) {
        storyCoverage.markMajorSubject(landmarkSubjectKey(place.name));
        storyCoverage.markTier1Subject(landmarkSubjectKey(place.name));
      }
    }
  }

  private resolveSubject(factPack: StoryFactPack, allowRevisit: boolean = false, position?: Position): StorySubject | null {
    if (factPack.places.length === 0) return null;

    this.markTier1Majors(factPack);

    // A moving-context candidate is unavailable when ANY of these hold:
    //  - session lock: the place was already TOLD this session (for a
    //    Tier-1 subject the lock now lands only at angle exhaustion —
    //    see settleSubjectHeard — so this check no longer suppresses a
    //    Tier-1 with fresh angles; the revisit pool below is what
    //    actually re-offers it);
    //  - pending: a story about it is already generated and waiting
    //    unplayed in the local cache — generating a second angle before
    //    the first plays is how one place fills the buffer;
    //  - daily cap: a minor subject already told DAILY_MINOR_CAP times
    //    today across sessions (Tier-1 and library places exempt);
    //  - minor retell rule (pre-publish stack Item 1, Oct 27, 2026):
    //    a minor place already HEARD on this tour — one telling per
    //    minor place per tour, whatever angle remains.
    // Dwell (allowRevisit) bypasses the first three: parked depth
    // rotation is the designed exception to each. The minor rule is
    // NOT bypassed — its filter is applied to the revisited pool
    // itself below.
    // Told-subject ledger (Oct 28, 2026): the last check is Erik's
    // queue-time rule — a subject with a telling committed this
    // tour (queued, playing, or delivered) is told for selection,
    // whatever the older records say. The Tier-1 revisit pool is
    // the ONE path allowed past it, and only through the
    // disparateness gate, so it calls blocked with viaRetellGate:
    // every other clause (lock, pending/in-flight, cap, minor)
    // still applies there in full.
    const blocked = (place: NearbyPlace, viaRetellGate: boolean = false) => {
      if (allowRevisit) return false;
      const key = landmarkSubjectKey(place.name);
      if (storyCoverage.isSubjectLockedForSession(key)) return true;
      if (storyCoverage.isSubjectPending(key)) return true;
      if (storyCoverage.isDailyCapped(key) && !storyLibrary.hasPlace(place.name)) return true;
      if (storyCoverage.isMinorRetellBlocked(key)) return true;
      if (!viaRetellGate && storyCoverage.isSubjectToldForSelection(key)) return true;
      return false;
    };

    // Bearing discipline at SELECTION (Area D, Oct 26, 2026): at
    // driving speed with a trustworthy heading, candidates in the
    // rear hemisphere are ineligible while ANY forward candidate
    // exists — selection, not just the dequeue gate, must refuse to
    // spend a story on somewhere already passed. (The dequeue gate
    // alone let surface-street behind-me narration through: it only
    // fired at freeway speed, at dequeue, after the story was
    // already written and queued.) The candidate's direction string
    // is computed against the fetch heading by the places service.
    // Dwell (allowRevisit) is exempt — parked, "behind" is meaningless;
    // stops and unreliable headings never reach the speed gate.
    const pickWithBearing = (cands: NearbyPlace[], opts?: { ignoreHeardPenalty?: boolean }) => {
      if (
        !allowRevisit &&
        position &&
        (position.speed ?? 0) >= 6 &&
        position.heading !== null &&
        !isNaN(position.heading)
      ) {
        const BEHIND = new Set(['directly behind you', 'behind to your right', 'behind to your left']);
        const forward = cands.filter(p => !BEHIND.has(p.direction));
        if (forward.length > 0 && forward.length < cands.length) {
          trackDiag('pipeline', 'behind-filter', `selection excluded ${cands.length - forward.length} behind-heading candidate(s)`);
          return pickStorySubject(forward, this.recentPrimaryTags(), opts);
        }
      }
      return pickStorySubject(cands, this.recentPrimaryTags(), opts);
    };

    const unheard = factPack.places.filter(p => !heardStories.hasHeardSubject(p.name) && !blocked(p));
    if (unheard.length > 0) {
      return pickWithBearing(unheard);
    }

    if (!allowRevisit) {
      // Tier-1 revisit pool (pre-publish stack Item 1, Oct 27, 2026):
      // Erik's ruling — a Tier-1 landmark is told almost every time it
      // is encountered, as long as the angle is not re-used. Moving
      // used to fall straight through to an area story once every
      // nearby landmark had been told; a Tier-1 whose angles are not
      // all spent now re-enters here, behind every never-heard place
      // (the unheard pool above always wins) and ahead of the area
      // fall-through. blocked() still applies in full — pending and
      // in-flight subjects stay refused, so a Tier-1 can never be
      // dealt twice while one telling awaits its settle — and the
      // freshness test is the same one the hearing funnel's lock
      // decision uses, so pool and lock cannot disagree.
      // Disparateness gate (Erik's refinement, Oct 28, 2026): the
      // pool is now ALSO the retell gate's door. A Tier-1 re-enters
      // only when canRetellTier1 holds — exactly one delivered
      // telling this tour, none in flight, the gate not already
      // declined — so a place can be retold at most once per tour,
      // and the generation that follows carries the first telling's
      // facts as binding exclusions (buildStoryPrompt's gate block)
      // with a decline outcome that spends the slot without a story.
      const tier1Revisit = factPack.places.filter(p =>
        placesService.isTier1Landmark(p) &&
        heardStories.hasHeardSubject(p.name) &&
        !blocked(p, true) &&
        storyCoverage.canRetellTier1(landmarkSubjectKey(p.name)) &&
        storyCoverage.hasFreshAngle(landmarkSubjectKey(p.name), LANDMARK_ANGLES, [LANDMARK_ANGLES[0]])
      );
      if (tier1Revisit.length > 0) {
        return pickWithBearing(tier1Revisit, { ignoreHeardPenalty: true });
      }
      // Moving with every nearby landmark told (and no Tier-1 angle
      // left to spend): fall through to an area story rather than
      // retelling a landmark at a new angle. The revisited pool below
      // is dwell-only.
      return null;
    }

    const revisited = factPack.places.filter(p => {
      const key = landmarkSubjectKey(p.name);
      // Told-subject ledger at dwell (Oct 28, 2026): parked depth
      // rotation is exempt from the lock/pending/cap bypass above,
      // but not from the ledger's hard facts — a subject with a
      // telling still unsettled in the player is never re-dealt,
      // and a Tier-1 already told on this tour re-enters only
      // through the same one-retell gate as the moving pool.
      if (storyCoverage.hasUnsettledTelling(key)) return false;
      if (
        storyCoverage.isTier1Subject(key) &&
        storyCoverage.deliveredTellingCount(key) >= 1 &&
        !storyCoverage.canRetellTier1(key)
      ) {
        return false;
      }
      return (
        storyCoverage.hasFreshAngle(key, LANDMARK_ANGLES, [LANDMARK_ANGLES[0]]) &&
        // The minor rule binds at dwell too (Item 1): parked rotation
        // may revisit Tier-1 and major places at fresh angles, but a
        // minor place heard on this tour is done for the tour.
        !storyCoverage.isMinorRetellBlocked(key)
      );
    });
    if (revisited.length > 0) {
      return pickStorySubject(revisited, this.recentPrimaryTags(), { ignoreHeardPenalty: true });
    }

    return null;
  }

  // Display topics are "<Name> — <angle label>" for rotated tellings; the
  // landmark's identity is the part before the separator.
  private topicBaseName(topic: string): string {
    return topic.split(' — ')[0].trim();
  }

  // True when a cached story must not be served while moving: its
  // landmark is locked out for this session, or it is a minor subject
  // that has hit the daily telling cap. Dwell bypasses both — parked
  // rotation serves are wanted. (Tier-1 exemption rides the majors
  // registry inside isDailyCapped; the library exemption is checked
  // here, where the place name is at hand.)
  // The minor retell rule (pre-publish stack Item 1) is checked
  // BEFORE the dwell bypass on purpose: it is a per-tour place rule,
  // not a movement rule — a minor place heard on this tour does not
  // serve another angle from a shelf even while parked.
  // Assemble the retell gate for a live generation, or null when
  // this generation is not a gated retell: the subject must be a
  // Tier-1 place with exactly one delivered telling this tour and
  // the gate still open (canRetellTier1), and the first telling's
  // text must be on record to serve as the exclusion list. (A
  // subject whose first "telling" never reached the listener has
  // no exclusions to carry — canRetellTier1 already excludes it,
  // since it counts delivered tellings only.)
  private retellGateFor(subjectKey: string, subjectName: string, angle: string | null): RetellGate | null {
    if (!storyCoverage.canRetellTier1(subjectKey)) return null;
    const firstText = storyCoverage.firstDeliveredTellingText(subjectKey);
    if (!firstText) return null;
    return { subjectKey, subjectName, angle, firstText };
  }

  private static isDeclineText(text: string): boolean {
    return DECLINE_TEXT_RE.test(text.trim());
  }

  private isTopicLockedForSession(topic: string, dwell: boolean): boolean {
    const base = this.topicBaseName(topic);
    const key = landmarkSubjectKey(base);
    if (storyCoverage.isMinorRetellBlocked(key)) return true;
    // Told-subject ledger (Oct 28, 2026): checked BEFORE the dwell
    // bypass on purpose, like the minor rule — a subject with a
    // telling still unsettled in the player, a declined retell, or
    // a spent Tier-1 retell slot does not serve another angle from
    // a shelf even while parked. A Tier-1 with one delivered
    // telling may still serve here at a genuinely different angle:
    // that serve IS its one retell (see storyCoverage).
    if (storyCoverage.isServeRefusedByToldLedger(key, angleFromTopic(topic))) return true;
    if (dwell) return false;
    if (storyCoverage.isSubjectLockedForSession(key)) return true;
    // In-flight counts as locked for SERVING (fix stack RC-2): a
    // story about this subject is already in the player awaiting its
    // settle, so dealing its next angle from a cache branch now would
    // queue two tellings of one place back to back. The lock itself
    // lands only when the in-flight story is heard.
    if (storyCoverage.isSubjectInFlight(key)) return true;
    if (storyCoverage.isDailyCapped(key) && !storyLibrary.hasPlace(base)) return true;
    return false;
  }

  private chooseAreaStory(position: Position, factPack: StoryFactPack): { rotation: StoryRotation; areaName: string } {
    const subjectKey = areaSubjectKey(position.lat, position.lng);
    const angle =
      storyCoverage.nextAngle(subjectKey, AREA_ANGLES) ??
      storyCoverage.leastRecentlyUsedAngle(subjectKey, AREA_ANGLES);

    return {
      rotation: { subjectKey, angle },
      areaName:
        factPack.areaInfo.neighborhood || describeArea(position.lat, position.lng),
    };
  }

  private chooseTarget(position: Position, factPack: StoryFactPack, context?: string): StoryTarget {
    // Broad-to-narrow: the first story in a new neighborhood should be an
    // area overview, not a landmark deep-dive. After that, narrow to landmarks.
    // 'welcome_back' belongs on this list: it is an intro serve whose
    // coverage history flipped the flavor (see getTourNarration), and its
    // own prompt instruction demands an AREA story — "tell them something
    // they probably do NOT know about this area yet... a fresh angle or a
    // deeper cut". Omitting it let the flip retarget the reserved opener
    // serve to the top landmark: the Oct 26, 2026 stationary field test
    // opened in La Jolla Colony (an area with permanent angle coverage)
    // and serve #2 came back as the dog park — the neighborhood welcome
    // never existed, under a first_serve audit that still read 'welcome'.
    // The flip may flavor the prompt; it must never retarget the serve.
    const isFirstInNeighborhood = context === 'neighborhood_intro' || context === 'initial' || context === 'welcome_back';

    // Angle rotation on an already-told landmark is a dwell feature: the
    // stationary contexts are the AREA_ANGLES strings themselves. In every
    // moving context the session lockout applies instead.
    const allowRevisit = !!context && context.startsWith('stationary_');
    const subject = isFirstInNeighborhood ? null : this.resolveSubject(factPack, allowRevisit, position);

    if (subject) {
      const subjectKey = landmarkSubjectKey(subject.name);
      const angle = storyCoverage.nextAngle(
        subjectKey,
        LANDMARK_ANGLES,
        heardStories.hasHeardSubject(subject.name) ? [LANDMARK_ANGLES[0]] : []
      );

      const isRotation = isRotationAngle(angle);
      const subjectPlace = factPack.places.find(p => p.name === subject.name);
      const significance =
        (subjectPlace !== undefined && placesService.isTier1Landmark(subjectPlace)) ||
        storyCoverage.isMajorSubject(subjectKey)
          ? ('major-landmark' as const)
          : undefined;

      return {
        kind: 'landmark',
        subject,
        rotation: isRotation && angle ? { subjectKey, angle } : null,
        areaName: '',
        displayTopic: isRotation && angle ? `${subject.name} — ${describeAngle(angle)}` : subject.name,
        angle,
        significance,
      };
    }

    const { rotation, areaName } = this.chooseAreaStory(position, factPack);
    return {
      kind: 'area',
      subject: null,
      rotation,
      areaName,
      displayTopic: `${areaName} — ${describeAngle(rotation.angle)}`,
      angle: rotation.angle,
      significance: factPack.areaInfo.majorArea ? ('major-area' as const) : undefined,
    };
  }

  private recentPrimaryTags(): string[] {
    return locationTracker
      .getAllToldStories()
      .slice(-4)
      .map(topic => deriveTags({ topic }).find(isInterestTag) ?? '')
      .filter(tag => tag.length > 0);
  }

  private buildTasteBlock(): string {
    const { liked, disliked } = tasteProfile.getSummary();
    if (liked.length === 0 && disliked.length === 0) return '';

    const lines = [
      'WHAT THIS LISTENER HAS RATED BEFORE (from their own thumbs up/down):',
      liked.length > 0 ? `They enjoy: ${liked.join(', ')}.` : '',
      disliked.length > 0 ? `They do not enjoy: ${disliked.join(', ')}.` : '',
      'Lean toward what they enjoy when the facts support it, and steer away from what they do not.',
      'Never mention these preferences out loud — this is guidance, not a topic to announce.',
    ];

    return lines.filter(line => line.length > 0).join('\n');
  }

  private buildFactPackBlock(position: Position, factPack: StoryFactPack): string {
    const { places, areaInfo, mode, isRural } = factPack;
    const areaLabel =
      [areaInfo.neighborhood, areaInfo.city].filter(Boolean).join(', ') ||
      `${position.lat.toFixed(4)}, ${position.lng.toFixed(4)}`;
    const accuracyInfo = position.accuracy > 0 ? `GPS accuracy: ±${Math.round(position.accuracy)}m` : '';

    const lines: string[] = [];
    lines.push(`MODE: ${mode}`);
    lines.push(`Coordinates: ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`);
    if (position.heading !== null && !isNaN(position.heading)) {
      lines.push(`Heading: ${Math.round(position.heading)}°`);
    }
    if (position.speed !== null) {
      lines.push(`Speed: ${Math.round(position.speed * 2.237)} mph`);
    }
    lines.push(`Area: ${areaLabel}`);
    if (areaInfo.street) lines.push(`Street: ${areaInfo.street}`);
    if (areaInfo.district) lines.push(`State/region: ${areaInfo.district}`);
    if (accuracyInfo) lines.push(accuracyInfo);

    if (isRural || places.length === 0) {
      lines.push('LANDMARKS: none found nearby.');
    } else {
      const closest = places.filter(p => p.distance <= 25);
      const inView = places.filter(p => p.distance > 25 && p.distance <= 50);
      const area = places.filter(p => p.distance > 50);
      lines.push('LANDMARKS (nearest first):');
      if (closest.length) lines.push(`Right around the listener: ${placesService.formatPlacesForPrompt(closest)}`);
      if (inView.length) lines.push(`In view: ${placesService.formatPlacesForPrompt(inView)}`);
      if (area.length) lines.push(`In this area: ${placesService.formatPlacesForPrompt(area)}`);
    }

    return lines.join('\n');
  }

  // Length hint (Pass 2, Oct 27, 2026): the persona's length doctrine
  // says scale to the road, but the prompt carried nothing about THIS
  // road — the model got the mode band and had to guess the density.
  // The fact pack already knows: how many other subjects it holds and
  // how far the next one sits (distances are from the discovery
  // position the pack was gathered around, so on a moving tour this is
  // the anticipated road, not the rear-view mirror). Sparse ahead →
  // lean to the long end of the band; subjects packed close → lean
  // short, so a longer story never eats the next landmark's turn. A
  // hint, not a word count. Significance and deep-listening govern
  // themselves and suppress it — their instructions are stronger and
  // already length-aware.
  private buildLengthHint(factPack: StoryFactPack, target: StoryTarget): string {
    const mode = factPack.mode;
    if (mode !== 'driving' && mode !== 'highway' && mode !== 'rural') return '';
    if (target.significance) return '';
    if (locationTracker.getDwellDepthLevel() !== null) return '';

    const others = factPack.places.filter(p => p.name !== target.subject?.name);
    const nextDist = others.length > 0 ? Math.min(...others.map(p => p.distance)) : null;
    const freewayScale = mode === 'highway' || mode === 'rural';
    const denseDist = freewayScale ? 600 : 300;
    const sparseDist = freewayScale ? 1800 : 900;
    const band = freewayScale ? '12-18 sentences' : '8-12 sentences';

    if (others.length >= 3 || (nextDist !== null && nextDist <= denseDist)) {
      return (
        'LENGTH HINT — SUBJECTS ARE PACKED CLOSE HERE: several story-worthy places sit ' +
        'within a short stretch of this road. Lean to the SHORTER end of the MODE band ' +
        `for this one (${band}) — a tight, complete telling, so the next place gets its turn.`
      );
    }
    if (others.length <= 1 || (nextDist !== null && nextDist >= sparseDist)) {
      return (
        'LENGTH HINT — THE ROAD AHEAD IS SPARSE: little else competes for the next ' +
        `stretch. Lean to the LONG end of the MODE band for this one (${band}) — take ` +
        'the room, build the scene, let the story breathe. (The honesty rule still ' +
        'governs: a thin fact pack makes a shorter story, never a more inventive one.)'
      );
    }
    return '';
  }

  // The story's length band, resolved in one place (extracted from
  // buildStoryPrompt, pre-publish stack Item 5, Oct 27, 2026).
  //
  // BASE RESOLUTION (fix stack D5) — the precedence, stated once and
  // applied by construction. The band starts as the mode band and
  // every applicable floor combines by element-wise MAX, NEVER a
  // replacement:
  //   mode band        walking 3–5 · driving 8–12 · highway 12–18
  //                    (rural rides the highway band)
  //   significance     10–14 (major landmark or major area)
  //   intro            10–12 (tour opener / neighborhood intro /
  //                    welcome-back — a FLOOR-raising exemption)
  //   deep listening   10–16 (dwell)
  // (Pass 2's significance text REPLACED the mode band, so a highway
  // major came out at 10–14 — shorter than an ordinary highway
  // story's 12–18. Under MAX, a highway major runs 12–18, a driving
  // major 10–14.)
  //
  // LATENCY LIFT (Item 5, Erik approved Oct 27, 2026): afterwards,
  // and only afterwards, the FLOOR rises with the measured pipeline
  // latency (latencyModel's rolling fetch+synth medians — the same
  // measurements that drive the discovery horizon). When generation
  // is slow, the story being written must run longer, because its
  // speaking time is the runway in which the NEXT story gets made;
  // when the pipeline is fast, the band sits at its ruled values.
  // Floor only: the lift never exceeds the band's own width, so the
  // floor may rise toward but never past the band's natural max —
  // the model is always asked for a length inside the ruled band,
  // just at its long end when latency demands. Field calibration:
  // the degraded Oct 26-27 pipeline (~33s median round trip) earns
  // +3 sentences; a ~60s pipeline saturates the band.
  private resolveLengthBand(
    factPack: StoryFactPack,
    target: StoryTarget,
    context: string
  ): { lengthLo: number; lengthHi: number; latencyLift: number } {
    const MODE_BANDS: Record<string, readonly [number, number]> = {
      walking: [3, 5],
      driving: [8, 12],
      highway: [12, 18],
      rural: [12, 18],
    };
    const modeBand = MODE_BANDS[factPack.mode] ?? [8, 12];
    let lengthLo = modeBand[0];
    let lengthHi = modeBand[1];
    const isIntroContext =
      context === 'initial' || context === 'neighborhood_intro' || context === 'welcome_back';
    if (isIntroContext) {
      lengthLo = Math.max(lengthLo, 10);
      lengthHi = Math.max(lengthHi, 12);
    }
    if (target.significance) {
      lengthLo = Math.max(lengthLo, 10);
      lengthHi = Math.max(lengthHi, 14);
    }
    if (locationTracker.getDwellDepthLevel() !== null) {
      lengthLo = Math.max(lengthLo, 10);
      lengthHi = Math.max(lengthHi, 16);
    }
    const med = latencyModel.medians();
    const pipelineS = med.fetchTextS + med.synthS;
    let latencyLift = 0;
    if (pipelineS > LATENCY_BASELINE_S) {
      latencyLift = Math.min(
        Math.ceil((pipelineS - LATENCY_BASELINE_S) / SENTENCE_RUNWAY_S),
        lengthHi - lengthLo
      );
    }
    lengthLo += latencyLift;
    return { lengthLo, lengthHi, latencyLift };
  }

  private buildStoryPrompt(
    position: Position,
    factPack: StoryFactPack,
    target: StoryTarget,
    context: string,
    depthLevel: number,
    depthCycle: number,
    destination: string | undefined,
    retellGate: RetellGate | null = null
  ): string {
    const lastTopic = locationTracker.getLastStoryTopic();
    const lastStoryText = locationTracker.getLastStoryText();
    const hasLastTopic = !!lastTopic && lastTopic.length > 0;
    const recentStoryTexts = locationTracker.getRecentStoryTexts();
    const allToldStories = locationTracker.getAllToldStories();
    const weaveCallback = locationTracker.shouldWeaveCallback();
    const storiesToldCount = locationTracker.getStoriesToldCount();

    // Drive arc (Pass 2): note where this story is being told, so the
    // arc block below can place the NEXT one. Prompt assembly is the
    // one moment every generated story passes through with its
    // neighborhood resolved; cache/library serves are counted by the
    // arc from the tracker's told record instead.
    driveArc.noteNeighborhood(factPack.areaInfo.neighborhood);

    const parts: string[] = [];

    parts.push(this.buildFactPackBlock(position, factPack));
    if (factPack.wikiContext) parts.push(factPack.wikiContext);
    if (factPack.osmContext) parts.push(factPack.osmContext);
    if (factPack.wikidataContext) parts.push(factPack.wikidataContext);
    if (factPack.registryContext) parts.push(factPack.registryContext);
    if (destination) parts.push(`Destination: ${destination}`);

    if (target.kind === 'landmark' && target.subject) {
      parts.push(
        `TELL THE STORY OF: "${target.subject.name}" (${target.subject.direction}). ` +
          'This is the most story-worthy thing here — build the story around it.'
      );

      if (target.rotation) {
        const angleName = describeAngle(target.rotation.angle);
        const covered = storyCoverage
          .getToldAngles(target.rotation.subjectKey)
          .filter(told => told !== target.rotation!.angle);

        parts.push(
          `THIS LISTENER HAS HEARD A STORY ABOUT THIS LANDMARK BEFORE. ` +
            `You are coming back to it for a different angle: ${angleName}. ` +
            'Do not retell what they already know. Open as if they already know the place — ' +
            'no re-introduction of what it is — and go straight into the new material. ' +
            'It should stand on its own for anyone listening, but it must not be the earlier story reworded.'
        );
        if (covered.length > 0) {
          parts.push(`ANGLES ALREADY COVERED ON IT (do not repeat): ${covered.map(describeAngle).join(', ')}.`);
        }
      }

      if (retellGate) {
        // The disparateness gate (Erik's rule, Oct 28, 2026): a
        // retell is permitted ONLY as a genuinely different story —
        // "not just a different tint of the same story." The first
        // telling's full text is the exclusion list: every fact in
        // it is spent. The decline outcome is a first-class success
        // of judgment: when the fact pack cannot fill the new angle
        // without reusing spent facts, the model returns the
        // sentinel and the caller records the subject as
        // mention-only for the rest of the tour — no tinted repeat
        // is dealt in its place.
        parts.push(
          `RETELL GATE (BINDING): this is the ONE second telling of "${retellGate.subjectName}" permitted on this tour` +
            (retellGate.angle ? `, on the new angle "${describeAngle(retellGate.angle)}"` : '') +
            `. It is permitted only as a genuinely different story. The first telling is quoted below — EVERY fact in it is spent. ` +
            'Do not reuse, recap, paraphrase, or re-introduce any of it, and do not re-explain what the place is. ' +
            'Write only from fact-pack material that does not appear in the spent telling. ' +
            'If the fact pack cannot fill a complete story on the new angle without reusing spent facts, do not write a story at all: ' +
            'reply with the single word DECLINE and nothing else — no story, no apology, no explanation. ' +
            'A declined retell is good judgment, not a failure.'
        );
        parts.push(
          `FIRST TELLING OF "${retellGate.subjectName}" (spent — none of its facts may be reused):\n"${retellGate.firstText}"`
        );
      }
    } else {
      const areaKey = target.rotation?.subjectKey ?? areaSubjectKey(position.lat, position.lng);
      const angle = target.rotation?.angle ?? AREA_ANGLES[0];
      const covered = storyCoverage.getToldAngles(areaKey).filter(told => told !== angle);
      const angleName = describeAngle(angle);

      parts.push(
        'AREA STORY — there is no landmark here worth a story, so this one is about the place itself.\n' +
          `THE SUBJECT IS: ${target.areaName}, and specifically ${angleName}.`
      );

      if (factPack.places.length > 0) {
        parts.push(
          'Do NOT tell the story of any landmark nearby — every one of them has already been covered or is not worth a story.'
        );
      }

      parts.push(
        covered.length > 0
          ? `ANGLES ALREADY COVERED ON THIS AREA (do not repeat these): ${covered.map(describeAngle).join(', ')}.`
          : 'This is your first story about this area.'
      );

      parts.push(
        `Cover ${angleName} properly — it is the whole subject of this story, not a passing mention. ` +
          'Go deeper than a visitor would get from a signpost. ' +
          'If you have touched on this angle before, find genuinely different facts, not a rephrasing.'
      );
    }

    const heardNearby = factPack.places
      .filter(p => heardStories.hasHeardSubject(p.name))
      .map(p => p.name)
      .filter(name => name !== target.subject?.name);
    if (heardNearby.length > 0) {
      parts.push(`THIS LISTENER HAS ALREADY HEARD STORIES ABOUT (never retell these): ${heardNearby.join(', ')}`);
    }

    parts.push(
      hasLastTopic
        ? `YOUR LAST STORY WAS ABOUT: "${lastTopic}". Tell a fresh story about what is here now. Write your own transition — one sentence that bridges, contrasts, or pivots from that topic to this one. Conversational flow, not a feedback loop.`
        : 'This is the first story of the tour.'
    );

    const contextDirective = MOVEMENT_CONTEXTS[context] ?? STATIONARY_CONTEXTS[context];
    if (contextDirective) parts.push(`THIS STORY: ${contextDirective}`);

    if (target.kind === 'landmark' && !target.rotation && context.startsWith('stationary')) {
      const depthLabel = [
        'landmarks', 'neighborhood', 'region', 'people', 'culture', 'street names & grid',
        'architecture', 'natural features', 'transportation', 'demographics', 'geology & terrain', 'folklore & myths',
        'economy', 'food', 'conflict & scandal', 'names & origins',
      ][depthLevel] ?? 'local culture';
      parts.push(
        `DEPTH: ${depthLabel}${depthCycle > 0 ? ` (round ${depthCycle + 1} — find a fresh angle, don't repeat round 1)` : ''}`
      );
    }

    if (hasLastTopic && lastStoryText) {
      parts.push(`PREVIOUS STORY (for a one-line callback only, never the subject):\n"${lastStoryText.slice(0, MAX_PREVIOUS_STORY_CHARS)}"`);
    }

    if (recentStoryTexts.length > 0) {
      parts.push(
        `STORIES ALREADY TOLD THIS TOUR (context only — do NOT retell):\n${recentStoryTexts
          .map((s, i) => `${i + 1}. "${s.slice(0, MAX_RECENT_STORY_CHARS)}"`)
          .join('\n')}`
      );
    }

    if (allToldStories.length > 0) {
      const revisiting = target.subject?.name.toLowerCase();
      const recentTopics = allToldStories
        .filter(topic => !revisiting || !topic.startsWith(revisiting))
        .slice(-MAX_TOLD_TOPICS_IN_PROMPT);
      if (recentTopics.length > 0) {
        parts.push(`TOPICS ALREADY COVERED (do not repeat): ${recentTopics.join(', ')}`);
      }
    }

    // Tour thread (Oct 28, 2026): the telling ledger's delivered
    // digest — subject, topic tags, and (for live generations) the
    // captured lead of each story this listener has actually HEARD
    // this tour — as continuity material for callbacks and contrast.
    // Compact by construction (~40 tokens a telling, hard-capped):
    // no story texts ride here. The prohibitions above stand
    // untouched alongside it, and the block is absent entirely until
    // the first telling is delivered, so a tour's first-story prompt
    // is byte-identical to the pre-thread prompt.
    const threadBlock = storyCoverage.tourThreadBlock();
    if (threadBlock) parts.push(threadBlock);

    if (weaveCallback && recentStoryTexts.length >= 2) {
      parts.push(
        `CALLBACK INVITATION: You have told ${storiesToldCount} stories this tour. If a genuine thread connects two or more of them, surface it in one line woven into this story. If none exists, skip it.`
      );
    }

    // Drive arc (Pass 2): the session's shape — route, subjects,
    // angles, themes — with the connect-when-natural instruction.
    // Empty until the tour has a past; the block itself caps the
    // connective tissue at a sentence or two.
    const arcBlock = driveArc.buildPromptBlock();
    if (arcBlock) parts.push(arcBlock);

    const tasteBlock = this.buildTasteBlock();
    if (tasteBlock) parts.push(tasteBlock);

    if (factPack.mode === 'rural') {
      parts.push('MODE IS RURAL: no landmarks, no neighborhood, open country. Follow RURAL MODE.');
    }

    const seasonalHint = seasonal.getPromptHint();
    if (seasonalHint) parts.push(seasonalHint);

    // The length band resolves BEFORE the hint (pre-publish stack
    // Item 5): the latency lift is part of the band, and the hint
    // must know whether it applies. The resolution itself — mode
    // band, D5 MAX combination, latency lift — lives in
    // resolveLengthBand.
    const { lengthLo, lengthHi, latencyLift } = this.resolveLengthBand(factPack, target, context);

    // Length hint (Pass 2): where this road sits inside the mode band —
    // computed from the fact pack's own density, suppressed when
    // significance or deep listening set the length themselves (below).
    // Item 5 adds one more suppression: under a latency lift the
    // hint's within-band lean (it argues for the short or long end of
    // the NATURAL band) could contradict the raised floor, so the
    // floor speaks alone.
    const lengthHint = this.buildLengthHint(factPack, target);
    if (lengthHint && latencyLift === 0) parts.push(lengthHint);

    // Significance length (Area E, Oct 26, 2026): story length
    // follows SIGNIFICANCE as well as speed and density. The v13
    // density doctrine thins stories where places are thick on the
    // ground — right for ordinary stops, wrong for the places a drive
    // is ABOUT: on the Oct 26 drive, Mission Bay, San Diego Bay and
    // Liberty Station all got ordinary-density tellings. A major now
    // takes its long band regardless of density. Interaction with the
    // missed-landmark rule: NONE — that rule governs whether a
    // landmark is told at all and always wins; significance only sets
    // how long a told major runs. The band printed below already
    // carries the D5 MAX combination AND the Item 5 latency lift.
    if (target.significance === 'major-landmark') {
      parts.push(
        'SIGNIFICANCE — MAJOR LANDMARK: this place is one of the defining landmarks of its area. ' +
          'Tell its story LONG regardless of speed, or how many other places are nearby: ' +
          `${lengthLo} to ${lengthHi} sentences — the full arc. What it is, how it came to be, the people and the ` +
          'conflict inside it, and why it still matters. That band already includes the mode band ' +
          '(combined by MAX, never replaced), so never keep it brief because the area is dense.'
      );
    } else if (target.significance === 'major-area') {
      parts.push(
        'SIGNIFICANCE — MAJOR AREA: this district is one of the defining places of the city, ' +
          `not an ordinary neighborhood stop. Tell its story LONG: ${lengthLo} to ${lengthHi} sentences — what ` +
          'this place is, how it came to be, the era that shaped it, and what it means now. ' +
          'That band already includes the mode band (combined by MAX, never replaced), so never ' +
          'keep it brief because the area is dense.'
      );
    }

    // Latency floor, spoken (Item 5): for targets WITHOUT a
    // significance block — the blocks above already print the lifted
    // band — the raised minimum needs its own sentence, or nothing in
    // the prompt tells the model the floor moved. (The persona's mode
    // bands state the natural ranges; this block is the measured
    // exception for THIS story, and it only ever raises the minimum.)
    if (latencyLift > 0 && !target.significance) {
      parts.push(
        `LENGTH FLOOR — SLOW PIPELINE: story production is running slow right now, so this ` +
          `telling must run at least ${lengthLo} sentences (up to ${lengthHi}). The extra length is ` +
          'runway: while this story plays, the next one is being made. Stay on THIS subject and ' +
          'go deeper — the scene, the people, the detail — never pad, never invent. The honesty ' +
          'rule still governs: depth from the facts at hand, not from imagination.'
      );
    }

    const dwellLevel = locationTracker.getDwellDepthLevel();
    if (dwellLevel !== null) {
      const dwellMinutes = locationTracker.getDwellMinutes();
      parts.push(
        `DEEP LISTENING MODE: the listener has been in this exact spot for ${dwellMinutes} minutes. ` +
          'They have stopped and stayed — that means they WANT the deep version, not the nugget. ' +
          'Go long — 10 to 16 sentences. This is the podcast episode, not the quick hit. ' +
          'Set the scene richly. Introduce the people with names and motivations. ' +
          'Build the tension slowly. Deliver the twist with real dramatic weight. ' +
          'Land it with a line that lingers. Dig into the detail you would normally leave out — ' +
          'the side characters, the what-happened-next, the irony, the human cost.\n' +
          'WIKIPEDIA IS YOUR PRIMARY SOURCE for deep mode. The Wikipedia context has been expanded ' +
          'with more articles and longer extracts for this story. Use specific facts — names, dates, ' +
          'causes, outcomes — not just vibes. Build the narrative around the richest article. ' +
          'The details are why they stayed.'
      );
    }

    // Position-binding rule (pre-publish stack Item 7, Oct 27,
    // 2026; Erik's rule, so a story told one queue slot late never
    // sounds out of order): a story's text is generated BEFORE it
    // is heard and may wait in line behind another story — any
    // phrase that binds the telling to the listener's position at
    // generation time can be false by the time it is spoken. The
    // ban is OUTRIGHT rather than freshness-gated: generation-time
    // freshness does not survive the queue (the wait is unbounded),
    // so no confidence condition the prompt could state would be
    // honest. Place-anchored language always survives. Folded into
    // the unpublished leo-v14 prompt behavior (Item 5's handling —
    // no version bump; the live build is still v13).
    parts.push(
      'POSITION-BINDING — LANGUAGE THAT NEVER EXPIRES: this story may be heard minutes after it is written, ' +
        'from further down the road. Nothing in it may depend on where the listener is at this moment. NEVER use ' +
        'expiring positional or temporal claims: "on your left", "on your right", "coming up", "just ahead of you", ' +
        '"you are about to pass", "the building you are passing now", "as you approach", "right here beside you", ' +
        'or anything that pins the story to a passing moment. Anchor to the PLACE instead: "here in Point Loma", ' +
        '"along this stretch of the bay", "in this neighborhood", "across the water in Coronado", or a compass point ' +
        '("on the bay side of the point"). You MAY — and should — describe what a place looks like: a true visual ' +
        'trait ("the white tower with the red roof") helps the listener spot it whenever they reach it. What ' +
        'expires is direction and approach, never description.'
    );

    // Portal rule (pre-publish stack Item 9, Oct 27, 2026 — the
    // PROMPT half of the v14 portal doctrine; Erik's ruling: a
    // microhistory is a portal, not a dead end. The SCORING half —
    // connection potential in candidate ranking — is deliberately
    // NOT in this stack: selection/scoring changes wait for the
    // post-retest stack, by the same ruling that scoped this item
    // to what does not move the pipeline under test). Applies to
    // minor landmark subjects only: a major landmark IS the bigger
    // story, and an area story already is the wider frame.
    // CONNECTION GROUNDING (Erik's refinement, Oct 27, 2026 —
    // supersedes his broader Oct 26 inference license): a
    // connection must be SOURCE-GROUNDED — basis in the fact pack,
    // in published local history/lore supplied with it, or in
    // sourced local opinion/discussion supplied with it (Reddit
    // and local media count as opinion sources, per the v14
    // Reddit ruling). A connection with no basis in any provided
    // source is prohibited; free invention is out, even for links.
    // "Use sources to assume — just don't completely make up.
    // Build trust." The honesty contract for hard facts is
    // unchanged. Folded into the unpublished leo-v14 prompt
    // behavior (no version bump).
    if (target.kind === 'landmark' && target.significance !== 'major-landmark') {
      parts.push(
        'PORTAL RULE — A SMALL SUBJECT OPENS ONTO A BIGGER STORY: this subject is a minor place, and its story ' +
          'must not end at its own walls. Connect it outward — to the neighborhood around it, to a major landmark ' +
          'nearby, to the larger history of this area or of this drive — and end the telling turned outward, ' +
          'toward that bigger story. The connection may be thematic: a shared era, a shared founder or benefactor, ' +
          'the same water, road, faith, industry, or argument running through both places. BUT the connection ' +
          'must be GROUNDED in the material provided: build it from the facts above, from published local ' +
          'history or lore included there, or from sourced local opinion and discussion included there — never ' +
          'from nothing. If you cannot ground a connection in the supplied sources, do not invent one: a ' +
          'smaller true connection beats a beautiful fabricated one, and a story with no honest outward link ' +
          'is better than a story with a made-up one. Every hard factual claim, about this subject and about ' +
          'the bigger story alike, still comes only from the facts provided. A church, a dog park, a restaurant, ' +
          'a small historic house — told as a portal, it makes the listener love the whole town more; told as a ' +
          'stopping point, it is a dead end.'
      );
    }

    return parts.join('\n\n');
  }

  async getTourNarration(
    position: Position,
    destination?: string,
    onChunk?: (text: string) => void,
    opts?: {
      requireWelcomeStory?: boolean;
      discoveryPosition?: Position;
      introContextReplay?: string | null;
      // Never-starve ladder (pre-publish stack Item 2): the app sets
      // this when the player queue is empty AND nothing is playing —
      // the one state where a tracker "not yet" may not end the
      // cycle, because nothing else will fill the silence. See the
      // forced-refill branch in the main path below.
      queueStarved?: boolean;
    }
  ): Promise<NarrationResult> {
    if (!this.ai) {
      return { ...EMPTY_NARRATION, text: "Hey, AI's still loading up. Give me just a second." };
    }

    // Fire the fact pack and a preliminary cache lookup in parallel. The
    // preliminary lookup searches for any story nearby without version-key or
    // angle filtering — if one exists that the listener hasn't heard, it can
    // be served immediately without waiting for the fact pack to complete.
    let factPack: StoryFactPack | null = null;
    let preliminaryCache: CachedStoryResult | null = null;

    const factPackPromise = this.gatherFactPack(position, opts?.discoveryPosition);
    // Pass the persona version as a partial version-key filter so old-persona
    // stories (with slang, meters, etc.) are never served from the preliminary
    // lookup. The full version key (with fact pack hash) is applied later.
    const partialVersionKey = `${LEO_PERSONA_VERSION}|`;
    const cachePromise = storyLookup.findNearbyStory(position.lat, position.lng, 100, partialVersionKey);

    // Wait for both in parallel. Don't short-circuit — we need the fact pack
    // for the fallback path even if the cache hits.
    [factPack, preliminaryCache] = await Promise.all([factPackPromise, cachePromise]);

    // Decide the context BEFORE any cache serve. The preliminary lookup
    // used to run first and could serve any unheard nearby story before
    // the tracker ever assigned a context — which is how a landmark
    // story could consume the first serve of a tour (and, mid-tour, the
    // serve on which a neighborhood intro was due). When this serve IS
    // an intro — the tour's first story, a neighborhood entry, a
    // welcome-back — no cache serve may substitute for it: the intro is
    // generated on the main path below, where skipCache already keeps
    // it personal. The caller can also demand the welcome explicitly
    // (the storyCache opener), which covers the first serve even if
    // tracker state was warmed by an earlier fetch.
    const landmarkNames = factPack.places.map(p => p.name);
    let decision = locationTracker.shouldTellNewStory(
      position,
      landmarkNames,
      factPack.areaInfo.neighborhood
    );
    // Opener replay (Pass 1, Oct 27, 2026): storyCache snapshots the
    // intro decision of the reserved opener serve. If that serve's
    // generation failed, this retry's fresh tracker call sees a
    // consumed decision and would deal a landmark as the tour's first
    // story — the exact Oct 27 commute failure. When the caller hands
    // back the snapshot and the fresh decision is not itself an intro,
    // replay the snapshot: this serve stays the welcome it was
    // reserved to be. (The tracker's own owed-intro re-offer covers
    // the mid-tour chapter-break case; this covers the opener, whose
    // tracker state may have been warmed by an earlier fetch.)
    if (
      opts?.requireWelcomeStory === true &&
      opts?.introContextReplay &&
      decision.context !== 'initial' &&
      decision.context !== 'neighborhood_intro'
    ) {
      const freshContext = decision.context;
      decision = {
        ...decision,
        shouldTell: true,
        context: opts.introContextReplay,
        isNeighborhoodIntro: opts.introContextReplay === 'neighborhood_intro',
      };
      console.log(`[Gemini] Replaying snapshotted intro context "${opts.introContextReplay}" over fresh decision "${freshContext}"`);
    }
    const introContext = decision.context === 'initial' || decision.context === 'neighborhood_intro';
    const cacheServeBlocked = introContext || opts?.requireWelcomeStory === true;

    // Majors are marked before any serve decision (Area C): the
    // preliminary serves below hold topics, not candidate objects, and
    // the major-subject mark is how a library serve of a Tier-1 place
    // claims its right-of-way. The library index primes here too, so
    // the tenant rule's anchors exist before the first serve decision.
    this.markTier1Majors(factPack);
    await storyLibrary.primePlaceIndex();

    // Tenant rule (Area C, Oct 26, 2026): a preliminary topic that is a
    // TENANT of an untold curated major must not serve — the whole
    // place goes first, via the redirect on the main path below. The
    // containment test uses the listener's position: a preliminary hit
    // is by construction within ~100m, well inside anchor tolerance.
    // A tenant that is itself a major is never suppressed.
    const prelimBase = preliminaryCache ? this.topicBaseName(preliminaryCache.topic) : null;
    const prelimAnchor = prelimBase
      ? storyLibrary.containingMajorAnchor(position.lat, position.lng, prelimBase)
      : null;
    const tenantBlocked =
      prelimAnchor !== null &&
      prelimBase !== null &&
      !storyCoverage.isMajorSubject(landmarkSubjectKey(prelimBase)) &&
      !storyCoverage.isSubjectLockedForSession(landmarkSubjectKey(prelimAnchor.name)) &&
      !heardStories.hasHeardSubject(prelimAnchor.name) &&
      // Told-subject ledger (Oct 28, 2026): if the whole place
      // already has a telling committed this tour — queued in the
      // player or delivered — the deferral's purpose is served:
      // the tenant's story queues behind it like any next story,
      // and suppressing the serve would only starve the cycle.
      !storyCoverage.hasUnsettledTelling(landmarkSubjectKey(prelimAnchor.name)) &&
      storyCoverage.deliveredTellingCount(landmarkSubjectKey(prelimAnchor.name)) === 0;

    // If the preliminary cache found an unheard story, serve it right away.
    // Session lockout applies too: a cached angle-variant of a landmark
    // already told this session is a retell, not a cache hit.
    if (
      !cacheServeBlocked &&
      !tenantBlocked &&
      preliminaryCache &&
      !heardStories.hasHeard(preliminaryCache.topic) &&
      !this.isTopicLockedForSession(preliminaryCache.topic, locationTracker.getDwellDepthLevel() !== null)
    ) {
      // LIBRARY FIRST (Erik's shelf order): if the library holds an
      // episode for the preliminary topic's place, the curated entry
      // displaces the ephemeral cache copy. Recording mirrors the cache
      // serve below exactly.
      //
      // Place-wide first (Pass 2, Oct 27, 2026): the exact-(place,
      // angle) displacement this block used to require starved the
      // shelf — selection rotates through all twelve landmark angles
      // while the corpus holds three per place, so the cache topic's
      // angle was rarely a shelved one. Now the place is the match:
      // any unheard, unlocked angle the library holds for it serves.
      // The exact-topic lookup remains as the fallback for when the
      // place index has not primed or the place walk finds nothing.
      let libHit =
        prelimBase && storyLibrary.hasPlace(prelimBase)
          ? await storyLibrary.lookupForPlace(
              prelimBase,
              (_angle, topic) =>
                !heardStories.hasHeard(topic) &&
                !this.isTopicLockedForSession(topic, locationTracker.getDwellDepthLevel() !== null)
            )
          : null;
      if (!libHit) {
        libHit = await storyLibrary.lookupForTopic(preliminaryCache.topic);
      }
      if (
        libHit &&
        !heardStories.hasHeard(libHit.topic) &&
        !this.isTopicLockedForSession(libHit.topic, locationTracker.getDwellDepthLevel() !== null)
      ) {
        console.log(`[Gemini] Library hit for "${libHit.topic}" — displacing ephemeral cache serve`);
        const versionKey = this.storyVersionKey(this.factPackHash(factPack));
        if (onChunk) onChunk(libHit.text);
        const libKey = landmarkSubjectKey(this.topicBaseName(libHit.topic));
        // Coverage at hearing (fix stack RC-2/D4): the serve marks
        // the subject in-flight only. The session lock and daily
        // count land when the story is HEARD (App's settle funnel →
        // storyCoverage.settleSubjectHeard), and major status is NOT
        // marked here — it comes from the place rules (Tier-1
        // evaluation, curated lists), never from the serve flavor.
        storyCoverage.markSubjectInFlight(libKey);
        await locationTracker.updateLastStoryTopic(
          libHit.topic, position, libHit.text, 'cache_hit', 0, versionKey
        );
        return { text: libHit.text, subject: libHit.topic, context: 'cache_hit', mode: factPack.mode, rotation: null, audioUrl: libHit.audioUrl, anchorLat: libHit.lat, anchorLng: libHit.lng, fromLibrary: true, major: storyCoverage.isMajorSubject(libKey) };
      }
      console.log(`[Gemini] Parallel cache hit for "${preliminaryCache.topic}" (${Math.round(preliminaryCache.distanceM)}m away)`);
      const versionKey = this.storyVersionKey(this.factPackHash(factPack));
      if (onChunk) onChunk(preliminaryCache.storyText);
      const prelimKey = landmarkSubjectKey(this.topicBaseName(preliminaryCache.topic));
      // Coverage at hearing (fix stack RC-2): in-flight only — the
      // lock and count land at the delivered settle (App funnel).
      storyCoverage.markSubjectInFlight(prelimKey);
      await locationTracker.updateLastStoryTopic(
        preliminaryCache.topic, position, preliminaryCache.storyText, 'cache_hit', 0, versionKey
      );
      return { text: preliminaryCache.storyText, subject: preliminaryCache.topic, context: 'cache_hit', mode: factPack.mode, rotation: null, major: storyCoverage.isMajorSubject(prelimKey) };
    }

    // Highway Corridor Library (pre-publish stack Item 6, Oct 27,
    // 2026): at freeway speed inside a banked segment, the corridor
    // story is the PRIMARY highway serve — it displaces the live
    // path entirely (the fix stack's region-anchored generation
    // below becomes the fallback for unbanked road, designed
    // silence the last resort). Placement is deliberate:
    //  - AFTER the preliminary/library serves: a warm banked POINT
    //    story (a Tier-1 episode already on the shelf) still wins —
    //    Erik's highway Tier-1 rule is "priority path when warm",
    //    and those serves are exactly the warm path.
    //  - BEFORE the decision gate and target selection: the
    //    corridor serve is banked material, and banked serves have
    //    never waited on the movement decision (the preliminary
    //    serves above are the precedent). It also answers Item 2's
    //    starved cycles on freeways instantly.
    //  - cacheServeBlocked keeps it out of the opener and owed
    //    intros: a corridor story is never a tour's first story and
    //    never substitutes for a neighborhood welcome.
    // Coverage is the hearing funnel's, via the in-flight mark here
    // and the settle in App: one telling per (segment, direction)
    // per tour, enforced by the tour-heard record (the settle takes
    // no session lock for corridor subjects — see storyCoverage).
    // Chaining is positional: when this story ends, the completion
    // cycle re-matches at the new position, and the NEXT segment's
    // story — untold this tour — is what matches.
    //
    // TRAFFIC HANDOFF (Erik's refinement, Oct 27, 2026): the
    // ≥15 m/s gate governs TRIGGERING and CHAINING, not continued
    // eligibility. A cycle that observes the driver inside a
    // segment at gate speed marks the segment triggered; from then
    // on, the segment's story remains serve-eligible while the
    // driver is inside it even if traffic collapses the speed — it
    // narrates where they still are. The NEXT segment still needs
    // its own at-speed observation to chain. A driver who ENTERS a
    // segment already in traffic never triggers it: the ordinary
    // driving machinery (live serves, the Item 2 ladder) covers
    // that traversal, which is the design — at traffic speeds
    // latency × speed is landable again. And when a corridor story
    // ends before its segment does (free-flow sizing in slow
    // traffic), the remainder is likewise the normal machinery's:
    // this branch simply stops matching a segment whose story is
    // tour-heard, and the cycles below proceed as usual.
    if (!cacheServeBlocked) {
      const corridorMatch = matchCorridor(position);
      if (corridorMatch) {
        const atGateSpeed = (position.speed ?? 0) >= 15;
        if (atGateSpeed) storyCoverage.markCorridorTriggered(corridorMatch.segment.id);
        const corridorEligible = atGateSpeed || storyCoverage.isCorridorTriggered(corridorMatch.segment.id);
        const corridorKey = landmarkSubjectKey(corridorMatch.segment.displayName);
        if (
          corridorEligible &&
          !storyCoverage.hasHeardThisTour(corridorKey) &&
          !storyCoverage.isSubjectInFlight(corridorKey)
        ) {
          const corridorHit = await storyLibrary.lookupCorridor(corridorMatch.segment.displayName);
          if (corridorHit) {
            console.log(`[Gemini] Corridor hit: "${corridorHit.topic}" (${corridorMatch.segment.id})`);
            const versionKey = this.storyVersionKey(this.factPackHash(factPack));
            if (onChunk) onChunk(corridorHit.text);
            storyCoverage.markSubjectInFlight(corridorKey);
            await locationTracker.updateLastStoryTopic(
              corridorHit.topic, position, corridorHit.text, 'cache_hit', 0, versionKey
            );
            trackDiag('pipeline', 'corridor-serve', `${corridorMatch.segment.id} matched ${Math.round(corridorMatch.distanceM)}m off its polyline`);
            return { text: corridorHit.text, subject: corridorHit.topic, context: 'corridor', mode: factPack.mode, rotation: null, audioUrl: corridorHit.audioUrl, anchorLat: corridorHit.lat, anchorLng: corridorHit.lng, corridorSegmentId: corridorMatch.segment.id, fromLibrary: true, major: true };
          }
        }
      }
    }

    const { shouldTell, context, depthLevel, depthCycle } = decision;

    console.log(
      '[Gemini] Story check - shouldTell:',
      shouldTell,
      'mode:',
      factPack.mode,
      'context:',
      context,
      'places:',
      factPack.places.length,
      'neighborhood:',
      factPack.areaInfo.neighborhood
    );

    // Never-starve refill (pre-publish stack Item 2, Oct 27, 2026):
    // Erik's doctrine — "something should always be trying to be
    // told, so Gemini text/TTS is the only holdup, never the
    // decider." When the app reports the player idle with an EMPTY
    // queue, pacing has nothing left to pace: the tracker's "not
    // yet" (today only ever a no_change decline while a story was
    // recently heard or playing — audit F-6) must not end the cycle.
    // The decision is forced to the movement rung and the cycle
    // proceeds to normal target selection (landmark → Tier-1 revisit
    // → area), which attempts a generation from the fact pack at
    // hand. requireWelcomeStory is exempt: the opener's cycle may
    // not deal a landmark as the tour's first story (the RC-7
    // shape), and opener pacing belongs to the welcome machinery.
    // The forced decision is a real decision: the result carries
    // decisionConsumed from the target outcome exactly as a
    // tracker-yes serve would, so a failed forced serve earns the
    // same refund consideration, no more, no less.
    let forcedRefill = false;
    if (!shouldTell) {
      if (opts?.queueStarved && !opts?.requireWelcomeStory) {
        forcedRefill = true;
        trackDiag('pipeline', 'starved-refill', `tracker declined (${context}); queue empty and player idle — forced to the movement rung`);
      } else {
        console.log('[Gemini] shouldTell=false — returning empty. context:', context);
        return { ...EMPTY_NARRATION, context, mode: factPack.mode, decisionConsumed: false, emptyReason: 'should-tell' };
      }
    }

    // Detect a return visit: if the area subject key already has told angles,
    // this is a welcome-back, not a first-time intro. NOTE: the coverage
    // record is permanent (not day-scoped), so in any area the listener has
    // ever toured this flip fires on every start — it is a PROMPT flavor
    // only. Targeting stays area-first for welcome_back (chooseTarget),
    // because the serve is still the tour's neighborhood welcome; letting
    // it narrow to a landmark was the Oct 26, 2026 missing-intro defect.
    let effectiveContext = context;
    // A forced refill runs as a movement story (Item 2): the MOVEMENT
    // prompt context is the honest one — the car IS moving; only the
    // tracker's pacing said wait.
    if (forcedRefill) effectiveContext = 'moved';
    if (context === 'neighborhood_intro') {
      const areaKey = areaSubjectKey(position.lat, position.lng);
      const hasPriorCoverage = storyCoverage.getToldAngles(areaKey).length > 0;
      if (hasPriorCoverage) {
        effectiveContext = 'welcome_back';
      }
    }

    // Neighborhood library (pre-publish stack Item 8, Oct 27,
    // 2026): banked welcome stories — one pre-rendered intro per
    // neighborhood (leo-v13 most-compelling-story format), shelved
    // like the place library. When this serve IS a first-visit
    // intro — context initial/neighborhood_intro, the welcome_back
    // flip above did NOT fire (prior coverage means the live
    // fresh-angle telling is the right serve), and no forced refill
    // has re-purposed the cycle — the bank is checked before any
    // live generation. A hit serves the banked intro with its
    // audio, carrying the SAME rotation identity a live area serve
    // carries (chooseAreaStory: the geo-keyed area subject + a real
    // rotation angle) and the live intro topic shape, so the
    // hearing funnel records it exactly as a live welcome — the
    // intro debt clears at hearing, the area gains its coverage,
    // and a return visit flips to a live welcome_back that never
    // re-serves the banked orientation. A miss (unbanked area)
    // falls through to live generation untouched. The opener gate
    // is unaffected: the serve still waits in the player for
    // greeting + opener order like every intro serve, and banked
    // audio makes it warm by definition under Item 7's insertion
    // rule (it may take a cold head; it never jumps a warm one).
    if (
      !forcedRefill &&
      (context === 'initial' || context === 'neighborhood_intro') &&
      effectiveContext !== 'welcome_back'
    ) {
      const { rotation: areaRotation, areaName } = this.chooseAreaStory(position, factPack);
      if (storyCoverage.getToldAngles(areaRotation.subjectKey).length === 0) {
        const bankHit = await storyLibrary.lookupNeighborhood(areaName);
        if (bankHit) {
          const bankTopic = `${areaName} — ${describeAngle(areaRotation.angle)}`;
          console.log(`[Gemini] Neighborhood bank hit: "${bankTopic}"`);
          const versionKey = this.storyVersionKey(this.factPackHash(factPack));
          if (onChunk) onChunk(bankHit.text);
          storyCoverage.markSubjectInFlight(areaRotation.subjectKey);
          await locationTracker.updateLastStoryTopic(
            bankTopic, position, bankHit.text, 'cache_hit', 0, versionKey
          );
          trackDiag('pipeline', 'neighborhood-bank-hit', areaName);
          return { text: bankHit.text, subject: bankTopic, context, mode: factPack.mode, rotation: areaRotation, audioUrl: bankHit.audioUrl, anchorLat: bankHit.lat, anchorLng: bankHit.lng, fromLibrary: true, major: false };
        }
      }
    }

    await storyLibrary.primePlaceIndex();
    const target = this.chooseTarget(position, factPack, effectiveContext);
    console.log(
      '[Gemini] Target:',
      target.kind,
      target.kind === 'landmark' ? target.subject?.name : `${target.displayTopic}`
    );

    const versionKey = this.storyVersionKey(this.factPackHash(factPack));

    // Neighborhood intros and welcome-backs are always fresh — they are
    // personal to this listener's first (or return) visit to this area, so a
    // shared cached story would give someone else's intro.
    const skipCache = effectiveContext === 'neighborhood_intro' || effectiveContext === 'welcome_back' || effectiveContext === 'initial';

    const subjectKey =
      target.kind === 'landmark' && target.subject
        ? landmarkSubjectKey(target.subject.name)
        : areaSubjectKey(position.lat, position.lng);
    const targetPlace =
      target.kind === 'landmark' && target.subject
        ? factPack.places.find(p => p.name === target.subject!.name)
        : undefined;

    // Tenant redirect (Area C, Oct 26, 2026): the chosen subject sits
    // inside a curated major place that has not been told this session —
    // serve the WHOLE PLACE's library story first (Liberty Station, not
    // its movie theater). The tenant stays eligible from the next cycle:
    // serving the place locks it, which lifts the redirect. Guards: a
    // subject that is itself Tier-1 or a marked major is never deferred,
    // and if the place has no untold library angle the tenant serves
    // as-is rather than not at all.
    if (
      target.kind === 'landmark' &&
      target.subject &&
      targetPlace?.lat !== undefined &&
      targetPlace?.lng !== undefined &&
      !placesService.isTier1Landmark(targetPlace) &&
      !storyCoverage.isMajorSubject(subjectKey)
    ) {
      const anchor = storyLibrary.containingMajorAnchor(targetPlace.lat, targetPlace.lng, target.subject.name);
      if (anchor) {
        const anchorKey = landmarkSubjectKey(anchor.name);
        if (
          !storyCoverage.isSubjectLockedForSession(anchorKey) &&
          !storyCoverage.isDailyCapped(anchorKey) &&
          !heardStories.hasHeardSubject(anchor.name) &&
          // Told-subject ledger (Oct 28, 2026) — the NASSCO hole.
          // The guard used to consult only the lock, the cap, and
          // the heard record, none of which see a telling that is
          // QUEUED but not yet heard: on Erik's Oct 28 drive the
          // redirect re-chose NASSCO on three consecutive cycles
          // (~45 s apart) while its first telling sat unplayed in
          // the queue, dealt two spare copies, and the spares were
          // mute-flushed at tour end. A committed telling counts
          // from the moment it is queued, so the redirect may fire
          // only when the anchor has no telling in flight and none
          // delivered this tour. (An anchor whose telling settled
          // UNDELIVERED may still be re-served through here — the
          // RC-2 release — but never while its queue window stands
          // open.)
          !storyCoverage.hasUnsettledTelling(anchorKey) &&
          storyCoverage.deliveredTellingCount(anchorKey) === 0
        ) {
          const anchorAngle = storyCoverage.nextAngle(
            anchorKey,
            LANDMARK_ANGLES,
            heardStories.hasHeardSubject(anchor.name) ? [LANDMARK_ANGLES[0]] : []
          );
          const anchorHit = anchorAngle ? await storyLibrary.lookup(anchor.name, anchorAngle) : null;
          if (anchorHit) {
            console.log(`[Gemini] Tenant redirect: "${target.subject.name}" deferred — whole place "${anchor.name}" serves first`);
            trackDiag('pipeline', 'tenant-redirect', `"${target.subject.name}" deferred to whole place "${anchor.name}"`);
            if (onChunk) onChunk(anchorHit.text);
            // Coverage at hearing (fix stack RC-2/D4): in-flight
            // only; the anchor's major status rides the result from
            // the curated-anchor place rule (major: true below), not
            // from a serve-time coverage mark.
            storyCoverage.markSubjectInFlight(anchorKey);
            await locationTracker.updateLastStoryTopic(
              anchorHit.topic, position, anchorHit.text, effectiveContext, depthLevel, versionKey
            );
            return {
              text: anchorHit.text,
              subject: anchorHit.topic,
              context: effectiveContext,
              mode: factPack.mode,
              rotation: null,
              audioUrl: anchorHit.audioUrl,
              anchorLat: anchorHit.lat,
              anchorLng: anchorHit.lng,
              fromLibrary: true,
              major: true,
            };
          }
        }
      }
    }

    const toldAngles = storyCoverage.getToldAngles(subjectKey);
    // LIBRARY FIRST (Erik's shelf order): for the exact (place, angle) just
    // chosen, a curated library entry beats both the ephemeral cache and a
    // live generation. Intros stay personal (skipCache), and area stories
    // have no library entries by construction. Coverage mirrors the cached
    // branch below (in-flight here, rotation null in the result; the
    // hearing record lands at the app's settle funnel).
    if (!skipCache && target.kind === 'landmark' && target.subject && target.angle) {
      // Place-wide first (Pass 2, Oct 27, 2026): the chosen angle is a
      // coverage decision across all twelve landmark angles; the shelf
      // holds three of them per place. Matching the place and taking
      // its first unheard shelved angle is what makes the library the
      // default serve for a seeded place — the exact-angle lookup
      // remains as fallback, and recording below names the SERVED
      // topic (libHit.topic), which for an exact hit is identical to
      // target.displayTopic.
      let libHit = storyLibrary.hasPlace(target.subject.name)
        ? await storyLibrary.lookupForPlace(
            target.subject.name,
            // Minor rule at the shelf (pre-publish stack Item 1): the
            // target itself was vetted by resolveSubject, but the
            // place-wide walk must not hand back a second angle of a
            // minor place already heard this tour — the walk, not the
            // target, is where Pass 2's displacement would re-deal it.
            // Told-subject ledger (Oct 28, 2026): the walk must ALSO
            // not hand back any angle while a telling of the place is
            // still unsettled in the player, nor a second copy of an
            // angle this tour already dealt, nor anything once a
            // Tier-1's one retell is spent or declined. A Tier-1 with
            // one delivered telling may serve here at a genuinely
            // different shelved angle — that serve IS its one retell.
            (_angle, topic) =>
              !heardStories.hasHeard(topic) &&
              !storyCoverage.isMinorRetellBlocked(landmarkSubjectKey(this.topicBaseName(topic))) &&
              !storyCoverage.isServeRefusedByToldLedger(landmarkSubjectKey(this.topicBaseName(topic)), _angle)
          )
        : null;
      if (!libHit) {
        libHit = await storyLibrary.lookup(target.subject.name, target.angle);
      }
      if (libHit && storyCoverage.isServeRefusedByToldLedger(subjectKey, libHit.angle)) {
        // The exact-angle fallback bypasses the walk's filters: the
        // same ledger verdict applies to its result.
        console.log(`[Gemini] Library hit for "${libHit.topic}" refused — subject already told this tour (told-subject ledger)`);
        libHit = null;
      }
      if (libHit) {
        console.log(`[Gemini] Library hit: "${libHit.topic}" (${libHit.angle})`);
        if (onChunk) onChunk(libHit.text);
        // Coverage at hearing (fix stack RC-2/D4): in-flight only —
        // no lock, no count, and no major mark from a serve.
        storyCoverage.markSubjectInFlight(subjectKey);
        await locationTracker.updateLastStoryTopic(
          libHit.topic, position, libHit.text, effectiveContext, depthLevel, versionKey
        );
        return {
          text: libHit.text,
          subject: libHit.topic,
          context: effectiveContext,
          mode: factPack.mode,
          rotation: null,
          audioUrl: libHit.audioUrl,
          anchorLat: libHit.lat,
          anchorLng: libHit.lng,
          fromLibrary: true,
          major: storyCoverage.isMajorSubject(subjectKey) || (targetPlace ? placesService.isTier1Landmark(targetPlace) : false),
        };
      }
    }
    const cached = skipCache ? null : await storyLookup.findNearbyStory(
      position.lat, position.lng, 100, versionKey, toldAngles
    );
    if (cached && !heardStories.hasHeard(cached.topic) && !this.isTopicLockedForSession(cached.topic, effectiveContext.startsWith('stationary_'))) {
      console.log(`[Gemini] Using ${cached.source} story for "${cached.topic}" (${Math.round(cached.distanceM)}m away)`);
      if (onChunk) onChunk(cached.storyText);
      // Mark the SERVED story's subject in-flight — the within-session
      // retell pile-up guard in its hearing-era form (fix stack RC-2).
      // The pile-up fix this block carries used to lock the served
      // subject at serve time; now the serve marks it in-flight
      // (isTopicLockedForSession and selection both refuse in-flight
      // subjects, so the next angle cannot be dealt while this one
      // awaits its settle), and the LOCK itself lands when the story
      // is heard, via the app's settle funnel. The story actually
      // told is still the one that counts — it just counts at hearing.
      const servedKey = landmarkSubjectKey(this.topicBaseName(cached.topic));
      storyCoverage.markSubjectInFlight(servedKey);
      await locationTracker.updateLastStoryTopic(
        cached.topic, position, cached.storyText, effectiveContext, depthLevel, versionKey
      );
      return { text: cached.storyText, subject: cached.topic, context: effectiveContext, mode: factPack.mode, rotation: null, major: storyCoverage.isMajorSubject(servedKey) };
    }
    if (cached) {
      console.log(`[Gemini] Cached story for "${cached.topic}" already heard — generating a fresh one`);
    }

    // Never-starve bookkeeping (Item 2): flips true the moment this
    // serve actually attempts a live generation, so the app can
    // distinguish an attempted-but-failed cycle (Gemini is the
    // holdup — acceptable) from a cycle that ended having attempted
    // nothing while the queue sat empty (starvation — telemetered
    // by reason at the app layer).
    let generationAttempted = false;

    // preferBanked made real (fix stack RC-6, Oct 27, 2026): while
    // the Gemini PLAYBACK engine is tripped, a live generation's
    // audio cannot sound through it — the telling would fall back
    // to the device voice mid-storm or die in the attempt economy,
    // and the generation spend is wasted either way. Banked serves
    // (library/cache above) still serve; the live branch declines
    // WITHOUT consuming the decision, so the app refunds it and the
    // next cycle retries when the engine recovers or banked
    // material appears. (preferBanked() used to exist only as a
    // player-side economy flag — nothing at the serve layer read
    // it, so "prefer banked" preferred nothing.)
    if (audioHealth.preferBanked()) {
      trackDiag('pipeline', 'live-skipped-breaker', 'Gemini playback engine tripped — banked serves only this cycle, live generation declined');
      return { ...EMPTY_NARRATION, context: effectiveContext, mode: factPack.mode, decisionConsumed: false, emptyReason: 'breaker-banked-only' };
    }

    // Highway doctrine (fix stack item 9, Oct 27, 2026): at freeway
    // pace (≥15 m/s), a COLD live generation aimed at a point
    // landmark the listener will already have blown past before the
    // story can finish is spend that cannot land — the generation
    // latency on a degraded connection (this drive's own measured
    // median, via latencyModel) covers more road than the subject
    // has left ahead. Prefer region-anchored material instead: an
    // area story describes the region being crossed, not a point,
    // and lands at any exit. If no area story generates either, the
    // honest serve is DESIGNED SILENCE — flagged as such so the app
    // reports neither an error nor a refundable failure. Banked
    // serves (library/cache above) never reach this check: they
    // cost no generation time and start now.
    if (
      (position.speed ?? 0) >= 15 &&
      target.kind === 'landmark' &&
      targetPlace?.lat !== undefined &&
      targetPlace?.lng !== undefined
    ) {
      const subjectDistM = calculateDistance(position.lat, position.lng, targetPlace.lat, targetPlace.lng);
      const latencyS = latencyModel.latencyS();
      if (subjectDistM < (position.speed ?? 0) * latencyS - 400) {
        trackDiag(
          'pipeline',
          'highway-corridor-skip',
          `"${target.subject?.name}" exits the exit corridor before a live telling could land (${Math.round(subjectDistM)}m ahead, latency ${latencyS.toFixed(1)}s at ${Math.round((position.speed ?? 0) * 2.237)} mph) — region material instead`
        );
        const { rotation: areaRotation, areaName } = this.chooseAreaStory(position, factPack);
        const areaTarget: StoryTarget = {
          kind: 'area',
          subject: null,
          rotation: areaRotation,
          areaName,
          displayTopic: `${areaName} — ${describeAngle(areaRotation.angle)}`,
          angle: areaRotation.angle,
          significance: factPack.areaInfo.majorArea ? 'major-area' : undefined,
        };
        generationAttempted = true;
        const areaText = await this.generateStory(
          position, factPack, areaTarget, effectiveContext, depthLevel, depthCycle, destination, onChunk, true, versionKey
        );
        if (areaText && areaText.trim().length > 0) {
          locationTracker.commitDepthAdvance();
          return {
            text: areaText,
            subject: areaTarget.displayTopic,
            context: effectiveContext,
            mode: factPack.mode,
            rotation: areaTarget.rotation,
            major: areaTarget.significance === 'major-area',
            decisionConsumed: true,
            generationAttempted: true,
          };
        }
        // The area generation was ATTEMPTED and came back empty —
        // designed silence stands (Item 2 does not retry the
        // corridor), and generationAttempted keeps the app from
        // counting this cycle as starved.
        return { ...EMPTY_NARRATION, context: effectiveContext, mode: factPack.mode, decisionConsumed: true, designedSilence: true, generationAttempted: true };
      }
    }

    // Retell gate (Oct 28, 2026): when this generation is the one
    // permitted second telling of a Tier-1 place, it carries the
    // first telling's facts as binding exclusions and may decline.
    const retellGate =
      target.kind === 'landmark' && target.subject
        ? this.retellGateFor(subjectKey, target.subject.name, target.angle)
        : null;

    generationAttempted = true;
    const text = await this.generateStory(
      position, factPack, target, effectiveContext, depthLevel, depthCycle, destination, onChunk, true, versionKey, 0, retellGate
    );
    console.log('[Gemini] generateStory returned:', text ? `${text.length} chars` : 'EMPTY');
    if (retellGate && text && GeminiService.isDeclineText(text)) {
      // The gate declined: no disjoint story could be filled
      // without reusing the first telling's facts. Record the
      // decline — the subject is mention-only for the rest of the
      // tour (every serve path refuses it via the ledger) and the
      // gate does not re-attempt — and return an honest empty: the
      // cycle DID its work (decisionConsumed), the silence is
      // designed, and nothing is queued in the retell's place. The
      // place can still be MENTIONED as connective tissue by later
      // stories through the ordinary told-context prompt material.
      storyCoverage.markRetellDeclined(retellGate.subjectKey);
      trackDiag(
        'pipeline',
        'retell-declined',
        `"${retellGate.subjectName}" — no disjoint story could be filled without reusing the first telling's facts; mention-only for the rest of the tour`
      );
      console.log(`[Gemini] Retell declined for "${retellGate.subjectName}" — mention-only for the rest of the tour`);
      return {
        ...EMPTY_NARRATION,
        context: effectiveContext,
        mode: factPack.mode,
        decisionConsumed: true,
        generationAttempted: true,
        emptyReason: 'retell-declined',
      };
    }
    if (text && text.trim().length > 0) {
      locationTracker.commitDepthAdvance();
      if (target.kind === 'landmark') {
        // Coverage at hearing (fix stack RC-2): generation marks the
        // subject in-flight only — canonical and rotation tellings
        // alike count exactly once, at the delivered settle, through
        // the app's hearing funnel. A generation that never reaches
        // the listener's ears burns nothing.
        storyCoverage.markSubjectInFlight(subjectKey);
      }
    }
    return {
      text,
      subject: target.displayTopic,
      context: effectiveContext,
      mode: factPack.mode,
      rotation: target.rotation,
      // Tour thread: this text was generated live just now — its
      // lead rides along for the ledger (see NarrationResult).
      signatureFact: leadFactFromText(text),
      major:
        target.kind === 'landmark' && target.subject
          ? storyCoverage.isMajorSubject(subjectKey) || (targetPlace ? placesService.isTier1Landmark(targetPlace) : false)
          : false,
      decisionConsumed: true,
      // An attempted generation that returned empty is Gemini being
      // the holdup (Item 2's acceptable case) — the reason tag keeps
      // it distinct from a never-attempted cycle in telemetry.
      generationAttempted,
      emptyReason: text && text.trim().length > 0 ? undefined : 'generation-empty',
    };
  }

  async prefetchStory(position: Position): Promise<NarrationResult> {
    if (!this.ai) {
      return EMPTY_NARRATION;
    }

    const factPack = await this.gatherFactPack(position);
    const versionKey = this.storyVersionKey(this.factPackHash(factPack));
    await storyLibrary.primePlaceIndex();
    const target = this.chooseTarget(position, factPack);

    const subjectKey =
      target.kind === 'landmark' && target.subject
        ? landmarkSubjectKey(target.subject.name)
        : areaSubjectKey(position.lat, position.lng);
    const toldAngles = storyCoverage.getToldAngles(subjectKey);
    // Library first here too: a prefetched library entry carries its audio
    // with it, so the play-time serve spends no synthesis quota. Nothing is
    // recorded at prefetch time — exactly like a generated prefetch, the
    // hearing is recorded at the delivered settle via the app's funnel,
    // keyed by the returned rotation.
    if (target.kind === 'landmark' && target.subject && target.angle) {
      // Place-wide first (Pass 2, Oct 27, 2026), same as the serve
      // paths above: a prefetched library entry is the cheapest story
      // the tour owns, and requiring the prefetcher's rotated angle to
      // be the shelved one starved the shelf here too. The result's
      // rotation names the angle actually SERVED, so App's play-time
      // recording marks the spent angle truthfully.
      let libHit = storyLibrary.hasPlace(target.subject.name)
        ? await storyLibrary.lookupForPlace(
            target.subject.name,
            // Minor rule at the shelf (pre-publish stack Item 1):
            // never even BUFFER a second angle of a minor place heard
            // this tour — the buffer serve would refuse it anyway,
            // and buffering it wastes the prefetch cycle.
            // Told-subject ledger (Oct 28, 2026): likewise never
            // buffer a story the ledger would refuse at serve time —
            // a telling in flight, an already-dealt angle, or a
            // Tier-1 past its one retell.
            (_angle, topic) =>
              !heardStories.hasHeard(topic) &&
              !storyCoverage.isMinorRetellBlocked(landmarkSubjectKey(this.topicBaseName(topic))) &&
              !storyCoverage.isServeRefusedByToldLedger(landmarkSubjectKey(this.topicBaseName(topic)), _angle)
          )
        : null;
      if (!libHit) {
        libHit = await storyLibrary.lookup(target.subject.name, target.angle);
      }
      if (libHit && storyCoverage.isServeRefusedByToldLedger(subjectKey, libHit.angle)) {
        console.log(`[Gemini] Prefetch library hit for "${libHit.topic}" refused — subject already told this tour (told-subject ledger)`);
        libHit = null;
      }
      if (libHit) {
        console.log(`[Gemini] Prefetch library hit: "${libHit.topic}" (${libHit.angle})`);
        return {
          text: libHit.text,
          subject: libHit.topic,
          context: 'prefetch',
          mode: factPack.mode,
          rotation: isRotationAngle(libHit.angle)
            ? { subjectKey, angle: libHit.angle }
            : null,
          audioUrl: libHit.audioUrl,
          anchorLat: libHit.lat,
          anchorLng: libHit.lng,
          fromLibrary: true,
        };
      }
    }
    const cached = await storyLookup.findNearbyStory(
      position.lat, position.lng, 100, versionKey, toldAngles
    );
    // Subject-level guards, not just the exact topic: prefetch deals
    // stories for a moving listener, so a place already heard this
    // listener (any angle) or locked for the session must not be dealt
    // a fresh angle here. This check used to be exact-topic only (plus
    // the lock) — one of the paths that kept re-dealing the same place.
    if (
      cached &&
      !heardStories.hasHeard(cached.topic) &&
      !heardStories.hasHeardSubject(this.topicBaseName(cached.topic)) &&
      !this.isTopicLockedForSession(cached.topic, false)
    ) {
      console.log(`[Gemini] Prefetch using ${cached.source} story for "${cached.topic}" (${Math.round(cached.distanceM)}m away)`);
      return { text: cached.storyText, subject: cached.topic, context: 'prefetch', mode: factPack.mode, rotation: null };
    }

    // Retell gate (Oct 28, 2026): a prefetched generation can be
    // the gated retell too (the prefetcher picks targets through
    // the same resolveSubject pools). It carries the same
    // exclusions and may decline the same way — and a declined
    // prefetch must return EMPTY, never the sentinel: the buffer
    // would otherwise deal "DECLINE" as a story.
    const retellGate =
      target.kind === 'landmark' && target.subject
        ? this.retellGateFor(subjectKey, target.subject.name, target.angle)
        : null;
    const text = await this.generateStory(
      position, factPack, target, 'prefetch', 0, 0, undefined, undefined, false, versionKey,
      2, // lane priority: prefetch — a live serve or a question always takes the lane first (fix stack RC-4)
      retellGate
    );
    if (retellGate && text && GeminiService.isDeclineText(text)) {
      storyCoverage.markRetellDeclined(retellGate.subjectKey);
      trackDiag(
        'pipeline',
        'retell-declined',
        `"${retellGate.subjectName}" (prefetch) — no disjoint story could be filled without reusing the first telling's facts; mention-only for the rest of the tour`
      );
      console.log(`[Gemini] Prefetch retell declined for "${retellGate.subjectName}" — mention-only for the rest of the tour`);
      return { ...EMPTY_NARRATION, mode: factPack.mode };
    }
    return {
      text,
      subject: target.displayTopic,
      context: 'prefetch',
      mode: factPack.mode,
      rotation: target.rotation,
      // Tour thread: live-generated in this call — capture the lead
      // (see NarrationResult). Declines returned empty above, so a
      // sentinel can never be captured here.
      signatureFact: leadFactFromText(text),
    };
  }

  private async generateStory(
    position: Position,
    factPack: StoryFactPack,
    target: StoryTarget,
    context: string,
    depthLevel: number,
    depthCycle: number,
    destination: string | undefined,
    onChunk: ((text: string) => void) | undefined,
    updateTracker: boolean,
    versionKey: string,
    lanePriority: number = 0,
    retellGate: RetellGate | null = null
  ): Promise<string> {
    const prompt = this.buildStoryPrompt(position, factPack, target, context, depthLevel, depthCycle, destination, retellGate);
    const topic = target.displayTopic;
    const shouldUpdate = updateTracker && target.kind === 'landmark' && !target.rotation;

    try {
      await this.acquireSlot(lanePriority);
    } catch (error) {
      this.emitGenerationAttempt(LEO_MODEL_ID, 'story', 0, SLOT_WAIT_TIMEOUT_MS, 'lane-timeout');
      throw error;
    }
    try {
      if (onChunk) {
        const deadlineAt = Date.now() + GEN_DEADLINE_MS;
        const response = await this.withRetry(LEO_MODEL_ID, () =>
          this.withTimeout(
            this.ai!.models.generateContentStream({
              model: LEO_MODEL_ID,
              contents: prompt,
              config: { systemInstruction: LEO_SYSTEM_INSTRUCTION },
            }),
            Math.max(1000, deadlineAt - Date.now())
          )
        );

        let fullText = '';
        let lastChunkTime = Date.now();

        for await (const chunk of response) {
          if (Date.now() > deadlineAt) {
            throw new Error('Gemini generation deadline exceeded');
          }
          if (Date.now() - lastChunkTime > REQUEST_TIMEOUT_MS) {
            throw new Error('Gemini stream stalled');
          }
          const chunkText = chunk.text || '';
          fullText += chunkText;
          onChunk(chunkText);
          lastChunkTime = Date.now();
        }

        const finalText = fullText.trim();
        if (finalText && shouldUpdate) {
          await locationTracker.updateLastStoryTopic(topic, position, finalText, context, depthLevel, versionKey);
        }

        return finalText;
      } else {
        const response = await this.withRetry(LEO_MODEL_ID, () =>
          this.withTimeout(
            this.ai!.models.generateContent({
              model: LEO_MODEL_ID,
              contents: prompt,
              config: { systemInstruction: LEO_SYSTEM_INSTRUCTION },
            }),
            GEN_DEADLINE_MS
          )
        );

        const text = (response.text || '').trim();

        if (text && shouldUpdate) {
          await locationTracker.updateLastStoryTopic(topic, position, text, context, depthLevel, versionKey);
        }

        return text;
      }
    } catch (error) {
      console.error('Gemini API error:', error);
      this.lastError = error instanceof Error ? error.message : String(error);
      return '';
    } finally {
      this.releaseSlot();
    }
  }

  hasModel(): boolean {
    return this.ai !== null;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  clearError(): void {
    this.lastError = null;
  }

  async answerQuestion(
    question: string,
    position: Position,
    onChunk?: (text: string) => void,
    qaContext?: QAContext
  ): Promise<string> {
    if (!this.ai) {
      return "Hey, AI's still loading up. Give me just a second.";
    }

    // Instrumentation (Oct 25): time the answer and record which model
    // actually produced it, so the Q&A fast lane is measurable in the
    // daily rollup. Observational only — wrapped so it can never
    // interfere with answering.
    const qaStartedAt = Date.now();
    const emitTiming = (model: string, source: string) => {
      try {
        analytics.track('question_timing', position, position.speed !== null && position.speed >= 6.0 ? 'driving' : 'walking', {
          fetchTextS: parseFloat(((Date.now() - qaStartedAt) / 1000).toFixed(3)),
          model,
          source,
        });
      } catch { /* never break an answer for a metric */ }
    };

    const parts: string[] = [];
    parts.push(`The listener is at ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} and asks: "${question}"`);

    if (qaContext?.lastSpokenSentences) {
      parts.push(`WHAT YOU JUST TOLD THEM (reference it if relevant):\n"${qaContext.lastSpokenSentences.slice(0, 400)}"`);
    }
    if (qaContext?.nearbyLandmarks && qaContext.nearbyLandmarks.length > 0) {
      parts.push(`NEARBY RIGHT NOW (they can likely see these): ${qaContext.nearbyLandmarks.slice(0, 5).join(', ')}`);
    }
    parts.push(
      'Answer the question directly and completely. Take as much time as the answer needs — 4 to 6 sentences is fine if the question warrants it, but keep it under 10 sentences so the listener can get back to the tour. The listener asked because they are curious, so give them a satisfying, full answer, not a quick summary. Ground it in this location and what you just told them when relevant. If you do not actually know, say so plainly and offer what you do know about the wider area — never invent specifics.'
    );
    parts.push(
      'POSITION-BINDING (Item 7): this answer may be heard a minute or two after the question was asked — the story now playing finishes first, and the car keeps moving. Never pin the answer to the listener\'s immediate position ("on your left", "coming up on your right", "that tower right beside you"); name the place, describe what it looks like, or use a compass point instead. The nearby list above was true when they asked; refer to those places by name, not by where they sit around the car.'
    );

    const prompt = parts.join('\n\n');

    try {
      await this.acquireSlot(1);
    } catch (error) {
      this.emitGenerationAttempt(LEO_QA_MODEL_ID, 'answer', 0, SLOT_WAIT_TIMEOUT_MS, 'lane-timeout');
      throw error;
    }
    try {
      const answer = await this.generateAnswer(prompt, LEO_QA_MODEL_ID, onChunk);
      emitTiming(LEO_QA_MODEL_ID, 'primary');
      return answer;
    } catch (primaryError) {
      // The reduced Q&A model is a cost/latency optimization, never a
      // single point of failure: if it is unavailable for any reason,
      // the flagship story model answers instead — slower, never dead.
      if (LEO_QA_MODEL_ID !== LEO_MODEL_ID) {
        try {
          console.warn('[Q&A] Reduced model failed, falling back to flagship:', primaryError);
          const fallbackAnswer = await this.generateAnswer(prompt, LEO_MODEL_ID, onChunk);
          emitTiming(LEO_MODEL_ID, 'fallback');
          return fallbackAnswer;
        } catch {
          // Fall through to the standard error copy below.
        }
      }
      console.error('Gemini API error:', primaryError);
      if (this.isQuotaError(primaryError)) {
        emitTiming(LEO_QA_MODEL_ID, 'quota_blocked');
        return "I'm getting too many requests right now. Ask me that again in a moment!";
      }
      emitTiming(LEO_QA_MODEL_ID, 'error');
      return "Having a connection hiccup. Ask me that again in a sec!";
    } finally {
      this.releaseSlot();
    }
  }

  private async generateAnswer(
    prompt: string,
    modelId: string,
    onChunk?: (text: string) => void
  ): Promise<string> {
    if (onChunk) {
      const deadlineAt = Date.now() + GEN_DEADLINE_MS;
      const response = await this.withRetry(modelId, () =>
        this.withTimeout(
          this.ai!.models.generateContentStream({
            model: modelId,
            contents: prompt,
            config: {
              systemInstruction: LEO_SYSTEM_INSTRUCTION,
              maxOutputTokens: LEO_QA_MAX_OUTPUT_TOKENS,
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
          Math.max(1000, deadlineAt - Date.now())
        )
      , 'answer');

      let fullText = '';
      let lastChunkTime = Date.now();

      try {
        for await (const chunk of response) {
          if (Date.now() > deadlineAt) {
            throw new Error('Gemini generation deadline exceeded');
          }
          if (Date.now() - lastChunkTime > REQUEST_TIMEOUT_MS) {
            throw new Error('Gemini stream stalled');
          }
          const chunkText = chunk.text || '';
          fullText += chunkText;
          onChunk(chunkText);
          lastChunkTime = Date.now();
        }
      } catch (streamError) {
        // A stream that dies after producing a real answer keeps it —
        // re-asking on the fallback model would double-print the prefix
        // the listener already received.
        if (fullText.trim().length > 0) {
          return fullText.trim();
        }
        throw streamError;
      }

      return fullText.trim();
    }

    const response = await this.withRetry(modelId, () =>
      this.withTimeout(
        this.ai!.models.generateContent({
          model: modelId,
          contents: prompt,
          config: {
            systemInstruction: LEO_SYSTEM_INSTRUCTION,
            maxOutputTokens: LEO_QA_MAX_OUTPUT_TOKENS,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        GEN_DEADLINE_MS
      )
    , 'answer');

    return (response.text || '').trim();
  }
}

export const geminiService = new GeminiService();
