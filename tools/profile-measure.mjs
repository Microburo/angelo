// Measures the design constants of every capture of a profile corpus and aggregates them:
// type scale, line height, measure, margins, spacing scale, palette, image ratios, columns,
// radius, desktop -> phone shifts. Each aggregate says how many sites support it.
// Usage: node tools/profile-measure.mjs <profile> [--status confirmed,probable]
// Reads profiles/<profile>/captures/<case>[-430]/capture.json, writes profiles/<profile>/measures.json.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const profile = args[0];
if (!profile) {
  console.error("usage: node tools/profile-measure.mjs <profile> [--status confirmed,probable]");
  process.exit(1);
}
const statusArg = args.includes("--status") ? args[args.indexOf("--status") + 1] : "confirmed,probable";
const keep = statusArg.split(",");
const root = join("profiles", profile);

const sites = readFileSync(join(root, "sites.csv"), "utf8").trim().split("\n").slice(1)
  .map((l) => l.split(","))
  .map(([kase, url, year, status]) => ({ kase, url, year, status }));

const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(d));
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const pct = (a, p) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const hist = (pairs) => {
  const m = new Map();
  for (const [k, w] of pairs) m.set(k, (m.get(k) || 0) + w);
  const total = [...m.values()].reduce((a, b) => a + b, 0) || 1;
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, w]) => [k, round(w / total, 3)]);
};
const rgb = (s) => (s?.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const chroma = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b);
const RATIOS = { "1:1": 1, "4:3": 4 / 3, "3:2": 3 / 2, "16:9": 16 / 9, "2:1": 2, "3:4": 3 / 4, "2:3": 2 / 3, "4:5": 4 / 5 };
const ratioName = (r) => {
  let best = "other", bd = 0.04;
  for (const [n, v] of Object.entries(RATIOS)) {
    const d = Math.abs(r - v) / v;
    if (d < bd) { best = n; bd = d; }
  }
  return best;
};

function measure(cap) {
  const W = cap.width;
  const seen = (b) => b.x > -1000 && b.x < W && b.w > 0 && b.h > 0;
  const texts = cap.boxes.filter((b) => b.text && b.font && seen(b) && b.text.trim().length > 1);
  const chars = (b) => b.text.replace(/\s+/g, " ").trim().length;
  const total = texts.reduce((a, b) => a + chars(b), 0) || 1;

  // type scale: sizes weighted by characters, kept when they carry >= 1 % of the text
  const sizeHist = hist(texts.map((b) => [round(b.font.size, 1), chars(b)]));
  const sizes = sizeHist.filter(([, w]) => w >= 0.01).map(([s]) => s).sort((a, b) => a - b);
  const steps = sizes.slice(1).map((s, i) => round(s / sizes[i], 3));
  // body = size carrying most characters among texts of 2+ lines at reading sizes (home statements run 48 px)
  const multi = texts.filter((b) => (b.lines?.length || 1) >= 2 && b.font.size <= 24);
  const body = hist(multi.map((b) => [round(b.font.size, 1), chars(b)]))[0]?.[0] ?? null;
  const display = Math.max(...texts.filter((b) => chars(b) >= 3).map((b) => b.font.size));
  const lhOf = (pred) => median(texts.filter(pred).filter((b) => b.font.lh > 0).map((b) => b.font.lh / b.font.size));
  const lsOf = (pred) => median(texts.filter(pred).map((b) => (b.font.ls || 0) / b.font.size));
  const families = hist(texts.map((b) => [b.font.family.split(",")[0].replace(/["']/g, "").trim(), chars(b)]));
  const weights = hist(texts.map((b) => [b.font.weight, chars(b)]));
  const upper = texts.filter((b) => /[A-Z]/.test(b.text) && b.text === b.text.toUpperCase()).reduce((a, b) => a + chars(b), 0) / total;

  // measure: characters per full line of reading-size paragraphs (3+ lines, last line dropped)
  const perLine = [];
  for (const b of texts) {
    if ((b.lines?.length || 0) < 3 || b.font.size > 24) continue;
    for (const l of b.lines.slice(0, -1)) perLine.push(l.t.trim().length);
  }

  // margins: where the content starts and ends horizontally
  const content = cap.boxes.filter((b) => seen(b) && (b.text || b.img || b.svg) && b.w < W - 2);
  const left = pct(content.map((b) => b.x), 5);
  const right = W - pct(content.map((b) => b.x + b.w), 95);

  // spacing scale: the gaps and paddings the CSS declares
  const spaces = [];
  for (const b of cap.boxes) {
    if (!seen(b)) continue;
    if (b.flex?.gap > 0) spaces.push(b.flex.gap);
    if (b.grid?.gap > 0) spaces.push(b.grid.gap);
    for (const p of b.pad || []) if (p > 0) spaces.push(p);
  }
  const spaceHist = hist(spaces.map((s) => [round(s, 1), 1]));
  const mult = (n) => round(spaces.filter((s) => Math.abs(s / n - Math.round(s / n)) < 0.01).length / (spaces.length || 1), 3);

  // palette
  const textColors = hist(texts.map((b) => [b.font.color, chars(b)]));
  const bgs = cap.boxes.filter((b) => seen(b) && b.bg && !/rgba\(.*, 0\)/.test(b.bg));
  const bgColors = hist(bgs.map((b) => [b.bg, b.w * b.h]));
  const chromatic = (h) => round(h.filter(([c]) => chroma(rgb(c)) > 24).reduce((a, [, w]) => a + w, 0), 3);

  // images
  const imgs = cap.boxes.filter((b) => seen(b) && b.img && b.w >= 80 && b.h >= 80);
  const ratios = hist(imgs.map((b) => [ratioName(b.w / b.h), b.w * b.h]));
  const contentW = W - left - right;
  const imgWidths = hist(imgs.map((b) => [round(b.w / contentW, 1), 1]));

  // columns: left edges shared by 3+ blocks
  const edges = new Map();
  for (const b of content) {
    const k = Math.round(b.x / 2) * 2;
    edges.set(k, (edges.get(k) || 0) + 1);
  }
  const columns = [...edges.entries()].filter(([, n]) => n >= 3).map(([x]) => x).sort((a, b) => a - b);

  const radius = hist(cap.boxes.filter((b) => seen(b) && b.r > 0).map((b) => [b.r, 1]));

  return {
    width: W,
    height: cap.height,
    type: {
      sizes, steps, stepMedian: median(steps), body, display, displayRatio: body ? round(display / body) : null,
      count: sizes.length, families: families.slice(0, 4), weights: weights.slice(0, 4), uppercase: round(upper, 3),
      lhBody: body ? round(lhOf((b) => b.font.size === body)) : null, lhDisplay: round(lhOf((b) => b.font.size >= 32) ?? 0),
      lsDisplayEm: round(lsOf((b) => b.font.size >= 32) ?? 0, 3), lsBodyEm: body ? round(lsOf((b) => b.font.size === body), 3) : null,
    },
    measure: { median: median(perLine), p10: pct(perLine, 10), p90: pct(perLine, 90), lines: perLine.length },
    margins: { left, right, contentW },
    spacing: { top: spaceHist.slice(0, 10), mult4: mult(4), mult8: mult(8), count: spaces.length },
    palette: { text: textColors.slice(0, 5), bg: bgColors.slice(0, 5), textChromatic: chromatic(textColors), bgChromatic: chromatic(bgColors) },
    images: { count: imgs.length, ratios: ratios.slice(0, 5), widths: imgWidths.slice(0, 5) },
    columns: { edges: columns.length, xs: columns.slice(0, 16) },
    radius: radius.slice(0, 4),
    layout: layout(cap, left, right, body, body ? lhOf((b) => b.font.size === body) * body : null),
  };
}

// layout: column grid, section / sub-section rhythm, spacing inside blocks.
// Relies on the capture's block labels (Header, Section, Sub-section, Column, Footer).
function layout(cap, left, right, bodyPx, bodyLine) {
  const W = cap.width;
  const cw = W - left - right;
  const byId = new Map(cap.boxes.map((b) => [b.id, b]));
  const seen = (b) => b.x > -1000 && b.x < W && b.w > 0 && b.h > 0;
  // nearest labelled ancestors: depth 0 = section, depth 1 = sub-section / column
  const chainOf = (b) => {
    const chain = [];
    for (let q = b; q; q = byId.get(q.p)) if (q.block) chain.unshift(q);
    return chain;
  };
  const isFrame = (blk) => /^(Header|Footer)/.test(blk.block);
  const leaves = cap.boxes.filter((b) => seen(b) && ((b.text && b.text.trim()) || b.img || b.svg))
    .map((b) => ({ b, chain: chainOf(b) }))
    .filter((l) => l.chain.length && !isFrame(l.chain[0]));
  const extent = (ls) => ls.length ? { top: Math.min(...ls.map((l) => l.b.y)), bottom: Math.max(...ls.map((l) => l.b.y + l.b.h)) } : null;

  // sections and their content extents, in page order
  const groups = (depth, parentId) => {
    const m = new Map();
    for (const l of leaves) {
      const g = l.chain[depth];
      if (!g || (depth > 0 && l.chain[depth - 1].id !== parentId)) continue;
      if (!m.has(g.id)) m.set(g.id, { blk: g, ls: [] });
      m.get(g.id).ls.push(l);
    }
    return [...m.values()].map((g) => ({ ...g, ...extent(g.ls) })).sort((a, b) => a.top - b.top);
  };
  // gap rects [x, y, w, h] kept for the overlay
  const marks = { section: [], sub: [], heading: [], caption: [] };
  const stackedGaps = (gs, kind) => {
    const out = [];
    for (let i = 1; i < gs.length; i++) {
      const a = gs[i - 1], b = gs[i];
      if (b.top < a.bottom - 1) continue; // side-by-side columns are skipped
      out.push(Math.round(b.top - a.bottom));
      if (b.top > a.bottom) marks[kind].push([left, Math.round(a.bottom), Math.round(cw), Math.round(b.top - a.bottom)]);
    }
    return out;
  };
  const sections = groups(0);
  const sectionGaps = stackedGaps(sections, "section");
  const subGaps = [];
  const shapes = [];
  for (const s of sections) {
    const subs = groups(1, s.blk.id);
    subGaps.push(...stackedGaps(subs, "sub"));
    const cols = subs.filter((x, i) => subs.some((y, j) => j !== i && Math.abs(y.top - x.top) < 4)).length;
    shapes.push(s.blk.w >= W - 2 ? (cols ? `full ${cols} col` : "full") : cols ? `${cols} col` : "contained");
  }

  // spacing inside blocks: next leaf straight below, same innermost block, classified by pair
  const inner = { heading: [], para: [], caption: [], toImage: [], other: [] };
  const sorted = [...leaves].sort((a, b) => a.b.y - b.b.y);
  const isHeading = (b) => b.text && b.font && bodyPx && b.font.size >= bodyPx * 1.4;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i].b, own = sorted[i].chain.at(-1).id;
    let next = null;
    for (let j = i + 1; j < sorted.length; j++) {
      const c = sorted[j].b;
      if (c.y < a.y + a.h - 1) continue;
      if (c.x >= a.x + a.w || c.x + c.w <= a.x) continue;
      next = sorted[j];
      break;
    }
    if (!next || next.chain.at(-1).id !== own) continue;
    const gap = Math.round(next.b.y - (a.y + a.h));
    if (gap <= 0 || gap > 400) continue;
    const c = next.b;
    const rect = [Math.round(Math.max(a.x, c.x)), Math.round(a.y + a.h), Math.round(Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x)), gap];
    if (isHeading(a)) { inner.heading.push(gap); marks.heading.push(rect); }
    else if (a.img && c.text) { inner.caption.push(gap); marks.caption.push(rect); }
    else if (c.img) inner.toImage.push(gap);
    else if (a.text && c.text && a.font?.size === bodyPx && c.font?.size === bodyPx) inner.para.push(gap);
    else inner.other.push(gap);
  }
  const allV = [...sectionGaps, ...subGaps, ...Object.values(inner).flat()].filter((g) => g > 0);
  const multOf = (n) => (n ? round(allV.filter((g) => Math.abs(g / n - Math.round(g / n)) * n <= 1).length / (allV.length || 1), 3) : null);

  // column grid: fit margin + N columns + gutter on the interior edges of blocks and wide leaves
  const edgeSet = (vals) => [...new Set(vals.map((v) => Math.round(v)))];
  // text boxes are left out: their right edge is ragged, it does not show the column
  const gridParents = new Set(cap.boxes.filter((b) => b.grid?.cols > 1 || (b.flex?.dir === "row" && b.flex.gap > 0)).map((b) => b.id));
  const cand = [
    ...cap.boxes.filter((b) => seen(b) && b.block && !isFrame(b)),
    ...leaves.map((l) => l.b).filter((b) => b.img && b.w >= cw * 0.12),
    ...cap.boxes.filter((b) => seen(b) && gridParents.has(b.p) && b.w >= cw * 0.12),
  ].filter((b) => b.w < cw - 4);
  const L = edgeSet(cand.map((b) => b.x)).filter((x) => x > left + 3 && x < W - right - 3);
  const R = edgeSet(cand.map((b) => b.x + b.w)).filter((x) => x > left + 3 && x < W - right - 3);
  let grid = { cols: 1, gutter: 0, fit: null, edges: L.length + R.length };
  if (L.length + R.length >= 3) {
    let best = null;
    for (const n of [2, 3, 4, 6, 8, 10, 12, 16, 24]) {
      for (let g = 0; g <= 64; g += 2) {
        const c = (cw - (n - 1) * g) / n;
        if (c < 8) continue;
        const near = (x, off) => {
          for (let k = 0; k < n; k++) if (Math.abs(x - (left + k * (c + g) + off)) <= 3) return true;
          return false;
        };
        const hits = L.filter((x) => near(x, 0)).length + R.filter((x) => near(x, c)).length;
        const rate = hits / (L.length + R.length);
        const chance = Math.min(1, (n * 7) / cw);
        const score = rate - chance;
        if (!best || score > best.score + 0.02) best = { cols: n, gutter: g, col: round(c, 1), fit: round(rate, 2), score };
      }
    }
    grid = { ...best, score: round(best.score, 2), edges: L.length + R.length };
  }
  // spans of sub-blocks on that grid, e.g. "8/12 +2" = 8 columns wide, starting after 2
  const spans = grid.cols > 1 ? hist(cap.boxes.filter((b) => seen(b) && b.block && !isFrame(b) && chainOf(b).length === 2 && b.w < cw - 4)
    .map((b) => [`${Math.round((b.w + grid.gutter) / (grid.col + grid.gutter))}/${grid.cols} +${Math.round((b.x - left) / (grid.col + grid.gutter))}`, 1])) : [];
  // grid-agnostic composition: real gutters between side-by-side blocks, block widths as fractions
  // of the content width (gutter-corrected), centred narrow blocks
  const FRACS = { "1/4": 1 / 4, "1/3": 1 / 3, "5/12": 5 / 12, "1/2": 1 / 2, "7/12": 7 / 12, "2/3": 2 / 3, "3/4": 3 / 4, "5/6": 5 / 6 };
  const parts = cand.filter((b) => b.w >= cw * 0.15);
  const gutters = [];
  const rows = new Map();
  for (const b of parts) {
    const k = `${b.p}:${Math.round(b.y / 4)}`;
    if (!rows.has(k)) rows.set(k, []);
    rows.get(k).push(b);
  }
  for (const r of rows.values()) {
    r.sort((a, b) => a.x - b.x);
    for (let i = 1; i < r.length; i++) {
      const g = Math.round(r[i].x - (r[i - 1].x + r[i - 1].w));
      if (g > 0 && g < 160) gutters.push(g);
    }
  }
  const gutter = gutters.length ? median(gutters) : null;
  const fracOf = (b) => {
    const f = (b.w + (gutter || 0)) / (cw + (gutter || 0));
    let best = "other", bd = 0.03;
    for (const [n, v] of Object.entries(FRACS)) if (Math.abs(f - v) < bd) { best = n; bd = Math.abs(f - v); }
    return best;
  };
  const centred = parts.filter((b) => Math.abs((b.x - left) - (W - right - b.x - b.w)) <= 4);
  const composition = {
    gutter, gutters: gutters.length,
    fractions: hist(parts.map((b) => [fracOf(b), 1])).slice(0, 6),
    centred: round(centred.length / (parts.length || 1), 2),
    centredFractions: hist(centred.map((b) => [fracOf(b), 1])).slice(0, 3),
    symmetric: Math.abs(left - right) <= 4,
  };
  const declared = hist(cap.boxes.filter((b) => seen(b) && b.grid?.cols > 1).map((b) => [`${b.grid.cols}×${b.grid.gap}`, 1]));

  const md = (a) => (a.length ? median(a) : null);
  return {
    marks, grid, composition, spans: spans.slice(0, 5), declared: declared.slice(0, 4),
    sections: sections.length, shapes: hist(shapes.map((s) => [s, 1])).slice(0, 5),
    sectionGap: md(sectionGaps), sectionGaps, subGap: md(subGaps), subGaps,
    inner: Object.fromEntries(Object.entries(inner).map(([k, v]) => [k, { median: md(v), n: v.length }])),
    ratio: {
      sectionOverSub: sectionGaps.length && subGaps.length ? round(md(sectionGaps) / md(subGaps)) : null,
      subOverPara: subGaps.length && inner.para.length ? round(md(subGaps) / md(inner.para)) : null,
    },
    verticalMult8: multOf(8), verticalMult4: multOf(4), verticalMultLine: bodyLine ? multOf(Math.round(bodyLine)) : null,
    verticalTop: hist(allV.map((g) => [g, 1])).slice(0, 8),
  };
}

const out = { profile, status: keep, sites: {} };
for (const s of sites) {
  if (!keep.includes(s.status)) continue;
  const parent = s.kase.endsWith("-inner") ? s.kase.slice(0, -6) : null;
  const site = { url: s.url, year: s.year, status: s.status };
  for (const [key, dir] of [["desktop", s.kase], ["phone", `${s.kase}-430`]]) {
    const f = join(root, "captures", dir, "capture.json");
    if (existsSync(f)) site[key] = measure(JSON.parse(readFileSync(f, "utf8")));
  }
  if (!site.desktop) continue;
  if (parent) { if (out.sites[parent]) out.sites[parent].inner = site; } // inner page hangs on its site
  else out.sites[s.kase] = site;
}

// aggregates: median across sites + the spread, so a rule can say how many sites hold it
const aggregate = (list) => {
const across = (get) => {
  const v = list.map(get).filter((x) => x != null && !Number.isNaN(x));
  return { median: median(v), min: Math.min(...v), max: Math.max(...v), n: v.length };
};
return {
  sites: list.length,
  bodySize: across((s) => s.desktop.type.body),
  bodySizePhone: across((s) => s.phone?.type.body),
  sizeCount: across((s) => s.desktop.type.count),
  stepMedian: across((s) => s.desktop.type.stepMedian),
  displayRatio: across((s) => s.desktop.type.displayRatio),
  displayRatioPhone: across((s) => s.phone?.type.displayRatio),
  lhBody: across((s) => s.desktop.type.lhBody),
  lhDisplay: across((s) => s.desktop.type.lhDisplay || null),
  lsDisplayEm: across((s) => s.desktop.type.lsDisplayEm),
  families: across((s) => s.desktop.type.families.filter(([, w]) => w >= 0.05).length),
  uppercase: across((s) => s.desktop.type.uppercase),
  measure: across((s) => s.desktop.measure.median),
  marginLeft: across((s) => s.desktop.margins.left),
  marginLeftPhone: across((s) => s.phone?.margins.left),
  spacingMult4: across((s) => s.desktop.spacing.mult4),
  spacingMult8: across((s) => s.desktop.spacing.mult8),
  textChromatic: across((s) => s.desktop.palette.textChromatic),
  bgChromatic: across((s) => s.desktop.palette.bgChromatic),
  columnEdges: across((s) => s.desktop.columns.edges),
  gridCols: across((s) => s.desktop.layout.grid.cols),
  gridGutter: across((s) => s.desktop.layout.grid.gutter),
  gridFit: across((s) => s.desktop.layout.grid.fit),
  gridColsPhone: across((s) => s.phone?.layout.grid.cols),
  gutter: across((s) => s.desktop.layout.composition.gutter),
  gutterPhone: across((s) => s.phone?.layout.composition.gutter),
  centred: across((s) => s.desktop.layout.composition.centred),
  sections: across((s) => s.desktop.layout.sections),
  sectionGap: across((s) => s.desktop.layout.sectionGap),
  sectionGapPhone: across((s) => s.phone?.layout.sectionGap),
  subGap: across((s) => s.desktop.layout.subGap),
  subGapPhone: across((s) => s.phone?.layout.subGap),
  headingGap: across((s) => s.desktop.layout.inner.heading.median),
  paraGap: across((s) => s.desktop.layout.inner.para.median),
  captionGap: across((s) => s.desktop.layout.inner.caption.median),
  sectionOverSub: across((s) => s.desktop.layout.ratio.sectionOverSub),
  subOverPara: across((s) => s.desktop.layout.ratio.subOverPara),
  verticalMult8: across((s) => s.desktop.layout.verticalMult8),
  verticalMult4: across((s) => s.desktop.layout.verticalMult4),
};
};
const list = Object.values(out.sites);
out.aggregate = aggregate(list);
out.aggregateInner = aggregate(list.map((s) => s.inner).filter(Boolean));
writeFileSync(join(root, "measures.json"), JSON.stringify(out, null, 1));
console.log(`${list.length} sites measured → ${join(root, "measures.json")}`);
const show = (v) => `${v.median == null ? "-" : +v.median.toFixed(3)}  [${v.min} – ${v.max}]  n=${v.n}`;
for (const [k, v] of Object.entries(out.aggregate)) if (k !== "sites") console.log(`${k.padEnd(18)} home ${show(v).padEnd(30)} inner ${show(out.aggregateInner[k])}`);
