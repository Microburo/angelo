---
name: angelo
description: Read and patch a Figma selection through the angelo MCP (angelo_read / angelo_expand / angelo_apply / local_figma_use). Use for any Figma read of a selection, page or node, and for any write that the Angelo vocabulary can express — layout, spacing, radius, fills, strokes, text, variants, instance overrides, mass edits.
---

# Angelo — read and patch Figma as compact text

Channel: Figma plugin "Angelo" (must stay open) → bridge :8787 → MCP `angelo`.

## Routing

| Need | Tool |
|---|---|
| Is the plugin there, what is selected | `angelo_status` |
| Read a design (selection, `page`, `1:234`) | `angelo_read` — never walk the tree by hand |
| Detail of a hole `<chunk n>` or one node | `angelo_expand` |
| Write anything the read vocabulary expresses | `angelo_apply` |
| Gradients, images, mixed text, vectors, plugin data, anything else | `local_figma_use` (JS, helpers `H`, 1 exec = 1 undo) |

Typed ops first: guarded (node hash), atomic, real diff back. `local_figma_use` has no guard.

## Fast path — default for every request

Target: a simple change in 2 Figma calls, no exploration. Time is spent in round trips and deliberation between them, not in Figma.

1. `angelo_read` straight away (target = selection, or the id the user gave). No `angelo_status` first: a closed plugin fails the read with a clear message.
2. Decide from that read alone. It carries what is needed: manifest of referenced tokens, tree, and `# warn` (where the render differs from the declared props, each line ending `→ <fix op>` — apply it as given). Do not probe with `local_figma_use` to confirm what the read already says.
3. One `angelo_apply` with every op of the change. `# warn` nodes are writable without another read.
4. The returned diff is the verification. No re-read, no screenshot, no repo check unless the diff contradicts the intent.

Only open more when the read cannot answer: `angelo_expand` for a hole you must touch or judge; `local_figma_use` for what the vocabulary cannot express. A question the read could not answer is a gap in the serializer — say so, so it gets fixed in angelo rather than worked around each time.

Every `read` invalidates the previous `sid` — never write on a stale read. Pass `sid` and `file` from the read header when several reads are in flight.

## Reading rules

Absent = default:
- no `at:` on children of an auto-layout parent (`abs` children and free nodes keep it).
- no `autosize:` when `size:` implies it (`hug,*` → width_and_height, `*,hug` → height, none otherwise).
- no `lh` / `ls` / `case` / `deco` / `pspace` when equal to the bound `font:t.*` style (see `# styles`).
- `stroke:0,0,1,0 inside #EBEBEB` = per-side weights top,right,bottom,left.
- `# cmp` props: `name=off` boolean, `title="…"` text, `icon:swap` swap slot.
- `* constr:scale,scale stroke:2 center c.text.primary` under a parent = tokens every child line below carries; a child restating a key keeps its own value. Writes take real values, never `*`.

## Writing rules

- Reuse labels from the manifest: `fill:c.surface.default`, `font:t.display-l`, `pad:n.space-4`. The manifest lists only referenced tokens (`# +N … not listed`); any other local variable/style label is still writable by its slug, and `angelo_read` with `manifest:"full"` lists them all when you need to choose one. A raw number on a bound field **unbinds** it — only do that on purpose.
- `gap` / `pad` / `align` need autolayout (`row` / `col`); without it the op is refused.
- `size:fill,…` needs an autolayout parent.
- Instances: `ref:(cmp.x){size:l}` switches variant (overrides survive), `ov:{label="…", icon=on}` sets instance props; INSTANCE_SWAP takes a `cmp.*` label.
- Mass edit: `{op:"each", match:{in|type|ref|name}, props}` — filters the last read only (closed chunks included, no expand needed), at least one filter, 500 targets max.
- One batch = one undo step. Any invalid op ⇒ nothing is written; fix and resend the whole batch. An op Figma refuses mid-batch rolls the batch back (`rolled back: nothing changed`).
- Reply header `# applied N ops · M nodes` counts the nodes really changed; `· K unchanged (already as asked)` / `no change` means the props were already there. The diff is capped (≈ 60 lines, ≈ 1.3k tokens), the rest counted on `# N more node(s), not detailed`.
- Children, siblings and ancestors a write moves (gap, resize in auto-layout) stay writable with no new read; past 300 of them the reply says `angelo_read before writing on them`.
- Never fetch an id you did not read (`0:1` loads the whole file).

## Live cursor — automatic

Every write (`local_figma_use` or `angelo_apply`) shows the agent's cursor (labelled with the agent name, `main` by default) and its gradient ring on the nodes it touches, with no code in the script; read-only execs show nothing. Up to 12 nodes the cursor stops on each one; beyond, it hops quickly with the ring following. Changes reach the cursor when the script yields (any `await`): a fully synchronous script only shows the closing pass (~1 s). Call `H.cursor()` to drive it finely (staged builds, reveals): the automatic cursor then steps aside for that exec.

## Live builds

The user must see the work start at once: stage the root frame(s) first (≤ 1 s, before any other work), then build content block by block in reading order (first block ≤ 3 s), nodes hidden then revealed with the cursor. Variants: stage every variant frame empty first, then fill. Details → `figma-structured-build` § Progressive display.

```js
const c = await H.cursor();          // agent-name label + gradient ring
const root = await c.stage({ name: "Page", width: 1440, after: desktop });  // instant feedback
// ...build inside root, every node hidden...
for (const n of nodes) await c.reveal(n);  // ring + glide, show, linger (~0.8 s each)
c.done();                            // also removed automatically on end or error
```

One exec ≤ 30 s → ~25 reveals per call; split bigger builds into several execs.

- Many nodes: `c.reveal` feels sluggish → use the web-to-figma pace `c.put(n, 64, 38)`, nodes grouped into ≤ 24 groups, rest of each group shown at once
- Frames laid out in a row: set x at reveal time, not at creation (previous frames still empty and narrow → overlap); keep any trailing frame pushed past the last revealed one

Mobile version of a desktop frame → skill `mobile-from-desktop` (`mobile-from-desktop/SKILL.md`).
Web page from a URL → skill `web-to-figma` (`web-to-figma/SKILL.md`).

## Failure

- "plugin disconnected" → ask the user to open Plugins → Development → Angelo; do not fall back to another Figma MCP silently.
- Batch refused "changed since read" → re-read the node, recompute, resend.
- Note's Undo after `local_figma_use`: fetched nodes and up to 400 layers below them are covered; past that, `undo` in the reply names the roots left out → `H.keep(node)` the layers the script changes.
