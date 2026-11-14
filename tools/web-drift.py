#!/usr/bin/env python3
"""Vertical drift between capture.json texts/images and figma.json (written by web-compare).

Usage: python3 tools/web-drift.py <case dir> [--all]
Matches each captured text to the Figma text with the same x (+-3 px) and the nearest y,
then prints dy along the page: only lines where dy changes, unless --all.
"""
import json
import sys
from pathlib import Path


def main():
    case = Path(sys.argv[1])
    show_all = "--all" in sys.argv
    cap = json.loads((case / "capture.json").read_text())
    fig = json.loads((case / "figma.json").read_text())
    texts = sorted(
        (b for b in cap["boxes"] if b.get("text")),
        key=lambda b: (b["y"], b["x"]),
    )
    pool = [list(t) for t in fig["texts"]]
    used = set()
    last = None
    for b in texts:
        best, bd = None, 1e9
        for i, (x, y, w, h) in enumerate(pool):
            if i in used or abs(x - b["x"]) > 3:
                continue
            d = abs(y - b["y"])
            if d < bd:
                best, bd = i, d
        if best is None or bd > 120:
            print(f"y{b['y']:>6} x{b['x']:>4}  ----  no match  {b['text'][:40]!r}")
            continue
        used.add(best)
        dy = pool[best][1] - b["y"]
        dh = pool[best][3] - b["h"]
        if show_all or dy != last or dh:
            print(f"y{b['y']:>6} x{b['x']:>4}  dy {dy:+4}  dh {dh:+3}  {b['text'][:40]!r}")
        last = dy


if __name__ == "__main__":
    main()
