// Intro forms (Nov 11, 2026) — the pure half of the pre-welcome
// opener system (design note intro-bridge-design-2026-11-10.md §1).
//
// The opener is a FORM, not a clip: at greeting settle the engine
// picks a form from the rotation (no form repeats within 3 starts),
// and every form degrades rung-by-rung to the plain path that
// shipped before this build. Everything in this module is pure —
// daypart from the device clock, callback lines composed ONLY from
// recorded facts (a callback that invents a shared past is a
// false-verbatim-class defect), hook validation — so the harness
// can pin the rules without a tour.

import type { Daypart } from '../content/clips';

export type IntroForm =
  | 'plain'
  | 'day-aware'
  | 'callback'
  | 'hook-question'
  | 'wandering'
  | 'regulars-short'
  | 'greeting-only'
  | 'resume';

export type GreetingAxis = 'standard' | 'daypart' | 'reentry';

/** Daypart from the device clock alone — no network, no ephemeris. */
export function daypartOf(date: Date): Daypart {
  const h = date.getHours();
  if (h >= 5 && h < 10) return 'early';
  if (h >= 10 && h < 15) return 'midday';
  if (h >= 15 && h < 19) return 'golden';
  return 'night';
}

// ------------------------------------------------------------ form rotation

export interface IntroFormInputs {
  /** Forms served on recent starts, oldest first (the rotation ledger). */
  recentForms: string[];
  /** The greeting that just played was a daypart line (the day-aware pairing). */
  daypartGreeting: boolean;
  /** The hook generation already failed this start — the form is not offered. */
  hookFailed: boolean;
  /** A start happened <48 h ago (the regular's-short / greeting-only gate). */
  regular: boolean;
}

/**
 * The rotation pool for this start: every form not served within
 * the last 3 starts and otherwise eligible. Callback is NOT in the
 * pool — it holds priority outside the rotation (a fresh unspent
 * callback asset preempts), and greeting-only is the pool-empty
 * landing, also decided by the caller.
 */
export function eligibleIntroForms(i: IntroFormInputs): IntroForm[] {
  const recent = new Set(i.recentForms.slice(-3));
  const pool: IntroForm[] = [];
  if (i.daypartGreeting && !recent.has('day-aware')) pool.push('day-aware');
  if (!recent.has('plain')) pool.push('plain');
  if (!recent.has('wandering')) pool.push('wandering');
  if (!i.hookFailed && !recent.has('hook-question')) pool.push('hook-question');
  if (i.regular && !recent.has('regulars-short')) pool.push('regulars-short');
  return pool;
}

/**
 * Pool exhausted and the start is NOT a regular's (so greeting-only
 * is not earned): the least-recently-served base form repeats —
 * the rotation degrades, it never silences the opening.
 */
export function fallbackIntroForm(i: IntroFormInputs): IntroForm {
  const candidates: IntroForm[] = ['plain', 'wandering'];
  if (!i.hookFailed) candidates.push('hook-question');
  if (i.daypartGreeting) candidates.push('day-aware');
  if (i.regular) candidates.push('regulars-short');
  let best: IntroForm = 'plain';
  let bestIdx = Infinity;
  for (const c of candidates) {
    const idx = i.recentForms.lastIndexOf(c);
    const eff = idx === -1 ? -Infinity : idx;
    if (eff < bestIdx) {
      bestIdx = eff;
      best = c;
    }
  }
  return best;
}

export function pickIntroForm(pool: IntroForm[], rand: number): IntroForm {
  return pool[Math.min(pool.length - 1, Math.floor(rand * pool.length))];
}

// ------------------------------------------------------------ callback

/**
 * The freeform closeout record: the ONLY facts a callback line may
 * speak. Written at endTour; consumed (spent once) by the next
 * fresh start's callback form. The next-start clip is pre-rendered
 * from `text` at closeout, so the start itself spends zero latency.
 */
export interface CloseoutRecord {
  areaName: string | null;
  lastStoryLabel: string | null;
  owedName: string | null;
  endedAt: number;
}

export interface CallbackAsset {
  text: string;
  record: CloseoutRecord;
  createdAt: number;
}

/**
 * Compose the callback line from recorded facts only. An owed
 * welcome outranks a plain memory (it is a promise outstanding);
 * a record with neither an area nor a story yields no line at all
 * — the form degrades to the rotation rather than inventing one.
 */
export function composeCallbackText(rec: CloseoutRecord): string | null {
  const area = (rec.areaName ?? '').trim();
  const story = (rec.lastStoryLabel ?? '').trim();
  const owed = (rec.owedName ?? '').trim();
  let text: string | null = null;
  if (owed) {
    text = `Welcome back. Last time we rolled, ${owed} never got its proper welcome — it's still on my list, and I haven't forgotten.`;
  } else if (area && story) {
    text = `Welcome back. Last time out we were around ${area}, and ${story} was the story that stuck. Let's see what today's streets have got.`;
  } else if (area) {
    text = `Welcome back. Last time we rolled through ${area}. Different day, same streets — let's see what's out there.`;
  } else if (story) {
    text = `Welcome back. Last time, ${story} was the story. Let's go find today's.`;
  }
  if (!text || text.length > 240) return null;
  return text;
}

/** A callback asset is spendable for 14 days; older is a stale memory. */
export function callbackAssetFresh(asset: CallbackAsset | null, nowMs: number): boolean {
  if (!asset || typeof asset.text !== 'string' || asset.text.trim().length === 0) return false;
  if (!Number.isFinite(asset.createdAt)) return false;
  return nowMs - asset.createdAt < 14 * 24 * 3600_000;
}

// ------------------------------------------------------------ hook-question

/**
 * The hook commission: ONE question, posed over the same fact pack
 * the first welcome is built from, so the welcome that follows can
 * honestly answer it. Generated in parallel with the welcome and
 * raced against the opener slot — late hooks are discarded, never
 * late-served.
 */
export function buildHookPrompt(areaName: string, factPackText: string): string {
  return [
    `HOOK QUESTION — one line only. You are Miles, opening a tour. Below is the fact pack for ${areaName}; the welcome that follows this line will be built from these same facts. Pose ONE question — a single sentence, spoken aloud, ending in a question mark — that the welcome can honestly answer from this pack. Make it specific to ${areaName}: a street, a date, a person, an oddity from the pack. Never generic ("want to hear a story?"), never rhetorical, and do not answer it. Output the question and nothing else.`,
    `FACT PACK:\n${factPackText}`,
  ].join('\n\n');
}

/**
 * Validate a generated hook: exactly one question, one sentence,
 * spoken length. Anything else is not a hook — the commission
 * fails and the form degrades a rung.
 */
export function validateHookText(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\s+/g, ' ').trim().replace(/^["“]|["”]$/g, '');
  if (!text.endsWith('?')) return null;
  if ((text.match(/\?/g) ?? []).length !== 1) return null;
  if (/[.!]\s/.test(text.slice(0, -1))) return null; // a second sentence snuck in
  if (text.length < 25 || text.length > 220) return null;
  return text;
}
