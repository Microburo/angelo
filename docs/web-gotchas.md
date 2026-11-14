# Angelo — web-to-figma, gotchas

A solved page technique (capture + build) goes to the catalogue `skill/web-to-figma/techniques.md`. This page covers the pipeline, Figma, and design decisions.

## Files and reference

- `page.jpg` / `figma.jpg` / `compare-*.jpg` / `overlay-*.jpg` / `elements-*.jpg` / `redo.json` / `figma.json` / `first.json` in `tests/web/<case>/` are not versioned (never committed)
- A reference `page.jpg` truncated at 2900 px means the bottom is unchecked: redo the full-page capture before judging
- `page.jpg` taken with `captureBeyondViewport`: the scrollbar disappears, the layout widens by ~15 px and full-width images with a fixed ratio grow (linear drift, +220 px at 25,000) → `scrollbar-gutter: stable` during that shot (does not touch the alpha canvas shot)
- `page.jpg` (extension) shifted as a block by ~11–14 px relative to the capture on a page using `vh` (example.com: `padding: 25vh`), cause not found (`stripShot` already waits for `innerHeight ≥ vh`) → `web-compare.py` `register()` looks for a single offset across all sheets (sum of gaps, ±2×SLIDE) and realigns the shot if ≥ 4 px and clearly better; a per-sheet vote fails (multi-line texts are ambiguous by ± their line height)

## Components

- Masters live on the "Components" page, created if missing · buttons = one `Button` set (Style × Size)
- Fewest components possible (`web-layout.mjs`): repeated ≥ 2 = component · seen once = component if nav, header, footer, filters, search bar (`landmark`: tag or block name, the top nav = `Navigation`, others `Subnav`), **menu / sub-menu** (role menu, or ≥ 4 leaves under a submenu / dropdown / megamenu block), **card** (recognised as `Card` by the grammar) · a **section heading** (2–6 leaves, texts + buttons, contains an h1–h6, no background) = one family whatever its parts, a component only if the page repeats it · page level definitions: `grammar/page.json` (added to `index.md` by `kit-grammar.mjs`) · atomic levels: atom (icon, button, badge) → molecule (card, heading, menu) → organism (header, footer, nav); an organism contains **instances** of its atoms and molecules (`nest`) · a media card = 1 component, axis `Width=Wide/Narrow` (2 widths with ≥ 2 occurrences, ratio ≥ 1.25), booleans per group `Badge`, `Text + price` (or `Text`), `Icon` · a struck-through price is merged into the price text, no layer or boolean · `web-check`: key `comps` of `expect.json`
- Merging two card looks: only with the same families and weights · a guard in the code, not a hand-reviewed list · a shared section or image ratio are rejected: they wrongly split genuinely identical cards · limit: a site with a single font (cards joined wrongly)
- web-layout: a leaf layer's `sig` includes its fixed size (Figma ignores `resize` on an instance sublayer → one variant per size) · top / bottom padding never below the block's CSS (overflowing content = negative or wrong measure)
- An instance slot in Figma: any write renews the node and its content (new ids, "node … does not exist")
- Instance sublayer: `x`, `relativeTransform`, `layoutPositioning` are refused as overrides ("cannot be overridden in an instance") → edit the main component · a line-clamped card title (Grid): 3 hidden siblings carry the same text → patch the visible one and keep the others consistent
- The text of an instance placed in an instance slot: unreadable through the API (`does not exist`), PNG export works · likewise a synchronous `mainComponent` that throws: do not read it as a dead node
- Slots: a row of atoms whose list varies between occurrences, inside an organism only (landmark, kit `organism` level, or a block outside the kit with more than 4 leaves) · identical list everywhere, or never more than one atom = no slot · atoms and molecules = variants · a row with gap 0 or 1 = same family (sub-pixel rounding), beyond that the gap separates (otherwise false slots)
- Spacing of a vertical stack: the page has its padding at the bottom with gap 0; sections have their padding-bottom with gap 0; sub-sections have no padding-bottom and a gap of X; an element that needs more takes its own padding-bottom · `stackGap` of `web-layout.mjs`: gap = mean of the gaps close to the smallest one, the rest goes into padding-bottom; fewer than half of the gaps close = padding-bottom only; `-wrap` if the child cannot carry it · a FIXED frame whose content gives its size to within 1 px → HUG (`hugFitting`): 8 % of FIXED frames, the rest follows a grid, a fill or a `space-between`
- `node tools/web-rename.mjs [case…] [--keep "<name>"…] [--apply]`: current pipeline names on masters already in Figma, no rebuild · matched by `fdslSig`, otherwise `fdslFam` if a single master remains, size within 2 px in both cases · `--keep`: a proposal judged wrong, left alone · without `--apply` nothing is written · masters from an older layout have a different signature and no match
- Figma refuses `swapComponent` to a variant of the set that contains the ancestor instance ("would create a cycle"): `layoutTree` gives a block nested inside its own family a family of its own (`own`), `web-build` ignores a master found in another family of the page (e.g. an image wrapper inside a card wrapper)
- Cleaning the components page: dead = a master not reachable from the instances of Page 1 through nested masters, cross-checked with `getInstancesAsync` (ghosts ignored) · a following build recreates whatever was removed
- Components found per site: the search is limited to the `fdslSite` board of the components page, otherwise a variant from another site is picked
- `kindOf`: no Footer taller than the viewport (a product grid can look like one)

## Figma build

- An exec > 30 s times out → `web-build` adapts its batches (~10 s each, based on the previous batch) and empties a `--root` root before building
- **Progressive display** (every build, variants included): the root frame is placed empty ≤ 1 s before any other step (`stagePage`; a frame of the same name already there is left intact until a capture exists, the build empties it: a cancelled or failed capture keeps the page), first block ≤ 3 s, then block by block in reading order, images as they come (batches of 10, at most one cursor glide ≤ 230 ms per second; a page of 1,008 nodes + 106 images: 2 min 10 → 15 s) → `figma-structured-build` § Progressive display
- Page root: width FIXED, height HUG (only if auto-layout, guard `layoutMode !== "NONE"`), `clipsContent`, radius 16
- Exec: `H.byId` on an instance sublayer id (`I…;…`) and `getInstancesAsync` load everything ("Unable to establish connection") → descend from the root
- HUG text: Figma rounds up to the next pixel (a label 43 → 44, a button 94 for 93, neighbours shifted by 1 px), not corrected in the pipeline; patch the instance if needed (padding 24.5)
- Pasted URL: trailing punctuation is stripped (`…/collections.` would build a 404)
- `setPluginData` ≤ 100 kB per entry (the spec of a master full of svgs is split over `fdslSpec`, `fdslSpec1`…)
- Plugin-data keys `fdslSite` `fdslSig` `fdslFam` `fdslSpec` `fdslLate` keep their original names: they are already written into existing Figma files, renaming them would orphan boards and components

## Capture

- `-apple-system` falling back to Inter: the `SYSTEM_FONTS` mapping of `web-build` is not run by a build, so frames are switched to SF Pro by `web-font-swap`
- Vertical text: `font.rot` (CSS clockwise degrees, ±90/180, from writing-mode + ancestors' transform + `rotate`) → 1 text, `HUG`, `rotation = -rot` · `rot` is part of the text signature
- Pseudo-element in hover state (`::before` filled, `translate: 0px 100%`): individual `translate` / `scale` / `rotate` composed before `transform` in the pseudo's matrix
- A text's `mix-blend-mode` → the layer's `blendMode` (`blendOf`), part of the text signature (a white label in `difference` is invisible without it)
- Virtualized list: preparation scroll frame by frame → catalogue `capture.md` · an area shot (`__angeloFrameShots`) waits for images to be loaded, decoded and still (3 s max)
- `__angeloFrameShots`: a "blind" block is discarded if text covers it by more than 2 % (a vertical "New" badge = 1.5 %) · the Angelo panel may reappear (45 s timer) and be photographed inside a card: hide it while shooting
- Grey cards: cause = images put back by the preparation stay at `opacity: 0` (the page's fade does not replay) and the capture skips what paints nothing → `__angeloShow` forces image + chain visible up to the restored node · blind block = **URL before pixels**: an `<img>` already in the block whatever its state (`dom`) → scroll + wait for mount (`mount`) → the page's inline data (`__NEXT_DATA__`, script JSON) through the block's link: path, last segment, final numeric id → the smallest record that carries it, `primary*` field first, query (`?imwidth=`) taken from a sibling image on the same CDN (`data`) → shot (`shot`) · counters in `prep.shots` · headless (hover emulated): 30/30 cards with an image from the capture, `data` 9/9 when any mount is prevented (~4 s per block)
- Inner scroller (content scrolls inside a container, page 1128 px): released at capture, heights frozen in px along its chain and children, restored afterwards (`__angeloRelock`) · a height in % or `vh` left free blows the root up (941,152 px)
- Virtualized grid (rows stacked as `absolute`): rows pinned across the full width without overlap → flow column, no more pin · a row gap stays fractional as soon as rounding loses ≥ 1 px on the row (32.5) · multi-layer `box-shadow`: `shadow.more` · a single line's line height is rounded (22, not 21.6)
- `tools/web-run.mjs`: the code is embedded in a template string sent to the exec → no backtick, even in a comment (esbuild: `Expected ";"`)
- `Components · <site>` frame: after deleting a page, its masters remain (no instance outside the frame) · carousels without `clipsContent` overflow by up to +1191 px and cover neighbouring masters · cleanup = remove masters whose live instances are all inside the removed set (fixed point), `getInstancesAsync` per master

## Comparator

- The "text / image absent from Figma" contract can give false positives (the path of a Lottie group above, `text-transform` uppercase vs the source text) · verify with `findAll` TEXT before fixing
- A `display:contents` box (0×0 at y0) and descendants pinned outside a block's extent · a Figma block taller by the gap up to the next block, same y = rhythm through padding-bottom, not a displacement
