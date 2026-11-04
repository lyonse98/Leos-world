// ------------------------------------------------------------
// The narration seam (addendum 5, Erik, Nov 3, 2026 — dual-
// persona-ready architecture, a HARD constraint: "don't want
// to have to rewrite everything").
//
// EVERY piece of route-mode live narration — bridges, the
// spoken preview, the wrap-up, gap stories — flows through
// this one seam. A narration request carries a KIND, the
// structured facts it may speak (context), and a VOICE. Today
// the voice is Miles solo; a future second chair changes the
// generation layer and the persona source ONLY.
//
// The discipline this module enforces:
//  - the request shape is uniform across kinds ({ kind,
//    context, voice }) — the builders below, the bridge text
//    layer (routeMode re-exports it from here), and the gap-
//    story prompt all render FROM a request's context;
//  - persona-specific phrasing lives HERE (the text builders)
//    and in the persona source (services/leoPersona) — never
//    in routeMode's composition logic, the runner, the gap-
//    fill pass, or the App, which deal only in structured
//    facts, plan items, and audio;
//  - plan items and the runner are voice-neutral: an item is
//    text + label + duration, and nothing outside this layer
//    may assume a narration is single-speaker — a future duo
//    item carrying two speakers' segments requires changes
//    only in this layer and the persona source;
//  - synthesis is injected (NarrationDeps), the same seam the
//    runner already uses: the App builds ONE NarrationDeps per
//    route build and wires it to the runner, the gap-fill pass,
//    and the wrap-up alike — in tests, the stubs replace this
//    seam and nothing else.
// ------------------------------------------------------------

/** The kinds of route-mode live narration. */
export type NarrationKind = 'bridge' | 'preview' | 'wrapup' | 'gapstory';

/**
 * Who is speaking. Miles solo today, by default everywhere;
 * the union widens in the generation layer when a second
 * chair is cast — callers never branch on it.
 */
export type NarrationVoice = 'miles-solo';

/** The voice every narration request carries unless overridden. */
export const DEFAULT_NARRATION_VOICE: NarrationVoice = 'miles-solo';

/** One uniform narration request: kind + structured facts + voice. */
export interface NarrationRequest<C> {
  kind: NarrationKind;
  /** Structured facts only — real plan/ledger data, never prose assembled by logic code. */
  context: C;
  voice: NarrationVoice;
}

/** Stamp a narration request (voice defaults to Miles solo). */
export function narrationRequest<C>(
  kind: NarrationKind,
  context: C,
  voice: NarrationVoice = DEFAULT_NARRATION_VOICE,
): NarrationRequest<C> {
  return { kind, context, voice };
}

/**
 * The injectable half of the seam, built ONCE per route build
 * by the App and shared by every route narration consumer:
 * the runner's synthUrl (bridges + preview), the gap-fill pass
 * (gap stories), and the wrap-up synthesis. Synthesis and
 * story generation are the codebase's existing gemini paths —
 * this type names the seam; it adds no new live calls.
 */
export interface NarrationDeps {
  voice: NarrationVoice;
  /** Text → speech audio (gemini.synthesizeSpeech in the App). */
  synthesize: (text: string) => Promise<Blob>;
  /** Persona story generation (gemini.generateStoryText in the App). */
  generateStory: (prompt: string) => Promise<string>;
}

// ------------------------------------------------------------ wrap-up text (addendum 3)

/**
 * The facts the wrap-up may speak — PLAN facts only (addendum
 * 3): the destination, the thread when the plan has one, the
 * climax the plan was composed around (addendum 4), and the
 * bookend pairing when the shelf offered one (addendum 5). A
 * played set is never part of this context, by construction:
 * the wrap-up is authored at preparation for the planned drive
 * played to finish, so it can close the episode's ARC but must
 * never assert a recap of specific stories as heard.
 * buildWrapUpContext (routeMode) assembles this from the plan.
 */
export interface WrapUpContext {
  destinationName: string;
  threadTopic: string | null;
  /**
   * How the plan's climax resolved (addendum 4): 'destination'
   * lets the arrival beat land on the climax; 'late' names it
   * as the drive's heart; 'natural' adds no climax sentence —
   * arrival is treated plainly.
   */
  climaxMode: 'destination' | 'late' | 'natural';
  /** The climax story's subject, when the plan has one. */
  climaxSubject: string | null;
  /**
   * The bookend pairing (addendum 5): the opening story's
   * subject, the closing climax's subject, and the tag they
   * share — the end explains the beginning. Null when the
   * shelf offered no pairing.
   */
  bookend: { openingSubject: string; sharedTopic: string; climaxSubject: string } | null;
}

/**
 * The ONE wrap-up text (addendum 3, Erik's simplification):
 * written for the planned drive played to completion — the
 * arrival beat, the thread payoff as arc language when a
 * thread exists, the climax/bookend closes the plan actually
 * composed (addendums 4–5), and Miles' sign-off. Authored
 * deterministically from the context (the same discipline as
 * the bridge text): no played-set claims, so it stays
 * truthful even if a mid-drive story dropped. ~30–45 s spoken.
 */
export function wrapUpTextFor(ctx: WrapUpContext): string {
  const arrival = `And here we are — ${ctx.destinationName}. `;
  const arc = ctx.threadTopic
    ? `That was the ${ctx.threadTopic} thread, beginning to end: it ran under every mile of this drive, and it ties off here, where the road delivers us. Every place we passed was one more verse of the same song — the kind of drive that reminds you a commute is never just a commute. `
    : `That was the drive, beginning to end — a road full of stories, and we rode it the whole way. This county layers its history right along the asphalt; you only have to be listening. `;
  const climax =
    ctx.climaxMode === 'destination' && ctx.climaxSubject
      ? `${ctx.climaxSubject} was where it all came together. `
      : ctx.climaxMode === 'late' && ctx.climaxSubject
        ? `And ${ctx.climaxSubject} — that was the heart of it. `
        : '';
  const bookend = ctx.bookend
    ? `And notice how it bookends: we started with ${ctx.bookend.openingSubject}, and ${ctx.bookend.climaxSubject} closed the loop — ${ctx.bookend.sharedTopic} at both ends of the drive. `
    : '';
  const signOff = `Thanks for riding with me. This is Miles — I'll be here for the next one.`;
  return `${arrival}${arc}${climax}${bookend}${signOff}`;
}

// ------------------------------------------------------------ bridge text (the preview lives here too)

/** Unfloored spoken-length estimate for short composed lines (bridges). */
function estimateSpokenSec(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(3, Math.round((words / 150) * 60));
}

/**
 * Authored connective sentences for elastic bridges. Place-free
 * by design — a bridge may stretch over any ground, so these
 * lines carry the drive, never facts about a place. The
 * pair-specific head line carries the names; these carry
 * the time.
 */
export const BRIDGE_CONNECTIVE_LINES: string[] = [
  'The road has a way of stitching this county together, one valley at a time.',
  'Keep your eyes up — the landscape is about to change its mind again.',
  'This is the part of the drive where the city starts showing its layers.',
  "Every mile out here has somebody's whole life folded into it.",
  'The map says one thing; the ground underneath remembers another.',
  'We are crossing ground that generations have crossed before us.',
  'San Diego does this — it hides its best stories in plain sight, right along the commute.',
  'Plenty of road behind us now, and the good stuff has a habit of clustering up ahead.',
  'If you have done this drive a hundred times, this is the stretch worth looking at fresh.',
  'The hills, the canyons, the bay pulling at the edge of everything — this county never just sits there.',
  'Settle in for a moment. The next story is worth arriving at properly.',
  'This is Miles, riding shotgun — pointing at the things the road forgets to mention.',
];

/** Pre-rendered reaction bank lines (Miles-solo, voice-only — no music, no archival stingers). */
export const REACTION_BANK: string[] = [
  'Still with me? Good. This county just keeps unfolding.',
  'Plenty of road left. Plenty of stories on it, too.',
  'I could drive these roads every day and still find something new.',
];

/**
 * The real context a bridge is composed with (differentiator
 * 2): the thread (when the plan has one), the previous story's
 * subject + one-line gist, the next story's subject. Subjects
 * from later in the plan appear in exactly one place — the
 * OPENING bridge, the spoken episode preview: it names the
 * destination, the climax it teases (addendum 4: the actual
 * climax, wherever it sits — not necessarily the destination),
 * and one mid-drive subject, because drawing the listener in
 * IS its job. A mid bridge's callback subject is always an
 * item EARLIER in this same plan. The preview's continuity
 * nod names a previously-heard subject only when the caller's
 * heard input actually contains one from this route's ground —
 * it is never invented.
 */
export interface BridgeContext {
  threadTopic: string | null;
  prevSubject: string;
  prevGist: string | null;
  nextSubject: string;
  role: 'opening' | 'mid' | 'payoff';
  /** Opening role only: the closing story the preview promises. */
  closingSubject?: string;
  /** Opening role only: where the drive ends. */
  destinationName?: string;
  /** Opening role only: how many stories the plan carries. */
  storyCount?: number;
  /** Opening role only: one mid-drive subject to listen for (thread plans). */
  midSubject?: string;
  /** Opening role only: the mid subject's own first line, when short enough to hook with. */
  midGist?: string;
  /** Opening role only: the climax subject the preview teases (addendum 4). */
  climaxSubject?: string;
  /** Opening role only: how the climax resolves — the promise is worded to match. */
  climaxMode?: 'destination' | 'late' | 'natural';
  /**
   * Opening + payoff roles (addendum 5): the bookend pairing —
   * the opening story's subject and the tag it shares with the
   * climax. The preview opens the loop with them; the climax's
   * bridge closes it.
   */
  openingSubject?: string;
  bookendTopic?: string;
  /** Opening role only: a real previously-heard subject on this route's ground, when the ledger has one. */
  previouslyHeardSubject?: string;
  /**
   * Opening role only: the matched prior DRIVE (addendum 2) —
   * its thread topic and up to two still-owed subjects, all from
   * the stored record as filtered against the current heard
   * ledger. When present it takes the continuity slot: the
   * subject-level nod stands down (the drive record is the
   * richer continuity, and the preview gets one nod, not two).
   */
  priorDrive?: { threadTopic: string | null; stillOwedSubjects: string[] };
  /** Mid role only: an earlier plan item this bridge may call back. */
  callbackSubject?: string;
  /** Payoff role only: whether the opening promise was actually composed earlier in this plan. */
  promiseMade?: boolean;
}

/**
 * Pair-specific bridge text, composed at plan time, Miles-solo
 * — authored HERE, in the narration layer, from the context's
 * structured facts (addendum 5: persona phrasing lives in this
 * layer and the persona source, never in composition logic).
 * Elastic: given a target, connective sentences are appended —
 * in a rotation seeded by the pair, so a given bridge is stable
 * across rebuilds but pairs differ — until the spoken estimate
 * reaches the target or the bank runs out (a bridge composes
 * TOWARD its target; the authored bank tops out around a
 * minute, and longer anchor gaps are window-wait, by design).
 * A portal hop's bridge names the connection that earned the
 * hop. Through-line: the opening bridge is the spoken episode
 * preview — it draws the listener in with the thread (when the
 * plan has one), the destination, the climax it promises
 * (addendum 4: the actual climax subject, wherever it sits),
 * and a mid-drive hook; a mid bridge may call back an earlier
 * story on the thread; and the bridge into a sequenced climax
 * pays the preview's promise off — closing the bookend loop
 * explicitly when the climax is the opening story's partner
 * (addendum 5). The authored lines are built only from the
 * context's real plan facts, and elastic fill composes around
 * them. Without a context, the text is exactly the composer-v2
 * bridge.
 */
export function bridgeTextFor(
  prev: { id: string; placeName: string },
  next: { id: string; placeName: string },
  opts: { targetSec?: number; portalTopic?: string; context?: BridgeContext } = {},
): string {
  const target = opts.targetSec ?? 8; // routeMode's BRIDGE_MIN_SEC, mirrored (this layer stays import-free)
  let text = opts.portalTopic
    ? `From ${prev.placeName}, there is a thread worth following — ${opts.portalTopic} ties it to ${next.placeName}, a little way off our road, and the connection is too good to skip.`
    : `From ${prev.placeName} we keep rolling — just ahead is ${next.placeName}, and it has its own story to tell.`;
  const ctx = opts.context;
  if (ctx && !opts.portalTopic) {
    if (ctx.role === 'opening') {
      // The spoken episode preview (Erik, Nov 3, 2026): this
      // bridge's job is to draw the listener in. With a thread,
      // it names the thread, the destination, the climax it
      // promises, and one mid-drive subject to listen for;
      // without one, the destination, how many stories are
      // coming, and the closing story. The promise names the
      // ACTUAL climax (addendum 4): sequenced last, it is
      // where the drive comes together; in natural order, it
      // is the one the drive builds to. A continuity nod rides
      // when the context carries a real previously-heard
      // subject — and only then.
      const promiseSubject = ctx.climaxSubject ?? ctx.closingSubject;
      if (ctx.threadTopic && promiseSubject) {
        text +=
          ctx.climaxMode === 'natural'
            ? ` Here's the thread to listen for on this drive: ${ctx.threadTopic}. It runs under this whole road, all the way to ${ctx.destinationName ?? 'the end'}. Keep an ear out for ${promiseSubject} — that's the one this drive builds to.`
            : ` Here's the thread to listen for on this drive: ${ctx.threadTopic}. It runs under this whole road — and by the time we reach ${ctx.destinationName ?? 'the end'}, I'll tell you about ${promiseSubject}, where it all comes together.`;
        if (ctx.midSubject) {
          text += ` And halfway there, ${ctx.midSubject} is waiting${ctx.midGist ? ` — ${ctx.midGist.replace(/\.$/, '')}` : ''}.`;
        }
      } else if (ctx.closingSubject) {
        text += ` We're headed to ${ctx.destinationName ?? 'the end'} — ${ctx.storyCount ?? 0} stories between here and there, and the last of them is ${ctx.closingSubject}.`;
      }
      // The bookend loop opens (addendum 5): the drive starts
      // with a subject the ending will explain.
      if (ctx.bookendTopic && ctx.openingSubject) {
        text += ` And hold onto ${ctx.openingSubject}, where this drive starts — ${ctx.bookendTopic} ties the first mile to the last.`;
      }
      // One continuity nod, never two: a matched prior DRIVE
      // (addendum 2) takes the slot over the subject-level nod.
      // Every name in it is record/ledger data — the prior
      // drive's thread, and what it still owes after the
      // current heard ledger discharged its share.
      if (ctx.priorDrive) {
        const owed = ctx.priorDrive.stillOwedSubjects;
        const owedList = owed.length === 2 ? `${owed[0]} and ${owed[1]}` : owed[0];
        if (owed.length > 0 && ctx.priorDrive.threadTopic) {
          text += ` Last time we came this way, the thread was ${ctx.priorDrive.threadTopic} — and Miles still owes you ${owedList}.`;
        } else if (owed.length > 0) {
          text += ` And Miles still owes you ${owedList} from last time we came this way.`;
        } else if (ctx.priorDrive.threadTopic) {
          text += ` Last time we came this way, the thread was ${ctx.priorDrive.threadTopic}.`;
        }
      } else if (ctx.previouslyHeardSubject) {
        text += ` Last time we came this way, you heard about ${ctx.previouslyHeardSubject} — today, new ground.`;
      }
    } else if (ctx.role === 'payoff' && (ctx.threadTopic || ctx.bookendTopic)) {
      if (ctx.threadTopic) {
        text += ctx.promiseMade
          ? ` And here it is — ${ctx.nextSubject}. I pointed at this one when we set out: this drive's ${ctx.threadTopic} thread lands here.`
          : ` And here it is — ${ctx.nextSubject}, where this drive's ${ctx.threadTopic} thread comes together.`;
      }
      // The bookend loop closes (addendum 5): the end explains
      // the beginning, naming both real subjects and their tag.
      if (ctx.bookendTopic && ctx.openingSubject) {
        text += ` And notice — ${ctx.openingSubject}, where we started, and ${ctx.nextSubject} are two ends of the same ${ctx.bookendTopic} thread: the end explains the beginning.`;
      }
    } else if (ctx.threadTopic && ctx.role === 'mid' && ctx.callbackSubject) {
      text += ` There's that ${ctx.threadTopic} thread again — ${ctx.callbackSubject} and ${ctx.nextSubject} are two ends of the same story.`;
    }
  }
  if (estimateSpokenSec(text) < target) {
    let seed = 0;
    const key = `${prev.id}>${next.id}`;
    for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) & 0x7fffffff;
    let idx = seed % BRIDGE_CONNECTIVE_LINES.length;
    let guard = 0;
    while (estimateSpokenSec(text) < target && guard < BRIDGE_CONNECTIVE_LINES.length) {
      text += ` ${BRIDGE_CONNECTIVE_LINES[idx % BRIDGE_CONNECTIVE_LINES.length]}`;
      idx += 1;
      guard += 1;
    }
  }
  return text;
}
