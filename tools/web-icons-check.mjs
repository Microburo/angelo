// Per example of a documentation page: the Lucide icons the capture holds against the Icon instances the Figma variant shows.
// --fix: each captured icon is looked up by position, and what sits there takes the right Icon and size, in place (--dry: only says so).
// Usage: node tools/web-icons-check.mjs --list <slugs.txt> --out <dir> --label <frame prefix> [--skip "<regex>"] [--slug <one>] [--fix] [--dry]

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { makeRpc, pluginFile } from "./web-lib.mjs";

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const [list, out, label, skip, one] = [opt("--list"), opt("--out"), opt("--label"), opt("--skip"), opt("--slug")];
const [fix, dry] = [args.includes("--fix"), args.includes("--dry")];
const rpc = makeRpc(await pluginFile());
const WAYS = ["left", "up", "right", "down"];
const canon = (n) => n.replace(/([a-z])(\d)/g, "$1-$2").replace(/\b(left|right)-(up|down)\b/g, "$2-$1");
const skipRe = skip ? new RegExp(skip, "i") : null;

// the capture's examples, in order: [{ name, icons: ["name@size"], spots: [{ name, x, y, w, h, spin }] }], x/y from the example's corner
const expected = (cap) => {
  const byId = new Map(cap.boxes.map((b) => [String(b.id), b]));
  const blockOf = (b) => { for (let n = b; n; n = byId.get(String(n.p))) if (n.block) return n; return null; };
  const blocks = [];
  const seen = new Map();
  for (const b of cap.boxes) if (b.block && !blockOf(byId.get(String(b.p)) || {})) { const e = { name: String(b.block).replace(/\s*#$/, ""), icons: [], spots: [] }; blocks.push(e); seen.set(b, e); }
  for (const b of cap.boxes) {
    if (typeof b.svg !== "string" || !/class="[^"]*\blucide-/.test(b.svg)) continue;
    const host = blockOf(b);
    if (!host || !seen.has(host)) continue;
    const steps = (+(/\sdata-rot="(\d+)"/.exec(b.svg)?.[1]) || 0) / 90;
    const raw = /\blucide-([a-z0-9-]+)/.exec(b.svg)[1];
    // (no direction in its name: no icon of the set draws it turned)
    const name = canon(steps ? raw.replace(/\b(left|up|right|down)\b/g, (d) => WAYS[(WAYS.indexOf(d) + steps) % 4]) : raw);
    seen.get(host).icons.push(name + "@" + Math.round(b.w));
    seen.get(host).spots.push({ name, x: b.x - host.x, y: b.y - host.y, w: b.w, h: b.h, spin: /animate-spin|loader/.test(b.svg) });
  }
  return blocks.filter((e) => !(skipRe && skipRe.test(e.name)));
};

const bag = (xs) => { const m = new Map(); for (const x of xs) m.set(x, (m.get(x) || 0) + 1); return m; };
const minus = (a, b) => { const out = []; for (const [k, v] of bag(a)) for (let i = (bag(b).get(k) || 0); i < v; i++) out.push(k); return out; };

// the frame on whichever page holds it (the user browses Figma meanwhile), and its component
const findRoot = (name) => `
let root = null;
for (const p of figma.root.children) {
  await p.loadAsync();
  root = p.children.find((n) => n.type === "FRAME" && n.name === ${JSON.stringify(name)});
  if (root) break;
}
const held = root ? root.children.find((k) => k.type === "COMPONENT" || k.type === "COMPONENT_SET") : null;`;

// what sits at each captured icon's place in one variant, set right
const repair = (name, index, spots) => rpc(`
${findRoot(name)}
if (!held) return { log: [] };
const v = (held.type === "COMPONENT_SET" ? held.children : [held])[${index}];
if (!v) return { log: [] };
const lib = figma.root.children.find((p) => /lucide/i.test(p.name));
await lib.loadAsync();
const mains = {};
for (const c of lib.findAllWithCriteria({ types: ["COMPONENT"] })) if (c.name.startsWith("Icon / ")) mains[c.name.slice(7)] = c;
const dry = ${dry}, log = [];
const o = v.absoluteTransform;
const safe = (f) => { try { return f(); } catch { return null; } };
const mainOf = async (n) => { try { return await n.getMainComponentAsync(); } catch { return null; } };
const SHAPE = new Set(["VECTOR", "ELLIPSE", "RECTANGLE", "LINE", "POLYGON", "STAR", "BOOLEAN_OPERATION"]);
const drawing = (n) => n.children && n.children.length > 0 && n.children.every((k) => SHAPE.has(k.type) || ((k.type === "GROUP" || k.type === "FRAME") && drawing(k)));
const paintOf = (n) => { for (const k of n.findAll((x) => SHAPE.has(x.type))) { if (k.strokes && k.strokes.length) return k.strokes[0]; if (k.fills && k.fills.length) return k.fills[0]; } return null; };
const inInstance = (n) => { for (let p = n.parent; p && p.type !== "PAGE"; p = p.parent) if (p.type === "INSTANCE") return true; return false; };
for (const s of ${JSON.stringify(spots)}) {
  let hit = null, best = 1e9;
  const walk = async (n) => {
    const box = safe(() => n.absoluteBoundingBox);
    if (!box || !safe(() => n.visible)) return;
    const [x, y] = [box.x - o[0][2], box.y - o[1][2]];
    const off = x > s.x + s.w + 8 || x + box.width < s.x - 8 || y > s.y + s.h + 8 || y + box.height < s.y - 8;
    // (a box that doesn't clip can hold a child hanging past it: a carousel's arrows)
    if (off && (!n.children || n.clipsContent)) return;
    let icon = false;
    if (n.type === "INSTANCE") { const m = await mainOf(n); icon = !!(m && m.name.startsWith("Icon / ")); }
    if (icon || (n.type !== "COMPONENT" && Math.abs(box.width - s.w) <= 5 && Math.abs(box.height - s.h) <= 5 && drawing(n))) {
      const d = Math.abs(x + box.width / 2 - s.x - s.w / 2) + Math.abs(y + box.height / 2 - s.y - s.h / 2);
      if (d < best && d <= 10) { best = d; hit = n; }
      return;
    }
    if (n.children) for (const k of n.children) await walk(k);
  };
  await walk(v);
  if (!hit) { log.push("nothing in place of " + s.name + "@" + Math.round(s.w) + " " + Math.round(s.x) + "," + Math.round(s.y)); continue; }
  const m = hit.type === "INSTANCE" ? await mainOf(hit) : null;
  const was = m && m.name.startsWith("Icon / ") ? m.name.slice(7) : hit.type + ":" + hit.name;
  const wrongSize = !s.spin && Math.abs(hit.width - s.w) > 1;
  if (was === s.name && !wrongSize) continue;
  const main = mains[s.name];
  if (!main) { log.push("missing from the file: " + s.name); continue; }
  log.push(was + "@" + Math.round(hit.width) + " → " + s.name + "@" + Math.round(s.w));
  if (dry) continue;
  const p = paintOf(hit);
  const [w, h] = s.spin ? [hit.width, hit.height] : [s.w, s.h];
  if (hit.type === "INSTANCE") {
    if (was !== s.name) hit.swapComponent(main);
    hit.name = s.name;
    if (Math.abs(hit.width - w) > 0.5 || Math.abs(hit.height - h) > 0.5) hit.resize(w, h);
    if (p) for (const k of hit.findAll((x) => x.type === "VECTOR")) k.fills = [JSON.parse(JSON.stringify(p))];
  } else if (inInstance(hit)) {
    log.push("  inside an instance, to redo on its main: " + hit.name);
  } else {
    const inst = main.createInstance();
    const parent = hit.parent, at = parent.children.indexOf(hit), auto = parent.layoutMode && parent.layoutMode !== "NONE";
    const [x, y, op, pos, grow, align, cons] = [hit.x, hit.y, hit.opacity, hit.layoutPositioning, hit.layoutGrow, hit.layoutAlign, hit.constraints];
    parent.insertChild(at, inst);
    inst.resize(w, h);
    inst.name = s.name;
    inst.opacity = op;
    if (p) for (const k of inst.findAll((q) => q.type === "VECTOR")) k.fills = [JSON.parse(JSON.stringify(p))];
    if (auto) { inst.layoutPositioning = pos; inst.layoutGrow = grow; inst.layoutAlign = align; }
    if (!auto || pos === "ABSOLUTE") { inst.x = x; inst.y = y; inst.constraints = cons; }
    hit.remove();
  }
}
return { v: v.name, log };`);

let bad = 0;
const slugs = one ? [one] : readFileSync(list, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
for (const slug of slugs) {
  const f = join(out, slug, "capture.json");
  if (!existsSync(f)) continue;
  const name = `${label} · ${slug}`;
  const want = expected(JSON.parse(readFileSync(f, "utf8")));
  if (fix) {
    const lines = [];
    for (let i = 0; i < want.length; i++) {
      if (!want[i].spots.length) continue;
      const r = await repair(name, i, want[i].spots);
      for (const l of r.log) lines.push(`  ${want[i].name} : ${l}`);
    }
    console.log(`${slug} : ${lines.length ? "\n" + lines.join("\n") : "nothing to do"}`);
    continue;
  }
  const shown = await rpc(`
${findRoot(name)}
if (!held) return null;
const vs = held.type === "COMPONENT_SET" ? held.children : [held];
const res = [];
for (const v of vs) {
  const icons = [];
  const walk = async (n) => {
    // a stale instance sublayer (its main lost that layer) reads as nothing
    let shown = false;
    try { shown = n.visible; } catch { return; }
    if (!shown) return;
    if (n.type === "INSTANCE") {
      const m = await n.getMainComponentAsync();
      if (m && m.name.startsWith("Icon / ")) { icons.push(m.name.slice(7) + "@" + Math.round(n.width)); return; }
    }
    if (n.children) for (const k of n.children) await walk(k);
  };
  await walk(v);
  res.push({ name: v.name.replace(/^Variant=/, ""), icons });
}
return res;`);
  if (!shown) continue;
  const lines = [];
  shown.forEach((v, i) => {
    const w = want[i]?.icons || [];
    const [extra, lack] = [minus(v.icons, w), minus(w, v.icons)];
    if (extra.length || lack.length) lines.push(`  ${v.name}: extra [${extra.join(", ")}] · missing [${lack.join(", ")}]`);
  });
  if (shown.length !== want.length) lines.push(`  ${shown.length} variants, ${want.length} examples`);
  if (lines.length) bad++;
  console.log(`${slug} : ${lines.length ? "\n" + lines.join("\n") : "ok"}`);
}
if (!fix) console.log(`${bad} page(s) to redo`);
