#!/usr/bin/env node
// Read-only dump of a Figma UI kit: tokens, styles and every component's structure, as raw JSON on disk.
// The plugin must be open in the kit file. Nothing is written to Figma.
// Usage: kit-extract.mjs --out grammar/shadcn/raw [--page <regex>] [--skip-page <regex>] [--chunk 30] [--tokens-only]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeRpc, pluginFile } from "./web-lib.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const out = arg("out", "grammar/shadcn/raw");
const pageRe = arg("page", ".");
const skipRe = arg("skip-page", "^(Icons|Thumbnail)$");
const chunk = Number(arg("chunk", 30));
const tokensOnly = process.argv.includes("--tokens-only");
mkdirSync(out, { recursive: true });

const file = await pluginFile();
const rpc = makeRpc(file);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const size = (o) => JSON.stringify(o).length;

// Runs in the plugin: helpers shared by every exec.
const PRELUDE = `
const allVars = await figma.variables.getLocalVariablesAsync();
const cols = await figma.variables.getLocalVariableCollectionsAsync();
const colName = Object.fromEntries(cols.map((c) => [c.id, c.name]));
const varName = Object.fromEntries(allVars.map((v) => [v.id, colName[v.variableCollectionId] + "/" + v.name]));
const hex = (c) => [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
const round = (v) => typeof v === "number" ? Math.round(v * 100) / 100 : v;
const paints = (ps) => {
  if (!Array.isArray(ps)) return ps === figma.mixed ? "mixed" : undefined;
  const out = ps.filter((p) => p.visible !== false).map((p) => {
    const bound = p.boundVariables && p.boundVariables.color;
    if (p.type !== "SOLID") return { kind: p.type };
    const r = bound ? { token: varName[bound.id] || bound.id } : { hex: hex(p.color) };
    if (p.opacity !== undefined && p.opacity < 1) r.opacity = round(p.opacity);
    return r;
  });
  return out.length ? out : undefined;
};
const styleName = async (id) => {
  if (!id || id === figma.mixed) return undefined;
  const s = await figma.getStyleByIdAsync(id);
  return s ? s.name : id;
};
const bindings = (n) => {
  const b = n.boundVariables || {};
  const r = {};
  for (const k of Object.keys(b)) {
    if (k === "fills" || k === "strokes" || k === "effects") continue;
    const v = b[k];
    if (v && v.id) r[k] = varName[v.id] || v.id;
  }
  return Object.keys(r).length ? r : undefined;
};
const mainCache = {};
const mainOf = async (n) => {
  const m = await n.getMainComponentAsync();
  if (!m) return null;
  if (mainCache[m.id]) return mainCache[m.id];
  let p = m;
  while (p && p.type !== "PAGE") p = p.parent;
  const inSet = m.parent && m.parent.type === "COMPONENT_SET";
  return (mainCache[m.id] = { main: inSet ? m.parent.name : m.name, variant: inSet ? m.name : undefined, page: p ? p.name : "(remote)" });
};
const clean = (o) => {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === false || o[k] === 0 && k.startsWith("pad")) delete o[k];
  return o;
};
const ser = async (n, depth) => {
  const r = { name: n.name, type: n.type };
  if (n.visible === false) r.hidden = true;
  if (n.componentPropertyReferences && Object.keys(n.componentPropertyReferences).length) r.props = n.componentPropertyReferences;
  r.w = round(n.width); r.h = round(n.height);
  if (n.opacity !== undefined && n.opacity < 1) r.opacity = round(n.opacity);
  if (n.layoutPositioning === "ABSOLUTE") r.absolute = true;
  // H = hug, X = fixed, L = fill (the first letter alone cannot tell FIXED from FILL).
  const sz = { HUG: "H", FIXED: "X", FILL: "L" };
  if (n.layoutSizingHorizontal) r.sizing = sz[n.layoutSizingHorizontal] + sz[n.layoutSizingVertical];
  const fills = paints(n.fills); if (fills) r.fills = fills;
  const strokes = paints(n.strokes); if (strokes) { r.strokes = strokes; r.strokeWeight = n.strokeWeight === figma.mixed ? "mixed" : round(n.strokeWeight); }
  if (n.cornerRadius) r.radius = n.cornerRadius === figma.mixed ? "mixed" : round(n.cornerRadius);
  const es = await styleName(n.effectStyleId); if (es) r.effectStyle = es;
  const bv = bindings(n); if (bv) r.bound = bv;
  if (n.layoutMode && n.layoutMode !== "NONE") {
    r.layout = n.layoutMode; r.gap = round(n.itemSpacing);
    r.pad = [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].map(round);
    r.align = n.primaryAxisAlignItems + "/" + n.counterAxisAlignItems;
    if (n.layoutWrap === "WRAP") r.wrap = true;
  }
  if (n.minWidth) r.minW = n.minWidth; if (n.maxWidth) r.maxW = n.maxWidth;
  if (n.clipsContent) r.clip = true;
  if (n.type === "TEXT") {
    r.text = n.characters.slice(0, 60);
    r.textStyle = await styleName(n.textStyleId);
    if (!r.textStyle) r.font = n.fontName === figma.mixed ? "mixed" : n.fontName.family + " " + n.fontName.style + " " + String(n.fontSize);
    r.autoResize = n.textAutoResize; r.alignH = n.textAlignHorizontal; r.alignV = n.textAlignVertical;
  }
  if (n.type === "INSTANCE") {
    const m = await mainOf(n);
    if (m) Object.assign(r, { instanceOf: m.main, variant: m.variant, instancePage: m.page });
    const cp = {};
    for (const [k, v] of Object.entries(n.componentProperties || {})) cp[k.split("#")[0]] = v.value;
    if (Object.keys(cp).length) r.values = cp;
    const ov = (n.overrides || []).length; if (ov) r.overrides = ov;
    return clean(r);
  }
  if (n.children && depth < 12) {
    r.children = [];
    for (const k of n.children) r.children.push(await ser(k, depth + 1));
  }
  return clean(r);
};
const propDefs = (c) => {
  const out = {};
  for (const [k, v] of Object.entries(c.componentPropertyDefinitions || {})) {
    const d = { type: v.type, default: v.defaultValue };
    if (v.variantOptions) d.options = v.variantOptions;
    if (v.preferredValues && v.preferredValues.length) d.preferred = v.preferredValues.length;
    out[k] = d;
  }
  return out;
};
`;

const t0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`, ...a);

const tokens = await rpc(`${PRELUDE}
const value = (v, val) => {
  if (val && val.type === "VARIABLE_ALIAS") return { alias: varName[val.id] || val.id };
  if (v.resolvedType === "COLOR") return hex(val) + (val.a !== undefined && val.a < 1 ? "@" + round(val.a) : "");
  return val;
};
const collections = cols.map((c) => ({
  name: c.name, modes: c.modes.map((m) => m.name),
  variables: allVars.filter((v) => v.variableCollectionId === c.id).map((v) => ({
    name: v.name, type: v.resolvedType, scopes: v.scopes, description: v.description || undefined,
    values: Object.fromEntries(c.modes.map((m) => [m.name, value(v, v.valuesByMode[m.modeId])])),
  })),
}));
const textStyles = (await figma.getLocalTextStylesAsync()).map((s) => ({
  name: s.name, family: s.fontName.family, style: s.fontName.style, size: s.fontSize, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing,
  case: s.textCase, decoration: s.textDecoration, bound: Object.fromEntries(Object.entries(s.boundVariables || {}).map(([k, v]) => [k, varName[v.id] || v.id])),
}));
const effectStyles = (await figma.getLocalEffectStylesAsync()).map((s) => ({
  name: s.name,
  effects: s.effects.map((e) => ({ type: e.type, radius: e.radius, spread: e.spread, offset: e.offset, color: e.color ? hex(e.color) + "@" + round(e.color.a) : undefined,
    bound: e.boundVariables ? Object.fromEntries(Object.entries(e.boundVariables).map(([k, v]) => [k, varName[v.id] || v.id])) : undefined })),
}));
return { collections, textStyles, effectStyles };`);
writeFileSync(join(out, "_tokens.json"), JSON.stringify(tokens, null, 1));
log("tokens", tokens.collections.reduce((s, c) => s + c.variables.length, 0), "variables,", tokens.textStyles.length, "text,", tokens.effectStyles.length, "effect,", size(tokens), "bytes");
if (tokensOnly) process.exit(0);

const index = await rpc(`
const re = new RegExp(${JSON.stringify(pageRe)}, "i"), skip = new RegExp(${JSON.stringify(skipRe)}, "i");
const out = [];
for (const p of figma.root.children) {
  if (!re.test(p.name) || skip.test(p.name)) continue;
  await p.loadAsync();
  const sets = p.findAllWithCriteria({ types: ["COMPONENT_SET"] }).map((s) => ({ id: s.id, name: s.name, kids: s.children.map((k) => k.id) }));
  const solo = p.findAllWithCriteria({ types: ["COMPONENT"] }).filter((c) => c.parent.type !== "COMPONENT_SET").map((c) => ({ id: c.id, name: c.name }));
  if (sets.length || solo.length) out.push({ page: p.name, sets, solo });
}
return out;`);
log("pages", index.length);

let setCount = 0, compCount = 0, maxExec = 0;
const timed = async (code) => {
  const t = Date.now();
  const r = await rpc(code);
  maxExec = Math.max(maxExec, Date.now() - t);
  return r;
};
for (const page of index) {
  const res = { page: page.page, sets: [], standalone: [] };
  for (const s of page.sets) {
    const head = await timed(`${PRELUDE}
const s = await figma.getNodeByIdAsync(${JSON.stringify(s.id)});
return { name: s.name, description: s.description || undefined, properties: propDefs(s), defaultVariant: s.defaultVariant ? s.defaultVariant.name : undefined };`);
    head.variants = [];
    for (let i = 0; i < s.kids.length; i += chunk) {
      const ids = s.kids.slice(i, i + chunk);
      const part = await timed(`${PRELUDE}
const out = [];
for (const id of ${JSON.stringify(ids)}) out.push(await ser(await figma.getNodeByIdAsync(id), 0));
return out;`);
      head.variants.push(...part);
    }
    res.sets.push(head);
    setCount++;
    compCount += head.variants.length;
  }
  for (const c of page.solo) {
    const one = await timed(`${PRELUDE}
const c = await figma.getNodeByIdAsync(${JSON.stringify(c.id)});
const r = await ser(c, 0);
r.description = c.description || undefined;
r.properties = propDefs(c);
return r;`);
    res.standalone.push(one);
    compCount++;
  }
  const f = join(out, `${slug(page.page.replace(/\s*\(OC\)/, "-oc"))}.json`);
  writeFileSync(f, JSON.stringify(res, null, 1));
  log(page.page, `sets ${page.sets.length} solo ${page.solo.length}`, size(res), "bytes");
}
log(`done: sets ${setCount} components ${compCount} max exec ${maxExec} ms`);
