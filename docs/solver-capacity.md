# Exact flop tree capacity

## What the solver allocates

The packed builder plans the tree before allocating node records, payoff programs, or a numerical arena. It builds a graph of shared immutable betting templates keyed by street, player, contributions, current raise state, and aggressors. Templates specify legal actions and preorder offsets. Each betting history retains its own ID and each canonical information set has independent strategy state.

- **Logical nodes** include all ordered public outcomes and every all-in continuation. The preorder and card order match the original solver. Node IDs have a signed 32-bit address bound.
- **Materialized tree records** count stored decisions, chance nodes and distinct terminal payoffs. The record budget is configurable up to 1,000,000. Several physical links can point to the same immutable terminal payoff. The planner also counts those links so they are included in the memory estimate.
- **Canonical decisions** are the stored decisions after public suit compression. Dense and compact numerical layouts retain their existing Float64 and mixed-precision options. In Auto, the planner tries dense first and tests compact if a resource limit is reached.
- **Strategy storage** estimates regret, averaging, current policy, and other configured numerical planes. Compact estimates account for forced decisions, deal support and private suit orbits. The preview allows for additional state and metadata at locks, so a locked game can allocate slightly less than its estimate.
- **WASM memory** includes the state, native tree metadata, payoff programs, scratch and alignment. The kernels use signed 32-bit byte offsets, so a linear arena can use at most 2,047.94 MiB.
- **Peak preparation memory** includes live JavaScript structures, private and payoff metadata, arena initialization and transfer, and an allowance for transient allocations and heap growth. A physical RSS measurement also depends on garbage collection, page commitment and other browser activity.

The browser offers a 2–8,192 MiB preparation setting with a 128 MiB default. If the browser exposes installed RAM, the solver uses at most half of the reported RAM for preparation, with a 128 MiB minimum for that device estimate. It separately reserves headroom below the browser's reported JavaScript heap limit when available. The preview names the first resource that exceeds its limit and shows required and available capacity. The configured ranges, sizes, raises and runout schedules carry through unchanged.

## Exact public chance compression

Before allocating physical branches, the builder computes exact suit automorphisms of the board and both weighted private ranges. The complete conditional chance schedule must be preserved, including each sampled river table in fixed sampled mode. A lock can preserve a suit permutation only if the permuted betting history has a matching lock and every affected combo has the same action mix. The builder recomputes the allowed transforms after lock edits.

The canonical branch is the first card in each orbit. At a river step the builder uses the stabilizer of the turn. Each alias reserves its original logical subtree span. A request for an aliased decision recomputes its offsets from the template and applies the exact range-index permutation. An aliased turn can reference a further aliased river. The solver expands the representative's counterfactual values by orbit member with the original conditional chance weights and blocker masks. Wide ranges, different suit weights, or asymmetric restrictions can leave fewer or no usable orbits.

The numerical tree uses sparse logical-to-physical addressing, flat typed parent and terminal links, shared action descriptors and a stride with a shared card table at each ordinary chance node. The native bridge writes flat node and strategy tables directly into its linear arena. It uses dense physical indices independent of logical IDs. Showdown preparation ranks only hands in the two input ranges. The browser preview materializes the starting street and reconstructs subsequent paths on demand. The solving worker owns the live numerical state.

Checkpoints retain their original format and fingerprint. A full report or JSON solution includes physical decisions and can be substantially larger than the solver state. The worker checks its estimated size before expansion. Individual decision reports and checkpoints remain available within the solver budget.

## Reproduce the measurements

Run the harness from the repository root with Node 24 and `--expose-gc`. It loads the same source-backed SIMD128 WebAssembly module as the browser. The baseline is production commit `d0af572`. The weighted BTN/BB fixture approximates a 2.5bb button open and big-blind call at 100bb effective, with 5.5bb in the pot and 97.5bb behind. The default board is `As 8s 3s` with 720 BB and 535 BTN legal combinations. Weights are equal across suits within a hand class. The narrow fixtures retain 15 BB and 22 BTN combinations to isolate structural capacity. Every case uses all 49 × 48 ordered public runouts, Float64 storage, DCFR, and the same betting structure on both builds.

```sh
baseline_dir=$(mktemp -d)
for file in core.js compiled-traversal.js wasm-kernel-data.js source-kernel-data.js; do
  git show "d0af572:public/turn-river-lab/$file" > "$baseline_dir/$file"
done
for mode in solve locked; do
  SOLVER_BASELINE_DIRECTORY="$baseline_dir" SOLVER_CAPACITY_TARGET=12 SOLVER_CAPACITY_STEPS=64 \
    node --expose-gc scripts/solver/capacity-benchmark.mjs two-size "$mode" wide
  SOLVER_CAPACITY_TARGET=12 SOLVER_CAPACITY_STEPS=64 \
    node --expose-gc scripts/solver/capacity-benchmark.mjs two-size "$mode" wide
done
SOLVER_CAPACITY_STEPS=4 node --expose-gc scripts/solver/capacity-benchmark.mjs flop-raise solve wide
SOLVER_CAPACITY_STEPS=4 node --expose-gc scripts/solver/capacity-benchmark.mjs flop-raise locked wide
node --expose-gc scripts/solver/capacity-benchmark.mjs raises plan wide

SOLVER_CAPACITY_RECORDS=250000 SOLVER_CAPACITY_STEPS=4 \
  node --expose-gc scripts/solver/capacity-benchmark.mjs raises solve narrow
SOLVER_CAPACITY_BOARD='As 8s 3h' SOLVER_CAPACITY_RECORDS=500000 SOLVER_CAPACITY_STEPS=4 \
  node --expose-gc scripts/solver/capacity-benchmark.mjs raises solve narrow
SOLVER_CAPACITY_STEPS=4 node --expose-gc scripts/solver/capacity-benchmark.mjs deep-raises solve narrow
SOLVER_CAPACITY_BOARD='As 8s 3h' SOLVER_CAPACITY_STEPS=4 \
  node --expose-gc scripts/solver/capacity-benchmark.mjs near-million solve narrow
```

The harness supports `plan` for estimate-only runs and `prepare` for allocation without iterations. Set `SOLVER_CAPACITY_MIB` to choose a budget. Prepare time includes JavaScript preparation and WASM initialization. Preparation RSS is the rise in the process's peak RSS over the starting RSS. Convergence timings include periodic exact best responses. Compare fixed-iteration results only at the same board, ranges, lock and iteration count.

## Before and after on identical games

The two-size case offers BTN 33% and 75% flop bets, a 75% river bet and all-ins. The locked case fixes BTN to 50% check, 25% bet 33%, and 25% bet 75% at the first decision after BB checks. Both builds reached the same 66-chip-per-player stopping target, 12% of the 550-chip pot. The target is for timing the two builds at a common threshold.

| Two-size game | Tree records, before / after | Peak preparation RSS, MiB | Prepare, s | Solve and check, s | Iterations | Observed OOP EV | Exact OOP EV bounds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Unrestricted | 71,898 / 20,886 | 634 / 467 | 2.95 / 0.97 | 16.41 / 16.59 | 24 | 173.746449 | [128.099825, 246.918497] |
| BTN c-bet locked | 71,898 / 20,886 | 632 / 461 | 1.82 / 1.28 | 17.05 / 17.04 | 22 | 188.559734 | [137.228795, 265.551595] |

The logical tree contains 104,924 nodes in both builds. Native records went from 71,652 to 22,473. The final constrained gap was 64.161400 chips per player and the unrestricted gap on the locked policy was 659.749829 in both builds. Training time was similar because both engines already solved the same canonical information sets. The savings primarily came from earlier compression and less temporary preparation work.

## Larger weighted games

The production baseline exceeded its 100,000-record limit for the multi-street and flop-raise cases. The new solver prepared and trained both games. The flop-raise fixture includes two sizes on each street, a 75% flop raise, and all-ins. It also ran with the BTN lock above.

| Game | Logical nodes | Records | Float64 state, MiB | Peak preparation RSS, MiB | Prepare, s | Training and checks |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Multi-street | 232,373 | 52,143 | 520 | 1,009 | 2.57 | 12 iterations in 16.80 s |
| Flop raise, unrestricted | 788,584 | 170,517 | 1,782 | 2,983 | 4.15 | 4 iterations in 18.47 s |
| Flop raise, BTN c-bet locked | 788,584 | 170,517 | 1,782 | 2,977 | 4.04 | 4 iterations in 20.01 s |

These are throughput runs. The three cases finished with exact gaps of 140.63, 1,070.17, and 787.05 chips per player, respectively, at the stated iteration counts. The larger `raises` fixture also offers fixed raises on turn and river. Its 231,888-record plan requires an estimated 2,740 MiB WASM arena with these weighted ranges. Preflight rejected it at the signed-offset limit. The heavier multi-size fixture reached the strategy storage limit first.

## Record and indexing stress tests

These are the same 100bb stack and exact chance model with narrow ranges. Each completed four Float64 SIMD128 iterations and exact best-response checks. Baseline preparation encountered the 100,000-record ceiling. The two-tone board retains fewer suit orbits than the monotone board.

| Record limit | Case | Records | Physical links | Logical nodes | WASM arena, MiB | Estimated peak / measured preparation RSS, MiB | Prepare / train and check, s |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 250,000 | Raises, monotone | 231,888 | 318,963 | 1,163,875 | 133 | 633 / 586 | 3.09 / 0.88 |
| 500,000 | Raises, two-tone | 489,210 | 673,551 | 1,163,875 | 318 | 1,213 / 1,109 | 4.19 / 1.87 |
| 1,000,000 | Two raises, monotone | 714,216 | 1,103,016 | 3,969,921 | 434 | 1,674 / 1,515 | 6.73 / 4.41 |
| 1,000,000 | Near-million, two-tone | 980,437 | 1,304,820 | 2,214,337 | 625 | 2,182 / 1,957 | 7.94 / 3.51 |

The narrow cases verified tree addressing, allocation, traversal, and evaluation at these sizes. The measurements are single runs in Node 24.22.1 with the same browser code and a two-core CPU quota. Timings and RSS vary across browsers and hardware.
