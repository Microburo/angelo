# Images, svg, canvas, video, icons

Solved techniques. Index and rule → [../techniques.md](../techniques.md).

| Page technique | Capture (`web-capture-page.js`) | Build (`web-layout` / `web-build`) |
|---|---|---|
| `<canvas>` / WebGL (globe, particles, animated mesh gradients; `toDataURL` blank) | page hidden except its canvases, shot as a transparent PNG (CDP background alpha 0), cropped per canvas into data URLs | image fill |
| `<video>` (looping product animations; no markup, cross-origin frames) | `canvas: 1`, shot with the canvases (isolate shows `canvas, video`) | image fill of the frame on screen |
| Media wider than its clipping band (3008 px hero centred in 1440 px) | `img` / `video` / `canvas` cropped to the clip whatever share shows, never dropped | image fill `FILL` (centred crop) |
| Data-URL images (`src="data:…"`, canvas crops) | kept as is | bytes written directly, no download |
| Same-origin images refused to `curl` (bot wall, 403 + ~11 KB HTML, `sips` fails, image skipped) | read in the page (`fetch`, credentials) and inlined as data URLs (`__angeloInlineImages`, 4 MB / file, 24 MB total); cross-origin stays a URL (opaque fetch) | data URLs decoded, no download |
| SVG stroke width | `stroke-width`, caps, joins | written with the stroke colour on the svg (default width 1 made a filled glyph bolder) |
| SVG painted by CSS (`fill="none"` on the root, colour from a stylesheet) | computed `fill` / `stroke` inlined on a clone of each shape | vector import |
| SVG sprite `<use href="#id">` | symbol markup inlined | vector import |
| SVG `currentColor`, rgba alpha, CSS custom properties | resolved at capture, alpha → node opacity | — |
| Long SVG (chart of hundreds of dots) | whitespace between tags and long decimals dropped, markup kept up to 400 KB | vector import; guarded by `web-check`: no svg captured without its markup |
| Player painted late (video-embed background iframe): shot flat, or cut to the oversized embed | shot clipped to the overflow-hidden ancestors, asked again up to 4 times while flat (standard deviation ≤ 10); reference tiles wait 1.8 s with a player in view (an empty card in `page.jpg` scores the right Figma as wrong) | shot of the clipped rect |
| Image cropped by `object-fit` / `object-position` | crop rect | raster `CROP` scaleMode, SVG in a clipping frame |
| Heavy images (carousel frames of 200–400 KB) | — | fetched by the plugin from the bridge `/img` route, never base64 in the RPC |
| Image cropped by `overflow: hidden` merged as its frame's background | `crop` | the cover's `crop` follows it onto the frame fill |
| Instances of one main showing different pictures, svgs among them (logos beside a photo) | — | main left empty, each svg an overlay beside its instance, held back until the last lot so every slot is known (`mixedMains`) |
| Inline svg background with escaped quotes (`url("data:image/svg+xml;utf8,<svg xmlns=\"…`) | — | url read past the escaped quotes then unescaped (`web-items`), cut at the first one it made an invalid svg |
| Image wider or taller than 4096 px | — | `fetchImages` scales it to 4096 px a side (`createImage` refuses "Image is too large") |
| Icons drawn by a CSS mask (`mask-image: url(svg)` over a coloured box) | `__angeloMaskIcons`: the mask svg fetched, filled with the box colour (viewBox added when missing); inline svg data url read with its escaped quotes | svg node |
| Logo fitted in its box (`object-fit: contain / scale-down`, another ratio) | box shrunk to the painted part (`object-position`) | image fills that box |
| Image that cannot be had (percent-encoded svg data url, text shimmer `blend: screen` over a text label) | slot left without its grey placeholder (`drop` in `placeImages`): what is under it shows | — |
| Image CSS filter (`brightness(1.4) saturate(0.25)`) | `fx` {exposure = log2(brightness), saturation, contrast}, −1…1 | pluginData `fx` → the image fill's `filters` |
| `object-fit: contain` image cut by its card | fitted in the whole box before the clip, then cropped | — |
| `object-fit: cover` off centre (`object-position: left top`) | `crop` = where the whole image sits (Figma FILL covers from the centre) | — |
| Percent-encoded data-URL svg (`data:image/svg+xml,%3Csvg…`) | decoded before `createNodeFromSvg` | an svg Figma cannot parse is skipped, not fatal |
| `url()` holding quotes or parentheses | quote-aware extraction | — |
| CDN refusing the `Mozilla/5.0` UA for images | retried with curl's default UA | — |
| Zero-width canvas | ignored at capture | — |
| Icon drawn as a CSS `mask-image` on a shadow `img` (the host has the background, the mask is on the child) | mask read on the shadow child too; svg fetched and filled with the box colour | arrows / pause icons instead of white squares |
| Image slots filled out of order making the live cursor bounce | each batch sorted top to bottom, cursor awaited before the next move and clamped to the frame | cursor goes down the page |
| `<video>` blank at capture (betamax canvas, no poster) under a stacked end-slate canvas | `web-audit.py --fill` takes the page shot for a blank video with no image box over it (poster guard) | `web-items.mjs`: the grey placeholder of a hidden canvas is skipped when another image box has the same rect |
| Svg mask built on a filter (inverted luminance): Figma's import drops the filter, the mask turns black and hides the shape | mask removed, drawing kept whole (a knocked-out count would be lost) | — |
| Svg viewBox of another ratio than its box (24×24 chevron in 35×19): browser fits it, Figma's resize stretches it | viewBox grown to the box's ratio, width and height set to the box | — |
| `background-size: auto` on an svg background | — | drawn at the svg's own size, not stretched to the box |
| Svg with decimal sizes | decimals kept, a rounded viewBox shifts the drawing | — |
| Svg root carrying a fill | — | cleared at build, otherwise it paints a rectangle behind the drawing |
| Lottie svg captured as an empty fragment: a `<use>` whose target is inside the svg itself (its own `<defs>`, masks, `__lottie_element_N`) is drawing, not a sprite; the sprite path replaced the whole svg by an empty fragment (160–500 chars instead of 14–262 KB) | no sprite swap; `display:none` layers without id removed; `__angeloLottieSample` keeps for 3 s the frame with most painted shapes, put back by `__angeloLottiePut` before the capture (+3 s of preparation) | — |
| `.svg` from a CDN gzipping whatever is asked (some CDNs) | `curl --compressed` before the `<svg` check, otherwise `sips` crashes (image skipped) | — |
| Icon painted by `mask-image: url(svg)` on a pseudo-element with a flat fill | `maskIcon` on the pseudo box, as on an element: svg tinted with the fill, otherwise a full rectangle | — |
| Native checkbox or radio: nothing in the DOM to draw | drawn as `b.svg` by the capture | control visible |
| Video shot through the isolated screenshot on a page without a scrollbar | `scrollbar-gutter: stable` forced only when the page has a gutter (else the layout narrows, a 16/9 video loses 15 px, a black band) | frame edge to edge |
| Svg root sized in % (`width="100%" height="40"`) | the capture rewrites the root's % sizes to the box's px (Figma reads % as px) | icon not squashed |
| Mask-image icon whose svg root has `fill="none"` (outline icon) | root fill/stroke recoloured like its children, `none` kept (else drawn as a filled blob) | outline icon |
| Svg `<img>` with `invert(1) brightness(2)` | `fx.invert` applied before the exposure on each paint (`web-place`) | black logo shown white |
| Svg turned a quarter (`rotate(90deg)`, vertical side text) | the viewBox fit is made against the box turned back, and the viewBox turns with the drawing (`web-capture-page`) | vertical text, not a 1 px line |
| Sprite `<use>` whose `<symbol fill="none">` draws strokes only | the symbol's own paint attributes win over the inherited fill (`web-capture-page`) | outline icon, not a filled blob |
| Centred `object-fit: cover` image cut by its clip (footer terrain 1440×192, 19 px shown) | the painted rect is kept as the crop even when centred (`web-capture-page`) | the strip's top shows, not its middle |
