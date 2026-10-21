"""Trade valuation: what a player is worth, whether a deal is good, what to ask for or offer.

    .venv/bin/python trade.py value "Joaquín Rosa" "Lucien Salieri"
    .venv/bin/python trade.py eval --give "Joaquín Rosa" --get "Roland Henry"
    .venv/bin/python trade.py shop "Joaquín Rosa"            # selling: what to ask for
    .venv/bin/python trade.py offer "Lucien Salieri"         # buying: packages of your players to offer
    .venv/bin/python trade.py comps "Joaquín Rosa"           # what similar players fetched in real RLB trades
    .venv/bin/python trade.py picks                          # what each draft round is worth

Draft picks can go in --give/--get as R1, R2, ... (valued as the average player taken in that
round in the last three drafts, as we rate them today; early and late picks in a round aren't
told apart).

Players are matched by name (accents and case ignored, partial names OK); add @Org to
disambiguate ("Ken Smith@Halifax") or use id:54120.

Each player gets two values, both in $M of surplus (value minus cost over the years he's controlled,
discounted 10%/yr; see value.py):
  surplus    our view, from his ratings (xWAR)
  perceived  how other GMs likely price him in a trade: the same, except
             - each projected season is shifted toward this season's WAR pace by --stats (default
               0.25), scaled down for small samples (full weight at 500 PA / 150 IP SP / 60 IP RP)
             - league-minimum (pre-arb) seasons count --premium times (default 1.5): RLB GMs pay up
               for cheap control
             - minor leaguers are discounted for bust risk by level (LEVEL_RISK)
             - hitters are seen at their listed position (not the one we'd play them at), with
               only --defense (default 0.4) of an above-average glove's value (a below-average
               glove still counts in full): GMs pay for bats and power, not gloves. Catchers are
               the exception: framing and arm count in full.
             Recent comparable deals (trade.py comps) are the reality check.
Trades you can actually make are ones the other GM sees as fair (perceived) but that win on
surplus and on your depth chart. --team picks your team (default Halifax); --now weights next
season's value for a contender (default 1).
"""

import argparse
import itertools
import re
import unicodedata

import duckdb
import numpy as np
import pandas as pd

from load import DB, mlb_teams
from offseason import depth, load
from value import LEVERAGE, RP_REPLACEMENT

pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 40)
pd.set_option("display.max_rows", 200)
M = 1e6
FULL = {"hit": 600, "C": 520, "SP": 180, "RP": 65}
LEVEL_RISK = {"RLB": 1.0, "AAA": 0.8, "AA": 0.6, "A": 0.45, "R": 0.3, "INT": 0.25}


def norm(s):
    return unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().casefold().strip()


class League:
    def __init__(self, team, now_weight, stats_weight=0.25, premium=1.5, defense=0.4):
        con = duckdb.connect(str(DB), read_only=True)
        self.team, self.now, self.stats, self.premium, self.defense = team, now_weight, stats_weight, premium, defense
        self.leverage, self.rp_repl = LEVERAGE, RP_REPLACEMENT
        self.yr = con.execute("select max(year(date)) from hist_ratings").fetchone()[0]
        self.nxt = self.yr + 1
        self.df = load(con, self.nxt).set_index("id", drop=False)
        self.pos_value = con.sql("select * from pos_value").df()
        self.proj = con.sql("select * from proj").df()
        mp = con.sql("select * from market_params").df().iloc[0]
        self.rate, self.repl, self.min, self.disc, self.lhp = mp.rate, mp.replacement, mp.min_salary, mp.discount, mp.lhp_share
        stats = con.sql("""
            select p.id, s.pa, null::double ip, null::int gs, s.war, s.wrc_plus, null::double era from cur_players p
            join cur_bat_stats s on s.player_id = p.id where p.pos not in ('SP', 'RP', 'CL')
            union all
            select p.id, null, s.ip, s.gs, s.war, null, s.era from cur_players p
            join cur_pit_stats s on s.player_id = p.id where p.pos in ('SP', 'RP', 'CL')
        """).df().set_index("id")
        rank = con.sql(f"""
            select player_id id, arg_max(rank, date) prospect_rank from hist_prospect_rank
            where year(date) = {self.yr} group by 1
        """).df().set_index("id")
        draft = con.sql(f"select player_id, round from hist_draft where year between {self.yr - 2} and {self.yr}").df()
        self.trades = con.sql("select * from hist_trades").df()
        con.close()
        self.df = self.df.join(stats[["pa", "ip", "gs", "war", "wrc_plus", "era"]]).join(rank)
        self._perceived()
        self._add_picks(draft)
        self.under = self.df[self.df.status_next.notna() & (self.df.status_next != "free agent")]
        self._depth_cache = {}

    # -------------------------------------------------------------- values
    def value(self, w):
        return self.min + self.rate * np.clip(w - self.repl, 0, None)

    def _perceived(self):
        """Other GMs' view: shift every projected season part way toward this season's WAR pace."""
        d = self.df
        hit = d.pa.fillna(0) >= 150
        pit = d.ip.fillna(0) >= 30
        full = np.where(d.pos == "C", FULL["C"], FULL["hit"])
        starter = d.best_pos == "SP"  # same basis as xWAR (role from stamina, not usage)
        ip_full = np.where(starter, FULL["SP"], FULL["RP"])
        pace = pd.Series(np.nan, index=d.index)
        pace[hit] = (d.war / d.pa * full)[hit]
        pace[pit] = (d.war / d.ip * ip_full)[pit]
        sample = pd.Series(0.0, index=d.index)
        sample[hit] = (d.pa / 500).clip(upper=1)[hit]
        sample[pit] = (d.ip / np.where(starter, 150, 60)).clip(upper=1)[pit]
        d["war_pace"] = pace
        # Hitters as other GMs see them: at the best position he can credibly play (rating 50+, or
        # his listed one), with an above-average glove discounted (they don't pay for gloves, but a
        # bad one still hurts) - catchers excepted.
        pv = self.pos_value[self.pos_value.pos.isin(["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"])].copy()
        pv = pv.merge(d[["pos"]].rename(columns={"pos": "listed"}), left_on="player_id", right_index=True)
        pv = pv[(pv.playable >= 50) | (pv.pos == pv.listed) | (pv.pos == "DH")]
        pv["seen"] = pv.xwar - np.where(pv.pos == "C", 0, (1 - self.defense) * pv.glove.fillna(0).clip(lower=0))
        seen = pv.groupby("player_id").seen.max()
        view = (seen - d.loc[seen.index, "xwar_next"]).reindex(d.index).fillna(0)
        shift = ((pace - d.xwar_now) * sample * self.stats).fillna(0) + view
        p = self.proj.merge(shift.rename("pace_shift"), left_on="player_id", right_index=True, how="left").fillna({"pace_shift": 0})
        p = p[p.status.notna() & (p.status != "free agent")]
        controlled = p.status.isin(["pre-arb", "arb"])
        pw = p.xwar + p.pace_shift
        rp = p.best_pos == "RP"  # relievers: pace is in reliever wins; price them as equivalent wins
        pw = np.where(rp, self.repl + self.leverage * (pw - self.rp_repl), pw)
        sur = self.value(pw) - p.cost
        sur = np.where(controlled, np.clip(sur, 0, None), sur)
        sur = np.where(p.status == "pre-arb", sur * self.premium, sur)
        risk = d.lev.map(LEVEL_RISK).fillna(1.0).reindex(p.player_id).to_numpy()
        weight = self.disc ** (p.season - self.nxt) * np.where(p.season == self.nxt, self.now, 1)
        p = p.assign(perceived=sur * weight * risk)
        d["perceived"] = p.groupby("player_id").perceived.sum().reindex(d.index).fillna(0)
        if self.now != 1:  # re-weight our own surplus the same way
            q = self.proj[self.proj.status.notna() & (self.proj.status != "free agent")]
            q = q.assign(s=q.surplus * self.disc ** (q.season - self.nxt) * np.where(q.season == self.nxt, self.now, 1))
            d["surplus"] = q.groupby("player_id").s.sum().reindex(d.index)
        d["surplus"] = d.surplus.fillna(0)

    def _add_picks(self, draft):
        """Draft picks as pseudo-players with id -round: the average draftee of that round."""
        d = draft.merge(self.df[["surplus", "perceived"]], left_on="player_id", right_index=True)
        d["grp"] = d["round"].clip(upper=11).where(d["round"] <= 5, np.where(d["round"] <= 10, 6, 11))
        by = d.groupby("grp")[["surplus", "perceived"]].mean()
        rows = []
        for r in range(1, int(draft["round"].max()) + 1):
            g = r if r <= 5 else 6 if r <= 10 else 11
            rows.append({"id": -r, "name": f"R{r} pick", "lev": "pick", "surplus": by.surplus.get(g, 0), "perceived": by.perceived.get(g, 0)})
        self.picks = pd.DataFrame(rows).set_index("id", drop=False)
        self.df = pd.concat([self.df, self.picks])

    # -------------------------------------------------------------- lookup
    def find(self, query, prefer=None):
        if query.startswith("id:"):
            return int(query[3:])
        if m := re.fullmatch(r"r(\d+)( pick)?", query.strip().casefold()):
            return -int(m.group(1))
        q, _, org = query.partition("@")
        d = self.df
        if org:
            d = d[d.org.map(norm) == norm(org)]
        exact = d[d.name.map(norm) == norm(q)]
        hits = exact if len(exact) else d[d.name.map(norm).str.contains(norm(q), regex=False)]
        if len(hits) > 1 and prefer is not None:
            pref = hits[prefer(hits)]
            hits = pref if len(pref) else hits
        if len(hits) == 1:
            return int(hits.id.iloc[0])
        if not len(hits):
            raise SystemExit(f"no player matches '{query}'")
        opts = "\n  ".join(f"{r['name']}@{r.org} ({r.pos}, {r.age}, {r.lev}) id:{r.id}" for _, r in hits.head(15).iterrows())
        raise SystemExit(f"'{query}' matches several players; pick one:\n  {opts}")

    # -------------------------------------------------------------- depth
    def team_total(self, org, add=(), remove=()):
        """Next season's depth-chart xWAR for an org after adding/removing players."""
        key = (org, tuple(sorted(add)), tuple(sorted(remove)))
        if key not in self._depth_cache:
            roster = self.under[(self.under.org == org) & ~self.under.id.isin(remove)]
            roster = pd.concat([roster, self.under[self.under.id.isin(add)]])
            chart = depth(roster, self.pos_value, self.lhp)
            self._depth_cache[key] = sum(w for _, w in chart.values())
        return self._depth_cache[key]

    def payroll(self, ids):
        p = self.proj[self.proj.player_id.isin(ids) & self.proj.status.isin(["contract", "extension", "arb", "pre-arb"])]
        return p.groupby("season").cost.sum().reindex(range(self.nxt, self.nxt + 3), fill_value=0) / M

    def card(self, ids, side=None):
        cols = ["id", "name", "org", "lev", "pos", "best_pos", "age", "oy", "xwar_next", "x3", "control_years", "avg_cost",
                "surplus", "perceived", "war", "war_pace", "wrc_plus", "era", "prospect_rank"]
        c = self.df.loc[list(ids), cols].copy()
        c["avg_cost"] = c.avg_cost / M
        c["surplus"] = c.surplus / M
        c["perceived"] = c.perceived / M
        c = c.rename(columns={"control_years": "yrs", "xwar_next": f"xwar_{self.nxt}", "prospect_rank": "prosp_rk", "oy": "opt_yrs",
                              "war": f"war_{self.yr}"})
        if side:
            c.insert(0, "side", side)
        return c.round(2)


# ------------------------------------------------------------------ commands

def cmd_value(lg, names):
    ids = [lg.find(n) for n in names]
    print(lg.card(ids).drop(columns="id").to_string(index=False))
    for pid in ids:
        r = lg.df.loc[pid]
        p = lg.proj[(lg.proj.player_id == pid) & (lg.proj.season < lg.nxt + 6)]
        p = p.assign(cost=p.cost / M, worth=p.market / M, surplus=p.surplus / M)
        print(f"\n{r['name']} ({r.org}, {r.pos}, {r.age}): by season")
        print(p[["season", "age", "xwrc", "xfip", "xwar", "status", "cost", "worth", "surplus"]].round(2).to_string(index=False))


def evaluate(lg, give, get):
    """A proposed deal from your side: both sides' cards, value gained, depth charts, payroll."""
    team = lg.team
    orgs = sorted({lg.df.loc[g, "org"] for g in get if g > 0} - {None, team})
    gain_s = lg.df.loc[list(get), "surplus"].sum() - lg.df.loc[list(give), "surplus"].sum()
    gain_p = lg.df.loc[list(give), "perceived"].sum() - lg.df.loc[list(get), "perceived"].sum()  # their view of their gain
    players_get, players_give = [g for g in get if g > 0], [g for g in give if g > 0]
    before = lg.team_total(team)
    after = lg.team_total(team, add=players_get, remove=players_give)
    partners = {}
    for org in orgs:
        theirs_out = [g for g in players_get if lg.df.loc[g, "org"] == org]
        partners[org] = (lg.team_total(org), lg.team_total(org, add=players_give, remove=theirs_out))
    return {
        "cards": pd.concat([lg.card(give, "you give"), lg.card(get, "you get")]),
        "surplus_gain": gain_s / M, "their_gain": gain_p / M, "depth": (before, after), "partners": partners,
        "payroll": lg.payroll(players_get) - lg.payroll(players_give),
        "rentals": [lg.df.loc[g, "name"] for g in players_get if lg.df.loc[g, "status_next"] == "free agent"],
    }


def print_eval(lg, r):
    print(r["cards"].drop(columns="id").to_string(index=False))
    print(f"\nsurplus (our view): {r['surplus_gain']:+.1f}M for {lg.team}")
    print(f"perceived (how other GMs likely see it): the other side {'gains' if r['their_gain'] >= 0 else 'loses'} "
          f"{abs(r['their_gain']):.1f}M" + ("  -> they should like it" if r["their_gain"] >= 0 else "  -> expect them to ask for more"))
    b, a = r["depth"]
    print(f"{lg.team} {lg.nxt} depth chart: {b:.1f} -> {a:.1f} xWAR ({a - b:+.1f})")
    for org, (b, a) in r["partners"].items():
        print(f"{org} {lg.nxt} depth chart: {b:.1f} -> {a:.1f} xWAR ({a - b:+.1f})")
    print("payroll change for you: " + ", ".join(f"{s} {v:+.1f}M" for s, v in r["payroll"].items()))
    if r["rentals"]:
        print(f"note: {', '.join(r['rentals'])} reach free agency after this season (no {lg.nxt} value)")


def shop(lg, give):
    """Selling: what to ask for. Players the other GM values at no more than what you're sending
    (perceived), ranked by our surplus plus what they add to your depth chart."""
    team = lg.team
    budget = lg.df.loc[list(give), "perceived"].sum()
    cap = max(budget * 1.1, budget + 2 * M)
    give_s = lg.df.loc[list(give), "surplus"].sum()
    c = lg.under[(lg.under.org != team) & lg.under.org.notna() & (lg.under.surplus > 0) & (lg.under.perceived <= cap)]
    c = pd.concat([c[c.perceived >= 0].nlargest(250, "surplus"), c[c.perceived < 0].nlargest(60, "surplus")])
    base = lg.team_total(team)
    players = [g for g in give if g > 0]
    rows = []
    for pid, r in c.iterrows():
        rows.append({"id": pid, "name": r["name"], "org": r.org, "lev": r.lev, "pos": r.pos, "age": r.age, "xwar_next": r.xwar_next,
                     "yrs": r.control_years, "avg_cost": r.avg_cost / M, "surplus": r.surplus / M, "perceived": r.perceived / M,
                     "your_depth": lg.team_total(team, add=[pid], remove=players) - base,
                     "their_depth": lg.team_total(r.org, add=players, remove=[pid]) - lg.team_total(r.org),
                     "prosp_rk": r.prospect_rank})
    out = pd.DataFrame(rows)
    out["score"] = out.surplus + lg.rate / M * out.your_depth * lg.now
    out = out.sort_values("score", ascending=False).drop(columns="score").round(2)
    fair = out.perceived >= 0
    return {
        "names": ", ".join(lg.df.loc[list(give), "name"]), "surplus": give_s / M, "perceived": budget / M, "cap": cap / M,
        "pick": pick_equivalent(lg, budget),
        "lists": [("Fair in their eyes, best for you", out[fair]),
                  ("...and they get better at the position", out[fair & (out.their_depth > 0)]),
                  ("Contracts they likely see as overpaid but we value (salary they may move for little)", out[~fair])],
    }


def print_shop(lg, r, n):
    print(f"Selling {r['names']}: our surplus {r['surplus']:.1f}M; other GMs likely see {r['perceived']:.1f}M (perceived), about {r['pick']}.")
    print(f"So ask for players they value at up to ~{r['cap']:.1f}M. surplus/perceived in $M; your_depth / their_depth = "
          f"change in each team's {lg.nxt} depth chart xWAR.\n")
    for title, df in r["lists"]:
        print(f"== {title}")
        print(df.drop(columns="id").head(n).to_string(index=False))
        print()


def pick_equivalent(lg, v):
    p = lg.picks.sort_values("perceived", ascending=False)
    above = p[p.perceived <= v]
    return f"a {above.name.iloc[0]}" if len(above) and v > 0.05 * M else "less than any draft pick"


def picks_table(lg):
    p = lg.picks.assign(surplus=lg.picks.surplus / M, perceived=lg.picks.perceived / M)
    return p[["name", "surplus", "perceived"]].round(2)


def comps(lg, pid, n=15, years=3):
    """Recent real trades of similar players: same hitter/pitcher type, age within 3, xWAR within 0.8.
    Returns a list of {date, sides: [(team, [item])]} with items {id?, label}."""
    me = lg.df.loc[pid]
    pitcher = me.pos in ("SP", "RP", "CL")
    names = {int(k): min(v, key=len) for k, v in mlb_teams().items()}
    t = lg.trades[pd.to_datetime(lg.trades.date).dt.year >= lg.yr - years + 1]
    p = t[t.player_id.notna()].merge(lg.df[["name", "pos", "age", "lev", "xwar_now"]], left_on="player_id", right_index=True)
    p["pitcher"] = p.pos.isin(["SP", "RP", "CL"])
    age_then = p.age - (lg.yr - pd.to_datetime(p.date).dt.year)
    like = p[(p.pitcher == pitcher) & ((age_then - me.age).abs() <= 3)
             & ((p.xwar_now - me.xwar_now).abs() <= 0.8) & (p.player_id != pid)]
    deals = []
    for tid in like.sort_values("date", ascending=False).trade_id.unique()[:n]:
        g = t[t.trade_id == tid]
        sides = []
        for side, h in g.groupby("side"):
            items = []
            for _, r in h.iterrows():
                if pd.notna(r.pick_round):
                    items.append({"label": f"R{int(r.pick_round)} pick"})
                elif int(r.player_id) in lg.df.index:
                    q = lg.df.loc[int(r.player_id)]
                    rk = f" prk{int(q.prospect_rank)}" if pd.notna(q.prospect_rank) else ""
                    items.append({"id": int(r.player_id), "label": f"{q['name']} ({q.pos}, x{q.xwar_now:.1f}{rk})"})
                else:
                    items.append({"label": "(retired)"})
            sides.append((names.get(int(h.from_team.iloc[0]), str(h.from_team.iloc[0])), items))
        deals.append({"date": pd.Timestamp(g.date.iloc[0]).date(), "sides": sides})
    return {"title": f"Trades since {lg.yr - years + 1} of {'pitchers' if pitcher else 'hitters'} like {me['name']} "
                     f"(age {me.age:.0f}, xWAR now {me.xwar_now:.1f}); x = today's xWAR, prk = best prospect rank", "deals": deals}


def print_comps(r):
    print(r["title"] + ":\n")
    for d in r["deals"]:
        parts = [f"{team} gave " + ", ".join(i["label"] for i in items) for team, items in d["sides"]]
        if len(parts) == 1:
            parts.append("nothing listed in return")
        print(f"{d['date']}  " + "  |  ".join(parts))


def offer(lg, get, protect, max_players=3):
    """Buying: packages of 1-3 of your players the other side would see as fair, costing you the least."""
    team = lg.team
    need = lg.df.loc[list(get), "perceived"].sum()
    get_s = lg.df.loc[list(get), "surplus"].sum()
    mine = lg.under[(lg.under.org == team) & ~lg.under.id.isin(protect) & (lg.under.perceived > 0.5 * M)]
    mine = mine.nlargest(40, "perceived")
    combos = []
    for k in range(1, max_players + 1):
        for combo in itertools.combinations(mine.id, k):
            p = mine.loc[list(combo), "perceived"].sum()
            if need * 0.95 <= p <= need * 1.6 + 3 * M:
                combos.append((combo, p, mine.loc[list(combo), "surplus"].sum()))
    combos.sort(key=lambda c: c[2])  # cheapest to us first
    base = lg.team_total(team)
    players_get = [g for g in get if g > 0]
    orgs = {lg.df.loc[g, "org"] for g in players_get}
    rows = []
    for combo, p, s in combos[:300]:
        depth_change = lg.team_total(team, add=players_get, remove=combo) - base
        their = sum(lg.team_total(o, add=combo, remove=[g for g in players_get if lg.df.loc[g, "org"] == o]) - lg.team_total(o) for o in orgs)
        rows.append({"ids": list(combo), "package": ", ".join(lg.df.loc[list(combo), "name"]), "perceived": p / M,
                     "surplus_given": s / M, "your_gain": (get_s - s) / M, "your_depth": depth_change, "their_depth": their})
    out = pd.DataFrame(rows)
    if len(out):
        out["score"] = out.your_gain + lg.rate / M * out.your_depth * lg.now
        out = out.sort_values("score", ascending=False).drop(columns="score").round(2)
    return {"names": ", ".join(lg.df.loc[list(get), "name"]), "surplus": get_s / M, "perceived": need / M,
            "packages": out, "pool": len(mine), "protected": ", ".join(lg.df.loc[list(protect), "name"]) or "none"}


def print_offer(r, n):
    print(f"Buying {r['names']}: our surplus {r['surplus']:.1f}M, perceived {r['perceived']:.1f}M (what the other side thinks they give up).")
    if not len(r["packages"]):
        print("no package of up to 3 tradable players reaches their perceived value; try --protect less")
        return
    print("Packages they should see as fair (perceived >= 95% of that), best for you first.\n")
    print(r["packages"].drop(columns="ids").head(n).to_string(index=False))
    print(f"\nyour tradable pool: {r['pool']} players (perceived > 0.5M); protected: {r['protected']}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--team", default="Halifax")
    ap.add_argument("--now", type=float, default=1.0, help="weight on next season's value (contender > 1)")
    ap.add_argument("--stats", type=float, default=0.25, help="how much other GMs weigh this season's results vs. ratings (0-1)")
    ap.add_argument("--premium", type=float, default=1.5, help="how much more other GMs value a league-minimum season")
    ap.add_argument("--defense", type=float, default=0.4, help="share of hitters' defensive value other GMs pay for")
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("value")
    v.add_argument("names", nargs="+")
    e = sub.add_parser("eval")
    e.add_argument("--give", nargs="+", required=True)
    e.add_argument("--get", nargs="+", required=True)
    s = sub.add_parser("shop")
    s.add_argument("names", nargs="+")
    s.add_argument("--n", type=int, default=15)
    o = sub.add_parser("offer")
    o.add_argument("names", nargs="+")
    o.add_argument("--n", type=int, default=12)
    o.add_argument("--protect", nargs="*", default=[], help="your players not to include")
    o.add_argument("--max", type=int, default=3, help="most players in a package")
    c = sub.add_parser("comps")
    c.add_argument("name")
    c.add_argument("--n", type=int, default=15)
    sub.add_parser("picks")
    args = ap.parse_args()

    lg = League(args.team, args.now, args.stats, args.premium, args.defense)
    mine = lambda h: h.org == args.team
    theirs = lambda h: h.org != args.team
    if args.cmd == "value":
        cmd_value(lg, args.names)
    elif args.cmd == "eval":
        print_eval(lg, evaluate(lg, [lg.find(n, mine) for n in args.give], [lg.find(n, theirs) for n in args.get]))
    elif args.cmd == "shop":
        print_shop(lg, shop(lg, [lg.find(n, mine) for n in args.names]), args.n)
    elif args.cmd == "offer":
        print_offer(offer(lg, [lg.find(n, theirs) for n in args.names], [lg.find(n, mine) for n in args.protect], args.max), args.n)
    elif args.cmd == "comps":
        print_comps(comps(lg, lg.find(args.name), args.n))
    elif args.cmd == "picks":
        print("Average value of a draft pick by round ($M; players taken in the last three drafts, rated today):")
        print(picks_table(lg).head(12).to_string(index=False))


if __name__ == "__main__":
    main()
