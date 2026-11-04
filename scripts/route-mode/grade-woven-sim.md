# Woven-pool simulation — route mode (composer v3.1, commit F)

Composer: da14720 · synthetic shelf, current depth (1258 units), seeded; the standard 40-drive commute battery with the heard-aware window and story-level heard (v3.1 A+B) underneath. Woven units are thread/climax material only — they never geo-tile and never open chapters. Guarantee pass is shelf-only (silence is an upper bound vs production).

HEADLINE — distinct, thread-bearing commute episodes before thread starvation (thread-found failing on 5 consecutive drives), vs the 0% run's 8:

| woven share | eligible units | thread episodes before starvation | additional vs 0% | starvation drive | thread drives /40 | climax drives /40 | woven climaxes | substantive episodes (silence ≤ 50%) | of those, thread-bearing | mean consecutive overlap | mean silence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0% | 0 | 8 | — | 9 | 8 | 9 | 0 | 9 | 8 | 0.744 | 83% |
| 25% | 200 | 40 | +32 | none in 40 | 40 | 40 | 31 | 9 | 9 | 0 | 75% |
| 50% | 399 | 40 | +32 | none in 40 | 40 | 40 | 31 | 9 | 9 | 0 | 75% |
| 75% | 581 | 40 | +32 | none in 40 | 40 | 40 | 31 | 9 | 9 | 0 | 75% |
| audit | 473 | 40 | +32 | none in 40 | 40 | 40 | 31 | 9 | 9 | 0 | 74% |

WHAT THE HEADLINE DOES AND DOES NOT SAY — read before deciding: at every woven share the corridor itself exhausts on the same drive as the 0% run (the geo supply is untouched by register). Past that drive, a "thread-bearing" drive is ONE woven climax story under a county-detected through-line, in a drive that is otherwise ~89% silence (see the per-drive tables). Woven therefore buys ZERO additional substantive episodes (silence ≤ 50%: identical at every share) — what it buys is that the commute never goes fully dark: the episode SHAPE (a named through-line + a closing story) survives indefinitely, and 25% already saturates that effect (25/50/75/audit are indistinguishable) because the pool is spent only through the single climax slot, one story per drive. The distinctness column is dominated by exhaustion arithmetic (empty-vs-empty pairs score 1; singleton-insert pairs score 0) and should not be read as an episode-diversity measure past the corridor's life. The open design question the sim poses: woven value scales only if woven members may also be SEATED as thread members inside the episode (multiple inserts), not only as its climax — that variant is not simulated here.

Model notes: episode distinctness is the mean Jaccard overlap of consecutive episodes' story sets (lower = more different). Silence barely moves by design — woven units do not tile; the only coverage they add is the climax insert's own duration. The selection-nudge effect of a woven-supported thread on corridor picks is not modeled, so distinctness gains here are a floor.

## Woven share 0% (0 eligible units)

| drive | stories | silence | thread | climax |
|---|---|---|---|---|
| 1 | 20 | 18% | Deep Time | yes |
| 2 | 21 | 25% | Coast | yes |
| 3 | 21 | 22% | Navy Century | yes |
| 4 | 19 | 21% | Rail | yes |
| 5 | 18 | 21% | The Cure | yes |
| 6 | 17 | 19% | Food & Drink | yes |
| 7 | 20 | 27% | folklore | yes |
| 8 | 20 | 39% | Coast | yes |
| 9 | 16 | 26% | — | yes |
| 10 | 1 | 95% | — | — |
| 11 | 0 | 100% | — | — |
| 12 | 0 | 100% | — | — |
| 13 | 0 | 100% | — | — |
| 14 | 0 | 100% | — | — |
| 15 | 0 | 100% | — | — |
| 16 | 0 | 100% | — | — |
| 17 | 0 | 100% | — | — |
| 18 | 0 | 100% | — | — |
| 19 | 0 | 100% | — | — |
| 20 | 0 | 100% | — | — |
| 21 | 0 | 100% | — | — |
| 22 | 0 | 100% | — | — |
| 23 | 0 | 100% | — | — |
| 24 | 0 | 100% | — | — |
| 25 | 0 | 100% | — | — |
| 26 | 0 | 100% | — | — |
| 27 | 0 | 100% | — | — |
| 28 | 0 | 100% | — | — |
| 29 | 0 | 100% | — | — |
| 30 | 0 | 100% | — | — |
| 31 | 0 | 100% | — | — |
| 32 | 0 | 100% | — | — |
| 33 | 0 | 100% | — | — |
| 34 | 0 | 100% | — | — |
| 35 | 0 | 100% | — | — |
| 36 | 0 | 100% | — | — |
| 37 | 0 | 100% | — | — |
| 38 | 0 | 100% | — | — |
| 39 | 0 | 100% | — | — |
| 40 | 0 | 100% | — | — |

## Woven share 25% (200 eligible units)

| drive | stories | silence | thread | climax |
|---|---|---|---|---|
| 1 | 20 | 18% | Navy Century | yes |
| 2 | 21 | 25% | Highway | yes |
| 3 | 21 | 22% | Navy Century | yes |
| 4 | 19 | 21% | Highway | yes |
| 5 | 18 | 21% | Highway | yes |
| 6 | 17 | 19% | Highway | yes |
| 7 | 20 | 27% | Coast | yes |
| 8 | 20 | 39% | Coast | yes |
| 9 | 16 | 26% | Highway | yes |
| 10 | 2 | 84% | Highway | woven |
| 11 | 1 | 89% | Coast | woven |
| 12 | 1 | 89% | Highway | woven |
| 13 | 1 | 89% | Coast | woven |
| 14 | 1 | 89% | Highway | woven |
| 15 | 1 | 90% | Coast | woven |
| 16 | 1 | 89% | Highway | woven |
| 17 | 1 | 91% | Coast | woven |
| 18 | 1 | 88% | Desert | woven |
| 19 | 1 | 90% | Highway | woven |
| 20 | 1 | 88% | Navy Century | woven |
| 21 | 1 | 93% | Coast | woven |
| 22 | 1 | 90% | Desert | woven |
| 23 | 1 | 90% | Highway | woven |
| 24 | 1 | 88% | Navy Century | woven |
| 25 | 1 | 94% | Coast | woven |
| 26 | 1 | 90% | Desert | woven |
| 27 | 1 | 91% | Highway | woven |
| 28 | 1 | 90% | Navy Century | woven |
| 29 | 1 | 88% | Border / CaliBaja | woven |
| 30 | 1 | 94% | Coast | woven |
| 31 | 1 | 90% | Desert | woven |
| 32 | 1 | 91% | Highway | woven |
| 33 | 1 | 91% | Navy Century | woven |
| 34 | 1 | 89% | Border / CaliBaja | woven |
| 35 | 1 | 94% | Coast | woven |
| 36 | 1 | 88% | Deep Time | woven |
| 37 | 1 | 91% | Desert | woven |
| 38 | 1 | 89% | Expositions & the Canal | woven |
| 39 | 1 | 88% | Flight | woven |
| 40 | 1 | 88% | Food & Drink | woven |

## Woven share 50% (399 eligible units)

| drive | stories | silence | thread | climax |
|---|---|---|---|---|
| 1 | 20 | 18% | Navy Century | yes |
| 2 | 21 | 25% | Navy Century | yes |
| 3 | 21 | 22% | Navy Century | yes |
| 4 | 19 | 21% | Navy Century | yes |
| 5 | 18 | 21% | Coast | yes |
| 6 | 17 | 19% | Coast | yes |
| 7 | 20 | 27% | Coast | yes |
| 8 | 20 | 39% | Coast | yes |
| 9 | 16 | 26% | Coast | yes |
| 10 | 2 | 84% | Coast | woven |
| 11 | 1 | 89% | Coast | woven |
| 12 | 1 | 89% | Coast | woven |
| 13 | 1 | 89% | Coast | woven |
| 14 | 1 | 89% | Coast | woven |
| 15 | 1 | 90% | Coast | woven |
| 16 | 1 | 88% | Navy Century | woven |
| 17 | 1 | 90% | Coast | woven |
| 18 | 1 | 88% | Navy Century | woven |
| 19 | 1 | 91% | Coast | woven |
| 20 | 1 | 89% | Highway | woven |
| 21 | 1 | 88% | Navy Century | woven |
| 22 | 1 | 93% | Coast | woven |
| 23 | 1 | 89% | Highway | woven |
| 24 | 1 | 90% | Navy Century | woven |
| 25 | 1 | 93% | Coast | woven |
| 26 | 1 | 88% | Food & Drink | woven |
| 27 | 1 | 89% | Highway | woven |
| 28 | 1 | 90% | Navy Century | woven |
| 29 | 1 | 94% | Coast | woven |
| 30 | 1 | 88% | Desert | woven |
| 31 | 1 | 91% | Food & Drink | woven |
| 32 | 1 | 89% | Highway | woven |
| 33 | 1 | 91% | Navy Century | woven |
| 34 | 1 | 94% | Coast | woven |
| 35 | 1 | 89% | Desert | woven |
| 36 | 1 | 92% | Food & Drink | woven |
| 37 | 1 | 89% | Highway | woven |
| 38 | 1 | 91% | Navy Century | woven |
| 39 | 1 | 88% | Border / CaliBaja | woven |
| 40 | 1 | 94% | Coast | woven |

## Woven share 75% (581 eligible units)

| drive | stories | silence | thread | climax |
|---|---|---|---|---|
| 1 | 20 | 18% | Navy Century | yes |
| 2 | 21 | 25% | Navy Century | yes |
| 3 | 21 | 22% | Navy Century | yes |
| 4 | 19 | 21% | Coast | yes |
| 5 | 18 | 21% | Coast | yes |
| 6 | 17 | 19% | Coast | yes |
| 7 | 20 | 27% | Coast | yes |
| 8 | 20 | 39% | Coast | yes |
| 9 | 16 | 26% | Coast | yes |
| 10 | 2 | 83% | Coast | woven |
| 11 | 1 | 88% | Coast | woven |
| 12 | 1 | 88% | Coast | woven |
| 13 | 1 | 89% | Coast | woven |
| 14 | 1 | 89% | Coast | woven |
| 15 | 1 | 89% | Coast | woven |
| 16 | 1 | 89% | Coast | woven |
| 17 | 1 | 89% | Coast | woven |
| 18 | 1 | 88% | Navy Century | woven |
| 19 | 1 | 90% | Coast | woven |
| 20 | 1 | 88% | Navy Century | woven |
| 21 | 1 | 90% | Coast | woven |
| 22 | 1 | 88% | Navy Century | woven |
| 23 | 1 | 91% | Coast | woven |
| 24 | 1 | 88% | Food & Drink | woven |
| 25 | 1 | 88% | Navy Century | woven |
| 26 | 1 | 91% | Coast | woven |
| 27 | 1 | 88% | Food & Drink | woven |
| 28 | 1 | 88% | Navy Century | woven |
| 29 | 1 | 91% | Coast | woven |
| 30 | 1 | 88% | Food & Drink | woven |
| 31 | 1 | 90% | Navy Century | woven |
| 32 | 1 | 93% | Coast | woven |
| 33 | 1 | 89% | Food & Drink | woven |
| 34 | 1 | 88% | Highway | woven |
| 35 | 1 | 90% | Navy Century | woven |
| 36 | 1 | 93% | Coast | woven |
| 37 | 1 | 89% | Food & Drink | woven |
| 38 | 1 | 88% | Highway | woven |
| 39 | 1 | 90% | Navy Century | woven |
| 40 | 1 | 93% | Coast | woven |

## Woven share audit (473 eligible units)

| drive | stories | silence | thread | climax |
|---|---|---|---|---|
| 1 | 20 | 18% | Coast | yes |
| 2 | 21 | 25% | Coast | yes |
| 3 | 21 | 22% | Navy Century | yes |
| 4 | 19 | 21% | Coast | yes |
| 5 | 18 | 21% | Coast | yes |
| 6 | 17 | 19% | Coast | yes |
| 7 | 20 | 27% | Coast | yes |
| 8 | 20 | 39% | Coast | yes |
| 9 | 16 | 26% | Coast | yes |
| 10 | 2 | 83% | Coast | woven |
| 11 | 1 | 88% | Coast | woven |
| 12 | 1 | 88% | Coast | woven |
| 13 | 1 | 88% | Coast | woven |
| 14 | 1 | 89% | Coast | woven |
| 15 | 1 | 89% | Coast | woven |
| 16 | 1 | 89% | Coast | woven |
| 17 | 1 | 89% | Coast | woven |
| 18 | 1 | 89% | Coast | woven |
| 19 | 1 | 89% | Coast | woven |
| 20 | 1 | 88% | Food & Drink | woven |
| 21 | 1 | 90% | Coast | woven |
| 22 | 1 | 88% | Food & Drink | woven |
| 23 | 1 | 90% | Coast | woven |
| 24 | 1 | 88% | Food & Drink | woven |
| 25 | 1 | 90% | Coast | woven |
| 26 | 1 | 88% | Food & Drink | woven |
| 27 | 1 | 88% | Navy Century | woven |
| 28 | 1 | 90% | Coast | woven |
| 29 | 1 | 89% | Food & Drink | woven |
| 30 | 1 | 88% | Navy Century | woven |
| 31 | 1 | 90% | Coast | woven |
| 32 | 1 | 89% | Food & Drink | woven |
| 33 | 1 | 88% | Navy Century | woven |
| 34 | 1 | 90% | Coast | woven |
| 35 | 1 | 89% | Food & Drink | woven |
| 36 | 1 | 88% | Navy Century | woven |
| 37 | 1 | 91% | Coast | woven |
| 38 | 1 | 90% | Food & Drink | woven |
| 39 | 1 | 88% | Navy Century | woven |
| 40 | 1 | 91% | Coast | woven |
