I fixed frame 1:137 in place and similarity goes from 95 % to 96 %. Some font rendering gaps remain, detailed below. I rebuilt nothing and committed nothing, and went only through the angelo MCP.

**Fixed (before → after)**
- **Vertical offset**: all the content was 44 px too low, because the top padding was 233 while the icon is at y=189 in the capture. It is now 189. The icon, the 7 texts and the link are aligned, and the block check gives 0 moved block.
- **Background**: the frame was white, it is now #EEEEEE like the page. The 16 px rounded corners, absent from the page, are removed.
- **Height**: the frame goes from 903 to 932 px (fixed, like the page).
- **Widths**: the Arabic, English and Chinese blocks were 475, 370 and 371 px and overflowed the frame. They are all 366 px as in the capture, and the "cut by clip" warning is gone.
- **Arabic**: the text goes from SF Pro, wider than the ref, to Geeza Pro. It fits on 3 lines again as in the ref.
- **Chinese**: the stray hyphen "，-" is removed and the text moves to PingFang SC. It takes 2 lines as in the ref.
- **"Learn more" link**: it goes from "absent" (57 px gap) to "differs" (41 px gap).

**Not fixable here**
- **Text width**: the browser's system font is not SF Pro. The Figma text is about 2 % wider (329 px against 322 px on the English reference line).
  - Consequence 1: the first paragraph breaks one word earlier (the last words of the paragraph end up alone on the last line).
  - Consequence 2: the 5 remaining "text wrap" gap zones and the glyph overlays shifted by a few pixels come from this.
  - I added no letter-spacing or other workaround.
- **"Learn more" link**: it is still flagged "differs". Its ink is shifted by about 3 px and the underline is thinner than in the ref. I attribute it to font rendering as well, but did not isolate it further.
- **Generic cause not coded**: the first paragraph's alignment and the stray hyphen come from the capture (forced line breaks in the Arabic and Chinese texts). I changed nothing in `tools/web-*`, so `npm run web-check` was not rerun.
