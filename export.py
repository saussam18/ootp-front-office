"""Export every player-list view from OOTP to CSV by driving the game window.

    .venv/bin/python export.py            # all views
    .venv/bin/python export.py default batting_ratings

OOTP must be open with the RLB league loaded. Don't touch the mouse while it
runs. Uses RLB > Transactions > Players > RLB Player List with minor leaguers,
international complex and free agents included.
"""

import glob
import os
import sys
import time

import ootp_ui as u
from load import EXPORTS

# view template -> position filter. Batting views get batters only, pitching views pitchers only.
VIEWS = {
    "default": "all_players",
    "financial_info": "all_players",
    "personality_morale": "all_players",
    "batting_ratings": "all_batters",
    "batting_potential": "all_batters",
    "fielding_ratings": "all_batters",
    "position_ratings": "all_batters",
    "batting_stats_main": "all_batters",
    "batter_prospect": "all_batters",
    "pitching_ratings": "all_pitchers",
    "pitching_potential": "all_pitchers",
    "individual_pitch_ratings": "all_pitchers",
    "individual_pitch_potential": "all_pitchers",
    "pitching_stats_main": "all_pitchers",
    "pitcher_prospect": "all_pitchers",
}
MENU = 0.97  # menu rows like "Batting Stats 1"/"2" score ~0.96 against each other


def wait_for(template, timeout=10, **kw):
    end = time.time() + timeout
    while time.time() < end:
        hit = u.find(template, **kw)
        if hit:
            return hit
        time.sleep(0.4)
    raise RuntimeError(f"timed out waiting for '{template}'")


def open_player_list():
    u.click_template("menu_rlb")
    u.click_template("item_transactions", threshold=0.9)
    time.sleep(1.5)
    u.click_template("tab_players")
    time.sleep(1.5)
    u.click_template("subtab_player_list")
    time.sleep(2.5)
    u.park()
    wait_for("btn_view")


def set_filters():
    for label, want in [("lbl_include_minors", True), ("lbl_include_intl", True), ("lbl_include_fa", True), ("lbl_include_retired", False)]:
        if u.set_checkbox(label, want):
            u.park()


def choose(button, item):
    u.park()
    u.click_template(button)
    u.park()
    u.click_template(item, threshold=MENU)
    time.sleep(1.0)
    # Leaving a customized view asks to save it first; saving keeps your column changes.
    u.park()
    if u.find("dlg_view_not_saved"):
        u.click_template("btn_yes")
    time.sleep(1.5)  # list reload


def write_csv():
    start = time.time()
    u.park()
    u.click_template("report_button")
    u.click_template("write_csv")
    wait_for("btn_ok", timeout=60)
    u.click_template("btn_ok")
    new = [p for p in glob.glob(str(EXPORTS / "*.csv")) if os.path.getmtime(p) >= start - 1]
    if not new:
        raise RuntimeError("OOTP said complete but no CSV changed")
    path = max(new, key=os.path.getmtime)
    rows = sum(1 for _ in open(path, encoding="utf-8-sig")) - 1
    return os.path.basename(path), rows


def main(views):
    u.activate()
    u.park()
    open_player_list()
    set_filters()
    position = None
    for view in views:
        if VIEWS[view] != position:
            choose("btn_position", f"pos_{VIEWS[view]}")
            position = VIEWS[view]
        choose("btn_view", f"view_{view}")
        name, rows = write_csv()
        print(f"  {view:28} {rows:6} rows -> {name}")


if __name__ == "__main__":
    main(sys.argv[1:] or list(VIEWS))
