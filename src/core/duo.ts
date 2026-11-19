// The Earl duo — composition layer (v16.2 Slice 9, Nov 17, 2026;
// Slice 9.5 mid-story insertion, Nov 18, 2026).
//
// Path A of the second-persona design, under the render
// architecture Erik approved: THE LIBRARY IS NEVER RE-VOICED.
// A woven member's shelf audio plays byte-identical; Earl's
// lines are the only new audio — short connective segments
// (bank first, generated pair-specific lines last) seated at
// the member's seams: a setup before the story, a turn beat,
// a verdict after it.
//
// Slice 9.5 makes the turn beat land MID-STORY, at the seam
// the script always recorded: when the member's audio yields
// a verified silence near the seam's estimated position, the
// member's plan item splits into two range items over the
// SAME shelf file (offset playback — the bytes are never
// touched, re-rendered, or re-encoded) and the turn seats
// between them: setup → story part 1 → turn → story part 2 →
// verdict. When no clean silence exists near the seam — or
// no silence map is wired — the member keeps the v1 shape:
// the turn sounds in the post-story cluster, in script
// order. Either way the script's Miles segments remain the
// shelf text verbatim; the split is a playback staging of
// the same words, never a different telling.
//
// This module is the composer-side half: eligibility and the
// persona's fences, the speaker-tagged script (Miles'
// segments are the twin's own sentences, verbatim — the
// integrity property the harness pins), the per-episode duo
// state (claims, the corrections tally Miles inflates IN
// WRITING ONLY, the rationed concession), the ≤33% word-share
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
import { bankLinesFor, duoLinesPrompt, EARL_INTRO_VARIANTS, type EarlBankLine } from '../services/duoPersona';
import { bridgeMoveOf, type BridgeMove } from './narration';
import type { SilenceSpan } from './audioFinish';

/** Earl's measured brisk pace (audition recipe, Nov 17, 2026): chars per second. */
export const EARL_CHARS_PER_SEC = 13.5;
/** Line discipline: an Earl line is a sentence, rarely two — never a paragraph. */
export const EARL_LINE_MAX_CHARS = 140;
/** Duo share cap: Earl's words ≤ this fraction of duo-eligible words (design §3; 0.25 at Slice 9 — Erik's scarcity complaint raised it to a third in the Nov 19 rework, §3.4). The guaranteed seats (intro line, first seam beat) are priced ahead of the cap and may carry a tiny episode past it by their own words alone; everything else binds exactly. */
export const DUO_SHARE_CAP = 0.33;
/** Per-member cap on Earl lines (design §3). */
export const DUO_MAX_LINES_PER_MEMBER = 3;
/** The grudging concession is rationed: at most one per episode (persona charter). */
export const DUO_MAX_CONCESSIONS = 1;
/** Explicit fourth-wall lines are rationed: at most two per episode beyond the intro's standing frame line (Nov 19 persona, §1). */
export const DUO_MAX_FRAME_BREAKS = 2;

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
  /**
   * Slice 9.5: the split offset (seconds into the shelf file)
   * when this member's turn beat serves mid-story; absent =
   * the member serves as one whole item (cluster staging).
   */
  splitSec?: number;
}

/** A member audio's measured shape for the split decision: its true duration and its verified silences. */
export interface DuoSilenceMap {
  totalSec: number;
  silences: readonly SilenceSpan[];
}

/** The seam's estimated position may drift this far (seconds) and still snap to a silence. */
export const DUO_SPLIT_SNAP_WINDOW_SEC = 4;
/** A silence shorter than this is a stop consonant, not a sentence pause (mirrors audioFinish's floor). */
export const DUO_SPLIT_MIN_SILENCE_SEC = 0.22;
/** A split may not land inside this fraction of the story at either end — the beat is a MID-story beat. */
export const DUO_SPLIT_EDGE_FRACTION = 0.15;
/** Each half of a split member must be at least this long — a sliver half is a stutter, not a staging. */
export const DUO_SPLIT_MIN_PART_SEC = 5;

/**
 * Choose a split point for one member (pure): the seam's
 * position is estimated from the script (chars before the
 * turn ÷ total chars × the audio's measured duration — the
 * narration pace is even enough that the estimate lands
 * within a sentence or two), then SNAPPED to the midpoint
 * of the nearest verified silence inside the snap window.
 * The midpoint is the safest point of the pause — maximally
 * far from speech on both sides, so the player's range
 * mechanics can only ever eat quiet. Returns null when no
 * silence qualifies (too short, too far from the estimate,
 * or the snap would leave an edge sliver): the caller falls
 * back to cluster staging for that member.
 */
export function pickDuoSplitSec(args: {
  seamCharsBefore: number;
  totalChars: number;
  totalSec: number;
  silences: readonly SilenceSpan[];
}): number | null {
  const { totalSec, silences } = args;
  if (!(totalSec > 0) || args.totalChars <= 0) return null;
  const estimate = (args.seamCharsBefore / args.totalChars) * totalSec;
  let best: number | null = null;
  let bestDist = Infinity;
  for (const s of silences) {
    if (s.endSec - s.startSec < DUO_SPLIT_MIN_SILENCE_SEC) continue;
    const mid = (s.startSec + s.endSec) / 2;
    const dist = Math.abs(mid - estimate);
    if (dist <= DUO_SPLIT_SNAP_WINDOW_SEC && dist < bestDist) {
      best = mid;
      bestDist = dist;
    }
  }
  if (best === null) return null;
  const split = Math.round(best * 100) / 100;
  const minPart = Math.max(DUO_SPLIT_MIN_PART_SEC, totalSec * DUO_SPLIT_EDGE_FRACTION);
  if (split < minPart || totalSec - split < minPart) return null;
  return split;
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
  /** Explicit fourth-wall lines spent this episode (the ≤2 ration beyond the intro). */
  frameBreaksUsed: number;
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
    frameBreaksUsed: 0,
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
  /** An explicit fourth-wall line — spends against the per-episode frame ration (Nov 19 persona, §1). */
  frame?: boolean;
}

const DUO_ROLES = new Set(['setup', 'turn', 'verdict']);
const DUO_MOVES = new Set(['wrong-assumption', 'old-man-beat', 'tall-tale', 'concession', 'verdict', 'question']);

/**
 * Mechanically validate the generation lane's raw output
 * (design §6.3's mechanical check): a JSON array of tagged
 * lines; a line survives only with a known role and move, at
 * most one line per role, and text inside the char cap. A
 * concession line is dropped when the episode's ration is
 * spent, and a frame-flagged line is dropped when the
 * fourth-wall ration (≤2 beyond the intro) is spent — the
 * rations are validated exactly alike, off the running duo
 * state plus this parse's own spend. Anything unparseable
 * yields no lines — the member plays solo (or takes a bank
 * verdict), never broken.
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
  let frameBreaks = state.frameBreaksUsed;
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { role, move, text, frame } = entry as { role?: unknown; move?: unknown; text?: unknown; frame?: unknown };
    if (typeof role !== 'string' || !DUO_ROLES.has(role) || seenRoles.has(role)) continue;
    if (typeof text !== 'string') continue;
    const line = text.trim();
    if (line.length === 0 || line.length > EARL_LINE_MAX_CHARS) continue;
    const m = typeof move === 'string' && DUO_MOVES.has(move) ? move : 'verdict';
    if (m === 'concession') {
      if (concessions >= DUO_MAX_CONCESSIONS) continue;
      concessions += 1;
    }
    const isFrame = frame === true;
    if (isFrame) {
      if (frameBreaks >= DUO_MAX_FRAME_BREAKS) continue;
      frameBreaks += 1;
    }
    seenRoles.add(role);
    out.push({ role: role as DuoLine['role'], move: m, text: line, ...(isFrame ? { frame: true } : {}) });
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
  /**
   * Intro-variant rotation seed (rework R2): the App wires
   * the drive-record count, so consecutive episodes rotate
   * Earl's standing intro line and never repeat the variant
   * back-to-back. Absent → variant 0 (the standing line).
   */
  introSeed?: number;
  /** The build's full unit pool (short-twin substitution reads it). */
  units: readonly LibraryUnit[];
  heardKeys: ReadonlySet<string>;
  /** The text lane (App wires generateStoryText under the duo instruction); raw output, validated here. */
  generateLines: (prompt: string) => Promise<string>;
  /**
   * The silence lane (Slice 9.5): a member's measured audio
   * shape — true duration + verified silences — or null when
   * the audio cannot be read. The App wires fetch + PCM
   * decode + findSilenceSpans over the shelf file. Absent,
   * failing, or silenceless all degrade the same way: that
   * member serves cluster-staged, exactly as Slice 9 built.
   */
  silenceFor?: (unit: LibraryUnit) => Promise<DuoSilenceMap | null>;
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
 * Order of work: fences → the standing intro priced first
 * and guaranteed → bridge beats → per-member short-twin
 * substitution for tight seats → per-member line generation
 * under the running duo state → the intro seated at the
 * head. The word-share budget binds in that allocation
 * order: when it is spent, later members play solo. (The
 * allocation order and the unconditional intro are the
 * Nov 19 rework, §3.4/§3.1; the ≤½ bridge cap died there
 * too — every eligible seam earns its beat.)
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
  // climax (a payoff bridge stays a Miles moment). A QUIET
  // HANDOFF bridge is fenced out (rework §3.2): a duo quiet
  // handoff is a contradiction — that seam stays Miles'
  // alone. Each eligible bridge's move is recorded: a
  // callback-move bridge draws its beat from the callback
  // bank (the §3.2 exception), the rest from the bridge bank.
  const bridgeMoveById = new Map<string, BridgeMove | null>();
  const eligibleBridges = plan.items.filter(it => {
    if (it.kind !== 'bridge' || typeof it.text !== 'string') return false;
    const prev = it.prevUnitId ? storyById.get(it.prevUnitId) : undefined;
    const next = it.nextUnitId ? storyById.get(it.nextUnitId) : undefined;
    if (next?.climax === true) return false;
    if (prev?.unit && !unitDuoClean(prev.unit)) return false;
    if (next?.unit && !unitDuoClean(next.unit)) return false;
    const move = bridgeMoveOf(it.text);
    if (move === 'quiet-handoff') return false;
    bridgeMoveById.set(it.id, move);
    return true;
  });

  // Nothing for Earl anywhere — no duo-eligible member and
  // no eligible seam: the episode stays solo, byte-for-byte.
  // The unconditional intro (below) never promises a co-host
  // the episode cannot seat again.
  if (members.length === 0 && eligibleBridges.length === 0) return plan;

  // The standing intro's Miles lines (template, persona doc):
  // they are duo-eligible material too, so their words stand
  // in the share denominator beside the members and bridges.
  // Miles' first line states the phone frame in one clause
  // (Nov 19 persona §2/§3.1); Earl's one line rotates through
  // the standing variants, seeded by the caller.
  const minutes = Math.max(1, Math.round(driveSec / 60));
  const introMiles1 =
    "I'm Miles. This is Earl — we live in the phone, he's very old, and neither of us is going to explain that. I call him Grumps.";
  const introSeed = Math.abs(Math.floor(opts.introSeed ?? 0));
  const introEarl = EARL_INTRO_VARIANTS[introSeed % EARL_INTRO_VARIANTS.length];
  const introMiles2 = `We're headed for ${plan.destinationName} — about ${minutes} minutes of road. Let's go.`;

  state.eligibleWords =
    members.reduce((s, it) => s + wordCount(it.unit?.storyText ?? ''), 0) +
    eligibleBridges.reduce((s, it) => s + wordCount(it.text ?? ''), 0) +
    wordCount(introMiles1) +
    wordCount(introMiles2);
  const earlBudgetWords = Math.floor(state.eligibleWords * DUO_SHARE_CAP);
  const shareAllows = (text: string): boolean => state.earlWords + wordCount(text) <= earlBudgetWords;
  // ALLOCATION ORDER (Nov 19 rework, §3.4): intro → seam beats
  // → member lines. The standing intro's Earl line is priced
  // FIRST and guaranteed — it is charged here, before any
  // seam or member spends, so the old failure mode (the
  // budget cannot carry the intro → the whole episode
  // silently goes solo) cannot recur for the intro itself.
  state.earlWords += wordCount(introEarl);
  state.earlLines += 1;

  // ---- the bank draw (rework §3.2): ONE rotation for the
  // whole episode, shared by seam beats and member fallback
  // verdicts. A bank line never repeats within the episode;
  // each seat's cursor starts from the episode's eligible-
  // bridge count, so consecutive episodes don't open their
  // seams with the same beat; a frame-flagged line draws only
  // while the fourth-wall ration lasts, and spends it when it
  // seats. A draw commits only when the caller's accept
  // predicate (the share budget) takes the line — a refused
  // line stays in the bank, unspent.
  const usedBankIds = new Set<string>();
  const bankCursors = new Map<string, number>();
  const takeBankLine = (
    seat: 'bridge' | 'callback',
    accept: (line: EarlBankLine) => boolean,
  ): EarlBankLine | null => {
    const lines = bankLinesFor(seat);
    if (lines.length === 0) return null;
    const start = (bankCursors.get(seat) ?? eligibleBridges.length) % lines.length;
    for (let k = 0; k < lines.length; k++) {
      const line = lines[(start + k) % lines.length];
      if (usedBankIds.has(line.id)) continue;
      if (line.frame && state.frameBreaksUsed >= DUO_MAX_FRAME_BREAKS) continue;
      if (!accept(line)) continue;
      usedBankIds.add(line.id);
      bankCursors.set(seat, start + k + 1);
      if (line.frame) state.frameBreaksUsed += 1;
      return line;
    }
    return null;
  };

  // ---- seam beats, priced BEFORE member lines (allocation
  // order, §3.4): an Earl beat at EVERY eligible seam — the
  // ≤½-of-bridges cap is gone; the share budget is the only
  // ceiling, and it binds member lines first. A callback-move
  // bridge draws the callback bank (the §3.2 exception),
  // falling back to the bridge bank when that bank is spent.
  // Beats are priced now and seated after the member loop,
  // appended after their bridge.
  const seamBeats = new Map<string, string>();
  eligibleBridges.forEach((bridge, idx) => {
    // PRESENCE FLOOR (§3.4): the first eligible seam's beat is
    // guaranteed, like the intro — priced ahead of the cap, so
    // a duo-enabled episode with an eligible member or seam
    // always has Earl in the intro AND at the first seam
    // before any member generation spends a word. The
    // fourth-wall ration still binds the draw itself (a
    // guaranteed beat is a bank line, never a forced frame
    // line).
    const guaranteed = idx === 0;
    const accept = (l: EarlBankLine): boolean => guaranteed || shareAllows(l.text);
    const seat = bridgeMoveById.get(bridge.id) === 'callback' ? 'callback' : 'bridge';
    const line =
      takeBankLine(seat, accept) ??
      (seat === 'callback' ? takeBankLine('bridge', accept) : null);
    if (!line) return;
    seamBeats.set(bridge.id, line.text);
    state.earlWords += wordCount(line.text);
    state.earlLines += 1;
  });
  let anyEarl = seamBeats.size > 0;

  // Short-twin pool for tight seats (unheard twins only, the
  // seating pass's own discipline).
  const twinByBase = new Map<string, LibraryUnit>();
  for (const u of opts.units) {
    if (isShortCutAngle(u.angle) && !opts.heardKeys.has(u.id)) twinByBase.set(canonicalStoryId(u.id), u);
  }
  const spans = soundingSpansOf(plan.items, driveSec);

  let items: PlanItem[] = [...plan.items];
  const scripts = new Map<string, DuoScript>();
  let splitMembers = 0;
  let clusterMembers = 0;

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
          frameBreaksLeft: Math.max(0, DUO_MAX_FRAME_BREAKS - state.frameBreaksUsed),
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
      // setup before a specific story is not). The draw rides
      // the episode's shared bank rotation — no repeats, and
      // a frame-flagged verdict spends its ration at the draw.
      const bankLine = takeBankLine('bridge', l => shareAllows(l.text));
      if (bankLine) {
        lines = [
          {
            role: 'verdict',
            move: 'verdict',
            text: bankLine.text,
            ...(bankLine.frame ? { frame: true } : {}),
          },
        ];
        fromBank = true;
      }
    }
    if (lines.length === 0) continue;

    // State: claims register, the story corrects them (the
    // tally Miles then inflates in writing), concessions spend.
    // GENERATED frame breaks spend HERE, at keep time — a
    // frame line the share filter refused never consumed the
    // ration. (A bank fallback's frame line already spent at
    // its draw, in takeBankLine — never twice.)
    for (const l of lines) {
      state.earlWords += wordCount(l.text);
      state.earlLines += 1;
      if (l.move === 'concession') state.concessionsUsed += 1;
      if (l.frame && !fromBank) state.frameBreaksUsed += 1;
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
    // the turn at its seam, the verdict after the story (after
    // its planned silence, when one rides the seam — the held
    // breath belongs to the story, the verdict follows it).
    const at = items.indexOf(servedItem);
    if (at < 0) continue;
    const setup = lines.find(l => l.role === 'setup');
    const turn = lines.find(l => l.role === 'turn');
    const verdict = lines.find(l => l.role === 'verdict');
    const setupItem = setup
      ? earlItem({ id: `duo:setup:${servedItem.id}`, text: setup.text, role: 'setup', memberId: servedItem.id })
      : null;
    const turnItem = turn
      ? earlItem({
          id: `duo:turn:${servedItem.id}`,
          text: turn.text,
          role: 'turn',
          memberId: servedItem.id,
          duoForId: servedItem.id,
        })
      : null;
    const verdictItem = verdict
      ? earlItem({
          id: `duo:verdict:${servedItem.id}`,
          text: verdict.text,
          role: 'verdict',
          memberId: servedItem.id,
          duoForId: servedItem.id,
        })
      : null;

    // Slice 9.5: the split decision. Only a member WITH a
    // turn can split (the turn is the beat that lands
    // mid-story), only when the silence lane is wired and
    // reads the member's audio, and never on an item carrying
    // late-presence conversion material (a converted head
    // plays a different whole file — the split's ranges would
    // be meaningless against it). Any miss = cluster staging.
    let splitSec: number | null = null;
    let splitTotalSec = 0;
    if (turn && opts.silenceFor && !servedItem.lateTwin) {
      let map: DuoSilenceMap | null = null;
      try {
        map = await opts.silenceFor(servedUnit);
      } catch {
        map = null; // an unreadable member audio degrades to cluster, never to a wedge
      }
      if (map && map.totalSec > 0) {
        // The seam's char offset, read off the composed
        // script: the Miles segment the turn follows.
        const storyText = servedUnit.storyText as string;
        const turnAt = script.segments.findIndex(s => s.speaker === 'earl' && s.role === 'turn');
        const beforeSeg = turnAt > 0 ? script.segments[turnAt - 1] : undefined;
        const seamChars =
          beforeSeg && beforeSeg.speaker === 'miles'
            ? beforeSeg.text.length
            : Math.round(storyText.length * 0.55);
        splitSec = pickDuoSplitSec({
          seamCharsBefore: seamChars,
          totalChars: storyText.length,
          totalSec: map.totalSec,
          silences: map.silences,
        });
        if (splitSec !== null) splitTotalSec = map.totalSec;
      }
    }
    if (turn) {
      // Telemetry (Slice 9.5): every turned member files its
      // staging — split-served with its offset, or the
      // cluster fallback — at plan time; the runner files
      // the served outcome on the same family.
      opts.onEvent?.('duo_member', {
        member_id: servedItem.id,
        serve: splitSec !== null ? 'split' : 'cluster',
        split_offset_sec: splitSec,
        mode: 'route',
      });
      if (splitSec !== null) splitMembers += 1;
      else clusterMembers += 1;
    }

    if (splitSec !== null && turnItem) {
      // Split staging: part 1 keeps the member's id and the
      // script; the turn seats between the parts; part 2
      // rides the member's fields under its part id. The
      // parts' durations are the MEASURED split (their sum
      // is the audio's true duration), so every downstream
      // budget reads the split's real numbers.
      script.splitSec = splitSec;
      const part1: PlanItem = {
        ...servedItem,
        duoScript: script,
        durationSec: splitSec,
        audioRange: { startSec: 0, endSec: splitSec },
        duoPart: { memberId: servedItem.id, part: 1, splitSec },
      };
      const part2: PlanItem = {
        ...servedItem,
        id: `${servedItem.id}#p2`,
        durationSec: Math.round((splitTotalSec - splitSec) * 100) / 100,
        audioRange: { startSec: splitSec },
        duoPart: { memberId: servedItem.id, part: 2, splitSec },
      };
      items[at] = part1;
      items.splice(at + 1, 0, turnItem, part2);
      let tailAt = at + 3;
      if (items[tailAt]?.kind === 'silence' && items[tailAt].prevUnitId === servedItem.id) tailAt += 1;
      if (verdictItem) items.splice(tailAt, 0, verdictItem);
    } else {
      items[at] = { ...servedItem, duoScript: script };
      const insertsAfter: PlanItem[] = [];
      if (turnItem) insertsAfter.push(turnItem);
      if (verdictItem) insertsAfter.push(verdictItem);
      let afterAt = at + 1;
      if (items[afterAt]?.kind === 'silence' && items[afterAt].prevUnitId === servedItem.id) afterAt += 1;
      items.splice(afterAt, 0, ...insertsAfter);
    }
    if (setupItem) items.splice(at, 0, setupItem);
  }

  // ---- seat the priced seam beats: each appends after its
  // bridge (the beat is Earl's reaction to Miles' road talk —
  // it never replaces, precedes, or rewrites the bridge text,
  // and the bridge's move was chosen by the existing rotation
  // untouched). A planned silence riding immediately behind
  // the bridge keeps the composer's position: the beat seats
  // after the silence, never displacing it.
  if (seamBeats.size > 0) {
    const withBeats: PlanItem[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      withBeats.push(it);
      const beat = seamBeats.get(it.id);
      if (beat) {
        const beatItem = earlItem({
          id: `duo:bridge-beat:${it.id}`,
          text: beat,
          role: 'bridge-beat',
          duoForId: it.id,
        });
        if (items[i + 1]?.kind === 'silence') {
          withBeats.push(items[i + 1]);
          withBeats.push(beatItem);
          i += 1;
        } else {
          withBeats.push(beatItem);
        }
      }
    }
    items = withBeats;
  }

  // The presence floor (rework §3.4): an episode with at
  // least one duo-eligible member ALWAYS opens with the
  // two-host intro — the intro is where the show promises
  // Earl, and the promise no longer depends on whether a
  // member happened to earn lines under the cap. A
  // bridge-only episode opens it when a beat seated. When
  // neither holds (nothing eligible survived the fences —
  // the early return above — or every seat was refused in a
  // bridges-only episode), the plan stays solo.
  if (!anyEarl && members.length === 0) return plan;

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
    split_members: splitMembers,
    cluster_members: clusterMembers,
    bridge_beats: seamBeats.size,
    frame_breaks: state.frameBreaksUsed,
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
