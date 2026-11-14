// One build of a capture in Figma, free of Node: everything goes through rpc(code), the host brings the
// capture, the site's faces and the images. Hosts: web-build.mjs (Node), the plugin's bundle (web-core).
// The body stays at column 0: the exec code it holds is sent as written.
import { selectItems } from "./web-items.mjs";
import { layoutTree } from "./web-layout.mjs";
import { svgTint } from "./web-components.mjs";
import { sha1 } from "./web-sha1.mjs";
import { placeImages, mixedMains, BATCH, BATCH_BYTES, BOARD_JS, BYTES_JS } from "./web-place.mjs";

// images(srcs) starts the downloads and returns { ready, value, get, cleanup } (see fetchImages);
// late "rootId,componentsId": no build, only waits for the site's fonts and swaps the marked texts.
// Returns what the host reports or continues from; a build stopped by Figma errors throws with .stopped.
export async function runBuild({
  cap, rpc, images, FACES = {},
  height = cap.height,
  exclude = null,
  name = cap.title || "web capture",
  fallbackFont = "Inter",
  fontMap: fontMapIn = {},
  // items per exec: the frame shows the first lot at once, an exec stays well under the bridge timeout
  LOT = 250,
  // max glide per reveal (ms): the cursor reaches the first node of the group, then they appear
  PACE = 64,
  // script time grouped into one reveal (ms): 0 = element by element, the cursor and the ring on
  // each one (the page builds up visibly); more = faster, groups appearing together
  REVEAL_MS = 0,
  HOLD = 38,
  drop = [],
  // id -> a source for a box the capture could not read (video poster)
  imgOver = {},
  // id -> markup for an svg the capture left empty (sprite <use>)
  svgOver = {},
  flatMode = false,
  stage,
  maxImg = Infinity,
  late = null,
  log = console.log,
  warn = console.error,
  trace = false,
}) {
// components are shared per site: one Components frame, reused from one page to the next
const SITE = (() => { try { return new URL(cap.url).hostname.replace(/^www\./, ""); } catch { return name; } })();
// page holding every site's components (mains), created on first use
const COMP_PAGE = "💊 Components";
// a system stack reads as the system font the page was captured with, never as the generic fallback
const SYSTEM_FONTS = { "-apple-system": "sf pro", blinkmacsystemfont: "sf pro", "system-ui": "sf pro", "ui-sans-serif": "sf pro" };
const fontMap = { ...SYSTEM_FONTS, ...fontMapIn };

// freshly activated site fonts reach Figma's list with a lag (up to a few minutes): the build does
// not wait, the texts in a family not listed yet get the fallback and keep their CSS font, swapped
// in by a detached run (--late) once Figma lists it
const siteFams = [...new Set(Object.values(FACES).flatMap((v) => [v.family, ...v.faces.map((f) => f.family || v.family), ...Object.values(v.opsz?.fams || {})]))];
const missing = () => rpc(`const f = await figma.listAvailableFontsAsync(); globalThis.__webFonts = f; return ${JSON.stringify(siteFams)}.filter((x) => !f.some((g) => g.fontName.family === x));`);
let LATE = siteFams.length ? await missing() : [];
if (LATE.length && !late) log(`not seen by Figma yet, fallback then update: ${LATE.join(", ")}`);

const items = selectItems(cap, { height, exclude, drop }).map((i) => ({
  ...i,
  ...(imgOver[i.id] ? { src: imgOver[i.id] } : {}),
  ...(svgOver[i.id] ? { svg: svgOver[i.id] } : {}),
}));

// components by default, --flat for absolute boxes
const COMPS = !flatMode;

const t0 = Date.now();
const flat = items.map(({ src, ...o }) => (src ? { ...o, img: true } : o));
// images start downloading now (reading order; beyond --max-img, slots stay grey placeholders)
// and ride along with the lot that creates their slot when ready by then
const srcs = items.filter((i) => i.src).sort((a, b) => a.y - b.y || a.x - b.x).slice(0, maxImg);
const fetcher = late ? null : images(srcs);
const wanted = new Set(srcs.map((i) => i.id));

// Shared by both modes, at the top of each exec: colors, fonts, the root frame (staged by the
// first exec, found again by the next ones)
const prelude = (ST) => `
const ST = ${JSON.stringify(ST)};
const MAP = ${JSON.stringify(fontMap)}, FACES = ${JSON.stringify(FACES)}, LATE = ${JSON.stringify(LATE)};
const W = ${cap.width}, HGT = ${height}, NAME = ${JSON.stringify(name)}, SITE = ${JSON.stringify(SITE)}, FALLBACK = ${JSON.stringify(fallbackFont)};
const rgba = (s) => { const m = s.match(/[\\d.]+/g).map(Number); return { color: { r: m[0] / 255, g: m[1] / 255, b: m[2] / 255 }, opacity: m.length > 3 ? m[3] : 1 }; };
const solid = (s) => { const c = rgba(s); return { type: "SOLID", color: c.color, opacity: c.opacity }; };
const GREY = [{ type: "SOLID", color: { r: 0.92, g: 0.92, b: 0.92 } }];
const corners = (n, s) => {
  // a "full" radius (CSS 999 / 9999, or half the height) stays a pill when auto-layout resizes the box
  const cap = (v) => (v >= Math.min(s.w, s.h) / 2 - 1 ? 999 : Math.min(v, s.w / 2, s.h / 2));
  if (s.rs) [n.topLeftRadius, n.topRightRadius, n.bottomRightRadius, n.bottomLeftRadius] = s.rs.map(cap);
  else n.cornerRadius = cap(s.r);
};
// CSS gradient layers (web-items gradients()) painted over the base fill
const grads = (g) => (g || []).map((p) => ({ type: p.type, gradientTransform: p.t, gradientStops: p.stops.map((x) => { const c = rgba(x.c); return { position: x.at, color: { ...c.color, a: c.opacity } }; }) }));
// drop shadow + backdrop blur (progressive when the blur fades along a line)
const fx = (s) => {
  const out = [];
  if (s.shadow) for (const l of [s.shadow, ...(s.shadow.more || [])]) { const k = rgba(l.c); out.push({ type: l.inset ? "INNER_SHADOW" : "DROP_SHADOW", color: { ...k.color, a: k.opacity }, offset: { x: l.x, y: l.y }, radius: l.blur, spread: l.spread, visible: true, blendMode: "NORMAL" }); }
  if (s.blur && s.blur.layer) out.push({ type: "LAYER_BLUR", radius: s.blur.r, visible: true });
  else if (s.blur) out.push(s.blur.from ? { type: "BACKGROUND_BLUR", blurType: "PROGRESSIVE", radius: s.blur.r, startRadius: 0, startOffset: s.blur.from, endOffset: s.blur.to, visible: true } : { type: "BACKGROUND_BLUR", radius: s.blur.r, visible: true });
  return out;
};
${BYTES_JS}
const imageFill = async (url) => [{ type: "IMAGE", imageHash: figma.createImage(await bytesOf(url)).hash, scaleMode: "FILL" }];
// a face's width in font-stretch %, from its style name (CSS width classes)
const widthOf = (style) => /ultra.?condensed/i.test(style) ? 50 : /extra.?condensed|compressed/i.test(style) ? 62.5 : /semi.?condensed|narrow/i.test(style) ? 87.5 : /condensed/i.test(style) ? 75
  : /ultra.?expanded/i.test(style) ? 200 : /extra.?expanded/i.test(style) ? 150 : /semi.?expanded|wide/i.test(style) ? 112.5 : /expanded|extended/i.test(style) ? 125 : 100;
// scripts the system UI font has no glyphs for in Figma (Arabic drawn blank): the face macOS falls back to
const SCRIPTS = [
  [/[\\u0600-\\u06ff\\u0750-\\u077f\\ufb50-\\ufdff\\ufe70-\\ufeff]/, ["SF Arabic", "Geeza Pro", "Noto Sans Arabic"]],
  [/[\\u0590-\\u05ff]/, ["SF Hebrew", "Arial Hebrew", "Noto Sans Hebrew"]],
  [/[\\u0e00-\\u0e7f]/, ["Thonburi", "Noto Sans Thai"]],
  [/[\\u0900-\\u097f]/, ["Kohinoor Devanagari", "Noto Sans Devanagari"]],
  [/[\\u3040-\\u30ff]/, ["Hiragino Sans", "Noto Sans JP"]],
  [/[\\uac00-\\ud7af]/, ["Apple SD Gothic Neo", "Noto Sans KR"]],
  [/[\\u4e00-\\u9fff]/, ["PingFang SC", "Noto Sans SC"]],
];
const styleOf = (fam, wt, it, size, opsz, stretch = 100, text = "") => {
  const f = styleOf0(fam, wt, it, size, opsz, stretch);
  if (!text || !(f.family === FALLBACK || /^sf pro/i.test(f.family))) return f;
  const fb = SCRIPTS.find(([re]) => re.test(text))?.[1].find((n) => fonts.some((x) => x.fontName.family === n));
  return fb ? styleOf0(fb, wt, it, size, opsz, stretch) : f;
};
const styleOf0 = (fam, wt, it, size, opsz, stretch = 100) => {
  // activated site font: nearest weight on the same slant, from the faces Figma reported
  let site = FACES[fam.toLowerCase()];
  // an italic asked of a CSS family without one (the browser slants it): the Figma family's italic, declared
  // under a sibling CSS name ("MercuryTextG1Regular" italic → the face of "MercuryTextG1Italic")
  if (site && it && !site.faces.some((f) => f.italic)) {
    const sib = Object.values(FACES).filter((v) => v.family === site.family).flatMap((v) => v.faces.filter((f) => f.italic));
    if (sib.length) site = { ...site, faces: [...site.faces, ...sib] };
  }
  // a width axis (Condensed, Expanded…): the face nearest the page's font-stretch (normal by default)
  const wide = (f) => Math.abs(widthOf(f.style) - stretch);
  const pick = site && site.faces.slice().sort((a, b) => (a.italic !== !!it) - (b.italic !== !!it) || wide(a) - wide(b) || Math.abs((a.weight ?? 400) - wt) - Math.abs((b.weight ?? 400) - wt))[0];
  // a CSS family named after its one face ("GothamNarrowBold" declared at weight 400): the browser draws that face
  const named = site?.faces.length === 1 && fam.toLowerCase().replace(/[\\s_-]/g, "").includes(pick.style.toLowerCase().replace(/\\s/g, ""));
  // only a far weight of the site font installed (a 900 Headline for 400 text): the fallback at the right weight reads closer
  if (pick && fonts.some((f) => f.fontName.family === site.family) && (named || Math.abs((pick.weight ?? 400) - wt) < 300)) {
    // optical size the browser drew (the font size unless set): the font pinned at that value
    const o = site.opsz;
    if (o && size) {
      const v = opsz === 0 ? o.axis.default : Math.min(o.axis.max, Math.max(o.axis.min, Math.round(opsz ?? size)));
      const pf = o.fams[v];
      if (pf && fonts.some((f) => f.fontName.family === pf && f.fontName.style === pick.style)) return { family: pf, style: pick.style };
    }
    return { family: pick.family || site.family, style: pick.style };
  }
  const names = { 100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black" };
  const want = names[Math.round(wt / 100) * 100] || "Regular";
  const mapped = MAP[fam.toLowerCase()];
  if (mapped && !fonts.some((f) => f.fontName.family.toLowerCase() === fam.toLowerCase())) fam = fonts.find((f) => f.fontName.family.toLowerCase() === mapped)?.fontName.family || fam;
  const fam2 = fonts.some((f) => f.fontName.family.toLowerCase() === fam.toLowerCase()) ? fonts.find((f) => f.fontName.family.toLowerCase() === fam.toLowerCase()).fontName.family : FALLBACK;
  const styles = fonts.filter((f) => f.fontName.family === fam2).map((f) => f.fontName.style);
  const norm = (s) => s.replace(/\\s/g, "").toLowerCase();
  const exact = stretch === 100 && styles.find((s) => norm(s) === norm(want));
  if (exact) return { family: fam2, style: exact };
  // no face of that exact name (800 in a family without ExtraBold, font-stretch: condensed): the nearest width, then weight
  const WEIGHTS = { thin: 100, hairline: 100, ultralight: 200, extralight: 200, light: 300, regular: 400, book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900 };
  const faceWeight = (s) => { const k = Object.keys(WEIGHTS).filter((w) => norm(s).includes(w)).sort((a, b) => b.length - a.length)[0]; return k ? WEIGHTS[k] : 400; };
  const upright = styles.filter((s) => !/italic|oblique/i.test(s));
  const near = upright.slice().sort((a, b) => Math.abs(widthOf(a) - stretch) - Math.abs(widthOf(b) - stretch) || Math.abs(faceWeight(a) - wt) - Math.abs(faceWeight(b) - wt))[0];
  return { family: fam2, style: near || styles[0] };
};
// a text in a site family Figma does not list yet keeps its CSS font per range, for the --late swap
const lateMark = (t, spans) => {
  if (spans.some((sp) => { const v = FACES[sp.font.family.toLowerCase()]; return v && [v.family, ...v.faces.map((x) => x.family || v.family), ...Object.values(v.opsz?.fams || {})].some((fam) => LATE.includes(fam)); })) t.setPluginData("fdslLate", JSON.stringify(spans));
};
// variation axes the page set by hand (wdth 98…), on a variable font only; a static face keeps its name
const axed = (t, a, i, j) => {
  if (!a) return;
  try {
    const f = i == null ? t.fontName : t.getRangeFontName(i, j);
    if (f === figma.mixed || !f.variationSettings) return;
    const v = { ...f, variationSettings: { ...f.variationSettings, ...a } };
    if (i == null) t.fontName = v; else t.setRangeFontName(i, j, v);
  } catch (e) {}
};
const page = figma.currentPage;
const right = page.children.reduce((m, n) => Math.max(m, n.x + n.width), 0);
const c = await H.cursor();
const fresh = !ST.root;
// --root: a frame staged before the capture (web-to-figma) is taken over as the page
const root = ST.root ? await H.byId(ST.root) : ST.stage ? await H.byId(ST.stage) : await c.stage({ name: NAME, width: W, height: HGT, x: page.children.length > 1 ? right + 300 : 0, y: 0 });
root.clipsContent = true;
if (Math.abs(root.width - W) >= 1) root.resize(W, root.height);
ST.root = root.id;
// font list fetched once per plugin session (seconds on a large library), after the frame is up
let fonts = globalThis.__webFonts || (globalThis.__webFonts = await figma.listAvailableFontsAsync());
// fonts activated since the list was cached: Figma lists them a few seconds after its font agent → refresh until seen (10 s max)
const unseen = () => Object.values(FACES).some((v) => [...v.faces.map((x) => x.family || v.family), ...Object.values(v.opsz?.fams || {})].some((fam) => !LATE.includes(fam) && !fonts.some((f) => f.fontName.family === fam)));
for (let i = 0, t0 = Date.now(); unseen() && Date.now() - t0 < 10000; i++) {
  if (i) await new Promise((r) => setTimeout(r, 1000));
  fonts = globalThis.__webFonts = await figma.listAvailableFontsAsync();
}
// nodes are created hidden and shown in groups: every yield costs Figma a relayout + repaint of
// the page (tens of ms on a long one), so one glide reveals the nodes of the last REVEAL_MS of work
let pending = [], shownAt = Date.now();
const flush = async () => {
  if (!pending.length) return;
  const [first, ...rest] = pending;
  pending = [];
  hidden.clear();
  await c.put(first, ${PACE}, ${HOLD});
  for (const m of rest) m.visible = true;
  shownAt = Date.now();
};
// a series of small siblings (footer links, list items, buttons) shows in one glide to its first
// node, and a node inside a small node still hidden shows with it (a link's text never splits its
// column); sections and cards stay one glide each, their content revealed in sequence after them
const small = (n) => n.height <= 60 && n.width <= 480;
let series = null;
const hidden = new Set();
const reveal = async (m, key) => {
  for (let p = m.parent; p && p.type !== "PAGE"; p = p.parent) if (hidden.has(p.id) && small(p)) return;
  if (pending.length && !(key && key === series && small(m)) && Date.now() - shownAt >= ${REVEAL_MS}) await flush();
  m.visible = false;
  pending.push(m);
  hidden.add(m.id);
  series = key;
};
// a font loaded once stays loaded for the plugin session: not again at every lot
const loaded = globalThis.__webLoaded || (globalThis.__webLoaded = new Set());
const load = async (f) => { const k = f.family + "|" + f.style; if (!loaded.has(k)) { await figma.loadFontAsync(f); loaded.add(k); } };
// arrows and other symbols the fallback font may lack → Inter
const symbols = async (t) => {
  for (const m of t.characters.matchAll(/[←-⇿↖-↙]/g)) {
    await load({ family: "Inter", style: "Regular" });
    t.setRangeFontName(m.index, m.index + 1, { family: "Inter", style: "Regular" });
  }
};
`;

// --late rootId,componentsId : detached after a build that fell back, waits (10 min max) for Figma to
// list the site families, then swaps the marked texts (mains first, instances follow) to them
if (late) {
  const [rid, cf] = late.split(",");
  const w0 = Date.now();
  while ((LATE = await missing()).length && Date.now() - w0 < 600000) await new Promise((r) => setTimeout(r, 5000));
  if (LATE.length) { log(`${new Date().toISOString()} still missing after 10 min: ${LATE.join(", ")}`); return { LATE }; }
  const r = await rpc(`
${prelude({ root: rid })}
let n = 0;
const scopes = [${JSON.stringify(cf || "")} && (await H.byId(${JSON.stringify(cf || "")})), root].filter(Boolean);
for (const sc of scopes) for (const t of sc.findAllWithCriteria({ types: ["TEXT"], pluginData: { keys: ["fdslLate"] } })) {
  const spans = JSON.parse(t.getPluginData("fdslLate") || "[]");
  if (!spans.length) continue;
  for (const f of t.getRangeAllFontNames(0, t.characters.length)) await load(f);
  for (const sp of spans) {
    const f = styleOf(sp.font.family, sp.font.weight, sp.font.italic, sp.font.size, sp.font.opsz, sp.font.stretch, t.characters.slice(sp.i, sp.j));
    await load(f);
    t.setRangeFontName(sp.i, sp.j, f);
    axed(t, sp.font.axes, sp.i, sp.j);
  }
  try { t.setPluginData("fdslLate", ""); } catch (e) {}
  n++;
}
return n;`);
  log(`${new Date().toISOString()} site fonts arrived after ${Math.round((Date.now() - w0) / 1000)} s: ${r} texts updated`);
  return { LATE: [] };
}

// Pass 1 (flat): frame, boxes, texts, SVGs (image slots as grey placeholders), in lots of LOT
// items in DOM order (= paint order); the first lot stages the frame, the next ones fill it.
const pass1 = (S, ST) => `
const S = ${JSON.stringify(S)};
${prelude(ST)}
const alignOf = (s) => (s.font.align === "center" ? "CENTER" : s.font.align === "right" || s.font.align === "end" ? "RIGHT" : "LEFT");

// One captured item → its nodes in parent, placed relative to (ox, oy)
const makeItem = async (s, parent, ox, oy) => {
  const made = [];
  if (s.bg || s.grad || s.border || s.img) {
    const r = figma.createRectangle();
    r.resize(Math.max(1, s.w), Math.max(1, s.h));
    r.fills = [...(s.imgUrl ? await imageFill(s.imgUrl) : s.img && !s.svgImg ? GREY : s.bg ? [solid(s.bg)] : []), ...grads(s.grad)];
    if (s.border) {
      r.strokes = [solid(s.border.c)]; r.strokeAlign = "INSIDE";
      if (s.border.sides) [r.strokeTopWeight, r.strokeRightWeight, r.strokeBottomWeight, r.strokeLeftWeight] = s.border.sides;
      else r.strokeWeight = s.border.w;
    }
    if (s.shadow || s.blur) r.effects = fx(s);
    if (s.r) corners(r, s);
    r.name = s.imgUrl || s.svgImg ? "image" : s.img ? "img:" + s.id : "box";
    parent.appendChild(r); r.x = s.x - ox; r.y = s.y - oy; made.push(r);
    const sv = s.svgImg && svgImage(s, parent, r.x, r.y);
    if (sv) made.push(sv);
  }
  if (s.svg) {
    try {
      const v = figma.createNodeFromSvg(s.svg);
      parent.appendChild(v); v.resize(Math.max(1, s.w), Math.max(1, s.h)); v.x = s.x - ox; v.y = s.y - oy; v.name = "icon"; made.push(v);
    } catch (e) {}
  }
  if (s.text) {
    const f = styleOf(s.font.family, s.font.weight, s.font.italic, s.font.size, s.font.opsz, s.font.stretch, s.text);
    await load(f);
    const align = alignOf(s);
    const mk = async (str) => {
      const t = figma.createText();
      t.fontName = f;
      t.characters = str;
      axed(t, s.font.axes);
      t.fontSize = s.font.size;
      // (Figma's hug rounds a fractional line up: 22.4 gives 23, and a single line is a whole pixel taller than its source)
      if (s.font.lh) t.lineHeight = { unit: "PIXELS", value: s.lines?.length === 1 ? Math.round(s.font.lh) : s.font.lh };
      if (s.font.ls) t.letterSpacing = { unit: "PIXELS", value: s.font.ls };
      t.fills = s.font.grad?.length ? grads(s.font.grad) : [solid(s.font.color)];
      t.textAlignHorizontal = align;
      if (s.font.deco) t.textDecoration = s.font.deco;
      if (s.font.decoW) t.textDecorationThickness = { unit: "PIXELS", value: s.font.decoW };
      if (s.font.decoY !== undefined) t.textDecorationOffset = { unit: "PIXELS", value: Math.round(s.font.decoY) }; // browsers snap the underline to a pixel row
      parent.appendChild(t);
      await symbols(t);
      t.textAutoResize = "WIDTH_AND_HEIGHT";
      t.name = str.slice(0, 40);
      lateMark(t, [{ i: 0, j: str.length, font: s.font }]);
      return t;
    };
    if (s.lines) {
      // one node per line the browser rendered, at its measured place: ISO even when the
      // fallback font is wider (anchored on the line's start, centre or end per alignment)
      for (const l of s.lines) {
        const t = await mk(l.t);
        t.x = (align === "CENTER" ? l.x + (l.w - t.width) / 2 : align === "RIGHT" ? l.x + l.w - t.width : l.x) - ox;
        t.y = l.y + l.h / 2 - t.height / 2 - oy;
        made.push(t);
      }
    } else {
      const t = await mk(s.text);
      // keep the browser's wrap width only when the browser wrapped it (several lines);
      // a single line stays one line even when the fallback font is wider
      const lines = s.font.lh ? Math.round(s.h / s.font.lh) : 2;
      if (lines > 1 && t.width > s.w + 2) { t.resize(s.w + 1, t.height); t.textAutoResize = "HEIGHT"; }
      t.x = s.x - ox + (align === "CENTER" ? (s.w - t.width) / 2 : 0);
      t.y = s.y - oy + Math.max(0, (s.h - t.height) / 2) * (s.h < 80 ? 1 : 0);
      made.push(t);
    }
  }
  if (s.op) for (const m of made) m.opacity = s.op;
  return made;
};
// vector image: the svg imported as is, fitted and centred inside its slot
function svgImage(s, parent, x, y) {
  try {
    const v = figma.createNodeFromSvg(s.svgImg);
    v.rescale(Math.min(s.w / v.width, s.h / v.height)); v.name = "svg";
    parent.appendChild(v); v.x = x + (s.w - v.width) / 2; v.y = y + (s.h - v.height) / 2;
    if (s.op) v.opacity = s.op;
    return v;
  } catch (e) { return null; }
}

let n = 0;
for (const s of S) for (const m of await makeItem(s, root, 0, 0)) { n++; await reveal(m); }
await flush();
c.done();
return { ST, nodes: root.children.length };
`;

// Tree pass (components mode): ops in preorder, each one node under its parent op (u → node id
// in ST.map); an instance op brings its family's mains the first time (built off-page in the
// white "Components" frame, one component set when the family has several variants) and its
// overrides (path of child indexes → texts, colors, sizes, image slots).
const treePass = (OPS, ST) => `
const OPS = ${JSON.stringify(OPS)};
${prelude(ST)}
const errors = [];
const setRuns = async (t, all) => {
  // consecutive runs of one style: one range, not one set of range calls each
  const runs = [];
  for (const r of all) {
    const l = runs[runs.length - 1];
    if (l && JSON.stringify(l.font) === JSON.stringify(r.font)) l.text += r.text;
    else runs.push({ text: r.text, font: r.font });
  }
  const fs = runs.map((r) => styleOf(r.font.family, r.font.weight, r.font.italic, r.font.size, r.font.opsz, r.font.stretch, r.text));
  for (const f of fs) await load(f);
  if (t.characters.length) for (const f of t.getRangeAllFontNames(0, t.characters.length)) await load(f);
  t.fontName = fs[0];
  t.characters = runs.map((r) => r.text).join("");
  let i = 0;
  const spans = [];
  const baseLh = Math.max(0, ...runs.map((r) => r.font.lh || 0));
  runs.forEach((r, k) => {
    const j = i + r.text.length;
    if (j > i) {
      t.setRangeFontName(i, j, fs[k]);
      axed(t, r.font.axes, i, j);
      // no superscript in the plugin API: a footnote figure is drawn smaller on the baseline
      t.setRangeFontSize(i, j, r.font.sup ? Math.round(r.font.size * 0.6) : r.font.size);
      t.setRangeFills(i, j, r.font.grad?.length ? grads(r.font.grad) : [solid(r.font.color)]);
      // an inline run at line-height 0 (sup reset, circle's footnote figures) adds no height to its line in CSS:
      // it takes the paragraph's, Figma's AUTO would grow the line (2 lines 67 px instead of 61.6)
      const lh = r.font.lh === 0 ? baseLh : r.font.lh;
      t.setRangeLineHeight(i, j, lh ? { unit: "PIXELS", value: lh } : { unit: "AUTO" });
      t.setRangeLetterSpacing(i, j, { unit: "PIXELS", value: r.font.ls || 0 });
      t.setRangeTextDecoration(i, j, r.font.deco || "NONE");
      if (r.font.decoW) t.setRangeTextDecorationThickness(i, j, { unit: "PIXELS", value: r.font.decoW });
      if (r.font.decoY !== undefined) t.setRangeTextDecorationOffset(i, j, { unit: "PIXELS", value: Math.round(r.font.decoY) });
      spans.push({ i, j, font: r.font });
    }
    i = j;
  });
  await symbols(t);
  lateMark(t, spans);
};
const stroke = (n, b) => {
  if (!b) { n.strokes = []; return; }
  n.strokes = [solid(b.c)]; n.strokeAlign = "INSIDE";
  // padding is measured from the border box: the border never adds to it
  // (auto layout only: Figma throws on a frame without it)
  if (n.layoutMode && n.layoutMode !== "NONE") n.strokesIncludedInLayout = false;
  if (b.sides) [n.strokeTopWeight, n.strokeRightWeight, n.strokeBottomWeight, n.strokeLeftWeight] = b.sides;
  else n.strokeWeight = b.w;
};
// CSS mix-blend-mode → layer blend (same names, upper snake case)
const blendOf = (n, s) => {
  const blend = s.blend && s.blend.toUpperCase().replace(/-/g, "_");
  if (blend && ["MULTIPLY", "SCREEN", "OVERLAY", "DARKEN", "LIGHTEN", "COLOR_DODGE", "COLOR_BURN", "HARD_LIGHT", "SOFT_LIGHT", "DIFFERENCE", "EXCLUSION", "HUE", "SATURATION", "COLOR", "LUMINOSITY"].includes(blend)) n.blendMode = blend;
};
const deco = (n, s) => {
  if (s.border) stroke(n, s.border);
  if (s.r) corners(n, s);
  if (s.shadow || s.blur) n.effects = fx(s);
  if (s.op) n.opacity = s.op;
  blendOf(n, s);
  // tiled background (background-size in px): the image placed later reads it
  if (s.tile) n.setPluginData("tile", String(s.tile));
  // a cropped image: its whole box against the slot [dx, dy, w, h], read when it is placed
  if (s.crop) n.setPluginData("crop", JSON.stringify(s.crop));
  // CSS filter on an image (brightness / saturate / contrast): the image fill's filters, set when it is placed
  if (s.fx) n.setPluginData("fx", JSON.stringify(s.fx));
};
// image id → the node ids of its slots: placeImages goes to them without walking the page
const slot = (k, n) => (ST.slots[k] ||= []).push(n.id);
const frameProps = (f, s) => {
  f.fills = [...(s.img ? GREY : s.bg ? [solid(s.bg)] : []), ...grads(s.grad)];
  if (s.img) { f.setPluginData("img", String(s.imgId ?? s.id)); slot(String(s.imgId ?? s.id), f); }
  f.clipsContent = !!s.clip;
  // after the layout mode: the border's place in the layout depends on it
  if (!s.dir) return deco(f, s);
  f.layoutMode = s.dir === "H" ? "HORIZONTAL" : "VERTICAL";
  if (s.revZ) f.itemReverseZIndex = true;
  [f.paddingTop, f.paddingRight, f.paddingBottom, f.paddingLeft] = s.pad;
  f.itemSpacing = s.gap || 0;
  f.primaryAxisAlignItems = s.justify || "MIN";
  f.counterAxisAlignItems = s.align || "MIN";
  deco(f, s);
};
const create = async (s) => {
  let n;
  if (s.k === "frame") { n = figma.createFrame(); frameProps(n, s); }
  else if (s.k === "text") {
    n = figma.createText();
    await setRuns(n, s.runs);
    n.textAlignHorizontal = s.align;
    if (s.indent) n.paragraphIndent = s.indent;
    // an opening quote hung outside the text (negative text-indent): Figma hangs it too
    if (s.hang) n.hangingPunctuation = true;
    if (s.trim) n.leadingTrim = "CAP_HEIGHT";
    if (s.op) n.opacity = s.op;
    blendOf(n, s);
  } else if (s.k === "svg") {
    try { n = figma.createNodeFromSvg(s.svg); } catch (e) { n = figma.createFrame(); }
    // the import paints the root's fill attribute (inherited by the shapes in SVG, never drawn) on the frame:
    // a white logo on a white square, a black one once the layer blends in difference
    n.fills = [];
    if (s.op) n.opacity = s.op;
  } else if (s.dash) {
    // a dotted rule: a dashed line in a clipping frame as thick as the rule (a dash pattern has no phase,
    // the line starts at the first dot and stretches with the frame)
    n = figma.createFrame();
    n.fills = []; n.clipsContent = true;
    n.resize(Math.max(1, s.w), Math.max(1, s.h));
    const l = figma.createLine();
    n.appendChild(l);
    const v = s.dash.v;
    l.resize(Math.max(1, (v ? s.h : s.w) - s.dash.x0), 0);
    l.strokes = [solid(s.bg)]; l.strokeWeight = v ? s.w : s.h; l.strokeCap = "NONE"; l.dashPattern = [s.dash.on, s.dash.off];
    if (v) { l.rotation = -90; l.x = s.w / 2; l.y = s.dash.x0; }
    else { l.x = s.dash.x0; l.y = s.h / 2; }
    l.constraints = v ? { horizontal: "MIN", vertical: "STRETCH" } : { horizontal: "STRETCH", vertical: "MIN" };
    if (s.op) n.opacity = s.op;
  } else {
    n = figma.createRectangle();
    n.fills = [...(s.k === "img" ? GREY : s.bg ? [solid(s.bg)] : []), ...grads(s.grad)];
    deco(n, s);
  }
  n.name = s.k === "img" ? "img:" + s.id : s.name || s.k;
  if (s.k === "img") slot(String(s.id), n);
  return n;
};
const auto = (p) => p.layoutMode && p.layoutMode !== "NONE";
// in its parent: flow or absolute, then size (FIXED / HUG / FILL per axis)
// built in reading order, stacked in paint order: zi = rank among its siblings (a fixed header
// is built first yet stays over the page)
// parent id → its children's paint ranks (read again when its child count changed elsewhere)
const ZI = new Map();
const ranks = (parent) => {
  const ch = parent.children;
  let z = ZI.get(parent.id);
  if (!z || z.length !== ch.length) ZI.set(parent.id, (z = ch.map((c) => +(c.getPluginData("zi") || -1))));
  return z;
};
const place = (n, s, parent) => {
  const z = ranks(parent);
  if (s.zi == null) { parent.appendChild(n); z.push(-1); }
  else {
    n.setPluginData("zi", String(s.zi));
    const at = z.findIndex((v) => v > s.zi);
    if (at < 0) { parent.appendChild(n); z.push(s.zi); } else { parent.insertChild(at, n); z.splice(at, 0, s.zi); }
  }
  if (s.abs || !auto(parent)) {
    if (auto(parent)) n.layoutPositioning = "ABSOLUTE";
    n.x = s.abs ? s.abs.x : 0; n.y = s.abs ? s.abs.y : 0;
    // a main's layer held by its far edge follows it when an instance is resized
    if (s.abs && (s.abs.ax || s.abs.ay)) n.constraints = { horizontal: s.abs.ax ? "MAX" : "MIN", vertical: s.abs.ay ? "MAX" : "MIN" };
  }
  const flow = auto(parent) && !s.abs;
  const fit = (v) => (v === "FILL" && !flow ? "FIXED" : v === "HUG" && n.type !== "TEXT" && !auto(n) ? "FIXED" : v || "FIXED");
  const sw = fit(s.sw), sh = fit(s.sh);
  if (n.type === "TEXT") {
    // turned text: its glyphs size it, Figma's rotation is counter-clockwise
    if (s.rot) { n.textAutoResize = "WIDTH_AND_HEIGHT"; n.rotation = -s.rot; return; }
    if (sw === "HUG") n.textAutoResize = "WIDTH_AND_HEIGHT";
    else {
      n.resize(Math.max(1, s.w + 2), n.height);
      n.textAutoResize = "HEIGHT";
      if (s.trunc) { n.textTruncation = "ENDING"; n.maxLines = s.trunc; }
      if (sw === "FILL") n.layoutSizingHorizontal = "FILL";
    }
    return;
  }
  n.resize(Math.max(1, s.w), Math.max(1, s.h));
  // a box turned by the page (CSS rotate): about its centre, as a transform matrix (clockwise, like CSS)
  if (s.rot && flow) n.rotation = -s.rot;
  else if (s.rot) {
    const t = (s.rot * Math.PI) / 180, [a, b] = [Math.cos(t), Math.sin(t)];
    const [cx, cy] = [n.x + s.w / 2, n.y + s.h / 2];
    n.relativeTransform = [[a, -b, cx - (a * s.w) / 2 + (b * s.h) / 2], [b, a, cy - (b * s.w) / 2 - (a * s.h) / 2]];
  }
  // the captured width, read back once the page is built (the post-send check)
  n.setPluginData("w", String(Math.round(s.w)));
  try { n.layoutSizingHorizontal = sw; } catch (e) { errors.push("w " + n.name + ": " + e.message); }
  try { n.layoutSizingVertical = sh; } catch (e) { errors.push("h " + n.name + ": " + e.message); }
  // a main's image of one ratio everywhere: its height follows the instance's width (no size override exists)
  if (s.ar && sw === "FILL" && sh === "FIXED") { try { n.lockAspectRatio(); } catch (e) { errors.push("ar " + n.name + ": " + e.message); } }
  // a positioned layer spanning its parent's width or height (a fixed header, a full-bleed band, an
  // image filling its box) follows the parent when it is resized: an instance can't override this
  if (!flow) {
    const across = Math.abs(n.x) <= 1 && Math.abs(s.w - parent.width) <= 1;
    const down = Math.abs(n.y) <= 1 && Math.abs(s.h - parent.height) <= 1;
    // a layer hugging that axis can't stretch: Figma moves it by half the growth instead (a hero photo
    // sliding 7 px down when its block grows), so it keeps to the start edge
    const st = (on, hug, was) => (on ? (hug ? "MIN" : "STRETCH") : was);
    if (across || down) { try { n.constraints = { horizontal: st(across, n.layoutSizingHorizontal === "HUG", n.constraints.horizontal), vertical: st(down, n.layoutSizingVertical === "HUG", n.constraints.vertical) }; } catch (e) {} }
  }
};
// main (or main sublayer) id → its children's spec index → child index (a built main does not change)
const KI = new Map();
const kidAt = (m, i) => {
  let k = KI.get(m.id);
  if (!k) {
    k = new Map();
    m.children.forEach((c, j) => { const v = c.getPluginData("ki"); if (v && !k.has(v)) k.set(v, j); });
    KI.set(m.id, k);
  }
  return k.get(String(i)) ?? i;
};
const instance = async (s, parent) => {
  const main = await H.byId(ST.mains[s.inst]);
  const node = main.createInstance();
  node.name = s.name;
  blendOf(node, s);
  place(node, s, parent);
  for (const o of s.ov) {
    try {
      const walk = () => { let t = node, m = main; for (const i of o.p) { const at = kidAt(m, i); t = t.children[at]; m = m.children[at]; } return t; };
      await override(walk(), o, walk);
    } catch (e) { errors.push("ov " + s.name + " " + o.p.join(".") + ": " + e.message); }
  }
  return node;
};
// children stack in paint order (zi), not in spec order: each one keeps its spec index, which
// override paths (and the reuse check) resolve through
const kids = async (s, n) => {
  for (const [i, k] of (s.kids || []).entries()) (await build(k, n)).setPluginData("ki", String(i));
};
// the main being filled: a slot only exists inside one
let MAIN = null;
const build = async (s, parent) => {
  if (s.inst) return await instance(s, parent);
  let n;
  if (s.slot && MAIN) {
    n = MAIN.createSlot();
    frameProps(n, s);
    n.name = s.name || "Slot";
  } else n = await create(s);
  place(n, s, parent);
  await kids(s, n);
  return n;
};

${BOARD_JS}
// the board is packed once, at the end of the exec, when a family added to it
let dirty = false;
const compFrame = async () => {
  dirty = true;
  const had = ST.cf && (await H.byId(ST.cf));
  if (had) return had;
  let cp = figma.root.children.find((p) => p.name === ${JSON.stringify(COMP_PAGE)});
  if (!cp) { cp = figma.createPage(); cp.name = ${JSON.stringify(COMP_PAGE)}; }
  await cp.loadAsync();
  // a board left by an earlier build (possibly one column) is rearranged in place
  let f = cp.children.find((n) => n.getPluginData("fdslSite") === SITE);
  if (!f) {
    f = figma.createFrame();
    cp.appendChild(f);
    f.name = "Components · " + SITE;
    f.setPluginData("fdslSite", SITE);
    f.x = cp.children.filter((n) => n !== f).reduce((m, n) => Math.max(m, n.x + n.width + 400), 0);
    f.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  }
  ST.cf = f.id;
  return f;
};
const mainFrom = async (s, cf) => {
  const m = figma.createComponent();
  frameProps(m, s);
  cf.appendChild(m);
  m.resize(Math.max(1, s.w), Math.max(1, s.h));
  m.layoutSizingHorizontal = s.dir && s.sw === "HUG" ? "HUG" : "FIXED";
  m.layoutSizingVertical = s.dir && s.sh === "HUG" ? "HUG" : "FIXED";
  MAIN = m;
  try { await kids(s, m); } finally { MAIN = null; }
  return m;
};
// every variant of a set names the same properties, or Figma marks the set in error and refuses its
// property calls (seen: "Width=Wide, Variant=Default" joining a set of "Variant=Transition" left by an
// earlier build): a missing property takes "Default", a name now repeated takes a number
const sameAxes = (set) => {
  const props = set.children.map((c) => Object.fromEntries(c.name.split(",").map((p) => p.split("=").map((s) => s.trim())).filter((p) => p.length === 2)));
  const axes = [...new Set(props.flatMap(Object.keys))];
  if (props.every((p) => axes.every((a) => a in p))) return;
  const seen = new Set();
  set.children.forEach((c, i) => {
    const vals = axes.map((a) => props[i][a] ?? "Default");
    let name = axes.map((a, j) => a + "=" + vals[j]).join(", ");
    for (let j = 2; seen.has(name); j++) name = axes.map((a, k) => a + "=" + vals[k] + (k === axes.length - 1 ? " " + j : "")).join(", ");
    seen.add(name);
    c.name = name;
  });
};
// a family's new variants; into = the component (set) a previous build left for this family
const family = async (fam) => {
  const cf = await compFrame();
  const into = fam.into && (await H.byId(fam.into));
  const many = fam.vars.length > 1 || !!into;
  const taken = new Set(into?.type === "COMPONENT_SET" ? into.children.map((c) => c.name) : into ? ["Variant=Default"] : []);
  const mains = [];
  for (const v of fam.vars) {
    const m = await mainFrom(v.spec, cf);
    // a label holding its own properties ("Style=Outline, Size=Small") is kept as is
    const lab = v.label.includes("=") ? v.label : "Variant=" + v.label;
    let name = lab;
    for (let i = 2; taken.has(name); i++) name = lab + " " + i;
    taken.add(name);
    m.name = many ? name : fam.name;
    // structure keys + the content the main was built from: the next build reuses it
    m.setPluginData("fdslFam", fam.fam); m.setPluginData("fdslSig", v.sig);
    // Figma caps one entry at 100 kB (a main full of svg markup): the spec spans numbered keys
    for (let i = 0; i === 0 || i * 4e4 < v.rep.length; i++) m.setPluginData("fdslSpec" + (i || ""), v.rep.slice(i * 4e4, (i + 1) * 4e4));
    ST.mains[v.key] = m.id;
    mains.push(m);
  }
  // a variant holding an instance of its own set cannot join it (Figma: component set cycle): it
  // stays beside the set, on its own, named after the family
  const alone = (m) => { m.name = fam.name + " / " + m.name.replace(/^Variant=/, ""); };
  // a variant joining a set renews the set's property ids and can repoint a layer of the variants
  // already there (seen: a layer moved to another boolean, its instances shown wrong on the page)
  const wired = [];
  const wiring = (n) => {
    const refs = n.componentPropertyReferences;
    if (refs && Object.keys(refs).length) wired.push([n, Object.fromEntries(Object.entries(refs).map(([key, id]) => [key, id.split("#")[0]]))]);
    if (n.type !== "INSTANCE" && "children" in n) n.children.forEach(wiring);
  };
  // the new mains, index for index with fam.vars (a lone into is put in front of mains below)
  const made = [...mains];
  if (into?.type === "COMPONENT_SET") into.children.filter((c) => !mains.includes(c)).forEach(wiring);
  if (into?.type === "COMPONENT_SET") {
    for (const m of mains) try { into.appendChild(m); } catch { alone(m); }
    sameAxes(into);
    setLayout(into);
  } else {
    if (into) { into.name = "Variant=Default"; mains.unshift(into); }
    if (mains.length > 1) {
      try {
        const set = figma.combineAsVariants(mains, cf);
        set.name = fam.name;
        setLayout(set);
      } catch { for (const m of mains) if (m !== into) alone(m); if (into) into.name = fam.name; }
    }
  }
  // a layer only some occurrences have: a boolean property of the main (of its set, once in one)
  fam.vars.forEach((v, i) => { try { addProps(made[i], v.spec); } catch (e) { errors.push("props " + fam.name + ": " + e.message); } });
  if (wired.length) {
    const defs = Object.keys(into.componentPropertyDefinitions);
    for (const [n, refs] of wired) {
      const now = Object.fromEntries(Object.entries(refs).map(([key, name]) => [key, defs.find((d) => d.split("#")[0] === name)]));
      if (Object.keys(now).some((key) => now[key] && now[key] !== n.componentPropertyReferences?.[key])) n.componentPropertyReferences = { ...n.componentPropertyReferences, ...Object.fromEntries(Object.entries(now).filter(([, d]) => d)) };
    }
  }
};
const addProps = (m, spec) => {
  const owner = m.parent.type === "COMPONENT_SET" ? m.parent : m;
  const used = new Set();
  const visit = (s, n) => {
    if (s.slot) return;
    (s.kids || []).forEach((k, i) => {
      const c = n.children[kidAt(n, i)];
      if (!c) return;
      const propOf = (base, type, value) => {
        let name = base;
        for (let j = 2; used.has(name); j++) name = base + " " + j;
        used.add(name);
        return Object.keys(owner.componentPropertyDefinitions).find((d) => d.split("#")[0] === name && owner.componentPropertyDefinitions[d].type === type) || owner.addComponentProperty(name, type, value);
      };
      const label = k.prop || k.name || c.name;
      // an icon's layer, as in the kit: "Left icon" swaps the drawing, "Show left icon" shows it
      if (k.icon && c.type === "INSTANCE" && ST.mains[k.inst]) {
        try { c.componentPropertyReferences = { ...(c.componentPropertyReferences || {}), mainComponent: propOf(label, "INSTANCE_SWAP", ST.mains[k.inst]) }; } catch (e) { errors.push("swap " + label + ": " + e.message); }
      }
      if (k.opt) c.componentPropertyReferences = { ...(c.componentPropertyReferences || {}), visible: propOf(k.icon ? "Show " + label.toLowerCase() : label, "BOOLEAN", true) };
      if (!k.inst) visit(k, c);
    });
  };
  visit(spec, m);
};
// an icon's override of color: each plain paint of its vectors that shows a color of the list takes the new one
const tint = (n, pairs) => {
  const map = pairs.map(([from, to]) => [solid(from), solid(to)]);
  const same = (p, q) => Math.abs(p.color.r - q.color.r) + Math.abs(p.color.g - q.color.g) + Math.abs(p.color.b - q.color.b) < 0.01 && Math.abs((p.opacity ?? 1) - (q.opacity ?? 1)) < 0.01;
  const swap = (paints) => paints.map((p) => { const m = p.type === "SOLID" && map.find(([f]) => same(p, f)); return m ? { ...p, color: m[1].color, opacity: m[1].opacity } : p; });
  for (const v of [n, ...("findAll" in n ? n.findAll(() => true) : [])]) {
    if ("fills" in v && Array.isArray(v.fills) && v.fills.length) v.fills = swap(v.fills);
    if ("strokes" in v && v.strokes.length) v.strokes = swap(v.strokes);
  }
};
const override = async (n0, o, walk = () => n0) => {
  // a write to a slot of an instance can renew the node (and its content): always fetched anew
  let live = n0;
  const N = () => (live.removed ? (live = walk()) : live);
  let n = N();
  // another icon in the same place: the nested instance swapped to its main
  if (o.swap) n.swapComponent(await H.byId(ST.mains[o.swap]));
  // a layer this occurrence doesn't have: the boolean of the instance holding it, off
  if (o.hide) {
    let h = n.parent;
    while (h && h.type !== "INSTANCE") h = h.parent;
    const key = n.componentPropertyReferences?.visible;
    if (key && h) h.setProperties({ [key]: false });
    else n.visible = false;
    return;
  }
  if (o.slot) {
    // the atoms are built off the slot (any write to it renews the slot and its content), then
    // moved in at once and tagged through the renewed slot
    const tmp = figma.createFrame();
    tmp.layoutMode = n.layoutMode === "NONE" ? "VERTICAL" : n.layoutMode;
    tmp.itemSpacing = n.itemSpacing;
    tmp.resize(Math.max(1, n.width), Math.max(1, n.height));
    for (const [i, k] of o.slot.entries()) (await build(k, tmp)).setPluginData("ki", String(i));
    // paint order, not spec order: the spec index of each moved atom, by position
    const ki = tmp.children.map((c) => c.getPluginData("ki"));
    while (N().children.length) N().children[0].remove();
    while (tmp.children.length) N().appendChild(tmp.children[0]);
    tmp.remove();
    N().children.forEach((c, i) => c.setPluginData("ki", ki[i]));
  }
  n = N();
  // a text atom nested as an instance (circle: Heading, Text inside a card): its one text layer takes the runs
  if (o.runs) { const t = n.type === "TEXT" ? n : n.findOne((k) => k.type === "TEXT"); await setRuns(t, o.runs); t.paragraphIndent = o.indent || 0; }
  n = N();
  if ("bg" in o && !o.img) n.fills = [...(o.bg ? [solid(o.bg)] : []), ...grads(o.grad)];
  n = N();
  if ("border" in o) stroke(n, o.border);
  n = N();
  if ("shadow" in o) n.effects = fx(o);
  n = N();
  if ("r" in o) n.cornerRadius = o.r >= Math.min(o.rw, o.rh) / 2 - 1 ? 999 : Math.min(o.r, o.rw / 2, o.rh / 2);
  n = N();
  if (o.rs) corners(n, { rs: o.rs, w: o.rw, h: o.rh });
  n = N();
  if (o.tint) tint(n, o.tint);
  n = N();
  if ("op" in o) n.opacity = o.op;
  n = N();
  if (o.pad) [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft] = o.pad;
  n = N();
  if ("gap" in o && n.layoutMode !== "NONE") n.itemSpacing = o.gap;
  n = N();
  if (o.al && n.layoutMode !== "NONE") n.counterAxisAlignItems = o.al;
  if (o.ju && n.layoutMode !== "NONE") n.primaryAxisAlignItems = o.ju;
  n = N();
  // (FILL / HUG refused where the parent or the layer has no auto layout: the size below still holds)
  if (o.sw) try { n.layoutSizingHorizontal = o.sw; } catch {}
  if (o.sh) try { n.layoutSizingVertical = o.sh; } catch {}
  n = N();
  if (o.w || o.h) {
    // (a master label that truncates keeps cutting once the source wraps: a chat bubble taken for a Button showed "Sure. Can you share your ord...")
    if (n.type === "TEXT") { n.resize(o.w + 2, n.height); n.textAutoResize = "HEIGHT"; if (n.textTruncation === "ENDING") n.textTruncation = "DISABLED"; }
    else n.resize(o.w || n.width, o.h || n.height);
  }
  n = N();
  if (o.img != null) {
    // its own placeholder, not the main's image once that one arrives
    n.fills = [...GREY, ...(o.grad ? grads(o.grad) : n.fills.filter((p) => p.type.startsWith("GRADIENT")))];
    if ("layoutMode" in n) n.setPluginData("img", String(o.img));
    else n.name = "img:" + o.img;
    slot(String(o.img), n);
  }
};

if (fresh) {
  // the page itself: an auto layout frame at the captured width, hugging its content in height
  const s = OPS[0].s;
  // a staged root left half-filled by a failed run is rebuilt from empty, never appended to
  if (ST.stage) for (const k of [...root.children]) k.remove();
  frameProps(root, s);
  if (!s.bg) root.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  root.clipsContent = true;
  root.cornerRadius = 16;
  // the height hugs the flow: a section a few px taller than on the page pushes the footer down
  // instead of being cut off at the page's height (moma: footer clipped 109 px short)
  // (a root with no auto layout, all children absolute, keeps its captured height)
  root.resize(W, HGT);
  if (root.layoutMode !== "NONE") {
    root.layoutSizingHorizontal = "FIXED";
    root.layoutSizingVertical = "HUG";
    // (never shorter than the page: its background fills the viewport under a short body)
    root.minHeight = HGT;
  }
  ST.map[OPS[0].u] = root.id;
}
const nodes = {};
const nodeOf = async (u) => nodes[u] || (nodes[u] = await H.byId(ST.map[u]));
let n = 0;
for (const op of OPS) {
  if (op.pu < 0) continue;
  try {
    const parent = await nodeOf(op.pu);
    let node;
    if (op.inst) {
      for (const f of op.fams || []) await family(f);
      node = await instance({ ...op.s, inst: op.inst, ov: op.ov }, parent);
    } else {
      node = await create(op.s);
      place(node, op.s, parent);
      if (op.s.k === "frame") { nodes[op.u] = node; ST.map[op.u] = node.id; }
    }
    n++;
    await reveal(node, parent.id);
  } catch (e) { errors.push(op.s.name + ": " + (e && e.message !== undefined ? e.message : JSON.stringify(e) + " " + String(e && e.stack || e).slice(0, 300))); }
}
await flush();
// the board packed with the new mains / sets; the boards to the right shift if it widened
if (dirty) { const cf = await H.byId(ST.cf); boardLayout(cf); boardsRow(cf.parent); }
c.done();
return { ST, nodes: n, errors: errors.slice(0, 10), nerr: errors.length };
`;

// a lot closes at LOT items, NODE_BUDGET nodes or IMG_BUDGET of image file bytes (decoded in the exec);
// a heavier image goes alone in pass 2
const IMG_BUDGET = 700_000;
// and at NODE_BUDGET nodes (~1 s of build): images ready by then go in between two lots
const NODE_BUDGET = 120;
let placed = 0;
let lots = 0;
let bytes = 0;
let rootId;
let cfId;
let slotIds;
let nodes = 0;
let firstImg = 0;
const later = [];

if (COMPS) {
  const L = layoutTree(cap, flat);
  // a main is built with the site's font table: when it changes (a font activated, an optical
  // size pinned) the mains already on the page are built anew, not reused with the old fonts;
  // FACE_RULE names the face choice in styleOf: changed with it, so a new rule rebuilds them too
  const FACE_RULE = "width-from-stretch";
  const fontKey = sha1(FACE_RULE + JSON.stringify(Object.keys(FACES).sort().map((k) => [k, FACES[k].family, FACES[k].faces.map((f) => (f.family || "") + "|" + f.style).sort(), Object.entries(FACES[k].opsz?.fams || {}).sort()]))).slice(0, 8);
  for (const c of L.comps) for (const v of c.vars) v.sig += "#" + fontKey;
  const sigOf = new Map(L.comps.flatMap((c) => c.vars.map((v) => [v.key, v.sig])));
  log(`components mode: ${L.stats.comps} components, ${L.comps.reduce((a, c) => a + c.vars.length, 0)} variants, ${L.stats.instances} instances, ${L.stats.auto}/${L.stats.frames} auto layout frames, ${L.stats.abs} absolute, ${L.stats.pinned} widths pinned by the check`);
  const strip = (n) => {
    const { kids, done, leaves, sig, fam, css, flex, hint, tag, synth, wrap, comp, ui, virt, u, ...s } = n;
    return s;
  };
  // (a nested block keeps its variant's structure key: an instance of another variant is swapped)
  // a main's spec: its own layers; what a nested instance holds is that component's own spec
  // (a slot's list is compared whole: no sublayer of it is reached by a path)
  const deep = (n) => ({ ...strip(n), cs: n.comp ? sigOf.get(n.comp) : undefined, kids: n.kids?.map(deep) });
  const full = (n) => ({ ...strip(n), cs: n.comp ? sigOf.get(n.comp) : undefined, kids: n.slot ? n.kids.map(deep) : n.kids?.map((k) => (k.comp ? { ...strip(k), cs: sigOf.get(k.comp) } : full(k))) });
  // a main's content: nested components become plain instances (their own main's content), each
  // occurrence overrides from that
  const stub = (n, own) => ({ inst: n.comp, icon: n.k === "svg", name: n.name, sw: n.sw, sh: n.sh, w: n.w, h: n.h, abs: n.abs, blend: n.blend, opt: n.opt, prop: n.prop, ov: own || n.k !== "frame" ? ovOf(reps.get(n.comp), n) : [] });
  // (a slot's atoms keep their content in the main: an occurrence holding the same list overrides nothing)
  const inMain = (n) => ({ ...strip(n), kids: n.kids?.map((k) => (k.comp ? stub(k, n.slot) : inMain(k))) });
  const mainSpec = (n) => {
    if (n.k === "frame") return { ...inMain(n), abs: undefined };
    const leaf = { ...full(n), abs: undefined, sw: n.sw === "HUG" ? "HUG" : "FILL", sh: n.k === "text" ? "HUG" : "FILL" };
    return { k: "frame", dir: "V", pad: [0, 0, 0, 0], gap: 0, align: "MIN", w: n.w, h: n.h, sw: n.sw === "HUG" ? "HUG" : "FIXED", sh: n.k === "text" ? "HUG" : "FIXED", kids: [leaf] };
  };
  // the sizing a layer really gets (see place()): a hug needs auto layout, a fill a flow
  const fitted = (n, v) => (v === "FILL" && n.abs ? "FIXED" : v === "HUG" && n.k !== "text" && !(n.k === "frame" && n.dir) ? "FIXED" : v || "FIXED");
  // what an occurrence changes on its main, layer by layer through the main's union of layers;
  // at = the layer in the main, where this occurrence's size and place are compared
  const diff = (at, b, p, out) => {
    let a = at;
    // a nested block: its content compares to its own main's. Of another variant of its family, the
    // instance is swapped to that variant first
    if (p.length && b.k === "frame" && b.comp) {
      const bs = sigOf.get(b.comp);
      const as = at.cs ?? sigOf.get(at.comp);
      if (as && as !== bs) out.push({ p, swap: b.comp });
      a = { ...reps.get(b.comp), cs: bs };
    }
    const o = {};
    if (b.k === "text") {
      if (JSON.stringify(a.runs) !== JSON.stringify(b.runs) || a.indent !== b.indent) { o.runs = b.runs; o.indent = b.indent; }
    } else {
      // fills go together: color base and gradient layers
      if (a.bg !== b.bg || JSON.stringify(a.grad) !== JSON.stringify(b.grad)) { o.bg = b.bg || null; o.grad = b.grad; }
      if (JSON.stringify(a.border || null) !== JSON.stringify(b.border || null)) o.border = b.border || null;
      if (JSON.stringify(a.shadow || null) !== JSON.stringify(b.shadow || null)) { o.shadow = b.shadow || null; o.blur = b.blur; }
      if ((a.r || 0) !== (b.r || 0)) { o.r = b.r || 0; o.rw = b.w; o.rh = b.h; }
      if (JSON.stringify(a.rs) !== JSON.stringify(b.rs)) { o.rs = b.rs; o.rw = b.w; o.rh = b.h; o.r = b.r || 0; }
      if (JSON.stringify(a.pad) !== JSON.stringify(b.pad)) o.pad = b.pad;
      if (b.k === "frame" && b.dir) {
        if ((a.gap || 0) !== (b.gap || 0)) o.gap = b.gap || 0;
        if ((a.align || "MIN") !== (b.align || "MIN")) o.al = b.align || "MIN";
        if ((a.justify || "MIN") !== (b.justify || "MIN")) o.ju = b.justify || "MIN";
      }
    }
    if (a.op !== b.op) o.op = b.op ?? 1;
    if (p.length) {
      if (fitted(at, at.sw) !== fitted(b, b.sw)) o.sw = fitted(b, b.sw);
      if (b.k !== "text" && fitted(at, at.sh) !== fitted(b, b.sh)) o.sh = fitted(b, b.sh);
    }
    if (fitted(b, b.sw) === "FIXED" && (o.sw || Math.abs(at.w - b.w) > 1)) o.w = b.w;
    if (b.k !== "text" && fitted(b, b.sh) === "FIXED" && (o.sh || Math.abs(at.h - b.h) > 1)) o.h = b.h;
    const img = b.k === "img" ? b.id : b.k === "frame" && b.img ? b.imgId ?? b.id : null;
    if (img != null) o.img = img;
    // an icon is a nested instance: another drawing swaps it
    if (b.k === "svg" && a.svg !== b.svg) {
      const same = svgTint(a.svg, b.svg);
      if (b.comp && !same) o.swap = b.comp;
      // the same drawing in another color: its paints, from what this layer shows (the main's, or what a swap brings)
      const main = o.swap ? svgTint(reps.get(b.comp)?.svg, b.svg) : same;
      if (main?.length) o.tint = main;
    }
    // a slot's list of its own: rebuilt whole, each atom with its overrides
    const slotKid = (k) => (k.comp ? stub(k, true) : inMain(k));
    if (a.slot && JSON.stringify(a.kids.map(deep)) !== JSON.stringify(b.kids.map(deep))) o.slot = b.kids.map(slotKid);
    if (Object.keys(o).length) out.push({ p, ...o });
    // a layer of the main this occurrence doesn't have: its boolean off
    if (!a.slot) (a.kids || []).forEach((ak, i) => {
      const ks = b.kids || [];
      const bk = ks.find((k) => k.ui === i) ?? (ks.every((k) => k.ui == null) ? ks[i] : null);
      if (bk) diff(ak, bk, [...p, i], out);
      else out.push({ p: [...p, i], hide: true });
    });
    return out;
  };
  // the instance's own root keeps its color / image overrides (tinted cards), its size comes from place()
  const ovOf = (rep, n) => (rep.k !== "frame" ? diff(rep, n, [0], []) : diff(rep, n, [], [])).map(({ w, h, sw, sh, ...o }) => (o.p.length ? { w, h, sw, sh, ...o } : o)).filter((o) => Object.keys(o).some((k) => k !== "p" && o[k] !== undefined));
  const famOf = new Map();
  for (const c of L.comps) for (const v of c.vars) famOf.set(v.key, c);
  // what each main holds: every layer any occurrence has, or for a structure already on the page
  // (an earlier build, another page of the site) its main's own content
  const reps = new Map();
  for (const c of L.comps) for (const v of c.vars) reps.set(v.key, v.union);
  const hasImg = (n) => n.k === "img" || !!n.img || (n.kids || []).some(hasImg);
  const found = await rpc(`
const out = { sigs: {}, fams: {}, names: {}, cf: null };
// mains live on the components page
const cp = figma.root.children.find((p) => p.name === ${JSON.stringify(COMP_PAGE)});
if (!cp) return out;
await cp.loadAsync();
let ms;
// this site's board only: another site's set would take this page's variants under its own name
const board = cp.findChildren((n) => n.type === "FRAME" && n.getPluginData("fdslSite") === ${JSON.stringify(SITE)})[0];
if (!board) return out;
try { ms = board.findAllWithCriteria({ types: ["COMPONENT"], pluginData: { keys: ["fdslSig"] } }); }
catch (e) { ms = board.findAllWithCriteria({ types: ["COMPONENT"] }).filter((m) => m.getPluginData("fdslSig")); }
// a main left short by a build stopped half-way (its spec saved, its children not all laid):
// the overrides' paths would end in the void (or on a node of another kind), it is built anew
const kidAt = (m, i) => { const j = m.children.findIndex((c) => c.getPluginData("ki") === String(i)); return j < 0 ? i : j; };
const fits = (sp, n) => !!n && (sp.k === "text") === (n.type === "TEXT") && (!(sp.kids || []).length || ("children" in n && n.children.length >= sp.kids.length && sp.kids.every((k, i) => fits(k, n.children[kidAt(n, i)]))));
out.stale = 0;
for (const m of ms) {
  let spec = m.getPluginData("fdslSpec");
  for (let i = 1, part; (part = m.getPluginData("fdslSpec" + i)); i++) spec += part;
  try { const sp = JSON.parse(spec); if (!fits(sp, sp.k !== "frame" ? m.children[0] : m)) { out.stale++; continue; } } catch { continue; }
  out.sigs[m.getPluginData("fdslSig")] = { id: m.id, spec, fam: m.getPluginData("fdslFam") };
  const owner = m.parent.type === "COMPONENT_SET" ? m.parent : m;
  out.fams[m.getPluginData("fdslFam")] = owner.id;
  out.names[owner.name] = { id: owner.id, fam: m.getPluginData("fdslFam") };
}
out.cf = board.id;
return out;`);
  const reused = new Map();
  const fams = new Set(L.comps.map((c) => c.fam));
  for (const c of L.comps) for (const v of c.vars) {
    const e = found.sigs[v.sig];
    if (!e?.spec) continue;
    // a main of another family of this page (a block once filed with its own container's family):
    // reused, it would sit in the set of the instance it is swapped into, which Figma refuses as a cycle
    if (e.fam && e.fam !== c.fam && fams.has(e.fam)) continue;
    const sp = JSON.parse(e.spec);
    // a main built without its picture while this page has one: built anew
    if (hasImg(full(v.union)) && !hasImg(sp)) continue;
    reused.set(v.key, e.id); reps.set(v.key, sp);
  }
  log(`reused: ${reused.size} variants already on the page${found.stale ? ` (${found.stale} incomplete ignored)` : ""}, ${L.comps.reduce((a, c) => a + c.vars.length, 0) - reused.size} to create`);
  const ops = [];
  let U = 0;
  const done = new Set();
  // image id → index of the op that lays its (first) slot
  const slotAt = new Map();
  const flatten = (n, pu, zi) => {
    const u = U++;
    if (n.comp) {
      const rep = reps.get(n.comp);
      const leafRep = rep.k !== "frame";
      const ov = ovOf(rep, n);
      const op = { u, pu, inst: n.comp, s: { name: n.name, sw: n.sw, sh: leafRep && n.k === "text" ? "HUG" : n.sh, w: n.w, h: n.h, abs: n.abs, blend: n.blend, zi }, ov };
      for (const o of ov) if (o.img != null) slotAt.set(o.img, ops.length);
      ops.push(op);
      return;
    }
    if (n.k === "img") slotAt.set(n.id, ops.length);
    else if (n.img) slotAt.set(n.imgId ?? n.id, ops.length);
    ops.push({ u, pu, s: { ...strip(n), zi } });
    // children in reading order (top to bottom), each keeping its paint rank
    (n.kids || []).map((k, i) => [k, i]).sort((a, b) => Math.round(a[0].y ?? 0) - Math.round(b[0].y ?? 0) || a[1] - b[1]).forEach(([k, i]) => flatten(k, u, i));
  };
  flatten(L.root, -1);
  // families' mains need every variant's representative: resolve after the walk;
  // families nested in a main come first (its instances need their mains)
  const famSpec = (c, out) => {
    const fresh = c.vars.filter((v) => !reused.has(v.key));
    const built = fresh.map((v) => ({ key: v.key, sig: v.sig, label: v.label, rep: JSON.stringify(full(reps.get(v.key))), spec: { ...mainSpec(reps.get(v.key)), name: undefined } }));
    // a variant holding an instance of a sibling variant: that sibling's main first
    const keys = (x, s = new Set()) => { if (Array.isArray(x)) x.forEach((y) => keys(y, s)); else if (x && typeof x === "object") { if (x.inst) s.add(x.inst); if (x.swap) s.add(x.swap); for (const k of ["kids", "ov", "slot"]) if (x[k]) keys(x[k], s); } return s; };
    const vars = [];
    const put = (v, seen = new Set()) => {
      if (vars.includes(v) || seen.has(v)) return;
      seen.add(v);
      for (const k of keys(v.spec.kids)) { const d = built.find((b) => b.key === k); if (d) put(d, seen); }
      vars.push(v);
    };
    built.forEach((v) => put(v));
    vars.forEach((v) => needIn(v.spec.kids, out));
    // another page of the site drew it a little differently (a header at another width): a component of
    // that name on the board is this one, the drawing joins it as a variant, no second "Header" beside it
    const named = found.names?.[c.name];
    out.push({ name: c.name, fam: c.fam, into: found.fams[c.fam] || (named && !fams.has(named.fam) ? named.id : null), vars });
  };
  // the mains a spec brings: nested instances, swapped icons
  const needIn = (x, out) => {
    if (Array.isArray(x)) return x.forEach((y) => needIn(y, out));
    if (!x || typeof x !== "object") return;
    if (x.inst) need(famOf.get(x.inst), out);
    if (x.swap) need(famOf.get(x.swap), out);
    for (const k of ["kids", "ov", "slot"]) if (x[k]) needIn(x[k], out);
  };
  const need = (c, out) => {
    if (done.has(c.key) || c.vars.every((v) => reused.has(v.key))) return;
    done.add(c.key);
    famSpec(c, out);
  };
  // in page order: an op brings the families it is the first to need (a family also nested in
  // an earlier main is already built by then)
  for (const op of ops) if (op.inst) {
    const fams = [];
    needIn(op.ov, fams);
    need(famOf.get(op.inst), fams);
    if (fams.length) op.fams = fams;
  }
  // lots: a small first one (frame + first block ≤ 3 s), then up to NODE_BUDGET glides / ~600 KB
  let ST = { root: null, stage, cf: found.cf, map: {}, mains: Object.fromEntries(reused), slots: {} };
  // an override costs too: each one a write, a restyled text one per run, a slot its atoms' nodes
  const ovs = (ov) => (ov || []).reduce((a, o) => a + 1 + (o.runs?.length || 0) + (o.slot || []).reduce((b, k) => b + count(k), 0), 0);
  const count = (s) => 1 + ovs(s.ov) + (s.kids || []).reduce((a, k) => a + count(k), 0);
  const weight = (op) => 1 + ovs(op.ov) + (op.fams || []).reduce((a, f) => a + f.vars.reduce((b, v) => b + count(v.spec), 0), 0);
  const sent = new Set();
  let imgAt = 0;
  // ms per op of the last lot: the next one is sized to ~8 s, far under the 30 s exec timeout
  // (a page heavy with earlier builds slows every write)
  let perOp = 0;
  for (let i = 0, k = 0; i < ops.length; k++) {
    const B = [];
    let size = 0;
    // element by element: ~2.5 s of glides per lot, so the images ready by then go in between
    // lots as the page builds (not all at the end)
    const max = Math.min(k ? NODE_BUDGET : 40, REVEAL_MS ? Infinity : Math.max(4, Math.floor(2500 / (PACE + HOLD + 60))), perOp ? Math.max(4, Math.floor(8000 / perOp)) : Infinity);
    // an op bringing its families' mains builds every variant's subtree too: counted in nodes
    // (55 variants in the first lot of 40 ops ran past the 30 s exec timeout)
    let cost = 0;
    for (; i < ops.length && (!B.length || cost + weight(ops[i]) <= max) && size < 600_000; i++) {
      B.push(ops[i]);
      cost += weight(ops[i]);
      size += JSON.stringify(ops[i]).length;
    }
    const tl = Date.now();
    let r;
    try { r = await rpc(treePass(B, ST)); }
    catch (e) {
      // which ops the lot held: the one that hangs or throws is among them
      if (trace) for (const op of B) warn(`  ${op.inst || op.s.k} ${op.s.name || ""} fams ${(op.fams || []).map((f) => f.name + ":" + f.vars.length).join(",")} ov ${JSON.stringify(op.ov || []).slice(0, 300)}`);
      throw e;
    }
    perOp = (Date.now() - tl) / cost;
    if (trace) log(`batch ${k + 1}: ${B.length} ops, cost ${cost}, ${r.nodes} nodes, ${Date.now() - tl} ms`);
    if (trace && r.nerr) for (const op of B) warn(`  ${op.inst || op.s.k} ${op.s.name || ""} fams ${(op.fams || []).map((f) => f.name + ":" + f.vars.length).join(",")} ov ${JSON.stringify(op.ov || []).slice(0, 1500)}`);
    ST = r.ST;
    nodes += r.nodes;
    // a node that fails takes its whole subtree with it (parent missing in every later lot): stop
    if (r.nerr) {
      throw Object.assign(new Error(`batch ${k + 1}: ${r.nerr} error(s): ${r.errors.join(" · ")}\nbuild stopped: ${nodes} nodes placed in ${ST.root}`), { stopped: true });
    }
    if (!lots++) log(`first batch: ${r.nodes} nodes in ${ST.root}, ${Date.now() - t0} ms`);
    // images whose slot exists by now and already downloaded: placed between lots, BATCH at a
    // time, one glide a second at most (the rest waits for the next lot, or pass 2)
    const last = i >= ops.length;
    if (!last && Date.now() - imgAt < 1000) continue;
    // an svg waits for the last lot: whether its main is shared is known once every slot exists
    const ready = srcs.filter((s) => !sent.has(s.id) && fetcher.ready(s.id) && slotAt.get(s.id) < i && (last || !fetcher.value(s.id)?.svg));
    if (!last) ready.splice(BATCH);
    let batch = [];
    bytes = 0;
    const put = async () => { const tp = Date.now(); (await placeImages(rpc, ST.root, batch, [ST.cf].filter(Boolean), ST.slots, mixedMains(ST.slots, srcs))).forEach((ok) => ok && placed++); imgAt = Date.now(); firstImg ||= placed && imgAt; if (trace) log(`  images : ${batch.length}, ${imgAt - tp} ms`); batch = []; bytes = 0; };
    for (const s of ready) {
      sent.add(s.id);
      // an image that could not be had: its slot loses the grey placeholder
      const d = fetcher.value(s.id) || { id: s.id, drop: true };
      if (batch.length && (batch.length >= BATCH || bytes + (d.svg?.length ?? d.size ?? 0) > BATCH_BYTES)) await put();
      batch.push(d); bytes += (d.svg?.length ?? d.size ?? 0);
    }
    if (batch.length) await put();
  }
  rootId = ST.root;
  cfId = ST.cf;
  slotIds = ST.slots;
  for (const s of srcs) if (!sent.has(s.id)) later.push(s.id);
} else {
  let r1;
  const spec = flat;
  // an image item with its payload when downloaded by now and the lot has room, else a placeholder
  const withImage = (s) => {
    if (!s.img || !wanted.has(s.id)) return s;
    const d = fetcher.ready(s.id) && fetcher.value(s.id);
    const size = d ? (d.svg?.length ?? d.size) : 0;
    if (d && size <= IMG_BUDGET && bytes + size <= IMG_BUDGET) {
      bytes += size; placed++;
      return d.svg ? { ...s, svgImg: d.svg } : { ...s, imgUrl: d.url };
    }
    later.push(s.id);
    return s;
  };
  let ST = { root: null, stage };
  for (let i = 0; i < spec.length || !r1; ) {
    const S = [];
    let cost = 0;
    bytes = 0;
    for (; i < spec.length && S.length < LOT && cost < NODE_BUDGET; i++) {
      const s = spec[i];
      cost += s.text && s.lines ? s.lines.length : 1;
      S.push(withImage(s));
    }
    r1 = await rpc(pass1(S, ST));
    ST = r1.ST;
    if (!lots++) log(`first batch: ${r1.nodes} nodes in ${ST.root}, ${Date.now() - t0} ms`);
  }
  rootId = ST.root;
  nodes = r1.nodes;
}
const pass1Ms = Date.now() - t0;
log(`pass 1: ${nodes} nodes in ${rootId}, ${pass1Ms} ms`);

// Pass 2: the images still downloading when their slot was laid, in batches
let B = [];
bytes = 0;
const more = [cfId].filter(Boolean);
const flush = async () => { if (B.length) (await placeImages(rpc, rootId, B, more, slotIds, slotIds ? mixedMains(slotIds, srcs) : [])).forEach((ok) => ok && placed++); firstImg ||= placed && Date.now(); B = []; bytes = 0; };
for (const id of later) {
  const d = (await fetcher.get(id)) || { id, drop: true };
  if (B.length && bytes + (d.svg?.length ?? d.size ?? 0) > BATCH_BYTES) await flush();
  B.push(d); bytes += (d.svg?.length ?? d.size ?? 0);
}
await flush();
await fetcher.cleanup();
log(`pass 2: ${later.length} late, ${placed}/${srcs.length} images${firstImg ? `, first at ${firstImg - t0} ms` : ""}, total ${Date.now() - t0} ms`);

// Post-send check: every built box (not texts, not inside an instance) read back against its
// captured width; off by more than 2 px → pinned to the captured width, outermost first (its
// filling children follow), a few rounds; what still differs is reported by name
if (cfId) {
  const r = await rpc(`
const root = await H.byId(${JSON.stringify(rootId)});
let checked = 0;
const off = () => {
  const out = [];
  checked = 0;
  const walk = (n, bad) => {
    const w = n.getPluginData("w");
    if (w !== "" && n.type !== "TEXT") checked++;
    const miss = w !== "" && n.type !== "TEXT" && Math.abs(n.width - +w) > 2;
    if (miss && !bad) out.push([n, +w]);
    if (n.type !== "INSTANCE" && "children" in n) for (const k of n.children) walk(k, bad || miss);
  };
  for (const k of root.children) walk(k, false);
  return out;
};
let fixed = 0;
for (let round = 0; round < 4; round++) {
  const bad = off();
  if (!bad.length) break;
  for (const [n, w] of bad) {
    try {
      if (n.parent && "layoutMode" in n.parent && n.parent.layoutMode !== "NONE" && n.layoutPositioning !== "ABSOLUTE") n.layoutSizingHorizontal = "FIXED";
      n.resize(Math.max(1, w), n.height);
      fixed++;
    } catch (e) {}
  }
}
const left = off().map(([n, w]) => n.name + " " + Math.round(n.width) + "/" + w);
return { checked, fixed, left: left.slice(0, 12), nleft: left.length };
`);
  log(`check: ${r.checked} boxes re-read, ${r.fixed} fixed${r.nleft ? `, ${r.nleft} still off: ${r.left.join(" · ")}` : ""}`);
}

// The mains of this site's board no instance uses any more (a variant replaced, a family
// redesigned): removed, once two independent methods agree (an instance scan of every page,
// then each main's own getInstancesAsync); a removed main frees the mains only it nested, so
// it loops until nothing is left, then the board is packed again
if (cfId) {
  const r = await rpc(`
${BOARD_JS}
const t0 = Date.now();
const cf = await H.byId(${JSON.stringify(cfId)});
let removed = 0, kept = 0;
for (let round = 0; cf && round < 6 && Date.now() - t0 < 20000; round++) {
  const used = new Set();
  for (const p of figma.root.children) {
    await p.loadAsync();
    for (const i of p.findAllWithCriteria({ types: ["INSTANCE"] })) { const m = await i.getMainComponentAsync(); if (m) used.add(m.id); }
  }
  const orphans = [];
  for (const m of cf.findAllWithCriteria({ types: ["COMPONENT"] })) if (!used.has(m.id) && !(await m.getInstancesAsync()).length) orphans.push(m);
  kept = cf.findAllWithCriteria({ types: ["COMPONENT"] }).filter((m) => !used.has(m.id)).length - orphans.length;
  if (!orphans.length) break;
  for (const m of orphans) {
    if (m.removed) continue;
    const set = m.parent?.type === "COMPONENT_SET" ? m.parent : null;
    m.remove(); removed++;
    if (set && !set.removed && !set.children.length) set.remove();
  }
}
if (removed && cf) { boardLayout(cf); for (const set of cf.findAllWithCriteria({ types: ["COMPONENT_SET"] })) setLayout(set); boardsRow(cf.parent); }
return { removed, kept, ms: Date.now() - t0 };`);
  if (r.removed || r.kept) log(`unused components: ${r.removed} removed${r.kept ? `, ${r.kept} kept (the two methods disagree)` : ""}, ${r.ms} ms`);
}

return { rootId, cfId, LATE, nodes, pass1Ms, height, images: srcs.length, placed, totalMs: Date.now() - t0 };
}
