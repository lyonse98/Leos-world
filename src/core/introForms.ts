// Intro forms (Nov 11, 2026) — the pure half of the pre-welcome
// opener system (design note intro-bridge-design-2026-11-10.md §1).
//
// The opener is a FORM, not a clip: at greeting settle the engine
// picks a form from the rotation (no form repeats within 3 starts),
// and every form degrades rung-by-rung to the plain path that
// shipped before this build. Everything in this module is pure —
// daypart from the device clock, hook validation — so the harness
// can pin the rules without a tour.
//
// The callback form (a pre-rendered recap of the last drive,
// Nov 11) was KILLED Nov 16, 2026 on Erik's Day-12 verdict —
// "a little weird… I'd rather just start from fresh." Every
// tour starts fresh: the form, its closeout composer, and its
// asset machinery are gone, not parked.

import type { Daypart } from '../content/clips';

export type IntroForm =
  | 'plain'
  | 'day-aware'
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
 * the last 3 starts and otherwise eligible. Greeting-only is the
 * pool-empty landing, decided by the caller. (The callback form
 * held priority outside this pool until its Nov 16, 2026 kill;
 * nothing preempts the rotation now.)
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
