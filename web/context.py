"""Model data for the web app, rebuilt whenever rlb.duckdb changes (i.e. after a refresh)."""

import threading
import time

import duckdb
import numpy as np
import pandas as pd

import offseason
import trade
from load import DB, mlb_teams
from offseason import best_lineup

from . import moves, plans, store

TEAM = "Halifax"
M = 1e6
PITCHERS = ("SP", "RP", "CL")


class Context:
    def __init__(self, team=TEAM):
        t0 = time.time()
        self.team = team
        self.lg = trade.League(team, 1.0)
        self.rep = offseason.build(team)
        self.df = self.lg.df
        self.players = self.df[self.df.index > 0]
        self.pv = self.lg.pos_value.set_index(["player_id", "pos"])
        self.proj = self.lg.proj
        self.yr, self.nxt = self.lg.yr, self.lg.nxt
        self.core_year = self.yr + plans.CORE_YEARS_AHEAD
        con = duckdb.connect(str(DB), read_only=True)
        self.snapshot = con.execute("select max(snapshot) from players").fetchone()[0]
        con.close()
        self.team_names = {int(k): min(v, key=len) for k, v in mlb_teams().items()}
        self.by_season = self.proj.set_index(["player_id", "season"])
        self.hand_medians = self._hand_medians()
        self.team_id = next((t for t, n in self.team_names.items() if n == team), None)
        ctl = self.proj[self.proj.status.notna() & (self.proj.status != "free agent")]
        self.model_last = ctl.groupby("player_id").season.max().to_dict()  # last controlled season per the model
        self._ov = (None, {})
        self.signed = self._signed()
        self.build_seconds = time.time() - t0

    # -------------------------------------------------------------- lookups
    def org(self, team=None):
        return self.players[self.players.org == (team or self.team)]

    def name(self, pid):
        return self.df.name.get(pid, "") if pid else ""

    def season(self, pid, year):
        return self.by_season.loc[(pid, year)] if (pid, year) in self.by_season.index else None

    def overrides(self):
        """{player_id: (last_season, note)} you've set (team options, releases), cached until the next edit."""
        if self._ov[0] != store.VERSION[0]:
            ov, legacy = store.control()
            for pid, note in legacy.items():  # old "leaving" marks: gone after this season
                store.set_control(pid, self.yr, note)
                ov[pid] = (self.yr, note)
            self._ov = (store.VERSION[0], ov)
        return self._ov[1]

    def last_season(self, pid):
        """His last controlled season: yours if you've set one, else the model's (this season if none)."""
        ov = self.overrides()
        return ov[pid][0] if pid in ov else int(self.model_last.get(pid, self.yr))

    def controlled(self, pid, year):
        """Under contract or team control in `year`, after your contract-end overrides."""
        ov = self.overrides()
        if pid in ov and year >= self.nxt:
            return year <= ov[pid][0]
        s = self.season(pid, year)
        return s is not None and pd.notna(s.status) and s.status != "free agent"

    def _hand_medians(self):
        """Median MLB team's starter value at each position vs each hand, next season."""
        under = self.lg.under
        pv = self.lg.pos_value[self.lg.pos_value.pos.isin(plans.HIT)]
        vals = {}
        for org in self.rep.grid.index:
            ids = under.id[under.org == org]
            sub = pv[pv.player_id.isin(ids)]
            for hand in ("vr", "vl"):
                for pos, (_, w) in best_lineup(sub, f"xwar_{hand}").items():
                    vals.setdefault((hand, pos), []).append(w)
        return {k: float(np.median(v)) for k, v in vals.items()}

    def _signed(self):
        """player_id -> (first pro contract date, how) for Rule 5 clocks: his international signing, else his latest draft."""
        con = duckdb.connect(str(DB), read_only=True)
        d = con.execute("""
            select player_id, arg_min(how, d) how, min(d) d from (
                select player_id, min(date) d, 'international signing' how from hist_signings group by 1
                union all select player_id, max(date), 'drafted' from hist_draft group by 1) group by 1
        """).df()
        con.close()
        return {int(r.player_id): (pd.Timestamp(r.d), r.how) for r in d.itertuples()}

    def rule5_year(self, pid):
        """The first December Rule 5 draft he's eligible for: after his 4th season if he signed at 18 or
        younger, his 3rd if older (matches all 289 Rule 5 picks in the league's history)."""
        if pid not in self.signed or pd.isna(self.df.at[pid, "dob"]):
            return None
        d, _ = self.signed[pid]
        age = (d - pd.Timestamp(self.df.at[pid, "dob"])).days / 365.25
        season = d.year + (1 if d.month >= 10 else 0)
        return season + (4 if age < 19 else 3)

    # -------------------------------------------------------------- 40-man roster
    def forty(self):
        org = self.org()
        on40 = org[org.on40.fillna(False).astype(bool)]
        leaving = {d["id"] for d in self.losing()}
        fringe = {f["player_id"]: f for f in store.fringe()}

        def val(v):
            return None if v is None or pd.isna(v) else v

        def brief(pid, r):
            return {"id": int(pid), "name": r["name"], "pos": r.pos, "age": int(r.age), "lev": r.lev, "b": r.b, "t": r.t,
                    "xwar": val(r.xwar_next), "peak": val(r.peak_xwar), "ceiling": val(r.ceiling_xwar), "surplus": val(r.surplus / M),
                    "perceived": val(r.perceived / M), "opt": val(r.opt), "oy": val(r.oy), "prospect_rank": val(r.prospect_rank),
                    "plan": fringe.get(pid, {}).get("status"), "note": fringe.get(pid, {}).get("note", "")}

        current = []
        for pid, r in on40.sort_values("surplus", ascending=False).iterrows():
            b = brief(pid, r)
            keep = max(b["surplus"] or 0, b["perceived"] or 0)
            b["leaving"] = pid in leaving
            b["drop_candidate"] = not b["leaving"] and keep < 1.0 and (b["peak"] or 0) < 1.0
            current.append(b)
        exposed = []
        for pid, r in org[~org.index.isin(on40.index)].iterrows():
            y = self.rule5_year(pid)
            if y is None or y > self.yr + 1:
                continue
            b = brief(pid, r)
            signed, how = self.signed[pid]
            b.update({"eligible": y, "signed": signed.date().isoformat(), "how": how, "eligible_now": y <= self.yr})
            value = max(b["surplus"] or 0, b["perceived"] or 0)
            b["advice"] = ("protect" if value >= 5 or (b["peak"] or 0) >= 1.5 or b["prospect_rank"] is not None else
                           "consider" if value >= 2 or (b["peak"] or 0) >= 1.0 else "expose")
            exposed.append(b)
        exposed.sort(key=lambda b: (not b["eligible_now"], {"protect": 0, "consider": 1, "expose": 2}[b["advice"]], -(b["surplus"] or 0)))
        n_leaving = sum(b["leaving"] for b in current)
        drops = sum(1 for b in current if b["plan"] == "off" and not b["leaving"])
        adds = sum(1 for b in exposed if b["plan"] == "on" and b["eligible_now"])
        return {"count": len(on40), "leaving": n_leaving, "planned_drops": drops, "planned_adds": adds,
                "projected": len(on40) - n_leaving - drops + adds, "rule5_year": self.yr, "current": current, "exposed": exposed}

    # -------------------------------------------------------------- moves
    def trade_moves(self):
        """Your trades from the player histories, as move parts with every player linked."""
        t = self.lg.trades
        mine = t[t.trade_id.isin(t.trade_id[t.from_team == self.team_id])]
        out = []
        for _, g in mine.groupby("trade_id"):
            gave, got = g[g.from_team == self.team_id], g[g.from_team != self.team_id]
            other = self.team_names.get(int(got.from_team.iloc[0]), "?") if len(got) else "?"

            def items(h):
                parts = []
                for _, r in h.iterrows():
                    if parts:
                        parts.append({"text": ", "})
                    if pd.notna(r.pick_round):
                        parts.append({"text": f"a {int(r.pick_round)}{'st' if r.pick_round == 1 else 'nd' if r.pick_round == 2 else 'rd' if r.pick_round == 3 else 'th'} round pick"})
                    else:
                        pid = int(r.player_id)
                        parts.append({"text": self.name(pid) or "a since-retired player", **({"player_id": pid} if pid in self.df.index else {})})
                return parts or [{"text": "nothing listed"}]
            parts = [{"text": "Traded "}, *items(gave), {"text": f" to {other} for "}, *items(got)]
            out.append((pd.Timestamp(g.date.iloc[0]).date().isoformat(), parts))
        return out

    def moves(self):
        notes = store.move_notes()
        return [{**m, "note": notes.get(m["key"], "")} for m in moves.moves(self.team_id, self.trade_moves())]

    def losing(self):
        """Players in the org now whose control ends after this season (by the model or your overrides)."""
        ov = self.overrides()
        return [{"id": int(pid), "name": r["name"], "pos": r.pos, "age": int(r.age), "lev": r.lev, "salary": (r.slr or 0) / M,
                 "xwar": r.xwar_y, "worth": r.worth_y, "price": r.price_y,
                 "why": (f"your call: {ov[pid][1]}" if ov[pid][1] else "your call") if pid in ov else "contract ends"}
                for pid, r in self.departures(self.nxt).iterrows()]

    # -------------------------------------------------------------- free agency planning
    def departures(self, year):
        """Org players whose control ends before `year`: his last controlled season is year - 1."""
        org = self.org()
        ov = self.overrides()
        leaving = [pid for pid in org.index if self.last_season(pid) == year - 1]
        d = org.loc[leaving]
        d = d[(d.lev == "RLB") | (d.xwar_next >= 0.5) | d.index.isin(list(ov))]
        cur = self.proj[(self.proj.season == year) & self.proj.player_id.isin(d.index)].set_index("player_id")
        return d.assign(xwar_y=cur.xwar.reindex(d.index), worth_y=cur.market.reindex(d.index) / M,
                        price_y=cur.price.reindex(d.index) / M).sort_values("xwar_y", ascending=False)

    def contracts(self):
        """Your org's players worth deciding on, with the model's and your last controlled season."""
        org = self.org()
        ov = self.overrides()
        d = org[(org.lev == "RLB") | (org.xwar_next >= 0.5) | org.index.isin(list(ov))]
        out = []
        for pid, r in d.iterrows():
            out.append({"id": int(pid), "name": r["name"], "pos": r.pos, "age": int(r.age), "lev": r.lev,
                        "salary": None if pd.isna(r.slr) else r.slr / M, "yl": None if pd.isna(r.yl) else int(r.yl),
                        "status": r.yl_status if isinstance(r.yl_status, str) else ("contract" if pd.notna(r.slr) and r.slr > 800_000 else ""),
                        "model_last": int(self.model_last.get(pid, self.yr)), "last": ov[pid][0] if pid in ov else None,
                        "note": ov[pid][1] if pid in ov else "", "xwar": None if pd.isna(r.xwar_next) else r.xwar_next})
        return sorted(out, key=lambda x: (x["lev"] != "RLB", -(x["salary"] or 0)))

    # -------------------------------------------------------------- player detail
    def player_detail(self, pid):
        con = duckdb.connect(str(DB), read_only=True)
        q = lambda s: con.execute(s, [pid]).df()
        pitcher = self.df.pos.get(pid) in PITCHERS
        kind = "pit" if pitcher else "bat"
        out = {
            "history": q(f"select yr, {'stu, mov, con, stu_p, mov_p, con_p' if pitcher else 'con, pow, eye, con_p, pow_p, eye_p'} "
                         f"from hist_{kind} where player_id = ? order by yr"),
            "contracts": q("select date, kind, years, total / 1e6 total_m, team_id from hist_contracts where player_id = ? order by date desc"),
            "injuries": q("select date, injury, days from hist_injuries where player_id = ? order by date desc limit 15"),
            "ratings": q(f"select * exclude (player_id) from cur_{'pit' if pitcher else 'bat'}_ratings where player_id = ?"),
            "potential": q(f"select * exclude (player_id) from cur_{'pit' if pitcher else 'bat'}_potential where player_id = ?"),
            "pitches": q("select * exclude (player_id) from cur_pitches where player_id = ?") if pitcher else None,
            "fielding": None if pitcher else q("select * exclude (player_id) from cur_fielding where player_id = ?"),
            "personality": q("select lea, loy, fin, we, int, type from cur_personality where player_id = ?"),
            "stats": q(f"select * exclude (player_id) from cur_{'pit' if pitcher else 'bat'}_stats where player_id = ?"),
        }
        trades = con.execute("select * from hist_trades where trade_id in (select trade_id from hist_trades where player_id = ?) order by date desc, side",
                             [pid]).df()
        con.close()
        out["trades"] = []
        for _, g in trades.groupby("trade_id", sort=False):
            sides = []
            for _, h in g.groupby("side"):
                items = [{"label": f"R{int(r.pick_round)} pick"} if pd.notna(r.pick_round) else
                         {"id": int(r.player_id), "label": self.name(int(r.player_id)) or "(retired)"} for _, r in h.iterrows()]
                sides.append({"team": self.team_names.get(int(h.from_team.iloc[0]), str(h.from_team.iloc[0])), "items": items})
            out["trades"].append({"date": pd.Timestamp(g.date.iloc[0]).date().isoformat(), "sides": sides})
        out["contracts"]["team"] = out["contracts"].team_id.map(lambda t: self.team_names.get(int(t), "") if pd.notna(t) else "")
        out["contracts"] = out["contracts"].drop(columns="team_id")
        out["projection"] = self.proj[self.proj.player_id == pid].sort_values("season")
        out["positions"] = self.lg.pos_value[self.lg.pos_value.player_id == pid]
        return out


_lock = threading.Lock()
_ctx, _mtime = None, None


def get():
    """The current Context, rebuilt if the database changed since it was built."""
    global _ctx, _mtime
    mtime = DB.stat().st_mtime
    with _lock:
        if _ctx is None or mtime != _mtime:
            try:
                _ctx, _mtime = Context(), mtime
            except duckdb.Error:
                if _ctx is None:  # mid-refresh and nothing to fall back on
                    raise
        return _ctx
