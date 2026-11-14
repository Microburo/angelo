Report (frame 1:92, patched in place, nothing rebuilt, nothing committed):

**Fixed (before → after)**
- **Horizontal alignment**: every block was pinned left with hand-tuned paddings. They are now centered, and the Russian text is no longer stretched over 2117 px. It goes from 1 line to 5 lines (424×112), as in the capture.
- **Vertical offset**: the frame's top padding goes from 282 to 238. Every box lands within ±2 px of `capture.json` (text 1 at y 297 for 298 expected, "Learn more" at 820 for 822, icon at 238).
- **Invisible Arabic**: SF Pro has no Arabic glyphs and nothing was drawn (rendered area of 20×24 px). The text now uses Geeza Pro Regular and shows on 2 lines (367 px wide, against 397 in the capture, the font being narrower).
- **Chinese**: the stray hyphen "将-" is removed, with the exact line break of the capture.
- **Page background**: the frame was white, the page is `#eee`.
  - Generic cause: the background is set on `<html>`, and no box carried it.
  - Fix: `tools/web-capture-page.js` now captures `canvas`, and `tools/web-layout.mjs` sets it on the root frame when the body has no background. `npm run web-check`: 9 cases, 0 failures.
  - Verified on a headless capture of example.com: `canvas` is `rgb(238, 238, 238)`.
- **Compare**: similarity 93 % → 97 %, 0 moved block, 0 gap zone ("text absent from Figma" and "svg differs" are gone).

**Not fixable here**
- **7 texts + 1 svg still "shifted" (~9 to 10 px)**: it is `page.jpg` that is shifted relative to `capture.json`, not Figma.
  - Proof: the ink of the first line starts at y 294 in `page.jpg`, against 303 in Figma, while the capture gives 300.5 for the line box. The icon is at 231 in `page.jpg`, against 241 in Figma.
  - `page.jpg` most likely comes from a shot taken with a different viewport height (the `25vh` padding varies with it). I could not prove it.
  - The capture must be redone from the extension, in the browser.
- **Arabic width**: Geeza Pro is narrower than the page's system font, and no closer font is installed.

Files changed in the repo: `tools/web-capture-page.js` and `tools/web-layout.mjs` (one line each). I did not add a frozen `canvas` case to `tests/web`.
