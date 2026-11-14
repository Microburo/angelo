// CUI data and picker scenes drawn from the C source (tests/component_shots.c): Uptime bars (dev2_uptime), Time histogram
// (dev2_histogram), Radial gauge (gauges), Candlestick chart (candlestick), Mixer = Knob + Fader + Level meter (mixer),
// Emoji picker, Schedule picker (dev_schedule), Month calendar. Dense bars, candles and level segments are merged vectors;
// plots are fixed frames with absolute children; everything else is auto-layout on the semantic tokens.
const NEW = ["Uptime bars", "Time histogram", "Radial gauge", "Candlestick chart", "Mixer", "Emoji picker", "Schedule picker", "Month calendar"];
for (const n of NEW) setNamed(n)?.remove();

const MS = rootNamed(MASTERS);
const IC = {};
for (const n of ["search", "clock", "chevron-left", "chevron-right"]) IC[n] = await H.icon(n, ICON);
const badge = setNamed("Badge");
const button = setNamed("Button");
const iconButton = setNamed("Icon button");
const input = setNamed("Input");
const segment = setNamed("Segment");
const segControl = setNamed("Segmented control");
const toggleItem = setNamed("Toggle item");
const timePicker = setNamed("Time picker");

const MINI = "Paragraph/Mini Regular", MINIM = "Paragraph/Mini Medium", SMALL = "Paragraph/Small Regular", SMALLM = "Paragraph/Small Medium";
const PI = Math.PI;

// ---- helpers ---------------------------------------------------------------------------------------------------------
const SOL = {};
const S = (t) => (SOL[t] ||= solid(t));
const paintOf = (t, a) => (a != null && a < 1 ? Object.assign({}, S(t), { opacity: a }) : S(t));
const hline = () => box("divider", { fill: "border/default" });
const spacer = () => box("spacer", { dir: "row" });
// out of the flow, at x y of the parent's own box
const abs = (parent, n, x, y) => {
  parent.appendChild(n);
  n.layoutPositioning = "ABSOLUTE";
  n.x = x;
  n.y = y;
  return n;
};
// fixed plot frame: children are absolute
const plot = (name, w, h) => box(name, { w, h });
function rect(parent, name, x, y, w, h, token, o = {}) {
  const r = figma.createRectangle();
  r.name = name;
  r.resize(Math.max(w, 0.01), Math.max(h, 0.01));
  setPaints(r, "fills", [paintOf(token, o.alpha)]);
  if (o.r) rad(r, o.r);
  return abs(parent, r, x, y);
}
function disc(parent, name, cx, cy, r, token, o = {}) {
  const e = figma.createEllipse();
  e.name = name;
  e.resize(2 * r, 2 * r);
  setPaints(e, "fills", [paintOf(token, o.alpha)]);
  return abs(parent, e, cx - r, cy - r);
}
const nrm = (a) => ((a % (2 * PI)) + 2 * PI) % (2 * PI);
// ring segment (arcData): angles in radians, 0 = 3 o'clock, clockwise
function ring(parent, name, cx, cy, R, th, a, b, token) {
  const e = figma.createEllipse();
  e.name = name;
  e.resize(2 * R, 2 * R);
  e.arcData = b - a >= 2 * PI - 1e-6 ? { startingAngle: 0, endingAngle: 2 * PI, innerRadius: (R - th) / R } : { startingAngle: nrm(a), endingAngle: nrm(a) + (b - a), innerRadius: (R - th) / R };
  e.fills = [S(token)];
  return abs(parent, e, cx - R, cy - R);
}
async function lab(parent, chars, x, y, w, align = "LEFT", color = "text/placeholder", style = MINI, name) {
  const t = await text(chars, style, color, name || chars);
  t.textAutoResize = "HEIGHT";
  t.textAlignHorizontal = align;
  t.resize(w, t.height);
  return abs(parent, t, x, y);
}
// vector pen (from 29-charts): paths in plot coordinates, translated so the box starts at 0,0
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
  p.empty = () => !cmds.length;
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
// st: { fill, alpha, stroke, salpha, sw, cap, dash }
function draw(parent, pn, name, st) {
  if (pn.empty()) return null;
  const n = pn.node(name, st.fill ? "NONZERO" : "NONE");
  const v = n.v;
  setPaints(v, "fills", st.fill ? [paintOf(st.fill, st.alpha)] : []);
  setPaints(v, "strokes", st.stroke ? [paintOf(st.stroke, st.salpha)] : []);
  if (st.stroke) {
    v.strokeWeight = st.sw || 1;
    v.strokeCap = st.cap || "NONE";
    v.strokeJoin = "ROUND";
    if (st.dash) v.dashPattern = st.dash;
  }
  return abs(parent, v, n.x, n.y);
}
// vertical or horizontal 1 px frame lines of a card
const bordered = (f) => {
  stroke(f, "border/default");
  return f;
};
const cardFrame = (name, o = {}) => box(name, { radius: "panel", fill: "bg/surface", stroke: "border/default", ...o });
const sideStroke = (f, t, r, b, l) => {
  f.strokeTopWeight = t;
  f.strokeRightWeight = r;
  f.strokeBottomWeight = b;
  f.strokeLeftWeight = l;
};
const T = { success: "feedback/success/default", warning: "feedback/warning/default", error: "feedback/error/default", info: "feedback/info/default" };

// ---- 1. Uptime bars (dev2_uptime) ------------------------------------------------------------------------------------
const uptime = box("Uptime bars", { component: true, gap: 16, w: 860 });
{
  const DAYS = 90;
  const SERVICES = [
    ["API", (i) => (i === 61 ? 0.962 : i % 17 === 5 ? 0.9985 : 1)],
    ["Website", (i) => (i === 44 ? 0.93 : 1)],
    ["Database", (i) => (i === 88 ? 0.97 : i % 23 === 9 ? 0.995 : 1)],
    ["CDN", (i) => (i < 20 ? -1 : 1)],
  ];
  for (const [name, f] of SERVICES) {
    const vals = Array.from({ length: DAYS }, (_, i) => f(i));
    const have = vals.filter((v) => v >= 0);
    const pct = ((have.reduce((a, v) => a + v, 0) / have.length) * 100).toFixed(2);
    const col = box("service", { gap: 8 });
    const head = box("head", { dir: "row", gap: 8, cross: "CENTER" });
    add(head, box("dot", { fill: T.success, radius: 999 }), { w: 8, h: 8 });
    head.appendChild(await text(name, SMALLM, "text/primary", "name"));
    head.appendChild(await text("Operational", MINI, "text/secondary", "state"));
    add(head, spacer(), { w: "fill", h: 1 });
    head.appendChild(await text(pct + "% uptime", MINI, "text/placeholder", "uptime"));
    add(col, head, { w: "fill" });
    const bars = box("bars", { dir: "row", gap: 4, h: 28 });
    for (const v of vals) {
      const r = figma.createRectangle();
      r.name = "day";
      rad(r, 2);
      // no data: border; >= 99.9%: success; >= 99%: success softened (stand-in for the success/warning mix); >= 95%: warning; else error
      const tok = v < 0 ? "border/default" : v >= 0.99 ? T.success : v >= 0.95 ? T.warning : T.error;
      setPaints(r, "fills", [paintOf(tok, v >= 0.99 && v < 0.999 ? 0.6 : null)]);
      bars.appendChild(r);
      r.layoutSizingHorizontal = "FILL";
      r.layoutSizingVertical = "FILL";
    }
    add(col, bars, { w: "fill" });
    add(uptime, col, { w: "fill" });
  }
  const foot = box("axis", { dir: "row" });
  foot.appendChild(await text("90 days ago", MINI, "text/placeholder", "from"));
  add(foot, spacer(), { w: "fill", h: 1 });
  foot.appendChild(await text("Today", MINI, "text/placeholder", "to"));
  add(uptime, foot, { w: "fill" });
}
MS.appendChild(uptime);

// ---- 2. Time histogram (dev2_histogram) ------------------------------------------------------------------------------
const hist = box("Time histogram", { component: true, gap: 8, w: 900 });
{
  const N = 96, PX = 40, PW = 856, PY = 6, PH = 124, slot = PW / N, bw = slot - 1;
  const info = [], warn = [], err = [];
  for (let i = 0; i < N; i++) {
    const x = i / N;
    info.push(120 + 80 * Math.sin(x * 6.28 * 2) + ((i * 37) % 23));
    warn.push(12 + ((i * 13) % 9) + (i > 60 && i < 70 ? 40 : 0));
    err.push(((i * 7) % 5) + (i > 62 && i < 67 ? 30 : 0));
  }
  const top = Math.max(...info.map((v, i) => v + warn[i] + err[i]));
  const ymax = Math.ceil(top / 100) * 100;
  const y = (v) => PY + PH * (1 - v / ymax);
  const pl = plot("plot", 900, 150);
  // selection of buckets 20..30 under the bars
  const sx0 = PX + 20 * slot, sx1 = PX + 31 * slot - 1;
  rect(pl, "selection", sx0, PY, sx1 - sx0, PH, "primary/subtle");
  for (let v = 0; v <= ymax; v += 100) {
    rect(pl, "grid", PX, y(v) - 0.5, PW, 1, "border/default");
    await lab(pl, String(v), 4, y(v) - 8, 30, "RIGHT");
  }
  const series = [["Info", info, null, T.info], ["Warning", warn, info, T.warning], ["Error", err, null, T.error]];
  const stack = info.map((v, i) => v + warn[i]);
  const bases = [info.map(() => 0), info, stack];
  series.forEach(([name, vals, , tok], s) => {
    const p = pen();
    vals.forEach((v, i) => {
      const yt = y(bases[s][i] + v), yb = y(bases[s][i]);
      p.rect(PX + i * slot, yt, bw, yb - yt);
    });
    draw(pl, p, name, { fill: tok });
  });
  rect(pl, "selection start", sx0 - 0.75, PY, 1.5, PH, "primary/default");
  rect(pl, "selection end", sx1 - 0.75, PY, 1.5, PH, "primary/default");
  // x ticks: 16:00 UTC start, a label every 3 h from 18:00
  for (let h = 2; h < 24; h += 3) {
    const x = PX + (h / 24) * PW;
    rect(pl, "tick", x - 0.5, PY + PH, 1, 4, "border/strong");
    await lab(pl, String((16 + h) % 24).padStart(2, "0") + ":00", x - 24, PY + PH + 4, 48, "CENTER");
  }
  add(hist, pl, { w: "fill" });
  const legend = box("legend", { dir: "row", gap: 16, pad: [0, 0, 0, 40], cross: "CENTER" });
  for (const [name, vals, , tok] of series) {
    const tot = vals.reduce((a, v) => a + v, 0);
    const it = box("legend-item", { dir: "row", gap: 4, cross: "CENTER" });
    add(it, box("swatch", { fill: tok, radius: 2 }), { w: 8, h: 8 });
    it.appendChild(await text(name, MINI, "text/secondary", "name"));
    it.appendChild(await text(tot >= 10000 ? (tot / 1000).toFixed(1) + "k" : String(Math.round(tot)), MINI, "text/placeholder", "total"));
    legend.appendChild(it);
  }
  add(hist, legend, { w: "fill" });
}
MS.appendChild(hist);

// ---- 3. Radial gauge (gauges) ----------------------------------------------------------------------------------------
const gaugesRow = box("Radial gauge", { component: true, dir: "row", gap: 24 });
async function gauge(size, o) {
  const R = size / 2 - 4, cx = size / 2, cy = 4 + R, sweep = (4 * PI) / 3, a0 = (5 * PI) / 6;
  const th = o.needle ? Math.max(3, 0.075 * R) : Math.max(6, 0.17 * R);
  const g = plot(o.name, size, o.h);
  const at = (a, r) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const angle = (t) => a0 + sweep * t;
  if (o.bands) {
    let prev = 0;
    o.bands.forEach(([upTo, tone], i) => {
      ring(g, "band-" + (i + 1), cx, cy, R, th, angle(prev / o.max), angle(upTo / o.max), T[tone]);
      prev = upTo;
    });
  } else ring(g, "track", cx, cy, R, th, a0, a0 + sweep, "bg/muted");
  const cap = (t, token, name) => disc(g, name, ...at(angle(t), R - th / 2), th / 2, token);
  if (!o.needle) {
    cap(0, "bg/muted", "track-cap-start");
    cap(1, "bg/muted", "track-cap-end");
    const t = o.value / o.max;
    ring(g, "value", cx, cy, R, th, a0, angle(t), "primary/default");
    cap(0, "primary/default", "value-cap-start");
    cap(t, "primary/default", "value-cap-end");
  } else {
    const ri = R - th - 3;
    if (o.ticks) {
      const maj = pen(), min = pen();
      const n = o.ticks;
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        maj.M(...at(angle(t), ri)).L(...at(angle(t), ri - 7));
        if (k < n - 1) for (let m = 1; m <= 4; m++) min.M(...at(angle(t + (m / 5) / (n - 1)), ri)).L(...at(angle(t + (m / 5) / (n - 1)), ri - 3.5));
        await lab(g, String(Math.round(o.max * t)), at(angle(t), ri - 17)[0] - 20, at(angle(t), ri - 17)[1] - 8, 40, "CENTER", "text/placeholder", MINI, "tick-" + (k + 1));
      }
      draw(g, min, "minor ticks", { stroke: "border/default", sw: 1 });
      draw(g, maj, "major ticks", { stroke: "border/strong", sw: 1.4 });
    }
    if (o.target != null) {
      const t = o.target / o.max;
      const [ax, ay] = at(angle(t), ri), [bx, by] = at(angle(t), R + 3);
      draw(g, pen().M(ax, ay).L(bx, by), "target edge", { stroke: "bg/surface", sw: 2.5 });
      draw(g, pen().M(ax, ay).L(bx, by), "target", { stroke: "text/primary", sw: 1.5 });
    }
    const th2 = angle(o.value / o.max);
    const tip = at(th2, R - th - 5);
    const base = at(th2, -10);
    const px = -Math.sin(th2) * 3.2, py = Math.cos(th2) * 3.2;
    draw(g, pen().poly([tip, [base[0] + px, base[1] + py], [base[0] - px, base[1] - py]]), "needle", { fill: "text/primary" });
    disc(g, "hub", cx, cy, 6.5, "text/primary");
    disc(g, "hub center", cx, cy, 2.5, "bg/surface");
  }
  const ro = box("readout", { dir: "row", gap: 4, cross: "BASELINE" });
  ro.appendChild(await text(String(o.value), "Display/2", "text/primary", "value"));
  if (o.unit) ro.appendChild(await text(o.unit, SMALLM, "text/secondary", "unit"));
  abs(g, ro, 0, 0);
  const yc = o.needle ? cy + 0.42 * R : cy - 6;
  ro.x = cx - ro.width / 2;
  ro.y = yc - ro.height / 2;
  await lab(g, o.label, 0, ro.y + ro.height + 2, size, "CENTER", "text/secondary", SMALL, "label");
  return g;
}
{
  const load = [[60, "success"], [85, "warning"], [100, "error"]];
  gaugesRow.appendChild(await gauge(200, { name: "gauge-cpu", h: 184, needle: true, value: 72, max: 100, unit: "%", label: "CPU load", bands: load, ticks: 5 }));
  gaugesRow.appendChild(await gauge(200, { name: "gauge-rps", h: 184, needle: true, value: 1840, max: 2500, label: "Requests per second", target: 2000, ticks: 5 }));
  gaugesRow.appendChild(await gauge(160, { name: "gauge-disk", h: 124, needle: false, value: 38, max: 100, unit: "%", label: "Disk" }));
}
MS.appendChild(gaugesRow);

// ---- 4. Candlestick chart (candlestick) ------------------------------------------------------------------------------
const candle = cardFrame("Candlestick chart", { component: true, gap: 8, pad: 16, w: 820 });
{
  // deterministic series: LCG seed 42, 140 daily candles, five draws each
  let seed = 42, price = 182;
  const draws = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed >>> 8) / 16777216;
  };
  const K = [];
  for (let i = 0; i < 140; i++) {
    const [u0, u1, u2, u3] = [draws(), draws(), draws(), draws()];
    draws();
    const vol = 0.012 + 0.018 * (0.5 + 0.5 * Math.sin(i * 0.07));
    const o = price, c = o * (1 + (u0 - 0.48) * 2 * vol);
    K.push({ o, c, h: Math.max(o, c) * (1 + u1 * vol * 0.8), l: Math.min(o, c) * (1 - u2 * vol * 0.8), v: (0.6 + u3 * 0.9 + (Math.abs(c - o) / o) * 30) * 1.2e6 });
    price = c;
  }
  const head = box("head", { dir: "row", gap: 8, cross: "CENTER" });
  head.appendChild(await text("NRTH", "Paragraph/Medium Medium", "text/primary", "symbol"));
  head.appendChild(await text("Northwind Labs", SMALL, "text/secondary", "name"));
  add(head, spacer(), { w: "fill", h: 1 });
  head.appendChild(inst(badge, { Tone: "Neutral" }, { Label: "Daily" }));
  add(candle, head, { w: "fill" });

  const W = 788, PW = 732, PY = 6, PH = 272, VH = 49, AH = PH - VH - 8; // price area height 215, volume below it
  const CW = 9, BW = 6, FIRST = 58.67, I0 = 59, I1 = 139;
  const vis = K.slice(I0, I1 + 1);
  const ylo = Math.min(...vis.map((k) => k.l)) * 0.95, yhi = Math.max(...vis.map((k) => k.h)) * 1.05;
  const y = (p) => PY + AH * (1 - (p - ylo) / (yhi - ylo));
  const xc = (i) => (i + 0.5 - FIRST) * CW;
  const vmax = Math.max(...vis.map((k) => k.v));
  const pl = plot("plot", W, 300);
  // nice-step grid lines with the price labels on the right axis
  const raw = (yhi - ylo) / 5, mag = 10 ** Math.floor(Math.log10(raw)), n = raw / mag;
  const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  for (let p = Math.ceil(ylo / step) * step; p < yhi; p += step) {
    rect(pl, "grid", 0, y(p) - 0.5, PW, 1, "border/default");
    await lab(pl, p.toFixed(2), PW + 8, y(p) - 8, 48, "LEFT");
  }
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (let i = I0; i <= I1; i++) {
    if (i % 10) continue;
    rect(pl, "grid", xc(i) - 0.5, PY, 1, PH, "border/default", { alpha: 0.6 });
    await lab(pl, `${MON[(8 + Math.floor(i / 28)) % 12]} ${(i % 28) + 1}`, xc(i) - 24, PY + PH + 4, 48, "CENTER");
  }
  rect(pl, "axis", 0, PY + AH - 0.5, PW, 1, "border/default");
  // merged vectors: volume, wicks, bodies, per direction
  const up = { vol: pen(), wick: pen(), body: pen() }, dn = { vol: pen(), wick: pen(), body: pen() };
  for (let i = I0; i <= I1; i++) {
    const k = K[i], d = k.c >= k.o ? up : dn;
    const x = xc(i);
    const vh = (k.v / vmax) * VH;
    d.vol.rect(x - BW / 2, PY + PH - vh, BW, vh);
    d.wick.rect(x - 0.5, y(k.h), 1, Math.max(y(k.l) - y(k.h), 1));
    const bt = y(Math.max(k.o, k.c)), bb = y(Math.min(k.o, k.c));
    d.body.rect(x - BW / 2, bt, BW, Math.max(bb - bt, 1), 2);
  }
  draw(pl, dn.vol, "volume down", { fill: T.error, alpha: 0.32 });
  draw(pl, up.vol, "volume up", { fill: T.success, alpha: 0.32 });
  draw(pl, dn.wick, "wicks down", { fill: T.error });
  draw(pl, up.wick, "wicks up", { fill: T.success });
  draw(pl, dn.body, "bodies down", { fill: T.error });
  draw(pl, up.body, "bodies up", { fill: T.success });
  // SMA 20
  const sma = pen();
  for (let i = I0; i <= I1; i++) {
    const m = K.slice(i - 19, i + 1).reduce((a, k) => a + k.c, 0) / 20;
    i === I0 ? sma.M(xc(i), y(m)) : sma.L(xc(i), y(m));
  }
  draw(pl, sma, "SMA 20", { stroke: T.info, sw: 1.5 });
  // last price: dashed line and a tag on the axis
  const last = K[I1], lc = last.c >= last.o ? T.success : T.error, ly = y(last.c);
  draw(pl, pen().M(0, ly).L(PW, ly), "last price", { stroke: lc, salpha: 0.7, sw: 1, dash: [3, 3] });
  const tag = box("last-price-tag", { w: 48, h: 16, fill: lc, radius: 4, align: "CENTER", cross: "CENTER" });
  tag.appendChild(await text(last.c.toFixed(2), MINI, "text/on-primary", "price"));
  abs(pl, tag, PW + 4, ly - 8);
  add(candle, pl, { w: "fill" });
}
MS.appendChild(candle);

// ---- 5. Mixer: knobs + horizontal level meter, faders with level meters (mixer) --------------------------------------------
const mixer = box("Mixer", { component: true, dir: "row", gap: 24 });
{
  const zone = (db) => (db < -18 ? T.success : db < -6 ? T.warning : T.error);
  async function knob(t, base, value, label) {
    const col = box("knob", { gap: 4, cross: "CENTER" });
    const dial = plot("dial", 48, 48);
    const R = 23, th = 3, ar = R - th / 2, A0 = (3 * PI) / 4, SW = (3 * PI) / 2;
    const at = (a, r) => [24 + r * Math.cos(a), 24 + r * Math.sin(a)];
    ring(dial, "track", 24, 24, R, th, A0, A0 + SW, "bg/muted");
    for (const [i, tt] of [[0, 0], [1, 1]]) disc(dial, "track-cap-" + (i ? "end" : "start"), ...at(A0 + SW * tt, ar), th / 2, "bg/muted");
    const lo = Math.min(base, t), hi = Math.max(base, t);
    if (hi - lo > 0.001) {
      ring(dial, "value", 24, 24, R, th, A0 + SW * lo, A0 + SW * hi, "primary/default");
      disc(dial, "value-cap-start", ...at(A0 + SW * lo, ar), th / 2, "primary/default");
      disc(dial, "value-cap-end", ...at(A0 + SW * hi, ar), th / 2, "primary/default");
    }
    const body = box("body", { w: 32, h: 32, fill: "bg/surface", radius: 999, stroke: "border/default" });
    await body.setEffectStyleIdAsync(ES["Elevation/sm"].id);
    abs(dial, body, 8, 8);
    const ang = A0 + SW * t;
    draw(dial, pen().M(...at(ang, 4.8)).L(...at(ang, 12)), "pointer", { stroke: "text/primary", sw: 2, cap: "ROUND" });
    col.appendChild(dial);
    col.appendChild(await text(value, SMALLM, "text/primary", "value"));
    col.appendChild(await text(label, MINI, "text/secondary", "label"));
    return col;
  }
  async function hmeter(levels) {
    const m = box("level-meter", { gap: 4 });
    const ch = box("channels", { gap: 4 });
    levels.forEach((lv, c) => {
      const row = box("channel-" + (c + 1), { dir: "row", gap: 4, cross: "CENTER" });
      const seg = plot("segments", 190, 6);
      const lit = { [T.success]: pen(), [T.warning]: pen(), [T.error]: pen() }, off = pen();
      for (let i = 0; i < 47; i++) {
        const db = -60 + ((i + 0.5) / 47) * 66;
        (db <= lv ? lit[zone(db)] : off).rect(i * 4, 0, 3, 6);
      }
      draw(seg, off, "unlit", { fill: "bg/muted" });
      for (const [tok, p] of Object.entries(lit)) draw(seg, p, "lit " + tok.split("/")[1], { fill: tok });
      row.appendChild(seg);
      add(row, box("lamp", { fill: "bg/muted", radius: 2 }), { w: 6, h: 6 });
      ch.appendChild(row);
    });
    m.appendChild(ch);
    const sc = plot("scale", 190, 14);
    for (const db of [-48, -36, -24, -12, 0]) await lab(sc, String(db), ((db + 60) / 66) * 190 - 14, 0, 28, "CENTER");
    m.appendChild(sc);
    return m;
  }
  const filter = cardFrame("filter", { gap: 16, pad: 16 });
  filter.appendChild(await text("Filter", SMALLM, "text/primary", "title"));
  const knobs = box("knobs", { dir: "row", gap: 12, cross: "MIN" });
  knobs.appendChild(await knob(0.693, 0, "2400 Hz", "Cutoff"));
  knobs.appendChild(await knob(0.35, 0, "0.35", "Resonance"));
  knobs.appendChild(await knob(0.375, 0, "4.5 dB", "Drive"));
  knobs.appendChild(await knob(0.4, 0.5, "-0.20", "Pan"));
  filter.appendChild(knobs);
  filter.appendChild(await hmeter([-9, -14]));
  mixer.appendChild(filter);

  const GY = 162, GH = 154;
  const fy = (db) => GY - ((db + 48) / 54) * GH;
  async function fader(db, name, levels, ticks) {
    const col = box("fader", { gap: 4, cross: "CENTER" });
    col.appendChild(await text(db.toFixed(1) + " dB", SMALLM, "text/primary", "value"));
    const row = box("body", { dir: "row", gap: 4, cross: "MIN" });
    if (ticks) {
      const sc = plot("scale", 26, 170);
      for (const d of ticks) await lab(sc, String(d), 0, fy(d) - 8, 26, "RIGHT");
      row.appendChild(sc);
    }
    const track = plot("track", 30, 170);
    rect(track, "groove", 13, 8, 4, GH, "bg/muted", { r: 2 });
    const thumb = box("thumb", { w: 30, h: 16, fill: "bg/surface", radius: 4, stroke: "border/strong" });
    await thumb.setEffectStyleIdAsync(ES["Elevation/sm"].id);
    abs(track, thumb, 0, fy(db) - 8);
    rect(track, "grip", 7, fy(db) - 0.75, 16, 1.5, "border/strong");
    row.appendChild(track);
    const mt = box("meter", { dir: "row", gap: 2 });
    for (const lv of levels) {
      const c = plot("channel", 4, 170);
      c.fills = [S("bg/muted")];
      c.clipsContent = true;
      const yy = (d) => 170 * (1 - (d + 48) / 54);
      const bands = [[-48, -18, T.success], [-18, -6, T.warning], [-6, 6, T.error]];
      for (const [lo, hi, tok] of bands) if (lv > lo) rect(c, "level", 0, yy(Math.min(lv, hi)), 4, yy(lo) - yy(Math.min(lv, hi)), tok);
      mt.appendChild(c);
    }
    row.appendChild(mt);
    col.appendChild(row);
    col.appendChild(await text(name, MINI, "text/secondary", "label"));
    return col;
  }
  const faders = cardFrame("faders", { dir: "row", gap: 8, pad: 16, cross: "MIN" });
  faders.appendChild(await fader(-6, "Vocals", [-10, -12], [6, 0, -6, -12, -24, -48]));
  faders.appendChild(await fader(0, "Guitar", [-20, -16]));
  faders.appendChild(await fader(-12.5, "Bass", [-7, -9]));
  faders.appendChild(await fader(-3, "Drums", [-5, -14]));
  mixer.appendChild(faders);
}
MS.appendChild(mixer);

// ---- 6. Emoji picker -------------------------------------------------------------------------------------------------
const emoji = box("Emoji picker", { component: true, dir: "row", gap: 24, cross: "MIN" });
{
  const picker = cardFrame("picker", { w: 360, clip: true });
  const top = box("search", { dir: "row", gap: 4, pad: [8, 8, 4, 8], cross: "CENTER" });
  add(top, inst(input, { Type: "Text", State: "Default", Value: "Placeholder" }, { "Left icon": true, "Left icon swap": IC.search.id, Text: "Search emoji" }), { w: "fill" });
  const tone = box("tone", { dir: "row", radius: 8, stroke: "border/default", align: "CENTER", cross: "CENTER" });
  tone.appendChild(await text("✋", "Display/4", "text/primary", "glyph"));
  add(top, tone, { w: 36, h: 36 });
  add(picker, top, { w: "fill" });

  const tabs = box("tabs", { dir: "row", pad: [0, 8] });
  const TABS = [null, "\u{1F600}", "\u{1F44B}", "\u{1F43B}", "\u{1F354}", "✈️", "⚽", "\u{1F4A1}", "\u{1F523}", "\u{1F3C1}"];
  for (let i = 0; i < TABS.length; i++) {
    const tb = box("tab-" + (i + 1), { align: "CENTER", cross: "CENTER" });
    const g = box("glyph", { dir: "row", align: "CENTER", cross: "CENTER" });
    g.appendChild(TABS[i] ? await text(TABS[i], "Display/4", "text/primary", "glyph") : await ico("clock", 18, "icon/default", "recent"));
    add(tb, g, { w: "fill", h: 32 });
    const ul = box("underline", { dir: "row", pad: [0, 8] });
    if (!i) add(ul, box("bar", { fill: "primary/default", radius: 999 }), { w: "fill", h: 2 });
    add(tb, ul, { w: "fill", h: 2 });
    if (i) tb.opacity = 0.5;
    add(tabs, tb, { w: "fill" });
  }
  add(picker, tabs, { w: "fill" });
  add(picker, hline(), { w: "fill", h: 1 });

  const view = box("grid", { w: 360, h: 280, pad: 8, clip: true });
  const group = async (title, list, perRow) => {
    const hd = box("group", { dir: "row", pad: [0, 0, 0, 12], cross: "CENTER" });
    hd.appendChild(await text(title, MINIM, "text/placeholder", "title"));
    add(view, hd, { w: "fill", h: 30 });
    for (let i = 0; i < list.length; i += perRow) {
      const row = box("row", { dir: "row" });
      for (const e of list.slice(i, i + perRow)) {
        const cell = box("emoji", { dir: "row", align: "CENTER", cross: "CENTER" });
        cell.appendChild(await text(e, "Display/2", "text/primary", "glyph"));
        add(row, cell, { w: 38, h: 38 });
      }
      add(view, row);
    }
  };
  await group("Recent", ["\u{1F44D}", "\u{1F389}", "✅", "\u{1F602}", "\u{1F680}", "\u{1F440}", "❤️", "\u{1F64F}"], 8);
  const SMILEYS = "\u{1F600} \u{1F603} \u{1F604} \u{1F601} \u{1F606} \u{1F605} \u{1F923} \u{1F602} \u{1F642} \u{1F643} \u{1F609} \u{1F60A} \u{1F607} \u{1F970} \u{1F60D} \u{1F929} \u{1F618} \u{1F617} ☺️ \u{1F61A} \u{1F619} \u{1F972} \u{1F60B} \u{1F61B} \u{1F61C} \u{1F92A} \u{1F61D} \u{1F911} \u{1F917} \u{1F92D} \u{1F92B} \u{1F914} \u{1F910} \u{1F928} \u{1F610} \u{1F611} \u{1F636} \u{1F60F} \u{1F612} \u{1F644} \u{1F62C} \u{1F925} \u{1F60C} \u{1F614} \u{1F62A}".split(" ");
  await group("Smileys & emotion", SMILEYS, 9);
  add(picker, view, { w: "fill", h: 280 });
  add(picker, hline(), { w: "fill", h: 1 });
  const prev = box("preview", { dir: "row", gap: 8, pad: [0, 12], minH: 48, cross: "CENTER" });
  prev.appendChild(await text("Pick an emoji", SMALL, "text/placeholder", "name"));
  add(picker, prev, { w: "fill" });
  emoji.appendChild(picker);

  const side = box("status", { gap: 8, w: 240 });
  side.appendChild(await text("Status", SMALLM, "text/primary", "title"));
  add(side, inst(input, { Type: "Text", State: "Default", Value: "Filled" }, { "Left icon": false, Text: "Shipped the fix " }), { w: "fill" });
  const react = box("reactions", { dir: "row", gap: 8, cross: "CENTER" });
  for (const [e, n] of [["\u{1F389}", "3"], ["\u{1F440}", "5"], ["\u{1F680}", "2"]]) {
    react.appendChild(await text(e, "Display/4", "text/primary", "emoji"));
    react.appendChild(await text(n, SMALL, "text/primary", "count"));
  }
  side.appendChild(react);
  emoji.appendChild(side);
}
MS.appendChild(emoji);

// ---- 7. Schedule picker (dev_schedule) -------------------------------------------------------------------------------
const sched = box("Schedule picker", { component: true, gap: 8, w: 560 });
{
  const seg = inst(segControl);
  seg.name = "frequency";
  const slot = seg.findChild((n) => n.type === "SLOT");
  for (const k of [...slot.children]) k.remove();
  ["Minutes", "Hourly", "Daily", "Weekly", "Monthly", "Custom"].forEach((l) => slot.appendChild(inst(segment, { Selected: l === "Weekly" ? "On" : "Off" }, { Label: l })));
  sched.appendChild(seg);

  const controls = box("controls", { dir: "row", gap: 8, minH: 36, cross: "CENTER" });
  const days = box("weekdays", { dir: "row", gap: 4, pad: 4, radius: 12, stroke: "border/default", fill: "bg/surface", cross: "CENTER" });
  ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].forEach((d, i) => {
    const it = inst(toggleItem, { Selected: i < 5 ? "On" : "Off" }, { "Label text": d });
    it.name = "day-" + d;
    it.findOne((n) => n.name === "icon").visible = false;
    days.appendChild(it);
  });
  controls.appendChild(days);
  controls.appendChild(await text("at", SMALL, "text/secondary", "at"));
  controls.appendChild(inst(timePicker, { State: "Closed" }));
  sched.appendChild(controls);

  const sum = box("summary", { dir: "row", gap: 8, cross: "CENTER" });
  sum.appendChild(await ico("clock", 16, "text/secondary", "clock"));
  sum.appendChild(await text("Every weekday at 09:30", SMALLM, "text/primary", "summary"));
  sum.appendChild(await text("30 9 * * 1-5", "Code/11", "text/placeholder", "cron"));
  sched.appendChild(sum);

  const runs = box("next-runs", { gap: 4, pad: [0, 0, 0, 24] });
  for (const r of ["Mon, Nov 9 · 09:30", "Tue, Nov 10 · 09:30", "Wed, Nov 11 · 09:30"]) runs.appendChild(await text(r, MINI, "text/secondary", "run"));
  sched.appendChild(runs);
}
MS.appendChild(sched);

// ---- 8. Month calendar -----------------------------------------------------------------------------------------------
const month = box("Month calendar", { component: true, gap: 8, w: 880 });
{
  // grid index 0 = Mon Oct 26, Nov d = d + 5; today Nov 8, selected Nov 10
  const NOV = (d) => d + 5, TODAY = NOV(8), SEL = NOV(10), ROWS = 6, CAP = 3;
  const TONE = {
    info: ["feedback/info/subtle", "feedback/info/default"],
    violet: ["primary/subtle", "primary/default"],
    rose: ["feedback/error/subtle", "feedback/error/default"],
    danger: ["feedback/error/subtle", "feedback/error/default"],
    teal: ["feedback/success/subtle", "feedback/success/default"],
    success: ["feedback/success/subtle", "feedback/success/default"],
    warning: ["feedback/warning/subtle", "feedback/warning/default"],
  };
  // [title, first day, last day, time or null for an all-day bar, tone]
  const EV = [
    ["Design sprint", 2, 4, null, "violet"], ["Standup", 2, 2, "9:30", "info"], ["1:1 with Jonas", 3, 3, "14:00", "rose"],
    ["Release 1.2", 6, 6, null, "success"], ["Standup", 9, 9, "9:30", "info"], ["Customer call", 10, 10, "11:00", "danger"],
    ["Lunch with Maya", 10, 10, "12:30", "teal"], ["Review: docking", 10, 10, "15:00", "violet"], ["Planning", 10, 10, "16:30", "warning"],
    ["Offsite, Lisbon", 12, 14, null, "warning"], ["Standup", 16, 16, "9:30", "info"], ["Accessibility audit", 17, 20, null, "teal"],
    ["Demo day", 20, 20, "16:00", "violet"], ["Standup", 23, 23, "9:30", "info"], ["Holiday", 26, 27, null, "success"],
    ["Board meeting", 30, 30, "10:00", "danger"],
  ].map(([title, s, e, time, tone]) => ({ title, s: NOV(s), e: NOV(e), time, tone }));
  // lanes of the all-day bars, per week: first lane free over every covered day
  const lane = new Map();
  for (let w = 0; w < ROWS; w++) {
    const used = [];
    for (const ev of EV.filter((x) => !x.time && x.s >= w * 7 && x.s < w * 7 + 7).sort((a, b) => a.s - b.s || b.e - a.e)) {
      let l = 0;
      while (used.some(([ll, s, e]) => ll === l && s <= ev.e && ev.s <= e)) l++;
      used.push([l, ev.s, ev.e]);
      lane.set(ev, l);
    }
  }
  const dayNum = (k) => (k <= 5 ? 26 + k : k <= 35 ? k - 5 : k - 35);

  const head = box("header", { dir: "row", gap: 4, cross: "CENTER" });
  add(head, await text("November 2026", "Paragraph/Large Medium", "text/primary", "title"), { w: "fill" });
  head.appendChild(inst(button, { Type: "Outline", Size: "sm" }, { Label: "Today" }));
  head.appendChild(inst(iconButton, { Type: "Ghost", Size: "sm" }, { Icon: IC["chevron-left"].id }));
  head.appendChild(inst(iconButton, { Type: "Ghost", Size: "sm" }, { Icon: IC["chevron-right"].id }));
  add(month, head, { w: "fill" });

  const wk = box("weekdays", { dir: "row" });
  for (const d of ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]) {
    const c = box("weekday-" + d, { dir: "row", pad: [0, 0, 0, 8] });
    c.appendChild(await text(d, MINIM, "text/placeholder", "label"));
    add(wk, c, { w: "fill" });
  }
  add(month, wk, { w: "fill" });

  const grid = box("grid", { stroke: "border/default" });
  sideStroke(grid, 1, 0, 0, 1);
  for (let w = 0; w < ROWS; w++) {
    const row = box("week-" + (w + 1), { dir: "row", h: 96 });
    for (let c = 0; c < 7; c++) {
      const k = w * 7 + c, outside = k <= 5 || k >= 36;
      const cell = box("day-" + k, { stroke: "border/default", fill: k === SEL ? "primary/subtle" : undefined });
      sideStroke(cell, 0, 1, 1, 0);
      const hd = box("head", { dir: "row", pad: [0, 0, 0, 4], cross: "CENTER" });
      const pill = box("number", { dir: "row", pad: [0, 6], fill: k === TODAY ? "primary/default" : undefined, radius: 999, align: "CENTER", cross: "CENTER" });
      pill.minWidth = 22;
      pill.appendChild(await text(String(dayNum(k)), k === SEL ? SMALLM : SMALL, k === TODAY ? "text/on-primary" : outside ? "text/placeholder" : "text/primary", "day"));
      add(hd, pill, { h: 20 });
      add(cell, hd, { w: "fill", h: 26 });
      // lines: bar lanes first (gaps keep the lanes aligned across the week), then the timed events
      const bars = EV.filter((x) => !x.time && x.s <= k && k <= x.e);
      const nBar = bars.reduce((m, x) => Math.max(m, lane.get(x) + 1), 0);
      const items = [];
      for (let l = 0; l < nBar; l++) items.push({ bar: bars.find((x) => lane.get(x) === l) });
      for (const x of EV.filter((x) => x.time && x.s === k)) items.push({ timed: x });
      let shown = items, hidden = 0;
      if (items.length > CAP) {
        shown = items.slice(0, CAP - 1);
        hidden = items.slice(CAP - 1).filter((x) => x.bar || x.timed).length;
      }
      for (const it of shown) {
        const line = box("line", { dir: "row", pad: [1, 0], cross: "CENTER" });
        if (it.bar) {
          const ev = it.bar, first = k === ev.s, lastDay = k === ev.e, [sub, edge] = TONE[ev.tone];
          line.paddingLeft = first ? 4 : 0;
          line.paddingRight = lastDay ? 4 : 0;
          const bar = box("bar", { dir: "row", gap: 4, pad: [0, first ? 4 : 0, 0, first ? 4 : 0], fill: sub, cross: "CENTER" });
          if (first) {
            num(bar, "topLeftRadius", 4, "radius");
            num(bar, "bottomLeftRadius", 4, "radius");
            stroke(bar, edge);
            sideStroke(bar, 0, 0, 0, 3);
          }
          if (lastDay) {
            num(bar, "topRightRadius", 4, "radius");
            num(bar, "bottomRightRadius", 4, "radius");
          }
          if (first) {
            const t = await text(ev.title, MINIM, "text/primary", "title");
            t.textTruncation = "ENDING";
            t.maxLines = 1;
            add(bar, t, { w: "fill" });
          }
          add(line, bar, { w: "fill", h: "fill" });
        } else if (it.timed) {
          const ev = it.timed, [, edge] = TONE[ev.tone];
          line.paddingLeft = 8;
          line.paddingRight = 4;
          line.itemSpacing = 4;
          add(line, box("dot", { fill: edge, radius: 999 }), { w: 4, h: 4 });
          line.appendChild(await text(ev.time, MINI, "text/placeholder", "time"));
          const t = await text(ev.title, MINI, "text/primary", "title");
          t.textTruncation = "ENDING";
          t.maxLines = 1;
          add(line, t, { w: "fill" });
        }
        add(cell, line, { w: "fill", h: 19 });
      }
      if (hidden) {
        const line = box("more", { dir: "row", pad: [0, 0, 0, 8], cross: "CENTER" });
        line.appendChild(await text(`+${hidden} more`, MINIM, "text/secondary", "more"));
        add(cell, line, { w: "fill", h: 19 });
      }
      add(row, cell, { w: "fill", h: "fill" });
    }
    add(grid, row, { w: "fill" });
  }
  add(month, grid, { w: "fill" });
}
MS.appendChild(month);

// ---- board cards ------------------------------------------------------------------------------------------------------
const c = await H.cursor();
const CARDS = [
  ["Uptime bars", "90 days per service · tone by availability", uptime],
  ["Time histogram", "Stacked series · selection · legend totals", hist],
  ["Radial gauge", "Bands · needle · target · ring only", gaugesRow],
  ["Candlestick chart", "Candles · volume · SMA · last price", candle],
  ["Knob, fader and level meter", "Knobs · horizontal meter · faders with meters", mixer],
  ["Emoji picker", "Search · categories · grid · preview", emoji],
  ["Schedule picker", "Frequency · weekdays · time · next runs", sched],
  ["Month calendar", "Weeks · day pill · bars and timed events", month],
];
for (const [caption, sub, master] of CARDS) {
  const k = await card(null, caption, sub);
  k.card.appendChild(master.createInstance());
  await burst(c, k.wrap);
}
c.done();
return Object.fromEntries(CARDS.map(([cap, , m]) => [cap, `${m.name} ${Math.round(m.width)}x${Math.round(m.height)}`]));
