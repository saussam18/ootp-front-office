"""DataFrames -> JSON tables for the React app: typed columns (label, tooltip, format, link) and rows."""

import math

import numpy as np
import pandas as pd

# column -> (header, tooltip)
COLUMNS = {
    "name": ("Player", ""),
    "pos": ("Pos", "Listed position"),
    "best_pos": ("Best", "Position where the model values him most"),
    "age": ("Age", ""),
    "lev": ("Lvl", "Level: RLB, AAA, AA, A, R, INT (international complex), blank = free agent"),
    "org": ("Org", ""),
    "b": ("B", "Bats"),
    "t": ("T", "Throws"),
    "xwar_next": ("xWAR next", "Projected WAR next season: full season, scaled for injury risk"),
    "xwar": ("xWAR", "Projected WAR (full season, health-adjusted)"),
    "xwar_vr": ("vs RHP", "Full-season xWAR rate if every PA came vs right-handed pitching"),
    "xwar_vl": ("vs LHP", "Full-season xWAR rate if every PA came vs left-handed pitching"),
    "peak_xwar": ("Peak", "Best projected season"),
    "ceiling_xwar": ("Ceiling", "xWAR if he reached every potential rating"),
    "x3": ("3-yr xWAR", "Projected WAR over the next three seasons"),
    "control_years": ("Yrs", "Seasons you control him (contract, extension, arbitration)"),
    "yrs": ("Yrs", "Seasons controlled"),
    "avg_cost": ("Avg $M", "Average cost per controlled season"),
    "surplus": ("Value $M", "Our view: value minus cost over his controlled seasons, discounted 10%/yr"),
    "perceived": ("Other GMs $M", "How other GMs likely price him (bats over gloves, cheap control premium, prospect risk)"),
    "oy": ("Opt yrs", "Minor-league option years left"),
    "opt_yrs": ("Opt yrs", "Minor-league option years left"),
    "worth": ("Worth $M", "Most you should pay per year"),
    "worth_1y": ("Worth 1y", "Most you should pay for one year"),
    "worth_3y_aav": ("Worth 3y AAV", "Most you should pay per year over three years"),
    "price": ("Typical $M", "What the market usually pays a player like this"),
    "typical_price": ("Typical $M", "What the market usually pays a player like this"),
    "ask": ("Ask $M", "His current demand"),
    "now_salary": ("Salary", "Current salary, $M"),
    "p_jump": ("Jump %", "Chance OSA raises his potential total by 10+ at the next Jan 1 update"),
    "cur": ("Cur", "Sum of the 3 core current ratings"),
    "pot": ("Pot", "Sum of the 3 core potential ratings"),
    "cur_change": ("Δ cur", "Change in current ratings at the last Jan 1 update"),
    "pot_change": ("Δ pot", "Change in potential at the last Jan 1 update"),
    "we": ("WE", "Work ethic"),
    "on40": ("40-man", ""),
    "prone": ("Injury", "Injury proneness"),
    "loy": ("Loyalty", ""),
    "fin": ("Greed", "Financial ambition"),
    "your_depth": ("Your depth Δ", "Change in your next-season depth chart xWAR"),
    "their_depth": ("Their depth Δ", "Change in their next-season depth chart xWAR"),
    "prosp_rk": ("Prospect rk", "Latest RLB prospect ranking this season"),
    "wrc_plus": ("wRC+", "This season"),
    "xwrc": ("xwRC+", "Expected wRC+ from ratings"),
    "fip": ("FIP", "This season"),
    "xfip": ("xFIP", "Expected FIP from ratings"),
    "season_gain": ("Gain", "WAR gained over a season of that platoon"),
    "cur_xwar": ("Current", "Your current option's full-season rate vs that hand"),
    "his_xwar": ("His rate", "His full-season rate vs that hand"),
    "cost": ("Cost $M", "Typical FA price or current average salary"),
    "league_median": ("League median", "The median MLB team's player in that slot"),
    "vs_median": ("vs median", ""),
    "upgrade": ("Upgrade", "xWAR over your current option at that slot"),
    "their_pct": ("Their W%", ""),
    "their_needs": ("Their needs", "Their weakest slots vs the league median"),
    "your_fits": ("Your fits", "Your non-starters who'd upgrade them"),
}
MONEY = {"surplus", "perceived", "avg_cost", "worth", "price", "ask", "worth_1y", "worth_3y_aav", "typical_price",
         "now_salary", "cost", "award", "surplus_given", "your_gain"}
PERCENT = {"p_jump", "their_pct"}


INTS = {"age", "yrs", "control_years", "oy", "opt_yrs", "cur", "pot", "prosp_rk", "cur_change", "pot_change", "wrc_plus",
        "season", "years", "yr", "days", "g", "gs", "pa", "hr", "rbi", "r", "h", "ebh", "sv", "hld", "bs", "qs", "k"}
LINK_COLS = {"name": "id", "vs RHP": "id_vr", "vs LHP": "id_vl"}


def clean(v):
    """A JSON-safe Python value."""
    if v is None or v is pd.NA or v is pd.NaT:
        return None
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (float, np.floating)):
        return None if math.isnan(v) else float(v)
    if isinstance(v, (pd.Timestamp,)):
        return v.date().isoformat()
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


def fmt_of(col, s):
    if col in MONEY:
        return "money"
    if col in PERCENT:
        return "pct"
    if col in INTS:
        return "int"
    if pd.api.types.is_bool_dtype(s):
        return "bool"
    if pd.api.types.is_numeric_dtype(s):
        return "num"
    return "text"


def frame(df, hide=()):
    """{columns: [{key, label, tip, fmt, link?}], rows: [{...}]}; id columns ride along for links."""
    if df is None:
        return {"columns": [], "rows": []}
    df = df.reset_index(drop=True)
    cols = []
    for c in df.columns:
        if c in hide or c == "id" or str(c).startswith("id_") or c == "ids":
            continue
        label, tip = COLUMNS.get(c, (str(c).replace("_", " "), ""))
        col = {"key": c, "label": label, "tip": tip, "fmt": fmt_of(c, df[c])}
        if c in LINK_COLS and LINK_COLS[c] in df.columns:
            col["link"] = LINK_COLS[c]
        cols.append(col)
    rows = [{k: clean(v) for k, v in r.items()} for r in df.to_dict("records")]
    return {"columns": cols, "rows": rows}


def records(df):
    return [{k: clean(v) for k, v in r.items()} for r in df.reset_index(drop=True).to_dict("records")]
