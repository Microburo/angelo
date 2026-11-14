# Block-by-block comparison of a Figma build (figma.jpg) with the page screenshot (page.jpg).
# The named blocks of the capture (Header, Section — …) are frames of the same name in Figma:
# their positions give the height gaps exactly, and each block is compared top-aligned with
# itself, so a gap in one block does not shift the comparison of the next ones.
# Called by web-compare.mjs: python3 -I tools/web-compare.py <case dir>

import re
import datetime
import glob
import json
import os
import sys

import numpy as np
from PIL import Image

BAND = 40  # css px per compared band
MOVE = 8  # css px: a smaller position or height gap is noise
GAP = 18  # mean gray gap (0-255) above which a band differs
HOT = 40  # per-pixel gap shown red
PIECE = 2000  # px height of each compare image

d = sys.argv[1]
cap = json.load(open(os.path.join(d, "capture.json")))
fig = json.load(open(os.path.join(d, "figma.json")))
W = int(cap.get("width", 1440))


def to_width(img):
    return img.resize((W, round(img.height * W / img.width)), Image.LANCZOS)


page = to_width(Image.open(os.path.join(d, "page.jpg")).convert("RGB"))
# the bands left out of a partial capture are cut from the screenshot as from the capture
rows = np.ones(page.height, bool)
for t, b in cap.get("holes", []):
    rows[max(0, t) : max(0, min(page.height, b))] = False
P = np.asarray(page)[rows]
F = np.asarray(to_width(Image.open(os.path.join(d, "figma.jpg")).convert("RGB")))
frames = fig["frames"]
print(f"check: page {P.shape[0]} px · Figma {F.shape[0]} px ({F.shape[0] - P.shape[0]:+d})")
# a screenshot shorter than the capture (the browser shot its viewport only) checks nothing below
H_CAP = int(cap.get("height", P.shape[0]))
if P.shape[0] < H_CAP - 2 * MOVE:
    print(f"  screenshot incomplete: {P.shape[0]} px of {H_CAP}, the rest is not checked")


def where(y0, y1):
    mid = (y0 + y1) / 2
    hits = [fr for fr in frames if fr["y"] <= mid < fr["y"] + fr["h"]]
    return " › ".join(fr["name"] for fr in sorted(hits, key=lambda fr: fr["d"])[-3:]) or "racine"


# a block's extent is its painted content, not only its box: a title that overflows its box
# (positioned above it) makes the Figma frame, which hugs its content, start there
kids = {}
for b in cap["boxes"]:
    kids.setdefault(b.get("p"), []).append(b)


def extent(b):
    top, bot, stack = b["y"], b["y"] + b["h"], list(kids.get(b["id"], []))
    while stack:
        c = stack.pop()
        # what is pinned is not the block's flow
        if c.get("pin"):
            continue
        # a box without size (display: contents, at 0,0) says nothing of where the block paints
        if (c.get("text") or c.get("img")) and c["w"] and c["h"]:
            top, bot = min(top, c["y"]), max(bot, c["y"] + c["h"])
        stack.extend(kids.get(c["id"], []))
    return top, bot


# blocks found on both sides, in page order
seen, blocks = set(), []
for b in sorted((b for b in cap["boxes"] if b.get("block")), key=lambda b: b["y"]):
    # same-named frames (a site banner and the nav both "Header"): the one nearest the block
    top, bot = extent(b)
    fr = min((fr for fr in frames if fr["name"] == b["block"]), key=lambda fr: abs(fr["y"] - top) + abs(fr["h"] - (bot - top)), default=None)
    if fr and b["block"] not in seen:
        seen.add(b["block"])
        blocks.append((b["block"], round(top), round(bot - top), fr["y"], fr["h"]))
# a block off the canvas (a skip link parked at x -999) is not drawn: not missing
missing = sorted({b["block"] for b in cap["boxes"] if b.get("block") and b["x"] + b["w"] > 0 and b["x"] < cap.get("width", 1e9)} - seen)
for name in missing[:5]:
    print(f"  block missing from Figma: {name}")
tops = sorted(b["y"] for b in cap["boxes"] if b.get("block"))


def rhythm(y, h, fh):
    # vertical rhythm is padding-bottom: a Figma block taller by no more than the gap down to the next
    # block carries that gap; its height says nothing then, wherever an earlier block pushed it
    bot = y + h
    room = next((t for t in tops if t >= bot), P.shape[0]) - bot
    return 0 < fh - h <= room + MOVE


moved = [(n, y, h, fy, fh) for n, y, h, fy, fh in blocks if abs(fy - y) >= MOVE or (abs(fh - h) >= MOVE and not rhythm(y, h, fh))]
for n, y, h, fy, fh in moved[:12]:
    print(f"  {n} : page y {y} h {h} · Figma y {fy} h {fh} (y {fy - y:+d}, h {fh - h:+d})")

# outer blocks (not inside another) tile the comparison; no block → the whole page
outer = [b for b in blocks if not any(o is not b and o[1] <= b[1] and b[1] + b[2] <= o[1] + o[2] and o[2] > b[2] for o in blocks)]
segments = [(n, y, h, fy, fh) for n, y, h, fy, fh in outer] or [("page", 0, P.shape[0], 0, F.shape[0])]
blind = [n for n, y, h, fy, fh in segments if y >= P.shape[0]]
segments = [sg for sg in segments if sg[1] < P.shape[0]]
for n in blind[:5]:
    print(f"  not checked (outside the screenshot): {n}")



def block_drift(y):
    for _, by, bh, fy, _ in outer:
        if by <= y < by + bh:
            return fy - by
    return 0


def realign(P):
    # The reference is shot after the capture: an ad that grew in between pushes the whole page down in
    # the shot (nyt: +30 px from the top). The shot is laid back on the capture's rows, from where Figma
    # (which follows the capture) shows the same pixels, so a shifted reference is not scored as a bad build.
    Fg, Pg = F.mean(axis=2)[:, ::4], P.mean(axis=2)[:, ::4]
    H, h, step, R = min(len(Fg), len(Pg)), 120, 150, 70
    ys, ss = [], []
    for y in range(0, H - h - R, step):
        d = block_drift(y)
        if y + d < 0 or y + d + h > len(Fg):
            continue
        f = Fg[y + d : y + d + h]
        if f.std() < 12:
            continue
        gaps = [(float(np.abs(Pg[y + dy : y + dy + h] - f).mean()), dy) for dy in range(-R, R + 1) if 0 <= y + dy and y + dy + h <= len(Pg)]
        if not gaps:
            continue
        g, dy = min(gaps)
        if g < 0.5 * float(np.median([x[0] for x in gaps])):  # a clear minimum only
            ys.append(y + h / 2)
            ss.append(dy)
    if len(ss) < 4 or abs(float(np.median(ss))) < MOVE:
        return P
    # a window whose Figma side is wrong votes alone: the median of its neighbours decides
    sm = [int(np.median(ss[max(0, i - 1) : i + 2])) for i in range(len(ss))]
    shift = np.interp(np.arange(len(P)), ys, sm)
    idx = np.clip(np.round(np.arange(len(P)) + shift).astype(int), 0, len(P) - 1)
    print(f"  reference shifted by {int(np.median(sm)):+d} px ({min(sm):+d} to {max(sm):+d}) against the capture (ads, lazy loading): realigned on its lines")
    return P[idx]


P = realign(P)

regions, strips, ghosts, total = [], [], [], []
for n, y, h, fy, fh in segments:
    p = P[max(0, y) : max(0, y) + h]
    f = F[max(0, fy) : max(0, fy) + fh]
    H = max(len(p), len(f))
    a = np.full((H, W, 3), 255, np.uint8)
    b = a.copy()
    a[: len(p)], b[: len(f)] = p, f
    gap = np.abs(a.astype(np.int16) - b.astype(np.int16)).mean(axis=2)
    heat = (b.mean(axis=2, keepdims=True) * 0.35 + 140).astype(np.uint8).repeat(3, axis=2)
    heat[gap > HOT] = [230, 40, 40]
    strips.append(np.concatenate([a, np.full((H, 20, 3), 255, np.uint8), b, np.full((H, 20, 3), 255, np.uint8), heat], axis=1))
    strips.append(np.full((6, W * 3 + 40, 3), 200, np.uint8))  # block separator
    # page and Figma laid over each other at half opacity: ISO reads sharp, a miss reads doubled
    ghosts.append(((a.astype(np.uint16) + b) // 2).astype(np.uint8))
    ghosts.append(np.full((6, W, 3), 200, np.uint8))
    cur = None
    for top in range(0, H, BAND):
        g = float(gap[top : top + BAND].mean())
        total.append(g)
        if g > GAP:
            if cur and cur[1] == top:
                cur[1], cur[2], cur[3] = top + BAND, cur[2] + g, cur[3] + 1
            else:
                cur = [top, top + BAND, g, 1]
                regions.append((fy, cur))
        else:
            cur = None
regions.sort(key=lambda r: -r[1][2])
for fy, (t, b, s, k) in regions[:8]:
    print(f"  Figma gap y {fy + t}–{fy + b}: {s / k:.0f}/255 · {where(fy + t, fy + b)}")
score = 100 - np.mean(total) / 2.55 if total else 0
extra = f" · {len(missing)} block(s) missing" * bool(missing) + f" · {len(blind)} block(s) not checked" * bool(blind)
print(f"  similarity {score:.0f} % · {len(moved)} block(s) moved · {len(regions)} gap zone(s){extra}")


# Element contract: every drawn leaf of the capture (image, svg, text) must exist in Figma at its
# place (shifted by the drift of its block) and look like the page there. Bands give the overall
# score; this names the element that is not ISO (an image never placed, a picture caught mid-reveal).
def page_y(y):
    # capture y → row of P: the capture closed its holes up already (boxes lifted), as P has them cut out
    return y


def drift(b):
    # offset of the innermost block holding the box (page → Figma)
    hold = [bl for bl in blocks if bl[1] <= b["y"] and b["y"] + b["h"] <= bl[1] + bl[2]]
    if not hold:
        return 0
    bl = min(hold, key=lambda bl: bl[2])
    return bl[3] - bl[1]


def flat(a):
    return a.size == 0 or float(a.std()) < 4


def unpainted(p, f):
    # the reference shows a light, near-uniform slot (lazy picture not painted at shot time) where Figma holds a real picture
    # (the slot keeps its caption and gradient over the grey: most of the pixels are the slot's grey)
    grey = float((np.abs(p.astype(np.int16) - np.median(p.reshape(-1, 3), axis=0)) <= 6).all(axis=2).mean())
    return float(np.median(p)) > 215 and grey >= 0.5 and float(f.std()) > 2 * max(float(p.std()), 8) * (1 if grey < 0.9 else 1)


unpainted_refs = []
slide_refs = []
# slides of a rotating gallery: images stacked at the same place, one visible (op 1) at capture time
_stack = {}
for _b in cap["boxes"]:
    if _b.get("img") and _b["img"] != "svg":
        _stack.setdefault((_b["x"], _b["y"], _b["w"], _b["h"]), set()).add(_b["img"])


def ahash(a):
    g = np.asarray(Image.fromarray(a).convert("L").resize((8, 8), Image.BILINEAR), np.float32)
    return g > g.mean()


def inside(b, rects, dy, cover, merged=False):
    # a Figma leaf over the box: images by overlap, vectors and texts by their centre
    x0, y0, x1, y1 = b["x"], b["y"] + dy, b["x"] + b["w"], b["y"] + dy + b["h"]
    for x, y, w, h in rects:
        if cover:
            ov = max(0, min(x1, x + w) - max(x0, x)) * max(0, min(y1, y + h) - max(y0, y))
            if ov >= 0.5 * b["w"] * b["h"]:
                return True
        elif x0 - 2 <= x + w / 2 <= x1 + 2 and y0 - 2 <= y + h / 2 <= y1 + 2:
            return True
        elif merged and x <= (x0 + x1) / 2 <= x + w and y <= (y0 + y1) / 2 <= y + h and w * h > 2 * (x1 - x0) * (y1 - y0):
            return True  # an inline run ("4h ago" after its sentence) merged into the paragraph's text node: drawn, in its range
    return False


has_leaves = "imgs" in fig
SLIDE = 12  # css px searched around the expected place: a leaf a few px off is placed, not wrong
issues, kinds = [], {"image": 0, "svg": 0, "text": 0}
unseen_both = []


def best(p, x0, fy):
    # Figma crop at the offset (within SLIDE) that matches the page crop best → (gap, dx, dy, crop)
    h, w = p.shape[:2]
    pi = p.astype(np.int16)
    top = None
    for oy in range(-SLIDE, SLIDE + 1, 2 if h > 60 else 1):
        for ox in range(-4, 5, 2):
            y0, xx = fy + oy, x0 + ox
            if y0 < 0 or xx < 0 or y0 + h > F.shape[0] or xx + w > W:
                continue
            f = F[y0 : y0 + h, xx : xx + w]
            g = float(np.abs(pi - f).mean())
            if top is None or g < top[0]:
                top = (g, ox, oy, f)
    return top


def register(P):
    # The whole shot off by a few px from the capture (Dia: viewport shorter at the shot, a 25vh or
    # centred column moves up by half the gap) is too short a page or too small a shift for realign's
    # bands: every leaf then slides by the same amount and reads "shifted". One offset is searched for
    # all the leaves at once (a single text matches at ± its line height too, the sum does not), and
    # the shot is laid back on the capture by it when it fits clearly better than none.
    crops = []
    for b in cap["boxes"]:
        if not (b.get("text") or b.get("img") == "svg") or b.get("op") == 0 or b["w"] < 8 or b["h"] < 8 or b["x"] >= W:
            continue
        y, dy = page_y(b["y"]), drift(b)
        x0, x1 = max(0, b["x"]), min(W, b["x"] + b["w"])
        if y < 0 or y + b["h"] > P.shape[0] or x1 - x0 < 8 or float(P[y : y + b["h"], x0:x1].std()) < 6:
            continue
        crops.append((P[y : y + b["h"], x0:x1].mean(axis=2), b["y"] + dy, b["h"], x0, x1))
    if len(crops) < 3:
        return P
    R = 2 * SLIDE
    Fm = F.mean(axis=2)
    score = {}
    for oy in range(-R, R + 1):
        tot = 0.0
        for p, fy, h, x0, x1 in crops:
            y0 = min(max(0, fy + oy), Fm.shape[0] - h)
            tot += float(np.abs(p - Fm[y0 : y0 + h, x0:x1]).mean())
        score[oy] = tot
    m = min(score, key=score.get)
    if abs(m) < 4 or score[m] > 0.8 * score[0]:
        return P
    print(f"  reference shifted by {-m:+d} px over {len(crops)} elements (browser window at shot time): realigned on the capture")
    return P[np.clip(np.arange(len(P)) - m, 0, len(P) - 1)]


P = register(P)
for b in cap["boxes"]:
    kind = "svg" if b.get("img") == "svg" else "image" if b.get("img") else "text" if b.get("text") else None
    if not kind or b["w"] * b["h"] < 64 or b["w"] < 4 or b["h"] < 4 or b["x"] >= W or b["x"] + b["w"] <= 0:
        continue  # off the page (a skip link parked at x -9999) is not drawn
    if b.get("op") == 0:
        continue  # a leaf caught at opacity 0 (a rotating ticker's hidden slide) is not on the page
    y, dy = page_y(b["y"]), drift(b)
    if y < 0 or y + b["h"] > P.shape[0]:
        continue
    kinds[kind] += 1
    x0, x1 = max(0, b["x"]), min(W, b["x"] + b["w"])
    p = P[y : y + b["h"], x0:x1]
    hit = best(p, x0, b["y"] + dy)
    if hit is None:
        issues.append((255, kind, "outside the Figma render", b, p, np.zeros_like(p)))
        continue
    gap, ox, oy, f = hit
    rects = {"image": fig.get("imgs"), "svg": fig.get("vecs"), "text": fig.get("texts")}[kind]
    if kind == "text":
        rects = (rects or []) + (fig.get("unread") or [])  # a text under an instance sublayer the API cannot read is drawn, only unreadable
    cover = kind == "image"
    if kind == "image" and re.search(r"\.svg(\?|$)", b["img"]):
        rects = (rects or []) + (fig.get("vecs") or [])  # an svg file placed as an <img> is imported as vectors (several paths), not as a picture fill
        cover = False
    # the block's drift is not the element's: content that sits lower in its block than the block moved
    # (a taller title above a row) is found at the page position too
    if has_leaves and not any(inside(b, rects or [], d_, cover, kind == "text") for d_ in {dy, 0}):
        # no leaf found, yet both renders agree at that place: nothing shows on the page (a leaf under a
        # panel, faded out, clipped) or the same ink is drawn by another layer; a real miss leaves one side
        # with ink the other lacks, however faint
        ink_p, ink_f = float(p.std()), float(f.std())
        if ink_p < 2.5 or (gap < max(3.0, 0.4 * ink_p) and 0.7 * ink_p <= ink_f <= 1.3 * ink_p):
            unseen_both.append(b)
        else:
            issues.append((300 + gap, kind, "missing from Figma", b, p, f))
    elif kind == "image" and min(p.shape[:2]) >= 24 and unpainted(p, F[b["y"] + dy : b["y"] + dy + b["h"], x0:x1]):  # at the place, not the slid best match (a slid crop lands on the white around a grey slot)
        unpainted_refs.append(b)  # the shot holds the page's grey slot, the picture never painted there: not a build defect
    elif kind == "image" and flat(f) and not flat(p):
        issues.append((250 + gap, kind, "empty in Figma", b, p, f))
    elif kind == "image" and min(p.shape[:2]) >= 24 and (ahash(p) != ahash(f)).sum() > 20 and len(_stack[(b["x"], b["y"], b["w"], b["h"])]) > 1:
        slide_refs.append(b)  # the shot (taken after the capture) shows another slide of the same gallery: not a build defect
    elif kind == "image" and min(p.shape[:2]) >= 24 and (ahash(p) != ahash(f)).sum() > 20:
        issues.append((200 + gap, kind, "other image", b, p, f))
    elif gap > GAP * 2:
        issues.append((100 + gap, kind, "differs", b, p, f))
    elif max(abs(ox), abs(oy)) >= MOVE:
        issues.append((max(abs(ox), abs(oy)), kind, "shifted", b, p, f))
# Reference self-check: page.jpg is the truth only if it shows what was captured. A capture text
# with no ink on the screenshot means the shot is off there (stretched tile, reveal not played).
bad = {}
for b in cap["boxes"]:
    if not b.get("text") or b["w"] * b["h"] < 200:
        continue
    y = page_y(b["y"])
    if 0 <= y and y + b["h"] <= P.shape[0]:
        k = y // 1000
        tot, blank = bad.get(k, (0, 0))
        bad[k] = (tot + 1, blank + flat(P[y : y + b["h"], max(0, b["x"]) : min(W, b["x"] + b["w"])]))
suspect = [k for k, (tot, blank) in sorted(bad.items()) if tot >= 4 and blank >= 0.5 * tot]
for k in suspect[:5]:
    print(f"  suspect reference y {k * 1000}–{k * 1000 + 1000}: {bad[k][1]}/{bad[k][0]} texts without ink on page.jpg")
# elements read in a band the reference does not show (weather card, feed missing from the shot: the
# page changed between capture and shot) are not scored: no verdict on the build from a wrong reference
off = {k for k in suspect}
dropped = [i for i in issues if i[1] != "image" and i[3]["y"] // 1000 in off]
issues = [i for i in issues if i not in dropped]
if dropped:
    print(f"  {len(dropped)} text/svg element(s) dropped from the verdict: read in a slice where page.jpg does not show the captured page (see below)")
# a caption or button laid over a picture the shot does not show (grey lazy slot, another slide) is not judged against that picture
covered = [i for i in issues if i[1] != "image" and any(
    r["x"] - 2 <= i[3]["x"] and i[3]["x"] + i[3]["w"] <= r["x"] + r["w"] + 2 and r["y"] - 2 <= i[3]["y"] and i[3]["y"] + i[3]["h"] <= r["y"] + r["h"] + 2
    for r in unpainted_refs + slide_refs)]
issues = [i for i in issues if i not in covered]
if covered:
    print(f"  {len(covered)} text/svg laid on an image page.jpg does not show (grey box, other slide): dropped from the verdict")
issues.sort(key=lambda i: -i[0])
count = {}
for _, kind, what, *_ in issues:
    count[f"{kind} {what}"] = count.get(f"{kind} {what}", 0) + 1
print(f"element contract: {kinds['image']} image(s), {kinds['svg']} svg, {kinds['text']} text(s) checked" + ("" if has_leaves else " (without the Figma nodes: rerun web-compare)"))
for k, v in sorted(count.items(), key=lambda kv: -kv[1]):
    print(f"  {v} {k}")
for kind_, what_ in (("text", "shifted"), ("text", "differs")):
    ys = [i[3]["y"] // 1000 for i in issues if i[1] == kind_ and i[2] == what_]
    if len(ys) >= 5:
        print(f"  {kind_} {what_} per 1000 px slice: " + " ".join(f"{k * 1000}:{ys.count(k)}" for k in sorted(set(ys))))
if unseen_both:
    print(f"  {len(unseen_both)} element(s) with no layer found but rendered identically on both sides (hidden, faded, clipped): dropped from the check · y " + ", ".join(str(b["y"]) for b in unseen_both[:8]))
if slide_refs:
    print(f"  {len(slide_refs)} image(s) from a slideshow: page.jpg shows another slide than the captured one (rotation between capture and photo), dropped from the check · y " + ", ".join(str(b["y"]) for b in slide_refs[:8]))
if unpainted_refs:
    print(f"  {len(unpainted_refs)} image(s) not painted on page.jpg (lazy grey box, the image is in Figma): dropped from the check, not a build defect · y " + ", ".join(str(b["y"]) for b in unpainted_refs[:8]))
# what is drawn and wrong first: the elements of a part cut from the frame would fill the list
for _, kind, what, b, *_ in sorted(issues, key=lambda i: i[2] == "outside the Figma render")[:12]:
    label = b.get("text", "")[:30] or (b.get("img", "")[:60] if kind == "image" else "")
    print(f"  {kind} {what} · x {b['x']} y {b['y']} {b['w']}×{b['h']} · {where(b['y'] + drift(b), b['y'] + drift(b) + b['h'])} · {label}")

# every issue, for reading past the 12 printed above
json.dump([{"kind": kind, "what": what, "score": round(s, 1), "id": b["id"], "x": b["x"], "y": b["y"], "w": b["w"], "h": b["h"], "label": (b.get("text") or "")[:40], "gap": round(float(np.abs(p.astype(np.int16) - f).mean()), 1), "ink": round(float(p.std()), 1)} for s, kind, what, b, p, f in issues], open(os.path.join(d, "elements.json"), "w"))

# images to place again (web-compare.mjs --fix): their source and their box in Figma coordinates
redo = [{"id": b["id"], "src": b["img"], "x": b["x"], "y": b["y"] + drift(b), "w": b["w"], "h": b["h"]}
        for _, kind, what, b, *_ in issues if kind == "image" and what in ("missing from Figma", "empty in Figma")]
json.dump(redo, open(os.path.join(d, "redo.json"), "w"))

# the worst elements side by side (page | Figma), 240 px high each, to look at before any report
for old in glob.glob(os.path.join(d, "elements-*.jpg")):
    os.remove(old)
crops = [(p, f) for *_, p, f in issues if _[0] >= 100][:24]
if crops:
    rows_ = []
    for p, f in crops:
        k = 240 / max(1, p.shape[0])
        size = (max(1, min(600, round(p.shape[1] * k))), 240)
        a, b = Image.fromarray(p).resize(size), Image.fromarray(f).resize(size)
        row = Image.new("RGB", (1240, 250), (40, 40, 40))
        row.paste(a, (0, 0))
        row.paste(b, (620, 0))
        rows_.append(np.asarray(row))
    Image.fromarray(np.concatenate(rows_)).save(os.path.join(d, "elements-1.jpg"), quality=80)
    print(f"  {os.path.join(d, 'elements-1.jpg')} (page | Figma, worst elements first)")

caught = [b for b in cap["boxes"] if b.get("shot") and b.get("anim")]
for b in caught[:5]:
    print(f"  shot taken mid-animation : x {b['x']} y {b['y']} {b['w']}×{b['h']}")
undecoded = [b for b in cap["boxes"] if b.get("dec") == 0]
if undecoded:
    print(f"  {len(undecoded)} image(s) not decoded when read (risk of an empty box)")

log = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../tests/web/iso.csv")
new = not os.path.exists(log)
with open(log, "a") as fh:
    if new:
        fh.write("date,url,score,blocks_moved,blocks_missing,images,images_bad,svg,svg_bad,texts,texts_bad,ref_suspect\n")
    bad_of = lambda k: sum(1 for i in issues if i[1] == k)
    fh.write(f"{datetime.datetime.now().isoformat(timespec='seconds')},{cap.get('url', '')},{score:.1f},{len(moved)},{len(missing)},{kinds['image']},{bad_of('image')},{kinds['svg']},{bad_of('svg')},{kinds['text']},{bad_of('text')},{len(suspect)}\n")

# page | Figma | gaps in red, block by block, half size, in pieces
canvas = np.concatenate(strips)
for old in glob.glob(os.path.join(d, "compare-*.jpg")):
    os.remove(old)
# (a phone page is narrow: shown at full size, half would make its text unreadable)
S = 1 if W < 800 else 2
img = Image.fromarray(canvas).resize((canvas.shape[1] // S, canvas.shape[0] // S))
n = 0
for top in range(0, img.height, PIECE):
    n += 1
    img.crop((0, top, img.width, min(img.height, top + PIECE))).save(os.path.join(d, f"compare-{n}.jpg"), quality=80)
print(f"  {n} image(s) {os.path.join(d, 'compare-1.jpg')}… (page | Figma | gaps in red, block by block)")

# the overlay, at half width (720 for a 1440 page): enough to see what is not ISO, read before any report
for old in glob.glob(os.path.join(d, "overlay-*.jpg")):
    os.remove(old)
ghost = np.concatenate(ghosts)
img = Image.fromarray(ghost).resize((W // S, ghost.shape[0] // S))
n = 0
for top in range(0, img.height, PIECE):
    n += 1
    img.crop((0, top, img.width, min(img.height, top + PIECE))).save(os.path.join(d, f"overlay-{n}.jpg"), quality=80)
print(f"  {n} image(s) {os.path.join(d, 'overlay-1.jpg')}… (page and Figma overlaid, to reread before any report)")
