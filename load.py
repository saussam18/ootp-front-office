"""Load OOTP 27 RLB CSV exports into a DuckDB database.

Each run snapshots the current exports (keyed by the league file's download
time) into data/snapshots/<snapshot>/, then rebuilds rlb.duckdb from every
snapshot so ratings can be compared over time.

    .venv/bin/python load.py
"""

import csv
import filecmp
import glob
import os
import re
import shutil
from pathlib import Path

import duckdb
import pandas as pd

import teamfile

LEAGUE = Path.home() / "Application Support/Out of the Park Developments/OOTP Baseball 27/saved_games/rlb.lg"
EXPORTS = LEAGUE / "import_export"
ROOT = Path(__file__).resolve().parent
SNAPSHOTS = ROOT / "data" / "snapshots"
DB = ROOT / "rlb.duckdb"

# Export file suffix -> table name. Anything else gets a table named after its suffix.
TABLES = {
    "player_list_default": "players",
    "player_list_batting_ratings": "bat_ratings",
    "player_list_batting_potential": "bat_potential",
    "player_list_fielding_ratings": "fielding",
    "player_list_pitching_ratings": "pit_ratings",
    "player_list_pitching_potential": "pit_potential",
    "player_list_financial_info": "contracts",
    "player_list_personality___morale": "personality",
    "player_list_position_ratings": "position_ratings",
    "player_list_individual_pitch_ratings": "pitches",
    "player_list_individual_pitch_potential": "pitch_potential",
    "player_list_batting_stats_main": "bat_stats",
    "player_list_pitching_stats_main": "pit_stats",
    "player_list_batter_prospect": "bat_profile",
    "player_list_pitcher_prospect": "pit_profile",
    # Older manual exports from Statistics > Sortable Stats; the player list versions above win.
    "sortable_stats_batting_stats_main": "bat_stats",
    "sortable_stats_pitching_stats_main": "pit_stats",
    "sortable_stats_batter_prospect": "bat_profile",
    "sortable_stats_pitcher_prospect": "pit_profile",
    "sortable_stats_default": None,  # MLB/AAA-only subset of players; redundant
}
LEVELS = {"Rookie League": "R", "Single A": "A", "Double A": "AA", "Triple A": "AAA"}
# Columns that repeat the master player list in every export.
BIO = {"num", "inf", "b", "t", "ovr", "pot", "sctacc", "mor"}


def snapshot_id():
    raw = (LEAGUE / "settings" / "online_league_file_time.cfg").read_bytes()
    stamp = re.search(rb"\d{14}", raw).group().decode()
    return f"{stamp[:8]}-{stamp[8:12]}"


def take_snapshot():
    snap = snapshot_id()
    dest = SNAPSHOTS / snap
    dest.mkdir(parents=True, exist_ok=True)
    copied = 0
    for src in [*EXPORTS.glob("rlb_*.csv"), *EXPORTS.glob("team_*.ootp")]:
        out = dest / src.name
        if not out.exists() or not filecmp.cmp(src, out, shallow=False):
            shutil.copy2(src, out)
            copied += 1
    print(f"snapshot {snap}: {copied} new/changed file(s)")


def table_for(filename):
    suffix = re.sub(r"^rlb_.*?_-_(rlb_)?", "", Path(filename).stem)
    return TABLES.get(suffix, re.sub(r"\W+", "_", suffix))


def snake(col):
    col = col.replace("%", "_pct").replace("+", "_plus").replace("#", "num").replace("'", "")
    return re.sub(r"\W+", "_", col).strip("_").lower()


def money(v):
    v = v.replace("$", "").replace(" ", "")
    mult = 1_000_000 if v.endswith("m") else 1_000 if v.endswith("k") else 1
    return float(v.rstrip("mk")) * mult


NUM = re.compile(r"-?(\d+)?\.?\d+")


def parse_column(name, values):
    """Convert one column's strings to typed values; returns {col: series}."""
    blank = values.isin(["", "-"])
    present = values[~blank]
    if name == "ip":
        parts = present.str.extract(r"(\d+)(?:\.(\d))?").astype(float).fillna(0)
        return {name: (parts[0] + parts[1] / 3).reindex(values.index)}
    if name == "yl":
        parts = values.str.extract(r"(\d+)(?: \((\w+)\.?\))?")
        return {"yl": pd.to_numeric(parts[0]), "yl_status": parts[1]}
    if name == "velo":
        parts = values.str.extract(r"(\d+)-(\d+)")
        return {"velo_lo": pd.to_numeric(parts[0]), "velo_hi": pd.to_numeric(parts[1])}
    if name == "ht":
        parts = values.str.extract(r"(\d+)' (\d+)")
        return {"ht_in": pd.to_numeric(parts[0]) * 12 + pd.to_numeric(parts[1])}
    if name == "wt":
        return {"wt_lb": pd.to_numeric(values.str.extract(r"(\d+)")[0])}
    if name == "dob":
        return {name: pd.to_datetime(values, format="%m/%d/%Y", errors="coerce").dt.date}
    if len(present) and present.str.startswith("$").mean() > 0.5:  # salary columns also hold "Free agent"
        return {name: values.where(values.str.startswith("$")).map(money, na_action="ignore")}
    if len(present) and present.str.fullmatch(r"-?[\d.]+%").all():
        return {name: pd.to_numeric(present.str.rstrip("%")).reindex(values.index)}
    if len(present) and present.str.fullmatch(NUM).all():
        return {name: pd.to_numeric(present).reindex(values.index)}
    if name == "on40":
        return {name: values.eq("Yes")}
    return {name: values.where(values != "")}


def read_export(path):
    raw = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    cols = {}
    for col in raw.columns:
        cols.update(parse_column(snake(col), raw[col].str.strip()))
    return pd.DataFrame(cols)


def abbrev(name):
    first, _, rest = name.partition(" ")
    return f"{first[0]}. {rest}" if rest else name


def mlb_teams():
    """MLB team id -> every label its box score links use ("Houston", "Houston Red Bulls", ...)."""
    teams = {}
    for f in glob.glob(str(LEAGUE / "news/html/box_scores/*.html")):
        text = open(f, encoding="utf-8", errors="replace").read()
        if "<title>RLB Box Score" in text:
            for team_id, label in re.findall(r'team_(\d+)\.html"[^>]*>([^<]+)<', text):
                teams.setdefault(team_id, set()).add(label)
    return teams


def affiliations(teams):
    """(level, affiliate) -> parent MLB org id, from each org's latest transaction log links."""
    link = re.compile(r'(Rookie League|Single A|Double A|Triple A) <a href="\.\./teams/team_(\d+)\.html">([^<]+)</a>')
    latest = {}
    for org_id in teams:
        paths = [LEAGUE / f"news/txt/teams/team_{org_id}_{log}.txt" for log in ("transactions", "all_transactions")]
        lines = [line for p in paths if p.exists() for line in open(p, encoding="utf-8", errors="replace")]
        for line in lines:
            date = line.split("\t", 1)[0]
            for level, _, aff in link.findall(line):
                key = (LEVELS[level], aff)
                if key not in latest or date > latest[key][0]:
                    latest[key] = (date, org_id)
    return {key: org_id for key, (_, org_id) in latest.items()}


def build_snapshot(con, snap_dir, teams, aff):
    snap = snap_dir.name
    frames = {}
    # Player list exports sort after Sortable Stats ones ("statistics" < "transactions"), so they win.
    for path in sorted(snap_dir.glob("rlb_*.csv")):
        table = table_for(path.name)
        if table:
            frames[table] = read_export(path)

    players = frames.pop("players")
    players["lev"] = players["lev"].where(players["lev"] != "-")
    # Name each org id the way the exports do: the label that is also an MLB team in the export.
    mlb = set(players.loc[players["lev"] == "RLB", "tm"])
    org_name = {org_id: next(iter(labels & mlb), None) for org_id, labels in teams.items()}
    def org(lev, tm):
        if lev == "RLB":
            return tm
        if lev == "INT":  # international complex: "Ottawa (INT)"
            return tm.removesuffix(" (INT)")
        return org_name.get(aff.get((lev, tm)))

    players["org"] = [org(lev, tm) for lev, tm in zip(players["lev"], players["tm"])]
    players["abbr"] = players["name"].map(abbrev)

    full_key = {k: i for k, i in zip(zip(players["name"], players["age"], players["pos"]), players["id"])}
    abbr_key = {}
    for k, i, lev in zip(zip(players["abbr"], players["age"], players["pos"]), players["id"], players["lev"]):
        abbr_key.setdefault(k, []).append((i, lev))

    def resolve_abbr(k):
        hits = abbr_key.get(k, [])
        if len(hits) > 1:  # stats views are MLB-level; prefer MLB, then AAA
            hits = [h for h in hits if h[1] == "RLB"] or [h for h in hits if h[1] == "AAA"] or hits
        return hits[0][0] if len(hits) == 1 else None

    def save(table, df):
        df.insert(0, "snapshot", snap)
        con.register("df", df)
        exists = con.execute(f"select count(*) from information_schema.tables where table_name = '{table}'").fetchone()[0]
        if exists:
            con.execute(f"insert into {table} by name select * from df")
        else:
            con.execute(f"create table {table} as select * from df")
        con.unregister("df")

    save("players", players.drop(columns=["ovr", "pot"]))
    for table, df in frames.items():
        abbreviated = df["name"].str.fullmatch(r"\w\. .+").mean() > 0.9
        keys = zip(df["name"], df["age"], df["pos"])
        df.insert(0, "player_id", [resolve_abbr(k) if abbreviated else full_key.get(k) for k in keys])
        missing = df["player_id"].isna().sum()
        df = df.drop(columns=[c for c in df.columns if c in BIO | {"name", "age", "pos"}])
        if abbreviated:
            # A minor leaguer can share "J. Kim", age and position with an MLB player and
            # resolve to the same id; keep whichever row actually has data.
            df = df.assign(_filled=df.notna().sum(axis=1)).sort_values("_filled", ascending=False)
            df = df[df["player_id"].isna() | ~df.duplicated("player_id")].drop(columns="_filled")
        save(table, df)
        print(f"  {snap} {table:14} {len(df):5} rows" + (f"  ({missing} unmatched)" if missing else ""))
    unmapped = players.loc[players["lev"].isin(LEVELS.values()) & players["org"].isna(), "tm"].unique()
    if len(unmapped):
        print(f"  affiliates with no parent org: {sorted(unmapped)}")

    # Your lineups, depth charts, rotation and rosters, from the team file you upload.
    path = teamfile.find(snap_dir)
    if path:
        team_id, frames = teamfile.parse(path)
        known = set(players["id"])
        for table, df in frames.items():
            unknown = (~df["player_id"].isin(known)).sum()
            if unknown:  # the file layout moved; better no table than a wrong lineup
                print(f"  {snap} {table:14} skipped: {unknown} ids not in the player list (team file format changed?)")
                continue
            save(table, df.assign(team_id=team_id))
            print(f"  {snap} {table:14} {len(df):5} rows (team file saved {df['saved'].iat[0]})")


def build_db():
    if DB.exists():
        DB.unlink()
    con = duckdb.connect(str(DB))
    teams = mlb_teams()
    aff = affiliations(teams)
    for snap_dir in sorted(p for p in SNAPSHOTS.iterdir() if p.is_dir()):
        build_snapshot(con, snap_dir, teams, aff)
    latest = con.execute("select max(snapshot) from players").fetchone()[0]
    tables = [r[0] for r in con.execute("select table_name from information_schema.tables where table_type = 'BASE TABLE'").fetchall()]
    for t in tables:
        con.execute(f"create view cur_{t} as select * exclude (snapshot) from {t} where snapshot = '{latest}'")
    con.close()
    print(f"built {DB.name}; cur_* views point at {latest}")


if __name__ == "__main__":
    take_snapshot()
    build_db()
