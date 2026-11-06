// Color Puck (audience coloring, Nov 5, 2026): the build-time
// pass that authors an episode's color pieces — the second
// chair's beats — into a composed plan. Erik's rulings, as
// amended onto the coloring scope:
//
//  - Color Puck is a PROMPT persona behind the same voice
//    (narration.colorPromptFor); there is no second voice,
//    no casting, no new TTS lane. The pieces are ordinary
//    plan tissue: their texts exist at plan-fix like every
//    live piece's, and their synthesis rides the runner's
//    render-ahead queue — a piece never gates a story.
//  - ADULT LICENSE, Standard only: in a Family build this
//    pass is a strict no-op — the color prompt never runs
//    and Miles hosts alone. There is no sanitized color.
//  - Surfaces: the plan's reaction slots (the color piece
//    replaces the bank line at the slot), bridge asides
//    (a piece inserted right after a story the reactions
//    didn't cover), and ONE closeout line at the plan's
//    tail. One budget covers all three (COLOR_MAX_PER_
//    EPISODE), spent reactions first, then the closeout,
//    then asides in plan order — the standing beats earn
//    their color before the discretionary ones do.
//  - Guardrails: a piece riffs only on its story (the story
//    item it follows — colorForId); a story in the
//    color-suppression class (routeMode.colorSuppressedFor:
//    memorial/somber register, Protected, scandal) gets NO
//    piece — Miles hosts past it straight; a piece over the
//    character cap is discarded whole, never truncated
//    mid-sentence; a failed or timed-out generation leaves
//    the plan exactly as composed (the bank reaction stands,
//    an aside simply never exists).
//  - Drop discipline is the runner's half of the contract:
//    each piece carries colorForId, and the feed gate kills
//    a piece whose story dropped or settled unplayed —
//    mirroring the doomed lead-in rule for bridges.
//
// THE UNFILTERED BRANCH (humor layer, Nov 6, 2026): in an
// 'unfiltered' build the curated humor bank (data/humorBank)
// is drawn into the SAME slots FIRST — bank-primary hybrid,
// Erik's ruling: at humor-eligible slots the bank draw goes
// before the generator, and generated Color Puck fills only
// the slots the bank left empty, under the same shared
// 5-piece budget. Humor pieces come ONLY from the bank —
// reviewed text, flagged `humor` with their bank id — and
// never exceed HUMOR_MAX_PER_EPISODE (2). The draw obeys the
// scope's discipline: the episode-wide memorial kill (a
// memorial-class story anywhere in the cast silences the
// layer for the whole episode — generated color still
// proceeds, as in Standard); the per-slot suppression class
// on the piece's target AND on the story that sounds next
// (no humor on or immediately before somber ground); the
// cross-drive cooldown (a line drawn within the last 20
// drives is ineligible — the App derives the set from the
// drive records); the within-episode ledger (a line never
// repeats inside an episode); heat spacing (never two roast
// lines); story spacing (humor targets sit at least one full
// story apart, and at most one humor piece lands in the
// preview/first-story zone). Bank text passes through the
// same spoken-form normalization as every live piece — the
// words are the reviewed words; only the road-label
// abbreviations are expanded for the TTS, exactly as
// generated tissue is. With the shipped bank EMPTY the
// branch is inert by construction: zero draws, and the
// generated stage is the Standard pass over the same slots —
// the harness pins that parity.
//
// The pass runs in the App's build staging AFTER member
// seating (the final plan shape) and before the wrap-up is
// authored — composition is untouched: stories, order, and
// budget are exactly what the composer settled. In a
// Standard build the plan's STRUCTURE is unchanged too,
// except for the aside/closeout inserts: reaction slots are
// converted in place, never added or removed.

import {
  COLOR_BANK,
  COLOR_MAX_CHARS,
  COLOR_MAX_PER_EPISODE,
  colorPromptFor,
  spokenFormText,
  type ColorContext,
} from './narration';
import {
  colorSuppressedFor,
  estimateDurationSec,
  memorialClassFor,
  type LibraryUnit,
  type PlanItem,
  type RoutePlan,
} from './routeMode';
import {
  HUMOR_BANK,
  HUMOR_MAX_CHARS,
  HUMOR_MAX_PER_EPISODE,
  type HumorLine,
  type HumorSlot,
} from '../data/humorBank';
import { resolveFillerRegion } from '../data/fillerRegions';

export interface ColorizeDeps {
  /** The standing generation seam (App: narration.generateStory). */
  generateColor: (prompt: string) => Promise<string | null>;
  /** Per-piece generation timeout; a timeout leaves the slot as composed. */
  timeoutMs?: number;
  /**
   * Unfiltered only: the humor bank to draw from. Defaults
   * to the shipped HUMOR_BANK — EMPTY until Erik's reviewed
   * bank replaces it, which is what makes the state inert.
   * Tests inject fixture banks here; production never does.
   */
  humorBank?: readonly HumorLine[];
  /**
   * Unfiltered only: bank line ids drawn within the
   * cooldown window (routeHistory.humorCooldownLineIds over
   * the drive records). Default: no cooldown.
   */
  humorCooldownIds?: ReadonlySet<string>;
}

const DEFAULT_COLOR_TIMEOUT_MS = 15_000;

/** Race a generation against its timeout; a timeout resolves null, never a hang. */
function withTimeout<T>(step: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>(resolve => {
    const timer = setTimeout(() => resolve(null), ms);
    step.then(
      v => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** One color slot the pass may spend its budget on. */
interface ColorSlot {
  surface: ColorContext['surface'];
  /** The story item the piece riffs on (its colorForId). */
  storyItem: PlanItem;
  /** Reaction slots only: the bank reaction item to convert in place. */
  reactionItem?: PlanItem;
  /** The episode's first slot in budget order (the preview/first-bridge neighborhood for bank 'preview' lines). */
  isFirstSlot?: boolean;
}

/**
 * Slot allocation, in budget order — reactions first (plan
 * order), then the closeout, then asides. Shared by every
 * branch so the Standard pass, the Unfiltered generated
 * stage, and the bank draw all spend the shared budget
 * against the same slot sequence. The closing story never
 * receives an aside: its discretionary beat is the closeout.
 */
function allocateColorSlots(plan: RoutePlan): ColorSlot[] {
  const storyItems = plan.items.filter(it => it.kind === 'story' && it.unit);
  if (storyItems.length === 0) return [];
  /**
   * The story a piece at this plan position riffs on: the
   * nearest story item behind it. Tissue (bridges, fillers,
   * other reactions) is walked across; a story is never
   * walked past — the FIRST story found is the subject.
   */
  const storyBefore = (index: number): PlanItem | null => {
    for (let i = index - 1; i >= 0; i--) {
      const it = plan.items[i];
      if (it.kind === 'story' && it.unit) return it;
    }
    return null;
  };
  const slots: ColorSlot[] = [];
  const coveredStoryIds = new Set<string>();
  plan.items.forEach((it, i) => {
    if (it.kind !== 'reaction' || it.voice === 'color-puck') return;
    const target = storyBefore(i);
    if (target) {
      slots.push({ surface: 'reaction', storyItem: target, reactionItem: it });
      coveredStoryIds.add(target.id);
    }
  });
  const closingStory = storyItems[storyItems.length - 1];
  if (!coveredStoryIds.has(closingStory.id)) {
    slots.push({ surface: 'closeout', storyItem: closingStory });
    coveredStoryIds.add(closingStory.id);
  }
  for (const s of storyItems) {
    if (s.id === closingStory.id || coveredStoryIds.has(s.id)) continue;
    slots.push({ surface: 'aside', storyItem: s });
  }
  if (slots.length > 0) slots[0].isFirstSlot = true;
  return slots;
}

/** Apply the filled slots as pieces: reactions converted in place, asides inserted after their story, the closeout at the tail. */
function applyColorPieces(plan: RoutePlan, pieces: ReadonlyMap<ColorSlot, PlanItem>): RoutePlan {
  const replacements = new Map<string, PlanItem>();
  const insertsAfter = new Map<string, PlanItem[]>();
  let tail: PlanItem | null = null;
  for (const [slot, piece] of pieces) {
    if (slot.surface === 'reaction' && slot.reactionItem) {
      replacements.set(slot.reactionItem.id, piece);
    } else if (slot.surface === 'closeout') {
      tail = piece;
    } else {
      const list = insertsAfter.get(slot.storyItem.id) ?? [];
      list.push(piece);
      insertsAfter.set(slot.storyItem.id, list);
    }
  }
  const items: PlanItem[] = [];
  for (const it of plan.items) {
    items.push(replacements.get(it.id) ?? it);
    const extra = insertsAfter.get(it.id);
    if (extra) items.push(...extra);
  }
  if (tail) items.push(tail);
  return { ...plan, items, totalSec: items.reduce((s, it) => s + it.durationSec, 0) };
}

/** The piece id a slot's piece carries — one scheme for generated and bank pieces alike. */
function pieceIdFor(slot: ColorSlot): string {
  return slot.surface === 'reaction'
    ? (slot.reactionItem as PlanItem).id
    : slot.surface === 'closeout'
      ? 'color:closeout'
      : `color:aside:${slot.storyItem.id}`;
}

/**
 * One generation under the standing discipline: the color
 * prompt for the context, raced against the timeout; a
 * failure, an empty return, or an over-cap return yields
 * null (the slot stays as composed — a truncated joke is a
 * broken sentence spoken aloud); a kept piece is spoken-
 * formed. Returns the piece's final text.
 */
async function generateColorText(deps: ColorizeDeps, ctx: ColorContext): Promise<string | null> {
  const raw = await withTimeout(deps.generateColor(colorPromptFor(ctx)), deps.timeoutMs ?? DEFAULT_COLOR_TIMEOUT_MS);
  const text = (raw ?? '').trim();
  if (!text || text.length > COLOR_MAX_CHARS) return null;
  return spokenFormText(text);
}

/**
 * Author the plan's color pieces. Returns the plan unchanged
 * (the same object) when the rating is Family, when the plan
 * has no stories, or when no piece survives — the caller
 * cannot tell a colorless build from an unauthored one,
 * which is the failure discipline working as designed.
 * Standard: generated pieces only, the pass as it has always
 * run. Unfiltered: the bank stage first, then the generated
 * stage over the slots the bank left empty (file header).
 */
export async function colorizeRoutePlan(plan: RoutePlan, deps: ColorizeDeps): Promise<RoutePlan> {
  // Family: the color prompt NEVER runs. Not a filtered
  // version of the pass — the pass itself stands down.
  if (plan.audience === 'family') return plan;
  if (plan.audience === 'unfiltered') return colorizeUnfiltered(plan, deps);

  const slots = allocateColorSlots(plan);
  const pieces = new Map<ColorSlot, PlanItem>();
  let moveIdx = 0;
  for (const slot of slots) {
    if (pieces.size >= COLOR_MAX_PER_EPISODE) break;
    const unit = slot.storyItem.unit as LibraryUnit;
    // Memorial/somber discipline: no color on or after this
    // class of story. The slot is skipped, not reassigned —
    // the budget is a cap, not a quota.
    if (colorSuppressedFor(unit)) continue;
    if (!unit.storyText) continue; // no fact pack, no riff — the piece has nothing honest to stand on
    const spoken = await generateColorText(deps, {
      storySubject: unit.placeName,
      storyText: unit.storyText,
      threadTopic: plan.thread?.topic ?? null,
      destinationName: plan.destinationName,
      surface: slot.surface,
      move: COLOR_BANK[moveIdx++ % COLOR_BANK.length],
    });
    if (!spoken) continue;
    pieces.set(slot, {
      kind: 'reaction',
      id: pieceIdFor(slot),
      label: 'Color commentary',
      durationSec: estimateDurationSec(spoken),
      text: spoken,
      voice: 'color-puck',
      colorForId: slot.storyItem.id,
      ready: true,
    });
  }
  if (pieces.size === 0) return plan;
  return applyColorPieces(plan, pieces);
}

// ── The Unfiltered bank draw ─────────────────────────────

/** The episode facts a bank line's contexts and exclusions are judged against — all read off the real plan. */
interface HumorEpisodeContext {
  /** Road labels of the route the driver actually picked (route choice record), e.g. 'I-5 S'. */
  roads: string[];
  /** Filler regions the cast's coordinates sit in. */
  regions: Set<string>;
  /** place_keys in the cast. */
  placeKeys: Set<string>;
  /** Topics the cast carries, plus the thread's topic. */
  topics: Set<string>;
  /** The thread's anchor kind, when the plan carries a thread. */
  anchorKind: string | null;
  /** The episode-wide memorial kill: any memorial-class story in the cast. */
  memorialKill: boolean;
  destinationName: string;
}

function humorEpisodeContext(plan: RoutePlan): HumorEpisodeContext {
  const units: LibraryUnit[] = [];
  for (const it of plan.items) if (it.kind === 'story' && it.unit) units.push(it.unit);
  const regions = new Set<string>();
  const placeKeys = new Set<string>();
  const topics = new Set<string>();
  for (const u of units) {
    const region = resolveFillerRegion(u.lat, u.lng);
    if (region) regions.add(region);
    placeKeys.add(u.placeKey);
    for (const t of u.topics ?? []) topics.add(t);
  }
  if (plan.thread?.topic) topics.add(plan.thread.topic);
  const choice = plan.routeChoice ?? null;
  const picked = choice ? (choice.offered[choice.pickedIndex ?? 0] ?? null) : null;
  return {
    roads: picked ? [...picked.routeLabels] : [],
    regions,
    placeKeys,
    topics,
    anchorKind: plan.thread?.anchorKind ?? null,
    memorialKill: units.some(u => memorialClassFor(u)),
    destinationName: plan.destinationName,
  };
}

/** Whether a bank line's scope-slot fits this color slot (the mapping is data/humorBank's header contract). */
function slotAccepts(line: HumorLine, slot: ColorSlot): boolean {
  return line.slots.some((s: HumorSlot) => {
    if (s === 'reaction') return slot.surface === 'reaction';
    if (s === 'bridge') return slot.surface === 'aside';
    if (s === 'wrap-up') return slot.surface === 'closeout';
    return slot.isFirstSlot === true; // 'preview'
  });
}

const NO_ROAD_MATCH: unique symbol = Symbol('no-road-match');

/**
 * Context match: returns the route label a {road} fill may
 * use (null when no road matched and the line needs none),
 * or NO_ROAD_MATCH when the line declares contexts and none
 * of them match this episode. A line with NO contexts is
 * context-light and matches anywhere.
 */
function contextRoadFor(line: HumorLine, ctx: HumorEpisodeContext): string | null | typeof NO_ROAD_MATCH {
  const c = line.contexts;
  if (!c) return null;
  let road: string | null = null;
  let matched = false;
  let declared = false;
  if (c.roads && c.roads.length > 0) {
    declared = true;
    for (const want of c.roads) {
      const hit = ctx.roads.find(r => r.toLowerCase().includes(want.toLowerCase()));
      if (hit) {
        matched = true;
        road = hit;
        break;
      }
    }
  }
  if (c.regions && c.regions.length > 0) {
    declared = true;
    if (c.regions.some(r => ctx.regions.has(r))) matched = true;
  }
  if (c.placeKeys && c.placeKeys.length > 0) {
    declared = true;
    if (c.placeKeys.some(k => ctx.placeKeys.has(k))) matched = true;
  }
  if (c.topics && c.topics.length > 0) {
    declared = true;
    if (c.topics.some(t => ctx.topics.has(t))) matched = true;
  }
  if (c.anchorKinds && c.anchorKinds.length > 0) {
    declared = true;
    if (ctx.anchorKind != null && c.anchorKinds.includes(ctx.anchorKind)) matched = true;
  }
  if (declared && !matched) return NO_ROAD_MATCH;
  return road;
}

/** The line's own vetoes: an excluded topic or place_key anywhere in the cast kills the line for this episode. */
function excludedFor(line: HumorLine, ctx: HumorEpisodeContext): boolean {
  const x = line.exclusions;
  if (!x) return false;
  if (x.topics && x.topics.some(t => ctx.topics.has(t))) return true;
  if (x.placeKeys && x.placeKeys.some(k => ctx.placeKeys.has(k))) return true;
  return false;
}

/**
 * Slot fills: {road}, {destination}, {place} — filled ONLY
 * from the episode's real facts. A fill that cannot be
 * completed (or an unknown token) makes the line ineligible
 * at this slot: a half-filled joke never airs.
 */
function fillHumorText(
  text: string,
  fills: { road: string | null; destination: string; place: string },
): string | null {
  let missing = false;
  const out = text.replace(/\{(road|destination|place)\}/g, (_m, key: string) => {
    const v = key === 'road' ? fills.road : key === 'destination' ? fills.destination : fills.place;
    if (v == null || v === '') {
      missing = true;
      return '';
    }
    return v;
  });
  if (missing) return null;
  if (/\{[^}]*\}/.test(out)) return null;
  const trimmed = out.trim();
  return trimmed ? trimmed : null;
}

/** The story item that sounds immediately AFTER this slot's position (the adjacency check's other neighbor). */
function nextStoryAfter(plan: RoutePlan, slot: ColorSlot): PlanItem | undefined {
  const anchor = slot.reactionItem ?? slot.storyItem;
  const idx = plan.items.indexOf(anchor);
  if (idx < 0) return undefined;
  for (let i = idx + 1; i < plan.items.length; i++) {
    if (plan.items[i].kind === 'story') return plan.items[i];
  }
  return undefined;
}

/**
 * The Unfiltered pass: bank draws staged into the color
 * slots FIRST, then the generated pass over the slots the
 * bank left empty — one shared budget (COLOR_MAX_PER_
 * EPISODE) binding both stages, humor capped at
 * HUMOR_MAX_PER_EPISODE inside it. See the file header for
 * the full draw discipline.
 */
async function colorizeUnfiltered(plan: RoutePlan, deps: ColorizeDeps): Promise<RoutePlan> {
  const slots = allocateColorSlots(plan);
  const pieces = new Map<ColorSlot, PlanItem>();
  const bank = deps.humorBank ?? HUMOR_BANK;
  const cooldown = deps.humorCooldownIds ?? new Set<string>();

  // ── Bank stage ─────────────────────────────────────────
  if (bank.length > 0 && slots.length > 0) {
    const ctx = humorEpisodeContext(plan);
    if (!ctx.memorialKill) {
      const storyIndex = new Map<PlanItem, number>();
      let si = 0;
      for (const it of plan.items) if (it.kind === 'story') storyIndex.set(it, si++);
      const usedLineIds = new Set<string>();
      const humorTargets: number[] = [];
      let roastUsed = false;
      let earlyZoneUsed = false;
      const today = new Date().toISOString().slice(0, 10);
      let humorSpent = 0;
      for (const slot of slots) {
        if (humorSpent >= HUMOR_MAX_PER_EPISODE) break;
        if (pieces.size >= COLOR_MAX_PER_EPISODE) break;
        const unit = slot.storyItem.unit as LibraryUnit;
        if (!unit.storyText) continue; // no fact pack, no riff
        // Adjacency suppression, both neighbors: the piece's
        // own target, and the story that sounds next — no
        // humor on or immediately before somber ground.
        if (colorSuppressedFor(unit)) continue;
        const next = nextStoryAfter(plan, slot);
        if (next?.unit && colorSuppressedFor(next.unit)) continue;
        // Spacing: humor targets sit at least one full story
        // apart; the preview/first-story zone holds at most
        // one humor piece.
        const idx = storyIndex.get(slot.storyItem) ?? -1;
        if (humorTargets.some(t => Math.abs(t - idx) < 2)) continue;
        if (idx === 0 && earlyZoneUsed) continue;
        // The draw: first eligible line, bank order —
        // deterministic, so the capture explains every draw.
        let drawn: { line: HumorLine; text: string } | null = null;
        for (const line of bank) {
          if (usedLineIds.has(line.id)) continue;
          if (cooldown.has(line.id)) continue;
          if (line.heat === 'roast' && roastUsed) continue;
          if (line.expires && line.expires < today) continue;
          if (!slotAccepts(line, slot)) continue;
          const road = contextRoadFor(line, ctx);
          if (road === NO_ROAD_MATCH) continue;
          if (excludedFor(line, ctx)) continue;
          const filled = fillHumorText(line.text, {
            road,
            destination: ctx.destinationName,
            place: unit.placeName,
          });
          if (filled === null || filled.length > HUMOR_MAX_CHARS) continue;
          drawn = { line, text: filled };
          break;
        }
        if (!drawn) continue;
        usedLineIds.add(drawn.line.id);
        if (drawn.line.heat === 'roast') roastUsed = true;
        humorTargets.push(idx);
        if (idx === 0) earlyZoneUsed = true;
        humorSpent++;
        const spoken = spokenFormText(drawn.text);
        pieces.set(slot, {
          kind: 'reaction',
          id: pieceIdFor(slot),
          label: 'Color commentary',
          durationSec: estimateDurationSec(spoken),
          text: spoken,
          voice: 'color-puck',
          colorForId: slot.storyItem.id,
          ready: true,
          humor: true,
          humorBankId: drawn.line.id,
        });
      }
    }
  }

  // ── Generated stage: the slots the bank left empty ─────
  // The Standard pass over the untaken slots, its own move
  // rotation from the top of the bank — generated pieces are
  // never humor-flagged, by the ruling.
  let moveIdx = 0;
  for (const slot of slots) {
    if (pieces.size >= COLOR_MAX_PER_EPISODE) break;
    if (pieces.has(slot)) continue;
    const unit = slot.storyItem.unit as LibraryUnit;
    if (colorSuppressedFor(unit)) continue;
    if (!unit.storyText) continue;
    const spoken = await generateColorText(deps, {
      storySubject: unit.placeName,
      storyText: unit.storyText,
      threadTopic: plan.thread?.topic ?? null,
      destinationName: plan.destinationName,
      surface: slot.surface,
      move: COLOR_BANK[moveIdx++ % COLOR_BANK.length],
    });
    if (!spoken) continue;
    pieces.set(slot, {
      kind: 'reaction',
      id: pieceIdFor(slot),
      label: 'Color commentary',
      durationSec: estimateDurationSec(spoken),
      text: spoken,
      voice: 'color-puck',
      colorForId: slot.storyItem.id,
      ready: true,
    });
  }
  if (pieces.size === 0) return plan;
  return applyColorPieces(plan, pieces);
}
