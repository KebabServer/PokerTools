# TurnRiverLab solver

TurnRiverLab solves a heads-up postflop betting abstraction with two weighted exact-combo ranges, an equal effective stack, and no rake. The browser and Node.js use the same Float64 engine. The browser retains its worker and cooperative fallback. The Node entry point is [solver/index.mjs](../solver/index.mjs).

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
  maxRaises: 0, weights0, weights1,
})

const unrestricted = prepared.createSession()
const baseline = unrestricted.solveUntil({ targetEVWidth: .01 })
const candidate = prepared.createSession()
const root = candidate.describe().root
candidate.setNodeLocks([
  candidate.makeLock(root, { comboPercentages: { [combo('Ks', 'Qs')]: [0, 100] } }),
])
candidate.warmStartFrom(unrestricted, { mode: 'combined', regretDiscount: .25 })
const result = candidate.solveUntil({ targetEVWidth: .01, baseline, hero: 0 })
console.log(result.equilibriumBounds.foldZero[0], result.evLoss, result.terminationReason)

const detail = candidate.nodeReport(root)
const counterfactuals = candidate.counterfactualActionValues(root, 'constrainedBest')
const { config, checkpoint } = decodeCheckpoint(candidate.encodeCheckpoint())
const resumed = prepareGame(config).createSession({ checkpoint })
```

- `prepareGame(config, { backend: 'javascript' })` selects the reference engine. The default attempts WASM and falls back according to the engine's reported backend.
- `decision(id)` and `findDecision(history)` expose the structural decision and its action order. Whole-node locks supply `percentages`. Combo locks supply `comboPercentages` keyed by exact combo ID. Remaining rows continue learning.
- `nodeReport(id)` returns the average mix and fold-zero action and profile EVs at a selected node. `counterfactualActionValues(id, continuation)` returns centered action CFVs weighted by compatible opponent and chance reach. It includes actions with zero policy probability. Continuations can use the average profile, a constrained best response, or an unrestricted best response.
- `metrics()` returns profile EVs, best-response values, bounds, and convergence in an EV-only summary. `solveUntil()` also returns the rule and configuration fingerprints, algorithm version, phase timings, memory estimates, process RSS observations, and termination reason.
- `setNodeLocks()` resets learned state and updates fixed rows immediately. `resetSolverState()` clears strategies, averages, regrets, pruning, and iteration schedules while retaining the current lock assignment.
- `solveUntil()` takes an additional iteration budget per call. It can stop at `targetEVWidth`, `targetExploitability`, `maxIterations`, `maxRuntimeMs`, or `maxMemoryBytes`. An optional comparable `incumbent` enables elimination when the candidate's upper EV bound is below the incumbent's lower bound. A final compact EV evaluation is returned after a budget stop.
- `saveCheckpoint()` and `restoreCheckpoint()` use the exact configuration and storage-layout fingerprint, including node locks. The binary codec uses the same format in the browser and Node. Old checkpoints can be migrated when the original numerical layout can be derived and verified. A changed symmetry layout can require a fresh solve.

### Warm starts

Warm transfer expects a second compatible GTO session. It can map state between different public symmetry layouts of the same full structural tree. Strategy transfer uses the donor's averaged continuation. Regret transfer discounts retained regrets and clears rows at, above, and below changed locks. A changed opponent policy can affect other branches in subsequent iterations, so retained regrets serve as initialization. The destination starts at iteration zero with empty strategy averages, no predictive deltas, and no culling masks. It evaluates the new restrictions immediately.

Use `mode: 'strategy'` for continuation policy, `'regret'` for discounted regrets, or `'combined'` for both. A cold reset provides the reference. Compare time at the same EV width. A warm hint can either help or slow convergence, depending on the game and change in restrictions.

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
  config: { ...flopConfig, flopSamplingMethod: 'suit-orbits', maxNodes: 180000 },
  fidelities: ['fast', { name: 'intermediate', turns: 20, riversPerTurn: 12 }, 'exact'],
  seeds: [29, 101, 509],
  candidates: [{
    id: 'small root mix',
    nodeLocks: [{ history: ['Flop'], percentages: [75, 25] }],
    warmStart: { mode: 'combined' },
  }],
  solve: { targetEVWidth: .2, maxIterations: 800, maxRuntimeMs: 10000 },
}, { workers: 2, maxMemoryBytes: 1024 ** 3, workerHeapMb: 256 })
```

The example assumes exactly two legal flop actions. A later-street lock can specify its history, and the worker resolves it against the actual sampled tree. A lock whose history is absent produces a candidate error. Exact enumeration runs once because the seed cannot change the full chance tree.

The batch CLI accepts a JSON job or array of jobs. Each job accepts `id`, `config`, `solve`, and optional `backend` and `candidates`. JSON configs contain regular arrays for combo weights.

```sh
node scripts/solve-turn-river.mjs jobs.json --workers 2 --memory-mib 1024 --worker-heap-mib 256
```

Workers solve independent games, reuse loaded modules between jobs, and return compact metrics in input order. The preparation budget estimates engine storage. The solve budget samples process RSS and includes WASM allocations. The worker heap limit applies to the V8 heap. Runtime and RSS checks are cooperative, so a single traversal, preparation, or final EV evaluation can exceed a requested budget transiently.

## Architecture and numerical audit

- `core.js` constructs the structural tree, prepares weighted private ranges, computes legal runout masks and showdown order, and implements reference CFR and evaluation. Full flop showdown layouts and legality tables are shared across swapped turn/river pairs. Forced one-action nodes retain their structural IDs and share their numerical rows.
- Prepared games share structural actions, chance outcomes, blockers, strength layouts, and suit maps. Sessions own strategy storage, locks, iteration counters, culling, and live scratch. Compatible lock changes reuse the numerical arena and compiled metadata. Changed suit layouts reuse the prepared game data and allocate a compatible arena.
- Public suit compression uses a subgroup preserving the starting board, exact weighted ranges, actual sampled outcomes and weights, and the complete set of locked rows and mixes. Later-street checks map each lock through its betting path. Canonical decisions keep their policies invariant under the stabilizer of their public cards. Reports expand the canonical rows back to each physical combo.
- `compiled-traversal.js` bridges the prepared game and linear memory. A native session allocates its state directly in linear memory. The existing SIMD and scalar kernels still serve ordinary training and QRE. The source-backed engine supplies locked GTO training and EV-only constrained evaluation, including projected frequency mixes. Source-backed constrained and unrestricted EVs share terminal calculations within a pass.
- `checkpoint-format.js` handles binary serialization and state checksums. Core validates the configuration, row layout, state length, and pruning masks before restoring. Reach-dependent showdown caches are scoped to a traversal. Session resets also clear retained reach-cache entries.
- Frequency pruning remains experimental. A probe restores the complete action set on its schedule. Training and the current masked average can change, so algorithm comparisons use independently measured full-action gaps.

The original WASM source was absent from the repository history and public upstream search. The bundled binaries retain their existing bytes. The new C module was written against the JS reference and the documented JS-to-WASM table layout. The build requires Clang and LLD 19.1.7 and Node.js.

```sh
scripts/build-turn-river-wasm.sh
CHECK=1 scripts/build-turn-river-wasm.sh
```

Set `CLANG` to an alternate compiler path if required. The module imports its linear memory and uses Float64 without fast-math. The generated browser asset is `public/turn-river-lab/native-kernel-data.js`.

See [the benchmark report](turn-river-benchmarks.md) for the measured performance, exact-flop capacity, and remaining optimization opportunities.
