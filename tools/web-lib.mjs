// Shared by the web → Figma builds: bridge exec, Lucide icons, images pasted from Finder.

import { readFileSync, readdirSync, mkdirSync, unlinkSync, rmdirSync, existsSync, writeFileSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { placeImages, BATCH, BATCH_BYTES, BOARD_JS, MAX_IMG, MAX_SIDE } from "./web-place.mjs";
// the desktop UA the capture browses with (web-capture.mjs): image downloads present the same browser
export const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
export { placeImages, BATCH, BATCH_BYTES, BOARD_JS };
export const LUCIDE_VERSION = "0.460.0";

// the bridge refuses a /rpc body over 1 MB (413): caught here, with the size and the call
// (image bytes never ride in it: the plugin fetches them from the bridge, see imageUrl)
export const RPC_MAX = 1_000_000;
// a downloaded image file as the plugin reads it: raw bytes served by the bridge (/img)
const PORT = process.env.ANGELO_PORT ?? 8787;
export const imageUrl = (file) => `http://localhost:${PORT}/img?p=${encodeURIComponent(resolve(file))}`;
const post = (body) => fetch(`http://127.0.0.1:${PORT}/rpc`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body,
}).catch(() => {
  throw new Error(`bridge unreachable on port ${PORT} (npm run bridge)`);
});
// label: optional short name shown in the plugin's activity list instead of the code's first line
// quiet: no cursor pass after the exec (see runExec), for tools chaining many small execs
export const makeRpc = (file, { quiet = false } = {}) => async (code, label) => {
  const body = JSON.stringify({ method: "exec", params: { code, file, label, ...(quiet && { quiet }) } });
  if (body.length > RPC_MAX) throw new Error(`exec too large: ${body.length} > ${RPC_MAX} (${code.trim().slice(0, 80)}…)`);
  // a keep-alive socket closed by the bridge during a long pause (downloads) resets once
  const res = await post(body).catch(() => post(body));
  const p = await res.json();
  if (p.error) throw new Error(p.error);
  if (p.result?.error) throw new Error(p.result.error + (p.result.at ? ` (line ${p.result.at.line}: ${p.result.at.src})` : ""));
  return p.result?.value;
};
// The file the plugin is open in (its ping names it)
// case folder of a host: every label but the TLD, so docs.stripe.com and docs.figma.com stay apart
export const caseName = (host) => {
  const labels = host.replace(/^www\./, "").split(".");
  return (labels.length > 1 ? labels.slice(0, -1) : labels).join("-").replace(/[^a-z0-9-]/gi, "-");
};

export const pluginFile = async () => {
  const p = await (await post(JSON.stringify({ method: "ping", params: {} }))).json();
  if (!p.result?.file) throw new Error(`Angelo plugin disconnected: open it in Figma (${p.error || "no file"})`);
  return p.result.file;
};

// Lucide SVGs (lucide-static), cached under ~/.cache/lucide-static/<version>/
export async function lucide(names, version = LUCIDE_VERSION) {
  const dir = join(homedir(), ".cache/lucide-static", version);
  mkdirSync(dir, { recursive: true });
  const out = {};
  for (const n of names) {
    const f = join(dir, `${n}.svg`);
    if (!existsSync(f)) {
      const res = await fetch(`https://unpkg.com/lucide-static@${version}/icons/${n}.svg`, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`unknown Lucide icon: ${n}`);
      writeFileSync(f, await res.text());
    }
    // drop the license comment, fix the stroke color (rebound to a variable in Figma)
    out[n] = readFileSync(f, "utf8").replace(/<!--[\s\S]*?-->/g, "").replace(/currentColor/g, "#1a1a1a").trim();
  }
  return out;
}

// Root frame first: the user sees the empty page at its final size and place before icons,
// components or capture work run. Placed 300 px right of everything on the page; returns its id.
// The cursor stays on it (held) until the build's first cursor takes over.
// keep: a frame of that name stays as it is (runBuild empties it once a capture exists: a capture
// that fails or is cancelled must not cost the page already there).
export async function stagePage(rpc, { name, width, height = 900, fill = "FFFFFF", keep = false }) {
  return rpc(`
const page = figma.currentPage;
const right = page.children.reduce((m, n) => Math.max(m, n.x + n.width), 0);
const c = await H.cursor();
// a rebuild takes over the last frame of that name (emptied) instead of adding one more
const prev = page.children.filter((n) => n.type === "FRAME" && n.name === ${JSON.stringify(name)}).at(-1);
if (prev) { ${keep ? "" : `for (const k of [...prev.children]) k.remove(); prev.resize(${width}, ${height}); `}c.node.x = prev.x + Math.min(120, prev.width / 4); c.node.y = prev.y + Math.min(80, prev.height / 4); c.ring.follow(prev); await c.to([prev.x + 24, prev.y + 14], 460); }
const f = prev || await c.stage({ name: ${JSON.stringify(name)}, width: ${width}, height: ${height}, x: right + 300, y: 0 });
const h = ${JSON.stringify(fill)};
if (${!keep} || !prev) f.fills = [{ type: "SOLID", color: { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 } }];
// capture and fonts run outside Figma: the cursor and its ring stay on the frame meanwhile
c.hold();
return f.id;`);
}

// A picked section that already lives in the full-page frame `home` is rebuilt there, in place:
// the rebuilt block (found by its name in the staged frame `temp`) takes the old one's seat in its
// parent (same index, same sizing / position / constraints) and the old one goes. All or nothing:
// each part must be found exactly once on both sides, else nothing moves and the staged frame stays.
// Returns { swapped, reason?, parts: [{ name, old, now, w }] }.
export async function swapSections(rpc, { temp, home, parts }) {
  return rpc(`
const page = figma.currentPage;
const tmp = await figma.getNodeByIdAsync(${JSON.stringify(temp)});
const host = page.children.filter((n) => n.type === "FRAME" && n.name === ${JSON.stringify(home)} && n.id !== ${JSON.stringify(temp)}).at(-1);
if (!tmp) return { swapped: false, reason: "staged frame gone" };
if (!host) return { swapped: false, reason: "no full-page frame named " + ${JSON.stringify(home)} };
// (an instance's sublayers are not walked: findAll over them throws)
const named = (root, name) => {
  const out = [], todo = [...root.children];
  while (todo.length) {
    const n = todo.shift();
    if (n.name === name && n.type !== "TEXT") out.push(n);
    if ("children" in n && n.type !== "INSTANCE") todo.unshift(...n.children);
  }
  return out;
};
const pairs = [];
for (const part of ${JSON.stringify(parts)}) {
  // "Name#2" = the 2nd layer called Name in the page frame, in reading order (the page repeats names)
  const [, name, nth] = /^(.*?)(?:#(\\d+))?$/.exec(part);
  const olds = named(host, name), news = named(tmp, name);
  const old = nth ? olds[Number(nth) - 1] : olds.length === 1 ? olds[0] : undefined;
  if (!old || news.length !== 1) return { swapped: false, reason: "\"" + part + "\" found " + olds.length + "× in the page frame, " + news.length + "× in the new build" };
  pairs.push([part, old, news[0]]);
}
const done = [];
for (const [name, old, now] of pairs) {
  const parent = old.parent, at = parent.children.indexOf(old);
  const wasW = old.width, auto = "layoutMode" in parent && parent.layoutMode !== "NONE";
  const sizeH = auto ? old.layoutSizingHorizontal : null, sizeV = auto ? old.layoutSizingVertical : null;
  const abs = old.layoutPositioning === "ABSOLUTE", ox = old.x, oy = old.y, cons = old.constraints;
  let warn;
  parent.insertChild(at, now);
  try {
    if (auto) {
      if (abs) { now.layoutPositioning = "ABSOLUTE"; now.x = ox; now.y = oy; }
      if (sizeH === "FILL" && !abs) now.layoutSizingHorizontal = "FILL"; else if (now.layoutSizingHorizontal !== "HUG") { now.layoutSizingHorizontal = "FIXED"; now.resize(wasW, now.height); }
      if (sizeV === "FILL" && !abs) now.layoutSizingVertical = "FILL";
    } else {
      now.x = ox; now.y = oy; now.resize(wasW, now.height);
    }
    now.constraints = cons;
  } catch (e) { warn = e.message; }
  done.push({ name, old: old.id, now: now.id, w: Math.round(now.width), wasW: Math.round(wasW), warn });
  old.remove();
}
const leftover = tmp.id;
tmp.remove();
return { swapped: true, parts: done, removed: leftover };`);
}

const run = promisify(execFile);
const sips = (...a) => run("sips", a, { timeout: 30000 });
export { adaptToFile } from "./web-finish.mjs";

// Downloads srcs ({id, src, w, h}) into imgDir as img-<id>.<native format>, `pool` at a time,
// in the given order. get(id) → promise of { id, svg } | { id, url, size } | null; ready(id) once settled.
export function fetchImages(srcs, imgDir, { pool = 6 } = {}) {
  mkdirSync(imgDir, { recursive: true });
  for (const f of readdirSync(imgDir)) if (/^img-.*\.(jpg|png|gif|svg)$/.test(f)) unlinkSync(join(imgDir, f));
  const fetchOne = async (it) => {
    const raw = join(imgDir, `${it.id}.src`);
    try {
      // a data url (canvas pixels shot in the page) is decoded, never fetched
      const data = /^data:[^;,]+;base64,(.*)$/s.exec(it.src);
      // a percent-encoded data url (inline svg backgrounds) is decoded as text
      const text = !data && /^data:[^,]*,(.*)$/s.exec(it.src);
      if (data) writeFileSync(raw, Buffer.from(data[1], "base64"));
      // (a lone % left raw by the page is kept as is)
      else if (text) writeFileSync(raw, text[1].replace(/(%[0-9a-f]{2})+/gi, (m) => { try { return decodeURIComponent(m); } catch { return m; } }));
      else {
        // --compressed: a CDN may gzip an svg whatever Accept-Encoding says (cloudfront), the bytes would not be markup
        // a full browser UA: a WAF answers an empty 202 challenge to a bare "Mozilla/5.0" (vmfa.museum)
        await run("curl", ["-sL", "--compressed", "-A", BROWSER_UA, "-o", raw, it.src], { timeout: 20000 });
        // a bot wall answers an HTML page ("Access Denied") or nothing to a browser-like UA it does not trust
        // (images.porsche.com: 403 to "Mozilla/5.0", 200 to curl's own): tried again with curl's default
        const refused = () => !existsSync(raw) || statSync(raw).size === 0 || /^\s*<(!doctype html|html)/i.test(readFileSync(raw, "utf8").slice(0, 200));
        if (refused()) await run("curl", ["-sL", "--compressed", "-o", raw, it.src], { timeout: 20000 });
        if (!existsSync(raw) || statSync(raw).size === 0) throw new Error("empty response from the site");
      }
      // an svg is already vector media: kept as markup, imported as is (never rasterised)
      const b = readFileSync(raw);
      const head = b.subarray(0, 400).toString();
      if (/^\s*<(!doctype html|html)/i.test(head)) throw new Error("refused by the site (HTML page instead of the image)");
      if (/<svg[\s>]/i.test(head)) return { id: it.id, svg: b.toString() };
      // native format kept: PNG / JPEG / GIF go in as downloaded; formats Figma cannot read
      // (WebP, AVIF…) become PNG (lossless); only a file too heavy for one exec is downscaled, same format
      const fmt = b[0] === 0x89 && b[1] === 0x50 ? "png" : b[0] === 0xff && b[1] === 0xd8 ? "jpg" : b.slice(0, 3).toString() === "GIF" ? "gif" : null;
      const out = join(imgDir, `img-${it.id}.${fmt || "png"}`);
      const side = async (f) => Math.max(...(await sips("-g", "pixelWidth", "-g", "pixelHeight", f)).stdout.match(/\d+$/gm).map(Number));
      // Figma refuses an image over MAX_SIDE px on a side ("Image is too large"), whatever its weight
      if (fmt && b.length <= MAX_IMG && (fmt === "gif" || (await side(raw)) <= MAX_SIDE)) writeFileSync(out, b);
      else {
        await sips("-s", "format", fmt === "jpg" ? "jpeg" : fmt || "png", raw, "--out", out);
        if ((await side(out)) > MAX_SIDE) await sips("-Z", String(MAX_SIDE), out);
        // shrink from the natural size down until it fits (a noisy PNG may need far below 600 px)
        for (let px = (await side(out)) * 0.8; readFileSync(out).length > MAX_IMG && px >= 64; px *= 0.8) await sips("-Z", String(Math.round(px)), out);
      }
      if (readFileSync(out).length > MAX_IMG) throw new Error("too heavy");
      return { id: it.id, url: imageUrl(out), size: statSync(out).size };
    } catch (e) {
      console.log(`image ${it.id} skipped (${(e.message || e).toString().split("\n")[0].slice(0, 80)})`);
      return null;
    } finally {
      if (existsSync(raw)) unlinkSync(raw);
    }
  };
  const jobs = new Map();
  const settled = new Map();
  let next = 0;
  const worker = async () => {
    while (next < srcs.length) {
      const it = srcs[next++];
      const p = fetchOne(it);
      jobs.set(it.id, p);
      settled.set(it.id, await p);
    }
  };
  const all = Promise.all(Array.from({ length: Math.min(pool, srcs.length) }, worker));
  const get = async (id) => {
    while (!jobs.has(id)) await new Promise((r) => setTimeout(r, 10));
    return jobs.get(id);
  };
  // once every download is settled: the files this run wrote go, then the directory when empty
  const cleanup = async () => {
    await all;
    for (const f of readdirSync(imgDir)) if (/^(img-.*\.(jpg|png|gif|svg)|.*\.src)$/.test(f)) unlinkSync(join(imgDir, f));
    if (!readdirSync(imgDir).length) rmdirSync(imgDir);
  };
  return { get, ready: (id) => settled.has(id), value: (id) => settled.get(id), all, cleanup };
}


// Downloads srcs and places each one as soon as it and the ones before it are ready (page
// order kept). Batches: every image already downloaded goes in the same exec, up to BATCH
// images / BATCH_BYTES of payload; a batch is sent as soon as the next image in page order
// is not ready yet, so images keep streaming in. The first image shows ~1 s in.
export async function loadImages(rpc, rootId, srcs, imgDir, { pool = 6 } = {}) {
  const f = fetchImages(srcs, imgDir, { pool });
  let got = 0;
  let placed = 0;
  const miss = [];
  let batch = [];
  let bytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    const B = batch;
    batch = [];
    bytes = 0;
    const res = await placeImages(rpc, rootId, B);
    res.forEach((ok, k) => (ok ? placed++ : miss.push(B[k].id)));
  };
  for (const it of srcs) {
    if (!f.ready(it.id)) await flush();
    const item = await f.get(it.id);
    if (!item) continue;
    got++;
    const size = item.svg?.length ?? item.size;
    if (batch.length && (batch.length >= BATCH || bytes + size > BATCH_BYTES)) await flush();
    batch.push(item);
    bytes += size;
  }
  await flush();
  await f.all;
  return { got, placed, miss };
}

// Cross-origin stylesheets listed by the in-page capture (web-capture-page.js): fetched here and
// parsed for the @font-face of the families in use. Mutates data: faces added, sheets/used dropped.
export async function sheetFaces(data) {
  for (const href of data.sheets) {
    try {
      const css = await (await fetch(href, { signal: AbortSignal.timeout(20000) })).text();
      for (const m of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
        const prop = (k) => (new RegExp(`${k}\\s*:\\s*([^;]+)`).exec(m[1]) || [])[1]?.trim();
        const fam = (prop("font-family") || "").replace(/["']/g, "").trim();
        if (!data.used.includes(fam.toLowerCase())) continue;
        // every src of the rule: an old-browser `src: url(x.eot)` usually precedes the real list
        const all = [...m[1].matchAll(/(?:^|[;\s])src\s*:\s*([^;]+)/g)].map((s) => s[1]).join(",");
        const urls = [...all.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((u) => new URL(u[1], href).href);
        const src = urls.find((u) => /\.woff2(\?|#|$)/i.test(u)) || urls.find((u) => /\.(woff|ttf|otf)(\?|#|$)/i.test(u)) || urls[0];
        if (src) data.faces.push({ family: fam, weight: prop("font-weight") || "400", style: prop("font-style") || "normal", src });
      }
    } catch (e) {
      console.log(`unreadable stylesheet, its fonts are missing: ${href} (${e.message})`);
    }
  }
  delete data.sheets; delete data.used;
}
