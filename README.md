# PokerTools

PokerTools is a static React and Vite site for No-Limit Texas Hold’em cash games. It runs at [kebabserver.github.io/PokerTools/](https://kebabserver.github.io/PokerTools/). All tools require Supabase sign-in with a PokerTools member account. GitHub Pages serves the public sign-in page and app code. Supabase controls access to study data and personal records.

## Local setup

Use Node.js 24 and npm. Clone the repository, then run:

```sh
npm ci
npm test
npm run dev
```

Open <http://localhost:5173/PokerTools/>. For a local production check, run `npm run build` and `npm run preview`, then open <http://localhost:4173/PokerTools/>.

## Private library

1. Create or select a Supabase project for PokerTools. In the project's SQL Editor, run the migrations in order from [supabase/migrations](supabase/migrations). If you manage migrations from the CLI, link this repository to that project and use `supabase db push`.
2. In Authentication settings, keep the Email provider enabled and turn off **Allow new users to sign up** and anonymous sign-ins. In **Authentication → Users**, add and confirm the email/password user you will sign in with. The membership migration enrolls existing confirmed accounts. For an account created later, add its user ID to `public.pokertools_members` in the SQL Editor. Set the Auth Site URL to `https://kebabserver.github.io/PokerTools/`.
3. Ensure `public` is exposed to the Data API. The migrations use row-level security to make saved items and imported flop ranges visible to their owners and make shared study data available to signed-in accounts. The login migration copies and checksums the study files from an earlier GitHub revision.
4. Copy `.env.example` to `.env.local`. Set `VITE_SUPABASE_URL` to the project URL and `VITE_SUPABASE_PUBLISHABLE_KEY` to its `sb_publishable_` key, then restart Vite. Use only the publishable key in those settings. Vite embeds these values in the public JavaScript bundle.

Sign in at the site entrance and sign out from **Settings**. Use **Save hand** in Replayer to save a completed hand and its notes. **Save notes** updates the notes on an open saved hand. In Equity, use **Save calculation** after a calculation to keep its inputs and exact or estimated results. Open or delete either kind of item in **Library**.

**Settings** reads database size and stored file bytes through the member-only `pokertools_project_usage` function. Database headroom is an estimate against the 500 MB Free Plan limit. Use **Open Supabase Usage** for organization-wide storage and billing-cycle quotas such as bandwidth and monthly active users.

## Deploy with GitHub Pages

1. In the repository, open **Settings → Pages**, then select **GitHub Actions** under **Build and deployment → Source**.
2. For sign-in and the study tools, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` under **Settings → Secrets and variables → Actions → Variables**. Both values are public client configuration.
3. Push to `main`, or run **Deploy PokerTools to GitHub Pages** from the Actions tab. Rerun the workflow after changing the variables. The workflow tests and builds the site, then publishes `dist/` under `/PokerTools/`.

## Using the tools

- In **Hand Replayer**, enter seats in clockwise order and identify the dealer. Enter blinds, an optional per-seat ante, and any known cards. Record each acting player's action in order. A raise amount is the player’s total commitment for the current street. Chip amounts support up to two decimals. The replay returns unmatched chips and shows each side pot separately. At a showdown with unknown cards, any pot whose winner depends on those cards stays unresolved.
- In **Equity Calculator**, enter `AsKd` or a comma-separated range such as `77+, AJs+, KQo, A5s-A2s`. Use `random` for all starting hands. Choose **Matrix** beside a player’s text field to add or remove whole starting-hand classes. The matrix reflects typed ranges and marks partially selected classes. The board takes 0, 3, 4, or 5 cards and the dead-card field is optional. Exact mode counts legal matchups and board runouts. Estimated mode samples legal matchups and runouts in a cancellable Web Worker. Wins are outright wins and ties are outcomes where the player shares first place. Equity credits the player with their fraction of the pot. Calculations run in the browser. Inputs and results are stored in your private library when you save them.
- In **Preflop Viewer**, choose a preset and select a spot to see its range on the 13×13 grid. Select a hand to compare its frequencies across the RFI, 3-bet, and 4-bet position matrices. Gray marks the share without a listed action. The viewer loads the four presets from Supabase.
- In **GTO Library**, follow GTO Wizard Simple preflop lines for six players at 100 bb. Select an action to advance the table, or use the history and arrows to revisit a decision. After preflop, choose a board to check the private flop catalog. [Source coverage and catalog setup](docs/gto-library.md)
- In **Flop Reports**, choose the pot type, positional matchup, and action line. **4-bet IP** and **4-bet OOP** show the supplied C-bet reports. Each bar shows the action mix for one solver flop, grouped by board texture. Set **Sort by** to **Lowest card** to order the flops inside each texture by their lowest rank. Hover over a bar for a preview, or tap it to open the flop, its IP and OOP EV, and its action frequencies. Use the arrow buttons in the details to step through boards. The site loads the selected report from Supabase.
  - Open **Trainer** to practice the selected report. **Sizing** asks for the most-used bet or raise size across the range and accepts tied top sizes. **Roll** gives you a number from 0 to 100 and asks which action covers it when the report frequencies are laid out in button order. At a shared boundary, the next band starts there. The last band includes 100. Each mode keeps its own score and shows an action-mix gradient after each answer.
- In **Flop Viewer**, select a configuration, flop, and decision node. Select a hand on the 13×13 grid to see exact combos, action frequencies, and available EVs. The chart removes board blockers and weights the action and hand-class totals by each exact combo's range weight. Gray in the grid includes available combos that do not reach the selected node. The migration adds an illustrative example so you can try the viewer before importing ranges.
- In **Solver**, TurnRiverLab v16.13 runs heads-up flop, turn, and river solves in the browser. In **Setup**, enter the board, pot, stack, and ranges, or open the **Flop library** to continue a saved flop line. Expand **Bet sizes**, **Betting tree**, and **Advanced** to change the game and solver settings. Use the fixed **Solve** / **Stop** bar to run a solve and follow exploitability. In **Strategy**, select a bet or card to follow the game tree and select a hand in the grid to inspect exact combos. Open **Lock strategy** for node locks and **Diagnostics** for convergence and run logs.
  - In a Nash / GTO solve, **Frequency increments** sets the allowable action frequencies for each exact hand by street and position. Use 0 for unrestricted mixes or a step that divides 100 evenly. A 25% step allows 0%, 25%, 50%, 75%, and 100% per action, with each hand’s mix totaling 100%. Exploitability is measured on the strategy that uses the increments. Coarser steps can make the target harder to reach.
  - Use **Files** to open and export solutions, save and resume checkpoints, and manage solutions saved in this browser for the signed-in account. Choose **Numerical storage** and **Storage precision** under **Runouts & optimizations**. The default is Float64. See [solver storage](docs/solver-numerical-storage.md), [mixed-precision accuracy and recommendations](docs/solver-precision.md), [WebAssembly SIMD performance](docs/solver-simd.md), and [exact flop capacity and all-in benchmarks](docs/solver-tree-compression.md).
  - For large exact flop games, **Advanced** allows up to 1,000,000 tree records. The capacity preview estimates records, strategy storage, WASM memory, and peak preparation memory. [Capacity limits and BTN versus BB benchmarks](docs/solver-capacity.md)
  - Local solver research runs through the Node.js API and batch CLI. They support reusable sessions, warm starts, exact-flop memory experiments, and an optional native addon. [Research solver guide](docs/turn-river-solver.md)
  - On a flop, choose **Dynamic sampling (experimental)** under **Runouts & optimizations** to vary the public runouts visited during DCFR training. The turn and river budgets affect training cost. The exact diagnostics still use the complete game. [Sampling math and benchmarks](docs/solver-public-chance.md)
  - Open **Heuristic Tester** in flop Setup to compare JSON rules at one Hero decision. Preview the combo mixes and run the candidates against a shared unrestricted baseline. The results show equilibrium EV-loss intervals and export to JSON. [Rule format, examples, and benchmarks](docs/heuristic-tester.md)
  - Choose **Multiple flops** in **Heuristic Tester** for probability-weighted results across a list or the complete flop population. Export JSON or CSV, or resume a saved run. [Multi-flop setup, weights, and coverage](docs/heuristic-multi-flop.md)
- In **Notes**, use **Add page** and the arrows in **Preview** to create and switch pages. Select the page counter to open the page list and use the up and down arrows to reorder pages. Use **Edit** to name a page and write Markdown. Search matches note titles, page names, and page text. Pin important notes and use the toolbar to format text. **Insert table** adds a table with the number of columns and body rows you choose. In **Edit**, choose **Note actions** and **Link note** to create a sub-note or link an existing note. Open the link in **Preview**. Notes and pages autosave. If a save fails, use **Retry**. If another device changed or deleted the note, use **Save a copy** to keep your draft.

## Download your data

Open **Library**, choose **Prepare backup**, then select **Download backup**. The versioned JSON file includes your saved hands and hand notes, equity calculations, Notes pages and links, imported Flop Viewer spots, and Solver solutions saved in the current browser. For Solver solutions stored on another device or browser, prepare a backup there as well.

## Import flop ranges

After signing in, open **Flop Viewer → Import ranges** and choose a JSON file or an existing Flop Viewer TSV. **Save to Supabase** writes the spots to your account. Importing the same configuration and flop replaces its nodes. The tab reads the saved strategies from Supabase.

A JSON file takes one spot object or an array of spots. Give each action a label and optionally a hex or named color. Provide combo weights from 0 to 1, action frequencies as percentages, and optional EVs in the same action order. Use `null` for an individual missing EV.

```json
{
  "configuration": "BTN vs BB",
  "board": "Ah7h2c",
  "nodes": [
    {
      "name": "BTN c-bet",
      "actions": [{ "label": "Check" }, { "label": "B33" }],
      "combos": [
        { "hand": "AsKs", "weight": 0.8, "frequencies": [35, 65], "evs": [3.4, 3.5] }
      ]
    }
  ]
}
```

The legacy import reads `Configuration`, `Board`, and the numbered `NodeName`, `PreflopRange`, `RangeColors`, and `Freqs` columns. Legacy action labels follow the source color order and display as **Action 1**, **Action 2**, and so on.

## Import 4-bet flop reports into a new project

Run the repository migrations first. From the repository root, extract the supplied ZIP and convert its solver exports to the legacy CSV format.

```sh
unzip /path/to/4Bet.zip -d /tmp/pokertools-exports
node scripts/convert-4bet-reports.mjs /tmp/pokertools-exports/4Bet /tmp/pokertools-reports
```

The output contains the CSVs and an `import-4bet-reports.sql` file. Run the SQL with an administrative Postgres connection to the new project to load `study_files`. Store the generated files outside the public repository and site build.

## Set up the solver’s flop library

The Solver tab’s bundled flop library is stored in `study_files` at `turn-river-lab/flop-library.tsv`. To seed another project, use the TSV text from the `FLOP_LIBRARY_DATA` string in the TurnRiverLab release. The Solver can also import a local FlopViewer TSV.
