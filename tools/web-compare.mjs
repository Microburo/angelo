// Checks a Figma build against the page it came from: the root frame exported as JPG next to the
// page screenshot (page.jpg), compared band by band → drifts (height gaps) and content gaps, with
// the Figma frames they fall in, plus compare-<n>.jpg (page | Figma | gap) to look at and correct.
// Also checks the built texts: two texts drawn over each other in Figma is a layout miss even when
// the capture was right (a flow offset lost, a row collapsed onto its neighbour).
// --fix: the images the element contract (web-compare.py) found missing or empty in Figma are
// placed again, on the layer at their box, then the check runs once more.
// Usage: node tools/web-compare.mjs <case dir> --file <Figma file> --root <node id> [--fix]

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchImages, makeRpc } from "./web-lib.mjs";

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const [dir] = args;
const file = opt("--file");
const root = opt("--root");
if (!dir || !file || !root) throw new Error("usage: web-compare.mjs <case dir> --file <Figma file> --root <id>");
if (!existsSync(join(dir, "page.jpg"))) {
  console.log("check: no page.jpg, comparison skipped");
  process.exit(0);
}

const t0 = Date.now();
// 1x export, capped under the 16k texture limit; the frames, to find the blocks and name where gaps fall
const rpc = makeRpc(file, { quiet: true });
const check = async () => {
const out = await rpc(`
const root = await figma.getNodeByIdAsync(${JSON.stringify(root)});
if (!root) throw new Error("frame ${root} not found");
const scale = Math.min(1, 16000 / root.height);
const bytes = await root.exportAsync({ format: "JPG", constraint: { type: "SCALE", value: scale } });
const top = root.absoluteBoundingBox.y;
const frames = [];
const walk = (n, d) => {
  if (d > 12 || !("children" in n)) return;
  for (const k of n.children) {
    // an instance sublayer gone under its id (its main edited by the unused-component sweep, cos
    // coats) throws on any read: skipped, the check goes on
    try {
      if (!k.visible || !k.absoluteBoundingBox || !("children" in k)) continue;
      frames.push({ name: k.name, y: Math.round(k.absoluteBoundingBox.y - top), h: Math.round(k.height), d });
    } catch { continue; }
    walk(k, d + 1);
  }
};
walk(root, 1);
// visible texts with their box, for the stacked-text check: in paint order, a text under an
// opaque layer painted after it (a chat panel over a board) is hidden, not stacked
const ox = root.absoluteBoundingBox.x;
const box = (n) => { const b = n.absoluteBoundingBox; return { x: b.x - ox, y: b.y - top, w: b.width, h: b.height }; };
const solidFill = (n) => Array.isArray(n.fills) && n.fills.some((f) => f.visible !== false && (f.opacity ?? 1) >= 1 && (f.type === "IMAGE" || (f.type === "SOLID" && (f.color.a ?? 1) >= 1)));
const texts = [], covers = [], imgs = [], vecs = [], unread = [];
const r1 = (b) => [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)];
// a cover counts only where it shows: a layer cut by a clipping parent hides nothing past that parent
const within = (b, c) => { if (!c) return b; const x = Math.max(b.x, c.x), y = Math.max(b.y, c.y); return { x, y, w: Math.max(0, Math.min(b.x + b.w, c.x + c.w) - x), h: Math.max(0, Math.min(b.y + b.h, c.y + c.h) - y) }; };
const paint = (n, op, clip) => {
  if (!n.visible || !n.absoluteBoundingBox) return;
  op *= n.opacity ?? 1;
  if (op === 0) return;
  if (n.type === "TEXT") { if (n.characters.trim()) texts.push({ id: n.id, text: n.characters.trim().slice(0, 30), at: covers.length, ...box(n) }); return; }
  if (Array.isArray(n.fills) && n.fills.some((f) => f.visible !== false && f.type === "IMAGE")) imgs.push(r1(box(n)));
  if (/^(VECTOR|BOOLEAN_OPERATION|STAR|ELLIPSE|LINE|POLYGON)$/.test(n.type)) vecs.push(r1(box(n)));
  if (n !== root && op >= 1 && n.blendMode !== "MULTIPLY" && solidFill(n) && !(n.effects || []).some((e) => e.visible && e.type === "LAYER_BLUR")) covers.push(within(box(n), clip));
  if (!("children" in n)) return;
  const inner = n !== root && n.clipsContent ? within(box(n), clip) : clip;
  for (const k of n.itemReverseZIndex ? [...n.children].reverse() : n.children) { try { paint(k, op, inner); } catch { try { unread.push(r1(box(n))); } catch {} } } // a sublayer the API cannot read is still drawn: its parent's box stands for it
};
paint(root, 1);
const ar = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
for (const t of texts) t.hid = covers.slice(t.at).some((c) => ar(c, t) >= 0.5 * t.w * t.h);
return { jpg: figma.base64Encode(bytes), scale, frames, texts, imgs, vecs, unread };
`);
writeFileSync(join(dir, "figma.jpg"), Buffer.from(out.jpg, "base64"));
// the drawn leaves (images, vectors, texts), for the element-by-element contract in web-compare.py
const tx = out.texts.filter((t) => !t.hid).map((t) => [Math.round(t.x), Math.round(t.y), Math.round(t.w), Math.round(t.h)]);
writeFileSync(join(dir, "figma.json"), JSON.stringify({ scale: out.scale, frames: out.frames, imgs: out.imgs, vecs: out.vecs, texts: tx, unread: out.unread }));
const py = join(dirname(fileURLToPath(import.meta.url)), "web-compare.py");
execFileSync("python3", ["-I", py, dir], { stdio: "inherit" });
return out;
};
let out = await check();

// --fix: raster images only (an svg goes through the build's own slot path)
const redo = existsSync(join(dir, "redo.json")) ? JSON.parse(readFileSync(join(dir, "redo.json"), "utf8")) : [];
if (args.includes("--fix") && redo.length) {
  const f = fetchImages(redo.map((r) => ({ id: "redo" + r.id, src: r.src })), join(dir, "web-build-img", "redo"));
  const got = await Promise.all(redo.map((r) => f.get("redo" + r.id)));
  const B = redo.map((r, k) => got[k]?.url && { ...r, url: got[k].url }).filter(Boolean);
  const fixed = await rpc(`
const root = await figma.getNodeByIdAsync(${JSON.stringify(root)});
const ox = root.absoluteBoundingBox.x, oy = root.absoluteBoundingBox.y;
const B = ${JSON.stringify(B)};
// a sublayer gone under its id throws on any read: left out
const all = root.findAll((n) => { try { return n.visible && n.type !== "TEXT" && "fills" in n && !!n.absoluteBoundingBox; } catch { return false; } });
let n = 0;
for (const r of B) {
  // the build's own slot by name first (an image in an instance keeps its main's size, so its
  // geometry may differ from the box), else the deepest layer drawn at the box (±3 px)
  const at = all.find((k) => k.name === "img:" + r.id) || all.filter((k) => { const a = k.absoluteBoundingBox; return Math.abs(a.x - ox - r.x) <= 3 && Math.abs(a.y - oy - r.y) <= 3 && Math.abs(a.width - r.w) <= 3 && Math.abs(a.height - r.h) <= 3; }).pop();
  if (!at) continue;
  const im = figma.createImage(new Uint8Array(await (await fetch(r.url)).arrayBuffer()));
  at.fills = [{ type: "IMAGE", imageHash: im.hash, scaleMode: "FILL" }];
  n++;
}
return n;`);
  console.log(`redo: ${fixed} image(s) placed again out of ${redo.length} (${redo.length - B.length} not downloadable or svg)`);
  if (fixed) out = await check();
}

// texts over each other in Figma: overlap ≥ half of the smaller one (a badge beside a label or a
// kicker merged into its headline never gets there)
const area = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const ts = out.texts.filter((t) => !t.hid);
const stacked = ts.flatMap((a, i) => ts.slice(i + 1).filter((b) => a.text !== b.text && area(a, b) >= 0.5 * Math.min(a.w * a.h, b.w * b.h)).map((b) => [a, b]));
if (stacked.length) {
  console.log(`stacked texts in Figma: ${stacked.length}`);
  for (const [a, b] of stacked.slice(0, 10)) console.log(`  y ${Math.round(a.y)} — "${a.text}" (${a.id}) / "${b.text}" (${b.id})`);
} else console.log("stacked texts in Figma: none");
// an image in an instance placed with another scale mode than its main (a texture reused from an
// earlier build: TILE in the main, stretched FILL in the instance → grain several times coarser)
const modes = await rpc(`const r = await figma.getNodeByIdAsync(${JSON.stringify(root)}); const bad = [];
// a sublayer gone under its id throws on any read: left out
const img = (n) => { try { return n.id.startsWith("I") && Array.isArray(n.fills) && n.fills.some((f) => f.type === "IMAGE"); } catch { return false; } };
for (const n of r.findAll(img)) {
  const m = await figma.getNodeByIdAsync(n.id.split(";").pop());
  const a = n.fills.find((f) => f.type === "IMAGE"), b = m && Array.isArray(m.fills) && m.fills.find((f) => f.type === "IMAGE");
  if (b && (a.scaleMode !== b.scaleMode || (a.scalingFactor ?? 1) !== (b.scalingFactor ?? 1))) bad.push(n.id + " " + a.scaleMode + " / main " + b.scaleMode);
}
return bad;`);
console.log(modes.length ? `instance images outside their main's mode: ${modes.length}\n  ${modes.slice(0, 5).join("\n  ")}` : "instance images outside their main's mode: none");
// a positioned layer set to stretch along an axis it hugs can't stretch: Figma moves it by half its
// parent's growth (a hero photo 7 px below its block's top once a title grew)
const slid = await rpc(`const r = await figma.getNodeByIdAsync(${JSON.stringify(root)});
const bad = (n) => { try { return n.layoutPositioning === "ABSOLUTE" && ((n.constraints.vertical === "STRETCH" && n.layoutSizingVertical === "HUG") || (n.constraints.horizontal === "STRETCH" && n.layoutSizingHorizontal === "HUG")); } catch { return false; } };
return r.findAll(bad).map((n) => n.name + " " + n.id);`);
console.log(slid.length ? `absolute layers stretched on an axis that hugs: ${slid.length}\n  ${slid.slice(0, 5).join("\n  ")}` : "absolute layers stretched on an axis that hugs: none");
// full radii, the whole class: every captured box whose radius is full (CSS 9999, or >= half its
// smaller side) must read 999 in Figma wherever a visible node sits on it; a pill clamped to half its
// height (20 on 40) breaks as soon as the box is resized. --fix sets 999 on them, instances included
{
  const cp = join(dir, "capture.json");
  const src = [];
  if (existsSync(cp)) {
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== "object") return;
      if (["x", "y", "w", "h", "r"].every((k) => typeof n[k] === "number") && n.r > 0 && n.w >= 8 && n.h >= 8 && n.x > -5000 && n.r >= Math.min(n.w, n.h) / 2 - 1) src.push([n.x, n.y, n.w, n.h]);
      Object.values(n).forEach(walk);
    };
    walk(JSON.parse(readFileSync(cp, "utf8")));
  }
  const radii = async (fix) => rpc(`const root = await figma.getNodeByIdAsync(${JSON.stringify(root)}); const b = root.absoluteBoundingBox;
const nodes = root.findAll((n) => { try { return typeof n.cornerRadius === "number" && n.absoluteBoundingBox; } catch { return false; } });
const shown = (n) => { for (let p = n; p && p.id !== root.id; p = p.parent) if (p.visible === false) return false; return true; };
const live = nodes.filter(shown).map((n) => ({ n, a: n.absoluteBoundingBox }));
const seen = new Set(), bad = []; let matched = 0;
for (const [x, y, w, h] of ${JSON.stringify(src)}) {
  const hit = live.filter(({ a }) => Math.abs(a.x - b.x - x) <= 2 && Math.abs(a.y - b.y - y) <= 2 && Math.abs(a.width - w) <= 2 && Math.abs(a.height - h) <= 2);
  if (hit.length) matched++;
  for (const { n } of hit) if (n.cornerRadius > 0 && n.cornerRadius !== 999 && !seen.has(n.id)) { seen.add(n.id); bad.push(n.id + " " + n.name + " " + n.cornerRadius + "/" + Math.round(h)); if (${!!fix}) {
    // the master first (an instance inherits it), the instance itself only if it still reads otherwise
    const m = n.type === "INSTANCE" ? await n.getMainComponentAsync() : n.id.startsWith("I") ? await figma.getNodeByIdAsync(n.id.split(";").pop()) : null;
    if (m && typeof m.cornerRadius === "number" && m.cornerRadius >= Math.min(m.width, m.height) / 2 - 1) m.cornerRadius = 999;
    if (n.cornerRadius !== 999) n.cornerRadius = 999;
  } }
}
return { matched, bad };`);
  if (src.length) {
    let r = await radii(false);
    console.log(`full radii: ${src.length} boxes captured, ${r.matched} found in Figma, ${r.bad.length} not at 999`);
    if (r.bad.length) console.log("  " + r.bad.slice(0, 12).join("\n  "));
    if (r.bad.length && args.includes("--fix")) {
      await radii(true);
      r = await radii(false);
      console.log(`full radii after --fix: ${r.bad.length} not at 999`);
    }
  }
}
console.log(`check in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
