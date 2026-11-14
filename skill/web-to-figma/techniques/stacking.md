# Stacking, opacity, covers

Solved techniques. Index and rule → [../techniques.md](../techniques.md).

| Page technique | Capture (`web-capture-page.js`) | Build (`web-layout` / `web-build`) |
|---|---|---|
| `position: absolute / fixed` | `pin: 1` | out of the flow, absolute child of its parent |
| `z-index` on positioned siblings (layer before text in DOM, painted under it) | `z` on positioned boxes | children sorted by `z`, DOM order within a level, flow order kept |
| `z-index` on static flex / grid items | `z` also read when the parent is flex or grid | same sort |
| Flow item painted above later flow items (sticky header over the hero) | `z` | flow order kept, `itemReverseZIndex` (first child on top) when the reversed z order keeps the flow |
| `z-index` escaping a non-stacking parent (cousins, not siblings) | `z` on the inner box | parent ranked by the escaping z, counted only where that content overlaps a sibling, just under an equal explicit z |
| Stacking context without a z-index of its own (`z-index: 0`, transform, opacity, filter, isolation, will-change, mask, clip-path, contain, fixed / sticky) | `sc: 1` | the z-index of its content stops there (blurred z 3 blobs stay under the cards beside them) |
| Opacity on nested boxes | `op` cumulative (flat build) | converted to relative to the parent in the tree, else multiplied at each Figma level |
| `filter: blur()` | `fblur`, scaled by the transform | layer blur (not counted as covering) |
| Paint layer clipped by an `overflow: hidden` ancestor | cropped to the clip at capture | — (structured build never clips) |
| Fixed overlays nested off the page spine (cookie banner, chat launcher) | `kind: "overlay"` blocks | excluded unless picked in the extension |
| Pinned background layer (canvas, scrim) before the flow | DOM order (box id) | moved under the flow |
| Leaf covering its parent (bg div, cover image) | — | becomes the parent's fill; gradient scrims stack on it |
| Bordered panel drawn as a sibling of its content | — | the rect adopts the siblings it surrounds |
| Positioned `::before` / `::after` (absolute shine, z-indexed base layer) | `pin` / `z` on the pseudo box, like any positioned box | painted with the positioned layers, not under the flow |
| Several pinned layers painted under the flow | DOM order (box id) | kept in DOM order among themselves |
| Bordered rect around siblings, with a sibling painted between them over it | — | no adoption (it would lift the held layers over the one between) |
| Faint layer escaping its parent with a z-index (grain, glow: no text, no opaque fill, or opacity < 0.5) | `z`, `op` | ranks nothing: its parent's opaque panel stays under the sibling |
| Text the page itself hides under a later layer (chat panel over a board, code panel over a list) | `hid`: hit-test at the middle of its first line, scrolled into view; only a painting cover counts, never fixed / sticky | kept covered (`web-check` excuses it) |
| Texture over a panel (grain, noise: `mix-blend-mode: overlay`, `background-size: 256px` repeated) | `blend` (any mode but normal), `tile` (px background size, repeated) | layer `blendMode`, image `TILE` at `tile / natural width` (width read from the bytes); a blended leaf never becomes its parent's fill; guarded by `web-check`: no translucent texture without blend over texts |
| Absolute layers at z auto overlapping (a board pushed out of the flow, a chat panel pinned over it) | `pin` / `sc`, DOM order (box id) | CSS paint order: flow boxes first, then positioned / stacking-context ones, DOM order within each; the under-layer bound counts flow items laid out absolute; guarded by `web-check`: no flow block painted over a positioned layer |
| Shimmer sweep parked at rest (pseudo image, `no-repeat`, px `background-size`, animated position) | painted only over its background rect, cropped to the box and the clip; nothing left → dropped | — |
| Transformed / blurred pseudo (glow centred on a corner by `translate(-50%, -50%)`, `filter: blur(80px)`) | transform applied about its origin, `fblur` scaled with it | layer blur; guarded by `web-check`: no sharp round faint fill |
| Gradient stops to `transparent` (fade to the page colour) | stops premultiplied (transparent takes the neighbour's colour at alpha 0) | — |
| Edge fade over a strip (`::before` with `z-index: 1` covering the frame) | `z` | a cover with `z > 0` stays a layer above the content, never the frame's fill |
| Covering layer drawn over a sibling (card UI image over the card's own panel) | — | a covering leaf becomes its frame's fill only when it is the bottom-most painted layer |
| Negative z escaping a box without stacking context (hero photo z -1, its title z 1, a card z -1 beside) | `z` | positioned negative layers move up beside their box, before it; DOM order within the level (photo, card, title) |
| Progress fill parked at zero: a pseudo-element painting one `no-repeat` image at `background-size: 0px 100%` (tab autoplay bar) | the painted rect is the background size, px or % of the box; empty → no box | — |
| Positioned backdrop painting over a sibling (hero image under the header) | — | z-order overlap measured on the sibling's painted extent (its kids included) |
| Faded tint layers over a photo (screen span op 0.42, multiply op 0.8) | — | a faded rect never adopts its siblings (its opacity would fade the card's text); a blended one still does (multiply badge behind its label) |
| Section whose full-width pinned background (z < 0, a 100vh video poster) hangs below it, the next section painting over it | the section clips (`hangs` in `buildTree`), the pinned child keeps its size | no band of poster under the hero |
| Dotted rule drawn by a repeated gradient (`linear-gradient(to right, #222 10%, transparent 10%)`, `background-size: 8px 1px`, bottom, centred) | drawn as a dashed Figma line (`dashPattern [dot, gap]`, started at the first dot, in a 1 px clipping frame; a strip of one hard stop per dot lost its dots to gradient sampling) at the box bottom (`dotRule`, size/position captured as `tileH`/`tileY`/`tileX`), carried by a synthetic child box `id + 0.5` (an item sharing the cell's id merges onto the cell frame and paints its full height); stretched over the box it painted a black bar | black bars in the table, then no rule, then full-height bars every 8 px |
| Chevron / arrow drawn by a CSS box (`::before` 10×10, two borders, `rotate: 45deg` or `transform: rotate(45deg)`) | the capture keeps the box's own size, its centre moved by the matrix, and `rot` (deg, CSS clockwise); the build rotates it about its centre (`relativeTransform` when pinned, `rotation = -rot` in flow); `rot` is part of the box signature | chevrons instead of square corners |
| `box-shadow: inset` used as an accent bar | layer kept with `inset:1`, `fx` emits `INNER_SHADOW` | accent not lost |
| Border with one side of another colour | the odd side becomes an inset layer (`oddSides`) | the other sides stay one stroke |
