# THE STYLE GATE — standing pre-TTS rule (adopted Oct 28, 2026)

Erik adopted the style memo's decision list (Oct 28, 2026): the
documentary rubric (`~/workspace/leos-world/style-notes-2026-10-28.md`
§4, criteria A1–A15) is the standing quality gate for Leo's World
generation, and the two anti-patterns (speculation pivot, lecture
cadence) are swept mechanically before render money is spent.

## The rule

**No batch renders — no TTS dispatch, in any builder, for any
campaign — until both halves of the gate have run on the batch's
final texts:**

1. **Mechanical layer — `style-gate.mjs`.** Run it against the
   batch's corpus manifest:

   ```
   node scripts/library/style-gate.mjs <manifest.json> [--filler] [--out <report>]
   ```

   It must come back **clean, or every FLAG adjudicated** (cleared
   with a reason, or the text fixed and the gate re-run). Honesty-class
   hits (A11 exclusion sweep) are REGENERATE-class: the text does not
   render, full stop, until it is rewritten and re-gated. Carve-out
   (Oct 29, 2026): under Erik's MEMORIAL-SPIRIT ruling, a bare PSA
   Flight 182 reference is an A11 *advisory*, adjudicated in the
   judgment layer for memorial register (human-first, no toll, no
   spectacle); spectacle markers (deadliest / mid-air collision /
   death toll) remain honesty-class hard hits.

2. **Judgment layer — a judgment audit** over (a) every flagged text
   and (b) a sample of the clean ones (≥15%), applying the
   JUDGMENT-REQUIRED criteria the script prints (open loop, the TURN,
   single thread, scene sourcing, button, protagonist, dark-material
   grammar, lecture cadence…). The audit's verdicts use the rubric
   bands: PASS / POLISH / REGENERATE-candidate, with honesty-class
   defects an automatic REGENERATE.

**The gate report — script output plus the judgment audit — is
attached to the batch's campaign report.** A batch report without a
gate section is incomplete; TTS dispatched without one is out of
process, however good the texts look.

## Worked example

Tonight's Pass 1 audit (Oct 28, 2026 —
`~/workspace/leos-world/style-audit-pass1-2026-10-28.md`) is the
worked example of step (ii): mechanical sweeps over all 203 pending
texts, ~45 full judgment reads (every flag class hand-verified
against its worst cases plus a stratified sample), verdicts in the
rubric bands, and an exceptions list written for Erik's
approve-with-exceptions reply. It also demonstrates the discipline
this gate inherits: **three mechanical proxies (A13 fact-runs, naive
A1 date-openers, A14 name-position) failed verification against their
own worst cases and were retired, not reported.** Any future detector
added to `style-gate.mjs` must survive the same test — hand-verify its
worst flags before its output is ever quoted — or it stays out.

## Scope notes

- **A9 (first person) — adopted Oct 28, 2026, Erik's ruling; refined
  Oct 29, 2026.** Leo speaks as "I" where it makes sense: most stories
  carry a genuine first-person beat (the documentary-pack's sixth beat
  in the persona), but it is a per-story judgment call, not a quota —
  a story that lands better in pure observation may stay observational.
  The gate flags zero-first-person texts mechanically as an
  **advisory** so the judgment sample can confirm the absence is
  deliberate; whether a present beat is *genuine* — a person surfacing,
  not a token "I" stuffed in — is judgment.
- The gate applies to **new generation from Batch 2B onward**. It is
  not retrofitted onto the standing shelf (the Pass 2 health map
  measured the shelf for prioritization; retrofitting the Oct 28
  techniques across it was explicitly ruled not-worth-it — they enter
  through future briefs at zero marginal cost).
- Fillers are gated on the filler thresholds (`--filler`): the open
  loop is optional at ~85 words; bare-date cap is 1.
- The gate judges texts. It does not replace Erik's approval — under
  the text-first production rule, his approval of the texts is what
  dispatches TTS, and the gate report is an input to that approval.
