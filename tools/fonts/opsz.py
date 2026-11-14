# Pin the optical size axis of a variable font: one font file per opsz value, its own family
# ("<Family> opsz<v>") with the other axes and the named styles kept. Browsers set opsz to the
# font size (font-optical-sizing: auto); Figma keeps the axis default and its plugin API cannot
# change it, so each size gets a font where the axis is already at the browser's value.
#
# Usage: python opsz.py axis <font>                     → JSON {min, default, max} or null
#        python opsz.py pin <font> <out dir> <v> [<v>…]  → JSON {v: file} (cached on disk)
import json
import os
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer


def axis(font):
    if "fvar" not in font:
        return None
    for a in font["fvar"].axes:
        if a.axisTag == "opsz":
            return {"min": a.minValue, "default": a.defaultValue, "max": a.maxValue}
    return None


def pin(src, out_dir, value):
    base = os.path.splitext(os.path.basename(src))[0]
    out = os.path.join(out_dir, f"{base}-opsz{value:g}.ttf")
    if os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(src):
        return out
    font = TTFont(src)
    # named styles sit at one opsz value: moved to the pinned one so the instancer keeps them
    for inst in font["fvar"].instances:
        inst.coordinates["opsz"] = value
        inst.postscriptNameID = 0xFFFF
    font = instancer.instantiateVariableFont(font, {"opsz": value})
    name = font["name"]
    fam = name.getDebugName(16) or name.getDebugName(1)
    new = f"{fam} opsz{value:g}"
    ps = new.replace(" ", "")
    style = name.getDebugName(17) or name.getDebugName(2) or "Regular"
    for rec in list(name.names):
        if rec.nameID in (1, 16):
            name.setName(new, rec.nameID, rec.platformID, rec.platEncID, rec.langID)
        elif rec.nameID == 4:
            name.setName(f"{new} {style}" if style != "Regular" else new, 4, rec.platformID, rec.platEncID, rec.langID)
        elif rec.nameID in (6, 25):
            name.setName(ps if rec.nameID == 25 else f"{ps}-{style.replace(' ', '')}", rec.nameID, rec.platformID, rec.platEncID, rec.langID)
        elif rec.nameID == 3:
            name.setName(f"{ps};{style}", 3, rec.platformID, rec.platEncID, rec.langID)
    font.save(out)
    return out


def main():
    mode, src = sys.argv[1], sys.argv[2]
    if mode == "axis":
        print(json.dumps(axis(TTFont(src))))
        return
    out_dir = sys.argv[3]
    os.makedirs(out_dir, exist_ok=True)
    print(json.dumps({v: pin(src, out_dir, float(v)) for v in sys.argv[4:]}))


main()
