"""The season plan: who's on the roster in a season decides the lineup and staff; you pin where you disagree.

A season's roster is your org players under control that season (after your contract-end calls) plus the
free agents you plan to sign. From it the model builds the best lineup (one lineup, valued over a season:
the PAs vs RHP at the vs-RHP rate and the PAs vs LHP at the vs-LHP rate, with a vs-LHP swap where a bench
bat is clearly better against lefties), the rotation and the bullpen. Pins override any slot. Each weak
or open slot lists fixes: the best bench option, free agents (at their ask, else the typical price) and
trade targets.

Seasons after next shift each player's next-season values by how his projection changes.
"""

import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment

from offseason import RP_LEVERAGE

from . import plans, store

M = 1e6
PITCHERS = ("SP", "RP", "CL")
HIT = plans.HIT
SP_SLOTS = [f"SP{i}" for i in range(1, 6)]
BULLPEN = plans.BULLPEN
SWAP_MIN = 0.6  # full-season xWAR rate vs LHP a bench bat must beat the starter by to platoon in
SEASONS_AHEAD = 4
GROUP = {"C": {"C"}, "1B": {"1B", "DH"}, "DH": {"1B", "DH", "LF", "RF"}, "2B": {"2B", "SS", "3B"}, "SS": {"2B", "SS", "3B"},
         "3B": {"2B", "SS", "3B"}, "LF": {"LF", "CF", "RF"}, "CF": {"LF", "CF", "RF"}, "RF": {"LF", "CF", "RF"}}


def leverage(role):
    return plans.LEVERAGE.get(role, RP_LEVERAGE[-1])


class Planner:
    def __init__(self, c):
        self.c = c
        self.lhp = c.rep.lhp
        pv = c.lg.pos_value
        self.pv = pv[pv.pos.isin(HIT + ["SP", "RP"])].copy()
        self.pv["blend"] = (1 - self.lhp) * self.pv.xwar_vr + self.lhp * self.pv.xwar_vl
        self.pv.loc[self.pv.pos.isin(["SP", "RP"]), "blend"] = self.pv.xwar
        self.xwar = c.proj.set_index(["player_id", "season"]).xwar
        self.fa = c.rep.get("fa_board")
        self.targets = c.rep.get("trade_targets")
        self.seasons = list(range(c.nxt, c.nxt + SEASONS_AHEAD))
        self._cache = {}

    # ------------------------------------------------------------ roster and values
    def signings(self, season):
        return {s["player_id"]: s for s in store.signings() if s["first_season"] <= season < s["first_season"] + s["years"]}

    def roster(self, season):
        """Player ids on the roster in `season`: org players under control then, plus planned signings."""
        ids = [pid for pid in self.c.org().index if self.c.controlled(pid, season)]
        return list(dict.fromkeys(ids + [pid for pid in self.signings(season) if pid in self.c.df.index]))

    def values(self, season, pids):
        """Per player and position: blended season value, vs-RHP and vs-LHP rates, shifted to `season`."""
        v = self.pv[self.pv.player_id.isin(pids)].copy()
        if season != self.c.nxt:
            shift = v.player_id.map(lambda p: self.xwar.get((p, season), np.nan) - self.xwar.get((p, self.c.nxt), np.nan))
            v = v[shift.notna()]
            for col in ("xwar", "xwar_vr", "xwar_vl", "blend"):
                v[col] = v[col] + shift[shift.notna()]
        return v

    # ------------------------------------------------------------ the plan for one season
    def plan(self, season, pins=None, fixes=True):
        key = (season, store.VERSION[0], pins is None, fixes)
        if key in self._cache:
            return self._cache[key]
        c = self.c
        pins = store.pins(season) if pins is None else pins
        roster = self.roster(season)
        signed = self.signings(season)
        v = self.values(season, roster)
        is_pit = v.player_id.map(lambda p: c.df.pos.get(p) in PITCHERS)
        hv, pv = v[~is_pit & v.pos.isin(HIT)], v[is_pit & v.pos.isin(["SP", "RP"])]
        on = set(roster)

        def pinned(slot, hand="R"):
            pid = pins.get((slot, hand))
            return pid if pid in on else None

        missing = [{"slot": s, "hand": h, "id": pid, "name": c.name(pid)} for (s, h), pid in pins.items() if pid not in on]

        # Lineup: pins fixed, the rest by optimal assignment on season value.
        table = hv.pivot_table(index="player_id", columns="pos", values="blend", aggfunc="max").reindex(columns=HIT)
        rate_r = hv.pivot_table(index="player_id", columns="pos", values="xwar_vr", aggfunc="max").reindex(columns=HIT)
        rate_l = hv.pivot_table(index="player_id", columns="pos", values="xwar_vl", aggfunc="max").reindex(columns=HIT)
        lineup = {s: pinned(s) for s in HIT if pinned(s)}
        free_slots = [s for s in HIT if s not in lineup]
        pool = table.drop(index=[p for p in lineup.values() if p in table.index], errors="ignore")
        if len(pool) and free_slots:
            cost = -pool[free_slots].fillna(-50).to_numpy()
            for r, k in zip(*linear_sum_assignment(cost)):
                if not np.isnan(pool[free_slots].iat[r, k]):
                    lineup[free_slots[k]] = int(pool.index[r])
        starters = set(lineup.values())

        # vs-LHP swaps: yours first, then a bench bat where he's clearly better vs lefties.
        # A pinned swap may move a starter (DH vs RHP playing 1B vs LHP) as long as nobody plays twice vs LHP.
        swaps = {s: (pinned(s, "L"), True) for s in HIT if pinned(s, "L") and pinned(s, "L") != lineup.get(s)}
        for s in list(swaps):
            vs_l = [swaps[t][0] if t in swaps else lineup.get(t) for t in HIT]
            if vs_l.count(swaps[s][0]) > 1:
                missing.append({"slot": s, "hand": "L", "id": swaps[s][0], "name": c.name(swaps[s][0]), "why": "already in the vs-LHP lineup"})
                del swaps[s]
        used = starters | {pid for pid, _ in swaps.values()}
        cands = []
        for s in HIT:
            if s in swaps or (s, "L") in pins or s not in lineup or s not in rate_l.columns:
                continue
            cur = rate_l.at[lineup[s], s] if lineup[s] in rate_l.index else np.nan
            for pid, val in rate_l[s].dropna().items():
                if pid not in used and (np.isnan(cur) or val - cur >= SWAP_MIN):
                    cands.append((val - (0 if np.isnan(cur) else cur), s, int(pid)))
        for gain, s, pid in sorted(cands, reverse=True):
            if s not in swaps and pid not in used:
                swaps[s] = (pid, False)
                used.add(pid)

        def cell(df, pid, s):
            return float(df.at[pid, s]) if pid in df.index and pd.notna(df.at[pid, s]) else None

        rows, total = [], 0.0
        for s in HIT:
            pid = lineup.get(s)
            sw = swaps.get(s)
            r_r, r_l = cell(rate_r, pid, s), cell(rate_l, pid, s)
            s_l = cell(rate_l, sw[0], s) if sw else None
            value = None if r_r is None else (1 - self.lhp) * r_r + self.lhp * (s_l if s_l is not None else (r_l or 0))
            med_r, med_l = c.hand_medians.get(("vr", s)), c.hand_medians.get(("vl", s))
            median = None if med_r is None or med_l is None else (1 - self.lhp) * med_r + self.lhp * med_l
            total += value or 0
            rows.append({"slot": s, "kind": "hit", **self._who(pid, signed), "pinned": (s, "R") in pins and pinned(s) == pid,
                         "rate_r": r_r, "rate_l": r_l, "value": value, "median": median,
                         "swap": None if not sw else {**self._who(sw[0], signed), "pinned": sw[1], "rate_l": s_l}})

        # Rotation and bullpen: pins fixed, then the best remaining arms in order.
        sp = pv[pv.pos == "SP"].set_index("player_id").xwar
        rp = pv[pv.pos == "RP"].set_index("player_id").xwar
        staff = {s: pinned(s) for s in SP_SLOTS + BULLPEN if pinned(s)}
        taken = set(staff.values())
        for s in SP_SLOTS:
            if s not in staff:
                best = next((p for p in sp.sort_values(ascending=False).index if p not in taken), None)
                if best is not None:
                    staff[s] = int(best)
                    taken.add(best)
        for s in BULLPEN:
            if s not in staff:
                best = next((p for p in rp.sort_values(ascending=False).index if p not in taken), None)
                if best is not None:
                    staff[s] = int(best)
                    taken.add(best)
        rotation, bullpen = [], []
        for s in SP_SLOTS:
            pid = staff.get(s)
            value = float(sp[pid]) if pid in sp.index else None
            median = float(c.rep.median[s]) if s in c.rep.median.index else None
            rotation.append({"slot": s, "kind": "sp", **self._who(pid, signed), "pinned": pinned(s) == pid and pid is not None,
                             "value": value, "median": median})
        for s in BULLPEN:
            pid = staff.get(s)
            value = float(rp[pid]) * leverage(s) if pid in rp.index else None
            median = float(c.rep.median[plans.BULLPEN_SLOT[s]])
            bullpen.append({"slot": s, "kind": "rp", **self._who(pid, signed), "pinned": pinned(s) == pid and pid is not None,
                            "value": value, "median": median})

        for r in rows + rotation + bullpen:
            r["gap"] = None if r["value"] is None or r["median"] is None else r["value"] - r["median"]
            r["status"] = ("open" if r["id"] is None else "upgrade" if r["gap"] is not None and r["gap"] < -plans.UPGRADE_GAP
                           else "strong" if r["gap"] is not None and r["gap"] > plans.STRONG_GAP else "ok")

        # Depth: everyone else, best first.
        bench_h = (hv[~hv.player_id.isin(used)].groupby("player_id").blend.max().sort_values(ascending=False))
        bench_p = (pv[~pv.player_id.isin(taken)].groupby("player_id").xwar.max().sort_values(ascending=False))
        bench = [{**self._who(int(p), signed), "value": float(x), "pos": c.df.pos.get(p)} for p, x in bench_h.head(8).items()]
        arms = [{**self._who(int(p), signed), "value": float(x), "pos": c.df.pos.get(p)} for p, x in bench_p.head(6).items()]

        out = {"season": season, "lineup": rows, "rotation": rotation, "bullpen": bullpen, "bench": bench, "arms": arms,
               "totals": {"lineup": total, "rotation": sum(r["value"] or 0 for r in rotation), "bullpen": sum(r["value"] or 0 for r in bullpen)},
               "missing_pins": missing, "payroll": self.payroll(season, roster, signed, used | taken)}
        if fixes:
            out["candidates"] = self._candidates(hv, pv, signed)
            for r in rows + rotation + bullpen:
                r["fixes"] = self._fixes(season, r, hv, pv, used | taken) if r["status"] in ("open", "upgrade") else None
        self._cache[key] = out
        return out

    def _who(self, pid, signed):
        if pid is None:
            return {"id": None, "name": None}
        r = self.c.df.loc[pid]
        return {"id": int(pid), "name": r["name"], "b": r.b, "t": r.t, "lev": None if pd.isna(r.lev) else r.lev, "age": int(r.age),
                "planned": pid in signed}

    def payroll(self, season, roster, signed, playing):
        """$M: the 40-man (as it stands now) plus anyone else in the lineup or staff, at each one's projected cost; plus planned signings."""
        on40 = set(self.c.df.index[self.c.df.on40.fillna(False).astype(bool)])
        paid = [p for p in roster if p in on40 or p in playing]
        cost = self.c.proj[(self.c.proj.season == season) & self.c.proj.player_id.isin(paid)].set_index("player_id").cost
        total = sum(float(s["aav"] or 0) * M for s in signed.values()) + float(cost.drop(index=list(signed), errors="ignore").fillna(0).sum())
        return total / M

    def _candidates(self, hv, pv, signed):
        """Roster players with their value at each slot, for the pin pickers."""
        out = {}
        for pid, g in pd.concat([hv, pv]).groupby("player_id"):
            out[int(pid)] = {**self._who(int(pid), signed), "pos": self.c.df.pos.get(pid),
                             "at": {p: float(x) for p, x in zip(g.pos, g.blend)},
                             "vl": {p: float(x) for p, x in zip(g.pos, g.xwar_vl) if p in HIT and pd.notna(x)}}
        return out

    def _slot_value(self, df, pid, slot, kind):
        """Season value of a player in a slot, from a values frame."""
        pos = "SP" if kind == "sp" else "RP" if kind == "rp" else slot
        x = df[(df.player_id == pid) & (df.pos == pos)].blend
        if not len(x):
            return None
        return float(x.iat[0]) * (leverage(slot) if kind == "rp" else 1)

    def _fixes(self, season, row, hv, pv, used):
        c = self.c
        kind, slot, cur = row["kind"], row["slot"], row["value"] or 0
        pos = "SP" if kind == "sp" else "RP" if kind == "rp" else slot
        lev = leverage(slot) if kind == "rp" else 1
        mine = hv if kind == "hit" else pv
        internal = []
        for pid, g in mine[(mine.pos == pos) & ~mine.player_id.isin(used)].groupby("player_id"):
            val = float(g.blend.max()) * lev
            if val > cur + 0.05:
                internal.append({"id": int(pid), "name": c.name(pid), "value": val, "gain": val - cur, "lev": c.df.lev.get(pid)})
        internal = sorted(internal, key=lambda x: -x["gain"])[:2]
        if season != c.nxt:  # the market lists are for this offseason
            return {"internal": internal, "fa": [], "trade": []}
        planned = {s["player_id"] for s in store.signings()}
        fa, everyone = [], self.values(season, list(self.fa.id))
        for _, f in self.fa.iterrows():
            if f.id in planned:
                continue
            val = self._slot_value(everyone, f.id, slot, kind)
            if val is not None and val > cur + 0.1:
                ask = None if pd.isna(f.ask) else float(f.ask)
                fa.append({"id": int(f.id), "name": f["name"], "age": int(f.age), "value": val, "gain": val - cur, "ask": ask,
                           "price": None if pd.isna(f.price) else float(f.price), "source": f.source, "org": None if pd.isna(f.org) else f.org})
        fa = sorted(fa, key=lambda x: -x["gain"])[:3]
        trade, tv = [], self.values(season, list(self.targets.id))
        for _, t in self.targets.drop_duplicates("id").iterrows():
            val = self._slot_value(tv, t.id, slot, kind)
            if val is not None and val > cur + 0.3:
                trade.append({"id": int(t.id), "name": t["name"], "age": int(t.age), "org": t.org, "value": val, "gain": val - cur,
                              "yrs": None if pd.isna(t.yrs) else int(t.yrs), "avg_cost": None if pd.isna(t.avg_cost) else float(t.avg_cost),
                              "surplus": None if pd.isna(t.surplus) else float(t.surplus)})
        trade = sorted(trade, key=lambda x: -x["gain"])[:3]
        return {"internal": internal, "fa": fa, "trade": trade}

    # ------------------------------------------------------------ across seasons
    def grid(self):
        """Each slot's starter and status for the next few seasons, without the market lists."""
        out = []
        for season in self.seasons:
            p = self.plan(season, fixes=False)
            out.append({"season": season, "payroll": p["payroll"], "totals": p["totals"],
                        "slots": {r["slot"]: {"id": r["id"], "name": r["name"], "value": r["value"], "status": r["status"],
                                              "planned": r.get("planned", False), "pinned": r["pinned"]}
                                  for r in p["lineup"] + p["rotation"] + p["bullpen"][:2]}})
        return out

    def model_totals(self, season):
        p = self.plan(season, pins={}, fixes=False)
        return p["totals"]

    # ------------------------------------------------------------ decisions and moves
    def decisions(self):
        """What needs your call before next season: Rule 5 protection, tender or non-tender, 40-man room."""
        c, yr, nxt = self.c, self.c.yr, self.c.nxt
        made = {(d["player_id"], d["kind"]): d["choice"] for d in store.decisions() if d["season"] == nxt}
        forty = c.forty()
        out = []
        for b in forty["exposed"]:
            if b["eligible_now"] and b["advice"] in ("protect", "consider") and b["plan"] not in ("on", "off"):
                out.append({"kind": "rule5", "id": b["id"], "name": b["name"], "pos": b["pos"], "lev": b["lev"],
                            "text": f"Rule 5 eligible this December and not on the 40-man; model says {b['advice']}"
                                    f" (worth ${max(b['surplus'] or 0, b['perceived'] or 0):.1f}M to keep)",
                            "choices": [{"key": "protect", "label": "Protect"}, {"key": "expose", "label": "Expose"}]})
        p = c.proj[(c.proj.season == nxt) & (c.proj.status == "arb") & c.proj.player_id.isin(c.org().index)]
        ov = c.overrides()
        for _, r in p.iterrows():
            pid = int(r.player_id)
            if pid in ov or (pid, "tender") in made or pd.isna(r.cost) or pd.isna(r.market):
                continue
            if r.market < r.cost - 0.5 * M:
                out.append({"kind": "tender", "id": pid, "name": c.name(pid), "pos": c.df.pos.get(pid), "lev": c.df.lev.get(pid),
                            "text": f"Arbitration projects ~${r.cost / M:.1f}M for {r.xwar:.1f} xWAR, worth ~${r.market / M:.1f}M",
                            "choices": [{"key": "tender", "label": "Tender"}, {"key": "non-tender", "label": "Non-tender"}]})
        for pid, year in legacy_departures(c):
            out.append({"kind": "legacy_leave", "id": pid, "name": c.name(pid), "pos": c.df.pos.get(pid), "lev": c.df.lev.get(pid), "season": year,
                        "text": f"Your old free agency plan had him gone before {year}; the model has him under control through "
                                f"{c.model_last.get(pid, c.yr)}",
                        "choices": [{"key": "leaving", "label": f"Gone before {year}"}, {"key": "staying", "label": "Keep the model's"}]})
        signed_now = sum(1 for s in store.signings() if s["first_season"] == nxt and c.df.org.get(s["player_id"]) != c.team)
        projected = forty["projected"] + signed_now
        if projected > 40:
            out.append({"kind": "forty", "id": None, "name": None,
                        "text": f"The 40-man is projected at {projected} after the offseason: drop {projected - 40} (mark them on the 40-man list)",
                        "choices": []})
        return out, {**{k: forty[k] for k in ("count", "leaving", "planned_drops", "planned_adds")}, "signings": signed_now, "projected": projected}

    def moves(self, season):
        """What changes before `season`: departures (the model's or yours) and planned signings."""
        c = self.c
        ov = c.overrides()
        out = []
        for pid, r in c.departures(season).iterrows():
            out.append({"kind": "leave", "id": int(pid), "name": r["name"], "pos": r.pos, "xwar": None if pd.isna(r.xwar_y) else float(r.xwar_y),
                        "why": (ov[pid][1] or "your call") if pid in ov else "contract ends", "yours": pid in ov})
        for s in store.signings():
            if s["first_season"] == season:
                pid = s["player_id"]
                out.append({"kind": "sign", "id": pid, "name": c.name(pid), "pos": c.df.pos.get(pid), "aav": s["aav"], "years": s["years"],
                            "note": s["note"], "xwar": float(self.xwar.get((pid, season), np.nan))})
        return out


def migrate(c):
    """Once: your old lineup / staff / core picks become pins (the vs-LHP lineup as swaps where it differs)."""
    if store.flag("plans_v2"):
        return
    vr = store.slots("lineup_vr")
    for s in HIT:
        if vr.get(s, {}).get("player_id"):
            store.set_pin(c.nxt, s, "R", vr[s]["player_id"])
    for s, row in store.slots("lineup_vl").items():
        if s in HIT and row.get("player_id") and row["player_id"] != vr.get(s, {}).get("player_id"):
            store.set_pin(c.nxt, s, "L", row["player_id"])
    for plan, season, slots in [("rotation", c.nxt, SP_SLOTS), ("bullpen", c.nxt, BULLPEN),
                                ("core_lineup", c.core_year, HIT), ("core_rotation", c.core_year, SP_SLOTS)]:
        for s, row in store.slots(plan).items():
            if s in slots and row.get("player_id"):
                store.set_pin(season, s, "R", row["player_id"])
    store.set_flag("plans_v2")


def legacy_departures(c):
    """Departures you added on the old free agency page that disagree with the model and haven't been settled."""
    ov = c.overrides()
    made = {(d["player_id"], d["kind"]) for d in store.decisions()}
    out = []
    for p in store.fa_plans():
        pid, year = p["departing_id"], p["year"]
        if not pid or p["hidden"] or pid in ov or (pid, "legacy_leave") in made or pid not in c.df.index:
            continue
        if c.model_last.get(pid, c.yr) != year - 1:
            out.append((pid, year))
    return out
