"""Read your lineups, depth charts, rotation and rosters from the team file OOTP writes for upload.

OOTP saves import_export/team_<id>.ootp each time you export your team to send to the league,
so it holds exactly what you've set: no screen scraping needed. The format is undocumented;
these offsets were mapped against the game screens (OOTP 27, Oct 2131) and every list is checked
against the player list when loaded, so a layout change shows up as unknown ids rather than junk.

    .venv/bin/python teamfile.py          # print what the latest team file says
"""

import struct
import sys
from pathlib import Path

import pandas as pd

POS = {1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF", 10: "DH"}
DEPTH_POS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"]
STARTS = {0: "", 1: "if starter tired", 3: "every 3rd game"}  # the utility players' "Starts" setting

TEAM_ID = 13  # int32
# Lineups: 9 x (int32 player, byte position); depth charts: 9 x 24-byte records, then 4 pinch
# hitters and 4 pinch runners as (byte, int32 player). Keyed by the opposing pitcher's hand.
LINEUP = {"R": 1355, "L": 1400}
DEPTH = {"R": 689, "L": 1001}
DEPTH_REC = 24
PINCH = {"PH": 220, "PR": 244}  # from the depth chart start
ROTATION = (1445, 5)
# Roster lists of int32 player ids (0 = empty slot): (offset, slots).
ROSTERS = {
    "active": (9901, 30),   # the 26 who can play now (all the lineup screen shows)
    "mlb": (1839, 50),      # MLB roster incl. players not active (30 in Oct 2131)
    "mlb_il": (4239, 50),   # mlb plus the injured list
    "forty": (2639, 50),    # 40-man roster
}


def find(exports):
    """Your team file (newest if there are several)."""
    files = sorted(Path(exports).glob("team_*.ootp"), key=lambda p: p.stat().st_mtime)
    return files[-1] if files else None


def _id(b, at):
    return struct.unpack_from("<i", b, at)[0]


def parse(path):
    """{table: DataFrame} for my_lineups, my_depth, my_rotation, my_roster, plus team_id and saved time."""
    b = Path(path).read_bytes()
    lineups = [
        {"vs": hand, "order": i + 1, "player_id": _id(b, at + 5 * i), "pos": POS.get(b[at + 5 * i + 4])}
        for hand, at in LINEUP.items() for i in range(9)
    ]
    depth = []
    for hand, at in DEPTH.items():
        for i, pos in enumerate(DEPTH_POS):
            r = at + DEPTH_REC * i
            depth.append({"vs": hand, "role": pos, "slot": 1, "player_id": _id(b, r), "starts": ""})
            depth.append({"vs": hand, "role": pos, "slot": 2, "player_id": _id(b, r + 4), "starts": STARTS.get(b[r + 8], b[r + 8])})
            depth.append({"vs": hand, "role": pos, "slot": 3, "player_id": _id(b, r + 9), "starts": STARTS.get(b[r + 13], b[r + 13])})
        for role, off in PINCH.items():
            for i in range(4):
                depth.append({"vs": hand, "role": role, "slot": i + 1, "player_id": _id(b, at + off + 5 * i), "starts": ""})
    at, n = ROTATION
    rotation = [{"slot": i + 1, "player_id": _id(b, at + 4 * i)} for i in range(n)]
    roster = [
        {"list": name, "player_id": pid}
        for name, (at, n) in ROSTERS.items() for pid in (_id(b, at + 4 * i) for i in range(n)) if pid
    ]
    frames = {
        "my_lineups": pd.DataFrame(lineups),
        "my_depth": pd.DataFrame(depth).query("player_id != 0"),
        "my_rotation": pd.DataFrame(rotation).query("player_id != 0"),
        "my_roster": pd.DataFrame(roster),
    }
    saved = pd.Timestamp.fromtimestamp(Path(path).stat().st_mtime).floor("s")
    for df in frames.values():
        df["saved"] = saved
    return _id(b, TEAM_ID), frames


if __name__ == "__main__":
    import duckdb

    from load import DB, EXPORTS

    path = Path(sys.argv[1]) if len(sys.argv) > 1 else find(EXPORTS)
    team_id, frames = parse(path)
    names = dict(duckdb.connect(str(DB), read_only=True).execute("select id, name from cur_players").fetchall())
    print(f"{path.name}: team {team_id}, saved {frames['my_lineups'].saved.iat[0]}")
    for table, df in frames.items():
        df = df.drop(columns="saved").assign(name=df.player_id.map(names))
        print(f"\n== {table}\n{df.to_string(index=False)}")
