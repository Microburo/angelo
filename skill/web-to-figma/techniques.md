# Front-end techniques → Figma

The method grows with every page: each miss found by `web-compare` becomes one line here, a generic fix in `tools/web-*` and an expectation in `tests/web/<case>/expect.json` (`npm run web-check`). One technique per line: what the page does → how it is read (capture) → how it is built (layout / build).

## Solved, by theme

- [stacking](techniques/stacking.md) — stacking, opacity, covers
- [text](techniques/text.md) — text and fonts
- [media](techniques/media.md) — images, svg, canvas, video, icons
- [capture](techniques/capture.md) — capture timing: animation, lazy loading, scroll, reference shot
- [layout](techniques/layout.md) — flow, sizing, clip, overflow
- [components](techniques/components.md) — components
- [check](techniques/check.md) — check blind spots

## Open (seen, not handled yet)

| Page technique | Symptom in Figma |
|---|---|
| Decorative gradients through `mask-image` / blend | gradient missing |
| Section shot mid-animation (stats band) | colour band differs from the page |
| Reveal missed by the settle (several blocks invisible when read) | section empty in capture and `page.jpg` (to recheck with the page clock) |
| Marquee / feed position differs between capture and `page.jpg` | horizontal / vertical offset in the overlay |
| Cookie dialog left in `page.jpg` (not dismissed by `consent()`, even retried after the settle; absent from the build) | reference shot differs, not the build |
| Scroll scene: sticky layers one viewport high fading in turn | each layer captured at its own rest state at its unstuck position: states stacked on one another; pick one state or unroll them |
| Looping carousel replaying its demo (~11 s cycle): any state is legitimate; a DOM-quiet wait does not help | `web-check` reports a text as absent on a live capture when the shot lands on another state |
| Hero `<video>` still taken at another moment than the page shot | zoomed frame vs wide |
| The file already has the landmark component (a header in its components page) | the build makes its own header; before the build, look for header / footer components in the file and swap them in. Layout then judged with the height difference |
| Intro title with negative letter-spacing: Figma counts the trailing spacing | wraps earlier than on the page: the text needs a few px more width and the gap trimmed |
| Symbol glyph fallback (◷ ✉ →) and its faux bold | other font or wrong width; range letter-spacing brings the width back, the bold and the arrow length stay. If a Lucide icon is wanted instead: take the glyph out and set `fontName` again, the remaining text inherits the glyph's fallback font (Apple Symbols, Zapf Dingbats) |
| Component reused across runs keeps the first run's style | a text style fixed on one step stays stale on another |
| Icon overlaid on an indented label (absolute text + `paragraphIndent`) | resizing the icon breaks the gap: put the text in the auto-layout flow and set the indent to 0 |
| `<br>` inside a paragraph: the text carries U+2028, not `\n` | a `/\s*\n\s*/` replace leaves the forced break and the paragraph wraps early: strip by char code (0x2028 / 0x2029) or never emit it for a `<br>` the page hides |
| Date field calendar icon, textarea resize grip | native chrome: a Lucide icon stands in, the grip is not drawn |
| Row of hugging text links spaced by the page gap (footer socials) | Figma rounds each text width up (75.x → 76), every link drifts +0.5–1 px to the right; a FIXED instance cannot be narrower than its text. Patched in place (wrap padding / row gap); a generic fix needs a post-build pass reading Figma widths and trimming the gap |
| Description wraps one word earlier than the browser | Figma shaping is slightly wider on the same font and width: line breaks differ, geometry and height identical; not fixable without touching the text |
