---
name: web-to-figma
description: Rebuild a live web page in Figma from its URL through Angelo — chains web-capture (rendered layout), figma-structured-build (auto layout, components, Lucide) and figma-local-images (real images). Use when asked to rebuild or reproduce a web page in Figma, or given a URL to turn into a Figma frame.
---

# Web to Figma

Rebuild what a browser renders, not what the HTML says. The user judges the render in Figma, never browser automation. Run from the `angelo` repo, plugin Angelo open, bridge :8787.

## Before running — success criteria

Say them to the user before the first run (details in each skill):
- capture: no text < 4 px, nothing outside the frame, overlays excluded
- build: 0 absolute node, Lucide only (report counts) · fewest components and variants → `figma-structured-build` § Rules
- images: every captured image placed, no `img:` slot left
- check: 0 block moved (y/h within 8 px) in `web-compare`, similarity reported, element contract: 0 image absent/empty (`--fix` places them again), every remaining element issue named
- display: raw page in Figma ≤ 15 s after the request (capture + raw build, no code written), then the structured build block by block
- performance: capture < 5 s, each exec < 30 s, images ~1 s each

## Working discipline

This is the method behind each step below, not an extra: capture, build, fix, check, patch.
- **Think before coding**: before touching code or Figma, say the cause (from data) and the success predicate. An image or remark with several readings (a suspicious number, a suspect padding) → name the readings and measure each, never pick one silently
- **Simplicity first**: skip → reuse (`corners()`, `override()`, existing helpers) → minimum rule. One generic rule, no per-site patch, no flag nobody asked for
- **Surgical changes**: every changed line traces to the request; no cleanup of neighbouring code; existing frames are patched in place, never rebuilt
- **Goal-driven, exhaustive controls**: a control is a predicate over the *whole class* (every button, every pill, every instance), computed source vs Figma by a script that prints a table, never a sample, a screenshot glance or one fixed node. Same predicate before and after the fix; the report comes only when the table is empty, or each remaining row has its proof. A fix proven on one node is not verified: the class table is the proof
- A defect the user finds that the controls did not → the control was too narrow: add its predicate to the checks (`web-compare` / `web-check`) in the same session, then fix the defect

## Steps

0. The request's first tool call, no reading, grep or analysis before it: `node tools/web-to-figma.mjs <url> [--exclude "<overlay text regex>"]` → the root frame is in Figma ~1 s in, then capture, site fonts (`fonts.mjs`) and the build fill it (`web-build --root`). `--file` only to target another file than the one the plugin is open in. Fix what is wrong afterwards
   - Phone version: `--width 430`, or the plugin's `mobile` switch on before pasting the URL (any width < 700), captured as the site serves it to a phone (isMobile, touch, iPhone UA), frame `<host> · 430`, case dir `tests/web/<case>-430`; judged and self-corrected the same way
   - **In a file with its own tokens** (at least 4 color or 3 text styles/variables, its own or a library's seen in use): after the check, the frame takes on the file's rules (`H.adapt`: nearest colors, text styles, grid; printed as `adaptation :`), `--faithful` keeps the site's look; no tokens = nothing changes. A later `web-compare` on an adapted frame judges the layout only: colors and fonts differ on purpose. Components of the file are not reused yet
1. Capture → skill `web-capture` (`tools/web-capture.mjs`, `--shot` to spot overlays)
2. Raw build at once: `node tools/web-build.mjs <out.json> --file <file> --height <h> --exclude "<overlay text regex>" --font <fallback> --name "<host> · capture brute" [--max-img n]` → flat absolute frame with images, the first display, **never the deliverable**
3. Structured build → skill `figma-structured-build`: write a build script from the capture measurements, block by block in reading order
4. Images → skill `figma-local-images`: `loadImages` into the `img:<box id>` slots
5. Check against the page, every build: `node tools/web-compare.mjs <case dir> --file <file> --root <id>` (web-to-figma.mjs runs it at the end; needs `page.jpg`, the full-page JPG shot) → per-block y/h gaps by name, gap zones with their Figma frame path, `compare-*.jpg` (page | Figma | gaps in red), `overlay-*.jpg` (page and Figma blended at half width, 720 px for 1440: doubled text or edges = not ISO). **Read every `overlay-*.jpg` before any report, without being asked** — the band metric misses horizontal shifts (a 15 px narrower layout scored 96 %); zoom a crop where something doubles. Read the images, fix the cause generically in `tools/web-*` (never a per-site hack), `npm run web-check`, rebuild, compare again. Success: 0 moved block, similarity up, every remaining gap named in the report
6. **Final self-correction — on every run, extension runs included, before telling the user anything.** The user must not be the one who finds the defects: read the shots yourself, 700 px per panel is enough (`compare-*.jpg`, `overlay-*.jpg` as written; never ask for a screenshot to discover a gap).
   - **Deterministic fixer first**: `node tools/web-fix.mjs <case> --file <file> --root <frame>` (~0.5 s) pairs every text / icon of the frame with its capture box and patches in place: whole-page height and canvas fill, text width, alignment, line count, then position through the parent's auto-layout (padding, alignment) before x/y; it reruns `web-compare.mjs --fix` and writes `<case>/fix.json` `{fixed, rest}`. The bridge runs it after every build; Claude (`tools/autofix.mjs --case --issues`) gets only `rest`, never the whole frame. A difference the fixer cannot express → add the pass to `web-fix.mjs`, not a one-off patch
   - Read the page side and the Figma side of each panel and list every visible difference: missing icon, blank card, wrong crop, missing texture, shifted block, missing footer. Do not trust the metric alone: an empty card in the *reference* (player or lazy image not painted when `page.jpg` was shot) scores the correct Figma as wrong. Blank on one side only → find which side is wrong before touching the build
   - Each difference → cause found in `capture.json` / `page.jpg` / `figma.json` (data, not guesses), generic fix in `tools/web-*` or `extension/`, `npm run web-check`, `node extension/build.mjs` if the extension changed
   - **A page already in Figma is never rebuilt, whatever the fix touches (fonts, global layout included): corrections are worked on the existing frame.** First choice: patch its nodes in place (`local_figma_use`), then `web-compare.mjs --root <frame>`. A section too broken to patch: rerun that section only, rebuilt in a staging frame and swapped into the full-page frame in place (`swapSections`). Headless: `node tools/web-capture.mjs <url> <out> --blocks` lists the blocks (a repeated name is told apart as `Name#2`), then `node tools/web-to-figma.mjs <url> --part "A + B"` (a section or a sub-section; the full-page frame is the one named after the host, `--home <frame>` otherwise). Extension: pick the faulty blocks. Section not found in the full-page frame: nothing moves, say so. A `--part` run overwrites `tests/web/<case>/capture.json` + `page.jpg` with the section's: before freezing a case, recapture the whole page with `web-capture.mjs` alone, no build
   - Extension capture asked → arm a Monitor on the bridge's output (`tail -n 0 -f <bridge output file> | grep --line-buffered -E "web-to-figma .*\(extension\) exit|Error|ALERT"`) before telling the user to start: the `exit <code>` line is the end of the job (check included), start this step then without being told. The plugin sends no alert; no watch = the run goes unseen until the user asks. Bridge not started from this session (no output file) → say so and ask the user to confirm when done. A Monitor expires after 30 min: re-arm
   - The rerun needs the user's Figma in front (the extension capture): say what to reload, rerun the check on the new shots, repeat until a pass finds nothing. Browser automation never judges the render: the shots the pipeline already makes are the only eyes
   - **The loop is part of the run, never a reply to a request.** The end of a build/capture is not the end of the task: the report comes only after the loop has emptied. Per pass, build the list of every difference (metrics, element contract, overlays, `figma.json` vs `capture.json`), then for each one: cause from data → generic fix → `npm run web-check` → rerun the block → recheck. A difference may leave the list only as *fixed* (recheck shows it) or *not fixable here* with its proof (e.g. reference shot out of sync with the capture, source image not downloadable); a difference merely "noted" or "to analyse" is an unfinished loop. A reference suspected out of sync is itself a defect to fix (shoot it again at capture time), not a reason to stop. Never end a turn on a list of leftovers the next step of which is obvious: do it
   - Report only what is still wrong after the loop, each with its cause and why it is not fixable here
7. Report in the user's language: timings, counts, images placed / captured, similarity before → after, gaps left. The user judges

## Defects

- **Every miss enriches the method** → [techniques.md](techniques.md) (index, Open table) + `techniques/<theme>.md` (solved): look up the page technique first; once fixed generically, add its line to its theme, take it out of Open, and freeze the case (`tests/web/<case>/capture.json` + `expect.json`) so `npm run web-check` guards it
- What the capture misses or misjudges → `web-capture` refining loop, `npm run web-check`
- How a thing is built → `figma-structured-build` gotchas · images → `figma-local-images`
- Fonts absent from Figma fall back → list them in the report, activate via FontZero rather than substitute
