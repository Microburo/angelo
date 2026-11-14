# Check blind spots

Solved techniques. Index and rule → [../techniques.md](../techniques.md).

| Page technique | Capture (`web-capture-page.js`) | Build (`web-layout` / `web-build`) |
|---|---|---|
| Animated state stacks left in the DOM | — | guarded by `web-check`: stacked texts, line by line |
| Layout miss only visible once built (flow offset lost, row collapsed onto its neighbour) | — | `web-compare` lists visible Figma texts overlapping by ≥ half of the smaller one, with their node ids |
| SVG image over a text (shimmer sweep, glow) | — | not counted as opaque (`web-check`) |
| One narrow glyph text ("·" separator, 3 px wide) | — | drawn (`web-check` tiny texts: more than one glyph only) |
| Check blind spots (not build defects): text under an instance sublayer the API cannot read, slideshow stacked slides, lazy slot unpainted in the shot, reference carousel reordered or scrolled after the capture | — | `web-compare`: unreadable sublayer → parent box counts as drawn (`unread`), slide set / unpainted / realign ±70 px in `web-compare.py`; a reference desynced from the capture is proved by the best vertical offset (poster found at −346 px, diff 7) and kept out of the issues |
| Several page blocks with the same name | — | the comparator pairs each with the nearest same-named frame, not the first one |
| Fixed widget held below the viewport by a transform: not in the capture, seen only in the taller full-page reference shot, Figma right | — | — |
| Section with a background image over its cards | `web-fix` walks an image frame's children too (was a leaf: its cards never paired) | 58/58 paired |
| Button / form field text paired with its control box (padding 20 read as a 20 px shift; `web-fix` padded the parent and moved the footer) | a text box with padding or border is its content box; one line centred in an input/select | no false shift |
| Icon frame 24×24 around a 21×24 drawing paired by the drawing | a bare group under a frame is the drawing: the frame is the leaf; an `<img>` of an `.svg` file pairs with vectors | icons paired |
