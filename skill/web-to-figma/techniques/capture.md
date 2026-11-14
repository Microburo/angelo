# Capture timing: animation, lazy loading, scroll, reference shot

Solved techniques. Index and rule → [../techniques.md](../techniques.md).

| Page technique | Capture (`web-capture-page.js`) | Build (`web-layout` / `web-build`) |
|---|---|---|
| Lazy images / content on scroll | `__angeloSettle` scrolls the page first | — |
| Scroll-linked animations (JS-driven bars, meters, slide-ins: state set by scroll position, e.g. `scaleY(0)` at load) | the settle samples each element's transform / opacity / clip-path / filter at every scroll step while it is in the viewport and keeps the most visible one (highest opacity, then closest to the viewport centre); `__angeloCapture` applies that rest state inline during the read, `__angeloHold` keeps it for the canvas and reference shots | — |
| `clip-path: inset()` (tickers, sliding labels: several states stacked, one shown) | clip like `overflow`, hidden states cropped away | — |
| Demo played on load (chat typing its answer, "Thinking…" then the reply) | settle waits for the DOM to stay quiet 4 s (20 s max, a ticker never stops) | — |
| Animation loop driven by `requestAnimationFrame` (marquee, canvas ticker) | rAF wrapped before page scripts (`evaluateOnNewDocument`), callbacks queued while `__angeloFreeze` holds | — |
| `::before` / `::after` that hangs the read (huge generated content) | pseudo read bounded | — |
| Page scrolled during capture (lazy media, sticky header) | `__angeloTop()` before the structural read | header built first, then blocks in reading order |
| Transient state at capture (element animating in) | settle keeps the last state seen wholly on screen as the rest state | — |
| State tied to the viewport (video controls shown while paused off screen, `IntersectionObserver`) | IO wrapped before page scripts; `__angeloInView()` at the end of settle tells every observer its targets are in view (as in the full-page shot) | — |
| `content-visibility: auto` sections (unpainted off screen, placeholder height) | settle injects `* { content-visibility: visible !important }` before reading | — |
| Body scrolling itself (`scrollHeight` = viewport) | max of `documentElement` / `body` | — |
| App shell: the document never scrolls, a panel inside it does (sidebar + scrolling main) | `web-capture` grows the viewport by what the widest scrolling panel hides, one round (an endless grid loads more on each growth), 16000 px max | — |
| Page block picked in the extension | `block` name | frame kept whole and named, never opened or renamed |
| Long page: nothing in Figma during the capture (35 s on a long marketing page: settle scroll waiting 1.5 s per 300 px step for fade-ins to end) | settle scroll in half-window steps, finite on-screen animations jumped to their end (`finish()`, 4 frames max for late starters), quiet wait 1.5 s (4 s min, 20 s max): scroll 23.5 → 3 s, capture 14 s | one pass into the staged frame (no first-screen slice: seams, a second page load, no clean cut = 40 s of nothing) |
| Virtualized product grid: card pictures unmounted once scrolled past, slot left grey (placeholder kept) | prepare scrolls frame by frame (a fifth of a window per frame, not window jumps); unmounted pictures put back where the slot has no picture, taken out again after the shot (`__angeloUnkeep`); `capture.json` carries `prep` (removed / restored / skipped) | — |
| Block shot from the viewport while its picture is still loading or sliding in (JS-driven, no animation to wait on) | `__angeloFrameShots` waits for its pictures loaded, decoded and at rest (page clock advanced), 3 s max | — |
| Scroll lock the page sets itself while a scroll scene plays (`overflow: hidden` + `scrollbar-gutter: stable` on `<html>`, released ~1 s later; set again on the scroll back to the top) | after the settle, wait until the root is no longer locked and narrower than the viewport (4 s max), else an alert that the page is narrower than the viewport | — |
| Element below the fold settled at its rest state when taller than the view under a sticky header | `last` = mostly on screen (60 %), not wholly | — |
| Ticker of labels (one per language) on a row shifted by `transform` under an `overflow: hidden` window: the row's box sits out of the window, its shown label in it | a container with visible overflow and no part in the clip is kept when one of its children (2 levels) is | — |
| Demo step caught mid-way by finite Web Animations (list items sliding past each other, 650 of 1420 ms) | `__angeloHold` pauses running finite animations that hold their end (fill forwards/both, transitions) 1 ms short of it, restored on release | — |
| Scroll-driven animations (`animation-timeline: view()`) | `__angeloHold` lands only document-timeline animations with a finite end (a scroll timeline's `currentTime` is a percent, landing it threw) | — |
| Virtualized grid unmounting its pictures (put-back nodes stay `opacity: 0`, slot paints grey, a shot of it is flat) | picture URL before pixels: put-back chain forced visible (`__angeloShow`), then `<img>` in the block, mounted `<img>` after a scroll, inline page data (`__NEXT_DATA__`), shot last | — |
| Page full of JS animations (spring animations driven on scroll, timers, marquees, scripted demos) | owned page clock (`web-capture.mjs`, `evaluateOnNewDocument`): timers, rAF, `performance.now`, `Date.now` virtual, CSS / WAAPI animations paused and stepped; settle `freeze()` then `tick()` per scroll step, `__angeloHold` freezes for the shots (CDP virtual time rejected: too few rAF frames, capped-delta springs lag) | — |
| Held rest value rewritten by the page's scroll handler (inline `style.opacity` on the way back to the top) | `__angeloHold` MutationObserver re-applies the rest values `!important` | — |
| Native lazy images with a low-res placeholder (`loading="lazy"`, lqip swapped on load) | forced `eager` before the settle, network idle awaited | — |
| Consent button with a localized label (e.g. "Accept all cookies" in another language) | `ACCEPT` pattern | — |
| Consent banner in a web component (shadow root, accept control = svg text with pointer cursor) | `consent()` walks shadow roots, accepts pointer-cursor leaves | — |
| Reference shot of a lazy / fixed-header page | scroll-and-stitch like a full-page screenshot extension (tile per viewport, fixed → absolute, sticky → relative, visible images complete + decoded before each tile) | — |
| Debugger infobar shrinking the viewport (~40 px, 100vh blocks shorter) | reference shot waits for the full `innerHeight`; canvas shot re-measures `b.py` right after the shot | page.jpg 80 % → 97 % |
| Slider hiding inactive slides with an animated `mask-position` on a sized gradient mask (not opacity) | `maskGone()` in the capture drops a box whose mask window (`maskSize` + `maskPosition`, horizontal linear-gradient) shows alpha < .02 everywhere: one slide stays per slider | — |
| Tiled svg background (`tileSvg`) | the tile is rebuilt as one full svg item (`tiled`) instead of a tiled image fill | — |
| `filter: brightness(0)` (+ `invert(1)`) on a logo | `fx.mono` = `#000000` / `#ffffff`; `imgFill` leaves it out of the filters and the svg branch of `web-place.mjs` recolours every paint (exposure alone would give a grey) | white logos |
| Inline box taller than its block | takes the block's box | — |
| Master label with `textTruncation ENDING` used as an instance whose source text wraps | instance override sets truncation to DISABLED, width +2, `textAutoResize HEIGHT` (resize before the mode, else it reverts); parent Button FIXED, label FILL | truncated chat bubble text |
| Button hidden by the page at capture time (white play disc on the orb: computed style visible, absent from the shot) | page state (animation), not a build defect: reported, not hidden | — |
| Site declaring its own global `scrollX()` / `scrollY()` functions (every position NaN, capture height NaN) | scroll offsets read off `document.scrollingElement` (`__angeloScrollX/Y`), never the bare globals | — |
