// The Earl duo — composition layer (v16.2 Slice 9, Nov 17, 2026).
//
// Path A of the second-persona design, under the render
// architecture Erik approved: THE LIBRARY IS NEVER RE-VOICED.
// A woven member's shelf audio plays byte-identical; Earl's
// lines are the only new audio — short connective segments
// (bank first, generated pair-specific lines last) seated at
// the member's seams as tissue items AROUND the story item:
// a setup before it, a turn beat and a verdict after it.
// (Mid-story audio insertion would require splitting the
// shelf WAV at its silences — a runner segment queue — and
// is NOT built in v1: the composed SCRIPT below records the
// turn beat at its true sentence-boundary seam, and the beat
// sounds in the post-story cluster, in script order.)
//
// This module is the composer-side half: eligibility and the
// persona's fences, the speaker-tagged script (Miles'
// segments are the twin's own sentences, verbatim — the
// integrity property the harness pins), the per-episode duo
// state (claims, the corrections tally Miles inflates IN
// WRITING ONLY, the rationed concession), the ≤25% word-share
// accounting over duo-eligible material, and the short-twin
// substitution that makes room for Earl inside a tight seat
// (the duo's seconds come out of the member's budget, never
// the episode's tiling — design addendum A.3.3).
//
// Solo parity is structural: with the duo off (or nothing
// eligible), applyDuoToPlan returns the plan object
// UNCHANGED — duo off is byte-for-byte today's episode.

import {
  colorSuppressedFor,
  memorialClassFor,
  servedShortCutUnit,
  canonicalStoryId,
  isShortCutAngle,
  type LibraryUnit,
  type PlanItem,
  type RoutePlan,
} from './routeMode';
import { bankLinesFor, duoLinesPrompt } from '../services/duoPersona';

/** Earl's measured brisk pace (audition recipe, Nov 17, 2026): chars per second. */
export const EARL_CHARS_PER_SEC = 13.5;
/** Line discipline: an Earl line is a sentence, rarely two — never a paragraph. */
export const EARL_LINE_MAX_CHARS = 140;
/** Duo share cap: Earl's words ≤ this fraction of duo-eligible words (design §3). */
export const DUO_SHARE_CAP = 0.25;
/** Per-member cap on Earl lines (design §3). */
export const DUO_MAX_LINES_PER_MEMBER = 3;
/** The grudging concession is rationed: at most one per episode (persona charter). */
export const DUO_MAX_CONCESSIONS = 1;

/** One turn of a duo script. Miles' segments are shelf text, verbatim. */
export interface DuoSegment {
  speaker: 'miles' | 'earl';
  text: string;
  /** 'shelf' = the twin's own text; 'generated' = per-episode pair-specific; 'bank'/'template' = stock. */
  source: 'shelf' | 'generated' | 'bank' | 'template';
  /** Earl segments only: the seam this line occupies. */
  role?: 'intro' | 'setup' | 'turn' | 'verdict' | 'bridge-beat';
}

/** A woven member's composed duo script (rides the member's plan item into capture). */
export interface DuoScript {
  memberId: string;
  segments: DuoSegment[];
}

/** Per-episode duo state — lives and dies with the episode (persona doctrine: no cross-episode ledger). */
export interface DuoEpisodeState {
  /** Earl's standing claims this episode (wrong assumptions the stories knocked down). */
  claims: string[];
  /** True corrections count. */
  corrections: number;
  /** The tally as Miles WRITES it — inflated, disputed, never settled (capture color only). */
  correctionsAsWritten: number;
  concessionsUsed: number;
  earlWords: number;
  eligibleWords: number;
  members: number;
  earlLines: number;
}

export function emptyDuoState(): DuoEpisodeState {
  return {
    claims: [],
    corrections: 0,
    correctionsAsWritten: 0,
    concessionsUsed: 0,
    earlWords: 0,
    eligibleWords: 0,
    members: 0,
    earlLines: 0,
  };
}

const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/** Expected sounding seconds of an Earl line at his brisk pace. */
export function earlDurationSec(text: string): number {
  return Math.max(2, Math.round((text.length / EARL_CHARS_PER_SEC) * 10) / 10);
}

/**
 * The verification gate (audition doctrine, Nov 17, 2026):
 * every generated Earl segment is measured against its
 * script before it may sound. A director's-notes leak makes
 * the render FAR longer than the line (the brisk run's leak
 * spoke the notes over a ~110-char line: ~28 s against an
 * ~8 s expectation); a truncated render runs far short.
 * Either way the segment is DROPPED — a missing beat is
 * invisible (skip-fallback). The band carries an absolute
 * slack so very short lines (whose renders pad with breath)
 * are not false-dropped.
 */
export function earlRenderPlausible(text: string, measuredSec: number): boolean {
  if (!Number.isFinite(measuredSec) || measuredSec <= 0) return false;
  const expected = text.length / EARL_CHARS_PER_SEC;
  if (Math.abs(measuredSec - expected) <= 1.2) return true;
  const ratio = measuredSec / expected;
  return ratio >= 0.5 && ratio <= 1.8;
}

/**
 * Sentence splitting that PRESERVES the source exactly:
 * concatenating the result reproduces the input byte-for-byte
 * (the duo script integrity property). Falls back to the
 * whole text as one segment when the split cannot be proven
 * lossless.
 */
export function splitSentencesExact(text: string): string[] {
  if (!text) return [];
  const parts = text.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g);
  if (!parts || parts.join('') !== text) return [text];
  return parts.filter(p => p.length > 0);
}

/** A unit Earl may ride: not memorial, not in the color-suppression class (somber/spooky/Protected/scandal). */
export function unitDuoClean(u: LibraryUnit): boolean {
  return !memorialClassFor(u) && !colorSuppressedFor(u);
}

/**
 * A plan item that may carry duo material: a WOVEN MEMBER
 * story (studio register, seated by seatWovenMembers) that is
 * duo-clean and not the climax. Presence stories are Miles
 * solo by fence — a windowed geo story is never woven, so the
 * woven flag IS the presence fence. The climax is fenced
 * whole (task scope: climax + solo closeout stay Miles').
 */
export function duoEligibleMember(item: PlanItem): boolean {
  return (
    item.kind === 'story' &&
    item.woven === true &&
    item.climax !== true &&
    item.unit !== undefined &&
    typeof item.unit.storyText === 'string' &&
    item.unit.storyText.trim().length > 0 &&
    unitDuoClean(item.unit)
  );
}

// ------------------------------------------------------------ generated-line validation

export interface DuoLine {
  role: 'setup' | 'turn' | 'verdict';
  move: string;
  text: string;
}

const DUO_ROLES = new Set(['setup', 'turn', 'verdict']);
const DUO_MOVES = new Set(['wrong-assumption', 'anachronism', 'tall-tale', 'concession', 'verdict', 'question']);

/**
 * Mechanically validate the generation lane's raw output
 * (design §6.3's mechanical check): a JSON array of tagged
 * lines; a line survives only with a known role and move, at
 * most one line per role, and text inside the char cap. A
 * concession line is dropped when the episode's ration is
 * spent. Anything unparseable yields no lines — the member
 * plays solo (or takes a bank verdict), never broken.
 */
export function parseDuoLines(raw: string, state: DuoEpisodeState): DuoLine[] {
  let parsed: unknown;
  try {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start < 0 || end <= start) return [];
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: DuoLine[] = [];
  const seenRoles = new Set<string>();
  let concessions = state.concessionsUsed;
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { role, move, text } = entry as { role?: unknown; move?: unknown; text?: unknown };
    if (typeof role !== 'string' || !DUO_ROLES.has(role) || seenRoles.has(role)) continue;
    if (typeof text !== 'string') continue;
    const line = text.trim();
    if (line.length === 0 || line.length > EARL_LINE_MAX_CHARS) continue;
    const m = typeof move === 'string' && DUO_MOVES.has(move) ? move : 'verdict';
    if (m === 'concession') {
      if (concessions >= DUO_MAX_CONCESSIONS) continue;
      concessions += 1;
    }
    seenRoles.add(role);
    out.push({ role: role as DuoLine['role'], move: m, text: line });
  }
  return out;
}

// ------------------------------------------------------------ script composition

/**
 * Compose one member's speaker-tagged script: Earl's lines at
 * the seams, Miles' segments the twin's own sentences in
 * order — their concatenation is byte-identical to the shelf
 * text (the integrity invariant). The turn beat sits at the
 * sentence boundary nearest the story's turn (~55% through).
 */
export function composeDuoScript(unit: LibraryUnit, lines: readonly DuoLine[]): DuoScript {
  const text = unit.storyText as string;
  const sentences = splitSentencesExact(text);
  const setup = lines.find(l => l.role === 'setup');
  const turn = lines.find(l => l.role === 'turn');
  const verdict = lines.find(l => l.role === 'verdict');
  // The turn seam: the sentence boundary nearest 55% of the text.
  let turnIdx = sentences.length;
  if (turn && sentences.length > 1) {
    const target = text.length * 0.55;
    let acc = 0;
    turnIdx = sentences.length - 1;
    for (let i = 0; i < sentences.length; i++) {
      acc += sentences[i].length;
      if (acc >= target) {
        turnIdx = i + 1;
        break;
      }
    }
    turnIdx = Math.max(1, Math.min(sentences.length - 1, turnIdx));
  }
  const segments: DuoSegment[] = [];
  if (setup) segments.push({ speaker: 'earl', text: setup.text, source: 'generated', role: 'setup' });
  const before = sentences.slice(0, turn ? turnIdx : sentences.length).join('');
  if (before) segments.push({ speaker: 'miles', text: before, source: 'shelf' });
  if (turn) segments.push({ speaker: 'earl', text: turn.text, source: 'generated', role: 'turn' });
  if (turn) {
    const after = sentences.slice(turnIdx).join('');
    if (after) segments.push({ speaker: 'miles', text: after, source: 'shelf' });
  }
  if (verdict) segments.push({ speaker: 'earl', text: verdict.text, source: 'generated', role: 'verdict' });
  if (segments.length === 0) segments.push({ speaker: 'miles', text, source: 'shelf' });
  return { memberId: unit.id, segments };
}

// ------------------------------------------------------------ bank beats (runner seats)

/** Earl's one reaction beat on a solicited/proposed suggestion — null when sponsored (Earl is absent from anything paid). */
export function earlSuggestionBeat(intent: string, sponsored: boolean, rotation = 0): string | null {
  if (sponsored) return null;
  const lines = bankLinesFor('suggestion', intent);
  if (lines.length === 0) return null;
  return lines[Math.abs(rotation) % lines.length].text;
}

/** Earl's grievance beat on a place-memory callback (the facts stay Miles'; the grievance is Earl's). */
export function earlCallbackBeat(rotation = 0): string | null {
  const lines = bankLinesFor('callback');
  if (lines.length === 0) return null;
  return lines[Math.abs(rotation) % lines.length].text;
}

// ------------------------------------------------------------ the staging pass

export interface DuoPassOptions {
  /** The duo gate (App: flag on + audience not Family). Off → the plan returns unchanged. */
  enabled: boolean;
  /** The build's full unit pool (short-twin substitution reads it). */
  units: readonly LibraryUnit[];
  heardKeys: ReadonlySet<string>;
  /** The text lane (App wires generateStoryText under the duo instruction); raw output, validated here. */
  generateLines: (prompt: string) => Promise<string>;
  onEvent?: (type: string, payload: Record<string, unknown>) => void;
}

interface SoundingSpan {
  item: PlanItem;
  start: number;
  end: number;
}

/** The standing interval model, mirrored from routeMode (soundingSpans): windowed stories sound across their windows, windowless at their anchors. */
function soundingSpansOf(items: PlanItem[], driveSec: number): SoundingSpan[] {
  const out: SoundingSpan[] = [];
  for (const it of items) {
    if ((it.kind !== 'story' && it.kind !== 'filler') || !it.unit) continue;
    const anchorSec = (it.anchorProgress ?? 0) * driveSec;
    const start = it.releaseProgress !== undefined ? it.releaseProgress * driveSec : anchorSec;
    const end = it.expireProgress !== undefined ? it.expireProgress * driveSec : start + it.durationSec;
    out.push({ item: it, start: Math.max(0, Math.min(driveSec, start)), end: Math.max(0, Math.min(driveSec, end)) });
  }
  return out.sort((a, b) => a.start - b.start);
}

function earlItem(args: {
  id: string;
  text: string;
  role: NonNullable<DuoSegment['role']>;
  memberId?: string;
  duoForId?: string;
}): PlanItem {
  return {
    kind: 'bridge',
    id: args.id,
    label: args.role === 'intro' ? 'Earl — intro' : `Earl — ${args.role}`,
    durationSec: earlDurationSec(args.text),
    text: args.text,
    ready: true,
    duo: { speaker: 'earl', role: args.role, ...(args.memberId ? { memberId: args.memberId } : {}) },
    ...(args.duoForId ? { duoForId: args.duoForId } : {}),
  };
}

/**
 * The duo staging pass (App build order: after colorize,
 * before wrap-up authoring — the wrap-up context and the
 * episode capture both see the duo plan). Pure but for the
 * injected generation lane; deterministic given its outputs.
 *
 * Order of work: fences → per-member short-twin substitution
 * for tight seats → per-member line generation under the
 * running duo state → bridge beats under the ≤½ cap → the
 * standing intro, seated only when Earl actually speaks in
 * the episode. The word-share budget binds throughout: when
 * it is spent, later members play solo.
 */
export async function applyDuoToPlan(plan: RoutePlan, opts: DuoPassOptions): Promise<RoutePlan> {
  if (!opts.enabled) return plan;
  // Fence: Family mode = duo off (design §4.5).
  if (plan.audience === 'family') return plan;
  // Fence: a memorial climax silences the whole episode's
  // banter, and the closeout after it is solo (design §4.1).
  const climaxItem = plan.items.find(i => i.climax === true);
  if (climaxItem?.unit && memorialClassFor(climaxItem.unit)) return plan;

  const driveSec = plan.driveSec ?? plan.budgetSec;
  if (!(driveSec > 0)) return plan;

  const state = emptyDuoState();
  const members = plan.items.filter(duoEligibleMember);
  const storyById = new Map<string, PlanItem>();
  for (const it of plan.items) if (it.kind === 'story') storyById.set(it.id, it);

  // Eligible bridges: composed pair tissue whose pair is
  // duo-clean on both sides and does not lead into the
  // climax (a payoff bridge stays a Miles moment).
  const eligibleBridges = plan.items.filter(it => {
    if (it.kind !== 'bridge' || typeof it.text !== 'string') return false;
    const prev = it.prevUnitId ? storyById.get(it.prevUnitId) : undefined;
    const next = it.nextUnitId ? storyById.get(it.nextUnitId) : undefined;
    if (next?.climax === true) return false;
    if (prev?.unit && !unitDuoClean(prev.unit)) return false;
    if (next?.unit && !unitDuoClean(next.unit)) return false;
    return true;
  });

  // The standing intro's Miles lines (template, persona doc):
  // they are duo-eligible material too, so their words stand
  // in the share denominator beside the members and bridges.
  const minutes = Math.max(1, Math.round(driveSec / 60));
  const introMiles1 =
    "I'm Miles. This is Earl — he rode these streets when they were streetcar lines, and crossed the bay on the ferry he crewed. I call him Grumps.";
  const introEarl = 'And I call him "son," because it annoys him.';
  const introMiles2 = `We're headed for ${plan.destinationName} — about ${minutes} minutes of road. Let's go.`;

  state.eligibleWords =
    members.reduce((s, it) => s + wordCount(it.unit?.storyText ?? ''), 0) +
    eligibleBridges.reduce((s, it) => s + wordCount(it.text ?? ''), 0) +
    wordCount(introMiles1) +
    wordCount(introMiles2);
  const earlBudgetWords = Math.floor(state.eligibleWords * DUO_SHARE_CAP);
  const shareAllows = (text: string): boolean => state.earlWords + wordCount(text) <= earlBudgetWords;
  // The standing intro's Earl line is pre-counted against
  // the budget: it seats unconditionally once Earl speaks
  // anywhere, so the share invariant (earlWords ≤ cap) must
  // already carry it. If the budget cannot carry even the
  // intro line, nothing seats and the episode stays solo
  // (the state is discarded with the unchanged plan).
  state.earlWords += wordCount(introEarl);
  state.earlLines += 1;

  // Short-twin pool for tight seats (unheard twins only, the
  // seating pass's own discipline).
  const twinByBase = new Map<string, LibraryUnit>();
  for (const u of opts.units) {
    if (isShortCutAngle(u.angle) && !opts.heardKeys.has(u.id)) twinByBase.set(canonicalStoryId(u.id), u);
  }
  const spans = soundingSpansOf(plan.items, driveSec);

  let items: PlanItem[] = [...plan.items];
  const scripts = new Map<string, DuoScript>();
  let bridgeBeatCount = 0;
  const bridgeBeatCap = Math.floor(eligibleBridges.length / 2);
  let anyEarl = false;

  // ---- woven members, in plan order
  for (const member of members) {
    const unit = member.unit as LibraryUnit;
    let servedUnit = unit;
    let servedItem = member;
    // Tight-seat substitution (addendum A.3.3): price the
    // seat's free room; when Earl's beats cannot fit beside
    // the full telling, seat the short-cut twin and let the
    // duo's seconds come out of the member's own budget.
    const span = spans.find(s => s.item === member);
    if (span && member.shortCut !== true) {
      const nextStart = spans.filter(s => s.start > span.start).reduce((m, s) => Math.min(m, s.start), driveSec);
      const roomSec = nextStart - span.start - unit.durationSec;
      const earlNeedSec = 3 * 9 + 2; // ~3 short lines at brisk pace + breaths, generously
      const twin = twinByBase.get(canonicalStoryId(unit.id));
      if (roomSec < earlNeedSec && twin && twin.id !== unit.id) {
        servedUnit = servedShortCutUnit(unit, twin);
        servedItem = {
          ...member,
          id: servedUnit.id,
          unit: servedUnit,
          durationSec: servedUnit.durationSec,
          shortCut: true,
          versionOf: unit.id,
        };
        // Id-keyed references follow the swap (the composer's
        // own discipline: a twin must never look like a
        // different story to the promise machinery).
        items = items.map(it =>
          it === member
            ? servedItem
            : {
                ...it,
                ...(it.prevUnitId === unit.id ? { prevUnitId: servedUnit.id } : {}),
                ...(it.nextUnitId === unit.id ? { nextUnitId: servedUnit.id } : {}),
              },
        );
      }
    }

    // Generate this member's lines under the running state.
    let lines: DuoLine[] = [];
    try {
      const raw = await opts.generateLines(
        duoLinesPrompt({
          placeName: servedUnit.placeName,
          storyText: servedUnit.storyText as string,
          claims: state.claims,
          concessionsUsed: state.concessionsUsed,
        }),
      );
      lines = parseDuoLines(raw, state);
    } catch {
      lines = []; // generation failed: the member plays solo or takes a bank verdict
    }
    // Share budget binds per line, in seam order — CUMULATIVELY
    // within the member: each kept line spends against the
    // lines kept before it, not just against the episode
    // total at filter time.
    {
      let running = state.earlWords;
      lines = lines.filter(l => {
        const w = wordCount(l.text);
        if (running + w > earlBudgetWords) return false;
        running += w;
        return true;
      });
    }
    let fromBank = false;
    if (lines.length === 0) {
      // Tier-1 fallback: a bank verdict after the story (a
      // generic verdict is the bank's honest job; a generic
      // setup before a specific story is not).
      const bank = bankLinesFor('bridge');
      const verdictText = bank[(state.members + bridgeBeatCount) % bank.length]?.text;
      if (verdictText && shareAllows(verdictText)) {
        lines = [{ role: 'verdict', move: 'verdict', text: verdictText }];
        fromBank = true;
      }
    }
    if (lines.length === 0) continue;

    // State: claims register, the story corrects them (the
    // tally Miles then inflates in writing), concessions spend.
    for (const l of lines) {
      state.earlWords += wordCount(l.text);
      state.earlLines += 1;
      if (l.move === 'concession') state.concessionsUsed += 1;
      if (l.role === 'setup' && l.move === 'wrong-assumption') {
        state.claims.push(l.text);
        state.corrections += 1;
      }
    }
    state.correctionsAsWritten = state.corrections + (state.corrections > 0 ? 1 : 0);
    state.members += 1;
    anyEarl = true;

    const script = composeDuoScript(servedUnit, lines);
    // Bank fallback lines are bank-sourced in the script record.
    if (fromBank) {
      for (const seg of script.segments) if (seg.speaker === 'earl') seg.source = 'bank';
    }
    scripts.set(servedItem.id, script);

    // Seat the audible items: setup directly before the
    // member (after its bridge in, which already sits there),
    // turn + verdict directly after it (after its planned
    // silence, when one rides the seam — the held breath
    // belongs to the story, the verdict follows it).
    const at = items.indexOf(servedItem);
    if (at < 0) continue;
    items[at] = { ...servedItem, duoScript: script };
    const setup = lines.find(l => l.role === 'setup');
    const turn = lines.find(l => l.role === 'turn');
    const verdict = lines.find(l => l.role === 'verdict');
    const insertsBefore: PlanItem[] = [];
    const insertsAfter: PlanItem[] = [];
    if (setup) {
      insertsBefore.push(
        earlItem({ id: `duo:setup:${servedItem.id}`, text: setup.text, role: 'setup', memberId: servedItem.id }),
      );
    }
    if (turn) {
      insertsAfter.push(
        earlItem({
          id: `duo:turn:${servedItem.id}`,
          text: turn.text,
          role: 'turn',
          memberId: servedItem.id,
          duoForId: servedItem.id,
        }),
      );
    }
    if (verdict) {
      insertsAfter.push(
        earlItem({
          id: `duo:verdict:${servedItem.id}`,
          text: verdict.text,
          role: 'verdict',
          memberId: servedItem.id,
          duoForId: servedItem.id,
        }),
      );
    }
    let afterAt = at + 1;
    if (items[afterAt]?.kind === 'silence' && items[afterAt].prevUnitId === servedItem.id) afterAt += 1;
    items.splice(afterAt, 0, ...insertsAfter);
    items.splice(at, 0, ...insertsBefore);
  }

  // ---- bridge beats (template machinery + Earl, ≤ half the bridges)
  if (bridgeBeatCap > 0) {
    const bank = bankLinesFor('bridge');
    const eligibleBridgeIds = new Set(eligibleBridges.map(b => b.id));
    const withBeats: PlanItem[] = [];
    for (const it of items) {
      withBeats.push(it);
      if (
        bridgeBeatCount < bridgeBeatCap &&
        eligibleBridgeIds.has(it.id) &&
        bank.length > 0
      ) {
        const text = bank[bridgeBeatCount % bank.length].text;
        if (shareAllows(text)) {
          withBeats.push(
            earlItem({ id: `duo:bridge-beat:${it.id}`, text, role: 'bridge-beat', duoForId: it.id }),
          );
          state.earlWords += wordCount(text);
          state.earlLines += 1;
          bridgeBeatCount += 1;
          anyEarl = true;
        }
      }
    }
    items = withBeats;
  }

  if (!anyEarl) return plan; // nothing for Earl in this episode: solo, exactly as today

  // ---- the standing two-host intro (template, <20 s), at the head
  const introItems: PlanItem[] = [
    {
      kind: 'bridge',
      id: 'duo:intro:miles-1',
      label: 'Intro — Miles',
      durationSec: Math.max(3, Math.round(wordCount(introMiles1) / 2.5)),
      text: introMiles1,
      ready: true,
    },
    earlItem({ id: 'duo:intro:earl', text: introEarl, role: 'intro' }),
    {
      kind: 'bridge',
      id: 'duo:intro:miles-2',
      label: 'Intro — Miles',
      durationSec: Math.max(3, Math.round(wordCount(introMiles2) / 2.5)),
      text: introMiles2,
      ready: true,
    },
  ];
  const previewAt = items.findIndex(i => i.kind === 'preview');
  if (previewAt >= 0) items.splice(previewAt, 0, ...introItems);
  else items.unshift(...introItems);

  opts.onEvent?.('duo_composed', {
    members: state.members,
    earl_lines: state.earlLines,
    earl_words: state.earlWords,
    eligible_words: state.eligibleWords,
    corrections: state.corrections,
    corrections_as_written: state.correctionsAsWritten,
    mode: 'route',
  });

  return {
    ...plan,
    items,
    totalSec: items.reduce((s, it) => s + it.durationSec, 0),
    duoState: { ...state },
  };
}
