"""Your team's moves, read from the league's transaction logs (news/txt/teams/team_<id>_*transactions.txt)."""

import hashlib
import re

from load import LEAGUE

LINK = re.compile(r'<a href="\.\./(players|teams|coaches)/(?:player|team|coach)_(\d+)\.html">([^<]*)</a>')
# kind -> pattern, first match wins; "roster" and "injury" are the day-to-day shuffles.
KINDS = [
    ("staff", r"[Cc]oach|Trainer|\bGM\b|Manager|Scout|retires|leaves the team|Hired"),
    ("trade", r"[Tt]raded"),
    ("draft", r"^Drafted|[Rr]ule 5"),
    ("release", r"Released|[Dd]esignated .*for assignment|waivers|[Cc]laimed|becomes a free[- ]agent|Declined|Voided|not offered arbitration"),
    ("signing", r"\b[Ss]igned\b|extension|Executed the contract|received a \d+-year contract|Agreed"),
    ("injury", r"injured list|Activated"),
    ("roster", r"Optioned|Recalled|Purchased the contract|Promoted|Demoted|Sent |Assigned|active roster|40-man|Invited|Reassigned|Selected"),
]
KEY_KINDS = {"trade", "draft", "signing", "release"}


def segments(text):
    """Text -> [{'text'} | {'text', 'player_id'}] so player names can link."""
    out, pos = [], 0
    for m in LINK.finditer(text):
        if m.start() > pos:
            out.append({"text": text[pos:m.start()]})
        seg = {"text": m.group(3)}
        if m.group(1) == "players":
            seg["player_id"] = int(m.group(2))
        out.append(seg)
        pos = m.end()
    if pos < len(text):
        out.append({"text": text[pos:]})
    return out


def kind_of(text):
    plain = LINK.sub(lambda m: m.group(3), text)
    return next((k for k, rx in KINDS if re.search(rx, plain)), "other")


def moves(team_id, trades=()):
    """Every logged move, newest first: {key, date, kind, key_move, parts}.

    Trade lines in the logs are plain text, so trades come from `trades` instead (built from the
    player histories, with every player linked): [(date, parts)]."""
    seen, out = set(), []
    for name in (f"team_{team_id}_all_transactions.txt", f"team_{team_id}_transactions.txt"):
        path = LEAGUE / "news/txt/teams" / name
        if not path.exists():
            continue
        for raw in open(path, "rb"):
            try:
                line = raw.decode("utf-8")
            except UnicodeDecodeError:  # some logs are Windows-1252
                line = raw.decode("cp1252", errors="replace")
            date, _, text = line.rstrip("\n").partition("\t")
            if len(date) != 8 or not date.isdigit() or not text.strip():
                continue
            key = hashlib.sha1(f"{date}|{text}".encode()).hexdigest()[:16]
            if key in seen:
                continue
            seen.add(key)
            k = kind_of(text)
            if k == "trade":
                continue
            out.append({"key": key, "date": f"{date[:4]}-{date[4:6]}-{date[6:]}", "kind": k, "key_move": k in KEY_KINDS,
                        "parts": segments(text)})
    for date, parts in trades:
        out.append({"key": hashlib.sha1(f"{date}|{parts}".encode()).hexdigest()[:16], "date": date, "kind": "trade",
                    "key_move": True, "parts": parts})
    return sorted(out, key=lambda m: m["date"], reverse=True)
