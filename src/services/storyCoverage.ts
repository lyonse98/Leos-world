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

export function areaSubjectKey(lat: number, lng: number): string {
  return `area:${Math.floor(lat / CELL_DEGREES)}_${Math.floor(lng / CELL_DEGREES)}`;
}

import { normalizePlaceName } from './placeName';

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
  // landmarks (marked when a candidate pool evaluates them) and library
  // places (marked on a library serve). Unlike the day state this set
  // does not expire — a place does not stop being major overnight; it
  // is re-derived whenever the place is evaluated or served anyway.
  private majorSubjects: Set<string> = new Set();

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
    }
    return false;
  }

  // Hard wipe of the lock/alias/day state only (the diagnostics full
  // reset calls resetAll, which wipes everything including storage).
  clearSessionLocks(): void {
    this.sessionLockedSubjects.clear();
    this.sessionAliasGroups.clear();
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
    this.majorSubjects.clear();
    this.pendingSubjects.clear();
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(MAJOR_SUBJECTS_KEY);
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
