"""Player value: aging, multi-year projections, market prices, contract surplus, potential-jump odds.

Builds on talent.py (rating weights) and history.py (OSA rating history, contracts,
injuries). Writes to rlb.duckdb:
  aging       per age and rating: average yearly change of current ratings, how much of the
              gap to potential closes, and how potential drifts
  proj        one row per player and future season: projected xwRC+/xFIP, xWAR, cost, surplus
  value       one row per player: next season's xWAR, peak, ceiling
              (xWAR if he reached every potential rating), contract cost, total surplus
  pos_value   (also xwar_vr / xwar_vl: the same if every PA came vs. RHP / LHP)
  pos_value   next season's xWAR for each hitter at every position he can play (glove = the part
              that's his defense, playable = his position rating there), and each pitcher
              as RP (65 IP) and, with stamina 50+, SP (32 starts at his stamina's typical length)
  market_params  the fitted $ per xWAR and typical-price curve, and the share of innings vs. LHP
  jump_odds   chance of a +10 potential jump at the next Jan 1 OSA update, per young player

    .venv/bin/python value.py
"""

import duckdb
import numpy as np
import pandas as pd

from load import DB

MIN_SALARY = 792_000
YEARS = 8  # seasons projected
DISCOUNT = 0.90  # per season: future value is less certain
FULL_TIME = {"hit": 600, "C": 520, "SP": 180, "RP": 65}  # PA or IP in a healthy season (SP: see sp_ip)
STARTS = 32
SEASON_DAYS = 183
REPLACEMENT = 1.0  # xWAR a team can get for about the minimum: 16 unsigned free agents project 1+ right now
# Relievers: replacement is far lower (the best unsigned ones project ~0.3-0.8), and their wins come
# in high leverage. Closers turn WAR into ~1.6x as much WPA, setup men ~1.25x, the rest ~0.7x; a
# reliever good enough to be worth trading for pitches late, so value him at 1.4x above replacement.
RP_REPLACEMENT = 0.3
LEVERAGE = 1.4
DEF_SHRINK = 0.5  # per-position defense slopes are noisy (~50 players each): halfway to the pooled one
# Mean days injured per year by proneness label, RLB + AAA players 2128-30 (see README).
PRONE_DAYS = {
    "hit": {"Iron Man": 1, "Durable": 1, "Normal": 6, "Fragile": 29, "Wrecked": 62},
    "pit": {"Iron Man": 1, "Durable": 1, "Normal": 10, "Fragile": 52, "Wrecked": 50},
}
# Export ratings driven by each OSA history rating, with their potential column.
BAT_MAP = {"con": [("babip", "ht_p"), ("ks", "k_p"), ("gap", "gap_p")], "pow": [("pow", "pow_p")], "eye": [("eye", "eye_p")]}
PIT_MAP = {"stu": [("stu", "stu_p")], "mov": [("hra", "hra_p"), ("pbabip", "pbabip_p")], "con": [("con", "con_p")]}
POSITIONS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"]


def season(con):
    return con.execute("select max(year(date)) from hist_ratings").fetchone()[0]


def wls(X, y, w):
    W = np.sqrt(w)
    coef, *_ = np.linalg.lstsq(X * W[:, None], y * W, rcond=None)
    return coef


# ---------------------------------------------------------------- aging

def aging(con):
    """Per age: yearly change in current ratings, share of the potential gap closed, potential drift.

    From consecutive Jan 1 OSA updates of players still in the league. Players who
    retired aren't in it, so late-career declines are, if anything, understated.
    """
    rows = []
    for kind, ratings in [("bat", ["con", "pow", "eye"]), ("pit", ["stu", "mov", "con"])]:
        h = con.sql(f"""
            select h.*, date_diff('year', p.dob, h.date) age from hist_{kind} h join cur_players p on p.id = h.player_id
        """).df()
        nxt = h.assign(yr=h.yr - 1)
        d = h.merge(nxt, on=["player_id", "yr"], suffixes=("", "_next"))
        d["age"] = d.age_next  # the age the change happened at
        for r in ratings:
            d[f"{r}_d"] = d[f"{r}_next"] - d[r]
            d[f"{r}_gap"] = (d[f"{r}_p"] - d[r]).clip(lower=0)
            d[f"{r}_pd"] = d[f"{r}_p_next"] - d[f"{r}_p"]
        good = (d[ratings].sum(axis=1) >= 140) | (d.age < 24)  # late-career curves from MLB-calibre players
        for age, g in d[good].groupby(d.age.clip(17, 38)):
            for r in ratings:
                gap = g[f"{r}_gap"].sum()
                rows.append((kind, int(age), r, len(g), g[f"{r}_d"].mean(),
                             (g[f"{r}_d"].clip(lower=0).sum() / gap) if gap else 0.0, g[f"{r}_pd"].mean()))
    a = pd.DataFrame(rows, columns=["kind", "age", "rating", "n", "delta", "close", "pot_drift"])
    # Smooth across neighbouring ages, weighted by sample size.
    out = []
    for (kind, r), g in a.groupby(["kind", "rating"]):
        g = g.set_index("age").reindex(range(17, 39))
        g["n"] = g.n.fillna(0)
        for col in ["delta", "close", "pot_drift"]:
            num = (g[col].fillna(0) * g.n).rolling(3, center=True, min_periods=1).sum()
            den = g.n.rolling(3, center=True, min_periods=1).sum()
            g[col] = (num / den).ffill()
        g["kind"], g["rating"] = kind, r
        out.append(g.reset_index())
    return pd.concat(out)[["kind", "rating", "age", "n", "delta", "close", "pot_drift"]]


def step(df, mapping, curve, age):
    """Advance ratings one season. Under 27: close part of the gap to potential, potential drifts.
    27 and up: apply the average decline, potential follows current."""
    df = df.copy()
    for osa, cols in mapping.items():
        c = curve[curve.rating == osa].set_index("age")
        a = age.clip(17, 38)
        delta, close, drift = (c[k].reindex(a).to_numpy() for k in ("delta", "close", "pot_drift"))
        young = age.to_numpy() < 27
        for cur, pot in cols:
            gap = (df[pot] - df[cur]).clip(lower=0)
            grown = df[cur] + close * gap
            df[cur] = np.where(young, np.minimum(grown, df[pot]), df[cur] + delta).clip(20, 80)
            df[pot] = np.where(young, np.maximum(df[pot] + drift, df[cur]), df[cur])
    return df


# ---------------------------------------------------------------- WAR

def war_models(con):
    """Full-season WAR from ratings, fit on this season's MLB players.

    Hitters: WAR/600 ~ xwRC+ + speed + defense at his position (relative to that position's
    average) + a constant per position. Catchers' defense is framing and arm instead of the
    position rating: framing is worth about twice as much per point. Pitchers: WAR/IP ~ xFIP,
    separately for SP and RP.
    """
    h = con.sql("""
        select p.pos, t.xwrc, r.spe, s.pa, s.war, bp.c_frm, f.c_arm, pr.* exclude (player_id)
        from cur_players p join hit_talent t on t.player_id = p.id join cur_bat_ratings r on r.player_id = p.id
        join cur_bat_stats s on s.player_id = p.id join cur_position_ratings pr on pr.player_id = p.id
        join cur_bat_profile bp on bp.player_id = p.id join cur_fielding f on f.player_id = p.id
        where s.pa >= 150 and p.pos not in ('SP', 'RP', 'CL')
    """).df()
    h["posr"] = [row.get(pos.lower(), np.nan) for pos, (_, row) in zip(h.pos, h.iterrows())]
    pos_mean = h.groupby("pos").posr.mean().dropna().to_dict()
    catcher = h.pos == "C"
    frm_mean, arm_mean = h.c_frm[catcher].mean(), h.c_arm[catcher].mean()
    h["def_rel"] = (h.posr - h.pos.map(pos_mean)).fillna(0).where(~catcher, 0)
    h["frm_rel"] = (h.c_frm - frm_mean).where(catcher, 0)
    h["arm_rel"] = (h.c_arm - arm_mean).where(catcher, 0)
    pos = sorted(h.pos.unique())
    X = np.column_stack([h.xwrc, h.def_rel, h.frm_rel, h.arm_rel, h.spe] + [(h.pos == p).astype(float) for p in pos])
    c = wls(X, (h.war / h.pa * 600).to_numpy(), h.pa.to_numpy())
    pooled = c[1]
    # Defense is worth more at some positions (CF most): refit with a slope per position.
    fielders = [p for p in pos if p not in ("C", "DH")]
    X2 = np.column_stack([h.xwrc, h.frm_rel, h.arm_rel, h.spe] + [(h.pos == p) * h.def_rel for p in fielders]
                         + [(h.pos == p).astype(float) for p in pos])
    c2 = wls(X2, (h.war / h.pa * 600).to_numpy(), h.pa.to_numpy())
    slopes = {p: DEF_SHRINK * pooled + (1 - DEF_SHRINK) * s for p, s in zip(fielders, c2[4:4 + len(fielders)])}
    hit = {"xwrc": c[0], "def": slopes, "frm": c[2], "arm": c[3], "spe": c[4], "pos": dict(zip(pos, c[5:])),
           "pos_mean": pos_mean, "frm_mean": frm_mean, "arm_mean": arm_mean}
    hit["pos"].setdefault("DH", min(hit["pos"].values()))

    p = con.sql("select t.role, t.xfip, s.ip, s.gs, s.war from pit_talent t join cur_pit_stats s using (player_id) where s.ip >= 30").df()
    pit = {}
    for role, m in [("SP", p.gs >= 8), ("RP", p.gs < 3)]:
        d = p[m]
        pit[role] = wls(np.column_stack([np.ones(len(d)), d.xfip]), (d.war / d.ip).to_numpy(), d.ip.to_numpy())
    # Starters' innings: a full season of starts at the length his stamina allows.
    s = con.sql("select s.ip, s.gs, r.stm from cur_pit_stats s join cur_pit_ratings r using (player_id) where s.gs >= 15").df()
    a, b = wls(np.column_stack([np.ones(len(s)), s.stm]), (s.ip / s.gs).to_numpy(), s.gs.to_numpy())
    pit["sp_ip"] = lambda stm, a=a, b=b: (STARTS * (a + b * stm)).clip(150, 215)
    print(f"SP innings = {STARTS} starts x ({a:.2f} + {b:.3f}*stamina): stamina 50 -> {pit['sp_ip'](np.array([50.]))[0]:.0f}, "
          f"75 -> {pit['sp_ip'](np.array([75.]))[0]:.0f}")
    print(f"WAR/600 PA = {hit['xwrc']:.3f}*xwRC+ + defense vs position avg * (" + ", ".join(f"{p} {s:.3f}" for p, s in hit["def"].items())
          + f") + {hit['spe']:.3f}*speed + position constant; catchers {hit['frm']:.3f}*framing + {hit['arm']:.3f}*arm")
    for role in ("SP", "RP"):
        a, b = pit[role]
        print(f"{role} WAR per {FULL_TIME[role]} IP = {a * FULL_TIME[role]:.2f} - {-b * FULL_TIME[role]:.2f}*xFIP")
    return hit, pit


def pos_war(df, xwrc, hit):
    """Full-season xWAR at every position he can play (rating 40+) and DH: DataFrame player x position.
    A hitter's value is his best of these."""
    out = {}
    base = hit["xwrc"] * xwrc + hit["spe"] * df.spe
    for p in POSITIONS:
        r = df[p.lower()]
        v = (base + glove_rate(df, hit, p) + hit["pos"][p]) * (FULL_TIME["C"] if p == "C" else FULL_TIME["hit"]) / 600
        out[p] = v.where(r >= 40)  # below 40 he can't really play there
    out["DH"] = base + hit["pos"]["DH"]
    return pd.DataFrame(out, index=df.index)


def glove_rate(df, hit, p):
    """Defense vs. the position average, in WAR per 600 PA (catchers: framing and arm)."""
    if p == "C":
        return hit["frm"] * (df.c_frm - hit["frm_mean"]) + hit["arm"] * (df.c_arm - hit["arm_mean"])
    return hit["def"][p] * (df[p.lower()] - hit["pos_mean"][p])


def pos_glove(df, hit):
    """Full-season xWAR from his glove alone at each position he can play (DH: 0)."""
    out = {p: (glove_rate(df, hit, p) * (FULL_TIME["C"] if p == "C" else FULL_TIME["hit"]) / 600).where(df[p.lower()] >= 40)
           for p in POSITIONS}
    out["DH"] = pd.Series(0.0, index=df.index)
    return pd.DataFrame(out, index=df.index)


def score(df, coef):
    """Apply one talent.py model (its terms are whatever it was fit on)."""
    return coef["const"] + sum(c * df[t] for t, c in coef.items() if t != "const")


# ---------------------------------------------------------------- market

def market_curve(con, xwar_now):
    """What wins cost in free agency, from the last two winters' signings.

    Returns (value, price):
      value(w): MIN + rate * (w - REPLACEMENT), the going rate per win above replacement
                (total dollars over total xWAR). Used for surplus value.
      price(w): MIN + a * (w - REPLACEMENT)^b, a log-space fit, so the typical (median) price
                a player with that xWAR actually signed for. The market is noisy and doesn't
                pay stars proportionally, so this is lower than value() at the top.
    xWAR here is the player's current-ratings full-season value; they signed for this season
    or last, so it's close to what the market was buying.
    """
    c = con.sql(f"select player_id, total / years aav from hist_contracts where kind = 'fa' and date >= make_date({season(con) - 1}, 9, 1)").df()
    d = c.merge(xwar_now, on="player_id")
    d = d[(d.xwar > REPLACEMENT + 0.2) & (d.aav > 1.2 * MIN_SALARY)]
    rate = (d.aav - MIN_SALARY).sum() / (d.xwar - REPLACEMENT).sum()
    b, log_a = np.polyfit(np.log(d.xwar - REPLACEMENT), np.log(d.aav - MIN_SALARY), 1)
    a = np.exp(log_a)
    value = lambda w: MIN_SALARY + rate * np.clip(w - REPLACEMENT, 0, None)
    price = lambda w: MIN_SALARY + a * np.clip(w - REPLACEMENT, 0, None) ** b
    con.execute("create or replace table market_params as select ? rate, ? a, ? b, ? replacement, ? min_salary, ? discount",
                [rate, a, b, REPLACEMENT, MIN_SALARY, DISCOUNT])
    print(f"market (n={len(d)} FA signings): ${rate / 1e6:.1f}M per xWAR above {REPLACEMENT}; typical price "
          + ", ".join(f"{w} xWAR ${price(w) / 1e6:.1f}M" for w in (1, 2, 3, 4)))
    return value, price


def arb_model(con, xwar_now):
    """Arbitration award ($) ~ b0 + b1 * xWAR + b2 * years of service, from last winter's awards.

    Awards follow stats and service, and come in far below what good players are worth
    (a 3-WAR player typically gets $5-8M)."""
    c = con.sql(f"""
        select c.player_id, c.total / c.years aav, k.mly - 1 service from hist_contracts c join cur_contracts k using (player_id)
        where c.kind = 'arbitration' and c.date >= make_date({season(con) - 1}, 9, 1)
    """).df().merge(xwar_now, on="player_id")
    X = np.column_stack([np.ones(len(c)), c.xwar.clip(lower=0), c.service.clip(2, 5)])
    b = np.linalg.lstsq(X, c.aav.to_numpy(), rcond=None)[0]
    print(f"arbitration award = ${b[0] / 1e6:.1f}M + ${b[1] / 1e6:.1f}M * xWAR + ${b[2] / 1e6:.1f}M * service years (n={len(c)})")
    return lambda w, service: max(MIN_SALARY, b[0] + b[1] * max(w, 0) + b[2] * min(max(service, 2), 5))


# ---------------------------------------------------------------- potential jumps

def jump_model(con):
    """P(potential total rises >= 10 at the next Jan 1 OSA update), per player 30 or younger.

    Logistic model on age band, gap between potential and current, last year's change in
    current and potential, and pitcher, fit on every year but the latest. Then recalibrated
    (Platt scaling) on the latest year, since jump rates roughly tripled in the latest update;
    we assume that regime continues. Most jumps are players developing faster than expected:
    current catches up to potential and the ceiling moves up.
    """
    h = con.sql("""
        select player_id, yr, 'bat' kind, con + pow + eye cur, con_p + pow_p + eye_p pot from hist_bat
        union all select player_id, yr, 'pit', stu + mov + con, stu_p + mov_p + con_p from hist_pit
    """).df()
    dob = con.sql("select id player_id, dob from cur_players").df()
    h = h.merge(dob, on="player_id")
    h["age"] = h.yr - pd.to_datetime(h.dob).dt.year
    prev = h.assign(yr=h.yr + 1)[["player_id", "kind", "yr", "cur", "pot"]]
    nxt = h.assign(yr=h.yr - 1)[["player_id", "kind", "yr", "pot"]]
    d = h.merge(prev, on=["player_id", "kind", "yr"], suffixes=("", "_prev"))
    latest = h.yr.max()

    def features(d):
        age = d.age
        return np.column_stack([
            np.ones(len(d)),
            age <= 20, (age >= 21) & (age <= 22), (age >= 23) & (age <= 24), (age >= 25) & (age <= 26), age >= 30,
            (d.pot - d.cur).clip(0, 60) / 10,
            (d.cur - d.cur_prev).clip(-15, 30) / 10,
            (d.pot - d.pot_prev).clip(-20, 20) / 10,
            d.kind == "pit",
        ]).astype(float)

    def logit(X, y):
        beta = np.zeros(X.shape[1])
        for _ in range(25):  # IRLS
            p = 1 / (1 + np.exp(-X @ beta))
            W = p * (1 - p)
            beta += np.linalg.solve(X.T @ (X * W[:, None]) + 1e-6 * np.eye(len(beta)), X.T @ (y - p))
        return beta

    train = d.merge(nxt, on=["player_id", "kind", "yr"], suffixes=("", "_next"))
    train = train[train.age <= 32]
    jumped = (train.pot_next - train.pot >= 10).astype(float).to_numpy()
    old, new = (train.yr + 1 < latest).to_numpy(), (train.yr + 1 == latest).to_numpy()
    beta = logit(features(train[old]), jumped[old])
    z = features(train[new]) @ beta
    platt = logit(np.column_stack([np.ones(new.sum()), z]), jumped[new])
    p = 1 / (1 + np.exp(-(platt[0] + platt[1] * z)))
    top = p >= np.quantile(p, 0.9)
    print(f"potential-jump model: tested on the {latest} update, base rate {jumped[new].mean():.0%}, "
          f"top-decile picks jumped {jumped[new][top].mean():.0%}")

    now = d[(d.yr == latest) & (d.age <= 30)].copy()
    now["p_jump"] = 1 / (1 + np.exp(-(platt[0] + platt[1] * (features(now) @ beta))))
    now["cur_change"] = now.cur - now.cur_prev
    now["pot_change"] = now.pot - now.pot_prev
    return now[["player_id", "kind", "p_jump", "cur", "pot", "cur_change", "pot_change"]]


# ---------------------------------------------------------------- injuries

def availability(con):
    """Expected share of a season healthy: prone label prior blended with the last 3 years' injury days."""
    yr = season(con)
    inj = con.sql(f"""
        select player_id, sum(days) as total_days from hist_injuries where year(date) between {yr - 2} and {yr} group by 1
    """).df()
    prone = con.sql("""
        select player_id, prone, 'hit' kind from cur_bat_profile
        union all select player_id, prone, 'pit' from cur_pit_profile
    """).df()
    d = prone.merge(inj, on="player_id", how="left").fillna({"total_days": 0})
    prior = [PRONE_DAYS[k].get(p, PRONE_DAYS[k]["Normal"]) for k, p in zip(d.kind, d.prone)]
    d["inj_days"] = (np.array(prior) * 2 + d.total_days) / 5  # prior worth 2 seasons, history up to 3
    d["avail"] = 1 - (d.inj_days / SEASON_DAYS).clip(0, 0.6)
    return d[["player_id", "kind", "prone", "inj_days", "avail"]].drop_duplicates("player_id")  # two-way players


# ---------------------------------------------------------------- contracts

def ceilings(h, p, coef, hit_m, pit_m, avail):
    """xwRC+/xFIP and xWAR if he reached every potential rating (current defense, today's health)."""
    hc = h.copy()
    for cur, pot in [col for cols in BAT_MAP.values() for col in cols]:
        hc[cur] = np.maximum(hc[cur], hc[pot])
    xwrc = score(hc, coef["hit"])
    pc = p.copy()
    for cur, pot in [col for cols in PIT_MAP.values() for col in cols]:
        pc[cur] = np.maximum(pc[cur], pc[pot])
    xfip = np.where(pc.role == "SP", score(pc, coef["SP"]), score(pc, coef["RP"]))
    war = np.where(pc.role == "SP", (pit_m["SP"][0] + pit_m["SP"][1] * xfip) * pit_m["sp_ip"](pc.stm),
                   (pit_m["RP"][0] + pit_m["RP"][1] * xfip) * FULL_TIME["RP"])
    out = pd.concat([
        pd.DataFrame({"player_id": h.player_id, "xwrc_ceil": xwrc, "xfip_ceil": np.nan, "ceiling_xwar": pos_war(hc, xwrc, hit_m).max(axis=1)}),
        pd.DataFrame({"player_id": p.player_id, "xwrc_ceil": np.nan, "xfip_ceil": xfip, "ceiling_xwar": war}),
    ]).merge(avail[["player_id", "avail"]], on="player_id", how="left")
    out["ceiling_xwar"] *= out.avail.fillna(1)
    return out.drop(columns="avail")


def contract_costs(k, xwar, market, arb):
    """Projected cost per future season, and whether the team controls him.

    k: contract row. xwar: projected full xWAR per future season (array). Guaranteed years
    cost their AAV; then any signed extension; then, for players not yet at 6 years of
    MLB service (mly, which already counts the season just played), pre-arb (min) or
    arbitration years. Service accrues each season he's MLB-calibre (xWAR >= 1) or already
    has MLB service.
    """
    costs, kinds = [], []
    guaranteed = max(int(k.yl) - 1, 0) if pd.notna(k.yl) else 0
    aav = k.cv / k.ty if pd.notna(k.cv) and k.ty else (k.slr if pd.notna(k.slr) else MIN_SALARY)
    ext = int(k.ety) if pd.notna(k.ety) else 0
    ext_aav = k.ecv / k.ety if ext else 0
    service = k.mly if pd.notna(k.mly) else 0  # MLB service: the arb/FA clock (secy is pro service, the minor-league FA clock)
    controlled = k.yl_status in ("auto", "arbitr")
    last = k.slr if pd.notna(k.slr) else MIN_SALARY
    for i, w in enumerate(xwar):
        if i < guaranteed:
            costs.append(aav), kinds.append("contract")
        elif i < guaranteed + ext:
            costs.append(ext_aav), kinds.append("extension")
        elif controlled and service < 6:
            if service < 2 or (service < 3 and w < 2):
                costs.append(MIN_SALARY), kinds.append("pre-arb")
            else:
                floor = last if k.yl_status == "arbitr" or kinds[-1:] == ["arb"] else MIN_SALARY  # awards rarely drop
                costs.append(max(floor, arb(w, service))), kinds.append("arb")
        else:
            costs.append(np.nan), kinds.append("free agent")
        if w >= 1 or service >= 1:
            service += 1
        last = costs[-1] if pd.notna(costs[-1]) else last
    return costs, kinds


def main():
    con = duckdb.connect(str(DB))
    yr = season(con)
    curve = aging(con)
    con.register("a", curve)
    con.execute("create or replace table aging as select * from a")
    hit_m, pit_m = war_models(con)
    coef = {m: dict(g[["term", "coef"]].to_numpy()) for m, g in con.sql("select * from talent_coef").df().groupby("model")}

    players = con.sql("select id player_id, name, pos, age, dob, lev, org, tm, b, t, sctacc from cur_players").df()
    avail = availability(con)
    contracts = con.sql("select * from cur_contracts").df().set_index("player_id")

    # Hitters
    h = con.sql("""
        select p.player_id, r.* exclude (player_id), b.* exclude (player_id, spe, ste, run, def), pr.* exclude (player_id, def),
               t.xwrc_vr - t.xwrc d_vr, t.xwrc_vl - t.xwrc d_vl,  -- platoon split, held constant as he ages
               bp.c_frm, f.c_arm
        from (select id player_id from cur_players where pos not in ('SP', 'RP', 'CL')) p
        join cur_bat_ratings r using (player_id) join cur_bat_potential b using (player_id) join cur_position_ratings pr using (player_id)
        join hit_talent t using (player_id) join cur_bat_profile bp using (player_id) join cur_fielding f using (player_id)
    """).df().merge(players[["player_id", "pos", "dob"]], on="player_id")
    # Pitchers
    p = con.sql("""
        select r.*, pp.stu_p, pp.mov_p, pp.hra_p, pp.pbabip_p, pp.con_p from cur_pit_ratings r join cur_pit_potential pp using (player_id)
        join cur_players pl on pl.id = r.player_id where pl.pos in ('SP', 'RP', 'CL')
    """).df().merge(players[["player_id", "pos", "dob"]], on="player_id")
    p["role"] = np.where(p.stm >= 50, "SP", "RP")

    rows = []
    hs, ps = h.copy(), p.copy()
    for i in range(YEARS):
        y = yr + 1 + i
        # The curve is indexed by age at Jan 1 after the change; report age on July 1.
        jan, jul = pd.Timestamp(f"{y}-01-01"), pd.Timestamp(f"{y}-07-01")
        age_h, age_p = (((jul - pd.to_datetime(d.dob)).dt.days // 365.25).astype(int) for d in (hs, ps))
        hs = step(hs, BAT_MAP, curve[curve.kind == "bat"], ((jan - pd.to_datetime(hs.dob)).dt.days // 365.25).astype(int))
        ps = step(ps, PIT_MAP, curve[curve.kind == "pit"], ((jan - pd.to_datetime(ps.dob)).dt.days // 365.25).astype(int))
        xwrc = score(hs, coef["hit"])
        best = pos_war(hs, xwrc, hit_m)
        rows.append(pd.DataFrame({
            "player_id": hs.player_id, "season": y, "age": age_h, "xwrc": xwrc, "xfip": np.nan,
            "xwar_full": best.max(axis=1), "best_pos": best.idxmax(axis=1),
        }))
        xfip = np.where(ps.role == "SP", score(ps, coef["SP"]),
                        score(ps, coef["RP"]))
        war = np.where(ps.role == "SP", (pit_m["SP"][0] + pit_m["SP"][1] * xfip) * pit_m["sp_ip"](ps.stm),
                       (pit_m["RP"][0] + pit_m["RP"][1] * xfip) * FULL_TIME["RP"])
        rows.append(pd.DataFrame({
            "player_id": ps.player_id, "season": y, "age": age_p, "xwrc": np.nan, "xfip": xfip,
            "xwar_full": war, "best_pos": ps.role,
        }))
        if i == 0:  # next season by position, for depth charts
            avail_h = hs[["player_id"]].merge(avail[["player_id", "avail"]], on="player_id", how="left").avail.fillna(1).to_numpy()
            def melt(b, col):
                return (b.mul(avail_h, axis=0).assign(player_id=hs.player_id.to_numpy())
                        .melt(id_vars="player_id", var_name="pos", value_name=col).dropna())
            pos_value = (melt(best, "xwar")
                         .merge(melt(pos_war(hs, xwrc + hs.d_vr, hit_m), "xwar_vr"), on=["player_id", "pos"])
                         .merge(melt(pos_war(hs, xwrc + hs.d_vl, hit_m), "xwar_vl"), on=["player_id", "pos"])
                         .merge(melt(pos_glove(hs, hit_m), "glove"), on=["player_id", "pos"], how="left")
                         .merge(hs[[p.lower() for p in POSITIONS]].set_axis(POSITIONS, axis=1).assign(DH=100, player_id=hs.player_id.to_numpy())
                                .melt(id_vars="player_id", var_name="pos", value_name="playable"), on=["player_id", "pos"], how="left"))
            # Pitchers by role: every pitcher as a reliever (65 IP), starters (stamina 50+) also in the
            # rotation; vs-hand versions swap in the stuff split.
            avail_p = ps[["player_id"]].merge(avail[["player_id", "avail"]], on="player_id", how="left").avail.fillna(1).to_numpy()
            for role, ok in [("SP", ps.role == "SP"), ("RP", pd.Series(True, index=ps.index))]:
                (a_, b_), ip = pit_m[role], (pit_m["sp_ip"](ps.stm) if role == "SP" else FULL_TIME["RP"])
                war = {}
                for col, stu in [("xwar", ps.stu), ("xwar_vr", ps.stu_vr), ("xwar_vl", ps.stu_vl)]:
                    fip = score(ps.assign(stu=stu), coef[role])
                    war[col] = (a_ + b_ * fip) * ip * avail_p
                pos_value = pd.concat([pos_value, pd.DataFrame({"player_id": ps.player_id, "pos": role, **war})[ok.to_numpy()]])
            # today's ratings (season yr), for market calibration
            now_h = pos_war(h, score(h, coef["hit"]), hit_m).max(axis=1)
            now_p = np.where(p.role == "SP", (pit_m["SP"][0] + pit_m["SP"][1] * score(p, coef["SP"])) * pit_m["sp_ip"](p.stm),
                             (pit_m["RP"][0] + pit_m["RP"][1] * score(p, coef["RP"])) * 65)
            xwar_now = pd.concat([pd.DataFrame({"player_id": h.player_id, "xwar": now_h}),
                                  pd.DataFrame({"player_id": p.player_id, "xwar": now_p})])
            now_val = pd.concat([pd.DataFrame({"player_id": h.player_id, "xwar": now_h}),  # relievers as equivalent wins
                                 pd.DataFrame({"player_id": p.player_id, "xwar": np.where(
                                     p.role == "SP", now_p, REPLACEMENT + LEVERAGE * (now_p - RP_REPLACEMENT))})])
    ceiling = ceilings(h, p, coef, hit_m, pit_m, avail)
    proj = pd.concat(rows).merge(avail[["player_id", "avail"]], on="player_id", how="left")
    proj["avail"] = proj.avail.fillna(1 - PRONE_DAYS["hit"]["Normal"] / SEASON_DAYS)
    proj["xwar"] = proj.xwar_full * proj.avail

    market, price = market_curve(con, now_val)
    arb = arb_model(con, now_val)
    # Relievers' xWAR in hitter/starter-equivalent wins, for anything priced in dollars.
    rp = proj.best_pos == "RP"
    proj["xwar_val"] = np.where(rp, REPLACEMENT + LEVERAGE * (proj.xwar - RP_REPLACEMENT), proj.xwar)
    proj["market"] = market(proj.xwar_val)
    proj["price"] = price(proj.xwar_val)

    # Contract cost per season
    costs = []
    for pid, g in proj.sort_values("season").groupby("player_id"):
        if pid not in contracts.index:
            continue
        c, kinds = contract_costs(contracts.loc[pid], g.xwar_val.to_numpy(), market, arb)
        costs.append(pd.DataFrame({"player_id": pid, "season": g.season.to_numpy(), "cost": c, "status": kinds}))
    proj = proj.merge(pd.concat(costs), on=["player_id", "season"], how="left")
    controlled = proj.status.isin(["pre-arb", "arb"])
    # Guaranteed money is owed regardless; controlled years can be declined (non-tender) if he's not worth it.
    proj["surplus"] = np.where(proj.status == "free agent", np.nan,
                               np.where(controlled, (proj.market - proj.cost).clip(lower=0), proj.market - proj.cost))
    proj["disc"] = DISCOUNT ** (proj.season - yr - 1)
    con.register("proj_df", proj)
    con.execute("create or replace table proj as select * from proj_df")

    con.register("xn", xwar_now.merge(ceiling, on="player_id", how="left"))
    con.execute(f"""
        create or replace table value as
        select p.player_id, n.xwar xwar_now, n.ceiling_xwar, n.xwrc_ceil, n.xfip_ceil,
               max(p.xwar) filter (season = {yr + 1}) xwar_next,
               max(p.xwar) peak_xwar, arg_max(season, p.xwar) peak_season,
               sum(p.xwar * disc) filter (status <> 'free agent') control_xwar,
               count(*) filter (status <> 'free agent') control_years,
               sum(cost * disc) filter (status <> 'free agent') control_cost,
               avg(cost) filter (status <> 'free agent') avg_cost,
               sum(surplus * disc) surplus,
               max(market) filter (season = {yr + 1}) market_next,
               max(price) filter (season = {yr + 1}) price_next,
               any_value(avail) avail
        from proj_df p left join xn n using (player_id) group by p.player_id, n.xwar, n.ceiling_xwar, n.xwrc_ceil, n.xfip_ceil
    """)
    lhp = con.execute("""
        select sum(s.ip) filter (p.t = 'Left') / sum(s.ip) from cur_pit_stats s join cur_players p on p.id = s.player_id where p.lev = 'RLB'
    """).fetchone()[0]
    con.execute(f"alter table market_params add column lhp_share double default {lhp}")
    print(f"share of MLB innings thrown by lefties: {lhp:.0%}")

    con.register("pv", pos_value)
    con.execute("create or replace table pos_value as select * from pv")

    jumps = jump_model(con)
    con.register("j", jumps)
    con.execute("create or replace table jump_odds as select * from j")
    con.close()
    print(f"wrote aging, proj ({len(proj)} rows), value, jump_odds")


if __name__ == "__main__":
    main()
