---
name: figma-local-images
description: Put external images into Figma nodes — download them locally, then load each file's bytes with figma.createImage through the Angelo bridge as the fill of a named slot. Use whenever a Figma build needs real photos or visuals from URLs (createImageAsync is blocked).
---

# Figma local images

`loadImages(rpc, rootId, srcs, imgDir, {pool})` in `tools/web-lib.mjs` (in the `angelo` repo, plugin Angelo open).

## Method

1. Slots: nodes named `img:<id>` under `rootId` (instance sublayers included), fixed size, a placeholder fill
2. Download: `srcs = [{id, src, w, h}]` (page order) → curl → `imgDir/img-<id>.<native ext>`, `pool` (6) in parallel (the folder's images are cleared first). **Native format always**: PNG / JPEG / GIF kept as downloaded; SVG = vector media, imported as is with `figma.createNodeFromSvg` (never rasterized, never re-vectorized); only formats Figma cannot read (WebP, AVIF…) become PNG (lossless); a file over ~700 KB is downscaled in its own format
3. Load, streamed: each image placed as soon as it and the ones before it are downloaded (first one ~0.2 s in, never after the whole batch), one exec per image, `figma.createImage(figma.base64Decode(b64)).hash` → `FILL` image paint on the slot, renamed `image`
4. Returns `{got, placed, miss}` · the user may cap the count (e.g. only 20) → slice `srcs`, the rest stay placeholders

## Success criteria

- `placed === srcs.length`, `miss` empty · ~1 s per image (download included; 12 × 40 KB = 13.7 s)

## Rules

- Never `createImageAsync(url)` (blocked by the manifest) · keep each exec under 1 MB (base64 of ≤ 700 KB)
- Finder copy/paste = fallback for heavy images (~1 MB+) only; pitfalls: copies the selection of another open Finder window, lands inside the frame under the viewport center (instance included), rectangles arrive before their image fill
- `makeRpc` retries once: the bridge closes an idle keep-alive socket during long downloads
