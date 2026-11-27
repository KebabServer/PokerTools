# TurnRiverLab solver

TurnRiverLab solves a heads-up postflop betting abstraction with two weighted exact-combo ranges, an equal effective stack, and no rake. The browser and Node.js share the solver core and Float64 evaluation. The browser retains its worker and cooperative fallback. The Node entry point is [solver/index.mjs](../solver/index.mjs).

## Prepare once and solve several restrictions

Use Node.js 22 or later. Both weight arrays use the engine's 1,326-combo ordering. The example config uses an analytical river game in which the unrestricted OOP equilibrium value is about 57.143 chips.

```js
import { cardId, comboId, decodeCheckpoint, prepareGame } from './solver/index.mjs'

const combo = (first, second) => comboId(cardId(first), cardId(second))
const weights0 = new Float64Array(1326)
const weights1 = new Float64Array(1326)
weights0[combo('Ah', 'Ad')] = .75
weights0[combo('Ks', 'Qs')] = 1
weights1[combo('Jh', 'Jd')] = 1

const prepared = prepareGame({
  board: ['As', '8h', '3d', '2c', '7s'],
  pot: 100, stack: 100, sizes0: [50], sizes1: [],
  maxRaises: 0, weights0, weights1, strategyStorage: 'compact',
})

const unrestricted = prepared.createSession()
const baseline = unrestricted.solveUntil({ targetEVWidth: .01 })
const candidate = prepared.createSession()
const root = candidate.describe().root
candidate.setNodeLocks([
  candidate.makeLock(root, { comboPercentages: { [combo('Ks', 'Qs')]: [0, 100] } }),
])
candidate.warmStartFrom(unrestricted, { mode: 'combined', regretDiscount: .25 })
const result = candidate.solveUntil({
  targetEVLossWidth: .025, baseline, hero: 0, adaptiveChecks: true, finalEvaluation: 'javascript',
})
console.log(result.equilibriumBounds.foldZero[0], result.evLoss, result.terminationReason)

const detail = candidate.nodeReport(root)
const counterfactuals = candidate.counterfactualActionValues(root, 'constrainedBest')
const { config, checkpoint } = decodeCheckpoint(candidate.encodeCheckpoint())
const resumed = prepareGame(config).createSession({ checkpoint })
```

- `prepareGame(config, { backend: 'javascript' })` selects the reference engine. `'wasm'` is the default. `'wasm-simd'` requests the source-backed SIMD build and can fall back to the scalar build on an unsupported runtime. `'native'` uses the local Node addon and requires a successful build. Native and SIMD requests select compact storage unless the configuration already specifies a layout. Inspect `describe().backend` for the engine used.
- `decision(id)` and `findDecision(history)` expose the structural decision and its action order. Whole-node locks supply `percentages`. Combo locks supply `comboPercentages` keyed by exact combo ID. Remaining rows continue learning.
- `nodeReport(id)` returns the average mix and fold-zero action and profile EVs at a selected node. `counterfactualActionValues(id, continuation, { comboIds, groups })` returns centered action CFVs, exact combo IDs, blocker-adjusted opponent mass, conditional action EVs, average and locked probabilities, own reach and joint reach mass. It includes actions with zero policy probability. Continuations are `'profile'`, `'constrainedBest'` or `'best'`. Pass a map of names to combo ID arrays to get reach-weighted action EVs and deltas from the first action. These are fixed-continuation estimates. A previously unreachable line can have an untrained continuation, so re-solve before using a local difference as an equilibrium EV change.
- `metrics()` returns profile EVs, best-response values, bounds, and convergence in an EV-only summary. `solveUntil()` also returns the rule and configuration fingerprints, algorithm version, phase timings, memory estimates, process RSS observations, and termination reason.
- `setNodeLocks()` resets learned state and updates fixed rows immediately. `resetSolverState()` clears strategies, averages, regrets, pruning, and iteration schedules while retaining the current lock assignment.
- `solveUntil()` takes an additional iteration budget per call. It can stop at `targetEVWidth`, `targetExploitability`, `targetEVLossWidth` with a comparable baseline, `maxIterations`, `maxRuntimeMs`, or `maxMemoryBytes`. An optional comparable `incumbent` enables elimination when the candidate's upper EV bound is below the incumbent's lower bound after the rounding tolerance. `adaptiveChecks` uses recent width changes, observed evaluation cost and remaining time to schedule checks between `checkEvery` and `maxCheckEvery`. `checkIterations` records the schedule. A separate Float64 evaluation confirms target stops. Choose `finalEvaluation: 'javascript'` or call `metrics({ independent: true })` to evaluate the trained policy through the JS reference.
- `saveCheckpoint()` and `restoreCheckpoint()` verify the configuration and storage fingerprint, including node locks. Dense checkpoints preserve the original Float64 format and legacy migration. Compact checkpoints preserve the packed bytes and precision of each bank. Use identical layout settings to resume across backends. Use warm transfer to seed an independently allocated compatible layout.

### Warm starts

Warm transfer expects a second compatible GTO session. It can map state between different public symmetry layouts of the same full structural tree. Strategy transfer uses the donor's averaged continuation. Regret transfer discounts retained regrets and clears rows at, above, and below changed locks. A changed opponent policy can affect other branches in subsequent iterations, so retained regrets serve as initialization. The destination starts at iteration zero with empty strategy averages, no predictive deltas, and no culling masks. It evaluates the new restrictions immediately.

Use `mode: 'strategy'` for continuation policy, `'regret'` for discounted regrets, or `'combined'` for both. A cold reset provides the reference. Compare time at the same EV width. A warm hint can either help or slow convergence, depending on the game and change in restrictions.

## Storage and all-in continuation

`strategyStorage: 'dense'` preserves the default browser and headless layout. Select `'compact'` for the new GTO path. Compact supports frequency increments and the existing GTO algorithms. QRE and the experimental action and regret pruning paths use dense storage.

| Compact precision | Regret | Average sum | Current policy |
| --- | --- | --- | --- |
| `f64` | Float64 | Float64 | Float64 |
| `f32-regret` | Float32 | Float64 | Float64 |
| `f32-average` | Float32 | Float32 | Float64 |
| `f32` | Float32 | Float32 | Float32 |
| `scaled` | Int16 with one Float32 scale per row | Int16 with one Float32 scale per row | Float32 |

Float64 remains the compact default. `scaled` currently supports DCFR. Every format uses Float64 for CFVs, payoffs, reaches, chance weights, normalization and best responses. Float32 current mixes are normalized when read. Scaled rows are dequantized and requantized once per update. Small actions can round to zero and scales are subject to Float32 underflow and saturation. Use independent best responses at the requested EV width before using results from an experimental format.

Set `currentPolicyStorage: 'derived'` with compact Float64 DCFR to compute the current mix from regrets and omit that entire bank. This preserves the cold update rule and supports regret-only warm starts. Frequency increments and independently seeded current policies use the stored layout. `describe()` reports strategy bytes, allocated scalars, row count, immutable bytes, arena bytes, scratch and packed node count. The compact path accepts an explicit `maxNodes` up to 1,000,000, subject to preparation, numerical and arena budgets.

Compact defaults to `allInRunouts: 'implicit'`. Called all-ins close the betting history and reference one shared public-board continuation. Turn all-ins evaluate the configured rivers and flop all-ins also follow the configured turn weights. `'explicit'` exposes each runout in the ordinary tree. `'pair-equity'` attempts a signed Int16 win-minus-loss matrix for exact programs within `pairEquityMaxWork` and uses the shared runout program elsewhere. The integer denominator is 44 on the turn and 45 × 44 on the flop. Blocked matchups and ties contribute zero centered payoff because both players have committed the same amount. Matrices are useful for small ranges and can be expensive to build for wide ranges.

Decisions keep the same numeric IDs under storage or precision changes with the same structural tree. The implicit all-in tree omits chance-only descendants of called all-ins, so numeric IDs can differ from explicit mode. Resolve a betting history with `findDecision(history)` when switching between tree representations. The browser continues to use its original explicit tree and checkpoint layout.

## Interpreting EV and convergence

At the root, the two private ranges are independently weighted and then conditioned on disjoint private cards. The engine removes public blockers and divides by the joint compatible mass. Centered terminal utilities are zero-sum. A win gives half the starting pot plus the opponent's committed chips. A loss costs half the starting pot plus the player's committed chips.

At a free information set, a best response takes the maximum across legal actions. At a locked row it uses the prescribed probability-weighted sum, regardless of actions the average profile currently uses. These requirements are linear in realization probabilities, which preserves a convex strategy set and the zero-sum minimax relationship. The best-response pass includes temporarily culled actions as legal deviations.

For Hero (H), the centered interval is ([-BR_{1-H}, BR_H]) using constrained responses to the opponent's average strategy. Adding half the starting pot to each endpoint yields the fold-zero interval. Equivalently, its lower endpoint is starting pot minus the opponent's fold-zero best response. The profile EV describes the played average profile. Constrained NashConv is the sum of centered constrained best responses, and constrained exploitability is half that sum. Unrestricted exploitability measures deviations allowed to ignore locks.

For a baseline interval ([L_0,U_0]) and candidate interval ([L_H,U_H]), `compareEvLoss()` reports ([L_0-U_H,U_0-L_H]) in chips and as a percentage of the starting pot. It intersects the interval with nonnegative values when only Hero is restricted. Restricting the opponent can improve Hero's value, so two-sided and opponent-only restrictions retain signed differences. An unrestricted candidate in the identical game has zero EV loss. Compatibility checks use the actual weighted ranges, payoff layout, actions, and chance tree. Convergence uncertainty and strategic EV loss appear separately in the result.

The bounds follow from best responses in the configured zero-sum game, evaluated in Float64. Small endpoint reversals from floating-point roundoff are ordered. The engine uses a conservative floating-point comparison for early elimination. Frequency-increment training projects each action mix onto a grid and measures best responses to that projected profile. Pure legal actions are on the grid, but the grid-strategy space may lack a mixed saddle point. Its EV bounds refer to the continuous lock game. Entropy-regularized QRE has a separate regularized residual. Its chip bounds refer to the ordinary chip minimax value.

## Flop fidelity and worker batches

| Fidelity | Turn cards | River cards per turn |
| --- | ---: | ---: |
| `fast` | 8 | 6 |
| `intermediate` | 16 | 12 |
| `high` | 32 | 24 |
| `exact` | 49 | 48 |

Set `flopFidelity` and optionally override `flopTurnSamples` or `flopRiverSamples`. The original seeded sample mapping remains available as `flopSamplingMethod: 'legacy'` and remains the browser default. `'uniform'` uses seeded sampling without replacement with rejection-based bounded draws. `'suit-orbits'` samples orbits under the board and range group. It uses the actual orbit inclusion probability at each stage and may select a variable number of cards. Conditional river samples on equivalent turns are mapped from the same representative.

An exact flop gives each disjoint private deal 45 legal turns and 44 legal rivers per turn. Exact branches carry weights (1/45) and (1/44). Sampled branches use the corresponding exact weight divided by the public inclusion probability. This is inverse-probability weighting for estimating the EV of a strategy fixed independently of the sample. Under the uniform sampling design and independently randomized stages, the estimator averages to the exact-tree EV. A particular deterministic sample can have total chance mass different from one for an individual private deal. Its strategy and EV bounds describe a weighted sampled game. Training and testing solely on that sample can favor strategies fitted to those runouts. The legacy pseudorandom mapping is retained for reproducibility and uses the same nominal weights.

Use common seeds within a comparison and independent seeds to check sensitivity. Pair each candidate with a baseline from the same fidelity and seed. Move shortlisted candidates to higher fidelity or exact enumeration. The following workflow runs all requested jobs and leaves candidate selection to the caller.

```js
import { runFlopValidation } from './solver/batch.mjs'

const results = await runFlopValidation({
  config: { ...flopConfig, strategyStorage: 'compact', flopSamplingMethod: 'suit-orbits', maxNodes: 180000 },
  fidelities: ['fast', { name: 'intermediate', turns: 20, riversPerTurn: 12 }, 'exact'],
  seeds: [29, 101, 509],
  candidates: [{
    id: 'small root mix',
    nodeLocks: [{ history: ['Flop'], percentages: [75, 25] }],
    warmStart: { mode: 'combined' },
  }],
  solve: { targetEVWidth: .2, maxIterations: 800, maxRuntimeMs: 10000, adaptiveChecks: true },
}, { workers: 2, maxMemoryBytes: 1024 ** 3, workerHeapMb: 256 })
```

The example assumes exactly two legal flop actions. A later-street lock can specify its history, and the worker resolves it against the actual sampled tree. A lock whose history is absent produces a candidate error. Exact enumeration runs once because the seed cannot change the full chance tree.

The batch CLI accepts a JSON job or array of jobs. Each job accepts `id`, `config`, `solve`, and optional `backend` and `candidates`. JSON configs contain regular arrays for combo weights. Use `candidateRounds` for successive additional iteration allowances. A candidate's `solve.maxIterations` caps its total iterations. Each round can reuse a saved state and eliminate an inferior candidate using bounds for the same hero. Without rounds, the worker evaluates candidates once in input order.

```js
import { runBatch } from './solver/batch.mjs'

const jobs = [{
  id: 'button-cbets',
  config: { ...flopConfig, strategyStorage: 'compact' },
  backend: 'wasm-simd',
  estimatedMemoryBytes: 256 * 1024 ** 2,
  estimatedWork: 2_000_000,
  checkpointDirectory: './candidate-checkpoints',
  candidateRounds: [40, 120, 360],
  solve: { hero: 1, maxIterations: 520, targetEVWidth: .5, adaptiveChecks: true },
  candidates: [25, 50, 75].map(bet => ({
    id: `bet-${bet}`,
    nodeLocks: [{ history: ['Flop', 'Check'], percentages: [100 - bet, bet] }],
    eliminateAgainstIncumbent: true,
  })),
}]
const controller = new AbortController()
const results = await runBatch(jobs, { workers: 2, maxMemoryBytes: 768 * 1024 ** 2, signal: controller.signal })
```

```sh
node scripts/solve-turn-river.mjs jobs.json --workers 2 --memory-mib 1024 --worker-heap-mib 256
```

Persistent workers choose the largest estimated work that fits available memory reservations, with preference for compatible preparation already on that worker. `estimatedMemoryBytes` reserves bytes for the whole job and `estimatedWork` controls order. Results remain in input order. Each candidate job reuses prepared inputs and retains an unrestricted numerical donor when a candidate requests a warm start. Across jobs, the most recent preparation on a worker is reused when its inputs match and no global RSS budget is set.

With `checkpointDirectory`, workers atomically write candidate state between rounds and resume a matching checkpoint on rerun. A transport failure gets one retry. Without a directory, multi-round workers use temporary checkpoints that are cleaned up at job completion. Eliminated candidates release saved state. A stop through `AbortSignal` or CLI Ctrl-C is cooperative between CFR steps or evaluations. Runtime and RSS budgets are also cooperative, so a single traversal, preparation or evaluation can exceed a requested limit transiently. The worker heap limit covers V8 heap allocations. The process RSS observation also includes WASM, native and checkpoint buffers.

## Architecture and numerical audit

- `core.js` constructs the tree, prepares weighted ranges and showdown layouts, and implements reference CFR and evaluation. Swapped turn and river share strength and legality tables. Compact decision histories are reconstructed from parent and edge tables. Repeated action labels and committed-chip pairs are shared.
- Prepared games share structural actions, chance outcomes, blockers, strength layouts, and suit maps. Sessions own strategy storage, locks, iteration counters, culling, and live scratch. Compatible lock changes reuse the numerical arena and compiled metadata. Changed suit layouts reuse the prepared game data and allocate a compatible arena.
- Public suit compression uses a subgroup preserving the starting board, exact weighted ranges, actual sampled outcomes and weights, and the complete set of locked rows and mixes. Later-street checks map each lock through its betting path. Compact layouts store one row per free orbit under the public-card stabilizer. Deal-blocked hands and hands with zero support against the opponent's legal range omit strategy state. A reachable deal retains its row even when its current action reach is zero. Fixed mixes are separate Float64 data, with one shared row for a whole-node lock. Reports expand policies to physical combination IDs.
- `compiled-traversal.js` packs canonical nodes and eliminates forced steps from the source-backed traversal while retaining their logical decisions. Compact WASM and the native addon share byte offsets and the C implementation. The opaque legacy kernels still serve dense training and QRE. The source-backed engine handles GTO training, profile EV, and constrained and unrestricted responses. EV modes share terminal work within a pass. Persistent state is hand-major, while compact training decodes the live node into action-major scratch for contiguous reach and CFV loops.
- `checkpoint-format.js` handles binary serialization and state checksums. Core validates the configuration, row layout, state length, and pruning masks before restoring. Reach-dependent showdown caches are scoped to a traversal. Session resets also clear retained reach-cache entries.
- Frequency pruning remains experimental. A probe restores the complete action set on its schedule. Training and the current masked average can change, so algorithm comparisons use independently measured full-action gaps.

The bundled legacy WASM binaries retain their original bytes. The source-backed C build produces both scalar and SIMD128 assets with Clang and LLD 19.1.7 and Node.js.

```sh
scripts/build-turn-river-wasm.sh
CHECK=1 scripts/build-turn-river-wasm.sh
```

Set `CLANG` to an alternate compiler path if required. The module imports its linear memory and uses Float64 without fast-math. The generated browser asset is `public/turn-river-lab/native-kernel-data.js`.

Build the optional native addon using Node development headers. The build script supports Linux and macOS with a C11 compiler. This stage measured Linux x86-64. The C ABI uses 32-bit offsets and is independent of the host pointer width. macOS, ARM64 and Windows performance remain to be measured.

```sh
NODE_INCLUDE=/path/to/node/include/node scripts/build-turn-river-native.sh
node scripts/solve-turn-river.mjs native-jobs.json --workers 2
```

The default addon uses the compiler's baseline ISA. Set `CPU_CFLAGS` to compare a host-tuned build, and use `NATIVE_OUTPUT` with `nativeAddon` to choose its output and load path. Keep floating-point contraction and fast-math disabled when checking parity.

See [the benchmark report](turn-river-benchmarks.md) for the measured performance, exact-flop capacity, and remaining optimization opportunities.
