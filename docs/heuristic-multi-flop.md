# Heuristic Tester v2 · Multi-flop evaluation

1. In **Solver → Setup**, choose **Flop** under **Start from** and expand **Heuristic Tester**. Set **Study** to **Multiple flops**. Select the shared Hero decision and load or enter the candidate rules. The decisions are matched by betting history, acting player, and legal actions on every board. [Candidate rules and examples](heuristic-tester.md)
2. Enter one flop per line, import a JSON array of flop strings or three-card arrays, or choose **Load representative flops**. A JSON object with a `boards` array also works. Duplicate flops count as errors even if the card order differs. **All valid flop classes** prepares the complete range-conditioned population. Preview that collection to see the solve count, then explicitly choose **Run comparison**.
3. Use Setup's original preflop weights or choose **Import original ranges**. The import accepts `{"weights0":[...],"weights1":[...]}` with 1,326 weights per player in Solver combo ID order. It also accepts a saved multi-flop result's `config`. Supply the preflop weights before removing cards for any particular board. Each board applies its own blockers. Choose **Preview combos** to inspect the Setup flop.
4. Choose **Run comparison**. The worker solves one board and one candidate at a time with cold starts. It reuses that board's unrestricted baseline for all candidates. The progress line shows the board, candidate, elapsed time, and completed probability coverage. **Cancel** keeps fully completed boards available for export.

**Exact full runouts** use deterministic Float64 DCFR with all legal turn and river cards. **Fixed sampled runouts** are exact for the configured sampled game on each selected flop. The collection label separately identifies the complete preflop population or a selected subset.

## Exact-combo rules

An exact combo outside Hero's original preflop range is a study error. For an exact combo that belongs to the original range and is blocked on a particular flop, the default **Report the board as failed** marks the affected board and excludes it from aggregate results. **Skip with a warning** explicitly permits the compiler to skip that blocked combo on that flop. The usual rule priority and default still apply to every legal combo. The per-flop view and JSON export report which references were skipped. Zero-probability flops have no compatible matchup in the original ranges and are counted separately from failed solves.

## Board probabilities

Let `M(B)` be the sum of `w₀(h₀) × w₁(h₁)` over every compatible pair of private hands disjoint from flop `B`. Each compatible pair leaves 48 cards, so it has `C(48, 3) = 17,296` equally likely unordered flops. The unconditional probability of the physical flop given the original ranges is

```
P(B) = M(B) / (M(empty) × C(48, 3)).
```

In the Solver, `M(B)` equals the board-conditioned `jointZ` multiplied by the two board-legal raw range totals. Collection planning computes the equivalent compatible mass using weights normalized by each player's original raw total. Those factors cancel in the probability ratio. It uses compatible blocker sums like the Solver's `jointZ` and sums the eligible hands directly when the subtraction is near zero.

Suit groups use only permutations that leave **both original weighted ranges** unchanged and preserve every exact-combo rule's set of combos. Starting-hand classes, made hands, positional pairs, and the draw predicates already preserve suit relabeling. Full deterministic runouts and the shared betting rules also preserve the transformation. The tester keeps fixed sampled boards separate because their selected runouts can differ under a suit relabeling. With all 24 suit permutations the full deck has 1,755 flop orbits, with different multiplicities. Asymmetric inputs can require up to 22,100 distinct physical flops before removing zero-probability boards. For a chosen subset, each representative's weight covers only that orbit's selected members. The export stores flop card IDs in ascending order, which is also the runout seed input order for a fixed sampled tree.

## Aggregation and resume

The tester averages EV-loss estimates and the two endpoints independently using the original preflop probability of each **completed** board. It divides through by the completed probability mass. Every candidate in a comparison uses the same completed boards. The summary reports both completed mass as a share of the total population and its share of the selected collection. Running on a selected list gives a result conditional on that list and its completed coverage.

The median counts each represented physical board once. The JSON export also includes the probability-weighted median. Best and worst boards use the loss interval midpoint. The candidate ranking uses the aggregate midpoint, with overlapping intervals inconclusive. For a threshold, the reported estimate counts midpoint losses strictly below it. Its lower percentage counts boards whose upper endpoint is below it, and its upper percentage counts boards whose lower endpoint is below it.

**Export JSON** records the original config, candidate rules, collection, completed intervals, skipped references, and failed boards. You can export the progress of an active run once one board finishes. **Export CSV** provides the aggregate and per-flop loss intervals with their probability mass after a run stops. Use **Resume JSON** with the same Setup and iteration cap. Import the original range weights from the saved config if the current Setup uses different weights. The tester checks fingerprints and compares the underlying data for the config and decision, the candidates and exact-combo policy, and the collection and grouping. It verifies the completed board records and recomputes their loss and aggregate values. A failed or interrupted board is eligible to solve again. You can change thresholds when resuming. A complete-population resume requires a fresh collection preview.

## Benchmark

```sh
node --expose-gc scripts/solver/heuristic-multi-benchmark.mjs
```

The benchmark uses the existing wide-range exact flop fixture and the example candidates on an ace-high rainbow flop, a two-tone broadway flop, and a paired flop. It records total wall time, largest Solver-reported game allocation, and peak process RSS. The latter includes the JavaScript runtime and discarded allocations awaiting collection. `SOLVER_MULTI_MAX` and `SOLVER_MULTI_WIDTH` set the iteration cap and target loss interval percentage.

On one logical CPU of an AMD EPYC 9V74 with Node 24.22.1, dense Float64 and SIMD128 WASM, the three-board study took **46.29 s** with browser-style yields. All three restricted candidates reached the 0.5% pot interval target on all boards. The largest Solver-reported game allocation was **188.8 MiB** and peak Node process RSS was **1.32 GiB**. The worker drops each numerical game before building the next. Garbage collection determines when its buffers are reclaimed.

| Flop | Share of all probability | Baseline and candidates wall time |
| --- | ---: | ---: |
| As Th 2d | 0.004226% | 19.1 s |
| 8c 8d 3s | 0.005112% | 14.7 s |
| Kh Qh 7c | 0.003772% | 12.5 s |
| **Completed coverage** | **0.013110%** | **46.29 s total** |

The selected subset gave aggregate loss intervals of **3.1399–3.4998%** of pot for **Value and draws**, **3.2840–3.6407%** for **Bet range**, and **4.8625–5.1738%** for **Check range**. The first two intervals overlap. The unrestricted control has zero loss by construction.
