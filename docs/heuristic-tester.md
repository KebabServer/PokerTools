# Heuristic Tester v1

Use **Multiple flops** in the same panel to evaluate a collection with range-conditioned weights, aggregate EV-loss bounds, and resume. [Multi-flop guide](heuristic-multi-flop.md)

Open **Solver → Setup**, set **Start from** to **Flop**, and expand **Heuristic Tester**. Pick the IP or OOP decision to lock. **Load example** fills in candidate rules using the legal action labels at that decision. Edit the JSON or import candidates from a file, then use **Preview combos** to inspect each compiled mix. **Run comparison** starts the unrestricted baseline and the candidates in a browser worker. **Export JSON** records the settings, original rules, Hero decision, bounds, and run timings. An exported file's candidates can be imported again.

The reference uses deterministic Float64 Nash/DCFR with the full 49 × 48 ordered public runouts. The tester uses the Setup board, weighted ranges, pot, effective stack, betting tree, storage layout, memory limit, and iteration cap. It starts with every decision free and applies exactly one Hero combo lock for each restricted candidate. QRE, frequency increments, and action culling are disabled in tester runs. Each result measures Hero's EV from the starting flop, so play before and after the selected decision can change in response to the lock.

The full reference needs enough tree records and memory to enumerate the entire tree. Adjust the betting sizes, raises, or limits in Setup if it exceeds capacity. **Setup’s fixed runouts** is an explicit smaller-game option when Setup uses a fixed runout tree. Its intervals are exact for that sampled game. Both the baseline and every candidate use the same public tree, seed, weighted ranges, and payoff assumptions.

## Candidate rules

Provide a JSON array. Each candidate needs a unique `name`, an ordered `rules` array, and a `default`. A rule has `match` and `mix`. A `mix` or `default` can be an exact action label for 100%, or a map of legal labels to percentages totaling 100. Omitted actions get 0%. The first matching rule supplies the whole distribution, and the default covers the remaining combos. `values` within a rule are alternatives. Use `{ "name": "Unrestricted control", "unrestricted": true }` to include a zero-loss row from the same baseline solve.

| Match `type` | `values` and behavior |
| --- | --- |
| `all` | Omit `values`. Matches every available Hero combo. |
| `combo` | Exact two-card strings such as `AcKd`. Card order is interchangeable. Board-blocked combos and combos outside Hero's positive-weight range are rejected. |
| `class` | Canonical starting hands such as `AKs`, `KQo`, or `77`. Only the available combos in each class are used. |
| `made` | `high-card`, `pair`, `two-pair`, `trips`, `straight`, `flush`, `full-house`, `quads`, `straight-flush`. Uses the five cards on the flop and in Hero's hand. |
| `pair` | `top-pair`, `middle-pair`, `bottom-pair`, `overpair`, `underpair`. Applies to one-pair hands on an unpaired flop. The first three require a hole card matching that flop rank. An overpair is above the entire board, and an underpair is below it. Pocket pairs between board ranks still match `made: pair`. |
| `draw` | `flush-draw` means four cards of the same suit. `open-ended` means four consecutive ranks with two live ends. `gutshot` covers other immediate straight draws, including one-ended wheel or Broadway draws and double gutshots. A made straight has no straight-draw match. Backdoor draws require two cards and are excluded. |

Made-hand, pair, and draw matches can overlap. Put specific exceptions before broad rules. For example, add `{"match":{"type":"combo","values":["AcKd"]},"mix":{"Check":60,"Bet 50%":40}}` ahead of an entire-range bet when that combo is available. [Example candidate file](heuristic-candidates.example.json)

## Bounds and stopping

The solver's OOP EV is reported on a scale where OOP and IP EV sum to the starting pot `P`. OOP bounds `[L, U]` become `[P − U, P − L]` for IP. After converting both results to Hero's perspective, the loss interval is `[L₀ − Uᴴ, U₀ − Lᴴ]`, intersected with the nonnegative real numbers. Restricting only Hero can reduce or preserve the equilibrium value. A wholly negative interval beyond round-off signals incompatible results. The table shows the midpoint and endpoints in chips and as a percentage of `P`. When the lower endpoint is zero, the bounds leave zero loss possible.

Each solve targets half the requested loss interval width. When both individual bounds reach that width, the combined interval fits the requested target. At the iteration cap the table keeps the bounds actually verified. Best-response checks use the same configured game throughout and honor the Hero lock in the constrained response. The tester reuses one baseline and reads convergence summaries, so detailed per-node strategy reports are unnecessary.

## Benchmark

```sh
node --expose-gc scripts/solver/heuristic-benchmark.mjs
```

The benchmark alternates cold and warm starts on the same wide-range full flop from the existing exact-flop suite. It reads the example candidates and measures wall time for a complete comparison, including game setup, WASM binding, and best-response checks. Each trial solves one baseline. Warm starts use its average policy to seed each candidate with the existing solver mechanism. Cold starts drop references to the baseline's numerical state before creating the next game. `SOLVER_HEURISTIC_TRIALS`, `SOLVER_HEURISTIC_MAX`, and `SOLVER_HEURISTIC_WIDTH` set the number of repetitions, per-solve cap, and target loss interval percentage.

Two trials per mode on one logical CPU of an AMD EPYC 9V74, with Node 24.22.1, dense Float64, and SIMD128 WASM. The `As Th 2d` fixture has 249 OOP and 279 IP weighted combos and a 100-chip starting pot. All solves used a 500-iteration cap and a target loss interval width of 0.1% of the starting pot. Each run reused its baseline for all candidates and for the unrestricted control. The baseline reached its target in 48 iterations in each run.

| Candidate | Cold seconds / iterations | Warm seconds / iterations | Cold loss interval (% pot) | Warm loss interval (% pot) |
| --- | ---: | ---: | ---: | ---: |
| Unrestricted control | <0.01 / baseline | <0.01 / baseline | 0 | 0 |
| Check range | 4.24 / 24 | 49.71 / 448 | 4.0600–4.1548 | 4.0599–4.1576 |
| Bet range | 6.50 / 40 | 44.31 / 400 | 3.2916–3.3891 | 3.3015–3.3993 |
| Value and draws | 5.09 / 32 | 62.99 / 500 | 2.0343–2.1204 | 2.0176–2.1396 |
| **Total including baseline** | **22.60 s** | **163.26 s** | **3/3 reached target** | **2/3 reached target** |

Times are medians of the two trials. Cold comparisons took 21.71–23.49 s, and warm comparisons took 158.24–168.28 s. The warm **Value and draws** runs hit the iteration cap with a 0.1219% loss interval. The browser uses cold starts, which reached all three targets sooner on this fixture and hold one active numerical game during a comparison.
