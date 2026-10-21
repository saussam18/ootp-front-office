"""Offseason report: contract values, re-sign decisions, free agent board, needs, trade targets,
hidden gems and potential-jump (TCR) candidates.

    .venv/bin/python offseason.py [team]

Run value.py first. Full lists are also written to out/<team>_*.csv.
"""

import argparse

import duckdb
import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment

from load import DB, ROOT
from report import section, standings

pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 40)
pd.set_option("display.max_rows", 300)

HIT_POS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"]
SP_SLOTS, RP_SLOTS = 5, 7
PLATOON_MAX_COST = 6  # $M a year
CSV = {"contracts": "{team}_contracts.csv", "fa_board": "fa_board.csv", "trade_targets": "{team}_trade_targets.csv",
       "platoons": "{team}_platoons.csv", "jump_mine": "{team}_jump_odds.csv"}
M = 1e6


def load(con, nxt):
    return con.sql(f"""
        select p.id, p.name, p.pos, p.age, p.dob, p.lev, p.org, p.tm, p.b, p.t,
               v.* exclude (player_id),
               n.best_pos, n.xwrc, n.xfip, n.status status_next, n.cost cost_next,
               k.slr, k.yl, k.yl_status, k.secy, k.on40, k.opt, k.oy,
               s.loy, s.fin, s.we, s.int, s.type,
               coalesce(bp.prone, pp.prone) prone, coalesce(bp.dem, pp.dem) dem,
               three.x3, three.worth3, jo.p_jump
        from cur_players p join value v on v.player_id = p.id
        left join (select * from proj where season = {nxt}) n on n.player_id = p.id
        left join (select player_id, sum(xwar) x3, avg(market) worth3 from proj
                   where season between {nxt} and {nxt + 2} group by 1) three on three.player_id = p.id
        left join cur_contracts k on k.player_id = p.id
        left join cur_personality s on s.player_id = p.id
        left join cur_bat_profile bp on bp.player_id = p.id and p.pos not in ('SP', 'RP', 'CL')
        left join cur_pit_profile pp on pp.player_id = p.id and p.pos in ('SP', 'RP', 'CL')
        left join jump_odds jo on jo.player_id = p.id
    """).df()


RP_LEVERAGE = [1.6, 1.25, 1.25, 0.7, 0.7, 0.7, 0.7]  # WPA per WAR by bullpen role: closer, setup, the rest


def best_lineup(pv, col):
    """Optimal (not greedy) assignment of players to HIT_POS maximizing total `col`: {pos: (pid, xwar)}."""
    m = pv.pivot_table(index="player_id", columns="pos", values=col, aggfunc="max").reindex(columns=HIT_POS)
    if m.empty:
        return {}
    cost = -m.fillna(-50).to_numpy()  # unplayable positions are a huge penalty
    rows, cols = linear_sum_assignment(cost)
    return {HIT_POS[c]: (m.index[r], m.iat[r, c]) for r, c in zip(rows, cols) if not np.isnan(m.iat[r, c])}


def depth(players, pos_value, lhp=0.23):
    """Depth chart for one org: the best lineup vs. RHP and vs. LHP, then 5 SP and 7 RP.

    players: that org's players under control next season. lhp: share of PA vs. lefties.
    Each position's value is the vs-RHP starter's xWAR * (1 - lhp) + the vs-LHP starter's * lhp,
    stored under the position with the vs-RHP starter; "<pos> vL" holds the vs-LHP starter (0 xWAR,
    so totals still add up). Bullpen slots are weighted by the leverage they pitch in."""
    pv = pos_value[pos_value.player_id.isin(players.id)]
    hitters = pv[pv.pos.isin(HIT_POS)]
    lineups = {hand: best_lineup(hitters, f"xwar_{hand}") for hand in ("vr", "vl")}
    chart = {}
    for pos in HIT_POS:
        (r, wr), (l, wl) = lineups["vr"].get(pos, (None, 0)), lineups["vl"].get(pos, (None, 0))
        chart[pos] = (r, (1 - lhp) * wr + lhp * wl)
        chart[f"{pos} vL"] = (l, 0.0)
    sp = pv[pv.pos == "SP"].nlargest(SP_SLOTS, "xwar")
    rp = pv[(pv.pos == "RP") & ~pv.player_id.isin(sp.player_id)].nlargest(RP_SLOTS, "xwar")
    for i, (pid, w) in enumerate(zip(sp.player_id, sp.xwar)):
        chart[f"SP{i + 1}"] = (pid, w)
    for i, (pid, w) in enumerate(zip(rp.player_id, rp.xwar)):
        chart[f"RP{i + 1}"] = (pid, w * RP_LEVERAGE[i])
    return chart


def money(x):
    return x / M


class Report:
    """Everything the offseason report computes, for the terminal (main) and the web app."""

    def __init__(self):
        self.sections = []  # (key, title, DataFrame, rows to show in the terminal)
        self.notes = {}  # key -> one-line summary

    def add(self, key, title, df, show=None):
        self.sections.append((key, title, df, show))
        return df

    def get(self, key):
        return next(s[2] for s in self.sections if s[0] == key)


def build(team="Halifax"):
    rep = Report()
    con = duckdb.connect(str(DB), read_only=True)
    yr = con.execute("select max(year(date)) from hist_ratings").fetchone()[0]
    nxt = yr + 1
    rep.team, rep.yr, rep.nxt = team, yr, nxt
    df = load(con, nxt)
    pos_value = con.sql("select * from pos_value").df()
    proj = con.sql(f"select * from proj where season between {nxt} and {nxt + 2}").df()
    name = df.set_index("id").name.to_dict()

    table = standings()
    mlb = sorted(df.loc[df.lev == "RLB", "org"].dropna().unique())
    table["org"] = [next((m for m in mlb if t.startswith(m)), None) for t in table.team]
    pct = table.set_index("org").pct.to_dict()
    rep.standings = table

    # ------------------------------------------------ market and aging
    a = con.sql("select * from aging").df()
    coef = {m: dict(g[["term", "coef"]].to_numpy()) for m, g in con.sql("select * from talent_coef").df().groupby("model")}
    ages = range(24, 38)
    bat = a[a.kind == "bat"].pivot(index="age", columns="rating", values="delta").reindex(ages)
    pit = a[a.kind == "pit"].pivot(index="age", columns="rating", values="delta").reindex(ages)
    h = coef["hit"]
    sp = coef["SP"]
    curve = pd.DataFrame({
        "age": list(ages),
        "hitter xwRC+/yr": (bat.con * (h["babip"] + h["ks"] + h["gap"]) + bat["pow"] * h["pow"] + bat.eye * h["eye"]).round(1).to_numpy(),
        "SP xFIP/yr": (pit.stu * sp["stu"] + pit.mov * (sp["hra"] + sp["pbabip"]) + pit.con * sp["con"]).round(2).to_numpy(),
    })
    rep.add("aging", f"AGING: average change per season at each age (from {con.execute('select count(*) from hist_ratings').fetchone()[0]} OSA rating updates)",
            curve)

    # ------------------------------------------------ team contracts
    mine = df[df.org == team].copy()
    mine["avg_cost"] = money(mine.avg_cost)
    cols = ["id", "name", "pos", "age", "lev", "xwar_next", "peak_xwar", "control_years", "avg_cost", "surplus", "oy"]
    view = mine[(mine.lev == "RLB") | (mine.surplus > 10 * M)].assign(surplus=lambda d: money(d.surplus)).sort_values("surplus", ascending=False)
    rep.add("contracts", f"{team} CONTRACT VALUE (surplus = discounted value minus cost over the years you control him, $M; xWAR full season x health)",
            view[cols].round(1))

    committed = proj[(proj.season == nxt) & proj.player_id.isin(mine.id) & proj.status.isin(["contract", "extension", "arb"])]
    pre_arb = proj[(proj.season == nxt) & proj.player_id.isin(mine.loc[mine.lev == "RLB", "id"]) & (proj.status == "pre-arb")]
    rep.payroll = (money(committed.cost.sum()), money(pre_arb.cost.sum()), len(pre_arb))
    rep.notes["contracts"] = (f"{nxt} payroll: ${rep.payroll[0]:.1f}M committed incl. projected arbitration, "
                              f"+ ${rep.payroll[1]:.1f}M for {rep.payroll[2]} pre-arb players on the MLB roster")

    # ------------------------------------------------ re-sign or let walk
    fa_class = df[(df.status_next == "free agent") & df.lev.notna() & df.lev.isin(["RLB", "AAA"])]
    leaving = fa_class[fa_class.org == team].sort_values("xwar_next", ascending=False)
    rows = []
    for _, r in leaving.iterrows():
        alts = fa_class[(fa_class.org != team) & (fa_class.pos == r.pos)].nlargest(3, "xwar_next")
        rows.append({
            "id": r.id, "name": r["name"], "pos": r.pos, "age": r.age, "now_salary": money(r.slr), "xwar_next": r.xwar_next, "x3": r.x3,
            "worth_1y": money(r.market_next), "worth_3y_aav": money(r.worth3), "typical_price": money(r.price_next),
            "loyalty": r.loy, "greed": r.fin,
            "best FA alternatives (xWAR, typical $M)": "; ".join(f"{n} {w:.1f}/{money(p):.0f}" for n, w, p in zip(alts["name"], alts.xwar_next, alts.price_next)),
        })
    rep.add("resign", f"RE-SIGN OR LET WALK: {team} players reaching free agency ($M; worth = most you should pay per year, typical = what the market usually pays)",
            pd.DataFrame(rows).round(1))

    arb = proj[(proj.season == nxt) & (proj.status == "arb")].drop(columns="age").merge(df[["id", "name", "pos", "age", "org", "xwar_next"]], left_on="player_id", right_on="id")
    arb["decision"] = np.where(arb.market >= arb.cost, "tender", "non-tender?")
    rep.add("arb", f"{team} ARBITRATION: projected award vs. what he's worth ($M)",
            arb[(arb.org == team) & ((arb.xwar_next >= 0.5) | (arb.player_id.isin(mine.loc[mine.lev == "RLB", "id"])))]
            .assign(award=lambda d: money(d.cost), worth=lambda d: money(d.market))
            [["id", "name", "pos", "age", "xwar_next", "award", "worth", "decision"]].round(1))

    # ------------------------------------------------ free agent board
    nontender = arb[(arb.market < arb.cost) & (arb.xwar_next >= 1)].id
    board = df[(df.status_next == "free agent") & (df.lev.isin(["RLB", "AAA"]) | df.lev.isna()) | df.id.isin(nontender)].copy()
    board = board[board.xwar_next >= 0.8]
    board["source"] = np.where(board.lev.isna(), "unsigned now", np.where(board.id.isin(nontender), "non-tender?", "contract ends"))
    board["bargain"] = money(board.market_next - board.price_next)
    board = board.assign(worth=money(board.market_next), price=money(board.price_next), ask=money(board.dem)).sort_values("xwar_next", ascending=False)
    cols = ["id", "name", "pos", "best_pos", "age", "org", "source", "xwar_next", "x3", "worth", "price", "ask", "prone", "loy", "fin"]
    rep.add("fa_board", f"FREE AGENT BOARD: top 40 of {len(board)} with >= 0.8 xWAR next season (worth / typical price / current ask, $M)",
            board[cols].round(1), show=40)

    # ------------------------------------------------ depth, needs
    under = df[df.status_next.notna() & (df.status_next != "free agent")]
    lhp = con.execute("select lhp_share from market_params").fetchone()[0]
    charts = {org: depth(g, pos_value, lhp) for org, g in under.groupby("org")}
    slots = HIT_POS + [f"SP{i + 1}" for i in range(SP_SLOTS)] + [f"RP{i + 1}" for i in range(RP_SLOTS)]
    grid = pd.DataFrame({org: {s: c.get(s, (None, 0))[1] for s in slots} for org, c in charts.items() if org in mlb}).T
    median = grid.median()
    my = charts[team]
    pv = pos_value.set_index(["player_id", "pos"])
    split = lambda pid, pos, col: pv[col].get((pid, pos), np.nan) if pos in HIT_POS else np.nan
    need = pd.DataFrame({
        "slot": slots,
        "id_vr": [my.get(s, (None,))[0] for s in slots],
        "vs RHP": [name.get(my.get(s, (None,))[0], "-") for s in slots],
        "xwar_vr": [split(my.get(s, (None,))[0], s, "xwar_vr") for s in slots],
        "id_vl": [my.get(f"{s} vL", (None,))[0] if s in HIT_POS else None for s in slots],
        "vs LHP": [name.get(my.get(f"{s} vL", (None,))[0], "") if s in HIT_POS else "" for s in slots],
        "xwar_vl": [split(my.get(f"{s} vL", (None,))[0], s, "xwar_vl") for s in slots],
        "xwar": [my.get(s, (None, 0))[1] for s in slots],
        "league_median": median.reindex(slots).to_numpy(),
    })
    need["vs_median"] = need.xwar - need.league_median
    rep.add("depth", f"{team} {nxt} DEPTH CHART (players under control) vs. the median MLB team's player in that slot "
            f"(hitters: full-season xWAR rate vs. each hand; xwar blends them at {1 - lhp:.0%} vs. RHP)", need.round(1))
    rank = grid.sum(axis=1).rank(ascending=False).astype(int)
    rep.total, rep.rank, rep.n_teams = grid.loc[team].sum(), rank[team], len(grid)
    rep.notes["depth"] = f"{team} projected {nxt} total: {rep.total:.1f} xWAR before free agency (rank {rep.rank} of {rep.n_teams})"
    rep.charts, rep.grid, rep.median, rep.lhp = charts, grid, median, lhp

    # ------------------------------------------------ trade targets
    def team_needs(org):
        gap = (grid.loc[org] - median)[HIT_POS + ["SP1", "SP2", "SP3", "RP1"]].sort_values()
        return ", ".join(f"{s} {v:+.1f}" for s, v in gap.head(3).items() if v < 0)

    starters = {s: my.get(s, (None, 0))[1] for s in slots}
    my_starters = {pid for pid, _ in my.values()}
    spare = mine[~mine.id.isin(my_starters) & (mine.surplus > 3 * M) & (mine.status_next != "free agent")]
    # Each outside player's biggest upgrade over your current option at any slot he can fill.
    others = under[(under.org != team) & under.org.notna()]
    bars = {**starters, "SP": starters.get(f"SP{SP_SLOTS}", 0), "RP": starters.get(f"RP{RP_SLOTS}", 0)}
    ups = (pos_value[pos_value.player_id.isin(others.id)].assign(bar=lambda d: d.pos.map(bars))
           .assign(upgrade=lambda d: d.xwar - d.bar))
    ups = ups.sort_values("upgrade", ascending=False).drop_duplicates("player_id")
    ups = ups[ups.upgrade >= 1.0].merge(df, left_on="player_id", right_on="id")

    def fits_for(org):
        """Your non-starters who'd upgrade one of that team's weak slots by 0.5+."""
        their = charts.get(org, {})
        weak = [s for s in HIT_POS + ["SP5"] if org in grid.index and grid.loc[org, s] < median[s] - 0.5]
        fits = []
        for s in weak:
            theirs = their.get(s, (None, 0))[1]
            p = "SP" if s == "SP5" else s
            better = pos_value[(pos_value.pos == p) & pos_value.player_id.isin(spare.id) & (pos_value.xwar > theirs + 0.5)].nlargest(2, "xwar").player_id
            fits += [f"{name[p]} ({s.rstrip('5')})" for p in better]
        return ", ".join(dict.fromkeys(fits))

    rows = []
    for _, r in ups.head(80).iterrows():
        rows.append({
            "slot": r.pos_x if "pos_x" in r else r.pos, "upgrade": r.upgrade, "id": r.id, "name": r["name"], "age": r.age, "org": r.org, "lev": r.lev,
            "xwar": r.xwar, "yrs": r.control_years, "avg_cost": money(r.avg_cost), "surplus": money(r.surplus),
            "their_pct": pct.get(r.org), "their_needs": team_needs(r.org) if r.org in grid.index else "",
            "your_fits": fits_for(r.org),
        })
    targets = pd.DataFrame(rows)
    rep.add("trade_targets", f"TRADE TARGETS: under control in {nxt}, biggest upgrades over your current {nxt} option at any slot "
            f"(yrs/avg_cost/surplus over the years he's controlled; their_pct = win %; their_needs = weakest slots vs. median; your_fits = your non-starters who'd upgrade them)",
            targets.round(2) if len(targets) else targets, show=30)

    # ------------------------------------------------ platoon partners
    pool = df[df.org.isna() | (df.org != team)]
    signable = set(board.id)  # free agents (incl. likely non-tenders)
    tradable = set(others.id)
    pvp = pos_value[pos_value.player_id.isin(signable | tradable) & pos_value.pos.isin(HIT_POS)].merge(
        pool[["id", "name", "org", "age", "b", "price_next", "avg_cost", "surplus"]], left_on="player_id", right_on="id")
    rows = []
    for pos in HIT_POS:
        for hand, col, share, key in [("RHP", "xwar_vr", 1 - lhp, pos), ("LHP", "xwar_vl", lhp, f"{pos} vL")]:
            cur_id = my.get(key, (None,))[0]
            cur = split(cur_id, pos, col)
            cur = 0 if np.isnan(cur) else cur
            c = pvp[(pvp.pos == pos) & (pvp[col] > cur)].assign(gain=lambda d: (d[col] - cur) * share)
            c = c[np.where(c.player_id.isin(signable), c.price_next, c.avg_cost) <= PLATOON_MAX_COST * M]
            for _, r in c.nlargest(3, "gain").iterrows():
                fa = r.player_id in signable
                rows.append({"slot": pos, "vs": hand, "current": name.get(cur_id, "-"), "cur_xwar": cur,
                             "id": r.player_id, "name": r["name"], "bats": r.b, "age": r.age, "org": r.org if not fa else "FA",
                             "his_xwar": r[col], "season_gain": r.gain,
                             "cost": money(r.price_next if fa else r.avg_cost)})
    plat = pd.DataFrame(rows)
    plat = plat[(plat.season_gain >= 0.3) & (plat.cost <= PLATOON_MAX_COST)].sort_values("season_gain", ascending=False)
    rep.add("platoons", f"PLATOON / SPLIT UPGRADES: cheapest-to-fill (<= ${PLATOON_MAX_COST}M) free agents and trade targets vs. one hand at each position "
            f"(cur_xwar / his_xwar = full-season rate vs. that hand; season_gain = WAR over a season of that platoon; "
            f"cost = typical FA price or current avg salary, $M)", plat.round(2), show=30)

    # ------------------------------------------------ hidden gems
    gems_now = df[df.lev.isna() & (df.xwar_next >= 0.7)].assign(ask=lambda d: money(d.dem)).sort_values("xwar_next", ascending=False)
    rep.add("gems_fa", "GEMS: unsigned free agents you can sign today", gems_now[["id", "name", "pos", "age", "xwar_next", "x3", "peak_xwar", "ask", "prone"]].round(1), show=15)

    starters_all = {pid for c in charts.values() for pid, _ in c.values()}
    blocked = df[df.lev.isin(["AAA", "AA"]) & (df.org != team) & (df.xwar_next >= 1.3) & (df.control_years >= 1) & ~df.id.isin(starters_all)]
    rep.add("gems_blocked", "GEMS: MLB-ready minor leaguers blocked in their org (not in its projected starting lineup/rotation/top-7 pen)",
            blocked.assign(surplus=money(blocked.surplus)).sort_values("xwar_next", ascending=False)
            [["id", "name", "pos", "age", "org", "lev", "xwar_next", "peak_xwar", "control_years", "surplus"]].round(1), show=20)

    luck = con.sql("""
        select p.id, s.pa, s.wrc_plus, t.xwrc, null::double ip, null::double fip, null::double xfip from cur_players p
        join cur_bat_stats s on s.player_id = p.id join hit_talent t on t.player_id = p.id where s.pa >= 200
        union all
        select p.id, null, null, null, s.ip, s.fip, t.xfip from cur_players p
        join cur_pit_stats s on s.player_id = p.id join pit_talent t on t.player_id = p.id where s.ip >= 50
    """).df().merge(df, on="id", suffixes=("", "_v"))
    luck["luck"] = np.where(luck.pa.notna(), (luck.wrc_plus - luck.xwrc) / 20, (luck.xfip - luck.fip) / 0.75)
    cols = ["id", "name", "pos", "age", "org", "wrc_plus", "xwrc", "fip", "xfip", "xwar_next", "control_years", "surplus"]
    buy = luck[(luck.org != team) & (luck.luck <= -1) & (luck.xwar_next >= 1.5)].assign(surplus=lambda d: money(d.surplus))
    rep.add("gems_buylow", "GEMS: buy low, results well below what the ratings say (stat-watchers will undervalue them)",
            buy.sort_values("luck")[cols].round(2), show=15)
    sell = luck[(luck.org == team) & (luck.luck >= 1)].assign(surplus=lambda d: money(d.surplus))
    rep.add("sell_high", f"{team} SELL HIGH: results well above the ratings", sell.sort_values("luck", ascending=False)[cols].round(2))

    # ------------------------------------------------ TCR / potential jumps
    j = df[df.p_jump.notna()].merge(con.sql("select player_id id, cur, pot, cur_change, pot_change from jump_odds").df(), on="id")
    cols = ["id", "name", "pos", "age", "org", "lev", "p_jump", "cur", "pot", "cur_change", "pot_change", "xwar_next", "peak_xwar", "we", "on40"]
    rep.add("jump_mine", f"POTENTIAL-JUMP ODDS, {team}: chance OSA raises his potential total by 10+ on Jan 1 (cur/pot = sum of 3 core ratings; changes = last Jan 1)",
            j[j.org == team].sort_values("p_jump", ascending=False)[cols].round(2), show=15)
    avail = j[(j.org != team) & j.org.notna() & (j.age <= 26) & (j.peak_xwar >= 1)]
    rep.add("jump_others", "POTENTIAL-JUMP ODDS: best candidates in other orgs who already project as useful MLB players (peak xWAR >= 1)",
            avail.sort_values("p_jump", ascending=False)[cols].round(2), show=25)
    fa = j[j.org.isna()]
    rep.add("jump_fa", "POTENTIAL-JUMP ODDS: unsigned free agents", fa.sort_values("p_jump", ascending=False)[cols].round(2), show=10)
    con.close()
    rep.df, rep.pos_value = df, pos_value
    return rep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("team", nargs="?", default="Halifax")
    team = ap.parse_args().team
    out = ROOT / "out"
    out.mkdir(exist_ok=True)
    rep = build(team)
    for key, title, df, show in rep.sections:
        shown = df.drop(columns=[c for c in df.columns if c == "id" or c.startswith("id_")])
        section(title, shown.head(show) if show else shown)
        if key in rep.notes:
            print(f"\n{rep.notes[key]}")
        if key in CSV:
            df.to_csv(out / CSV[key].format(team=team.lower()), index=False)
    print(f"\nfull lists in {out}/")


if __name__ == "__main__":
    main()
