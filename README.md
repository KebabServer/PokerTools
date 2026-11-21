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

Sign in at the site entrance. You can sign out from **Library**. Use **Save hand** in Replayer to save a completed hand and its notes. **Save notes** updates the notes on an open saved hand. In Equity, use **Save calculation** after a calculation to keep its inputs and exact or estimated results. Open or delete either kind of item in **Library**.

## Deploy with GitHub Pages

1. In the repository, open **Settings → Pages**, then select **GitHub Actions** under **Build and deployment → Source**.
2. For sign-in and the study tools, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` under **Settings → Secrets and variables → Actions → Variables**. Both values are public client configuration.
3. Push to `main`, or run **Deploy PokerTools to GitHub Pages** from the Actions tab. Rerun the workflow after changing the variables. The workflow tests and builds the site, then publishes `dist/` under `/PokerTools/`.

## Using the tools

- In **Hand Replayer**, enter seats in clockwise order and identify the dealer. Enter blinds, an optional per-seat ante, and any known cards. Record each acting player's action in order. A raise amount is the player’s total commitment for the current street. Chip amounts support up to two decimals. The replay returns unmatched chips and shows each side pot separately. At a showdown with unknown cards, any pot whose winner depends on those cards stays unresolved.
- In **Equity Calculator**, enter `AsKd` or a comma-separated range such as `77+, AJs+, KQo, A5s-A2s`. Use `random` for all starting hands. The grid adds or removes whole starting-hand classes. The board takes 0, 3, 4, or 5 cards and the dead-card field is optional. Exact mode counts legal matchups and board runouts. Estimated mode samples legal matchups and runouts in a cancellable Web Worker. Wins are outright wins and ties are outcomes where the player shares first place. Equity credits the player with their fraction of the pot. Calculations run in the browser. Inputs and results are stored in your private library when you save them.
- In **Preflop Viewer**, choose a preset and select a spot to see its range on the 13×13 grid. Select a hand to compare its frequencies across the RFI, 3-bet, and 4-bet position matrices. Gray marks the share without a listed action. The viewer loads the four presets from Supabase.
- In **Flop Reports**, choose the pot type, positional matchup, and action line. Each bar shows the action mix for one solver flop, grouped by board texture. Hover over a bar for a preview, or tap it to open the flop, its IP and OOP EV, and its action frequencies. Use the arrow buttons in the details to step through boards. The site loads the selected report from Supabase.
- In **Flop Viewer**, select a configuration, flop, and decision node. Select a hand on the 13×13 grid to see exact combos, action frequencies, and available EVs. The chart removes board blockers and weights the action and hand-class totals by each exact combo's range weight. Gray in the grid includes available combos that do not reach the selected node. The migration adds an illustrative example so you can try the viewer before importing ranges.
- In **Notes**, write and reopen private notes. Use the toolbar to add Markdown formatting and **Preview** to see how the note renders. Use **Save**, Ctrl+S, or Cmd+S to save your changes. Your first line becomes the title if you leave the title blank.

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
