"""Parse the league's player history logs (rlb.lg/news/txt/players/*_history.txt).

Each log is a career timeline. The useful parts:
  - every Jan 1, OSA's (league scouting service) current and potential ratings:
    hitters Contact/Power/Eye, pitchers Stuff/Movement/Control
  - contracts: free agent signings, extensions, arbitration awards, renewals
  - injuries with their expected length, draft position, prospect rankings

  - trades: who and which draft picks went each way
  - international signings and Rule 5 draft picks (for Rule 5 eligibility)

These are OSA's public ratings, not true ratings. Tables written to rlb.duckdb:
hist_ratings, hist_contracts, hist_injuries, hist_draft, hist_prospect_rank, hist_trades,
hist_signings, hist_rule5.

    .venv/bin/python history.py
"""

import re

import duckdb
import pandas as pd

from load import DB, LEAGUE

LOGS = LEAGUE / "news/txt/players"

BAT = re.compile(r"Contact: (\d+) \((\d+)\); Power: (\d+) \((\d+)\); Eye: (\d+) \((\d+)\)")
PIT = re.compile(r"Stuff: (\d+) \((\d+)\); Movement: (\d+) \((\d+)\); Control: (\d+) \((\d+)\)")
TEAM = r'<a href="\.\./teams/team_(\d+)\.html">'
CONTRACTS = [
    ("fa", re.compile(rf"Signed a (\d+)-year contract worth a total of \$([\d,]+) with the {TEAM}")),
    ("extension", re.compile(rf"Signed a (\d+)-year contract extension worth a total of \$([\d,]+) with the {TEAM}")),
    ("arbitration", re.compile(r"Received a (\d+)-year contract through arbitration worth a total of \$([\d,]+)")),
    ("renewal", re.compile(r"Received a (\d+)-year contract through automatic renewal worth a total of \$([\d,]+)")),
]
INJURY = re.compile(r"\[I\]Injured \((.+)\),(day-to-day|out) for (.+?)\.?$")
SETBACK = re.compile(r"\[I\]Suffered setback in recovery from injury, will miss another (.+?)\.?$")
DRAFT = re.compile(r"Drafted in the (\d+)\s+first-year player draft\s+\(Round (\d+), Pick (\d+), (\d+)\w\w overall pick\) by the " + TEAM)
RANK = re.compile(r"Named the #(\d+) prospect in the RLB")
INTL = re.compile(r"Signed a minor league contract out of (.+?) with the " + TEAM)
RULE5 = re.compile(r"Drafted in the rule 5 draft .*? by the " + TEAM + r"[^<]*</a> from the " + TEAM)
TRADE = re.compile(r"Was traded by the " + TEAM + r"[^<]*</a> to the " + TEAM + r"[^<]*</a>(.*)$")
PLAYER = re.compile(r"player_(\d+)\.html")
PICK = re.compile(r"(\d+)\w\w round draft pick")
UNITS = {"day": 1, "days": 1, "week": 7, "weeks": 7, "month": 30, "months": 30}
WORDS = {"one": 1, "two": 2, "three": 3}


def days(text):
    """'one week' -> 7, '5-6 weeks' -> 38.5, '4 months' -> 120."""
    m = re.fullmatch(r"([\w]+)(?:-(\d+))? (\w+)", text.strip())
    if not m or m.group(3) not in UNITS:
        return None
    lo = WORDS.get(m.group(1)) or (int(m.group(1)) if m.group(1).isdigit() else None)
    if lo is None:
        return None
    hi = int(m.group(2)) if m.group(2) else lo
    return (lo + hi) / 2 * UNITS[m.group(3)]


def parse():
    ratings, contracts, injuries, draft, ranks, trades, signings, rule5 = [], [], [], [], [], {}, [], []
    for path in LOGS.glob("player_*_history.txt"):
        pid = int(path.stem.split("_")[1])
        for line in open(path, encoding="utf-8", errors="replace"):
            date, _, text = line.rstrip("\n").partition("\t")
            if len(date) != 8 or not date.isdigit():
                continue
            day = pd.Timestamp(f"{date[:4]}-{date[4:6]}-{date[6:]}")
            if m := BAT.search(text):
                c, cp, p, pp, e, ep = map(int, m.groups())
                ratings.append((pid, day, "bat", c, p, e, cp, pp, ep))
            elif m := PIT.search(text):
                s, sp, mv, mp, c, cp = map(int, m.groups())
                ratings.append((pid, day, "pit", s, mv, c, sp, mp, cp))
            elif text.startswith("[G]Signed a") or text.startswith("[G]Received a"):
                for kind, rx in CONTRACTS:
                    if m := rx.search(text):
                        years, total = int(m.group(1)), int(m.group(2).replace(",", ""))
                        team = int(m.group(3)) if m.lastindex >= 3 else None
                        contracts.append((pid, day, kind, years, total, team))
                        break
            elif m := INJURY.search(text):
                injuries.append((pid, day, m.group(1), m.group(2) == "out", days(m.group(3)), False))
            elif m := SETBACK.search(text):
                injuries.append((pid, day, "setback", True, days(m.group(1)), True))
            elif m := DRAFT.search(text):
                draft.append((pid, day, *map(int, m.groups())))
            elif m := RANK.search(text):
                ranks.append((pid, day, int(m.group(1))))
            elif m := INTL.search(text):
                signings.append((pid, day, "international", int(m.group(2))))
            elif m := RULE5.search(text):
                rule5.append((pid, day, int(m.group(1)), int(m.group(2))))
            elif m := TRADE.search(text):
                # Every traded player's log has the whole deal; key it the same way from either side.
                a, b, rest = m.groups()
                along, _, exch = rest.partition("in exchange for")
                sides = sorted([(int(a), frozenset({pid, *map(int, PLAYER.findall(along))}), tuple(sorted(map(int, PICK.findall(along))))),
                                (int(b), frozenset(map(int, PLAYER.findall(exch))), tuple(sorted(map(int, PICK.findall(exch)))))],
                               key=lambda s: s[0])
                trades[(day, tuple(sides))] = None
    # One row per player or pick that changed hands; side 0/1 = the team that GAVE it up.
    trade_rows = []
    for t, (day, sides) in enumerate(sorted(trades, key=lambda k: k[0])):
        for side, (team, players, picks) in enumerate(sides):
            trade_rows += [(t, day, side, team, p, None) for p in sorted(players)]
            trade_rows += [(t, day, side, team, None, r) for r in picks]
    # r1..r3 are con/pow/eye for hitters and stu/mov/con for pitchers.
    return {
        "hist_trades": pd.DataFrame(trade_rows, columns=["trade_id", "date", "side", "from_team", "player_id", "pick_round"]),
        "hist_signings": pd.DataFrame(signings, columns=["player_id", "date", "kind", "team_id"]),
        "hist_rule5": pd.DataFrame(rule5, columns=["player_id", "date", "to_team", "from_team"]),
        "hist_ratings": pd.DataFrame(ratings, columns=["player_id", "date", "kind", "r1", "r2", "r3", "r1_p", "r2_p", "r3_p"]),
        "hist_contracts": pd.DataFrame(contracts, columns=["player_id", "date", "kind", "years", "total", "team_id"]),
        "hist_injuries": pd.DataFrame(injuries, columns=["player_id", "date", "injury", "out", "days", "setback"]),
        "hist_draft": pd.DataFrame(draft, columns=["player_id", "date", "year", "round", "pick", "overall", "team_id"]),
        "hist_prospect_rank": pd.DataFrame(ranks, columns=["player_id", "date", "rank"]),
    }


def main(con=None):
    own = con is None
    con = con or duckdb.connect(str(DB))
    for name, df in parse().items():
        con.register("df", df)
        con.execute(f"create or replace table {name} as select * from df")
        con.unregister("df")
        print(f"  {name:20} {len(df):6} rows")
    # Readable rating columns, one view per kind.
    con.execute("""create or replace view hist_bat as select player_id, date, year(date) yr,
        r1 con, r2 pow, r3 eye, r1_p con_p, r2_p pow_p, r3_p eye_p from hist_ratings where kind = 'bat'""")
    con.execute("""create or replace view hist_pit as select player_id, date, year(date) yr,
        r1 stu, r2 mov, r3 con, r1_p stu_p, r2_p mov_p, r3_p con_p from hist_ratings where kind = 'pit'""")
    if own:
        con.close()


if __name__ == "__main__":
    main()
