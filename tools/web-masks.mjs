// CSS gradient masks → Figma, after the build (the box's layer is found by its place, like web-compare --fix).
// Over content: a real alpha mask in a group around the layer, nested once per layer for an intersect.
// Over a childless box that only draws a border (a corner shine): its stroke takes the mask's alpha.
// A mask on a childless box with a fill stays with scrim() in web-items. Backdrop-filter scrims and
// sized (tiled) masks have no equivalent here and are left out.
// Idempotent: a layer already wrapped carries the name mask:<box id>.
// Usage: node tools/web-masks.mjs <case dir> --file <Figma file> --root <node id>

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gradients } from "./web-items.mjs";
import { makeRpc } from "./web-lib.mjs";

const channels = (c) => {
  const m = /rgba?\(([^,]+),\s*([^,]+),\s*([^,)]+)(?:,\s*([^)]+))?\)/.exec(c);
  return m ? { r: m[1] / 255, g: m[2] / 255, b: m[3] / 255, a: m[4] == null ? 1 : +m[4] } : null;
};
const paintOf = (g) => ({
  type: g.type,
  gradientTransform: g.t,
  gradientStops: g.stops.map((s) => ({ position: s.at, color: channels(s.c) })),
});

// What to do for each masked box of a capture; pure, guarded by web-check.
export function maskSpecs(cap) {
  const out = [];
  for (const b of cap.boxes) {
    if (!b.mask || b.bdf || b.maskSize) continue;
    const layers = gradients(b.mask, b.w, b.h);
    // an opaque mask (a text-clip trick, linear-gradient(black, black)) changes nothing
    if (!layers.length || layers.every((g) => g.stops.every((s) => channels(s.c)?.a === 1))) continue;
    const content = cap.boxes.some((k) => k.p === b.id);
    if (!content && !b.border) continue;
    const base = { id: b.id, x: b.x, y: b.y, w: b.w, h: b.h };
    if (content) out.push({ ...base, kind: "group", intersect: b.maskComp === "intersect", paints: layers.map(paintOf) });
    else if (b.border.c && channels(b.border.c)) out.push({ ...base, kind: "stroke", color: channels(b.border.c), paints: layers.map(paintOf) });
  }
  return out;
}

export async function applyMasks(rpc, rootId, specs) {
  if (!specs.length) return { group: 0, stroke: 0, missed: [] };
  return rpc(`
const root = await H.byId(${JSON.stringify(rootId)});
const O = root.absoluteBoundingBox;
const specs = ${JSON.stringify(specs)};
const TOL = 8;
const all = [], done = new Set();
const todo = [root];
// a sublayer gone under its id throws on any read: left out
while (todo.length) {
  const n = todo.pop();
  try {
    if (/^mask:/.test(n.name)) done.add(n.name.slice(5));
    if (n !== root && n.type !== "TEXT" && n.absoluteBoundingBox) all.push(n);
    if ("children" in n) todo.push(...[...n.children].reverse());
  } catch (e) {}
}
const at = (s) => all.filter((n) => { try { const a = n.absoluteBoundingBox; return Math.abs(a.x - O.x - s.x) <= TOL && Math.abs(a.y - O.y - s.y) <= TOL && Math.abs(a.width - s.w) <= TOL && Math.abs(a.height - s.h) <= TOL; } catch (e) { return false; } });
const inInst = (n) => n.id.startsWith("I");
const res = { group: 0, stroke: 0, missed: [] };
for (const s of specs) {
  if (done.has(String(s.id))) continue;
  const here = at(s);
  if (s.kind === "stroke") {
    // the layers drawing this border, told apart by colour (nested panels share a box): childless
    // ones first (a shine doubled by the build counts twice), else the deepest frame that adopted it
    const same = (a, b) => Math.abs(a - b) < 0.01;
    // already masked by an earlier run: its gradient carries this colour at this alpha
    const masked = (n) => Array.isArray(n.strokes) && n.strokes.some((p) => p.gradientStops && p.gradientStops.some((g) => same(g.color.a, s.color.a) && same(g.color.r, s.color.r) && same(g.color.g, s.color.g) && same(g.color.b, s.color.b)));
    if (here.some(masked)) continue;
    const solid = (n) => n.strokes.find((p) => p.type === "SOLID" && p.visible !== false);
    const hit = here.filter((n) => {
      if (!Array.isArray(n.strokes) || !solid(n)) return false;
      const c = solid(n);
      return same(c.color.r, s.color.r) && same(c.color.g, s.color.g) && same(c.color.b, s.color.b) && same(c.opacity ?? 1, s.color.a);
    });
    const bare = hit.filter((n) => !("children" in n) || !n.children.length);
    const ts = bare.length ? bare : hit.slice(-1);
    if (!ts.length) { res.missed.push(s.id + " stroke"); continue; }
    for (const t of ts) t.strokes = s.paints.map((p) => ({ ...p, gradientStops: p.gradientStops.map((g) => ({ position: g.position, color: { r: s.color.r, g: s.color.g, b: s.color.b, a: g.color.a * s.color.a } })) }));
    res.stroke += ts.length;
    continue;
  }
  // the outermost layer on the box that an instance does not hold
  const t = here.find((n) => "children" in n && !inInst(n));
  if (!t) { res.missed.push(s.id + " group"); continue; }
  let inner = t;
  const box = t.absoluteBoundingBox;
  const lay = s.intersect ? s.paints.map((p) => [p]) : [s.paints];
  for (const fills of lay) {
    const parent = inner.parent, i = parent.children.indexOf(inner);
    // group first: a rectangle inserted beside the layer would join an auto-layout flow and push it down
    const g = figma.group([inner], parent, i);
    const m = figma.createRectangle();
    m.name = "mask";
    m.resize(box.width, box.height);
    m.fills = fills;
    g.insertChild(0, m);
    m.isMask = true;
    m.maskType = "ALPHA";
    g.name = "mask:" + s.id;
    inner = g;
  }
  // a group in an auto-layout parent is placed by the flow and its content comes out offset:
  // every level goes back on the box, from the outside in
  const onBox = (n) => { const a = n.absoluteBoundingBox, dx = box.x - a.x, dy = box.y - a.y; if (dx || dy) { n.x += dx; n.y += dy; } };
  for (let g = inner; g !== t; ) {
    const k = g.children.find((c) => !c.isMask);
    onBox(g.children.find((c) => c.isMask));
    onBox(k);
    g = k;
  }
  res.group++;
}
return res;`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const [dir] = args;
  const file = opt("--file"), root = opt("--root");
  if (!dir || !file || !root) throw new Error("usage: web-masks.mjs <case dir> --file <Figma file> --root <id>");
  const cap = JSON.parse(readFileSync(join(dir, "capture.json"), "utf8"));
  const specs = maskSpecs(cap);
  const r = await applyMasks(makeRpc(file), root, specs);
  console.log(`masks: ${specs.length} read, ${r.group} groups, ${r.stroke} hairlines${r.missed.length ? `, not placed: ${r.missed.join(" · ")}` : ""}`);
}
