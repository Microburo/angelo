// Boxes already in Figma that hold their centred content by padding alone (buttons, pills, icon buttons, one-child variants)
// are set to centre it, in place: mains and plain frames only, instances follow. Text positions on the frame are compared
// before and after; a box that moved something is put back (kept in the totals). --dry: only counts.
// Usage: node tools/web-center.mjs --pages "<page>" [--frames "<page>><frame>"] [--slug <frame name>] [--dry]

import { makeRpc, pluginFile } from "./web-lib.mjs";

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const [pages, frames, one] = [opt("--pages"), opt("--frames"), opt("--slug")];
const dry = args.includes("--dry");
const rpc = makeRpc(await pluginFile());

const LOOK = `
const pageOf = async (name) => { const p = figma.root.children.find((q) => q.name === name); if (p) await p.loadAsync(); return p; };`;

const roots = [];
if (pages) {
  const ids = await rpc(`${LOOK}
const p = await pageOf(${JSON.stringify(pages)});
return p.children.filter((n) => n.type === "FRAME" && (${JSON.stringify(one || "")} === "" || n.name === ${JSON.stringify(one || "")})).map((n) => n.id);`);
  roots.push(...ids);
}
if (frames && !one) {
  const [page, frame] = frames.split(">");
  const ids = await rpc(`${LOOK}
const p = await pageOf(${JSON.stringify(page)});
return p.children.filter((n) => n.name === ${JSON.stringify(frame)}).map((n) => n.id);`);
  roots.unshift(...ids);
}

const pass = (id) => rpc(`
const root = await figma.getNodeByIdAsync(${JSON.stringify(id)});
const dry = ${dry};
const safe = (f, d) => { try { return f(); } catch { return d; } };
const where = () => {
  const m = new Map();
  for (const t of root.findAll((n) => safe(() => n.type === "TEXT" || n.type === "INSTANCE" && n.children.length === 0, false))) {
    const b = safe(() => t.absoluteBoundingBox, null);
    if (b) m.set(t.id, [b.x, b.y]);
  }
  return m;
};
const FLOW = (n) => n.children.filter((k) => safe(() => k.visible && k.layoutPositioning !== "ABSOLUTE", false));
const painted = (n) => (n.fills && n.fills.length > 0) || (n.strokes && n.strokes.length > 0);
const SHAPE = new Set(["VECTOR", "BOOLEAN_OPERATION", "ELLIPSE", "RECTANGLE"]);
const isIcon = (k) => k.type === "INSTANCE" ? safe(() => k.width <= 32 && k.height <= 32, false) : SHAPE.has(k.type);
const wants = (n) => {
  if (n.layoutMode === "NONE" || n.primaryAxisAlignItems === "SPACE_BETWEEN" || !n.children) return null;
  const kids = FLOW(n);
  if (!kids.length) return null;
  // what is really there, not the padding: a box wider than its content holds it to the left whatever its padding says
  const left = Math.min(...kids.map((k) => k.x)), right = n.width - Math.max(...kids.map((k) => k.x + k.width));
  const top = Math.min(...kids.map((k) => k.y)), bottom = n.height - Math.max(...kids.map((k) => k.y + k.height));
  const across = Math.abs(left - right) <= 1, down = Math.abs(top - bottom) <= 1;
  const one = kids.length === 1 ? kids[0] : null;
  // a variant around one element: it is that element
  if (n.type === "COMPONENT" && one && n.parent && n.parent.type === "COMPONENT_SET" && across && down) return "both";
  if (!painted(n)) return null;
  // a label centred in its box, an icon alone in its box
  if (one && one.type === "TEXT" && one.textAlignHorizontal === "CENTER" && one.textAutoResize !== "HEIGHT" && n.height <= 64 && across && down) return "both";
  if (one && isIcon(one) && n.width <= 64 && n.height <= 64 && across && down) return "both";
  // an icon and a label on a row, in a control's height
  if (kids.length <= 4 && n.layoutMode === "HORIZONTAL" && n.height <= 64 && across && down && kids.some((k) => k.type === "TEXT") && kids.every((k) => (k.type === "TEXT" && k.textAutoResize !== "HEIGHT") || isIcon(k))) return "both";
  return null;
};
const before = where();
const todo = root.findAll((n) => safe(() => (n.type === "COMPONENT" || n.type === "FRAME") && !!wants(n), false)).filter((n) => {
  for (let p = n.parent; p && p.type !== "PAGE"; p = p.parent) if (p.type === "INSTANCE") return false;
  return n.primaryAxisAlignItems !== "CENTER" || n.counterAxisAlignItems !== "CENTER" || (FLOW(n).length === 1 && n.layoutMode === "VERTICAL");
});
if (dry) return { name: root.name, n: todo.length };
const undo = [];
for (const n of todo) {
  undo.push([n, n.layoutMode, n.primaryAxisAlignItems, n.counterAxisAlignItems, n.layoutSizingHorizontal, n.layoutSizingVertical]);
  const [sw, sh] = [n.layoutSizingHorizontal, n.layoutSizingVertical];
  if (FLOW(n).length === 1 && n.layoutMode !== "HORIZONTAL") {
    // the axis swap would turn a child's fill across into a fill along
    const kid = FLOW(n)[0], [kw, kh] = [kid.layoutSizingHorizontal, kid.layoutSizingVertical];
    n.layoutMode = "HORIZONTAL";
    kid.layoutSizingHorizontal = kw;
    kid.layoutSizingVertical = kh;
  }
  n.primaryAxisAlignItems = "CENTER";
  n.counterAxisAlignItems = "CENTER";
  n.layoutSizingHorizontal = sw;
  n.layoutSizingVertical = sh;
}
const put = ([n, mode, prim, cross, sw, sh]) => {
  const kid = FLOW(n).length === 1 ? FLOW(n)[0] : null, sizes = kid && [kid.layoutSizingHorizontal, kid.layoutSizingVertical];
  n.layoutMode = mode;
  if (kid) { kid.layoutSizingHorizontal = sizes[0]; kid.layoutSizingVertical = sizes[1]; }
  n.primaryAxisAlignItems = prim;
  n.counterAxisAlignItems = cross;
  n.layoutSizingHorizontal = sw;
  n.layoutSizingVertical = sh;
};
const movedNow = () => {
  const after = where(), out = [];
  for (const [k, a] of before) { const b = after.get(k); if (b && (Math.abs(a[0] - b[0]) > 1 || Math.abs(a[1] - b[1]) > 1)) out.push(k); }
  return out;
};
// an instance wider than its main shows the main's change differently: only the box that moved something goes back
const live = new Map(undo.map((u) => [u[0].id, u]));
let moved = movedNow(), kept = [];
for (let round = 0; moved.length && round < 6; round++) {
  for (const k of moved) {
    let p = await figma.getNodeByIdAsync(k.split(";").pop().replace(/^I/, ""));
    for (; p && p.type !== "PAGE"; p = p.parent) if (live.has(p.id)) { put(live.get(p.id)); kept.push(p.name); live.delete(p.id); break; }
  }
  moved = movedNow();
}
if (moved.length) { for (const u of live.values()) put(u); live.clear(); }
return { name: root.name, n: live.size, kept: kept.length, moved: moved.length, sample: moved.slice(0, 4) };`);

const total = { n: 0, kept: 0, moved: 0, frames: 0 };
for (const id of roots) {
  const r = await pass(id);
  total.n += r.n;
  total.kept += r.kept || 0;
  total.frames++;
  if (r.moved) { total.moved += r.moved; console.log(`${r.name} : ${r.n} centered, ${r.moved} moved ${r.sample.join(" | ")}`); }
}
console.log(JSON.stringify(total));
