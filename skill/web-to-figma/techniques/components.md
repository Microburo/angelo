# Components

Solved techniques. Index and rule → [../techniques.md](../techniques.md).

| Page technique | Capture (`web-capture-page.js`) | Build (`web-layout` / `web-build`) |
|---|---|---|
| Fixed-size image inside a repeated block | — | size part of the variant (Figma ignores resize on instance sublayers) |
| Buttons (small rounded painted frame, one label, ≤ 1 icon) | — | one `Button` component set, `Style=Filled / Outline`, `Size` ranked by label size |
| Components of every site | — | mains on a dedicated components page, created on first use |
| SVG inside a repeated block (badge in a component) | — | placed in the main's slot only, never copied onto the root (a copy stays put while the layout moves) |
| Texture tiled in a reused component (grain `background-repeat` at 0.5×) | — | instance slot reads `tile` from its main, else keeps the main's TILE fill |
| Looped list (marquee duplicated for a seamless loop) reusing one main | — | SVG placed once in the main, instance slots mirrored from it, never re-placed on the host; skipped slots and imported SVG frames lose their fill (white / grey box otherwise) |
| Component main whose spec exceeds Figma's 100 kB plugin-data entry (svg-heavy block) | — | spec split over `fdslSpec`, `fdslSpec1`… and joined on read |
| Lots heavy with variant mains (40 ops = 55 mains → exec > 30 s) | — | tree-pass lots weighted by main node count |
| Children stacked in paint order (`zi`) inside a main | — | each child keeps its spec index (pluginData `ki`), override paths and the reuse check resolve through it (by position a text override landed on an svg) |
| Main left short by a stopped build | — | reuse check (`fits`) rejects it, built anew |
| Instance of a component whose main was built before a build change | reused as is (same signature): rotation or paint added later does not reach existing mains | — |
| Nav drawn as one svg | — | still a landmark component, the single-leaf guard only applies to names found in a class (search, filters) |
| Single-met menu or card | — | components even met once (atomic design: atom → molecule → organism); a header/footer/nav holds instances of the atoms and molecules it contains |
| Section headings with different parts (kicker, text, button) | — | one family (`kindFam`), a component only once repeated; the parts are options |
| Boolean on a row: a HUG auto layout frame whose children are all hidden keeps its height | — | the prop goes on the row, not on its content |
| Blend mode on a component instance | — | carried by the instance |
| Labels laid over an svg (svg `<text>` extracted as absolute boxes) | `sign()` keeps absolute kids in the family when they outnumber the flow kids | the drawing no longer joins every lone icon's family; header and corner widget stay apart |
| Same card with covers of different fixed sizes (518×324, 518×216…) | one variant per fixed image size, axis `Size=` (`dimsSplit` in `web-layout`): Figma refuses any size override on an instance sublayer | each card at its size |
