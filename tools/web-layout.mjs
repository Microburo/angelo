// Components mode of web-build.mjs: a capture becomes an auto layout tree where every UI block
// is a component instance. The DOM gives the tree (boxes that draw and their ancestors, empty
// wrappers collapsed); the geometry gives the layout, by XY-cut: children that stack without
// overlapping go VERTICAL, side by side HORIZONTAL, a mix is split into nested rows/columns.
// Padding = gap between a box and its children; vertical rhythm: page and sections = the previous
// child's padding-bottom (itemSpacing 0, a filled child carries it on a "-wrap"), sub-sections =
// their gap, padding-bottom only on a child that needs more; what overlaps and can't be merged
// stays absolute. Blocks are matched without their colors and widths (three
// tinted cards = one component, colors become instance overrides).

import { nameOcc, shapeName, mostCommon, words, qualify, SIZES, frameName, placeOf, iconFromSvg, iconFromHint, iconFromText, iconFromShape, iconFromPath, iconShape } from "./web-components.mjs";
import { loadGrammar, recognize, slotNames } from "./web-grammar.mjs";

const KIT = loadGrammar();

const T = 1.5; // px tolerance (sub-pixel rounding of the capture)
const MAX_REPEAT = 60; // a repeated one up to this many
const ATOM_H = 64; // a painted block up to this height and this many leaves, met twice, is an atom
const ATOM_LEAVES = 4;

const hash = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};
const r1 = (v) => Math.round(v * 10) / 10;
const union = (ns) => {
  let x = Infinity, y = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of ns) { x = Math.min(x, n.x); y = Math.min(y, n.y); x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h); }
  return { x, y, w: x1 - x, h: y1 - y };
};
const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

// inline pieces with no space between them but apart on screen (a bold kicker set off by a
// margin): the browser's lines hold the space, the runs get it back; the reverse too (two React
// text nodes "+" "22" joined with a space the browser does not show)
const lineSpaces = (s) => {
  if (!s.lines?.length) return s;
  // case aside: a text-transform is applied to the runs, not to the browser's lines
  const L = s.lines.map((l) => l.t.trim()).join(" ").replace(/\s+/g, " ").toLowerCase();
  // width on screen of the spaces in L between two pieces of one row (merged by selectItems)
  const gapAt = new Map();
  for (let k = 0, q = 0; k < s.lines.length; q += s.lines[k].t.trim().replace(/\s+/g, " ").length + 1, k++)
    for (const [o, g, sp] of s.lines[k].gaps || []) gapAt.set(q + s.lines[k].t.slice(0, o).trimStart().replace(/\s+/g, " ").length, { g, sp });
  const src = s.runs || [{ text: s.text, font: s.font }];
  const R = src.map((r) => r.text).join("").toLowerCase();
  const at = new Map(), drop = new Set(), wide = new Map();
  let j = 0;
  for (let i = 0; i < R.length; i++, j++) {
    // a space already there takes the gap in place
    if (/\s/.test(R[i]) && L[j] === " " && gapAt.has(j)) { wide.set(i, gapAt.get(j)); continue; }
    if (R[i] === L[j] || (/\s/.test(R[i]) && L[j] === " ")) continue;
    // a blank line (two hard breaks) is one space between the browser's lines: the second is kept
    if (R[i] === "\n" && R[i - 1] === "\n") { j--; continue; }
    if (/\s/.test(R[i])) { drop.add(i); j--; continue; }
    if (L[j] !== " ") return s;
    // two pieces on one row set apart (a badge after its label): the space takes the measured gap
    at.set(i, gapAt.get(j) ?? null);
    j++;
    if (R[i] !== L[j]) return s;
  }
  if ((!at.size && !drop.size && !wide.size) || j !== L.length) return s;
  let p = 0;
  const runs = [];
  for (const r of src) {
    let t = "";
    for (const c0 of r.text) {
      const q = p++;
      if (drop.has(q)) continue;
      // a space put back before c0, or c0 itself a space that takes a gap
      const sp = at.has(q) || wide.has(q), gap = at.get(q) ?? wide.get(q);
      const c = wide.has(q) ? "" : c0;
      // a space wider than the font's (measured by the capture, ~0.28 em without it): its own run
      // in the font before it, the rest as letter spacing
      const f = (t ? r : runs[runs.length - 1] || r).font || s.font;
      const extra = gap == null ? 0 : gap.g - (gap.sp ?? Math.round(f.size * 0.28));
      if (sp && extra > 2) { if (t) runs.push({ ...r, text: t }); runs.push({ text: " ", font: { ...f, ls: extra } }); t = c; continue; }
      t += (sp ? " " : "") + c;
    }
    if (t) runs.push({ ...r, text: t });
  }
  const text = runs.map((r) => r.text).join("");
  return s.runs || runs.length > 1 ? { ...s, runs, text } : { ...s, text };
};

// words the browser hyphenated at a line end (line marked `hy`): Figma has no automatic
// hyphenation, the hyphen and the break are written in ("ins-⏎piration"), so the lines after
// it wrap where the browser's did
// (CJK breaks between any two characters without a hyphen: older captures mark them `hy`)
const CJK = /[⺀-鿿가-힯豈-﫿＀-￯]$/;
const hyphenate = (s0) => {
  const s = s0.lines?.some((l) => l.hy && CJK.test(l.t.trimEnd())) ? { ...s0, lines: s0.lines.map((l) => (l.hy && CJK.test(l.t.trimEnd()) ? { ...l, hy: undefined } : l)) } : s0;
  if (!s.lines?.some((l) => l.hy)) return s;
  const cut = new Set();
  let n = 0;
  for (const l of s.lines) {
    n += l.t.replace(/\s+/g, "").length;
    if (l.hy) cut.add(n);
  }
  const lines = s.lines.map((l) => (l.hy ? { ...l, t: l.t.trimEnd() + "-" } : l));
  let k = 0;
  const put = (t) => [...t].map((c) => (/\s/.test(c) ? c : (k++, cut.has(k) ? c + "- " : c))).join("");
  if (s.runs) {
    const runs = s.runs.map((r) => ({ ...r, text: put(r.text) }));
    return { ...s, lines, runs, text: runs.map((r) => r.text).join("") };
  }
  return { ...s, lines, text: put(s.text) };
};

// text rect: where the glyphs are (first line top to last line bottom, widest line)
const textNode = (s0) => {
  let s = lineSpaces(hyphenate(s0));
  // lines set further apart than the text's own line height (an inline span in a taller block: the
  // block's strut): an even measured pitch is the line height Figma needs
  const ps = (s.lines || []).slice(1).map((l, i) => l.y - s.lines[i].y);
  if (ps.length && s.font.lh && Math.max(...ps) - Math.min(...ps) < 0.6 && ps[0] > s.font.lh + 1) {
    const lh = Math.round(ps.reduce((a, b) => a + b, 0) / ps.length * 10) / 10;
    s = { ...s, font: { ...s.font, lh }, runs: s.runs?.map((r) => (r.font?.lh && r.font.lh < lh ? { ...r, font: { ...r.font, lh } } : r)) };
  }
  // a text on its side: one line, turned in Figma, sized by its glyphs (its box is the turned one)
  if (s.font.rot) return { k: "text", id: s.id, x: s.x, y: s.y, w: s.w, h: s.h, n: 1, br: false, trim: false, align: "LEFT", lx: s.x, indent: 0, rot: s.font.rot, runs: s.runs || [{ text: s.text, font: s.font }], op: s.op, blend: s.blend };
  const l0 = s.lines?.[0];
  // a blank line (two hard breaks) has no word, so no line of its own: it still takes a line height
  const blank = ((s.runs || [{ text: s.text }]).map((r) => r.text).join("").match(/\n(?=\n)/g) || []).length;
  const n = (s.lines?.length ?? 1) + blank;
  // runs with their own line height (a bigger "+"): Figma draws the line at the tallest one
  // (a single line takes a whole pixel: Figma's hug would round a fractional one up)
  const raw = s.font.lh || (n === 1 && Math.max(0, ...(s.runs || []).map((r) => r.font?.lh || 0))) || null;
  const lh = raw && n === 1 ? Math.round(raw) : raw;
  // a box shorter than its line boxes: CSS text-box-trim (cap height to baseline), Figma's leading trim
  // (shorter than its own lines too: an inline span's box is its content area, never its line height)
  const trim = !!(s.font.lh && l0 && s.h < n * s.font.lh - 4 && s.h < s.lines.at(-1).y + s.lines.at(-1).h - l0.y - 4);
  const y = trim ? s.y : l0 ? l0.y + l0.h / 2 - (lh || l0.h) / 2 : s.y;
  const h = trim ? s.h : lh ? n * lh : s.lines ? s.lines.at(-1).y + s.lines.at(-1).h - l0.y : s.h;
  const align = /center/.test(s.font.align) ? "CENTER" : /right|end/.test(s.font.align) ? "RIGHT" : "LEFT";
  // a short wrapped text (2-3 lines) keeps auto width: the browser's line breaks become soft breaks;
  // a hyphenated one too, whatever its length (its breaks are already written in)
  const br = n > 1 && (n <= 3 || s.lines.some((l) => l.hy)) && s.lines.map((l) => l.t).join(" ").replace(/\s+/g, " ").trim() === s.text.replace(/\s+/g, " ").trim();
  // a centred / right-aligned text that hugs its lines: its box is theirs, not its block's
  // (left at the block side, it would sit there once its width shrinks to the widest line)
  // so does a flex container's own text: an anonymous flex item, its box is the container's (a "/" between
  // two spans would overlap the first and merge with it, a space instead of the flex gap)
  const own = (n === 1 || br) && (align !== "LEFT" || s.anon) && s.lines?.length;
  // a one-line inline piece starting mid-line (a nowrap span after its link's text) starts at its line, not at its block's side
  const mid = n === 1 && l0 && l0.x > (s.tx ?? s.x) + 1;
  const x = own || mid ? Math.min(...s.lines.map((l) => l.x)) : s.tx ?? s.x;
  // (a wrapped centred / right-aligned one keeps its block's width: cut at its widest line's right
  // end, its lines would centre a few px left of where the browser put them)
  const w = !own && align !== "LEFT" && s.lines?.length ? s.tw ?? s.w : Math.min(own ? Infinity : s.tw ?? s.w, Math.max(...(s.lines || [{ x, w: s.w }]).map((l) => l.x + l.w)) - x);
  const text = br ? s.lines.map((l) => l.t.trim()).join("\u2028") : s.text;
  // styled runs (inline pieces of a paragraph): the browser's breaks replace the spaces they fell on
  let runs = [{ text, font: s.font }];
  if (s.runs) {
    const at = new Set();
    if (br) for (let i = 0, p = 0; i < s.lines.length - 1; i++) at.add((p += s.lines[i].t.trim().length + (i ? 1 : 0)));
    let p = 0;
    // the block's line height is a floor for every line (CSS strut): a run set smaller (a label and its
    // badge in a list item) still sits on a line that tall, Figma only takes the tallest range
    const strut = !trim && s.font.lh;
    runs = s.runs.map((r) => ({ ...r, text: [...r.text].map((c) => (at.has(p++) && c === " " ? "\u2028" : c)).join(""), ...(strut && r.font?.lh && r.font.lh < strut ? { font: { ...r.font, lh: strut } } : {}) }));
  }
  // the runs keep the captured line height, unrounded: the build writes it as the ratio the page set
  // (115 % of every size), Figma hugs a single line at the whole pixel computed above
  // a first-line offset is an indent only in a left-aligned text (centred lines all start inside)
  return { k: "text", id: s.id, x, y, w, h, n, br, trim, align, lx: l0 ? l0.x : x, indent: l0 && align === "LEFT" && !s.font.hang ? Math.max(0, Math.round(l0.x - x)) : 0, hang: s.font.hang, runs, op: s.op, blend: s.blend, trunc: s.trunc, inField: !!s.inField && align === "LEFT" };
};
// a text whose box is its content (auto width): one line, or short lines broken by hand
// (a truncated one keeps its block's width: Figma cuts it with an ellipsis; an input's placeholder spans its
// field, the box the browser gives it, never its few words)
const oneLine = (k) => k.k === "text" && !k.trunc && (k.n === 1 || k.br);
const hugs = (k) => oneLine(k) && !k.inField;
// a frame with no slack of its own: already hugging, around one icon or image, or a pill around one line
const tight = (k) => k.k === "frame" && (k.sw === "HUG" || (k.kids?.length === 1 && (k.kids[0].k === "svg" || k.kids[0].k === "img" || ((k.bg || k.border) && hugs(k.kids[0])))));
const deco = (s) => ({ bg: s.bg, grad: s.grad, border: s.border, r: s.r, rs: s.rs, shadow: s.shadow, blur: s.blur, op: s.op, blend: s.blend, tile: s.tile, dash: s.dash, crop: s.crop, rot: s.rot, img: s.src || s.img ? true : undefined });

// --- tree -------------------------------------------------------------------------------

function buildTree(cap, items) {
  const byId = new Map(cap.boxes.map((b) => [b.id, b]));
  const item = new Map(items.map((i) => [i.id, i]));
  const keep = new Set();
  for (const i of items) for (let b = byId.get(i.id); b && !keep.has(b.id); b = byId.get(b.p)) keep.add(b.id);
  const kidsOf = new Map();
  for (const b of cap.boxes) if (keep.has(b.id) && b.p !== -1) (kidsOf.get(b.p) || kidsOf.set(b.p, []).get(b.p)).push(b.id);

  const norm = (id) => {
    const b = byId.get(id), s = item.get(id);
    const kids = (kidsOf.get(id) || []).map(norm).filter(Boolean);
    const draws = s && (s.bg || s.grad || s.border || s.src || s.img || s.shadow || s.blur);
    if (s?.svg && !kids.length) return { k: "svg", id, x: s.x, y: s.y, w: s.w, h: s.h, svg: s.svg, op: s.op, pin: b.pin, z: b.z, mt: b.mt };
    if (s?.text) {
      const t = textNode(s);
      if (!draws && !kids.length) return { ...t, z: b.z, pin: b.pin, mt: b.mt };
      kids.push(t);
    }
    if (draws && !kids.length) return { k: s.src || s.img ? "img" : "rect", id, x: s.x, y: s.y, w: s.w, h: s.h, pin: b.pin, z: b.z, mt: b.mt, ...deco(s) };
    if (!draws && !kids.length) return null;
    // a one-line text a pixel or two taller than its box (a bigger "+" run): the box sets the
    // row pitch, the text's line fits it (else each row of the grid grows by the difference)
    if (b.h >= 1) for (const k of kids) if (k.k === "text" && k.n === 1 && k.h - b.h >= 0.5 && k.h - b.h <= 2.5) {
      Object.assign(k, { y: b.y, h: b.h, runs: k.runs.map((r) => ({ ...r, font: { ...r.font, lh: Math.min(r.font.lh || b.h, b.h) } })) });
    }
    // a clipping box with content past its edges (a 1200 px logo in a 480 px card) keeps its own bounds
    const past = (n) => n.x < b.x - 2 || n.y < b.y - 2 || n.x + n.w > b.x + b.w + 2 || n.y + n.h > b.y + b.h + 2 || (n.kids || []).some(past);
    // and a rounded one: its picture or fill reaches the corners it rounds off (a 32 px radius card)
    const clip = !!(b.clip && b.w >= 1 && b.h >= 1 && (kids.some(past) || b.r > 0));
    // and a section whose full-width pinned background (a 100vh video behind the hero) hangs below it:
    // the page shows it cut at the section's bottom, the next section painting over it
    const hangs = !b.clip && b.w >= 1 && b.h >= 1 && kids.some((k) => k.pin && k.z < 0 && k.w >= b.w * 0.9 && k.y + k.h > b.y + b.h + 4);
    // a page block picked in the browser extension keeps its own frame, named after it,
    // and so does a clipping one: its single child overflows it (carousel track)
    if (!draws && kids.length === 1 && !b.op && !b.blend && !b.block && !clip && !hangs) return { ...kids[0], lm: kids[0].k === "frame" ? kids[0].lm || landmark(b) : undefined, fg: b.fg, pin: b.pin || kids[0].pin, z: b.sc ? b.z : b.z ?? kids[0].z, sc: b.sc || kids[0].sc, mt: b.mt ?? kids[0].mt };
    // (a child overflowing it evenly all round, a 54 px icon in a 44 px tab, is centred on it: it keeps the box's size)
    const centred = (k) => {
      const [l, rr, t, bt] = [b.x - k.x, k.x + k.w - (b.x + b.w), b.y - k.y, k.y + k.h - (b.y + b.h)];
      return Math.abs(l - rr) <= 1 && Math.abs(t - bt) <= 1 && l >= 2 && t >= 2;
    };
    // a box with no size of its own (display: contents…) takes its children's bounds
    // (and one that doesn't draw grows to hold what overflows it: a divider set in its margin;
    // a positioned layer past its edges never does, it takes no room on the page)
    const r = b.w < 1 || b.h < 1 ? union(kids) : draws || clip || hangs ? b : union([b, ...kids.filter((k) => !k.pin && !centred(k))]);
    // never past the page sides: what overflows them is never seen (slides parked off-screen)
    if (!draws && r !== b) {
      const x0 = Math.max(r.x, Math.min(b.x, 0)), x1 = Math.min(r.x + r.w, Math.max(b.x + b.w, cap.width));
      if (x1 > x0) Object.assign(r, { x: x0, w: x1 - x0 });
    }
    return { k: "frame", id, tag: b.tag, role: b.role, on: b.on, hint: b.hint, block: b.block, lm: landmark(b), fg: b.fg, flex: b.flex, css: b.pad, mt: b.mt, pin: b.pin, z: b.z, sc: b.sc, clip: clip || hangs || undefined, x: r.x, y: r.y, w: r.w, h: r.h, kids, ...(draws ? deco(s) : { op: b.op, blend: b.blend, r: clip && b.r > 0 ? b.r : undefined }) };
  };
  const root = cap.boxes.find((b) => b.p === -1);
  const t = norm(root.id);
  // a body pushed down by a fixed header (margin-top = header height): the page frame starts at the
  // top of the page, not of the body, or the header lands above the frame, clipped out of sight
  if (t.k === "frame" && t.y > 0 && t.kids?.some((k) => k.y < t.y)) {
    const y0 = Math.max(0, Math.min(...t.kids.map((k) => k.y)));
    t.h += t.y - y0;
    t.y = y0;
  }
  // a body narrower than the page (max-width + margin: auto): the page is the frame, the body a
  // column inside it, placed by the page's auto layout instead of offsetting every child
  if (t.k === "frame" && t.w < cap.width - 1) return { k: "frame", id: root.id, x: 0, y: Math.min(0, t.y), w: cap.width, h: Math.max(t.y + t.h, 0) - Math.min(0, t.y), bg: cap.canvas, kids: [t] };
  if (t.k === "frame" && !t.bg && !t.grad && cap.canvas) t.bg = cap.canvas;
  return t.k === "frame" ? t :{ k: "frame", id: root.id, x: 0, y: 0, w: cap.width, h: cap.height, kids: [t] };
}

// --- layout -----------------------------------------------------------------------------

// split into groups along y (dir V) or x (dir H); null when everything overlaps
const split = (ns, ax) => {
  const [p, s] = ax === "y" ? ["y", "h"] : ["x", "w"];
  const sorted = [...ns].sort((a, b) => a[p] - b[p]);
  const groups = [];
  let end = -Infinity;
  for (const n of sorted) {
    if (n[p] >= end - (n[s] <= 3 ? 3 : T)) groups.push([n]); // a hairline may sit on its neighbour's edge
    else groups[groups.length - 1].push(n);
    end = Math.max(groups.length > 1 || groups[0].length > 1 ? end : -Infinity, n[p] + n[s]);
  }
  return groups.length > 1 ? groups : null;
};

// (a rounded clipper is not: padding would grow it past its picture, and the corners with it; a <button> neither: its padding is its own)
const plain = (n) => n.k === "frame" && n.tag !== "button" && !n.bg && !n.grad && !n.border && !n.shadow && !n.blur && !n.img && !(n.clip && n.r > 0) && n.dir;
// a gap carried as padding: on the child itself when it's a plain auto layout frame, else on a wrap
const padSide = (n, side, v) => {
  v = Math.round(v);
  // the next box starts 1-2 px inside this one (a section overlapped by its neighbour's border): the overlap comes off
  // this box's own padding on that side, else every such section adds its pixel to the page height
  // (no padding to give: the box keeps its height less the overlap, its last pixel is the one the neighbour paints over)
  if (v < 0 && v >= -2 && side === "b" && plain(n)) {
    if (n.pad[2] >= -v) n.pad[2] += v; else n.sh = "FIXED";
    n.h += v;
    return n;
  }
  if (v <= 0) return n;
  const i = "trbl".indexOf(side);
  if (plain(n)) {
    n.pad[i] += v;
    // (a hugging box grows too: its width stays the one Figma will give it)
    // (a filling one too: its share of the row is measured with the padding it now holds)
    if (side === "l" || side === "r") n.w += v;
    // the box grows on that side: its origin moves with it
    if (side === "l" && n.sw !== "FILL") n.x -= v;
    // its absolute layers are placed from the frame's corner: a top / left pad moves them along
    if (side === "t" || side === "l") for (const k of n.kids || []) if (k.abs) k.abs[side === "t" ? "y" : "x"] += v;
    return n;
  }
  const pad = [0, 0, 0, 0];
  pad[i] = v;
  return { k: "frame", wrap: true, dir: "V", pad, gap: 0, align: "MIN", sw: n.sw === "FILL" ? "FILL" : "HUG", sh: n.sh === "FILL" ? "FILL" : "HUG", kids: [n], x: n.x - (side === "l" ? v : 0), y: n.y - (side === "t" ? v : 0), w: n.w + (i % 2 ? v : 0), h: n.h + (i % 2 ? 0 : v) };
};

// an absolute frame laid around hugging content (a caption box over a picture): its width follows
// the content, not one occurrence's text length (else each length is a variant)
const hugsFlow = (a) => a.k === "frame" && !!a.dir && !a.bg && !a.border && !a.img && flowOf(a).length > 0 && flowOf(a).every((k) => k.sw === "HUG") && Math.abs(hugW(a) - a.w) <= GUARD;
// default sizing before the parent decides on FILL
const defaults = (n) => {
  if (n.k === "text") { n.sw = hugs(n) ? "HUG" : "FIXED"; n.sh = "HUG"; }
  else if (n.k !== "frame") { n.sw = n.sh = "FIXED"; }
  else if (n.synth) { n.sw = n.sh = "HUG"; }
  else n.sw = n.sw || "FIXED";
};

// overlapping texts in one flow (kicker + headline) → one text with styled runs
// texts on one line (spans of a button) read left to right by their first line, and stay one line
const mergeTexts = (ts) => {
  const row = (a, b) => Math.abs(a.y - b.y) < Math.min(a.h, b.h) / 2;
  ts.sort((a, b) => (row(a, b) ? a.lx - b.lx : a.y - b.y));
  const r = union(ts);
  const runs = [];
  ts.forEach((t, k) => {
    for (const run of t.runs) runs.push({ ...run });
    if (k < ts.length - 1) runs[runs.length - 1].text += " ";
  });
  return { k: "text", id: ts[0].id, ...r, n: ts.every((t) => t.n === 1 && row(t, ts[0])) ? 1 : ts.reduce((a, t) => a + t.n, 0), align: ts[0].align, indent: ts[0].indent, runs, merged: true };
};

// page width, set by layoutTree
let PAGE = Infinity;

// a block the page names as its nav, header, footer, filter bar or search bar: a component even met once
const landmark = (b) => {
  if (b.tag === "button" || b.tag === "a") return undefined;
  const named = (b.block || "").toLowerCase();
  if (b.tag === "nav" || /^(nav|navigation)\b/.test(named)) return "nav";
  if ((b.tag === "footer" && b.w >= 0.6 * PAGE) || /^footer\b/.test(named)) return "footer";
  if ((b.tag === "header" && b.y < 200 && b.w >= 0.8 * PAGE) || /^header\b/.test(named)) return "header";
  const ws = b.hint ? words(b.hint) : [];
  if (b.tag === "search" || ws.includes("search") || ws.includes("searchbar")) return "search";
  if (ws.includes("filter") || ws.includes("filters")) return "filters";
  return undefined;
};
const PRICE = /\d\s*[€$£¥]|[€$£¥]\s*\d/;
const LANDMARK_NAME = { footer: "Footer", header: "Header", search: "Search bar", filters: "Filters", heading: "Section heading", menu: "Menu", card: "Card" };

// a struck price beside the current one: one text with a struck range, no layer to show or hide
const mergeStruck = (n) => {
  if (n.k !== "frame") return;
  n.kids = n.kids.map((k) => {
    mergeStruck(k);
    if (k.k !== "frame" || k.kids.length !== 2 || !k.kids.every((t) => t.k === "text" && t.n === 1) || k.bg || k.border || k.img || k.block) return k;
    const struck = k.kids.map((t) => t.runs.every((r) => r.font?.deco === "STRIKETHROUGH"));
    if (struck[0] === struck[1]) return k;
    return { ...mergeTexts(k.kids), pin: k.pin, z: k.z, sc: k.sc, fg: k.fg };
  });
};

// a vertical sub-section spaces its children by its gap: the smallest one, shared by at least half of
// them. A child that needs more keeps the rest as padding-bottom (a title above its content).
function stackGap(f) {
  const g = f.gaps.slice(0, -1);
  if (!g.length) return;
  const min = Math.min(...g);
  const near = g.filter((v) => v - min <= T);
  if (min <= 0 || near.length * 2 < g.length) return;
  const sum = near.reduce((a, b) => a + b, 0), mean = sum / near.length, whole = Math.round(mean);
  f.gap = Math.abs(whole * near.length - sum) >= 1 ? +mean.toFixed(4) : whole; // 2 decimals drift: 47.79 x 14 gaps = +0.06, a pixel once rounded
  f.gaps = f.gaps.map((v, i) => (i < g.length && v - min > T ? v - f.gap : 0));
}

// tier: "page" and "section" stack with itemSpacing 0 and padding-bottom, a "sub" section with its gap.
// One child adds no level; a section made mostly of full-width bands is still the page (a main around the sections).
function layout(f, tier = "page") {
  if (f.done) return;
  f.done = true;
  // a leaf covering the whole frame is its background
  // (not one stacked over the content by a positive z-index: an edge fade, a scrim on top)
  if (!f.bg && !f.img && !f.grad && f.kids.length > 1) {
    // (a gradient reaching past the frame is a scrim over a wider box, not the frame's own fill: a card's
    // 320 px fade behind a 280 px text block would shrink to the text)
    const spills = (k) => k.grad && !k.bg && !k.img && (k.x < f.x - T || k.y < f.y - T || k.x + k.w > f.x + f.w + T || k.y + k.h > f.y + f.h + T);
    const covers = (k) => (k.k === "rect" || k.k === "img") && !k.border && !k.blur?.layer && !k.blend && !(k.z > 0) && !spills(k) && inter(k, f) >= 0.98 * f.w * f.h;
    // only the bottom-most painted layer: one drawn after an overlapping sibling sits on top of it
    const at = f.kids.findIndex(covers);
    const cover = at >= 0 && f.kids.slice(0, at).every((k) => !inter(k, f.kids[at])) ? f.kids[at] : null;
    if (cover) {
      f.kids = f.kids.filter((k) => k !== cover);
      Object.assign(f, { bg: cover.bg, grad: cover.grad, img: cover.img, r: f.r || cover.r, shadow: f.shadow || cover.shadow, blur: f.blur || cover.blur, imgId: cover.img ? cover.id : undefined, crop: cover.img ? cover.crop : undefined });
      // gradient-only layers painted over it (scrims) stack on the same fills, in paint order
      for (const k of f.kids.filter((k) => covers(k) && k.k === "rect" && k.grad && !k.bg && !k.shadow && !k.blur)) {
        if (f.kids.length < 2) break;
        f.kids = f.kids.filter((x) => x !== k);
        f.grad = [...(f.grad || []), ...k.grad];
      }
    }
  }
  // a box drawn as a sibling around other siblings (bordered panel) adopts them
  const inside = (a, b) => a.x >= b.x - T && a.y >= b.y - T && a.x + a.w <= b.x + b.w + T && a.y + a.h <= b.y + b.h + T;
  // (never a faded layer: what it held would fade with it, a tint over a photo would wash out the
  // card's text; a blended one does adopt, a multiply badge behind its own label)
  for (const r of [...f.kids].filter((k) => k.k === "rect" && k.w > 4 && k.h > 4 && !k.op).sort((a, b) => b.w * b.h - a.w * a.h)) {
    if (!f.kids.includes(r)) continue;
    // a pinned translucent layer (scrim) never adopts what is painted under it (a cookie scrim over the header: the header
    // inside the scrim's frame would come out over the tint instead of under it)
    const scrim = r.pin && /^rgba\(.*,\s*0?\.\d+\)$/.test(String(r.bg || ""));
    const under = (k) => (k.z ?? 0) < (r.z ?? 0) || ((k.z ?? 0) === (r.z ?? 0) && (k.id ?? k.kids?.[0]?.id ?? Infinity) < (r.id ?? Infinity));
    // nor a filled layer what is painted under it (an ::after gradient over a hero photo: as the photo's frame
    // its fill would sit under the photo); a border alone may, Figma strokes paint over the children, and a
    // blended one too (a multiply badge over its own label reads as behind it)
    const over = scrim || ((r.bg || r.grad) && !r.blend);
    const held = f.kids.filter((k) => k !== r && inside(k, r) && !(over && under(k)));
    if (!held.length) continue;
    // never across a sibling painted between them over the box (a z 1 frame around the base
    // layer of a chart would lift that base over the chart)
    const at = [r, ...held].map((k) => f.kids.indexOf(k));
    if (f.kids.slice(Math.min(...at), Math.max(...at)).some((k) => k !== r && !held.includes(k) && inter(k, r) > 0)) continue;
    f.kids = f.kids.filter((k) => !held.includes(k));
    Object.assign(r, { k: "frame", kids: held, sw: undefined, sh: undefined });
  }
  // out of the page flow (position absolute / fixed): over the others, taking none of their space
  // past the page sides too (a board column cut by the viewport, a panel bleeding off the left):
  // laid out from the parent's side in Figma, it keeps its real offset as an absolute layer
  // (only where its parent is on the page: inside a column already past the side, the kids are that column's flow)
  const past = (k) => k.x < -T || k.x + k.w > PAGE + T;
  // a clipping box starting above its parent's top with its content (a card 24 px over the section's top edge):
  // in flow it would sit at the parent's top and add its overhang to the parent's height; as an absolute
  // layer it keeps its offset and the parent keeps the page's height
  const over = (k) => k.k === "frame" && k.clip && !k.synth && k.y < f.y - T && k.y + k.h > f.y + 1 && k.kids?.length && union(k.kids).y < f.y - 0.5;
  const off = (k) => k.pin || (past(k) && !past(f)) || over(k);
  dividersToStrokes(f);
  let flow = f.kids.filter((k) => !off(k)), abs = f.kids.filter(off);
  // overlap: texts merge, else the largest stay in flow and the rest go absolute
  const cut = (ns) => split(ns, "y") || split(ns, "x");
  // no clean cut: open the wrappers that draw nothing (their children may cut where they don't)
  if (flow.length > 1 && !cut(flow)) {
    let open = flow;
    for (let pass = 0; pass < 3 && !cut(open); pass++) {
      const next = open.flatMap((k) => (k.k === "frame" && !k.done && !k.block && !k.bg && !k.grad && !k.border && !k.shadow && !k.blur && !k.img && k.kids.length ? k.kids : [k]));
      if (next.every((k, i) => k === open[i])) break; // (same count is not same content: a wrapper around one text opens too)
      open = next;
    }
    if (cut(open)) flow = open;
  }
  if (flow.length > 1 && !cut(flow)) {
    if (flow.every((k) => k.k === "text")) flow = [mergeTexts(flow)];
    else {
      const keep = [];
      for (const k of [...flow].sort((a, b) => b.w * b.h - a.w * a.h)) (keep.some((o) => inter(o, k) > 4) ? abs : keep).push(k);
      // still no clean cut (pinwheel, slight overlaps): the smallest leave the flow until there is one
      while (keep.length > 1 && !split(keep, "y") && !split(keep, "x")) abs.push(keep.pop());
      flow = keep;
    }
  }
  // the one child, pinned over its whole box (a card's stretched link holding all its content): the
  // same picture in flow, and the box then follows it per occurrence; a frame with no auto layout
  // refuses a height override in an instance (ableton: 480 x 320 teasers stuck at the main's 560)
  if (!flow.length && abs.length === 1 && abs[0].k === "frame" && abs[0].kids.length && Math.abs(abs[0].x - f.x) <= T && Math.abs(abs[0].y - f.y) <= T && Math.abs(abs[0].w - f.w) <= T && Math.abs(abs[0].h - f.h) <= T) flow = abs.splice(0);
  // rows pinned one under the other across the whole box (a virtualised list placing each row at its offset): a column
  const down = [...abs].sort((a, b) => a.y - b.y);
  if (!flow.length && down.length >= 2 && down.every((k, i) => k.pin && Math.abs(k.x - f.x) <= T && Math.abs(k.w - f.w) <= T && (!i || k.y >= down[i - 1].y + down[i - 1].h))) {
    flow = abs.splice(0);
    for (const k of flow) k.pin = undefined;
  }
  for (const k of [...flow, ...abs]) defaults(k);
  f.kids = flow;
  if (!flow.length) { f.dir = null; f.sh = "FIXED"; }
  else arrange(f);
  for (const a of abs) { a.abs = { x: r1(a.x - f.x), y: r1(a.y - f.y) }; a.sw = hugs(a) || hugsFlow(a) ? "HUG" : "FIXED"; }
  // CSS paint order at z auto: flow boxes first, then positioned / stacking-context ones, DOM order within each
  // (overlapping flow items are pulled out last first; a board pushed out of the flow stays under the panel over it)
  const idOf = (k) => k.id ?? k.kids?.[0]?.id ?? Infinity;
  abs.sort((a, b) => (a.pin || a.sc ? 1 : 0) - (b.pin || b.sc ? 1 : 0) || idOf(a) - idOf(b));
  f.kids.push(...abs);
  const kids = f.kids;
  const own = tier === "section" && f.dir === "V" && flow.length > 1 && flow.filter((k) => k.w >= PAGE * 0.9).length * 2 > flow.length ? "page" : tier;
  const next = flow.length <= 1 ? own : own === "page" ? "section" : "sub";
  for (const k of kids) {
    const inner = k.wrap ? k.kids[0] : k;
    if (inner.k === "frame") layout(inner, next);
  }
  if (f.gaps && f.dir === "V" && own === "sub") stackGap(f);
  if (f.gaps) {
    f.kids = kids.map((k, i) => (f.gaps[i] ? padSide(k, f.dir === "V" ? "b" : "r", f.gaps[i]) : k));
    delete f.gaps;
  }
  if (f.offs) {
    f.kids = f.kids.map((k, i) => (f.offs[i] ? padSide(k, f.dir === "V" ? "l" : "t", f.offs[i]) : k));
    delete f.offs;
  }
  // a pinned layer before the flow in the page (background canvas, scrim) stays under it
  // (flow items laid out absolute, off the page sides or overlapping, are still the flow)
  const first = Math.min(...f.kids.filter((k) => !k.pin).map((k) => k.id ?? k.kids?.[0]?.id ?? Infinity));
  // in DOM order: the paint order among themselves
  const under = f.kids.filter((k) => k.abs && k.pin && k.id < first).sort((a, b) => a.id - b.id);
  if (under.length) f.kids = [...under, ...f.kids.filter((k) => !under.includes(k))];
  // z-index: paint order by stacking level, DOM order within a level (the flow keeps its order)
  // a box without a z-index of its own makes no stacking context: the z-index of its content
  // escapes it (a z 2 label deep in a section paints over a z 1 background beside the section),
  // counted where it overlaps a sibling, ranked just under a sibling of the same explicit z;
  // a stacking context of its own (sc: z-index 0, transform…) stops it
  // a faint layer escaping (grain, glow: no text, no opaque fill, or under half opacity) ranks nothing: lifting its
  // parent would lift the parent's opaque panel over the sibling with it
  // a sibling counts with what it paints past its frame (a hero's positioned backdrop under the header)
  // (each sibling's painted extent is asked for by every z lookup: computed once, reset when a sibling changes)
  const painted = new Map();
  const paints = (o) => {
    let r = painted.get(o);
    if (!r) painted.set(o, (r = union([o, ...(o.kids || []).map(paints)])));
    return r;
  };
  const meets = (n, k) => f.kids.some((o) => o !== k && inter(n, paints(o)) > 0);
  const solid = (n) => (n.op ?? 1) >= 0.5 && (n.k === "text" || n.img || (n.bg && !/rgba\([^)]*,\s*0?\.\d+\)/.test(n.bg)) || (n.kids || []).some(solid));
  const leak = (n, k) => (n.z && meets(n, k) && solid(n) ? n.z : n.z || n.sc ? 0 : Math.max(0, ...(n.kids || []).map((c) => leak(c, k))));
  // a negative z escapes too (a hero photo at z -1 under a box without z): the box paints in that
  // layer, in DOM order with a sibling of the same z (the photo first, the card drawn after it on top)
  const sink = (n, k) => (n.z < 0 && meets(n, k) && solid(n) ? n.z : n.z || n.sc ? 0 : Math.min(0, ...(n.kids || []).map((c) => sink(c, k))));
  const zOf = (k) => {
    const n = k.wrap ? k.kids[0] : k;
    if (n.z || n.sc) return n.z || 0;
    const e = Math.max(0, ...(n.kids || []).map((c) => leak(c, k)));
    return e ? e - 0.5 : Math.min(0, ...(n.kids || []).map((c) => sink(c, k)));
  };
  // a box without stacking context whose content escapes both ways (a hero photo at z -1, its title at
  // z 1) cannot sit at one level in Figma: its positioned negative layers move up beside it, before it
  for (const k of [...f.kids]) {
    const n = k.wrap ? k.kids[0] : k;
    if (n.z || n.sc || n.clip || !(n.kids || []).some((c) => leak(c, k) > 0)) continue;
    const out = (n.kids || []).filter((c) => c.abs && c.z < 0 && meets(c, k) && solid(c));
    if (!out.length) continue;
    n.kids = n.kids.filter((c) => !out.includes(c));
    for (const c of out) c.abs = { x: r1(c.x - f.x), y: r1(c.y - f.y) };
    f.kids.splice(f.kids.indexOf(k), 0, ...out);
    painted.clear();
  }
  // the same box whose positive layer escapes while the rest of it stays low (a hero video at z 1 under the caption at z 1,
  // its play button at z 3 deep inside the video box): at the button's level the whole box would cover the caption, so the
  // button moves up beside the box, after it, and the box ranks by what is left
  const lifted = (n, out = []) => {
    for (const c of n.kids || []) {
      if (c.abs && c.z > 0 && meets(c, n) && solid(c)) out.push(c);
      else if (!c.z && !c.sc && !c.clip) lifted(c, out);
    }
    return out;
  };
  for (const k of [...f.kids]) {
    const n = k.wrap ? k.kids[0] : k;
    if (n.z || n.sc || n.clip) continue;
    const up = lifted(n);
    if (!up.length) continue;
    const parents = new Map();
    const owner = (m) => { for (const c of m.kids || []) { if (up.includes(c)) parents.set(c, m); else owner(c); } };
    owner(n);
    const was = new Map(up.map((c) => [c, parents.get(c).kids.slice()]));
    for (const c of up) parents.get(c).kids = parents.get(c).kids.filter((x) => x !== c);
    painted.clear();
    const rest = zOf(k), top = Math.max(...up.map((c) => c.z));
    if (f.kids.some((o) => o !== k && !up.includes(o) && inter(paints(k), paints(o)) > 0 && zOf(o) > rest && zOf(o) < top)) {
      for (const c of up) c.abs = { x: r1(c.x - f.x), y: r1(c.y - f.y) };
      f.kids.splice(f.kids.indexOf(k) + 1, 0, ...up);
    } else for (const c of up) parents.get(c).kids = was.get(c);
    painted.clear();
  }
  const z = new Map(f.kids.map((k) => [k, zOf(k)]));
  // a level ranks a sibling only against the ones it overlaps: a footer at z 2 beside a section it never touches must not
  // forbid the header above the page (z 11) its place on top
  for (const k of f.kids) if (z.get(k) && !f.kids.some((o) => o !== k && inter(paints(k), paints(o)) > 0)) z.set(k, 0);
  if (f.kids.some((k) => z.get(k))) {
    const sorted = [...f.kids].sort((a, b) => z.get(a) - z.get(b));
    const flow = f.kids.filter((k) => !k.abs);
    const keeps = (list) => list.filter((k) => !k.abs).every((k, i) => k === flow[i]);
    // a flow item over the next ones (a header above the page): the frame stacks first on top
    if (keeps(sorted)) f.kids = sorted;
    else {
      const top = [...f.kids].sort((a, b) => z.get(b) - z.get(a));
      if (keeps(top)) [f.kids, f.revZ] = [top, true];
    }
  }
}

// A hairline lying along one edge of its frame, full length (a ::before rule, a 1 px div) becomes
// that side's stroke instead of a drawn rectangle; inset, gradient or clashing with an existing
// border, it stays a layer. Padding comes from the geometry, so the content does not move.
const DIV_T = 1.5;
function dividersToStrokes(f) {
  if (f.img || !f.kids.length) return;
  const sides = f.border ? [...(f.border.sides || [f.border.w, f.border.w, f.border.w, f.border.w])] : [0, 0, 0, 0];
  const keep = [];
  for (const k of f.kids) {
    const flat = k.k === "rect" || (k.k === "frame" && !k.kids?.length && !k.img);
    // its colour: its fill, or the border an empty box draws (a ::before with only border-top)
    const paint = k.bg ? !k.border && k.bg : k.border?.c;
    const plainPaint = flat && paint && !k.grad && !k.shadow && !k.blur && !k.op && !k.blend && !k.r && !k.abs;
    let side = -1;
    if (plainPaint && k.h <= 2 && Math.abs(k.x - f.x) <= DIV_T && Math.abs(k.w - f.w) <= DIV_T) {
      if (Math.abs(k.y - f.y) <= DIV_T) side = 0;
      else if (Math.abs(k.y + k.h - (f.y + f.h)) <= DIV_T) side = 2;
    } else if (plainPaint && k.w <= 2 && Math.abs(k.y - f.y) <= DIV_T && Math.abs(k.h - f.h) <= DIV_T) {
      if (Math.abs(k.x - f.x) <= DIV_T) side = 3;
      else if (Math.abs(k.x + k.w - (f.x + f.w)) <= DIV_T) side = 1;
    }
    const w = Math.round(side === 0 || side === 2 ? k.h : k.w) || 1;
    // between two blocks: the bottom stroke of the unpainted block right above it, which grows down to it
    if (side < 0 && plainPaint && k.h <= 2) {
      const bottom = (s) => s.y + s.h;
      const above = f.kids.filter((s) => s !== k && bottom(s) <= k.y + DIV_T && s.x < k.x + k.w && s.x + s.w > k.x);
      const s = above.sort((a, b) => bottom(b) - bottom(a))[0];
      const gap = s && k.y - bottom(s);
      if (s && s.k === "frame" && !s.bg && !s.grad && !s.border && !s.img && !s.shadow && s.kids?.length && gap >= -DIV_T && gap <= 64 && Math.abs(s.x - k.x) <= DIV_T && Math.abs(s.w - k.w) <= DIV_T) {
        const grow = k.y + k.h - bottom(s);
        if (s.pad) s.pad = [s.pad[0], s.pad[1], r1(s.pad[2] + grow), s.pad[3]];
        s.h = k.y + k.h - s.y;
        s.border = { w: Math.round(k.h) || 1, c: paint, sides: [0, 0, Math.round(k.h) || 1, 0] };
        continue;
      }
    }
    if (side < 0 || sides[side] || (f.border && f.border.c !== paint)) { keep.push(k); continue; }
    sides[side] = w;
    f.border = { w: Math.max(...sides), c: paint };
  }
  if (keep.length === f.kids.length) return;
  f.kids = keep;
  if (!f.border) return;
  if (sides.some((v) => v !== f.border.w)) f.border.sides = sides;
  else delete f.border.sides;
}

function arrange(f) {
  let ns = f.kids;
  // a negative margin (-24 px on a section's top) puts an unpainted flow child above its parent while its own
  // padding brings the content back down: Figma has no negative padding, so the child would sit at the parent's
  // top and its content land `overhang` px too low. Cut the box at the parent's top, content untouched.
  for (const k of ns) {
    if (k.k !== "frame" || k.synth || k.pin || k.bg || k.grad || k.border || k.img || k.shadow || k.blur || !k.kids?.length) continue;
    if (!(k.y < f.y - 0.5 && k.y + k.h > f.y + 1) || union(k.kids).y < f.y - 0.5) continue;
    Object.assign(k, { h: k.y + k.h - f.y, y: f.y });
  }
  // same on the sides: a gutter row (margin 0 -32px, padding-left 32px) starts 32 px left of its parent,
  // its content inside it. Kept as is, Figma puts the row at the parent's start and every column lands
  // 32 px right (vmfa.museum). Cut at the parent's sides, content untouched (paddings follow the geometry)
  for (const k of ns) {
    if (k.k !== "frame" || k.synth || k.pin || k.bg || k.grad || k.border || k.img || k.shadow || k.blur || !k.kids?.length) continue;
    const u = union(k.kids);
    if (k.x < f.x - 0.5 && k.x + k.w > f.x + 1 && u.x >= f.x - 0.5) Object.assign(k, { w: k.x + k.w - f.x, x: f.x });
    if (k.x + k.w > f.x + f.w + 0.5 && k.x < f.x + f.w - 1 && u.x + u.w <= f.x + f.w + 0.5) k.w = f.x + f.w - k.x;
  }
  let groups = split(ns, "y");
  let dir = "V";
  if (!groups) { groups = split(ns, "x"); dir = groups ? "H" : "V"; }
  if (!groups) groups = [ns];
  // a group of several becomes a row / column of its own
  ns = groups.map((g) => {
    if (g.length === 1) return g[0];
    const s = { k: "frame", synth: true, id: Math.min(...g.map((n) => n.id)), ...union(g), kids: g };
    // within its parent's sides: pinned members past them keep their offset as absolute layers
    const x0 = Math.max(s.x, f.x), x1 = Math.min(s.x + s.w, f.x + f.w);
    if (x1 > x0) Object.assign(s, { x: x0, w: x1 - x0 });
    // (and above its top: a tab list pinned 56 px over its panel would else push the whole flow down by 56)
    if (s.y < f.y && s.y + s.h > f.y) Object.assign(s, { y: f.y, h: s.y + s.h - f.y });
    defaults(s);
    return s;
  });
  ns.sort((a, b) => (dir === "V" ? a.y - b.y : a.x - b.x));
  f.kids = ns;
  f.dir = dir;
  f.sh = f.sh || "HUG";
  const css = f.css || [0, 0, 0, 0];
  const bw = f.border ? f.border.sides || [f.border.w, f.border.w, f.border.w, f.border.w] : [0, 0, 0, 0];
  const R = union(ns);
  const hug = f.sw === "HUG";
  const geo = [R.y - f.y, f.x + f.w - (R.x + R.w), f.y + f.h - (R.y + R.h), R.x - f.x];
  // top and bottom from the geometry (height hugs); sides from CSS when narrower (alignment does the rest)
  // content overflowing the box (text taller than its card): the box's own padding still applies
  // within 1 px of it, the CSS value wins (sub-pixel line boxes round up on both sides)
  // content overflowing both sides alike (a 22 px line centred in a 42 px bordered pill) keeps
  // the box's height: hugging it with the CSS padding grows the box by the overflow
  const under = [0, 2].map((i) => css[i] + bw[i] - geo[i]);
  const overflows = under[0] >= 1 && Math.abs(under[0] - under[1]) <= 1;
  if (overflows) f.sh = "FIXED";
  // a clipping box its flow overflows below (a 600 px mockup in a 532 px card) keeps its height:
  // hugging it shows what the page cuts off and pushes the rest of the page down
  if (f.clip && geo[2] < -1) f.sh = "FIXED";
  const raw = [geo[0], geo[2]];
  // (kept height: the content stays where it is, the CSS padding would push it down — a 24 px title
  // at y 13 of a 51 px banner, padding 20)
  // (a first child raised by its negative top margin sits where the margin puts it: geometry wins)
  const raised = dir === "V" && ns[0]?.mt < 0 && Math.abs(css[0] + bw[0] + ns[0].mt - geo[0]) <= 2;
  if (!overflows) [0, 2].forEach((i) => (geo[i] = geo[i] < css[i] + bw[i] + 1 && !(i === 0 && raised) ? css[i] + bw[i] : geo[i]));
  // the CSS value winning on both sides over a rounded box (10 + 38 + 11 read in a 59 px box, CSS 11 / 11)
  // makes the hugged height overshoot the box's: the overshoot comes back off the side(s) CSS overrode,
  // else every row of a grid grows by it and what is pinned beside them drifts (jacquemus: +5 px by row 4)
  if (f.sh === "HUG") {
    let over = geo[0] + R.h + geo[2] - f.h;
    for (const [j, i] of [0, 2].entries()) if (over >= 0.5) { const take = Math.min(over, Math.max(0, geo[i] - raw[j])); geo[i] -= take; over -= take; }
  }
  f.pad = [geo[0], hug ? geo[1] : Math.min(geo[1], css[1] + bw[1]), geo[2], dir === "H" || hug ? geo[3] : Math.min(geo[3], css[3] + bw[3])].map((v) => Math.max(0, Math.round(v)));
  // a centred line in a box (9.5 + 24 + 10.5 in a 44 px button): each side rounding up would hug 45, so the pair keeps its rounded sum
  if (f.sh === "HUG" && geo[0] > 0 && geo[2] > 0) f.pad[2] = Math.max(0, Math.round(geo[0] + geo[2]) - f.pad[0]);
  // a synthetic group has no CSS of its own; its bounds include its pinned layers, so the flow
  // keeps its offset inside them (a row moved down by a transform under an absolute list)
  if (f.synth) f.pad = [R.y - f.y, f.x + f.w - (R.x + R.w), f.y + f.h - (R.y + R.h), R.x - f.x].map((v) => Math.max(0, Math.round(v)));
  const cx0 = f.x + f.pad[3], cx1 = hug ? R.x + R.w : f.x + f.w - f.pad[1];
  const cy0 = R.y, cy1 = R.y + R.h;
  f.gap = 0;
  const between = f.flex?.justify === "space-between";
  if (dir === "V") {
    const off = ns.map((k) => [k.x - cx0, cx1 - (k.x + k.w)]);
    // a one-line text keeps auto width: stretched, the Figma font's few extra px wrap it
    // one overflowing both sides (a tab row scrolled inside a clipping box) keeps its width: filling, it shrinks
    ns.forEach((k, i) => { if (!hug && Math.abs(off[i][0]) <= T && Math.abs(off[i][1]) <= T && k.k !== "svg" && !hugs(k)) k.sw = "FILL"; });
    const rest = off.filter((o, i) => ns[i].sw !== "FILL");
    f.align = rest.some((o) => o[0] < -T) && rest.every((o) => Math.abs(o[0] - o[1]) <= T) ? "CENTER" : rest.every((o) => o[0] <= T) ? "MIN" : rest.every((o) => Math.abs(o[0] - o[1]) <= T) ? "CENTER" : rest.every((o) => o[1] <= T && o[1] >= -T) ? "MAX" : "MIN"; // (past the far edge is not flush with it: a clipped Gantt pushed 48 px right)
    if (f.align === "MIN") f.offs = ns.map((k, i) => (k.sw !== "FILL" && off[i][0] > T ? off[i][0] : 0));
    if (between && ns.length > 1 && f.flex?.dir === "column") { f.justify = "SPACE_BETWEEN"; f.sh = "FIXED"; }
    else f.gaps = ns.map((k, i) => (i < ns.length - 1 ? ns[i + 1].y - (k.y + k.h) : 0));
  } else {
    const off = ns.map((k) => [k.y - cy0, cy1 - (k.y + k.h)]);
    // columns as tall as the row, tops a few px apart: top aligned, or the tallest one's growth pushes the others down
    const sameTop = off.every((o) => o[0] <= 0.05 * R.h);
    f.align = off.every((o) => o[0] <= T) ? "MIN" : off.every((o) => Math.abs(o[0] - o[1]) <= T) ? "CENTER" : off.every((o) => o[1] <= T) && !sameTop ? "MAX" : "MIN";
    if (f.align === "MIN") f.offs = ns.map((k, i) => (off[i][0] > T ? off[i][0] : 0));
    // a flex-grow item takes the row's slack, whatever the gaps
    for (const k of ns) if (k.fg && !hug && k.k === "frame") k.sw = "FILL";
    const g = ns.slice(1).map((k, i) => k.x - (ns[i].x + ns[i].w));
    const flush = !hug && Math.abs(R.x + R.w - cx1) <= T;
    // space-between filling its box stays that: a fixed gap would move the end child when a shared row's text changes
    const spread = between && flush && ns.length > 1;
    if (!spread && (!g.length || Math.max(...g) - Math.min(...g) <= T)) {
      // captured x are whole pixels: gaps of 32 and 33 are a 32.5 gap, rounded it overflows the row and squeezes its filling child
      const sum = g.reduce((a, b) => a + b, 0), mean = g.length ? sum / g.length : 0, whole = Math.round(mean);
      f.gap = Math.max(0, Math.abs(whole * g.length - sum) >= 1 ? +mean.toFixed(4) : whole);
      // the row fills its box: its most flexible child takes the slack when resized
      if (flush) {
        // (not a frame around one icon or image, nor a pill: stretched, the row's slack lands inside them)
        const flex = [...ns].filter((k) => (k.k === "text" && !hugs(k)) || (k.k === "frame" && !tight(k))).sort((a, b) => (b.k === "text" && b.n > 1) - (a.k === "text" && a.n > 1) || b.w - a.w)[0];
        if (flex) flex.sw = "FILL";
      }
    // spread evenly only when the CSS says so (or two children): with uneven gaps, a middle
    // child pushed against its neighbour (a nav after the logo) would be centred instead
    } else if (flush && (ns.length === 2 || between)) f.justify = "SPACE_BETWEEN";
    else f.gaps = ns.map((k, i) => (i < g.length ? g[i] : 0));
    // filled frames stretched to the row's height: all but the fullest follow it
    const tall = ns.filter((k, i) => k.k === "frame" && off[i][0] <= T && off[i][1] <= T && (k.bg || k.border));
    if (tall.length > 1) tall.slice(1).forEach((k) => (k.sh = "FILL"));
  }
  // an unpainted box as wide as its single-line texts hugs them: its width is its content's, not a
  // size of its own (a title and price block, a variant per title length otherwise)
  if (!f.synth && !f.img && f.sw === "FIXED" && !f.bg && !f.border && ns.length && ns.every(hugs) && Math.abs(f.w - f.pad[1] - f.pad[3] - Math.max(...ns.map((k) => k.w))) <= T) f.sw = "HUG";
  // same for an unpainted row of fixed atoms and single-line texts as wide as they are: an icon and its
  // label keep their width whatever the occurrence's text (a header's left group, 64 or 123 px)
  if (!f.synth && !f.img && f.sw === "FIXED" && !f.bg && !f.border && dir === "H" && ns.length > 1 && ns.every((k) => hugs(k) || k.k === "svg" || tight(k)) && !between && Math.abs(R.x + R.w - (f.x + f.w - f.pad[1])) <= T) f.sw = "HUG";
  // a pill (filled frame around single-line content) hugs its content
  // (not a box filled by an image: a cover with a title over it keeps the image's size)
  if (!f.synth && !f.img && f.sw === "FIXED" && (f.bg || f.border) && ns.every((k) => hugs(k) || k.k === "svg")) {
    f.sw = "HUG";
    const was = f.pad[3];
    f.pad[1] = Math.max(0, Math.round(geo[1]));
    f.pad[3] = Math.max(0, Math.round(geo[3]));
    // offsets were taken from the old left padding: what the padding now holds is not added twice
    if (f.offs && dir === "V") f.offs = f.offs.map((o) => Math.max(0, o - (f.pad[3] - was)));
  }
  // a box that centres its content (CSS flex, a button's label) says so in Figma: the content stays
  // centred when the box is resized, not held in place by its padding alone
  if (!f.synth && ns.length && f.justify !== "SPACE_BETWEEN") {
    // a button's label is centred on it: one value for its top and bottom padding (a rounded 10 / 11 is 10 / 10)
    if (ns.length === 1 && ns[0].k === "text" && isButton(f) && Math.abs(f.pad[0] - f.pad[2]) <= 2) f.pad[0] = f.pad[2] = Math.floor((f.pad[0] + f.pad[2]) / 2);
    // (an unpainted <button> too: what its box holds above and below the line, shared)
    else if (ns.length === 1 && ns[0].k === "text" && f.tag === "button" && !f.border && f.h > ns[0].h) f.pad[0] = f.pad[2] = Math.max(0, Math.floor((f.h - ns[0].h) / 2));
    const label = !f.flex && /^(button|a)$/.test(f.tag || "") && ns.length === 1 && ns[0].k === "text" && ns[0].align === "CENTER";
    // (a <button> centres its one line on its height whatever the text-align)
    const lone = !f.flex && f.tag === "button" && ns.length === 1 && ns[0].k === "text";
    // (a browser centres the one line of a field on its height, whatever the CSS: not a textarea, which starts at the top;
    // display: flex on an input changes nothing, its value is no flex item: circle's "Soumettre" submit)
    const field = /^(input|select)$/.test(f.tag || "") && ns.length === 1 && ns[0].k === "text";
    const row = f.flex?.dir !== "column";
    const across = label || (f.flex && f.flex[row ? "justify" : "align"] === "center");
    const down = label || lone || field || (f.flex && f.flex[row ? "align" : "justify"] === "center");
    // (its padding was derived from a text position the capture doesn't have: the box's height stands, not top and bottom)
    if (field) {
      f.pad[0] = f.pad[2] = 0;
      if (f.sh === "HUG") f.sh = "FIXED";
    }
    const h = across && Math.abs(f.pad[1] - f.pad[3]) <= T;
    const v = down && Math.abs(f.pad[0] - f.pad[2]) <= T;
    if (h || v) {
      // (one child has no direction of its own: the box's row or column stands)
      if (ns.length === 1 && f.flex) {
        const turned = f.dir === "V" && row;
        f.dir = row ? "H" : "V";
        // a lone child placed sideways by the column's align or offset keeps its place in the row (a search box's icons at its right end)
        if (turned && !h) {
          if (f.align === "MAX" || f.align === "CENTER") f.justify = f.align;
          else if (f.offs?.[0]) f.pad[3] += Math.round(f.offs[0]);
          f.offs = undefined;
        }
      }
      const [main, cross] = f.dir === "H" ? [h, v] : [v, h];
      if (main) f.justify = "CENTER";
      if (cross) { f.align = "CENTER"; f.offs = undefined; }
    }
  }
  // the one child overflowing the box evenly along its flow (a 54 px icon in a 44 px tab): centred on it, not hung from its start
  if (!f.synth && ns.length === 1 && !f.justify) {
    const [a, z, size] = dir === "V" ? [geo[0], geo[2], f.sh] : [geo[3], geo[1], f.sw];
    if (size === "FIXED" && a < -1 && Math.abs(a - z) <= 1) f.justify = "CENTER";
  }
}

// a frame that draws nothing around one child of its own box: the child takes its place (less depth)
// (a one-line left-aligned text in a wider box takes the box's width: it renders the same)
const bare = (n) => n.k === "frame" && !n.bg && !n.grad && !n.border && !n.shadow && !n.blur && !n.img && !n.clip && !n.op && !n.blend && !n.block && !n.revZ;

// Every one-line field is one component: a painted box holding, flat, what sits left of the value, the
// value, what sits right of it. A bare input, a search box, "$ 0.00 USD", a URL with its copy icon differ
// by which layers they show, not by being other things.
const FIELD_H = 64; // px: taller is no one-line field
const FIELD_FAM = hash("field");
const PART_NAME = { left: { svg: "left-icon", text: "prefix" }, text: { text: "text" }, right: { svg: "right-icon", text: "suffix" } };
const lineField = (n) => n.k === "frame" && /^(input|select)$/.test(n.tag || "") && !n.abs && n.kids.length === 1 && n.kids[0].k === "text";
const painted = (n) => !!(n.bg || n.grad || n.border);
const asField = (n, tag) => {
  n.tag = tag;
  n.field = true;
  n.kindFam = FIELD_FAM;
  n.dir = "H";
  n.align = "CENTER";
  n.justify = undefined;
  n.offs = n.gaps = undefined;
  // (a value longer than the box stops at its edge: every field clips)
  n.clip = true;
  // (the value takes what is left: what follows it stays where the page has it)
  if (n.sw === "HUG") n.sw = "FIXED";
  n.sh = "FIXED";
};
// what an unpainted wrapper holds, in its place
const unwrap = (k, all) => (bare(k) && k.kids.length && (all || k.kids.length === 1) && k.kids.every((x) => !x.abs) ? k.kids.flatMap((x) => unwrap(x, all)) : [k]);
function markFields(n) {
  if (n.k !== "frame") return;
  n.kids.forEach(markFields);
  if (n.h > FIELD_H) return;
  if (lineField(n)) {
    if (!painted(n)) return;
    asField(n, n.tag);
    n.gap = 0;
    n.pad[0] = n.pad[2] = 0;
    n.kids[0].part = "text";
    n.kids[0].sw = "FILL";
    return;
  }
  if (!painted(n) || n.img || n.dir !== "H" || n.kids.some((k) => k.abs)) return;
  const at = n.kids.findIndex(lineField);
  if (at < 0 || painted(n.kids[at]) || n.kids.filter(lineField).length > 1) return;
  const field = n.kids[at], value = field.kids[0];
  // the gaps a row of one gap can show: the value's right edge is free, it fills
  const gaps = (L, R) => {
    const span = [...L, value];
    const out = [];
    span.forEach((k, i) => { if (i) out.push(k.x - (span[i - 1].x + span[i - 1].w)); });
    R.forEach((k, i) => { if (i) out.push(k.x - (R[i - 1].x + R[i - 1].w)); });
    return out;
  };
  const even = (g) => !g.length || Math.max(...g) - Math.min(...g) <= 1;
  const sides = (all) => [n.kids.slice(0, at).flatMap((k) => unwrap(k, all)), n.kids.slice(at + 1).flatMap((k) => unwrap(k, all))];
  // (two icons held at another gap than the value's stay in their own frame)
  let [L, R] = sides(true);
  if (!even(gaps(L, R))) [L, R] = sides(false);
  if (!even(gaps(L, R))) return;
  const g = gaps(L, R);
  const end = R.length ? R[R.length - 1].x + R[R.length - 1].w : field.x + field.w - field.pad[1];
  asField(n, field.tag);
  n.pad = [0, Math.max(0, Math.round(n.x + n.w - end)), 0, Math.max(0, Math.round((L[0] || value).x - n.x))];
  n.gap = g.length ? Math.max(0, Math.round(g[0])) : R.length ? Math.max(0, Math.round(R[0].x - (field.x + field.w - field.pad[1]))) : 0;
  // (what a kept frame holds says the same place: the icon of an icon button on the right is a right-icon)
  const side = (k, part) => { k.part = part; (k.kids || []).forEach((x) => side(x, part)); };
  for (const k of L) side(k, "left");
  for (const k of R) side(k, "right");
  value.part = "text";
  value.sw = "FILL";
  n.kids = [...L, value, ...R];
}
function collapse(n) {
  if (n.k !== "frame") return;
  n.kids = n.kids.map((k) => {
    collapse(k);
    if (k.k !== "frame" || k.kids.length !== 1 || k.kids[0].abs) return k;
    const c = k.kids[0];
    const near = (a, b) => Math.abs(a - b) <= T;
    const same = near(c.x, k.x) && near(c.y, k.y) && near(c.w, k.w) && near(c.h, k.h);
    // a plain fill around a frame of its own box: the frame takes the fill (or covers it whole)
    if (!bare(k) && same && c.k === "frame" && (k.bg || k.clip) && !k.grad && !k.border && !k.shadow && !k.blur && !k.img && !k.op && !k.blend && !k.block && !k.revZ) {
      const covers = c.bg && !/rgba\([^)]*,\s*0?\.\d+\)/.test(c.bg) && (c.r || 0) <= (k.r || 0);
      if (k.bg && !covers && (c.bg || c.grad || c.img)) return k;
      if (k.bg && !c.bg) { c.bg = k.bg; c.r = c.r || k.r; }
      if (k.clip) { c.clip = true; c.r = c.r || k.r; }
      Object.assign(c, { abs: k.abs, sw: k.sw, sh: k.sh, pin: c.pin || k.pin, z: c.z ?? k.z, sc: c.sc || k.sc });
      if (!c.hint) c.hint = k.hint;
      if (!c.lm) c.lm = k.lm;
      return c;
    }
    if (!bare(k)) return k;
    const line = c.k === "text" && c.n === 1 && (!c.align || c.align === "LEFT") && near(c.x, k.x) && near(c.y, k.y) && near(c.h, k.h);
    if (!same && !line) return k;
    // padding carried on it (a gap to the next sibling, an offset) is spacing the child alone would lose
    if (k.pad?.some((v) => v > 0)) return k;
    // a hugging box around a laid-out frame: the frame keeps its own sizing (its fills inside it)
    // a text narrower than its hugging box keeps the box's width fixed (the box's padding was spacing)
    const sw = k.sw === "HUG" && c.k === "frame" ? c.sw : k.sw === "HUG" && c.k === "text" && !near(c.w, k.w) ? "FIXED" : k.sw;
    const sh = k.sh === "HUG" && c.k === "frame" ? c.sh : k.sh;
    // a text keeps its own line height (its cell already set it)
    Object.assign(c, { abs: k.abs, sw, sh, x: k.x, y: c.k === "text" ? c.y : k.y, w: k.w, h: c.k === "text" ? c.h : k.h, pin: c.pin || k.pin, z: c.z ?? k.z, sc: c.sc || k.sc });
    if (!c.hint) c.hint = k.hint;
    if (!c.lm && c.k === "frame") c.lm = k.lm;
    return c;
  });
}

// --- components ---------------------------------------------------------------------------

// Guard: the width each node will get from Figma's auto layout (FILL / HUG / FIXED as inferred),
// against its captured width. A node the rules would size wrong is pinned to its captured width:
// a wrong guess comes out rigid but right, never misplaced. Returns the number of nodes pinned.
const GUARD = 2; // px
const flowOf = (f) => (f.kids || []).filter((k) => !k.abs);
// width of a hugging node: its content's (texts, images, icons keep their captured width)
const hugW = (n) => {
  if (n.k !== "frame" || !n.dir) return n.w;
  const ks = flowOf(n);
  const fixed = ks.filter((k) => k.sw !== "FILL");
  // only filling children: nothing defines the width, Figma keeps the box's own
  if (!fixed.length) return n.w;
  const pads = (n.pad?.[1] || 0) + (n.pad?.[3] || 0);
  if (n.dir === "V") return Math.max(...fixed.map(sized)) + pads;
  const gaps = n.gaps ? n.gaps.reduce((a, b) => a + b, 0) : (n.gap || 0) * (ks.length - 1);
  return ks.reduce((a, k) => a + (k.sw === "FILL" ? k.w : sized(k)), 0) + gaps + pads;
};
const sized = (n) => (n.sw === "HUG" ? hugW(n) : n.w);
function guardWidths(root) {
  let pinned = 0;
  const visit = (n, w) => {
    // a frame (or an image / box) its parent would size off its captured width: fixed at it
    if (n.k !== "text" && n.k !== "svg" && n.sw !== "FIXED" && Math.abs(w - n.w) > GUARD) {
      if (process.env.ANGELO_GUARD) console.log("guard", n.id ?? n.kids?.[0]?.id, n.sw, Math.round(w), "->", Math.round(n.w));
      n.sw = "FIXED";
      w = n.w;
      pinned++;
    }
    if (n.k !== "frame") return;
    const ks = flowOf(n);
    // absolute layers keep their own size
    for (const k of n.kids) if (k.abs) visit(k, sized(k));
    if (!n.dir) { ks.forEach((k) => visit(k, sized(k))); return; }
    const inner = w - (n.pad?.[1] || 0) - (n.pad?.[3] || 0);
    if (n.dir === "V") { ks.forEach((k) => visit(k, k.sw === "FILL" ? inner : sized(k))); return; }
    const fill = ks.filter((k) => k.sw === "FILL");
    const gaps = n.justify === "SPACE_BETWEEN" ? 0 : n.gaps ? n.gaps.reduce((a, b) => a + b, 0) : (n.gap || 0) * (ks.length - 1);
    const rest = inner - gaps - ks.filter((k) => k.sw !== "FILL").reduce((a, k) => a + sized(k), 0);
    ks.forEach((k) => visit(k, k.sw === "FILL" ? rest / fill.length : sized(k)));
  };
  visit(root, root.w);
  return pinned;
}

// a sticky featured column (the page's script pins each item's image while its neighbour list scrolls): the
// static capture leaves each item one viewport of image, then a long empty gap. Each item's image takes its
// whole slot (item + the gap after it), its content padded down by the gap so it stays at the image's foot.
const PIN_GAP = 0.2; // of an item's height
function fillPinned(n) {
  if (n.k !== "frame") return;
  n.kids.forEach(fillPinned);
  const items = flowOf(n);
  if (n.dir !== "V" || items.length < 2 || n.bg || n.grad || n.img || !(n.gap > 0)) return;
  const near = (a, b) => Math.abs(a - b) <= 2;
  const mediaOf = (k) => k.k === "frame" && (k.kids || []).find((m) => m.abs && m.pin && (m.img || m.bg || (m.kids || []).some((c) => c.img)) && near(m.x, k.x) && near(m.y, k.y) && near(m.w, k.w) && near(m.h, k.h));
  const media = items.map(mediaOf);
  if (!media.every(Boolean) || n.gap < PIN_GAP * Math.min(...items.map((k) => k.h))) return;
  const g = n.gap, tail = n.pad && n.pad[2] >= 0.8 * g ? n.pad[2] : 0;
  const shift = (x, d) => { x.y += d; (x.kids || []).forEach((c) => shift(c, d)); };
  const grow = (x, h, d) => { if (near(x.h, h)) x.h += d; (x.kids || []).forEach((c) => grow(c, h, d)); };
  items.forEach((k, i) => {
    const d = i < items.length - 1 ? g : tail;
    if (!d) return;
    grow(media[i], media[i].h, d);
    k.pad = [(k.pad?.[0] || 0) + d, k.pad?.[1] || 0, k.pad?.[2] || 0, k.pad?.[3] || 0];
    flowOf(k).forEach((c) => shift(c, d));
    k.h += d;
  });
  n.gap = 0;
  if (tail) n.pad[2] -= tail;
}

// a fixed width its content already gives hugs it: the frame follows its text and its icons. Children
// first, a parent's content depends on theirs. A frame with a filling child or spreading its children
// takes its width from outside and stays fixed.
const HUG_FIT = 1; // px
function hugFitting(n, top = true) {
  if (n.k !== "frame") return;
  n.kids.forEach((k) => hugFitting(k, false));
  if (top || n.sw !== "FIXED" || !n.dir || n.img || n.justify === "SPACE_BETWEEN" || flowOf(n).some((k) => k.sw === "FILL")) return;
  if (flowOf(n).length && Math.abs(hugW(n) - n.w) <= HUG_FIT) n.sw = "HUG";
}

const fontSig = (f) => [f.family, f.size, f.weight, f.italic, f.lh, f.ls, f.transform, f.deco, ...(f.stretch ? [f.stretch] : [])].join(",");
const boxSig = (n) => [n.bg ? "bg" : "", n.grad ? n.grad.map((g) => g.type + g.stops.length).join("+") : "", n.border ? JSON.stringify({ ...n.border, c: 0 }) : "", n.r || "", n.rs ? n.rs.join("/") : "", n.shadow ? JSON.stringify({ ...n.shadow, c: 0 }) : "", n.blur ? "blur" + n.blur.r : "", n.op || "", n.img ? "img" : "", n.clip ? "clip" : "", n.crop ? "crop" + n.crop.join(":") : "", n.rot ? "r" + n.rot : ""].join(",");
// the tree can be signed again: a leaf's signature never changes, a frame's paint does not either
// (only its children do)
const signedLeaf = new WeakSet();
// picked blocks, while the tree is signed for grouping: referenced by family in their parent
let NESTED = null;
const boxSigs = new WeakMap();
const boxSigOf = (n) => {
  let s = boxSigs.get(n);
  if (s === undefined) boxSigs.set(n, (s = boxSig(n)));
  return s;
};
// a nested frame's fixed size: Figma ignores a resize on an instance sublayer, so it is part of the variant
const fixedDims = (k) => (k.sw === "FIXED" ? Math.round(k.w) : "") + "x" + (k.sh === "FIXED" ? Math.round(k.h) : "");
function sign(n) {
  if (n.k !== "frame" && signedLeaf.has(n)) return;
  let s;
  if (n.k === "text") s = ["t", n.align, n.sw, n.indent ? "i" : "", n.hang ? "h" : "", n.trim ? "tr" : "", n.rot ? "r" + n.rot : "", ...n.runs.map((r) => fontSig(r.font))].join("|") + (n.blend ? "|b:" + n.blend : "");
  else if (n.k === "svg") s = "v|" + hash(iconShape(n.svg));
  else if (n.k !== "frame") s = [n.k, n.sw, n.sh, boxSigOf(n)].join("|");
  else {
    for (const k of n.kids) sign(k);
    flattenLabel(n);
    // a frame's own sizing belongs to its parent (one instance may fill, another not): children carry theirs
    // an image cover's padding follows the image (caption laid under it): an instance override, not structure
    // an icon is an instance swapped per occurrence: its size only
    const ref = (k) => (k.k === "svg" ? "icon" + Math.round(k.w) + "x" + Math.round(k.h) : NESTED?.has(k) ? "c:" + k.fam : k.sig);
    s = ["f", n.dir, n.img ? "" : n.pad, n.gap, n.align, n.justify, boxSigOf(n), n.wrap ? "w" : "", n.revZ ? "rz" : ""].join("|") + (n.slot ? "{slot}" : "{" + n.kids.map((k) => (k.abs ? "@" + k.abs.x + "," + k.abs.y : "") + (k.k === "frame" ? k.sw + k.sh + fixedDims(k) : "") + ref(k)).join(";") + "}");
  }
  // an image background is content too
  n.leaves = n.k === "frame" ? n.kids.reduce((a, k) => a + k.leaves, n.img ? 1 : 0) : 1;
  // a fixed size can't be overridden on an instance sublayer (Figma ignores the resize): part of the variant
  const dims = n.k !== "frame" && n.k !== "text" ? "|" + (n.sw === "FIXED" ? Math.round(n.w) : "") + "x" + (n.sh === "FIXED" ? Math.round(n.h) : "") : "";
  n.sig = hash(s + dims);
  // family: the same block once absolute extras (an icon over a headline…) are set aside: one component
  if (n.k === "text") n.fam = hash(s.replace("|i|", "||")); // a first-line indent makes room for an inline icon
  else if (n.k !== "frame") n.fam = hash(s); // its size apart: same family, another variant
  if (n.k !== "frame") signedLeaf.add(n);
  else {
    // absolute extras are set aside only while they are extras: labels laid over a drawing (svg <text>) are its content,
    // the drawing alone would join every lone icon's family
    const abs = n.kids.filter((k) => k.abs);
    const flow = abs.length > n.kids.length - abs.length ? n.kids : n.kids.filter((k) => !k.abs);
    // padding apart: the same block more or less padded is the same component, overridden
    // and a row's gap next to a filling child: the slack of its content (a title's length), not its structure
    // (a slot's too under 1 px: subpixel widths read the same row at gap 0 or 1)
    const head = ["f", n.dir, (n.slot && n.gap <= 1) || (n.dir === "H" && flow.some((k) => k.sw === "FILL")) ? "" : n.gap, n.align, n.justify, boxSigOf(n), n.wrap ? "w" : "", n.revZ ? "rz" : ""].join("|");
    n.fam = (n.synth || n.wrap) && flow.length === 1 ? flow[0].fam : hash(head + (n.slot ? "{slot}" : "{" + flow.map((k) => (k.k === "svg" ? "icon" : k.fam)).join(";") + "}"));
    // every button is one family: filled / outline and sizes are overrides of one main
    // (what the source does not make pressable is a chip, and a row that fills its parent another thing)
    if (isButton(n)) { n.btn = true; n.fam = hash((n.tag === "button" || n.tag === "a" ? "button" : "chip") + (n.sw === "FILL" ? "+fill" : "") + (flow.some((k) => k.k === "svg") ? "+icon" : "")); }
    // a cell of a grid of media cards: one family whatever its width or options
    if (n.cellFam) n.fam = n.cellFam;
    else if (n.kindFam) n.fam = n.kindFam;
  }
}

// a button: a small rounded painted frame holding one label (and at most one icon)
const isButton = (n) => {
  if (n.k !== "frame" || n.field || !(n.bg || n.border) || !n.r || n.h > 64) return false;
  // (what the page does not declare pressable is a pill or nothing: a chat bubble is no button)
  if (n.tag !== "button" && n.tag !== "a" && n.r < Math.min(n.w, n.h) / 2 - 1) return false;
  const flow = n.kids.filter((k) => !k.abs);
  return flow.filter((k) => k.k === "text").length === 1 && flow.filter((k) => k.k === "svg").length <= 1 && flow.every((k) => k.k === "text" || k.k === "svg");
};
// A button around its one label has no direction to speak of: told as a row, so stacked and row-laid buttons are one main.
const flattenLabel = (n) => {
  if (n.dir !== "V" || n.wrap || n.gaps || n.offs?.some(Boolean) || !isButton(n) || n.kids.filter((k) => !k.abs).length !== 1) return;
  n.dir = "H";
  [n.align, n.justify] = [n.justify === "SPACE_BETWEEN" ? "MIN" : n.justify, n.align];
  n.offs = undefined;
};
// What a variant is, against the component's first: what the instance can't override, in words a person would use.
const VARIANT_BOX = [["blur", "Blurred"], ["img", "With image"], ["clip", "Clipped"], ["rot", "Rotated"], ["tile", "Tiled"], ["dash", "Dashed"], ["fx", "With effects"], ["blend", "Blended"], ["wrap", "Wrapped"], ["revZ", "Reversed"]];
const KIND_WORD = { text: "Text", svg: "Icon", img: "Image", rect: "Shape", frame: "Group" };
const variantWord = (a, b) => {
  if (a.k !== b.k) return KIND_WORD[b.k] || "Other";
  if (a.dir !== b.dir && b.dir) return b.dir === "V" ? "Vertical" : "Horizontal";
  if (!a.shadow !== !b.shadow) return b.shadow ? "Raised" : "Flat";
  for (const [k, word] of VARIANT_BOX) if (!a[k] !== !b[k]) return b[k] ? word : "Plain";
  if (a.shadow) return "Raised";
  return b.h > a.h ? "Large" : b.h < a.h ? "Small" : b.w > a.w ? "Wide" : b.w < a.w ? "Narrow" : "Alternate";
};
const MIN_SHAPE = 8; // same threshold as H.lint: one text, one icon are alike by nature
const WIDE_APART = 1.25; // two widths this far apart read as two widths
const TEXT_STACK = /^fap?\(t(,t)+\)$/; // a frame of text lines, as unionShape writes it
const MEDIA_CARD_LEAVES = 12; // more layers than this around an image is a section, not a card
const unionShape = (u, P, top = true) => {
  const r = u.rep;
  if (r.k !== "frame") return r.k[0];
  if (!top && P.has(r)) return "c";
  return `f${r.dir ? "a" : ""}${r.bg || r.grad || r.border || r.img || r.shadow || r.blur || r.op || r.blend || r.clip ? "p" : ""}(${(u.kids || []).map((k) => unionShape(k, P, false)).join(",")})`;
};
const nestedFams = (u, P, out = new Set()) => {
  for (const k of u.kids || []) {
    if (P.has(k.rep)) out.add(k.rep.fam);
    nestedFams(k, P, out);
  }
  return out;
};
const labelParts = (label) => (label.includes("=") ? Object.fromEntries(label.split(",").map((p) => p.split("=").map((x) => x.trim()))) : label === "Default" ? {} : { Variant: label });
// Components of one name and one structure are one component: their mains stay as they are, as the
// variants of one set, told apart by title size, then width, then where they sit. Instances don't change.
function mergeAlike(comps, P) {
  const byFamily = new Map(comps.map((c) => [c.fam, c]));
  const holds = new Map(comps.map((c) => [c, new Set(c.vars.flatMap((v) => [...nestedFams(v.u, P)]))]));
  // (Figma refuses a set holding an instance of itself, however deep)
  const reaches = (c, fam, seen = new Set()) => {
    for (const f of holds.get(c) || []) {
      if (f === fam) return true;
      if (seen.has(f) || !byFamily.has(f)) continue;
      seen.add(f);
      if (reaches(byFamily.get(f), fam, seen)) return true;
    }
    return false;
  };
  const groups = new Map();
  for (const c of comps) {
    if (/^Icon \//.test(c.name) || c.occ.some((n) => n.lm)) continue;
    const s = unionShape(c.vars[0].u, P);
    // bare lines of text stacked the same way are one component, whatever each is called; a flat
    // background is no shape (a rounded or outlined box is)
    const r = c.vars[0].u.rep;
    const stack = !c.kit && TEXT_STACK.test(s) && !r.r && !r.border && !r.shadow && !r.grad && !r.img && !r.blur;
    if (s.length < MIN_SHAPE && !stack) continue;
    const key = stack ? ["text stack", r.dir, s.replace("fap", "fa")].join("|") : [c.name, c.kit || "", s].join("|");
    (groups.get(key) || groups.set(key, []).get(key)).push(c);
  }
  const gone = new Set();
  for (const all of groups.values()) {
    const g = [];
    for (const c of [...all].sort((a, b) => b.count - a.count)) if (!g.some((d) => reaches(c, d.fam) || reaches(d, c.fam))) g.push(c);
    if (g.length < 2) continue;
    const size = (c) => Math.round(Math.max(0, ...c.kinds.filter((k) => k.text).map((k) => k.font.size)));
    const sizes = [...new Set(g.map(size))].sort((a, b) => b - a);
    const words = SIZES[sizes.length];
    const rows = g.flatMap((c) => c.vars.map((v) => ({ c, v, parts: labelParts(v.label) })));
    const key = (r) => JSON.stringify([r.parts.Size, r.parts.Width, r.parts.Variant]);
    const collide = () => rows.filter((r) => rows.some((o) => o !== r && key(o) === key(r)));
    if (words) for (const r of rows) r.parts.Size = words[sizes.indexOf(size(r.c))];
    const [lo, hi] = [Math.min(...g.map((c) => c.w)), Math.max(...g.map((c) => c.w))];
    if (collide().length && hi / lo >= WIDE_APART) for (const r of rows) r.parts.Width ||= r.c.w >= Math.sqrt(lo * hi) ? "Wide" : "Narrow";
    for (const r of collide()) if (!r.parts.Variant && r.c.near) r.parts.Variant = r.c.near;
    const seen = new Map();
    for (const r of collide()) {
      const k = key(r);
      const nth = (seen.get(k) || 0) + 1;
      seen.set(k, nth);
      if (nth > 1) r.parts.Variant = (r.parts.Variant ? r.parts.Variant + " " : "Alternate ") + String.fromCharCode(64 + nth);
    }
    const axes = ["Size", "Width", "Variant"].filter((a) => rows.some((r) => r.parts[a]));
    for (const r of rows) r.v.label = axes.length === 1 && axes[0] === "Variant" ? r.parts.Variant || "Default" : axes.map((a) => a + "=" + (r.parts[a] || "Default")).join(", ");
    const [head, ...rest] = g;
    for (const c of rest) {
      head.vars.push(...c.vars);
      head.occ.push(...c.occ);
      head.roles.push(...c.roles);
      head.count += c.count;
      gone.add(c);
    }
  }
  if (gone.size) comps.splice(0, comps.length, ...comps.filter((c) => !gone.has(c)));
}
const ROW_STEP = 8; // px: rows this close in height are the same row
const MIN_CELLS = 2;
const CELL_TOP = 8; // px: media blocks this close in height are the same grid's

// Layers two occurrences of a component can share: one main shows both through overrides. What an
// instance can't override (direction, alignment, effects, rotation…) tells them apart.
// (a field's shadow is an override: with or without, it is the same Input)
const boxKey = (n) => [n.r != null ? "" : "", n.shadow && !n.field ? JSON.stringify({ ...n.shadow, c: 0 }) : "", n.blur ? "blur" + n.blur.r : "", n.img ? "img" : "", n.clip ? "clip" : "", n.rot ? "r" + n.rot : "", n.tile || "", n.dash ? "dash" : "", n.fx ? JSON.stringify(n.fx) : "", n.blend || ""].join(",");
const near = (a, b) => Math.abs(a - b) <= 1;
const pairable = (a, b, P) => {
  if (a.k !== b.k || !!a.abs !== !!b.abs || P.has(a) !== P.has(b) || a.part !== b.part) return false;
  // an absolute layer's place can't be overridden in an instance: one layer per place, each optional.
  // The same place is the same distance to either edge of its parent (a badge 15 px from the right of
  // cards of any width): a constraint of the main follows it
  if (a.abs && !((near(a.abs.x, b.abs.x) || near(a.abs.r, b.abs.r)) && (near(a.abs.y, b.abs.y) || near(a.abs.b, b.abs.b)))) return false;
  // (the alignment of a text hugging its one line draws nothing: two layers for it = two labels in one pill)
  if (a.k === "text") return (a.align === b.align || (oneLine(a) && oneLine(b))) && !a.rot === !b.rot && !a.trim === !b.trim && !a.hang === !b.hang && a.blend === b.blend;
  if (a.k === "svg") return true;
  if (boxKey(a) !== boxKey(b)) return false;
  if (a.k !== "frame") return true;
  // a nested instance swaps only within its family
  if (P.has(a) && a.fam !== b.fam) return false;
  return a.dir === b.dir && !a.wrap === !b.wrap && !a.revZ === !b.revZ && !a.slot === !b.slot;
};
const pairScore = (a, b) => (a.fam === b.fam ? 3 : 1);
const plainFrame = (n, P) => n.k === "frame" && !n.abs && !n.img && !n.bg && !n.border && !n.slot && !P.has(n);
// a kid that fits inside a union frame (a caption without its icon, next to a row holding caption + icon):
// the kid of that frame it would be
// (a padded wrapper counts as its kid: the same caption in a row and alone in a wrapper is one layer)
const liftInto = (u, k, P) => (u.kids && !k.abs && plainFrame(u.rep, P) ? u.kids.find((x) => pairable(x.rep, k.wrap ? k.kids[0] : k, P)) : null);
// the other way round: a kid wrapping what the union holds bare; the kid of it that would be
const liftOver = (u, k, P) => (plainFrame(k, P) && !u.rep.abs ? k.kids.find((x) => pairable(u.rep, x, P)) : null);
// Weighted longest common subsequence of a union's kids and an occurrence's: [unionIndex, kidIndex] pairs.
function alignKids(us, ks, P) {
  const best = Array.from({ length: us.length + 1 }, () => new Array(ks.length + 1).fill(0));
  const fit = (i, j) => {
    const u = us[i], k = ks[j];
    if (pairable(u.rep, k, P)) return pairScore(u.rep, k) * 2;
    // a padded wrapper is only its kid and a gap: as good as the kid itself
    const x = liftInto(u, k, P);
    if (x) return pairScore(x.rep, k) * (u.rep.wrap ? 2 : 1);
    const y = liftOver(u, k, P);
    return y ? pairScore(u.rep, y) * (k.wrap ? 2 : 1) : 0;
  };
  for (let i = us.length - 1; i >= 0; i--) for (let j = ks.length - 1; j >= 0; j--) {
    const f = fit(i, j);
    best[i][j] = Math.max(best[i + 1][j], best[i][j + 1], f ? f + best[i + 1][j + 1] : 0);
  }
  const pairs = [];
  for (let i = 0, j = 0; i < us.length && j < ks.length; ) {
    const f = fit(i, j);
    if (f && best[i][j] === f + best[i + 1][j + 1]) pairs.push([i++, j++]);
    else if (best[i][j] === best[i + 1][j]) i++;
    else j++;
  }
  return pairs;
}
// union of the occurrences of a component: every layer any of them has, in order. u = { rep, kids, count }
const unionOf = (n, uOf) => {
  const u = { rep: n, kids: null, count: 1 };
  uOf.set(n, u);
  return u;
};
function growUnion(u, n, P, uOf, top = false) {
  // a nested instance is merged in its own family
  if ((P.has(u.rep) && !top) || u.rep.slot || u.rep.k !== "frame") return;
  if (!u.kids) u.kids = [];
  const ks = n.kids || [];
  const pairs = alignKids(u.kids, ks, P);
  const match = new Map(pairs.map(([i, j]) => [j, i]));
  // the kids this occurrence is the first to have go right after the kid before them
  const next = [];
  let from = 0;
  ks.forEach((k, j) => {
    if (match.has(j)) {
      const i = match.get(j);
      for (; from <= i; from++) next.push(u.kids[from]);
      let ku = u.kids[i];
      if (!pairable(ku.rep, k, P)) {
        const x = liftInto(ku, k, P);
        if (x) {
          // a frame this occurrence lacks: it gets it at placing time, holding only this kid
          ku.count++;
          x.count++;
          uOf.set(k, x);
          if (k.wrap) uOf.set(k.kids[0], x);
          growUnion(x, k.wrap ? k.kids[0] : k, P, uOf);
        } else {
          // a frame the union lacks: it goes around what the union holds
          const w = unionOf(k, uOf);
          w.count = ku.count + 1;
          w.kids = [ku];
          next[next.length - 1] = w;
          growUnion(w, k, P, uOf);
        }
        return;
      }
      ku.count++;
      uOf.set(k, ku);
      if (k.abs) {
        // held by its far edge: flagged on the main's layer for its constraint
        if (!near(ku.rep.abs.x, k.abs.x)) ku.rep.abs.ax = true;
        if (!near(ku.rep.abs.y, k.abs.y)) ku.rep.abs.ay = true;
      }
      growUnion(ku, k, P, uOf);
    } else {
      const ku = unionOf(k, uOf);
      next.push(ku);
      growUnion(ku, k, P, uOf);
    }
  });
  for (; from < u.kids.length; from++) next.push(u.kids[from]);
  u.kids = next;
}

// Media cards of one grid (one image on top, a caption below in the same font, media blocks of the
// same height) are one component: a wider cell, a sold-out one without its cart icon, a sale badge
// are overrides and boolean properties of it, each product's image and texts its overrides. Structure
// hashes alone split them into a family per combination.
function markCells(root) {
  const isMedia = (n) => n.k === "img" || (n.k === "frame" && n.img);
  const all = (n, out = []) => { out.push(n); if (n.k === "frame") n.kids.forEach((k) => all(k, out)); return out; };
  const cells = [];
  const visit = (n) => {
    if (n.k !== "frame") return;
    const flow = n.kids.filter((k) => !k.abs);
    if (n !== root && n.dir === "V" && flow.length >= 2) {
      const top = all(flow[0]);
      const rest = flow.slice(1).flatMap((k) => all(k));
      const texts = rest.filter((k) => k.k === "text");
      if (top.filter(isMedia).length === 1 && texts.length && !rest.some(isMedia)) {
        cells.push({ n, top: flow[0].h, font: mostCommon(texts.map((t) => fontSig(t.runs[0].font))) });
        return;
      }
    }
    n.kids.forEach(visit);
  };
  visit(root);
  const byFont = new Map();
  for (const c of cells) (byFont.get(c.font) || byFont.set(c.font, []).get(c.font)).push(c);
  for (const [font, list] of byFont) {
    list.sort((a, b) => a.top - b.top);
    let group = [];
    const close = () => {
      if (group.length >= MIN_CELLS && new Set(group.map((c) => c.n.fam)).size > 1) {
        const fam = hash("cell|" + font + "|" + Math.round(group[0].top));
        for (const c of group) c.n.cellFam = fam;
      }
      group = [];
    };
    for (const c of list) {
      if (group.length && c.top - group.at(-1).top > CELL_TOP) close();
      group.push(c);
    }
    close();
  }
}

const leavesOf = (n, out = []) => {
  if (n.k === "frame") n.kids.forEach((k) => leavesOf(k, out));
  else out.push(n);
  return out;
};
// leaf → item-like object for the naming helpers
const asItem = (l) =>
  l.k === "text"
    ? { id: l.id, text: l.runs.map((r) => r.text).join(""), font: l.runs.reduce((m, r) => (r.font.size > m.font.size ? r : m)).font, x: l.x, y: l.y, w: l.w, h: l.h }
    : { id: l.id, x: l.x, y: l.y, w: l.w, h: l.h, svg: l.k === "svg" ? l.svg : undefined, img: l.k === "img" || undefined, bg: l.bg };

const ICON_MAX = 64; // px: same threshold as H.lint, above it a drawing is an illustration
const LEAF_ROLE = { svg: "Icon", img: "Image", rect: "Shape", text: "Text" };

export function layoutTree(cap, items) {
  const byId = new Map(cap.boxes.map((b) => [b.id, b]));
  // An icon's name: its own markup, then its classes, then the label most of its occurrences sit next to, then its shape.
  const textKids = new Map();
  for (const b of cap.boxes) if (b.text) (textKids.get(b.p) || textKids.set(b.p, []).get(b.p)).push(b);
  const labelNear = (id) => {
    let p = byId.get(id)?.p;
    for (let up = 0; up < 2 && p !== undefined && p !== -1; up++, p = byId.get(p)?.p) {
      const label = (textKids.get(p) || []).map((b) => iconFromText(b.text)).find(Boolean);
      if (label) return label;
    }
    return "";
  };
  // what the box holding the drawing calls itself, two levels up at most
  const hintNear = (id) => {
    let p = byId.get(id)?.p;
    for (let up = 0; up < 2 && p !== undefined && p !== -1; up++, p = byId.get(p)?.p) {
      const named = iconFromHint(byId.get(p)?.hint || "");
      if (named) return named;
    }
    return "";
  };
  const iconName = (occ) => {
    const leaf = leavesOf(occ[0])[0];
    // (occurrences of one drawing may carry their own label: the one most of them give)
    return mostCommon(occ.map((n) => iconFromSvg(leavesOf(n)[0].svg))) || mostCommon(occ.map((n) => iconFromText(byId.get(leavesOf(n)[0].id)?.said))) || iconFromHint(byId.get(leaf.id)?.hint || "") || iconFromHint(byId.get(occ[0].id)?.hint || "")
      || mostCommon(occ.map((n) => labelNear(leavesOf(n)[0].id))) || mostCommon(occ.map((n) => hintNear(leavesOf(n)[0].id))) || iconFromShape(leaf.svg);
  };
  const end = new Map();
  for (let k = cap.boxes.length - 1; k >= 0; k--) {
    const b = cap.boxes[k];
    end.set(b.id, Math.max(end.get(b.id) ?? b.id, b.id));
    if (b.p !== -1) end.set(b.p, Math.max(end.get(b.p) ?? b.p, end.get(b.id)));
  }
  PAGE = cap.width;
  const root = buildTree(cap, items);
  // the capture's opacity is cumulative (for the flat build); nested Figma layers multiply it,
  // so each node keeps its share of its nearest ancestor's
  const relOp = (n, above = 1) => {
    const own = n.op ?? above;
    const r = Math.round((own / above) * 100) / 100;
    n.op = r < 1 ? r : undefined;
    for (const k of n.kids || []) relOp(k, own);
  };
  relOp(root);
  mergeStruck(root);
  root.sw = root.sh = "FIXED";
  layout(root);
  collapse(root);
  hugFitting(root);
  fillPinned(root);
  markFields(root);
  const fixedW = guardWidths(root);
  sign(root);

  const count = new Map();
  const walk = (n, f) => { f(n); if (n.k === "frame") n.kids.forEach((k) => walk(k, f)); };
  // a row that only holds one block plus absolute extras shares its family: counted once
  const recount = () => {
    count.clear();
    walk(root, (n) => { for (const k of n.kids || []) if (k.fam !== n.fam) count.set(k.fam, (count.get(k.fam) || 0) + 1); });
  };
  recount();
  const HEAD = /^h[1-6]$/;
  const textsOnly = (n) => n.k === "text" || (n.k === "frame" && !n.img && !n.field && n.kids.every((k) => textsOnly(k) || (k.btn && k.k === "frame")));
  const hasHeading = (n) => (n.k === "text" && HEAD.test(byId.get(n.id)?.tag || "")) || (n.kids || []).some(hasHeading);
  // section headings (an h1-h6 with its kicker, text, buttons: no paint) are one family whatever their parts,
  // options of one component: it is a component once the page repeats it
  const headings = [];
  walk(root, (n) => {
    if (n !== root && n.k === "frame" && !n.btn && !n.field && !n.img && !n.synth && !n.wrap && !n.cellFam && !n.kindFam && !n.bg && !n.grad && !n.border && !n.shadow && n.leaves >= 2 && n.leaves <= 6 && n.h < 0.6 * root.h && textsOnly(n) && hasHeading(n)) headings.push(n);
  });
  // (a heading holding a heading is the outer block's part: only the innermost one is kept)
  const innermost = headings.filter((n) => !headings.some((m) => m !== n && (function inside(x) { return (x.kids || []).some((k) => k === m || inside(k)); })(n)));
  if (innermost.length > 1) for (const n of innermost) n.fam = n.kindFam = hash("section heading");
  recount();
  // the kit's one row: rows of a height, already repeated, differ by an option (an image, a second line,
  // a trailing tag), not by being another component. Cards stay apart: merged, they split back into
  // more components than they had (measured on every captured page)
  const kinds = new Map();
  walk(root, (n) => {
    if (n.k !== "frame" || n === root || n.btn || n.synth || n.wrap || n.cellFam || !(count.get(n.fam) > 1)) return;
    if (recognize(n, KIT, { count: count.get(n.fam), pageW: PAGE })?.name !== "Row") return;
    const key = "row|" + Math.round(n.h / ROW_STEP);
    (kinds.get(key) || kinds.set(key, []).get(key)).push(n);
  });
  // painted blocks of one size wearing the same class are the site's own one component, whatever their
  // content (an issue card with an avatar, an icon or neither)
  const classed = new Map();
  walk(root, (n) => {
    if (n.k !== "frame" || n === root || !n.hint || !(n.bg || n.border) || n.btn || n.synth || n.wrap || n.cellFam || n.kindFam || n.img) return;
    const key = "class|" + n.hint + "|" + Math.round(n.w / ROW_STEP) + "|" + Math.round(n.h / ROW_STEP);
    (classed.get(key) || classed.set(key, []).get(key)).push(n);
  });
  for (const [key, list] of classed) if (list.length > 1 && new Set(list.map((n) => n.fam)).size > 1) for (const n of list) n.fam = n.kindFam = hash(key);
  recount();
  // atoms: icons, and small painted blocks met more than once (a tag pill, a round icon button):
  // components of their own wherever they sit
  // (an unpainted link or button with padding on both axes is a tag pill too: its paint only shows on hover)
  const pill = (n) => n.leaves === 1 && (n.tag === "a" || n.tag === "button") && n.pad?.[0] > 0 && n.pad?.[1] > 0;
  const atom = (n) => n.k === "svg" || (n.k === "frame" && (n.bg || n.border || pill(n)) && !n.img && n.h <= ATOM_H && n.leaves <= ATOM_LEAVES && count.get(n.fam) > 1);
  // a row of atoms in an organism is a slot: each instance holds its own list (two tags, one, none)
  // instead of a variant per combination. Atoms and molecules stay variants.
  const markSlots = (n) => {
    if (n.k !== "frame") return;
    n.kids.forEach(markSlots);
    if (n === root || !n.dir || n.img || atom(n)) return;
    const ks = n.kids.map((k) => (k.wrap ? k.kids[0] : k));
    // (atoms of a list are alike in height: an icon above a product row is no list)
    const hs = ks.map((k) => k.h);
    if (ks.length && n.kids.every((k) => !k.abs) && ks.every(atom) && (ks.length > 1 || ks[0].k === "frame") && Math.max(...hs) <= 1.5 * Math.min(...hs)) n.slot = true;
  };
  markSlots(root);
  sign(root);
  recount();
  // (once marked, the holders' families have merged: their owners' repeats can be counted)
  const organism = (b) => {
    if (b.lm) return !["heading", "card"].includes(b.lm);
    const read = recognize(b, KIT, { count: count.get(b.fam), pageW: PAGE });
    return read ? read.level === "organism" : b.leaves > ATOM_LEAVES;
  };
  const holders = new Map();
  const settle = (n, owner) => {
    if (n.k !== "frame") return;
    if (n.slot) {
      // (an owner met once has no other instance to hold another list)
      if (!owner || count.get(owner.fam) < 2 || !organism(owner)) n.slot = false;
      else (holders.get(n.fam) || holders.set(n.fam, []).get(n.fam)).push(n);
    }
    const next = n !== root && !n.wrap && (n.lm || count.get(n.fam) > 1) ? n : owner;
    n.kids.forEach((k) => settle(k, next));
  };
  settle(root, null);
  // a list every occurrence holds alike needs no slot, nor do rows that never hold more than one atom
  const listOf = (n) => n.kids.map((k) => (k.wrap ? k.kids[0] : k).fam).join(";");
  for (const list of holders.values()) if (new Set(list.map(listOf)).size < 2 || list.every((n) => n.kids.length < 2)) for (const n of list) n.slot = false;
  sign(root);
  recount();
  markCells(root);
  sign(root);
  recount();
  // outermost blocks: landmarks, and repeated ones
  // a nav of shapes alone (a slider's dots) names nothing a person navigates: no landmark
  const labelled = (n) => n.k === "text" || n.k === "svg" || n.k === "img" || (n.kids || []).some(labelled);
  walk(root, (n) => { if (n.lm === "nav" && !labelled(n)) n.lm = undefined; });
  // Atomic design: atoms (button, field, icon), molecules (card, section heading, a menu's item),
  // organisms (header, footer, a menu of items). A card and a menu are components even met once, like a header (a
  // section heading only when it repeats, see the heading family above): they hold instances of the atoms inside them.
  const menuBox = (n) => ["menu", "menubar"].includes(byId.get(n.id)?.role) || ((n.hint ? words(n.hint) : []).some((w) => ["submenu", "dropdown", "megamenu"].includes(w)) && n.leaves >= 4);
  walk(root, (n) => {
    if (n === root || n.lm || n.k !== "frame" || n.btn || n.field || n.img || n.h >= 0.6 * root.h) return;
    if (menuBox(n)) n.lm = "menu";
    else if (recognize(n, KIT, { count: 1, pageW: PAGE })?.name === "Card") n.lm = "card";
  });
  const picked = [];
  // a page's top block is not a repeat, nor what holds most of it: other blocks may look like it (examples
  // of a carousel would share one union of layers, sizes included), it stays plain frames down to its parts
  let bodyOf = 0;
  const pick = (n) => {
    const was = bodyOf;
    if (n.block && root.kids?.includes(n)) bodyOf = n.leaves / 2;
    pickIn(n);
    bodyOf = was;
  };
  // an unpainted block holding nothing but repeated blocks (and dividers) is a grid or a section, not a component:
  // its cards are, and it stays plain frames, however often the arrangement comes back.
  // A grid's blocks stand alone: alike, or each with its own image and text. A media block above a text block
  // is one card, a molecule of two parts, and stays a component.
  const carries = (n, test) => test(n) || (n.kids || []).some((k) => carries(k, test));
  const wholeCard = (b) => carries(b, (x) => x.k === "img" || x.img) && carries(b, (x) => x.k === "text");
  const isArrangement = (n) => {
    if (n.k !== "frame" || n.lm || n.btn || n.field || n.slot || n.img || n.bg || n.grad || n.border || n.shadow || n.blur || !n.kids.length) return false;
    const blocks = n.kids.filter((k) => k.k !== "rect").map((k) => (k.wrap ? k.kids[0] : k));
    if (!blocks.length || !blocks.every((b) => b.k === "frame" && b.leaves > 1 && (isArrangement(b) || count.get(b.fam) > 1))) return false;
    return blocks.length === 1 || new Set(blocks.map((b) => b.fam)).size === 1 || blocks.every((b) => isArrangement(b) || wholeCard(b));
  };
  const pickIn = (n) => {
    if (n.wrap) { n.kids[0].lm ||= n.lm; return pick(n.kids[0]); }
    if (n !== root && isArrangement(n)) return n.kids.forEach((k) => pick(k));
    // a one-line field met twice is an Input wherever it sits, even alone in a page's top block
    if (n.field && count.get(n.fam) > 1) { picked.push(n); return nest(n); }
    // a nav, header or footer stays one even drawn as a single svg; a mere class name needs more than one thing
    if (n !== root && n.lm && n.k === "frame" && n.h < 0.6 * root.h && (n.leaves >= 2 || !["search", "filters"].includes(n.lm))) { picked.push(n); return nest(n); }
    // a repeated block that is mostly a block repeated more often (divider + card): go for the card
    // a row holding only grid cells is layout: the cells are the components
    if (n.kids?.length && n.kids.every((k) => (k.wrap ? k.kids[0] : k).cellFam)) return n.kids.forEach((k) => pick(k));
    const core = n.kids?.find((k) => k.k === "frame" && count.get((k.wrap ? k.kids[0] : k).fam) > count.get(n.fam));
    if (core && !n.img && n.kids.every((k) => k === core || k.k === "rect")) return n.kids.forEach((k) => pick(k));
    // a component is what repeats: a block met once stays plain frames (a bare text repeated is a text style, not a component)
    if (n !== root && n.k !== "text" && count.get(n.fam) > 1 && n.leaves <= MAX_REPEAT && !(bodyOf && n.leaves >= bodyOf)) { picked.push(n); return nest(n); }
    (n.kids || []).forEach((k) => pick(k));
  };
  // inside a picked block, blocks repeated more often than it (cards in a row…) are components of
  // their own: nested instances (a card's caption, always with its card, stays plain)
  const timesIn = (n, fam) => (n.kids || []).reduce((a, k) => a + (k.fam === fam && !k.wrap ? 1 : 0) + timesIn(k, fam), 0);
  const nest = (n, top = n) => {
    for (const k of n.kids || []) {
      const b = k.wrap ? k.kids[0] : k;
      // a slot belongs to its organism: its atoms are the components, not the row holding them
      if (b.slot) { nest(b, top); continue; }
      // the part holding that slot, once per occurrence of a repeated block, is its body, not a repeat
      if (count.get(top.fam) > 1 && b.kids?.some((x) => x.slot) && timesIn(top, b.fam) === 1) { nest(b, top); continue; }
      // a small label laid over the block, not a control
      if (b.k === "frame" && (b.abs || k.abs) && b.leaves === 1 && b.tag !== "button" && b.tag !== "a" && b.w * b.h < 0.25 * top.w * top.h) b.badge = true;
      if (b.k === "frame" && (b.leaves > 1 || b.btn || top.lm) && count.get(b.fam) > (count.get(top.fam) || 1) && !isArrangement(b)) { picked.push(b); nested.add(b.fam); nest(b); }
      // a landmark's repeated items (a filter, a footer link), even bare texts
      else if (top.lm && b.k === "text" && count.get(b.fam) > 1) { picked.push(b); nested.add(b.fam); }
      else if (atom(b)) { b.host = top.fam; picked.push(b); nested.add(b.fam); nest(b); }
      // a painted or absolute block on only some occurrences, met twice or more (a sale badge): a
      // component of its own, shown or hidden by a boolean of its holder
      else if (b.k === "frame" && !b.img && (b.abs || k.abs || b.bg || b.border) && b.w * b.h < 0.25 * top.w * top.h && count.get(b.fam) >= 2 && count.get(b.fam) < (count.get(top.fam) || 1)) { picked.push(b); nested.add(b.fam); nest(b); }
      else if (k.k === "frame") nest(k, top);
    }
  };
  const nested = new Set();
  pick(root);
  // a block of a nested family left plain in another occurrence (one leaf short): nested there too,
  // so both occurrences hold the same instance
  const P = new Set(picked);
  // (a padded wrapper shares its kid's family: the kid is the component, not it)
  const more = (n) => { for (const k of n.kids || []) { if (k.k === "frame" && !k.wrap && !P.has(k) && nested.has(k.fam)) { picked.push(k); P.add(k); } more(k); } };
  for (const n of [...picked]) more(n);
  // a family picked only once (its other occurrences sit inside a block of their own): nothing repeats
  // (an icon met once in a repeated block stays one: another occurrence swaps to it, a plain drawing can't be overridden)
  const picks = new Map();
  for (const n of picked) picks.set(n.fam, (picks.get(n.fam) || 0) + 1);
  // (same in a landmark, met once by nature: its icons are swappable like any other)
  const lmFams = new Set(picked.filter((n) => n.lm).map((n) => n.fam));
  const swappable = (n) => n.k === "svg" && (picks.get(n.host) > 1 || (lmFams.has(n.host) && Math.max(n.w, n.h) <= ICON_MAX));
  for (let i = picked.length - 1; i >= 0; i--) if (picks.get(picked[i].fam) < 2 && !picked[i].lm && !swappable(picked[i])) { P.delete(picked[i]); picked.splice(i, 1); }
  // a block that is itself a row of atoms: its main holds the list (an instance root can't be a slot)
  for (const n of picked) n.slot = false;
  // a nested instance counts by its family in its parent: its own variant is swapped per occurrence
  NESTED = P;
  sign(root);
  NESTED = null;
  // a block nested in a block of its own family gets a family of its own: Figma refuses to swap an
  // instance to a variant of the set that holds its ancestor instance (cos: image wrapper in the card wrapper)
  const own = (n, up) => {
    for (const k of n.kids || []) {
      if (!P.has(k)) { own(k, up); continue; }
      const f = k.fam, d = up.filter((u) => u === f).length;
      if (d) k.fam = hash(f + "|in" + d);
      own(k, [...up, f]);
    }
  };
  own(root, []);

  // one component per family, no variant: the main holds every layer any occurrence has, sizes and
  // content are overrides, an optional layer a boolean property. A variant is left only for what an
  // instance can't override (another direction, other effects).
  walk(root, (n) => { for (const k of n.kids || []) if (k.abs) k.abs = { ...k.abs, r: n.w - k.abs.x - k.w, b: n.h - k.abs.y - k.h }; });
  const byFam = new Map();
  for (const n of picked) (byFam.get(n.fam) || byFam.set(n.fam, []).get(n.fam)).push(n);
  // occurrences sharing no layer are not one thing (a card's media, a footer row): each group its own
  // component, never a union of layers no occurrence holds together
  const kidsOf = (n) => (n.kids || []).map((k) => ({ rep: k }));
  for (const [fam, occ] of [...byFam]) {
    if (occ.some((n) => n.k !== "frame")) continue;
    const groups = [];
    for (const n of occ) {
      const g = groups.find((g) => g.some((m) => !m.kids?.length || !n.kids?.length || alignKids(kidsOf(m), n.kids, P).length));
      if (g) g.push(n);
      else groups.push([n]);
    }
    if (groups.length < 2) continue;
    groups.sort((a, b) => b.length - a.length);
    byFam.delete(fam);
    groups.forEach((g, i) => {
      // alone in its group: nothing repeats, plain frames
      if (g.length < 2 && !g[0].lm) { P.delete(g[0]); return; }
      const f = i ? hash(fam + "|part" + i) : fam;
      g.forEach((n) => (n.fam = f));
      byFam.set(f, g);
    });
  }
  const comps = [];
  const uOf = new Map();
  // two sizes of a media block (a grid's wide and narrow cards): one variant each, one set of layers
  const holdsMedia = (n) => n.k === "frame" && n.kids.some((k) => (k.k === "img" && k.w >= 0.5 * n.w) || (k.img && k.w >= 0.5 * n.w) || (!P.has(k) && k.w >= 0.5 * n.w && holdsMedia(k)));
  // (the ratio of its main image: a sublayer's size cannot change in an instance, one ratio per variant locks it)
  const mainRatio = (n) => {
    for (const k of n.kids || []) {
      if ((k.k === "img" || (k.img && !k.kids?.length)) && k.w >= 0.5 * n.w && k.h > 0) return k.w / k.h;
      if (!P.has(k) && k.k === "frame" && k.w >= 0.5 * n.w) { const r = mainRatio(k); if (r) return r; }
    }
    return 0;
  };
  const splitBy = (occ, classes) => {
    const top = classes.filter((c) => c.length >= 2).sort((a, b) => b.length - a.length).slice(0, 2);
    if (top.length < 2) return null;
    const [wide, narrow] = top[0][0].w > top[1][0].w ? top : [top[1], top[0]];
    const lo = Math.min(...wide.map((n) => n.w)), hi = Math.max(...narrow.map((n) => n.w));
    if (lo / hi < 1.25) return null;
    const mid = (lo + hi) / 2;
    return [{ wc: "Wide", occ: occ.filter((n) => n.w >= mid) }, { wc: "Narrow", occ: occ.filter((n) => n.w < mid) }];
  };
  const widthSplit = (occ) => {
    if (occ.length < 4 || !occ.every((n) => n.sw !== "HUG" && holdsMedia(n))) return null;
    const byW = [];
    for (const n of [...occ].sort((a, b) => b.w - a.w)) {
      const c = byW[byW.length - 1];
      if (c && c[0].w / n.w < 1.2) c.push(n);
      else byW.push([n]);
    }
    const split = splitBy(occ, byW);
    if (split) return split;
    // widths too scattered for two classes (a 924 and a 456 beside four 292): the image ratios still part them
    const byR = [];
    for (const n of [...occ].sort((a, b) => b.w - a.w)) {
      const r = mainRatio(n);
      const c = r && byR.find((c) => Math.abs(mainRatio(c[0]) / r - 1) < 0.02);
      if (c) c.push(n);
      else if (r) byR.push([n]);
    }
    return splitBy(occ, byR);
  };
  // Figma refuses any size override on an instance sublayer ("cannot be overridden in an instance: size"):
  // occurrences whose image, shape or drawing layers keep different fixed sizes (a 518x324 and a 518x216
  // cover, a 1340x126 logo and a 26x26 search glyph in one header slot) are
  // one variant per size. A width-filling layer keys on its ratio (locked in the main, see ratioLocked)
  // Sizes compare layer by layer of the main (the union): a layer only some occurrences have (an optional
  // icon) is a boolean, not another size
  const dimsSplit = (occ) => {
    if (occ.length < 2) return null;
    const sizesOf = (n, q = 2) => {
      const out = new Map();
      const scan = (m) => {
        for (const k of m.kids || []) {
          if (k.k === "img" || k.k === "rect" || k.k === "svg" || (k.k === "frame" && k.img && !k.kids?.length)) {
            out.set(uOf.get(k) ?? k, k.sw === "FILL" ? (k.h > 0 ? "r" + (k.w / k.h).toFixed(2) : "") : (k.sw === "FIXED" ? Math.round(k.w / q) * q : "") + "x" + (k.sh === "FIXED" ? Math.round(k.h / q) * q : ""));
          } else if (k.k === "frame" && !P.has(k)) scan(k);
        }
      };
      scan(n);
      return out;
    };
    // each occurrence joins the first class it agrees with on every layer both have
    const classes = [];
    for (const n of occ) {
      const s = sizesOf(n);
      const c = classes.find((c) => [...s].every(([u, v]) => !c.s.has(u) || c.s.get(u) === v));
      if (c) { s.forEach((v, u) => c.s.set(u, v)); c.occ.push(n); }
      else classes.push({ s, occ: [n] });
    }
    // (past a handful of sizes, a masonry grid: one main, the sizes left wrong rather than a variant per card)
    if (classes.length < 2 || classes.length > 8) return null;
    // named by the sizes that set it apart: the layers two classes size differently
    const apart = new Set(classes.flatMap((c) => [...c.s].filter(([u, v]) => classes.some((d) => d.s.has(u) && d.s.get(u) !== v)).map(([u]) => u)));
    return classes.map((c) => {
      const exact = new Map(c.occ.flatMap((n) => [...sizesOf(n, 1)]));
      return { wc: [...apart].filter((u) => exact.has(u)).map((u) => exact.get(u)).filter((x) => /\d/.test(x)).join(" ") || "Default", occ: c.occ };
    });
  };
  // every media card of a page is one component, whatever its look: one family, so its layers join in one
  // main, optional ones a boolean, its sizes the width axis. A card holding a card keeps its own family
  // (Figma refuses a set holding an instance of itself).
  const hasText = (n) => n.k === "text" || (n.kids || []).some(hasText);
  const mediaCard = (n) => n.k === "frame" && !n.lm && !n.btn && !n.field && n.leaves <= MEDIA_CARD_LEAVES && hasText(n) && holdsMedia(n);
  const cards = new Set([...byFam].filter(([, occ]) => occ.every(mediaCard)).map(([fam]) => fam));
  const holdsCard = (n) => (n.kids || []).some((k) => (P.has(k) && cards.has(k.fam)) || holdsCard(k));
  const outer = [...cards].filter((fam) => byFam.get(fam).some(holdsCard));
  outer.forEach((fam) => cards.delete(fam));
  const cardsByDir = new Map();
  for (const fam of cards) {
    const dir = byFam.get(fam)[0].dir;
    (cardsByDir.get(dir) || cardsByDir.set(dir, []).get(dir)).push(fam);
  }
  // Same shape alone is no proof: two looks join only with the same type faces and weights (sizes follow the
  // width). A wrong split shows as a near duplicate on the board, a wrong join edits unrelated cards at once:
  // a product card and a person's portrait stay apart, at the price of some real card split by an optional line.
  const faces = (fam) => {
    const set = new Set();
    for (const n of byFam.get(fam)) walk(n, (m) => { if (m.k === "text") for (const r of m.runs || []) set.add(r.font?.family + "/" + r.font?.weight); });
    return [...set].sort().join("|");
  };
  for (const fams of cardsByDir.values()) {
    const looks = new Map();
    for (const fam of fams.sort((a, b) => byFam.get(b).length - byFam.get(a).length)) {
      const key = faces(fam);
      if (looks.has(key)) looks.get(key).push(fam);
      else looks.set(key, [fam]);
    }
    for (const [head, ...rest] of looks.values()) {
      for (const fam of rest) {
        for (const n of byFam.get(fam)) { n.fam = head; byFam.get(head).push(n); }
        byFam.delete(fam);
      }
    }
  }
  const topNav = Math.min(...[...P].filter((n) => n.lm === "nav").map((n) => n.y));
  const topOf = new Map();
  // a leaf as its occurrence's own layer: an atom (a link, an icon) is its own whole
  const unionAt = (n, l) => (l === n ? topOf.get(n) : uOf.get(l));
  for (const [fam, occ] of byFam) {
    const key = "C" + (comps.length + 1);
    const clusters = [];
    // the deepest occurrence first: the others' shallower kids lift into its frames
    const depth = (n) => (n.k === "frame" && !(P.has(n) && n !== cur) ? 1 + Math.max(0, ...n.kids.map(depth)) : 0);
    let cur = null;
    const richness = new Map(occ.map((n) => { cur = n; return [n, depth(n) * 1000 + n.leaves]; }));
    for (const n of [...occ].sort((a, b) => richness.get(b) - richness.get(a))) {
      // (an instance's own place belongs to its parent, not to its main)
      let c = clusters.find((c) => pairable({ ...c.u.rep, abs: null }, { ...n, abs: null }, new Set()));
      // (the union of an occurrence as a whole, apart from its place in a parent's union, in uOf)
      if (!c) { const u = { rep: n, kids: null, count: 1 }; clusters.push((c = { u, occ: [] })); }
      else c.u.count++;
      topOf.set(n, c.u);
      c.occ.push(n);
      growUnion(c.u, n, P, uOf, true);
    }
    // (a width class still holding two image ratios, a 16:9 video card beside a 1.59 one, splits again: its
    // instances can't take the other ratio)
    const sizes = (occ) => (widthSplit(occ) || [{ occ }]).flatMap((p) => (dimsSplit(p.occ) || [p]).map((q) => (q === p ? p : { wc: p.wc ? p.wc + " " + q.wc : q.wc, occ: q.occ })));
    const parts = clusters.sort((a, b) => b.occ.length - a.occ.length).flatMap((c, i) => sizes(c.occ).map((p) => ({ ...p, u: c.u, i })));
    const vars = parts.map((p, v) => ({ ...p, key: key + "." + (v + 1) }));
    const ls = leavesOf(occ[0]).map(asItem);
    const named = occ.map((n) => {
      const its = leavesOf(n).map(asItem);
      const hi = Math.max(...its.map((i) => end.get(i.id) ?? i.id));
      return nameOcc(byId, { id: n.id, end: Math.max(end.get(n.id) ?? n.id, hi) }, its);
    });
    // a name with no word in it (a counter "0", a price) names nothing: structure instead
    const worded = (v) => (/\p{L}{2}/u.test(v || "") ? v : undefined);
    // a leaf's role: what its occurrences call it, wherever it sits in each
    occ.forEach((n, i) => leavesOf(n).forEach((l, k) => { const u = unionAt(n, l); if (u) (u.roles ||= []).push(worded(named[i].roles[k])); }));
    const n0 = occ[0];
    let name = mostCommon(named.map((x) => worded(x.name)));
    if (!name) {
      if (n0.k === "svg") name = n0.w > 2 * n0.h && n0.w > 60 ? "Logo" : "Icon";
      else if (n0.k === "text") name = byId.get(n0.id)?.tag === "a" || byId.get(byId.get(n0.id)?.p)?.tag === "a" ? "Link" : ls[0].font.size >= 20 ? "Heading" : "Text";
      else if (n0.k === "img") name = "Image";
      else if (n0.k === "rect") name = n0.w <= 2 || n0.h <= 2 ? "Divider" : "Shape";
      else name = shapeName(byId.get(n0.id)?.tag, ls);
    }
    // (a Button is what the page declares pressable; a pill of the same shape that is not stays a Chip)
    if (n0.btn) name = n0.badge ? "Badge" : n0.tag === "button" || n0.tag === "a" ? "Button" : "Chip";
    if (n0.lm) name = n0.lm === "nav" ? (n0.y > topNav ? "Subnav" : "Navigation") : LANDMARK_NAME[n0.lm];
    // one drawing and nothing else, icon sized: an icon, whatever the block around it calls itself
    if (!n0.btn && !n0.lm && ls.length === 1 && ls[0].svg && Math.max(ls[0].w, ls[0].h) <= ICON_MAX) name = "Icon / " + iconName(occ);
    // the width axis says wide or narrow; a variant left apart for its structure says what sets it apart
    const sized = vars.some((v) => v.wc);
    // (a variant per fixed layer size, see dimsSplit, names its axis by that size)
    const axis = vars.some((v) => v.wc && !/^(Wide|Narrow)$/.test(v.wc)) ? "Size=" : "Width=";
    const apart = clusters.length > 1;
    const taken = new Map();
    const wordOf = clusters.map((c, i) => {
      if (!i) return "Default";
      const w = variantWord(clusters[0].u.rep, c.u.rep);
      const seen = (taken.get(w) || 0) + 1;
      taken.set(w, seen);
      return seen > 1 ? w + " " + seen : w;
    });
    for (const v of vars) {
      v.label = !sized ? wordOf[v.i] : axis + (v.wc || "Default") + (apart ? ", Variant=" + wordOf[v.i] : "");
      v.occ.forEach((n) => (n.comp = v.key));
    }
    comps.push({ key, fam, name, near: mostCommon(occ.map((n) => placeOf(byId, n.id, name))), count: occ.length, kinds: ls, w: Math.round(n0.w), vars, occ });
  }
  // leaf names, one per union layer: role, numbered within its component; the roles feed the naming
  for (const c of comps) {
    const seen = new Map();
    const leafU = (u, out = []) => { if (u.kids) u.kids.forEach((k) => leafU(k, out)); else if (u.rep.k !== "frame") out.push(u); return out; };
    c.roles = [];
    for (const v of c.vars) for (const u of leafU(v.u)) {
      const r = mostCommon(u.roles || []) || LEAF_ROLE[u.rep.k] || u.rep.k;
      const i = (seen.get(r) || 0) + 1;
      seen.set(r, i);
      u.name = i > 1 ? r + " " + i : r;
      c.roles.push(u.name);
    }
    // a block the page proves to be a kind of the kit's takes its name and its layers' names
    const read = recognize(c.occ[0], KIT, { count: c.count, pageW: PAGE });
    if (!read) continue;
    c.name = read.name;
    c.kit = read.kit;
    for (const v of c.vars) {
      const leaves = leafU(v.u);
      const slots = slotNames(read.def, leaves.map((u) => ({ text: "T", svg: "I", img: "M" })[u.rep.k] || ""));
      leaves.forEach((u, i) => { if (slots[i]) u.name = slots[i]; });
      // a field's layers say their place: `left-icon` or a prefix, the value, `right-icon` or a suffix
      const seenPart = new Map();
      for (const u of leaves) {
        const r = PART_NAME[u.rep.part]?.[u.rep.k];
        if (!r) continue;
        const i = (seenPart.get(r) || 0) + 1;
        seenPart.set(r, i);
        u.name = i > 1 ? r + "-" + i : r;
      }
    }
    if (c.occ[0].field) c.roles = [...new Set(c.vars.flatMap((v) => leafU(v.u).map((u) => u.name)))];
  }
  mergeAlike(comps, P);
  // Several drawings under one icon name: that word names their place, not them ("Icon / Social"): their label, else their strokes.
  const sameIcon = new Map();
  for (const c of comps) if (/^Icon \//.test(c.name)) (sameIcon.get(c.name) || sameIcon.set(c.name, []).get(c.name)).push(c);
  for (const g of sameIcon.values()) {
    if (g.length < 2) continue;
    for (const c of g) {
      const own = mostCommon(c.occ.map((n) => labelNear(leavesOf(n)[0].id))) || iconFromPath(c.kinds[0]?.svg);
      if (own) c.name = "Icon / " + own;
    }
  }
  // a logo says whose it is when its markup or its host does
  for (const c of comps) {
    if (c.name !== "Logo" || !c.kinds[0]?.svg) continue;
    const own = iconFromSvg(c.kinds[0].svg) || mostCommon(c.occ.map((n) => iconFromText(byId.get(leavesOf(n)[0].id)?.said)));
    if (own) c.name = "Logo/" + own;
  }
  qualify(comps);

  // layer names: leaves by role, frames by the page's own words or their structure
  const nameFrames = (n) => {
    if (n.k !== "frame") return;
    n.name = n.block || (n.synth && !n.hint ? (n.dir === "H" ? "Row" : "Stack") : frameName(n));
    n.kids.forEach(nameFrames);
    if (n.wrap) n.name = (n.kids[0].name || n.kids[0].k) + " wrap";
  };
  for (const c of comps) {
    for (const n of c.occ) {
      leavesOf(n).forEach((l) => { const u = unionAt(n, l); l.name = u?.name || LEAF_ROLE[l.k] || l.k; });
      nameFrames(n);
      n.name = n.block || c.name.split("/")[0].trim();
    }
  }
  nameFrames(root);
  for (const c of comps) for (const n of c.occ) n.name = n.block || c.name.split("/")[0].trim();
  // a field's layers keep their place, nested icons included (the swap and boolean properties take these
  // names); a kept group on either side reads as that side's icon or text
  for (const c of comps) if (c.occ[0].field) for (const n of c.occ) {
    leavesOf(n).forEach((l) => { const u = unionAt(n, l); if (u?.name) l.name = u.name; });
    for (const k of n.kids) if (k.k === "frame" && !k.comp && PART_NAME[k.part]?.text) k.name = PART_NAME[k.part][leavesOf(k).every((l) => l.k === "svg") ? "svg" : "text"];
  }
  // each occurrence's layers point at their place in the main; the main's content: the union, its
  // optional layers (on only some occurrences) flagged for a boolean property
  for (const [n, u] of uOf) n.u = u;
  // the union frames between a union and one of its layers
  const pathTo = (u, t) => {
    for (const k of u.kids || []) {
      if (k === t) return [k];
      const p = pathTo(k, t);
      if (p) return [k, ...p];
    }
    return null;
  };
  const virts = [];
  // an occurrence lacking a frame the main has (a caption with no icon beside it): that frame is added
  // to its tree, plain, holding what it has, so its layers and the main's line up
  const virt = (u, k) => {
    const f = u.rep;
    const v = { k: "frame", virt: true, dir: f.dir, pad: [0, 0, 0, 0], gap: 0, align: f.align, justify: f.justify, wrap: f.wrap, synth: f.synth, revZ: f.revZ, sw: f.sw === "FIXED" ? "HUG" : f.sw, sh: f.sh === "FIXED" ? "HUG" : f.sh, kids: [k], x: k.x, y: k.y, w: k.w, h: k.h, leaves: k.leaves, sig: k.sig, fam: f.fam, name: f.name, u };
    virts.push(v);
    return v;
  };
  const place = (n, u) => {
    if (!u.kids) return;
    n.kids = (n.kids || []).map((k) => {
      if (!k.u) return k;
      // a wrapper lifted as its kid into the union's layer: the kid takes that layer itself
      if (k.wrap && k.u.rep.k !== "frame") k = k.kids[0];
      const p = pathTo(u, k.u);
      if (!p) return k;
      let out = k;
      for (let i = p.length - 2; i >= 0; i--) out = virt(p[i], out);
      return out;
    });
    for (const k of n.kids) {
      if (!k.u) continue;
      k.ui = u.kids.indexOf(k.u);
      if (k.ui >= 0) place(k, k.u);
    }
  };
  for (const c of comps) for (const v of c.vars) for (const n of v.occ) place(n, v.u);
  const structure = (u) => hash([u.rep.k, u.rep.k === "frame" ? [u.rep.dir, u.rep.align, u.rep.justify, boxKey(u.rep)].join("|") : u.rep.k === "text" ? u.rep.sig : boxKey(u.rep), u.rep.comp ? "c:" + u.rep.fam : "", u.rep.slot ? "slot" : "", ...(u.kids || []).map((k) => (k.count < u.count ? "?" : "") + structure(k))].join(";"));
  // a width variant's layers keep the sizes of its own occurrences, all the union's layers on each
  const materialize = (un, up, sized, ar) => {
    const opt = up && un.count < up.count ? true : undefined;
    const { u, ...rep } = sized?.get(un) || un.rep;
    const own = ar?.has(un) ? { ar: true } : {};
    if (!un.kids) return { ...rep, opt, ...own };
    return { ...rep, opt, ...own, kids: un.kids.map((k) => materialize(k, un, sized, ar)) };
  };
  // Figma drops a resize on an instance's sublayer: an image filling its width whose occurrences all keep
  // one ratio locks it in the main, its height then follows each instance's width
  const ratioLocked = (occ) => {
    const rs = new Map();
    const scan = (n) => {
      for (const k of n.kids || []) {
        if (k.u && k.sw === "FILL" && k.h > 0 && (k.k === "img" || (k.k === "frame" && k.img && !k.kids?.length))) (rs.get(k.u) || rs.set(k.u, []).get(k.u)).push(k.w / k.h);
        if (!P.has(k)) scan(k);
      }
    };
    occ.forEach(scan);
    return new Set([...rs].filter(([, r]) => r.every((x) => Math.abs(x / r[0] - 1) < 0.02)).map(([u]) => u));
  };
  // A variant still holding one image of many heights (a masonry tile, more sizes than variants are worth)
  // gives that height to the instance: Figma refuses it on the sublayer, not on the instance itself. The
  // image and the frames above it fill the main's height, each instance keeps its own
  const heightFollows = (v) => {
    const hs = new Map();
    const leaf = (k) => k.k === "img" || k.k === "rect" || k.k === "svg" || (k.k === "frame" && k.img && !k.kids?.length);
    const scan = (n) => { for (const k of n.kids || []) { if (!k.u) continue; if (leaf(k)) (hs.get(k.u) || hs.set(k.u, []).get(k.u)).push(k); else if (k.k === "frame" && !P.has(k)) scan(k); } };
    v.occ.forEach(scan);
    const clash = [...hs].filter(([, ks]) => ks.some((k) => Math.abs(k.h - ks[0].h) >= 2));
    if (clash.length !== 1) return;
    const [u, ks] = clash[0];
    // its width follows the instance or never changes: only the height is the instance's to give
    if (!ks.every((k) => k.sw === "FILL") && !ks.every((k) => k.sw === "FIXED" && Math.abs(k.w - ks[0].w) < 2)) return;
    const path = (n) => (n === u ? [] : (n.kids || []).reduce((p, k, i) => p || ((q) => q && [i, ...q])(path(k)), null));
    const at = path(v.u);
    if (!at) return;
    const chain = [v.union];
    for (const i of at) chain.push(chain[chain.length - 1].kids[i]);
    // (the main's own position on the page is not a layer of it)
    if (chain[chain.length - 1].ar || !chain.slice(0, -1).every((f) => f.dir) || chain.slice(1).some((f) => f.abs || f.comp)) return;
    chain.slice(1).forEach((f) => { f.sh = "FILL"; });
    v.union.sh = "FIXED";
    v.occ.forEach((n) => { n.sh = "FIXED"; });
  };
  // a media block's booleans go by group, whatever the page shows: its text as one (title and price
  // together), its icon's slot, its badge
  const endsOf = (n) => (n.kids ? n.kids.flatMap(endsOf) : [n]);
  const groupProps = (un) => {
    let texted = false;
    const visit = (n) => {
      for (const k of n.kids || []) {
        const ls = endsOf(k);
        if (k.opt && k.badge) k.prop = "Badge";
        else if (k.opt && ls.every((l) => l.k === "svg")) k.prop = "Icon";
        if (k.comp) continue;
        if (!texted && ls.every((l) => l.k === "text")) {
          texted = true;
          // on the row holding the text and optional layers when there is one: a hug frame whose
          // children are all hidden keeps its height in Figma, the block would never collapse
          const row = !k.opt && n !== un && n.kids.every((x) => x === k || x.opt) ? n : k;
          row.opt = true;
          row.prop = ls.some((l) => (l.runs || []).some((r) => PRICE.test(r.text ?? r.t ?? ""))) ? "Text + price" : "Text";
        } else if (k.kids) visit(k);
      }
    };
    visit(un);
  };
  for (const c of comps) for (const v of c.vars) {
    v.sig = structure(v.u) + (v.wc ? "|" + v.wc : "");
    let sized = null;
    if (v.wc) {
      sized = new Map([[v.u, v.occ[0]]]);
      // (a frame added only to line layers up is not this size's own: it has no padding or sizing to give)
      const mark = (n) => { for (const k of n.kids || []) { if (k.u && !k.virt && !sized.has(k.u)) sized.set(k.u, k); if (!P.has(k)) mark(k); } };
      v.occ.forEach(mark);
    }
    v.union = materialize(v.u, undefined, sized, ratioLocked(v.occ));
    heightFollows(v);
    if (v.occ.some(holdsMedia)) groupProps(v.union);
  }
  for (const n of uOf.keys()) delete n.u;
  for (const n of virts) delete n.u;

  // stats: auto layout frames, absolute nodes, instances
  const st = { frames: 0, auto: 0, abs: 0, instances: picked.length, comps: comps.length, loose: 0, pinned: fixedW };
  walk(root, (n) => {
    if (n.k === "frame") { st.frames++; if (n.dir) st.auto++; }
    if (n.abs) st.abs++;
  });
  return { root, comps: comps.map(({ occ, ...c }) => ({ ...c, vars: c.vars.map(({ occ, u, ...v }) => ({ ...v, count: occ.length })) })), stats: st };
}
