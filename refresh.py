"""Export from OOTP, rebuild the database, refit talent and value, print the team report.

The offseason report (offseason.py) is long, so it's saved to out/<team>_offseason.txt.

    .venv/bin/python refresh.py            # run once now
    .venv/bin/python refresh.py --watch    # wait for each new league file download, then run
    .venv/bin/python refresh.py --skip-export   # reuse the last exports, e.g. to pick up a new team file

Run from the terminal app that has Accessibility + Screen Recording access.
Moving the mouse while the export runs stops it.
"""

import argparse
import subprocess
import sys
import time

import export
import history
import load
import ootp_ui
import talent
import value

STAMP = load.LEAGUE / "settings" / "online_league_file_time.cfg"


def notify(text):
    subprocess.run(["osascript", "-e", f'display notification "{text}" with title "RLB refresh"'], capture_output=True)


def refresh(team, skip_export=False):
    if not skip_export:
        print("exporting from OOTP...")
        try:
            export.main(list(export.VIEWS))
        except ootp_ui.UserTookOver as e:
            print(f"stopped: {e}. Run refresh.py again when you're away from the mouse.")
            notify("Export stopped - you moved the mouse")
            return False
    load.take_snapshot()
    load.build_db()
    talent.main()
    history.main()
    value.main()
    subprocess.run([sys.executable, "report.py", team], cwd=load.ROOT)
    path = load.ROOT / "out" / f"{team.lower()}_offseason.txt"
    path.parent.mkdir(exist_ok=True)
    with open(path, "w") as f:
        subprocess.run([sys.executable, "offseason.py", team], cwd=load.ROOT, stdout=f)
    print(f"offseason report: {path}")
    notify(f"Done - snapshot {load.snapshot_id()}")
    return True


def watch(team, warn):
    seen = STAMP.read_bytes()
    print(f"watching for new league file downloads (current: {load.snapshot_id()})")
    while True:
        time.sleep(30)
        if STAMP.read_bytes() == seen:
            continue
        time.sleep(20)  # let OOTP finish loading the new file
        notify(f"New league file - exporting in {warn}s. Hands off the mouse.")
        time.sleep(warn)
        ootp_ui._last = None
        if refresh(team):
            seen = STAMP.read_bytes()


if __name__ == "__main__":
    sys.stdout.reconfigure(line_buffering=True)
    ap = argparse.ArgumentParser()
    ap.add_argument("--watch", action="store_true")
    ap.add_argument("--team", default="Halifax")
    ap.add_argument("--warn", type=int, default=20, help="seconds of warning before a watched export starts")
    ap.add_argument("--skip-export", action="store_true", help="don't drive OOTP; reload the exports and team file already on disk")
    args = ap.parse_args()
    watch(args.team, args.warn) if args.watch else refresh(args.team, args.skip_export)
