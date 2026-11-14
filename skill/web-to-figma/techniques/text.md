# Text and fonts

Solved techniques. Index and rule → [../techniques.md](../techniques.md).

| Page technique | Capture (`web-capture-page.js`) | Build (`web-layout` / `web-build`) |
|---|---|---|
| `background-clip: text` gradient (multi-layer, `text, text, text`) | gradient kept as `font.fill`, no box background | gradient text fills (one paint per layer) |
| Off-screen pinned text (skip link at `y: -42`) | `pin: 1` | kept `pin` on text leaves, so it stays an absolute layer and never grows its parent |
| Overlapping texts in one flow (kicker + headline, button spans) | — | merged into one text with styled runs |
| `sr-only` / clipped accessibility text | dropped (< 4 px) | — |
| sr-only copy beside a label drawn as SVG (1 px wide, full height, `clip: rect(1px…)`) | dropped: absolute + overflow hidden + 1 px on one side or `clip: rect(1px…)`; the SVG carries the label | vector import |
| Paragraph of inline pieces (links, coloured letters, `<br>`, a `display: none` fallback, an sr-only twin, `inline-block` nowrap groups) | one text with styled `runs`; hidden / sr-only pieces skipped, `<br>` left to the lines | one text, runs as ranges, browser breaks as soft breaks |
| `<br>` between inline pieces (`<a>…</a><br><br><a>…</a>`, footer legal text) | counted on the piece after it (walker takes `BR` with the text nodes): `\n` per `<br>`, two = a blank line | hard breaks kept, a blank line counts as one line in the height |
| Superscript drawn by the font (`font-feature-settings: "numr"` / `"sups"`) or `vertical-align: super` | `font.sup` on the run | run drawn at 0.6× size (no superscript in the plugin API) |
| Centred / right-aligned wrapped text (first line starts inside the box) | `lines` | first-line offset is an indent only when left-aligned |
| Inline pieces apart on screen with no space in the DOM (kicker + title in two spans) | `lines` hold the visual space | runs regain the spaces the browser's lines show; guarded by `web-check`: no glued words |
| Centred / right-aligned text hugging its lines | `lines` | its box is its lines', so the parent centres it (else it sits at the block's left once it shrinks) |
| Plain text broken by a `<br>` with no space around it ("development<br>system") | `lines` | treated as one run: the browser's line spaces come back |
| Inline chip in a paragraph (`code`, `kbd`, diff highlights: a painted inline piece on one line) | text stays a run of the paragraph; the chip's fill / border pushed as its own box, cropped to the clip, `pin`, `z -1` | fill painted under the text |
| Runs of different sizes on one row ("Diffs" + small "+") | one browser rect per run | rects on the same row merged into one line, no soft break between them; guarded by `web-check`: no text line split on one row |
| Space between two DOM text nodes the browser does not show (React "+" "22") | `lines` | runs lose the spaces the browser's lines lack; guarded by `web-check`: no extra space |
| One-line text whose runs carry a taller line height (bigger "+" at 29 px in a 28 px row) | runs `font.lh` | text line height = tallest run, planned height follows; guarded by `web-check`: no text taller in Figma than planned |
| One-line text a pixel or two taller than its grid cell (29 px "+" in a 28 px cell) | box `h` | the cell sets the row pitch: text fitted to it, line height capped; guarded by `web-check`: no one-line text taller than its cell |
| `text-box-trim` (box shorter than its line boxes: cap height to baseline) | box `h` vs `lines` | box geometry kept, `leadingTrim = CAP_HEIGHT` (fonts loaded first); guarded by `web-check`: no trimmed text built untrimmed |
| Trimmed and untrimmed text sharing one variant | `trim` part of the text signature | a main built on a trimmed heading no longer forces CAP_HEIGHT on an untrimmed one (Changelog 48 → 35 px, everything below 16 px up) |
| Optical size axis (`font-optical-sizing: auto`, browser sets opsz to the size) | `opsz` read per text, one pinned font per value (`tools/fonts/opsz.py`, fonttools) | Figma keeps the axis default otherwise: wrong width and contrast |
| Variable font with a width axis (UltraCondensed…Regular faces) | at equal weight, the normal-width face before condensed/expanded ones (`FACE_RULE` in the font key rebuilds mains) | — |
| Obfuscated font files whose @font-face weights round to one word (350, 375, 400: all "Regular", Figma drew the thin file) | exact weights name first, a word already taken → the next lighter one (`tools/fonts.mjs`); Figma keeps the old file until restarted | — |
| Generated text in flow (`::before` / `::after` content, `open-quote` / `close-quote` from `quotes`), hung by a negative `text-indent` | joined to `text` / `runs` / `lines`, `font.hang` | `hangingPunctuation` |
| Icon font glyph (empty `<i>`, `::before` content = one U+E000–F8FF char, a site icon font) | the glyph read as the box's text in the pseudo's font; the font file (ttf/otf accepted by `fonts.mjs`) joins the faces → site font activated | text in the icon font |
| Soft hyphen at a line end (`hyphens: auto`, "devel-opment") | `hy` on the line | hyphen kept at the break |
| Inline description at `opacity: 0` revealed on hover (span inside a paragraph) | text pieces: a piece not visible with `opacityProperty` is left out | — |
| Decoration in a transparent colour (`text-decoration-color: transparent`, underline shown on hover) | `decoOf` skips it | — |
| Underline with its own thickness / offset (`text-decoration-thickness: 1px`, `text-underline-offset: 1.6px`) | `font.decoW` / `font.decoY` from `decoOf`'s computed style (px values only) | `textDecorationThickness` / `textDecorationOffset` `{unit:"PIXELS"}` (ranges: `setRangeTextDecoration*`) |
| Inline pill between two text nodes ("agents [Build] together") | `linesOf` records wide word gaps (`gaps`, not on justified text), kept through line merges | the gap becomes a wide-space run (`lineSpaces`, runs or not) |
| Each weight shipped as its own family (`Inter Semi Bold`, `Inter Medium`) | — | `fonts.mjs` keeps a per-face family, `styleOf` picks it |
| Rolling ticker held mid-roll by the page clock (outgoing and incoming digits both in the box) | text lines kept only when at least half inside the clip (mask / overflow), the text box shrunk to them or emptied (`web-capture-page.js`) | — |
| Other variation axes set by hand (`font-variation-settings: "wdth" 98`) | `font.axes` (every axis but opsz / wght) | `variationSettings` on the variable font's `fontName`, a static face untouched |
| Runs smaller than their block's line height (a label and its badge in a list item) | block `lh` | every run raised to it (CSS strut), Figma takes only the tallest range |
| Inline span in a taller block (lines further apart than the span's `lh`) | even pitch between `lines` | that pitch as line height |
| Text slotted into a web component (`<p-display>`, `<p-text>`: real style lives in the shadow tree, host computes 16 px black) | font read from the slot's (`assignedSlot`) computed style | — |
| Web font with its name table wiped (empty family, "Font" everywhere) | renamed from the `@font-face` (`tools/fonts/rename.py`), latin file only per weight, foreign-named script subsets dropped | the real family instead of the fallback |
| Text slotted into a screen-reader-only shadow wrapper | not captured (`slotHidden`) | no phantom screen-reader label |
| Text hidden by `text-indent: -5000px` inside an `overflow: hidden` icon button | a line wholly past a side of the clip is dropped, as it was past the top / bottom | no hidden label text at x −2167 |
| `@font-face { font-weight: normal / bold }` on a font with a wiped name table | keyword read as 400 / 700 before the rename (`WORDS[NaN]` fell back) | the site font instead of the fallback |
| Struck old price beside the current one (`text-decoration: line-through` on a sibling) | — | two texts in a row merged into one text with a struck range, no extra boolean |
| Row of hug texts: Figma rounds each hug text width to a whole pixel, the excess adds up along the row | — | not compensated by the build, padding trimmed in place |
| Word gap of an inline link row | the space's own width measured (`spaceWidth`, per computed font) | deducted from the gap, instead of a 0.28 em guess |
| Inline pseudo-element showing words: no client rect | placed at the start of the element's first line box or the end of its last | — |
| `<input type=submit>` | its `value` captured as the button's label | — |
| `ul` of inline-block items (one per line or CSS columns) merged into one wrapped paragraph | `listed` (CSS columns or all tops distinct): not a paragraph, one text per item · `orphan`: an inline-block whose parent is not a paragraph is read as a paragraph itself, otherwise the link's text disappears | one text per item |
| Weight 800 or a stretch the family does not have | `styleOf` falls back to the nearest width, then weight, on upright faces | no italic or condensed face picked by accident |
| Empty `input[type=date]`: the hint is not in the DOM | hint written from the page locale | text drawn in the field |
| `textarea`: no line box to read | a `lines` entry placed at border + padding top | text at the top of the field, not centred |
| No-break spaces (U+00A0, U+202F) binding words on a line | whitespace collapsed like CSS (`[^\S\u00a0\u202f]+`), the no-break spaces kept | same line breaks as the page |
| `sup` at `line-height: 0` inside a paragraph | the run takes the paragraph's px line height (`setRuns`) | lines keep their pitch |
| Inline `sup` listed by the capture as its own `lines` entry on the same visual line | the fixer counts visual rows (`rows()` in `web-fix`), not entries | no extra line forced, rows below stay put |
| `<input>` with `display: flex` | still a field: its one line centred on its height (`web-layout`) | submit label centred |
| Text inside a nested instance atom too narrow | width set via the main component's FILL (instance sublayer resize is ignored) | wraps as on the page |
| `filter: invert() / brightness()` on the text or an ancestor (header over a hero) | `__angeloFilterColor` bakes the filters, in CSS order, into the text colour and the box bg | white label as painted |
| CSS family named after its one face ("BrandNarrowBold" declared at weight 400) | the face is taken whatever the weight gap (`styleOf0`) | bold labels |
| Italic asked of a CSS family without one ("BrandTextRegular" italic) | the Figma family's italic declared under a sibling CSS name; the browser's faux oblique stays ~5 % wider (Figma has none) | true italic |
| One-line nowrap span after its link's text ("See more at" + "Event ›") | the piece starting mid-line takes its line's x, no paragraph indent (`web-layout`); a link holding text boxes besides its own text makes that text an anonymous item (`web-items`) | one row, not a split title |
| `-webkit-line-clamp: N` cut by a clipping ancestor | the clip filter keeps a clamped text's hidden lines; the kept lines are written with the browser's ellipsis on the last one, Figma truncation ENDING (`web-capture-page`) | the ellipsis follows a whole word, not mid-word |
