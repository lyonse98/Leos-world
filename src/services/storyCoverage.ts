// What Leo has already told this listener about a given subject, and which
// angle to take next.
//
// Every subject Leo can talk about has more than one story in it. A courthouse
// has its founding, the architect, the trial held there, the fire. A
// neighborhood has its people, its street grid, the creek that used to run
// through it. Telling each subject exactly once and then going silent wastes
// all of that — and it is worst on a commute, where the same ground is covered
// over and over.
//
// So instead of "have I told this subject?", the question becomes "which angles
// have I used on this subject, and which is next?" A subject is only exhausted
// once every angle is spent.
//
// Two things make this work:
//
// 1. Identity is the subject, not the position. A story about a neighborhood
//    used to be filed under the coordinates it was generated at — and a
//    coordinate changes as you drive, so it never matched itself twice. Filing
//    by subject means the same ground is recognised on every pass.
// 2. Angles are worked through in a fixed order, so the tenth pass through your
//    own neighborhood is genuinely a different story rather than a rerun.

// Roughly a neighborhood. Small enough that a story still describes where you
// are, large enough that driving in on a different road lands in the same cell
// and remembers what you have already heard.
const CELL_DEGREES = 0.015;

const STORAGE_KEY = 'leo_story_coverage';
const MAX_SUBJECTS = 300;
const MAX_RECENT_ANGLES = 6;

// Day-scoped subject state (locks, alias links, telling counts) — see
// the lockout section below for why the scope is a calendar day.
const DAY_STATE_KEY = 'leo_day_state';
// Cap-exempt major subjects (Tier-1 landmarks, library places). No date
// stamp: a place does not stop being major overnight.
const MAJOR_SUBJECTS_KEY = 'leo_major_subjects';
// Strict Tier-1 subjects (placesService's Tier-1 test), tracked
// separately from majors at large (pre-publish stack Item 1, Oct 27,
// 2026): Erik's retell policy is Tier-1-specific — a Tier-1 place is
// told again on a later encounter whenever an angle remains unheard,
// while a curated major that is not Tier-1 keeps the place-absolute
// session lock. No date stamp, like majors: a place does not stop
// being Tier-1 overnight, and the set is re-derived whenever a
// candidate pool evaluates the place anyway.
const TIER1_SUBJECTS_KEY = 'leo_tier1_subjects';

// Corridor subject keys (Item 6): banked freeway segment stories
// record coverage through the same hearing funnel as every story,
// but their retell rule is per-TOUR (the tour-heard record), never
// the day-scoped session lock — see settleSubjectHeard. Built with
// landmarkSubjectKey itself so the normalization can never drift
// from the keys the funnel actually produces.
const CORRIDOR_SUBJECT_KEYS = new Set(
  CORRIDOR_SEGMENTS.map(s => landmarkSubjectKey(s.displayName))
);

// Prominence-scaled daily cap: a MINOR subject (not Tier-1, not in the
// library) may be told at most this many times per calendar day across
// all sessions. Majors are exempt; area stories are the fall-through
// the cap steers toward and are never capped.
export const DAILY_MINOR_CAP = 2;

// The angles Leo takes on a neighborhood, in the order he works through them.
//
// Ordered deliberately: the first pass gives you the neighborhood's history and
// the people in it, the third brings you up to the present day, and the deeper
// passes are the ones a regular earns by coming back — the old creek under the
// parking lot, the street grid, the local legends.
export const AREA_ANGLES: readonly string[] = [
  'stationary_neighborhood',
  'stationary_figures',
  'stationary_recent',
  'stationary_names',
  'stationary_streets',
  'stationary_nature',
  'stationary_architecture',
  'stationary_economy',
  'stationary_culture',
  'stationary_food',
  'stationary_transport',
  'stationary_region',
  'stationary_demographics',
  'stationary_conflict',
  'stationary_geology',
  'stationary_folklore',
  'stationary_music', 'stationary_crime', 'stationary_education', 'stationary_women',
  'stationary_infrastructure', 'stationary_sports', 'stationary_events', 'stationary_lives',
];

// The angles Leo takes on a single landmark. A landmark earns fewer angles than
// a neighborhood because there is less of it to say — but six is enough that a
// regular who passes the same building every day still has something new to
// hear for a long while.
export const LANDMARK_ANGLES: readonly string[] = [
  'landmark_origin',
  'landmark_role',
  'landmark_people',
  'landmark_event',
  'landmark_building',
  'landmark_surroundings',
  'landmark_recent',
  'landmark_legends',
  'landmark_scandal', 'landmark_cultural', 'landmark_sports', 'landmark_music',
];

// How each angle is named. Used in the prompt, so Leo knows what to cover and
// what is already spent.
const ANGLE_LABELS: Record<string, string> = {
  stationary_neighborhood: 'neighborhood history',
  stationary_figures: 'the people who lived here',
  stationary_recent: 'recent history and what people still talk about',
  stationary_streets: 'street names and the grid',
  stationary_nature: 'natural features and the old landscape',
  stationary_architecture: 'building styles and eras',
  stationary_culture: 'local culture and traditions',
  stationary_transport: 'transportation history',
  stationary_region: 'the wider regional story',
  stationary_demographics: 'how the community changed',
  stationary_geology: 'geology and terrain',
  stationary_folklore: 'local legends and folklore',
  stationary_economy: 'what people did for work here, and how that shifted',
  stationary_conflict: 'disputes, strikes, protests, and moments of friction',
  stationary_food: 'the food culture — old markets, long-gone restaurants, what people ate',
  stationary_names: 'why things are called what they are — the origin of place and street names',
  landmark_origin: 'how it came to be, and what was there before it',
  landmark_role: 'what this place did — its ongoing function and purpose over the years',
  landmark_people: 'the people behind it',
  landmark_event: 'the notable thing that happened there',
  landmark_building: 'the building itself — its style and construction',
  landmark_surroundings: 'what used to be around it — the block it replaced, the neighbors it outlived',
  landmark_recent: 'what it has been in recent decades',
  landmark_legends: 'legends, rumors and local stories about it',
  stationary_music: 'music history — bands, venues, scenes, and sounds from this area',
  stationary_crime: 'crime and law — notorious cases, the justice system, law enforcement history',
  stationary_education: 'education history — schools, colleges, and how learning shaped this place',
  stationary_women: "women's history — the women who shaped this area and their stories",
  stationary_infrastructure: 'infrastructure hidden in plain sight — the systems beneath the street',
  stationary_sports: 'sports history — teams, games, arenas, and athletic legends',
  stationary_events: 'big cultural events — fairs, expos, festivals, and moments that defined the area',
  stationary_lives: 'famous lives — notable births, deaths, and residents connected to this place',
  landmark_scandal: 'the scandal or controversy connected to it',
  landmark_cultural: 'its cultural significance — art, music, or cultural impact',
  landmark_sports: 'the sports history connected to it',
  landmark_music: 'the music history connected to it',
};

export function describeAngle(angle: string): string {
  return ANGLE_LABELS[angle] ?? angle.replace(/^(stationary|landmark)_/, '').replace(/_/g, ' ');
}

// The landmark angle a display topic encodes (pre-publish stack
// Item 1, Oct 27, 2026): a bare topic is the canonical first telling
// (LANDMARK_ANGLES[0]); a "<Place> — <angle label>" topic names its
// angle through describeAngle, inverted here the same way the library
// inverts it for lookupForTopic. The hearing funnel needs this
// because library serves carry no rotation object — the topic is the
// only place their angle survives.
export function angleFromTopic(topic: string): string {
  const sep = topic.indexOf(' — ');
  if (sep === -1) return LANDMARK_ANGLES[0];
  const label = topic.slice(sep + 3).trim();
  return LANDMARK_ANGLES.find(a => describeAngle(a) === label) ?? LANDMARK_ANGLES[0];
}

export function areaSubjectKey(lat: number, lng: number): string {
  return `area:${Math.floor(lat / CELL_DEGREES)}_${Math.floor(lng / CELL_DEGREES)}`;
}

import { normalizePlaceName } from './placeName';
// Tour-thread topic tags (Oct 28, 2026): the app's existing tag
// vocabulary — the same derivation the taste machinery runs on told
// topics (recentPrimaryTags in gemini.ts reads it the same way). A
// pure module; no cycle.
import { deriveTags, describeTag, isInterestTag } from './storyTags';
// The durable heard record (pre-publish stack Item 1, Oct 27, 2026):
// the Tier-1 per-angle lock decision at settle time needs to know
// whether the canonical angle was already spent on this listener in
// an earlier tour, and that truth lives in heardStories. Acyclic:
// heardStories imports only supabase + placeName.
import { heardStories } from './heardStories';
// Corridor subjects (pre-publish stack Item 6, Oct 27, 2026): the
// segment display names, keyed as landmark subjects. The dataset is
// a pure data module — no cycle.
import { CORRIDOR_SEGMENTS } from '../data/corridors';

export function landmarkSubjectKey(name: string): string {
  return `landmark:${normalizePlaceName(name)}`;
}

// True when this angle was picked by rotation rather than being the canonical
// first telling of its subject. A rotation story is personal to the listener
// who earned it — which angle they got depends on what they had already heard
// — so it is never shared with other listeners, and never counted as the story
// of that landmark for a newcomer.
export function isRotationAngle(angle: string | null): boolean {
  if (!angle) return false;
  return angle.startsWith('stationary_') || angle !== LANDMARK_ANGLES[0];
}

// A stable name for an area the map has no name for. It describes the cell
// rather than the exact position, so it reads the same on every pass through.
export function describeArea(lat: number, lng: number): string {
  const cellLat = (Math.floor(lat / CELL_DEGREES) + 0.5) * CELL_DEGREES;
  const cellLng = (Math.floor(lng / CELL_DEGREES) + 0.5) * CELL_DEGREES;
  return `the area around ${cellLat.toFixed(3)}, ${cellLng.toFixed(3)}`;
}

// One committed telling in the tour telling ledger (see the ledger
// section below): a story handed to the player for a landmark
// subject, with the settle the hearing funnel eventually delivered
// for it. `angle` is the telling's rotation/library angle when known
// (null for angle-less serves); `text` is kept so a later retell of
// the same subject can carry it as its exclusion list.
interface TourTelling {
  angle: string | null;
  text: string;
  settled: boolean;
  delivered: boolean;
  // Tour thread (Oct 28, 2026): the display subject (the topic's base
  // name, as the listener heard it announced), the telling's topic
  // tags in the storyTags vocabulary, and its signature fact — the
  // lead captured at generation time, for live generations only. A
  // shelf serve records null: the library row carries no designated
  // lead line, and a lead is never derived from the text or invented
  // after the fact. These fields are read only once the telling is
  // DELIVERED — the thread is what the driver actually heard.
  topicBase?: string;
  tags?: string[];
  signatureFact?: string | null;
  // Hearing order within the tour: a per-tour sequence stamped only
  // at a DELIVERED settle, so the thread reads in the order the
  // listener met the stories, not the order the pipeline dealt them.
  threadOrder?: number;
}

// One entry of the tour thread: a delivered telling reduced to the
// compact digest the next live generation is fed — subject, topic
// tags, and (where one was captured) the telling's signature fact.
export interface TourThreadEntry {
  subject: string;
  tags: string[];
  signatureFact: string | null;
}

type SubjectCoverage = Record<string, number>;

interface StoredCoverage {
  cells: Record<string, SubjectCoverage>;
  recent: string[];
}

interface StoredDayState {
  date: string;
  locks: string[];
  aliases: [string, string][];
  counts: Record<string, number>;
}

class StoryCoverageService {
  private subjects: Record<string, SubjectCoverage> = {};
  private recent: string[] = [];

  constructor() {
    this.load();
    this.loadDayState();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredCoverage;
      if (!parsed || typeof parsed !== 'object') return;
      if (parsed.cells && typeof parsed.cells === 'object') this.subjects = parsed.cells;
      if (Array.isArray(parsed.recent)) this.recent = parsed.recent.slice(-MAX_RECENT_ANGLES);
    } catch {
      // storage unavailable or corrupt — start with a clean slate
    }
  }

  private save(): void {
    try {
      const entries = Object.entries(this.subjects);
      if (entries.length > MAX_SUBJECTS) {
        // A route driven for years would otherwise grow this without bound.
        // The least recently visited subjects are the ones least likely to be
        // driven again.
        entries.sort((a, b) => this.latestTold(b[1]) - this.latestTold(a[1]));
        this.subjects = Object.fromEntries(entries.slice(0, MAX_SUBJECTS));
      }
      const payload: StoredCoverage = { cells: this.subjects, recent: this.recent };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // storage unavailable — coverage is lost between sessions, nothing breaks
    }
  }

  private latestTold(coverage: SubjectCoverage): number {
    return Object.values(coverage).reduce((max, at) => Math.max(max, at), 0);
  }

  // Every angle already covered on this subject.
  getToldAngles(subjectKey: string): string[] {
    const coverage = this.subjects[subjectKey];
    if (!coverage) return [];
    return Object.keys(coverage);
  }

  // --- Day-scoped landmark lockout + telling tally -------------------------
  // Within one tour, once a landmark's story has been told while the
  // listener is moving, that landmark is out — no fresh-angle retell
  // while they are still in its area. Angle rotation is for dwell
  // (parked, depth is the point) and for return visits on a later day,
  // both of which bypass this lock.
  //
  // The lock set is DAY-scoped, not tour-scoped (Oct 25 amendment): it
  // persists across tour restarts within the same calendar day, in
  // localStorage next to the coverage record. The failure this fixes
  // was precise — the lock lived in memory and cleared at every tour
  // start, so a minor place (Balboa Avenue Station) became fully
  // eligible after each of the day's nine restarts and, with angle
  // coverage rotating by design, was told ~10 times in one day, every
  // telling individually rule-abiding. A new calendar day clears the
  // set; the dwell exception is untouched because the checks, not the
  // set, are what movement mode gates.
  //
  // Alongside the locks, a per-day telling tally per subject powers
  // the prominence-scaled daily cap (minor subjects: DAILY_MINOR_CAP
  // tellings/day across ALL sessions — see recordDailyTelling). Alias
  // groups persist with the locks so a place locked or counted under
  // one name stays bound under its variants for the whole day.
  private sessionLockedSubjects: Set<string> = new Set();

  // Session alias groups: subject keys proven to be the SAME place under
  // different names (a Google candidate and a registry record at the same
  // ground, linked when the candidate pool is assembled). Locking or
  // checking any member binds the whole group — otherwise the lockout
  // holds only the spelling that happened to be told, and the same place
  // walks back in under its other name. The links are re-derived on every
  // candidate merge and persist with the day state.
  private sessionAliasGroups: Map<string, Set<string>> = new Map();

  // Per-day telling counts by subject key (landmarks only — area
  // stories are the fall-through the cap steers TOWARD, never capped).
  private dailyCounts: Record<string, number> = {};
  private dayStamp: string = StoryCoverageService.todayStamp();

  // Subjects exempt from the daily cap because they are majors: Tier-1
  // landmarks and curated major places (marked when a candidate pool
  // EVALUATES them — fact-pack assembly, curated-list merge — never
  // merely because a serve happened to come from the library; fix
  // stack D4, Oct 27, 2026). Unlike the day state this set does not
  // expire — a place does not stop being major overnight; it is
  // re-derived whenever the place is evaluated anyway.
  private majorSubjects: Set<string> = new Set();

  // Strict Tier-1 subjects, a subset of the majors (pre-publish stack
  // Item 1): marked by the same candidate-pool evaluation that marks
  // majors (markTier1Majors in gemini.ts), persisted like majors. The
  // retell policy consults this set, NOT the majors set at large —
  // a curated major that never passed the Tier-1 test keeps the old
  // place-absolute lock.
  private tier1Subjects: Set<string> = new Set();

  // Landmark subjects HEARD on THIS tour (pre-publish stack Item 1):
  // the record Erik's minor-place rule reads — one telling per minor
  // place per tour, full stop. Tour-scoped on purpose: the session
  // lock set above is DAY-scoped (the Oct 25 anti-restart-churn
  // amendment), but the minor rule is stated per tour, so it gets its
  // own record, cleared at every tour start (beginSession) and
  // written only at a delivered settle (settleSubjectHeard) — a
  // minor story that dies unheard does not spend the place's one
  // telling. In-memory only: a page reload ends the tour anyway.
  private tourHeardSubjects: Set<string> = new Set();

  // Subjects with a story SERVED (handed to the player) but not yet
  // settled — the in-flight half of coverage-at-hearing (fix stack
  // RC-2, Oct 27, 2026). Coverage used to be recorded at generation /
  // queue time, so every story that later died — stale drop, timeout,
  // displacement, teardown — had already burned its subject for the
  // session and the day. Now the serve only marks the subject
  // in-flight (a generation/selection guard, like pendingSubjects);
  // the lock, the daily count, and the heard record land exclusively
  // in settleSubjectHeard, which the app calls from the player's
  // settle callback when a story is actually HEARD (sounded AND
  // completed). A non-delivered settle releases the in-flight mark
  // and records nothing. In-memory only: a page reload kills the
  // served story with the page, so there is nothing to persist.
  private inFlightSubjects: Set<string> = new Set();

  // Tour telling ledger (told-subject integrity, Oct 28, 2026): every
  // telling COMMITTED to the player this tour, per landmark subject —
  // written at queue time by the app's hearing funnel
  // (registerHearing), settled by the same funnel. Erik's Oct 28
  // ruling: a place counts as told from the moment it is QUEUED, not
  // from the moment it is heard. The Oct 28 field drive showed why:
  // "told" used to land only at playback completion, so a place
  // sitting in the player queue was invisible to selection — NASSCO
  // was served three times in ~60s by the tenant redirect while its
  // first telling waited unplayed, and a second angle of the San
  // Diego California Temple was dealt while its first was still in
  // the queue. The in-flight set above covers some of that window,
  // but not every serve path consults it (the tenant redirect did
  // not), and it releases the instant a telling settles — including
  // the delivered settle after which Erik's per-tour rules (minor
  // one-telling, Tier-1 one-retell cap) must still bind. The ledger
  // is the one record every serve path now consults. Tour-scoped and
  // in-memory, like the tour-heard record; alias-group aware like
  // every other subject operation.
  //
  // Settle semantics, reconciled with coverage-at-hearing (fix stack
  // RC-2): a telling that settles UNDELIVERED records nothing beyond
  // its own settle — the subject is free again exactly as RC-2 ruled
  // (a displaced major must be re-servable later in the drive; that
  // recycling is deliberate and verified). What the ledger changes
  // is the QUEUED window and the delivered aftermath: while any
  // telling is unsettled the subject is told for every selection
  // purpose, and once a telling is DELIVERED the per-tour rules
  // below bind for the rest of the tour.
  private tourTellings: Map<string, TourTelling[]> = new Map();

  // Tour-thread delivery sequence (Oct 28, 2026): stamped onto a
  // telling at its delivered settle (see settleSubjectQueued), reset
  // with the ledger at every tour start.
  private threadSeq = 0;

  // Tier-1 subjects whose one permitted retell was attempted and
  // DECLINED by the disparateness gate this tour (the generation
  // could not fill a genuinely different story without reusing the
  // first telling's facts). A declined subject is mention-only for
  // the rest of the tour: no serve path may deal it a story again,
  // and the gate does not re-attempt the generation.
  private retellDeclinedSubjects: Set<string> = new Set();

  private static todayStamp(): string {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  private loadDayState(): void {
    try {
      const rawMajors = localStorage.getItem(MAJOR_SUBJECTS_KEY);
      if (rawMajors) {
        const parsed = JSON.parse(rawMajors) as unknown;
        if (Array.isArray(parsed)) {
          this.majorSubjects = new Set(parsed.filter((k): k is string => typeof k === 'string'));
        }
      }
      const rawTier1 = localStorage.getItem(TIER1_SUBJECTS_KEY);
      if (rawTier1) {
        const parsed = JSON.parse(rawTier1) as unknown;
        if (Array.isArray(parsed)) {
          this.tier1Subjects = new Set(parsed.filter((k): k is string => typeof k === 'string'));
        }
      }
      const raw = localStorage.getItem(DAY_STATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredDayState;
      if (!parsed || parsed.date !== this.dayStamp) return; // a new day starts clean
      if (Array.isArray(parsed.locks)) {
        this.sessionLockedSubjects = new Set(parsed.locks.filter(k => typeof k === 'string'));
      }
      if (Array.isArray(parsed.aliases)) {
        for (const pair of parsed.aliases) {
          if (Array.isArray(pair) && pair.length === 2) {
            this.linkSubjectsInternal(pair[0], pair[1]);
          }
        }
      }
      if (parsed.counts && typeof parsed.counts === 'object') {
        this.dailyCounts = parsed.counts;
      }
    } catch {
      // storage unavailable or corrupt — day state lives in memory only
    }
  }

  private saveDayState(): void {
    try {
      const pairs: [string, string][] = [];
      const seenGroups = new Set<Set<string>>();
      for (const group of this.sessionAliasGroups.values()) {
        if (seenGroups.has(group)) continue;
        seenGroups.add(group);
        const members = [...group];
        for (let i = 1; i < members.length; i++) pairs.push([members[0], members[i]]);
      }
      const payload: StoredDayState = {
        date: this.dayStamp,
        locks: [...this.sessionLockedSubjects],
        aliases: pairs,
        counts: this.dailyCounts,
      };
      localStorage.setItem(DAY_STATE_KEY, JSON.stringify(payload));
    } catch {
      // storage unavailable — the in-memory day state still applies
    }
  }

  private saveMajors(): void {
    try {
      localStorage.setItem(MAJOR_SUBJECTS_KEY, JSON.stringify([...this.majorSubjects]));
    } catch {
      // storage unavailable — majors live in memory only
    }
  }

  private saveTier1(): void {
    try {
      localStorage.setItem(TIER1_SUBJECTS_KEY, JSON.stringify([...this.tier1Subjects]));
    } catch {
      // storage unavailable — Tier-1 marks live in memory only
    }
  }

  // Day rollover, checked on entry to the day-state operations: a tour
  // left open across midnight (or a state restored from yesterday by a
  // fresh page load whose constructor ran before midnight) must not
  // carry yesterday's locks or counts into today.
  private syncDay(): void {
    const today = StoryCoverageService.todayStamp();
    if (today === this.dayStamp) return;
    this.dayStamp = today;
    this.sessionLockedSubjects.clear();
    this.sessionAliasGroups.clear();
    this.dailyCounts = {};
    this.saveDayState();
  }

  // Called at every tour start (locationTracker.reset). Same-day locks,
  // aliases, and counts SURVIVE — that is the point of the day scope.
  // The only work here is the rollover check.
  beginSession(): void {
    this.syncDay();
    // The tour-heard record is the one per-TOUR structure in this
    // service (pre-publish stack Item 1): a new tour starts with no
    // minor place yet told on it, whatever earlier tours today did.
    this.tourHeardSubjects.clear();
    // The telling ledger and the retell-decline record are per-tour
    // for the same reason (told-subject integrity, Oct 28, 2026): a
    // new tour starts with nothing yet told on it.
    this.tourTellings.clear();
    this.retellDeclinedSubjects.clear();
    this.threadSeq = 0;
    // Corridor triggers are per-tour too (Item 6 refinement): a
    // segment triggered on the drive out is not triggered on the
    // drive home — the return direction is a different segment
    // anyway, and this direction must earn its own observation.
    this.corridorTriggered.clear();
  }

  private linkSubjectsInternal(keyA: string, keyB: string): void {
    if (!keyA || !keyB || keyA === keyB) return;
    const groupA = this.sessionAliasGroups.get(keyA);
    const groupB = this.sessionAliasGroups.get(keyB);
    const merged = new Set<string>([keyA, keyB, ...(groupA ?? []), ...(groupB ?? [])]);
    for (const member of merged) this.sessionAliasGroups.set(member, merged);
  }

  linkSubjectAliases(keyA: string, keyB: string): void {
    this.syncDay();
    this.linkSubjectsInternal(keyA, keyB);
    this.saveDayState();
  }

  private aliasGroupOf(subjectKey: string): Set<string> {
    return this.sessionAliasGroups.get(subjectKey) ?? new Set([subjectKey]);
  }

  lockSubjectForSession(subjectKey: string): void {
    this.syncDay();
    for (const member of this.aliasGroupOf(subjectKey)) {
      this.sessionLockedSubjects.add(member);
    }
    this.saveDayState();
  }

  isSubjectLockedForSession(subjectKey: string): boolean {
    this.syncDay();
    for (const member of this.aliasGroupOf(subjectKey)) {
      if (this.sessionLockedSubjects.has(member)) return true;
    }
    return false;
  }

  // Pass 1 (Oct 27, 2026): release ONE subject (and its alias group)
  // from the session lock — the counterpart to lockSubjectForSession
  // for a story the platform killed before it was heard, so it can be
  // retold later in the same drive. Daily counts and coverage angles
  // are NOT rolled back: they record that a telling happened today,
  // which stays true.
  unlockSubjectForSession(subjectKey: string): void {
    this.syncDay();
    for (const member of this.aliasGroupOf(subjectKey)) {
      this.sessionLockedSubjects.delete(member);
    }
    this.saveDayState();
  }

  // --- Daily cap (prominence-scaled) ---------------------------------------
  // A minor subject may be TOLD at most DAILY_MINOR_CAP times per
  // calendar day across all sessions. Majors (Tier-1, library) are
  // exempt — their repeat tellings across a day of restarts are the
  // marquee working as intended; the cap exists so one minor place
  // cannot dominate a day through restart churn. Enforcement lives at
  // the selection/serve layers next to the lockout; this is the count.

  recordDailyTelling(subjectKey: string): void {
    if (!subjectKey.startsWith('landmark:')) return;
    this.syncDay();
    this.dailyCounts[subjectKey] = (this.dailyCounts[subjectKey] ?? 0) + 1;
    this.saveDayState();
  }

  // Tellings of this place today, summed across its alias group — a
  // telling recorded under any name variant counts toward the place.
  dailyTellingCount(subjectKey: string): number {
    this.syncDay();
    let total = 0;
    for (const member of this.aliasGroupOf(subjectKey)) {
      total += this.dailyCounts[member] ?? 0;
    }
    return total;
  }

  markMajorSubject(subjectKey: string): void {
    if (!subjectKey || this.majorSubjects.has(subjectKey)) return;
    this.majorSubjects.add(subjectKey);
    this.saveMajors();
  }

  isMajorSubject(subjectKey: string): boolean {
    for (const member of this.aliasGroupOf(subjectKey)) {
      if (this.majorSubjects.has(member)) return true;
    }
    return false;
  }

  // Tier-1 marks (pre-publish stack Item 1): set only when a
  // candidate pool EVALUATES the place against the strict Tier-1
  // test — the same discipline as majors (D4), never at a serve.
  markTier1Subject(subjectKey: string): void {
    if (!subjectKey || this.tier1Subjects.has(subjectKey)) return;
    this.tier1Subjects.add(subjectKey);
    this.saveTier1();
  }

  isTier1Subject(subjectKey: string): boolean {
    for (const member of this.aliasGroupOf(subjectKey)) {
      if (this.tier1Subjects.has(member)) return true;
    }
    return false;
  }

  // --- Tour-heard record + the minor retell rule (Item 1) --------------
  // Written exclusively at a delivered settle (settleSubjectHeard),
  // read by every serve flavor through isMinorRetellBlocked. Alias
  // groups bind like every other subject operation: a place heard
  // under one name is heard under its variants.

  private recordTourHeard(subjectKey: string): void {
    for (const member of this.aliasGroupOf(subjectKey)) {
      this.tourHeardSubjects.add(member);
    }
  }

  hasHeardThisTour(subjectKey: string): boolean {
    for (const member of this.aliasGroupOf(subjectKey)) {
      if (this.tourHeardSubjects.has(member)) return true;
    }
    return false;
  }

  // Corridor triggers (Item 6 traffic handoff, Erik's refinement,
  // Oct 27, 2026): the ≥15 m/s highway gate governs corridor
  // TRIGGERING — a segment's banked story may first serve only when
  // a serve cycle observes the driver inside the segment at gate
  // speed. Once triggered, the segment stays serve-eligible for the
  // rest of the traversal even if traffic collapses the speed: the
  // story narrates where the driver still is, and Erik's free-flow
  // sizing (the story ends ~10% early at design speed) is exactly
  // what makes a slow traversal's remainder somebody else's job.
  // Chaining is NOT grandfathered: the next segment needs its own
  // trigger observation. Per-tour and in-memory, like the
  // tour-heard record; keyed by segment id.
  private corridorTriggered = new Set<string>();

  markCorridorTriggered(segmentId: string): void {
    this.corridorTriggered.add(segmentId);
  }

  isCorridorTriggered(segmentId: string): boolean {
    return this.corridorTriggered.has(segmentId);
  }

  // Corridor expiry (Oct 28, 2026): a banked segment story dropped
  // at the player because the driver had already exited the segment
  // settles UNDELIVERED (the telling ledger's ordinary release —
  // settleSubjectQueued(key, false) at the funnel), but the segment
  // itself is consumed for the tour: the serve gate's
  // hasHeardThisTour check must refuse it if the driver later loops
  // back onto the same ground. Records ONLY the tour-heard mark —
  // no daily tally, no session lock (a new tour is a new telling
  // context, exactly as for a delivered corridor telling). No-op
  // for any key that is not a corridor subject.
  markCorridorSegmentConsumed(subjectKey: string): void {
    if (!CORRIDOR_SUBJECT_KEYS.has(subjectKey)) return;
    this.recordTourHeard(subjectKey);
  }

  // Erik's minor rule (Oct 27, 2026): a minor place — not Tier-1, not
  // a marked major — gets ONE telling per tour, full stop. Once any
  // angle of it has been heard on this tour, no other angle serves,
  // from the library shelf, the ephemeral cache, the local buffer, or
  // live selection, moving or parked. Tier-1 places are governed by
  // the per-angle lock instead (settleSubjectHeard); marked majors
  // keep their previous behavior (place-absolute day lock while
  // moving, dwell revisit allowed).
  isMinorRetellBlocked(subjectKey: string): boolean {
    if (!subjectKey.startsWith('landmark:')) return false;
    if (this.isMajorSubject(subjectKey) || this.isTier1Subject(subjectKey)) return false;
    return this.hasHeardThisTour(subjectKey);
  }

  isDailyCapped(subjectKey: string): boolean {
    if (this.isMajorSubject(subjectKey)) return false;
    return this.dailyTellingCount(subjectKey) >= DAILY_MINOR_CAP;
  }

  // --- Pending subjects (generation guard) ---------------------------------
  // Subjects with a story already generated and waiting unplayed in the
  // local cache. Subject selection must not generate ANOTHER story
  // about a pending subject: across successive prefetch cycles the
  // first story hasn't played yet, so nothing about the subject is
  // locked, heard, or covered — without this guard each cycle deals
  // the same place a fresh angle, and the buffer fills with one place
  // wearing five angles (the generation half of the Balboa pile-up;
  // the serve half was the unmarked lock). storyCache re-derives this
  // set from its cache contents on every mutation, so it cannot leak:
  // a pending subject exists exactly while its story sits unplayed.
  // Generation-only — serving the pending story itself is the point.
  private pendingSubjects: Set<string> = new Set();

  setPendingSubjects(keys: Iterable<string>): void {
    this.pendingSubjects = new Set(keys);
  }

  isSubjectPending(subjectKey: string): boolean {
    for (const member of this.aliasGroupOf(subjectKey)) {
      if (this.pendingSubjects.has(member)) return true;
      // A subject with a story in the player (served, awaiting its
      // settle) is pending for generation purposes exactly like a
      // buffered one: generating a second angle before the first is
      // heard is how one place fills the buffer.
      if (this.inFlightSubjects.has(member)) return true;
    }
    return false;
  }

  // --- In-flight subjects (served, not yet heard) ---------------------------
  // See the inFlightSubjects declaration for the doctrine. Alias-group
  // aware like every other subject operation: a serve under either
  // name binds the place.

  markSubjectInFlight(subjectKey: string): void {
    if (!subjectKey) return;
    for (const member of this.aliasGroupOf(subjectKey)) {
      this.inFlightSubjects.add(member);
    }
  }

  releaseSubjectInFlight(subjectKey: string): void {
    if (!subjectKey) return;
    for (const member of this.aliasGroupOf(subjectKey)) {
      this.inFlightSubjects.delete(member);
    }
  }

  isSubjectInFlight(subjectKey: string): boolean {
    for (const member of this.aliasGroupOf(subjectKey)) {
      if (this.inFlightSubjects.has(member)) return true;
    }
    return false;
  }

  // --- Tour telling ledger (told-subject integrity, Oct 28, 2026) --------
  // Written and settled by the app's hearing funnel — registerHearing
  // at queue time, settleHearing at the player's settle — so the
  // record exists for exactly the stories the listener was actually
  // dealt, whatever serve flavor produced them (live, cache, library,
  // tenant redirect, catch-up batch). Landmark subjects only: area
  // stories have their own angle coverage and no per-tour telling
  // rule.

  markSubjectQueued(
    subjectKey: string,
    angle: string | null,
    text: string,
    meta?: { topic?: string; signatureFact?: string | null }
  ): void {
    if (!subjectKey || !subjectKey.startsWith('landmark:')) return;
    const list = this.tourTellings.get(subjectKey) ?? [];
    list.push({
      angle,
      text,
      settled: false,
      delivered: false,
      topicBase: meta?.topic ? meta.topic.split(' — ')[0].trim() : undefined,
      tags: this.threadTagsFor(meta?.topic, angle, text),
      signatureFact: meta?.signatureFact ?? null,
    });
    this.tourTellings.set(subjectKey, list);
  }

  // The telling's thread tags: its rotation angle's label first (the
  // vocabulary the prompt already speaks — the canonical first angle
  // is the default telling and adds nothing, so it is skipped), then
  // interest tags derived from the topic + text by the existing
  // storyTags machinery — the same tag set the taste profile derives
  // from a told topic. No new taxonomy, capped at three.
  private threadTagsFor(topic: string | undefined, angle: string | null, text: string): string[] {
    const tags: string[] = [];
    if (angle && angle !== LANDMARK_ANGLES[0]) tags.push(describeAngle(angle));
    const base = topic ? topic.split(' — ')[0].trim() : '';
    for (const tag of deriveTags({ topic: base, text })) {
      if (tags.length >= 3) break;
      if (!isInterestTag(tag)) continue;
      const label = describeTag(tag);
      if (!tags.includes(label)) tags.push(label);
    }
    return tags.slice(0, 3);
  }

  // Settle the oldest unsettled telling of this subject. The funnel
  // registers and settles under the same derived key; the alias-group
  // scan is the fallback for a serve that registered under a variant.
  settleSubjectQueued(subjectKey: string, delivered: boolean): void {
    if (!subjectKey || !subjectKey.startsWith('landmark:')) return;
    const own = this.tourTellings.get(subjectKey) ?? [];
    let open = own.find(t => !t.settled);
    if (!open) {
      for (const member of this.aliasGroupOf(subjectKey)) {
        if (member === subjectKey) continue;
        open = (this.tourTellings.get(member) ?? []).find(t => !t.settled);
        if (open) break;
      }
    }
    if (!open) return;
    open.settled = true;
    open.delivered = delivered;
    if (delivered) {
      // Tour thread (Oct 28, 2026): a delivered telling joins the
      // thread in HEARING order — the sequence stamps here, at the
      // settle, so a story queued early but heard late takes its
      // place where the listener actually met it. An undelivered
      // settle stamps nothing: the telling never enters the thread.
      open.threadOrder = ++this.threadSeq;
    }
  }

  private tellingsFor(subjectKey: string): TourTelling[] {
    const out: TourTelling[] = [];
    for (const member of this.aliasGroupOf(subjectKey)) {
      const list = this.tourTellings.get(member);
      if (list) out.push(...list);
    }
    return out;
  }

  // Every telling committed this tour (queued, playing, or settled).
  tourTellingCount(subjectKey: string): number {
    return this.tellingsFor(subjectKey).length;
  }

  // Tellings that were actually HEARD this tour (delivered settles).
  deliveredTellingCount(subjectKey: string): number {
    return this.tellingsFor(subjectKey).filter(t => t.settled && t.delivered).length;
  }

  // A telling has been dealt and its settle has not landed: the
  // subject is mid-telling, and NO serve path may deal it again.
  hasUnsettledTelling(subjectKey: string): boolean {
    return this.tellingsFor(subjectKey).some(t => !t.settled);
  }

  toldAnglesThisTour(subjectKey: string): string[] {
    return [
      ...new Set(
        this.tellingsFor(subjectKey)
          .map(t => t.angle)
          .filter((a): a is string => !!a)
      ),
    ];
  }

  // The first DELIVERED telling's text — the exclusion list a gated
  // retell generation must carry (Erik's disparateness rule: the
  // retell may spend only facts the first telling did not).
  firstDeliveredTellingText(subjectKey: string): string | null {
    const first = this.tellingsFor(subjectKey).find(t => t.settled && t.delivered);
    return first ? first.text : null;
  }

  // --- Tour thread (Oct 28, 2026) --------------------------------------
  // Erik's direction: stories should feel connected — Leo remembers
  // what he told earlier in the tour and can call back to it —
  // WITHOUT feeding whole prior stories into each new prompt. The
  // thread is that memory in compact form: this tour's DELIVERED
  // tellings, in hearing order, each reduced to subject + topic tags
  // + (for live generations) the signature fact captured when the
  // story was generated. buildStoryPrompt feeds it as continuity
  // material alongside the standing prohibitions; selection-side
  // topic PACING over the same data remains v15 work — this build
  // lands the data and the feed only.

  // The thread entries, most recent last. Delivered only, by
  // construction: an entry exists only where a telling carries a
  // threadOrder, which is stamped exclusively at a delivered settle.
  // A telling displaced before it ever played is absent however long
  // it sat queued — the thread is what the driver HEARD, not what
  // the pipeline dealt. Landmark subjects only, like the ledger
  // itself; area and intro tellings stay with the tracker's
  // last-topic / drive-arc material, as before.
  tourThread(limit: number = 10): TourThreadEntry[] {
    const heard: { order: number; entry: TourThreadEntry }[] = [];
    for (const [key, list] of this.tourTellings) {
      for (const t of list) {
        if (t.threadOrder === undefined) continue;
        heard.push({
          order: t.threadOrder,
          entry: {
            subject: t.topicBase || key.slice('landmark:'.length),
            tags: t.tags ?? [],
            signatureFact: t.signatureFact ?? null,
          },
        });
      }
    }
    heard.sort((a, b) => a.order - b.order);
    return heard.slice(-limit).map(h => h.entry);
  }

  // The thread as a prompt block, or '' when nothing has been heard
  // yet this tour — so a tour's first-story prompt is byte-identical
  // to the pre-thread prompt. Budget: ~40 tokens per telling with a
  // hard cap of ~500 tokens across the lines (1900 chars ≈ 475
  // tokens at the app's ~4 chars/token), oldest lines dropped first
  // when the cap binds. A signature fact rides only where one was
  // captured at generation; shelf tellings appear as subject + tags,
  // never with a derived or invented lead.
  tourThreadBlock(limit: number = 10): string {
    const entries = this.tourThread(limit);
    if (entries.length === 0) return '';
    const MAX_THREAD_LINE_CHARS = 1900;
    const lines: string[] = [];
    let used = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      const line =
        `${e.subject}` +
        (e.tags.length > 0 ? ` — ${e.tags.join(', ')}` : '') +
        (e.signatureFact ? ` — "${e.signatureFact}"` : '');
      if (lines.length > 0 && used + line.length > MAX_THREAD_LINE_CHARS) break;
      lines.unshift(line);
      used += line.length;
    }
    return (
      'TOUR THREAD SO FAR — the stories this listener has actually heard this tour, in order. ' +
      'This is continuity material, not content: you may weave AT MOST ONE line of callback or contrast drawn from it into this story. ' +
      'This story stays about the ground in front of you — nothing in the thread is retold or re-explained, and a fact listed under another place belongs to THAT place; never attribute it to the place you are telling now.\n' +
      lines.map((l, i) => `${i + 1}. ${l}`).join('\n')
    );
  }

  markRetellDeclined(subjectKey: string): void {
    for (const member of this.aliasGroupOf(subjectKey)) {
      this.retellDeclinedSubjects.add(member);
    }
  }

  isRetellDeclined(subjectKey: string): boolean {
    for (const member of this.aliasGroupOf(subjectKey)) {
      if (this.retellDeclinedSubjects.has(member)) return true;
    }
    return false;
  }

  // The NON-GATE selection verdict (Erik's Oct 28 ruling): true when
  // ordinary selection / serve paths must treat this subject as
  // already told this tour. A Tier-1 subject with a delivered telling
  // reads as told here even though fresh angles remain — its ONLY
  // re-entry is the disparateness-gated retell (canRetellTier1,
  // consulted by the revisit pool itself). Majors that are not
  // Tier-1 return false once settled: the session lock written at
  // the same settle governs them, exactly as before. Minors with a
  // delivered telling are told (the queue-era form of the one-
  // telling rule — the tour-heard record enforces the same thing).
  isSubjectToldForSelection(subjectKey: string): boolean {
    if (!subjectKey.startsWith('landmark:')) return false;
    if (this.hasUnsettledTelling(subjectKey)) return true;
    if (this.isRetellDeclined(subjectKey)) return true;
    const delivered = this.deliveredTellingCount(subjectKey);
    if (delivered === 0) return false;
    if (this.isTier1Subject(subjectKey)) return true;
    if (this.isMajorSubject(subjectKey)) return false;
    return true;
  }

  // May this Tier-1 subject be RETOLD right now (Erik's Oct 28
  // disparateness doctrine)? Exactly one delivered telling so far,
  // no telling in flight, and the gate has not already declined it.
  // The retell itself — gated generation, or a banked serve at a
  // genuinely different angle — is what consumes the slot: once a
  // second telling is DELIVERED the count reaches two and this
  // stays false for the rest of the tour (the one-retell cap).
  canRetellTier1(subjectKey: string): boolean {
    if (!subjectKey.startsWith('landmark:')) return false;
    if (!this.isTier1Subject(subjectKey)) return false;
    if (this.isRetellDeclined(subjectKey)) return false;
    if (this.hasUnsettledTelling(subjectKey)) return false;
    return this.deliveredTellingCount(subjectKey) === 1;
  }

  // The cache/library serve verdict: may a SHELF story about this
  // subject, at this angle, be dealt now? Refused while a telling
  // is unsettled (the pile-up window), after a declined retell, at
  // or past the Tier-1 cap, and — the disparateness test for pre-
  // authored material — when the angle on offer is one this tour
  // has already been dealt. A Tier-1 subject with exactly one
  // delivered telling may serve ONE more time from the shelf, at a
  // genuinely different angle: the shelved angles are separately
  // authored stories of the place, so angle-distinctness is the
  // disparateness evidence, and the serve consumes the retell slot
  // exactly as a gated generation would. Non-Tier-1 subjects defer
  // to the existing checks (session lock, minor rule, daily cap),
  // which the callers apply alongside this one.
  isServeRefusedByToldLedger(subjectKey: string, angle: string | null): boolean {
    if (!subjectKey.startsWith('landmark:')) return false;
    if (this.hasUnsettledTelling(subjectKey)) return true;
    if (this.isRetellDeclined(subjectKey)) return true;
    if (!this.isTier1Subject(subjectKey)) return false;
    const delivered = this.deliveredTellingCount(subjectKey);
    if (delivered >= 2) return true;
    if (delivered === 1 && angle !== null && this.toldAnglesThisTour(subjectKey).includes(angle)) {
      return true;
    }
    return false;
  }

  /**
   * THE hearing record for coverage (fix stack RC-2): called exactly
   * once per served story, from the player's settle, and only when
   * the story was delivered (sounded AND completed). Applies the
   * session lock and the daily telling count, and clears the
   * in-flight mark. Area keys clear their in-flight mark only — area
   * stories are never locked or capped (recordDailyTelling already
   * ignores non-landmark keys; the lock is landmark doctrine too).
   *
   * Tier-1 per-angle lock (pre-publish stack Item 1, Oct 27, 2026):
   * Erik's ruling — a Tier-1 place is told almost every time it is
   * encountered, as long as the angle is not re-used. So for a Tier-1
   * subject the session lock no longer lands at the first hearing:
   * it lands only when NO unheard angle remains, judged against the
   * coverage angles, the angle just heard (passed in — the funnel
   * calls this before the tracker's recordStoryHeard writes it), and
   * the canonical angle whenever the durable record says this
   * listener has heard the place before. Selection independently
   * gates Tier-1 retells on the same freshness test (resolveSubject's
   * revisit pool), so the lock here is the second belt, not the only
   * one. The daily count and the tour-heard record land on EVERY
   * delivered telling, Tier-1 or not — the count is a tally, not a
   * gate, and majors are cap-exempt anyway.
   */
  settleSubjectHeard(subjectKey: string, heardAngle?: string | null): void {
    if (!subjectKey) return;
    if (subjectKey.startsWith('landmark:')) {
      this.recordTourHeard(subjectKey);
      this.recordDailyTelling(subjectKey);
      if (CORRIDOR_SUBJECT_KEYS.has(subjectKey)) {
        // Corridor stories (Item 6) take NO session lock: Erik's
        // rule is one telling per (segment, direction) PER TOUR,
        // and the tour-heard record just written is the whole of
        // it. The day-scoped lock would also suppress the segment
        // on a second tour today — a new tour is a new telling
        // context, and the reverse direction home is a different
        // subject anyway. The alias-group check is unnecessary
        // here: corridor display names are unique by construction
        // and never alias with place names.
      } else if (this.isTier1Subject(subjectKey) && this.tier1HasFreshAngle(subjectKey, heardAngle)) {
        // Fresh angles remain: the place stays serve-eligible for a
        // later encounter this session (and this day — the lock set
        // is day-scoped, and leaving it unlocked is what lets a
        // second tour today re-tell it at a new angle).
      } else {
        this.lockSubjectForSession(subjectKey);
      }
    }
    this.releaseSubjectInFlight(subjectKey);
  }

  // Does a Tier-1 subject still have an angle this listener has not
  // heard, counting the angle being settled right now as spent?
  private tier1HasFreshAngle(subjectKey: string, heardAngle?: string | null): boolean {
    const name = subjectKey.slice('landmark:'.length);
    const spent: string[] = [];
    if (heardAngle) spent.push(heardAngle);
    if (heardStories.hasHeardSubject(name)) spent.push(LANDMARK_ANGLES[0]);
    return this.hasFreshAngle(subjectKey, LANDMARK_ANGLES, spent);
  }

  // Hard wipe of the lock/alias/day state only (the diagnostics full
  // reset calls resetAll, which wipes everything including storage).
  clearSessionLocks(): void {
    this.sessionLockedSubjects.clear();
    this.sessionAliasGroups.clear();
    this.inFlightSubjects.clear();
    this.tourTellings.clear();
    this.retellDeclinedSubjects.clear();
    this.threadSeq = 0;
    this.tourHeardSubjects.clear();
    this.corridorTriggered.clear();
    this.dailyCounts = {};
    this.dayStamp = StoryCoverageService.todayStamp();
    try {
      localStorage.removeItem(DAY_STATE_KEY);
    } catch {
      // storage unavailable — the in-memory wipe still applies
    }
  }

  // Full wipe — every angle on every subject forgotten, in memory and in
  // storage. Exists for field testing: a developer driving the same test
  // routes daily burns through their own coverage until Leo has nothing
  // left to say. Paired with the heard-stories reset and device-key
  // rotation in App, this makes the listener brand new again.
  resetAll(): void {
    this.subjects = {};
    this.recent = [];
    this.clearSessionLocks();
    this.tourTellings.clear();
    this.retellDeclinedSubjects.clear();
    this.majorSubjects.clear();
    this.tier1Subjects.clear();
    this.pendingSubjects.clear();
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(MAJOR_SUBJECTS_KEY);
      localStorage.removeItem(TIER1_SUBJECTS_KEY);
    } catch {
      // storage unavailable — the in-memory wipe still applies this session
    }
  }

  // True while this subject still has an angle Leo has not taken. Angles the
  // caller knows are spent but that are not recorded here — a landmark's
  // canonical telling, which lives in the heard-stories record rather than in
  // coverage — are passed in.
  hasFreshAngle(subjectKey: string, angles: readonly string[], alreadySpent: readonly string[] = []): boolean {
    return this.nextAngle(subjectKey, angles, alreadySpent) !== null;
  }

  // The next angle to take, or null once the subject is exhausted. Prefers an
  // angle that has not been used here AND was not just used somewhere else, so
  // two subjects in a row do not open the same way.
  nextAngle(
    subjectKey: string,
    angles: readonly string[],
    alreadySpent: readonly string[] = []
  ): string | null {
    const used = new Set([...this.getToldAngles(subjectKey), ...alreadySpent]);
    if (used.size >= angles.length) return null;

    const recentElsewhere = this.recent.slice(-2);
    return (
      angles.find(angle => !used.has(angle) && !recentElsewhere.includes(angle)) ??
      angles.find(angle => !used.has(angle)) ??
      null
    );
  }

  // Once every angle has been used, the subject starts again — oldest first, so
  // the least recent story is the one that comes back.
  leastRecentlyUsedAngle(subjectKey: string, angles: readonly string[]): string {
    const coverage = this.subjects[subjectKey] ?? {};
    let best = angles[0];
    let bestAt = Infinity;
    for (const angle of angles) {
      const at = coverage[angle] ?? 0;
      if (at < bestAt) {
        bestAt = at;
        best = angle;
      }
    }
    return best;
  }

  markTold(subjectKey: string, angle: string): void {
    const coverage = this.subjects[subjectKey] ?? {};
    coverage[angle] = Date.now();
    this.subjects[subjectKey] = coverage;

    // Tracked across subjects, not within one: a commuter passing from one
    // neighborhood into the next should not hear two folklore stories back to
    // back just because the two areas have never met.
    this.recent = [...this.recent.filter(a => a !== angle), angle].slice(-MAX_RECENT_ANGLES);

    this.save();
  }

  getRecentAngles(): string[] {
    return [...this.recent];
  }

  // Diagnostics only: how much of the rotation this listener has worked
  // through. Lets the coverage be checked without a debugger.
  getSubjectCount(): number {
    return Object.values(this.subjects).filter(coverage => Object.keys(coverage).length > 0).length;
  }

  getTotalAnglesCovered(): number {
    return Object.values(this.subjects).reduce((sum, coverage) => sum + Object.keys(coverage).length, 0);
  }
}

export const storyCoverage = new StoryCoverageService();
