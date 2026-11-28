# GTO Library v1

Open **GTO Library** after signing in. The table starts at UTG with six 100 bb stacks and 0.5/1 bb blinds. Choose an action to advance the betting history. Back, forward, and the history buttons restore the pot, stacks, and acting seat at that point. Reset returns to UTG. After preflop, open **Choose flop**, select three cards from the deck, and choose **Set flop**. Tap a selected card again to remove it. Turn and River show placeholders once the flop has been entered.

The browser uses the `GTOw 500nl Simple` preset from the existing private `preflop-ranges.tsv` study file. The export records each spot's actor, invested amounts, action labels, and strategy vectors. Starting stack depth and rake parameters are unspecified in the export. V1 uses the requested 100 bb configuration and reports gross pots before rake. Folded contributions stay in the pot. The game returns unmatched chips when preflop ends.

## Source coverage

| Decision | Coverage |
| --- | --- |
| Raise first in | Five rows from UTG through SB. Folds before the opener are legal. Only actions listed in the row have known frequencies. |
| Facing an open | Fifteen response rows from players behind the opener. The acting seat and all six investments must match the export. |
| Opener facing a 3-bet | Fifteen rows for the original opener against one 3-bettor. All others must have folded. The investments must match the export. |
| Other decisions | Limps and iso-raises, squeezes, overcalls, cold 4-bets, responses to a 4-bet or most jams, and size variants outside the supplied rows have gaps. Legal actions shown in those gaps carry unavailable frequencies. |

The SB opening row lists a 2.5 bb raise. The separate BB response and SB 4-bet rows assume a 3 bb open. The app exposes both opening totals so you can inspect those lines. The 3 bb opener's frequency and incoming range are unknown. The 2.5 bb line has no matching BB response row.

`Raise …bb` is a raise-to total. `All In`, `Call`, `Fold`, and `Check` are direct actions when legal in the current state. Conditional labels such as `R7.5bb/C` or combined plans such as `R/R27bb` cannot supply a frequency for one immediate action. The adapter retains the exported labels and leaves these actions unmapped. Gray in the matrix is unlisted share. It can include a genuinely missing action or reach from hands outside an opening range.

The import preserves all 1,326 values per action as Float64 in `cdhs-low-major-v1` order. Card IDs run from 0 to 51 in ascending rank with clubs, diamonds, hearts, and spades within a rank. The TSV orders each pair by its higher card, then its lower card. The importer remaps that order to lower card first and averages each hand class in the original export order. The GTO Library and Preflop Viewer share the same matrix for those raw averages.

Range-wide percentages divide exported action mass by the actor's known incoming range mass, using that player's combination weights. The exported 4-bet response weights already include the opener's reach when their per-combo sums match the known opening weights within the export's rounding tolerance. The adapter uses those weights directly. If the incoming range cannot be verified, the raw row remains visible and range-wide percentages stay unavailable. Source rounding is preserved.

The flop matchup includes exact positions, history, pot, effective stack, and known incoming weights. Choosing a board removes blocked combinations from each known range. Multiway pots retain all seats and their contributions. Catalog lookup is limited to heads-up pots with stack left to play. A missing strategy stays unavailable, including when an acting range passed through an undocumented branch.

## Catalog and private storage

Apply [the additive GTO Library migration](../supabase/migrations/20261128101152_gto_library_v1.sql) with the repository's Supabase migrations. The migration reuses the existing study file and seeds the initial strategy revision only if its content SHA-256 matches the verified export. It starts with no flop solution rows or binary files.

| Table | Purpose |
| --- | --- |
| `gto_game_configs` | Game variant, seat count, blinds, effective starting stack, and optional rake. Chip amounts are in hundredths of a big blind for the initial game. |
| `gto_libraries` | Named study collections linked to a game configuration. |
| `gto_strategy_versions` | Study path, preset, source SHA-256, combo order, and adapter version for each revision. |
| `gto_preflop_nodes` | Logical node keys, parent references, actor, source spot, and optional action metadata within a revision. The browser reconstructs preflop from the TSV. |
| `gto_postflop_matchups` | Exact preflop history key, IP and OOP positions, starting pot and stack, and a fingerprint for the solver configuration and ranges used by the solution. |
| `gto_flop_solutions` | Index by library, revision, matchup, and three sorted card IDs. Each row includes the binary format version, private object path, and SHA-256, plus an optional action EV object and hash. |

The app looks up the latest revision matching the loaded source, preset, adapter, and combo order. An index entry marks that exact preflop history and physical board as available. V1 reports catalog availability, with strategy loading and postflop solving reserved for future releases.

`gto-strategy-files` is a private bucket for future payloads. Store flop strategies under `<library>/<revision>/flops/` and optional EV data under `<library>/<revision>/ev/`. Keep versioned import packages in Storage as well. The database holds metadata, with frequencies and EVs packed in their corresponding assets. Signed-in PokerTools members can read catalog rows and files. Operators publish through server-side administrative access. The browser continues to use the existing Supabase publishable key and uses no service-role credentials.

The rules in `src/gtoGame.ts` run independently of the TSV adapter in `src/gtoPreflop.ts`. Each node has a stable logical ID, parent ID, legal child references, game state, range provenance, and strategy availability. Strategy actions can include exact-combo EV vectors. Later street adapters can attach their own strategies using the same position, history, and public-card keys. Map solver combo order explicitly when importing its results.

Run `npm test` for the game and source regressions. On a Supabase test project with the migrations and matching study fixture installed, run `supabase test db supabase/tests/gto_library_access.sql`. The SQL check runs in a rolled-back transaction.
