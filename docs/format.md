# Angelo — format and writing

## Reading

- The first read returns a manifest: variables (modes included), styles, components (props / variants), fonts, then the tree at surface level with numbered holes `<chunk n · N nodes>`
- The manifest lists what the scope references (variables + alias targets, styles, components, fonts) plus a line `# +N local … not listed` · `angelo_read manifest:"full"` lists every local one · any local label stays writable (registered on the fly by `angelo_apply`) · measured on one scope: 3,281 → 851 tokens
- Local content (geometry, texts, sheets) comes per chunk, on demand (`expand(id)`)
- The plugin does the chunking (budget ~4k tokens per chunk, boundaries = whole subtrees); the agent pulls what it needs
- Real Figma node ids (`1:234`), no hash · variables through a legend (`c.surface.default`), not opaque ids · an instance is only `ref(cmp){overrides}`
- Token economy: `at` omitted under auto-layout, `autosize` / text style props omitted when implied, a `* …` line = tokens common to the children (never `at` / `wh` / `text`), `tools/tokens.mjs` estimates · measured −13 % on a full site page (12,060 → 10,454), −18 % from the `*` line alone on an icon page
- Versioned header `angelo/1 units:px` · covered (read, write, `edge/` fixtures): strokes, clip, opacity / blend, rotation, hidden nodes, wrap + counter-spacing, absolute positioning, constraints

## Read example

Versioned header, manifest, tree:

```
angelo/1 units:px file:"Shop" page:"Home" scope:selection(1) nodes:412 chunks:7

# vars
@ primitives modes[light|dark]
c.surface.default = #FFF | dark:#101010
n.space.md = 16

# styles
t.body = Inter Regular 14/20 ls:-0.01
e.card = drop(0,2,8,#0000001A)

# cmp
cmp.button = "Button" variants[variant: primary|secondary] props[label:TEXT="Send"]

# fonts
Inter Medium, Inter Regular

# tree
FRAME#1:2 "Home" 1440x900 col gap:24 pad:48
  FRAME#1:5 "Header" 1440x80 row gap:16 pad:0,48 align:between,center
    <chunk 1 · 37 nodes · "Logo", "Nav", "Actions">
  FRAME#1:40 "Hero" 1440x620 col gap:32
    <chunk 2 · 64 nodes · "Copy", "Visual">
```

`angelo_expand` returns the same lines, complete:

```
# chunk 1 of read 3 · in #1:5 · 37 nodes
FRAME#1:6 "Logo" at:48,24 wh:120x32 fill:c.surface.default r:4
TEXT#1:7 "Baseline" at:0,36 wh:120x16 font:t.caption fill:c.text.muted text:"Leather goods"
```

- A scope that fits the budget (4000 by default) has no chunks and comes back as `detail:full`
- Instance = `ref(cmp.button){variant:primary} ov{label:"Send"}`, never walked into · component sets: variants are in the manifest · instance swap = the target's label (`ov{icon=cmp.icon-rocket}`, target added to the manifest; `swap` only when not found)
- A vector whose regions paint something other than the node's fill → `regionfill:<paint>`: the region is what shows, the bound fill is hidden · writing: `regionfill:inherit` only (reassigns `node.fills`, never `setVectorNetworkAsync`, which moves the old paint onto the node)
- A `# warn` section (between manifest and tree) lists gaps between declared and rendered; each line ends with `→ <op>` that can be applied without re-reading (nodes registered in the session). Nodes are those of the read (instance interiors excluded, 5000 max): `op:0` or cumulative opacity < 10 % → `op:1` · an auto-layout child cut off by its parent's clip → `clip:off` · missing font (fallback render) · a raw hex equal to a local token → `fill:` / `stroke:` candidates (alias first, then text / border role), grouped by color · components (opaque instances): vector regions ≠ node fill — raw region → `regionfill:inherit`, bound region and raw node → `fill:<token>` · a page of 1,921 nodes: 1.1 s
- Text is always on one line; mixed styles go on `+ seg:0-6 …` lines
- Also covered: strokes (weight, alignment, dashes), locked nodes, layout grids

## Writing

- The write path that already exists: `local_figma_use` (arbitrary JS). Typed ops are a layer on top, not a second path
- Ops `set` / `insert` / `clone` / `reorder` go through the same channel; the plugin returns the real diff · a per-node hash: an op is refused if the design moved (never overwrites)
- A batch = `each {match:{in|type|ref|name}, props}` filtered **on the last read** (never a query against the file), chunks not expanded included (matches fingerprinted on the spot, counted on a `# each:` line of the reply), 500 targets max, at least one filter · `pad` / `r` / `gap` take a number or a variable label (`pad:n.gap.16` binds the token, `pad:16` unbinds it) · variants and instance overrides through `ref:(cmp.x){size:l}` and `ov:{label="…"}`
- `loadFontAsync` before any `characters` · 1 batch = 1 undo step · an op Figma refuses in pass 2 rolls the ops before it back in the same undo step (`rolled back: nothing changed`)
- Reply: `# applied N ops · M nodes` = nodes really changed, `· K unchanged (already as asked)` or `no change: …` when a write lands on the value already there · diff capped at 60 lines or ≈ 2,800 chars, the rest counted · the layers a write moves without writing them (children, siblings, ancestors still as read, 300 max) get a fresh fingerprint, past that `# N layer(s) around the change not re-fingerprinted`
- A note's Undo on an exec keeps what the script fetched (`byId`, `getNodeByIdAsync`, selection) and up to 400 layers below in all; roots left partly kept are named in the reply's `undo`
- Grammar validator on the plugin side · round-trip test serialize → parse → re-serialize identical from day one

## Live A/B measurement of a format change

`git worktree add <scratch>/old <commit>`, symlink `node_modules`, build, copy its `dist` into `plugin/dist`, measure, `npm run build` to restore, `git worktree remove` (`tools/tokens.mjs` is the estimator)
