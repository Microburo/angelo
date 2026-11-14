// Read-only: id-free fingerprint of the mini DS (variables, styles, element frames, masters) so a rebuild
// elsewhere can be compared with the validated reference (tools/mini-ds/fingerprint.mjs).
const names = {};
for (const v of await figma.variables.getLocalVariablesAsync()) names[v.id] = v.name;
const round = (n) => (typeof n === "number" ? Math.round(n * 1000) / 1000 : n);
const val = (x) => {
  if (x && x.type === "VARIABLE_ALIAS") return "→" + names[x.id];
  if (x && typeof x === "object" && "r" in x) return [x.r, x.g, x.b, x.a].map(round).join(",");
  return round(x);
};
const bound = (n) => {
  const out = {};
  for (const [k, v] of Object.entries(n.boundVariables || {})) {
    const list = Array.isArray(v) ? v : [v];
    out[k] = list.map((a) => names[a.id] || "?").join("|");
  }
  return Object.keys(out).length ? out : undefined;
};
const paint = (p) => {
  if (p.type === "SOLID") return p.boundVariables?.color ? "var:" + names[p.boundVariables.color.id] : "solid:" + val(p.color);
  if (p.type === "IMAGE") return "image:" + p.imageHash;
  return p.type;
};
const paints = (list) => (list === figma.mixed ? "mixed" : list && list.length ? list.map(paint) : undefined);

const variables = [];
for (const col of await figma.variables.getLocalVariableCollectionsAsync()) {
  for (const id of col.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(id);
    variables.push([col.name, col.modes.map((m) => m.name).join("|"), v.name, v.resolvedType, val(Object.values(v.valuesByMode)[0]), v.scopes.join("|")]);
  }
}
const styles = [];
for (const s of await figma.getLocalTextStylesAsync()) styles.push(["text", s.name, s.fontName.family, s.fontName.style, s.fontSize, JSON.stringify(s.lineHeight), JSON.stringify(bound(s))]);
for (const s of await figma.getLocalEffectStylesAsync()) styles.push(["effect", s.name, JSON.stringify(s.effects.map((e) => ({ t: e.type, b: Object.fromEntries(Object.entries(e.boundVariables || {}).map(([k, a]) => [k, names[a.id]])) })))]);
for (const s of await figma.getLocalGridStylesAsync()) styles.push(["grid", s.name, JSON.stringify(s.layoutGrids)]);

const textStyleName = {};
for (const s of await figma.getLocalTextStylesAsync()) textStyleName[s.id] = s.name;
async function node(n) {
  // sublayers of an instance nested in a slot of another instance are not readable through the API
  try { n.name; } catch (e) { return { unreadable: n.type }; }
  const o ={ n: n.name, t: n.type, w: round(n.width), h: round(n.height) };
  // hidden layers are not re-laid out by Figma: their size is stale, not part of the design
  if (n.visible === false) {
    o.hidden = true;
    delete o.w;
    delete o.h;
  }
  // a slot-bound frame reads as SLOT or FRAME depending on when the file was loaded
  if (n.type === "SLOT" || n.componentPropertyReferences?.slotContentId) {
    o.t = "FRAME";
    o.slot = true;
  }
  if ("layoutMode" in n && n.layoutMode !== "NONE") {
    o.lay = [n.layoutMode, n.layoutWrap, n.primaryAxisAlignItems, n.counterAxisAlignItems, n.layoutSizingHorizontal, n.layoutSizingVertical].join(",");
    o.sp = [n.itemSpacing, n.counterAxisSpacing, n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].join(",");
  }
  if ("strokeWeight" in n && n.strokes?.length) o.sw = n.strokeWeight === figma.mixed ? "mixed" : n.strokeWeight;
  if ("effectStyleId" in n && n.effectStyleId) o.es = (await figma.getStyleByIdAsync(n.effectStyleId))?.name;
  if ("opacity" in n && n.opacity !== 1) o.o = round(n.opacity);
  if ("fills" in n) o.f = paints(n.fills);
  if ("strokes" in n && n.strokes.length) o.s = paints(n.strokes);
  if ("cornerRadius" in n && n.cornerRadius) o.r = n.cornerRadius === figma.mixed ? "mixed" : n.cornerRadius;
  o.b = bound(n);
  if (n.type === "TEXT") {
    o.c = n.characters;
    o.st = textStyleName[n.textStyleId] || "none";
  }
  if (n.type === "INSTANCE") {
    const m = await n.getMainComponentAsync();
    o.m = (m.parent?.type === "COMPONENT_SET" ? m.parent.name + "/" : "") + m.name;
    o.p = Object.fromEntries(Object.entries(n.componentProperties).map(([k, v]) => [k.split("#")[0], v.type === "INSTANCE_SWAP" ? "swap" : v.value]));
  }
  if (n.type === "COMPONENT_SET") o.props = Object.entries(n.componentPropertyDefinitions).map(([k, d]) => k.split("#")[0] + ":" + d.type).sort();
  // instances walked too: overrides (chip fills, strokes, texts) are part of the fingerprint
  if ("children" in n) o.k = await Promise.all(n.children.map(node));
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}
const order = (n) => ELEMENTS.indexOf(n.name);
const frames = [];
for (const e of elements().sort((a, b) => order(a) - order(b))) frames.push(await node(e));
const masters = await node(rootNamed(MASTERS));
const page = figma.currentPage;
return { page: { name: page.name, bg: paints(page.backgrounds) }, variables, styles, frames, masters };
