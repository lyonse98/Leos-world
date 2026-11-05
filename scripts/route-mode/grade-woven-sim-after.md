# Woven-pool simulation — route mode (composer v3.1, commit F)

Composer: ecb0a0b · synthetic shelf, current depth (1258 units), seeded; the standard 40-drive commute battery with the heard-aware window and story-level heard (v3.1 A+B) underneath. Woven units are thread/climax material only — they never geo-tile and never open chapters. Guarantee pass is shelf-only (silence is an upper bound vs production).

HEADLINE — distinct, thread-bearing commute episodes before thread starvation (thread-found failing on 5 consecutive drives), vs the 0% run's 11:

| woven share | eligible units | thread episodes before starvation | additional vs 0% | starvation drive | thread drives /40 | climax drives /40 | woven climaxes | substantive episodes (silence ≤ 50%) | of those, thread-bearing | mean consecutive overlap | mean silence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0% | 0 | 11 | — | 12 | 11 | 14 | 0 | 13 | 11 | 0.487 | 70% |
| 25% | 200 | 40 | +29 | none in 40 | 40 | 40 | 26 | 13 | 13 | 0 | 65% |
| 50% | 399 | 40 | +29 | none in 40 | 40 | 40 | 26 | 13 | 13 | 0 | 65% |
| 75% | 581 | 40 | +29 | none in 40 | 40 | 40 | 26 | 13 | 13 | 0 | 64% |
| audit | 473 | 40 | +29 | none in 40 | 40 | 40 | 26 | 13 | 13 | 0 | 64% |

WHAT THE HEADLINE DOES AND DOES NOT SAY — read before deciding: at every woven share the corridor itself exhausts on the same drive as the 0% run (the geo supply is untouched by register). Past that drive, a "thread-bearing" drive is ONE woven climax story under a county-detected through-line, in a drive that is otherwise ~89% silence (see the per-drive tables). Woven therefore buys ZERO additional substantive episodes (silence ≤ 50%: identical at every share) — what it buys is that the commute never goes fully dark: the episode SHAPE (a named through-line + a closing story) survives indefinitely, and 25% already saturates that effect (25/50/75/audit are indistinguishable) because the pool is spent only through the single climax slot, one story per drive. The distinctness column is dominated by exhaustion arithmetic (empty-vs-empty pairs score 1; singleton-insert pairs score 0) and should not be read as an episode-diversity measure past the corridor's life. The open design question the sim poses: woven value scales only if woven members may also be SEATED as thread members inside the episode (multiple inserts), not only as its climax — that variant is not simulated here.

Model notes: episode distinctness is the mean Jaccard overlap of consecutive episodes' story sets (lower = more different). Silence barely moves by design — woven units do not tile; the only coverage they add is the climax insert's own duration. The selection-nudge effect of a woven-supported thread on corridor picks is not modeled, so distinctness gains here are a floor.

## Woven share 0% (0 eligible units)

| drive | stories | silence | thread | climax |
|---|---|---|---|---|
| 1 | 18 | 19% | Deep Time | yes |
| 2 | 17 | 26% | Deep Time | yes |
| 3 | 18 | 17% | Deep Time | yes |
| 4 | 19 | 20% | Navy Century | yes |
| 5 | 13 | 14% | Food & Drink | yes |
| 6 | 19 | 8% | Highway | yes |
| 7 | 16 | 15% | Rail | yes |
| 8 | 21 | 14% | Coast | yes |
| 9 | 17 | 14% | folklore | yes |
| 10 | 17 | 14% | Coast | yes |
| 11 | 19 | 15% | Border / CaliBaja | yes |
| 12 | 17 | 27% | — | yes |
| 13 | 21 | 51% | — | yes |
| 14 | 15 | 23% | — | yes |
| 15 | 7 | 75% | — | — |
| 16 | 6 | 81% | — | — |
| 17 | 2 | 92% | — | — |
| 18 | 1 | 96% | — | — |
| 19 | 1 | 97% | — | — |
| 20 | 1 | 96% | — | — |
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
| 1 | 18 | 19% | Highway | yes |
| 2 | 17 | 26% | Coast | yes |
| 3 | 18 | 17% | Navy Century | yes |
| 4 | 19 | 20% | Navy Century | yes |
| 5 | 13 | 14% | Highway | yes |
| 6 | 19 | 8% | Highway | yes |
| 7 | 16 | 15% | Coast | yes |
| 8 | 21 | 14% | Coast | yes |
| 9 | 17 | 14% | Coast | yes |
| 10 | 17 | 14% | Coast | yes |
| 11 | 19 | 15% | Coast | yes |
| 12 | 17 | 27% | Coast | yes |
| 13 | 21 | 51% | Coast | yes |
| 14 | 15 | 23% | Coast | yes |
| 15 | 8 | 68% | Coast | woven |
| 16 | 7 | 73% | Coast | woven |
| 17 | 3 | 86% | Coast | woven |
| 18 | 2 | 91% | Coast | woven |
| 19 | 2 | 93% | Coast | woven |
| 20 | 2 | 94% | Coast | woven |
| 21 | 1 | 88% | Desert | woven |
| 22 | 1 | 89% | Highway | woven |
| 23 | 1 | 88% | Navy Century | woven |
| 24 | 1 | 94% | Coast | woven |
| 25 | 1 | 90% | Desert | woven |
| 26 | 1 | 89% | Highway | woven |
| 27 | 1 | 90% | Navy Century | woven |
| 28 | 1 | 88% | Border / CaliBaja | woven |
| 29 | 1 | 94% | Coast | woven |
| 30 | 1 | 90% | Desert | woven |
| 31 | 1 | 89% | Highway | woven |
| 32 | 1 | 91% | Navy Century | woven |
| 33 | 1 | 89% | Border / CaliBaja | woven |
| 34 | 1 | 94% | Coast | woven |
| 35 | 1 | 91% | Desert | woven |
| 36 | 1 | 88% | Flight | woven |
| 37 | 1 | 90% | Highway | woven |
| 38 | 1 | 91% | Navy Century | woven |
| 39 | 1 | 89% | Border / CaliBaja | woven |
| 40 | 1 | 94% | Coast | woven |

## Woven share 50% (399 eligible units)

| drive | stories | silence | thread | climax |
|---|---|---|---|---|
| 1 | 18 | 19% | Navy Century | yes |
| 2 | 17 | 26% | Navy Century | yes |
| 3 | 18 | 17% | Navy Century | yes |
| 4 | 19 | 20% | Navy Century | yes |
| 5 | 13 | 14% | Coast | yes |
| 6 | 19 | 8% | Coast | yes |
| 7 | 16 | 15% | Coast | yes |
| 8 | 21 | 14% | Coast | yes |
| 9 | 17 | 14% | Coast | yes |
| 10 | 17 | 14% | Coast | yes |
| 11 | 19 | 15% | Coast | yes |
| 12 | 17 | 27% | Coast | yes |
| 13 | 21 | 51% | Coast | yes |
| 14 | 15 | 23% | Coast | yes |
| 15 | 8 | 67% | Coast | woven |
| 16 | 7 | 73% | Coast | woven |
| 17 | 3 | 85% | Coast | woven |
| 18 | 2 | 89% | Coast | woven |
| 19 | 2 | 90% | Coast | woven |
| 20 | 2 | 90% | Coast | woven |
| 21 | 1 | 91% | Coast | woven |
| 22 | 1 | 93% | Coast | woven |
| 23 | 1 | 88% | Navy Century | woven |
| 24 | 1 | 93% | Coast | woven |
| 25 | 1 | 88% | Navy Century | woven |
| 26 | 1 | 94% | Coast | woven |
| 27 | 1 | 90% | Navy Century | woven |
| 28 | 1 | 94% | Coast | woven |
| 29 | 1 | 90% | Navy Century | woven |
| 30 | 1 | 94% | Coast | woven |
| 31 | 1 | 91% | Navy Century | woven |
| 32 | 1 | 94% | Coast | woven |
| 33 | 1 | 88% | Desert | woven |
| 34 | 1 | 88% | Flight | woven |
| 35 | 1 | 91% | Navy Century | woven |
| 36 | 1 | 94% | Coast | woven |
| 37 | 1 | 89% | Desert | woven |
| 38 | 1 | 88% | Flight | woven |
| 39 | 1 | 92% | Food & Drink | woven |
| 40 | 1 | 91% | Navy Century | woven |

## Woven share 75% (581 eligible units)

| drive | stories | silence | thread | climax |
|---|---|---|---|---|
| 1 | 18 | 19% | Navy Century | yes |
| 2 | 17 | 26% | Coast | yes |
| 3 | 18 | 17% | Navy Century | yes |
| 4 | 19 | 20% | Navy Century | yes |
| 5 | 13 | 14% | Coast | yes |
| 6 | 19 | 8% | Coast | yes |
| 7 | 16 | 15% | Coast | yes |
| 8 | 21 | 14% | Coast | yes |
| 9 | 17 | 14% | Coast | yes |
| 10 | 17 | 14% | Coast | yes |
| 11 | 19 | 15% | Coast | yes |
| 12 | 17 | 27% | Coast | yes |
| 13 | 21 | 51% | Coast | yes |
| 14 | 15 | 23% | Coast | yes |
| 15 | 8 | 67% | Coast | woven |
| 16 | 7 | 72% | Coast | woven |
| 17 | 3 | 85% | Coast | woven |
| 18 | 2 | 89% | Coast | woven |
| 19 | 2 | 89% | Coast | woven |
| 20 | 2 | 90% | Coast | woven |
| 21 | 1 | 90% | Coast | woven |
| 22 | 1 | 91% | Coast | woven |
| 23 | 1 | 88% | Navy Century | woven |
| 24 | 1 | 91% | Coast | woven |
| 25 | 1 | 88% | Navy Century | woven |
| 26 | 1 | 91% | Coast | woven |
| 27 | 1 | 88% | Navy Century | woven |
| 28 | 1 | 93% | Coast | woven |
| 29 | 1 | 88% | Navy Century | woven |
| 30 | 1 | 93% | Coast | woven |
| 31 | 1 | 88% | Food & Drink | woven |
| 32 | 1 | 90% | Navy Century | woven |
| 33 | 1 | 93% | Coast | woven |
| 34 | 1 | 88% | Food & Drink | woven |
| 35 | 1 | 90% | Navy Century | woven |
| 36 | 1 | 94% | Coast | woven |
| 37 | 1 | 89% | Food & Drink | woven |
| 38 | 1 | 90% | Navy Century | woven |
| 39 | 1 | 94% | Coast | woven |
| 40 | 1 | 89% | Food & Drink | woven |

## Woven share audit (473 eligible units)

| drive | stories | silence | thread | climax |
|---|---|---|---|---|
| 1 | 18 | 19% | Coast | yes |
| 2 | 17 | 26% | Coast | yes |
| 3 | 18 | 17% | Food & Drink | yes |
| 4 | 19 | 20% | Food & Drink | yes |
| 5 | 13 | 14% | Food & Drink | yes |
| 6 | 19 | 8% | Coast | yes |
| 7 | 16 | 15% | Coast | yes |
| 8 | 21 | 14% | Coast | yes |
| 9 | 17 | 14% | Coast | yes |
| 10 | 17 | 14% | Coast | yes |
| 11 | 19 | 15% | Coast | yes |
| 12 | 17 | 27% | Coast | yes |
| 13 | 21 | 51% | Coast | yes |
| 14 | 15 | 23% | Coast | yes |
| 15 | 8 | 67% | Coast | woven |
| 16 | 7 | 72% | Coast | woven |
| 17 | 3 | 84% | Coast | woven |
| 18 | 2 | 89% | Coast | woven |
| 19 | 2 | 89% | Coast | woven |
| 20 | 2 | 89% | Coast | woven |
| 21 | 1 | 89% | Coast | woven |
| 22 | 1 | 90% | Coast | woven |
| 23 | 1 | 90% | Coast | woven |
| 24 | 1 | 88% | Food & Drink | woven |
| 25 | 1 | 90% | Coast | woven |
| 26 | 1 | 88% | Food & Drink | woven |
| 27 | 1 | 90% | Coast | woven |
| 28 | 1 | 88% | Food & Drink | woven |
| 29 | 1 | 91% | Coast | woven |
| 30 | 1 | 89% | Food & Drink | woven |
| 31 | 1 | 91% | Coast | woven |
| 32 | 1 | 89% | Food & Drink | woven |
| 33 | 1 | 91% | Coast | woven |
| 34 | 1 | 89% | Food & Drink | woven |
| 35 | 1 | 93% | Coast | woven |
| 36 | 1 | 90% | Food & Drink | woven |
| 37 | 1 | 88% | Navy Century | woven |
| 38 | 1 | 93% | Coast | woven |
| 39 | 1 | 90% | Food & Drink | woven |
| 40 | 1 | 88% | Navy Century | woven |
