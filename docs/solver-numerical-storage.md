# Solver numerical storage

## Layout selection

Solver Setup → Advanced → Runouts & optimizations has Auto, Dense, and Compact. All three use Float64. Dense retains the previous arena and full-tree WASM backend. Auto uses Dense when its strategy state and payoff data fit the configured memory limit, and Compact when they exceed it. Select Compact directly to prioritize lower memory use. The completion log reports the layout actually used.

The dense-size estimate is for the tree available to the planner. Full payoff and fixed WASM arena costs are evaluated separately. A worker may use JavaScript when the optional WASM arena does not fit. The accounting measures selected long-lived arrays and the reserved WASM linear memory. JavaScript object overhead, exported reports, and runtime RSS are separate.

## Numerical rows and the physical game

* A player's global combo ID maps to a range index through the existing `player.index`. `player.ids` maps back. The initial range already filters starting-board blockers and zero input weights.
* For each public board, the planner shares exact support across betting histories. A hand qualifies if it survives the public cards and there is at least one disjoint, positive-input-weight opponent combo on that board. Integer card incidence counts plus inclusion–exclusion establish this exactly.
* Each canonical decision maps physical range indices through an Int16 row map, with -1 for an implicit or fixed policy. A reverse Uint16 table gives the representative range index of each allocated row. The ordinal times the decision's action count is the offset in each Float64 plane. Decisions with identical board, player, and unrestricted rows share the mapping.
* Only learnable representatives receive regret, average, current-policy, and algorithm-specific planes. Forced decisions share a probability-one row. Whole-node locks store one mix, and partial locks store a sparse table of fixed mixes. Fixed mixes bypass ordinary regret and averaging. Unavailable free rows reconstruct the deterministic default policy for the decision.
* Current reach never determines whether a row exists. The solver keeps hands behind zero-probability actions, including actions suppressed by prior locks, because an unrestricted best response can still analyze those paths.
* Training and evaluation still use the physical opponent reach, card blockers, and exact payoff aggregation. Convergence checks use compact average planes directly. Reports map physical hands back through the saved suit permutations and emit the original combo IDs and action arrays. A full export still has one physical record per combo and decision.

## Suit symmetry and locks

Compact first checks suit permutations against both weighted ranges. The flop is an unordered public set, so permutations can swap suits of equal-rank flop cards. Starting and dealt turn and river cards are fixed individually by the local stabilizer. On sampled flop solves, the permutation must preserve the actual seeded turn set and every conditional river set. Chance branches are grouped only under that verified group.

For each candidate permutation, a locked betting history must map to a locked physical history with the same locked hand masks and identical action probabilities. A whole-node lock on an invariant history can keep the group. An unmatched lock or a differently weighted combo removes the offending permutations. Node locks are validated before compact offsets are assigned. Changing locks rebuilds the game and recomputes its symmetry group and offsets.

Public orbits share a canonical subtree. Private orbits share numerical rows under the stabilizer of the node's public history. Permutation arrays are reused by every node that uses the same transform, and inverse arrays are reused during reporting. Nested chance aliases are followed back to their numerical source. The structural tree and physical showdown programs remain available for exact navigation and reporting. Sharing the showdown tables themselves would require a suit-aware payoff evaluator and is outside this storage change.

## Solver backends and session state

* Dense keeps the legacy full-tree Float64 WASM backend and the JavaScript reference backend.
* Compact supports the JavaScript reference path and a Float64 WASM decision kernel for CFR+ and the supported DCFR variants. Chance, terminal evaluation, averaging, and policy refresh use JavaScript in Compact, and locked or culled decisions use the exact JavaScript row update. Compact QRE and variants with predictive corrections use JavaScript. The legacy native regret-pruning optimization is available through Dense. The compact kernel uses the same ordered f64 operations as the reference row update.
* Checkpoints record the actual arena layout and hash the compact mappings, full betting tree, ranges, algorithm, and locks. The old binary container still reads legacy dense checkpoints. Resume preserves iteration, regrets, averages, policy, and history. A checkpoint with an incompatible layout or lock revision is rejected.
* `CFRSolver.warmStart(freshGame, previousSolver)` seeds a new solve on the same physical game and ranges, including a different layout or lock revision. It imports the previous average policy through physical combo mappings, projects to the destination restrictions, and starts with fresh iteration counts and averages. Use checkpoint resume for exact continuation. The browser rebuilds on lock edits and supports exact checkpoint continuation.

To regenerate the 358-byte compact kernel embedded in `compiled-traversal.js`:

```sh
npx --yes --package=wabt@1.0.39 wat2wasm scripts/solver/compact-f64.wat -o /tmp/pokertools-compact-f64.wasm
node scripts/solver/embed-compact-wasm.mjs /tmp/pokertools-compact-f64.wasm
```

## Dense and compact measurements

Run `SOLVER_BENCH_TRIALS=3 node --expose-gc scripts/solver/benchmark.mjs`. Measurements below are medians of three sequential alternating trials on Node 24.22.1 and an AMD EPYC 9V74. Both cases use the same 1,737-node paired turn tree and weighted ranges with 450 OOP and 452 IP combos. The locked case fixes the root at 50/50. The exact stopping target is 0.50 chips per player, checked every five iterations starting with a minimum of 20 iterations. Solve time includes the exact checks and excludes build time.

| Case | Backend | Arena MiB, dense → compact | Accounted MiB, dense → compact | Build ms, dense → compact | Solve ms, dense → compact |
| --- | --- | ---: | ---: | ---: | ---: |
| Paired turn | JS → JS | 16.437 → 8.978 | 16.791 → 9.443 | 79 → 66 | 3,114 → 2,292 |
| Paired turn | Full WASM → compact WASM | 16.437 → 8.978 | 20.417 → 11.652 | 66 → 60 | 622 → 1,965 |
| Locked paired turn | JS → JS | 16.437 → 8.965 | 16.798 → 9.430 | 55 → 56 | 3,855 → 3,441 |
| Locked paired turn | Full WASM → compact WASM | 16.437 → 8.965 | 20.424 → 11.652 | 75 → 77 | 886 → 2,907 |

The paired turn reached the target at 40 iterations with OOP EV 46.632256595745 and gap 0.455218087624. The locked turn reached the target at 30 iterations with OOP EV 44.732524377865, constrained gap 0.380776809172, and unrestricted gap 4.801308948297. Across these trials the dense and compact EVs and gaps agreed within 1e-12 chips. Compact removed 180 aliased decisions in each case, along with 10,344 unavailable rows and 56,622 private-orbit duplicates on the unlocked canonical tree. Both cases selected Dense in Auto with the default budget and Compact at a 12 MiB cap.

The JavaScript measurements show when reducing the working set also reduces solve time. The native measurements show the cost of running traversal and exact checks in JavaScript with the compact kernel. At the measured target, dense native is about three times faster when its memory fits. Compact native cuts accounted capacity by about 43% in these cases.
