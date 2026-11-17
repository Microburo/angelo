// Deterministic self-correction of a web-to-figma frame (web-to-figma skill step 6), in seconds:
// every drawn leaf of the capture (text, svg, image) is paired with its Figma node by geometry and
// content, then fixed in place, class by class:
//   1. width  — a text far wider or narrower than its captured box with another line count → its box width
//   2. lines  — a text that still wraps into another line count → letter spacing nudged (±0.6 px max)
//   3. align  — the captured text-align
//   4. place  — a leaf off its captured place → the spacing that moved it (parent padding, the wrap
//               before it, the gap), or x/y outside auto-layout; several rounds, outer frames first
// then web-compare --fix (images placed again, full radii) for the record. What stays off is written
// to <case>/fix.json with its node ids: only that goes to a model (bridge, autofix --issues).
//   0. page   — a whole-page frame shorter than the captured page → its height; its fill → the page
//               canvas colour (html background)
// The capture is the reference, not page.jpg: a screenshot taken at another viewport height moves
// every vh-based layout (example.com: padding 25vh, the column −11 px in the shot); web-compare lays
// such a shot back on the capture before its element contract.
// Usage: node tools/web-fix.mjs <case dir> --file <Figma file> --root <node id> [--dry] [--no-compare]

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRpc } from "./web-lib.mjs";

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const [dir] = args;
const file = opt("--file");
const root = opt("--root");
const dry = args.includes("--dry");
if (!dir || !file || !root) throw new Error("usage: web-fix.mjs <case dir> --file <Figma file> --root <id>");
const TOL = 4; // px: a smaller gap is rounding and font metrics, left alone
const ROUNDS = 3;
const t0 = Date.now();
const rpc = makeRpc(file, { quiet: true });
const cap = JSON.parse(readFileSync(join(dir, "capture.json"), "utf8"));

// the captured leaves, in capture coordinates
const norm = (s) => String(s || "").replace(/[\s­​-]+/g, "").toLowerCase();
// a flex box's own text beside other boxes (texts, an icon, a ::before bar and the flex gap ahead of the
// glyphs) is an anonymous flex item: its box is its lines, not the container
const anonBox = (b) => {
  if (!b.text || !b.flex || !b.lines?.length || !cap.boxes.some((k) => k.p === b.id)) return {};
  const x = Math.min(...b.lines.map((l) => l.x)), r = Math.max(...b.lines.map((l) => l.x + l.w));
  const y = Math.min(...b.lines.map((l) => l.y)), btm = Math.max(...b.lines.map((l) => l.y + l.h));
  return { x, y, w: r - x, h: btm - y, tw: r - x };
};
// visual lines: a run the capture lists apart on the same line (circle's footnote figure, a sup at
// line-height 0, its own entry at x 301 inside "Network"'s line) is not a line of its own
const rows = (ls) => (ls || []).reduce((acc, l) => { const top = acc[acc.length - 1]; if (top && l.y + l.h / 2 > top.y && l.y + l.h / 2 < top.y + top.h) return acc; acc.push(l); return acc; }, []).length;
const leaves = cap.boxes
  // off the page (skip links parked at x -9999, menus above the top) is not drawn
  .filter((b) => (b.text || b.img) && b.w >= 4 && b.h >= 4 && b.op !== 0 && b.x < cap.width && b.x + b.w > 0 && b.y + b.h > 0)
  .map((b) => ({ ...b, ...anonBox(b) }))
  // a text box with a border or a padding (a button, a form control) is drawn around its text: the text is
  // its content box, one line high and vertically centred in an input or a select
  .map((b) => {
    if (!b.text || !(b.pad || b.border?.w)) return b;
    const bw = b.border?.w || 0, [pt, pr, pb, pl] = b.pad || [0, 0, 0, 0];
    const x = b.x + bw + pl, w = Math.max(4, b.w - 2 * bw - pl - pr);
    if (!/^(input|select)$/.test(b.tag || "")) return { ...b, x, w, y: b.y + bw + pt, h: Math.max(4, b.h - 2 * bw - pt - pb) };
    const h = b.font?.lh || Math.round((b.font?.size || 16) * 1.2);
    return { ...b, x, w, y: b.y + (b.h - h) / 2, h, lines: [{ y: 0, h }] };
  })
  .map((b) => ({
    id: b.id, kind: b.text ? "text" : b.img === "svg" ? "svg" : "img", x: b.x, y: b.y, w: b.w, h: b.h,
    svgFile: b.img !== "svg" && /\.svg(\?|#|$)/i.test(b.img || ""), key: b.text ? norm(b.text) : "", lines: rows(b.lines), lh: b.font?.lh, align: b.font?.align, tw: b.tw,
  }));

// the Figma side: drawn leaves with their box (root-relative), their text metrics and their chain of
// slots (each ancestor up to the root, with the auto-layout of its parent)
const READ = `
const root = await figma.getNodeByIdAsync(${JSON.stringify(root)});
if (!root) throw new Error("frame ${root} not found");
const R = root.absoluteBoundingBox;
const solid = Array.isArray(root.fills) && root.fills.length <= 1 && root.fills.every((f) => f.type === "SOLID" && !(f.boundVariables && f.boundVariables.color));
const fill = solid && root.fills.length ? root.fills[0].color : null;
const out = { w: R.width, h: R.height, leaves: [], fill: fill && [fill.r, fill.g, fill.b].map((v) => Math.round(v * 255)), solid };
// a box of vectors only: an image beside an icon (a hero and its pause button) is not one
// (an instance sublayer Figma has not refreshed yet throws on read: no image)
const hasImg = (k) => { try { return Array.isArray(k.fills) && k.fills.some((f) => f.visible !== false && f.type === "IMAGE"); } catch { return false; } };
const isVecBox = (n) => "children" in n && n.children.length && !hasImg(n) && n.findAll((k) => k.type === "TEXT" || hasImg(k)).length === 0 && n.findAll((k) => /^(VECTOR|BOOLEAN_OPERATION|STAR|ELLIPSE|LINE|POLYGON)$/.test(k.type)).length > 0;
const walk = (n, chain) => {
  if (!n.visible) return;
  const b = n.absoluteBoundingBox;
  if (!b) return;
  const box = { x: b.x - R.x, y: b.y - R.y, w: b.width, h: b.height };
  if (n.type === "TEXT") {
    const lh = n.lineHeight !== figma.mixed && n.lineHeight.unit === "PIXELS" ? n.lineHeight.value : (n.fontSize !== figma.mixed ? n.fontSize * (n.lineHeight !== figma.mixed && n.lineHeight.unit === "PERCENT" ? n.lineHeight.value / 100 : 1.2) : 0);
    out.leaves.push({ kind: "text", id: n.id, chain, ...box, text: n.characters, lh, align: n.textAlignHorizontal, sizing: n.layoutSizingHorizontal, resize: n.textAutoResize, ls: n.letterSpacing !== figma.mixed && n.letterSpacing.unit === "PIXELS" ? n.letterSpacing.value : null });
    return;
  }
  const img = Array.isArray(n.fills) && n.fills.some((f) => f.visible !== false && f.type === "IMAGE");
  // a wrap holding one vector box is not the leaf: the box under it is. A bare group of paths under it is the
  // drawing, smaller than the icon's box (the svg element in the capture): the frame is the leaf
  const wrap = isVecBox(n) && n.children.length === 1 && isVecBox(n.children[0]) && (n.children[0].type !== "GROUP" || Math.abs(n.children[0].width - n.width) < 1 && Math.abs(n.children[0].height - n.height) < 1);
  // a row of icons (social links, slider arrows) lays out several drawings: each is a leaf
  const row = isVecBox(n) && n.layoutMode && n.layoutMode !== "NONE" && n.children.filter((k) => k.visible && (isVecBox(k) || /^(VECTOR|BOOLEAN_OPERATION)$/.test(k.type))).length > 1;
  if (n !== root && !wrap && !row && (img || isVecBox(n) || /^(VECTOR|BOOLEAN_OPERATION)$/.test(n.type))) { out.leaves.push({ kind: img ? "img" : "svg", id: n.id, name: n.name, fillX: n.parent.layoutMode !== "NONE" && n.layoutSizingHorizontal === "FILL", chain, ...box });
    // a background image (a section under its cards) is a leaf and a parent: its content is walked too
    if (!img || !("children" in n) || !n.children.length) return;
  }
  if ("children" in n) for (const k of n.children) { try { walk(k, n === root ? [k.id] : [...chain, k.id]); } catch {} }
};
walk(root, []);
return out;`;

// pairs each captured leaf with one Figma leaf: texts by content (nearest when repeated); an image by
// its slot name (img:<box id>) whatever its size, else svg and images by kind, size and centre, the
// closest pairs first over the whole page (in capture order, a row of same-size icons pairs crosswise)
function pair(fig) {
  const used = new Set();
  const pairs = [];
  const ctr = (b) => [b.x + b.w / 2, b.y + b.h / 2];
  const dist = (a, b) => Math.hypot(ctr(a)[0] - ctr(b)[0], ctr(a)[1] - ctr(b)[1]);
  const byName = new Map(fig.leaves.filter((f) => f.kind === "img" && /^img:/.test(f.name || "")).map((f) => [f.name.slice(4), f]));
  const done = new Set();
  for (const c of leaves) {
    const f = c.kind === "img" && byName.get(String(c.id));
    if (!f || used.has(f.id)) continue;
    used.add(f.id); done.add(c.id);
    pairs.push({ c, f });
  }
  for (const c of leaves) {
    if (c.kind !== "text") continue;
    const pool = fig.leaves.filter((f) => !used.has(f.id) && f.kind === "text" &&
      (norm(f.text) === c.key || (c.key.length >= 12 && (norm(f.text).startsWith(c.key.slice(0, 24)) || c.key.startsWith(norm(f.text).slice(0, 24))))));
    if (!pool.length) continue;
    const f = pool.sort((a, b) => dist(a, c) - dist(b, c))[0];
    used.add(f.id);
    pairs.push({ c, f });
  }
  const cand = [];
  for (const c of leaves) {
    if (c.kind === "text" || done.has(c.id)) continue;
    for (const f of fig.leaves) {
      if ((f.kind !== c.kind && !(c.svgFile && f.kind === "svg")) || used.has(f.id) || Math.abs(f.w - c.w) > Math.max(3, c.w * 0.1) || Math.abs(f.h - c.h) > Math.max(3, c.h * 0.1)) continue;
      const d = dist(f, c);
      if (d < cap.width) cand.push({ c, f, d });
    }
  }
  for (const { c, f } of cand.sort((a, b) => a.d - b.d)) {
    if (used.has(f.id) || done.has(c.id)) continue;
    used.add(f.id); done.add(c.id);
    pairs.push({ c, f });
  }
  // nearest-first crosses look-alikes shifted by more than their spacing (3 icons 188 px off: the last
  // Figma one takes the first captured one): swap any two whose swap shortens the squared distances
  const d2 = (a, b) => (ctr(a)[0] - ctr(b)[0]) ** 2 + (ctr(a)[1] - ctr(b)[1]) ** 2;
  const alike = (p, q) => p.c.kind === q.c.kind && (p.c.kind === "text" ? p.c.key === q.c.key
    : Math.abs(p.f.w - q.c.w) <= Math.max(3, q.c.w * 0.1) && Math.abs(p.f.h - q.c.h) <= Math.max(3, q.c.h * 0.1) && Math.abs(q.f.w - p.c.w) <= Math.max(3, p.c.w * 0.1) && Math.abs(q.f.h - p.c.h) <= Math.max(3, p.c.h * 0.1));
  for (let swapped = true, round = 0; swapped && round < 20; round++) {
    swapped = false;
    for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
      const p = pairs[i], q = pairs[j];
      if (p.c.kind === "img" && byName.has(String(p.c.id))) continue;
      if (!alike(p, q) || d2(p.f, p.c) + d2(q.f, q.c) <= d2(p.f, q.c) + d2(q.f, p.c) + 1) continue;
      [p.f, q.f] = [q.f, p.f];
      swapped = true;
    }
  }
  return pairs;
}
// horizontal gap of a pair: a centred (or right-aligned) text is placed by its centre (right edge),
// its box may be wider than the captured one (FILL in a column)
const dxOf = (c, f) => (c.kind === "text" && f.align === "CENTER" ? f.x + f.w / 2 - (c.x + c.w / 2) : c.kind === "text" && f.align === "RIGHT" ? f.x + f.w - (c.x + c.w) : f.x - c.x);
const linesOf = (f) => (f.lh ? Math.round(f.h / f.lh) : 0);
const capLines = (c) => c.lines || (c.lh ? Math.round(c.h / c.lh) : 0);

// applies one list of operations in Figma (fonts loaded first for the text ones); returns what changed
const APPLY = (ops) => `
const ops = ${JSON.stringify(ops)};
const done = [];
const fontsOf = async (t) => { for (const f of t.getRangeAllFontNames(0, t.characters.length)) await figma.loadFontAsync(f); };
for (const o of ops) {
  const n = await figma.getNodeByIdAsync(o.id);
  if (!n) continue;
  if (o.op === "height") {
    // content keeps its place: only the bottom grows (a MIN-aligned column stays where it is)
    if (n.layoutMode === "VERTICAL") n.primaryAxisSizingMode = "FIXED";
    else if (n.layoutMode === "HORIZONTAL") n.counterAxisSizingMode = "FIXED";
    n.resize(n.width, o.h);
    done.push(o);
  } else if (o.op === "size") {
    // an image keeps the width its column gives it (FILL); a sublayer of an instance takes an override
    const al = n.parent && n.parent.layoutMode !== "NONE";
    const fillX = al && n.layoutSizingHorizontal === "FILL";
    try { if (al) n.layoutSizingVertical = "FIXED"; n.resize(fillX ? n.width : o.w, o.h); } catch {}
    // Figma ignores a resize on an instance sublayer: the image fills its column's height instead, and
    // the column (the instance itself, or a frame of its own) grows by the difference
    const p = n.parent, dh = o.h - n.height;
    if (Math.abs(dh) >= 1 && p && p.layoutMode === "VERTICAL" && (p.type === "INSTANCE" || !p.id.startsWith("I"))) {
      try { const h0 = p.height; p.primaryAxisSizingMode = "FIXED"; n.layoutSizingVertical = "FILL"; p.resize(p.width, h0 + dh); } catch {}
    }
    if (Math.abs(n.height - o.h) < 1) done.push(o);
  } else if (o.op === "bg") {
    n.fills = [{ type: "SOLID", color: { r: o.rgb[0] / 255, g: o.rgb[1] / 255, b: o.rgb[2] / 255 } }];
    done.push(o);
  } else if (o.op === "width") {
    await fontsOf(n);
    if (n.parent && n.parent.layoutMode !== "NONE") n.layoutSizingHorizontal = "FIXED";
    n.textAutoResize = "HEIGHT";
    n.resize(o.w, n.height);
    // Figma ignores the resize on a text nested in an atom instance inside an instance (circle: a card's
    // Heading, its main HUG at the first card's title width): when the captured width is the column's,
    // the text stack of the main component fills its column (text, atom, wrap), every instance follows
    if (Math.abs(n.width - o.w) > 1 && n.id.startsWith("I")) {
      const atom = (k) => k.type === "INSTANCE" && k.children.length === 1; // a text atom (Heading, Text) sized by its main
      let col = n.parent; while (col && (col.layoutSizingHorizontal === "HUG" || atom(col)) && col.parent && col.parent.type !== "PAGE") col = col.parent;
      const inner = col ? col.width - (col.paddingLeft || 0) - (col.paddingRight || 0) : 0;
      const segs = n.id.slice(1).split(";");
      const m = Math.abs(inner - o.w) <= 4 ? await figma.getNodeByIdAsync(segs.length > 2 ? "I" + segs.slice(1).join(";") : segs[1]) : null;
      if (m && m.type === "TEXT") {
        await fontsOf(m);
        const chain = []; for (let k = m; k && k.type !== "COMPONENT" && k.parent; k = k.parent) chain.unshift(k);
        if (chain[0] && chain[0].parent && chain[0].parent.type === "COMPONENT") for (const k of chain) if (k.parent.layoutMode === "VERTICAL") { k.layoutSizingHorizontal = "FILL"; if (k.type === "TEXT") k.textAutoResize = "HEIGHT"; }
        // the instance drops its own HUG overrides on that stack (an earlier pass may have set them)
        // outer layers first: a text set to FILL inside its still-FIXED atom keeps the atom's width
        const up = []; for (let k = n; k && k !== col; k = k.parent) up.unshift(k);
        for (const k of up) if (k.parent.layoutMode === "VERTICAL") try { k.layoutSizingHorizontal = "FILL"; } catch {}
      }
    }
    // a wrap that filled its row would keep the old width around the text
    let p = n.parent;
    if (Math.abs(n.width - o.w) <= 1 && n.layoutSizingHorizontal === "FILL") p = null;
    while (p && p.id !== ${JSON.stringify(root)} && p.children.length === 1 && p.layoutMode !== "NONE" && p.layoutSizingHorizontal === "FILL") { p.layoutSizingHorizontal = "HUG"; p = p.parent; }
    done.push(o);
  } else if (o.op === "lines") {
    await fontsOf(n);
    const lh = o.lh, want = o.lines, ls0 = o.ls ?? 0;
    const count = () => Math.round(n.height / lh);
    if (n.textAutoResize === "WIDTH_AND_HEIGHT") { const w = n.width; n.textAutoResize = "HEIGHT"; n.resize(w, n.height); }
    let best = null;
    for (let k = 1; k <= 12 && !best; k++) for (const s of [-1, 1]) {
      const v = Math.round((ls0 + s * k * 0.05) * 100) / 100;
      n.letterSpacing = { unit: "PIXELS", value: v };
      if (count() === want) { best = v; break; }
    }
    if (best === null) n.letterSpacing = { unit: "PIXELS", value: ls0 };
    else done.push({ ...o, ls: best });
  } else if (o.op === "align") {
    n.textAlignHorizontal = o.align;
    done.push(o);
  } else if (o.op === "pad") {
    const before = n[o.side];
    n[o.side] = Math.max(0, Math.round((n[o.side] + o.by) * 10) / 10);
    if (n[o.side] === before) continue; // a padding already at 0 cannot shrink: nothing changed, not a fix
    // space after a slot of fixed size: the slot grows by it, or the padding only squeezes its content
    const H = o.side === "paddingRight";
    if (o.grow && (H ? n.layoutSizingHorizontal : n.layoutSizingVertical) === "FIXED") {
      const d = n[o.side] - before;
      // an instance's sublayer resizes unreliably (ignored, or read back stale): the space goes to the
      // start of the next slot instead when that one hugs (it grows by it)
      const next = n.parent.children[n.parent.children.indexOf(n) + 1];
      const start = H ? "paddingLeft" : "paddingTop";
      if (n.id.startsWith("I") && next && "paddingLeft" in next && next.layoutMode !== "NONE" && (H ? next.layoutSizingHorizontal : next.layoutSizingVertical) === "HUG") {
        n[o.side] = before;
        next[start] = Math.max(0, next[start] + d);
      } else n.resize(n.width + (H ? d : 0), n.height + (H ? 0 : d));
    }
    done.push(o);
  } else if (o.op === "prim") {
    n.primaryAxisAlignItems = o.align;
    done.push(o);
  } else if (o.op === "center") {
    n.counterAxisAlignItems = "CENTER";
    done.push(o);
  } else if (o.op === "gap") {
    n.itemSpacing = Math.round((n.itemSpacing + o.by) * 10) / 10;
    done.push(o);
  } else if (o.op === "move") {
    // a layer inside an instance cannot move (relative-transform is not overridable): left to the rest
    try { n.x += o.dx; n.y += o.dy; done.push(o); } catch (e) {}
  }
}
return done;`;

// the frames named by the chains, with their auto-layout, for the place pass
const FRAMES = (ids) => `
const root = await figma.getNodeByIdAsync(${JSON.stringify(root)});
const out = {};
for (const id of ${JSON.stringify(ids)}) {
  const n = await figma.getNodeByIdAsync(id);
  if (!n) continue;
  const p = n.parent;
  const nb = n.absoluteBoundingBox, rb = root.absoluteBoundingBox;
  out[id] = { parent: p.id, pos: n.layoutPositioning, at: { x: nb.x - rb.x, y: nb.y - rb.y, w: nb.width, h: nb.height }, fillX: n.layoutSizingHorizontal === "FILL", fillY: n.layoutSizingVertical === "FILL", index: p.children.indexOf(n),
    mode: p.layoutMode, prim: p.primaryAxisAlignItems, cross: p.counterAxisAlignItems, gap: p.itemSpacing, kids: p.children.length,
    pt: p.paddingTop, pb: p.paddingBottom, pl: p.paddingLeft, pr: p.paddingRight,
    pbox: (() => { const a = p.absoluteBoundingBox, r = root.absoluteBoundingBox; return { x: a.x - r.x + p.paddingLeft, y: a.y - r.y + p.paddingTop, w: a.width - p.paddingLeft - p.paddingRight, h: a.height - p.paddingTop - p.paddingBottom }; })(),
    own: "paddingBottom" in n && n.layoutMode !== "NONE" ? { pt: n.paddingTop, pb: n.paddingBottom, pl: n.paddingLeft, pr: n.paddingRight } : null };
  // an auto-layout row is judged on all its children, the ones in place included (space-between gaps,
  // the padding after an unmoved sibling)
  if (p.layoutMode && p.layoutMode !== "NONE") out[id].sibs = p.children.filter((k) => k.visible).map((k) => { const b = k.absoluteBoundingBox; return { id: k.id, index: p.children.indexOf(k), at: { x: b.x - rb.x, y: b.y - rb.y, w: b.width, h: b.height }, pos: k.layoutPositioning, fillX: k.layoutSizingHorizontal === "FILL", fillY: k.layoutSizingVertical === "FILL", own: "paddingBottom" in k && k.layoutMode !== "NONE" }; });
}
return out;`;

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const fixed = [];
let fig = await rpc(READ, "fix · read");
// a part build (--part) or a section frame: its origin is not the capture's, the median offset is
const offset = (pairs) => (Math.abs(fig.w - cap.width) > 2
  ? { x: median(pairs.map(({ c, f }) => f.x - c.x)), y: median(pairs.map(({ c, f }) => f.y - c.y)) }
  : { x: 0, y: 0 });
let pairs = pair(fig);
console.log(`auto-fix: ${pairs.length}/${leaves.length} elements paired`);

// 0: the page frame itself (whole-page builds only)
const pageOps = [];
if (Math.abs(fig.w - cap.width) <= 2) {
  if (cap.height && fig.h < cap.height - TOL) pageOps.push({ op: "height", id: root, h: cap.height, why: `${Math.round(fig.h)} → ${cap.height} px` });
  const rgb = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(cap.canvas || "");
  if (rgb && (rgb[4] === undefined || Number(rgb[4]) === 1) && fig.solid) {
    const want = rgb.slice(1, 4).map(Number);
    const have = fig.fill || [255, 255, 255];
    if (want.some((v, i) => Math.abs(v - have[i]) > 3)) pageOps.push({ op: "bg", id: root, rgb: want, why: `${have.join(",")} → ${want.join(",")}` });
  }
}
if (pageOps.length && !dry) {
  fixed.push(...(await rpc(APPLY(pageOps), "fix · page")));
  fig = await rpc(READ, "fix · re-read"); // a centring frame moves its content as it grows
} else fixed.push(...pageOps);

// 1-3: image sizes (an instance keeps its main's image size), text boxes
const textOps = [];
for (const { c, f } of pairs) {
  if (c.kind === "img" && (Math.abs(f.h - c.h) >= TOL || (Math.abs(f.w - c.w) >= TOL && !f.fillX))) textOps.push({ op: "size", id: f.id, w: c.w, h: c.h, why: `${Math.round(f.w)}×${Math.round(f.h)} → ${c.w}×${c.h}` });
  if (c.kind !== "text") continue;
  const want = capLines(c);
  const width = c.tw ?? c.w;
  if (want && linesOf(f) !== want && Math.abs(f.w - width) > TOL && !f.text.includes("\n")) textOps.push({ op: "width", id: f.id, w: width, why: `${Math.round(f.w)} → ${width} px` });
  if (c.align && /^(left|right|center|justify|start|end)$/.test(c.align)) {
    const a = { left: "LEFT", start: "LEFT", right: "RIGHT", end: "RIGHT", center: "CENTER", justify: "JUSTIFIED" }[c.align];
    if (a !== f.align) textOps.push({ op: "align", id: f.id, align: a, why: `${f.align} → ${a}` });
  }
}
if (textOps.length) fixed.push(...(dry ? textOps : await rpc(APPLY(textOps), "fix · texts")));
if (textOps.length) fig = await rpc(READ, "fix · re-read");
pairs = pair(fig);
const lineOps = pairs
  .filter(({ c, f }) => c.kind === "text" && capLines(c) && f.lh && linesOf(f) !== capLines(c) && !f.text.includes("\n"))
  .map(({ c, f }) => ({ op: "lines", id: f.id, lh: f.lh, lines: capLines(c), ls: f.ls, why: `${linesOf(f)} → ${capLines(c)} lines` }));
if (lineOps.length && !dry) {
  fixed.push(...(await rpc(APPLY(lineOps), "fix · lines")));
  fig = await rpc(READ, "fix · re-read");
}

// 4: places, outer frames first: a slot (child of an auto-layout frame, or of a plain frame) moves by
// the median gap of the leaves it holds, minus what its parent moves by
for (let round = 0; round < ROUNDS; round++) {
  pairs = pair(fig);
  const o = offset(pairs);
  const gaps = pairs.map(({ c, f }) => ({ c, f, dx: dxOf(c, f) - o.x, dy: f.y - c.y - o.y }));
  const off = gaps.filter((g) => Math.abs(g.dx) >= TOL || Math.abs(g.dy) >= TOL);
  if (!off.length) break;
  const ids = [...new Set(off.flatMap((g) => g.f.chain))];
  const frames = await rpc(FRAMES(ids), "fix · frames");
  // the gap of a slot = median over the leaves under it
  const under = (id) => gaps.filter((g) => g.f.chain.includes(id));
  const shift = (id) => { const u = under(id); return { dx: median(u.map((g) => g.dx)), dy: median(u.map((g) => g.dy)) }; };
  // the outermost level that is off: deeper slots wait for the next round
  const depth = (id) => off.find((g) => g.f.chain.includes(id))?.f.chain.indexOf(id) ?? 99;
  const levels = ids.filter((id) => frames[id]).map((id) => ({ id, d: depth(id), ...frames[id], ...shift(id) }));
  // where a slot really sits: on an axis it fills (auto-layout), where its parent sits
  const placed = (id) => {
    if (id === root || !frames[id]) return { dx: 0, dy: 0 };
    const fr = frames[id], m = shift(id), al = fr.mode !== "NONE" && fr.pos !== "ABSOLUTE";
    const up = al && (fr.fillX || fr.fillY) ? placed(fr.parent) : null;
    return { dx: al && fr.fillX ? up.dx : m.dx, dy: al && fr.fillY ? up.dy : m.dy };
  };
  const parentShift = (fr) => placed(fr.parent);
  // a slot that fills an axis of an auto-layout parent cannot be off on it: its leaves are, one level down
  const offOn = (l) => { const p = parentShift(l), al = l.mode !== "NONE" && l.pos !== "ABSOLUTE"; return (Math.abs(l.dx - p.dx) >= TOL && !(al && l.fillX)) || (Math.abs(l.dy - p.dy) >= TOL && !(al && l.fillY)); };
  // a level whose gaps no op expresses (a slot of fixed size, a wrap) hands over to the next one down
  const lvls = [...new Set(levels.filter(offOn).map((l) => l.d))].sort((a, b) => a - b);
  if (!lvls.length) break;
  let ops = [];
  for (const level of lvls) {
  ops = [];
  const byParent = {};
  for (const l of levels.filter((l) => l.d === level)) (byParent[l.parent] ??= []).push(l);
  for (const [parent, slots] of Object.entries(byParent)) {
    const ps = parentShift(slots[0]);
    slots.sort((a, b) => a.index - b.index);
    for (const s of slots) { s.rx = s.dx - ps.dx; s.ry = s.dy - ps.dy; }
    const fr = slots[0];
    if (fr.mode === "NONE" || slots.every((s) => s.pos === "ABSOLUTE")) {
      for (const s of slots) if (Math.abs(s.rx) >= TOL || Math.abs(s.ry) >= TOL) ops.push({ op: "move", id: s.id, dx: -s.rx, dy: -s.ry, why: `${Math.round(s.rx)},${Math.round(s.ry)} px` });
      continue;
    }
    const V = fr.mode === "VERTICAL";
    // slots centred on one axis in the capture, around the parent's centre, in a parent that is not:
    // the parent centres them (paddings would copy the offsets, and break on the next edit)
    const crossFill = (s) => (V ? s.fillX : s.fillY);
    if (fr.cross !== "CENTER" && slots.some((s) => !crossFill(s))) {
      const mid = (s) => { const u = under(s.id).map((g) => (V ? g.c.x + g.c.w / 2 : g.c.y + g.c.h / 2)); return median(u); };
      const ms = slots.map(mid);
      const pc = V ? fr.pbox.x + fr.pbox.w / 2 : fr.pbox.y + fr.pbox.h / 2;
      if (ms.every((m) => Math.abs(m - ms[0]) <= 3) && Math.abs(ms[0] - pc - (V ? o.x : o.y)) <= 3) {
        ops.push({ op: "center", id: parent, why: `${slots.length} children centered on ${Math.round(ms[0])}` });
        continue;
      }
    }
    const main = (s) => (V ? s.ry : s.rx);
    const cross = (s) => (V ? s.rx : s.ry);
    // space-between spreads its children evenly; the capture's gaps are not even (a grid of columns, a
    // list pushed to the end): start-aligned, the smallest gap, the excess as the end padding of the slot before
    const fillMain = (s) => (V ? s.fillY : s.fillX);
    // children not off move with the parent: no gap of their own
    const sb = fr.sibs && fr.sibs.map((k) => slots.find((s) => s.id === k.id) || { ...k, rx: 0, ry: 0 });
    // (two children have one gap: never uneven, space-between stays)
    if (fr.prim === "SPACE_BETWEEN" && sb && sb.length > 2 && slots.some((s) => Math.abs(main(s)) >= TOL)
      && sb.every((s, i) => !fillMain(s) && s.pos !== "ABSOLUTE" && (i === sb.length - 1 || s.own))) {
      const slots = sb;
      const st = (s) => (V ? s.at.y : s.at.x) - main(s);
      const len = (s) => (V ? s.at.h : s.at.w);
      const gaps = slots.slice(1).map((s, i) => st(s) - (st(slots[i]) + len(slots[i])));
      const g = Math.max(0, Math.round(Math.min(...gaps)));
      ops.push({ op: "prim", id: parent, align: "MIN", why: `space-between → start, gaps ${gaps.map(Math.round).join("/")} px` });
      if (Math.abs(g - fr.gap) >= 0.5) ops.push({ op: "gap", id: parent, by: g - fr.gap, why: `gap ${g} px` });
      const by0 = st(slots[0]) - (V ? fr.pbox.y : fr.pbox.x);
      if (Math.abs(by0) >= 0.5) ops.push({ op: "pad", id: parent, side: V ? "paddingTop" : "paddingLeft", by: by0, why: `start ${Math.round(by0)} px` });
      gaps.forEach((x, i) => { if (x - g >= 0.5) ops.push({ op: "pad", id: slots[i].id, side: V ? "paddingBottom" : "paddingRight", by: x - g, grow: true, why: `after ${slots[i].id} ${Math.round(x)} px` }); });
      continue;
    }
    // main axis: the change of spacing before each slot (the first one: the parent's start padding)
    let prev = 0;
    let prevSlot = null;
    const k = fr.prim === "CENTER" ? 2 : 1;
    for (const s of sb || slots) {
      const by = -(main(s) - prev);
      if (Math.abs(by) >= TOL) {
        if (!prevSlot && s.index === 0) {
          if (fr.prim === "MAX") ops.push({ op: "pad", id: parent, side: V ? "paddingBottom" : "paddingRight", by: -by, why: `start ${Math.round(main(s))} px` });
          else ops.push({ op: "pad", id: parent, side: V ? "paddingTop" : "paddingLeft", by: by * k, why: `start ${Math.round(main(s))} px` });
        } else if (prevSlot && prevSlot.index === s.index - 1 && prevSlot.own) {
          ops.push({ op: "pad", id: prevSlot.id, side: V ? "paddingBottom" : "paddingRight", by, grow: true, why: `after ${prevSlot.id} ${Math.round(main(s) - prev)} px` });
        } else if (slots.length === fr.kids && slots.every((x, i) => i === 0 || Math.abs(-(main(x) - main(slots[i - 1])) - by) < TOL)) {
          ops.push({ op: "gap", id: parent, by, why: `gap ${Math.round(-by)} px` });
          break;
        }
      }
      prev = main(s);
      prevSlot = s;
    }
    // cross axis: a slot of its own (wrap) shifted sideways → its start padding; in a centring parent
    // a padding moves the content by half of it, so twice, or the end padding when the start would go negative
    for (const s of slots) {
      // a slot filling the cross axis cannot move sideways: what is off is inside it (next round)
      if (Math.abs(cross(s)) < TOL || !s.own || crossFill(s)) continue;
      const [a, b] = V ? ["paddingLeft", "paddingRight"] : ["paddingTop", "paddingBottom"];
      const start = V ? s.own.pl : s.own.pt;
      // a start padding cannot go below 0 (circle's footer column, 10 px left of a padding at 0): the op
      // would come back every round as a no-op and keep the deeper levels from their turn
      if (fr.cross !== "CENTER" && start - cross(s) < 0) continue;
      if (fr.cross !== "CENTER") ops.push({ op: "pad", id: s.id, side: a, by: -cross(s), why: `side ${Math.round(cross(s))} px` });
      else if (start - 2 * cross(s) >= 0) ops.push({ op: "pad", id: s.id, side: a, by: -2 * cross(s), why: `side ${Math.round(cross(s))} px (centered)` });
      else ops.push({ op: "pad", id: s.id, side: b, by: 2 * cross(s) - start, why: `side ${Math.round(cross(s))} px (centered)` }, { op: "pad", id: s.id, side: a, by: -start, why: "" });
    }
  }
  if (ops.length) break;
  }
  if (!ops.length) break;
  if (dry) { fixed.push(...ops); break; }
  fixed.push(...(await rpc(APPLY(ops), "fix · places")));
  fig = await rpc(READ, "fix · re-read");
}

// what stays off after the passes, with its node: the only thing worth a model's time
pairs = pair(fig);
const o = offset(pairs);
const rest = [];
for (const { c, f } of pairs) {
  const rdx = dxOf(c, f) - o.x, rdy = f.y - c.y - o.y;
  const dx = Math.round(rdx), dy = Math.round(rdy);
  const what = c.kind === "text" ? `"${f.text.replace(/\s+/g, " ").slice(0, 30)}"` : c.kind;
  if (Math.abs(rdx) >= TOL || Math.abs(rdy) >= TOL) rest.push(`${what} #${f.id} off by x ${dx} y ${dy} px (capture x ${c.x} y ${c.y} ${c.w}×${c.h})`);
  if (c.kind === "text" && capLines(c) && f.lh && linesOf(f) !== capLines(c)) rest.push(`${what} #${f.id} ${linesOf(f)} lines instead of ${capLines(c)}`);
}
const paired = new Set(pairs.map((p) => p.c.id));
for (const c of leaves.filter((c) => !paired.has(c.id)).slice(0, 10)) rest.push(`${c.kind} captured but not found in Figma (#${c.id} x ${c.x} y ${c.y} ${c.w}×${c.h})`);

const count = {};
for (const f of fixed) count[f.op] = (count[f.op] || 0) + 1;
const names = { prim: "distribution", size: "image size", height: "height", bg: "background", center: "centering", width: "width", lines: "lines", align: "alignment", pad: "padding", gap: "gap", move: "position" };
console.log(`auto-fix: ${fixed.length} fix(es)${fixed.length ? ` (${Object.entries(count).map(([k, v]) => `${names[k]} ${v}`).join(", ")})` : ""}${dry ? " [dry run]" : ""}`);
for (const f of fixed.slice(0, 12)) console.log(`  ${names[f.op]} #${f.id} : ${f.why}`);
writeFileSync(join(dir, "fix.json"), JSON.stringify({ fixed, rest }, null, 1));

if (!args.includes("--no-compare") && existsSync(join(dir, "page.jpg"))) {
  const cmp = join(dirname(fileURLToPath(import.meta.url)), "web-compare.mjs");
  execFileSync(process.execPath, [cmp, dir, "--file", file, "--root", root, "--fix"], { stdio: "inherit" });
}
console.log(rest.length ? `${rest.length} gap(s) left (${join(dir, "fix.json")}):` : "none left: no gap to the capture");
for (const r of rest.slice(0, 10)) console.log(`  ${r}`);
console.log(`auto-fix in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
