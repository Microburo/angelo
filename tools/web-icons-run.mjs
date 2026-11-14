// Captured Lucide svgs → instances of the file's own `Icon / <name>` components, in place, free of Node:
// everything goes through rpc(code). Hosts: web-icons.mjs (Node), the plugin's bundle (web-core).
// Recognition by geometry, not by name: every lucide-classed svg of the captures is re-imported in Figma
// to get its shapes, then every small leaf frame / wrapper instance under the roots is compared to them.
// The body stays at column 0: the exec code it holds is sent as written.

const WAYS = ["left", "up", "right", "down"];
// a class name against the set's: digits apart (clock2 → clock-2), a turned diagonal up/down first (arrow-left-up → arrow-up-left)
const canon = (n) => n.replace(/([a-z])(\d)/g, "$1-$2").replace(/\b(left|right)-(up|down)\b/g, "$2-$1");

// caps: parsed captures · root: one frame id, or frames: a regex source on the names of the page's frames
// Returns { total, report, names, kept, cleaned, missing, odd, ms }; a capture without Lucide sends nothing.
export async function swapIcons({ rpc, caps, root = null, frames = null, board = null, clean = false }) {
// lucide svgs of the captures, one per distinct drawing
const seen = new Map();
const walk = (v) => {
  if (Array.isArray(v)) return v.forEach(walk);
  if (!v || typeof v !== "object") return;
  if (typeof v.svg === "string" && /class="[^"]*\blucide-/.test(v.svg)) {
    // turned by the page: the drawing is another icon of the set (a chevron-left at 90° reads chevron-up)
    const steps = (+(/\sdata-rot="(\d+)"/.exec(v.svg)?.[1]) || 0) / 90;
    const turned = (n) => (steps ? n.replace(/\b(left|up|right|down)\b/g, (d) => WAYS[(WAYS.indexOf(d) + steps) % 4]) : n);
    // (no direction in its name: no icon of the set draws it turned, it stays as drawn)
    const names = [...v.svg.match(/class="([^"]*)"/)[1].matchAll(/\blucide-([a-z0-9-]+)/g)].map((m) => m[1]).filter((n) => !steps || /\b(left|up|right|down)\b/.test(n)).map(turned).map(canon);
    if (steps && !names.length) return;
    const shapes = v.svg.replace(/^<svg[^>]*>/, "").replace(/\s(stroke|fill|stroke-width|stroke-linecap|stroke-linejoin|class)="[^"]*"/g, "");
    if (!seen.has(shapes)) seen.set(shapes, { names, svg: v.svg });
  }
  Object.values(v).forEach(walk);
};
caps.forEach(walk);
if (!seen.size) return { total: 0, report: {}, names: 0, kept: 0, cleaned: 0, missing: [], odd: [], ms: 0 };

// shared by every exec: the shapes of a leaf, in units of a 24 px box
const LEAF = `
const SHAPES = new Set(["VECTOR", "ELLIPSE", "RECTANGLE", "LINE", "POLYGON", "STAR", "BOOLEAN_OPERATION"]);
const leafOf = (n) => {
  if (!n.children || !n.children.length) return null;
  if (n.children.every((k) => SHAPES.has(k.type))) return n;
  if (n.children.length === 1 && n.children[0].type === "FRAME") return leafOf(n.children[0]);
  return null;
};
const sigOf = (f) => {
  const s = 24 / f.width;
  let letters = "";
  const nums = [];
  for (const k of f.children) {
    letters += k.type[0];
    nums.push(k.x * s, k.y * s, k.width * s, k.height * s);
    for (const p of k.vectorPaths || []) for (const t of p.data.split(/\\s+/)) {
      if (/^[A-Za-z]$/.test(t)) letters += t;
      else nums.push(Number(t) * s);
    }
  }
  return { letters, nums };
};
`;

// the reference table: each drawing re-imported as the build imports it
const refs = [];
const list = [...seen.values()];
for (let i = 0; i < list.length; i += 40) {
  const part = list.slice(i, i + 40);
  const got = await rpc(`${LEAF}
return ${JSON.stringify(part.map((p) => p.svg))}.map((svg) => {
  const f = figma.createNodeFromSvg(svg);
  const sig = sigOf(f);
  f.remove();
  return sig;
});`);
  got.forEach((sig, j) => refs.push({ names: part[j].names, letters: sig.letters, nums: sig.nums.map((n) => +n.toFixed(2)) }));
}

// each drawing → its Icon component, created on demand by the plugin (first class Lucide knows wins)
const owners = await rpc(`
if (!H.icon) throw new Error("Angelo plugin without embedded Lucide: reload it");
const out = [];
for (const names of ${JSON.stringify(refs.map((r) => r.names))}) {
  let hit = null;
  for (const name of names) {
    const c = await H.icon(name);
    if (c) { hit = { id: c.id, name }; break; }
  }
  out.push(hit);
}
return out;`);
const missing = new Set();
const table = [];
refs.forEach((r, i) => {
  if (owners[i]) table.push({ ...owners[i], letters: r.letters, nums: r.nums });
  else missing.add(r.names[0]);
});

// one exec = 20 s of work at most; rerun until a pass has nothing left
const PASS = `${LEAF}
const table = ${JSON.stringify(table)};
const match = (f) => {
  const s = sigOf(f);
  return table.find((r) => r.letters === s.letters && r.nums.length === s.nums.length && r.nums.every((v, i) => Math.abs(v - s.nums[i]) < 0.3));
};
const paintOf = (f) => {
  for (const k of f.children) if (k.strokes && k.strokes.length) return k.strokes[0];
  for (const k of f.children) if (k.fills && k.fills.length) return k.fills[0];
  return null;
};
// a drawn fill on top of the stroke is not what the outline icon draws: left as it is
const filled = (f) => f.children.some((k) => k.strokes && k.strokes.length && k.fills && k.fills.some((p) => p.visible !== false && p.opacity !== 0));
const paint = (inst, p) => {
  if (!p) return;
  for (const k of inst.findAll((n) => n.type === "VECTOR")) k.fills = [JSON.parse(JSON.stringify(p))];
};
const mains = new Map();
const iconMain = async (id) => {
  if (!mains.has(id)) mains.set(id, await figma.getNodeByIdAsync(id));
  return mains.get(id);
};
const inInstance = (n) => { for (let p = n.parent; p && p.type !== "PAGE"; p = p.parent) if (p.type === "INSTANCE") return true; return false; };
const t0 = Date.now();
const done = {}, odd = [];
let keptFilled = 0, more = false;
const walk = async (n) => {
  if (Date.now() - t0 > 20000) { more = true; return; }
  if (n.type === "INSTANCE") {
    const main = await n.getMainComponentAsync();
    // (the build's own wrappers are named Icon / too, and carry its signature: those still get swapped)
    if (main && main.name.startsWith("Icon / ") && !main.getPluginData("fdslSig")) return;
    // (a painted box around a smaller icon is not the icon: its size tells them apart)
    const f = n.width <= 96 && n.height <= 96 && leafOf(n);
    const r = f && Math.abs(f.width - n.width) <= 0.5 && Math.abs(f.height - n.height) <= 0.5 && match(f);
    if (r && !filled(f)) {
      const [w, h, p] = [n.width, n.height, paintOf(f)];
      n.swapComponent(await iconMain(r.id));
      n.name = r.name;
      if (n.width !== w || n.height !== h) n.resize(w, h);
      paint(n, p);
      if (Math.abs(n.width - w) > 0.5) odd.push(n.id);
      done[r.name] = (done[r.name] || 0) + 1;
      return;
    }
    if (r) { keptFilled++; return; }
  } else if (n.type === "FRAME" && n.width <= 96 && n.height <= 96 && n.children.length && !inInstance(n) && leafOf(n) === n) {
    const r = match(n);
    if (!r) return;
    if (filled(n)) { keptFilled++; return; }
    // a wrapper main keeps its drawing until nothing uses it
    if (n.parent.type === "COMPONENT" && n.parent.children.length === 1 && n.parent.getPluginData("fdslSig")) return;
    const inst = (await iconMain(r.id)).createInstance();
    const parent = n.parent, at = parent.children.indexOf(n), auto = parent.layoutMode && parent.layoutMode !== "NONE";
    const [w, h, x, y, op, p] = [n.width, n.height, n.x, n.y, n.opacity, paintOf(n)];
    const [pos, grow, align, cons] = auto ? [n.layoutPositioning, n.layoutGrow, n.layoutAlign, n.constraints] : [null, 0, null, n.constraints];
    // in a main: the instances that hide this layer (or a boolean that does) keep hiding the new one
    const refs = n.componentPropertyReferences;
    let owner = n.parent;
    const path = [at];
    while (owner && owner.type !== "COMPONENT" && owner.type !== "PAGE") { path.unshift(owner.parent.children.indexOf(owner)); owner = owner.parent; }
    const layerAt = (i) => path.reduce((l, k) => l && l.children && l.children[k], i);
    const hiding = owner && owner.type === "COMPONENT" && !(refs && refs.visible) ? (await owner.getInstancesAsync()).filter((i) => layerAt(i)?.visible === false) : [];
    parent.insertChild(at, inst);
    if (refs && refs.visible) inst.componentPropertyReferences = { visible: refs.visible };
    inst.resize(w, h);
    inst.opacity = op;
    inst.name = r.name;
    paint(inst, p);
    if (auto) { inst.layoutPositioning = pos; inst.layoutGrow = grow; inst.layoutAlign = align; }
    if (!auto || pos === "ABSOLUTE") { inst.x = x; inst.y = y; inst.constraints = cons; }
    n.remove();
    for (const i of hiding) { const l = layerAt(i); if (l) l.visible = false; }
    done[r.name] = (done[r.name] || 0) + 1;
    return;
  }
  if (n.children) for (const k of [...n.children]) { if (k.removed) continue; await walk(k); }
};
`;

const report = {};
let kept = 0;
const odd = [];
const passOn = async (target) => {
  for (let i = 0; i < 30; i++) {
    const r = await rpc(`${PASS}${target}
return { done, keptFilled, more, odd };`);
    for (const [k, v] of Object.entries(r.done)) report[k] = (report[k] || 0) + v;
    kept = Math.max(kept, r.keptFilled);
    odd.push(...r.odd);
    if (!r.more) return;
  }
  throw new Error("web-icons: 30 passes without finishing");
};

const t0 = Date.now();
// the mains first: an instance of them follows
if (board) await passOn(`
const page = figma.root.children.find((p) => /^💊 Components$/.test(p.name));
await page.loadAsync();
const b = page.children.find((n) => n.name === ${JSON.stringify(board)});
if (!b) throw new Error("board not found");
await walk(b);`);
await passOn(root ? `
await walk(await H.byId(${JSON.stringify(root)}));` : `
const re = new RegExp(${JSON.stringify(frames)});
for (const f of figma.currentPage.children) if (f.type === "FRAME" && re.test(f.name)) await walk(f);`);

// wrappers left without any instance: generated by the build, gone once nothing refers to them
let cleaned = 0;
if (board && clean) {
  cleaned = await rpc(`${LEAF}
const page = figma.root.children.find((p) => /^💊 Components$/.test(p.name));
await page.loadAsync();
const b = page.children.find((n) => n.name === ${JSON.stringify(board)});
const table = ${JSON.stringify(table)};
let n = 0;
for (const c of b.findAll((k) => k.type === "COMPONENT" && k.getPluginData("fdslSig") && k.children.length === 1)) {
  const f = leafOf(c);
  if (!f) continue;
  const s = sigOf(f);
  if (!table.some((r) => r.letters === s.letters && r.nums.every((v, i) => Math.abs(v - s.nums[i]) < 0.3))) continue;
  if ((await c.getInstancesAsync()).length) continue;
  c.remove();
  n++;
}
return n;`);
}

return { total: Object.values(report).reduce((a, b) => a + b, 0), report, names: Object.keys(report).length, kept, cleaned, missing: [...missing], odd, ms: Date.now() - t0 };
}
