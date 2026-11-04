# Presence audit pipeline (Nov 4, 2026)

How every story on the shelf got its presence register —
`bound` / `mixed` / `safe` — which is what woven eligibility
(`src/data/routePresence.ts`, via
`scripts/route-mode/build-route-presence.mjs`) is built
from. The audit's report is
`~/workspace/leos-world/presence-audit-2026-11-04.md`.

## Provenance

These scripts are the audit session's own classification
pipeline, recovered verbatim from that session's working
files when the woven production build (Nov 4, 2026) needed
the per-story classes the audit had only reported in
aggregate. The only edits on the way in: the scratch
workdir literal became the `PRESENCE_AUDIT_DIR` environment
variable (default `/tmp/presence-audit`), and `emit_csv.py`
is new — the audit never wrote a per-story file, so the
production build added the emitter (its Protected-register
rules are copied verbatim from `analysis.py`).

**The shipped labels are the audit's own.** The audit
session's `final.json` was recovered from that session's
working artifacts (the woven-tranche agent's
`audit-recovery/` directory) and is what
`presence-classes.csv` was emitted from. It validates
against the published report closely but not exactly —
split bound 195 / mixed 567 / safe 502 vs the report's
202 / 563 / 499; topic-less rows 73 / 195 / 161 vs
72 / 200 / 157; the Protected set resolves to exactly 32 —
so a handful of borderline rows differ from whatever the
report's run held, and the report's numbers remain the
reference census.

As a cross-check, the production build also re-ran this
whole pipeline end to end on Nov 4 (fresh census pull,
both Gemini passes, hand labels applied positionally): it
landed at bound 185 / mixed 582 / safe 497, and its binary
woven-eligibility calls (bound vs mixed/safe, Protected
excluded) agree with the shipped labels on 90.2% of rows.
One caveat from that re-run: the hand-label samples are
drawn seeded from the flash pass's own output, so on a
re-run the audit's positional hand labels land on shifted
rows (hand-vs-refined agreement fell to 41% from the
original 68%) — a re-run should re-draw and re-label the
samples by hand rather than reuse the embedded lists.

## The pipeline, in order

1. `getkeys.mjs` — writes the Gemini key list the Python
   steps shell out with (from the repo-avatar library
   tooling's `loadKeys()`; keys are referrer-locked to the
   app origin, which every call sends).
2. `fetch.py` — pulls the full story census from Supabase
   REST (anon key, public-read policy) into `census.json`.
3. `classify.py` — scripted signal scan (hard/soft presence
   phrases) + a Gemini Flash pass (`gemini-3.6-flash`,
   temp 0.1, batches of 10) over every story → `flash.json`,
   `signals.json`. Resumable; exits on quota (HTTP 429) so a
   later run continues where it stopped.
4. `prep_review.py` — draws the seeded hand-review sample
   (12 flash/signal-agreeing rows per class + the
   scripted-vs-Flash disputed set) → `sample-keys.json`.
5. `flagsets.py` — the A/B/C/D disagreement sets and the
   seeded B-sample → `flagsets.json`, `bsample-keys.json`.
6. Hand labels for the samples live embedded in
   `assemble.py` (positional, in sample order — the audit's
   own review notes).
7. `rerun.py` — a second Flash pass over the disputed
   population → `flash2.json`.
8. `assemble.py` — merges scripted signals, both Flash
   passes, and the hand labels into `final.json` (hand
   labels override; remaining disputes go to a documented
   precedence).
9. `apply_hand.py` — applies every hand label (including
   the hand-labeled B-sample overrides) onto `final.json`.
10. `analysis.py` — the report's aggregates: the Protected
    register (32 rows, rules inline), the per-topic
    cross-tab, and the woven-tranche candidacy tiers.
11. `emit_csv.py` — NEW: writes `presence-classes.csv`
    (`place_key, angle, presence_class, protected`) from
    `final.json` + `census.json`, asserting the Protected
    set resolves to exactly 32 rows.

Then, from the repo root:

```
node scripts/route-mode/build-route-presence.mjs
```

regenerates `src/data/routePresence.ts` deterministically
from the CSV (the harness pins the committed file against a
fresh regeneration).
