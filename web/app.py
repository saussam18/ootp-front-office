"""Halifax front office: JSON API for the React app in ui/, which it also serves once built.

    .venv/bin/python serve.py            # http://127.0.0.1:8000

Model data comes from rlb.duckdb (rebuilt by refresh.py; the API picks up changes on the next
request). Your notes and plans live in data/app.sqlite. Set APP_PASSWORD to require a login
(HTTP basic auth, any username) before hosting it anywhere.
"""

import base64
import json
import os
import re
import secrets

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import trade
from load import ROOT
from trade import norm

from . import context, plans, seed, store
from .serialize import clean, frame, records

def sanitize(v):
    """Recursively make a response JSON-safe (NaN -> null, numpy -> Python)."""
    if isinstance(v, dict):
        return {str(k): sanitize(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [sanitize(x) for x in v]
    return clean(v)


class SafeJSON(JSONResponse):
    def render(self, content):
        return json.dumps(sanitize(content), ensure_ascii=False, separators=(",", ":")).encode("utf-8")


app = FastAPI(title="Halifax front office", default_response_class=SafeJSON)
DIST = ROOT / "ui" / "dist"
M = 1e6
REPORT_GROUPS = [
    ("Your team", ["depth", "contracts", "resign", "arb", "sell_high", "jump_mine"]),
    ("Market", ["fa_board", "trade_targets", "platoons", "gems_fa", "gems_blocked", "gems_buylow", "jump_others", "jump_fa"]),
    ("Model", ["aging"]),
]


@app.middleware("http")
async def basic_auth(request: Request, call_next):
    password = os.environ.get("APP_PASSWORD")
    if password:
        header = request.headers.get("authorization", "")
        ok = False
        if header.startswith("Basic "):
            try:
                ok = secrets.compare_digest(base64.b64decode(header[6:]).decode().partition(":")[2], password)
            except ValueError:
                ok = False
        if not ok:
            return Response(status_code=401, headers={"WWW-Authenticate": 'Basic realm="Halifax"'})
    return await call_next(request)


def ctx():
    c = context.get()
    seed.seed(c)
    return c


def player_brief(c, pid):
    if pid is None or pid not in c.df.index:
        return None
    r = c.df.loc[pid]
    return {"id": int(pid), "name": r["name"], "pos": clean(r.pos), "age": clean(r.age), "lev": clean(r.lev), "org": clean(r.org),
            "xwar_next": clean(r.xwar_next), "surplus": clean(r.surplus / M), "perceived": clean(r.perceived / M), "oy": clean(r.oy),
            "on40": clean(r.on40), "peak": clean(r.peak_xwar)}


# ------------------------------------------------------------------ meta and dashboard

@app.get("/api/meta")
def meta():
    c = ctx()
    return {"team": c.team, "season": c.yr, "next": c.nxt, "core_year": c.core_year, "snapshot": c.snapshot}


@app.get("/api/dashboard")
def dashboard():
    c = ctx()
    st = c.rep.standings.reset_index(drop=True)
    me = st[st.org == c.team]
    depth = c.rep.get("depth")
    return {
        "record": None if me.empty else {"w": int(me.w.iloc[0]), "l": int(me.l.iloc[0]), "rank": int(me.index[0]) + 1, "teams": len(st)},
        "projection": {"total": c.rep.total, "rank": int(c.rep.rank), "teams": c.rep.n_teams},
        "payroll": {"committed": c.rep.payroll[0], "pre_arb": c.rep.payroll[1]},
        "holes": frame(depth[depth.vs_median < -0.25].sort_values("vs_median")),
        "losing": c.losing(),
        "block": block_rows(c),
        "standings": records(st[["team", "org", "w", "l", "pct"]]),
    }


# ------------------------------------------------------------------ notes, trade block, 40-man fringe

class Note(BaseModel):
    body: str


@app.put("/api/notes/{key}")
def save_note(key: str, note: Note):
    store.set_note(key, note.body)
    return {"ok": True}


def block_rows(c):
    rows = []
    for b in store.block():
        brief = player_brief(c, b["player_id"])
        if brief:
            rows.append({**b, **brief, "pick": trade.pick_equivalent(c.lg, brief["perceived"] * M)})
    return rows


@app.get("/api/strategy")
def strategy():
    c = ctx()
    fringe = [{**f, **player_brief(c, f["player_id"])} for f in store.fringe() if player_brief(c, f["player_id"])]
    return {"notes": store.notes(), "block": block_rows(c), "fringe": fringe}


class BlockItem(BaseModel):
    player_id: int
    asking: str = ""
    note: str = ""


@app.post("/api/block")
def block_add(item: BlockItem):
    store.add_block(item.player_id, item.asking, item.note)
    return {"ok": True}


@app.delete("/api/block/{pid}")
def block_delete(pid: int):
    store.remove_block(pid)
    return {"ok": True}


class FringeItem(BaseModel):
    player_id: int
    status: str = "on"
    note: str = ""


@app.post("/api/fringe")
def fringe_add(item: FringeItem):
    store.set_fringe(item.player_id, item.status, item.note)
    return {"ok": True}


@app.delete("/api/fringe/{pid}")
def fringe_delete(pid: int):
    store.remove_fringe(pid)
    return {"ok": True}


# ------------------------------------------------------------------ plans

class Leaving(BaseModel):
    note: str = ""


@app.put("/api/leaving/{pid}")
def mark_leaving(pid: int, body: Leaving):
    """Gone after this season (declined option, release): a contract end date of this season."""
    store.set_control(pid, ctx().yr, body.note)
    return {"ok": True}


@app.delete("/api/leaving/{pid}")
def unmark_leaving(pid: int):
    store.remove_control(pid)
    return {"ok": True}


@app.get("/api/contracts")
def contracts():
    c = ctx()
    return {"season": c.yr, "years": list(range(c.yr, c.yr + 7)), "players": c.contracts()}


class Control(BaseModel):
    last_season: int | None = None  # None = back to the model's
    note: str = ""


@app.put("/api/contracts/{pid}")
def set_contract(pid: int, body: Control):
    if body.last_season is None:
        store.remove_control(pid)
    else:
        store.set_control(pid, body.last_season, body.note)
    return {"ok": True}


@app.get("/api/plans")
def get_plans():
    c = ctx()
    marked = {pid: note for pid, (last, note) in c.overrides().items() if last == c.yr}
    return {"players": c.plan_players(), "plans": {k: c.plan(k) for k in plans.PLANS}, "losing": c.losing(), "marked": marked,
            "next": c.nxt, "core_year": c.core_year, "upgrade_gap": plans.UPGRADE_GAP}


class Slot(BaseModel):
    player_id: int | None = None
    label: str = ""


@app.put("/api/plans/{key}/{slot}")
def set_slot(key: str, slot: str, s: Slot):
    if key not in plans.PLANS:
        raise HTTPException(404)
    store.set_slot(key, slot, s.player_id, "" if s.player_id else s.label)
    return ctx().plan(key)


# ------------------------------------------------------------------ free agency planning

def starters(keys):
    """Player ids in the starting slots of these plans (they're not 'next up' for anyone else)."""
    out = set()
    for k in keys:
        for slot, s in store.slots(k).items():
            if slot in plans.PLANS[k]["slots"] and s.get("player_id"):
                out.add(s["player_id"])
    return out


def fa_years(c, pools=True):
    """Per season: the ML regulars gone before it (model) plus the ones you've added, with your plans.

    Regulars = on the MLB roster now, or in a starting slot of your next-season or core plans.
    A player you've added to a season is gone before that season instead of whenever the model says.
    'Next up' is the best internal option not already starting, leaving, planned as a replacement by then, or next up for someone else."""
    saved = store.fa_plans()
    years = []
    busy_next = starters(["lineup_vr", "lineup_vl", "rotation", "bullpen"])
    busy_core = starters(["core_lineup", "core_rotation"])
    regulars = busy_next | busy_core
    seasons = range(c.nxt, c.nxt + 4)
    model = {}
    for year in seasons:
        d = c.departures(year)
        model[year] = d[(d.lev == "RLB") | d.index.isin(list(regulars))]
    added = {p["departing_id"]: p["year"] for p in saved
             if p["departing_id"] and not p["hidden"] and p["departing_id"] not in model.get(p["year"], {}).index}

    def entry(year, pid, label, plan, added):
        r = c.df.loc[pid] if pid and pid in c.df.index else None
        s = c.season(pid, year) if r is not None else None
        pos = r.pos if r is not None else ""
        if plan:
            plan = {**plan, "replacement_name": c.name(plan["replacement_id"]) or plan["replacement_label"]}
        return {"id": int(pid) if r is not None else None, "name": r["name"] if r is not None else label, "label": label, "pos": pos,
                "age": clean(r.age) if r is not None else None, "lev": clean(r.lev) if r is not None else None,
                "salary": clean((r.slr or 0) / M) if r is not None else None,
                "xwar": clean(s.xwar) if s is not None else None, "worth": clean(s.market / M) if s is not None else None,
                "price": clean(s.price / M) if s is not None else None, "plan": plan, "added": added,
                "_best": (r.best_pos if pd.notna(r.best_pos) else pos) if r is not None else None}

    for year in seasons:
        busy = busy_core if year >= c.core_year else busy_next
        d = model[year]
        gone = set(d.index) | {pid for pid, y in added.items() if y <= year}
        mine = {(p["departing_id"], p["departing_label"]): p for p in saved if p["year"] == year}
        rows, hidden = [], 0
        for pid in d.index:
            plan = mine.pop((pid, ""), None)
            if plan and plan["hidden"]:
                hidden += 1
                continue
            if pid in added and added[pid] != year:  # you've put him in another season
                continue
            rows.append(entry(year, pid, "", plan, False))
        for p in mine.values():  # ones you added (trades, releases, old notes)
            if not p["hidden"]:
                rows.append(entry(year, p["departing_id"] or None, p["departing_label"], p, True))
        claimed = {p["replacement_id"] for p in saved if p["replacement_id"] and not p["hidden"] and p["year"] <= year}  # planned from then on
        for r in sorted(rows, key=lambda r: -(r["xwar"] or 0)):
            best = r.pop("_best")
            r["options"] = c.internal_options(year, best, busy | gone | claimed) if best is not None else []
            if r["options"] and not (r["plan"] and r["plan"]["replacement_id"]):
                claimed.add(r["options"][0]["id"])
        pool = [{"id": int(pid), "name": r["name"], "pos": r.pos, "lev": r.lev}
                for pid, r in c.org().sort_values("name").iterrows() if c.controlled(pid, year)] if pools else []
        years.append({"year": year, "rows": rows, "hidden": hidden, "pool": pool})
    return years


@app.get("/api/fa")
def fa():
    return {"years": fa_years(ctx())}


class FaPlan(BaseModel):
    year: int
    departing_id: int = 0
    departing_label: str = ""
    replacement_id: int | None = None
    replacement_label: str = ""
    note: str = ""
    hidden: bool = False


@app.put("/api/fa")
def fa_save(p: FaPlan):
    """Set a replacement plan; also adds your own departures, or hides a model one (hidden=True)."""
    store.set_fa_plan(p.year, p.departing_id, p.departing_label, p.replacement_id, "" if p.replacement_id else p.replacement_label,
                      p.note, p.hidden)
    return {"ok": True}


@app.post("/api/fa/{year}/unhide")
def fa_unhide(year: int):
    store.unhide_fa_plans(year)
    return {"ok": True}


@app.delete("/api/fa")
def fa_delete(year: int, departing_id: int = 0, departing_label: str = ""):
    store.remove_fa_plan(year, departing_id, departing_label)
    return {"ok": True}


# ------------------------------------------------------------------ team plan board, 40-man, moves

@app.get("/api/board")
def board():
    """The one-page team plan: lineups, staff, minors, core, FA timeline, needs, 40-man count."""
    c = ctx()
    forty = c.forty()
    return {"players": c.plan_players(), "plans": {k: c.plan(k, with_options=False) for k in plans.PLANS},
            "fa": fa_years(c), "losing": c.losing(),
            "forty": {k: forty[k] for k in ("count", "leaving", "planned_drops", "planned_adds", "projected")},
            "must_protect": [b for b in forty["exposed"] if b["eligible_now"] and b["advice"] == "protect" and b["plan"] != "on"],
            "next": c.nxt, "core_year": c.core_year, "season": c.yr}


@app.get("/api/forty")
def forty():
    return ctx().forty()


class FortyPlan(BaseModel):
    status: str | None = None  # "on" = keep / protect, "off" = drop / expose, None = undecided
    note: str = ""


@app.put("/api/forty/{pid}")
def forty_plan(pid: int, p: FortyPlan):
    if p.status in ("on", "off"):
        store.set_fringe(pid, p.status, p.note)
    else:
        store.remove_fringe(pid)
    return {"ok": True}


@app.get("/api/moves")
def get_moves():
    return {"moves": ctx().moves()}


@app.put("/api/moves/{key}")
def move_note(key: str, note: Note):
    store.set_move_note(key, note.body.strip())
    return {"ok": True}


# ------------------------------------------------------------------ roster, players

ROSTER_COLS = ["id", "name", "pos", "best_pos", "age", "lev", "b", "t", "xwar_next", "peak_xwar", "ceiling_xwar", "control_years",
               "avg_cost", "surplus", "perceived", "oy", "on40", "p_jump", "prone", "we"]


@app.get("/api/roster")
def roster(org: str = "", q: str = ""):
    c = ctx()
    d = c.players
    if q:
        d = d[d.name.map(norm).str.contains(norm(q), regex=False)]
    elif (org or c.team) != "all":
        d = d[d.lev.isna()] if org == "FA" else d[d.org == (org or c.team)]
    d = d.assign(avg_cost=d.avg_cost / M, surplus=d.surplus / M, perceived=d.perceived / M)
    order = {"RLB": 0, "AAA": 1, "AA": 2, "A": 3, "R": 4, "INT": 5}
    d = d.assign(_o=d.lev.map(order).fillna(9)).sort_values(["_o", "xwar_next"], ascending=[True, False])
    return {"orgs": sorted(c.players.org.dropna().unique()), "table": frame(d[ROSTER_COLS])}


@app.get("/api/player/{pid}")
def player(pid: int):
    c = ctx()
    if pid not in c.df.index or pid < 0:
        raise HTTPException(404)
    r = c.df.loc[pid]
    det = c.player_detail(pid)
    proj = det["projection"].assign(cost=lambda d: d.cost / M, worth=lambda d: d.market / M, surplus=lambda d: d.surplus / M)
    return {
        "player": {k: clean(v) for k, v in r.items()},
        "on_block": any(b["player_id"] == pid for b in store.block()),
        "mine": r.org == c.team,
        "projection": frame(proj[["season", "age", "xwrc", "xfip", "xwar", "status", "cost", "worth", "surplus"]]),
        "positions": frame(det["positions"][["pos", "xwar", "xwar_vr", "xwar_vl", "glove", "playable"]].sort_values("xwar", ascending=False)),
        "history": records(det["history"]),
        "tables": {k: frame(det[k]) for k in ("ratings", "potential", "pitches", "fielding", "personality", "stats", "contracts", "injuries")
                   if det[k] is not None},
        "trades": det["trades"],
        "comps": comps_json(trade.comps(c.lg, pid, 10)),
    }


@app.get("/api/players")
def players(q: str = "", scope: str = "all", limit: int = 15):
    """Autocomplete: [{id, label}] for names containing q; scope = all | mine | others. 'R3' finds a draft pick."""
    c = ctx()
    out = []
    if m := re.fullmatch(r"r(\d+)( pick)?", q.strip().casefold()):
        out.append({"id": -int(m.group(1)), "label": f"R{m.group(1)} pick"})
    if len(q.strip()) >= 2:
        d = c.players
        if scope == "mine":
            d = d[d.org == c.team]
        elif scope == "others":
            d = d[d.org != c.team]
        hits = d[d.name.map(norm).str.contains(norm(q), regex=False)].sort_values("xwar_next", ascending=False).head(limit)
        out += [{"id": int(pid), "label": r["name"], "detail": f"{r.pos} · {r.org or 'FA'} {r.lev or ''} · {r.xwar_next:.1f} xWAR"}
                for pid, r in hits.iterrows()]
    return out


# ------------------------------------------------------------------ trade lab

def labels(c, xs):
    return [{"id": x, "label": c.name(x)} for x in xs]


@app.get("/api/trade/eval")
def trade_eval(give: list[int] = Query([]), get: list[int] = Query([])):
    c = ctx()
    r = trade.evaluate(c.lg, give, get)
    return {"cards": frame(r["cards"]), "surplus_gain": r["surplus_gain"], "their_gain": r["their_gain"], "depth": r["depth"],
            "partners": [{"org": o, "before": b, "after": a} for o, (b, a) in r["partners"].items()],
            "payroll": {int(k): float(v) for k, v in r["payroll"].items()}, "rentals": r["rentals"]}


@app.get("/api/trade/shop")
def trade_shop(give: list[int] = Query([])):
    c = ctx()
    r = trade.shop(c.lg, give)
    return {**{k: r[k] for k in ("names", "surplus", "perceived", "cap", "pick")},
            "lists": [{"title": t, "table": frame(df.head(30))} for t, df in r["lists"]]}


@app.get("/api/trade/offer")
def trade_offer(get: list[int] = Query([]), protect: list[int] = Query([])):
    c = ctx()
    r = trade.offer(c.lg, get, protect)
    pk = r["packages"]
    packages = [] if not len(pk) else [{"players": labels(c, row.ids), **{k: clean(row[k]) for k in
                                                                          ("perceived", "surplus_given", "your_gain", "your_depth", "their_depth")}}
                                       for _, row in pk.head(20).iterrows()]
    return {**{k: r[k] for k in ("names", "surplus", "perceived", "pool", "protected")}, "packages": packages}


def comps_json(r):
    return {"title": r["title"], "deals": [{"date": d["date"].isoformat(), "sides": [{"team": t, "items": i} for t, i in d["sides"]]}
                                           for d in r["deals"]]}


@app.get("/api/trade/comps/{pid}")
def trade_comps(pid: int):
    return comps_json(trade.comps(ctx().lg, pid, 20))


@app.get("/api/picks")
def picks():
    return frame(trade.picks_table(ctx().lg).head(10))


# ------------------------------------------------------------------ reports

@app.get("/api/reports")
def reports():
    c = ctx()
    secs = {k: (t, df) for k, t, df, _ in c.rep.sections}
    return [{"group": g, "reports": [{"key": k, "title": secs[k][0].split(":")[0].strip(),
                                      "desc": secs[k][0].split(":", 1)[1].strip() if ":" in secs[k][0] else "", "rows": len(secs[k][1])}
                                     for k in keys if k in secs]} for g, keys in REPORT_GROUPS]


@app.get("/api/reports/{key}")
def report(key: str):
    c = ctx()
    sec = next((s for s in c.rep.sections if s[0] == key), None)
    if not sec:
        raise HTTPException(404)
    title, _, desc = sec[1].partition(":")
    return {"key": key, "title": title.strip(), "desc": desc.strip(), "note": c.rep.notes.get(key), "table": frame(sec[2])}


# ------------------------------------------------------------------ the React app

if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404)
    index = DIST / "index.html"
    if not index.exists():
        return Response("The UI isn't built yet: cd ui && pnpm install && pnpm build (or pnpm dev for development).", media_type="text/plain")
    return FileResponse(index)
