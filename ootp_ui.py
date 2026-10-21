"""Drive the OOTP 27 window: screenshots, template matching, clicks and keys.

Coordinates are window pixels (Retina, 2x points), the same space as shot().
Needs Accessibility + Screen Recording permission for the terminal app.
"""

import subprocess
import tempfile
import time
from pathlib import Path

import cv2
import numpy as np
import Quartz

TEMPLATES = Path(__file__).resolve().parent / "ui_templates"
OWNER = "OOTP Baseball 27"


def window():
    """(window id, bounds dict in points) of the main OOTP window."""
    wins = Quartz.CGWindowListCopyWindowInfo(
        Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements, Quartz.kCGNullWindowID
    )
    for w in wins:
        if w.get("kCGWindowOwnerName") == OWNER and w.get("kCGWindowLayer") == 0:
            return w["kCGWindowNumber"], dict(w["kCGWindowBounds"])
    raise RuntimeError("OOTP window not found - is the game open with the league loaded?")


def activate():
    subprocess.run(
        ["osascript", "-e", f'tell application "System Events" to set frontmost of (first process whose name is "{OWNER}") to true'],
        check=True, capture_output=True,
    )
    time.sleep(0.4)


def shot(save=None):
    """Window screenshot as a BGR array (window pixels)."""
    wid, _ = window()
    path = save or tempfile.mktemp(suffix=".png")
    subprocess.run(["screencapture", "-x", "-o", "-l", str(wid), str(path)], check=True)
    img = cv2.imread(str(path))
    if not save:
        Path(path).unlink()
    return img


def _to_screen(x, y):
    _, b = window()
    img_h = shot().shape[0]
    scale = img_h / b["Height"]  # 2.0 on Retina
    return b["X"] + x / scale, b["Y"] + y / scale


class UserTookOver(RuntimeError):
    pass


_last = None  # where we last put the mouse


def _mouse(kind, pt):
    global _last
    if _last is not None:
        now = Quartz.CGEventGetLocation(Quartz.CGEventCreate(None))
        if abs(now.x - _last[0]) > 3 or abs(now.y - _last[1]) > 3:
            raise UserTookOver("mouse moved by someone else - stopping")
    ev = Quartz.CGEventCreateMouseEvent(None, kind, pt, Quartz.kCGMouseButtonLeft)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
    _last = (pt[0], pt[1])


def park():
    """Move the mouse to the title bar so hover tooltips don't cover buttons."""
    _mouse(Quartz.kCGEventMouseMoved, _to_screen(1400, 20))
    time.sleep(0.5)


def click(x, y, pause=0.6):
    pt = _to_screen(x, y)
    _mouse(Quartz.kCGEventMouseMoved, pt)
    time.sleep(0.05)
    _mouse(Quartz.kCGEventLeftMouseDown, pt)
    time.sleep(0.05)
    _mouse(Quartz.kCGEventLeftMouseUp, pt)
    time.sleep(pause)


KEYS = {"escape": 53, "return": 36, "down": 125, "up": 126}


def key(name, pause=0.4):
    code = KEYS[name]
    for down in (True, False):
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, Quartz.CGEventCreateKeyboardEvent(None, code, down))
        time.sleep(0.03)
    time.sleep(pause)


def find(template, img=None, threshold=0.88, region=None):
    """Best match of ui_templates/<template>.png: (center x, center y, score) or None."""
    img = shot() if img is None else img
    tpl = cv2.imread(str(TEMPLATES / f"{template}.png"))
    x0, y0 = 0, 0
    if region:
        x0, y0, x1, y1 = region
        img = img[y0:y1, x0:x1]
    res = cv2.matchTemplate(img, tpl, cv2.TM_CCOEFF_NORMED)
    _, score, _, (mx, my) = cv2.minMaxLoc(res)
    if score < threshold:
        return None
    h, w = tpl.shape[:2]
    return x0 + mx + w // 2, y0 + my + h // 2, score


def click_template(template, **kw):
    hit = find(template, **kw)
    if not hit:
        raise RuntimeError(f"couldn't find '{template}' on screen")
    click(hit[0], hit[1])
    return hit


def set_checkbox(label, checked):
    """Tick or untick the checkbox just left of ui_templates/<label>.png. Returns True if it clicked."""
    img = shot()
    hit = find(label, img=img)
    if not hit:
        raise RuntimeError(f"couldn't find checkbox label '{label}'")
    w = cv2.imread(str(TEMPLATES / f"{label}.png")).shape[1]
    bx, by = hit[0] - w // 2 - 25, hit[1] + 4
    region = (bx - 25, by - 25, bx + 25, by + 25)
    on = find("box_checked", img=img, region=region, threshold=0)
    off = find("box_unchecked", img=img, region=region, threshold=0)
    if (on[2] > off[2]) == checked:
        return False
    click(bx, by, pause=1.5)
    return True


def save_template(name, x0, y0, x1, y1, img=None):
    """Crop a region of the current window into ui_templates/<name>.png."""
    img = shot() if img is None else img
    TEMPLATES.mkdir(exist_ok=True)
    cv2.imwrite(str(TEMPLATES / f"{name}.png"), img[y0:y1, x0:x1])
