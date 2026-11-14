#!/usr/bin/env node
// Compiles the raw kit dump (tools/kit-extract.mjs) into a style-free component grammar:
// anatomy, axes, what each axis option changes, composition level and token roles.
// Usage: kit-grammar.mjs [--raw grammar/shadcn/raw] [--out grammar/shadcn]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const rawDir = arg("raw", "grammar/shadcn/raw");
const outDir = arg("out", "grammar/shadcn");
const ICON_PAGES = /^(Icons|Decorative Icon)/;

// "shadcn colors/shadcn colors/general/primary foreground" -> "primary foreground"
const role = (t) => String(t)
  .replace(/^shadcn colors\/(shadcn colors\/)?/, "")
  .replace(/^general\//, "")
  .replace(/^border radii\//, "")
  .replace(/^spacing\/(out-of-scale\/)?/, "space:");
const cleanName = (s) => s.replace(/\s*-\s*Nova\s*$/, "").replace(/^\./, "").trim();
const propName = (k) => k.split("#")[0].replace(/^⮑\s*/, "").trim();
const paint = (ps) => (Array.isArray(ps) ? ps.map((p) => (p.token ? role(p.token) : p.hex ? "#" + p.hex : p.kind) + (p.opacity ? "@" + p.opacity : "")).join("+") : ps);
const radiusToken = (b) => b && (b.topLeftRadius || b.cornerRadius);

// One layer without its children, reduced to what carries structure or a token role.
const layer = (n) => {
  const r = {};
  if (n.hidden) r.hidden = true;
  if (n.sizing) r.sizing = n.sizing;
  const b = n.bound || {};
  const bound = (key, value) => (b[key] ? role(b[key]) : value);
  if (n.sizing && n.sizing[0] === "X") r.w = bound("width", n.w);
  if (n.sizing && n.sizing[1] === "X") r.h = bound("height", n.h);
  if (n.fills) r.fill = paint(n.fills);
  if (n.strokes) { r.stroke = paint(n.strokes); r.strokeWeight = n.strokeWeight; }
  if (n.radius) r.radius = radiusToken(n.bound) ? role(radiusToken(n.bound)) : n.radius;
  if (n.opacity) r.opacity = n.opacity;
  if (n.effectStyle) r.effect = n.effectStyle;
  if (n.layout) {
    r.layout = n.layout;
    r.gap = bound("itemSpacing", n.gap);
    r.pad = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"].map((k, i) => bound(k, n.pad ? n.pad[i] : 0));
    r.align = n.align;
  }
  if (n.wrap) r.wrap = true;
  if (n.absolute) r.absolute = true;
  if (n.textStyle || n.font) r.text = n.textStyle || n.font;
  if (n.instanceOf) { r.instance = cleanName(n.instanceOf); if (n.values) r.values = n.values; }
  return r;
};
const anatomy = (n) => {
  const r = { name: n.name, kind: n.type === "COMPONENT" ? "root" : n.type.toLowerCase(), ...layer(n) };
  if (n.props) r.props = Object.fromEntries(Object.entries(n.props).map(([k, v]) => [k, propName(v)]));
  if (n.children && n.children.length) r.children = n.children.map(anatomy);
  return r;
};
// Layers by path, the root as "(root)"; siblings sharing a name are told apart by #n.
const flat = (n, key = "(root)", out = {}) => {
  out[key] = layer(n);
  if (n.children && n.children.length > 1) out[key].order = n.children.map((c) => c.name).join(" > ");
  const seen = {};
  for (const c of n.children || []) {
    seen[c.name] = (seen[c.name] || 0) + 1;
    const name = seen[c.name] > 1 ? `${c.name}#${seen[c.name]}` : c.name;
    flat(c, key === "(root)" ? name : `${key}/${name}`, out);
  }
  return out;
};
const applyRule = (layers, rule) => {
  for (const [key, change] of Object.entries(rule)) {
    if (change === "removed") delete layers[key];
    else if (change !== "added") {
      layers[key] = { ...layers[key], ...change };
      for (const f of Object.keys(change)) if (change[f] === null) delete layers[key][f];
    }
  }
  return layers;
};
const parseVariant = (name) => Object.fromEntries(name.split(",").map((kv) => kv.trim().split("=").map((s) => s.trim())));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const diff = (a, b) => {
  const out = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[key], y = b[key];
    if (!x || !y) { out[key] = y ? "added" : "removed"; continue; }
    const changed = {};
    for (const f of new Set([...Object.keys(x), ...Object.keys(y)])) if (!same(x[f], y[f])) changed[f] = y[f] === undefined ? null : y[f];
    if (Object.keys(changed).length) out[key] = changed;
  }
  return out;
};
const deps = (n, out = new Set(), icons = new Set()) => {
  if (n.instanceOf) (ICON_PAGES.test(n.instancePage || "") ? icons : out).add(cleanName(n.instanceOf));
  for (const c of n.children || []) deps(c, out, icons);
  return { out, icons };
};

const files = readdirSync(rawDir).filter((f) => f.endsWith(".json") && f !== "_tokens.json").sort();
const components = [];
let rawSets = 0, rawComponents = 0, axisOptions = 0, axisSkipped = 0, predicted = 0, predictable = 0;
const misses = [], lossy = [];

for (const f of files) {
  const page = JSON.parse(readFileSync(join(rawDir, f), "utf8"));
  const family = page.page.replace(/\s*•\s*$/, "").trim();
  for (const s of page.sets) {
    rawSets++;
    rawComponents += s.variants.length;
    const defs = Object.entries(s.properties);
    const axes = Object.fromEntries(defs.filter(([, p]) => p.type === "VARIANT").map(([k, p]) => [k, { options: p.options, default: p.default }]));
    const defaults = Object.fromEntries(Object.entries(axes).map(([k, a]) => [k, a.default]));
    const byKey = new Map(s.variants.map((v) => [JSON.stringify(Object.entries(parseVariant(v.name)).sort()), v]));
    const pick = (values) => byKey.get(JSON.stringify(Object.entries(values).sort()));
    const base = pick(defaults) || s.variants[0];
    const rules = {};
    for (const [axis, a] of Object.entries(axes)) {
      rules[axis] = {};
      for (const opt of a.options) {
        if (opt === a.default) continue;
        axisOptions++;
        const v = pick({ ...defaults, [axis]: opt });
        if (!v) { axisSkipped++; rules[axis][opt] = "no variant at the other axes' defaults"; continue; }
        rules[axis][opt] = diff(flat(base), flat(v));
      }
    }
    // Check: do the per-axis rules alone rebuild every variant of the set?
    let setHits = 0;
    const crossings = {};
    for (const v of s.variants) {
      const values = parseVariant(v.name);
      const rebuilt = flat(base);
      let ok = true;
      for (const [axis, opt] of Object.entries(values)) {
        if (opt === defaults[axis]) continue;
        const rule = rules[axis] && rules[axis][opt];
        if (!rule || typeof rule === "string") { ok = false; break; }
        applyRule(rebuilt, rule);
      }
      predictable++;
      const residual = ok ? diff(rebuilt, flat(v)) : null;
      if (residual && !Object.keys(residual).length) { predicted++; setHits++; continue; }
      // What the axes do not explain alone: a crossing, kept so the grammar stays lossless.
      crossings[v.name] = residual || diff(flat(base), flat(v));
      if (!residual) crossings[v.name] = { $fromBase: true, ...crossings[v.name] };
    }
    if (setHits < s.variants.length) misses.push(`${cleanName(s.name)} ${setHits}/${s.variants.length}`);
    // Lossless check: base + axis rules + crossing must give every variant back.
    for (const v of s.variants) {
      const values = parseVariant(v.name);
      const rebuilt = flat(base);
      const { $fromBase, ...cross } = crossings[v.name] || {};
      if (!$fromBase) for (const [axis, opt] of Object.entries(values)) if (opt !== defaults[axis]) applyRule(rebuilt, rules[axis][opt]);
      applyRule(rebuilt, cross);
      for (const [k, change] of Object.entries(cross)) if (change === "added") rebuilt[k] = flat(v)[k];
      if (Object.keys(diff(rebuilt, flat(v))).length) lossy.push(`${cleanName(s.name)}: ${v.name}`);
    }
    const used = { out: new Set(), icons: new Set() };
    for (const v of s.variants) { const d = deps(v); d.out.forEach((x) => used.out.add(x)); d.icons.forEach((x) => used.icons.add(x)); }
    components.push({
      name: cleanName(s.name), family, internal: s.name.startsWith(".") || undefined,
      description: s.description, variants: s.variants.length, axes,
      heights: [Math.min(...s.variants.map((v) => v.h)), Math.max(...s.variants.map((v) => v.h))],
      props: Object.fromEntries(defs.filter(([, p]) => p.type !== "VARIANT").map(([k, p]) => [propName(k), { type: p.type, default: p.default }])),
      anatomy: anatomy(base), rules, crossings,
      uses: [...used.out].sort(), icons: [...used.icons].sort(),
    });
  }
  for (const c of page.standalone) {
    rawComponents++;
    const d = deps(c);
    components.push({
      name: cleanName(c.name), family, internal: c.name.startsWith(".") || undefined,
      description: c.description, variants: 1, axes: {},
      heights: [c.h, c.h],
      props: Object.fromEntries(Object.entries(c.properties || {}).map(([k, p]) => [propName(k), { type: p.type, default: p.default }])),
      anatomy: anatomy(c), rules: {},
      uses: [...d.out].sort(), icons: [...d.icons].sort(),
    });
  }
}

// Composition level: atom = no component inside but icons; molecule = atoms only; organism = the rest.
const level = {};
for (const c of components) if (!c.uses.filter((u) => u !== c.name).length) level[c.name] = "atom";
for (const c of components) if (!level[c.name] && c.uses.every((u) => level[u] === "atom" || u === c.name)) level[c.name] = "molecule";
for (const c of components) c.level = level[c.name] || "organism";

// Token roles: resolved values and how often the kit's components use each one.
const tokens = JSON.parse(readFileSync(join(rawDir, "_tokens.json"), "utf8"));
const byPath = {};
for (const c of tokens.collections) for (const v of c.variables) byPath[`${c.name}/${v.name}`] = Object.values(v.values)[0];
const resolve = (val, depth = 0) => (val && val.alias && depth < 10 ? resolve(byPath[val.alias], depth + 1) : val);
const usage = {};
const count = (o) => {
  if (Array.isArray(o)) return o.forEach(count);
  if (o && typeof o === "object") {
    for (const k of ["fill", "stroke", "radius", "effect", "text"]) if (typeof o[k] === "string") for (const t of o[k].split("+")) usage[t] = (usage[t] || 0) + 1;
    Object.values(o).forEach(count);
  }
};
components.forEach((c) => { count(c.anatomy); count(c.rules); });
const roles = {};
for (const coll of tokens.collections) {
  if (!["shadcn colors", "border radii", "spacing"].includes(coll.name)) continue;
  for (const v of coll.variables) {
    const r = role(`${coll.name}/${v.name}`);
    roles[r] = { collection: coll.name, value: resolve(Object.values(v.values)[0]), used: usage[r] || 0 };
  }
}

writeFileSync(join(outDir, "grammar.json"), JSON.stringify({ source: "shadcn ui kit community edition (Obra)", components }, null, 1));
writeFileSync(join(outDir, "tokens.json"), JSON.stringify({ roles, textStyles: tokens.textStyles, effectStyles: tokens.effectStyles }, null, 1));

const lines = ["# Component grammar index", "", "Generated by tools/kit-grammar.mjs. Structure and logic only: values come from the design being produced.", ""];
for (const lv of ["atom", "molecule", "organism"]) {
  lines.push(`## ${lv}`, "");
  for (const c of components.filter((x) => x.level === lv)) {
    const axes = Object.entries(c.axes).map(([k, a]) => `${k}(${a.options.length})`).join(" × ");
    const props = Object.entries(c.props).map(([k, p]) => `${k}:${p.type[0]}`).join(", ");
    lines.push(`- **${c.name}** [${c.family}]${axes ? " · " + axes : ""}${props ? " · " + props : ""}${c.uses.length ? " · uses " + c.uses.join(", ") : ""}`);
  }
  lines.push("");
}
// page-level components (grammar/page.json): found on a web page, built from the atoms above
try {
  const page = JSON.parse(readFileSync(join(outDir, "..", "page.json"), "utf8"));
  lines.push("## page level", "");
  for (const c of page.components) lines.push(`- **${c.name}** [${c.level}] · ${c.when} · holds ${c.holds} · proof: ${c.proof}`);
  lines.push("");
} catch {}
writeFileSync(join(outDir, "index.md"), lines.join("\n"));

const byLevel = Object.fromEntries(["atom", "molecule", "organism"].map((l) => [l, components.filter((c) => c.level === l).length]));
const used = Object.entries(usage).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${k} ${n}`);
const known = new Set(components.map((c) => c.name));
const unknownUses = [...new Set(components.flatMap((c) => c.uses))].filter((u) => !known.has(u));
const icons = [...new Set(components.flatMap((c) => c.icons))].sort();
writeFileSync(join(outDir, "icons.json"), JSON.stringify(icons, null, 0));
console.log(JSON.stringify({ sets: rawSets, components: rawComponents, entries: components.length, byLevel, axisOptions, axisSkipped, rebuilt: `${predicted}/${predictable}`, lossy: lossy.length, lossySample: lossy.slice(0, 5), unknownUses, icons: icons.length, iconSample: icons.slice(0, 5), roles: Object.keys(roles).length, topRoles: used }));
