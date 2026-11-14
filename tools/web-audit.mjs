// A documentation page's components in Figma against their capture, example by example, read only: the source is the reference.
// Every painted box of the capture that holds text or icons is looked up in the variant (nearest painted ancestor of the same
// leaf), then its height, width and insets are compared; then every leaf's place inside the example. Width and insets allow what
// a larger font size explains (library type rule). Run after every treatment on a library.
// Usage: node tools/web-audit.mjs --list <slugs.txt> --out <dir> --label <frame prefix> [--skip "<regex>"] [--slug <one>] [--report <file.json>]

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { makeRpc, pluginFile } from "./web-lib.mjs";
import { cased } from "./web-items.mjs";

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const [list, out, label, skip, one] = [opt("--list"), opt("--out"), opt("--label"), opt("--skip"), opt("--slug")];
const report = opt("--report") || join(out, "audit.json");
const skipRe = skip ? new RegExp(skip, "i") : null;
const slugs = one ? [one] : readFileSync(list, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
const rpc = makeRpc(await pluginFile());

const norm = (s) => String(s).replace(/\s+/g, " ").trim();
const paints = (b) => !!(b.bg || (b.border && b.border.w) || (b.shadow && (b.shadow.blur || b.shadow.spread || b.shadow.x || b.shadow.y)));

// the capture's examples, in order: their leaves and painted boxes, in the page's coordinates
const expected = (cap) => {
  const byId = new Map(cap.boxes.map((b) => [String(b.id), b]));
  const up = (b) => byId.get(String(b.p));
  const hostOf = (b) => { for (let n = b; n; n = up(n)) if (n.block) { let top = n; for (let q = up(n); q; q = up(q)) if (q.block) top = q; return top; } return null; };
  const blocks = new Map();
  for (const b of cap.boxes) if (b.block && hostOf(b) === b) blocks.set(b, { name: String(b.block).replace(/\s*#$/, ""), leaves: [], boxes: new Map() });
  for (const b of cap.boxes) {
    const leaf = b.img === "svg" || b.svg ? "icon" : b.text ? "text" : null;
    if (!leaf) continue;
    const host = hostOf(b);
    if (!host || !blocks.has(host)) continue;
    const e = blocks.get(host);
    // (a text's ink comes from its lines: tx/tw are the box's content width)
    const ink = b.lines?.length ? { x: Math.min(...b.lines.map((q) => q.x)), w: Math.max(...b.lines.map((q) => q.x + q.w)) - Math.min(...b.lines.map((q) => q.x)) } : { x: b.tx ?? b.x, w: b.tw ?? b.w };
    const l = leaf === "text"
      ? { kind: "text", text: norm(cased(b.text, b.font?.transform)), ...ink, y: b.y, h: b.h, size: b.font?.size || 14, ink: !!b.lines?.length, many: (b.lines?.length || 1) > 1 }
      : { kind: "icon", x: b.x, w: b.w, y: b.y, h: b.h };
    e.leaves.push(l);
    for (let n = b; n; n = up(n)) {
      if (paints(n) && n.h > 0) {
        if (!e.boxes.has(n)) e.boxes.set(n, { x: n.x, y: n.y, w: n.w, h: n.h, leaves: [] });
        e.boxes.get(n).leaves.push(l);
        break;
      }
      if (n === host) break;
    }
  }
  return [...blocks.values()].filter((e) => !(skipRe && skipRe.test(e.name)));
};

// the variants' geometry, leaves and painted ancestors (a stale instance sublayer reads as nothing)
const read = (name, from, count) => rpc(`
let root = null;
for (const p of figma.root.children) { await p.loadAsync(); root = p.children.find((n) => n.type === "FRAME" && n.name === ${JSON.stringify(name)}); if (root) break; }
const held = root ? root.children.find((k) => k.type === "COMPONENT" || k.type === "COMPONENT_SET") : null;
if (!held) return null;
const all = held.type === "COMPONENT_SET" ? held.children : [held];
const seen = (l) => (l === figma.mixed ? [] : l || []).filter((p) => p.visible !== false);
const SHAPE = new Set(["VECTOR", "BOOLEAN_OPERATION", "ELLIPSE", "LINE", "POLYGON", "STAR", "RECTANGLE"]);
const isIcon = (n) => { if (SHAPE.has(n.type)) return n.width <= 64 && n.height <= 64; if (!n.children || !n.children.length || n.width > 64 || n.height > 64 || n.layoutMode && n.layoutMode !== "NONE") return false; return n.children.every(isIcon); };
const shot = (v) => {
  const b0 = v.absoluteBoundingBox, nodes = [];
  const walk = (n, parent) => {
    let e;
    try {
      if (!n.visible) return;
      const b = n.absoluteBoundingBox;
      if (!b) return;
      e = { i: nodes.length, p: parent, id: n.id, name: n.name, x: b.x - b0.x, y: b.y - b0.y, w: b.width, h: b.height, painted: seen(n.fills).length > 0 || seen(n.strokes).length > 0 };
      if (n.type === "TEXT") { e.text = n.characters.replace(/\\s+/g, " ").trim(); e.size = n.fontSize === figma.mixed ? 0 : n.fontSize; e.hug = n.textAutoResize === "WIDTH_AND_HEIGHT"; }
      else if (n !== v && isIcon(n)) e.icon = 1;
      nodes.push(e);
      if (e.icon || !n.children) return;
      for (const k of n.children) walk(k, e.i);
    } catch {}
  };
  walk(v, -1);
  return { name: v.name, w: b0.width, h: b0.height, nodes };
};
return { total: all.length, shots: all.slice(${from}, ${from + count}).map(shot) };`);

const bbox = (l) => ({ x: Math.min(...l.map((q) => q.x)), y: Math.min(...l.map((q) => q.y)), r: Math.max(...l.map((q) => q.x + q.w)), b: Math.max(...l.map((q) => q.y + q.h)) });
const round = (v) => Math.round(v * 10) / 10;

const audit = (block, shot) => {
  const issues = [];
  const texts = shot.nodes.filter((n) => n.text !== undefined), icons = shot.nodes.filter((n) => n.icon);
  const used = new Set();
  const iconsAlike = icons.length === block.leaves.filter((l) => l.kind === "icon").length;
  let iconAt = 0;
  for (const l of block.leaves) {
    if (l.kind === "icon") { l.fig = iconsAlike ? icons[iconAt++] : null; continue; }
    l.fig = texts.find((n) => !used.has(n.i) && n.text === l.text) || null;
    if (l.fig) used.add(l.fig.i);
    else if (!texts.some((n) => n.text.includes(l.text))) issues.push({ kind: "text absent", text: l.text });
  }
  if (!iconsAlike) issues.push({ kind: "icons", cap: block.leaves.filter((l) => l.kind === "icon").length, fig: icons.length });
  // what the text's own width explains (another font, a larger size)
  const slack = (ls) => Math.max(0, ...ls.map((l) => (!l.fig || l.kind !== "text" ? 0 : l.ink && l.fig.hug ? Math.abs(l.fig.w - l.w) : l.size && l.fig.size ? l.w * Math.abs(l.fig.size / l.size - 1) : 0)));

  for (const c of block.boxes.values()) {
    const matched = c.leaves.filter((l) => l.fig);
    if (!matched.length) continue;
    let f = shot.nodes[matched[0].fig.p];
    while (f && !f.painted) f = shot.nodes[f.p];
    const tag = matched[0].kind === "text" ? matched[0].text.slice(0, 32) : "icon";
    if (!f) { issues.push({ kind: "box missing", leaf: tag, cap: [c.w, c.h] }); continue; }
    const inside = matched.filter((l) => { for (let n = l.fig; n; n = shot.nodes[n.p]) if (n === f) return true; return false; });
    const [cb, fb] = [bbox(inside), bbox(inside.map((l) => l.fig))];
    const want = { h: c.h, w: c.w, l: cb.x - c.x, r: c.x + c.w - cb.r };
    const got = { h: f.h, w: f.w, l: fb.x - f.x, r: f.x + f.w - fb.r };
    const tol = 1.5 + slack(inside);
    const bad = [];
    // (a taller box of several lines follows the line height: only a control's height is the source's)
    if (c.h <= 64 && !c.leaves.some((l) => l.many) && new Set(c.leaves.map((l) => Math.round(l.y + l.h / 2))).size === 1 && Math.abs(want.h - got.h) > 1.5) bad.push("h");
    if (Math.abs(want.w - got.w) > tol) bad.push("w");
    // (a text box wider than its ink says nothing about the side it doesn't start from: only an end leaf that hugs or an icon counts)
    const ends = (edge) => inside.filter((l) => Math.abs((edge === "l" ? l.x : l.x + l.w) - (edge === "l" ? cb.x : cb.r)) < 1).every((l) => l.kind === "icon" || (l.fig.hug && l.ink));
    if (ends("l") && Math.abs(want.l - got.l) > tol) bad.push("l");
    if (ends("r") && Math.abs(want.r - got.r) > tol) bad.push("r");
    // what a fix needs: a lone text sitting in its padding hugs in the source; its width difference comes on top of the source's
    const lone = inside.length === 1 && c.leaves.length === 1 && inside[0].kind === "text" && inside[0].ink;
    const hugs = lone && Math.abs(want.l - want.r) <= 2 && want.l <= 32;
    if (bad.length) issues.push({ kind: "box", leaf: tag, id: f.id, name: f.name, bad, hugs, lastIcon: inside.some((l) => l.kind === "icon" && Math.abs(l.x + l.w - cb.r) < 1), cap: { h: round(want.h), w: round(want.w), l: round(want.l), r: round(want.r) }, fig: { h: round(got.h), w: round(got.w), l: round(got.l), r: round(got.r) } });
  }

  const placed = block.leaves.filter((l) => l.fig);
  if (placed.length > 1) {
    const [cb, fb] = [bbox(placed), bbox(placed.map((l) => l.fig))];
    for (const l of placed) {
      const tol = 2 + slack(placed);
      const left = l.x - cb.x - (l.fig.x - fb.x);
      const mid = l.x + l.w / 2 - cb.x - (l.fig.x + l.fig.w / 2 - fb.x);
      const right = l.x + l.w - cb.x - (l.fig.x + l.fig.w - fb.x);
      const dx = Math.min(Math.abs(left), Math.abs(mid), Math.abs(right));
      // (from the top centre line: a text's box height follows its line height, not its place)
      const dy = l.y + l.h / 2 - Math.min(...placed.map((q) => q.y + q.h / 2)) - (l.fig.y + l.fig.h / 2 - Math.min(...placed.map((q) => q.fig.y + q.fig.h / 2)));
      if (dx > tol || Math.abs(dy) > 3 + placed.length / 4) issues.push({ kind: "place", leaf: l.kind === "text" ? l.text.slice(0, 32) : "icon", id: l.fig.id, dx: round(dx), dy: round(dy) });
    }
  }
  return issues;
};

const tally = {};
const pages = [];
const t0 = Date.now();
for (const slug of slugs) {
  const file = join(out, slug, "capture.json");
  if (!existsSync(file)) continue;
  const blocks = expected(JSON.parse(readFileSync(file, "utf8")));
  const page = { slug, variants: [], blocks: blocks.length };
  let total = null;
  for (let i = 0; i < blocks.length; i++) {
    const r = await read(`${label} · ${slug}`, i, 1);
    if (!r) { page.missing = true; break; }
    total = r.total;
    if (!r.shots[0]) { page.variants.push({ name: blocks[i].name, issues: [{ kind: "variant missing" }] }); continue; }
    const issues = audit(blocks[i], r.shots[0]);
    for (const q of issues) tally[q.kind] = (tally[q.kind] || 0) + 1;
    if (issues.length) page.variants.push({ name: r.shots[0].name, source: blocks[i].name, issues });
  }
  page.total = total;
  pages.push(page);
  const n = page.variants.reduce((a, v) => a + v.issues.length, 0);
  console.log(`${slug} : ${page.missing ? "no component" : n + " gaps, " + page.variants.length + "/" + blocks.length + " examples"}`);
}
writeFileSync(report, JSON.stringify(pages, null, 1));
console.log(JSON.stringify({ pages: pages.length, ...tally, ms: Date.now() - t0 }));
