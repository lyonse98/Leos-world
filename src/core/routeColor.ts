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
  type LibraryUnit,
  type PlanItem,
  type RoutePlan,
} from './routeMode';

export interface ColorizeDeps {
  /** Color text generation (App wires gemini.generateStoryText — the standing generation path). */
  generateColor: (prompt: string) => Promise<string>;
  /** Per-piece generation timeout (default 15 s): a slow piece is skipped, never a stalled build. */
  timeoutMs?: number;
}

const DEFAULT_COLOR_TIMEOUT_MS = 15_000;

/** Race a generation against the timeout: null on timeout or rejection (skip-fallback, as everywhere). */
function withTimeout<T>(step: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>(resolve => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(null);
      }
    }, ms);
    const timerHandle = timer as unknown as { unref?: () => void };
    if (typeof timerHandle.unref === 'function') timerHandle.unref();
    step.then(
      value => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(null);
        }
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
}

/**
 * Author the plan's color pieces. Returns the plan unchanged
 * (the same object) when the rating is Family, when the plan
 * has no stories, or when no piece survives — the caller
 * cannot tell a colorless Standard build from an unauthored
 * one, which is the failure discipline working as designed.
 */
export async function colorizeRoutePlan(plan: RoutePlan, deps: ColorizeDeps): Promise<RoutePlan> {
  // Family: the color prompt NEVER runs. Not a filtered
  // version of the pass — the pass itself stands down.
  if (plan.audience !== 'standard') return plan;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_COLOR_TIMEOUT_MS;

  const storyItems = plan.items.filter(it => it.kind === 'story' && it.unit);
  if (storyItems.length === 0) return plan;
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

  // ---- slot allocation (budget order: reactions, closeout, asides)
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
  const closeoutSlot: ColorSlot | null = coveredStoryIds.has(closingStory.id)
    ? null
    : { surface: 'closeout', storyItem: closingStory };
  const asideSlots: ColorSlot[] = [];
  for (const s of storyItems) {
    if (s.id === closingStory.id || coveredStoryIds.has(s.id)) continue;
    asideSlots.push({ surface: 'aside', storyItem: s });
  }
  const ordered: ColorSlot[] = [...slots, ...(closeoutSlot ? [closeoutSlot] : []), ...asideSlots];

  // ---- generation + application
  const replacements = new Map<string, PlanItem>();
  const insertsAfter = new Map<string, PlanItem[]>();
  let tail: PlanItem | null = null;
  let spent = 0;
  let moveIdx = 0;
  for (const slot of ordered) {
    if (spent >= COLOR_MAX_PER_EPISODE) break;
    const unit = slot.storyItem.unit as LibraryUnit;
    // Memorial/somber discipline: no color on or after this
    // class of story. The slot is skipped, not reassigned —
    // the budget is a cap, not a quota.
    if (colorSuppressedFor(unit)) continue;
    if (!unit.storyText) continue; // no fact pack, no riff — the piece has nothing honest to stand on
    const move = COLOR_BANK[moveIdx % COLOR_BANK.length];
    moveIdx += 1;
    const raw = await withTimeout(
      deps.generateColor(
        colorPromptFor({
          storySubject: unit.placeName,
          storyText: unit.storyText,
          threadTopic: plan.thread?.topic ?? null,
          destinationName: plan.destinationName,
          surface: slot.surface,
          move,
        }),
      ),
      timeoutMs,
    );
    const text = (raw ?? '').trim();
    // Over the cap = discarded whole. A truncated joke is a
    // broken sentence spoken aloud; the plan loses nothing
    // by the piece never existing.
    if (!text || text.length > COLOR_MAX_CHARS) continue;
    const spoken = spokenFormText(text);
    spent += 1;
    const piece: PlanItem = {
      kind: 'reaction',
      id:
        slot.surface === 'reaction'
          ? (slot.reactionItem as PlanItem).id
          : slot.surface === 'closeout'
            ? 'color:closeout'
            : `color:aside:${slot.storyItem.id}`,
      label: 'Color commentary',
      durationSec: estimateDurationSec(spoken),
      text: spoken,
      voice: 'color-puck',
      colorForId: slot.storyItem.id,
      ready: true,
    };
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
  if (spent === 0) return plan;

  const items: PlanItem[] = [];
  for (const it of plan.items) {
    items.push(replacements.get(it.id) ?? it);
    const extra = insertsAfter.get(it.id);
    if (extra) items.push(...extra);
  }
  if (tail) items.push(tail);
  return { ...plan, items, totalSec: items.reduce((s, it) => s + it.durationSec, 0) };
}
