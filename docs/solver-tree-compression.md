# Structural game tree and all-in evaluation

The solver keeps its original preorder decision IDs, action labels, deal order and checkpoint fingerprint. Tree layout and numerical storage are independent. Dense Float64 and compact Float64 retain their existing strategy state layouts. Auto still prefers dense when it fits the memory budget.

## Physical storage and logical navigation

- The packed tree uses an Int32 record for each materialized node's parent, label index and terminal descriptor index. Terminal records with the same cards, winner and contributions are shared. Betting sizes, contributions and action descriptions are shared where they are identical. Each strategic decision keeps its own history, children and strategy state.
- A forced check keeps its logical node, but stores the single child inline. The solver forwards reach and counterfactual values directly. Browser navigation and reports reconstruct the check action as needed. Dense checkpoints keep their legacy one-action numerical rows.
- An ordinary chance node keeps typed child offsets and shares the board's selected cards and chance weights. Five-card rank programs and legal-hand masks are shared for swapped turn and river cards. Played observations, betting history and the conditional chance schedules retain their order.
- After both players go all-in, the tree reserves the same logical IDs in a contiguous span. The turn and river paths, weights, boards and final pot can be reconstructed from that span. The numerical tree never builds those runout histories. Strategy browser breadcrumbs use the stored parent links. Opening an individual runout reconstructs just the requested presentation view.
- The native bridge remaps logical IDs to compact physical indices. It shares identical terminal records and chance-only continuations. The existing full Float64 WASM kernel evaluates those shared continuations as explicit deals. The JavaScript solver and the compact Float64 WASM backend, which uses JavaScript traversal, can instead call the all-in operator. Native policy updates and selected-node evaluation receive the same physical mapping.
- The **Max tree records** setting covers distinct terminal records and materialized decisions and chance nodes. The budget excludes typed links for deduplicated terminals and logical nodes in an all-in span. There is also a two-million logical node ceiling. A solution or checkpoint from the previous layout can still address its original nodes.

## All-in operators

Once both players have committed their stacks, the centered payoff for a compatible pair on one board is `pot / 2 + stack` for a win, its negative for a loss and zero for a tie. A tie splits the actual pot. The operator multiplies by opponent reach, so the result supports weighted ranges and the conditional range arriving at that decision.

The complete flop chance structure deals 49 possible turns and then 48 possible rivers. Given both players' private cards, deal weights are `1/45` and `1/44`. Sampled schedules retain the original inverse-inclusion weights and seed. Both private hands must be compatible with each other and the runout. Every compatible pair keeps the original sampled-deal weights after removing illegal deals. Exact flop all-ins can combine the two orders of a final board. A sampled schedule counts each order only if it occurs in that schedule.

Available exact representations for JavaScript traversal are:

- **Signed counts.** A lazily built Int16 matrix stores wins minus losses. A full ordered flop schedule has at most 2,352 terms, which fit without rounding. Multiply by the original chance weight and payoff in Float64. One matrix supports both players through transposition and sign reversal.
- **Float64 pairwise equity.** The same precomputation with the payoff and chance scale already applied, using four times the matrix memory.
- **Cached board rank programs.** Apply the existing linear rank and blocker kernel to each distinct board with reusable Float64 scratch. Reuse an evaluated result only for the same live opponent reach in a single traversal. This avoids a matrix and has lower cold cost for broad ranges. River showdowns already use the one-board rank program.
- **On-demand pairs.** Compute the signed outcomes directly for each compatible pair as a comparison mode. Full pairwise re-evaluation is expensive for broad ranges.

Auto chooses counts for up to two million pair/runout combinations per plan. It caps optional matrices at 16 MiB per game and rechecks the live memory budget before allocating. It uses board programs for broader ranges and when the budget has no room. Dense WASM uses board programs and chance records. All weights, expected payoffs, strategy values and accumulators are evaluated in Float64. Addition order can produce normal Float64 rounding differences.

## Reproducing the benchmarks

Run the harness from the repository root with Node 24 and `--expose-gc`. The capacity run uses a rainbow flop, effective stack 85 into a 100-chip pot, and realistic weighted ranges with 249 OOP and 279 IP physical combinations. Jam branches are available throughout. All accepted games use the full 49 × 48 ordered chance structure, no sampled runouts, the dense native Float64 backend and DCFR. Both layouts use a 1 GiB engine budget and a 100,000 record limit. The convergence target is two chips per player on the 100-chip pot.

```sh
baseline=$(mktemp -d)
for file in core.js compiled-traversal.js wasm-kernel-data.js; do
  git show "3d50e47:public/turn-river-lab/$file" > "$baseline/$file"
done
for fixture in jam one-size multi-size turn-pressure full-multisize; do
  SOLVER_BASELINE_DIRECTORY="$baseline" node --expose-gc scripts/solver/tree-benchmark.mjs capacity "$fixture" explicit wasm
  node --expose-gc scripts/solver/tree-benchmark.mjs capacity "$fixture" packed wasm
done

SOLVER_BASELINE_DIRECTORY="$baseline" node --expose-gc scripts/solver/tree-benchmark.mjs kernels wide explicit javascript auto
for operator in counts float64 boards ondemand; do
  node --expose-gc scripts/solver/tree-benchmark.mjs kernels wide packed javascript "$operator"
done
```

Capacity runs report construction time, elapsed solving time including periodic convergence checks, and memory after building and before solving. Engine MiB accounts for numerical state, programs, typed links and WASM. The benchmark also reports V8 heap, external allocations and RSS deltas. Browser working sets depend on devices, allocator behavior and whether the user requests a full report.

### Exact flop capacity

These are single runs on Node 24.22.1 on an AMD EPYC 9V74. Setup and solve times are wall-clock seconds. RSS is the increase since process warm-up. A slash gives the explicit baseline and packed values in that order.

| Betting configuration | Logical nodes | Packed records | Native rows, before / after | Engine MiB, before / after | RSS MiB, before / after | Setup s, before / after | Solve s, before / after | Iterations to target |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Check and jam on every street | 31,124 | 19,266 | 31,124 / 19,216 | 159.72 / 140.29 | 363 / 303 | 4.01 / 1.91 | 7.42 / 6.17 | 18 |
| Add one 33% OOP flop size | 59,844 | 36,177 | 59,844 / 36,028 | 280.79 / 259.37 | 646 / 530 | 3.26 / 1.72 | 9.10 / 8.79 | 16 |
| OOP 33% and 65%, IP 50% on flop, one raise allowed | 117,284 | 69,999 | over cap / 69,652 | — / 497.52 | — / 968 | — / 2.38 | — / 16.03 | 16 |
| Same flop plus 50% OOP turn bet | 141,098 | 79,652 | over cap / 79,256 | — / 615.59 | — / 1,182 | — / 2.12 | — / 22.18 | 18 |
| Deeper stack, several turn sizes and 50% river bets | — | over cap | over cap in both layouts | — | — | — | — | — |

The two common trees matched at the reported precision. The check-and-jam tree finished at 1.5468 chips of exploitability and 51.3447 chips of OOP EV. The one-size tree finished at 1.8865 and 51.8878 chips. The packed-only multi-size and turn-pressure trees finished at gaps of 1.9030 and 1.7474 chips respectively.

### Broad-range JavaScript flop all-in

The table isolates one flop all-in evaluation against the same opponent weights. The first call includes lazy initialization. Subsequent time averages 60 calls, with three calls for on-demand pairs.

| Operator | Matrix KiB for this flop | First call, ms | Subsequent call, ms |
| --- | ---: | ---: | ---: |
| Original explicit traversal | 0 | 84.31 | 42.82 |
| Float64 pairwise | 542.74 | 652.51 | 0.22 |
| Int16 signed counts | 135.69 | 696.01 | 0.27 |
| Cached board rank programs | 0 | 26.93 | 12.74 |
| On-demand pairs | 0 | 657.09 | 671.45 |

For the same broad ranges on the turn, the signed-count matrix used about 128 KiB, took 61 ms for the first call, and averaged 0.23 ms subsequently. Cached board programs took about 5 ms for the first call and 0.74 ms subsequently. An exact 12 × 12 flop all-in used a 0.28 KiB count matrix. Subsequent evaluations were about 0.01 ms with signed counts and roughly 1 ms with board programs. These measurements favor precomputation on smaller ranges and board programs as the default when large matrices have uncertain reuse. The benchmark harness exposes all five paths for comparisons.

## Remaining limits

- Deep stacks with multiple later-street sizes and repeated raises still create many genuinely distinct decisions. All of their legal actions remain in the tree. The deepest multi-street benchmark still exceeds the 100,000-record cap. A materialized decision carries one metadata object even when an exact symmetry shares its numerical policy.
- The native WASM ABI still walks chance on all-ins. Its savings come from interning identical terminal and chance-only records and sharing board programs. Dedicated pairwise or board operator instructions would require a new native kernel.
- Full-report generation, saved solution JSON and checkpoint signatures still observe the complete logical tree. Full strategy exports can be much larger than an interactive solve. The preview and selected-node report avoid that expansion.
- An exact run resolves the configured game, including the chosen bet and raise sizes. Convergence time still grows with the number of decisions and range width. These are desktop measurements, so the larger cases require a suitable memory budget.
