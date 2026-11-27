# TurnRiverLab v18 benchmark and engineering report

The baseline was `4f68dcc` on `solver/repeated-constrained-solving`. Its 71 tests passed before implementation. The v18 engine was measured from `23be02c`. The v18 suite includes archived weighted combination inputs, public chance settings, numerical layouts, training and evaluation backend names, EV endpoints, range and tree fingerprints, and per-repetition measurements. The production browser build and the new native/JS/WASM parity tests are part of validation.

## Benchmark games

The benchmark reads the `GTOw 500nl Simple` inputs from the repository's archived study snapshot at `f9ea705820f13dc1574f29dcb9a0c8773a580f45`. The parser maps all 1,326 physical combinations from the snapshot's card and combo order into the engine's order. BTN and CO single-raised games use the opener's raise vector and BB's call vector. In three-bet pots, the opener's postflop input is its original raise weight times its conditional call frequency. Exact asymmetric inputs are retained. The explicitly symmetric orbit cases average each hand category across physical suits.

The snapshot includes the four-bettor's action and the defender's three-bet vector. Four-bet defense uses a documented approximation that multiplies the defender's three-bet weight by fixed call frequencies for selected categories. Those cases are input approximations. [Range fixtures](../scripts/turn-river-realistic-cases.mjs)

| Game | Initial pot | Remaining effective stack | Dead blind |
| --- | ---: | ---: | ---: |
| BTN vs BB or CO vs BB single-raised | 5.50 bb | 97.50 bb | 0.50 bb |
| BTN vs SB three-bet | 25.00 bb | 88.00 bb | 1.00 bb |
| BTN vs BB three-bet | 26.50 bb | 87.00 bb | 0.50 bb |
| BTN vs BB four-bet | 54.50 bb | 73.00 bb | 0.50 bb |
| BTN vs SB four-bet | 53.00 bb | 74.00 bb | 1.00 bb |

One big blind is 100 solver chips. All pots use 100 bb preflop effective stacks and omit rake. The default sampled comparison uses 6 public turns, 5 rivers per turn and seed 29. Exact cases use all 49 turns and 48 rivers per turn. The relevant hero for c-bet comparisons is player 1. A benchmark lock after the initial check assigns 75% check and 25% to the first bet, with additional actions at zero. Benchmarks may override the mix explicitly.

## What the measurements mean

EV interval width is the sum of centered constrained best responses. Half-NashConv exploitability is half that sum. Percent targets divide width by the starting pot. A solve counts as reaching a target when the final measured width is at or below it. Fixed-iteration tests expose both convergence and memory differences when a target is out of reach.

Engine estimates include the prepared game, persistent numerical state and engine arena. Process high-water RSS additionally includes the JS heap, compiled code and runtime allocations. The runner records RSS before and after independent evaluation. JS validation has its own timing and can increase peak RSS. Time to target includes preparation, arena setup, CFR and the check that first reaches the target. The raw data record independent evaluation separately. The ordinary comparison runs use a fresh process for each measurement and report medians and min–max variability across three repetitions. Capacity and longer accuracy runs are identified as single measurements.

## Matched Float64 engine comparisons

The v18 native derived layout drops the current-policy bank and reads the same regret-matched distribution from Float64 regrets. It stores legal unlocked rows for each public-card orbit and packs canonical nodes into the native arena. Here are median sizes in MiB. Peak RSS covers preparation and solving, with independent validation measured separately.

| BTN vs BB exact game | v17 numerical state | v18 numerical state | v17 estimated engine | v18 estimated engine | v17 peak RSS | v18 peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| IP-only river betting | 111.7 | 68.4 | 144.8 | 114.0 | 248.4 | 224.8 |
| One IP size per street | 451.3 | 276.7 | 504.8 | 336.5 | 689.2 | 514.2 |
| One IP size per street, c-bet lock | 451.3 | 276.7 | 504.8 | 336.5 | 752.8 | 587.9 |
| Monotone flop, symmetric projected ranges | 130.7 | 54.2 | 184.8 | 92.7 | 416.1 | 310.7 |

One exact bet size per street gave a 33% reduction in estimated engine memory and a 25% reduction in peak solving RSS. With the stored Float64 current policy, compact WASM used 415.0 MiB for numerical state in this case. The 276.7 MiB native-derived figure isolates the saving from removing the current-policy bank in addition to packing legal rows.

| BTN vs BB case and measured work | Engine | Prepare, ms | Arena setup, ms | CFR, ms/iteration | BR, ms/check | Time to target or fixed-work wall time |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Sampled, 0.1% target | v17 WASM | 59 | 24 | 9.82 | 8.15 | 1.02 s |
| Sampled, 0.1% target | v18 compact scalar WASM | 107 | 16 | 14.20 | 9.27 | 1.48 s |
| Sampled, 0.1% target | v18 compact SIMD WASM | 78 | 12 | 13.13 | 8.62 | 1.36 s |
| Sampled, 0.1% target | v18 compact native | 72 | 10 | 8.44 | 5.17 | 0.90 s |
| Exact river betting, 0.1% target | v17 WASM | 730 | 141 | 179.2 | 138.3 | 6.67 s |
| Exact river betting, 0.1% target | v18 compact SIMD WASM | 600 | 124 | 239.8 | 179.6 | 8.56 s |
| Exact river betting, 0.1% target | v18 compact native | 600 | 147 | 159.5 | 100.9 | 5.96 s |
| Exact one size per street, 10 iterations | v17 WASM | 762 | 601 | 807.8 | 568.9 | Fixed work |
| Exact one size per street, 10 iterations | v18 native derived | 758 | 246 | 693.4 | 354.8 | Fixed work |
| Exact one size per street with a lock, 10 iterations | v17 WASM | 890 | 470 | 988.8 | 752.7 | Fixed work |
| Exact one size per street with a lock, 10 iterations | v18 native derived | 895 | 260 | 722.9 | 373.6 | Fixed work |

The 10-iteration exact one-size widths were 8.75% unrestricted and 4.85% locked in both revisions. Sampled and exact river-only target runs reached their stopping widths in 90 and 30 iterations respectively. Both revisions independently evaluated their trained profiles through JavaScript. Compact WASM saved state in the one-size cases but took longer on the measured target runs. The existing dense WASM backend therefore remains the default.

### CPU and memory profile

V8 CPU sampling on a 12-iteration exact BTN–BB game attributed 28.5% of v17 sample time to terminal leaves, 11.1% to reach basis construction and 29.6% to the main training visit function. In source-backed compact SIMD WASM, terminal evaluation accounted for 34.3%, training recursion for 39.2%, and decoding the current or average policy for 12.8%. Decision state remains the largest memory allocation. In the one-size exact case the baseline state alone was 451 MiB of a 505 MiB engine estimate. The compact compiler packs 47,535 nodes for that same 57,042-node game. Phase measurements and sampled CPU breakdowns accompany the raw results.

## Exact-flop capacity

| BTN vs BB exact configuration | Structural nodes | Result |
| --- | ---: | --- |
| IP-only river betting | 14,262 | Converged below 0.1% in both revisions |
| One IP bet size per street | 57,042 | Compact Float64 fits with stored or derived current policy |
| Two IP flop bet sizes, one IP size on each later street, c-bet lock | 85,563 | Prior engine exceeded 512 MiB. Native derived Float64 traversed two iterations at 484 MiB estimated and 713 MiB peak RSS including validation. The interval was 22.76% of the starting pot. |
| Two flop sizes, both players have a turn and river size | 191,844 | Prior and new engines exceeded 512 MiB. All-Float32 state reached 998 MiB before the arena and exceeded the tested 1 GiB total budget. |
| Stretch including a flop raise, all-in branches, and a c-bet lock | 717,828 | Prior tree exceeded its 250,000-node cap. Compact built the tree and counted 131,015,101 free canonical rows. Estimated all-Float32 state with prepared metadata was 3.81 GiB before the arena. The 1.5 GiB solves stopped at the numerical budget. |

The 85,563-node solve uses exact private combinations, the full 49 × 48 public chance tree, and the documented BTN–BB preflop inputs. Its later streets are one-sided and its two iterations are a capacity check. The full stretch benchmark and its 0.1% target remain open.

## High-accuracy solves

These are single isolated runs. The JS column is the time to evaluate the final trained strategy through the independent Float64 reference.

| BTN vs BB configuration | Target width, % pot | Verified width, % pot | Iterations | Training and checks to target | JS validation |
| --- | ---: | ---: | ---: | ---: | ---: |
| Sampled, one IP size per street | 1.0 | 0.632210 | 30 | 0.41 s | 0.21 s |
| Sampled, one IP size per street | 0.5 | 0.348599 | 40 | 0.45 s | 0.20 s |
| Sampled, one IP size per street | 0.1 | 0.085712 | 90 | 1.13 s | 0.28 s |
| Sampled, one IP size per street | 0.05 | 0.046228 | 130 | 1.51 s | 0.20 s |
| Sampled, one IP size per street | 0.01 | 0.009844 | 310 | 3.07 s | 0.22 s |
| Exact, river betting only | 0.01 | 0.009210 | 70 | 14.57 s | 2.27 s |
| Exact, one IP size per street | 0.1 | 0.087282 | 90 | 72.76 s | 7.68 s |
| Exact, one IP size per street with a c-bet lock | 0.1 | 0.090654 | 70 | 53.35 s | 9.15 s |

The last two solves estimated 337 MiB each for the engine. Their solving peak RSS values were 511 and 592 MiB, and independent evaluation raised the process peaks to 627 and 688 MiB. Fold-zero IP values were 386.253–386.733 chips unrestricted and 364.804–365.303 chips with the 25% c-bet lock. These compatible intervals imply an IP EV loss of 20.951–21.929 chips. The loss interval width is about 0.178% of the starting pot because it includes uncertainty from both solves.

## Precision

All rows used the source-backed SIMD WASM engine and were re-evaluated by the independent Float64 JavaScript path. A–D match the storage configurations in the [solver guide](turn-river-solver.md#storage-and-all-in-continuation). The sampled BTN–BB comparisons use 150 fixed iterations. Endpoint differences compare the independently computed constrained bounds with the Float64 run at that same iteration. The raw data also include independent profile EV and unrestricted best-response EV for both players.

| Format | Unlocked state, MiB | Unlocked ms/iteration | Unlocked width, % pot | Locked width, % pot | Largest locked endpoint difference, chips |
| --- | ---: | ---: | ---: | ---: | ---: |
| Float64 | 5.83 | 14.60 | 0.03623 | 0.03139 | Reference |
| A, Float32 regret | 4.86 | 16.59 | 0.03621 | 0.03139 | 0.00000074 |
| B, Float32 regret and average | 3.89 | 14.81 | 0.03621 | 0.03139 | 0.00000075 |
| C, all three Float32 | 2.92 | 14.39 | 0.03620 | 0.03139 | 0.00000088 |
| D, scaled Int16 accumulators | 2.92 | 33.24 | 0.04945 | 0.04009 | 0.0282 |

At 1,800 iterations on the narrow synthetic river, Float64 and A–C produced widths near 0.00133% of the pot. The largest A–C change in an independent bound was 0.00000042 chips. D finished at 0.01921% and missed the 0.01% target. On the sampled locked flop, D moved profile EV by roughly 0.0083 chips and the largest unrestricted best response by 0.0262 chips. With two actions, its per-row scales consumed the same state bytes as C. All lower-precision formats remain opt-in. The experiments cover a long narrow solve and shorter wide solves. Wide exact games at 0.01% and extreme reach ratios over long runs still need validation.

## All-in continuation

The implicit path shares a runout program by public board after both stacks are committed. The optional exact pair representation stores signed win-minus-loss counts in Int16. For a legal deal, dividing by the number of remaining ordered runouts gives the centered showdown expectation. The pair operator keeps the matchup blockers and gives split outcomes zero centered payoff. The sampled setting uses the weighted runout program.

| Synthetic game | Method | Logical nodes | C nodes | Prep, ms | CFR, ms/iteration | Estimated engine, MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Exact turn | Explicit | 537 | 537 | 42 | 2.19 | 1.55 |
| Exact turn | Implicit | 441 | 488 | 41 | 2.07 | 1.54 |
| Exact turn | Pair equity | 441 | 440 | 53 | 1.59 | 1.55 |
| Exact flop | Explicit | 31,124 | 31,124 | 300 | 59.48 | 33.47 |
| Exact flop | Implicit | 21,618 | 23,920 | 251 | 49.77 | 30.86 |
| Exact flop | Pair equity | 21,618 | 21,568 | 453 | 35.51 | 30.72 |

The turn and flop comparisons finished at the same EV interval widths of 0.118% and 12.666% respectively. Regression tests compare explicit, implicit and pair-equity EVs directly, including weighted blockers and exact and sampled chance. A pair matrix trades preparation work for lower per-iteration time in these small ranges. The work budget limits this tradeoff on wide ranges.

## Repeated solving

Three lock mixes and three repetitions per mix and mode hit the same targets in both revisions. The following medians are milliseconds to target per candidate. The one-time preparation and 100-iteration donor training are separately recorded. Values are from the legacy v17 WASM path and the v18 compact native path with a stored Float64 current policy.

| Mode | v17 river | v18 river | v17 turn | v18 turn |
| --- | ---: | ---: | ---: | ---: |
| Cold, fresh preparation | 3.11 | 3.98 | 118.65 | 116.29 |
| Cold, reused preparation and arena | 0.69 | 0.50 | 90.35 | 78.22 |
| Strategy transfer | 0.79 | 0.83 | 111.75 | 99.54 |
| Regret transfer | 0.91 | 0.65 | 92.23 | 74.01 |
| Combined transfer | 0.49 | 0.61 | 119.45 | 103.12 |

The turn regret-transfer case reached the target in about 74 ms after preparation and donor training, or 13.5 candidate solves per second at the median latency. Combined transfer used 50 median iterations on the turn, while cold and regret transfer used 40. The execution mode and one-time donor cost matter when sizing a research batch.

### Candidate selection and parallel throughput

The candidate benchmark uses two independently sampled BTN–BB one-size games, seeds 29 and 103. Each game compares four whole-node c-bet frequencies. Both methods use the same maximum of 170 iterations per candidate and the same target width of 0.1% of the pot. Staging uses allowances of 25, 42 and 103 iterations, adaptive checks and compatible EV bounds. The fixed method evaluates every candidate to its stopping condition.

| Scheduling | Workers | Median wall time | Min–max | Candidate iterations | Eliminated |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fixed | 1 | 10.71 s | 7.34–12.00 s | 670 | 0 |
| Staged | 1 | 4.91 s | 4.57–5.10 s | 324 | 6 |
| Fixed | 2 | 4.54 s | 3.80–9.19 s | 670 | 0 |
| Staged | 2 | 2.62 s | 2.61–7.17 s | 324 | 6 |

Both methods identified the same highest-value candidate independently in each sampled game. Candidate iterations include resumed work and exclude the unrestricted baselines. Wall time includes preparation, baseline solves, checkpoint I/O, checks and worker startup. Bounds apply separately within each sampled game.

## Algorithm and sampling investigation

DCFR remains the reference. Its positive and negative regret discounts and its strategy averaging schedule are applied to exhaustive chance traversals in the exact game. The compact backend also runs the existing CFR+, discounted variants and predictive options. Published PCFR+ couples predictive regret matching with Blackwell approachability. Published DDCFR uses a learned discount policy. The similarly named existing PokerTools heuristic schedules and predictive variant have their own update rules. Direct implementations of the published algorithms would require separate parity and convergence measurements. [Discounted regret minimization](https://arxiv.org/abs/1809.04040) · [Predictive Blackwell approachability](https://ojs.aaai.org/index.php/AAAI/article/view/16676) · [Dynamic Discounted CFR](https://proceedings.iclr.cc/paper_files/paper/2024/hash/a89331e2ecbbd9d9618bc94717a91155-Abstract-Conference.html) · [Hyperparameter schedules](https://ojs.aaai.org/index.php/AAAI/article/view/38784)

Fixed sampled chance trees are useful for screening. A fresh public sample can also estimate the EV of a fixed full-game strategy if every relevant outcome has nonzero inclusion probability and the evaluation weights account for the sampling design. A stochastic CFR update is a separate operation. For a public sequence drawn with probability `q`, the sampled counterfactual contribution must use its exact chance weight divided by `q`, with blocked private deals contributing zero. A correct implementation also needs a realization-weighted average and a schedule for discounted regrets at unvisited information sets. Full-game exact best responses are the final test of a learned stochastic policy. Taking the maximum over noisy action estimates can bias a best-response estimate. Common random draws reduce noise in comparisons when samples are shared by the corresponding strategies. [MCCFR](https://proceedings.neurips.cc/paper/2009/hash/00411460f7c92d2124a67ea0f4cb5f85-Abstract.html) · [Public chance sampling](https://johanson.ca/publications/poker/2012-aamas-pcs/2012-aamas-pcs.html)

A practical next sampling experiment would draw suit-orbit representatives, weight each member by its actual inclusion probability, and keep the exact-tree row map for every public outcome. This makes exact evaluation possible even for rare runouts. Stratification by public texture can reduce variance with positive probability for every stratum. External sampling also changes the opponent-action estimator, which must account for hand-specific opponent policies in the vectorized engine. Training currently enumerates the configured chance tree.

## Remaining bottlenecks in priority order

1. **Persistent state across betting histories.** The stretch game requires more than 131 million canonical private-hand rows. Some histories share the same pot and remaining stacks while retaining separate reach and strategy. The next design work should test segmented arenas and representations that preserve independent regrets. Validate exact fallback cases before expanding the full tree.
2. **Repeated terminal and traversal work.** Profile and best responses continue to walk the actual chance tree. Candidate changes near the flop root can alter reach throughout the tree. Investigate sharing immutable payoff metadata across engines, lazily building physical board metadata, and reusing payoff bases only for identical opponent reach and public cards. A reach-dependent cache must include the generation of a reused scratch vector.
3. **Within-game parallelism.** The existing worker scheduler parallelizes independent games. Within one alternating update, canonical chance subtrees can own disjoint descendant state. Dealt branches must join in a deterministic order before updating ancestor regrets and changing the other player's policy. Sharing a representative with multiple workers would require one writer or an explicit deterministic aggregation rule. Compare a bounded worker pool with independent-game throughput before adding a threaded kernel.
4. **Learning and candidate accuracy.** Fixed samples and early EV bounds screen candidates within compatible games. Measure revised discount schedules and stochastic updates against the exact Float64 evaluator at the same EV width, including rare or previously unreachable continuations. Cross-seed and cross-fidelity evidence serves screening. Full-game ranking needs comparable exact bounds.

## Reproduce

The measurement host ran Debian 13 on Linux x86-64 with an Intel Xeon Platinum 8573C, three visible CPUs, a two-CPU quota and an 8 GiB cgroup memory limit. Node.js was 24.22.3. Clang and LLD 19.1.7 built the WASM assets. GCC 14.2.0 built the native addon. The benchmark uses exact Float64 arithmetic for payoffs and evaluations, disables floating-point contraction and keeps ordinary compiler rounding. A hardware counter probe returned `EPERM` on this host, so the measurements use process RSS, wall clock, V8 sampling and compiler output. The data include sampled raw values and min–max variability.

Use a history-bearing checkout for the archived range source.

```sh
git worktree add --detach /tmp/pokertools-v17 4f68dcc
scripts/build-turn-river-wasm.sh
CHECK=1 scripts/build-turn-river-wasm.sh
NODE_INCLUDE=/path/to/node/include/node scripts/build-turn-river-native.sh
node scripts/benchmark-turn-river-v18.mjs --group engine \
  --baseline-source /tmp/pokertools-v17/public/turn-river-lab --revision 23be02c
node scripts/benchmark-turn-river-v18.mjs --group precision --revision 23be02c
node scripts/benchmark-turn-river-v18.mjs --group equity --revision 23be02c
node scripts/benchmark-turn-river-v18.mjs --group accuracy --repetitions 1 \
  --baseline-source /tmp/pokertools-v17/public/turn-river-lab --revision 23be02c
node scripts/benchmark-turn-river-v18.mjs --group capacity --repetitions 1 \
  --baseline-source /tmp/pokertools-v17/public/turn-river-lab --revision 23be02c
node scripts/benchmark-turn-river-candidates.mjs --backend native --repetitions 3
```

Use `--case` and `--mode` to select an isolated matrix entry. The targeted input below computes the compact Float32 state estimate without allocating the mutable strategy arena. For the same estimate with Float64 derived current, replace `--precision f32` with `--current-policy derived`.

```sh
node scripts/benchmark-turn-river.mjs --suite realistic --case btn-bb-exact-stretch \
  --storage compact --precision f32 --prepare-only --max-nodes 1000000 \
  --memory-mib 16384 --repetitions 1
node scripts/benchmark-turn-river.mjs --suite repeated --repetitions 3 \
  --source /tmp/pokertools-v17/public/turn-river-lab --revision 4f68dcc
node scripts/benchmark-turn-river.mjs --suite repeated --repetitions 3 \
  --storage compact --backend native --revision 23be02c
```
