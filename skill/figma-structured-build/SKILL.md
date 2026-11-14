---
name: figma-structured-build
description: Build any design in Figma through the Angelo bridge as a structured file — full auto layout, repeated elements as few components, Lucide icons, page / section / sub-section vertical rhythm, bound color variables, live cursor. Use for every Figma creation by script (page rebuild, mockup, screen), before writing the exec code.
---

# Figma structured build

Applies to every Figma design built by script, web rebuilds included.

Checks and adaptation, in the exec helpers:

- `await H.lint(node?, { rule, limit })` measures a build's components against these rules (selection or page by default): `{ ms, clean, errors, byRule, issues }`. `npm run web-lint` runs the same rules on frozen captures, without Figma
- `await H.brand()` reads the file's own colors, text styles and grids; `await H.adapt(node, { dry: true })` reports what a frame from elsewhere would take from them, `H.adapt(node, { grid: false })` applies. `npm run adapt-check` tests the matching without Figma
- `node tools/web-rename.mjs [case…]` reports the names today's pipeline gives components already in Figma, `--apply` renames them in place, nothing rebuilt

## Rules

- Everything in auto layout, 0 absolute child
- Fewest components and variants, but every element repeated twice is a component: repeated ≥ 2 → component; met once → component only for a nav, header, footer, filter bar or search bar; a media card = 1 component, 1 variant axis Width (size is a variant), 1 boolean per group (badge, text + price, "+"), its badge a nested component
- Components as simple as possible (fewest nesting levels, atom → molecule → organism, instances wherever possible): an atom = the box itself carrying its paint, padding and gap, its text and icon direct children (never variant > group > inner box > text); a molecule = instances of atoms; no component around a lone text; no unpainted wrapper when padding or gap does the job
- Typical component, to adapt to each case: flat row of layers, each present only if the case has it, in this order `img` · `avatar` · `left-icon` · `text` (or `text-1`, `text-2`… stacked) · `right-icon`; one BOOLEAN per layer shows or hides it; `left-icon` and `right-icon` also take an INSTANCE_SWAP; state and tone go to the variant axis, nothing else does
- Same structure = 1 single component, on every project: rows that differ only by what they show (image or icon or round check on the left; a duration, a key, one or two icon buttons on the right; an error border) are one component with its booleans, swaps and a state variant, never one component per look
- Naming `Category / Name` · variants for states / tones · TEXT / BOOLEAN / INSTANCE_SWAP props · page = instances only · masters in a `<name> / components` frame (300 px from the rest)
- Icons = Lucide, embedded in the plugin: `(await H.icon("plus")).createInstance()` returns the file's `Icon / <name>` component (found on the page named lucide, created there on first use, null if Lucide has no such name). A component = one 24 px frame holding one filled vector: size by `resize` on the instance, colour by `fills` on the vector
- Vertical rhythm, an aim of simplicity rather than a rule for every case: page and sections = padding-bottom, `itemSpacing` 0 · sub-sections = no padding-bottom, a gap · an element that needs more takes its own padding-bottom (a title, for instance) · a filled box carries its pb on a `-wrap`
- Component library: one line height in percent for every text, 130 % (the rhythm holds whatever the size), never auto; font sizes always even, on the scale 12 14 16 18 20 24 28 32 36 ...; a control's height comes from its source, fixed, its text centred, never from line height + padding (`tools/web-leading.mjs`)
- Colors = one variable collection per design, bound on every fill / stroke (`setBoundVariableForPaint`), never a hex

## Progressive display

The user must see the work start at once and grow block by block, never a blank canvas then everything at the end.
- ≤ 1 s: root frame(s) staged empty at final size and place — `stagePage(rpc, …)` of `tools/web-lib.mjs` or `c.stage` — before icons, components, capture or writing the build code
- first content block ≤ 3 s after the frame, then one block at a time in reading order (header → hero → sections → footer), the cursor following each
- components: one exec A only while it keeps the first block under 3 s; otherwise create each block's components just before its instances
- images streamed slot by slot as soon as their block exists (`loadImages` places each one as it lands, page order kept)
- variants of a design: stage every variant frame empty next to the source first, then fill them one by one
- code still being written (new case, long script) → run it block by block (one exec per block, appended to the root id), not one script at the end

## Build shape

- `makeRpc(file)` (`tools/web-lib.mjs`) → exec through `/rpc`, 30 s per exec, 1 MB body
- Exec 0 = `stagePage` (root id) · exec A = variables + icons + components · exec B = page of instances into the root id (loads A's ids) · then images (`figma-local-images`)
- Shared prelude string in both execs: `paint(var)`, `text()`, `box()` (auto-layout frame), `fix()` (root sizing: resize **before** sizing modes), `add()` (child sizing FIXED / FILL / hug), `ico()`, `swap()`
- `c = await H.cursor()`, `c.stage({name, width, height, x, y})` for each root not staged by exec 0, `c.ring.follow(n); await c.to(n)` per section, `c.done()`
- Return counts from exec B: nodes, instances, absolute (must be 0)
- Order of magnitude: ~40 icons + ~10 components ≈ 2 s, a 1440 page of ~600 nodes ≈ 4 s

## Gotchas

- An INSTANCE_SWAP renames the swapped layer → find it by parent + index before the swap, rename it back
- `componentPropertyReferences` only on layers of the component itself, not inside nested instances
- Geist weights: `SemiBold` without a space
- A run that fails halfway leaves its frame: remove only what this run created, then rerun (exec A refuses if the components frame exists)

## Success criteria (say them before the run)

- 0 absolute · every repeated element an instance · Lucide only · page and sections `itemSpacing` 0, sub-sections a gap · each exec < 30 s
- frame visible ≤ 1 s · first block ≤ 3 s after it (the build logs `frame : … ms`)
