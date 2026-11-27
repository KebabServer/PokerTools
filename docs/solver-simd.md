# Browser solver SIMD128

PokerTools builds its standard DCFR traversal from [C source](../scripts/solver/wasm/traversal.c) for two WebAssembly targets. The worker tries SIMD128 first and uses the scalar build when SIMD validation fails. Both targets use identical game rules and state formats. The **Diagnostics** section and completed solve log name the backend that actually ran.

The imported TurnRiverLab Pages release supplied four full-traversal binaries and their JavaScript ABI. The original C source was absent from the repository, its Git history, and the release archive. The source-backed kernel reuses that ABI, the packed tree, and the Node.js and browser entry points. The supplied kernels and Float64 JavaScript reference remain available for compatibility.

## Findings and changes

A V8 sampling profile of the previous engine put showdown evaluation and blocker mass at approximately half of the sampled and fully enumerated flop work. Traversal, including the inlined regret updates, averaging, action aggregation, and reach propagation, accounted for most of the remainder. In the locked sampled flop, the JavaScript half of the exact convergence check was substantial. Per-phase counters and the optional sampling profile can be reproduced with the benchmark command below.

- The C showdown kernel walks the same exact rank groups and removes both private-hand blockers. It reuses card-incidence masses for the same opponent reach across hero actions. Root reach is already filtered by the starting board, and chance updates maintain that invariant, so the root traversal avoids repeating that validity test inside the mass loop. Direct subtree evaluation still honors its board masks.
- The dense two-action kernel packs two physical hands into Float64 lanes. It calculates action values, updates and matches regrets, and accumulates the old strategy with the correct realization weight. General rows use the same scalar reduction order with Float64 lane arithmetic. Clang also auto-vectorizes output clearing, contiguous CFV additions, binary best-action selection, and initial own reach. The explicit operations cover strided policy rows, deal blockers, and regret updates.
- Compact still reads the existing representative row and exact suit maps. All orbit members see the same strategy before the representative is updated. All four mixed modes keep their existing rounding and scaling on store. Float32 vector conversion instructions move persistent regret values in and out of Float64 lanes. Chance, counterfactual values, payoff math and best responses stay in Float64.
- On supported games, a single native arena holds state, layout metadata, and reusable traversal scratch. Fixed root priors are copied once. Iterations can discard their CFV output inside WASM, and profile and best-response calls can reduce that output directly from WASM memory. Strategy updates and averaging share row loads.
- Native evaluation handles both full and combo locks. Constrained best responses respect the player's fixed mixes. Unrestricted best responses may deviate from them, and the opponent still plays the fixed mixes. The bridge reuses a player's constrained result when that player has no locks.

## Reproducible builds and benchmark commands

```sh
# Requires Clang 19 with the wasm32 target and LLD, then Node 24.
node scripts/solver/build-wasm.mjs
node scripts/solver/build-wasm.mjs --check

# Keep the previous release in a temporary directory for the comparison.
baseline=$(mktemp -d)
for file in core.js compiled-traversal.js wasm-kernel-data.js; do
  git show "ce1c7cb:public/turn-river-lab/$file" > "$baseline/$file"
done
for fixture in river locked-river turn locked-turn sampled-flop locked-sampled-flop exact-flop locked-exact-flop; do
  SOLVER_BASELINE_DIRECTORY="$baseline" node --expose-gc scripts/solver/simd-benchmark.mjs \
    "$fixture" dense float64 original,scalar,simd
done
SOLVER_BASELINE_DIRECTORY="$baseline" SOLVER_SIMD_REBUILDS=3 \
  node --expose-gc scripts/solver/simd-benchmark.mjs locked-turn dense float64 original,scalar,simd
SOLVER_BASELINE_DIRECTORY="$baseline" SOLVER_BENCH_TRIALS=1 SOLVER_SIMD_PROFILE=1 \
  node scripts/solver/simd-benchmark.mjs exact-flop dense float64 original
node --expose-gc scripts/solver/simd-benchmark.mjs sampled-flop compact f32-all legacy,scalar,simd

# Build the compiler-only SIMD experiment outside the shipped assets.
SOLVER_WASM_OUTPUT=/tmp/pokertools-autovec.js node scripts/solver/build-wasm.mjs --autovector-only
SOLVER_WASM_OUTPUT=/tmp/pokertools-autovec.js \
  node --expose-gc scripts/solver/simd-benchmark.mjs sampled-flop dense float64 simd
```

The build generates the checked-in browser asset with `-fno-fast-math -ffp-contract=off`. Its scalar module is 14,967 bytes and passes validation with SIMD disabled. Its SIMD module is 17,460 bytes. The regular GitHub Pages build uses the generated asset without requiring a C compiler. Set `SOLVER_CLANG` to select another installation of Clang 19.

## Performance at a fixed target

Medians of three trials on Node 24.22.1 and AMD EPYC 9V74. The scripts reuse the weighted flop and river fixtures from the previous precision benchmark. Every row reached 0.05 chips/player of exploitability on a 100-chip pot. The full equilibrium EV interval at the target is at most 0.1% of pot. Independent Float64 JavaScript validation evaluated the stopped policies over the full physical tree and measured a maximum diagnostic discrepancy of 3.6 × 10⁻¹⁴ chips. All backends in each row crossed the target at the same checked iteration.

Wall time starts after the game is built and includes convergence checks. Check time sums the constrained and unrestricted best-response diagnostics, where applicable. Training throughput excludes checks. Memory is the solver-accounted arena and payoff data.

| Dense Float64 game | Iterations | Wall ms, old / scalar / SIMD | Iter/s, old / scalar / SIMD | Check ms, old / scalar / SIMD | MiB, old / source |
| --- | ---: | ---: | ---: | ---: | ---: |
| River | 50 | 2.7 / 1.8 / 1.7 | 21,412 / 31,969 / 32,654 | 0.4 / 0.2 / 0.4 | 3.23 / 3.23 |
| Locked river | 20 | 15.7 / 1.5 / 1.5 | 4,135 / 16,723 / 14,586 | 10.9 / 0.3 / 0.3 | 3.23 / 3.23 |
| Turn | 152 | 1,526 / 1,283 / 1,109 | 111 / 131 / 151 | 142 / 123 / 103 | 12.86 / 12.93 |
| Locked turn | 96 | 1,685 / 864 / 893 | 104 / 129 / 125 | 763 / 122 / 127 | 12.87 / 12.93 |
| Sampled flop | 130 | 685 / 501 / 404 | 207 / 282 / 355 | 55 / 39 / 36 | 7.21 / 7.27 |
| Locked sampled flop | 100 | 883 / 378 / 309 | 216 / 299 / 371 | 431 / 44 / 40 | 7.74 / 7.28 |
| Exact flop | 40 | 6,347 / 5,126 / 4,488 | 7.0 / 8.6 / 10.0 | 596 / 466 / 478 | 170.81 / 171.81 |
| Locked exact flop | 24 | 9,260 / 3,638 / 3,221 | 5.6 / 7.5 / 8.7 | 4,952 / 420 / 454 | 170.81 / 171.81 |

The exact flop has 249 × 279 weighted combinations, 28,524 logical nodes, and all 49 × 48 ordered runouts. Its OOP EV was 60.38154871 chips and its final gap was 0.03370696 chips/player. With the root locked, the corresponding values were 56.57674743 and 0.04116564, with an unrestricted gap of 3.38434496. Repeated locked turn solves rebuilt the game and warmed from the previous policy after each lock change. They reached the target at **0.46 solves/s** before, **0.86** with source scalar, and **0.98** with source SIMD.

In a separate alternating sampled-flop test, compiler-only SIMD reached the target in 548 ms. The build with explicit intrinsics took 452 ms. Both builds used the same Float64 arithmetic and reached the target in 130 iterations.

The previous Compact Float64 backend used a scalar row kernel and JavaScript traversal. The previous Compact mixed modes used JavaScript. All rows below are the same sampled flop with the 0.05-chip target at iteration 130.

| Compact precision | Wall ms, old / scalar / SIMD | Iter/s, old / scalar / SIMD | Check ms, old / scalar / SIMD | MiB, old / source |
| --- | ---: | ---: | ---: | ---: |
| Float64 | 3,343 / 795 / 864 | 47 / 173 / 158 | 504 / 43 / 39 | 6.46 / 7.11 |
| Float32 regrets | 3,811 / 828 / 849 | 38 / 166 / 160 | 371 / 43 / 36 | 3.74 / 6.55 |
| Float32 regrets and averages | 3,833 / 966 / 985 | 38 / 142 / 138 | 418 / 53 / 45 | 3.14 / 5.93 |
| Float32 regrets, averages, and current strategy | 4,920 / 1,215 / 1,098 | 29 / 112 / 123 | 442 / 51 / 40 | 2.55 / 5.36 |
| Float32 regrets and scaled averages | 4,197 / 891 / 891 | 34 / 153 / 152 | 349 / 44 / 38 | 3.22 / 5.99 |

## Compatibility and remaining costs

The source-backed route covers standard Nash/DCFR solves with dense, compact, or mixed state, including node locks and public suit symmetry. Frequency grids, QRE, other CFR variants, experimental pruning, and the separate dense river-private-symmetry path use their existing compatible backends. If the compiled arena exceeds the memory budget, the solver uses an available smaller backend at the selected precision. Saved checkpoints retain their existing file format and load across scalar and SIMD. The worker keeps the existing progress and cancellation schedule.

The source kernel still spends most of its time in tree traversal, including ordered rank and blocker work inside each terminal. Card-incidence scatter and indexed rank walks limit SIMD lane utilization. Compact rows also require mapped, sometimes noncontiguous accesses. This explains why the scalar source build can match or beat SIMD on some compact fixtures. Shared all-in runouts are traversed in native code, while JavaScript retains its pairwise and board operators. Full hand-level reports still use the reference evaluator.
