// Tester access gate (Nov 2, 2026) — the cheap version, on purpose.
//
// B's Bolt link is open to anyone who gets it, and a leaked link can
// spend from the shared AI Studio purse. This gate stops casual
// link-leak use: one shared code, checked in-app, unlock persisted per
// device. It is link-leak protection, NOT hardened security — the code
// ships in the bundle and anyone who reads the bundle can find it.
//
// Changing the code is a one-line edit: TESTER_ACCESS_CODE below.
//
// This module imports NOTHING (no backend, no engine, no seams): the
// gate decision must be evaluable before any spend machinery exists,
// and App renders the tour shell only after it passes. Storage is
// touched only inside the functions below, never at module scope.

/** The shared tester code. Testers type it exactly (all lowercase). */
export const TESTER_ACCESS_CODE = 'coast619';

const UNLOCK_KEY = 'miles_tester_unlocked';

/** True when this device has already unlocked with the tester code. */
export function isTesterUnlocked(): boolean {
  try {
    return localStorage.getItem(UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Check a typed code; on a match, persist the unlock on this device
 * and return true. Case-sensitive (the code is all lowercase);
 * surrounding whitespace from a paste is tolerated.
 */
export function tryTesterUnlock(code: string): boolean {
  if (code.trim() !== TESTER_ACCESS_CODE) return false;
  try {
    localStorage.setItem(UNLOCK_KEY, '1');
  } catch {
    /* storage unavailable (private mode): unlock for this session */
  }
  return true;
}
