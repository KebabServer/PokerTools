# Dynamic public chance sampling

Choose **Solver → Setup → Advanced → Runouts & optimizations → Flop chance training → Dynamic sampling (experimental)** on a flop. The mode uses standard Nash/DCFR with action culling off. Set a seed, a turn budget, and a river budget per sampled turn. The budgets count public suit-orbit representatives wherever the solver can use exact suit isomorphism. The same betting tree and weighted ranges are available through Strategy, node locks, and export.

**Fixed runout tree** remains the default. Its exact checks apply to the fixed game that the selected runouts define. Set its turn and river counts to **49 and 48** for deterministic full-game DCFR. Dynamic sampling at **49 and 48** also visits every orbit and provides a parity check against that reference. Full-game refers to the entered betting abstraction and both weighted ranges.

## Training estimator

The algorithm traverses every legal strategic action and keeps the vector of private combinations. It samples only public chance, using the inclusion-probability correction from Monte Carlo CFR and the public-only traversal structure from PCS. [Lanctot et al., Monte Carlo Sampling for Regret Minimization in Extensive Games](https://proceedings.neurips.cc/paper/2009/hash/00411460f7c92d2124a67ea0f4cb5f85-Abstract.html), [Johanson et al., Efficient Nash Equilibrium Approximation through Monte Carlo Counterfactual Regret Minimization](https://www.johanson.ca/publications/poker/2012-aamas-pcs/2012-aamas-pcs.html)

Each player gets a separate seeded draw for its alternating update. A keyed stream uses the seed, iteration, player, public prefix, and population size. It reuses the draw across betting histories with the same prefix and population size within that pass. River draws are keyed by the dealt turn. Integer rejection sampling avoids modulo bias, and both WASM builds use the same draw order as JavaScript.

For a chance node with `N` outcomes and `K = min(budget, N)`, there are two proposals.

- **Uniform without replacement** applies a partial Fisher–Yates shuffle for `K` indices. Each selected outcome has inclusion probability `K / N` and reciprocal weight `N / K`.
- **Stratified** divides the population in card order into `K` disjoint contiguous bands. Band `i` covers indices `floor(iN/K)` up to `floor((i+1)N/K)`, with the upper endpoint excluded. It draws one outcome uniformly from each band. Its reciprocal weight is the band size, including for unequal and singleton bands.

For a selected edge with fixed probability `p` and inclusion probability `π`, traversal uses `p / π`. The expectation of `1{included} × p / π × value` is `p × value` for each fixed contribution. At the flop the turn probability is `1/45` and the river probability conditional on a legal turn is `1/44`, given two compatible private hands. Both reach vectors zero the combinations holding the dealt card. There is no blocker-dependent renormalization after a deal. A two-street contribution gets the product of the two edge corrections. Opponent reach supplies the counterfactual value and regret terms. Separately, an average-strategy increment is `t² × own realization reach × action probability`, with public edge corrections carried by own reach. Each accumulator therefore applies the public correction once. The expected additive increments at a fixed profile equal the corresponding full traversal increments. Policy normalization, regret matching, and signed DCFR discounts are nonlinear, so different seeds can have different convergence paths and rates.

Public suit isomorphism treats one orbit as one sampling unit. A visit evaluates its representative and relabels the contribution for **every** member with the existing suit permutations. Every member inherits the same orbit inclusion probability. The solver retains public mappings and private aliases only for symmetries that preserve the full betting game, weighted ranges, and current locks. Packed all-in continuations reuse showdown payoff records and apply the same sampling rules during training. Exact evaluation still uses the complete continuation.

## Persistent state and evaluation

Sampling leaves strategy and regret rows in the full tree. Each learnable canonical decision stores a last-updated iteration and the cumulative positive regret discount at that iteration, using 12 bytes per decision. A skipped iteration contributes zero estimated regret. Before the next update after `g` skipped iterations, the kernel multiplies existing positive regret by the ratio of cumulative positive discounts and negative regret by `2⁻ᵍ`. It then adds the new estimate and applies the current iteration's standard signed discount. Multiplying all positive regrets by the same factor preserves their relative action weights. A dormant decision keeps its last valid policy, or its initial policy until reached. Only visited decisions refresh their policy during training. Permanently fixed and forced rows retain the existing compact representations. [Brown and Sandholm, Solving Imperfect-Information Games via Discounted Regret Minimization](https://ojs.aaai.org/index.php/AAAI/article/view/4007)

The dynamic checkpoint includes the proposal settings, iteration, discount clocks, and cumulative training counters. Its fingerprint binds the settings to the exact game and numerical layout. Scalar and SIMD WASM can resume each other's checkpoints. A warm start uses the previous policy on the same full physical tree and starts a fresh clock and random stream. Lock changes rebuild legal symmetry from the new restrictions before that policy is seeded. Dense and compact storage and every precision mode are available. Node-frequency grids use the existing JavaScript solver path, including for dynamic runs. Counterfactual arithmetic and best responses remain in Float64.

Periodic and final best responses use the full flop tree and the averaged policy, including decisions whose average is still empty. At locked nodes the constrained response honors every fixed mix. Unrestricted responses allow deviations there. The reported OOP EV interval is `[pot/2 − BR_IP, pot/2 + BR_OOP]` with centered payoffs, using constrained responses when locks are active. Its width is twice the applicable exploitability in chips per player. The convergence timer includes the exact check, and diagnostics show evaluated game scope, sampled chance edges per iteration, and cumulative training visits over both player passes. Multiple visits to the same public card in distinct betting histories are counted separately.

## Reproduce the benchmarks

The script reuses the existing wide-range exact flop at `As Th 2d`, with 249 OOP and 279 IP weighted combinations, starting pot and stack of 100 chips, a 50% flop bet and 33% river bet, and 28,524 full-tree records. The constrained variant fixes the flop c-bet at 38%. Dense Float64 and the source-backed SIMD WASM kernel are used throughout. Run the cases sequentially on an otherwise idle machine for the most stable timing.

```sh
node --expose-gc scripts/solver/public-chance-benchmark.mjs unrestricted
node --expose-gc scripts/solver/public-chance-benchmark.mjs locked
```

The JSONL output includes build time, training time, exact-check time, node throughput, memory accounted by the solver, and target hits. `SOLVER_CHANCE_CAP_MS`, `SOLVER_CHANCE_CHECK_MS`, `SOLVER_CHANCE_SEEDS`, and `SOLVER_CHANCE_REPEATS` control the run. The optional final argument selects named cases, for example `stratified-16x12`. Wall time counts training and the exact checks used to stop the solve. A separate Float64 JavaScript reference with suit reduction disabled independently checks the reported target hits and final EV. For fixed sampling the audit copies policies by betting history onto the full game and uses valid initial strategies for missing histories. Its lifted-policy EV and full width are separate from its local fixed-game diagnostics.

## Measured results

Node 24.22.1 on AMD EPYC 9V74, with each scenario pinned to one logical CPU. The three dynamic seeds were `79`, `173`, and `421`. Checks followed about 750 ms of training. Each run had a 12 s training-plus-check cap, with a final check allowed to finish. Times below are seconds to the stated **full-game EV interval width as a percentage of starting pot**, with the median of successful runs and the number of seeds that reached each target. An em dash denotes zero hits. The final width range includes all seeds. Independent Float64 JavaScript checks agreed with the reported full-game bounds, exploitability, and profile EV to within `10⁻⁸` chips at audited points.

| Full-game target | Training mode | 0.5% | 0.1% | 0.05% | Final width (% pot) |
| --- | --- | ---: | ---: | ---: | ---: |
| Unrestricted | Full DCFR | 1.71 (1/1) | 3.43 (1/1) | 5.18 (1/1) | 0.0461 |
| Unrestricted | Dynamic stratified 6 × 6 | 4.98 (3/3) | — | — | 0.1162–0.1274 |
| Unrestricted | Dynamic stratified 16 × 12 | 4.15 (3/3) | 12.07 (2/3) | — | 0.0980–0.1003 |
| Unrestricted | Dynamic stratified 32 × 24 | 4.24 (3/3) | 11.97 (3/3) | — | 0.0938–0.0983 |
| Unrestricted | Dynamic uniform 16 × 12 | 4.20 (3/3) | — | — | 0.1087–0.1848 |
| C-bet locked | Full DCFR | 1.81 (1/1) | 2.69 (1/1) | 3.58 (1/1) | 0.0401 |
| C-bet locked | Dynamic stratified 6 × 6 | 4.36 (3/3) | 12.12 (3/3) | — | 0.0902–0.0966 |
| C-bet locked | Dynamic stratified 16 × 12 | 4.36 (3/3) | 11.38 (3/3) | — | 0.0851–0.0898 |
| C-bet locked | Dynamic stratified 32 × 24 | 4.47 (3/3) | 11.56 (1/3) | — | 0.0846–0.2006 |
| C-bet locked | Dynamic uniform 16 × 12 | 5.45 (3/3) | — | — | 0.1078–0.1296 |

An extended 16 × 12 stratified run with seed `173` and roughly 1 s of training between checks reached the 0.05% width in **21.72 s** unrestricted and **16.94 s** locked, at iterations 2,519 and 1,810. OOP EVs were 60.38523 and 56.56795 chips, within 0.00240 and 0.00132 chips of the corresponding deterministic point estimates. The locked run had 3.38525 chips/player of unrestricted exploitability despite its 0.04875-chip constrained interval width. The deterministic locked policy showed 3.37664 chips/player of unrestricted exploitability.

| Training mode | Node visits / iteration | Sampled chance edges / iteration | Training throughput (thousands of nodes/s, unrestricted / locked) | Solver MiB |
| --- | ---: | ---: | ---: | ---: |
| Full DCFR | 57,048 | All | 594 / 631 | 171.81 |
| Fixed 16 × 12 | 4,812 | All in fixed tree | 779 / 758 | 18.63 |
| Dynamic stratified 6 × 6 | 948 | 168 | 639 / 649 | 171.93–171.94 |
| Dynamic stratified 16 × 12 | 4,812 | 832 | 624 / 600 | 171.93–171.94 |
| Dynamic stratified 32 × 24 | 18,828 | 3,200 | 599 / 536 | 171.93–171.94 |
| Dynamic uniform 16 × 12 | 4,812 | 832 | 624 / 508 | 171.93–171.94 |

Fixed 16 × 12 with seed `79` reached a **local** interval width of 0.00925% unrestricted and 0.00406% locked in about 0.76 s each. Its local OOP EVs were 60.04354 and 56.07962 chips. With its policy lifted onto the full game, the audited widths were **32.5798%** and **29.8292%**. All fixed-tree times and local EVs describe the smaller configured game. The lift measures one explicit way to complete the missing decisions.

For repeated constrained solving, the benchmark changed the locked c-bet from 38% to 38.25% and then to 38.50%, rebuilding symmetry and seeding from the most recent policy. Full DCFR reached 0.05% on both changes in 2.93 s and 2.73 s including setup, or **0.35 verified solves/s**. Dynamic 16 × 12 reached 0.1% in 12.58 s and 10.76 s including setup, or **0.086 verified solves/s** at that width, and ended at 0.08360% and 0.06888% before the short cap. Full DCFR also reached 0.1% at the same checked points as its 0.05% hits. Fixed 16 × 12 took 1.01 s and 0.99 s including setup to pass its local target. Its lifted full-game widths were still above 29%.

## Recommended settings

Use deterministic **49 × 48** when the full tree fits and verified EV accuracy is the priority. Dynamic 16 × 12 stratified is the most useful starting point for experiments on this fixture. It cut training visits per iteration by about **92%**, but needed more iterations and more checked wall time at every tested full-game target. Very small budgets increased variance, and uniform draws at 16 × 12 reached fewer targets than stratified draws. Keep the mode experimental and use the full-game interval, especially for small EV differences and constrained comparisons.

Dynamic training retains the full decision tree and uses about the same memory as deterministic full solving. The configured tree-record and memory limits therefore still apply. Smaller budgets save traversal work. To fit more games into a given memory budget, use the existing tree and numerical storage controls.
