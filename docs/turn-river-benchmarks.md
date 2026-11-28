# TurnRiverLab benchmark results

The [v18 report](turn-river-v18.md) measures exact-flop scalability, compact state, native execution, and weighted preflop games against the later `4f68dcc` branch baseline. This page preserves the earlier `55e6384` comparison.

Baseline `55e6384` and the `turnriver-f64-v2` engine were measured on the same Linux x64 environment with Node.js 24.22.3, an Intel Xeon Platinum 8573C, and a two-CPU quota. The suite uses Float64, deterministic weighted ranges, fixed board cards and bet sizes, and the same measured exploitability targets. Sampled comparisons use the legacy seed mapping at seed 29 in both revisions.

The raw data include separate preparation, WASM initialization, CFR, and best-response timings, iteration throughput, scope of the memory measurements, and numerical results. The suites ran sequentially. Modules can warm across cases within one process. Process high-water RSS is cumulative within a suite, and sampled RSS is also recorded by row. Separate capacity invocations provide isolated peak RSS for the largest full solves. [Baseline data](benchmarks/turn-river-before.json) · [Current data](benchmarks/turn-river-after.json)

## DCFR to the same accuracy

The median is across three repetitions. Time to target includes setup and convergence checks every ten iterations. Except for the exact narrow flop, the target was 0.25 chips per player, corresponding to a 0.50-chip EV interval. The exact narrow flop used 1.50 chips per player. Every row reached its target in both revisions.

| Configuration | Iterations | Gap at stop | Before, ms | After, ms |
| --- | ---: | ---: | ---: | ---: |
| Narrow river, SPR 0.8 | 30 | 0.153296 | 13.4 | 8.3 |
| Wide paired river, SPR 4 | 20 | 0.161674 | 24.1 | 20.2 |
| Turn, symmetric whole-node lock | 40 | 0.174697 | 304.5 | 105.3 |
| Turn, asymmetric combo lock | 50 | 0.223992 | 258.8 | 138.6 |
| Sampled rainbow flop, unrestricted | 60 | 0.241206 | 357.7 | 322.7 |
| Sampled monotone flop, partial lock | 80 | 0.211724 | 552.7 | 262.6 |
| Exact two-tone flop, narrow ranges | 10 | 0.721353 | 844.8 | 262.1 |

For the symmetric turn lock, 424 of 580 decision nodes needed state. Median convergence-check time fell from 127.9 ms to 6.8 ms across four checks. For the asymmetric turn lock all 580 decisions remained canonical and check time fell from 67.5 ms to 12.0 ms across five checks. For the sampled partial-lock flop, eight checks fell from 239.1 ms to 24.7 ms. The centered and fold-zero results agree to the reported precision.

For the exact narrow flop, median preparation and state setup fell from 694.7 ms to 133.7 ms. The exact-order chance tree is the same size. Preparation evaluates only hands in the two ranges and shares hand rankings, blockers, and payoff layouts across swapped turn/river cards.

## Repeated solves

Each case changes a later decision's lock across three mixes over three repetitions. The river target is 0.08 chips/player and the turn target is 0.20. All nine solves per mode met their targets. Median milliseconds include each lock update, warm transfer where applicable, and time to the target. Warm modes use a common 100-iteration donor. The raw records include the one-time donor preparation and training costs.

| Mode | River, ms | Turn, ms |
| --- | ---: | ---: |
| Original, fresh game | 6.28 | 186.25 |
| Current, fresh game | 4.37 | 88.88 |
| Current, reused game, cold strategy | 0.80 | 65.59 |
| Current, continuation strategy | 0.82 | 84.91 |
| Current, discounted regrets | 0.60 | 69.00 |
| Current, combined | 0.58 | 85.67 |

Preparation and arena reuse improved both cases. Combined warm transfer reduced the median river iteration count from 60 to 50. The turn cold reset was faster than every warm mode in this sample. The API leaves warm-start mode explicit.

## Exact flop capacity

The capacity runs used a 512 MiB estimated-engine budget, full 49×48 public enumeration, and no raises. These are the largest cases exercised in the suite.

| Configuration | Structural nodes | Before | After |
| --- | ---: | --- | --- |
| Wide asymmetric ranges, one-sided river sizing | 14,262 | Partial WASM, 434 MiB estimated | Full WASM, 306 MiB estimated |
| Wide symmetric ranges, one-sided turn and river sizing | 28,521 | Partial WASM, 303 MiB estimated | Full WASM, 208 MiB estimated |
| Medium ranges, one-sided sizing on all three streets | 45,282 | Full WASM, 52 MiB estimated | Full WASM, 50 MiB estimated |
| Medium ranges, one size per player on all three streets | 116,580 | Exceeds the old 100,000-node cap | Full WASM, 123 MiB estimated |
| Wide asymmetric ranges, one size per player on all three streets | 116,580 | Exceeds the old node cap | Exceeds the 512 MiB numerical budget |

The wide cases above used two iterations to check allocation and traversal. In the matched one-sided medium solve, both revisions reached 0.490 chips/player in 20 iterations. Time to target fell from 2.05 s to 0.91 s. Isolated process peak RSS fell from 307 MiB to 225 MiB. The current engine solved the 116,580-node medium case to 0.299 chips/player in 4.32 s and 40 iterations. It used 33,705 canonical nodes and peaked at 377 MiB process RSS. Its OOP fold-zero bounds were 44.2111 to 44.8095 chips. These measurements support increasing the configurable node budget with the memory estimate still enforced.

## Algorithm selection

Times below are current-engine medians across two repetitions, in milliseconds to 0.25 chips/player. A limit means the target was still unmet at the configured iteration cap. Original timings and per-case memory and throughput appear in the raw data.

| Algorithm | Narrow river | Wide river | Symmetric locked turn | Sampled flop | Partial-lock flop |
| --- | ---: | ---: | ---: | ---: | ---: |
| CFR+ | 12.9 | 18.7 | 112.3 | 519.2 | 482.8 |
| DCFR | 3.1 | 15.8 | 87.2 | 301.8 | 248.9 |
| Scheduled DCFR | 3.0 | 19.7 | 104.8 | 435.2 | 325.9 |
| Scheduled cubic DCFR | 2.4 | 15.2 | 101.2 | 441.4 | 295.4 |
| Adaptive DCFR | 2.2 | 14.9 | 127.4 | 386.0 | 388.6 |
| Predictive DCFR | 2.2 | 16.0 | 142.0 | 715.7 | 571.4 |
| Linear CFR | 2.1 | 14.2 | 131.4 | 656.5 | limit |
| Cubic DCFR | 2.1 | 9.3 | 111.6 | 335.6 | 430.5 |
| DCFR α=2 β=0.5 γ=2 | 2.0 | 11.0 | 123.3 | 488.9 | 584.4 |
| Optimistic CFR+ | 2.4 | 14.2 | 151.3 | 822.1 | limit |

DCFR remains the default. It reached the target in every case and had the lowest observed wall time on all three multi-street cases in this matrix. Single-digit river times are sensitive to startup and JIT effects. The matrix covers several textures, ranges, and SPRs, and leaves broader validation across deeper stacks and more sizes open.

## Reproduce

```sh
git worktree add --detach /tmp/pokertools-before 55e6384
node --expose-gc scripts/benchmark-turn-river.mjs --source /tmp/pokertools-before/public/turn-river-lab --suite standard --repetitions 3 --revision 55e6384
node --expose-gc scripts/benchmark-turn-river.mjs --suite standard --repetitions 3 --revision turnriver-f64-v2
node --expose-gc scripts/benchmark-turn-river.mjs --suite algorithms --repetitions 2
node --expose-gc scripts/benchmark-turn-river.mjs --suite repeated --repetitions 3
node --expose-gc scripts/benchmark-turn-river.mjs --suite capacity --repetitions 1
node --expose-gc scripts/benchmark-turn-river.mjs --suite capacity --case exact-medium-three-street-two-sided --max-iterations 240 --target .5 --repetitions 1
```

Pass the original source directory with `--source` for additional baseline suites. Use `--backend javascript` for the reference path, `--memory-mib` for the estimated memory budget, and `--case` to isolate RSS. The two one-sided capacity comparisons used `--case exact-medium-three-street-one-sided --max-iterations 200 --target .5 --repetitions 1`.

## Remaining optimization work

- Wide, asymmetric full-flop games can still exceed the budget. Compact legal and unlocked decision rows and a shared all-in continuation representation could reduce Float64 state and repeated work. Changing the storage type would require a separate accuracy baseline.
- Independently active sessions duplicate WASM linear-memory metadata. Layout-preserving lock changes reuse the entire arena within a session. A reusable immutable metadata representation across independent arenas could reduce allocation and packing costs.
- The original WASM training kernels still depend on bundled binaries. Only the new lock-aware kernel has a reproducible source build in this repository. Large unrestricted games, SIMD and scalar implementations of the new kernel, and browser memory pressure warrant additional profiling.
- Sampled games need seed sensitivity checks and exact validation where practical. Candidate elimination is limited to compatible bounds within one game. Broader tests across flops, SPRs, ranges, and raise trees can guide algorithm and warm-start selection.
