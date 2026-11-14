# mini-ds — reproducible mini design system (V1)

Builds the validated V1 (2026-11-06) in any Figma file where the Angelo plugin is open.

## Rebuild elsewhere

1. Open the target Figma file, run Plugins → Development → Angelo. Fonts active: Inter (Regular, Medium) — FontZero if missing.
2. `node tools/mini-ds/run.mjs build` — steps 00 → 09. **00-reset wipes the file's local variables and styles** and empties (or creates) the V1 pages "📐 Design system" (board) and "💊 Components" (masters frame): blank file only — it refuses a file that already has variables unless `--wipe` is passed (which also redraws the plugin's "👻 lucide-icons" page). Icons are drawn at stroke 1.5 (`ICON` in `prelude.js`).
3. `node tools/mini-ds/fingerprint.mjs compare` — must print `identical to reference/v1.json`. Any line = a delta to fix in the steps, then rebuild.

Before any build: `figma.root.name` must be the blank target ("Untitled"); the original V1 file "Figma domain syntax language" is never wiped, only patched in place.

## Files

- `prelude.js` — shared helpers, element order (`ELEMENTS`), card layout
- `steps/00–09` — full build; `steps/10–18` — in-place patches applied to the original page (already folded into 00–09, never run on a rebuild)
- `assets/avatar.jpg` — Avatar photo, injected by `run.mjs`; `export-assets.mjs` re-exports it from Figma
- `reference/v1.json` — id-free fingerprint of V1 (variables, styles, element frames, masters, instance overrides); `fingerprint.mjs save` only when a new version is validated

## Rule

Every change made in Figma (by hand or by patch) goes into steps 00–09 in the same session, then `fingerprint.mjs save`; otherwise a rebuild drifts from the validated version.

## CUI flavor (branch `cui-components`)

CUI library (yappologistic/CUI, MIT) rebuilt on our tokens, in its own file "Angelo CUI" (never the V1 file).

- `node tools/mini-ds/run.mjs build --flavor cui` — `steps-cui/<step>.js` replaces `steps/<step>.js`; new steps 20–32 (controls, feedback, menus, actions, inputs, pickers, navigation, overlays, data, charts, planning, motion, ai), ending with the CUI `09-check`
- `node tools/mini-ds/syntax.mjs --flavor cui <step…>` — offline check (parses prelude + step, Lucide names exist, vector paths use M L C Q Z only); run it before any Figma run
- One board card per CUI catalog page (caption = catalog title, listed in the `extra` array of `prelude.js`); 107 of 108 pages covered, "Icons" has none
- CUI `09-check` lays the cards on 6 rows and the masters frame on 10 auto-layout columns (`columns`), then reports absolute children, unbound paints, unstyled texts and stray top-level nodes (leftovers of a failed step)
- Pages: board "Design system", masters "Components" (own page, found by `rootNamed`), "Organismes" = components of a specific project (steps never write there); page names ignore a leading emoji (`pageNamed`)
- Translucent token paint: instances drop its opacity (back to 1, master keeps it) → write it with `setPaints(node, "fills"|"strokes", paints)` (prelude), which stores it unbound with the token resolved for the node; `09-check` lists those as unbound paints
- `run.mjs` takes the full step name (`33-code`, not `33`: ENOENT) · `box()` without a size makes a 100 px frame: a `spacer()` needs `h` (use `{ w: "fill", h: 1 }`) or it inflates its row · steps rebuild masters and cards but keep card positions (`cuiPos` plugin data on the root restores them)
- Known: 32 absolutely placed layers (chart dots, rings, Gantt overlays, node editor links, compare handle) — open decision
- Steps 23–32 were written by Sonnet agents from a brief (tokens only, Inter styles, unique layer names, one card per catalog page, ≤ 30 s) and run serially (single plugin client)

## Porting CUI components into V1 (2026-11-07, done)

Only the green-dotted CUI cards (45) are ported, batch by batch, each batch validated by the owner.

- Build in the V1 file directly (authorized): `node run.mjs <step>` (flavor v1 falls back to `steps-cui/`), then `node run.mjs 09-check`; check `figma.root.name` first, the run does not
- Port pattern in a `steps-cui` step: CUI-only masters and cards under `if (CUI)`, kept cards via `keep(caption)`; add the caption to `ELEMENTS` and a `TIERS` row in `prelude.js`, the step to `PORTED` in `run.mjs`; check both flavors with `syntax.mjs <step>` and `--flavor cui`
- V1 board = 7 rows by family (`TIERS`): foundations, actions, form inputs, pickers, lists and navigation, feedback, overlays; `09-check` sorts each row by `TIERS` order
- Rule: every cumulative content wrap becomes a SLOT (`slotify(set, prop, { from, to, only, frame })` in `prelude.js`, one SLOT property, content stackable in instances)
- Existing instances of a standalone component do not resync after slotify: replace them with fresh instances (same place, size, name)
- Rule: any icon painted text/primary or text/secondary uses `icon/default`
- V1 gaps vs CUI, adapted: radius scale 0 2 4 8 12 16 24 999 (24 = board cards only; no 6, 10, 18: `rad()` snaps an off-scale number to the nearest step, 10 → 8, 18 → 16), no `danger/default` (use `feedback/error/default`), no Danger button type (Primary filled with the error tone), control height 40 (CUI 36)
- V1 paragraph sizes: Large 17, Medium 15, Small 13, Mini 11, line height 130 % (decided 2026-11-07) · Display = Source Serif 4 Medium (decided 2026-11-08, was Inter Medium, Roxborough before)
- Space: off-grid steps space/2 6 10 14 20 added after the brand ramp (Primitives order), every component padding/gap bound; only 3, 19 and negative overlaps stay raw
- Heights: controls with a standard height stay FIXED (Button, Icon button, Chip, Segment, Toggle item, Reaction, Filter chip, Range preset, Wheel item, Calendar weekday, Model picker, Split button; decided 2026-11-07, space scale cannot hit 32/40/48), geometric shapes too; large blocks HUG with a `minH` floor bound to space (Dropzone, wide Control tile); HUG with a raw `minH` (36/52/112, off the space scale) for Calendar day, Code box, square Control tile (decided 2026-11-07, "component in hug")
- Board card radius 24 bound to `radius/board` (alias of Primitives `radius/24`), excluded from the component radius tiles in `prelude.js` (decided 2026-11-07, "bind radius to a token")
- New Primitives variables are appended at the END of the collection in the steps (variable order = creation order = live order): inserting mid-scale shifts every later index and `fingerprint.mjs compare` reports hundreds of false diffs; a reorder done by hand in Figma is folded into the steps, then checked as a pure permutation (same variable multiset) before `save` (radius/24 moved before 999, 2026-11-08)
- A HUG change shows up on masters AND instances in the fingerprint (493 vertical FIXED→HUG for 3 families): check the diff is only that direction before `save`
- All 45 ported (`PORTED` in `run.mjs`, 20-controls → 32-ai); `reference/v1.json` saved after the port
- Textarea carries a `resize` grip (2 diagonal strokes 8×8, `text/placeholder`, ABSOLUTE, constraints MAX/MAX, 4 px from the corner; no Lucide glyph for it) built in `steps/06-inputs.js`: `09-check` lists it among absolute layers (decided 2026-11-08)
- Dialog = `Dialog header` (Title, Close) + `Content` slot (description by default, extra content stacked in instances) + `Dialog footer` (variants Tone Default · Danger, switched on the nested instance, not a slot); header and footer are exposed instances (decided 2026-11-08); `Dialog footer` also has Size md · sm (sm = 268 wide, no top padding)
- Same split elsewhere: `Confirm popover` = `Content` slot (title, description) + `Dialog footer` (Danger, sm) · `Composer` = `Files` slot + draft + `Composer toolbar` (variants State Draft · Empty · Busy) · `Comment` = body + `Comment actions` (variants Liked Off · On, Likes text); nested parts are exposed instances, switched by variant, not slots (decided 2026-11-08)
- `slotify(..., { frame })` renames the frame to the slot name and overwrites its references: re-add a `visible` binding afterwards on the renamed frame (Composer `Files` + `Attachments`)
- Sublayers of an instance placed in a slot of another instance (Kanban card in a column) are unreadable through the API: `fingerprint.js` records them as `unreadable`

