/**
 * Session arbitration (Nov 6, 2026 — field fix, lane A).
 *
 * Erik's Nov 6 drive: a route build ran long, he started a
 * freeform tour from the landing, and when the build finally
 * landed it staged and played OVER the running freeform tour —
 * two tours alive at once. The build had no way to know it had
 * been superseded, the freeform start had no way to retire the
 * pending build, and a second build could silently orphan the
 * first. There was no single answer to "whose session is this
 * device in right now?"
 *
 * This module is that answer: ONE authority, a monotonically
 * increasing token, and the rule that the NEWEST user intent
 * wins. Starting anything — a route build, a route tour at
 * handover, a freeform tour (including the route closeout's
 * freeform tail) — takes a claim. The previous claim is stale
 * from that instant, whatever it was. Holders of a stale claim
 * must stand down at their next checkpoint: a stale build
 * discards its plan and runner without touching the screen, a
 * stale extras chain spends nothing further.
 *
 * The authority is deliberately tiny and synchronous — claims
 * are taken inside tap handlers and checked after awaits, so
 * it must never itself be async. The App owns the single
 * instance; the harness exercises this class directly.
 */

export type SessionKind = 'route-build' | 'route-tour' | 'freeform-tour';

export interface SessionClaim {
  /** Monotonic: a later claim always carries a higher token. */
  token: number;
  kind: SessionKind;
  /** The session's own id (a route build's session id, a tour's claim id). */
  id: string;
}

export class SessionAuthority {
  private seq = 0;
  private latest: SessionClaim | null = null;

  /**
   * Take the session for a new intent. Every earlier claim is
   * superseded from this instant — including one of the same
   * kind (a second route build supersedes the first at START,
   * not at completion, so two builds are never rivals).
   */
  claim(kind: SessionKind, id: string): SessionClaim {
    const next: SessionClaim = { token: ++this.seq, kind, id };
    this.latest = next;
    return next;
  }

  /** True only while `claim` is the newest intent on the device. */
  isCurrent(claim: SessionClaim): boolean {
    return this.latest !== null && this.latest.token === claim.token;
  }

  /** The newest claim, or null when no session is live. */
  current(): SessionClaim | null {
    return this.latest;
  }

  /**
   * Give the session up (a tour ended, a build was abandoned):
   * clears the authority only if `claim` is still the latest —
   * a stale holder releasing must never evict its successor.
   */
  release(claim: SessionClaim): void {
    if (this.latest !== null && this.latest.token === claim.token) {
      this.latest = null;
    }
  }
}
