// Shared by web-build.mjs and web-check.mjs: which captured boxes become Figma nodes.

// CSS text-transform as painted: Figma gets the text it shows
export const cased = (text, how) =>
  how === "uppercase" ? text.toUpperCase()
  : how === "lowercase" ? text.toLowerCase()
  : how === "capitalize" ? text.replace(/(^|[\s\-–—/(])(\p{L})/gu, (_, a, c) => a + c.toUpperCase())
  : text;

// Drops excluded subtrees (cookie banners…) and everything below the cut, keeps
// boxes that draw something (fill, border, text, svg, image).
export function selectItems(cap, { height = cap.height, exclude = null, drop = [] } = {}) {
  const byId = new Map(cap.boxes.map((b) => [b.id, b]));
  // a text whose element has no box of its own (display: contents): its lines say where it stands
  for (const b of cap.boxes) {
    if (!b.text || b.w >= 1 || b.h >= 1 || !b.lines?.length) continue;
    const x = Math.min(...b.lines.map((l) => l.x)), y = Math.min(...b.lines.map((l) => l.y));
    Object.assign(b, { x, y, w: Math.max(...b.lines.map((l) => l.x + l.w)) - x, h: Math.max(...b.lines.map((l) => l.y + l.h)) - y });
  }
  // a page that keeps a scrollbar gutter (overflow hidden + stable gutter) lays out narrower than its window:
  // its width is the body's, or every full-width block lands off by half the gutter
  const body = cap.boxes.find((b) => b.p === -1);
  const gutter = body ? cap.width - body.w : 0;
  if (gutter >= 1 && gutter <= 20 && cap.boxes.every((b) => !b.w || b.x + b.w <= body.w + 1)) cap.width = body.w;
  // ids picked by hand: overlays with no text to match (canvas, white-on-white animation layers)
  const dropped = new Set(drop);
  // a box shot from the screen holds what its content painted (a lazy image's grey placeholder over it)
  for (const b of cap.boxes) if (byId.get(b.p)?.shot) dropped.add(b.id);
  if (exclude) {
    for (const b of cap.boxes) {
      if (b.text && exclude.test(b.text)) {
        // climb to the outermost pinned (fixed/sticky) overlay-sized ancestor with a background;
        // none → the text is page content (a "cookie settings" link in the footer), kept
        let top = null;
        // never the document root (a white body would take the whole page with it)
        for (let a = byId.get(b.p); a && a.p !== -1; a = byId.get(a.p)) if (a.pin && a.bg && a.h < cap.height / 2) top = a;
        if (top) dropped.add(top.id);
      }
    }
  }
  const isDropped = (b) => {
    for (let a = b; a; a = byId.get(a.p)) if (dropped.has(a.id)) return true;
    return false;
  };
  // the same text twice at the same place (a copy layered for a blend effect): the one painted on top
  const at = (b) => [b.text, b.x, b.y, b.w, b.h].join("|");
  // A transparent copy over a painted one is an animated effect (a shimmer clipped to the text): the
  // page shows the painted text, the effect's box and its content are dropped
  const ghost = (b) => /,\s*0\)$|transparent/.test(b.font?.color || "");
  const painted = new Set(cap.boxes.filter((b) => b.text && !ghost(b)).map(at));
  for (const b of cap.boxes) if (b.text && ghost(b) && painted.has(at(b))) dropped.add(b.id);
  const top = new Map(cap.boxes.filter((b) => b.text && !dropped.has(b.id)).map((b) => [at(b), b.id]));
  // opacity 0 (cumulative): a carousel's parked slide, painted nothing
  // a dotted rule gets a box of its own under the cell: the layout hangs one node per box id, a rule
  // sharing the cell's id would land on the cell's frame and paint all of it
  for (let i = 0; i < cap.boxes.length; i++) {
    const b = cap.boxes[i];
    const rule = b.tile && b.tile < b.w - 1 && !/url\(/.test(b.bgImg || "") && dotRule(b);
    if (rule && !byId.has(b.id + 0.5)) {
      const r = { id: b.id + 0.5, p: b.id, x: b.x, y: rule.y, w: b.w, h: b.tileH, rule };
      byId.set(r.id, r);
      cap.boxes.splice(i + 1, 0, r);
    }
  }
  return cap.boxes
    // a text wholly above or beside the page (a skip link parked off-screen) is never seen: no layer outside the frame
    .filter((b) => !(b.text && (b.y + b.h <= 0 || b.x + b.w <= 0 || b.x >= cap.width)))
    .filter((b) => b.y < height && b.op !== 0 && !isDropped(b) && (!b.text || top.get(at(b)) === b.id))
    .filter((b) => b.rule || b.bg || b.border || b.text || b.svg || b.bdf || b.blank || (b.img && b.img !== "svg") || /url\(|gradient\(/.test(b.bgImg || ""))
    .map((b) => {
      if (b.rule) return { id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, bg: b.rule.bg, dash: b.rule.dash };
      const hair = repeatRule(b);
      if (hair) return { id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, bg: hair.bg, dash: hair.dash, ...(b.op && { op: b.op }) };
      const o = { id: b.id, x: b.x, y: b.y, w: b.w, h: b.h };
      if (b.bg) o.bg = b.bg;
      // a video / canvas that never painted (no shot, no poster) still holds its box: a neutral fill
      // keeps the column it sits in from collapsing
      // not when an image already fills that same box (a hidden end-slate canvas stacked on the video's frame)
      else if (b.blank && !b.img && !cap.boxes.some((k) => k !== b && k.img && k.img !== "svg" && Math.abs(k.x - b.x) < 2 && Math.abs(k.y - b.y) < 2 && Math.abs(k.w - b.w) < 2 && Math.abs(k.h - b.h) < 2)) o.bg = "rgb(235, 235, 235)";
      if (b.border) o.border = b.border;
      if (b.rot) o.rot = b.rot;
      if (b.shadow) o.shadow = b.shadow;
      if (b.r) o.r = b.r;
      if (b.rs) o.rs = b.rs;
      // a gradient repeated at a smaller size (a dotted rule: 8 px tile, hard stop at 10 %) can't tile in Figma;
      // stretched over the box it paints a bar instead of the rule
      const repeated = b.tile && b.tile < b.w - 1 && !/url\(/.test(b.bgImg || "");
      const grad = repeated ? [] : gradients(b.bgImg, b.w, b.h);
      if (grad.length) o.grad = grad;
      // a mask over content is a real Figma mask, laid after the build (web-masks.mjs): the box's own
      // fill must not fade twice
      if (b.bdf || (b.mask && !cap.boxes.some((k) => k.p === b.id))) scrim(o, b);
      if (b.fblur && !o.blur) o.blur = { r: b.fblur, layer: 1 };
      if (b.op) o.op = b.op;
      if (b.blend) o.blend = b.blend;
      if (b.tile) o.tile = b.tile;
      if (b.crop) o.crop = b.crop;
      if (b.fx) o.fx = b.fx;
      if (b.svg) o.svg = b.svg;
      // a url's quotes may be CSS-escaped inside it (an inline svg: xmlns=\"…\")
      const src = b.img && b.img !== "svg" ? b.img : (/url\((?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^)]+))\)/.exec(b.bgImg || "") || []).slice(1).find(Boolean)?.replace(/\\(["'\\])/g, "$1");
      const tiled = src && !b.img && b.tile ? tileSvg(src, b) : null;
      if (tiled) { o.svg = tiled; delete o.tile; }
      else if (src) o.src = src;
      if (b.text) {
        o.text = cased(b.text, b.font.transform);
        // gradient through the glyphs (background-clip: text) → gradient text fill
        o.font = b.font.fill ? { ...b.font, grad: gradients(b.font.fill, b.w, b.h) } : b.font;
        const up = (t) => cased(t, b.font.transform);
        // runs of different sizes on one row come back as one rect each: one line
        if (b.lines) o.lines = b.lines.map((l) => ({ ...l, t: up(l.t) })).reduce((acc, l) => {
          const p = acc[acc.length - 1];
          if (!p || Math.min(l.y + l.h, p.y + p.h) - Math.max(l.y, p.y) < Math.min(l.h, p.h) / 2) return [...acc, l];
          const [x, y] = [Math.min(p.x, l.x), Math.min(p.y, l.y)];
          // the space put back between them keeps its width on screen (a badge set off by a margin)
          const g = l.x - (p.x + p.w);
          acc[acc.length - 1] = { t: p.t + (g > 1 ? " " : "") + l.t, x, y, w: Math.max(p.x + p.w, l.x + l.w) - x, h: Math.max(p.y + p.h, l.y + l.h) - y, gaps: [...(p.gaps || []), ...(g > 1 ? [[p.t.length, Math.round(g)]] : []), ...(l.gaps || []).map(([o, w, sp]) => [o + p.t.length + (g > 1 ? 1 : 0), w, sp])], ...(l.hy && { hy: 1 }) };
          return acc;
        }, []);
        // inline pieces of one paragraph (links, sup, spans): styled runs
        if (b.runs) o.runs = b.runs.map((r) => ({ text: cased(r.text, r.font.transform), font: r.font.fill ? { ...r.font, grad: gradients(r.font.fill, b.w, b.h) } : r.font }));
        if (o.runs) o.text = o.runs.map((r) => r.text).join("");
        if (b.tw) [o.tx, o.tw] = [b.tx, b.tw];
        // a box holding text boxes besides its own text (flex, or an inline link and its nowrap span): that text is an anonymous item
        if ((b.flex || b.tag === "a") && cap.boxes.some((k) => k.p === b.id && k.text)) o.anon = 1;
        if (b.trunc) o.trunc = b.trunc;
        // an input's value or placeholder: drawn inside its field, no line boxes measured
        if (b.tag === "input" && !b.lines) o.inField = 1;
        // an inline box taller than the block holding only it (a 24 px link in a 12 px heading, centred on it):
        // the block's box is the text's, its line overflows (Figma's leading trim does the same)
        const par = byId.get(b.p);
        if (par && !par.text && par.h + 4 <= b.h && b.lines?.length === 1 && Math.abs(b.y + b.h / 2 - (par.y + par.h / 2)) <= 1 && b.x >= par.x - 1 && cap.boxes.filter((k) => k.p === par.id).length === 1) [o.y, o.h] = [par.y, par.h];
      }
      return o;
    });
}

// An svg data-URI repeated as a background (a ruler: 9 px tile, two hairlines): Figma can't read an svg as an
// image fill, so the tiles are written out as one svg of the box's size. Null when the tile fills the box,
// or the svg isn't a plain viewBox + shapes.
function tileSvg(src, b) {
  if (!/^data:image\/svg\+xml/.test(src)) return null;
  let t;
  try { t = decodeURIComponent(src.slice(src.indexOf(",") + 1)); } catch { return null; }
  const m = /<svg\b[^>]*viewBox=['"]\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s*['"][^>]*>([\s\S]*)<\/svg>/i.exec(t);
  if (!m || !+m[1] || !+m[2]) return null;
  const [vw, vh, inner] = [+m[1], +m[2], m[3]];
  const tw = b.tile, th = b.tileH || (tw * vh) / vw;
  if (!(tw > 0) || !(th > 0) || (tw >= b.w - 1 && th >= b.h - 1)) return null;
  const at = (v, free) => { const q = /^(-?[\d.]+)(%|px)$/.exec(v || "0px"); return q ? (q[2] === "%" ? (free * q[1]) / 100 : +q[1]) : 0; };
  const x0 = at(b.tileX, b.w - tw), y0 = at(b.tileY, b.h - th);
  const bx = x0 - Math.ceil(x0 / tw) * tw, by = tw >= b.w - 1 ? y0 : y0 - Math.ceil(y0 / th) * th;
  const nx = tw >= b.w - 1 ? 1 : Math.ceil((b.w - bx) / tw), ny = th >= b.h - 1 ? 1 : Math.ceil((b.h - by) / th);
  if (nx * ny > 2000) return null;
  const r = (v) => Math.round(v * 1e3) / 1e3;
  let g = "";
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) g += `<g transform="translate(${r((tw >= b.w - 1 ? x0 : bx) + i * tw)} ${r(by + j * th)}) scale(${r(tw / vw)} ${r(th / vh)})">${inner}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${r(b.w)}" height="${r(b.h)}" viewBox="0 0 ${r(b.w)} ${r(b.h)}">${g}</svg>`;
}

// A rule drawn by a horizontally repeated gradient (dotted line: 8 px tile, hard stop at 10 %, a
// few px high at the bottom of the box, tiles centred). Figma can't tile a gradient: the tiles are
// unrolled into one strip of stops across the box width.
function dotRule(b) {
  if (!b.tileH || !/^linear-gradient\(\s*to right/.test(b.bgImg)) return null;
  const at = /^(100%|bottom)$/.test(b.tileY) ? b.y + b.h - b.tileH : /^(0%|0px|top)$/.test(b.tileY) ? b.y : null;
  const tile = gradients(b.bgImg, b.tile, b.tileH)[0];
  // where the first tile starts: a % of the free space, or px
  const px = /^([\d.]+)(%|px)$/.exec(b.tileX || "0px");
  const o = px ? (px[2] === "%" ? (b.w - b.tile) * px[1] / 100 : +px[1]) : null;
  if (at == null || !tile || o == null) return null;
  // a dot then a gap (hard stops): the dot's color and the share of the tile it fills; a Figma dashed line draws it,
  // a gradient of one hard stop per dot loses its dots to the gradient's own sampling
  const c = tile.stops[0].c, cut = tile.stops.find((s) => s.c !== c);
  if (!cut || /rgba?\([^)]*,\s*0\)$|transparent/.test(c)) return null;
  const on = Math.round(cut.at * b.tile * 100) / 100, base = o - Math.ceil(o / b.tile) * b.tile;
  return { y: at, bg: c, dash: { on, off: Math.round((b.tile - on) * 100) / 100, x0: Math.round((base < 0 ? base + b.tile : base) * 100) / 100 } };
}

// A hairline painted by a repeating gradient along its length (chart grid lines: 2 px on, 4 px off):
// no Figma equivalent for the gradient, a dashed line draws it. Null for anything else.
function repeatRule(b) {
  const m = /^repeating-linear-gradient\((.*)\)$/s.exec((b.bgImg || "").trim());
  const across = b.w <= 2 ? "v" : b.h <= 2 ? "h" : null;
  if (!m || !across) return null;
  const dir = /^\s*(to right|90deg|to left|270deg)/.test(m[1]) ? "h" : /^\s*(to [a-z]+|-?[\d.]+deg)/.test(m[1]) && !/^\s*(to (bottom|top)|0deg|180deg)/.test(m[1]) ? null : "v";
  if (dir !== across) return null;
  const stops = [...m[1].matchAll(/(rgba?\([^)]*\)|#[0-9a-f]+|transparent)\s+([\d.]+)px/gi)].map((s) => ({ c: s[1], at: +s[2] }));
  const c = stops[0]?.c, cut = stops.find((s) => s.c !== c);
  if (!cut || alphaOf(c) === 0 || stops.at(-1).at <= cut.at) return null;
  return { bg: c, dash: { on: cut.at, off: stops.at(-1).at - cut.at, x0: 0, ...(dir === "v" && { v: 1 }) } };
}

const alphaOf = (c) => (c === "transparent" ? 0 : /^rgba|^hsla|\/ /.test(c) ? +(/([\d.]+)\s*\)$/.exec(c) || [, 1])[1] : 1);

// backdrop-filter (blur, brightness) and a gradient mask-image → what Figma can show:
// brightness < 1 / > 1 = a black / white veil, the blur = a background blur; a linear mask
// fades the veil (gradient fill whose alpha follows the mask) and the blur (progressive blur).
// A mask over a plain background turns that background into the same fading gradient.
function scrim(o, b) {
  const mask = gradients(b.mask, b.w, b.h).filter((g) => g.type === "GRADIENT_LINEAR").at(-1);
  const fade = (rgb, k) => (mask ? [{ ...mask, stops: mask.stops.map((s) => ({ c: `rgba(${rgb}, ${Math.round(k * alphaOf(s.c) * 1000) / 1000})`, at: s.at })) }] : null);
  if (b.bdf) {
    const blur = /blur\(([\d.]+)px\)/.exec(b.bdf);
    const br = /brightness\(([\d.]+)(%?)\)/.exec(b.bdf);
    const v = br ? parseFloat(br[1]) / (br[2] ? 100 : 1) : 1;
    if (v !== 1) {
      const [rgb, k] = v < 1 ? ["0, 0, 0", 1 - v] : ["255, 255, 255", Math.min(1, v - 1)];
      if (mask) o.grad = [...(o.grad || []), ...fade(rgb, k)];
      else if (!o.bg) o.bg = `rgba(${rgb}, ${k})`;
    }
    if (blur && +blur[1]) {
      o.blur = { r: +blur[1] };
      if (mask) {
        // blur ramps from 0 where the mask is last fully clear to full where it is first opaque
        const a = mask.stops.map((s) => alphaOf(s.c));
        const s0 = mask.stops[Math.max(0, a.findLastIndex((x, i) => x === 0 && a.slice(0, i + 1).every((y) => y === 0)))].at;
        const i1 = a.findIndex((x) => x >= 0.99);
        const s1 = i1 < 0 ? 1 : mask.stops[i1].at;
        const [[x0, y0], [x1, y1]] = mask.p;
        const r = (v) => Math.round(v * 1e3) / 1e3;
        o.blur.from = { x: r(x0 + (x1 - x0) * s0), y: r(y0 + (y1 - y0) * s0) };
        o.blur.to = { x: r(x0 + (x1 - x0) * s1), y: r(y0 + (y1 - y0) * s1) };
      }
    }
  } else if (mask && o.bg) {
    const m = /rgba?\(([^,]+),\s*([^,]+),\s*([^,)]+)/.exec(o.bg);
    if (m) {
      o.grad = [...fade(m.slice(1).join(", "), alphaOf(o.bg)), ...(o.grad || [])];
      delete o.bg;
    }
  }
}

// A radial gradient with an explicit size and centre ("200px 200px at 100% 0%"), in box px; null for
// a keyword size (farthest-corner...), kept as the centred ellipse.
function radialBox(arg, w, h) {
  const m = /^(?:circle\s+|ellipse\s+)?([\d.]+)px(?:\s+([\d.]+)px)?(?:\s+at\s+(\S+)\s+(\S+))?$/.exec(arg.trim());
  if (!m || !+m[1]) return null;
  const pos = (v, size) => (v == null ? size / 2 : v.endsWith("%") ? (parseFloat(v) / 100) * size : parseFloat(v));
  const cx = pos(m[3], w), cy = pos(m[4], h);
  return Number.isFinite(cx) && Number.isFinite(cy) ? { rx: +m[1], ry: +(m[2] || m[1]), cx, cy } : null;
}

// CSS gradient layers → Figma gradient paints, bottom layer first (Figma paints the last on top).
// linear: any angle / side keyword, stops in % or px (missing ones spread evenly);
// radial: centred ellipse; repeating gradients have no Figma equivalent and are skipped.
// Each paint: { type, stops: [{ c: css color, at: 0..1 }], t: gradientTransform }.
// Gradient stops interpolated in a CSS color space (in oklab, in oklch longer hue, in hsl, in
// srgb-linear) for Figma, which blends in sRGB: each segment gets intermediate stops computed in
// that space (premultiplied alpha, hue arcs per CSS Color 4), so the sRGB blend between two close
// stops stays on the browser's curve. Spaces not handled (lab, lch, xyz…) keep the sRGB blend.
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.sign(c) * Math.abs(c) ** (1 / 2.4) - 0.055);
const toOklab = ([r, g, b]) => {
  const [lr, lg, lb] = [r, g, b].map(srgbToLin);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const fromOklab = ([L, a, b]) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(linToSrgb);
};
const toHsl = ([r, g, b]) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [NaN, 0, l];
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, d / (1 - Math.abs(2 * l - 1)), l];
};
const fromHsl = ([h, s, l]) => {
  h = ((h % 360) + 360) % 360; // a hue arc through 0° comes negative
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
};
// [to, from, index of the hue channel or -1]; hue NaN = powerless (grey), taken from the other end
const SPACES = {
  "srgb-linear": [(c) => c.map(srgbToLin), (c) => c.map(linToSrgb), -1],
  oklab: [toOklab, fromOklab, -1],
  oklch: [(c) => { const [L, a, b] = toOklab(c), C = Math.hypot(a, b); return [L, C, C < 2e-4 ? NaN : (Math.atan2(b, a) * 180 / Math.PI + 360) % 360]; },
    ([L, C, H]) => fromOklab([L, C * Math.cos(H * Math.PI / 180), C * Math.sin(H * Math.PI / 180)]), 2],
  hsl: [toHsl, fromHsl, 0],
};
const rgbaOf = (c) => {
  const m = /rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(c);
  return m ? [m[1] / 255, m[2] / 255, m[3] / 255, m[4] === undefined ? 1 : +m[4]] : null;
};
function resample(stops, { name, hue }) {
  const sp = SPACES[name];
  if (!sp) return;
  const [to, from, hi] = sp;
  const out = [stops[0]];
  for (let i = 1; i < stops.length; i++) {
    const A = stops[i - 1], B = stops[i], ca = rgbaOf(A.c), cb = rgbaOf(B.c);
    if (!ca || !cb || B.at <= A.at) { out.push(B); continue; }
    const pa = to(ca.slice(0, 3)), pb = to(cb.slice(0, 3));
    let span = 0;
    if (hi >= 0) {
      if (Number.isNaN(pa[hi])) pa[hi] = Number.isNaN(pb[hi]) ? 0 : pb[hi];
      if (Number.isNaN(pb[hi])) pb[hi] = pa[hi];
      let d = pb[hi] - pa[hi];
      if (hue === "shorter") d = d > 180 ? d - 360 : d < -180 ? d + 360 : d;
      else if (hue === "longer") d = d > 0 && d < 180 ? d - 360 : d > -180 && d <= 0 ? d + 360 : d;
      else if (hue === "increasing") d = d < 0 ? d + 360 : d;
      else d = d > 0 ? d - 360 : d;
      pb[hi] = pa[hi] + d;
      span = Math.abs(d);
    }
    // an sRGB blend is already exact between equal colors (an alpha fade)
    const same = ca.slice(0, 3).every((v, k) => Math.abs(v - cb[k]) < 1e-3) && !span;
    const n = same ? 1 : Math.max(8, Math.ceil(span / 20));
    for (let k = 1; k < n; k++) {
      const f = k / n, al = ca[3] + (cb[3] - ca[3]) * f;
      // premultiplied: every channel but the hue weighted by its alpha
      const mix = pa.map((v, j) => (j === hi ? v + (pb[j] - v) * f : al ? (v * ca[3] + (pb[j] * cb[3] - v * ca[3]) * f) / al : v + (pb[j] - v) * f));
      const rgb = from(mix).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
      const at = Math.round((A.at + (B.at - A.at) * f) * 1000) / 1000;
      out.push({ c: al < 1 ? `rgba(${rgb.join(", ")}, ${Math.round(al * 1000) / 1000})` : `rgb(${rgb.join(", ")})`, at });
    }
    out.push(B);
  }
  stops.splice(0, stops.length, ...out);
}

export function gradients(css, w, h) {
  // an empty box paints nothing (and a zero side makes the transform NaN, refused by Figma)
  if (!css || !/gradient\(/.test(css) || !(w > 0 && h > 0)) return [];
  const top = (str) => {
    const out = [];
    let depth = 0, cur = "";
    for (const ch of str) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && !depth) { out.push(cur.trim()); cur = ""; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  // space-separated at the top level: color function and calc() stay whole
  const words = (str) => {
    const out = [];
    let depth = 0, cur = "";
    for (const ch of str) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (/\s/.test(ch) && !depth) { if (cur) out.push(cur); cur = ""; } else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  };
  const sides = { top: 0, right: 90, bottom: 180, left: 270 };
  const out = [];
  for (const layer of top(css)) {
    const m = /^(linear|radial)-gradient\((.*)\)$/s.exec(layer);
    if (!m) continue;
    const args = top(m[2]);
    // color interpolation space (in oklab, in hsl longer hue): Figma interpolates in sRGB only,
    // the stops are resampled in that space further down
    let space = null;
    if (args.length) {
      const sm = /(^|\s)in\s+([a-z0-9-]+)(?:\s+(shorter|longer|increasing|decreasing)\s+hue)?/i.exec(args[0]);
      if (sm) space = { name: sm[2].toLowerCase(), hue: (sm[3] || "shorter").toLowerCase() };
      args[0] = args[0].replace(/(^|\s)in\s+[a-z0-9-]+(\s+(shorter|longer|increasing|decreasing)\s+hue)?/i, " ").trim();
      if (!args[0]) args.shift();
    }
    let deg = 180, sized = null;
    if (m[1] === "linear") {
      const a = args[0];
      if (/^-?[\d.]+(deg|turn|rad)$/.test(a)) {
        deg = parseFloat(a) * (a.endsWith("turn") ? 360 : a.endsWith("rad") ? 180 / Math.PI : 1);
        args.shift();
      } else if (a.startsWith("to ")) {
        const k = a.slice(3).split(/\s+/);
        // corners: the diagonal of the box
        deg = k.length === 1 ? sides[k[0]] : (() => {
          const v = Math.atan2(w, h) * 180 / Math.PI;
          const tb = k.includes("top") ? "t" : "b", lr = k.includes("right") ? "r" : "l";
          return { tr: v, br: 180 - v, bl: 180 + v, tl: 360 - v }[tb + lr];
        })();
        args.shift();
      }
    } else if (!/^(rgb|hsl|#|[a-z]+$)/.test(args[0]) || /\bat\b|circle|ellipse/.test(args[0])) sized = radialBox(args.shift(), w, h);
    const rad = deg * Math.PI / 180, dx = Math.sin(rad), dy = -Math.cos(rad);
    // the CSS gradient line spans the box's projection on the angle
    const len = m[1] === "linear" ? Math.abs(w * dx) + Math.abs(h * dy) : sized ? sized.rx : Math.max(w, h) / 2;
    const stops = [];
    for (const a of args) {
      const [color, ...rest] = words(a);
      // % of the line, px over its length, calc() of both
      const at = (v) => {
        const c = /^calc\((.*)\)$/.exec(v);
        if (!c) return v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v) / len;
        let sum = 0;
        for (const [, sign, n, u] of c[1].matchAll(/([+-]?)\s*([\d.]+)(%|px)?/g)) sum += (sign === "-" ? -1 : 1) * (u === "%" ? n / 100 : n / len);
        return sum;
      };
      // a stop with two positions is two stops of the same color
      if (!rest.length) stops.push({ c: color, at: null });
      for (const v of rest) stops.push({ c: color, at: at(v) });
    }
    if (stops.length < 2) continue;
    if (stops[0].at == null) stops[0].at = 0;
    if (stops.at(-1).at == null) stops.at(-1).at = 1;
    for (let i = 1; i < stops.length; i++) {
      if (stops[i].at != null) { stops[i].at = Math.max(stops[i].at, stops[i - 1].at); continue; }
      let j = i;
      while (stops[j].at == null) j++;
      for (let k = i; k < j; k++) stops[k].at = stops[i - 1].at + (stops[j].at - stops[i - 1].at) * (k - i + 1) / (j - i + 1);
    }
    stops.forEach((s) => (s.at = Math.min(1, Math.max(0, Math.round(s.at * 1000) / 1000))));
    // a transparent stop takes its neighbours' color (the browser blends premultiplied, Figma
    // does not: white → rgba(0,0,0,0) goes grey half-way), split when they differ
    const rgb = (c) => (/rgba?\(([^,]+),\s*([^,]+),\s*([^,)]+)/.exec(c) || []).slice(1).join(", ");
    const clear = (s) => s.c === "transparent" || (/rgba\(/.test(s.c) && alphaOf(s.c) === 0);
    for (let i = stops.length - 1; i >= 0; i--) {
      if (!clear(stops[i])) continue;
      const pv = stops.slice(0, i).reverse().find((s) => !clear(s)), nx = stops.slice(i + 1).find((s) => !clear(s));
      const cs = [...new Set([pv, nx].filter(Boolean).map((s) => rgb(s.c)).filter(Boolean))];
      if (cs.length) stops.splice(i, 1, ...cs.map((c) => ({ c: `rgba(${c}, 0)`, at: stops[i].at })));
    }
    if (space) resample(stops, space);
    let t, p;
    if (m[1] === "linear") {
      // gradient space (0,.5)→(1,.5) mapped onto start→end in the box's normalised space, inverted
      const sx = 0.5 - (dx * len) / 2 / w, sy = 0.5 - (dy * len) / 2 / h;
      const ax = (dx * len) / w, ay = (dy * len) / h, px = -ay, py = ax;
      const det = ax * py - px * ay;
      const ox = sx - 0.5 * px, oy = sy - 0.5 * py;
      const r = (v) => Math.round(v * 1e4) / 1e4;
      t = [[r(py / det), r(-px / det), r((px * oy - py * ox) / det)], [r(-ay / det), r(ax / det), r((ay * ox - ax * oy) / det)]];
      // the line's ends in the box's normalised space
      p = [[r(sx), r(sy)], [r(sx + ax), r(sy + ay)]];
    } else if (sized) {
      // gradient space centre (.5, .5), radius .5: box coordinates → (d / 2r) + .5
      const r = (v) => Math.round(v * 1e4) / 1e4;
      t = [[r(w / (2 * sized.rx)), 0, r(0.5 - sized.cx / (2 * sized.rx))], [0, r(h / (2 * sized.ry)), r(0.5 - sized.cy / (2 * sized.ry))]];
    } else t = [[1, 0, 0], [0, 1, 0]];
    // what Figma accepts and nothing else: rgb()/rgba() stops (transparent named; color hints and
    // anything unread dropped), at least two, finite positions and transform
    const ok = stops.map((x) => ({ ...x, c: x.c === "transparent" ? "rgba(0, 0, 0, 0)" : x.c })).filter((x) => /^rgba?\(/.test(x.c) && Number.isFinite(x.at));
    const fin = (a) => a.flat().every(Number.isFinite);
    if (ok.length < 2 || !fin(t) || (p && !fin(p))) continue;
    out.push({ type: m[1] === "linear" ? "GRADIENT_LINEAR" : "GRADIENT_RADIAL", stops: ok, t, ...(p && { p }) });
  }
  return out.reverse();
}
