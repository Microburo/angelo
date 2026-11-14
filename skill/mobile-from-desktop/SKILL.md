---
name: mobile-from-desktop
description: Build the mobile version of a selected desktop Figma frame through Angelo — native mobile structure, same brand and content, library components first, live build with the agent cursor. Use when asked for a mobile version of a desktop frame or page, or a mobile width (390, 430…) of one.
---

# Mobile From Desktop

Create a mobile version of the selected desktop frame. It must feel designed for mobile, not a shrunk desktop. Keep brand, content and visual language; transform only structure, sizing and interaction patterns.

Tooling: skill `angelo` (read → write loop). Every Figma call passes `file` (the open file name) — the plugin refuses another file.

## Canvas

- Width **390** by default; the width the user names wins (430 is common).
- Height hugs content (root frame VERTICAL autolayout, HUG). Never crop content to a height.
- Name `[desktop name] mobile` unless the file already has a naming pattern for mobile frames — follow it.
- Place it **300 px right** of the desktop frame, same y (order: desktop 1, mobile 1, desktop 2, mobile 2). If that spot is taken, ask.
- Never modify the desktop frame, nor any master component.

## Step 1 — Read and map (before any write)

1. `angelo_read` the selection — manifest (variables, styles, components with variants, fonts) + tree. `angelo_expand` only the sections you will transform.
2. List sections in order (header, hero, grids, filters, lists, pre-footer, footer…) and, for each, the component it is an instance of.
3. For each instance, check its component set for a mobile counterpart (`Device=Mobile`, `Size=S`, `*-mobile`, `nav/mobile`…). Mobile variant exists → swap the variant; this is always the first option.
4. Note the spacing tokens, the type styles (mobile styles if the library has them) and the mobile grid style if any — mobile values come from these, never invented.
5. Selection is not a page/screen frame → say so and stop.

## Step 2 — Global rules

### Layout
- Grid: the library's mobile grid style if it exists (bind it); otherwise 6 cols, gutter 4, margin 12 hardcoded on the root and flagged in the report. Side padding = grid margin.
- Multi-column → one column, desktop reading order. Every stacked section in VERTICAL autolayout, children FILL.
- **Vertical rhythm**: page and sections = padding-bottom, `itemSpacing` 0 · sub-sections = no padding-bottom, a gap · an element that needs more takes its own padding-bottom, one that cannot carry it goes into a `<name>-wrap`. No spacer frames.
- Section paddings: desktop value −40 to 50 % (120 → 64, 96 → 56, 64 → 40), picked from the spacing tokens and bound. Big desktop gaps stay bigger on mobile.

### Typography
- Library text styles only: mobile styles when they exist, otherwise the next style down in the hierarchy (display → heading…). Raw sizes only if the library has no fitting style — flag them.
- Target scale when choosing: 64–72 → 36–40 · 48–56 → 30–32 · 32–40 → 24–28 · 24 → 20 · body 16 (never < 15) · labels ≥ 12.
- Keep all copy. Heading on 4+ lines → flag, do not rewrite.
- Long text left-aligned; short hero / section titles may stay centred.

### Touch targets
- Interactive elements ≥ 44×44 hit area, ≥ 8 px apart.
- Primary CTA full width in stacked sections, height 48–56 (button component size variant if any).

### Imagery
- Full-bleed images may span the frame width; contained ones stay in the content area.
- Keep aspect ratios; panoramic crops (21:9) → 4:3 or 1:1 on the subject.
- Decorative elements that crowd the screen: hide (not delete) and list them.

## Step 3 — Section patterns

- **Navigation**: logo left, icons/hamburger right, 64 tall; hide the text links (`visible = false`), they move to a `[name] menu` frame (stacked links, 56 rows) placed 300 px right of the mobile frame — only when the user asks for the menu state, otherwise offer it in the report. App-like page with 3–5 destinations → bottom tab bar.
- **Hero**: heading → subheading → CTAs → image (image first if it is the message). Side-by-side CTAs → stacked, primary on top.
- **Section title (title | paragraph side by side)**: stacked, both FILL, container HUG.
- **Feature / product grids**: stack; 2 columns when cards are small (product tiles, contacts, re-assurance items: wrap row, fixed width `(content − gap) / 2`, `counterAxisSpacing` for rows).
- **Carousels, category strips, filter menus, logo bars**: single row, aligned start with the side padding, parent `clipsContent = true` (horizontal scroll). Never centred-and-cut.
- **Pricing**: stacked, recommended plan first; comparison matrix → per-card lists, reported.
- **Data tables**: ≤ 6 simple columns → one card per row; dense numeric → horizontal scroll, first column pinned.
- **Forms**: fields full width, stacked, 48–56 tall, labels above; short pairs (ZIP | City) may stay paired.
- **Footer**: image + content side by side → stacked (image FILL, ~520 tall, clipped); link columns stacked (accordions if 4+ groups and the user wants them); legal and social last.
- **Sticky sidebar CTA** → sticky bottom bar, full-width button.

Section order unchanged, except purely decorative filler before the primary CTA, which may move below it — reported.

## Step 4 — Build live (Angelo)

- First exec: `c.stage({ name, width, after: desktop })` → the empty mobile frame appears at once; then clone the desktop sections into it hidden and `c.reveal` them in order.
- 1 exec ≤ 30 s (~25 reveals) → one exec per 1–3 sections. Each exec = one undo step.
- Clone from the desktop (`node.clone()`), never rebuild what exists. Instances stay instances.

### Instance limits (verified in live)
- An instance sublayer **cannot change `layoutMode` direction nor `layoutPositioning`** (silently ignored, or "cannot be overridden in an instance"). Padding, alignment, visibility, sizing, `clipsContent`, text and variant props can.
- So: mobile variant → swap · only padding/alignment/visibility needed → override · direction change needed → `detachInstance()` **on the clone inside the mobile frame only**, then detach nested instances that need the same change. Every detach goes into the report.
- Variant property names are case-sensitive (`{ Style: "Black" }`, not `style: "black"`).
- Absolute children (`layoutPositioning = "ABSOLUTE"`): set `"AUTO"` before `FILL` (else "FILL cannot be set on absolute positioned children"). Set `layoutMode` on a frame before HUG/FILL on its children.
- After stacking, containers with a fixed height → `layoutSizingVertical = "HUG"` (otherwise the next block overlaps).
- Text styles: look them up by normalised name (`/` → `.`, spaces → `-`) or by id from the manifest.

## Step 5 — Verify and report

1. Overflow check in one exec: every visible node whose bounding box leaves the root's x-range, ignoring children of a clipping parent. Target: empty list (tiny badges a few px out are acceptable, say so).
2. Contained checks: body ≥ 15, targets ≥ 44, autolayout on every stacked section, no fixed-height container cutting content.
3. `H.shot(root, ~0.3)` to look at it yourself, then hand over — **the user judges the render in Figma**; do not claim it is good on assertions alone.
4. Report in the user's language, short:
   - pattern used per section
   - hidden, cropped, reordered, converted items
   - detached instances and hardcoded values (grid, sizes) — to replace once mobile components or tokens exist
   - flags (4+ line headings, dense tables, nav CTA placement)

## Guardrails

- Never invent content, copy or imagery — everything comes from the desktop frame.
- Never restyle: colours, fonts, radius, shadows identical; tokens stay bound (a raw number on a bound field unbinds it).
- Library components and their mobile variants first; detach or rebuild only when nothing fits, and report each case.
- Never delete anything outside the mobile frame being built; leftovers from a failed exec inside it → undo (Cmd+Z) or remove only what this run created.
