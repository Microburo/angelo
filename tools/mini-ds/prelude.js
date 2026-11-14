// Shared prelude of every mini DS step (runs inside the Angelo plugin exec, helpers H available).
// Tokens are read by name; every paint, gap, padding and radius on the scale is bound to a variable.
const PAGE = "Design system";
const MASTERS = "Mini DS / components";
const MASTERS_PAGE = "Components";
const CUI = typeof FLAVOR !== "undefined" && FLAVOR === "cui";
// Inter for paragraphs; display in Source Serif 4 Medium (v1) or Inter Semi Bold (cui); cui flavor:, CUI type scale, line heights and control height
const FONTS = [
  { family: "Inter", style: "Regular" },
  { family: "Inter", style: "Medium" },
  CUI ? { family: "Inter", style: "Semi Bold" } : { family: "Source Serif 4", style: "Medium" },
];
await Promise.all(FONTS.map((f) => figma.loadFontAsync(f)));
// page by name, ignoring a leading emoji or symbol the designer may add ("📐 Design system")
const pageNamed = (name) => figma.root.children.find((n) => n.name.replace(/^[^\p{L}\p{N}]+/u, "") === name);
{
  const p = pageNamed(PAGE);
  if (p && figma.currentPage !== p) await figma.setCurrentPageAsync(p);
}

// text style names: Paragraph/<Mini|Small|Medium|Large> <weight>, Display/<1–4> (1 = largest)
const PARA = { 11: "Mini", 13: "Small", 15: "Medium", 17: "Large" };
const DISP = CUI ? { 36: "1", 28: "2", 22: "3", 18: "4" } : { 40: "1", 36: "2", 30: "3", 24: "4" };
const LH = CUI ? { Paragraph: 130, Display: 120 } : { Paragraph: 130, Display: 130 };
const DISPLAY_FONT = CUI ? { family: "Inter", style: "Semi Bold" } : { family: "Source Serif 4", style: "Medium" };
// control height (input, select) and its width
const CTRL = CUI ? 36 : 40;
const STYLE_NAME = (kind, size, weight) => (kind === "Display" ? `Display/${DISP[size]}` : `Paragraph/${PARA[size]} ${weight}`);

const V = {};
for (const x of await figma.variables.getLocalVariablesAsync()) V[x.name] = x;
const TS = {};
for (const s of await figma.getLocalTextStylesAsync()) TS[s.name] = s;
const ES = {};
for (const s of await figma.getLocalEffectStylesAsync()) ES[s.name] = s;
const GS = {};
for (const s of await figma.getLocalGridStylesAsync()) GS[s.name] = s;

const vr = (n) => {
  if (!V[n]) throw new Error("missing variable " + n);
  return V[n];
};
const solid = (n) => figma.variables.setBoundVariableForPaint({ type: "SOLID", color: { r: 0, g: 0, b: 0 } }, "color", vr(n));
// Instances drop the opacity of a token-bound paint (back to 1): translucent paints are written unbound, token resolved for the node
const setPaints = (node, key, paints) => {
  node[key] = paints.map((x) => {
    const alias = x.boundVariables && x.boundVariables.color;
    if (x.opacity == null || x.opacity >= 1 || !alias) return x;
    const c = Object.values(V).find((v) => v.id === alias.id).resolveForConsumer(node).value;
    return { type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: x.opacity * (c.a == null ? 1 : c.a) };
  });
};
// the masters frame may live on its own page: looked up on the other pages once per run
let MASTERS_AWAY = null;
if (!figma.currentPage.children.some((n) => n.name === MASTERS)) {
  for (const p of figma.root.children) {
    if (p === figma.currentPage) continue;
    await p.loadAsync();
    MASTERS_AWAY = p.children.find((n) => n.name === MASTERS) || null;
    if (MASTERS_AWAY) break;
  }
}
const rootNamed = (name) => figma.currentPage.children.find((n) => n.name === name) || (name === MASTERS && MASTERS_AWAY && !MASTERS_AWAY.removed ? MASTERS_AWAY : undefined);
// true when the masters frame shares the board page (only then is it placed next to the cards)
const mastersHere = (m) => m && m.parent === figma.currentPage;

// numeric field: bound to space/<v> or radius/<v> when the value is on the scale, raw otherwise
const num = (node, field, value, scale = "space") => {
  const v = V[`${scale}/${value}`];
  if (v) node.setBoundVariable(field, v);
  else node[field] = value;
};
const pad = (f, p) => {
  const [t, r, b, l] = typeof p === "number" ? [p, p, p, p] : p.length === 2 ? [p[0], p[1], p[0], p[1]] : p;
  num(f, "paddingTop", t);
  num(f, "paddingRight", r);
  num(f, "paddingBottom", b);
  num(f, "paddingLeft", l);
};
// off-scale numeric radius within 2 px of a radius/<n> step snaps to it (ties go down); farther values stay raw
const snapRadius = (r) => {
  if (typeof r !== "number" || V[`radius/${r}`]) return r;
  const steps = Object.keys(V).map((n) => n.match(/^radius\/(\d+)$/)).filter(Boolean).map((m) => +m[1]);
  const near = steps.length ? steps.reduce((best, s) => (Math.abs(s - r) < Math.abs(best - r) ? s : best)) : r;
  return Math.abs(near - r) <= 2 ? near : r;
};
const rad = (f, r) => {
  r = snapRadius(r);
  for (const k of ["topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius"]) num(f, k, r, "radius");
};
const stroke = (f, color, w = 1) => {
  f.strokes = [solid(color)];
  f.strokeWeight = w;
  f.strokeAlign = "INSIDE";
};

// auto-layout frame: { dir: "row"|"col", gap, pad, fill, radius, stroke, sw, align, cross, w, h, minH, wrap, clip }
function box(name, o = {}) {
  const f = o.component ? figma.createComponent() : figma.createFrame();
  f.name = name;
  f.layoutMode = o.dir === "row" ? "HORIZONTAL" : "VERTICAL";
  f.primaryAxisSizingMode = "AUTO";
  f.counterAxisSizingMode = "AUTO";
  f.fills = o.fill ? [solid(o.fill)] : [];
  f.clipsContent = !!o.clip;
  if (o.gap != null) num(f, "itemSpacing", o.gap);
  if (o.pad != null) pad(f, o.pad);
  if (o.radius != null) rad(f, o.radius);
  if (o.stroke) stroke(f, o.stroke, o.sw || 1);
  if (o.align) f.primaryAxisAlignItems = o.align;
  if (o.cross) f.counterAxisAlignItems = o.cross;
  if (o.w || o.h) {
    f.resize(o.w || f.width, o.h || f.height);
    if (o.w) f.layoutSizingHorizontal = "FIXED";
    if (o.h) f.layoutSizingVertical = "FIXED";
  }
  // HUG height with a floor (keeps the drawn height, grows with content)
  if (o.minH) {
    f.layoutSizingVertical = "HUG";
    num(f, "minHeight", o.minH);
  }
  if (o.wrap) {
    f.layoutWrap = "WRAP";
    num(f, "counterAxisSpacing", o.wrap);
  }
  return f;
}
// child sizing once appended: "fill" | "hug" | number (fixed)
function add(parent, child, { w, h } = {}) {
  parent.appendChild(child);
  const set = (axis, v) => {
    if (v == null) return;
    const k = axis === "w" ? "layoutSizingHorizontal" : "layoutSizingVertical";
    if (v === "fill") child[k] = "FILL";
    else if (v === "hug") child[k] = "HUG";
    else {
      child.resize(axis === "w" ? v : child.width, axis === "h" ? v : child.height);
      child[k] = "FIXED";
    }
  };
  set("w", w);
  set("h", h);
  return child;
}
async function text(chars, style, color = "text/primary", name) {
  const t = figma.createText();
  if (!TS[style]) throw new Error("missing text style " + style);
  await t.setTextStyleIdAsync(TS[style].id);
  t.characters = chars;
  t.fills = [solid(color)];
  t.name = name || chars.slice(0, 40);
  return t;
}
// V1 icons: Lucide drawn at stroke 1.5 (the original file's icon page)
const ICON = { stroke: 1.5 };
// Lucide instance, sized; its master paints the vector with icon/default (default icon color),
// the instance overrides it with `color` when given; primary and secondary ink (text/primary, text/secondary) map to icon/default
async function ico(name, size = 18, color = null, layer) {
  if ((color === "text/primary" || color === "text/secondary") && V["icon/default"]) color = "icon/default";
  const comp = await H.icon(name, ICON);
  if (!comp) throw new Error("no Lucide icon " + name);
  if (V["icon/default"]) for (const v of comp.findAll((n) => n.type === "VECTOR")) if (!v.fills[0]?.boundVariables?.color) v.fills = [solid("icon/default")];
  const i = comp.createInstance();
  i.resize(size, size);
  if (color) for (const v of i.findAll((n) => n.type === "VECTOR")) v.fills = [solid(color)];
  i.name = layer || name;
  return i;
}
// own layers of a component (instances not walked)
function own(root, name) {
  const out = [];
  const todo = [...root.children];
  while (todo.length) {
    const n = todo.shift();
    if (n.name === name) out.push(n);
    if ("children" in n && n.type !== "INSTANCE") todo.push(...n.children);
  }
  return out;
}
// variants from the cartesian product of axes; build(props) returns a ComponentNode
async function variants(name, axes, build, { cols, parent } = {}) {
  // axes: { Axis: [values] } (cartesian product) or an explicit list of combos
  const list = Array.isArray(axes);
  const keys = list ? Object.keys(axes[0]) : Object.keys(axes);
  let combos = list ? axes : [{}];
  if (!list) for (const k of keys) combos = combos.flatMap((c) => axes[k].map((v) => ({ ...c, [k]: v })));
  const comps = [];
  for (const p of combos) {
    const c = await build(p);
    c.name = keys.map((k) => `${k}=${p[k]}`).join(", ");
    comps.push(c);
  }
  const host = parent || rootNamed(MASTERS);
  // combineAsVariants needs the comps on the host's page (masters frame may live on another page)
  for (const c of comps) if (c.parent !== host) host.appendChild(c);
  const set = figma.combineAsVariants(comps, host);
  set.name = name;
  set.layoutMode = "HORIZONTAL";
  set.layoutWrap = "WRAP";
  set.itemSpacing = 24;
  set.counterAxisSpacing = 24;
  set.paddingTop = set.paddingRight = set.paddingBottom = set.paddingLeft = 24;
  set.primaryAxisSizingMode = "FIXED";
  set.counterAxisSizingMode = "AUTO";
  set.counterAxisAlignItems = "CENTER";
  const n = cols || (list ? combos.length : axes[keys[keys.length - 1]].length);
  const maxW = Math.max(...comps.map((c) => c.width));
  set.resize(n * maxW + (n - 1) * 24 + 48, set.height);
  set.fills = [];
  return set;
}
// component properties on a set (or a lone component), referenced by every own layer of that name
// specs: [{ layer, kind: "BOOLEAN"|"TEXT"|"SWAP", name, def, pref }]
function wire(set, specs) {
  const targets = set.type === "COMPONENT_SET" ? set.children : [set];
  const field = { BOOLEAN: "visible", TEXT: "characters", SWAP: "mainComponent" };
  for (const s of specs) {
    const first = targets.map((t) => own(t, s.layer)[0]).find(Boolean);
    if (!first) throw new Error(`no layer ${s.layer} in ${set.name}`);
    const def = s.kind === "TEXT" ? (s.def ?? first.characters) : s.kind === "BOOLEAN" ? (s.def ?? true) : s.def;
    const type = s.kind === "SWAP" ? "INSTANCE_SWAP" : s.kind;
    const opts = s.pref ? { preferredValues: s.pref.map((c) => ({ type: c.type === "COMPONENT_SET" ? "COMPONENT_SET" : "COMPONENT", key: c.key })) } : undefined;
    const key = set.addComponentProperty(s.name, type, def, opts);
    for (const t of targets) for (const l of own(t, s.layer)) l.componentPropertyReferences = { ...(l.componentPropertyReferences || {}), [field[s.kind]]: key };
  }
}
// repeated content as a SLOT: in each variant (or `only` that one), children [from, to) move into a frame with the
// parent's direction, gap and cross alignment, bound to one SLOT property, so instances can stack more content
// `frame`: bind that existing nested list frame instead (variants without it are skipped)
async function slotify(set, prop, { from = 0, to, only, frame } = {}) {
  const targets = (set.type === "COMPONENT_SET" ? set.children : [set]).filter((v) => !only || v.name === only);
  const key = set.addComponentProperty(prop, "SLOT", "");
  for (const v of targets) {
    if (frame) {
      for (const f of own(v, frame)) f.componentPropertyReferences = { slotContentId: key };
      continue;
    }
    const kids = v.children.slice(from, to);
    const f = figma.createFrame();
    f.name = prop.toLowerCase();
    f.fills = [];
    f.clipsContent = false;
    f.layoutMode = v.layoutMode;
    f.itemSpacing = v.itemSpacing;
    const gap = v.boundVariables?.itemSpacing;
    if (gap) f.setBoundVariable("itemSpacing", await figma.variables.getVariableByIdAsync(gap.id));
    f.counterAxisAlignItems = v.counterAxisAlignItems;
    v.insertChild(from, f);
    // main axis hugs the items; a vertical list fills the parent's width, a row hugs
    f.layoutSizingHorizontal = v.layoutMode === "VERTICAL" ? "FILL" : "HUG";
    f.layoutSizingVertical = "HUG";
    for (const k of kids) {
      const h = k.layoutSizingHorizontal, vv = k.layoutSizingVertical;
      f.appendChild(k);
      if (h === "FILL") k.layoutSizingHorizontal = "FILL";
      if (vv === "FILL") k.layoutSizingVertical = "FILL";
    }
    f.componentPropertyReferences = { slotContentId: key };
  }
  return key;
}
// instance of a set's variant: inst(set, { Type: "Primary" }, { "Left icon": true, Label: "Save" })
function inst(set, variant = {}, props = {}) {
  const c = set.type === "COMPONENT_SET" ? set.defaultVariant : set;
  const i = c.createInstance();
  const all = { ...variant, ...props };
  const defs = i.componentProperties;
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    const key = Object.keys(defs).find((d) => d === k || d.split("#")[0] === k);
    if (!key) throw new Error(`no property ${k} on ${set.name}`);
    const type = defs[key].type;
    if ((type === "BOOLEAN") !== (typeof v === "boolean")) throw new Error(`property ${k} on ${set.name} is ${type}, got ${typeof v}`);
    // re-setting a swap to its current component resets the nested instance (name and color overrides lost)
    if (type === "INSTANCE_SWAP" && defs[key].value === v) continue;
    out[key] = v;
  }
  if (Object.keys(out).length) i.setProperties(out);
  return i;
}
// masters live in the frame itself, or in its "columns" grid once a flavor's 09-check laid them out
const setNamed = (name) => {
  const ms = rootNamed(MASTERS);
  const grid = ms.findChild((n) => n.name === "columns");
  return ms.findChild((n) => n.name === name) || (grid ? grid.children.map((col) => col.findChild((n) => n.name === name)).find(Boolean) : null);
};

// presentation: one top-level element frame per element (white card on the grey page, named after
// the element, radius 24, padding 40, gap 20, Board / title instance on top), laid out in ELEMENTS order by step 09
const ELEMENT = "mini-ds-element";
const ELEMENTS = [
  "Primitives", "Semantic", "Display", "Paragraph", "Spacing", "Radius", "Elevation", "Grid",
  "Avatar", "Badge", "Button", "Checkbox · Radio", "Field", "Icon button", "Image", "Input", "Item", "Select", "Slider", "Textarea",
  // ported from the cui flavor (steps-cui shared source)
  "Switch", "Segmented control", "Tabs", "Chip", "Keycap", "Radio card", "Progress",
  "Alert", "Toast", "Tooltip", "Empty state",
  "Menu", "Split button", "Reactions", "Speed dial", "Theme switcher and toggle", "User menu",
  "One time code", "Combobox",
  "Dropzone", "Avatar upload", "Time picker", "Date picker and calendar", "Date range picker",
  "Sidebar navigation",
  "Popover", "Hover card", "Confirm popover", "Dialog", "Expandable text and card",
  "Progress, meter, spinner and skeleton", "Onboarding checklist", "Undo toast",
  "Accordion", "Reorderable list", "Table", "Data grid and filter bar", "Property inspector",
  "Kanban board", "Chat", "Comments", "Presence, counter and ticker",
  "Control tiles", "Agent plan and status", "Composer and model picker",
];
// cui flavor: one board row per tier, interface foundations first, then elements from simple to composed
let TIERS = null;
if (CUI) {
  TIERS = [
    ["Primitives", "Semantic", "Display", "Paragraph", "Spacing", "Radius", "Elevation", "Grid"],
    ["Button", "Icon button", "Badge", "Chip", "Keycap", "Avatar", "Image", "Tooltip",
      "Input", "Textarea", "Select", "Field", "Checkbox · Radio", "Switch", "Radio card", "Slider", "Segmented control"],
    ["Number field", "Money field", "Prefix and suffix", "Tag input", "One time code", "Combobox", "Multi-select",
      "Button group, copy and hold to confirm", "Split button", "Toggle group", "Confirm button", "Status button", "Reactions", "Speed dial", "Theme switcher and toggle"],
    ["Progress", "Alert", "Toast", "Undo toast", "Empty state", "Progress, meter, spinner and skeleton", "Onboarding checklist",
      "Tabs", "Menu", "User menu", "Breadcrumb, pagination and stepper", "Table of contents", "Menu bar", "Toolbar", "Document tabs", "Sidebar navigation"],
    ["Popover", "Hover card", "Confirm popover", "Dialog", "Command palette",
      "Item", "Accordion", "Expandable text and card", "Reorderable list", "List and tree", "Table", "Data grid and filter bar", "Property inspector"],
    ["Dropzone", "Avatar upload", "Time picker", "Date picker and calendar", "Date range picker",
      "Control tiles", "Presence, counter and ticker", "Image compare and card stack", "Chat", "Comments", "Agent plan and status", "Composer and model picker", "Kanban board"],
  ];
  ELEMENTS.length = 0;
  ELEMENTS.push(...TIERS.flat());
} else {
  // v1: one row per family, foundations first, then from simple to composed
  TIERS = [
    ELEMENTS.slice(0, 8),
    ["Button", "Icon button", "Split button", "Badge", "Chip", "Keycap", "Avatar", "Image", "Reactions", "Speed dial", "Theme switcher and toggle"],
    ["Input", "Textarea", "Select", "Combobox", "Field", "Checkbox · Radio", "Switch", "Control tiles", "Radio card", "Slider", "Segmented control", "One time code"],
    ["Dropzone", "Avatar upload", "Time picker", "Date picker and calendar", "Date range picker"],
    ["Item", "Tabs", "Sidebar navigation", "Menu", "User menu"],
    ["Tooltip", "Alert", "Toast", "Undo toast", "Empty state", "Progress", "Progress, meter, spinner and skeleton", "Onboarding checklist"],
    ["Popover", "Hover card", "Confirm popover", "Dialog", "Expandable text and card"],
    ["Accordion", "Reorderable list", "Table", "Data grid and filter bar", "Property inspector"],
    ["Kanban board", "Chat", "Comments", "Presence, counter and ticker", "Agent plan and status", "Composer and model picker"],
  ];
}
const elements = () => figma.currentPage.children.filter((n) => n.getPluginData(ELEMENT));
// a rerun replaces its element frame in place; `_parent` kept for call compatibility
async function card(_parent, caption, title, o = {}) {
  const prev = elements().find((n) => n.name === caption);
  const c = box(caption, { fill: "bg/surface", radius: "board", pad: 40, gap: o.gap ?? 20, dir: o.dir, w: o.w, wrap: o.wrap, cross: o.cross });
  c.setPluginData(ELEMENT, "1");
  figma.currentPage.appendChild(c);
  if (prev) {
    c.x = prev.x;
    c.y = prev.y;
    prev.remove();
    c.setPluginData("inPlace", "1");
  } else {
    c.x = elements().filter((n) => n !== c).reduce((m, n) => Math.max(m, n.x + n.width), -40) + 40;
    c.y = 0;
  }
  // title: instance of the Board / title master (Paragraph/Medium Regular, 40 below), full width
  if (title) {
    add(c, inst(setNamed("Board / title"), {}, { Title: title }), { w: "fill" });
  }
  c.visible = false;
  return { wrap: c, card: c };
}
// Nervous reveal (web-to-figma pace): the card, then its rows and their items in quick glides
// (64 ms glide, 38 ms rest). Past BURST stops, the remaining items show with the stop before them.
const BURST = 24;
async function burst(c, wrap) {
  const seq = [];
  for (const row of wrap.children) {
    seq.push(row);
    if ("children" in row && row.type !== "INSTANCE" && row.children.length <= 40) seq.push(...row.children);
  }
  // nodes hidden by design stay hidden
  const shown = seq.filter((n) => n.visible);
  seq.length = 0;
  seq.push(...shown);
  for (const n of seq) n.visible = false;
  // placed now its content is built: at creation the previous card could still be empty and narrow
  if (!wrap.getPluginData("inPlace")) wrap.x = elements().filter((n) => n !== wrap && n.visible).reduce((m, n) => Math.max(m, n.x + n.width), -40) + 40;
  // masters frame stays after the last card while the row grows (09-check: 300 after the row)
  const right = elements().filter((n) => n.visible || n === wrap).reduce((m, n) => Math.max(m, n.x + n.width), 0);
  const ms = rootNamed(MASTERS);
  if (mastersHere(ms) && ms.x < right + 300) ms.x = right + 300;
  await c.put(wrap, 64, 38);
  const per = Math.ceil(seq.length / BURST) || 1;
  for (let i = 0; i < seq.length; i += per) {
    const group = seq.slice(i, i + per);
    await c.put(group[0], 64, 38);
    for (const n of group.slice(1)) n.visible = true;
  }
}
// component radius tokens (Semantic radius/<component>): tile bound to the token, name + aliased step
async function radiusComponents(parent, label) {
  parent.findChild((n) => n.name === "components")?.remove();
  const row = box("components", { dir: "row", gap: 24 });
  for (const name of Object.keys(V).filter((n) => /^radius\/[a-z]/.test(n) && n !== "radius/board")) { // (board = the element cards' own rounding, not a component)
    const alias = Object.values(V[name].valuesByMode)[0];
    const target = (await figma.variables.getVariableByIdAsync(alias.id)).name;
    const t = box(name, { gap: 8 });
    add(t, box("tile", { fill: "primary/subtle", stroke: "border/strong", radius: name.split("/")[1] }), { w: 64, h: 64 });
    t.appendChild(await label(name, "→ " + target));
    row.appendChild(t);
  }
  parent.appendChild(row);
  return row;
}
// boards are gone: kept so steps read the same; root/body are null (cursor ring follows nothing)
async function board() {
  return { root: null, body: null };
}
