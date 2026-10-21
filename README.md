# ootp-front-office

Analysis of the RLB online league (OOTP 27) from in-game CSV exports.

Setup: `python3 -m venv .venv && .venv/bin/pip install -r requirements-export.txt` on the Mac running OOTP (`requirements.txt` alone is enough to run the model and the web app on existing data). MIT licensed.

## Web app

```bash
.venv/bin/python serve.py                 # http://127.0.0.1:8000 (serves the built UI + the API)
cd ui && pnpm install && pnpm build       # once, and after UI changes (builds into web/static/)
cd ui && pnpm dev                         # while editing the UI: http://localhost:5173, hot reload, API proxied to :8000
```

React (Vite, TypeScript, Tailwind CSS v4 with a few Radix and cmdk primitives in `ui/src/components/ui.tsx`, React Query, React Router) in `ui/`, over a FastAPI JSON API in `web/` (`web/app.py` routes, `web/context.py` model data, `web/store.py` your data, `web/plans.py` lineup/staff plan definitions).

Pages: **Plan** (the home page). Pick a season (next season through the core three out); the model builds that season's lineup (one lineup, with vs-LHP swaps), rotation and bullpen from who's on the roster then, and you pin a slot where you disagree. Your inputs are roster decisions: let someone go (declined option, release, non-tender), plan a free-agent signing (at his ask, else the typical price), Rule 5 protect/expose. Weak or open slots offer fixes (your bench, free agents, trade targets with a link to the trade lab), a Decide list collects what needs your call before next season, and a by-year grid shows every season's plan at once (`web/planner.py`). **Market**: free agent board, trade targets, trade lab, platoon and gem reports, standings. **Players**: any org's roster, contract end dates, the model's reports. **Log**: your transaction log with notes, strategy notes and the trade block.

Model data is read from `rlb.duckdb` and rebuilt in memory when that file changes, so after `refresh.py` just reload. Your plans, trade block, move notes and **contract end dates** live in `data/app.sqlite`. The export counts team option years as guaranteed, so set when a player's control really ends (declined/exercised options, releases) on the Free agency page; lineups, free agency, the team plan and the 40-man all follow it. That file is never touched by refreshes; the first run seeds it from the strategy notes you kept before.

Hosting: the public demo runs on Vercel from this repo (`index.py` → `web/app.py`, UI built into `web/static/` and served by the same app, see `vercel.json`). It's read-only (`READ_ONLY=1`, on by default on Vercel): every page works, edits are refused, and your plans are whatever `data/app.sqlite` held when you last pushed. To update it, refresh, then commit and push `rlb.duckdb` (plus `data/app.sqlite` for your plans). Everything the app needs from the league folder (team names, standings, transaction logs) is copied into `rlb.duckdb` at refresh, so it runs without OOTP. To use it with edits from elsewhere, keep it running here and share it privately (e.g. Tailscale): `APP_PASSWORD=... .venv/bin/python serve.py --host 0.0.0.0`. With `APP_PASSWORD` set, everything asks for the password (any username).

## Refresh after each league file download

With OOTP open on the RLB league, from the terminal app that has Accessibility + Screen Recording access:

```bash
.venv/bin/python refresh.py           # export every view from OOTP, load, fit, report (~4 min)
.venv/bin/python refresh.py --watch   # leave running: does the above after each new league file download
```

It prints the team report and saves the offseason report to `out/<team>_offseason.txt`, with full lists in `out/*.csv`.

`refresh.py --skip-export` skips the OOTP export and reloads what's already on disk (the CSVs plus your team file), so after changing lineups and exporting your team for upload it picks up the new setup without touching the game.

The export drives the game window (`export.py`, using `ootp_ui.py` and the screenshots in `ui_templates/`), so keep your hands off the mouse while it runs. Moving the mouse stops it. If an OOTP update changes a screen and a step can't find its button, re-crop that template from a fresh screenshot with `ootp_ui.save_template`.

The individual steps also run on their own:

```bash
.venv/bin/python export.py [view ...]  # just the OOTP exports (default: all)
.venv/bin/python load.py               # snapshot exports into data/snapshots/<league file time>/, rebuild rlb.duckdb
.venv/bin/python talent.py             # fit ratings -> results, write hit_talent / pit_talent / talent_coef
.venv/bin/python history.py            # parse player history logs: OSA ratings by year, contracts, injuries, draft
.venv/bin/python value.py              # aging, projections, market prices, contract surplus, potential-jump odds
.venv/bin/python report.py [team]      # team report (default Halifax; pass another MLB short name to scout them)
.venv/bin/python offseason.py [team]   # contract value, re-sign/arb calls, FA board, depth/needs, trade targets, gems, jump odds
```

## Trades (trade.py)

```bash
.venv/bin/python trade.py value "Joaquín Rosa"                                # value card + season-by-season breakdown
.venv/bin/python trade.py eval --give "Joaquín Rosa" --get "Lucien Salieri"   # is this deal good?
.venv/bin/python trade.py shop "Joaquín Rosa"                                 # selling: what to ask for
.venv/bin/python trade.py offer "Lucien Salieri" --protect "WILL WRIGHT"       # buying: packages to offer
```

```bash
.venv/bin/python trade.py comps "Joaquín Rosa"   # what similar players fetched in real RLB trades
.venv/bin/python trade.py picks                  # average value of a pick by round; use R1, R2, ... in --give/--get
```

Names match without accents/case; use `Name@Org` or `id:N` when ambiguous. Every player has two values in $M of surplus: **surplus** (our ratings-based view) and **perceived** (how other GMs likely price him: each projected season shifted toward this year's WAR pace by `--stats`, default 0.25, scaled by sample size; league-minimum seasons worth `--premium` times more, default 1.5, since RLB GMs pay up for cheap control; minor leaguers discounted for bust risk by level; hitters valued at their best credible position (rating 50+) with only `--defense`, default 0.4, of an above-average glove, since GMs pay for bats and power; catchers' framing counts in full). Trades are parsed from the player logs (`hist_trades`); fitting values to them didn't work yet (too few recent trades, rated with today's ratings), so `comps` is the reality check. A good trade looks fair on perceived but wins on surplus and on your next-season depth chart (`your_depth`). `--now 1.3` weights next season more for a contender. We can't see the OVR/POT stars other GMs see, so perceived is an estimate.

`load.py` rebuilds the database from scratch, so run `talent.py`, `history.py` and `value.py` after it (refresh does).

## Exports used

All from RLB → Transactions → Players → RLB Player List, with minor leaguers, international complex and free agents included:

| View (position filter) | Table |
| --- | --- |
| Default, all players (has ID, team, level) | `players` |
| Financial Info / Personality & Morale, all players | `contracts` / `personality` |
| Batting Ratings / Batting Potential / Fielding Ratings / Position Ratings, batters | `bat_ratings` / `bat_potential` / `fielding` / `position_ratings` |
| Batting Stats Main / Batter Prospect, batters | `bat_stats` / `bat_profile` |
| Pitching Ratings / Pitching Potential / Individual Pitch Ratings / Individual Pitch Potential, pitchers | `pit_ratings` / `pit_potential` / `pitches` / `pitch_potential` |
| Pitching Stats Main / Pitcher Prospect, pitchers | `pit_stats` / `pit_profile` |

Your own setup comes from the team file OOTP writes when you export your team for upload (`import_export/team_<id>.ootp`), read by `teamfile.py` (`.venv/bin/python teamfile.py` prints it):

| Table | What |
| --- | --- |
| `my_lineups` | batting order and position vs RHP (`vs = 'R'`) and vs LHP |
| `my_depth` | depth chart per position (slot 1 starter, 2-3 backups with their "Starts" setting), pinch hitters `PH`, pinch runners `PR` |
| `my_rotation` | rotation slots |
| `my_roster` | `active` (who can play now: the playoff roster in October), `mlb` (MLB roster incl. inactive), `mlb_il` (plus injured list), `forty` (40-man) |

The format is undocumented: the offsets in `teamfile.py` were mapped against the game screens, and `load.py` skips a table if any id in it isn't a known player (a sign the layout changed). Bullpen roles aren't decoded yet. It's only as current as your last team export, and the report prints when that was.

Stats views only fill in MLB stats. Any other `rlb_*.csv` export is loaded as a table named after its file. Every table has a `snapshot` column; `cur_*` views show the latest snapshot.

## Notes

- Ratings are your scout's view (`sctacc`), not true ratings.
- Minor-league players are mapped to their MLB org (`players.org`) from the org transaction logs in `rlb.lg/news/txt/teams/`.
- Sortable Stats views abbreviate first names; they're matched to players by abbreviated name + age + position.
- `xwrc` / `xfip` come from one season of MLB results (R² ≈ 0.48 hitters, 0.34 SP, 0.46 RP). Treat them as a ranking, not a projection.

## Value model (value.py)

- **History**: `rlb.lg/news/txt/players/*_history.txt` logs OSA's current (potential) Contact/Power/Eye or Stuff/Movement/Control every Jan 1, plus every contract, injury and draft pick. OSA matches the team scout almost exactly at Very High accuracy.
- **Aging**: average year-over-year change in those ratings at each age, from players still in the league (retired players have no birth date, so late declines may be slightly understated). Under 27, a player closes a share of his gap to potential each year and potential drifts as it historically has; from 27, the average decline applies. Defense and speed are held constant.
- **xWAR**: hitters WAR/600 = 0.078 × xwRC+ + 0.057 × (position rating − position average) + 0.015 × speed + a position constant, at his best position (rating 40+) or DH. For catchers, defense is framing (0.175 per point, about three times a position-rating point) and arm instead of the position rating. SP WAR/180 IP = 11.35 − 2.01 × xFIP, over 32 starts at the length his stamina allows (stamina 50 → 184 IP, 75 → 202); SP xFIP also includes stamina (high-stamina starters beat their stuff/control). RP WAR/65 IP = 4.9 − 1.0 × xFIP. Individual pitch ratings, velocity and number of pitches add nothing beyond the composites. Scaled by expected health (proneness label blended with the last 3 years of injury days).
- **Relievers**: replacement is 0.3 xWAR (vs. 1.0 for hitters/starters; the best unsigned relievers project ~0.3-0.8), and their value is priced at 1.4x above replacement for leverage (closers turn WAR into ~1.6x as much WPA, setup men ~1.25x, others ~0.7x). Depth-chart bullpen slots use those per-role multipliers.
- **Defense by position**: per-position slopes (CF highest, 1B lowest) shrunk halfway to the pooled one.
- **Depth charts**: lineups vs. RHP and vs. LHP are optimal assignments (scipy), not greedy, so e.g. a great-glove CF can push a better hitter to a corner.
- **Money**: value = $0.79M + about $10M per xWAR above 1.0 (replacement: 1+ xWAR players sit unsigned), from the last two winters' FA signings; "typical price" is the median-fit price, which is much flatter (the market underpays stars and is very noisy). Arbitration awards are fit directly (about -$1.9M + $2.0M per xWAR + $1.0M per service year) and rarely drop below last year's salary. Surplus is value minus cost over guaranteed, extension and team-control years, discounted 10% a year.
- **Splits**: each hitter's vs-RHP/vs-LHP expected wRC+ (from the split contact/power/eye ratings) is carried into next season's position values. Depth charts build separate lineups vs. RHP and vs. LHP and blend them by the share of MLB innings thrown by lefties (~23%), so platoons are valued in depth charts and trades. The offseason report lists cheap platoon upgrades.
- **Ceiling**: `value.ceiling_xwar` is next season's xWAR if he reached every potential rating today; the projection assumes he usually won't (potentials historically drift down for young players).
- **Potential jumps (TCR)**: logistic model on age, gap to potential, and last year's change in current and potential ratings; fit on older years and recalibrated on the latest update. Out of sample, its top 10% jumped 29% of the time vs. 13% overall. Work ethic and intelligence barely matter.
