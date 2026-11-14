# Give a web font with an obfuscated name table (empty family, "Font" for every file) the names the
# page's @font-face states, so Figma can list it. Rewrites the file in place.
#
# Usage: python rename.py <font> <family> <style>   (style: "Regular", "Semi Bold", "Bold Italic"…)
import sys

from fontTools.ttLib import TTFont

src, family, style = sys.argv[1:4]
font = TTFont(src)
name = font["name"]
name.names = []
plain = style in ("Regular", "Bold", "Italic", "Bold Italic")
ps = f"{family}-{style}".replace(" ", "")
values = {
    1: family if plain else f"{family} {style}",
    2: style if plain else "Regular",
    3: f"{ps};angelo",
    4: f"{family} {style}",
    6: ps,
    16: family,
    17: style,
}
for nid, v in values.items():
    name.setName(v, nid, 3, 1, 0x409)
    name.setName(v, nid, 1, 0, 0)
font.save(src)
