"""The lineup / staff / core plans you edit, and how each slot is judged.

Next-season plans only use players under contract or team control next season. Each slot is
valued by the model (a hitter's full-season xWAR at that position vs that hand, a starter's
xWAR, a reliever's xWAR weighted by the leverage of his role) and compared to the median MLB
team's player in the same slot. The core plan looks CORE_YEARS_AHEAD seasons past the current one.
"""

HIT = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"]
BULLPEN = ["CL", "SU1", "SU2", "MR1", "MR2", "LR", "LHS"]
LEVERAGE = {"CL": 1.6, "SU1": 1.25, "SU2": 1.25}  # other bullpen roles: 0.7 (see offseason.RP_LEVERAGE)
BULLPEN_SLOT = dict(zip(BULLPEN, [f"RP{i}" for i in range(1, 8)]))  # role -> depth chart slot for the league median
CORE_YEARS_AHEAD = 3
UPGRADE_GAP = 0.3  # flag a slot this far (xWAR) below the league median
STRONG_GAP = 0.5

PLANS = {
    "lineup_vr": {"title": "Lineup vs RHP", "group": "next", "kind": "hit", "hand": "vr",
                  "slots": HIT, "bench": [f"Bench {i}" for i in range(1, 6)]},
    "lineup_vl": {"title": "Lineup vs LHP", "group": "next", "kind": "hit", "hand": "vl",
                  "slots": HIT, "bench": [f"Bench {i}" for i in range(1, 6)]},
    "rotation": {"title": "Rotation", "group": "next", "kind": "pit", "role": "SP",
                 "slots": [f"SP{i}" for i in range(1, 6)], "bench": ["Spot starter"]},
    "bullpen": {"title": "Bullpen", "group": "next", "kind": "pit", "role": "RP", "slots": BULLPEN, "bench": []},
    "minors_hit": {"title": "Minors: hitters to watch", "group": "minors", "kind": "hit", "slots": [], "bench": [f"M{i}" for i in range(1, 9)]},
    "minors_pit": {"title": "Minors: pitchers to watch", "group": "minors", "kind": "pit", "slots": [], "bench": [f"M{i}" for i in range(1, 7)]},
    "core_lineup": {"title": "Core lineup", "group": "core", "kind": "hit",
                    "slots": HIT, "bench": ["Bench bat", "OF depth", "IF depth", "C backup"]},
    "core_rotation": {"title": "Core rotation", "group": "core", "kind": "pit", "role": "SP",
                      "slots": [f"SP{i}" for i in range(1, 6)], "bench": []},
}
