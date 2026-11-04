# Woven SEATED-members simulation — route mode (follow-up to composer v3.1, commit F)

Composer: ad223ec · synthetic shelf, current depth (1258 units), seeded; the standard 40-drive commute battery with the heard-aware window and story-level heard (v3.1 A+B) underneath. Same world, eligibility draws and union thread detection as commit F's `--woven` run; the climax-only rows below rerun F's model at the same eligibilities and reproduce grade-woven-sim.md's numbers. Guarantee pass is shelf-only (silence is an upper bound vs production).

THE MODEL — woven members seated in-episode: after F's climax post-pass, unheard eligible woven units on the detected thread topic seat as windowless inserts, strongest first, one telling per place, each placed at the start of the largest silent gap it fits entirely inside (idealized placement — inserts never displace sounding geo material in the sim; the caps stand in for the displacement cost). Seconds-capped configurations bound TOTAL woven story-seconds (the climax insert counts) at 25% / 40% of the episode budget — the same budgetSec the silence share is measured against; the count configuration bounds members at 4 per episode (climax not counted). Seated members are played, hence heard: they burn the woven pool, tracked per topic below. Inherited from F unchanged: thread detection over (corridor pool ∪ woven pool), and the thread's selection nudge on corridor picks is not re-modeled, so tiling is the standard build's.

HEADLINE — substantive thread-bearing episodes (silence ≤ 50% AND a thread found) across 40 drives, vs the 0% run's 8 and F's climax-only best of 9:

| configuration | eligible units | substantive thread-bearing | substantive episodes | substantive-thread starvation | thread drives /40 | climax /40 | mean silence | mean consecutive overlap | woven burned (units / sec) | members seated | woven supply-dry drive |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0% | 0 | 8 | 9 | none in 40 | 8 | 9 | 83% | 0.744 | 0 / 0 | 0 | none in 40 |
| climax-only 50% | 399 | 9 | 9 | none in 40 | 40 | 40 | 75% | 0 | 31 / 7542 | 0 | none in 40 |
| climax-only audit | 473 | 9 | 9 | none in 40 | 40 | 40 | 74% | 0 | 31 / 8293 | 0 | none in 40 |
| seated-25% 50% | 399 | 9 | 9 | none in 40 | 40 | 40 | 61% | 0 | 94 / 20746 | 63 | none in 40 |
| seated-25% audit | 473 | 9 | 9 | none in 40 | 40 | 40 | 61% | 0 | 93 / 21081 | 62 | none in 40 |
| seated-40% 50% | 399 | 9 | 9 | none in 40 | 40 | 40 | 50% | 0 | 153 / 32027 | 122 | none in 40 |
| seated-40% audit | 473 | 9 | 9 | none in 40 | 40 | 40 | 49% | 0 | 149 / 32653 | 118 | none in 40 |
| seated-max4 50% | 399 | 22 | 22 | none in 40 | 40 | 40 | 45% | 0 | 173 / 36540 | 142 | none in 40 |
| seated-max4 audit | 473 | 26 | 26 | none in 40 | 40 | 40 | 41% | 0 | 174 / 39936 | 143 | none in 40 |

HONEST READING — seating scales substance only when woven seconds are allowed to become the episode's majority material; capped below that, it buys fullness, not episodes. (1) THE SECONDS CAPS FAIL THE HEADLINE METRIC FOR AN ARITHMETIC REASON: a substantive episode needs ≥1,200 covered seconds of the 2,400 budget, and in a corridor-dead drive (geo coverage ≈ 0) a 25% cap (600 woven seconds) or a 40% cap (960) can never reach that line — substantive thread-bearing episodes stay 9 at both caps and both eligibilities, exactly F's climax-only count, even though members seat on most drives (62–122 members burned across the capped runs) and mean silence falls to 61% / 49%. The capped models make dead drives less dark (1 story → 2–4), never episodes. (2) THE 4-MEMBER CONFIGURATION SCALES: substantive thread-bearing episodes rise to 22 (flat 50%) and 26 (audit) of 40 — every substantive episode thread-bearing, no substantive-thread starvation in 40, mean silence 45% / 41%. The price is in the burn tables: ~4.3 woven units per drive (174 of 473 eligible units across 40 drives in the audit run), and in dead drives woven supplies ~1,100–1,450 of the 2,400 budget seconds — nearly all of the covered story time. The geo spine becomes the frame, not the content. (3) THE WOVEN CLIFF, AS A HARD EVENT, DOES NOT ARRIVE IN 40 DRIVES: no topic's pool empties (deepest burn: Coast 40 of 58 audit-eligible) and no detected thread ever finds zero woven supply — detection rotates topics as pools thin. What arrives instead is a DURATION FADE: strongest-first seating spends the county's long stories first, so a five-story woven bundle sums to ~1,250 story-seconds around drives 28–30 but only ~730 by drive 40 (flat 50%), and substance lapses drive-by-drive from ~drive 31; the audit pool's deeper per-topic benches hold substance to drive 39, with dips. The binding resource is the pool's LONG stratum, not its unit count. (4) CONSEQUENCE FOR THE DESIGN QUESTION: a production seating rule must cap members by count (as simulated), or set any seconds cap above ~50% of budget for exhausted drives (arithmetic from the substance line — not itself simulated); a 25–40% cap spends woven stories on fullness. And if a woven tranche is ever bought, its value concentrates in LONG stories on the topics this commute burned deepest (Coast, Navy Century, Food & Drink — see the burn tables). The distinctness column inherits F's caveat: past the corridor's life it is exhaustion arithmetic, not an episode-diversity measure.

## Woven pool burn, per configuration and topic

### 0% (0 eligible units)

No woven units consumed.

### climax-only 50% (399 eligible units)

| thread topic | eligible units (topic-tagged) | consumed | consumed sec | pool dry after drive |
|---|---|---|---|---|
| Coast | 32 | 13 | 2861 | not in 40 |
| Navy Century | 36 | 7 | 1813 | not in 40 |
| Highway | 25 | 5 | 1326 | not in 40 |
| Food & Drink | 23 | 3 | 698 | not in 40 |
| Desert | 18 | 2 | 562 | not in 40 |
| Border / CaliBaja | 17 | 1 | 282 | not in 40 |

Totals: 31 woven units (7542 story-seconds), 0 of them seated members, across 0 drives with members; first drive a detected thread found zero unheard woven units on its topic: none in 40.

### climax-only audit (473 eligible units)

| thread topic | eligible units (topic-tagged) | consumed | consumed sec | pool dry after drive |
|---|---|---|---|---|
| Coast | 58 | 18 | 4642 | not in 40 |
| Food & Drink | 50 | 8 | 2198 | not in 40 |
| Navy Century | 51 | 5 | 1453 | not in 40 |

Totals: 31 woven units (8293 story-seconds), 0 of them seated members, across 0 drives with members; first drive a detected thread found zero unheard woven units on its topic: none in 40.

### seated-25% 50% (399 eligible units)

| thread topic | eligible units (topic-tagged) | consumed | consumed sec | pool dry after drive |
|---|---|---|---|---|
| Navy Century | 36 | 13 | 2695 | not in 40 |
| Coast | 32 | 21 | 3911 | not in 40 |
| Highway | 25 | 10 | 2285 | not in 40 |
| Food & Drink | 23 | 9 | 1720 | not in 40 |
| Desert | 18 | 10 | 2253 | not in 40 |
| Border / CaliBaja | 17 | 7 | 1682 | not in 40 |
| Flight | 16 | 7 | 1707 | not in 40 |
| The Cure | 13 | 4 | 1105 | not in 40 |
| Deep Time | 16 | 5 | 1144 | not in 40 |
| Boom & Bust | 12 | 2 | 559 | not in 40 |
| Expositions & the Canal | 13 | 2 | 552 | not in 40 |
| Film | 11 | 2 | 565 | not in 40 |
| Fire & Fault | 10 | 2 | 568 | not in 40 |

Totals: 94 woven units (20746 story-seconds), 63 of them seated members, across 40 drives with members; first drive a detected thread found zero unheard woven units on its topic: none in 40.

### seated-25% audit (473 eligible units)

| thread topic | eligible units (topic-tagged) | consumed | consumed sec | pool dry after drive |
|---|---|---|---|---|
| Coast | 58 | 31 | 6424 | not in 40 |
| Navy Century | 51 | 18 | 4293 | not in 40 |
| Food & Drink | 50 | 24 | 5334 | not in 40 |
| Border / CaliBaja | 31 | 9 | 2230 | not in 40 |
| Desert | 26 | 7 | 1661 | not in 40 |
| Highway | 26 | 4 | 1139 | not in 40 |

Totals: 93 woven units (21081 story-seconds), 62 of them seated members, across 40 drives with members; first drive a detected thread found zero unheard woven units on its topic: none in 40.

### seated-40% 50% (399 eligible units)

| thread topic | eligible units (topic-tagged) | consumed | consumed sec | pool dry after drive |
|---|---|---|---|---|
| Navy Century | 36 | 18 | 3702 | not in 40 |
| Coast | 32 | 27 | 4523 | 38 |
| Highway | 25 | 16 | 3472 | not in 40 |
| Food & Drink | 23 | 16 | 2685 | not in 40 |
| Desert | 18 | 13 | 2794 | not in 40 |
| Border / CaliBaja | 17 | 8 | 1850 | not in 40 |
| Flight | 16 | 8 | 1907 | not in 40 |
| The Cure | 13 | 7 | 1783 | not in 40 |
| Deep Time | 16 | 4 | 948 | not in 40 |
| Boom & Bust | 12 | 8 | 1866 | not in 40 |
| Expositions & the Canal | 13 | 4 | 915 | not in 40 |
| Film | 11 | 4 | 917 | not in 40 |
| Fire & Fault | 10 | 4 | 934 | not in 40 |
| Mission Chain | 13 | 4 | 950 | not in 40 |
| Faith | 12 | 4 | 910 | not in 40 |
| Rail | 14 | 4 | 942 | not in 40 |
| Water | 11 | 4 | 929 | not in 40 |

Totals: 153 woven units (32027 story-seconds), 122 of them seated members, across 40 drives with members; first drive a detected thread found zero unheard woven units on its topic: none in 40.

### seated-40% audit (473 eligible units)

| thread topic | eligible units (topic-tagged) | consumed | consumed sec | pool dry after drive |
|---|---|---|---|---|
| Coast | 58 | 37 | 7308 | not in 40 |
| Navy Century | 51 | 25 | 5843 | not in 40 |
| Food & Drink | 50 | 30 | 6302 | not in 40 |
| Border / CaliBaja | 31 | 13 | 2861 | not in 40 |
| Desert | 26 | 13 | 2806 | not in 40 |
| Highway | 26 | 7 | 1830 | not in 40 |
| Expositions & the Canal | 21 | 4 | 959 | not in 40 |
| Surf | 23 | 4 | 943 | not in 40 |
| Deep Time | 20 | 4 | 947 | not in 40 |
| Film | 19 | 4 | 955 | not in 40 |
| Mission Chain | 23 | 4 | 952 | not in 40 |
| Water | 18 | 4 | 947 | not in 40 |

Totals: 149 woven units (32653 story-seconds), 118 of them seated members, across 40 drives with members; first drive a detected thread found zero unheard woven units on its topic: none in 40.

### seated-max4 50% (399 eligible units)

| thread topic | eligible units (topic-tagged) | consumed | consumed sec | pool dry after drive |
|---|---|---|---|---|
| Navy Century | 36 | 20 | 4086 | not in 40 |
| Coast | 32 | 25 | 4327 | not in 40 |
| Highway | 25 | 18 | 3968 | not in 40 |
| Food & Drink | 23 | 15 | 2616 | not in 40 |
| Desert | 18 | 15 | 3077 | not in 40 |
| Border / CaliBaja | 17 | 10 | 2176 | not in 40 |
| Flight | 16 | 10 | 2295 | not in 40 |
| The Cure | 13 | 10 | 2378 | not in 40 |
| Deep Time | 16 | 10 | 1997 | not in 40 |
| Boom & Bust | 12 | 5 | 1301 | not in 40 |
| Mission Chain | 13 | 5 | 1249 | not in 40 |
| Expositions & the Canal | 13 | 5 | 1176 | not in 40 |
| Film | 11 | 5 | 1235 | not in 40 |
| Fire & Fault | 10 | 5 | 1251 | not in 40 |
| Water | 11 | 5 | 1219 | not in 40 |
| Faith | 12 | 5 | 1057 | not in 40 |
| Rail | 14 | 5 | 1132 | not in 40 |

Totals: 173 woven units (36540 story-seconds), 142 of them seated members, across 40 drives with members; first drive a detected thread found zero unheard woven units on its topic: none in 40.

### seated-max4 audit (473 eligible units)

| thread topic | eligible units (topic-tagged) | consumed | consumed sec | pool dry after drive |
|---|---|---|---|---|
| Coast | 58 | 40 | 7653 | not in 40 |
| Navy Century | 51 | 26 | 6135 | not in 40 |
| Food & Drink | 50 | 28 | 6088 | not in 40 |
| Border / CaliBaja | 31 | 15 | 3276 | not in 40 |
| Desert | 26 | 10 | 2367 | not in 40 |
| Highway | 26 | 10 | 2536 | not in 40 |
| Surf | 23 | 5 | 1314 | not in 40 |
| Expositions & the Canal | 21 | 5 | 1290 | not in 40 |
| Deep Time | 20 | 5 | 1284 | not in 40 |
| Film | 19 | 5 | 1394 | not in 40 |
| Mission Chain | 23 | 5 | 1305 | not in 40 |
| Water | 18 | 5 | 1339 | not in 40 |
| Flight | 17 | 5 | 1332 | not in 40 |
| Rail | 20 | 5 | 1298 | not in 40 |
| Boom & Bust | 21 | 5 | 1325 | not in 40 |

Totals: 174 woven units (39936 story-seconds), 143 of them seated members, across 40 drives with members; first drive a detected thread found zero unheard woven units on its topic: none in 40.

## 0% (0 eligible units)

| drive | stories | silence | thread | members | climax |
|---|---|---|---|---|---|
| 1 | 20 | 18% | Deep Time | 0 | yes |
| 2 | 21 | 25% | Coast | 0 | yes |
| 3 | 21 | 22% | Navy Century | 0 | yes |
| 4 | 19 | 21% | Rail | 0 | yes |
| 5 | 18 | 21% | The Cure | 0 | yes |
| 6 | 17 | 19% | Food & Drink | 0 | yes |
| 7 | 20 | 27% | folklore | 0 | yes |
| 8 | 20 | 39% | Coast | 0 | yes |
| 9 | 16 | 26% | — | 0 | yes |
| 10 | 1 | 95% | — | 0 | — |
| 11 | 0 | 100% | — | 0 | — |
| 12 | 0 | 100% | — | 0 | — |
| 13 | 0 | 100% | — | 0 | — |
| 14 | 0 | 100% | — | 0 | — |
| 15 | 0 | 100% | — | 0 | — |
| 16 | 0 | 100% | — | 0 | — |
| 17 | 0 | 100% | — | 0 | — |
| 18 | 0 | 100% | — | 0 | — |
| 19 | 0 | 100% | — | 0 | — |
| 20 | 0 | 100% | — | 0 | — |
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
| 1 | 20 | 18% | Navy Century | 0 | yes |
| 2 | 21 | 25% | Navy Century | 0 | yes |
| 3 | 21 | 22% | Navy Century | 0 | yes |
| 4 | 19 | 21% | Navy Century | 0 | yes |
| 5 | 18 | 21% | Coast | 0 | yes |
| 6 | 17 | 19% | Coast | 0 | yes |
| 7 | 20 | 27% | Coast | 0 | yes |
| 8 | 20 | 39% | Coast | 0 | yes |
| 9 | 16 | 26% | Coast | 0 | yes |
| 10 | 2 | 84% | Coast | 0 | woven |
| 11 | 1 | 89% | Coast | 0 | woven |
| 12 | 1 | 89% | Coast | 0 | woven |
| 13 | 1 | 89% | Coast | 0 | woven |
| 14 | 1 | 89% | Coast | 0 | woven |
| 15 | 1 | 90% | Coast | 0 | woven |
| 16 | 1 | 88% | Navy Century | 0 | woven |
| 17 | 1 | 90% | Coast | 0 | woven |
| 18 | 1 | 88% | Navy Century | 0 | woven |
| 19 | 1 | 91% | Coast | 0 | woven |
| 20 | 1 | 89% | Highway | 0 | woven |
| 21 | 1 | 88% | Navy Century | 0 | woven |
| 22 | 1 | 93% | Coast | 0 | woven |
| 23 | 1 | 89% | Highway | 0 | woven |
| 24 | 1 | 90% | Navy Century | 0 | woven |
| 25 | 1 | 93% | Coast | 0 | woven |
| 26 | 1 | 88% | Food & Drink | 0 | woven |
| 27 | 1 | 89% | Highway | 0 | woven |
| 28 | 1 | 90% | Navy Century | 0 | woven |
| 29 | 1 | 94% | Coast | 0 | woven |
| 30 | 1 | 88% | Desert | 0 | woven |
| 31 | 1 | 91% | Food & Drink | 0 | woven |
| 32 | 1 | 89% | Highway | 0 | woven |
| 33 | 1 | 91% | Navy Century | 0 | woven |
| 34 | 1 | 94% | Coast | 0 | woven |
| 35 | 1 | 89% | Desert | 0 | woven |
| 36 | 1 | 92% | Food & Drink | 0 | woven |
| 37 | 1 | 89% | Highway | 0 | woven |
| 38 | 1 | 91% | Navy Century | 0 | woven |
| 39 | 1 | 88% | Border / CaliBaja | 0 | woven |
| 40 | 1 | 94% | Coast | 0 | woven |

## climax-only audit (473 eligible units)

| drive | stories | silence | thread | members | climax |
|---|---|---|---|---|---|
| 1 | 20 | 18% | Coast | 0 | yes |
| 2 | 21 | 25% | Coast | 0 | yes |
| 3 | 21 | 22% | Navy Century | 0 | yes |
| 4 | 19 | 21% | Coast | 0 | yes |
| 5 | 18 | 21% | Coast | 0 | yes |
| 6 | 17 | 19% | Coast | 0 | yes |
| 7 | 20 | 27% | Coast | 0 | yes |
| 8 | 20 | 39% | Coast | 0 | yes |
| 9 | 16 | 26% | Coast | 0 | yes |
| 10 | 2 | 83% | Coast | 0 | woven |
| 11 | 1 | 88% | Coast | 0 | woven |
| 12 | 1 | 88% | Coast | 0 | woven |
| 13 | 1 | 88% | Coast | 0 | woven |
| 14 | 1 | 89% | Coast | 0 | woven |
| 15 | 1 | 89% | Coast | 0 | woven |
| 16 | 1 | 89% | Coast | 0 | woven |
| 17 | 1 | 89% | Coast | 0 | woven |
| 18 | 1 | 89% | Coast | 0 | woven |
| 19 | 1 | 89% | Coast | 0 | woven |
| 20 | 1 | 88% | Food & Drink | 0 | woven |
| 21 | 1 | 90% | Coast | 0 | woven |
| 22 | 1 | 88% | Food & Drink | 0 | woven |
| 23 | 1 | 90% | Coast | 0 | woven |
| 24 | 1 | 88% | Food & Drink | 0 | woven |
| 25 | 1 | 90% | Coast | 0 | woven |
| 26 | 1 | 88% | Food & Drink | 0 | woven |
| 27 | 1 | 88% | Navy Century | 0 | woven |
| 28 | 1 | 90% | Coast | 0 | woven |
| 29 | 1 | 89% | Food & Drink | 0 | woven |
| 30 | 1 | 88% | Navy Century | 0 | woven |
| 31 | 1 | 90% | Coast | 0 | woven |
| 32 | 1 | 89% | Food & Drink | 0 | woven |
| 33 | 1 | 88% | Navy Century | 0 | woven |
| 34 | 1 | 90% | Coast | 0 | woven |
| 35 | 1 | 89% | Food & Drink | 0 | woven |
| 36 | 1 | 88% | Navy Century | 0 | woven |
| 37 | 1 | 91% | Coast | 0 | woven |
| 38 | 1 | 90% | Food & Drink | 0 | woven |
| 39 | 1 | 88% | Navy Century | 0 | woven |
| 40 | 1 | 91% | Coast | 0 | woven |

## seated-25% 50% (399 eligible units)

| drive | stories | silence | thread | members | climax |
|---|---|---|---|---|---|
| 1 | 22 | 6% | Navy Century | 2 | yes |
| 2 | 24 | 5% | Coast | 3 | yes |
| 3 | 22 | 10% | Navy Century | 1 | yes |
| 4 | 21 | 7% | Navy Century | 2 | yes |
| 5 | 20 | 10% | Coast | 2 | yes |
| 6 | 18 | 9% | Highway | 1 | yes |
| 7 | 22 | 8% | Coast | 2 | yes |
| 8 | 23 | 14% | Coast | 3 | yes |
| 9 | 18 | 9% | Highway | 2 | yes |
| 10 | 4 | 71% | Food & Drink | 2 | woven |
| 11 | 2 | 78% | Coast | 1 | woven |
| 12 | 2 | 77% | Desert | 1 | woven |
| 13 | 2 | 78% | Highway | 1 | woven |
| 14 | 2 | 76% | Navy Century | 1 | woven |
| 15 | 2 | 77% | Border / CaliBaja | 1 | woven |
| 16 | 2 | 79% | Coast | 1 | woven |
| 17 | 2 | 79% | Desert | 1 | woven |
| 18 | 3 | 76% | Food & Drink | 2 | woven |
| 19 | 2 | 78% | Highway | 1 | woven |
| 20 | 3 | 76% | Navy Century | 2 | woven |
| 21 | 2 | 76% | Flight | 1 | woven |
| 22 | 2 | 78% | Border / CaliBaja | 1 | woven |
| 23 | 3 | 77% | Coast | 2 | woven |
| 24 | 3 | 76% | Desert | 2 | woven |
| 25 | 3 | 76% | Highway | 2 | woven |
| 26 | 2 | 76% | The Cure | 1 | woven |
| 27 | 2 | 76% | Deep Time | 1 | woven |
| 28 | 2 | 78% | Flight | 1 | woven |
| 29 | 3 | 77% | Food & Drink | 2 | woven |
| 30 | 3 | 75% | Navy Century | 2 | woven |
| 31 | 2 | 77% | Boom & Bust | 1 | woven |
| 32 | 3 | 75% | Border / CaliBaja | 2 | woven |
| 33 | 2 | 78% | The Cure | 1 | woven |
| 34 | 4 | 78% | Coast | 3 | woven |
| 35 | 3 | 76% | Deep Time | 2 | woven |
| 36 | 3 | 75% | Desert | 2 | woven |
| 37 | 2 | 77% | Expositions & the Canal | 1 | woven |
| 38 | 2 | 77% | Film | 1 | woven |
| 39 | 2 | 76% | Fire & Fault | 1 | woven |
| 40 | 3 | 75% | Flight | 2 | woven |

## seated-25% audit (473 eligible units)

| drive | stories | silence | thread | members | climax |
|---|---|---|---|---|---|
| 1 | 22 | 6% | Coast | 2 | yes |
| 2 | 24 | 5% | Coast | 3 | yes |
| 3 | 22 | 10% | Navy Century | 1 | yes |
| 4 | 21 | 7% | Coast | 2 | yes |
| 5 | 20 | 10% | Coast | 2 | yes |
| 6 | 18 | 9% | Food & Drink | 1 | yes |
| 7 | 22 | 8% | Coast | 2 | yes |
| 8 | 23 | 16% | Coast | 3 | yes |
| 9 | 18 | 8% | Food & Drink | 2 | yes |
| 10 | 3 | 71% | Food & Drink | 1 | woven |
| 11 | 2 | 76% | Food & Drink | 1 | woven |
| 12 | 2 | 76% | Navy Century | 1 | woven |
| 13 | 2 | 76% | Coast | 1 | woven |
| 14 | 2 | 78% | Food & Drink | 1 | woven |
| 15 | 2 | 76% | Navy Century | 1 | woven |
| 16 | 2 | 77% | Coast | 1 | woven |
| 17 | 3 | 75% | Food & Drink | 2 | woven |
| 18 | 2 | 77% | Navy Century | 1 | woven |
| 19 | 2 | 77% | Coast | 1 | woven |
| 20 | 2 | 79% | Navy Century | 1 | woven |
| 21 | 3 | 75% | Food & Drink | 2 | woven |
| 22 | 2 | 78% | Coast | 1 | woven |
| 23 | 3 | 75% | Navy Century | 2 | woven |
| 24 | 2 | 76% | Border / CaliBaja | 1 | woven |
| 25 | 3 | 75% | Coast | 2 | woven |
| 26 | 3 | 75% | Food & Drink | 2 | woven |
| 27 | 3 | 76% | Navy Century | 2 | woven |
| 28 | 2 | 77% | Border / CaliBaja | 1 | woven |
| 29 | 3 | 75% | Coast | 2 | woven |
| 30 | 2 | 77% | Desert | 1 | woven |
| 31 | 3 | 75% | Food & Drink | 2 | woven |
| 32 | 2 | 79% | Border / CaliBaja | 1 | woven |
| 33 | 3 | 76% | Navy Century | 2 | woven |
| 34 | 2 | 79% | Desert | 1 | woven |
| 35 | 2 | 75% | Highway | 1 | woven |
| 36 | 3 | 75% | Border / CaliBaja | 2 | woven |
| 37 | 3 | 76% | Coast | 2 | woven |
| 38 | 3 | 76% | Food & Drink | 2 | woven |
| 39 | 3 | 75% | Desert | 2 | woven |
| 40 | 2 | 77% | Highway | 1 | woven |

## seated-40% 50% (399 eligible units)

| drive | stories | silence | thread | members | climax |
|---|---|---|---|---|---|
| 1 | 22 | 6% | Navy Century | 2 | yes |
| 2 | 24 | 5% | Coast | 3 | yes |
| 3 | 22 | 10% | Navy Century | 1 | yes |
| 4 | 21 | 7% | Navy Century | 2 | yes |
| 5 | 20 | 10% | Coast | 2 | yes |
| 6 | 18 | 9% | Highway | 1 | yes |
| 7 | 22 | 8% | Coast | 2 | yes |
| 8 | 23 | 13% | Coast | 3 | yes |
| 9 | 18 | 9% | Highway | 2 | yes |
| 10 | 5 | 58% | Food & Drink | 3 | woven |
| 11 | 4 | 61% | Coast | 3 | woven |
| 12 | 4 | 61% | Desert | 3 | woven |
| 13 | 4 | 61% | Highway | 3 | woven |
| 14 | 4 | 61% | Navy Century | 3 | woven |
| 15 | 4 | 61% | Border / CaliBaja | 3 | woven |
| 16 | 4 | 60% | Flight | 3 | woven |
| 17 | 5 | 63% | Food & Drink | 4 | woven |
| 18 | 5 | 63% | Coast | 4 | woven |
| 19 | 4 | 60% | Desert | 3 | woven |
| 20 | 4 | 60% | Highway | 3 | woven |
| 21 | 4 | 62% | Navy Century | 3 | woven |
| 22 | 3 | 65% | The Cure | 2 | woven |
| 23 | 4 | 61% | Deep Time | 3 | woven |
| 24 | 4 | 61% | Boom & Bust | 3 | woven |
| 25 | 4 | 62% | Border / CaliBaja | 3 | woven |
| 26 | 4 | 62% | Expositions & the Canal | 3 | woven |
| 27 | 4 | 62% | Film | 3 | woven |
| 28 | 4 | 61% | Fire & Fault | 3 | woven |
| 29 | 4 | 61% | Flight | 3 | woven |
| 30 | 4 | 60% | Mission Chain | 3 | woven |
| 31 | 4 | 61% | The Cure | 3 | woven |
| 32 | 5 | 62% | Desert | 4 | woven |
| 33 | 4 | 62% | Faith | 3 | woven |
| 34 | 5 | 61% | Highway | 4 | woven |
| 35 | 5 | 61% | Navy Century | 4 | woven |
| 36 | 4 | 61% | Rail | 3 | woven |
| 37 | 4 | 61% | Water | 3 | woven |
| 38 | 8 | 64% | Coast | 7 | woven |
| 39 | 7 | 63% | Food & Drink | 6 | woven |
| 40 | 4 | 62% | Boom & Bust | 3 | woven |

## seated-40% audit (473 eligible units)

| drive | stories | silence | thread | members | climax |
|---|---|---|---|---|---|
| 1 | 22 | 6% | Coast | 2 | yes |
| 2 | 24 | 5% | Coast | 3 | yes |
| 3 | 22 | 10% | Navy Century | 1 | yes |
| 4 | 21 | 7% | Coast | 2 | yes |
| 5 | 20 | 10% | Coast | 2 | yes |
| 6 | 18 | 9% | Food & Drink | 1 | yes |
| 7 | 22 | 8% | Coast | 2 | yes |
| 8 | 24 | 8% | Coast | 4 | yes |
| 9 | 18 | 8% | Food & Drink | 2 | yes |
| 10 | 4 | 59% | Food & Drink | 2 | woven |
| 11 | 3 | 64% | Navy Century | 2 | woven |
| 12 | 4 | 60% | Food & Drink | 3 | woven |
| 13 | 4 | 60% | Coast | 3 | woven |
| 14 | 4 | 60% | Navy Century | 3 | woven |
| 15 | 4 | 61% | Food & Drink | 3 | woven |
| 16 | 4 | 60% | Coast | 3 | woven |
| 17 | 4 | 60% | Navy Century | 3 | woven |
| 18 | 5 | 60% | Food & Drink | 4 | woven |
| 19 | 4 | 60% | Border / CaliBaja | 3 | woven |
| 20 | 4 | 61% | Coast | 3 | woven |
| 21 | 4 | 61% | Navy Century | 3 | woven |
| 22 | 4 | 60% | Desert | 3 | woven |
| 23 | 4 | 60% | Border / CaliBaja | 3 | woven |
| 24 | 5 | 60% | Food & Drink | 4 | woven |
| 25 | 4 | 63% | Coast | 3 | woven |
| 26 | 3 | 64% | Highway | 2 | woven |
| 27 | 4 | 64% | Navy Century | 3 | woven |
| 28 | 4 | 62% | Desert | 3 | woven |
| 29 | 4 | 60% | Highway | 3 | woven |
| 30 | 5 | 60% | Border / CaliBaja | 4 | woven |
| 31 | 6 | 61% | Coast | 5 | woven |
| 32 | 4 | 60% | Expositions & the Canal | 3 | woven |
| 33 | 6 | 60% | Food & Drink | 5 | woven |
| 34 | 4 | 61% | Surf | 3 | woven |
| 35 | 4 | 61% | Deep Time | 3 | woven |
| 36 | 4 | 60% | Film | 3 | woven |
| 37 | 4 | 60% | Mission Chain | 3 | woven |
| 38 | 5 | 60% | Navy Century | 4 | woven |
| 39 | 5 | 61% | Desert | 4 | woven |
| 40 | 4 | 61% | Water | 3 | woven |

## seated-max4 50% (399 eligible units)

| drive | stories | silence | thread | members | climax |
|---|---|---|---|---|---|
| 1 | 22 | 6% | Navy Century | 2 | yes |
| 2 | 24 | 5% | Coast | 3 | yes |
| 3 | 22 | 10% | Navy Century | 1 | yes |
| 4 | 21 | 7% | Navy Century | 2 | yes |
| 5 | 20 | 10% | Coast | 2 | yes |
| 6 | 18 | 9% | Highway | 1 | yes |
| 7 | 22 | 8% | Coast | 2 | yes |
| 8 | 23 | 13% | Coast | 3 | yes |
| 9 | 18 | 9% | Highway | 2 | yes |
| 10 | 6 | 50% | Food & Drink | 4 | woven |
| 11 | 5 | 47% | Coast | 4 | woven |
| 12 | 5 | 46% | Desert | 4 | woven |
| 13 | 5 | 47% | Highway | 4 | woven |
| 14 | 5 | 46% | Navy Century | 4 | woven |
| 15 | 5 | 44% | Border / CaliBaja | 4 | woven |
| 16 | 5 | 43% | Flight | 4 | woven |
| 17 | 5 | 64% | Food & Drink | 4 | woven |
| 18 | 5 | 43% | The Cure | 4 | woven |
| 19 | 5 | 71% | Coast | 4 | woven |
| 20 | 5 | 50% | Deep Time | 4 | woven |
| 21 | 5 | 54% | Highway | 4 | woven |
| 22 | 5 | 57% | Navy Century | 4 | woven |
| 23 | 5 | 46% | Boom & Bust | 4 | woven |
| 24 | 5 | 57% | Desert | 4 | woven |
| 25 | 5 | 48% | Mission Chain | 4 | woven |
| 26 | 5 | 65% | Border / CaliBaja | 4 | woven |
| 27 | 5 | 51% | Expositions & the Canal | 4 | woven |
| 28 | 5 | 49% | Film | 4 | woven |
| 29 | 5 | 48% | Fire & Fault | 4 | woven |
| 30 | 5 | 49% | Water | 4 | woven |
| 31 | 5 | 56% | Faith | 4 | woven |
| 32 | 5 | 53% | Rail | 4 | woven |
| 33 | 5 | 61% | Flight | 4 | woven |
| 34 | 5 | 72% | Food & Drink | 4 | woven |
| 35 | 5 | 58% | The Cure | 4 | woven |
| 36 | 5 | 78% | Coast | 4 | woven |
| 37 | 5 | 67% | Deep Time | 4 | woven |
| 38 | 5 | 61% | Highway | 4 | woven |
| 39 | 5 | 65% | Navy Century | 4 | woven |
| 40 | 5 | 69% | Desert | 4 | woven |

## seated-max4 audit (473 eligible units)

| drive | stories | silence | thread | members | climax |
|---|---|---|---|---|---|
| 1 | 22 | 6% | Coast | 2 | yes |
| 2 | 24 | 5% | Coast | 3 | yes |
| 3 | 22 | 10% | Navy Century | 1 | yes |
| 4 | 21 | 7% | Coast | 2 | yes |
| 5 | 20 | 10% | Coast | 2 | yes |
| 6 | 18 | 9% | Food & Drink | 1 | yes |
| 7 | 22 | 8% | Coast | 2 | yes |
| 8 | 24 | 8% | Coast | 4 | yes |
| 9 | 18 | 8% | Food & Drink | 2 | yes |
| 10 | 6 | 36% | Food & Drink | 4 | woven |
| 11 | 5 | 40% | Navy Century | 4 | woven |
| 12 | 5 | 41% | Coast | 4 | woven |
| 13 | 5 | 50% | Food & Drink | 4 | woven |
| 14 | 5 | 47% | Navy Century | 4 | woven |
| 15 | 5 | 46% | Coast | 4 | woven |
| 16 | 5 | 57% | Food & Drink | 4 | woven |
| 17 | 5 | 42% | Border / CaliBaja | 4 | woven |
| 18 | 5 | 53% | Navy Century | 4 | woven |
| 19 | 5 | 57% | Coast | 4 | woven |
| 20 | 5 | 46% | Desert | 4 | woven |
| 21 | 5 | 61% | Food & Drink | 4 | woven |
| 22 | 5 | 42% | Highway | 4 | woven |
| 23 | 5 | 56% | Navy Century | 4 | woven |
| 24 | 5 | 55% | Border / CaliBaja | 4 | woven |
| 25 | 5 | 71% | Coast | 4 | woven |
| 26 | 5 | 56% | Desert | 4 | woven |
| 27 | 5 | 66% | Food & Drink | 4 | woven |
| 28 | 5 | 45% | Surf | 4 | woven |
| 29 | 5 | 46% | Expositions & the Canal | 4 | woven |
| 30 | 5 | 47% | Deep Time | 4 | woven |
| 31 | 5 | 42% | Film | 4 | woven |
| 32 | 5 | 46% | Mission Chain | 4 | woven |
| 33 | 5 | 44% | Water | 4 | woven |
| 34 | 5 | 67% | Border / CaliBaja | 4 | woven |
| 35 | 5 | 61% | Navy Century | 4 | woven |
| 36 | 5 | 45% | Flight | 4 | woven |
| 37 | 5 | 53% | Highway | 4 | woven |
| 38 | 5 | 46% | Rail | 4 | woven |
| 39 | 5 | 45% | Boom & Bust | 4 | woven |
| 40 | 5 | 76% | Coast | 4 | woven |
