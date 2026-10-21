"""Ratings -> expected results, fit on this season's MLB players.

Creates two tables in rlb.duckdb:
  hit_talent: xwrc (expected wRC+ from batting ratings), plus vs-L/R versions
  pit_talent: xfip (expected FIP from pitching ratings, fit separately for SP and RP)
  talent_coef: the fitted weights (model, term, coef), so other scripts can score projected ratings

    .venv/bin/python talent.py
"""

import duckdb
import numpy as np

from load import DB

HIT = ["babip", "ks", "gap", "pow", "eye"]
PIT = ["stu", "hra", "pbabip", "con"]
SP_TERMS = PIT + ["stm"]  # high-stamina starters beat their stuff/control (r = -0.25 on the residual)


def fit(df, y, X, w):
    d = df.dropna(subset=[y, w] + X)
    A = np.column_stack([np.ones(len(d))] + [d[x] for x in X])
    W = np.sqrt(d[w].to_numpy())
    coef, *_ = np.linalg.lstsq(A * W[:, None], d[y].to_numpy() * W, rcond=None)
    pred = A @ coef
    mean = np.average(d[y], weights=d[w])
    r2 = 1 - np.average((d[y] - pred) ** 2, weights=d[w]) / np.average((d[y] - mean) ** 2, weights=d[w])
    print(f"{y} ~ {' + '.join(X)}: n={len(d)}, R²={r2:.2f}")
    return coef


def predict(df, coef, X):
    return coef[0] + sum(c * df[x] for c, x in zip(coef[1:], X))


def main():
    con = duckdb.connect(str(DB))
    coefs = []
    hitters = con.sql("""
        select r.*, s.pa, s.wrc_plus from cur_bat_ratings r
        join cur_players p on p.id = r.player_id
        left join cur_bat_stats s using (player_id)
        where p.pos not in ('SP', 'RP', 'CL')
    """).df()
    coef = fit(hitters[hitters.pa >= 150], "wrc_plus", HIT, "pa")
    coefs += [("hit", t, c) for t, c in zip(["const"] + HIT, coef)]
    hitters["xwrc"] = predict(hitters, coef, HIT)
    # Split ratings only cover contact/power/eye; swap those in, keep BABIP/K's/gap.
    # Contact is mostly BABIP + avoid K's, so shift both by the side's contact delta.
    for side in ("vl", "vr"):
        shifted = hitters.assign(
            pow=hitters[f"pow_{side}"],
            eye=hitters[f"eye_{side}"],
            babip=hitters.babip + (hitters[f"con_{side}"] - hitters.con),
            ks=hitters.ks + (hitters[f"con_{side}"] - hitters.con),
        )
        hitters[f"xwrc_{side}"] = predict(shifted, coef, HIT)
    con.register("h", hitters[["player_id", "xwrc", "xwrc_vl", "xwrc_vr"]])
    con.execute("create or replace table hit_talent as select * from h")

    pitchers = con.sql("""
        select r.*, s.ip, s.gs, s.fip from cur_pit_ratings r
        left join cur_pit_stats s using (player_id)
    """).df()
    pitchers["xfip"] = np.nan
    starter = pitchers.stm >= 50
    for label, mask, sample, terms in [
        ("SP", starter, (pitchers.gs >= 8) & (pitchers.ip >= 40), SP_TERMS),
        ("RP", ~starter, (pitchers.gs < 3) & (pitchers.ip >= 30), PIT),
    ]:
        print(f"[{label}] ", end="")
        coef = fit(pitchers[sample], "fip", terms, "ip")
        coefs += [(label, t, c) for t, c in zip(["const"] + terms, coef)]
        pitchers.loc[mask, "xfip"] = predict(pitchers[mask], coef, terms)
    pitchers["role"] = np.where(starter, "SP", "RP")
    con.register("p", pitchers[["player_id", "role", "xfip"]])
    con.execute("create or replace table pit_talent as select * from p")
    con.execute("create or replace table talent_coef (model varchar, term varchar, coef double)")
    con.executemany("insert into talent_coef values (?, ?, ?)", coefs)
    con.close()


if __name__ == "__main__":
    main()
