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
export type NarrationKind = 'bridge' | 'preview' | 'wrapup' | 'gapstory' | 'color';

/**
 * Who is speaking. Miles solo by default everywhere. The
 * second chair (audience coloring, Nov 5, 2026) is NOT a
 * second voice: 'color-puck' is the SAME Puck voice under a
 * different prompt — Color Puck, the color-commentator
 * persona whose pieces carry the adult license in a Standard
 * episode (see the color section below). Callers never
 * branch on the voice; the text carries the persona.
 */
export type NarrationVoice = 'miles-solo' | 'color-puck';

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

// ------------------------------------------------------------ spoken forms (field fix, lane 5)

/**
 * Spoken-form normalization for LIVE tissue (field fix lane 5,
 * Nov 5, 2026): highway and route labels as they appear in
 * place names ("SR-905 West: Brown Field to I-805") read badly
 * when a TTS voice meets the raw abbreviation — the field
 * drive's bridges said the highway names "weird" because the
 * raw labels went to synthesis verbatim. Every live-authored
 * text (bridge, preview, wrap-up, reaction, commission) passes
 * through here as its final step BEFORE synthesis, so the
 * captured text is the spoken text, exactly. Word-boundary
 * anchored, digits required: the pronoun "I", "SR" inside a
 * word, and ordinary numbers are never touched. Library story
 * texts, unit ids, and place keys never pass through here —
 * this is a property of the live tissue only.
 */
export function spokenFormText(text: string): string {
  return text
    .replace(/\bPCF\s+(\d+)\b/g, 'P C F $1')
    .replace(/\bSR-(\d+)\b/g, 'State Route $1')
    .replace(/\bCA-(\d+)\b/g, 'State Route $1')
    .replace(/\bUS-(\d+)\b/g, 'U.S. $1')
    .replace(/\bI-(\d+)\b/g, 'Interstate $1');
}

// ------------------------------------------------------------ wrap-up text (addendum 3)

/**
 * The facts the wrap-up may speak — PLAN facts only (addendum
 * 3): the destination, the thread when the plan has one, and
 * the climax the plan was composed around (addendum 4, plus
 * the consolidation's off-route portal climax). A played set
 * is never part of this context, by construction: the wrap-up
 * is authored at preparation for the planned drive played to
 * finish, so it can close the episode's ARC but must never
 * assert a recap of specific stories as heard.
 * buildWrapUpContext (routeMode) assembles this from the plan.
 */
/**
 * The thread's anchor class (thread re-anchor, Nov 5, 2026)
 * — mirrors routeMode's ThreadAnchorKind (declared here so
 * the narration layer stays import-free of composition).
 */
export type ThreadAnchorKindView = 'destination' | 'onroute' | 'origin' | 'feature' | 'topic';

export interface WrapUpContext {
  destinationName: string;
  threadTopic: string | null;
  /**
   * The thread's speakable name when anchored (its place or
   * road name) and its anchor class. The wrap-up names where
   * an anchored thread tied off instead of naming a bare tag.
   */
  threadLabel?: string | null;
  threadAnchorKind?: ThreadAnchorKindView | null;
  /**
   * How the plan's climax resolved (addendum 4 + consolidation
   * §4): 'destination' lets the arrival beat land on the
   * climax; 'portal' — the off-route story the drive was about
   * — lands the same way; 'late' names it as the drive's
   * heart; 'natural' adds no climax sentence — arrival is
   * treated plainly. 'thread' (thread-carried episodes,
   * Nov 4, 2026): the strongest on-thread member holds the
   * climax position because the road offered no climax of its
   * own — it lands with the 'late' wording, the heart of the
   * drive.
   */
  climaxMode: 'destination' | 'late' | 'natural' | 'portal' | 'thread';
  /** The climax story's subject, when the plan has one. */
  climaxSubject: string | null;
}

/**
 * The ONE wrap-up text (addendum 3, Erik's simplification):
 * written for the planned drive played to completion — the
 * arrival beat, the thread payoff as arc language when a
 * thread exists, the climax close the plan actually composed,
 * and Miles' sign-off. Authored deterministically from the
 * context (the same discipline as the bridge text): no
 * played-set claims, so it stays truthful even if a mid-drive
 * story dropped. ~30–45 s spoken.
 */
export function wrapUpTextFor(ctx: WrapUpContext): string {
  const arrival = `And here we are — ${ctx.destinationName}. `;
  // Thread re-anchor (Nov 5, 2026): an anchored thread ties
  // off WHERE it lived — a destination anchor at the arrival
  // itself, an on-route place back at its ground, the origin
  // behind us, a road/thread along the drive. The topic
  // wording is unchanged.
  const anchoredArc =
    ctx.threadAnchorKind === 'destination' && ctx.threadLabel
      ? `And the thread of this drive was ${ctx.threadLabel} itself, waiting at the end of the road the whole way — every mile we covered was a mile closer to it, and it ties off here, at the arrival. `
      : ctx.threadAnchorKind === 'onroute' && ctx.threadLabel
        ? `The thread of this drive was ${ctx.threadLabel} — the country we passed through mid-drive, where the stories kept gathering. It ties off back there, at its own ground; the road carried it the rest of the way here. `
        : ctx.threadAnchorKind === 'origin' && ctx.threadLabel
          ? `The thread of this drive started back in ${ctx.threadLabel} country — the ground we set out from — and it ran with us the whole way, tying off here, where the road delivers us. `
          : (ctx.threadAnchorKind === 'feature' || ctx.threadAnchorKind === 'topic') && ctx.threadLabel && ctx.threadLabel !== ctx.threadTopic
            ? `The thread of this drive was ${ctx.threadLabel} — it ran under every mile of this drive, and it ties off here, where the road delivers us. `
            : null;
  const arc =
    anchoredArc ??
    (ctx.threadTopic
      ? `That was the ${ctx.threadTopic} thread, beginning to end: it ran under every mile of this drive, and it ties off here, where the road delivers us. Every place we passed was one more verse of the same song — the kind of drive that reminds you a commute is never just a commute. `
      : `That was the drive, beginning to end — a road full of stories, and we rode it the whole way. This county layers its history right along the asphalt; you only have to be listening. `);
  const climax =
    (ctx.climaxMode === 'destination' || ctx.climaxMode === 'portal') && ctx.climaxSubject
      ? `${ctx.climaxSubject} was where it all came together. `
      : (ctx.climaxMode === 'late' || ctx.climaxMode === 'thread') && ctx.climaxSubject
        ? `And ${ctx.climaxSubject} — that was the heart of it. `
        : '';
  const signOff = `Thanks for riding with me. This is Miles — I'll be here for the next one.`;
  return spokenFormText(`${arrival}${arc}${climax}${signOff}`);
}

// ------------------------------------------------------------ the spoken preview (consolidation §2)

/**
 * The facts the spoken episode preview may speak — the plan's
 * own facts, assembled by buildPreviewContext (routeMode)
 * from the composed plan. The preview is the plan's FIRST
 * item (consolidation §2): it draws the listener in with the
 * thread (when the plan has one), the destination, the climax
 * it promises (the actual climax, wherever it sits — not
 * necessarily the destination), and one mid-drive subject to
 * listen for. Its continuity nods name real data only: a
 * previously-heard subject appears solely when the caller's
 * heard input contains one from this route's ground, and a
 * prior DRIVE (addendum 2) solely when a stored record
 * matched this build — neither is ever invented.
 */
export interface PreviewContext {
  threadTopic: string | null;
  /**
   * The thread's speakable name when anchored (its place or
   * road name) and its anchor class (thread re-anchor,
   * Nov 5, 2026). The preview frames an anchored thread by
   * where the thread lives on this drive: the destination
   * waits at the end of the road; an on-route place owns the
   * middle; the origin is the ground we set out from; a
   * feature is the road's own arc. When the thread is a
   * plain topic (or the label equals the topic), the topic
   * wording stands unchanged.
   */
  threadLabel?: string | null;
  threadAnchorKind?: ThreadAnchorKindView | null;
  /** Where the drive ends. */
  destinationName: string;
  /** How many stories the plan carries. */
  storyCount: number;
  /** The plan's closing story subject — always present when a preview is composed. */
  closingSubject: string;
  /** The climax subject the preview teases, when the plan has one. */
  climaxSubject: string | null;
  /** How the climax resolves — the promise is worded to match. */
  climaxMode: 'destination' | 'late' | 'natural' | 'portal' | 'thread';
  /**
   * Thread-carried episode (Nov 4, 2026): the road could not
   * fill half this drive, so the episode is carried by its
   * thread — off-route members anchored along the timeline.
   * The preview must SAY so, plainly: the road is quiet
   * today, and the drive follows the thread instead. It
   * never implies the member stories are on the route.
   * Set only by the thread-carried rebuild (routeMode),
   * from the settled plan's own assessment.
   */
  threadCarried?: boolean;
  /** One mid-drive subject to listen for (thread plans only). */
  midSubject?: string;
  /** The mid subject's own first line, when short enough to hook with. */
  midGist?: string;
  /** A real previously-heard subject on this route's ground, when the ledger has one. */
  previouslyHeardSubject?: string;
  /**
   * Promise discipline (field fix F2, Nov 12, 2026): false
   * when the closing subject is seated but NOT window-
   * protected — the preview names the destination, the
   * count, and the thread, but never promises the closer by
   * name. Absent = protected; the promise stands.
   */
  closingNamed?: boolean;
  /**
   * Promise discipline (F2): the prior drive left owed
   * stories, but none is seated with window protection in
   * this plan — the preview acknowledges the debt generically
   * and names no titles. (A protected owed story rides
   * priorDrive.stillOwedSubjects and IS named; this flag is
   * then absent.)
   */
  owedUnnamed?: boolean;
  /**
   * The matched prior DRIVE (addendum 2) — its thread topic
   * and up to two still-owed subjects, all from the stored
   * record as filtered against the current heard ledger. When
   * present it takes the continuity slot: the subject-level
   * nod stands down (the drive record is the richer
   * continuity, and the preview gets one nod, not two).
   */
  priorDrive?: { threadTopic: string | null; stillOwedSubjects: string[] };
  /**
   * Thread sell (field fix F4, Nov 12, 2026): the thread's
   * window-protected members — how many, and the first and
   * last by name. The preview's cold-open sell is drawn ONLY
   * from these (promise discipline binds the sell). Absent =
   * no protected member: the thread is named, never sold.
   */
  threadSell?: { count: number; firstSubject: string; lastSubject: string };
}

/**
 * The spoken episode preview, authored HERE from the
 * context's structured facts (the same discipline as the
 * bridge and wrap-up text). With a thread, it names the
 * thread, the destination, the climax it promises, and a
 * mid-drive hook; without one, the destination, how many
 * stories are coming, and the closing story. The promise
 * names the ACTUAL climax: sequenced last, it is where the
 * drive comes together; in natural order, it is the one the
 * drive builds to.
 */
export function previewTextFor(ctx: PreviewContext): string {
  // Promise discipline (F2, Nov 12, 2026): the subject the
  // preview may PROMISE is the protected climax when the
  // composer cleared one, else the closing subject when IT
  // is protected. Both unprotected → promised is null: the
  // preview names the destination, the count, and the thread
  // (surfaces that cannot drop) and promises no story.
  const promiseSubject = ctx.climaxSubject ?? (ctx.closingNamed === false ? null : ctx.closingSubject);
  // The thread's spoken name: the anchor label when the
  // thread is anchored to a place or feature, else its topic.
  const threadName = ctx.threadTopic ?? ctx.threadLabel;
  // Thread sell (F4, Nov 12, 2026): the cold-open close for
  // threaded previews — the thread's depth and span, drawn
  // ONLY from its window-protected members (the composer
  // filtered them; a sold promise is still a promise). One
  // protected member is sold as what it is; two or more sell
  // the arc from first to last.
  const sell = ctx.threadSell;
  const sellSuffix =
    sell && sell.count >= 2 && sell.firstSubject !== sell.lastSubject
      ? ` The thread runs ${sell.count} stories deep on this drive — from ${sell.firstSubject} to ${sell.lastSubject}.`
      : sell && sell.count === 1
        ? ` One story carries the thread today: ${sell.firstSubject}.`
        : '';
  let text: string;
  if (ctx.threadCarried && threadName) {
    // Thread-carried framing (Nov 4, 2026): honest about the
    // shape of this episode — the road itself is quiet, the
    // THREAD is the drive. The promise is the member the
    // episode builds to (the designated climax when there is
    // one, else its closing story); the mid hook is a real
    // member of the plan, as everywhere. No sentence places
    // a member on the route. (Thread re-anchor, Nov 5, 2026:
    // an anchored thread keeps this honest shape — the road
    // is quiet today, so the drive follows the road to the
    // destination — with the anchor's own name in place of a
    // bare tag when the thread carries no topic.)
    text =
      ctx.threadTopic
        ? `The road's quiet today — so this drive follows a thread instead: ${ctx.threadTopic}. ` +
          `It runs under the whole road, all the way to ${ctx.destinationName}.`
        : `The road's quiet today — so we're following the road to ${ctx.destinationName}, and the thread is ${threadName} itself.`;
    if (promiseSubject) {
      text += ` Keep an ear out for ${promiseSubject} — that's the one this drive builds to.`;
    }
    if (ctx.midSubject) {
      text += ` And halfway there, ${ctx.midSubject} is waiting${ctx.midGist ? ` — ${ctx.midGist.replace(/\.$/, '')}` : ''}.`;
    }
    text += sellSuffix;
  } else if (threadName && promiseSubject) {
    // Thread re-anchor (Nov 5, 2026): anchored threads are
    // framed by where the thread LIVES on this drive. A
    // destination anchor: the road flows TOWARD the thread,
    // and the thread ties off at arrival. An on-route place:
    // the place owns the middle of the drive. An origin
    // anchor: we are leaving its country. A feature: the
    // road's own arc — presence-proven, so the "runs under
    // this whole road" language is earned. A plain topic
    // thread keeps the standing wording exactly.
    const anchored =
      ctx.threadAnchorKind === 'destination' && ctx.threadLabel
        ? ctx.climaxMode === 'natural'
          ? `Here's where this drive is headed — not just ${ctx.destinationName}, but ${ctx.threadLabel} itself. The whole road flows toward it, and ${promiseSubject} waits at the end.`
          : `Here's where this drive is headed — not just ${ctx.destinationName}, but ${ctx.threadLabel} itself, and it ties off at arrival: by the time we reach ${ctx.destinationName}, I'll tell you about ${promiseSubject}, where it all comes together.`
        : ctx.threadAnchorKind === 'onroute' && ctx.threadLabel
          ? `The heart of this drive is ${ctx.threadLabel} — it owns the middle of the road, and the stories keep gathering there. ${ctx.climaxMode === 'natural' ? `Keep an ear out for ${promiseSubject} — that's the one this drive builds to.` : `By the time we reach ${ctx.destinationName}, I'll tell you about ${promiseSubject}, where it all comes together.`}`
          : ctx.threadAnchorKind === 'origin' && ctx.threadLabel
            ? `We're leaving ${ctx.threadLabel} country — the ground we set out from threads this whole drive, all the way to ${ctx.destinationName}. Keep an ear out for ${promiseSubject} — that's the one this drive builds to.`
            : null;
    text =
      anchored ??
      (ctx.threadTopic
        ? ctx.climaxMode === 'natural'
          ? `Here's the thread to listen for on this drive: ${ctx.threadTopic}. It runs under this whole road, all the way to ${ctx.destinationName}. Keep an ear out for ${promiseSubject} — that's the one this drive builds to.`
          : `Here's the thread to listen for on this drive: ${ctx.threadTopic}. It runs under this whole road — and by the time we reach ${ctx.destinationName}, I'll tell you about ${promiseSubject}, where it all comes together.`
        : `The thread of this drive is ${threadName} — it runs under this whole road, all the way to ${ctx.destinationName}. Keep an ear out for ${promiseSubject} — that's the one this drive builds to.`);
    if (ctx.midSubject) {
      text += ` And halfway there, ${ctx.midSubject} is waiting${ctx.midGist ? ` — ${ctx.midGist.replace(/\.$/, '')}` : ''}.`;
    }
    text += sellSuffix;
  } else if (threadName) {
    // Promise discipline (F2): a thread but NO protected
    // promise — the thread is named and sold on its own
    // (it is a protected surface: the cast exists), and no
    // story is promised by name. The mid hook, when the
    // composer passed one, is protected by construction.
    text =
      ctx.threadAnchorKind === 'destination' && ctx.threadLabel
        ? `Here's where this drive is headed — not just ${ctx.destinationName}, but ${ctx.threadLabel} itself. The whole road flows toward it.`
        : ctx.threadAnchorKind === 'onroute' && ctx.threadLabel
          ? `The heart of this drive is ${ctx.threadLabel} — it owns the middle of the road, and the stories keep gathering there.`
          : ctx.threadAnchorKind === 'origin' && ctx.threadLabel
            ? `We're leaving ${ctx.threadLabel} country — the ground we set out from threads this whole drive, all the way to ${ctx.destinationName}.`
            : ctx.threadTopic
              ? `Here's the thread to listen for on this drive: ${ctx.threadTopic}. It runs under this whole road, all the way to ${ctx.destinationName}.`
              : `The thread of this drive is ${threadName} — it runs under this whole road, all the way to ${ctx.destinationName}.`;
    if (ctx.midSubject) {
      text += ` And halfway there, ${ctx.midSubject} is waiting${ctx.midGist ? ` — ${ctx.midGist.replace(/\.$/, '')}` : ''}.`;
    }
    text += sellSuffix;
  } else if (ctx.storyCount === 1) {
    text =
      ctx.closingNamed === false
        ? `We're headed to ${ctx.destinationName} — one story on the way.`
        : `We're headed to ${ctx.destinationName} — one story on the way, and it's ${ctx.closingSubject}.`;
  } else {
    text =
      ctx.closingNamed === false
        ? `We're headed to ${ctx.destinationName} — ${ctx.storyCount} stories between here and there.`
        : `We're headed to ${ctx.destinationName} — ${ctx.storyCount} stories between here and there, and the last of them is ${ctx.closingSubject}.`;
  }
  // Owed but unnameable (F2): the debt is acknowledged
  // without titles whenever no owed subject survived the
  // protection gate into priorDrive's named list.
  if (ctx.owedUnnamed && !(ctx.priorDrive && ctx.priorDrive.stillOwedSubjects.length > 0)) {
    text += ` And Miles still owes you a story from the last time we came this way.`;
  }
  // One continuity nod, never two: a matched prior DRIVE
  // (addendum 2) takes the slot over the subject-level nod.
  // Every name in it is record/ledger data — the prior
  // drive's thread, and what it still owes after the current
  // heard ledger discharged its share.
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
  return spokenFormText(text);
}

// ------------------------------------------------------------ bridge text

/**
 * Authored connective sentences, once the elastic bridges'
 * padding (composer v2). Place-free by design — they carry
 * the drive, never facts about a place. Field fix lane 1
 * (Nov 5, 2026) retired them from bridge authoring: a bridge
 * is its pair's facts at honest length, never stretched with
 * stock lines. The bank remains as the episode ledger's
 * fingerprint set — bridgeEpisodeStateFromTexts recognizes
 * these lines in existing texts so the no-repeat invariant
 * (lane 1b) stays checkable across passes — and as the
 * historical record of the lines the field drive heard
 * repeat.
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

/**
 * Neutral seam lines (field fix F5, Nov 12, 2026): the
 * fallback tissue for a bridge whose render failed. The
 * Nov 12 episode lost three late bridges to render failures
 * and the stories around them arrived across raw gaps. A
 * seam names NEITHER neighbor and claims nothing about the
 * road — it is a breath with words in it, a few seconds of
 * composed presence where the failure would have left a
 * tear. Selection is a stable hash of the bridge's own id,
 * so the same plan always falls back to the same seam.
 */
export const NEUTRAL_SEAM_LINES: string[] = [
  'We roll on.',
  'On we go.',
  'The road keeps unfolding.',
  'And the drive goes on.',
];

export function neutralSeamTextFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return NEUTRAL_SEAM_LINES[h % NEUTRAL_SEAM_LINES.length];
}

/** Pre-rendered reaction bank lines (Miles-solo, voice-only — no music, no archival stingers). */
export const REACTION_BANK: string[] = [
  'Still with me? Good. This county just keeps unfolding.',
  'Plenty of road left. Plenty of stories on it, too.',
  'I could drive these roads every day and still find something new.',
];

// ------------------------------------------------------------ Color Puck (audience coloring, Nov 5, 2026)

/**
 * COLOR PUCK — the route-mode color commentator (Erik, Nov 5,
 * 2026, settling the second-chair identity parked since
 * Oct 30): NOT a cast voice. Behind the scenes it is the same
 * Puck voice as Miles, generated under a DIFFERENT PROMPT —
 * one voice, two prompt-personas. Miles hosts straight in
 * both ratings; Color Puck is where the adult license lives,
 * and it exists only in a Standard episode: in Family the
 * color prompt never runs and Miles hosts alone.
 *
 * The persona discipline mirrors the Sanctum narrator
 * charter: a FIXED character frame (the dry-witted local
 * co-pilot — the funny tour guide who has driven this county
 * for thirty years and cannot resist one beat after a story
 * lands) plus a fixed PERSONA-COLOR BANK of moves below. A
 * color piece SELECTS a move from the bank and riffs inside
 * its register; it does not improvise a personality fresh
 * each episode. And the facts discipline is absolute: a
 * piece riffs ONLY on the story just told (its text is the
 * fact pack) — no invented facts, ever, even as jokes; no
 * color on or after memorial/somber material (the composer-
 * side class, routeMode.colorSuppressedFor, never offers
 * those beats); living people stay public-record.
 */

/** A color piece's hard character cap: a beat, not a monologue (~15–17 s spoken). */
export const COLOR_MAX_CHARS = 260;

/** Color pieces per episode, at most — reactions, bridge asides, and the closeout line share this one budget. */
export const COLOR_MAX_PER_EPISODE = 5;

/** One move from the color bank: a named register a piece is authored inside. */
export interface ColorBankMove {
  name: string;
  register: string;
}

/**
 * The persona-color bank (fixed, Erik-reviewable): the moves
 * Color Puck may make, in rotation. Each is a DELIVERY
 * register over the story's own facts — none of them is a
 * source of facts.
 */
export const COLOR_BANK: ColorBankMove[] = [
  {
    name: 'the dry aside',
    register:
      'one flat, knowing sentence, deadpan — the joke is that you barely react to how wild the fact is',
  },
  {
    name: "the local's nod",
    register:
      'the insider beat: what every local knows about this place that the story just proved, said with a grin',
  },
  {
    name: 'the tour-guide wink',
    register:
      'playful direct address to the riders — the guide who loves this stop on the route and is not hiding it',
  },
  {
    name: 'the bar-stool footnote',
    register:
      'one colorful detail FROM the story, retold the way it would be told at the end of a bar — same facts, more grin',
  },
  {
    name: 'the straight-faced scale joke',
    register:
      'comic emphasis on a true size, date, or number in the story — exaggerate the REACTION, never the figure',
  },
];

/** The facts a color piece may speak: the story just told, and nothing else. */
export interface ColorContext {
  /** The story's subject (place name). */
  storySubject: string;
  /** The story's own text — the fact pack. The piece may claim nothing outside it. */
  storyText: string;
  /** The episode's thread topic, when the plan has one (color only — never a fact source). */
  threadTopic: string | null;
  /** Where the drive ends. */
  destinationName: string;
  /** The surface the piece plays on. */
  surface: 'reaction' | 'aside' | 'closeout';
  /** The bank move this piece is authored inside (rotation is the caller's). */
  move: ColorBankMove;
}

/**
 * The color prompt: ridden on the standing story-generation
 * path (the persona system instruction stays byte-identical —
 * per-call specifics ride in user prompts by design), this
 * prompt steps the voice into the color chair for ONE beat.
 * The adult license is stated as Erik ruled it (Nov 5, 2026):
 * profanity as seasoning at funny-tour-guide heat, riffing,
 * ad libs, jokes, direct address — inside the guardrails
 * that never bend (facts only, no memorial riffing, no
 * invented facts played for laughs).
 */
export function colorPromptFor(ctx: ColorContext): string {
  const surfaceLine =
    ctx.surface === 'closeout'
      ? 'This is the closing beat of the episode — the last word after the final story, before Miles signs off.'
      : ctx.surface === 'reaction'
        ? 'This lands in a reaction slot, right after the story, mid-drive.'
        : 'This is a short aside right after the story, as the drive rolls on.';
  const parts = [
    'COLOR COMMENTARY — one short piece, from the second chair.',
    'You are the same guide, the same voice — but for this one beat you are COLOR PUCK: the color commentator riding along, the funny local co-pilot who has driven this county for thirty years and cannot resist one beat after a story lands. Miles hosts straight; you are the grin after his sentence.',
    surfaceLine,
    `THE STORY JUST TOLD — your ONLY facts. Riff on these and nothing else:\nSubject: ${ctx.storySubject}\n${ctx.storyText}`,
    `YOUR MOVE (from the color bank): ${ctx.move.name} — ${ctx.move.register}.`,
    [
      'Rules that never bend:',
      `- ONE beat: at most ${COLOR_MAX_CHARS} characters, one or two sentences. Land it and stop.`,
      '- Facts: every claim in your beat must come from the story above. Invent NOTHING — no names, dates, numbers, people, or events that are not in it. A joke built on an invented fact is a lie with a laugh track.',
      '- Adult register: profanity is seasoning, not the meal — the occasional damn or hell (or one stronger word, once) lands BECAUSE it is occasional. Funny-tour-guide heat, never shock-jock saturation.',
      '- Jokes punch at situations, history, scale, and the listener\u2019s own drive — never at the dead, the grieving, victims, or living private people.',
      '- No relative directions (nothing "on your left", nothing "coming up"), no markdown, no stage directions — plain spoken prose, ready to be read aloud exactly as written.',
    ].join('\n'),
  ];
  if (ctx.threadTopic) {
    parts.push(`The episode's thread is ${ctx.threadTopic}; the drive ends at ${ctx.destinationName}. Context only — not a fact source.`);
  } else {
    parts.push(`The drive ends at ${ctx.destinationName}. Context only — not a fact source.`);
  }
  return parts.join('\n\n');
}

// ------------------------------------------------------------ Family rules for generated stories (coloring scope §2)

/**
 * The Family block for the ONE model-authored story surface
 * (the generated gap story): appended to the gap-story user
 * prompt when the build's rating is Family — in the user
 * prompt, never the persona system instruction, whose
 * byte-identical prefix is a caching and discipline
 * invariant. Family is a framing discipline, not a
 * falsification license: it chooses what to tell and where
 * the weight sits; it never softens a fact into an untruth.
 */
export const FAMILY_GAP_STORY_RULES = [
  'AUDIENCE: FAMILY — this telling is the G-rated version, and these rules govern it completely:',
  '- Vocabulary: no profanity, no innuendo, no gallows humor. Humor is gentle and situation-based.',
  '- Death and tragedy: real deaths may appear only as plain historical fact at civic-history distance ("he died there in 1873") — never a dramatized scene, never method or suffering detail, never the emotional peak of the piece. If this subject\u2019s story IS a death or a haunting, do not soften it — tell the subject\u2019s civic story instead (what was built, who built it, what it was for), or keep to the parts of its record that stand at that distance.',
  '- Violence: outcomes over acts ("the raid ended the settlement") — never blow-by-blow, never weapon detail as color.',
  '- Sex and vice: brothels, gambling, saloons, opium are named at category level only, and only where the category is the historical engine that cannot honestly be removed. Never depicted, never played for spice or comedy.',
  '- Alcohol and Prohibition: civic and economic history — the ban, the smuggling routes, the patrol boats, repeal. Adventure framing; no speakeasy glamour, no drinking detail.',
  '- Fear: no haunting framing. Legends are told as documented history, or not told.',
  '- Never falsify: a place where something sad happened does not become a place where nothing happened. Choose what to tell; do not rewrite what happened.',
].join('\n');

/**
 * The head shapes a bridge can open with (field fix lane 1b).
 * The standard on-road head rotates through three phrasings
 * of the same facts; the off-route heads are their own shapes
 * (the range, the portal hop). Recorded in the episode ledger
 * so no two consecutive bridges open alike and the rotation
 * spreads across the episode.
 */
export type BridgeOpeningShape = 'ahead' | 'carries' | 'next' | 'rolling' | 'portal';

/**
 * The EPISODE LEDGER for bridges (field fix lane 1b, Nov 5,
 * 2026 — Erik, from the first real route drive: "the bridges
 * didn't seem to be aware of each other"). Bridges were
 * authored pair-locally, so one episode repeated its own
 * devices: the same connective-bank lines padded bridge after
 * bridge, and the thread callout ("two ends of the same
 * story") fired on nearly every bridge. The ledger is the
 * episode's memory, carried as DATA through the seam: the
 * composer threads one ledger through a plan's bridges in
 * order; member surgery and the runner's commissions seed
 * theirs from the texts already in the episode
 * (bridgeEpisodeStateFromTexts) and extend it. The rules it
 * enforces live in bridgeTextFor: no bank line ever repeats
 * within an episode (lane 1 removed bank padding outright —
 * the ledger still records any bank line an existing text
 * carries, so the invariant is checkable), the thread callout
 * fires at most once per episode, and standard openings
 * rotate.
 */
export interface BridgeEpisodeState {
  /** Connective-bank lines already present in this episode's bridges. */
  bankLinesUsed: string[];
  /** The thread callout has fired in this episode. */
  threadCalloutUsed: boolean;
  /** Opening shapes authored so far, in order. */
  openings: BridgeOpeningShape[];
  /**
   * Bridge MOVES authored so far, in order (Nov 11, 2026): a
   * bridge performs ONE move from the seven-move set, and the
   * rotation rules (no move twice running, anchor a minority,
   * question ≤2/episode, a mandated quiet handoff in long
   * episodes) are enforced off this ledger — the same discipline
   * as the opening shapes.
   */
  moves: BridgeMove[];
}

/** A fresh episode ledger (a plan's first bridge starts here). */
export function newBridgeEpisodeState(): BridgeEpisodeState {
  return { bankLinesUsed: [], threadCalloutUsed: false, openings: [], moves: [] };
}

/**
 * The seven bridge moves (Nov 11, 2026). A bridge is connective
 * tissue with a JOB: anchor the road in place-names, tease what
 * is coming, call back what was heard, ask the question the next
 * story answers, stitch the thread, mark the distance, or hand
 * over quietly. The sameness the field drives heard came from
 * every bridge doing the anchor's job in the same syntax; the
 * rotation exists so each bridge does a different one.
 */
export type BridgeMove =
  | 'anchor'
  | 'forward-tease'
  | 'callback'
  | 'question'
  | 'thread-stitch'
  | 'distance'
  | 'quiet-handoff';

/** Which head shape a bridge text opens with, by its fingerprint. Null when it matches none (fixtures, foreign texts). */
function openingShapeOf(text: string): BridgeOpeningShape | null {
  if (text.includes('we range off the road for a story')) return 'portal';
  if (/we keep rolling — just ahead is/.test(text)) return 'ahead';
  if (text.includes('the road carries us on to')) return 'carries';
  if (text.includes('Next along the road:')) return 'next';
  if (/we keep rolling\./.test(text)) return 'rolling';
  return null;
}

/**
 * Rebuild an episode ledger from bridge texts already in the
 * episode — the seam-side memory for passes that author into
 * a plan they did not compose (member surgery, drive-time
 * commissions). Detection is by fingerprint (bank lines
 * verbatim, the callout formula, opening shapes), so a ledger
 * seeded this way knows exactly what the listener has already
 * heard.
 */
/** Which bridge move a text performed, by its fingerprint. Null when it matches none (fixtures, foreign texts). */
function moveShapeOf(text: string): BridgeMove | null {
  if (text.includes('?')) return 'question';
  if (text.includes('two ends of the same story') || text.includes('thread again')) return 'thread-stitch';
  if (text.includes('stays with us')) return 'callback';
  if (text.includes('miles of road yet') || text.includes('another mile of road')) return 'distance';
  if (text.includes('earns its moment') || text.includes('worth the wait')) return 'forward-tease';
  const t = text.trim();
  if (/^From .{1,60} we roll on\.$/.test(t) && t.length <= 80) return 'quiet-handoff';
  if (openingShapeOf(t)) return 'anchor';
  return null;
}

export function bridgeEpisodeStateFromTexts(texts: string[]): BridgeEpisodeState {
  const state = newBridgeEpisodeState();
  for (const t of texts) {
    for (const line of BRIDGE_CONNECTIVE_LINES) {
      if (t.includes(line) && !state.bankLinesUsed.includes(line)) state.bankLinesUsed.push(line);
    }
    if (t.includes('two ends of the same story')) state.threadCalloutUsed = true;
    const shape = openingShapeOf(t);
    if (shape) state.openings.push(shape);
    const move = moveShapeOf(t);
    if (move) state.moves.push(move);
  }
  return state;
}

/**
 * The real context a bridge is composed with (differentiator
 * 2): the thread (when the plan has one), the previous story's
 * subject + one-line gist, the next story's subject. A bridge
 * is pure connective tissue between its pair — the episode
 * framing that used to ride the first bridge now lives in the
 * plan's own preview item (consolidation §2, previewTextFor
 * above). A mid bridge's callback subject is always an item
 * EARLIER in this same plan. The bridge into a sequenced
 * climax is the payoff: it owes the preview its closing beat.
 * The bridge into an off-route portal climax (consolidation
 * §4) carries the subject it hops to, so the hop is framed
 * honestly — the story is not on the road, and no proximity
 * language is ever used for it.
 */
export interface BridgeContext {
  threadTopic: string | null;
  /**
   * The thread's speakable name when anchored (its place or
   * road name) and its anchor class (thread re-anchor,
   * Nov 5, 2026). When the thread carries no topic, the
   * payoff/callback lines name the thread by this label
   * instead of falling silent.
   */
  threadLabel?: string | null;
  threadAnchorKind?: ThreadAnchorKindView | null;
  prevSubject: string;
  prevGist: string | null;
  nextSubject: string;
  role: 'mid' | 'payoff';
  /** Mid role only: an earlier plan item this bridge may call back. */
  callbackSubject?: string;
  /** Payoff role only: whether the preview actually promised this climax earlier in the plan. */
  promiseMade?: boolean;
  /**
   * Payoff role only (consolidation §4): the climax story is
   * OFF the route — its real place name, carried so the bridge
   * frames the hop honestly instead of pretending the ground
   * ahead holds it.
   */
  offRouteSubject?: string;
  /**
   * Mid role only (Nov 4, 2026): the next story is a WOVEN
   * MEMBER — an off-route story seated in a silent gap as a
   * member of the plan's through-line. Its real place name,
   * carried so the bridge frames the range honestly: the host
   * is following the thread across the county, and no
   * proximity, visibility, or passing language is ever used
   * for it.
   */
  wovenSubject?: string;
  /**
   * The next story's one-line gist (Nov 11, 2026): the forward
   * tease names it as a promise. Null when the next story carries
   * no text (or, under Family, when its first line must not be
   * spoken verbatim — the same gist rule as prevGist).
   */
  nextGist?: string | null;
  /** The next story's angle — the question move is keyed to it (a question is only posed where the story demonstrably answers it). */
  nextAngle?: string | null;
  /**
   * The PREVIOUS story is a woven member (Nov 11, 2026): this
   * bridge is the return to the road, and the return is the
   * anchor's job — proximity framing is honest again here, and
   * no other move displaces it.
   */
  prevWoven?: boolean;
  /**
   * Promise discipline (field fix F2c, Nov 12, 2026): the
   * next story is NOT committed — seated without window
   * protection, or (for runner-authored commissions) inside
   * a window too tight to confirm at authoring time. The
   * bridge must not name or announce it: the lead-in anchors
   * on the CURRENT place (a factual callback without the
   * forward tail) or hands off quietly. If the story then
   * drops, nothing was promised; if it sounds, it arrives
   * unannounced but unbroken. Set by routeMode's
   * buildBridgeContext from the caller's verdict.
   */
  nextUncommitted?: boolean;
  /**
   * Memorial guardrails (Nov 11, 2026): either side of the pair
   * is in the audited memorial set. Into memorial ground the
   * allowed moves shrink to quiet handoff, plain anchor, and
   * factual callback — question, forward tease, and the thread
   * callout formula are banned there.
   */
  memorialPair?: boolean;
  /** Either side is somber/protected-register: the quiet handoff is preferred. */
  somberPair?: boolean;
  /**
   * The pair's segment distance in meters (anchor to anchor,
   * derived from the plan's own geometry): the distance/time
   * marker speaks only this, in honest bands.
   */
  segDistanceM?: number | null;
}

/**
 * A story's gist as a speakable mid-sentence clause: trailing
 * punctuation stripped, and the first word lowercased ONLY when
 * it is a common sentence-starter — a proper noun or an acronym
 * keeps its capital, so TTS never hears a mangled name.
 */
const GIST_STARTERS = new Set([
  'the', 'a', 'an', 'it', 'in', 'on', 'when', 'before', 'after', 'long', 'by',
  'for', 'with', 'this', 'that', 'there', 'here', 'he', 'she', 'they', 'we',
  'its', 'his', 'her', 'their', 'one', 'two', 'first', 'back', 'over', 'under',
]);
/**
 * A gist as a bridge SPEAKS it: trimmed to a transition's size
 * (~110 chars at a word boundary). The context gist keeps its
 * full 160-char cap for composition logic; only the spoken
 * callback/tease sentences trim — bridge durations feed the
 * runner's suppression predictions, and a bridge that recaps
 * at length reprices every window behind it.
 */
export function spokenGist(gist: string): string {
  const clean = gist.replace(/…$/, '').trim();
  if (clean.length <= 110) return clean;
  // Prefer a whole sentence when one ends inside the budget
  // (the context gist carries up to two); else a word boundary.
  const sentenceEnd = clean.lastIndexOf('. ', 110);
  if (sentenceEnd > 40) return clean.slice(0, sentenceEnd + 1).trim();
  const cut = clean.slice(0, 110);
  const at = cut.lastIndexOf(' ');
  return (at > 60 ? cut.slice(0, at) : cut).trim();
}

export function gistClause(gist: string): string {
  const clean = gist.replace(/\s+/g, ' ').trim().replace(/[.!?…]+$/, '');
  const m = clean.match(/^(\S+)\s+(.*)$/);
  if (!m) return clean;
  const first = m[1];
  const rest = m[2];
  const lower = first.toLowerCase();
  // A plain capitalized starter ("The", "In", "When") lowercases;
  // anything with interior capitals or apostrophes (a name, an
  // acronym) keeps its case untouched.
  const plainCapitalized =
    first.length > 1 &&
    first.charAt(0) === first.charAt(0).toUpperCase() &&
    first.slice(1) === first.slice(1).toLowerCase();
  if (GIST_STARTERS.has(lower) && (first === lower || plainCapitalized)) {
    return `${lower} ${rest}`;
  }
  return clean;
}

/** The question move's templates, keyed by the next story's angle class. Null = no honest question exists for this pair. */
function questionTextFor(angle: string | null | undefined, prev: string, next: string): string | null {
  if (!angle) return null;
  if (angle.includes('mechanism') || angle.includes('how') || angle.includes('works')) {
    return `From ${prev} we keep rolling. So how does ${next} actually work? Stay close — the answer is just ahead.`;
  }
  if (angle.includes('origin') || angle.includes('founding') || angle.includes('begin')) {
    return `From ${prev} we keep rolling. How did ${next} even begin? Stay close — the answer is just ahead.`;
  }
  if (angle.includes('event') || angle.includes('history') || angle.includes('story')) {
    return `From ${prev} we keep rolling. So what happened at ${next}? Stay close — the answer is just ahead.`;
  }
  return null;
}

/**
 * Choose this bridge's move from the ledger + the pair's facts —
 * deterministic, the pickStandardHead discipline. Every rule is
 * a degrade toward the anchor: when a move's facts are missing
 * or its budget is spent, the next move is tried, and the anchor
 * (today's heads) is the floor every bridge can always stand on.
 */
function chooseBridgeMove(ctx: BridgeContext, episode: BridgeEpisodeState): BridgeMove {
  const moves = episode.moves;
  const done = moves.length;
  const last = moves[done - 1];
  const count = (m: BridgeMove) => moves.filter(x => x === m).length;
  // The return from a woven member re-anchors on the road.
  if (ctx.prevWoven) return 'anchor';
  // The thread stitch outranks even the first-bridge anchor:
  // when the pair carries a real callback subject on threaded,
  // non-memorial, non-somber ground, the callout family IS the
  // bridge the episode is owed (the field-fix lane-1 pin: the
  // uncapped first bridge of a threaded episode carries the
  // callout). Memorial pairs never stitch (guardrails below).
  if (
    ctx.role === 'mid' &&
    (ctx.threadTopic || ctx.threadLabel) &&
    ctx.callbackSubject &&
    last !== 'thread-stitch' &&
    !ctx.memorialPair &&
    !ctx.somberPair
  ) {
    return 'thread-stitch';
  }
  // The episode's first bridge anchors (the road gets named
  // before it gets played with) — except into memorial ground,
  // where the quiet handoff may lead.
  if (done === 0 && !ctx.memorialPair) return 'anchor';
  // Mandated quiet handoff (episodes of 7+ stories carry ≥6
  // bridges): if the sixth bridge arrives with none served, it
  // serves — the episode is guaranteed its one composed beat.
  if (done >= 5 && !moves.includes('quiet-handoff')) return 'quiet-handoff';
  // Memorial ground: quiet handoff, factual callback, plain
  // anchor — nothing else, ever.
  if (ctx.memorialPair) {
    if (ctx.somberPair && last !== 'quiet-handoff') return 'quiet-handoff';
    if (ctx.prevGist && last !== 'callback') return 'callback';
    if (last !== 'quiet-handoff' && count('quiet-handoff') === 0 && done >= 2) return 'quiet-handoff';
    return 'anchor';
  }
  // Somber ground prefers the quiet handoff.
  if (ctx.somberPair && last !== 'quiet-handoff' && count('quiet-handoff') < 2) return 'quiet-handoff';
  // The thread stitch: today's callout family, when the pair
  // carries a real callback subject and the move is off cooldown.
  if (
    ctx.role === 'mid' &&
    (ctx.threadTopic || ctx.threadLabel) &&
    ctx.callbackSubject &&
    last !== 'thread-stitch'
  ) {
    return 'thread-stitch';
  }
  // Callback: the previous story's gist, actually spoken — the
  // fact the old skeleton carried and never said.
  if (ctx.prevGist && last !== 'callback' && done >= 1 && count('callback') * 2 <= done) return 'callback';
  // Question: angle-keyed, ≤2 per episode, never twice running,
  // on a spaced cadence.
  if (questionTextFor(ctx.nextAngle, ctx.prevSubject, ctx.nextSubject) && count('question') < 2 && last !== 'question' && done % 3 === 2) {
    return 'question';
  }
  // Distance/time marker: a real stretch of road between the pair.
  if (ctx.segDistanceM != null && ctx.segDistanceM >= 1609 && last !== 'distance') return 'distance';
  // Forward tease: the next story's gist named as a promise.
  if (ctx.role === 'mid' && ctx.nextGist && count('forward-tease') < 3 && last !== 'forward-tease' && done >= 1) {
    return 'forward-tease';
  }
  // A long episode still owes its quiet handoff.
  if (done >= 3 && last !== 'quiet-handoff' && count('quiet-handoff') === 0) return 'quiet-handoff';
  // Anchor budget: from the fifth bridge on, anchors stay a
  // minority — when the share would pass 40%, a factual
  // alternative serves instead.
  if (done >= 4 && (count('anchor') + 1) / (done + 1) > 0.4) {
    if (ctx.prevGist && last !== 'callback') return 'callback';
    if (last !== 'quiet-handoff') return 'quiet-handoff';
  }
  return 'anchor';
}

/** The standard on-road head shapes, in rotation order (lane 1b). Each is pure phrasing around the same two facts. */
const STANDARD_HEADS: { shape: BridgeOpeningShape; make: (prev: string, next: string) => string }[] = [
  {
    shape: 'ahead',
    make: (prev, next) => `From ${prev} we keep rolling — just ahead is ${next}, and it has its own story to tell.`,
  },
  { shape: 'carries', make: (prev, next) => `From ${prev}, the road carries us on to ${next}.` },
  { shape: 'next', make: (prev, next) => `From ${prev} we roll on. Next along the road: ${next}.` },
];

/**
 * Pick the next standard head shape from the episode ledger:
 * never the shape the immediately previous bridge opened with
 * (when any alternative exists), otherwise the least-used
 * shape in the episode — deterministic, ties by rotation
 * order. The choice is recorded by the caller.
 */
function pickStandardHead(episode: BridgeEpisodeState): (typeof STANDARD_HEADS)[number] {
  const last = episode.openings[episode.openings.length - 1];
  const counts = new Map<BridgeOpeningShape, number>();
  for (const s of episode.openings) counts.set(s, (counts.get(s) ?? 0) + 1);
  const pool = STANDARD_HEADS.filter(h => h.shape !== last);
  const candidates = pool.length > 0 ? pool : STANDARD_HEADS;
  return candidates.reduce((best, h) => ((counts.get(h.shape) ?? 0) < (counts.get(best.shape) ?? 0) ? h : best));
}

/**
 * Pair-specific bridge text, composed at plan time, Miles-solo
 * — authored HERE, in the narration layer, from the context's
 * structured facts (addendum 5: persona phrasing lives in this
 * layer and the persona source, never in composition logic).
 *
 * HONEST LENGTH (field fix lane 1, Nov 5, 2026): a bridge is
 * its head plus whatever the pair's facts earn — a thread
 * sentence, a payoff beat, an honest hop framing. It is NEVER
 * stretched toward a time target with connective-bank filler:
 * the elastic padding was the field drive's awkwardness (84 s
 * bridges of stock lines) and its window burn (tissue seconds
 * are sequence seconds at highway speed). opts.targetSec is
 * still accepted from standing callers but no longer shapes
 * the text; genuine long waits belong to the composer's own
 * devices (window-wait, fillers, stories), never to a bridge.
 * opts.maxChars (the runner's re-bridge cap) drops the one
 * optional sentence — the mid thread callback — before it
 * ever truncates a head or a payoff mid-sentence.
 *
 * EPISODE AWARENESS (lane 1b): opts.episode is the episode
 * ledger (see BridgeEpisodeState). The standard head rotates
 * so consecutive bridges never open alike; the thread callout
 * ("two ends of the same story") fires at most once per
 * episode — later mid bridges name the callback plainly
 * instead. Without a ledger, a fresh one is used (a lone
 * bridge behaves exactly as the first bridge of an episode).
 *
 * A portal hop's bridge frames the story as one being TOLD
 * from across the county and names the connection that earned
 * the hop (lane 4) — no proximity language, ever. Through-
 * line: a mid bridge may call back an earlier story on the
 * thread, and the bridge into a sequenced climax pays the
 * preview's promise off — for an off-route portal climax, it
 * says so plainly: the story is not on this road, and Miles
 * is choosing it because it is what the drive has been about.
 * The authored lines are built only from the context's real
 * plan facts. The final text passes through spokenFormText
 * (lane 5), so what is captured is what is spoken.
 */
export function bridgeTextFor(
  prev: { id: string; placeName: string },
  next: { id: string; placeName: string },
  opts: {
    targetSec?: number;
    portalTopic?: string;
    context?: BridgeContext;
    episode?: BridgeEpisodeState;
    maxChars?: number;
    /**
     * A re-bridge COMMISSION (the runner's repair for a dropped
     * story): the repair keeps its historic composition — the
     * rotating standard head plus the thread sentence when the
     * pair carries one (the field-fix lane 1/1b pin) — rather
     * than drawing a fresh move from the rotation. Memorial
     * guardrails still bind: on memorial ground the chooser's
     * restricted set decides, commission or not.
     */
    commission?: boolean;
  } = {},
): string {
  const ctx = opts.context;
  const episode = opts.episode ?? newBridgeEpisodeState();
  const sentences: string[] = [];
  // An off-route climax gets no "just ahead" head — the story
  // is not ahead, it is across the county, and the bridge
  // says so (consolidation §4: honest framing, no proximity
  // language). A woven member's bridge is under the same
  // discipline: the next story is not ahead either — the host
  // is ranging along the thread, and the head says that
  // instead of pointing at the road.
  // The bridge's MOVE (Nov 11, 2026): chosen from the episode
  // ledger + the pair's facts, recorded on the ledger, and the
  // head is authored for the move. Portal and woven framings
  // keep their exact texts (their honesty discipline is the
  // point); the payoff bridge is the forward tease's formal
  // case and keeps its composition.
  let move: BridgeMove = 'anchor';
  if (opts.portalTopic) {
    // A portal hop (lane 4 framing): a story ranged for and
    // TOLD from across the county — the connection that earned
    // the hop is named, the distance is never hidden, and no
    // proximity language pretends the ground ahead holds it.
    sentences.push(
      `From ${prev.placeName}, we range off the road for a story — ${next.placeName}, clear across the county. The ${opts.portalTopic} thread ties it to ${prev.placeName}, and the connection is too good to skip.`,
    );
    episode.openings.push('portal');
    move = 'anchor';
  } else if (ctx?.offRouteSubject || ctx?.wovenSubject) {
    sentences.push(`From ${prev.placeName} we keep rolling.`);
    episode.openings.push('rolling');
    move = ctx?.wovenSubject ? 'thread-stitch' : 'anchor';
  } else if (ctx?.nextUncommitted) {
    // Promise discipline (F2c): the next story is not
    // committed, so this bridge does not name it — the
    // Kate Sessions shape (a bridge that spoke the name of
    // a story that then dropped) is impossible from here.
    // Two honest forms: a factual callback on the story
    // just told (the standing callback minus its "Ahead:"
    // tail), or the quiet handoff. The move recorded is
    // the form used, so the episode rotation stays truthful.
    if (ctx.prevGist) {
      const gist = spokenGist(ctx.prevGist);
      const gistSentence = /[.!?]$/.test(gist) ? gist : `${gist}.`;
      sentences.push(`From ${prev.placeName} we roll on. ${gistSentence} That stays with us.`);
      move = 'callback';
    } else {
      sentences.push(`From ${prev.placeName}, we roll on.`);
      move = 'quiet-handoff';
    }
    episode.openings.push('rolling');
  } else if (ctx && ctx.role !== 'payoff') {
    move =
      opts.commission &&
      !ctx.memorialPair &&
      ctx.role === 'mid' &&
      (ctx.threadTopic || ctx.threadLabel) &&
      ctx.callbackSubject
        ? 'thread-stitch'
        : chooseBridgeMove(ctx, episode);
    if (move === 'callback' && ctx.prevGist) {
      // The previous story's gist, spoken as the sentence it
      // is, then tied forward — the fact the old skeleton
      // carried in its context and never said. The spoken gist
      // is trimmed harder than the context gist (a bridge is a
      // transition, not a recap — and the runner's suppression
      // math prices bridge durations, so a bridge must stay a
      // transition's size).
      const gist = spokenGist(ctx.prevGist);
      const gistSentence = /[.!?]$/.test(gist) ? gist : `${gist}.`;
      sentences.push(
        `From ${prev.placeName} we roll on. ${gistSentence} That stays with us. Ahead: ${next.placeName}.`,
      );
    } else if (move === 'forward-tease' && ctx.nextGist) {
      sentences.push(
        `From ${prev.placeName} we keep rolling — and ahead, ${next.placeName}: ${gistClause(spokenGist(ctx.nextGist))}. It earns its moment.`,
      );
    } else if (move === 'question' && questionTextFor(ctx.nextAngle, prev.placeName, next.placeName)) {
      sentences.push(questionTextFor(ctx.nextAngle, prev.placeName, next.placeName) as string);
    } else if (move === 'distance' && ctx.segDistanceM != null) {
      sentences.push(
        ctx.segDistanceM >= 5000
          ? `From ${prev.placeName} we roll on — miles of road yet before ${next.placeName}.`
          : `From ${prev.placeName} we roll on — at least another mile of road before ${next.placeName}.`,
      );
    } else if (move === 'quiet-handoff') {
      // The quiet handoff: a bare clause, or nothing at all —
      // small-scale planned silence inside the tissue itself.
      sentences.push(`From ${prev.placeName}, we roll on.`);
    } else {
      // Anchor (and every move whose facts fell through): the
      // standard rotating head, exactly as before.
      if (move !== 'anchor' && move !== 'thread-stitch') move = 'anchor';
      const head = pickStandardHead(episode);
      sentences.push(head.make(prev.placeName, next.placeName));
      episode.openings.push(head.shape);
    }
  } else {
    if (ctx?.role === 'payoff') move = 'forward-tease';
    const head = pickStandardHead(episode);
    sentences.push(head.make(prev.placeName, next.placeName));
    episode.openings.push(head.shape);
  }
  episode.moves.push(move);
  /** The one optional sentence's index (the mid thread callback/callout) — droppable under a char cap. */
  let optionalIdx = -1;
  // Promise discipline (F2c): the optional sentences (payoff
  // landing, thread callout) all NAME the next story — an
  // uncommitted next story gets none of them.
  if (ctx && !opts.portalTopic && !ctx.nextUncommitted) {
    if (ctx.wovenSubject && ctx.role !== 'payoff') {
      // The woven range, framed honestly (Nov 4, 2026): the
      // story is NOT on this road — Miles is following the
      // drive's thread to where that same story is told,
      // clear across the county, and says so plainly.
      sentences.push(
        ctx.threadTopic
          ? `This next one isn't on our road at all — it's ${ctx.wovenSubject}, clear across the county. But the ${ctx.threadTopic} thread runs straight through it, so we're following the thread for a while.`
          : ctx.threadLabel
            ? // Thread re-anchor (Nov 5, 2026): an anchored
              // thread with no topic names its thread by its
              // place — the range is framed the same way.
              `This next one isn't on our road at all — it's ${ctx.wovenSubject}, clear across the county. But it belongs to the ${ctx.threadLabel} thread of this drive, so we're following the thread for a while.`
            : `This next one isn't on our road at all — it's ${ctx.wovenSubject}, clear across the county. But it belongs in this drive, so we're ranging off the road for it.`,
      );
    }
    if (ctx.role === 'payoff') {
      if (ctx.threadTopic) {
        sentences.push(
          ctx.promiseMade
            ? `And here it is — ${ctx.nextSubject}. I pointed at this one when we set out: this drive's ${ctx.threadTopic} thread lands here.`
            : `And here it is — ${ctx.nextSubject}, where this drive's ${ctx.threadTopic} thread comes together.`,
        );
      } else if (ctx.threadLabel) {
        // Thread re-anchor (Nov 5, 2026): an anchored thread
        // with no topic pays off by its anchor's name.
        sentences.push(
          ctx.promiseMade
            ? `And here it is — ${ctx.nextSubject}. I pointed at this one when we set out: this is where the ${ctx.threadLabel} thread of this drive lands.`
            : `And here it is — ${ctx.nextSubject}, where the ${ctx.threadLabel} thread of this drive comes together.`,
        );
      }
      // The off-route hop, framed honestly (consolidation §4):
      // the story is NOT on the road — Miles is choosing it
      // because it is the story the drive has been about.
      if (ctx.offRouteSubject) {
        sentences.push(
          `Now — this next one isn't on our road at all. ${ctx.offRouteSubject} is clear across the county from here. But it's the story this whole drive has been about, so we're making the hop.`,
        );
      }
    } else if (
      move === 'thread-stitch' &&
      (ctx.threadTopic || ctx.threadLabel) &&
      ctx.role === 'mid' &&
      ctx.callbackSubject
    ) {
      // The thread callout fires at most once per episode
      // (lane 1b): the first mid bridge that can name it gets
      // the formula; later ones connect on the callback fact
      // plainly, in different words. (Thread re-anchor,
      // Nov 5, 2026: an anchored thread with no topic calls
      // back by its anchor's name — `threadName` below is the
      // same name the topic wording has always used when a
      // topic exists, so topic threads are byte-identical.)
      const threadName = ctx.threadTopic ?? ctx.threadLabel;
      optionalIdx = sentences.length;
      if (!episode.threadCalloutUsed) {
        sentences.push(
          `There's that ${threadName} thread again — ${ctx.callbackSubject} and ${ctx.nextSubject} are two ends of the same story.`,
        );
        episode.threadCalloutUsed = true;
      } else {
        sentences.push(
          `We heard the ${threadName} thread in ${ctx.callbackSubject} — it runs through ${ctx.nextSubject} too.`,
        );
      }
    }
  }
  if (opts.maxChars !== undefined && optionalIdx >= 0 && sentences.join(' ').length > opts.maxChars) {
    sentences.splice(optionalIdx, 1);
  }
  return spokenFormText(sentences.join(' '));
}
