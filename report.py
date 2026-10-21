"""Team report: roster vs. expected talent, internal options, free agents, trade targets, payroll, farm.

    .venv/bin/python report.py [team] [--sellers N]

Run load.py and talent.py first. Sellers are the N worst MLB records in the
latest box scores (default 10).
"""

import argparse
import contextlib
import glob
import io
import re

import duckdb
import pandas as pd

import talent
from load import DB, LEAGUE

pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 40)
pd.set_option("display.max_rows", 300)

HITTERS = """
select p.id, p.name, p.pos, p.age, p.b, p.tm, p.lev, p.org, round(t.xwrc) xwrc, round(t.xwrc_vl) xvl, round(t.xwrc_vr) xvr,
       s.pa, s.wrc_plus wrc, s.war, r.babip, r.ks, r.pow, r.eye, r.def, f.c_abi, f.c_arm,
       k.slr / 1e6 sal, k.yl, k.yl_status st, p.sctacc acc
from cur_players p join hit_talent t on t.player_id = p.id join cur_bat_ratings r on r.player_id = p.id
join cur_fielding f on f.player_id = p.id left join cur_bat_stats s on s.player_id = p.id
left join cur_contracts k on k.player_id = p.id
"""
PITCHERS = """
select p.id, p.name, p.pos, p.age, p.t, p.tm, p.lev, p.org, t.role, round(t.xfip, 2) xfip, round(s.ip) ip, s.era, s.fip, s.war,
       r.stu, r.hra, r.pbabip, r.con, r.stm, k.slr / 1e6 sal, k.yl, k.yl_status st, p.sctacc acc
from cur_players p join pit_talent t on t.player_id = p.id join cur_pit_ratings r on r.player_id = p.id
left join cur_pit_stats s on s.player_id = p.id left join cur_contracts k on k.player_id = p.id
"""


def standings():
    """Latest W-L per MLB team (export short names) from box score headers."""
    latest = {}
    for f in glob.glob(str(LEAGUE / "news/html/box_scores/*.html")):
        text = open(f, encoding="utf-8", errors="replace").read()
        date = re.search(r"<title>RLB Box Score, [^,]+, (\d\d)/(\d\d)/(\d{4})", text)
        if not date:
            continue
        day = date.group(3) + date.group(1) + date.group(2)
        for team, w, l in re.findall(r">\s*([A-Z][^<>()]+?) \((\d+)-(\d+)\)", text):
            if team.strip() not in latest or day > latest[team.strip()][0]:
                latest[team.strip()] = (day, int(w), int(l))
    newest = max(d for d, _, _ in latest.values())
    rows = [(t, w, l) for t, (d, w, l) in latest.items() if d == newest]  # drops defunct names
    return pd.DataFrame(rows, columns=["team", "w", "l"]).assign(pct=lambda d: d.w / (d.w + d.l)).sort_values("pct", ascending=False)


def section(title, df):
    print(f"\n== {title}")
    print(df.to_string(index=False) if len(df) else "  (none)")


def my_setup(con, team):
    """What you've actually set in the game, from the team file you upload (teamfile.py)."""
    have = con.sql("select count(*) from information_schema.tables where table_name = 'cur_my_roster'").fetchone()[0]
    if not have:
        return
    active = con.sql("select r.player_id, p.org, r.saved from cur_my_roster r join cur_players p on p.id = r.player_id where list = 'active'").df()
    if active.empty or (active.org != team).any():
        return
    print(f"\n== {team} as set in the game (team file saved {active.saved.iat[0]})")
    for hand, other in (("R", "vr"), ("L", "vl")):
        section(f"Lineup vs {hand}HP (xwrc vs that hand)", con.sql(f"""
            select l."order", l.pos, p.name, p.b, round(t.xwrc_{other}) xwrc
            from cur_my_lineups l join cur_players p on p.id = l.player_id left join hit_talent t on t.player_id = l.player_id
            where l.vs = '{hand}' order by l."order"
        """).df())
        section(f"Depth vs {hand}HP: backups and bench", con.sql(f"""
            select d.role, d.slot, p.name, d.starts from cur_my_depth d join cur_players p on p.id = d.player_id
            where d.vs = '{hand}' and d.slot > 1 or d.vs = '{hand}' and d.role in ('PH', 'PR') order by d.role, d.slot
        """).df())
    section("Pitching staff (rotation slot; the rest are the bullpen)", con.sql("""
        select r.slot, p.name, p.t, t.role, round(t.xfip, 2) xfip
        from cur_my_roster a join cur_players p on p.id = a.player_id join pit_talent t on t.player_id = a.player_id
        left join cur_my_rotation r on r.player_id = a.player_id
        where a.list = 'active' order by r.slot nulls last, t.xfip
    """).df())
    section("Not active: on the MLB roster / injured list but can't play now", con.sql("""
        select p.name, p.pos, case when bool_or(r.list = 'mlb') then 'inactive' else 'injured list' end status
        from cur_my_roster r join cur_players p on p.id = r.player_id
        where r.list in ('mlb', 'mlb_il') and r.player_id not in (select player_id from cur_my_roster where list = 'active')
        group by p.name, p.pos order by status, p.pos
    """).df())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("team", nargs="?", default="Halifax")
    ap.add_argument("--sellers", type=int, default=10)
    args = ap.parse_args()
    team = args.team

    con = duckdb.connect(str(DB), read_only=True)
    con.execute(f"create temp view h as {HITTERS}")
    con.execute(f"create temp view pt as {PITCHERS}")
    mlb = set(con.sql("select distinct tm from cur_players where lev = 'RLB'").df().tm)

    table = standings()
    table["org"] = [next((m for m in mlb if t.startswith(m)), None) for t in table.team]
    section("STANDINGS", table.assign(rank=range(1, len(table) + 1))[["rank", "team", "w", "l", "pct"]].round(3))
    sellers = tuple(table.org.dropna().tail(args.sellers))

    section(f"{team} hitters (xwrc = expected wRC+ from ratings)",
            con.sql(f"select * exclude (id, tm, lev, org, acc) from h where tm = '{team}' order by xwrc desc").df())
    section(f"{team} pitchers (xfip = expected FIP from ratings)",
            con.sql(f"select * exclude (id, tm, lev, org, acc) from pt where tm = '{team}' order by role, xfip").df())
    my_setup(con, team)
    section("League starter xwrc by position (most-PA player per team)", con.sql("""
        with q as (select pos, xwrc, row_number() over (partition by tm, pos order by pa desc nulls last) rn
                   from h where lev = 'RLB' and pos not in ('SP', 'RP', 'CL'))
        select pos, round(median(xwrc)) median, round(quantile_cont(xwrc, 0.75)) p75 from q where rn = 1 group by pos order by pos
    """).df())
    section(f"{team} minor leaguers, xwrc >= 90",
            con.sql(f"select * exclude (id, org, acc, war) from h where org = '{team}' and lev <> 'RLB' and xwrc >= 90 order by xwrc desc").df())
    section(f"{team} minor leaguers, xfip <= 4.6",
            con.sql(f"select * exclude (id, org, acc, war) from pt where org = '{team}' and lev <> 'RLB' and xfip <= 4.6 order by xfip").df())
    section("Free agent hitters, xwrc >= 90 (catchers >= 75)",
            con.sql("select * exclude (id, tm, lev, org, sal, yl, st) from h where lev is null and (xwrc >= 90 or (pos = 'C' and xwrc >= 75)) order by xwrc desc limit 15").df())
    section("Free agent pitchers, xfip <= 4.3",
            con.sql("select * exclude (id, tm, lev, org, sal, yl, st) from pt where lev is null and xfip <= 4.3 order by xfip limit 12").df())
    print(f"\nSellers: {', '.join(sellers)}")
    section("Seller catchers, xwrc >= 85 and C ABI >= 50", con.sql(
        f"select * exclude (id, org) from h where org in {sellers} and pos = 'C' and lev in ('RLB', 'AAA') and xwrc >= 85 and c_abi >= 50 order by xwrc desc limit 12").df())
    section("Seller bats, xwrc >= 115", con.sql(
        f"select * exclude (id, org, c_abi, c_arm) from h where org in {sellers} and lev in ('RLB', 'AAA') and xwrc >= 115 and pos <> 'C' order by xwrc desc limit 15").df())
    section("Seller relievers, xfip <= 3.6", con.sql(
        f"select * exclude (id, org) from pt where org in {sellers} and lev in ('RLB', 'AAA') and role = 'RP' and xfip <= 3.6 order by xfip limit 15").df())
    section("Seller starters, xfip <= 4.0", con.sql(
        f"select * exclude (id, org) from pt where org in {sellers} and lev in ('RLB', 'AAA') and role = 'SP' and xfip <= 4.0 order by xfip limit 12").df())

    pay = con.sql("""
        select p.tm, round(sum(k.slr) / 1e6, 1) payroll, round(sum(case when k.yl > 1 then k.slr end) / 1e6, 1) committed_next
        from cur_players p join cur_contracts k on k.player_id = p.id where p.lev = 'RLB' group by 1 order by 2 desc
    """).df()
    pay.insert(0, "rank", range(1, len(pay) + 1))
    section(f"Payroll ($M, MLB roster; league median {pay.payroll.median():.1f})", pd.concat([pay.head(3), pay[pay.tm == team]]))
    section(f"{team} expiring contracts >= $2M", con.sql(f"""
        select p.name, p.pos, p.age, k.slr / 1e6 sal, k.yl_status from cur_players p join cur_contracts k on k.player_id = p.id
        where p.tm = '{team}' and k.yl = 1 and k.slr >= 2e6 order by k.slr desc
    """).df())

    # Farm: the same rating -> results fits, applied to potential ratings.
    with contextlib.redirect_stdout(io.StringIO()):
        hit_coef = talent.fit(con.sql("""
            select r.babip, r.ks, r.gap, r.pow, r.eye, s.pa, s.wrc_plus from cur_bat_ratings r join cur_bat_stats s using (player_id)
            join cur_players p on p.id = r.player_id where s.pa >= 150 and p.pos not in ('SP', 'RP', 'CL')
        """).df(), "wrc_plus", talent.HIT, "pa")
        pit_coef = talent.fit(con.sql("""
            select r.stu, r.hra, r.pbabip, r.con, s.ip, s.fip from cur_pit_ratings r join cur_pit_stats s using (player_id)
            where s.gs >= 8 and s.ip >= 40 and r.stm >= 50
        """).df(), "fip", talent.PIT, "ip")
    bats = con.sql("""
        select p.name, p.pos, p.age, p.lev, p.org, b.ht_p babip, b.k_p ks, b.gap_p gap, b.pow_p pow, b.eye_p eye
        from cur_bat_potential b join cur_players p on p.id = b.player_id
        where p.pos not in ('SP', 'RP', 'CL') and p.lev <> 'RLB' and p.org is not null and p.age <= 24
    """).df()
    bats["pot_xwrc"] = talent.predict(bats, hit_coef, talent.HIT).round()
    arms = con.sql("""
        select p.name, p.pos, p.age, p.lev, p.org, q.stm, q.stu_p stu, q.hra_p hra, q.pbabip_p pbabip, q.con_p con
        from cur_pit_potential q join cur_players p on p.id = q.player_id
        where p.lev <> 'RLB' and p.org is not null and p.age <= 24
    """).df()
    arms["pot_xfip"] = talent.predict(arms, pit_coef, talent.PIT).round(2)
    farm = pd.DataFrame({
        "bats_110": bats[bats.pot_xwrc >= 110].groupby("org").size(),
        "arms_390": arms[arms.pot_xfip <= 3.9].groupby("org").size(),
    }).fillna(0).astype(int)
    farm["total"] = farm.sum(axis=1)
    farm = farm.sort_values("total", ascending=False).reset_index(names="org")
    farm.insert(0, "rank", range(1, len(farm) + 1))
    section("Farm: prospects (<= 24, minors) with potential xwrc >= 110 / xfip <= 3.90", pd.concat([farm.head(3), farm[farm.org == team]]))
    section(f"{team} top bat prospects", bats[bats.org == team].nlargest(6, "pot_xwrc")[["name", "pos", "age", "lev", "pot_xwrc"]])
    section(f"{team} top arm prospects", arms[arms.org == team].nsmallest(6, "pot_xfip")[["name", "pos", "age", "lev", "stm", "pot_xfip"]])


if __name__ == "__main__":
    main()
