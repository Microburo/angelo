# Flow, sizing, clip, overflow

Solved techniques. Index and rule → [../techniques.md](../techniques.md).

| Page technique | Capture (`web-capture-page.js`) | Build (`web-layout` / `web-build`) |
|---|---|---|
| Header that follows a resize | `flex-grow` → `fg` | the growing row item is FILL even with uneven gaps; the gap carried as padding widens its `w` so the width guard keeps FILL |
| Flow item moved by a `transform` beside absolute siblings (a list row drawn below a pinned list) | box at its transformed position | a synthetic group keeps the geometric offset of its flow as padding (its bounds include the pinned layers) |
| `display: contents` / zero-size wrapper | box size 0 | takes its children's bounds |
| Content overflowing its box (divider in a margin) | — | non-drawing frame grows to hold it |
| `justify-content: space-between` | `flex` | `SPACE_BETWEEN` |
| CSS padding vs measured gap | `pad` | vertical padding never under the CSS value |
| Separator line (`::before` with `border-top`, 1 px div, `hr`) | a box ≤ 2 px thick | stroke, not a rectangle (`dividersToStrokes`): full length on a frame edge → that side's stroke; between two blocks → bottom stroke of the unpainted block above, which grows down to it (pb from geometry); a layer only when inset, outside its parent, decorated or clashing with an existing border colour |
| Bordered box (outline button) | `pad` measured from the border box | `strokesIncludedInLayout = false` (Figma's default adds the border again) |
| Sub-pixel line box (padding 15.5 / 16.5 around a 16 px CSS padding) | `pad` | vertical padding within 1 px of the CSS value takes the CSS value |
| Slides parked off-screen (carousel at x −694 → 2135) | boxes at their real position | a non-drawing frame grows only within the page sides, a synthetic group within its parent's; slides past them stay absolute layers; guarded by `web-check`: no flow frame past the page sides |
| Flow item past the page sides (board column cut by the viewport, panel bleeding off the left) | box at its real position | absolute layer with its real offset (laid out from the parent's side otherwise); guarded by `web-check`: no flow frame past the page sides |
| Mask (`mask-image`) on an element | clips its content to its border box, like overflow | guarded by `web-check`: no painted leaf past a masked ancestor |
| `overflow: hidden` card with content past its edges (1200 px logo in a 480 px card) | `clip: 1` | frame keeps its own bounds, `clipsContent`; guarded by `web-check`: no content past an overflow box built unclipped |
| Absolute child in a frame padded by a row offset (link arrow) | — | `padSide` shifts absolute children with the padding |
| Carousel track wider than the page in an `overflow: hidden` wrapper with one child | `clip: 1` | the clipping wrapper keeps its frame (never collapsed into its single child); guarded by `web-check`: a flow frame past the page sides is fine under a clipping frame |
| Row of 3+ children with uneven gaps filling its box, no `justify: space-between` (logo · nav · buttons pushed by `margin-left: auto`) | `flex.justify` | measured gaps (`padSide`), `SPACE_BETWEEN` only for 2 children or CSS space-between |
| Row wider than its clipping box (tab row scrolled inside a mask) | — | keeps its width (never `FILL`), centred when it overflows both sides |
| Content overflowing both sides of a fixed-height box alike (22 px line centred in a 42 px bordered pill) | the box keeps its measured height (`sh FIXED`), the CSS padding no longer grows it by the overflow | — |
| Clipping box its flow overflows below (600 px mockup in a 532 px card) | — | keeps its height (`sh FIXED`), hugging pushed the page down |
| Positioned layer past its parent's edges (icon pinned 64 px above its block) | — | takes no room: a non-drawing box grows only with its in-flow children |
| Pill drawn by a shadow-internal wrapper (`<p-tag>`, `<p-button>`) | paint (bg, border, radius, shadow, backdrop) of the shadow element covering the host | — |
| Rounded card clipping its picture (`overflow:hidden` + radius, children inside) | `clip` + `r` | clips when `r > 0`, not only on overflow |
| Web components with a shadow root (`<p-header>`, `<p-link-tile>`, `<p-icon>`…) | capture walks `shadowRoot.children`, slots flattened to their assigned elements; a shadow wrapper already used as the host's paint is walked through, not drawn twice | header, scrim, tile titles captured (567 boxes instead of 248) |
| Rounded clipper wrapping a single same-size frame (`p-link-tile` r 24 > `div` > `img`) | the radius moves with the clip when `collapse` merges the two | tile images rounded |
| Rounded clipper that draws nothing | keeps its radius on the clipping frame | cards' pictures rounded |
| Rounded clipper (`figure` r 14) followed by a caption: the gap below carried as its padding-bottom | a rounded clipper takes the gap on a wrap (`plain` refuses it), the frame stays the picture's height | square bottom corners on the cards, rounded ones on the empty 24 px |
| `display: contents` parent with a background (0×0 rect) | background moved to the visible children | — |
| Absolute child covering its whole parent; content overflowing the box | — | moved back to flow; the box's own padding still applies |
| Pill (CSS radius 999 / 9999, or ≥ half the height) on a box that auto-layout resizes (HUG: 40 → 44 high) | — | radius capped at build time to half the *capture* height, so the pill goes square-ish after the resize; now "full" (r ≥ min(w,h)/2 − 1) is written as 999, Figma keeps it a pill at any size (`corners()` and the patch path in `web-run.mjs`) |
| Negative margin / pinned header putting an unpainted flow child above its parent while its own padding brings the content back (-24 px section top, tab list pinned 56 px up) | — | synthetic groups and plain children cut at the parent's top in `arrange()` (content untouched): no extra offset in Figma, which has no negative padding |
| Gradient scrim over a picture (no paint of its own spilling past its parent) | — | `spills` rule in `web-layout.mjs`: the scrim stays absolute over the picture instead of becoming a flow child |
| Clipping box overhanging its parent's top | — | `over` rule: the box becomes absolute (negative padding does not exist in Figma) |
| Lone child overflowing its parent evenly on both sides | — | `centred()` helper: justify CENTER on the parent, no padding |
| Pad pair (left + right) of a HUG frame whose geometry sums to a rounded value | — | `arrange()` keeps the rounded sum: the right pad is recomputed from `geo` so the HUG width equals the capture |
| Section overlapping the next by 1-2 px | — | `padSide` takes it off the padding-bottom, or sets FIXED height reduced by the overlap when the padding is too small |
| Columns whose tops sit within 5 % of the row height (`sameTop`) | — | MIN alignment plus top padding (`offs`), not MAX: columns without paint end 8 px higher and 9 px taller, accepted |
