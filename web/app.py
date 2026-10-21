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
from . import planner as planner_mod
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
DIST = ROOT / "web" / "static"  # the built UI (ui/ builds into it)
M = 1e6
REPORT_GROUPS = [
    ("Your team", ["depth", "contracts", "resign", "arb", "sell_high", "jump_mine"]),
    ("Market", ["fa_board", "trade_targets", "platoons", "gems_fa", "gems_blocked", "gems_buylow", "jump_others", "jump_fa"]),
    ("Model", ["aging"]),
]


@app.middleware("http")
async def read_only(request: Request, call_next):
    if store.READ_ONLY and request.method not in ("GET", "HEAD", "OPTIONS"):
        return JSONResponse({"detail": "This is a read-only demo."}, status_code=403)
    return await call_next(request)


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
    return {"team": c.team, "season": c.yr, "next": c.nxt, "core_year": c.core_year, "snapshot": c.snapshot, "read_only": store.READ_ONLY}


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


# ------------------------------------------------------------------ the season plan (web/planner.py)

_planners = {}


def planner():
    c = ctx()
    if id(c) not in _planners:
        _planners.clear()
        planner_mod.migrate(c)
        _planners[id(c)] = planner_mod.Planner(c)
    return _planners[id(c)]


@app.get("/api/plan")
def get_plan(season: int | None = None):
    pl = planner()
    c = pl.c
    season = season if season in pl.seasons else c.nxt
    out = {**pl.plan(season), "seasons": pl.seasons, "next": c.nxt, "current": c.yr, "core_year": c.core_year, "lhp": pl.lhp,
           "model_totals": pl.model_totals(season), "moves": pl.moves(season), "grid": pl.grid(),
           "upgrade_gap": plans.UPGRADE_GAP, "strong_gap": plans.STRONG_GAP,
           "watch": {k: [{"slot": slot, "id": r["player_id"], "name": c.name(r["player_id"]), "pos": c.df.pos.get(r["player_id"]),
                          "lev": c.df.lev.get(r["player_id"])}
                         for slot, r in sorted(store.slots(k).items()) if r.get("player_id") in c.df.index]
                     for k in ("minors_hit", "minors_pit")}}
    if season == c.nxt:
        out["decisions"], out["forty"] = pl.decisions()
    return out


class Pin(BaseModel):
    season: int
    slot: str
    hand: str = "R"
    player_id: int | None = None  # None = back to the model's pick


@app.put("/api/pins")
def set_pin(p: Pin):
    store.set_pin(p.season, p.slot, p.hand if p.hand in ("R", "L") else "R", p.player_id)
    return {"ok": True}


@app.delete("/api/pins")
def reset_pins(season: int, group: str = "all"):
    slots = {"lineup": plans.HIT, "staff": planner_mod.SP_SLOTS + plans.BULLPEN}.get(group, plans.HIT + planner_mod.SP_SLOTS + plans.BULLPEN)
    store.clear_pins(season, slots)
    return {"ok": True}


class Signing(BaseModel):
    player_id: int
    first_season: int
    years: int = 1
    aav: float | None = None  # $M a year
    note: str = ""


@app.post("/api/signings")
def add_signing(s: Signing):
    store.set_signing(s.player_id, s.first_season, max(1, s.years), s.aav, s.note)
    return {"ok": True}


@app.delete("/api/signings/{pid}")
def drop_signing(pid: int):
    store.remove_signing(pid)
    return {"ok": True}


class Decision(BaseModel):
    player_id: int
    kind: str  # rule5, tender, legacy_leave
    choice: str
    season: int | None = None  # legacy_leave: the season he's gone before


@app.put("/api/decisions")
def decide(d: Decision):
    c = ctx()
    if d.kind == "rule5":
        store.set_fringe(d.player_id, "on" if d.choice == "protect" else "off")
    elif d.kind == "tender":
        if d.choice == "non-tender":
            store.set_control(d.player_id, c.yr, "non-tender")
        store.set_decision(d.player_id, c.nxt, "tender", d.choice)
    elif d.kind == "legacy_leave":
        if d.choice == "leaving" and d.season:
            store.set_control(d.player_id, d.season - 1, "from your free agency plan")
        store.set_decision(d.player_id, c.nxt, "legacy_leave", d.choice)
    else:
        raise HTTPException(400, "unknown decision")
    return {"ok": True}


class Slot(BaseModel):
    player_id: int | None = None
    label: str = ""


@app.put("/api/plans/{key}/{slot}")
def set_slot(key: str, slot: str, s: Slot):
    if key not in plans.PLANS:
        raise HTTPException(404)
    store.set_slot(key, slot, s.player_id, "" if s.player_id else s.label)
    return {"ok": True}


# ------------------------------------------------------------------ 40-man, moves

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
