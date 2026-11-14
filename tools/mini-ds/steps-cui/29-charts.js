// CUI charts: Legend item, Chart bar, Heat cell, Treemap tile, Funnel stage, Sankey node, Bar list row (shared parts), then
// Line chart, Bar chart, Donut chart, Heatmap, Calendar heatmap, Treemap, Radar chart, Funnel, Split bar, Waffle, Sankey,
// Bar list, Activity rings, Scatter chart (Scatter | Bubble), and one board card per catalog page.
// Grids, bars and cells are auto-layout frames with token fills. Lines, arcs, ribbons and dots are single multi-subpath
// vectors; where drawings must overlap (grid + lines, arcs, ribbons, dots) the plot frame is an auto-layout frame whose
// vector children are marked layoutPositioning = ABSOLUTE (named plot / rings / ribbons), nothing else is placed freely.
const NEW = [
  "Legend item", "Chart bar", "Heat cell", "Treemap tile", "Funnel stage", "Sankey node", "Bar list row",
  "Line chart", "Bar chart", "Donut chart", "Heatmap", "Calendar heatmap", "Treemap", "Radar chart", "Funnel", "Split bar",
  "Waffle", "Sankey", "Bar list", "Activity rings", "Scatter chart",
];
for (const n of NEW) setNamed(n)?.remove();
const MS = rootNamed(MASTERS);

// series colors: [fill token, subtle token, foreground on the fill]
const SERIES = [
  { n: "Info", c: "feedback/info/default", s: "feedback/info/subtle" },
  { n: "Warning", c: "feedback/warning/default", s: "feedback/warning/subtle" },
  { n: "Success", c: "feedback/success/default", s: "feedback/success/subtle" },
  { n: "Error", c: "feedback/error/default", s: "feedback/error/subtle" },
  { n: "Primary", c: "primary/default", s: "primary/subtle" },
];
const MINI = "Paragraph/Mini Regular";
const SMALL = "Paragraph/Small Regular";
const SMALLM = "Paragraph/Small Medium";

// deterministic noise so a rerun draws the same data
let seed = 11;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

// fill token at partial opacity (the paint stays bound to the token)
const tint = (f, token, a) => {
  setPaints(f, "fills", [a == null || a >= 1 ? solid(token) : Object.assign({}, solid(token), { opacity: a })]);
};
// text with a fixed width (aligned inside its cell)
async function tcell(chars, w, align = "CENTER", style = MINI, color = "text/secondary", name) {
  const t = await text(chars, style, color, name);
  t.textAutoResize = "HEIGHT";
  t.textAlignHorizontal = align;
  t.resize(w, t.height);
  return t;
}
// vector pen: paths in plot coordinates, translated so the vector's box starts at 0,0 (node placed at x, y afterwards)
function pen() {
  const cmds = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const ext = (x, y) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  const p = {};
  p.M = (x, y) => (cmds.push(["M", x, y]), ext(x, y), p);
  p.L = (x, y) => (cmds.push(["L", x, y]), ext(x, y), p);
  p.C = (a, b, c, d, x, y) => (cmds.push(["C", a, b, c, d, x, y]), ext(x, y), p);
  p.Z = () => (cmds.push(["Z"]), p);
  p.poly = (pts, close = true) => {
    pts.forEach(([x, y], i) => (i ? p.L(x, y) : p.M(x, y)));
    return close ? p.Z() : p;
  };
  p.rect = (x, y, w, h, r = 0) => {
    r = Math.min(r, w / 2, h / 2);
    if (!r) return p.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
    const k = r * 0.5523;
    p.M(x + r, y).L(x + w - r, y).C(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
    p.L(x + w, y + h - r).C(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
    p.L(x + r, y + h).C(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
    p.L(x, y + r).C(x, y + r - k, x + r - k, y, x + r, y);
    return p.Z();
  };
  // angles in radians, clockwise from 12 o'clock; a1 may pass a full turn
  p.arc = (cx, cy, r, a0, a1) => {
    const at = (a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
    const step = (a1 - a0) / n;
    p.M(...at(a0));
    for (let i = 0; i < n; i++) {
      const s = a0 + i * step;
      const e = s + step;
      const k = (4 / 3) * Math.tan((e - s) / 4) * r;
      const [sx, sy] = at(s);
      const [ex, ey] = at(e);
      p.C(sx + k * Math.cos(s), sy + k * Math.sin(s), ex - k * Math.cos(e), ey - k * Math.sin(e), ex, ey);
    }
    for (let m = Math.ceil(a0 / (Math.PI / 2)); (m * Math.PI) / 2 <= a1 + 1e-9; m++) ext(...at((m * Math.PI) / 2));
    return p;
  };
  p.circle = (cx, cy, r) => {
    p.arc(cx, cy, r, 0, 2 * Math.PI);
    return p.Z();
  };
  p.node = (name, rule) => {
    const f = (v) => Math.round(v * 100) / 100;
    const data = cmds.map(([k, ...a]) => (k === "Z" ? "Z" : k + " " + a.map((v, i) => f(v - (i % 2 ? y0 : x0))).join(" "))).join(" ");
    const v = figma.createVector();
    v.name = name;
    v.vectorPaths = [{ windingRule: rule, data }];
    return { v, x: x0, y: y0 };
  };
  return p;
}
// st: { fill, alpha, stroke, salpha, sw, cap }; abs = out of the flow, at the path's own place in the parent
function draw(parent, pn, name, st, abs = true) {
  const n = pn.node(name, st.fill ? "NONZERO" : "NONE");
  const v = n.v;
  setPaints(v, "fills", st.fill ? [st.alpha ? Object.assign({}, solid(st.fill), { opacity: st.alpha }) : solid(st.fill)] : []);
  setPaints(v, "strokes", st.stroke ? [st.salpha ? Object.assign({}, solid(st.stroke), { opacity: st.salpha }) : solid(st.stroke)] : []);
  if (st.stroke) {
    v.strokeWeight = st.sw || 1;
    v.strokeCap = st.cap || "NONE";
    v.strokeJoin = "ROUND";
  }
  parent.appendChild(v);
  if (abs) {
    v.layoutPositioning = "ABSOLUTE";
    v.x = n.x;
    v.y = n.y;
  }
  return v;
}
// horizontal bump between points: flat tangent at every anchor, so extremes stay on the anchors
const bump = (p, pts) => {
  pts.forEach(([x, y], i) => {
    if (!i) return p.M(x, y);
    const [px, py] = pts[i - 1];
    const m = (px + x) / 2;
    p.C(m, py, m, y, x, y);
  });
  return p;
};
// y axis labels (right aligned column), grid frame (lines space-between, 8 px above and below), x axis labels
async function yAxis(labels, w, h) {
  const col = box("y-axis", { w, h, align: "SPACE_BETWEEN" });
  for (let i = 0; i < labels.length; i++) {
    const t = await text(labels[i], MINI, "text/secondary", `y-${i + 1}`);
    t.textAutoResize = "HEIGHT";
    t.textAlignHorizontal = "RIGHT";
    add(col, t, { w: "fill" });
  }
  return col;
}
function gridFrame(w, h, n) {
  const g = box("plot", { w, h, align: "SPACE_BETWEEN", pad: [8, 0] });
  for (let i = 0; i < n; i++) add(g, box(`grid-${i + 1}`, { fill: i === n - 1 ? "border/strong" : "border/default" }), { w: "fill", h: 1 });
  return g;
}
async function xAxis(labels, w, o = {}) {
  const row = box("x-axis", { dir: "row", w, align: "SPACE_BETWEEN", pad: o.pad });
  for (let i = 0; i < labels.length; i++) {
    row.appendChild(o.cell ? await tcell(labels[i], o.cell, "CENTER", MINI, "text/secondary", `x-${i + 1}`) : await text(labels[i], MINI, "text/secondary", `x-${i + 1}`));
  }
  return row;
}
const rowOf = (name, items, gap = 16, cross = "CENTER") => {
  const r = box(name, { dir: "row", gap, cross });
  items.forEach((i) => r.appendChild(i));
  return r;
};

// ---- shared parts ---------------------------------------------------------------------------------------------------------
// Legend item: color dot, label, optional value and share
const legend = await variants("Legend item", { Series: SERIES.map((s) => s.n) }, async ({ Series }) => {
  const s = SERIES.find((x) => x.n === Series);
  const b = box("legend-item", { component: true, dir: "row", gap: 8, cross: "CENTER" });
  b.appendChild(box("dot", { w: 8, h: 8, radius: 2, fill: s.c }));
  b.appendChild(await text("Label", SMALL, "text/primary", "label"));
  for (const k of ["value", "share"]) {
    const t = await text(k === "value" ? "Value" : "Share", SMALL, "text/secondary", k);
    t.visible = false;
    b.appendChild(t);
  }
  return b;
}, { cols: 5 });
wire(legend, [
  { layer: "label", kind: "TEXT", name: "Label" },
  { layer: "value", kind: "BOOLEAN", name: "Value", def: false },
  { layer: "value", kind: "TEXT", name: "Value text" },
  { layer: "share", kind: "BOOLEAN", name: "Share", def: false },
  { layer: "share", kind: "TEXT", name: "Share text" },
]);
const leg = (i, label, o = {}) => inst(legend, { Series: SERIES[i].n }, { Label: label, ...o });
const legVal = (i, label, value, share) => leg(i, label, { Value: true, "Value text": value, ...(share ? { Share: true, "Share text": share } : {}) });

// Chart bar: 16 px column, rounded top, one per series (height set on the instance)
const chartBar = await variants("Chart bar", { Series: SERIES.map((s) => s.n) }, ({ Series }) => {
  const s = SERIES.find((x) => x.n === Series);
  const b = box("chart-bar", { component: true, w: 16, h: 100, fill: s.c });
  num(b, "topLeftRadius", 4, "radius");
  num(b, "topRightRadius", 4, "radius");
  b.bottomLeftRadius = 0;
  b.bottomRightRadius = 0;
  return b;
}, { cols: 5 });

// Heat cell: five levels of one hue (surface tint, then 28 %, 55 %, full, dark)
const LEVELS = [["bg/muted"], ["feedback/info/default", 0.28], ["feedback/info/default", 0.55], ["feedback/info/default"], ["feedback/info/text"]];
const heat = await variants("Heat cell", { Level: ["0", "1", "2", "3", "4"] }, ({ Level }) => {
  const b = box("heat-cell", { component: true, w: 16, h: 16, radius: 4 });
  tint(b, ...LEVELS[+Level]);
  return b;
}, { cols: 5 });
const heatCell = (level, size) => {
  const c = inst(heat, { Level: String(level) });
  c.resize(size, size);
  return c;
};
// grid of heat cells: levelFn(row, col) -> 0..4
function heatGrid(name, rows, cols, size, gap, levelFn) {
  const g = box(name, { gap });
  for (let r = 0; r < rows; r++) {
    const row = box(`row-${r + 1}`, { dir: "row", gap });
    for (let c = 0; c < cols; c++) row.appendChild(heatCell(levelFn(r, c), size));
    g.appendChild(row);
  }
  return g;
}
// left labels, one per row, centered on rows of height h
async function rowLabels(labels, w, h, gap) {
  const col = box("row-labels", { gap });
  for (let i = 0; i < labels.length; i++) {
    const c = box(`row-label-${i + 1}`, { dir: "row", w, h, cross: "CENTER" });
    if (labels[i]) add(c, await tcell(labels[i], w, "RIGHT", SMALL), { w });
    col.appendChild(c);
  }
  return col;
}

// Treemap tile: shade by value, label + value (hideable on small tiles)
const SHADE = { Dark: ["feedback/info/text"], Medium: ["feedback/info/default"], Light: ["feedback/info/default", 0.65], Pale: ["feedback/info/default", 0.4, "text/primary"] };
const tile = await variants("Treemap tile", { Shade: Object.keys(SHADE) }, async ({ Shade }) => {
  const [tok, a, fg = "text/on-primary"] = SHADE[Shade];
  const b = box("treemap-tile", { component: true, w: 120, h: 120, pad: 12, radius: 12 });
  tint(b, tok, a);
  const l = box("labels", { gap: 2 });
  l.appendChild(await text("Label", SMALLM, fg, "label"));
  l.appendChild(await text("0 KB", SMALL, fg, "value"));
  b.appendChild(l);
  return b;
}, { cols: 4 });
wire(tile, [
  { layer: "labels", kind: "BOOLEAN", name: "Labels", def: true },
  { layer: "label", kind: "TEXT", name: "Label" },
  { layer: "value", kind: "TEXT", name: "Value" },
]);

// Funnel stage: bar with its figure, fading shades
const STAGE = { 1: [1, "text/on-primary"], 2: [0.8, "text/on-primary"], 3: [0.6, "text/primary"], 4: [0.4, "text/primary"] };
const stage = await variants("Funnel stage", { Shade: Object.keys(STAGE) }, async ({ Shade }) => {
  const [a, fg] = STAGE[Shade];
  const b = box("funnel-stage", { component: true, w: 200, h: 40, radius: "item", align: "CENTER", cross: "CENTER" });
  tint(b, "feedback/info/default", a);
  b.appendChild(await text("0", SMALLM, fg, "value"));
  return b;
}, { cols: 4 });
wire(stage, [{ layer: "value", kind: "TEXT", name: "Value" }]);

// Sankey node: bar + floating label, bar color by tone (height set on the instance)
const NODE = { Neutral: "secondary/active", Info: "feedback/info/default", Warning: "feedback/warning/default", Success: "feedback/success/default" };
const snode = await variants("Sankey node", { Tone: Object.keys(NODE) }, async ({ Tone }) => {
  const b = box("sankey-node", { component: true, dir: "row", gap: 4, cross: "CENTER" });
  add(b, box("bar", { w: 12, radius: 2, fill: NODE[Tone] }), { w: 12, h: "fill" });
  const l = box("label", { dir: "row", gap: 6, pad: [2, 6], radius: 6, cross: "CENTER" });
  tint(l, "bg/surface", 0.9);
  l.appendChild(await text("Label", SMALLM, "text/primary", "name"));
  l.appendChild(await text("0", SMALL, "text/secondary", "value"));
  b.appendChild(l);
  return b;
}, { cols: 4 });
wire(snode, [
  { layer: "name", kind: "TEXT", name: "Label" },
  { layer: "value", kind: "TEXT", name: "Value" },
]);

// Bar list row: tinted bar sized to the value (resized on the instance), label inside, figure to the right
const blRow = box("Bar list row", { component: true, dir: "row", gap: 16, cross: "CENTER" });
{
  const slot = box("track", { dir: "row", w: 400, h: 34 });
  const bar = box("bar", { dir: "row", pad: [0, 12], radius: 8, cross: "CENTER" });
  tint(bar, "feedback/info/default", 0.15);
  bar.appendChild(await text("/docs", SMALL, "text/primary", "label"));
  add(slot, bar, { w: 400, h: "fill" });
  blRow.appendChild(slot);
  add(blRow, await tcell("4.8k", 36, "RIGHT", SMALL, "text/secondary", "value"), { w: 36 });
}
MS.appendChild(blRow);
wire(blRow, [
  { layer: "label", kind: "TEXT", name: "Label" },
  { layer: "value", kind: "TEXT", name: "Value" },
]);

// ---- Line chart: area under the first series, two smooth lines, legend ------------------------------------------------------
const LCW = 520, LCH = 200;
const lineChart = box("Line chart", { component: true, gap: 12 });
lineChart.appendChild(rowOf("legend", [leg(0, "Subscriptions"), leg(1, "Cloud spend")]));
{
  const body = box("body", { dir: "row", gap: 8 });
  body.appendChild(await yAxis(["$60k", "$50k", "$40k", "$30k", "$20k", "$10k", "$0"], 36, LCH));
  const area = box("plot-area", { gap: 8 });
  const plot = gridFrame(LCW, LCH, 7);
  const X = (i) => (i * LCW) / 11;
  const Y = (v) => 8 + (1 - v / 60) * (LCH - 16);
  const subs = [18, 22, 21, 27, 31, 29, 36, 41, 39, 46, 52, 58].map((v, i) => [X(i), Y(v)]);
  const cloud = [12, 13, 15, 14, 18, 19, 21, 22, 24, 25, 27, 29].map((v, i) => [X(i), Y(v)]);
  draw(plot, bump(pen(), subs).L(LCW, LCH - 8).L(0, LCH - 8).Z(), "area", { fill: "feedback/info/subtle" });
  draw(plot, bump(pen(), cloud), "series-2", { stroke: SERIES[1].c, sw: 2.5, cap: "ROUND" });
  draw(plot, bump(pen(), subs), "series-1", { stroke: SERIES[0].c, sw: 2.5, cap: "ROUND" });
  area.appendChild(plot);
  area.appendChild(await xAxis(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], LCW));
  body.appendChild(area);
  lineChart.appendChild(body);
}
MS.appendChild(lineChart);
wire(lineChart, [
  { layer: "legend", kind: "BOOLEAN", name: "Legend", def: true },
  { layer: "area", kind: "BOOLEAN", name: "Area", def: true },
]);

// ---- Bar chart: two series per month, bars on a grid ---------------------------------------------------------------------
const BW = 300, BH = 200;
const barChart = box("Bar chart", { component: true, gap: 12 });
barChart.appendChild(rowOf("legend", [leg(0, "Desktop"), leg(1, "Mobile")]));
{
  const body = box("body", { dir: "row", gap: 8 });
  body.appendChild(await yAxis(["80", "60", "40", "20", "0"], 24, BH));
  const area = box("plot-area", { gap: 8 });
  const plot = gridFrame(BW, BH, 5);
  const bars = box("bars", { dir: "row", w: BW, h: BH, pad: [8, 24], align: "SPACE_BETWEEN", cross: "MAX" });
  const desk = [42, 51, 38, 64, 58, 71];
  const mob = [28, 33, 30, 41, 46, 49];
  desk.forEach((d, i) => {
    const g = box(`group-${i + 1}`, { dir: "row", gap: 4, cross: "MAX" });
    add(g, inst(chartBar, { Series: "Info" }), { h: Math.round((d / 80) * (BH - 16)) });
    add(g, inst(chartBar, { Series: "Warning" }), { h: Math.round((mob[i] / 80) * (BH - 16)) });
    bars.appendChild(g);
  });
  plot.appendChild(bars);
  bars.layoutPositioning = "ABSOLUTE";
  bars.x = 0;
  bars.y = 0;
  area.appendChild(plot);
  area.appendChild(await xAxis(["Jan", "Feb", "Mar", "Apr", "May", "Jun"], BW, { pad: [0, 24], cell: 36 }));
  body.appendChild(area);
  barChart.appendChild(body);
}
MS.appendChild(barChart);
wire(barChart, [{ layer: "legend", kind: "BOOLEAN", name: "Legend", def: true }]);

// ---- Donut chart: arcs of 22 px with a gap, figure in the hole, legend beside ----------------------------------------------
const donut = box("Donut chart", { component: true, dir: "row", gap: 32, cross: "CENTER" });
{
  const ring = box("ring", { w: 160, h: 160, align: "CENTER", cross: "CENTER" });
  const mid = box("center", { cross: "CENTER" });
  mid.appendChild(await text("46%", "Display/3", "text/primary", "center-value"));
  mid.appendChild(await text("Windows", MINI, "text/secondary", "center-label"));
  ring.appendChild(mid);
  const shares = [46, 27, 17, 10];
  const gap = 0.05;
  let at = 0;
  shares.forEach((s, i) => {
    const a1 = at + (s / 100) * 2 * Math.PI;
    draw(ring, pen().arc(80, 80, 69, at + gap / 2, a1 - gap / 2), `slice-${i + 1}`, { stroke: SERIES[i].c, sw: 22 });
    at = a1;
  });
  donut.appendChild(ring);
  const l = box("legend", { gap: 12 });
  [["Windows", "46%"], ["macOS", "27%"], ["Linux", "17%"], ["Other", "10%"]].forEach(([n, v], i) => l.appendChild(legVal(i, n, v)));
  donut.appendChild(l);
}
MS.appendChild(donut);
wire(donut, [
  { layer: "center-value", kind: "TEXT", name: "Center value" },
  { layer: "center-label", kind: "TEXT", name: "Center label" },
  { layer: "legend", kind: "BOOLEAN", name: "Legend", def: true },
]);

// ---- Heatmap: 7 days x 12 two-hour blocks, hour labels, scale --------------------------------------------------------------
const heatmap = box("Heatmap", { component: true, gap: 8 });
{
  const body = box("body", { dir: "row", gap: 8 });
  body.appendChild(await rowLabels(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], 32, 28, 4));
  body.appendChild(heatGrid("grid", 7, 12, 28, 4, (r, c) => {
    const peak = Math.exp(-((c - 6) ** 2) / 8);
    const v = (0.1 + 0.9 * peak) * (r < 5 ? 1 : 0.55) + (rnd() - 0.5) * 0.2;
    return Math.max(0, Math.min(4, Math.floor(v * 5)));
  }));
  heatmap.appendChild(body);
  const xl = box("x-axis", { dir: "row", gap: 4, pad: [0, 0, 0, 40] });
  for (let i = 0; i < 12; i++) {
    const c = box(`hour-${i + 1}`, { dir: "row", w: 28, h: 16, align: "CENTER" });
    const t = await text(`${i * 2}h`, MINI, "text/secondary", `hour-label-${i + 1}`);
    t.visible = i % 2 === 0;
    c.appendChild(t);
    xl.appendChild(c);
  }
  heatmap.appendChild(xl);
  const scale = box("scale", { dir: "row", gap: 8, align: "MAX", cross: "CENTER" });
  scale.appendChild(await text("0 req", MINI, "text/secondary", "scale-min"));
  const ramp = box("ramp", { dir: "row", gap: 2 });
  for (let l = 0; l < 5; l++) {
    const c = inst(heat, { Level: String(l) });
    c.resize(18, 8);
    ramp.appendChild(c);
  }
  scale.appendChild(ramp);
  scale.appendChild(await text("99 req", MINI, "text/secondary", "scale-max"));
  add(heatmap, scale, { w: "fill" });
}
MS.appendChild(heatmap);

// ---- Calendar heatmap: weeks as columns, Monday first, month labels, total and Less / More scale -------------------------------
const calendar = box("Calendar heatmap", { component: true, gap: 12 });
{
  const body = box("body", { dir: "row", gap: 8 });
  const left = box("left", { gap: 8 });
  add(left, box("spacer"), { w: 1, h: 16 });
  const days = box("day-labels", { gap: 3 });
  const DAYS = ["Mon", "", "Wed", "", "Fri", "", ""];
  for (let i = 0; i < DAYS.length; i++) {
    const c = box(`day-${i + 1}`, { dir: "row", w: 28, h: 14, cross: "CENTER" });
    if (DAYS[i]) c.appendChild(await text(DAYS[i], MINI, "text/secondary", `day-label-${i + 1}`));
    days.appendChild(c);
  }
  left.appendChild(days);
  body.appendChild(left);
  const right = box("right", { gap: 8 });
  const months = box("months", { dir: "row", gap: 3 });
  const MONTH = { 0: "Aug", 4: "Sep", 9: "Oct", 13: "Nov" };
  for (let w = 0; w < 14; w++) {
    const c = box(`month-${w + 1}`, { dir: "row", w: 14, h: 16 });
    if (MONTH[w]) c.appendChild(await text(MONTH[w], MINI, "text/secondary", `month-label-${w + 1}`));
    months.appendChild(c);
  }
  right.appendChild(months);
  right.appendChild(heatGrid("grid", 7, 14, 14, 3, (r) => {
    const v = rnd() * (r < 5 ? 1 : 0.6);
    return v < 0.3 ? 0 : v < 0.55 ? 1 : v < 0.75 ? 2 : v < 0.9 ? 3 : 4;
  }));
  body.appendChild(right);
  calendar.appendChild(body);
  const foot = box("footer", { dir: "row", align: "SPACE_BETWEEN", cross: "CENTER" });
  foot.appendChild(await text("1.2k contributions", SMALL, "text/secondary", "total"));
  const sc = box("scale", { dir: "row", gap: 4, cross: "CENTER" });
  sc.appendChild(await text("Less", MINI, "text/secondary", "less"));
  for (let l = 0; l < 5; l++) sc.appendChild(heatCell(l, 12));
  sc.appendChild(await text("More", MINI, "text/secondary", "more"));
  foot.appendChild(sc);
  add(calendar, foot, { w: "fill" });
}
MS.appendChild(calendar);

// ---- Treemap: nested rows and columns sized by value (grow = value) ------------------------------------------------------------
const treemap = box("Treemap", { component: true, dir: "row", gap: 4, w: 520, h: 290 });
{
  const stretch = (parent, child, g) => {
    // Figma layoutGrow only takes 0 or 1: keep the weight, sizes are resolved by fit() once the tree is built
    parent.appendChild(child);
    weight.set(child, g);
    return child;
  };
  const weight = new Map();
  const fit = (node, w, h) => {
    if (node.type !== "INSTANCE") node.resize(w, h);
    const kids = node.children ? node.children.filter((k) => weight.has(k)) : [];
    if (!kids.length) {
      if (node.type === "INSTANCE") node.resize(w, h);
      return;
    }
    const row = node.layoutMode === "HORIZONTAL";
    const sum = kids.reduce((a, k) => a + weight.get(k), 0);
    const avail = (row ? w : h) - node.itemSpacing * (kids.length - 1);
    for (const k of kids) {
      const main = (avail * weight.get(k)) / sum;
      fit(k, row ? main : w, row ? h : main);
    }
  };
  const t = (shade, label, value, g, labels = true) => ({ n: inst(tile, { Shade: shade }, { Label: label, Value: value, Labels: labels }), g });
  const place = (parent, list) => list.forEach(({ n, g }) => stretch(parent, n, g));
  const colA = box("col-1", { gap: 4 });
  place(colA, [t("Dark", "Layout", "55 KB", 55), t("Medium", "Text", "42 KB", 42)]);
  const colB = box("col-2", { gap: 4 });
  place(colB, [t("Medium", "Draw", "35 KB", 35), t("Medium", "Controls", "31 KB", 31)]);
  const colC = box("col-3", { gap: 4 });
  const top = box("top", { dir: "row", gap: 4 });
  place(top, [t("Light", "Charts", "23 KB", 23), t("Light", "Overlays", "19 KB", 19)]);
  const bottom = box("bottom", { dir: "row", gap: 4 });
  stretch(bottom, t("Light", "Platform", "16 KB", 16).n, 16);
  const small = box("small", { gap: 4 });
  stretch(small, t("Pale", "Theme", "9 KB", 9).n, 9);
  const tiny = box("tiny", { dir: "row", gap: 4 });
  place(tiny, [t("Pale", "A", "6 KB", 6, false), t("Pale", "B", "4 KB", 4, false)]);
  stretch(small, tiny, 10);
  stretch(bottom, small, 19);
  stretch(colC, top, 42);
  stretch(colC, bottom, 35);
  stretch(treemap, colA, 4.25);
  stretch(treemap, colB, 2.87);
  stretch(treemap, colC, 3.49);
  fit(treemap, 520, 290);
}
MS.appendChild(treemap);

// ---- Radar chart: hexagon rings, two series as closed polygons with dots, axis labels around -------------------------------
const radar = box("Radar chart", { component: true, gap: 12, cross: "CENTER" });
{
  radar.appendChild(await text("Review scores by release", SMALLM, "text/primary", "title"));
  radar.appendChild(await text("Speed", SMALL, "text/secondary", "axis-top"));
  const mid = box("mid", { dir: "row", gap: 8 });
  const lc = box("left-labels", { w: 64, h: 200, align: "SPACE_BETWEEN", pad: [42, 0], cross: "MAX" });
  for (const n of ["Tests", "Platforms"]) lc.appendChild(await text(n, SMALL, "text/secondary", "axis-" + n.toLowerCase()));
  mid.appendChild(lc);
  const plot = box("plot", { w: 200, h: 200 });
  const R = 88, C = 100;
  const pt = (i, f) => [C + R * f * Math.sin((i * Math.PI) / 3), C - R * f * Math.cos((i * Math.PI) / 3)];
  const hexes = pen();
  for (const f of [0.25, 0.5, 0.75, 1]) hexes.poly([0, 1, 2, 3, 4, 5].map((i) => pt(i, f)));
  draw(plot, hexes, "rings", { stroke: "border/default", sw: 1 });
  // speed, size, polish, docs, platforms, tests
  const s1 = [0.88, 0.58, 0.95, 0.5, 0.8, 0.88];
  const s2 = [0.72, 0.86, 0.75, 0.78, 0.62, 0.78];
  [[s1, 0], [s2, 1]].forEach(([vals, si]) => {
    const pts = vals.map((v, i) => pt(i, v));
    draw(plot, pen().poly(pts), `series-${si + 1}`, { fill: si ? SERIES[si].s : undefined, alpha: si ? 0.6 : undefined, stroke: SERIES[si].c, sw: 2 });
    const dots = pen();
    pts.forEach(([x, y]) => dots.circle(x, y, 3.5));
    draw(plot, dots, `dots-${si + 1}`, { fill: SERIES[si].c, stroke: "bg/surface", sw: 1.5 });
  });
  mid.appendChild(plot);
  const rc = box("right-labels", { w: 64, h: 200, align: "SPACE_BETWEEN", pad: [42, 0] });
  for (const n of ["Size", "Polish"]) rc.appendChild(await text(n, SMALL, "text/secondary", "axis-" + n.toLowerCase()));
  mid.appendChild(rc);
  radar.appendChild(mid);
  radar.appendChild(await text("Docs", SMALL, "text/secondary", "axis-bottom"));
  radar.appendChild(rowOf("legend", [leg(0, "1.0"), leg(1, "1.1")]));
}
MS.appendChild(radar);
wire(radar, [
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "legend", kind: "BOOLEAN", name: "Legend", def: true },
]);

// ---- Funnel: stage bars joined by connectors, shares on the right ------------------------------------------------------------
const funnel = box("Funnel", { component: true, dir: "row", gap: 24 });
{
  const names = ["Visited", "Signed up", "Activated", "Subscribed"];
  const figures = ["13k", "4.2k", "2.4k", "860"];
  const widths = [320, 110, 66, 44];
  const pct = [["100%"], ["33%"], ["19%", "57% of previous"], ["6.7%", "36% of previous"]];
  const labels = box("labels", { gap: 12 });
  for (let i = 0; i < names.length; i++) {
    const c = box(`label-${i + 1}`, { dir: "row", h: 40, cross: "CENTER" });
    c.appendChild(await text(names[i], SMALL, "text/primary", `name-${i + 1}`));
    labels.appendChild(c);
  }
  funnel.appendChild(labels);
  const bars = box("bars", { w: 320, cross: "CENTER" });
  widths.forEach((w, i) => {
    add(bars, inst(stage, { Shade: String(i + 1) }, { Value: figures[i] }), { w });
    if (i < 3) {
      const wi = w, wj = widths[i + 1];
      draw(bars, pen().poly([[0, 0], [wi, 0], [(wi + wj) / 2, 12], [(wi - wj) / 2, 12]]), `connector-${i + 1}`, { fill: "feedback/info/subtle" }, false);
    }
  });
  funnel.appendChild(bars);
  const ms = box("metrics", { gap: 12 });
  for (let i = 0; i < 4; i++) {
    const c = box(`metric-${i + 1}`, { w: 120, h: 40, align: "CENTER", cross: "MAX" });
    c.appendChild(await text(pct[i][0], SMALLM, "text/primary", `share-${i + 1}`));
    if (pct[i][1]) c.appendChild(await text(pct[i][1], MINI, "text/secondary", `previous-${i + 1}`));
    ms.appendChild(c);
  }
  funnel.appendChild(ms);
}
MS.appendChild(funnel);

// ---- Split bar: one bar cut into parts, legend with value and share ---------------------------------------------------------
const splitBar = box("Split bar", { component: true, gap: 16, w: 440 });
{
  const parts = [["Layout", "4.1 ms", "38%", 38], ["Text", "2.6 ms", "24%", 24], ["Paint", "2.3 ms", "21%", 21], ["Input", "1.0 ms", "9.2%", 9.2], ["Other", "0.9 ms", "8.3%", 8.3]];
  const bar = box("bar", { dir: "row", gap: 2, radius: 999, clip: true });
  parts.forEach(([n, , , g], i) => {
    const s = box(`part-${i + 1}`, { fill: SERIES[i].c });
    bar.appendChild(s);
    s.resize((440 - 2 * (parts.length - 1)) * (g / 100.5), 12);
  });
  add(splitBar, bar, { w: "fill", h: 12 });
  const l = box("legend", { dir: "row", gap: 20, wrap: 8 });
  parts.forEach(([n, v, s], i) => l.appendChild(legVal(i, n, v, s)));
  add(splitBar, l, { w: "fill" });
}
MS.appendChild(splitBar);

// ---- Waffle: 100 squares by share, drawn as one vector per run of a column (bottom up, left to right) ---------------------------
const waffle = box("Waffle", { component: true, dir: "row", gap: 32, cross: "CENTER" });
{
  const counts = [46, 31, 23];
  const series = counts.flatMap((n, i) => Array(n).fill(i));
  const grid = box("grid", { dir: "row", gap: 3 });
  for (let c = 0; c < 10; c++) {
    const col = box(`col-${c + 1}`, { gap: 3 });
    // runs from the top of the column down
    const runs = [];
    for (let r = 9; r >= 0; r--) {
      const s = series[c * 10 + r];
      if (runs.length && runs[runs.length - 1][0] === s) runs[runs.length - 1][1]++;
      else runs.push([s, 1]);
    }
    runs.forEach(([s, n], k) => {
      const p = pen();
      for (let j = 0; j < n; j++) p.rect(0, j * 15, 12, 12, 3);
      draw(col, p, `run-${k + 1}`, { fill: SERIES[s].c }, false);
    });
    grid.appendChild(col);
  }
  waffle.appendChild(grid);
  const l = box("legend", { gap: 12 });
  [["Windows", "46%"], ["macOS", "31%"], ["Linux", "23%"]].forEach(([n, v], i) => l.appendChild(legVal(i, n, v)));
  waffle.appendChild(l);
}
MS.appendChild(waffle);

// ---- Sankey: ribbons (one vector per color) behind node columns --------------------------------------------------------------
const sankey = box("Sankey", { component: true });
let sankeyLinks = 0;
{
  const K = 0.17, SH = 280, SW = 600;
  const colX = [0, 170, 340, 480];
  const colW = [170, 170, 140, 120];
  const nodes = [
    { id: "Search", v: 720, col: 0, tone: "Neutral" },
    { id: "Social", v: 480, col: 0, tone: "Neutral" },
    { id: "Referral", v: 180, col: 0, tone: "Neutral" },
    { id: "Sign up", v: 860, col: 1, tone: "Neutral" },
    { id: "Bounced", v: 520, col: 1, tone: "Warning" },
    { id: "Trial", v: 860, col: 2, tone: "Neutral" },
    { id: "Paid", v: 580, col: 3, tone: "Info" },
    { id: "Churned", v: 280, col: 3, tone: "Success" },
  ];
  const padTop = [8, 6, 52, 40];
  const gaps = [14, 28, 0, 18];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  for (let c = 0; c < 4; c++) {
    let y = padTop[c];
    for (const n of nodes.filter((m) => m.col === c)) {
      n.y = y;
      n.h = n.v * K;
      n.out = n.in = y;
      y += n.h + gaps[c];
    }
  }
  const links = [["Search", "Sign up", 420], ["Search", "Bounced", 300], ["Social", "Sign up", 260], ["Social", "Bounced", 220], ["Referral", "Sign up", 180], ["Sign up", "Trial", 860], ["Trial", "Paid", 580], ["Trial", "Churned", 280]];
  const groups = { Neutral: pen(), Warning: pen(), Info: pen(), Success: pen() };
  for (const [a, b, v] of links) {
    const s = byId[a], t = byId[b];
    const x0 = colX[s.col] + 12, x1 = colX[t.col], m = (x0 + x1) / 2;
    const ya = s.out, yb = t.in, h = v * K;
    s.out += h;
    t.in += h;
    groups[t.tone === "Neutral" ? "Neutral" : t.tone].M(x0, ya).C(m, ya, m, yb, x1, yb).L(x1, yb + h).C(m, yb + h, m, ya + h, x0, ya + h).Z();
    sankeyLinks++;
  }
  const plot = box("ribbons", { dir: "row", w: SW, h: SH });
  draw(plot, groups.Neutral, "ribbons-neutral", { fill: "secondary/hover" });
  draw(plot, groups.Warning, "ribbons-bounced", { fill: SERIES[1].c, alpha: 0.28 });
  draw(plot, groups.Info, "ribbon-paid", { fill: SERIES[0].c, alpha: 0.28 });
  draw(plot, groups.Success, "ribbon-churned", { fill: SERIES[2].c, alpha: 0.28 });
  for (let c = 0; c < 4; c++) {
    const col = box(`column-${c + 1}`, { w: colW[c], h: SH, pad: [padTop[c], 0, 0, 0], gap: gaps[c] });
    for (const n of nodes.filter((m) => m.col === c)) {
      const ni = inst(snode, { Tone: n.tone }, { Label: n.id, Value: String(n.v) });
      add(col, ni, { h: n.h });
      ni.layoutSizingHorizontal = "HUG";
    }
    plot.appendChild(col);
  }
  sankey.appendChild(plot);
}
MS.appendChild(sankey);

// ---- Bar list: ranked rows, bar width by value ---------------------------------------------------------------------------------------
const barList = box("Bar list", { component: true, gap: 12 });
{
  [["/docs", "4.8k", 4.8], ["/", "3.9k", 3.9], ["/gallery", "2.4k", 2.4], ["/blog/fast-ui-in-c", "1.8k", 1.8], ["/download", "1.2k", 1.2]].forEach(([n, v, f], i) => {
    const r = inst(blRow, {}, { Label: n, Value: v });
    r.name = `row-${i + 1}`;
    const bar = r.findOne((x) => x.name === "bar");
    bar.resize(Math.round((f / 4.8) * 400), bar.height);
    bar.layoutSizingHorizontal = "FIXED";
    barList.appendChild(r);
  });
}
MS.appendChild(barList);

// ---- Activity rings: three concentric tracks with arcs (past 100 % the arc winds on), legend beside ------------------------------------
const rings = box("Activity rings", { component: true, dir: "row", gap: 32, cross: "CENTER" });
{
  const ring = box("rings", { w: 180, h: 180 });
  const spec = [[0, 81, 0.82], [1, 57, 1.24], [2, 33, 0.58]];
  for (const [i, r] of spec) draw(ring, pen().circle(90, 90, r), `track-${i + 1}`, { stroke: SERIES[i].c, salpha: 0.18, sw: 18 });
  for (const [i, r, f] of spec) draw(ring, pen().arc(90, 90, r, 0, f * 2 * Math.PI), `ring-${i + 1}`, { stroke: SERIES[i].c, sw: 18, cap: "ROUND" });
  rings.appendChild(ring);
  const l = box("legend", { gap: 12 });
  [["Move", "82%"], ["Exercise", "124%"], ["Stand", "58%"]].forEach(([n, v], i) => l.appendChild(legVal(i, n, v)));
  rings.appendChild(l);
}
MS.appendChild(rings);
wire(rings, [{ layer: "legend", kind: "BOOLEAN", name: "Legend", def: true }]);

// ---- Scatter chart: dots of equal size, or bubbles whose area follows the value ----------------------------------------------------------
const SW2 = 500, SH2 = 200;
const scatter = await variants("Scatter chart", { Kind: ["Scatter", "Bubble"] }, async ({ Kind }) => {
  const bubble = Kind === "Bubble";
  const b = box("scatter-chart", { component: true, gap: 12 });
  b.appendChild(rowOf("legend", [leg(0, "Software"), leg(1, "OpenGL")]));
  b.appendChild(await text("Frame time (ms)", SMALLM, "text/secondary", "y-title"));
  const body = box("body", { dir: "row", gap: 8 });
  body.appendChild(await yAxis(["0.35", "0.30", "0.25", "0.20", "0.15", "0.10", "0.05", "0.00"], 36, SH2));
  const area = box("plot-area", { gap: 8 });
  const plot = gridFrame(SW2, SH2, 8);
  const X = (v) => (v / 4000) * SW2;
  const Y = (v) => 8 + (1 - v / 0.35) * (SH2 - 16);
  const n = bubble ? 12 : 26;
  const dots = (f, si) => {
    const p = pen();
    for (let i = 0; i < n; i++) {
      const xv = 180 + i * (3700 / n) + (rnd() - 0.5) * 120;
      const r = bubble ? 4 + 10 * Math.sqrt(rnd()) : 4.5;
      p.circle(X(xv), Y(f(xv)), r);
    }
    draw(plot, p, `dots-${si + 1}`, { fill: SERIES[si].c, stroke: "bg/surface", sw: 1.5, alpha: bubble ? 0.85 : undefined });
  };
  dots((x) => 0.04 + 0.29 * Math.pow(x / 3900, 1.6) + (rnd() - 0.5) * 0.03, 0);
  dots((x) => 0.1 + 0.075 * (x / 4000) + (rnd() - 0.5) * 0.04, 1);
  area.appendChild(plot);
  area.appendChild(await xAxis(["0", "500", "1.0k", "1.5k", "2.0k", "2.5k", "3.0k", "3.5k", "4.0k"], SW2));
  area.appendChild(await tcell("Nodes", SW2, "CENTER", SMALLM));
  body.appendChild(area);
  b.appendChild(body);
  return b;
}, { cols: 2 });

// ---- board cards ----------------------------------------------------------------------------------------------------------------------------------
const c = await H.cursor();

const k1 = await card(null, "Charts", "Line · bar · donut");
k1.card.appendChild(lineChart.createInstance());
k1.card.appendChild(rowOf("bars-donut", [barChart.createInstance(), donut.createInstance()], 48, "MIN"));
await burst(c, k1.wrap);

const k2 = await card(null, "Heatmap", "Day × time block, one hue");
k2.card.appendChild(heatmap.createInstance());
await burst(c, k2.wrap);

const k3 = await card(null, "Calendar heatmap", "One square a day, five levels");
k3.card.appendChild(calendar.createInstance());
await burst(c, k3.wrap);

const k4 = await card(null, "Treemap and radar", "Squarified rectangles · radar");
k4.card.appendChild(rowOf("charts", [treemap.createInstance(), radar.createInstance()], 64, "MIN"));
await burst(c, k4.wrap);

const k5 = await card(null, "Funnel, split bar and waffle", "Funnel · split bar · waffle");
const side = box("side", { gap: 32 });
side.appendChild(splitBar.createInstance());
side.appendChild(waffle.createInstance());
k5.card.appendChild(rowOf("charts", [funnel.createInstance(), side], 64, "MIN"));
await burst(c, k5.wrap);

const k6 = await card(null, "Sankey", "Sources · steps · outcomes");
k6.card.appendChild(sankey.createInstance());
await burst(c, k6.wrap);

const k7 = await card(null, "Bar list and activity rings", "Ranked bars · rings");
k7.card.appendChild(rowOf("charts", [barList.createInstance(), rings.createInstance()], 64));
await burst(c, k7.wrap);

const k8 = await card(null, "Scatter and bubble", "Scatter · bubble");
k8.card.appendChild(inst(scatter, { Kind: "Scatter" }));
k8.card.appendChild(inst(scatter, { Kind: "Bubble" }));
await burst(c, k8.wrap);
c.done();
return {
  heatCells: heat.children.length, heatInstances: [heatmap, calendar].reduce((n, f) => n + f.findAll((x) => x.type === "INSTANCE").length, 0), sankeyLinks, scatter: scatter.children.length,
  legend: legend.children.length, chartBar: chartBar.children.length, cards: 8,
};
