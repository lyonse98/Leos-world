import { GoogleGenAI } from '@google/genai';
import type { Position } from '../hooks/useGeolocation';
import { placesService, NearbyPlace, AreaInfo } from './placesService';
import { locationTracker } from './locationTracker';
import { storyLookup } from './storyLookup';
import type { CachedStoryResult } from './storyLookup';
import { heardStories } from './heardStories';
import { pickStorySubject, StorySubject } from './relevance';
import { tasteProfile } from './tasteProfile';
import { deriveTags, isInterestTag } from './storyTags';
import { storyCoverage, AREA_ANGLES, LANDMARK_ANGLES, describeAngle, describeArea, areaSubjectKey, landmarkSubjectKey, isRotationAngle } from './storyCoverage';
import { resolveMovementMode, MovementModeHysteresis } from '../utils/geo';
import { hashString } from '../utils/hash';
import { LEO_MODEL_ID, LEO_PERSONA_VERSION, LEO_SYSTEM_INSTRUCTION } from './leoPersona';
import { wikipedia } from './wikipedia';
import { seasonal } from './seasonal';
import { osmService } from './osmService';

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
}

const EMPTY_NARRATION: NarrationResult = { text: '', subject: '', context: '', mode: 'walking', rotation: null };

interface StoryTarget {
  kind: 'landmark' | 'area';
  subject: StorySubject | null;
  rotation: StoryRotation | null;
  areaName: string;
  displayTopic: string;
}

const MIN_REQUEST_INTERVAL_MS = 3000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 30000;

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
  initial: 'FIRST STORY OF THE TOUR: Welcome the listener. Name the city and neighborhood. Give the one-sentence history of this area — what kind of place this is, how it came to be. Set the scene like the opening of a podcast episode. Then tell ONE broad story about this NEIGHBORHOOD or AREA — not a specific landmark. Save individual landmark stories for the next stop. This is the warm-up: orient them, ground them, make them want to keep listening.',
  prefetch: 'Tell the best story about what is here now.',
  neighborhood_intro: 'NEIGHBORHOOD INTRO: The listener just entered a new neighborhood. Give a brief 1-2 sentence lowdown on this area first — the vibe, the one-sentence history, what kind of place this is — BEFORE diving into any specific landmark story. Situate them. Then transition naturally into the best story about what is here. Keep the intro punchy and distinct from the story that follows.',
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

  private async waitForSlot(): Promise<void> {
    while (this.requestInProgress) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    this.requestInProgress = true;
  }

  private releaseSlot(): void {
    this.requestInProgress = false;
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

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.enforceRateLimit();
        return await fn();
      } catch (error) {
        lastError = error;
        if (this.isQuotaError(error) && attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          console.warn(`[Gemini] Quota hit, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
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

  async gatherFactPack(position: Position): Promise<StoryFactPack> {
    let places: NearbyPlace[] = [];
    let areaInfo: AreaInfo = { neighborhood: null, city: null, district: null, street: null };
    let wikiContext = '';
    let osmContext = '';
    const deepMode = locationTracker.getDwellDepthLevel() !== null;
    try {
      const [placesResult, areaResult, wikiResult, osmResult] = await Promise.all([
        placesService.getNearbyLandmarks(position, 100),
        placesService.getAreaInfo(position),
        wikipedia.getNearbyArticles(position, deepMode),
        osmService.getNearbyFeatures(position, position.speed),
      ]);
      places = placesResult;
      areaInfo = areaResult;
      wikiContext = wikipedia.formatForPrompt(wikiResult);
      osmContext = osmService.formatForPrompt(osmResult);
    } catch (error) {
      console.error('Error fetching fact pack:', error);
    }

    const movement = resolveMovementMode(position.speed, this.lastKnownMode);
    const isRural =
      movement === 'driving' && !areaInfo.neighborhood && !areaInfo.city && places.length === 0;
    const mode = this.resolveMode(position, { isRural });

    return { places, areaInfo, mode, isRural, wikiContext, osmContext };
  }

  factPackHash(factPack: StoryFactPack): string {
    const placeKey = factPack.places
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

  private resolveSubject(factPack: StoryFactPack): StorySubject | null {
    if (factPack.places.length === 0) return null;

    const unheard = factPack.places.filter(p => !heardStories.hasHeard(p.name));
    if (unheard.length > 0) return pickStorySubject(unheard, this.recentPrimaryTags());

    const revisited = factPack.places.filter(p =>
      storyCoverage.hasFreshAngle(landmarkSubjectKey(p.name), LANDMARK_ANGLES, [LANDMARK_ANGLES[0]])
    );
    if (revisited.length > 0) {
      return pickStorySubject(revisited, this.recentPrimaryTags(), { ignoreHeardPenalty: true });
    }

    return null;
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
    const isFirstInNeighborhood = context === 'neighborhood_intro' || context === 'initial';

    const subject = isFirstInNeighborhood ? null : this.resolveSubject(factPack);

    if (subject) {
      const subjectKey = landmarkSubjectKey(subject.name);
      const angle = storyCoverage.nextAngle(
        subjectKey,
        LANDMARK_ANGLES,
        heardStories.hasHeard(subject.name) ? [LANDMARK_ANGLES[0]] : []
      );

      const isRotation = isRotationAngle(angle);

      return {
        kind: 'landmark',
        subject,
        rotation: isRotation && angle ? { subjectKey, angle } : null,
        areaName: '',
        displayTopic: isRotation && angle ? `${subject.name} — ${describeAngle(angle)}` : subject.name,
      };
    }

    const { rotation, areaName } = this.chooseAreaStory(position, factPack);
    return {
      kind: 'area',
      subject: null,
      rotation,
      areaName,
      displayTopic: `${areaName} — ${describeAngle(rotation.angle)}`,
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

  private buildStoryPrompt(
    position: Position,
    factPack: StoryFactPack,
    target: StoryTarget,
    context: string,
    depthLevel: number,
    depthCycle: number,
    destination: string | undefined
  ): string {
    const lastTopic = locationTracker.getLastStoryTopic();
    const lastStoryText = locationTracker.getLastStoryText();
    const hasLastTopic = !!lastTopic && lastTopic.length > 0;
    const recentStoryTexts = locationTracker.getRecentStoryTexts();
    const allToldStories = locationTracker.getAllToldStories();
    const weaveCallback = locationTracker.shouldWeaveCallback();
    const storiesToldCount = locationTracker.getStoriesToldCount();

    const parts: string[] = [];

    parts.push(this.buildFactPackBlock(position, factPack));
    if (factPack.wikiContext) parts.push(factPack.wikiContext);
    if (factPack.osmContext) parts.push(factPack.osmContext);
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
      .filter(p => heardStories.hasHeard(p.name))
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
        `STORIES ALREADY TOLD THIS TOUR (context only — do NOT retell, do NOT force a connection):\n${recentStoryTexts
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

    if (weaveCallback && recentStoryTexts.length >= 2) {
      parts.push(
        `CALLBACK INVITATION: You have told ${storiesToldCount} stories this tour. If a genuine thread connects two or more of them, surface it in one line woven into this story. If none exists, skip it.`
      );
    }

    const tasteBlock = this.buildTasteBlock();
    if (tasteBlock) parts.push(tasteBlock);

    if (factPack.mode === 'rural') {
      parts.push('MODE IS RURAL: no landmarks, no neighborhood, open country. Follow RURAL MODE.');
    }

    const seasonalHint = seasonal.getPromptHint();
    if (seasonalHint) parts.push(seasonalHint);

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

    return parts.join('\n\n');
  }

  async getTourNarration(
    position: Position,
    destination?: string,
    onChunk?: (text: string) => void
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

    const factPackPromise = this.gatherFactPack(position);
    // Pass the persona version as a partial version-key filter so old-persona
    // stories (with slang, meters, etc.) are never served from the preliminary
    // lookup. The full version key (with fact pack hash) is applied later.
    const partialVersionKey = `${LEO_PERSONA_VERSION}|`;
    const cachePromise = storyLookup.findNearbyStory(position.lat, position.lng, 100, partialVersionKey);

    // Wait for both in parallel. Don't short-circuit — we need the fact pack
    // for the fallback path even if the cache hits.
    [factPack, preliminaryCache] = await Promise.all([factPackPromise, cachePromise]);

    // If the preliminary cache found an unheard story, serve it right away.
    if (preliminaryCache && !heardStories.hasHeard(preliminaryCache.topic)) {
      console.log(`[Gemini] Parallel cache hit for "${preliminaryCache.topic}" (${Math.round(preliminaryCache.distanceM)}m away)`);
      const versionKey = this.storyVersionKey(this.factPackHash(factPack));
      if (onChunk) onChunk(preliminaryCache.storyText);
      await locationTracker.updateLastStoryTopic(
        preliminaryCache.topic, position, preliminaryCache.storyText, 'cache_hit', 0, versionKey
      );
      return { text: preliminaryCache.storyText, subject: preliminaryCache.topic, context: 'cache_hit', mode: factPack.mode, rotation: null };
    }

    const landmarkNames = factPack.places.map(p => p.name);
    const { shouldTell, context, depthLevel, depthCycle } = locationTracker.shouldTellNewStory(
      position,
      landmarkNames,
      factPack.areaInfo.neighborhood
    );

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

    if (!shouldTell) {
      console.log('[Gemini] shouldTell=false — returning empty. context:', context);
      return { ...EMPTY_NARRATION, context, mode: factPack.mode };
    }

    // Detect a return visit: if the area subject key already has told angles,
    // this is a welcome-back, not a first-time intro.
    let effectiveContext = context;
    if (context === 'neighborhood_intro') {
      const areaKey = areaSubjectKey(position.lat, position.lng);
      const hasPriorCoverage = storyCoverage.getToldAngles(areaKey).length > 0;
      if (hasPriorCoverage) {
        effectiveContext = 'welcome_back';
      }
    }

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
    const toldAngles = storyCoverage.getToldAngles(subjectKey);
    const cached = skipCache ? null : await storyLookup.findNearbyStory(
      position.lat, position.lng, 100, versionKey, toldAngles
    );
    if (cached && !heardStories.hasHeard(cached.topic)) {
      console.log(`[Gemini] Using ${cached.source} story for "${cached.topic}" (${Math.round(cached.distanceM)}m away)`);
      if (onChunk) onChunk(cached.storyText);
      await locationTracker.updateLastStoryTopic(
        cached.topic, position, cached.storyText, effectiveContext, depthLevel, versionKey
      );
      return { text: cached.storyText, subject: cached.topic, context: effectiveContext, mode: factPack.mode, rotation: null };
    }
    if (cached) {
      console.log(`[Gemini] Cached story for "${cached.topic}" already heard — generating a fresh one`);
    }

    const text = await this.generateStory(
      position, factPack, target, effectiveContext, depthLevel, depthCycle, destination, onChunk, true, versionKey
    );
    console.log('[Gemini] generateStory returned:', text ? `${text.length} chars` : 'EMPTY');
    if (text && text.trim().length > 0) {
      locationTracker.commitDepthAdvance();
    }
    return {
      text,
      subject: target.displayTopic,
      context: effectiveContext,
      mode: factPack.mode,
      rotation: target.rotation,
    };
  }

  async prefetchStory(position: Position): Promise<NarrationResult> {
    if (!this.ai) {
      return EMPTY_NARRATION;
    }

    const factPack = await this.gatherFactPack(position);
    const versionKey = this.storyVersionKey(this.factPackHash(factPack));
    const target = this.chooseTarget(position, factPack);

    const subjectKey =
      target.kind === 'landmark' && target.subject
        ? landmarkSubjectKey(target.subject.name)
        : areaSubjectKey(position.lat, position.lng);
    const toldAngles = storyCoverage.getToldAngles(subjectKey);
    const cached = await storyLookup.findNearbyStory(
      position.lat, position.lng, 100, versionKey, toldAngles
    );
    if (cached && !heardStories.hasHeard(cached.topic)) {
      console.log(`[Gemini] Prefetch using ${cached.source} story for "${cached.topic}" (${Math.round(cached.distanceM)}m away)`);
      return { text: cached.storyText, subject: cached.topic, context: 'prefetch', mode: factPack.mode, rotation: null };
    }

    const text = await this.generateStory(
      position, factPack, target, 'prefetch', 0, 0, undefined, undefined, false, versionKey
    );
    return {
      text,
      subject: target.displayTopic,
      context: 'prefetch',
      mode: factPack.mode,
      rotation: target.rotation,
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
    versionKey: string
  ): Promise<string> {
    const prompt = this.buildStoryPrompt(position, factPack, target, context, depthLevel, depthCycle, destination);
    const topic = target.displayTopic;
    const shouldUpdate = updateTracker && target.kind === 'landmark' && !target.rotation;

    await this.waitForSlot();
    try {
      if (onChunk) {
        const response = await this.withRetry(() =>
          this.withTimeout(
            this.ai!.models.generateContentStream({
              model: LEO_MODEL_ID,
              contents: prompt,
              config: { systemInstruction: LEO_SYSTEM_INSTRUCTION },
            }),
            REQUEST_TIMEOUT_MS
          )
        );

        let fullText = '';
        let lastChunkTime = Date.now();

        for await (const chunk of response) {
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
        const response = await this.withRetry(() =>
          this.withTimeout(
            this.ai!.models.generateContent({
              model: LEO_MODEL_ID,
              contents: prompt,
              config: { systemInstruction: LEO_SYSTEM_INSTRUCTION },
            }),
            REQUEST_TIMEOUT_MS
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

    const parts: string[] = [];
    parts.push(`The listener is at ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} and asks: "${question}"`);

    if (qaContext?.lastSpokenSentences) {
      parts.push(`WHAT YOU JUST TOLD THEM (reference it if relevant):\n"${qaContext.lastSpokenSentences.slice(0, 400)}"`);
    }
    if (qaContext?.nearbyLandmarks && qaContext.nearbyLandmarks.length > 0) {
      parts.push(`NEARBY RIGHT NOW (they can likely see these): ${qaContext.nearbyLandmarks.slice(0, 5).join(', ')}`);
    }
    parts.push(
      'Answer the question directly and completely. Take as much time as the answer needs — 4 to 6 sentences is fine if the question warrants it. The listener asked because they are curious, so give them a satisfying, full answer, not a quick summary. Ground it in this location and what you just told them when relevant. If you do not actually know, say so plainly and offer what you do know about the wider area — never invent specifics.'
    );

    const prompt = parts.join('\n\n');

    await this.waitForSlot();
    try {
      if (onChunk) {
        const response = await this.withRetry(() =>
          this.withTimeout(
            this.ai!.models.generateContentStream({
              model: LEO_MODEL_ID,
              contents: prompt,
              config: { systemInstruction: LEO_SYSTEM_INSTRUCTION },
            }),
            REQUEST_TIMEOUT_MS
          )
        );

        let fullText = '';
        let lastChunkTime = Date.now();

        for await (const chunk of response) {
          if (Date.now() - lastChunkTime > REQUEST_TIMEOUT_MS) {
            throw new Error('Gemini stream stalled');
          }
          const chunkText = chunk.text || '';
          fullText += chunkText;
          onChunk(chunkText);
          lastChunkTime = Date.now();
        }

        return fullText.trim();
      } else {
        const response = await this.withRetry(() =>
          this.withTimeout(
            this.ai!.models.generateContent({
              model: LEO_MODEL_ID,
              contents: prompt,
              config: { systemInstruction: LEO_SYSTEM_INSTRUCTION },
            }),
            REQUEST_TIMEOUT_MS
          )
        );

        return (response.text || '').trim();
      }
    } catch (error) {
      console.error('Gemini API error:', error);
      if (this.isQuotaError(error)) {
        return "I'm getting too many requests right now. Ask me that again in a moment!";
      }
      return "Having a connection hiccup. Ask me that again in a sec!";
    } finally {
      this.releaseSlot();
    }
  }
}

export const geminiService = new GeminiService();
