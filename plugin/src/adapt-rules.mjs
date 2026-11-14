// Nearest token of a file's design system for a foreign value (a color, a text). Pure JS, no Figma API:
// read by the plugin (H.adapt) and by tools/adapt-check.mjs.
//
// Color token: { id?, kind: "variable"|"style"|"raw", name, r, g, b, opacity } (channels 0..1)
// Text token: { id?, name, family, style, size }

const linear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

// OKLab: distances read as a person sees them, unlike RGB (dark blues, greys).
export const oklab = ({ r, g, b }) => {
  const R = linear(r), G = linear(g), B = linear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};

export const colorDistance = (a, b) => {
  const x = oklab(a), y = oklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

export const chroma = (c) => {
  const [, a, b] = oklab(c);
  return Math.hypot(a, b);
};

// WCAG contrast ratio, 1 to 21.
export const contrast = (a, b) => {
  const lum = ({ r, g, b: bl }) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(bl);
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const RANK = { variable: 0, style: 1, raw: 2 };
const NEUTRAL_MAX = 0.03; // OKLab chroma a person still reads as grey
const LEGIBLE = 3; // WCAG ratio for large text and graphics

// The closest color; on a tie a variable wins over a style, a style over a value merely in use.
// `ctx` = { was, on }: the background it stood on, and what that background became. What could be read on its
// background stays readable, even when a closer token would melt into it. A grey stays a neutral while one is left:
// close in lightness to an accent, it would still not be that accent.
export const nearestColor = (c, palette, ctx) => {
  const guard = ctx && contrast(c, ctx.was) >= LEGIBLE;
  const legible = guard ? palette.filter((t) => contrast(t, ctx.on) >= LEGIBLE) : palette;
  let pool = legible.length ? legible : palette;
  if (chroma(c) <= NEUTRAL_MAX) {
    const neutrals = pool.filter((t) => chroma(t) <= NEUTRAL_MAX);
    if (neutrals.length) pool = neutrals;
  }
  let best = null, dist = Infinity;
  for (const t of pool) {
    const d = colorDistance(c, t);
    if (d < dist - 1e-6 || (Math.abs(d - dist) <= 1e-6 && RANK[t.kind] < RANK[best.kind])) { best = t; dist = d; }
  }
  return best && { token: best, dist };
};

const WEIGHTS = [[/thin|hairline/i, 100], [/extra\s*-?light|ultra\s*-?light/i, 200], [/light/i, 300], [/medium/i, 500], [/semi\s*-?bold|demi/i, 600], [/extra\s*-?bold|ultra\s*-?bold/i, 800], [/bold/i, 700], [/black|heavy/i, 900]];

export const weightOf = (style) => {
  for (const [re, w] of WEIGHTS) if (re.test(style)) return w;
  return 400;
};
export const isItalic = (style) => /italic|oblique/i.test(style);

// Size leads, as a ratio: 14 → 16 is as far as 28 → 32. A weight apart costs less than a step of the scale.
const SIZE_COST = 4, WEIGHT_COST = 1 / 900, SLANT_COST = 0.3, FAMILY_COST = 0.05;

export const textDistance = (a, b) =>
  Math.abs(Math.log(a.size / b.size)) * SIZE_COST
  + Math.abs(weightOf(a.style) - weightOf(b.style)) * WEIGHT_COST
  + (isItalic(a.style) !== isItalic(b.style) ? SLANT_COST : 0)
  + (a.family !== b.family ? FAMILY_COST : 0);

// Beyond this a style is another text, not a step of the same scale (56 px bold headline vs a 40 px largest style):
// the run keeps its own font and size, reported for the eye to judge.
export const FAR_TEXT = 1;

export const nearestText = (t, list) => {
  let best = null, dist = Infinity;
  for (const s of list) {
    const d = textDistance(t, s);
    if (d < dist) { best = s; dist = d; }
  }
  return best && { token: best, dist, far: dist > FAR_TEXT };
};

// The grid whose frame is closest in width to the frame receiving it.
export const nearestGrid = (width, grids) => {
  let best = null, dist = Infinity;
  for (const g of grids) {
    const d = Math.abs((g.width ?? width) - width);
    if (d < dist) { best = g; dist = d; }
  }
  return best;
};
