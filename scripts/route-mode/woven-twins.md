# Woven twins — conventions and the ingest flow

The woven tranche (Tier 100, Nov 4, 2026) gives presence-bound
shelf stories a host-told WOVEN-register twin: the same facts,
retold with no presence anchoring, so route mode can seat the
story OFF its ground as a through-line member. This note is
the standing reference for how twins are keyed, classified,
reserved, and — critically — how future twin ingests land
seatable with no hand-wiring.

## Conventions

- **Key**: twin angle = source angle + `-woven-v1`
  (e.g. `landmark_event-woven-v1`, `corridor-woven-v1`).
  Storage key = `library/<place_key>/<twin_angle>.wav`.
  Twins are NEW story_library rows (anon INSERT,
  ignore-duplicates); originals are never modified.
- **Tags**: twin rows are appended to `story-tags.csv` with
  topics INHERITED from the source row and tone judged from
  the twin text (`tagged_from=woven-tranche-<yyyy-mm>`).
- **Presence**: twins have no audit rows — the presence
  audit predates them. `build-route-presence.mjs` DERIVES
  each twin's entry from `story-tags.csv`: a twin is
  weave-safe by construction (host-told, no presence
  anchoring) and never Protected, so it gains
  `{ presence: 'safe', protected: false }`.
  `presence-classes.csv` is never edited for twins — it
  stays the audit's artifact. Guards in the generator:
  an audit row for the twin's own key wins; a twin whose
  SOURCE is Protected aborts the build; a twin whose source
  was never classified is skipped (stays ineligible).
- **Eligibility**: under the composer's standing rule
  (eligible = mixed/safe AND not Protected), every twin is
  woven-eligible via `wovenEligibleFor`. Landmark-class
  twins can seat as members and lend thread support;
  corridor twins tile as geo units like their sources.
- **Freeform reservation**: twins are route-seating only.
  Freeform's generic library finds refuse `-woven-v1` rows
  (`isWovenTwinAngle` in `src/core/tour.ts`), so freeform
  keeps serving the presence originals. The refusal sits at
  the freeform selection layer, NOT the shared fetch —
  route staging reads the same `fetchLibraryIndex` and must
  keep seeing the twins.

## The December completion render (70 staged twins)

The November window rendered + ingested ranks 1–30; ranks
31–100 are gate-passed texts staged in
`~/workspace/leos-world/woven-tranche/`. To land them:

1. **Render** (resumes automatically; inserted twins are
   skipped):
   `cd ~/workspace/leos-world/woven-tranche && node render-woven.mjs --budget-usd <n>`
2. **Ingest** the new twins exactly as the November tranche
   did: anon INSERT the rows into story_library and append
   their tag rows to `story-tags.csv` (topics inherited,
   tone judged from the twin text).
3. **Regenerate BOTH bundled maps** — the Commit E rule:
   regen is the mandatory final step of every library
   ingest, and the twins ride it. From the repo root:
   - `node scripts/route-mode/build-route-tags.mjs`
   - `node scripts/route-mode/build-route-presence.mjs`

   The presence regen derives the new twins' safe entries
   from `story-tags.csv` on its own — no CSV edits, no
   hand-wiring. If it ABORTS on a Protected source, stop:
   that twin must be adjudicated by hand or dropped from
   the render list.
4. **Verify**: `node scripts/route-mode/run.mjs`. The
   woven-twins data suites read the shipped maps, so first
   update their census pins to the new totals (shelf rows,
   twin count, per-topic twin counts in the `woven data` and
   `woven twins (data)` suites) — the pins are deliberately
   exact so a partial wiring cannot slip through. Then
   `node scripts/fresh-verify/run.mjs` and
   `npm run typecheck && npm run build`.
5. **Commit** the regenerated `src/data/routeTags.ts` +
   `src/data/routePresence.ts` with the suite pins, and push.

No other step exists. If a future twin is not seatable after
this flow, the wiring — not the twin — is what to inspect.
