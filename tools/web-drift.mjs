#!/usr/bin/env node
// Where a built page drifts from its capture: pairs each captured text with the same text in Figma,
// prints the vertical and horizontal offset per band of the page, the bands where the offset changes
// first. Read-only, ~1 s.
// Usage: node tools/web-drift.mjs tests/web/<case> --file <name> --root <id> [--band 100] [--list y0,y1]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeRpc } from "./web-lib.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dir = args[0];
const file = opt("--file");
const root = opt("--root");
const band = +opt("--band", 100);
const list = opt("--list")?.split(",").map(Number);
if (!dir || !file || !root) throw new Error("usage: web-drift.mjs <case dir> --file <name> --root <id> [--band 100] [--list y0,y1]");

const cap = JSON.parse(readFileSync(join(dir, "capture.json"), "utf8"));
const norm = (s) => String(s).replace(/\s+/g, " ").trim();
const texts = (cap.texts || cap.boxes).flatMap((b) => {
  const s = b.text ?? b.txt ?? (b.runs || []).map((r) => r.text ?? r.t ?? "").join("");
  return norm(s) ? [{ s: norm(s), x: b.x, y: b.y, w: b.w, h: b.h }] : [];
});

const rpc = makeRpc(file);
const figma = await rpc(`
const root = await figma.getNodeByIdAsync(${JSON.stringify(root)});
const rb = root.absoluteTransform;
const out = [];
const walk = (n) => {
  let kids = [];
  try { kids = "children" in n ? n.children : []; } catch (e) { return; }
  for (const c of kids) {
    try {
      if (!c.visible) continue;
      if (c.type === "TEXT") {
        const a = c.absoluteTransform;
        out.push({ s: c.characters, x: a[0][2] - rb[0][2], y: a[1][2] - rb[1][2], w: c.width, h: c.height, id: c.id });
      } else walk(c);
    } catch (e) {}
  }
};
walk(root);
return out;
`);

const used = new Set();
const pairs = [];
for (const t of texts.sort((a, b) => a.y - b.y)) {
  let best = null;
  for (const f of figma) {
    if (used.has(f.id) || norm(f.s) !== t.s) continue;
    const d = Math.abs(f.x - t.x) + Math.abs(f.y + f.h / 2 - (t.y + t.h / 2));
    if (d < 60 && (!best || d < best.d)) best = { f, d };
  }
  if (!best) continue;
  used.add(best.f.id);
  pairs.push({ s: t.s, x: t.x, y: t.y, id: best.f.id, dx: best.f.x - t.x, dy: best.f.y + best.f.h / 2 - (t.y + t.h / 2) });
}

const median = (v) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
console.log(`${pairs.length} texts paired of ${texts.length} captured, ${figma.length} in Figma`);
const bands = new Map();
for (const p of pairs) {
  const k = Math.floor(p.y / band) * band;
  (bands.get(k) || bands.set(k, []).get(k)).push(p);
}
for (const k of [...bands.keys()].sort((a, b) => a - b)) {
  const b = bands.get(k);
  const dy = b.map((p) => p.dy);
  const dx = b.map((p) => p.dx);
  console.log(`y ${String(k).padStart(5)} n ${String(b.length).padStart(3)}  dy ${median(dy).toFixed(1).padStart(6)} [${Math.min(...dy).toFixed(1)} ${Math.max(...dy).toFixed(1)}]  dx ${median(dx).toFixed(1).padStart(6)} [${Math.min(...dx).toFixed(1)} ${Math.max(...dx).toFixed(1)}]`);
}
// --frames: the frames whose height differs from their captured box, outermost first: what moves the rest
if (args.includes("--frames")) {
  const frames = await rpc(`
const root = await figma.getNodeByIdAsync(${JSON.stringify(root)});
const rb = root.absoluteTransform;
const out = [];
const walk = (n, d) => {
  let kids = [];
  try { kids = "children" in n ? n.children : []; } catch (e) { return; }
  for (const c of kids) {
    try {
      if (!c.visible || c.type === "TEXT" || c.type === "VECTOR" || c.layoutPositioning === "ABSOLUTE") continue;
      const a = c.absoluteTransform;
      out.push({ id: c.id, name: c.name, type: c.type, d, x: a[0][2] - rb[0][2], y: a[1][2] - rb[1][2], w: c.width, h: c.height, mode: c.layoutMode, sh: c.layoutSizingVertical, n: "children" in c ? c.children.length : 0 });
      walk(c, d + 1);
    } catch (e) {}
  }
};
walk(root, 0);
return out;
`);
  const boxes = cap.boxes.filter((b) => b.w >= 8 && b.h >= 8);
  for (const f of frames) {
    let best = null;
    for (const b of boxes) {
      if (Math.abs(b.x - f.x) > 3 || Math.abs(b.w - f.w) > 3 || Math.abs(b.y - f.y) > 14) continue;
      const d = Math.abs(b.h - f.h) * 2 + Math.abs(b.y - f.y);
      if (!best || d < best.d) best = { b, d };
    }
    if (!best) continue;
    const dh = f.h - best.b.h;
    if (Math.abs(dh) < 1) continue;
    console.log(`${"  ".repeat(Math.min(f.d, 10))}${f.id} ${f.type[0]} "${String(f.name).slice(0, 22)}" y ${best.b.y}→${f.y.toFixed(1)} h ${best.b.h}→${f.h.toFixed(1)} (${dh > 0 ? "+" : ""}${dh.toFixed(1)}) ${f.mode} ${f.sh} kids ${f.n}`);
  }
}
if (list) {
  for (const p of pairs.filter((q) => q.y >= list[0] && q.y < list[1])) {
    console.log(`  ${Math.round(p.x)},${Math.round(p.y)} dx ${p.dx.toFixed(1)} dy ${p.dy.toFixed(1)} ${p.id} ${p.s.slice(0, 40)}`);
  }
}
