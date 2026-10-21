"""First-run seed: the team strategy notes Sam kept before the app existed.

Names are matched to your org's players (accents and case ignored, last name or full name);
anything that doesn't match is kept as text so you can fix it in the app.
"""

from trade import norm

from . import store

NOTES = {"moves": ""}

BLOCK = [("Joaquín Rosa", "4th round pick", "Non-tender candidate; sell rather than pay arbitration"),
         ("PAT LEDESMA", "", "Too many OF prospects; can play CF (65 range)")]

# (year, departing, replacement)
FA = [
    (2132, "Robby Wallace", "ELIGIUS SCHUMMER"), (2132, "Dave Lewis", "FERNANDO JIMÉNEZ"),
    (2132, "Jesús Cisnero", "WILL WRIGHT"), (2132, "Fadeuka Liyv", "LAZZARO BOCCHERINI"),
    (2132, "Ken Smith", "HAJY TURKISTANISHVILI"), (2132, "Alexander Moody", "MARIO DÍAZ"),
    (2133, "Joaquín Rosa", "SANG-DUK PARK"), (2133, "Imamverdi Kobiashvili", "IGNATIE SANDU"),
    (2134, "Wally Cook", "SEUNG-HAK PARK"), (2134, "Artie Hardin", "DAVID PISTOHLKORS"),
]

SLOTS = {
    "lineup_vr": {"C": "Liyv", "1B": "Rosa", "2B": "Miller", "3B": "Ken Smith", "SS": "Truevtsev", "LF": "Dave Lewis",
                  "CF": "Munchkin", "RF": "Kinkladze", "DH": "Robby Wallace",
                  "Bench 1": "Kobiashvili", "Bench 2": "Artie Hardin", "Bench 3": "Fonseca", "Bench 4": "Urzica", "Bench 5": "DARBY SMITH"},
    "lineup_vl": {"C": "Kobiashvili", "1B": "Fonseca", "2B": "Miller", "3B": "Ken Smith", "SS": "Truevtsev", "LF": "DARBY SMITH",
                  "CF": "Munchkin", "RF": "Kinkladze", "DH": "Artie Hardin",
                  "Bench 1": "Liyv", "Bench 2": "Rosa", "Bench 3": "Urzica", "Bench 4": "Dave Lewis", "Bench 5": "Robby Wallace"},
    "minors_hit": {"M1": "LEDESMA", "M2": "JIMÉNEZ", "M3": "TURKISTANISHVILI", "M4": "DECOURCY", "M5": "SANDU", "M6": "BOCCHERINI"},
    "rotation": {"SP1": "Bienienda", "SP2": "Wally Cook", "SP3": "Abbott", "SP4": "Murakami", "SP5": "Cisnero", "Spot starter": "Koto Okawa"},
    "bullpen": {"CL": "Husain", "SU1": "Maekawa", "SU2": "Moody", "MR1": "Je-ju Kim", "MR2": "McCain", "LR": "Koto Okawa", "LHS": "Ervin"},
    "minors_pit": {"M1": "WILL WRIGHT", "M2": "MARIO DÍAZ", "M3": "Inaplia", "M4": "DeCaro"},
    "core_lineup": {"DH": "DECOURCY", "1B": "Fonseca", "2B": "Truevtsev", "SS": "Urzica", "LF": "JIMÉNEZ", "CF": "Kinkladze",
                    "RF": "LEDESMA", "C": "SANDU", "Bench bat": "SANG-DUK PARK", "OF depth": "DARBY SMITH",
                    "IF depth": "TURKISTANISHVILI", "C backup": "BOCCHERINI"},
    "core_rotation": {"SP1": "Bienienda", "SP2": "WILL WRIGHT", "SP3": "Abbott", "SP4": "Koto Okawa", "SP5": "Murakami"},
}


def resolver(org):
    """name -> player id among your org (None if no unique match)."""
    names = {pid: norm(n) for pid, n in org.name.items()}

    def find(text):
        t = norm(text)
        exact = [p for p, n in names.items() if n == t]
        if len(exact) == 1:
            return exact[0]
        hits = [p for p, n in names.items() if t in n or all(w in n.split() for w in t.split())]
        if len(hits) > 1:  # prefer the major leaguer
            mlb = [p for p in hits if org.lev.get(p) == "RLB"]
            hits = mlb if len(mlb) == 1 else hits
        return hits[0] if len(hits) == 1 else None
    return find


def seed(ctx):
    if not store.is_empty():
        return
    find = resolver(ctx.org())
    if pid := find("Jesús Cisnero"):
        store.set_control(pid, ctx.yr, "declining 2132 team option")
    for key, body in NOTES.items():
        store.set_note(key, body)
    for name, asking, note in BLOCK:
        if pid := find(name):
            store.add_block(pid, asking, note)
    for year, out, rep in FA:
        o, r = find(out), find(rep)
        store.set_fa_plan(year, o or 0, "" if o else out, r, "" if r else rep)
    for plan, slots in SLOTS.items():
        for slot, name in slots.items():
            pid = find(name)
            store.set_slot(plan, slot, pid, "" if pid else name)
