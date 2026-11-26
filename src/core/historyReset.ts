// Clear listening history (Nov 25, 2026 — Erik's testing
// reset). Erik, testing on his own phone, had burned through
// his home corridors' stories: every telling he heard while
// testing was filed as heard and stayed suppressed, so he
// could no longer hear the app the way a first-time user
// does. This is the reset he asked for: one control that
// makes the device a first-time listener again, on demand.
//
// WHAT "HEARD" IS MADE OF — every store that gates story
// eligibility, and what this reset does to it:
//   1. The cross-day heard ledger (heard_stories, server-side,
//      scoped by the on-device device key): ROTATE the key
//      (backend.rotateDeviceKey). Every fetch the app makes
//      keys on the device key, so the old key's rows become
//      invisible everywhere at once — freeform's heardTopics /
//      heardStoryTexts hydration, route builds' heard keys,
//      the tray's heard read. Nothing is deleted server-side
//      (the anon client cannot delete, and a testing reset
//      must work offline-of-the-ledger by construction).
//   2. The shell's local told bookkeeping (backend LS):
//      dayState (today's told list), toldTopics, recentSubjects
//      (persistDayState's family), coverage (the legacy story
//      coverage store) — DELETED.
//   3. Corridor consumption state: corridor tells live in the
//      ledger as (place, angle) rows keyed by verbatim story
//      text — the rotation in (1) is what un-consumes them;
//      there is no separate local corridor store (the Tour's
//      corridorConsumed set is tour-scoped and dies with the
//      tour; a live tour's in-memory cross-day sets are reset
//      through Tour.forgetCrossDayHeard, wired by the shell).
//   4. Welcome heard state: also ledger-keyed (an area counts
//      as heard when its intro's topic stands in the ledger) —
//      the rotation covers it; the local opener/greeting
//      rotation histories that gate which intro forms and
//      lines may serve (introFormHistory, openersPlayed,
//      daypartGreetingsPlayed, lastIntroIndex, lastTourStartAt)
//      are DELETED with it, so a fresh listener's first drive
//      is a first drive in form as well as content.
//   5. Place-memory's source: the route drive records
//      (routeDrives) — DELETED, so no callback can keep
//      referencing places passed on earlier drives. The
//      suggestion tray's place-memory records are dropped
//      with them (they are claims about that same history);
//      place-flavor tray records — saved stop suggestions,
//      not listening history — are kept.
//   6. Stall-phrase rotation counts (stallPhrasesPlayed) and
//      the legacy callbackNext key — DELETED (played-line
//      bookkeeping in the same family).
//
// WHAT IS KEPT, DELIBERATELY: the profile document (declared
// tastes/constraints AND the inferred topics — they rank
// Miles' own content but never suppress a story, and Erik
// asked for a history reset, not a factory reset), the
// tester unlock (accessGate), the live-spend ledger (a spend
// cap is not history), the event-feed / hours caches, the
// library index cache, the pinned-audio cache, and the
// active-session bookkeeping (a live tour must not be
// corrupted by a clear — see Tour.forgetCrossDayHeard).
//
// Pure local work: no network, no server writes, nothing to
// fail halfway — the rotation and the deletes are each
// single localStorage operations behind the standing
// storage seams, which swallow storage errors by design.

import { lsDel, lsGet, rotateDeviceKey } from './backend';
import { loadProposalRecords, localProposalStore } from './proposals';

// The LS keys cleared, as (backend LS name, raw localStorage
// key) pairs — the raw names are exported for the harness,
// which asserts against localStorage directly.
export const HISTORY_RESET_STORES: readonly { ls: Parameters<typeof lsDel>[0]; raw: string }[] = [
  { ls: 'dayState', raw: 'leo_day_state' },
  { ls: 'coverage', raw: 'leo_story_coverage' },
  { ls: 'toldTopics', raw: 'leo_told_topics' },
  { ls: 'recentSubjects', raw: 'leo_major_subjects' },
  { ls: 'routeDrives', raw: 'leo_route_drives' },
  { ls: 'introFormHistory', raw: 'leo_intro_form_history' },
  { ls: 'lastTourStartAt', raw: 'leo_last_tour_start_at' },
  { ls: 'openersPlayed', raw: 'leo_openers_played' },
  { ls: 'daypartGreetingsPlayed', raw: 'leo_daypart_greetings_played' },
  { ls: 'stallPhrasesPlayed', raw: 'leo_stall_phrases_played' },
  { ls: 'lastIntroIndex', raw: 'leo_last_intro_index' },
  { ls: 'callbackNext', raw: 'leo_callback_next' },
];

export interface ClearListeningHistoryResult {
  /** The device key the ledger was filed under, before the rotation (null if none was minted yet). */
  previousDeviceKey: string | null;
  /** The fresh device key now in force. */
  newDeviceKey: string;
  /** Raw localStorage keys deleted, in HISTORY_RESET_STORES order. */
  clearedStoreKeys: string[];
  /** Place-memory tray records dropped (place records are kept). */
  trayCallbacksDropped: number;
}

/**
 * Clear the listening history: rotate the device key and
 * delete every local heard-history store (see the header).
 * The caller (the shell) must also notify any live tour —
 * Tour.forgetCrossDayHeard — so a running tour observes the
 * cleared state without a restart.
 */
export function clearListeningHistory(): ClearListeningHistoryResult {
  const previousDeviceKey = lsGet('userKey');
  const newDeviceKey = rotateDeviceKey();
  const clearedStoreKeys: string[] = [];
  for (const store of HISTORY_RESET_STORES) {
    lsDel(store.ls);
    clearedStoreKeys.push(store.raw);
  }
  // The tray: place-memory records are claims about the
  // history just cleared ("you passed this, still unheard")
  // and die with it; place records are saved suggestions and
  // stay.
  const records = loadProposalRecords(localProposalStore);
  const kept = records.filter(r => r.flavor !== 'place-memory');
  const trayCallbacksDropped = records.length - kept.length;
  if (trayCallbacksDropped > 0) {
    if (kept.length > 0) {
      try {
        localProposalStore.write(JSON.stringify(kept));
      } catch {
        /* the tray is a nicety, never a failure */
      }
    } else {
      localProposalStore.clear();
    }
  }
  return { previousDeviceKey, newDeviceKey, clearedStoreKeys, trayCallbacksDropped };
}
