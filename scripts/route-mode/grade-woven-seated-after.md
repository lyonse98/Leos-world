# Woven SEATED-members simulation — route mode (follow-up to composer v3.1, commit F)

Composer: ecb0a0b · synthetic shelf, current depth (1258 units), seeded; the standard 40-drive commute battery with the heard-aware window and story-level heard (v3.1 A+B) underneath. Same world, eligibility draws and union thread detection as commit F's `--woven` run; the climax-only rows below rerun F's model at the same eligibilities and reproduce grade-woven-sim.md's numbers. Guarantee pass is shelf-only (silence is an upper bound vs production).

THE MODEL — woven members seated in-episode: after F's climax post-pass, unheard eligible woven units on the detected thread topic seat as windowless inserts, strongest first, one telling per place, each placed at the start of the largest silent gap it fits entirely inside (idealized placement — inserts never displace sounding geo material in the sim; the caps stand in for the displacement cost). Seconds-capped configurations bound TOTAL woven story-seconds (the climax insert counts) at 25% / 40% of the episode budget — the same budgetSec the silence share is measured against; the count configuration bounds members at 4 per episode (climax not counted). Seated members are played, hence heard: they burn the woven pool, tracked per topic below. Inherited from F unchanged: thread detection over (corridor pool ∪ woven pool), and the thread's selection nudge on corridor picks is not re-modeled, so tiling is the standard build's.

HEADLINE — substantive thread-bearing episodes (silence ≤ 50% AND a thread found) across 40 drives, vs the 0% run's 11 and F's climax-only best of 9:

| configuration | eligible units | substantive thread-bearing | substantive episodes | substantive-thread starvation | thread drives /40 | climax /40 | mean silence | mean consecutive overlap | woven burned (units / sec) | members seated | woven supply-dry drive |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0% | 0 | 11 | 13 | none in 40 | 11 | 14 | 70% | 0.487 | 0 / 0 | 0 | none in 40 |
| climax-only 50% | 399 | 13 | 13 | none in 40 | 40 | 40 | 65% | 0 | 26 / 5974 | 0 | none in 40 |
| climax-only audit | 473 | 13 | 13 | none in 40 | 40 | 40 | 64% | 0 | 26 / 6623 | 0 | none in 40 |
| seated-25% 50% | 399 | 14 | 14 | none in 40 | 40 | 40 | 52% | 0 | 89 / 18366 | 63 | none in 40 |
| seated-25% audit | 473 | 14 | 14 | none in 40 | 40 | 40 | 52% | 0 | 89 / 18347 | 63 | none in 40 |
| seated-40% 50% | 399 | 17 | 17 | none in 40 | 40 | 40 | 42% | 0 | 141 / 28047 | 115 | none in 40 |
| seated-40% audit | 473 | 16 | 16 | none in 40 | 40 | 40 | 42% | 0 | 138 / 28269 | 112 | none in 40 |
| seated-max4 50% | 399 | 24 | 24 | none in 40 | 40 | 40 | 38% | 0 | 158 / 32019 | 132 | none in 40 |
| seated-max4 audit | 473 | 29 | 29 | none in 40 | 40 | 40 | 35% | 0 | 154 / 34218 | 128 | none in 40 |

HONEST READING — seating scales substance only when woven seconds are allowed to become the episode's majority material; capped below that, it buys fullness, not episodes. (1) THE SECONDS CAPS FAIL THE HEADLINE METRIC FOR AN ARITHMETIC REASON: a substantive episode needs ≥1,200 covered seconds of the 2,400 budget, and in a corridor-dead drive (geo coverage ≈ 0) a 25% cap (600 woven seconds) or a 40% cap (960) can never reach that line — substantive thread-bearing episodes stay 14 at both caps and both eligibilities, exactly F's climax-only count, even though members seat on most drives (63–115 members burned across the capped runs) and mean silence falls to 52% / 42%. The capped models make dead drives less dark (1 story → 2–4), never episodes. (2) THE 4-MEMBER CONFIGURATION SCALES: substantive thread-bearing episodes rise to 24 (flat 50%) and 29 (audit) of 40 — every substantive episode thread-bearing, no substantive-thread starvation in 40, mean silence 38% / 35%. The price is in the burn tables: ~4.3 woven units per drive (154 of 473 eligible units across 40 drives in the audit run), and in dead drives woven supplies ~1,100–1,450 of the 2,400 budget seconds — nearly all of the covered story time. The geo spine becomes the frame, not the content. (3) THE WOVEN CLIFF, AS A HARD EVENT, DOES NOT ARRIVE IN 40 DRIVES: no topic's pool empties (deepest burn: Coast 33 of 58 audit-eligible) and no detected thread ever finds zero woven supply — detection rotates topics as pools thin. What arrives instead is a DURATION FADE: strongest-first seating spends the county's long stories first, so a five-story woven bundle sums to ~1,250 story-seconds around drives 28–30 but only ~730 by drive 40 (flat 50%), and substance lapses drive-by-drive from ~drive 31; the audit pool's deeper per-topic benches hold substance to drive 39, with dips. The binding resource is the pool's LONG stratum, not its unit count. (4) CONSEQUENCE FOR THE DESIGN QUESTION: a production seating rule must cap members by count (as simulated), or set any seconds cap above ~50% of budget for exhausted drives (arithmetic from the substance line — not itself simulated); a 25–40% cap spends woven stories on fullness. And if a woven tranche is ever bought, its value concentrates in LONG stories on the topics this commute burned deepest (Coast, Navy Century, Food & Drink — see the burn tables). The distinctness column inherits F's caveat: past the corridor's life it is exhaustion arithmetic, not an episode-diversity measure.

## Woven pool burn, per configuration and topic

### 0% (0 eligible units)

No woven units consumed.

### climax-only 50% (399 eligible units)

| thread topic | eligible units (topic-tagged) | consumed | consumed sec | pool dry after drive |
|---|---|---|---|---|
| Coast | 32 | 14 | 2887 | not in 40 |
| Navy Century | 36 | 7 | 1737 | not in 40 |
| Desert | 18 | 2 | 562 | not in 40 |
| Flight | 16 | 2 | 585 | not in 40 |
| Food & Drink | 23 | 1 | 203 | not in 40 |

Totals: 26 woven units (5974 story-seconds), 0 of them seated members, across 0 drives with members; first drive a detected thread found zero unheard woven units on its topic: none in 40.

### climax-only audit (473 eligible units)

| thread topic | eligible units (topic-tagged) | consumed | consumed sec | pool dry after drive |
|---|---|---|---|---|
| Coast | 58 | 16 | 3891 | not in 40 |
| Food & Drink | 50 | 8 | 2148 | not in 40 |
| Navy Century | 51 | 2 | 584 | not in 40 |

Totals: 26 woven units (6623 story-seconds), 0 of them seated members, across 0 drives with members; first drive a detected thread found zero unheard woven units on its topic: none in 40.

### seated-25% 50% (399 eligible units)

| thread topic | eligible units (topic-tagged) | consumed | consumed sec | pool dry after drive |
|---|---|---|---|---|
| Navy Century | 36 | 15 | 2579 | not in 40 |
| Coast | 32 | 23 | 3998 | not in 40 |
| Food & Drink | 23 | 7 | 1292 | not in 40 |
| Desert | 18 | 8 | 1667 | not in 40 |
| Flight | 16 | 7 | 1707 | not in 40 |
| Border / CaliBaja | 17 | 7 | 1665 | not in 40 |
| Highway | 25 | 6 | 1571 | not in 40 |
| The Cure | 13 | 4 | 1097 | not in 40 |
| Deep Time | 16 | 5 | 1084 | not in 40 |
| Film | 11 | 2 | 565 | not in 40 |
| Boom & Bust | 12 | 2 | 559 | not in 40 |
| Faith | 12 | 3 | 582 | not in 40 |

Totals: 89 woven units (18366 story-seconds), 63 of them seated members, across 38 drives with members; first drive a detected thread found zero unheard woven units on its topic: none in 40.

### seated-25% audit (473 eligible units)

| thread topic | eligible units (topic-tagged) | consumed | consumed sec | pool dry after drive |
|---|---|---|---|---|
| Coast | 58 | 32 | 6057 | not in 40 |
| Food & Drink | 50 | 24 | 4979 | not in 40 |
| Navy Century | 51 | 16 | 3328 | not in 40 |
| Border / CaliBaja | 31 | 10 | 2253 | not in 40 |
| Desert | 26 | 5 | 1161 | not in 40 |
| Surf | 23 | 2 | 569 | not in 40 |

Totals: 89 woven units (18347 story-seconds), 63 of them seated members, across 38 drives with members; first drive a detected thread found zero unheard woven units on its topic: none in 40.

### seated-40% 50% (399 eligible units)

| thread topic | eligible units (topic-tagged) | consumed | consumed sec | pool dry after drive |
|---|---|---|---|---|
| Navy Century | 36 | 20 | 3606 | not in 40 |
| Coast | 32 | 27 | 4397 | 35 |
| Food & Drink | 23 | 13 | 2069 | not in 40 |
| Desert | 18 | 12 | 2460 | not in 40 |
| Flight | 16 | 8 | 1907 | not in 40 |
| Border / CaliBaja | 17 | 9 | 1896 | not in 40 |
| Highway | 25 | 8 | 1909 | not in 40 |
| The Cure | 13 | 7 | 1730 | not in 40 |
| Deep Time | 16 | 10 | 1800 | 40 |
| Film | 11 | 4 | 917 | not in 40 |
| Boom & Bust | 12 | 3 | 808 | not in 40 |
| Faith | 12 | 5 | 951 | not in 40 |
| Fire & Fault | 10 | 3 | 823 | not in 40 |
| Expositions & the Canal | 13 | 4 | 919 | not in 40 |
| Mission Chain | 13 | 4 | 909 | not in 40 |
| Water | 11 | 4 | 946 | not in 40 |

Totals: 141 woven units (28047 story-seconds), 115 of them seated members, across 38 drives with members; first drive a detected thread found zero unheard woven units on its topic: none in 40.

### seated-40% audit (473 eligible units)

| thread topic | eligible units (topic-tagged) | consumed | consumed sec | pool dry after drive |
|---|---|---|---|---|
| Coast | 58 | 38 | 6762 | not in 40 |
| Food & Drink | 50 | 30 | 5930 | not in 40 |
| Navy Century | 51 | 20 | 4222 | not in 40 |
| Border / CaliBaja | 31 | 14 | 2864 | not in 40 |
| Desert | 26 | 8 | 1822 | not in 40 |
| Surf | 23 | 8 | 1901 | not in 40 |
| Deep Time | 20 | 4 | 947 | not in 40 |
| Expositions & the Canal | 21 | 4 | 959 | not in 40 |
| Film | 19 | 4 | 955 | not in 40 |
| Flight | 17 | 4 | 952 | not in 40 |
| Rail | 20 | 4 | 955 | not in 40 |

Totals: 138 woven units (28269 story-seconds), 112 of them seated members, across 38 drives with members; first drive a detected thread found zero unheard woven units on its topic: none in 40.

### seated-max4 50% (399 eligible units)

| thread topic | eligible units (topic-tagged) | consumed | consumed sec | pool dry after drive |
|---|---|---|---|---|
| Navy Century | 36 | 18 | 3275 | not in 40 |
| Coast | 32 | 26 | 4300 | not in 40 |
| Food & Drink | 23 | 11 | 1865 | not in 40 |
| Desert | 18 | 13 | 2523 | 40 |
| Flight | 16 | 10 | 2347 | not in 40 |
| Border / CaliBaja | 17 | 10 | 2056 | not in 40 |
| Highway | 25 | 10 | 2442 | not in 40 |
| The Cure | 13 | 10 | 2232 | not in 40 |
| Deep Time | 16 | 10 | 1800 | 39 |
| Film | 11 | 5 | 1235 | not in 40 |
| Boom & Bust | 12 | 5 | 1301 | not in 40 |
| Faith | 12 | 5 | 951 | not in 40 |
| Fire & Fault | 10 | 5 | 1251 | not in 40 |
| Expositions & the Canal | 13 | 5 | 1091 | not in 40 |
| Mission Chain | 13 | 5 | 1249 | not in 40 |
| Water | 11 | 5 | 1049 | not in 40 |
| Rail | 14 | 5 | 1052 | not in 40 |

Totals: 158 woven units (32019 story-seconds), 132 of them seated members, across 38 drives with members; first drive a detected thread found zero unheard woven units on its topic: none in 40.

### seated-max4 audit (473 eligible units)

| thread topic | eligible units (topic-tagged) | consumed | consumed sec | pool dry after drive |
|---|---|---|---|---|
| Coast | 58 | 33 | 6210 | not in 40 |
| Food & Drink | 50 | 27 | 5547 | not in 40 |
| Navy Century | 51 | 19 | 4193 | not in 40 |
| Border / CaliBaja | 31 | 15 | 3016 | not in 40 |
| Desert | 26 | 10 | 2247 | not in 40 |
| Surf | 23 | 10 | 2454 | not in 40 |
| Deep Time | 20 | 5 | 1284 | not in 40 |
| Expositions & the Canal | 21 | 5 | 1233 | not in 40 |
| Film | 19 | 5 | 1394 | not in 40 |
| Rail | 20 | 5 | 1298 | not in 40 |
| Flight | 17 | 5 | 1332 | not in 40 |
| Highway | 26 | 5 | 1364 | not in 40 |
| Mission Chain | 23 | 5 | 1305 | not in 40 |
| The Cure | 14 | 5 | 1341 | not in 40 |

Totals: 154 woven units (34218 story-seconds), 128 of them seated members, across 38 drives with members; first drive a detected thread found zero unheard woven units on its topic: none in 40.

## 0% (0 eligible units)

| drive | stories | silence | thread | members | climax |
|---|---|---|---|---|---|
| 1 | 18 | 19% | Deep Time | 0 | yes |
| 2 | 17 | 26% | Deep Time | 0 | yes |
| 3 | 18 | 17% | Deep Time | 0 | yes |
| 4 | 19 | 20% | Navy Century | 0 | yes |
| 5 | 13 | 14% | Food & Drink | 0 | yes |
| 6 | 19 | 8% | Highway | 0 | yes |
| 7 | 16 | 15% | Rail | 0 | yes |
| 8 | 21 | 14% | Coast | 0 | yes |
| 9 | 17 | 14% | folklore | 0 | yes |
| 10 | 17 | 14% | Coast | 0 | yes |
| 11 | 19 | 15% | Border / CaliBaja | 0 | yes |
| 12 | 17 | 27% | — | 0 | yes |
| 13 | 21 | 51% | — | 0 | yes |
| 14 | 15 | 23% | — | 0 | yes |
| 15 | 7 | 75% | — | 0 | — |
| 16 | 6 | 81% | — | 0 | — |
| 17 | 2 | 92% | — | 0 | — |
| 18 | 1 | 96% | — | 0 | — |
| 19 | 1 | 97% | — | 0 | — |
| 20 | 1 | 96% | — | 0 | — |
| 21 | 0 | 100% | — | 0 | — |
| 22 | 0 | 100% | — | 0 | — |
| 23 | 0 | 100% | — | 0 | — |
| 24 | 0 | 100% | — | 0 | — |
| 25 | 0 | 100% | — | 0 | — |
| 26 | 0 | 100% | — | 0 | — |
| 27 | 0 | 100% | — | 0 | — |
| 28 | 0 | 100% | — | 0 | — |
| 29 | 0 | 100% | — | 0 | — |
| 30 | 0 | 100% | — | 0 | — |
| 31 | 0 | 100% | — | 0 | — |
| 32 | 0 | 100% | — | 0 | — |
| 33 | 0 | 100% | — | 0 | — |
| 34 | 0 | 100% | — | 0 | — |
| 35 | 0 | 100% | — | 0 | — |
| 36 | 0 | 100% | — | 0 | — |
| 37 | 0 | 100% | — | 0 | — |
| 38 | 0 | 100% | — | 0 | — |
| 39 | 0 | 100% | — | 0 | — |
| 40 | 0 | 100% | — | 0 | — |

## climax-only 50% (399 eligible units)

| drive | stories | silence | thread | members | climax |
|---|---|---|---|---|---|
| 1 | 18 | 19% | Navy Century | 0 | yes |
| 2 | 17 | 26% | Navy Century | 0 | yes |
| 3 | 18 | 17% | Navy Century | 0 | yes |
| 4 | 19 | 20% | Navy Century | 0 | yes |
| 5 | 13 | 14% | Coast | 0 | yes |
| 6 | 19 | 8% | Coast | 0 | yes |
| 7 | 16 | 15% | Coast | 0 | yes |
| 8 | 21 | 14% | Coast | 0 | yes |
| 9 | 17 | 14% | Coast | 0 | yes |
| 10 | 17 | 14% | Coast | 0 | yes |
| 11 | 19 | 15% | Coast | 0 | yes |
| 12 | 17 | 27% | Coast | 0 | yes |
| 13 | 21 | 51% | Coast | 0 | yes |
| 14 | 15 | 23% | Coast | 0 | yes |
| 15 | 8 | 67% | Coast | 0 | woven |
| 16 | 7 | 73% | Coast | 0 | woven |
| 17 | 3 | 85% | Coast | 0 | woven |
| 18 | 2 | 89% | Coast | 0 | woven |
| 19 | 2 | 90% | Coast | 0 | woven |
| 20 | 2 | 90% | Coast | 0 | woven |
| 21 | 1 | 91% | Coast | 0 | woven |
| 22 | 1 | 93% | Coast | 0 | woven |
| 23 | 1 | 88% | Navy Century | 0 | woven |
| 24 | 1 | 93% | Coast | 0 | woven |
| 25 | 1 | 88% | Navy Century | 0 | woven |
| 26 | 1 | 94% | Coast | 0 | woven |
| 27 | 1 | 90% | Navy Century | 0 | woven |
| 28 | 1 | 94% | Coast | 0 | woven |
| 29 | 1 | 90% | Navy Century | 0 | woven |
| 30 | 1 | 94% | Coast | 0 | woven |
| 31 | 1 | 91% | Navy Century | 0 | woven |
| 32 | 1 | 94% | Coast | 0 | woven |
| 33 | 1 | 88% | Desert | 0 | woven |
| 34 | 1 | 88% | Flight | 0 | woven |
| 35 | 1 | 91% | Navy Century | 0 | woven |
| 36 | 1 | 94% | Coast | 0 | woven |
| 37 | 1 | 89% | Desert | 0 | woven |
| 38 | 1 | 88% | Flight | 0 | woven |
| 39 | 1 | 92% | Food & Drink | 0 | woven |
| 40 | 1 | 91% | Navy Century | 0 | woven |

## climax-only audit (473 eligible units)

| drive | stories | silence | thread | members | climax |
|---|---|---|---|---|---|
| 1 | 18 | 19% | Coast | 0 | yes |
| 2 | 17 | 26% | Coast | 0 | yes |
| 3 | 18 | 17% | Food & Drink | 0 | yes |
| 4 | 19 | 20% | Food & Drink | 0 | yes |
| 5 | 13 | 14% | Food & Drink | 0 | yes |
| 6 | 19 | 8% | Coast | 0 | yes |
| 7 | 16 | 15% | Coast | 0 | yes |
| 8 | 21 | 14% | Coast | 0 | yes |
| 9 | 17 | 14% | Coast | 0 | yes |
| 10 | 17 | 14% | Coast | 0 | yes |
| 11 | 19 | 15% | Coast | 0 | yes |
| 12 | 17 | 27% | Coast | 0 | yes |
| 13 | 21 | 51% | Coast | 0 | yes |
| 14 | 15 | 23% | Coast | 0 | yes |
| 15 | 8 | 67% | Coast | 0 | woven |
| 16 | 7 | 72% | Coast | 0 | woven |
| 17 | 3 | 84% | Coast | 0 | woven |
| 18 | 2 | 89% | Coast | 0 | woven |
| 19 | 2 | 89% | Coast | 0 | woven |
| 20 | 2 | 89% | Coast | 0 | woven |
| 21 | 1 | 89% | Coast | 0 | woven |
| 22 | 1 | 90% | Coast | 0 | woven |
| 23 | 1 | 90% | Coast | 0 | woven |
| 24 | 1 | 88% | Food & Drink | 0 | woven |
| 25 | 1 | 90% | Coast | 0 | woven |
| 26 | 1 | 88% | Food & Drink | 0 | woven |
| 27 | 1 | 90% | Coast | 0 | woven |
| 28 | 1 | 88% | Food & Drink | 0 | woven |
| 29 | 1 | 91% | Coast | 0 | woven |
| 30 | 1 | 89% | Food & Drink | 0 | woven |
| 31 | 1 | 91% | Coast | 0 | woven |
| 32 | 1 | 89% | Food & Drink | 0 | woven |
| 33 | 1 | 91% | Coast | 0 | woven |
| 34 | 1 | 89% | Food & Drink | 0 | woven |
| 35 | 1 | 93% | Coast | 0 | woven |
| 36 | 1 | 90% | Food & Drink | 0 | woven |
| 37 | 1 | 88% | Navy Century | 0 | woven |
| 38 | 1 | 93% | Coast | 0 | woven |
| 39 | 1 | 90% | Food & Drink | 0 | woven |
| 40 | 1 | 88% | Navy Century | 0 | woven |

## seated-25% 50% (399 eligible units)

| drive | stories | silence | thread | members | climax |
|---|---|---|---|---|---|
| 1 | 20 | 11% | Navy Century | 2 | yes |
| 2 | 21 | 3% | Coast | 4 | yes |
| 3 | 20 | 6% | Navy Century | 2 | yes |
| 4 | 17 | 6% | Navy Century | 1 | yes |
| 5 | 17 | 11% | Navy Century | 0 | yes |
| 6 | 19 | 4% | Navy Century | 3 | yes |
| 7 | 19 | 4% | Coast | 3 | yes |
| 8 | 20 | 9% | Coast | 0 | yes |
| 9 | 19 | 10% | Coast | 1 | yes |
| 10 | 20 | 8% | Coast | 2 | yes |
| 11 | 22 | 14% | Food & Drink | 1 | yes |
| 12 | 20 | 10% | Coast | 2 | yes |
| 13 | 20 | 22% | Coast | 2 | yes |
| 14 | 17 | 14% | Desert | 3 | yes |
| 15 | 8 | 60% | Navy Century | 1 | woven |
| 16 | 8 | 61% | Flight | 1 | woven |
| 17 | 6 | 65% | Border / CaliBaja | 1 | woven |
| 18 | 3 | 79% | Coast | 1 | woven |
| 19 | 4 | 76% | Food & Drink | 2 | woven |
| 20 | 2 | 77% | Highway | 1 | woven |
| 21 | 2 | 80% | Navy Century | 1 | woven |
| 22 | 2 | 78% | Desert | 1 | woven |
| 23 | 2 | 78% | Flight | 1 | woven |
| 24 | 2 | 78% | Border / CaliBaja | 1 | woven |
| 25 | 3 | 76% | Coast | 2 | woven |
| 26 | 2 | 78% | Highway | 1 | woven |
| 27 | 3 | 76% | Navy Century | 2 | woven |
| 28 | 2 | 76% | The Cure | 1 | woven |
| 29 | 2 | 77% | Deep Time | 1 | woven |
| 30 | 3 | 76% | Desert | 2 | woven |
| 31 | 3 | 75% | Flight | 2 | woven |
| 32 | 3 | 78% | Food & Drink | 2 | woven |
| 33 | 3 | 76% | Border / CaliBaja | 2 | woven |
| 34 | 2 | 77% | Film | 1 | woven |
| 35 | 2 | 79% | Highway | 1 | woven |
| 36 | 2 | 78% | The Cure | 1 | woven |
| 37 | 2 | 77% | Boom & Bust | 1 | woven |
| 38 | 4 | 77% | Coast | 3 | woven |
| 39 | 3 | 78% | Deep Time | 2 | woven |
| 40 | 3 | 76% | Faith | 2 | woven |

## seated-25% audit (473 eligible units)

| drive | stories | silence | thread | members | climax |
|---|---|---|---|---|---|
| 1 | 20 | 10% | Coast | 2 | yes |
| 2 | 21 | 3% | Coast | 4 | yes |
| 3 | 20 | 6% | Food & Drink | 2 | yes |
| 4 | 21 | 11% | Navy Century | 2 | yes |
| 5 | 14 | 10% | Food & Drink | 1 | yes |
| 6 | 19 | 8% | Coast | 0 | yes |
| 7 | 17 | 9% | Coast | 1 | yes |
| 8 | 23 | 7% | Coast | 1 | yes |
| 9 | 19 | 3% | Navy Century | 2 | yes |
| 10 | 18 | 9% | Coast | 1 | yes |
| 11 | 18 | 15% | Food & Drink | 0 | yes |
| 12 | 19 | 7% | Coast | 2 | yes |
| 13 | 23 | 27% | Food & Drink | 2 | yes |
| 14 | 16 | 9% | Coast | 2 | yes |
| 15 | 9 | 55% | Food & Drink | 1 | woven |
| 16 | 8 | 60% | Coast | 1 | woven |
| 17 | 4 | 74% | Food & Drink | 1 | woven |
| 18 | 3 | 77% | Coast | 1 | woven |
| 19 | 4 | 75% | Food & Drink | 2 | woven |
| 20 | 3 | 78% | Coast | 1 | woven |
| 21 | 2 | 76% | Navy Century | 1 | woven |
| 22 | 3 | 75% | Coast | 2 | woven |
| 23 | 3 | 75% | Food & Drink | 2 | woven |
| 24 | 2 | 76% | Navy Century | 1 | woven |
| 25 | 2 | 77% | Border / CaliBaja | 1 | woven |
| 26 | 3 | 75% | Coast | 2 | woven |
| 27 | 3 | 75% | Food & Drink | 2 | woven |
| 28 | 2 | 78% | Navy Century | 1 | woven |
| 29 | 2 | 78% | Border / CaliBaja | 1 | woven |
| 30 | 2 | 77% | Desert | 1 | woven |
| 31 | 3 | 76% | Navy Century | 2 | woven |
| 32 | 3 | 75% | Border / CaliBaja | 2 | woven |
| 33 | 3 | 76% | Coast | 2 | woven |
| 34 | 3 | 75% | Food & Drink | 2 | woven |
| 35 | 3 | 75% | Desert | 2 | woven |
| 36 | 3 | 76% | Navy Century | 2 | woven |
| 37 | 2 | 76% | Surf | 1 | woven |
| 38 | 3 | 76% | Border / CaliBaja | 2 | woven |
| 39 | 4 | 76% | Coast | 3 | woven |
| 40 | 3 | 76% | Food & Drink | 2 | woven |

## seated-40% 50% (399 eligible units)

| drive | stories | silence | thread | members | climax |
|---|---|---|---|---|---|
| 1 | 20 | 11% | Navy Century | 2 | yes |
| 2 | 21 | 3% | Coast | 4 | yes |
| 3 | 20 | 6% | Navy Century | 2 | yes |
| 4 | 17 | 6% | Navy Century | 1 | yes |
| 5 | 17 | 11% | Navy Century | 0 | yes |
| 6 | 19 | 4% | Navy Century | 3 | yes |
| 7 | 19 | 4% | Coast | 3 | yes |
| 8 | 20 | 9% | Coast | 0 | yes |
| 9 | 19 | 10% | Coast | 1 | yes |
| 10 | 20 | 8% | Coast | 2 | yes |
| 11 | 22 | 14% | Food & Drink | 1 | yes |
| 12 | 20 | 10% | Coast | 2 | yes |
| 13 | 22 | 9% | Coast | 4 | yes |
| 14 | 17 | 14% | Desert | 3 | yes |
| 15 | 9 | 50% | Navy Century | 2 | woven |
| 16 | 10 | 46% | Flight | 3 | woven |
| 17 | 8 | 49% | Border / CaliBaja | 3 | woven |
| 18 | 6 | 61% | Food & Drink | 4 | woven |
| 19 | 5 | 61% | Highway | 3 | woven |
| 20 | 4 | 60% | Desert | 3 | woven |
| 21 | 4 | 62% | Navy Century | 3 | woven |
| 22 | 4 | 60% | Coast | 3 | woven |
| 23 | 3 | 65% | The Cure | 2 | woven |
| 24 | 4 | 62% | Deep Time | 3 | woven |
| 25 | 5 | 60% | Border / CaliBaja | 4 | woven |
| 26 | 4 | 62% | Film | 3 | woven |
| 27 | 4 | 61% | Flight | 3 | woven |
| 28 | 4 | 60% | Highway | 3 | woven |
| 29 | 3 | 66% | Boom & Bust | 2 | woven |
| 30 | 5 | 60% | Faith | 4 | woven |
| 31 | 3 | 66% | Fire & Fault | 2 | woven |
| 32 | 7 | 61% | Food & Drink | 6 | woven |
| 33 | 5 | 61% | Navy Century | 4 | woven |
| 34 | 4 | 63% | The Cure | 3 | woven |
| 35 | 7 | 67% | Coast | 6 | woven |
| 36 | 5 | 61% | Desert | 4 | woven |
| 37 | 4 | 62% | Expositions & the Canal | 3 | woven |
| 38 | 4 | 62% | Mission Chain | 3 | woven |
| 39 | 4 | 61% | Water | 3 | woven |
| 40 | 6 | 64% | Deep Time | 5 | woven |

## seated-40% audit (473 eligible units)

| drive | stories | silence | thread | members | climax |
|---|---|---|---|---|---|
| 1 | 20 | 10% | Coast | 2 | yes |
| 2 | 21 | 3% | Coast | 4 | yes |
| 3 | 20 | 6% | Food & Drink | 2 | yes |
| 4 | 21 | 11% | Navy Century | 2 | yes |
| 5 | 14 | 10% | Food & Drink | 1 | yes |
| 6 | 19 | 8% | Coast | 0 | yes |
| 7 | 17 | 9% | Coast | 1 | yes |
| 8 | 23 | 7% | Coast | 1 | yes |
| 9 | 19 | 3% | Navy Century | 2 | yes |
| 10 | 18 | 9% | Coast | 1 | yes |
| 11 | 18 | 15% | Food & Drink | 0 | yes |
| 12 | 19 | 7% | Coast | 2 | yes |
| 13 | 25 | 14% | Food & Drink | 4 | yes |
| 14 | 16 | 9% | Coast | 2 | yes |
| 15 | 11 | 39% | Coast | 3 | woven |
| 16 | 10 | 44% | Food & Drink | 3 | woven |
| 17 | 6 | 56% | Coast | 3 | woven |
| 18 | 5 | 60% | Food & Drink | 3 | woven |
| 19 | 4 | 64% | Navy Century | 2 | woven |
| 20 | 5 | 60% | Border / CaliBaja | 3 | woven |
| 21 | 4 | 61% | Coast | 3 | woven |
| 22 | 4 | 60% | Navy Century | 3 | woven |
| 23 | 4 | 64% | Food & Drink | 3 | woven |
| 24 | 4 | 60% | Desert | 3 | woven |
| 25 | 4 | 61% | Border / CaliBaja | 3 | woven |
| 26 | 5 | 63% | Coast | 4 | woven |
| 27 | 4 | 60% | Navy Century | 3 | woven |
| 28 | 5 | 60% | Food & Drink | 4 | woven |
| 29 | 4 | 61% | Surf | 3 | woven |
| 30 | 4 | 64% | Desert | 3 | woven |
| 31 | 6 | 60% | Border / CaliBaja | 5 | woven |
| 32 | 4 | 61% | Deep Time | 3 | woven |
| 33 | 4 | 60% | Expositions & the Canal | 3 | woven |
| 34 | 4 | 60% | Film | 3 | woven |
| 35 | 5 | 60% | Navy Century | 4 | woven |
| 36 | 8 | 60% | Coast | 7 | woven |
| 37 | 4 | 60% | Flight | 3 | woven |
| 38 | 6 | 60% | Food & Drink | 5 | woven |
| 39 | 4 | 60% | Rail | 3 | woven |
| 40 | 4 | 60% | Surf | 3 | woven |

## seated-max4 50% (399 eligible units)

| drive | stories | silence | thread | members | climax |
|---|---|---|---|---|---|
| 1 | 20 | 11% | Navy Century | 2 | yes |
| 2 | 21 | 3% | Coast | 4 | yes |
| 3 | 20 | 6% | Navy Century | 2 | yes |
| 4 | 17 | 6% | Navy Century | 1 | yes |
| 5 | 17 | 11% | Navy Century | 0 | yes |
| 6 | 19 | 4% | Navy Century | 3 | yes |
| 7 | 19 | 4% | Coast | 3 | yes |
| 8 | 20 | 9% | Coast | 0 | yes |
| 9 | 19 | 10% | Coast | 1 | yes |
| 10 | 20 | 8% | Coast | 2 | yes |
| 11 | 22 | 14% | Food & Drink | 1 | yes |
| 12 | 20 | 10% | Coast | 2 | yes |
| 13 | 22 | 9% | Coast | 4 | yes |
| 14 | 17 | 14% | Desert | 3 | yes |
| 15 | 11 | 30% | Navy Century | 4 | woven |
| 16 | 11 | 29% | Flight | 4 | woven |
| 17 | 9 | 33% | Border / CaliBaja | 4 | woven |
| 18 | 6 | 61% | Food & Drink | 4 | woven |
| 19 | 6 | 45% | Highway | 4 | woven |
| 20 | 5 | 49% | Desert | 4 | woven |
| 21 | 5 | 54% | Coast | 4 | woven |
| 22 | 5 | 45% | The Cure | 4 | woven |
| 23 | 5 | 55% | Deep Time | 4 | woven |
| 24 | 5 | 56% | Navy Century | 4 | woven |
| 25 | 5 | 49% | Film | 4 | woven |
| 26 | 5 | 59% | Flight | 4 | woven |
| 27 | 5 | 46% | Boom & Bust | 4 | woven |
| 28 | 5 | 70% | Border / CaliBaja | 4 | woven |
| 29 | 5 | 60% | Faith | 4 | woven |
| 30 | 5 | 48% | Fire & Fault | 4 | woven |
| 31 | 5 | 69% | Food & Drink | 4 | woven |
| 32 | 5 | 54% | Highway | 4 | woven |
| 33 | 5 | 55% | Expositions & the Canal | 4 | woven |
| 34 | 5 | 48% | Mission Chain | 4 | woven |
| 35 | 5 | 56% | Water | 4 | woven |
| 36 | 5 | 78% | Coast | 4 | woven |
| 37 | 5 | 56% | Rail | 4 | woven |
| 38 | 5 | 62% | The Cure | 4 | woven |
| 39 | 5 | 70% | Deep Time | 4 | woven |
| 40 | 5 | 69% | Desert | 4 | woven |

## seated-max4 audit (473 eligible units)

| drive | stories | silence | thread | members | climax |
|---|---|---|---|---|---|
| 1 | 20 | 10% | Coast | 2 | yes |
| 2 | 21 | 3% | Coast | 4 | yes |
| 3 | 20 | 6% | Food & Drink | 2 | yes |
| 4 | 21 | 11% | Navy Century | 2 | yes |
| 5 | 14 | 10% | Food & Drink | 1 | yes |
| 6 | 19 | 8% | Coast | 0 | yes |
| 7 | 17 | 9% | Coast | 1 | yes |
| 8 | 23 | 7% | Coast | 1 | yes |
| 9 | 19 | 3% | Navy Century | 2 | yes |
| 10 | 18 | 9% | Coast | 1 | yes |
| 11 | 18 | 15% | Food & Drink | 0 | yes |
| 12 | 19 | 7% | Coast | 2 | yes |
| 13 | 25 | 14% | Food & Drink | 4 | yes |
| 14 | 16 | 9% | Coast | 2 | yes |
| 15 | 12 | 22% | Coast | 4 | woven |
| 16 | 11 | 28% | Food & Drink | 4 | woven |
| 17 | 7 | 44% | Coast | 4 | woven |
| 18 | 6 | 40% | Navy Century | 4 | woven |
| 19 | 6 | 54% | Food & Drink | 4 | woven |
| 20 | 6 | 44% | Border / CaliBaja | 4 | woven |
| 21 | 5 | 63% | Coast | 4 | woven |
| 22 | 5 | 50% | Navy Century | 4 | woven |
| 23 | 5 | 47% | Desert | 4 | woven |
| 24 | 5 | 59% | Food & Drink | 4 | woven |
| 25 | 5 | 60% | Border / CaliBaja | 4 | woven |
| 26 | 5 | 45% | Surf | 4 | woven |
| 27 | 5 | 73% | Coast | 4 | woven |
| 28 | 5 | 56% | Navy Century | 4 | woven |
| 29 | 5 | 47% | Deep Time | 4 | woven |
| 30 | 5 | 60% | Desert | 4 | woven |
| 31 | 5 | 49% | Expositions & the Canal | 4 | woven |
| 32 | 5 | 42% | Film | 4 | woven |
| 33 | 5 | 64% | Food & Drink | 4 | woven |
| 34 | 5 | 70% | Border / CaliBaja | 4 | woven |
| 35 | 5 | 46% | Rail | 4 | woven |
| 36 | 5 | 45% | Flight | 4 | woven |
| 37 | 5 | 43% | Highway | 4 | woven |
| 38 | 5 | 46% | Mission Chain | 4 | woven |
| 39 | 5 | 53% | Surf | 4 | woven |
| 40 | 5 | 44% | The Cure | 4 | woven |
