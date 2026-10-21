"""Your own data: notes, trade block, 40-man fringe, lineup/staff plans, free agency plans.

Kept in data/app.sqlite, separate from rlb.duckdb (which is rebuilt on every refresh).
"""

import os
import shutil
import sqlite3
from datetime import date
from pathlib import Path

from load import ROOT

PATH = ROOT / "data" / "app.sqlite"
# Read-only (the public demo; on by default on Vercel): the API refuses edits, and the app reads a scratch
# copy because the deployed files can't be written to.
READ_ONLY = os.environ.get("READ_ONLY", "1" if os.environ.get("VERCEL") else "") == "1"
if READ_ONLY:
    scratch = Path("/tmp/app.sqlite")
    if not scratch.exists() and PATH.exists():
        shutil.copy(PATH, scratch)
    PATH = scratch

SCHEMA = """
create table if not exists notes (key text primary key, body text not null default '', updated text);
create table if not exists block (player_id integer primary key, asking text not null default '', note text not null default '', added text);
create table if not exists fringe (player_id integer primary key, status text not null, note text not null default '');
create table if not exists slots (plan text, slot text, player_id integer, label text not null default '', primary key (plan, slot));
create table if not exists leaving (player_id integer primary key, note text not null default '');
create table if not exists control (player_id integer primary key, last_season integer not null, note text not null default '');
create table if not exists move_notes (key text primary key, note text not null default '');
create table if not exists pins (season integer, slot text, hand text not null default 'R', player_id integer not null, primary key (season, slot, hand));
create table if not exists signings (player_id integer primary key, first_season integer not null, years integer not null default 1,
    aav real, note text not null default '');
create table if not exists decisions (player_id integer, season integer, kind text, choice text not null, primary key (player_id, season, kind));
create table if not exists flags (key text primary key, value text not null default '');
create table if not exists fa_plan (
    year integer, departing_id integer, departing_label text not null default '',
    replacement_id integer, replacement_label text not null default '', note text not null default '',
    primary key (year, departing_id, departing_label)
);
"""


VERSION = [0]  # bumped on every write that changes a plan (control, pins, signings, decisions, 40-man), so callers can cache


def connect():
    PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(PATH)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    if "hidden" not in {r["name"] for r in con.execute("pragma table_info(fa_plan)")}:  # added later
        con.execute("alter table fa_plan add column hidden integer not null default 0")
    return con


def is_empty():
    with connect() as con:
        return not any(con.execute(f"select 1 from {t} limit 1").fetchone() for t in ("notes", "block", "slots", "fa_plan"))


# ------------------------------------------------------------------ notes

def notes():
    with connect() as con:
        return {r["key"]: r["body"] for r in con.execute("select key, body from notes")}


def set_note(key, body):
    with connect() as con:
        con.execute("insert into notes values (?, ?, ?) on conflict (key) do update set body = excluded.body, updated = excluded.updated",
                    (key, body, date.today().isoformat()))


# ------------------------------------------------------------------ trade block / 40-man fringe

def block():
    with connect() as con:
        return [dict(r) for r in con.execute("select * from block order by added, player_id")]


def add_block(pid, asking="", note=""):
    with connect() as con:
        con.execute("insert or replace into block values (?, ?, ?, ?)", (pid, asking, note, date.today().isoformat()))


def remove_block(pid):
    with connect() as con:
        con.execute("delete from block where player_id = ?", (pid,))


def fringe():
    with connect() as con:
        return [dict(r) for r in con.execute("select * from fringe order by status, player_id")]


def set_fringe(pid, status, note=""):
    with connect() as con:
        con.execute("insert or replace into fringe values (?, ?, ?)", (pid, status, note))
    VERSION[0] += 1


def remove_fringe(pid):
    with connect() as con:
        con.execute("delete from fringe where player_id = ?", (pid,))
    VERSION[0] += 1


# ------------------------------------------------------------------ contract end dates you set

def control():
    """{player_id: (last_season, note)}: your call on when a player's control ends, overriding the model
    (declined or exercised team options, planned releases). The old 'leaving' marks are folded in."""
    with connect() as con:
        out = {r["player_id"]: (r["last_season"], r["note"]) for r in con.execute("select * from control")}
        legacy = {r["player_id"]: r["note"] for r in con.execute("select * from leaving")}
    return out, legacy


def set_control(pid, last_season, note=""):
    with connect() as con:
        con.execute("insert or replace into control values (?, ?, ?)", (pid, last_season, note))
        con.execute("delete from leaving where player_id = ?", (pid,))
    VERSION[0] += 1


def remove_control(pid):
    with connect() as con:
        con.execute("delete from control where player_id = ?", (pid,))
        con.execute("delete from leaving where player_id = ?", (pid,))
    VERSION[0] += 1


# ------------------------------------------------------------------ notes on logged moves

def move_notes():
    with connect() as con:
        return {r["key"]: r["note"] for r in con.execute("select * from move_notes")}


def set_move_note(key, note):
    with connect() as con:
        if note:
            con.execute("insert or replace into move_notes values (?, ?)", (key, note))
        else:
            con.execute("delete from move_notes where key = ?", (key,))


# ------------------------------------------------------------------ plans (lineups, staff, core)

def slots(plan):
    with connect() as con:
        return {r["slot"]: dict(r) for r in con.execute("select * from slots where plan = ?", (plan,))}


def set_slot(plan, slot, pid=None, label=""):
    with connect() as con:
        if pid is None and not label:
            con.execute("delete from slots where plan = ? and slot = ?", (plan, slot))
        else:
            con.execute("insert or replace into slots values (?, ?, ?, ?)", (plan, slot, pid, label))


# ------------------------------------------------------------------ free agency plans

def fa_plans():
    with connect() as con:
        return [dict(r) for r in con.execute("select * from fa_plan order by year")]


def set_fa_plan(year, departing_id, departing_label, replacement_id, replacement_label, note="", hidden=False):
    """departing_id 0 = a free-text entry (departing_label), so the primary key never holds NULL.
    hidden: a departure the model lists that you've removed from the timeline."""
    with connect() as con:
        con.execute("insert or replace into fa_plan values (?, ?, ?, ?, ?, ?, ?)",
                    (year, departing_id or 0, departing_label or "", replacement_id, replacement_label or "", note or "", int(hidden)))


def unhide_fa_plans(year):
    with connect() as con:
        con.execute("update fa_plan set hidden = 0 where year = ?", (year,))


def remove_fa_plan(year, departing_id, departing_label):
    with connect() as con:
        con.execute("delete from fa_plan where year = ? and departing_id = ? and departing_label = ?",
                    (year, departing_id or 0, departing_label or ""))


# ------------------------------------------------------------------ the season plan (web/planner.py)

def pins(season):
    """{(slot, hand): player_id}: slots you've decided yourself; hand 'L' is a vs-LHP swap."""
    with connect() as con:
        return {(r["slot"], r["hand"]): r["player_id"] for r in con.execute("select * from pins where season = ?", (season,))}


def set_pin(season, slot, hand, pid):
    with connect() as con:
        if pid is None:
            con.execute("delete from pins where season = ? and slot = ? and hand = ?", (season, slot, hand))
        else:
            con.execute("insert or replace into pins values (?, ?, ?, ?)", (season, slot, hand, pid))
    VERSION[0] += 1


def clear_pins(season, slots):
    with connect() as con:
        con.executemany("delete from pins where season = ? and slot = ?", [(season, s) for s in slots])
    VERSION[0] += 1


def signings():
    with connect() as con:
        return [dict(r) for r in con.execute("select * from signings order by first_season, player_id")]


def set_signing(pid, first_season, years, aav, note=""):
    with connect() as con:
        con.execute("insert or replace into signings values (?, ?, ?, ?, ?)", (pid, first_season, years, aav, note))
    VERSION[0] += 1


def remove_signing(pid):
    with connect() as con:
        con.execute("delete from signings where player_id = ?", (pid,))
    VERSION[0] += 1


def decisions():
    with connect() as con:
        return [dict(r) for r in con.execute("select * from decisions")]


def set_decision(pid, season, kind, choice):
    with connect() as con:
        if choice is None:
            con.execute("delete from decisions where player_id = ? and season = ? and kind = ?", (pid, season, kind))
        else:
            con.execute("insert or replace into decisions values (?, ?, ?, ?)", (pid, season, kind, choice))
    VERSION[0] += 1


def flag(key):
    with connect() as con:
        r = con.execute("select value from flags where key = ?", (key,)).fetchone()
        return r["value"] if r else None


def set_flag(key, value="1"):
    with connect() as con:
        con.execute("insert or replace into flags values (?, ?)", (key, value))
