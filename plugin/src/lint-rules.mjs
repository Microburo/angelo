// Component lint: one set of rules, read by the plugin (H.lint, on Figma nodes) and by the pipeline
// (tools/web-lint.mjs, on layout output). Pure JS over a neutral tree, no Figma API and no Node API.
//
// Component: { id?, name, count?, axes: { axis: [values] }, props: [{ name, type }], variants: [Layer] }
//   count = occurrences on the page, axes = {} and one variant for a plain component.
// Layer: { name, kind: "frame"|"text"|"icon"|"image"|"shape"|"instance", kit?, auto?: bool, painted?: bool,
//   padded?: bool, abs?: bool, slot?: bool, optional?: bool, boolProp?: name, swapProp?: name, kids?: [Layer] }

// Axes a variant set may have: what an instance can't express otherwise, nothing else.
export const AXES = new Set(["state", "variant", "tone", "size", "width", "orientation", "type"]);
// How deep a component may nest its frames, root excluded: the deepest of each level in the kit.
export const DEPTH = { atom: 1, molecule: 2, organism: 2 };
const DEPTH_FREE = 4; // a component the kit doesn't know (a page block): twice its deepest

const VALUE_NOISE = /^(default|variant|style|option|version)\s*\d+$|^\d+$/i;
const PX = /\b\d+\s*px\b/i;
const SUFFIX = /\s\d+$/;
// (lowercase, as the DOM writes it: "Button", "Footer" are names a person would give)
const HTML_TAG = /^(div|span|section|article|aside|header|footer|main|nav|ul|ol|li|a|p|h[1-6]|button|label|figure|form|svg|path|g|img|picture|video)$/;
// A page's landmarks need no category: there is one of each.
const LANDMARK = /^(header|footer|navigation|subnav|sidebar|search bar|filters)$/i;
const DEFAULT_LAYER = /^(frame|group|rectangle|vector|ellipse|line|instance)(\s\d+)?$/i;
const ICON_NAME = /^icon\s*\/\s*\S/i;
const VOWEL = /[aeiouyàâéèêëîïôùûü]/i;

// A word that reads as a CSS fragment rather than a word: too short, no vowel, digits mixed in, an odd capital.
// Known short words and acronyms of interface vocabulary are let through.
const SHORT_OK = new Set(["big", "small", "btn", "bg","msg", "a11y", "alt", "cmd", "sub", "pr", "ad", "ads", "ai", "ui", "ux", "cta", "faq", "nav", "tab", "tag", "row", "bar", "map", "key", "kbd", "url", "api", "app", "log", "pin", "dot", "box", "hero", "menu", "card", "link", "list", "icon", "text", "logo", "chip", "item", "form", "grid", "cell", "code", "date", "file", "line", "step", "tile", "toc", "svg", "img", "top", "new", "pdf", "ios", "off", "on", "of", "by", "in", "to", "up", "and", "or", "the", "for", "with", "xs", "sm", "md", "lg", "xl", "xxl"]);
export const isCssFragment = (word) => {
  const w = word.trim();
  if (!/\p{L}/u.test(w)) return false; // a sign or a number isn't a word at all
  if (!w) return false;
  const low = w.toLowerCase();
  if (SHORT_OK.has(low)) return false;
  if (/\d/.test(w) && /\p{L}/u.test(w)) return true;
  if (low.length <= 3) return true;
  if (w === w.toUpperCase()) return false; // a label of the page in capitals ("ALBA", "WORLD"), not a class
  if (!VOWEL.test(low)) return true;
  if (/[a-z][A-Z]/.test(w) || /^[A-Z][a-z]*[A-Z]/.test(w)) return true;
  return false;
};
const nameWords = (name) => name.split(/[\/,=]|\s+/).map((s) => s.trim()).filter(Boolean);

// The kit component a name points at: its first path part, its number left out, under the kit's name or the shorter one it goes by.
const KIT_ALIAS = { row: "dropdown menu item", avatar: "avatar with image" };
export const kitKey = (name) => { const k = name.split("/")[0].trim().replace(SUFFIX, "").toLowerCase(); return KIT_ALIAS[k] || k; };

// Depth of nested frames under a layer, nested instances counting as leaves: their depth is their own component's.
const depthOf = (l) => (l.kind === "frame" ? 1 + Math.max(0, ...(l.kids || []).map(depthOf)) : 0);
const walk = (l, f, parent = null) => { f(l, parent); for (const k of l.kids || []) walk(k, f, l); };
const leaves = (l, out = []) => { if (l.kind !== "frame") out.push(l); else for (const k of l.kids || []) leaves(k, out); return out; };

// Rank of a layer in the row order: img · avatar · left-icon · text · right-icon.
const orderClass = (l, seenText) => (l.kind === "image" || /avatar/i.test(l.name) ? 0 : l.kind === "icon" || l.swapProp ? (seenText ? 3 : 1) : l.kind === "text" ? 2 : -1);

// Shape of a layer, for finding components that are one thing built twice.
const shapeOf = (l) => (l.kind === "frame" ? `f${l.auto ? "a" : ""}${l.painted ? "p" : ""}(${(l.kids || []).map(shapeOf).join(",")})` : l.kind[0]);

export const RULES = {
  // structure
  "depth": "more nested frames than its level allows",
  "wrapper": "unpainted frame holding one child with no padding",
  "lone-text": "a component that is only a text: a text style, not a component",
  "slot-instances": "slot holding instances, whose sublayers can't be read or written",
  "absolute": "absolutely placed layer in a component that can lay it out",
  // naming
  "name-pattern": "component not named Category / Name",
  "name-css": "name made of CSS fragments",
  "name-px": "pixels in a name",
  "name-number": "name told apart by a number",
  "icon-name": "icon component not named Icon / <name>",
  "layer-tag": "layer named after an HTML tag",
  "layer-default": "layer with Figma's default name",
  // variants
  "axis-unknown": "variant axis other than state, variant, size, width",
  "axis-single": "axis with one value",
  "value-noise": "axis value that means nothing (Default 2, Variant 3)",
  "variant-boolean": "two variants differ by one layer: a boolean, not a variant",
  // properties
  "opt-no-bool": "optional layer with no boolean",
  "icon-no-swap": "icon layer with no instance swap",
  "prop-css": "property named after a CSS fragment",
  "prop-unused": "boolean bound to no layer",
  // order
  "row-order": "row not in the order img, avatar, left icon, text, right icon",
  // duplicates
  "duplicate": "same structure as another component",
};

// (slot-instances: asked for on organisms, the rule stays as a reminder of what can't be patched afterwards)
const SEVERITY = { "slot-instances": "info", depth: "warn", wrapper: "warn", "lone-text": "warn", absolute: "info", "layer-default": "info", "layer-tag": "info", "row-order": "info", duplicate: "warn" };

// One component's issues: [{ rule, at, detail }]
export function lintComponent(c) {
  const out = [];
  const add = (rule, at, detail) => out.push({ rule, severity: SEVERITY[rule] || "error", component: c.name, at, detail });
  // (a painted or padded frame around one icon is an icon button, not an icon)
  const isIcon = c.variants.every((v) => v.kind === "icon" || (!v.painted && !v.padded && (v.kids || []).length && leaves(v).every((l) => l.kind === "icon") && leaves(v).length === 1));

  // naming
  if (isIcon && !ICON_NAME.test(c.name)) add("icon-name", c.name);
  if (!isIcon && !c.name.includes("/") && c.kit === undefined && c.free !== true && !LANDMARK.test(c.name.replace(SUFFIX, ""))) add("name-pattern", c.name);
  // (an icon set's own names are words of its vocabulary: "x", "axe", "clock-1")
  const bad = ICON_NAME.test(c.name) ? [] : nameWords(c.name).filter((w) => !/^\d+$/.test(w) && !PX.test(w) && isCssFragment(w));
  if (bad.length) add("name-css", c.name, bad.join(" "));
  if (PX.test(c.name)) add("name-px", c.name);
  if (SUFFIX.test(c.name)) add("name-number", c.name);

  // variants
  for (const [axis, values] of Object.entries(c.axes || {})) {
    if (!AXES.has(axis.toLowerCase())) add("axis-unknown", axis);
    if (values.length < 2) add("axis-single", axis, values[0]);
    for (const v of values) if (VALUE_NOISE.test(String(v))) add("value-noise", axis, v);
  }
  // a pair of variants whose leaves differ by exactly one is a boolean away from being one
  const sigs = c.variants.map((v) => leaves(v).map((l) => l.kind[0]));
  sigs.forEach((a, i) => {
    for (let j = i + 1; j < sigs.length; j++) {
      const [s, b] = a.length < sigs[j].length ? [a, sigs[j]] : [sigs[j], a];
      if (b.length - s.length !== 1) continue;
      let x = 0;
      for (const k of b) if (k === s[x]) x++;
      if (x === s.length) { add("variant-boolean", `${i + 1}/${j + 1}`); return; }
    }
  });

  // layers
  const used = new Set();
  for (const root of c.variants) {
    const d = depthOf(root) - 1;
    const allowed = DEPTH[c.level] ?? DEPTH_FREE;
    if (d > allowed) add("depth", root.name, `${d} > ${allowed}`);
    if ((root.kids || []).length === 1 && root.kids[0].kind === "text" && !root.painted && !root.padded) add("lone-text", root.name);
    walk(root, (l, parent) => {
      if (parent) {
        if (HTML_TAG.test(l.name)) add("layer-tag", l.name);
        else if (DEFAULT_LAYER.test(l.name)) add("layer-default", l.name);
        // (a box around one absolute child positions it: not a wrapper)
        if (l.kind === "frame" && !l.painted && !l.padded && !l.slot && !l.abs && (l.kids || []).length === 1 && !l.kids[0].abs) add("wrapper", l.name);
        if (l.abs) add("absolute", l.name);
        if (l.optional && !l.boolProp) add("opt-no-bool", l.name);
        if (l.kind === "icon" && !l.swapProp && !isIcon) add("icon-no-swap", l.name);
      }
      if (l.boolProp) used.add(l.boolProp);
      if (l.slot && (l.kids || []).some((k) => k.kind === "instance" || k.kind === "icon")) add("slot-instances", l.name, String(l.kids.length));
    });
    // order, on the flattest row that holds a text
    walk(root, (l) => {
      if (l.kind !== "frame" || !(l.kids || []).some((k) => k.kind === "text")) return;
      let seenText = false, last = -1;
      for (const k of l.kids) {
        const r = orderClass(k, seenText);
        if (r === 2) seenText = true;
        if (r < 0) continue;
        if (r < last) { add("row-order", l.name); break; }
        last = r;
      }
    });
  }

  // properties
  for (const p of c.props || []) {
    const words = nameWords(p.name.replace(/#.*$/, ""));
    if (words.some(isCssFragment)) add("prop-css", p.name);
    if (p.type === "BOOLEAN" && !used.has(p.name)) add("prop-unused", p.name);
  }
  return out;
}

// Issues of a whole library: each component's, then the groups that are one thing built twice.
export function lint(components) {
  const issues = components.flatMap(lintComponent);
  const byShape = new Map();
  for (const c of components) {
    if (!c.variants.length) continue;
    const s = shapeOf(c.variants[0]);
    if (s.length < 8) continue; // one text, one icon: alike by nature
    (byShape.get(s) || byShape.set(s, []).get(s)).push(c);
  }
  for (const g of byShape.values()) {
    if (g.length < 2) continue;
    for (const c of g.slice(1)) issues.push({ rule: "duplicate", severity: SEVERITY.duplicate, component: c.name, at: g[0].name, detail: "" });
  }
  return issues;
}

// { errors, warnings, infos, byRule, components, score } score = components with no error or warning, in %.
export function summarize(components, issues) {
  const byRule = {};
  const dirty = new Set();
  let errors = 0, warnings = 0, infos = 0;
  for (const i of issues) {
    byRule[i.rule] = (byRule[i.rule] || 0) + 1;
    if (i.severity === "error") errors++;
    else if (i.severity === "warn") warnings++;
    else infos++;
    if (i.severity !== "info") dirty.add(i.component);
  }
  const n = components.length;
  return { components: n, errors, warnings, infos, byRule, clean: n ? Math.round((100 * (n - dirty.size)) / n) : 100 };
}
