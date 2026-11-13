// The Miles user profile (personalization tool, Nov 13, 2026 —
// Erik approved the recommended package from the shotgun-agent
// decision brief the same morning). This module is the profile
// SYSTEM only: a structured, on-device store with a clean read
// API. Its first consumer (the current-events layer) does not
// exist yet and is NOT built here; nothing in the composer, the
// tour engine, or playback reads this module to change behavior.
//
// ============================================================
// THE USE FENCE — read this before touching the module.
//
// Profile reads exist for ONE purpose: ranking Miles's OWN
// stories and suggestions for the person holding the phone.
//   - No third-party calls. Nothing in this module (or anything
//     built on its read API) may send profile data off-device.
//   - No ad code, no ad targeting, no data sale, no sharing.
//   - Sponsorship in Miles is place/context-based and labeled;
//     it never consumes this profile.
// Loosening this fence is Erik's explicit gate decision, never
// a builder's side effect. If you are here to wire the profile
// into an ad or partner surface: stop, that work is not
// authorized by the package this module was built under.
// ============================================================
//
// Shape doctrine (from the approved package):
//   - TWO LAYERS, kept separate: DECLARED (the user said it) and
//     INFERRED (behavior suggested it). Every entry carries its
//     source, what set it (provenance), and when. User edits are
//     declared and beat inference, always.
//   - FIELDS ARE TASTES + CONSTRAINTS ONLY, from the closed
//     vocabularies below. NEVER collected: gender, income,
//     exact age / date of birth. A field that would not change
//     a suggestion does not get collected. The forbidden-key
//     guard below (and its sim) fails the build if a forbidden
//     key ever enters the schema.
//   - CONSTRAINTS ARE DECLARED-ONLY. Inference never writes a
//     constraint (nobody's budget or kids get guessed at), and
//     declared constraints never decay. In v1, inference writes
//     exactly one thing: story-topic affinities, from signals
//     the app already generates on-device (story completions vs
//     cut-offs, thread menu picks). Tone picks and mode picks
//     are accepted by the signal API below and deliberately map
//     to NO field — the field list has no tone/mode slot, and
//     inventing one is forbidden by the same spec.
//   - ON-DEVICE ONLY. localStorage through a store seam (the
//     routeHistory pattern), no server writes, no sync. The
//     profile is exportable/importable JSON so taste can travel
//     to a new city (Erik's portability requirement); account
//     sync is a separate, later, opt-in decision.
//   - PAUSE MEANS PAUSE: when paused, inference stops and every
//     personalization read returns empty. The data stays (the
//     user may resume), it is simply not used.

import { ROUTE_TOPICS } from './routeMode';

// ------------------------------------------------------------ vocabularies

/** Story-topic vocabulary: the composer's own topic list, reused verbatim. */
export const STORY_TOPICS: readonly string[] = ROUTE_TOPICS;

export const CUISINE_OPTIONS = [
  'tacos-mexican',
  'seafood',
  'bbq',
  'italian',
  'asian',
  'coffee-bakery',
] as const;

export const DRINK_OPTIONS = ['coffee', 'beer', 'wine', 'cocktails', 'no-alcohol'] as const;

export const ACTIVITY_OPTIONS = [
  'live-music',
  'history-museums',
  'outdoors-views',
  'sports',
  'markets',
  'nightlife',
  'weird-local-lore',
] as const;

export const DIETARY_OPTIONS = ['vegetarian', 'gluten-free'] as const;

export const BUDGET_COMFORT_OPTIONS = ['drop-in', 'sit-down', 'splurge'] as const;
export type BudgetComfort = (typeof BUDGET_COMFORT_OPTIONS)[number];

export const WALKING_TOLERANCE_OPTIONS = ['low', 'medium', 'high'] as const;
export type WalkingTolerance = (typeof WALKING_TOLERANCE_OPTIONS)[number];

export const SURPRISE_TOLERANCE_OPTIONS = ['favorites', 'mix', 'surprise-me'] as const;
export type SurpriseTolerance = (typeof SURPRISE_TOLERANCE_OPTIONS)[number];

export const DETOUR_MINUTE_OPTIONS = [5, 10, 20] as const;

/** Plain-language labels for the UI (the seed card + Your Miles screen). */
export const OPTION_LABELS: Record<string, string> = {
  'tacos-mexican': 'Tacos & Mexican',
  seafood: 'Seafood',
  bbq: 'BBQ',
  italian: 'Italian',
  asian: 'Asian',
  'coffee-bakery': 'Coffee & bakeries',
  coffee: 'Coffee',
  beer: 'Beer',
  wine: 'Wine',
  cocktails: 'Cocktails',
  'no-alcohol': 'No alcohol',
  'live-music': 'Live music',
  'history-museums': 'History & museums',
  'outdoors-views': 'Outdoors & views',
  sports: 'Sports',
  markets: 'Markets',
  nightlife: 'Nightlife',
  'weird-local-lore': 'Weird local lore',
  vegetarian: 'Vegetarian',
  'gluten-free': 'Gluten-free',
  'drop-in': 'Drop-in — keep it cheap and easy',
  'sit-down': 'Sit-down — a proper meal out',
  splurge: 'Splurge — make it an occasion',
  low: 'Low — short walks',
  medium: 'Medium — a few blocks is fine',
  high: 'High — happy to roam',
  favorites: 'Favorites — stick to what I love',
  mix: 'A mix — mostly my tastes, some new',
  'surprise-me': 'Surprise me — push the new',
};

// ------------------------------------------------------------ schema

export type EntrySource = 'declared' | 'inferred';

export interface ProfileEntry<T> {
  value: T;
  source: EntrySource;
  /** What set this entry: 'seed-card', 'your-miles-edit', 'import', 'story-completion', 'thread-pick', … */
  provenance: string;
  /** Epoch ms of the last write/evidence. */
  updatedAt: number;
  /** Inferred entries only; declared entries carry null (a declaration is not a guess). */
  confidence: number | null;
}

export interface InferredTopicAffinity {
  topic: string;
  source: 'inferred';
  provenance: string;
  updatedAt: number;
  /** Raw confidence 0..1 BEFORE read-time aging (see agedConfidence). */
  confidence: number;
  evidenceCount: number;
}

export interface MilesProfile {
  version: 1;
  createdAt: number;
  paused: boolean;
  seedState: 'not-offered' | 'completed' | 'skipped';
  tastes: {
    cuisines: ProfileEntry<string[]> | null;
    drinks: ProfileEntry<string[]> | null;
    activities: ProfileEntry<string[]> | null;
    storyTopics: ProfileEntry<string[]> | null;
  };
  constraints: {
    budgetComfort: ProfileEntry<BudgetComfort> | null;
    maxDetourMinutes: ProfileEntry<number> | null;
    alcoholOk: ProfileEntry<boolean> | null;
    usuallyWithKids: ProfileEntry<boolean> | null;
    dogFriendly: ProfileEntry<boolean> | null;
    walkingTolerance: ProfileEntry<WalkingTolerance> | null;
    surpriseTolerance: ProfileEntry<SurpriseTolerance> | null;
    dietary: ProfileEntry<string[]> | null;
  };
  /** topic → affinity. The ONLY thing inference writes in v1. */
  inferredTopics: Record<string, InferredTopicAffinity>;
}

export type TasteField = keyof MilesProfile['tastes'];
export type ConstraintField = keyof MilesProfile['constraints'];

export const TASTE_FIELDS: readonly TasteField[] = ['cuisines', 'drinks', 'activities', 'storyTopics'];
export const CONSTRAINT_FIELDS: readonly ConstraintField[] = [
  'budgetComfort',
  'maxDetourMinutes',
  'alcoholOk',
  'usuallyWithKids',
  'dogFriendly',
  'walkingTolerance',
  'surpriseTolerance',
  'dietary',
];

/**
 * Keys that must NEVER appear anywhere in a profile document.
 * The guard runs on parse + import, and a sim walks the schema
 * itself: if a future builder adds one of these fields, the
 * build fails loudly instead of shipping quietly.
 */
export const FORBIDDEN_PROFILE_KEYS: readonly string[] = [
  'gender',
  'income',
  'dob',
  'dateofbirth',
  'birthdate',
  'birthday',
  'age',
  'salary',
  'race',
  'ethnicity',
  'religion',
  'politics',
  'health',
  'disability',
  'sexualorientation',
];

const normKey = (k: string): string => k.toLowerCase().replace(/[^a-z]/g, '');

/** Deep-walk any value; return the forbidden keys found (normalized), if any. */
export function findForbiddenKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) findForbiddenKeys(v, found);
  } else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_PROFILE_KEYS.includes(normKey(k))) found.push(k);
      findForbiddenKeys(v, found);
    }
  }
  return found;
}

// ------------------------------------------------------------ store seam

export interface ProfileStore {
  read(): string | null;
  write(value: string): void;
  clear(): void;
}

export const PROFILE_STORAGE_KEY = 'leo_user_profile';
/** A store larger than this is not a profile; it is corruption. Read as empty. */
const MAX_STORE_CHARS = 64_000;

/** The app default: localStorage, touched only inside functions (accessGate pattern). */
export const localProfileStore: ProfileStore = {
  read() {
    try {
      return localStorage.getItem(PROFILE_STORAGE_KEY);
    } catch {
      return null;
    }
  },
  write(value: string) {
    try {
      localStorage.setItem(PROFILE_STORAGE_KEY, value);
    } catch {
      /* storage unavailable — the profile is a nicety, never a failure */
    }
  },
  clear() {
    try {
      localStorage.removeItem(PROFILE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  },
};

// ------------------------------------------------------------ construction + validation

export function emptyProfile(now: number): MilesProfile {
  return {
    version: 1,
    createdAt: now,
    paused: false,
    seedState: 'not-offered',
    tastes: { cuisines: null, drinks: null, activities: null, storyTopics: null },
    constraints: {
      budgetComfort: null,
      maxDetourMinutes: null,
      alcoholOk: null,
      usuallyWithKids: null,
      dogFriendly: null,
      walkingTolerance: null,
      surpriseTolerance: null,
      dietary: null,
    },
    inferredTopics: {},
  };
}

const inVocab = (v: unknown, vocab: readonly string[]): v is string =>
  typeof v === 'string' && vocab.includes(v);

function cleanStringList(v: unknown, vocab: readonly string[]): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = [...new Set(v.filter(x => inVocab(x, vocab)))];
  return out;
}

function cleanEntry<T>(raw: unknown, clean: (v: unknown) => T | null): ProfileEntry<T> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const value = clean(r.value);
  if (value === null) return null;
  if (typeof r.updatedAt !== 'number' || !Number.isFinite(r.updatedAt)) return null;
  return {
    value,
    source: 'declared',
    provenance: typeof r.provenance === 'string' ? r.provenance : 'import',
    updatedAt: r.updatedAt,
    confidence: null,
  };
}

/**
 * Parse + validate a raw profile document. Anything unexpected —
 * bad JSON, wrong version, a forbidden key ANYWHERE — reads as
 * null (never a throw, never a partial trust). Taste values are
 * filtered to the closed vocabularies; entries that clean to
 * nothing are dropped.
 */
export function parseProfile(raw: string | null): MilesProfile | null {
  if (!raw || raw.length > MAX_STORE_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  if (findForbiddenKeys(parsed).length > 0) return null;
  const p = parsed as Record<string, unknown>;
  if (p.version !== 1) return null;
  if (typeof p.createdAt !== 'number' || !Number.isFinite(p.createdAt)) return null;

  const out = emptyProfile(p.createdAt);
  out.paused = p.paused === true;
  out.seedState = p.seedState === 'completed' || p.seedState === 'skipped' ? p.seedState : 'not-offered';

  const tastes = (typeof p.tastes === 'object' && p.tastes !== null ? p.tastes : {}) as Record<string, unknown>;
  out.tastes.cuisines = cleanEntry(tastes.cuisines, v => cleanStringList(v, CUISINE_OPTIONS));
  out.tastes.drinks = cleanEntry(tastes.drinks, v => cleanStringList(v, DRINK_OPTIONS));
  out.tastes.activities = cleanEntry(tastes.activities, v => cleanStringList(v, ACTIVITY_OPTIONS));
  out.tastes.storyTopics = cleanEntry(tastes.storyTopics, v => cleanStringList(v, STORY_TOPICS));

  const cons = (typeof p.constraints === 'object' && p.constraints !== null ? p.constraints : {}) as Record<
    string,
    unknown
  >;
  out.constraints.budgetComfort = cleanEntry(cons.budgetComfort, v =>
    inVocab(v, BUDGET_COMFORT_OPTIONS) ? (v as BudgetComfort) : null,
  );
  out.constraints.maxDetourMinutes = cleanEntry(cons.maxDetourMinutes, v =>
    typeof v === 'number' && (DETOUR_MINUTE_OPTIONS as readonly number[]).includes(v) ? v : null,
  );
  const boolOrNull = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
  out.constraints.alcoholOk = cleanEntry(cons.alcoholOk, boolOrNull);
  out.constraints.usuallyWithKids = cleanEntry(cons.usuallyWithKids, boolOrNull);
  out.constraints.dogFriendly = cleanEntry(cons.dogFriendly, boolOrNull);
  out.constraints.walkingTolerance = cleanEntry(cons.walkingTolerance, v =>
    inVocab(v, WALKING_TOLERANCE_OPTIONS) ? (v as WalkingTolerance) : null,
  );
  out.constraints.surpriseTolerance = cleanEntry(cons.surpriseTolerance, v =>
    inVocab(v, SURPRISE_TOLERANCE_OPTIONS) ? (v as SurpriseTolerance) : null,
  );
  out.constraints.dietary = cleanEntry(cons.dietary, v => cleanStringList(v, DIETARY_OPTIONS));

  const inferred = (typeof p.inferredTopics === 'object' && p.inferredTopics !== null
    ? p.inferredTopics
    : {}) as Record<string, unknown>;
  for (const [topic, raw] of Object.entries(inferred)) {
    if (!STORY_TOPICS.includes(topic)) continue;
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.confidence !== 'number' || !Number.isFinite(r.confidence)) continue;
    if (typeof r.updatedAt !== 'number' || !Number.isFinite(r.updatedAt)) continue;
    out.inferredTopics[topic] = {
      topic,
      source: 'inferred',
      provenance: typeof r.provenance === 'string' ? r.provenance : 'story-completion',
      updatedAt: r.updatedAt,
      confidence: Math.min(1, Math.max(0, r.confidence)),
      evidenceCount:
        typeof r.evidenceCount === 'number' && Number.isFinite(r.evidenceCount)
          ? Math.max(0, Math.floor(r.evidenceCount))
          : 0,
    };
  }
  return out;
}

// ------------------------------------------------------------ persistence

export function loadProfile(store: ProfileStore = localProfileStore, now: number = Date.now()): MilesProfile {
  let raw: string | null = null;
  try {
    raw = store.read();
  } catch {
    raw = null;
  }
  return parseProfile(raw) ?? emptyProfile(now);
}

export function saveProfile(store: ProfileStore, profile: MilesProfile): void {
  try {
    store.write(JSON.stringify(profile));
  } catch {
    /* storage unavailable — degrade silently, like every other local store */
  }
}

function mutate(
  fn: (p: MilesProfile, now: number) => void,
  store: ProfileStore = localProfileStore,
  now: number = Date.now(),
): MilesProfile {
  const p = loadProfile(store, now);
  fn(p, now);
  saveProfile(store, p);
  return p;
}

// ------------------------------------------------------------ decay (read-time aging)

/** Inferred confidence holds full strength this long after its last evidence… */
export const INFER_GRACE_MS = 90 * 24 * 60 * 60 * 1000;
/** …then halves every this-long while it goes unused. */
export const INFER_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
/** Below this effective confidence an inferred affinity no longer surfaces in reads. */
export const INFER_MIN_CONFIDENCE = 0.15;

export function agedConfidence(entry: InferredTopicAffinity, now: number): number {
  const idle = now - entry.updatedAt;
  if (idle <= INFER_GRACE_MS) return entry.confidence;
  const halfLives = (idle - INFER_GRACE_MS) / INFER_HALF_LIFE_MS;
  return entry.confidence * Math.pow(0.5, halfLives);
}

// ------------------------------------------------------------ declared mutations

export function setDeclaredTaste(
  field: TasteField,
  values: string[],
  provenance: string,
  store: ProfileStore = localProfileStore,
  now: number = Date.now(),
): MilesProfile {
  const vocab =
    field === 'cuisines'
      ? CUISINE_OPTIONS
      : field === 'drinks'
        ? DRINK_OPTIONS
        : field === 'activities'
          ? ACTIVITY_OPTIONS
          : STORY_TOPICS;
  const clean = [...new Set(values.filter(v => (vocab as readonly string[]).includes(v)))];
  return mutate((p, t) => {
    p.tastes[field] = { value: clean, source: 'declared', provenance, updatedAt: t, confidence: null } as never;
  }, store, now);
}

export function setDeclaredConstraint<K extends ConstraintField>(
  field: K,
  value: MilesProfile['constraints'][K] extends ProfileEntry<infer T> | null ? T : never,
  provenance: string,
  store: ProfileStore = localProfileStore,
  now: number = Date.now(),
): MilesProfile {
  return mutate((p, t) => {
    (p.constraints[field] as ProfileEntry<unknown> | null) = {
      value,
      source: 'declared',
      provenance,
      updatedAt: t,
      confidence: null,
    };
  }, store, now);
}

/** Remove one declared entry (a taste field or a constraint field). */
export function clearDeclared(
  section: 'tastes' | 'constraints',
  field: TasteField | ConstraintField,
  store: ProfileStore = localProfileStore,
  now: number = Date.now(),
): MilesProfile {
  return mutate(p => {
    if (section === 'tastes') p.tastes[field as TasteField] = null;
    else p.constraints[field as ConstraintField] = null;
  }, store, now);
}

/** Forget one inferred topic affinity (the Your Miles screen's per-entry delete). */
export function deleteInferredTopic(
  topic: string,
  store: ProfileStore = localProfileStore,
  now: number = Date.now(),
): MilesProfile {
  return mutate(p => {
    delete p.inferredTopics[topic];
  }, store, now);
}

export function setPaused(
  paused: boolean,
  store: ProfileStore = localProfileStore,
  now: number = Date.now(),
): MilesProfile {
  return mutate(p => {
    p.paused = paused;
  }, store, now);
}

export function setSeedState(
  state: MilesProfile['seedState'],
  store: ProfileStore = localProfileStore,
  now: number = Date.now(),
): MilesProfile {
  return mutate(p => {
    p.seedState = state;
  }, store, now);
}

/** Erase the whole profile from this device. */
export function wipeProfile(store: ProfileStore = localProfileStore): void {
  try {
    store.clear();
  } catch {
    /* ignore */
  }
}

/** True when the seed card should be offered: never completed, never skipped. */
export function shouldOfferSeed(store: ProfileStore = localProfileStore, now: number = Date.now()): boolean {
  return loadProfile(store, now).seedState === 'not-offered';
}

// ------------------------------------------------------------ read API (for future consumers)
// The current-events layer will consume exactly these three
// reads. All of them honor the pause: paused → empty. Declared
// constraints are returned verbatim (hard filters); inferred
// affinities are aged at read time and thresholded.

export interface ResolvedConstraints {
  budgetComfort: BudgetComfort | null;
  maxDetourMinutes: number | null;
  alcoholOk: boolean | null;
  usuallyWithKids: boolean | null;
  dogFriendly: boolean | null;
  walkingTolerance: WalkingTolerance | null;
  surpriseTolerance: SurpriseTolerance | null;
  dietary: string[];
}

const EMPTY_CONSTRAINTS: ResolvedConstraints = {
  budgetComfort: null,
  maxDetourMinutes: null,
  alcoholOk: null,
  usuallyWithKids: null,
  dogFriendly: null,
  walkingTolerance: null,
  surpriseTolerance: null,
  dietary: [],
};

export function getConstraints(
  store: ProfileStore = localProfileStore,
  now: number = Date.now(),
): ResolvedConstraints {
  const p = loadProfile(store, now);
  if (p.paused) return { ...EMPTY_CONSTRAINTS, dietary: [] };
  const c = p.constraints;
  return {
    budgetComfort: c.budgetComfort?.value ?? null,
    maxDetourMinutes: c.maxDetourMinutes?.value ?? null,
    alcoholOk: c.alcoholOk?.value ?? null,
    usuallyWithKids: c.usuallyWithKids?.value ?? null,
    dogFriendly: c.dogFriendly?.value ?? null,
    walkingTolerance: c.walkingTolerance?.value ?? null,
    surpriseTolerance: c.surpriseTolerance?.value ?? null,
    dietary: c.dietary?.value ?? [],
  };
}

export interface ProfileView {
  paused: boolean;
  seedState: MilesProfile['seedState'];
  tastes: {
    cuisines: string[];
    drinks: string[];
    activities: string[];
    storyTopics: string[];
  };
  constraints: ResolvedConstraints;
  /** Effective (aged) inferred affinities at or above the read threshold, strongest first. */
  inferredTopics: { topic: string; confidence: number; provenance: string; updatedAt: number }[];
  hasAnyDeclared: boolean;
}

/** The plain-language view behind the Your Miles screen. */
export function getProfile(store: ProfileStore = localProfileStore, now: number = Date.now()): ProfileView {
  const p = loadProfile(store, now);
  const inferredTopics = Object.values(p.inferredTopics)
    .map(e => ({ topic: e.topic, confidence: agedConfidence(e, now), provenance: e.provenance, updatedAt: e.updatedAt }))
    .filter(e => e.confidence >= INFER_MIN_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence);
  return {
    paused: p.paused,
    seedState: p.seedState,
    tastes: {
      cuisines: p.tastes.cuisines?.value ?? [],
      drinks: p.tastes.drinks?.value ?? [],
      activities: p.tastes.activities?.value ?? [],
      storyTopics: p.tastes.storyTopics?.value ?? [],
    },
    constraints: getConstraints(store, now),
    inferredTopics,
    hasAnyDeclared:
      TASTE_FIELDS.some(f => p.tastes[f] !== null) || CONSTRAINT_FIELDS.some(f => p.constraints[f] !== null),
  };
}

export interface MatchInputs {
  /** Story-topic weights for ranking: declared topics weigh 1; inferred weigh their aged confidence. */
  topics: { topic: string; weight: number; source: EntrySource }[];
  cuisines: string[];
  drinks: string[];
  activities: string[];
  dietary: string[];
}

/**
 * Everything a ranking consumer needs, merged. Declared beats
 * inferred on the same topic (the declaration shadows the guess
 * — it is never double-counted). Empty when paused.
 */
export function matchInputs(store: ProfileStore = localProfileStore, now: number = Date.now()): MatchInputs {
  const empty: MatchInputs = { topics: [], cuisines: [], drinks: [], activities: [], dietary: [] };
  const p = loadProfile(store, now);
  if (p.paused) return empty;
  const topics: MatchInputs['topics'] = [];
  const declaredTopics = new Set(p.tastes.storyTopics?.value ?? []);
  for (const topic of declaredTopics) topics.push({ topic, weight: 1, source: 'declared' });
  for (const e of Object.values(p.inferredTopics)) {
    if (declaredTopics.has(e.topic)) continue;
    const w = agedConfidence(e, now);
    if (w >= INFER_MIN_CONFIDENCE) topics.push({ topic: e.topic, weight: w, source: 'inferred' });
  }
  topics.sort((a, b) => b.weight - a.weight);
  return {
    topics,
    cuisines: p.tastes.cuisines?.value ?? [],
    drinks: p.tastes.drinks?.value ?? [],
    activities: p.tastes.activities?.value ?? [],
    dietary: p.constraints.dietary?.value ?? [],
  };
}

// ------------------------------------------------------------ export / import (portability)

/** The profile as a portable JSON document (an empty profile when none exists yet). */
export function exportProfile(store: ProfileStore = localProfileStore, now: number = Date.now()): string {
  return JSON.stringify(loadProfile(store, now), null, 2);
}

export type ImportResult = { ok: true } | { ok: false; error: string };

/**
 * Import a profile document (taste traveling to a new city).
 * Full validation via parseProfile: a document carrying a
 * forbidden key, a wrong version, or a corrupt shape is
 * rejected whole — imports never partially apply.
 */
export function importProfile(
  json: string,
  store: ProfileStore = localProfileStore,
): ImportResult {
  const parsed = parseProfile(json);
  if (!parsed) return { ok: false, error: 'That file is not a valid Miles profile.' };
  saveProfile(store, parsed);
  return { ok: true };
}

// ------------------------------------------------------------ inference (signal intake)
// Signals the app already generates on-device. These functions
// are the ONLY writers of inferred state, they write ONLY
// story-topic affinities, and they all no-op while paused.

const COMPLETION_DELTA = 0.25;
const CUTOFF_DELTA = -0.1;
const THREAD_PICK_DELTA = 0.4;
/** A cut-off only counts as a taste signal when the listener actually heard some of the story. */
export const CUTOFF_MIN_SOUNDED_MS = 10_000;

function bumpTopic(
  p: MilesProfile,
  topic: string,
  delta: number,
  provenance: string,
  now: number,
): void {
  const existing = p.inferredTopics[topic];
  const next = Math.min(1, Math.max(0, (existing?.confidence ?? 0) + delta));
  if (next <= 0) {
    // Nothing to remember: a lone weak negative never creates
    // an affinity from nothing, and a fully-eroded one is gone.
    delete p.inferredTopics[topic];
    return;
  }
  p.inferredTopics[topic] = {
    topic,
    source: 'inferred',
    provenance,
    updatedAt: now,
    confidence: next,
    evidenceCount: (existing?.evidenceCount ?? 0) + 1,
  };
}

/**
 * A story settled. Completed → its topics gain confidence.
 * Sounded but cut short (≥ CUTOFF_MIN_SOUNDED_MS heard) → a
 * weak negative. Never sounded, or barely heard → no signal:
 * a story the road took away is not a story the listener
 * rejected.
 */
export function observeStoryOutcome(
  args: { topics: string[]; completed: boolean; soundedMs: number },
  store: ProfileStore = localProfileStore,
  now: number = Date.now(),
): void {
  const topics = args.topics.filter(t => STORY_TOPICS.includes(t));
  if (topics.length === 0) return;
  mutate(p => {
    if (p.paused) return;
    if (args.completed) {
      for (const t of topics) bumpTopic(p, t, COMPLETION_DELTA, 'story-completion', now);
    } else if (args.soundedMs >= CUTOFF_MIN_SOUNDED_MS) {
      for (const t of topics) bumpTopic(p, t, CUTOFF_DELTA, 'story-cutoff', now);
    }
  }, store, now);
}

/** The listener deliberately picked this thread at the seam menu. */
export function observeThreadPick(
  topic: string,
  store: ProfileStore = localProfileStore,
  now: number = Date.now(),
): void {
  if (!STORY_TOPICS.includes(topic)) return;
  mutate(p => {
    if (p.paused) return;
    bumpTopic(p, topic, THREAD_PICK_DELTA, 'thread-pick', now);
  }, store, now);
}

/**
 * Tone picks and mode picks are real app signals, but the v1
 * field list has no tone or mode slot — and inference must not
 * invent categories outside the field list. These intakes
 * therefore deliberately record NOTHING. They exist so call
 * sites have one obvious home if a future, Erik-approved field
 * ever consumes these signals.
 */
export function observeTonePick(_tone: string | null): void {
  /* no v1 field consumes tone picks — see the module header */
}
export function observeModePick(_mode: string): void {
  /* no v1 field consumes mode picks — see the module header */
}
