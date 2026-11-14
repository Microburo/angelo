# Checks a web capture before it is built: what the page shows but the capture lacks, so a gap is
# said up front instead of found in Figma. Same checks for both capture paths (headless, extension).
# - zones of the screenshot with content where the capture has no leaf (text, image, svg, canvas,
#   background image): a section the capture missed (lazy, hidden while read, clipped)
# - media frames without their image (a <picture> or <img> never loaded, a video never painted)
# - blocks invisible while read (reported by the capture itself)
# - page height left without content below the last captured leaf
# With --fill, what the capture cannot read takes its pixels from the screenshot, written back into
# the capture: iframes (ads, embeds: cross-origin, no DOM) and the boxes behind a missed zone.
# Usage: python3 -I tools/web-audit.py <capture.json> [page.jpg] [--fill]

import base64
import io
import json
import os
import sys

import numpy as np
from PIL import Image

BAND = 50  # css px per screenshot band
INK = 10  # gray std (0-255) above which a band shows content
ZONE = 200  # css px: a smaller uncovered zone is noise (a divider, a shadow)
TAIL = 1200  # css px of page left empty under the last leaf
FEW = 20  # leaves: fewer is a page that did not render (bot wall, consent wall)

args = [a for a in sys.argv[1:] if not a.startswith("--")]
FILL = "--fill" in sys.argv
cap = json.load(open(args[0]))
shot = args[1] if len(args) > 1 else os.path.join(os.path.dirname(args[0]), "page.jpg")
boxes = cap["boxes"]
W = int(cap.get("width", 1440))
H = int(cap.get("height", 0))
issues = []


def leaf(b):
    bg = b.get("bg") or ""
    return bool(b.get("text") or b.get("img") or b.get("canvas") or (isinstance(bg, str) and ("url(" in bg or "gradient" in bg)))


leaves = [b for b in boxes if leaf(b) and b["w"] > 0 and b["h"] > 0]

if len(leaves) < FEW:
    issues.append(f"capture almost empty: {len(leaves)} leaves over {H} px (page blocked, consent wall, client-side render unfinished?)")

# media frames without their image
kids = {}
for b in boxes:
    kids.setdefault(b.get("p"), []).append(b)


def has_img(b):
    return bool(b.get("img")) or any(has_img(k) for k in kids.get(b["id"], []))


empty = [b for b in boxes if b.get("tag") in ("picture", "img", "video") and b["w"] * b["h"] >= 2500 and not has_img(b)]
empty += [b for b in boxes if (b.get("blank") or b.get("partial")) and not b.get("shot")]
if empty:
    issues.append(f"{len(empty)} media frame(s) without an image: " + " · ".join(f"{b['tag']} y {round(b['y'])} {round(b['w'])}×{round(b['h'])}" for b in empty[:6]))

unseen = cap.get("unseen") or []
if unseen:
    issues.append(f"{len(unseen)} block(s) invisible when read: " + " · ".join(f"{u['what']} y {u['y']} h {u['h']}" for u in unseen[:6]))

bottom = max((b["y"] + b["h"] for b in leaves), default=0)
if H and H - bottom > TAIL:
    issues.append(f"nothing captured below y {round(bottom)} of a {H} px page ({H - round(bottom)} px empty)")

# the screenshot band by band, against what the capture covers
if os.path.exists(shot):
    rgb = Image.open(shot).convert("RGB")
    rgb = rgb.resize((W, round(rgb.height * W / rgb.width)), Image.BILINEAR)
    rows = np.ones(rgb.height, bool)
    for t, b in cap.get("holes", []):
        rows[max(0, t) : max(0, min(rgb.height, b))] = False
    C = np.asarray(rgb)[rows]
    P = np.asarray(rgb.convert("L"))[rows].astype(np.float32)
    if H and P.shape[0] < H - 2 * BAND:
        issues.append(f"screenshot incomplete: {P.shape[0]} px of {H}, the bottom is not checked")
    n = P.shape[0] // BAND
    ink = [P[i * BAND : (i + 1) * BAND].std() > INK for i in range(n)]
    covered = np.zeros(n, bool)
    for b in leaves:
        covered[max(0, int(b["y"] // BAND)) : max(0, min(n, int((b["y"] + b["h"]) // BAND) + 1))] = True
    zones, start = [], None
    for i in range(n + 1):
        gap = i < n and ink[i] and not covered[i]
        if gap and start is None:
            start = i
        elif not gap and start is not None:
            if (i - start) * BAND >= ZONE:
                zones.append((start * BAND, i * BAND))
            start = None

    def inked(b):
        return any(leaf(k) or inked(k) for k in kids.get(b["id"], []))

    def crop(b):
        x0, y0 = max(0, round(b["x"])), max(0, round(b["y"]))
        x1, y1 = min(W, round(b["x"] + b["w"])), min(C.shape[0], round(b["y"] + b["h"]))
        if x1 - x0 < 8 or y1 - y0 < 8 or P[y0:y1, x0:x1].std() <= INK:
            return None  # too small, or nothing painted there (an ad slot left empty)
        buf = io.BytesIO()
        Image.fromarray(C[y0:y1, x0:x1]).save(buf, "JPEG", quality=85)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()

    if FILL:
        # an iframe is read as an empty box: its pixels come from the screenshot
        fill = [b for b in boxes if b.get("tag") == "iframe" and b["w"] * b["h"] >= 2500 and not b.get("img")]
        # a video the capture could not still (stream loaded on view): the frame the page shows there, when no poster stands in
        def posted(v):
            # an image box (poster, thumbnail) already covers most of the video: nothing to fill
            return any(o.get("img") and o is not v and min(o["x"] + o["w"], v["x"] + v["w"]) - max(o["x"], v["x"]) > v["w"] / 2 and min(o["y"] + o["h"], v["y"] + v["h"]) - max(o["y"], v["y"]) > v["h"] / 2 for o in boxes)

        fill += [b for b in boxes if b.get("tag") == "video" and b.get("blank") and b["w"] * b["h"] >= 2500 and not has_img(b) and not posted(b)]
        # a missed zone: the smallest box spanning it with nothing captured inside
        left = []
        for a, z in zones:
            if any(min(z, b["y"] + b["h"]) - max(a, b["y"]) >= (z - a) / 2 for b in fill):
                continue  # an iframe already filled covers it
            span = [b for b in boxes if b["y"] <= a + BAND and b["y"] + b["h"] >= z - BAND and b["w"] >= 200 and b["h"] < 3 * (z - a) + 4 * BAND and not leaf(b) and not inked(b)]
            if span:
                fill.append(min(span, key=lambda b: b["w"] * b["h"]))
            else:
                left.append((a, z))
        done = []
        for b in fill:
            src = crop(b)
            if src:
                b["img"], b["shot"] = src, True
                done.append(b)
        if done:
            json.dump(cap, open(args[0], "w"))
            print(f"filled from the screenshot: {len(done)} frame(s) · " + " · ".join(f"{b['tag']} y {round(b['y'])} {round(b['w'])}×{round(b['h'])}" for b in done[:8]))
        zones = left
    if zones:
        issues.append(f"{len(zones)} zone(s) visible on the page, empty in the capture: " + " · ".join(f"y {a}-{b}" for a, b in zones[:6]))
else:
    issues.append("no screenshot: missing zones not checked")

if issues:
    print("incomplete capture:")
    for i in issues:
        print("  " + i)
else:
    print(f"audit capture : ok ({len(leaves)} feuilles, {H} px)")
