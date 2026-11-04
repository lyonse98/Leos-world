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
 * 3): the destination, the thread when the plan has one. A
 * played set is never part of this context, by construction:
 * the wrap-up is authored at preparation for the planned drive
 * played to finish, so it can close the episode's ARC but must
 * never assert a recap of specific stories as heard.
 * buildWrapUpContext (routeMode) assembles this from the plan.
 */
export interface WrapUpContext {
  destinationName: string;
  threadTopic: string | null;
}

/**
 * The ONE wrap-up text (addendum 3, Erik's simplification):
 * written for the planned drive played to completion — the
 * arrival beat, the thread payoff as arc language when a
 * thread exists, and Miles' sign-off. Authored deterministically
 * from the context (the same discipline as the bridge text):
 * no played-set claims, so it stays truthful even if a
 * mid-drive story dropped. ~30–45 s spoken.
 */
export function wrapUpTextFor(ctx: WrapUpContext): string {
  const arrival = `And here we are — ${ctx.destinationName}. `;
  const arc = ctx.threadTopic
    ? `That was the ${ctx.threadTopic} thread, beginning to end: it ran under every mile of this drive, and it ties off here, where the road delivers us. Every place we passed was one more verse of the same song — the kind of drive that reminds you a commute is never just a commute. `
    : `That was the drive, beginning to end — a road full of stories, and we rode it the whole way. This county layers its history right along the asphalt; you only have to be listening. `;
  const signOff = `Thanks for riding with me. This is Miles — I'll be here for the next one.`;
  return `${arrival}${arc}${signOff}`;
}
