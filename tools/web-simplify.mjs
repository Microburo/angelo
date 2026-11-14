// Components already in Figma, flattened in place: a box takes over its only child, a text or an icon held in an unpainted
// wrapper sits directly in its row, what the wrapper's padding did goes to the row's padding and gap. Each main is tried on a
// clone first: anything moving more than 1.5 px (a label recentred in its control excepted) leaves that main as it is.
// Usage: node tools/web-simplify.mjs --pages "<page>" [--slug <frame name>] [--frames "<page>><frame>"] [--dry]

import { makeRpc, pluginFile } from "./web-lib.mjs";

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const [pages, frames, one] = [opt("--pages"), opt("--frames"), opt("--slug")];
const dry = args.includes("--dry");
const rpc = makeRpc(await pluginFile());

const pageOf = `const pageOf = async (name) => { const p = figma.root.children.find((q) => q.name === name); if (p) await p.loadAsync(); return p; };`;
const roots = [];
if (pages) roots.push(...(await rpc(`${pageOf}
const p = await pageOf(${JSON.stringify(pages)});
return p.children.filter((n) => n.type === "FRAME" && (${JSON.stringify(one || "")} === "" || n.name === ${JSON.stringify(one || "")})).map((n) => n.id);`)));
if (frames && !one) {
  const [page, frame] = frames.split(">");
  roots.unshift(...(await rpc(`${pageOf}
const p = await pageOf(${JSON.stringify(page)});
return p.children.filter((n) => n.name === ${JSON.stringify(frame)}).map((n) => n.id);`)));
}

const listMains = (id) => rpc(`
const root = await figma.getNodeByIdAsync(${JSON.stringify(id)});
const inInstance = (n) => { for (let p = n.parent; p && p.type !== "PAGE"; p = p.parent) if (p.type === "INSTANCE") return true; return false; };
return { name: root.name, ids: root.findAll((n) => n.type === "COMPONENT" && !inInstance(n)).map((n) => n.id) };`);

// every text shown under a root, instances included: flattening a main must not lose an override
const textsOf = (id) => rpc(`
const root = await figma.getNodeByIdAsync(${JSON.stringify(id)});
const out = {};
for (const t of root.findAllWithCriteria({ types: ["TEXT"] })) { try { out[t.characters] = (out[t.characters] || 0) + 1; } catch {} }
return out;`);

const pass = (rootId, ids) => rpc(`
const root = await figma.getNodeByIdAsync(${JSON.stringify(rootId)});
const dry = ${dry};
const safe = (f, d) => { try { return f(); } catch { return d; } };
const seen = (list) => (list === figma.mixed ? [] : list || []).filter((p) => p.visible !== false);
const showing = (e) => e.visible !== false && (e.radius > 0 || e.spread > 0 || (e.offset && (e.offset.x !== 0 || e.offset.y !== 0))) && (!e.color || e.color.a > 0);
const painted = (n) => seen(n.fills).length > 0 || seen(n.strokes).length > 0 || (n.effects || []).some(showing) || n.opacity < 1;
const flowing = (k) => k.visible && k.layoutPositioning !== "ABSOLUTE";
const isBox = (n) => n.type === "FRAME" && n.layoutMode !== "NONE";
const inInstance = (n) => { for (let p = n.parent; p && p.type !== "PAGE"; p = p.parent) if (p.type === "INSTANCE") return true; return false; };
const CORNERS = ["topLeftRadius", "topRightRadius", "bottomRightRadius", "bottomLeftRadius"];

// The box takes over its only child: layout, padding, paint, then the grandchildren.
const absorb = (p) => {
  if (!p.children || p.children.length !== 1 || p.layoutMode === "NONE" || p.type === "INSTANCE") return false;
  const w = p.children[0];
  if (!isBox(w) || !flowing(w) || (painted(p) && painted(w))) return false;
  if (seen(w.fills).some((f) => f.type === "IMAGE")) return false;
  // a wrapper's padding is outside a painted child: taking the paint would bring that margin inside the box
  if (painted(w) && (p.paddingTop || p.paddingRight || p.paddingBottom || p.paddingLeft)) return false;
  const roomX = p.width - p.paddingLeft - p.paddingRight, roomY = p.height - p.paddingTop - p.paddingBottom;
  if (Math.abs(w.width - roomX) > 1 || Math.abs(w.height - roomY) > 1) return false;
  // a child fixed on an axis the box hugs passes its size on (a control's height stays the control's)
  const [sw, sh] = [p.layoutSizingHorizontal === "HUG" ? w.layoutSizingHorizontal === "FIXED" ? "FIXED" : "HUG" : p.layoutSizingHorizontal, p.layoutSizingVertical === "HUG" ? w.layoutSizingVertical === "FIXED" ? "FIXED" : "HUG" : p.layoutSizingVertical];
  const [fw, fh] = [p.width, p.height];
  const kids = [...w.children];
  const sizes = kids.map((k) => [k.layoutSizingHorizontal, k.layoutSizingVertical]);
  p.layoutMode = w.layoutMode;
  p.primaryAxisAlignItems = w.primaryAxisAlignItems;
  p.counterAxisAlignItems = w.counterAxisAlignItems;
  p.itemSpacing = w.itemSpacing;
  p.layoutWrap = w.layoutWrap;
  p.paddingTop += w.paddingTop; p.paddingRight += w.paddingRight; p.paddingBottom += w.paddingBottom; p.paddingLeft += w.paddingLeft;
  if (painted(w)) {
    p.fills = w.fills; p.strokes = w.strokes; p.effects = w.effects; p.strokeAlign = w.strokeAlign;
    for (const c of ["strokeTopWeight", "strokeRightWeight", "strokeBottomWeight", "strokeLeftWeight", ...CORNERS]) p[c] = w[c];
    p.clipsContent = w.clipsContent;
  }
  p.strokesIncludedInLayout = w.strokesIncludedInLayout;
  for (const k of kids) p.appendChild(k);
  kids.forEach((k, i) => safe(() => { k.layoutSizingHorizontal = sizes[i][0]; k.layoutSizingVertical = sizes[i][1]; }));
  w.remove();
  p.layoutSizingHorizontal = sw; p.layoutSizingVertical = sh;
  if (sw === "FIXED" || sh === "FIXED") p.resize(sw === "FIXED" ? fw : p.width, sh === "FIXED" ? fh : p.height);
  return true;
};

// An unpainted wrapper around one element in a row or a column: the element sits in the parent, the wrapper's padding becomes the parent's.
const unwrap = (w) => {
  const p = w.parent;
  if (!isBox(w) || painted(w) || !flowing(w) || w.children.length !== 1 || !p || !p.children || p.layoutMode === "NONE" || p.type === "INSTANCE") return false;
  const c = w.children[0];
  if (!flowing(c) || p.children.length < 2) return false;
  const kids = p.children.filter(flowing), i = kids.indexOf(w), row = p.layoutMode === "HORIZONTAL";
  if (i < 0 || (i > 0 && i < kids.length - 1 && kids.length > 2)) return false;
  const [before, after, a, b] = row ? [w.paddingLeft, w.paddingRight, "paddingLeft", "paddingRight"] : [w.paddingTop, w.paddingBottom, "paddingTop", "paddingBottom"];
  const [crossA, crossB] = row ? [w.paddingTop, w.paddingBottom] : [w.paddingLeft, w.paddingRight];
  if (kids.length > 2 && (i === 0 ? after : before) > 0) return false;
  const label = c.type === "TEXT" && p.height <= 64 && row;
  const wide = row ? w.layoutSizingHorizontal !== "HUG" && w.width > c.width + before + after + 1 : false;
  const idx = p.children.indexOf(w);
  const sizes = [c.layoutSizingHorizontal, c.layoutSizingVertical];
  const crossWas = row ? p.height : p.width;
  p.insertChild(idx, c);
  safe(() => { c.layoutSizingHorizontal = sizes[0]; c.layoutSizingVertical = sizes[1]; });
  if (i === 0) { p[a] += before; p.itemSpacing += after; } else { p[b] += after; p.itemSpacing += before; }
  if (wide) c.layoutSizingHorizontal = "FILL";
  if (label && Math.abs(crossA - crossB) <= 8) p.counterAxisAlignItems = "CENTER";
  w.remove();
  // a hugging parent keeps its height: what the wrapper held goes to the parent's padding, evenly
  const lost = crossWas - (row ? p.height : p.width);
  if (lost > 0) {
    if (row) { p.paddingTop += lost / 2; p.paddingBottom += lost / 2; } else { p.paddingLeft += lost / 2; p.paddingRight += lost / 2; }
  }
  return true;
};

const flatten = async (top) => {
  for (const t of top.findAll((n) => n.type === "TEXT")) for (const f of safe(() => t.fontName === figma.mixed ? t.getRangeAllFontNames(0, t.characters.length) : [t.fontName], [])) await figma.loadFontAsync(f);
  let done = 0, again = true;
  while (again) {
    again = false;
    for (const n of [top, ...top.findAll((q) => isBox(q) && !inInstance(q))]) {
      if (n.removed) continue;
      if (absorb(n)) { done++; again = true; break; }
      if (n !== top && unwrap(n)) { done++; again = true; break; }
    }
  }
  return done;
};

const count = (n) => n.findAll(() => true).length;
const depthOf = (n) => (n.children && n.type !== "INSTANCE" ? 1 + Math.max(0, ...n.children.map(depthOf)) : 0);
const look = (top) => {
  const o = top.absoluteBoundingBox;
  return top.findAll((n) => n.type === "TEXT" || (n.type === "INSTANCE" && !inInstance(n))).filter((n) => n.absoluteBoundingBox).map((n) => { const b = n.absoluteBoundingBox; return { name: n.characters ?? n.name, text: n.type === "TEXT", x: b.x - o.x, y: b.y - o.y, h: n.parent && n.parent.height }; });
};
const page = (() => { let p = root; while (p.type !== "PAGE") p = p.parent; return p; })();
const mains = [];
for (const q of ${JSON.stringify(ids)}) { const m = await figma.getNodeByIdAsync(q); if (m) mains.push(m); }
const out = { name: root.name, mains: mains.length, flattened: 0, removed: 0, depth: [0, 0], refused: [], recentred: 0 };
for (const m of mains) {
  const clone = m.clone();
  page.appendChild(clone);
  const a = look(clone), [wa, ha] = [clone.width, clone.height];
  const before = count(clone), depth = depthOf(clone);
  await flatten(clone);
  const z = look(clone);
  let bad = null, recentred = 0;
  if (a.length !== z.length) bad = "elements " + a.length + "→" + z.length;
  else for (let i = 0; i < a.length && !bad; i++) {
    const dx = Math.abs(a[i].x - z[i].x), dy = Math.abs(a[i].y - z[i].y);
    if (dx > 1.5) bad = a[i].name + " x " + Math.round(z[i].x - a[i].x);
    else if (dy > 1.5) { if (z[i].text && z[i].h <= 64) recentred++; else bad = a[i].name + " y " + Math.round(z[i].y - a[i].y); }
  }
  if (!bad && (Math.abs(wa - clone.width) > 1 || Math.abs(ha - clone.height) > 1)) bad = "size " + Math.round(wa) + "x" + Math.round(ha) + "→" + Math.round(clone.width) + "x" + Math.round(clone.height);
  const after = count(clone), depth2 = depthOf(clone);
  clone.remove();
  if (bad) { out.refused.push(m.name + " : " + bad); out.depth[0] += depth; out.depth[1] += depth; continue; }
  if (!dry && before !== after) await flatten(m);
  out.flattened += before !== after ? 1 : 0;
  out.removed += before - after;
  out.recentred += recentred;
  out.depth[0] += depth; out.depth[1] += depth2;
}
return out;`);

const total = { mains: 0, flattened: 0, removed: 0, recentred: 0, refused: 0, textsLost: 0 };
const before = {};
for (const id of roots) before[id] = await textsOf(id);
for (const id of roots) {
  const { name, ids } = await listMains(id);
  const r = { flattened: 0, mains: 0, removed: 0, recentred: 0, depth: [0, 0], refused: [] };
  for (let i = 0; i < ids.length; i += 15) {
    const b = await pass(id, ids.slice(i, i + 15));
    for (const k of ["mains", "flattened", "removed", "recentred"]) r[k] += b[k];
    r.depth[0] += b.depth[0]; r.depth[1] += b.depth[1];
    r.refused.push(...b.refused);
  }
  for (const k of ["mains", "flattened", "removed", "recentred"]) total[k] += r[k];
  total.refused += r.refused.length;
  console.log(`${name} : ${r.flattened}/${r.mains} flattened, ${r.removed} fewer nodes, depth ${r.depth[0]}→${r.depth[1]}, ${r.recentred} recentered`);
  for (const q of r.refused) console.log("  refused " + q);
}
for (const id of roots) {
  const now = await textsOf(id);
  for (const [t, n] of Object.entries(before[id])) if ((now[t] || 0) < n) { total.textsLost++; console.log(`  text lost "${t.slice(0, 50)}" ${n}→${now[t] || 0}`); }
}
console.log(JSON.stringify(total));
