// Names of the components found by web-layout.mjs, given as each component, variant and layer is built:
// the page's own words first (capture hints: data-component, readable classes, ARIA role; a
// BEM-like "card-headline" names the block "Card" and the layer "headline"), else structure.

// What a hint is once the build tool's hash is gone: a CSS module's "ImRUSq_root" is its local name, a
// class that is nothing but a hash ("jzUjvc", "gHBLUR") is no name at all. The hint stays raw in the
// capture, where it still tells occurrences apart: only the words read from it are cleaned.
import { isCssFragment } from "../plugin/src/lint-rules.mjs";

const VOWEL = /[aeiouy]/i;
const ABBR = new Set(["btn", "nav", "img", "bg", "txt", "lbl", "cta", "faq", "ui", "ux", "ai", "svg", "kbd", "tab", "top", "row", "bar", "map", "tag", "key", "pin", "dot", "box", "app", "log", "url", "api", "toc", "cmd", "alt", "msg", "pr", "sub"]);
const camelParts = (t) => t.replace(/([a-z])([A-Z])/g, "$1 $2").split(" ");
// a token no one typed: digits inside, capitals out of place, a part with no vowel, letters no word starts with or strings together
const ONSET = /^(?:bl|br|ch|cl|cr|dr|dw|fl|fr|gh|gl|gn|gr|kn|kr|ph|pl|pr|ps|qu|rh|sc|sh|sk|sl|sm|sn|sp|st|sv|sw|th|tr|tw|wh|wr|xl|xs)/;
const CODA = /(?:s|ch|th|ld|rd|nd|st|ght|ng|sk|nk|rk|lk|mp|nt|ct|pt|ft|lt|rt)$/; // what a word of ours ends on after two consonants
export const hashLike = (t) => {
  if (/\d/.test(t) && /\p{L}/u.test(t) && !/^[a-z]+\d$/i.test(t)) return true;
  if (/^[a-z]{5,7}$/.test(t) && !/[aeiou]/.test(t)) return true;
  if (/^[a-z]{6,7}$/.test(t) && ((/^[^aeiouy]{2}/.test(t) && !ONSET.test(t)) || /[^aeiouy]{5}/.test(t))) return true;
  if (/^[a-z]{6,7}$/.test(t) && /[^aeiouy]{3}$/.test(t) && !CODA.test(t)) return true;
  if (/^[A-Z]{2,}[a-z]/.test(t) || /[a-z][A-Z]{2,}/.test(t)) return true;
  const parts = camelParts(t);
  return parts.length > 1 && parts.some((p) => !ABBR.has(p.toLowerCase()) && (p.length < 2 || !VOWEL.test(p)));
};
const MODULE = /^(_?[-\w]{4,7}?)_+([a-zA-Z][-\w]*)$/;
const NEXT_MODULE = /^[A-Z][A-Za-z]*(?:-module)?_([A-Za-z][A-Za-z0-9]*)__[-\w]{3,}$/; // File_Local__hash
const VITE_MODULE = /^_([a-zA-Z][-\w]*?)_[a-z0-9]{5}_\d+$/; // _local_hash_line
// a Tailwind state or fraction, a builder's own class, one side of a utility ("border-t")
const UTILITY = /^@?[a-z0-9-]+:|\/|^framer-(v-)?[^-]+(-container)?$|^html-\w+$|^[a-z]+-[trblxy]$/;
const MAX_HINT = 40; // the capture cuts hints there: the last word is a piece of a word
export const cleanHint = (raw) => {
  if (UTILITY.test(raw)) return "";
  // an arbitrary-value utility ("cols:calc(var(--cols)…)", "[&:not(:root…") is a style, not a name: only what precedes it can be one
  raw = raw.split(/[[\](){}:=*&'"]/)[0];
  let h = raw.length === MAX_HINT ? raw.replace(/[-_]+[^-_]*$/, "") : raw;
  const next = NEXT_MODULE.exec(h);
  if (next) return next[1];
  const vite = VITE_MODULE.exec(h);
  if (vite) return vite[1];
  const m = MODULE.exec(h);
  if (m && (hashLike(m[1].replace(/^[-_]+/, "")) || /[-_]\w*[\dA-Z]/.test(m[1]))) return m[2];
  if (h.length >= 5 && !/[-_\s|]/.test(h) && !VOWEL.test(h)) return "";
  const tokens = h.split(/__|--|[-_\s|]+/).filter(Boolean);
  if (tokens.length && tokens.length <= 2 && tokens.every((t) => t.length <= 7) && tokens.some(hashLike)) return "";
  // short CSS modules, with no separator left to read a local name from: nothing typed by anyone
  return h.length >= 5 && h.length <= 7 && !/[-_\s|]/.test(h) && hashLike(h) ? "" : h;
};
// a word about the structure, not the thing ("Card-root" is a card): dropped; alone, no name at all
// (an HTML tag in a class says as little as the tag: the structure names it better)
// (a utility class says how a box is laid out, not what it is)
const GENERIC = new Set(["root", "wrapper", "wrap", "container", "inner", "outer", "contents", "component", "element", "el", "base", "main", "holder", "override", "color", "div", "span", "svg", "img", "path", "picture", "flex", "inline", "block", "relative", "absolute", "hidden", "scaled", "hydrated", "builtin", "clickarea", "pointer", "events", "none", "shrink", "grow", "self", "full", "default", "has"]);
const readable = (x) => x.length > 1 && (ABBR.has(x) || x.length < 3 || VOWEL.test(x));
// the word a person would read in a layers panel
const SPELLED = { btn: "button", lbl: "label", txt: "text", bg: "background", col: "column", pic: "picture", h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading" };
// a short brand prefix ("gu-video-loop", "c-card") says nothing: dropped, short interface words kept ("nav-item")
export const words = (raw) => {
  const h = cleanHint(raw);
  if (!h) return [];
  const w = h.replace(/([a-z])([A-Z])/g, "$1 $2").split(/__|--|[-_\s|]+/).filter(Boolean).map((x) => x.toLowerCase());
  let cut = w;
  while (cut.length > 1 && cut[0].length <= 3 && !ABBR.has(cut[0])) cut = cut.slice(1);
  return cut.filter((x) => !GENERIC.has(x) && readable(x)).map((x) => SPELLED[x] || x);
};
export const title = (ws) => (ws.length ? ws[0][0].toUpperCase() + ws.join(" ").slice(1) : "");

// A frame's name when the page gave none: what its tag means, else how it lays its children out.
const FRAME_TAGS = { h1: "Heading", h2: "Heading", h3: "Heading", h4: "Heading", h5: "Heading", h6: "Heading", p: "Text", label: "Label", main: "Main", dl: "List", tbody: "Table", table: "Table", td: "Cell", th: "Cell" };
export const frameName = (n) => {
  const named = n.hint ? title(words(n.hint)) : "";
  if (named) return named;
  const tag = TAGS[n.tag] || FRAME_TAGS[n.tag];
  if (tag) return tag;
  return n.dir === "H" ? "Row" : n.dir === "V" ? "Stack" : "Layers";
};

// An icon's own name: the icon set's class, its title or label, else what the page's class calls it.
const ICON_CLASS = /\b(?:lucide|tabler-icon|ph|bi|fa|ri|icon)-([a-z][a-z0-9-]+)/;
const ICON_NOISE = new Set(["icon", "icons", "ic", "svg", "img", "image", "glyph", "logo", "solid", "outline", "fill", "small", "large", "medium", "sm", "md", "lg", "xs", "xl", "btn", "button", "label", "link", "item", "wrap", "ui", "graphic", "size"]);
const iconWords = (raw) => raw.toLowerCase().replace(/[-_]+/g, " ").split(/\s+/).filter((w) => w && !ICON_NOISE.has(w) && !/\d/.test(w) && !/^\$/.test(w) && w !== "current");
const iconTitle = (raw) => { const w = iconWords(raw); return w.length && w.length <= 4 ? title(w) : ""; };
export const iconFromSvg = (svg) => {
  const open = /<svg\b[^>]*>/i.exec(svg || "")?.[0] || "";
  const cls = /class="([^"]*)"/.exec(open)?.[1] || "";
  const set = ICON_CLASS.exec(cls)?.[1];
  const label = /<title[^>]*>([^<]+)</i.exec(svg || "")?.[1] || /aria-label="([^"]+)"/.exec(open)?.[1] || /data-icon="([^"]+)"/.exec(open)?.[1] || /<use[^>]*href="[^"]*#([^"]+)"/.exec(svg || "")?.[1];
  return iconTitle(set || "") || iconTitle(label || "");
};
export const iconFromHint = (hint) => iconTitle(words(hint).join(" "));
// the words next to an icon name it only when they read as a label
export const iconFromText = (text) => (/^\p{L}[\p{L}' -]{1,23}$/u.test((text || "").trim()) && text.trim().split(/\s+/).length <= 3 ? title(text.trim().toLowerCase().split(/\s+/)) : "");
// The straight subpaths of a path's d: [{ pts, closed }], null as soon as a curve shows up.
const straightSubpaths = (d) => {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+)(?:e-?\d+)?/g) || [];
  const subs = [];
  let [cmd, x, y, sub, i] = ["", 0, 0, null, 0];
  const num = () => Number(tokens[i++]);
  const isCmd = (t) => /^[a-zA-Z]$/.test(t);
  while (i < tokens.length) {
    if (isCmd(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const c = cmd.toUpperCase();
    if (c === "Z") { if (sub) { sub.closed = true; x = sub.pts[0][0]; y = sub.pts[0][1]; } sub = null; continue; }
    if (!"MLHV".includes(c) || !c) return null;
    if (c === "M") {
      x = (rel ? x : 0) + num(); y = (rel ? y : 0) + num();
      sub = { pts: [[x, y]], closed: false };
      subs.push(sub);
      cmd = rel ? "l" : "L"; // further pairs are line-tos
      continue;
    }
    if (c === "L") { x = (rel ? x : 0) + num(); y = (rel ? y : 0) + num(); }
    if (c === "H") x = (rel ? x : 0) + num();
    if (c === "V") y = (rel ? y : 0) + num();
    if (!sub) { sub = { pts: [[x, y]], closed: false }; subs.push(sub); } else sub.pts.push([x, y]);
  }
  return subs;
};
const wayOf = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
// a V: its two arms alike and its point straight along one axis; the way it points
const chevronWay = (pts) => {
  if (pts.length !== 3) return "";
  const [a, b, c] = pts;
  const [ab, bc] = [Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1])];
  if (!ab || !bc || Math.abs(ab - bc) > 0.2 * Math.max(ab, bc)) return "";
  const [dx, dy] = [b[0] - (a[0] + c[0]) / 2, b[1] - (a[1] + c[1]) / 2];
  if (Math.hypot(dx, dy) < 0.15 * Math.hypot(c[0] - a[0], c[1] - a[1])) return "";
  return Math.min(Math.abs(dx), Math.abs(dy)) > 0.3 * Math.max(Math.abs(dx), Math.abs(dy)) ? "" : wayOf(dx, dy);
};
const segWay = ([a, b]) => {
  const [dx, dy] = [Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])];
  return dy < 0.1 * dx ? "h" : dx < 0.1 * dy ? "v" : dx > 0.5 * dy && dy > 0.5 * dx ? "d" : "";
};
const boxOf = (pts) => { const [xs, ys] = [pts.map((p) => p[0]), pts.map((p) => p[1])]; return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; };
// What a drawing of straight strokes shows, read from its geometry alone. "" for anything else.
export const iconFromPath = (svg) => {
  if (!svg || /<(circle|ellipse|rect|polygon|image|text)\b/i.test(svg)) return "";
  const subs = [];
  for (const m of svg.matchAll(/<path\b[^>]*?\sd="([^"]+)"/gi)) {
    const own = straightSubpaths(m[1]);
    if (!own) return "";
    subs.push(...own);
  }
  for (const m of svg.matchAll(/<line\b[^>]*>/gi)) {
    const at = (k) => Number(new RegExp(`\\s${k}="([^"]+)"`).exec(m[0])?.[1] || 0);
    subs.push({ pts: [[at("x1"), at("y1")], [at("x2"), at("y2")]], closed: false });
  }
  for (const m of svg.matchAll(/<polyline\b[^>]*\spoints="([^"]+)"/gi)) {
    const n = m[1].trim().split(/[\s,]+/).map(Number);
    subs.push({ pts: n.flatMap((_, i) => (i % 2 ? [] : [[n[i], n[i + 1]]])), closed: false });
  }
  if (!subs.length || subs.length > 3) return "";
  const open = subs.filter((s) => !s.closed);
  if (open.length === subs.length) {
    if (subs.length === 1 && chevronWay(subs[0].pts)) return "Chevron " + chevronWay(subs[0].pts);
    const lines = subs.filter((s) => s.pts.length === 2);
    const vee = subs.find((s) => s.pts.length === 3);
    if (subs.length === 2 && lines.length === 1 && vee && chevronWay(vee.pts)) return "Arrow " + chevronWay(vee.pts);
    if (lines.length !== subs.length) return "";
    const ways = lines.map((s) => segWay(s.pts));
    if (ways.length === 1 && ways[0] === "h") return "Minus";
    if (ways.length >= 2 && ways.every((w) => w === "h")) return "Menu";
    if (ways.length === 2 && ways.includes("h") && ways.includes("v")) return "Plus";
    if (ways.length === 2 && ways.every((w) => w === "d")) return "Close";
    return "";
  }
  if (open.length) return "";
  // filled: thin bars, a cross outline, a triangle
  const thin = subs.every((s) => { const b = boxOf(s.pts); return s.pts.length <= 5 && b.w >= 4 * b.h; });
  if (thin) return subs.length === 1 ? "Minus" : "Menu";
  if (subs.length === 1 && subs[0].pts.length === 3) {
    const [a, b, c] = subs[0].pts;
    const sides = [[a, b, c], [b, c, a], [c, a, b]].map(([p, q, r]) => ({ len: Math.hypot(q[0] - p[0], q[1] - p[1]), dx: r[0] - (p[0] + q[0]) / 2, dy: r[1] - (p[1] + q[1]) / 2 }));
    const flat = sides.find((s) => segWay([[0, 0], [s.dx, s.dy]]) === "h" || segWay([[0, 0], [s.dx, s.dy]]) === "v");
    return flat ? "Triangle " + wayOf(flat.dx, flat.dy) : "";
  }
  if (subs.length === 1 && subs[0].pts.length >= 12 && subs[0].pts.length <= 13) {
    const pts = subs[0].pts;
    const square = pts.every((p, i) => { const q = pts[(i + 1) % pts.length]; return segWay([p, q]) === "h" || segWay([p, q]) === "v" || (p[0] === q[0] && p[1] === q[1]); });
    if (square) return "Plus";
  }
  return "";
};
// what a drawing is when nothing names it: a plain shape says so, its strokes when they read, the rest is a glyph
export const iconFromShape = (svg) => {
  const tags = [...new Set([...(svg || "").matchAll(/<(circle|ellipse|rect|line|polyline|polygon|path)\b/gi)].map((m) => m[1].toLowerCase()))];
  if (tags.length === 1 && (tags[0] === "circle" || tags[0] === "ellipse")) return "Circle";
  if (tags.length === 1 && tags[0] === "rect") return "Square";
  return iconFromPath(svg) || (tags.length === 1 && tags[0] === "line" ? "Line" : "Glyph");
};
// A drawing's identity: its markup without what an instance overrides or the DOM alone reads (size, classes,
// labels, a title) and with its plain colors told by order of appearance, so the same drawing in another color is
// one component. A gradient's stops, an opacity, a sprite's href stay in: no paint override expresses them.
const SVG_PAINT = /(?<![\w-])(fill|stroke|color)(="|\s*:\s*)(#[0-9a-f]{3,8}\b|rgba?\([^)]*\))/gi;
const cssColor = (raw) => {
  const c = raw.toLowerCase().replace(/\s+/g, "");
  if (c[0] !== "#") return c;
  const h = c.length <= 5 ? [...c.slice(1)].map((x) => x + x).join("") : c.slice(1);
  const [r, g, b, a] = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
  return h.length === 8 ? `rgba(${r},${g},${b},${Math.round((a / 255) * 100) / 100})` : `rgb(${r},${g},${b})`;
};
const svgPaints = (svg) => [...(svg || "").matchAll(SVG_PAINT)].map((m) => cssColor(m[3]));
export const iconShape = (svg) => {
  if (!svg) return "";
  const seen = new Map();
  const tone = (raw) => { const c = cssColor(raw); if (!seen.has(c)) seen.set(c, "c" + seen.size); return seen.get(c); };
  // (ids are generated per render: told by order of appearance too)
  const ids = new Map();
  const local = (id) => { if (!ids.has(id)) ids.set(id, "i" + ids.size); return ids.get(id); };
  const root = (open) => open
    .replace(/\s(?:width|height|aria-[\w-]+|role|focusable|xmlns(?::\w+)?)="[^"]*"/g, "")
    .replace(/\sstyle="([^"]*)"/, (_, st) => { const own = st.split(";").map((d) => d.trim()).filter((d) => d && !d.startsWith("--")); return own.length ? ` style="${own.join(";")}"` : ""; });
  return svg
    .replace(/<svg\b[^>]*>/i, root)
    .replace(/<title[^>]*>[^<]*<\/title>/gi, "")
    .replace(/\s(?:class|data-[\w-]+)="[^"]*"/g, "")
    .replace(/\sid="([^"]*)"|url\(#([^)]*)\)|href="#([^"]*)"/g, (m, a, b, c) => (a !== undefined ? ` id="${local(a)}"` : b !== undefined ? `url(#${local(b)})` : `href="#${local(c)}"`))
    .replace(SVG_PAINT, (_, k, sep, v) => k + sep + tone(v))
    .replace(/\s+/g, " ");
};
// What turns one color of a drawing into another: [[from, to]…], [] when they already match, null when they aren't one drawing.
export const svgTint = (from, to) => {
  if (iconShape(from) !== iconShape(to)) return null;
  const [a, b] = [svgPaints(from), svgPaints(to)];
  const pairs = new Map();
  a.forEach((c, i) => { if (c !== b[i]) pairs.set(c, b[i]); });
  return [...pairs];
};
export const mostCommon = (list) => {
  const n = new Map();
  for (const v of list) if (v) n.set(v, (n.get(v) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
};
const TAGS = { li: "List item", a: "Link", button: "Button", article: "Card", nav: "Nav", figure: "Figure", header: "Header", footer: "Footer", section: "Section", form: "Form", ul: "List", ol: "List", aside: "Aside", tr: "Row" };

// Names for one occurrence: { name, block, roles[] } from the hints under its box, else structure
export const nameOcc = (byId, box, its) => {
  const depth = (id) => { let d = 0; for (let b = byId.get(id); b && b.id !== box.id; b = byId.get(b.p)) d++; return d; };
  // the shallowest hinted boxes under the component box name its block
  const hinted = [];
  for (let id = box.id; id <= box.end; id++) { const b = byId.get(id); const w = b?.hint ? words(b.hint) : []; if (w.length) hinted.push({ id, d: depth(id), w }); }
  let block = null;
  if (hinted.length) {
    const top = Math.min(...hinted.map((h) => h.d));
    block = mostCommon(hinted.filter((h) => h.d === top).map((h) => (h.d === 0 || h.w.length === 1 ? h.w.join(" ") : h.w[0])));
  }
  const name = block ? title(words(block)) : null;
  // layer roles: the shallowest hint on the item's own chain, minus the block word
  const texts = its.filter((s) => s.text);
  const big = Math.max(0, ...texts.map((s) => s.font.size));
  const iTitle = its.findIndex((s) => s.text && s.font.size === big);
  const shape = (s, k) => {
    if (s.text) return texts.length === 1 || k === iTitle ? "title" : k < iTitle ? "kicker" : s.font.size >= 15 ? "text" : "meta";
    if (s.svg) return "icon";
    if (s.img || s.src) return "image";
    return s.w <= 2 || s.h <= 2 ? "divider" : "background";
  };
  const hintRoles = its.map((s) => {
    let h = null;
    for (let b = byId.get(s.id); b && b.id !== box.id; b = byId.get(b.p)) if (b.hint && words(b.hint).length) h = b.hint;
    const w = h ? words(h).filter((x) => !block || !words(block).includes(x)) : [];
    return w.join(" ");
  });
  // a hint shared by several layers (kicker and headline in one "card-headline") names only
  // its title; the others take their structural role
  const roles = its.map((s, k) => {
    const h = hintRoles[k];
    if (!h) return shape(s, k);
    if (hintRoles.filter((x) => x === h).length === 1) return h;
    const r = shape(s, k);
    return r === "title" ? h : r;
  });
  return { name, roles };
};
// structural name when the page gave none
export const shapeName = (tag, its) => {
  if (TAGS[tag]) return TAGS[tag];
  const n = (f) => its.filter(f).length;
  const [t, i, v] = [n((s) => s.text), n((s) => s.img || s.src), n((s) => s.svg)];
  if (i && t) return "Card";
  if (i) return "Media";
  if (v && t === 1) return "Icon label";
  if (v && !t) return "Icons";
  if (t > 1) return "Text group";
  return t ? "Label" : "Shape";
};

const ROLE_LAST = /^(.+)\s(card|button|link|heading|title|label|badge|tag|image|logo|banner|menu|tab|tile|chip|pill|thumbnail|video|quote|caption|avatar|input|divider|graphic|background|section|item|slide|row|grid|list)$/i;
// One word that is already a role, and a page's landmarks: there is one of each, no category to add.
const KNOWN_ROLE = new Set(["button", "badge", "nav", "footer", "header", "section", "form", "aside", "figure", "list", "subnav", "navigation", "main"]);
const LANDMARK = /^(header|footer|navigation|subnav|sidebar|search bar|filters)$/i;
const BARE_ROLE = new Set(["text", "heading", "link", "image", "logo", "divider", "label", "group", "shape", "media", "text group", "icons", "icon label", "list item", "card", "row", "stack", "layers"]);
// A box too general to say where a block sits.
const NOT_A_PLACE = new Set(["content", "section", "layout", "page", "body", "app", "grid", "row", "col", "column", "stack", "list", "group", "item", "box", "card", "text", "link", "image"]);
// Where a block sits: the nearest box above it that names a place, its landmark tag failing a class.
export const placeOf = (byId, id, own = "") => {
  let b = byId.get(byId.get(id)?.p);
  for (let up = 0; b && up < 8; up++, b = byId.get(b.p)) {
    const w = (b.hint ? words(b.hint) : []).filter((x) => !NOT_A_PLACE.has(x) && x !== own.toLowerCase());
    // a place read as a class fragment ("Lb", "now") names nothing: look further up
    if (w.length && w.length <= 3 && !w.some(isCssFragment)) return title(w);
    if (["header", "footer", "nav", "aside"].includes(b.tag)) return TAGS[b.tag];
  }
  return "";
};

// How a block with no other word looks: a shape by its tone, the rest by its proportions. "" when neither says anything.
const toneOf = (color) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color || "");
  if (!m) return "";
  const [r, g, b] = m.slice(1, 4).map(Number);
  const [hi, lo] = [Math.max(r, g, b), Math.min(r, g, b)];
  if (hi - lo < 24) return hi < 80 ? "Dark" : hi > 200 ? "Light" : "Gray";
  return hi === r ? (g > 0.75 * r ? "Yellow" : "Red") : hi === g ? "Green" : "Blue";
};
const lookOf = (c) => {
  const k = c.kinds?.[0];
  if (!k) return "Block";
  const tone = k.k === "rect" || !k.text ? toneOf(k.bg) : "";
  if (tone) return tone;
  return k.w > 1.3 * k.h ? "Landscape" : k.h > 1.3 * k.w ? "Portrait" : "Square";
};
// A page's own word with no role in it: the role comes from what the block holds.
// Never a kit component's name: the lint reads the first path part as the kit component it follows, and a guess is not one.
const categoryOf = (c) => {
  const n = (f) => c.kinds.filter(f).length;
  const [t, i, v] = [n((s) => s.text), n((s) => s.img || s.src), n((s) => s.svg)];
  return i && t ? "Tile" : i ? "Media" : v && !t ? "Graphic" : t > 1 ? "Text group" : t ? "Text" : "Shape";
};

// One name for several components: Figma-style paths say what sets them apart, in turn
// content (Image / Icon / Text), title size, width; a number only for what still collides.
// comps: [{ name, roles, kinds (items), w }], names updated in place, kinds and w removed.
export const SIZES = { 2: ["Large", "Small"], 3: ["Large", "Medium", "Small"], 4: ["XL", "Large", "Medium", "Small"], 5: ["XL", "Large", "Medium", "Small", "XS"] };
export function qualify(comps) {
  const WIDTHS = { 2: ["Wide", "Narrow"], 3: ["Wide", "Medium", "Narrow"] };
  const n = (c, f) => c.kinds.filter(f).length;
  const base = (r) => r.replace(/ \d+$/, "");
  // the site's own long name reads by its role first (Card/Product), a bare role by where it sits (Link/Footer)
  for (const c of comps) {
    if (c.kit || c.name.includes("/") || /^Icon \//.test(c.name)) continue;
    // the class fragments of a long name go ("Weather card now icon" → "Weather card icon")
    const kept = c.name.split(" ").filter((w) => !isCssFragment(w));
    if (kept.length > 1 && kept.length < c.name.split(" ").length) c.name = kept.join(" ");
    const role = ROLE_LAST.exec(c.name);
    // two letters are what's left of a class name (Tp, Ox), never a word: where it sits says more
    if (/^[a-z]{1,2}$/i.test(c.name)) c.name = categoryOf(c) + "/" + (c.near || lookOf(c));
    else if (BARE_ROLE.has(c.name.toLowerCase())) c.name += "/" + (c.near || lookOf(c));
    else if (role) c.name = title([role[2].toLowerCase()]) + "/" + role[1];
    else if (!LANDMARK.test(c.name) && !KNOWN_ROLE.has(c.name.toLowerCase())) c.name = categoryOf(c) + "/" + c.name;
  }
  const DECOR = new Set(["background", "divider", "icon"]);
  const quals = [
    (c) => (n(c, (s) => s.img || s.src) ? "Image" : n(c, (s) => s.svg) ? "Icon" : "Text"),
    (c) => Math.max(0, ...c.kinds.filter((s) => s.text).map((s) => s.font.size)),
    (c) => c.w,
    // what still collides: the layers only some of them have ("With meta"), decor left out
    (c, g) => {
      const extra = [...new Set(c.roles.map(base))].filter((r) => !DECOR.has(r) && !g.every((d) => d.roles.some((x) => base(x) === r)));
      return extra.length ? "With " + extra.slice(0, 2).join(" + ") : "Plain";
    },
    // where it sits, then how it looks
    (c) => c.near || "Page",
    (c) => lookOf(c),
  ];
  const labels = [null, SIZES, WIDTHS, null, null, null];
  // an icon is told by its own name alone: an instance takes any size
  const named = comps.filter((c) => !/^Icon \//.test(c.name));
  for (const [k, q] of quals.entries()) {
    const groups = new Map();
    for (const c of named) (groups.get(c.name) || groups.set(c.name, []).get(c.name)).push(c);
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const vals = [...new Set(g.map((c) => q(c, g)))].sort((a, b) => (typeof a === "number" ? b - a : 0));
      if (vals.length < 2) continue;
      const lab = labels[k]?.[vals.length];
      // more sizes than labels: no size is the one to tell them apart by, never a value in pixels
      if (labels[k] && !lab) continue;
      for (const c of g) { const v = q(c, g); c.name += "/" + (labels[k] ? lab[vals.indexOf(v)] : v); }
    }
  }
  // what still collides: the words of the block, then a number if the page gives nothing else
  const words1 = (c) => {
    const t = c.kinds.find((s) => s.text)?.text;
    return t && /^\p{L}[\p{L}' -]{1,23}$/u.test(t.trim()) && t.trim().split(/\s+/).length <= 3 ? t.trim() : "";
  };
  const left = new Map();
  for (const c of named) (left.get(c.name) || left.set(c.name, []).get(c.name)).push(c);
  for (const g of left.values()) {
    if (g.length < 2) continue;
    const seen = new Set();
    g.forEach((c, i) => { const w = words1(c); if (i && w && !seen.has(w)) { seen.add(w); c.name += "/" + w; } });
  }
  const used = new Map();
  for (const c of comps) {
    const k = (used.get(c.name) || 0) + 1;
    used.set(c.name, k);
    if (k > 1) c.name += " " + k;
    delete c.kinds; delete c.w; delete c.near;
  }
}
