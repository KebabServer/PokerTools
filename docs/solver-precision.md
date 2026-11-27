# Mixed-precision Solver

Open **Solver → Setup → Advanced → Runouts & optimizations → Storage precision**. The default is **Float64 reference**. **Numerical storage** independently controls whether the game uses dense rows or compact rows. Auto may select either layout at the chosen precision.

| Precision | Regrets | Average sums | Current strategy | State bytes per learned action in a standard GTO row |
| --- | --- | --- | --- | ---: |
| Float64 reference | Float64 | Float64 | Float64 | 24 |
| Float32 regrets | Float32 | Float64 | Float64 | 20 |
| Float32 regrets + averages | Float32 | Float32 | Float64 | 16 |
| Float32 regrets + averages + strategy | Float32 | Float32 | Float32 | 12 |
| Float32 regrets + scaled averages | Float32 | Float32 with binary scaling | Float64 | 16 plus one byte per row |

The table assumes equal regret and policy row counts, as in Compact. Dense river suit orbits can use different counts. Predictive corrections, QRE log and entropy caches, fixed lock probabilities, and implicit default policies use Float64. Compact can still share exactly symmetric rows and omit forced or unavailable rows.

## Numerical behavior

- The mixed modes use JavaScript. The existing native WASM kernels still use the original Float64 arena and layouts. Packed tree indices, payoff programs and all-in operators are shared independently of the precision selection.
- Reach vectors, blocker-adjusted normalization, terminal and chance calculations, counterfactual deltas, profile EVs, best responses and EV bounds all use Float64. The mixed arena rounds values when storing them in a narrower persistent plane.
- Float32 regrets are stored in a power-of-two chip unit based on the largest starting stake. Discounting and additions follow the same CFR recurrence in that unit. Regret matching scales the tie threshold by the same factor. This gives large pots headroom and keeps the normalization free of a decimal scale. Cancellation between nearly equal values still loses the bits already rounded away in Float32.
- From the browser's maximum ten million iterations and the largest supported averaging power of four, cumulative weights are on the order of 10³⁴ even before the usual reach attenuation. This fits normal Float32 output. Relative precision can still discard a small increment to a much larger sum. In the scaled-average mode every learned row has one signed binary exponent, changed in exact powers of two. All action sums in that row share the scale, which cancels when computing the strategy. The scaled mode protects very small common realization weights and large absolute sums, with the same Float32 significand precision for unequal contributions.
- Float32 current storage writes the smaller action masses and reconstructs the largest action as the Float64 residual. It retains small probabilities that are representable in Float32 and keeps the row normalized. Frequency grids store whole units and decode once to Float64. QRE encodes slack above its probability floor so rounding cannot drop an action below that floor.
- A mixed checkpoint stores its typed arena and its precision in the version 2 file. Resume requires the same precision, layout, locks and physical game. The Float64 version 1 format and fingerprint remain compatible with existing checkpoints. A warm start imports the average policy into a fresh game and can change precision, layout or locks. In a direct comparison with the previous release, the Float64 arena matched bit for bit after 25 iterations across DCFR, optimistic CFR, predictive DCFR, and QRE for their available JavaScript and WASM paths.

## Independent evaluation and reproduction

The benchmark imports each trained average policy into a separately built Float64 reference game. It uses the original explicit tree, disables suit grouping, and walks every runout in the configured chance schedule for both best responses. Locked games use both constrained and unrestricted best responses. For a 100-chip starting pot, a reported exploitability of 0.01 chips per player is a 0.01% stopping target. The OOP equilibrium EV interval has full width equal to twice that gap. Small EV comparisons require nonoverlapping bounds for the two games being compared.

```sh
for fixture in exact-flop sampled-flop long locked-a locked-b; do
  for precision in float64 f32-regrets f32-regrets-averages f32-all f32-scaled-averages; do
    node --expose-gc scripts/solver/precision-benchmark.mjs "$fixture" "$precision" compact javascript
  done
done
node --expose-gc scripts/solver/precision-benchmark.mjs exact-flop float64 dense wasm
SOLVER_PRECISION_TARGET_METRIC=interval SOLVER_PRECISION_STEPS=128 \
  SOLVER_PRECISION_EVERY=16 node --expose-gc scripts/solver/precision-benchmark.mjs exact-flop f32-regrets compact javascript
SOLVER_PRECISION_MEMORY_ONLY=1 SOLVER_PRECISION_STEPS=4 \
  node --expose-gc scripts/solver/precision-benchmark.mjs exact-flop f32-all compact javascript
```

The harness reports arena and engine-accounted memory, RSS growth before the independent audit, build time, training throughput, and time to each checked threshold. The target times include training and audits and exclude construction of the training game. The reported minimum is the lowest independently verified gap in the run. The numbers characterize the tested policies and iteration limits.

## Measured results

Node 24.22.1 on an AMD EPYC 9V74. Each timing is a single process run. The two flop fixtures use weighted ranges of 249 OOP and 279 IP combinations and a 100-chip starting pot. The fully enumerated fixture has 28,524 logical nodes and 49 × 48 ordered runouts. The sampled fixture has 876 logical nodes, three sampled turns and four rivers per turn, multiple flop bet sizes, raises, and turn betting. The sampled results apply to that fixed chance schedule.

### Fully enumerated flop, 40 iterations

Compact JavaScript held layout, tree, weighted ranges and algorithm fixed. All modes hit 0.1% exploitability at iteration 24 and 0.05% at iteration 40. The OOP profile EV was 60.381548708 chips for Float64. The largest EV deviation at iteration 40 was below 0.000000001 chips, and the observed gaps differed from the Float64 reference by at most 1.3 × 10⁻⁹ chips.

| Precision | Arena MiB | Accounted MiB | Training iter/s | Seconds to 0.1% | Seconds to 0.05% | Minimum audited gap, chips/player |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Float64 | 104.53 | 124.33 | 1.10 | 25.2 | 47.0 | 0.033706960 |
| Float32 regrets | 87.11 | 106.91 | 0.97 | 26.1 | 52.6 | 0.033706961 |
| Float32 regrets + averages | 69.69 | 89.48 | 1.11 | 25.0 | 46.4 | 0.033706960 |
| Float32 regrets + averages + strategy | 52.27 | 72.06 | 0.92 | 30.1 | 55.8 | 0.033706959 |
| Float32 regrets + scaled averages | 71.87 | 91.66 | 1.00 | 28.3 | 52.4 | 0.033706960 |

The dense Float64 WASM reference used 170.81 MiB and trained at 6.35 iterations/s in the 40-iteration run. A separate 128-iteration comparison checked full EV interval widths. Both dense Float64 WASM and compact Float32 regrets reached 0.1% and 0.05% widths at the first qualifying check, iteration 48. Both reached **0.01% width at iteration 128**.

| 128-iteration run | Accounted MiB | Training iter/s | Seconds to 0.01% width, including audit | Final full EV interval width | OOP profile EV |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dense Float64 WASM | 170.81 | 4.92 | 35.8 | 0.008100% | 60.381854830 |
| Compact Float32 regrets, JS | 106.91 | 0.75 | 188.3 | 0.008097% | 60.381854244 |

The extended comparison changes both layout and backend. The compact JavaScript table above isolates storage precision.

A separate memory run measured the process peak through setup, four iterations, and a Float64 convergence check. Peak RSS excludes the separate audit game. It was 456.3 MiB for Float64, 436.8 MiB for Float32 regrets, 422.9 MiB for Float32 regrets and averages, 409.2 MiB for all-Float32 state, and 422.3 MiB for scaled averages. Peak includes the JavaScript runtime, payoff data, allocator overhead, and diagnostic buffers.

### Sampled multi-size flop, 1,000 iterations

All five modes hit 0.1%, 0.05% and 0.01% exploitability by iterations 100, 150 and 300 respectively. The Float64 reference OOP profile EV was 51.091564209 chips at iteration 1,000. Mixed storage changed that EV by at most 0.000000125 chips. The solver's own diagnostic matched the independent physical-tree checker within 9 × 10⁻¹⁵ chips of exploitability.

| Precision | Arena MiB | Accounted MiB | Training iter/s | Seconds to 0.1% / 0.05% / 0.01% | Minimum audited gap, chips/player |
| --- | ---: | ---: | ---: | ---: | ---: |
| Float64 | 3.57 | 4.33 | 43.3 | 3.56 / 4.86 / 8.33 | 0.001114629 |
| Float32 regrets | 2.97 | 3.74 | 46.5 | 2.83 / 4.08 / 7.51 | 0.001114369 |
| Float32 regrets + averages | 2.38 | 3.14 | 40.5 | 3.02 / 4.44 / 8.21 | 0.001114366 |
| Float32 regrets + averages + strategy | 1.78 | 2.55 | 32.1 | 3.29 / 4.71 / 9.78 | 0.001113059 |
| Float32 regrets + scaled averages | 2.45 | 3.22 | 45.0 | 2.69 / 3.92 / 7.42 | 0.001114366 |

A second pass targeted **full EV interval width**. Every mode reached widths of 0.1%, 0.05%, and 0.01% at iterations 150, 200, and 450 respectively. Including independent certification, time to 0.01% width ranged from 12.1 s to 23.7 s in those runs.

### Close locked-game EV comparison

On the same river and weighted ranges of 242 × 272 hands, two root locks checked with frequencies of 62% and 62.25%. Each mode ran for 5,000 iterations. The second lock had about **0.001792272 chips higher OOP EV**, or 0.001792% of the pot, in every mode. Both constrained equilibrium intervals were disjoint for every mode. Across all modes, the upper bound of the first lock was below 47.745012 and the lower bound of the second was above 47.746798. The maximum profile EV deviation from the corresponding Float64 run was under 1.3 × 10⁻¹² chips. The unrestricted best response remained exploitable, as expected for a fixed strategy.

| Precision | Accounted MiB in each game | Iter/s, first / second lock | Minimum constrained gaps, chips/player |
| --- | ---: | ---: | ---: |
| Float64 | 0.08 | 4,663 / 4,986 | 2.529 × 10⁻⁶ / 2.539 × 10⁻⁶ |
| Float32 regrets | 0.07 | 4,654 / 4,926 | 2.529 × 10⁻⁶ / 2.539 × 10⁻⁶ |
| Float32 regrets + averages | 0.07 | 4,848 / 4,932 | 2.530 × 10⁻⁶ / 2.539 × 10⁻⁶ |
| Float32 regrets + averages + strategy | 0.06 | 4,556 / 4,265 | 2.530 × 10⁻⁶ / 2.539 × 10⁻⁶ |
| Float32 regrets + scaled averages | 0.07 | 4,894 / 4,311 | 2.530 × 10⁻⁶ / 2.539 × 10⁻⁶ |

Every lock and precision cleared all three exploitability thresholds at the first recorded check, 500 iterations and 0.17–0.21 seconds.

### Long-run stability and rare weights

The stress run used 50,000 iterations, a 900,000-chip pot, input combo weights spanning 18 decimal orders of magnitude, and power-four averaging. All modes crossed all three exploitability thresholds at the first check, iteration 5,000. Float64 OOP profile EV was 429,007.899783933 chips. Maximum mixed-mode EV deviation was 0.000022 chips. Independent evaluations measured each policy over the full weight distribution. Re-basing the scales in the regression tests also covered accumulated weights near the browser's ten-million-iteration cap.

| Precision | Accounted MiB | Training iter/s | Time to 50,000 | Minimum audited gap as % of pot |
| --- | ---: | ---: | ---: | ---: |
| Float64 | 0.03 | 17,048 | 2.95 s | 0.0001081% |
| Float32 regrets | 0.03 | 17,168 | 2.94 s | 0.0000810% |
| Float32 regrets + averages | 0.02 | 17,160 | 2.94 s | 0.0000781% |
| Float32 regrets + averages + strategy | 0.02 | 14,784 | 3.40 s | 0.0000867% |
| Float32 regrets + scaled averages | 0.02 | 16,442 | 3.07 s | 0.0000781% |

Unscaled Float32 averages dropped test contributions at 2⁻¹⁰⁰⁰ and fell back to the current strategy. Scaled Float32 reproduced the Float64 distribution at those weights and at 2⁹⁰⁰. This protects a row's absolute dynamic range. A contribution far below one Float32 unit at the scale of the running sum can still disappear, and Float32 current storage can round a sufficiently small probability to zero.

## Recommendations

- **Float64** is the default and the reference for studying thin EV differences. Its dense WASM backend remains the best choice for throughput when it fits.
- **Float32 regrets** is the first memory-saving option. It keeps averaging and policy storage in Float64. On the exact flop it saved 17.42 MiB of accounted memory in Compact.
- **Float32 regrets + averages** saves more working memory. Use **scaled averages** for unusual realization-weight ranges where ordinary Float32 would underflow.
- **Float32 regrets + averages + strategy** saved 50% of the strategy arena and 42% of accounted solver memory on the exact flop. It had the lowest throughput in the sampled flop. Choose it when capacity matters and verify the resulting EV interval on the game you are comparing.

Use the certified EV intervals for a close decision. The locked river experiment resolved a 0.001792-chip difference. That resolution depends on the game's convergence and the width of the two intervals.
