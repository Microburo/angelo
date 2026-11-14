// CUI tool panels drawn from the C source (src/cui_flame.c, cui_curves.c, cui_devpanels.c + tests/component_shots.c):
// Flame graph, Curve editor, Gradient editor, Timeline editor, Key-value editor, Problems panel, Test explorer, Regex tester.
// Part masters: Gradient stop, Timeline track, Key-value row, Problem file, Problem row, Test row, Regex chip.
// Drawings (flame bars, curves, timeline keys and clips) are fixed-size plot frames whose vector children are absolute,
// one multi-subpath vector per paint; list parts are real auto-layout rows. Mono text reuses the Code/* styles made by 33-code.
const NEW = [
  "Flame graph", "Curve editor", "Gradient stop", "Gradient editor", "Timeline track", "Timeline editor", "Key-value row", "Key-value editor",
  "Problem file", "Problem row", "Problems panel", "Test row", "Test explorer", "Regex chip", "Regex tester",
];
for (const n of NEW) setNamed(n)?.remove();

// ---- mono text styles ------------------------------------------------------------------------------------------------
const MONO = { family: "Menlo", style: "Regular" };
await figma.loadFontAsync(MONO);
for (const [n, [size, lh]] of Object.entries({ "Code/11": [11, 16], "Code/12": [12, 20], "Code/12 Tall": [12, 21], "Code/13": [13, 21], "Code/13 Compact": [13, 19] })) {
  if (TS[n]) continue;
  const s = figma.createTextStyle();
  s.name = n;
  s.fontName = MONO;
  s.fontSize = size;
  s.lineHeight = { unit: "PIXELS", value: lh };
  TS[n] = s;
}

const pick = async (...names) => {
  for (const n of names) {
    try {
      if (await H.icon(n, ICON)) return n;
    } catch {}
  }
  throw new Error("no Lucide icon among " + names.join(", "));
};
const ICONS = ["chevron-down", "file", "circle-x", "triangle-alert", "info", "circle-check", "chevrons-right", "search", "play", "lock", "x", "trash-2", "user", "video", "audio-lines", "clock"];
const IC = {};
for (const n of ICONS) IC[n] = await H.icon(n, ICON);
const HELP = await pick("circle-help", "circle-question-mark");
IC["circle-help"] = await H.icon(HELP, ICON);
IC["lock-open"] = await H.icon(await pick("lock-open", "unlock"), ICON);
const MS = rootNamed(MASTERS);
const checkbox = setNamed("Checkbox");
const button = setNamed("Button");
const iconButton = setNamed("Icon button");
const input = setNamed("Input");
const scrub = setNamed("Scrub field");
const colorPicker = setNamed("Color picker");
const titem = setNamed("Toggle item");
const spinner = setNamed("Spinner");

// ---- helpers ---------------------------------------------------------------------------------------------------------
const PL = "text/primary", PU = "text/secondary", PH = "text/placeholder";
const S13 = "Paragraph/Small Regular", S13M = "Paragraph/Small Medium", S11 = "Paragraph/Mini Regular", S11M = "Paragraph/Mini Medium";
const SERIES = [
  { n: "Info", c: "feedback/info/default", s: "feedback/info/subtle" },
  { n: "Warning", c: "feedback/warning/default", s: "feedback/warning/subtle" },
  { n: "Success", c: "feedback/success/default", s: "feedback/success/subtle" },
  { n: "Error", c: "feedback/error/default", s: "feedback/error/subtle" },
  { n: "Primary", c: "primary/default", s: "primary/subtle" },
];
const hline = () => box("divider", { fill: "border/default" });
const spacer = () => box("spacer");
const bottomBorder = (f, color = "border/default") => {
  stroke(f, color);
  f.strokeTopWeight = f.strokeLeftWeight = f.strokeRightWeight = 0;
  f.strokeBottomWeight = 1;
};
const rightBorder = (f, color = "border/default") => {
  stroke(f, color);
  f.strokeTopWeight = f.strokeLeftWeight = f.strokeBottomWeight = 0;
  f.strokeRightWeight = 1;
};
const tintFill = (f, token, a) => {
  setPaints(f, "fills", [a == null || a >= 1 ? solid(token) : Object.assign({}, solid(token), { opacity: a })]);
};
// property of an instance nested in an instance (or master), found by layer name
function nest(root, layer, props) {
  const n = root.findOne((x) => x.name === layer && x.type === "INSTANCE");
  if (!n) throw new Error("no instance " + layer);
  const defs = n.componentProperties;
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    const key = Object.keys(defs).find((d) => d === k || d.split("#")[0] === k);
    if (!key) throw new Error(`no property ${k} on ${layer}`);
    out[key] = v;
  }
  n.setProperties(out);
  return n;
}
const layerOf = (root, name) => {
  const n = root.findOne((x) => x.name === name);
  if (!n) throw new Error("no layer " + name);
  return n;
};
// icon vectors of a nested icon instance repainted with a token
const inkIcon = (root, layer, token) => {
  for (const v of layerOf(root, layer).findAll((x) => x.type === "VECTOR")) v.fills = [solid(token)];
};
// text node of an instance repainted with a token
const inkText = (root, layer, token) => {
  layerOf(root, layer).fills = [solid(token)];
};
// text placed freely in a plot frame: x, y, optional fixed width with alignment, optional ellipsis
async function atext(parent, chars, x, y, style, color, o = {}) {
  const t = await text(chars, style, color, o.name || chars.slice(0, 24));
  parent.appendChild(t);
  t.layoutPositioning = "ABSOLUTE";
  if (o.w) {
    t.textAutoResize = "HEIGHT";
    t.resize(o.w, t.height);
  }
  if (o.align) t.textAlignHorizontal = o.align;
  if (o.trunc) {
    t.textTruncation = "ENDING";
    t.maxLines = 1;
  }
  t.x = x;
  t.y = y;
  return t;
}
// vector pen (as in 29-charts): paths in plot coordinates, translated so the vector's box starts at 0,0
function pen() {
  const cmds = [];
  let x0 = Infinity, y0 = Infinity;
  const ext = (x, y) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
  };
  const p = {};
  p.M = (x, y) => (cmds.push(["M", x, y]), ext(x, y), p);
  p.L = (x, y) => (cmds.push(["L", x, y]), ext(x, y), p);
  p.C = (a, b, c, d, x, y) => (cmds.push(["C", a, b, c, d, x, y]), ext(a, b), ext(c, d), ext(x, y), p);
  p.Z = () => (cmds.push(["Z"]), p);
  p.empty = () => !cmds.length;
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
  p.circle = (cx, cy, r) => {
    const k = r * 0.5523;
    p.M(cx, cy - r).C(cx + k, cy - r, cx + r, cy - k, cx + r, cy).C(cx + r, cy + k, cx + k, cy + r, cx, cy + r);
    p.C(cx - k, cy + r, cx - r, cy + k, cx - r, cy).C(cx - r, cy - k, cx - k, cy - r, cx, cy - r);
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
// st: { fill, alpha, stroke, salpha, sw, cap }: absolute vector at the path's own place in the parent
function draw(parent, pn, name, st) {
  if (pn.empty()) return null;
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
  v.layoutPositioning = "ABSOLUTE";
  v.x = n.x;
  v.y = n.y;
  return v;
}
function cell(parent, t, w, align) {
  parent.appendChild(t);
  t.textAutoResize = "HEIGHT";
  t.resize(w, t.height);
  t.layoutSizingHorizontal = "FIXED";
  if (align) t.textAlignHorizontal = align;
  return t;
}
const trunc = (t) => {
  t.textTruncation = "ENDING";
  t.maxLines = 1;
};
// raw data color (cannot be bound to a variable): "#RRGGBB" -> solid paint
const raw = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return { type: "SOLID", color: { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }, ...(a != null ? { opacity: a } : {}) };
};
const ghostIcon = (icon) => inst(iconButton, { Type: "Ghost", Size: "sm" }, { Icon: icon.id });
const range = (a, b, s) => {
  const r = [];
  for (let i = 0; a + i * s <= b + 1e-9; i++) r.push(+(a + i * s).toFixed(6));
  return r;
};

// ---- curve maths (cui_curves.c): monotone slopes on smooth keys, stored handles on free keys ---------------------------------
function curveSegs(keys) {
  const n = keys.length, d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((keys[i + 1].v - keys[i].v) / (keys[i + 1].t - keys[i].t));
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] > 0 ? (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]) : 0;
  const out = [];
  for (let i = 0; i < n - 1; i++) {
    const a = keys[i], b = keys[i + 1], dx = (b.t - a.t) / 3;
    const c1 = a.o ? [a.t + a.o[0], a.v + a.o[1]] : [a.t + dx, a.v + m[i] * dx];
    const c2 = b.i ? [b.t + b.i[0], b.v + b.i[1]] : [b.t - dx, b.v - m[i + 1] * dx];
    out.push([[a.t, a.v], c1, c2, [b.t, b.v]]);
  }
  return out;
}
function curveAt(segs, T) {
  const s = segs.find((q) => T >= q[0][0] && T <= q[3][0]);
  if (!s) return null;
  const bz = (u, k) => {
    const w = 1 - u;
    return w * w * w * s[0][k] + 3 * w * w * u * s[1][k] + 3 * w * u * u * s[2][k] + u * u * u * s[3][k];
  };
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (bz(mid, 0) < T) lo = mid;
    else hi = mid;
  }
  return bz(lo, 1);
}
// plot frame: o = { w, h, t0, t1, v0, v1, xt, yt, xm, ym, fx, fy, keys, sel, play }; margins left 40, right 14, top 12, bottom 30
async function curvePlot(o) {
  const ml = 40, mr = 14, mt = 12, mb = 30, pw = o.w - ml - mr, ph = o.h - mt - mb;
  const X = (t) => ml + ((t - o.t0) / (o.t1 - o.t0)) * pw;
  const Y = (v) => mt + ph - ((v - o.v0) / (o.v1 - o.v0)) * ph;
  const f = box("plot", { w: o.w, h: o.h });
  const vlines = (p, step) => range(o.t0, o.t1, step).forEach((t) => p.M(X(t), mt).L(X(t), mt + ph));
  const hlines = (p, step) => range(o.v0, o.v1, step).forEach((v) => p.M(ml, Y(v)).L(ml + pw, Y(v)));
  const gm = pen();
  vlines(gm, o.xm);
  hlines(gm, o.ym);
  draw(f, gm, "grid-minor", { stroke: "border/default", salpha: 0.5 });
  const gp = pen();
  vlines(gp, o.xt);
  hlines(gp, o.yt);
  gp.rect(ml, mt, pw, ph);
  draw(f, gp, "grid", { stroke: "border/default" });
  for (const v of range(o.v0, o.v1, o.yt)) await atext(f, o.fy(v), 0, Math.round(Y(v) - 7), S11, PU, { w: ml - 8, align: "RIGHT", name: "y-" + o.fy(v) });
  for (const t of range(o.t0, o.t1, o.xt)) await atext(f, o.fx(t), Math.round(X(t) - 20), mt + ph + 8, S11, PU, { w: 40, align: "CENTER", name: "x-" + o.fx(t) });
  const segs = curveSegs(o.keys);
  const k0 = o.keys[0], k1 = o.keys[o.keys.length - 1];
  const ex = pen();
  if (k0.t > o.t0) ex.M(X(o.t0), Y(k0.v)).L(X(k0.t), Y(k0.v));
  if (k1.t < o.t1) ex.M(X(k1.t), Y(k1.v)).L(X(o.t1), Y(k1.v));
  draw(f, ex, "extension", { stroke: "primary/default", salpha: 0.4, sw: 2 });
  const cv = pen();
  segs.forEach((s, i) => {
    if (!i) cv.M(X(s[0][0]), Y(s[0][1]));
    cv.C(X(s[1][0]), Y(s[1][1]), X(s[2][0]), Y(s[2][1]), X(s[3][0]), Y(s[3][1]));
  });
  draw(f, cv, "curve", { stroke: "primary/default", sw: 2, cap: "ROUND" });
  // handles of the selected key, at least 18 px long
  const hp = [];
  const sel = o.keys[o.sel];
  if (sel) {
    const kx = X(sel.t), ky = Y(sel.v);
    const ends = [];
    if (o.sel < segs.length) ends.push(segs[o.sel][1]);
    if (o.sel > 0) ends.push(segs[o.sel - 1][2]);
    for (const c of ends) {
      let dx = X(c[0]) - kx, dy = Y(c[1]) - ky;
      const l = Math.hypot(dx, dy) || 1;
      const s = Math.max(18, l) / l;
      hp.push([kx + dx * s, ky + dy * s]);
    }
    const hl = pen();
    hp.forEach(([x, y]) => hl.M(kx, ky).L(x, y));
    draw(f, hl, "handle-lines", { stroke: "text/placeholder", salpha: 0.8 });
    const ho = pen(), hi = pen();
    hp.forEach(([x, y]) => (ho.circle(x, y, 4.75), hi.circle(x, y, 3.5)));
    draw(f, ho, "handle-rims", { fill: "bg/surface" });
    draw(f, hi, "handles", { fill: "text/secondary" });
  }
  const ko = pen(), ki = pen();
  o.keys.forEach((k, i) => {
    if (i !== o.sel) (ko.circle(X(k.t), Y(k.v), 4.75), ki.circle(X(k.t), Y(k.v), 2.75));
  });
  draw(f, ko, "keys", { fill: "primary/default" });
  draw(f, ki, "key-centers", { fill: "bg/surface" });
  if (sel) {
    draw(f, pen().circle(X(sel.t), Y(sel.v), 6.5), "selected-rim", { fill: "bg/surface" });
    draw(f, pen().circle(X(sel.t), Y(sel.v), 5), "selected-key", { fill: "primary/default" });
  }
  if (o.play != null) {
    draw(f, pen().M(X(o.play), mt).L(X(o.play), mt + ph), "playhead", { stroke: "primary/default", salpha: 0.55, sw: 1.5 });
    const y = curveAt(segs, o.play);
    if (y != null) draw(f, pen().circle(X(o.play), Y(y), 4), "playhead-dot", { fill: "primary/default" });
  }
  return f;
}
// footer shared by the curve panels: mode select, Time and Value scrub fields, delete
async function curveFooter(tv, vv) {
  const r = box("footer", { dir: "row", gap: 8, pad: [8, 12], minH: 56, cross: "CENTER" });
  const mode = inst(input, { Type: "Select", State: "Default", Value: "Filled" }, { Text: "Free", "Left icon": false });
  mode.name = "mode";
  add(r, mode, { w: 128 });
  const t = inst(scrub, { Fill: "25", State: "Default" }, { Label: "Time", Value: tv, Suffix: "" });
  t.name = "time";
  add(r, t, { w: 140 });
  const v = inst(scrub, { Fill: "80", State: "Default" }, { Label: "Value", Value: vv, Suffix: "" });
  v.name = "value";
  add(r, v, { w: 140 });
  add(r, spacer(), { w: "fill", h: 1 });
  const del = inst(iconButton, { Type: "Ghost", Size: "sm" }, { Icon: IC["trash-2"].id });
  del.name = "delete";
  r.appendChild(del);
  return r;
}
async function curvePanel(name, o, tv, vv, component) {
  const p = box(name, { component: !!component, w: o.w, radius: "panel", stroke: "border/default", fill: "bg/surface", clip: true });
  add(p, await curvePlot(o), { w: "fill" });
  add(p, hline(), { w: "fill", h: 1 });
  add(p, await curveFooter(tv, vv), { w: "fill" });
  return p;
}

// ---- 1. Flame graph: profiler spans ported from tests/component_shots.c (fl_*), panel 960 wide, view 0 to 33.5 ms ---------------------
// Flame graph profiler data, ported from tests/component_shots.c (fl_*): spans {name,s,e,depth,key} in ms
let fseed = 41;
const frand = () => {
  fseed = (Math.imul(fseed, 1103515245) + 12345) >>> 0;
  return ((fseed >>> 16) & 0x7fff) / 32767;
};
const SP = [];
const fadd = (name, s, e, depth, key = 0) => SP.push({ name, s, e, depth, key });
function fsplit(name, s, e, depth, n, fill) {
  const slot = (e - s) / n;
  for (let k = 0; k < n; k++) {
    const w = slot * fill * (0.55 + 0.45 * frand());
    const a = s + k * slot + (slot - w) * frand();
    fadd(name, a, a + w, depth);
  }
}
function fseq(s, e, depth, names, w) {
  const n = names.length, out = [];
  const tot = w.reduce((a, b) => a + b, 0);
  const gap = (e - s) * 0.012, len = e - s - gap * (n + 1);
  let x = s;
  for (let k = 0; k < n; k++) {
    const a = x + gap, b = a + (len * w[k]) / tot;
    fadd(names[k], a, b, depth);
    out.push(a, b);
    x = b;
  }
  return out;
}
function fframe(title, f0, len) {
  fadd(title, f0, f0 + len, 0, 3);
  const t3 = fseq(f0, f0 + len, 1, ["Update", "Render", "Present"], [7.1, 7.6, 1.3]);
  const u = fseq(t3[0], t3[1], 2, ["Input", "Animation", "Physics", "AI", "Scripts"], [0.4, 1.5, 3.2, 1.1, 0.9]);
  fsplit("Poll devices", u[0], u[1], 3, 3, 0.7);
  const o = fseq(u[2], u[3], 3, ["Blend tree", "Skinning"], [0.45, 0.55]);
  fsplit("Evaluate clip", o[0], o[1], 4, 9, 0.8);
  fsplit("Skin mesh", o[2], o[3], 4, 24, 0.75);
  const ph = fseq(u[4], u[5], 3, ["Broadphase", "Narrowphase", "Solver"], [0.6, 0.9, 1.5]);
  fsplit("Sweep axis", ph[0], ph[1], 4, 3, 0.85);
  fsplit("Collide pair", ph[2], ph[3], 4, 46, 0.7);
  const is = fseq(ph[4], ph[5], 4, [0, 1, 2, 3, 4, 5, 6, 7].map((k) => "Island " + k), [1.3, 1, 0.8, 1.1, 0.7, 0.9, 1.2, 0.6]);
  for (let k = 0; k < 8; k++) {
    const so = fseq(is[2 * k], is[2 * k + 1], 5, ["Contacts", "Integrate"], [0.6, 0.4]);
    fsplit("Body", so[2], so[3], 6, 6, 0.8);
  }
  const ao = fseq(u[6], u[7], 3, ["Perception", "Pathfinding"], [0.35, 0.65]);
  fsplit("A* search", ao[2], ao[3], 4, 6, 0.85);
  fsplit("OnUpdate", u[8], u[9], 3, 28, 0.7);
  const r = fseq(t3[2], t3[3], 2, ["Cull", "Shadow pass", "GBuffer", "Lighting", "Post"], [0.8, 1.9, 2.6, 1.3, 0.8]);
  fsplit("Frustum test", r[0], r[1], 3, 4, 0.8);
  const co = fseq(r[2], r[3], 3, ["Cascade 0", "Cascade 1", "Cascade 2", "Cascade 3"], [1.4, 1.1, 0.9, 0.7]);
  for (let k = 0; k < 4; k++) fsplit("Draw", co[2 * k], co[2 * k + 1], 4, 22, 0.7);
  const go = fseq(r[4], r[5], 3, ["Opaque", "Decals"], [0.8, 0.2]);
  const bw = [];
  for (let k = 0; k < 12; k++) bw.push(0.6 + frand());
  const bo = fseq(go[0], go[1], 4, new Array(12).fill("Batch"), bw);
  for (let k = 0; k < 12; k++) fsplit("Draw", bo[2 * k], bo[2 * k + 1], 5, 8, 0.75);
  fseq(r[6], r[7], 3, ["Light culling", "Deferred shading"], [0.35, 0.65]);
  fseq(r[8], r[9], 3, ["Bloom", "Tone map", "TAA"], [0.4, 0.2, 0.4]);
  const pr = fseq(t3[4], t3[5], 2, ["Swap buffers"], [1]);
  fseq(pr[0], pr[1], 3, ["Wait for GPU"], [1]);
}
fframe("Frame 4812", 0.0, 16.4);
fframe("Frame 4813", 16.6, 16.9);

const FW = 960, FPX = 8, FPW = 944, FT1 = 33.5, FK = FPW / FT1, FROW = 20, FBAR = 19, FRULER = 24, FBODY = 148;
const nameHash = (s) => {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
};
const flame = box("Flame graph", { component: true, gap: 8, w: FW });
{
  const head = box("header", { dir: "row", gap: 16, cross: "CENTER" });
  head.appendChild(await text("Frames 4812 to 4813", S13M, PL, "title"));
  head.appendChild(await text("Physics, 2.99 ms", S13, PU, "selection"));
  add(flame, head, { w: "fill" });
  const panel = box("flame-panel", { radius: "panel", stroke: "border/default", fill: "bg/surface", clip: true });
  // ruler: ticks every 5 ms, labels 4 px right of the tick
  const ruler = box("ruler", { w: FW, h: FRULER, fill: "bg/muted" });
  bottomBorder(ruler);
  const ticks = pen();
  for (let ms = 0; ms <= 30; ms += 5) {
    const x = FPX + ms * FK;
    ticks.M(x, FRULER - 6).L(x, FRULER - 1);
  }
  draw(ruler, ticks, "ticks", { stroke: "border/strong" });
  for (let ms = 0; ms <= 30; ms += 5) await atext(ruler, ms + " ms", FPX + ms * FK + 4, 4, S11, PH, { name: "tick-" + ms });
  add(panel, ruler, { w: "fill" });
  // body: one vector per tone for the bars, one for the grid, labels where the bar is wide enough
  const body = box("body", { w: FW, h: FBODY });
  const grid = pen();
  for (let ms = 5; ms <= 30; ms += 5) grid.M(FPX + ms * FK, 0).L(FPX + ms * FK, FBODY);
  draw(body, grid, "grid", { stroke: "border/default", salpha: 0.5 });
  const vis = SP.filter((s) => (s.e - s.s) * FK >= 2);
  const toneOf = (s) => (s.key ? s.key : nameHash(s.name)) % 5;
  const bars = SERIES.map(() => pen());
  for (const s of vis) bars[toneOf(s)].rect(FPX + s.s * FK, 4 + s.depth * FROW, (s.e - s.s) * FK - 1, FBAR, 4);
  SERIES.forEach((t, i) => bars[i].node && vis.some((s) => toneOf(s) === i) && draw(body, bars[i], t.n + " spans", { fill: t.s }));
  const selSpan = SP.find((s) => s.name === "Physics" && s.s > 16.6);
  draw(body, pen().rect(FPX + selSpan.s * FK, 4 + selSpan.depth * FROW, (selSpan.e - selSpan.s) * FK - 1, FBAR, 4), "selected span", { stroke: "primary/default", sw: 1.5 });
  for (const s of vis) {
    const w = (s.e - s.s) * FK - 1;
    if (w >= 28) await atext(body, s.name, FPX + s.s * FK + 6, 4 + s.depth * FROW + 2, S11, PL, { w: w - 8, trunc: true, name: s.name });
  }
  add(panel, body, { w: "fill" });
  add(flame, panel, { w: "fill" });
}
MS.appendChild(flame);

// ---- 2. Curve editor: 4 keys, the second free with handles, plot 620 x 220 + footer --------------------------------------------------
const curveEditor = await curvePanel(
  "Curve editor",
  {
    w: 620, h: 220, t0: 0, t1: 2, v0: 0, v1: 1.2, xt: 0.5, yt: 0.4, xm: 0.25, ym: 0.2,
    fx: (t) => String(t), fy: (v) => String(+v.toFixed(1)),
    keys: [{ t: 0, v: 0 }, { t: 0.55, v: 0.66, i: [-0.22, -0.42], o: [0.24, 0.46] }, { t: 1.2, v: 1.08 }, { t: 2, v: 1 }],
    sel: 1,
  },
  "0.55",
  "0.66",
  true,
);
MS.appendChild(curveEditor);

// ---- 3. Gradient editor: Gradient stop (Selected) + ramp, track, controls --------------------------------------------------------------
const gstop = await variants("Gradient stop", { Selected: ["Off", "On"] }, async ({ Selected }) => {
  const on = Selected === "On";
  const b = box("stop", { component: true, dir: "row", pad: 3, w: 20, h: 20, radius: 999, fill: "bg/surface", stroke: on ? "border/strong" : "border/default", sw: on ? 2 : 1, align: "CENTER", cross: "CENTER" });
  add(b, box("color", { fill: "primary/default", radius: 999 }), { w: "fill", h: "fill" });
  return b;
}, { cols: 2 });
const GSTOPS = [[0, "#FFF1C1"], [0.24, "#FFB14A"], [0.58, "#E2552B"], [1, "#5C1F16", 0]];
const GW = 560, GTRACK = GW - 16;
const gradient = box("Gradient editor", { component: true, gap: 8, w: GW });
{
  add(gradient, await text("Flame color over lifetime", S13M, PL, "title"), { w: "fill" });
  const bars = box("bars", { pad: [0, 8] });
  const ramp = box("ramp", { radius: 8, stroke: "border/default" });
  add(bars, ramp, { w: "fill", h: 28 });
  const rgba = (hex, a) => {
    const p = raw(hex).color;
    return { ...p, a };
  };
  ramp.fills = [
    solid("bg/surface"),
    { type: "GRADIENT_LINEAR", gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: GSTOPS.map(([pos, hex, a]) => ({ position: pos, color: rgba(hex, a == null ? 1 : a) })) },
  ];
  const track = box("track", {});
  add(bars, track, { w: "fill", h: 26 });
  GSTOPS.forEach(([pos, hex], i) => {
    const s = inst(gstop, { Selected: i === 2 ? "On" : "Off" });
    s.name = "stop-" + (i + 1);
    layerOf(s, "color").fills = [raw(hex)];
    track.appendChild(s);
    s.layoutPositioning = "ABSOLUTE";
    s.x = Math.round(pos * GTRACK - 10);
    s.y = 3;
  });
  add(gradient, bars, { w: "fill" });
  const ctl = box("controls", { dir: "row", gap: 8, pad: [8, 0, 0, 0], cross: "CENTER" });
  const cp = inst(colorPicker, { State: "Closed" }, { Value: "#E2552B" });
  cp.name = "color";
  layerOf(layerOf(cp, "swatch"), "color").fills = [raw("#E2552B")];
  add(ctl, cp, { w: 160 });
  const loc = inst(scrub, { Fill: "80", State: "Default" }, { Label: "Location", Value: "58", Suffix: "%" });
  loc.name = "location";
  add(ctl, loc, { w: 140 });
  const opa = inst(scrub, { Fill: "80", State: "Default" }, { Label: "Opacity", Value: "100", Suffix: "%" });
  opa.name = "opacity";
  add(ctl, opa, { w: 140 });
  add(ctl, spacer(), { w: "fill", h: 1 });
  const del = ghostIcon(IC["trash-2"]);
  del.name = "delete";
  ctl.appendChild(del);
  add(gradient, ctl, { w: "fill" });
}
MS.appendChild(gradient);

// ---- 4. Timeline editor: Timeline track (Kind) list, one plot frame for the time column, Rotation curve below ----------------------------
const ttrack = await variants("Timeline track", { Kind: ["Group", "Track", "Current"] }, async ({ Kind }) => {
  const b = box("track-row", { component: true, dir: "row", gap: 8, pad: [0, 8], w: 184, h: 26, cross: "CENTER", fill: Kind === "Group" ? "bg/muted" : Kind === "Current" ? "primary/subtle" : undefined });
  bottomBorder(b);
  b.appendChild(box("indent", { w: 16, h: 1 }));
  const chev = await ico("chevron-down", 14, PH, "chevron");
  chev.visible = Kind === "Group";
  b.appendChild(chev);
  add(b, box("tone", { fill: "primary/default", radius: 2 }), { w: 3, h: 12 });
  b.appendChild(await ico("user", 14, PU, "icon"));
  add(b, await text("Track", Kind === "Group" ? S13M : S13, Kind === "Track" ? PU : PL, "name"), { w: "fill" });
  trunc(b.children[4]);
  return b;
}, { cols: 3 });
wire(ttrack, [
  { layer: "name", kind: "TEXT", name: "Name" },
  { layer: "icon", kind: "BOOLEAN", name: "Icon", def: true },
  { layer: "icon", kind: "SWAP", name: "Icon swap", def: IC.user.id },
]);
// rows: [name, kind, depth, tone (index in SERIES), icon, keys [[seconds, kind s|l|t]]]
const TROWS = [
  ["Hero", "Group", 0, 0, "user"],
  ["Position X", "Track", 1, 0, null, [[0, "s"], [1.25, "s"], [2.25, "s"], [3.5, "s"], [5, "s"]]],
  ["Position Y", "Track", 1, 0, null, [[0, "s"], [1.25, "s"], [1.75, "s"], [2.25, "s"], [4, "t"]]],
  ["Rotation", "Current", 1, 0, null, [[0, "s"], [1.25, "s"], [1.75, "s"], [2.25, "s"], [3.5, "s"]]],
  ["Scale", "Track", 1, 0, null, [[0, "s"], [2.25, "l"], [2.375, "l"], [2.625, "s"]]],
  ["Opacity", "Track", 1, 0, null, [[0, "l"], [0.5, "l"], [4.5, "l"], [5, "l"]]],
  ["Camera", "Group", 0, 3, "video"],
  ["Zoom", "Track", 1, 3, null, [[0, "s"], [3, "s"], [4.25, "s"], [5, "s"]]],
  ["Pan", "Track", 1, 3, null, [[0, "l"], [5, "l"]]],
  ["Sound", "Track", 0, 2, "audio-lines"],
];
const TL_W = 736, TL_H = 288, TRH = 26, TRULER = 28, TLIST = 184;
const TX = (t) => 10 + t * 143.2;
const TSEL = { row: 3, time: 1.75 };
async function timePlot() {
  const f = box("time-grid", { w: TL_W, h: TL_H });
  const ry = (r) => TRULER + r * TRH;
  draw(f, pen().rect(0, 0, TL_W, TRULER), "ruler", { fill: "bg/muted" });
  const gt = pen(), ct = pen();
  TROWS.forEach(([, kind], r) => (kind === "Group" ? gt : kind === "Current" ? ct : null)?.rect(0, ry(r), TL_W, TRH));
  draw(f, gt, "group rows", { fill: "bg/muted" });
  draw(f, ct, "current row", { fill: "primary/subtle" });
  // in/out range 0.5 to 4.5: the outside is shaded
  draw(f, pen().rect(0, TRULER, TX(0.5), TL_H - TRULER).rect(TX(4.5), TRULER, TL_W - TX(4.5), TL_H - TRULER), "outside range", { fill: "text/primary", alpha: 0.045 });
  const grid = pen(), tick = pen();
  for (let fr = 0; fr <= 120; fr += 10) {
    const x = 10 + (fr / 24) * 143.2;
    grid.M(x, TRULER).L(x, TL_H);
    tick.M(x, TRULER - 6).L(x, TRULER);
  }
  draw(f, grid, "frame grid", { stroke: "border/default", salpha: 0.6 });
  const sep = pen();
  sep.M(0, TRULER).L(TL_W, TRULER);
  for (let r = 1; r < TROWS.length; r++) sep.M(0, ry(r)).L(TL_W, ry(r));
  draw(f, sep, "row separators", { stroke: "border/default" });
  draw(f, tick, "ruler ticks", { stroke: "border/strong" });
  for (let fr = 0; fr <= 120; fr += 10) await atext(f, String(fr), 10 + (fr / 24) * 143.2 + 4, 5, S11, PH, { name: "frame-" + fr });
  // summary dots on the group rows: the children's key times
  const sum = pen();
  TROWS.forEach(([, kind, depth], r) => {
    if (kind !== "Group") return;
    const times = new Set();
    for (let k = r + 1; k < TROWS.length && TROWS[k][2] > depth; k++) (TROWS[k][5] || []).forEach(([t]) => times.add(t));
    times.forEach((t) => sum.circle(TX(t), ry(r) + TRH / 2, 2));
  });
  draw(f, sum, "summary keys", { fill: "text/secondary", alpha: 0.75 });
  // keys: surface rings first, one vector per tone, then the selected key
  const shape = (p, k, x, y, grow) => {
    if (k === "s") p.poly([[x, y - 5 - grow], [x + 5 + grow, y], [x, y + 5 + grow], [x - 5 - grow, y]]);
    else if (k === "l") p.circle(x, y, 4 + grow);
    else p.rect(x - 3.5 - grow, y - 3.5 - grow, 7 + 2 * grow, 7 + 2 * grow);
  };
  const rings = pen(), keys = SERIES.map(() => pen()), used = new Set();
  TROWS.forEach((row, r) => {
    for (const [t, k] of row[5] || []) {
      if (r === TSEL.row && t === TSEL.time) continue;
      const y = ry(r) + TRH / 2;
      shape(rings, k, TX(t), y, 1.5);
      shape(keys[row[3]], k, TX(t), y, 0);
      used.add(row[3]);
    }
  });
  draw(f, rings, "key rings", { fill: "bg/surface" });
  SERIES.forEach((s, i) => used.has(i) && draw(f, keys[i], s.n + " keys", { fill: s.c }));
  {
    const x = TX(TSEL.time), y = ry(TSEL.row) + TRH / 2;
    draw(f, pen().circle(x, y, 7.5), "selected halo", { fill: "bg/surface" });
    draw(f, pen().circle(x, y, 6), "selected key", { fill: "primary/default" });
    draw(f, pen().circle(x, y, 1.8), "selected center", { fill: "bg/surface" });
  }
  // audio clips on the Sound row
  const sy = ry(9) + 3, clips = pen(), grips = pen();
  const CLIPS = [["Footsteps", 0.375, 2.25], ["Street ambience", 3, 4.625]];
  for (const [, a, b] of CLIPS) {
    clips.rect(TX(a), sy, TX(b) - TX(a), 20, 4);
    grips.rect(TX(a) + 2, sy + 4, 2, 12).rect(TX(b) - 4, sy + 4, 2, 12);
  }
  draw(f, clips, "clips", { fill: "feedback/success/subtle", stroke: "feedback/success/default" });
  draw(f, grips, "clip grips", { fill: "feedback/success/default" });
  for (const [n, a, b] of CLIPS) await atext(f, n, TX(a) + 8, sy + 3, S11M, "feedback/success/text", { w: TX(b) - TX(a) - 16, trunc: true, name: n });
  // playhead at 1.5 s
  const px = TX(1.5);
  draw(f, pen().M(px, 0).L(px, TL_H), "playhead", { stroke: "primary/default", sw: 1.5 });
  draw(f, pen().rect(px - 5.5, 0, 11, 14, 4), "playhead handle", { fill: "primary/default" });
  return f;
}
const timeline = box("Timeline editor", { component: true, gap: 8, w: 920 });
{
  const head = box("header", { dir: "row", gap: 8, cross: "CENTER" });
  const play = inst(iconButton, { Type: "Outline", Size: "sm" }, { Icon: IC.play.id });
  play.name = "play";
  head.appendChild(play);
  head.appendChild(await text("Shot 4", S13M, PL, "title"));
  head.appendChild(await text("5 seconds at 24 fps", S13, PU, "info"));
  add(timeline, head, { w: "fill" });
  const panel = box("timeline", { dir: "row", radius: "panel", stroke: "border/default", fill: "bg/surface", clip: true });
  const list = box("track-list", { w: TLIST, h: TL_H });
  rightBorder(list);
  const corner = box("corner", { dir: "row", pad: [0, 12], cross: "CENTER", fill: "bg/muted" });
  bottomBorder(corner);
  corner.appendChild(await text("Frame 36", S11M, PU, "frame"));
  add(list, corner, { w: "fill", h: TRULER });
  for (const [name, kind, depth, tone, icon] of TROWS) {
    const r = inst(ttrack, { Kind: kind }, icon ? { Name: name, "Icon swap": IC[icon].id } : { Name: name, Icon: false });
    r.name = name;
    layerOf(r, "tone").fills = [solid(SERIES[tone].c)];
    if (!depth) layerOf(r, "indent").visible = false;
    add(list, r, { w: "fill", h: TRH });
  }
  panel.appendChild(list);
  panel.appendChild(await timePlot());
  add(timeline, panel, { w: "fill" });
  add(timeline, await text("Rotation", S13M, PL, "curve title"), { w: "fill" });
  add(
    timeline,
    await curvePanel(
      "Rotation curve",
      {
        w: 920, h: 170, t0: 0, t1: 5, v0: -20, v1: 20, xt: 0.5, yt: 10, xm: 0.25, ym: 5,
        fx: (t) => String(t), fy: (v) => String(v),
        keys: [{ t: 0, v: 0 }, { t: 1.25, v: -8 }, { t: 1.75, v: 12 }, { t: 2.25, v: 0 }, { t: 3.5, v: 4 }],
        sel: 2, play: 1.5,
      },
      "1.75",
      "12",
      false,
    ),
    { w: "fill" },
  );
}
MS.appendChild(timeline);

// ---- 5. Key-value editor: Key-value row (nested instances switched per row), heading + 5 rows -------------------------------------------
const kvrow = box("Key-value row", { component: true, dir: "row", gap: 8, w: 680 });
{
  const cw = box("check-wrap", { dir: "row", h: 36, cross: "CENTER" });
  const cb = inst(checkbox, { Checked: "On" }, { Label: false });
  cb.name = "check";
  cw.appendChild(cb);
  kvrow.appendChild(cw);
  const kc = box("key-cell", { gap: 4 });
  const key = inst(input, { Type: "Text", State: "Default", Value: "Filled" }, { Text: "Key", "Left icon": false });
  key.name = "key";
  add(kc, key, { w: "fill" });
  const err = await text("Used twice", S11, "feedback/error/text", "error");
  err.visible = false;
  add(kc, err, { w: "fill" });
  add(kvrow, kc, { w: 230 });
  const val = inst(input, { Type: "Text", State: "Default", Value: "Filled" }, { Text: "Value", "Left icon": false });
  val.name = "value";
  add(kvrow, val, { w: "fill" });
  const act = box("actions", { dir: "row", gap: 4, h: 36, cross: "CENTER" });
  const lock = inst(iconButton, { Type: "Ghost", Size: "sm" }, { Icon: IC["lock-open"].id });
  lock.name = "lock";
  const rm = ghostIcon(IC.x);
  rm.name = "remove";
  act.appendChild(lock);
  act.appendChild(rm);
  kvrow.appendChild(act);
}
wire(kvrow, [
  { layer: "error", kind: "BOOLEAN", name: "Error", def: false },
  { layer: "error", kind: "TEXT", name: "Error text" },
]);
MS.appendChild(kvrow);
const kvEditor = box("Key-value editor", { component: true, gap: 8, w: 680 });
{
  add(kvEditor, await text("Headers", S13M, PL, "title"), { w: "fill" });
  const rows = box("rows", { gap: 8 });
  const PAIRS = [
    { key: "Authorization", value: "Bearer 4f9c2e81d0b7a6", secret: true },
    { key: "Accept", value: "application/json" },
    { key: "X-Request-Id", value: "7d1c0a", off: true },
    { key: "Accept", value: "text/html", dup: true },
    { key: "Key", value: "Value", empty: true },
  ];
  for (const p of PAIRS) {
    const r = inst(kvrow, {}, p.dup ? { Error: true } : {});
    r.name = p.empty ? "empty row" : p.key;
    const dim = p.off || p.empty;
    nest(r, "check", { Checked: dim ? "Off" : "On" });
    nest(r, "key", { Text: p.key, Value: p.empty ? "Placeholder" : "Filled", State: p.off ? "Disabled" : p.dup ? "Error" : "Default" });
    nest(r, "value", { Text: p.secret ? "•".repeat(14) : p.value, Value: p.empty ? "Placeholder" : "Filled", State: p.off ? "Disabled" : "Default" });
    nest(r, "lock", p.secret ? { Icon: IC.lock.id } : p.empty ? { State: "Disabled" } : {});
    nest(r, "remove", p.empty ? { State: "Disabled" } : {});
    add(rows, r, { w: "fill" });
  }
  add(kvEditor, rows, { w: "fill" });
}
MS.appendChild(kvEditor);

// ---- 6. Problems panel: Problem file, Problem row (Severity), filters + list 760 x 286 ------------------------------------------------------
const pfile = box("Problem file", { component: true, dir: "row", gap: 8, pad: [0, 8], w: 760, h: 28, cross: "CENTER" });
pfile.appendChild(await ico("chevron-down", 14, PH, "chevron"));
pfile.appendChild(await ico("file", 14, PU, "file-icon"));
pfile.appendChild(await text("file.c", S13M, PL, "file"));
add(pfile, await text("src", S11, PH, "folder"), { w: "fill" });
{
  const pill = box("pill", { dir: "row", pad: [0, 8], radius: "chip", fill: "bg/muted", cross: "CENTER" });
  pill.appendChild(await text("0", S11, PU, "count"));
  pfile.appendChild(pill);
}
wire(pfile, [
  { layer: "file", kind: "TEXT", name: "File" },
  { layer: "folder", kind: "TEXT", name: "Folder" },
  { layer: "count", kind: "TEXT", name: "Count" },
]);
MS.appendChild(pfile);
const SEV = { Error: ["circle-x", "danger/default"], Warning: ["triangle-alert", "feedback/warning/default"], Info: ["info", "feedback/info/default"], Hint: [HELP, "text/placeholder"] };
const prow = await variants("Problem row", { Severity: Object.keys(SEV) }, async ({ Severity }) => {
  const [icon, tone] = SEV[Severity];
  const b = box("problem-row", { component: true, dir: "row", gap: 8, pad: [0, 8, 0, 32], w: 760, h: 28, cross: "CENTER" });
  b.appendChild(await ico(icon, 14, tone, "severity"));
  add(b, await text("message", S13, PL, "message"), { w: "fill" });
  trunc(b.children[1]);
  b.appendChild(await text("source", "Code/11", PH, "source"));
  b.appendChild(await text("0:0", "Code/11", PU, "position"));
  return b;
}, { cols: 2 });
wire(prow, [
  { layer: "message", kind: "TEXT", name: "Message" },
  { layer: "source", kind: "TEXT", name: "Source" },
  { layer: "position", kind: "TEXT", name: "Position" },
]);
const tgFrame = (name) => box(name, { dir: "row", gap: 2, pad: 3, radius: 12, stroke: "border/default", fill: "bg/surface", cross: "CENTER" });
const tgi = (on, icon, label) => {
  const i = inst(titem, { Selected: on ? "On" : "Off" }, label ? { Icon: icon.id, Label: true, "Label text": label } : { Icon: icon.id, Label: false });
  return i;
};
const problems = box("Problems panel", { component: true, gap: 8, w: 760 });
{
  const bar = box("toolbar", { dir: "row", gap: 8, cross: "CENTER" });
  const tg = tgFrame("severity-filter");
  [[IC["circle-x"], "Errors 2"], [IC["triangle-alert"], "Warnings 3"], [IC.info, "Info 1"], [IC["circle-help"], "Hints 1"]].forEach(([ic, l], i) => {
    const it = tgi(true, ic, l);
    it.name = "filter-" + (i + 1);
    tg.appendChild(it);
  });
  bar.appendChild(tg);
  const q = inst(input, { Type: "Text", State: "Default", Value: "Placeholder" }, { Text: "Filter problems", "Left icon": true, "Left icon swap": IC.search.id });
  q.name = "filter";
  add(bar, q, { w: "fill" });
  add(problems, bar, { w: "fill" });
  const list = box("problem-list", { w: 760, h: 286, radius: "panel", stroke: "border/default", fill: "bg/surface", clip: true });
  const FILES = [
    ["timing.c", "src/render", [
      ["Error", "use of undeclared identifier 'frame_time'", "clang(undeclared-var)", "42:17"],
      ["Warning", "unused variable 'scale'", "clang(-Wunused-variable)", "88:11"],
    ]],
    ["layout.c", "src/core", [
      ["Error", "incompatible pointer types passing 'float *' to 'double *'", "clang(-Wincompatible-pointer-types)", "210:33"],
      ["Warning", "implicit conversion loses floating-point precision", "clang(-Wfloat-conversion)", "318:22"],
      ["Info", "function 'measure' could be declared static", "clang-tidy(misc-use-internal-linkage)", "402:6"],
    ]],
    ["main.c", "src/app", [
      ["Hint", "loop variable copied on each iteration; consider a pointer", "clang-tidy(performance-for-range-copy)", "51:9"],
      ["Warning", "comparison of integers of different signs", "gcc(-Wsign-compare)", "77:18"],
    ]],
  ];
  for (const [file, folder, items] of FILES) {
    const f = inst(pfile, {}, { File: file, Folder: folder, Count: String(items.length) });
    f.name = file;
    add(list, f, { w: "fill" });
    for (const [sev, msg, src, pos] of items) {
      const r = inst(prow, { Severity: sev }, { Message: msg, Source: src, Position: pos });
      r.name = sev.toLowerCase();
      add(list, r, { w: "fill" });
    }
  }
  add(problems, list, { w: "fill" });
}
MS.appendChild(problems);

// ---- 7. Test explorer: Test row (Status x Kind), toolbar + list 760 x 456 ---------------------------------------------------------------
const TST = { Passed: ["circle-check", "feedback/success/default"], Failed: ["circle-x", "danger/default"], Skipped: ["chevrons-right", PH], Pending: ["clock", PH], Running: [null, null] };
const trow = await variants("Test row", { Status: Object.keys(TST), Kind: ["Test", "Suite"] }, async ({ Status, Kind }) => {
  const suite = Kind === "Suite";
  const b = box("test-row", { component: true, dir: "row", gap: 8, pad: [0, 8], w: 760, h: 28, cross: "CENTER" });
  b.appendChild(box("indent", { w: 16, h: 1 }));
  if (suite) b.appendChild(await ico("chevron-down", 14, PH, "chevron"));
  else b.appendChild(box("chevron", { w: 14, h: 14 }));
  if (Status === "Running") {
    const sp = inst(spinner, { Size: "sm" });
    sp.resize(14, 14);
    sp.name = "status";
    b.appendChild(sp);
  } else b.appendChild(await ico(TST[Status][0], 14, TST[Status][1], "status"));
  add(b, await text("Test name", suite ? S13M : S13, Status === "Skipped" ? PH : PL, "name"), { w: "fill" });
  trunc(b.children[3]);
  b.appendChild(await text("0/0", S11, PH, "count"));
  b.appendChild(await text("0 ms", S11, PH, "duration"));
  b.appendChild(box("end", { w: 28, h: 1 }));
  return b;
}, { cols: 5 });
wire(trow, [
  { layer: "name", kind: "TEXT", name: "Name" },
  { layer: "count", kind: "BOOLEAN", name: "Show count", def: true },
  { layer: "count", kind: "TEXT", name: "Count" },
  { layer: "duration", kind: "BOOLEAN", name: "Show duration", def: true },
  { layer: "duration", kind: "TEXT", name: "Duration" },
]);
const explorer = box("Test explorer", { component: true, gap: 8, w: 760 });
{
  const bar = box("toolbar", { dir: "row", gap: 8, cross: "CENTER" });
  const run = inst(button, { Type: "Primary", Size: "sm" }, { Label: "Run all", "Left icon": true, "Left icon swap": IC.play.id });
  run.name = "run-all";
  bar.appendChild(run);
  const tg = tgFrame("status-filter");
  [[IC["circle-check"], "6"], [IC["circle-x"], "1"], [IC["chevrons-right"], "1"]].forEach(([ic, l], i) => {
    const it = tgi(true, ic, l);
    it.name = "filter-" + (i + 1);
    tg.appendChild(it);
  });
  bar.appendChild(tg);
  const q = inst(input, { Type: "Text", State: "Default", Value: "Placeholder" }, { Text: "Filter tests", "Left icon": true, "Left icon swap": IC.search.id });
  q.name = "filter";
  add(bar, q, { w: "fill" });
  add(explorer, bar, { w: "fill" });
  const list = box("test-list", { w: 760, h: 456, radius: "panel", stroke: "border/default", fill: "bg/surface", clip: true });
  // [name, depth, status, kind, count, duration, slow, failure message]
  const ROWS = [
    ["layout", 0, "Failed", "Suite", "2/3", "22 ms"],
    ["row distributes extra space", 1, "Passed", "Test", null, "4 ms"],
    ["wraps to the next line", 1, "Passed", "Test", null, "6 ms"],
    ["mirrors under right to left", 1, "Failed", "Test", null, "12 ms", false, "expected x = 412, got 388 (padding not mirrored)"],
    ["text", 0, "Passed", "Suite", "2/3", "213 ms"],
    ["shapes Persian", 1, "Passed", "Test", null, "210 ms"],
    ["ellipsis keeps whole characters", 1, "Passed", "Test", null, "3 ms"],
    ["bidi brackets", 1, "Skipped", "Test", null, null],
    ["renderer", 0, "Running", "Suite", "2/4", "1.45 s", true],
    ["software", 1, "Running", "Suite", "1/2", "31 ms"],
    ["rounded corners", 2, "Passed", "Test", null, "31 ms"],
    ["soft shadows", 2, "Running", "Test", null, null],
    ["OpenGL", 1, "Pending", "Suite", "1/2", "1.42 s", true],
    ["atlas growth", 2, "Pending", "Test", null, null],
    ["slow gradient path", 2, "Passed", "Test", null, "1.42 s", true],
  ];
  for (const [name, depth, status, kind, count, dur, slow, msg] of ROWS) {
    const r = inst(trow, { Status: status, Kind: kind }, {
      Name: name, "Show count": !!count, Count: count || "0/0", "Show duration": !!dur, Duration: dur || "0 ms",
    });
    r.name = name;
    const ind = layerOf(r, "indent");
    if (!depth) ind.visible = false;
    else if (depth > 1) ind.resize(depth * 16, ind.height);
    if (slow) layerOf(r, "duration").fills = [solid("feedback/warning/text")];
    add(list, r, { w: "fill" });
    if (msg) {
      const m = box("failure", { dir: "row", pad: [0, 8, 0, depth * 16 + 40], h: 28, cross: "CENTER" });
      add(m, await text(msg, "Code/11", "feedback/error/text", "message"), { w: "fill" });
      add(list, m, { w: "fill" });
    }
  }
  add(explorer, list, { w: "fill" });
}
MS.appendChild(explorer);

// ---- 8. Regex tester: Regex chip (Tone), pattern row, editor with match marks, match list ----------------------------------------------------
const rchip = await variants("Regex chip", { Tone: ["Match", "Group 1", "Group 2", "Group 3"] }, async ({ Tone }) => {
  const fill = { Match: "primary/subtle", "Group 1": "feedback/info/subtle", "Group 2": "feedback/warning/subtle", "Group 3": "feedback/success/subtle" }[Tone];
  const b = box("chip", { component: true, dir: "row", pad: [2, 8], radius: 4, fill, cross: "CENTER" });
  b.appendChild(await text("match", "Code/11", PL, "text"));
  return b;
}, { cols: 4 });
wire(rchip, [{ layer: "text", kind: "TEXT", name: "Text" }]);
const REGEX = /([\w.]+)@([\w-]+)\.(com|org)/g;
const PATTERN = "(?<user>[\\w.]+)@(?<host>[\\w-]+)\\.(com|org)";
const LINES = ["Contact maya.okafor@example.com or jonas@cui-lib.org for access.", "Old address: priya@legacy.net (no longer read).", "Support: help@example.com"];
const regex = box("Regex tester", { component: true, gap: 8, w: 760 });
{
  const prow1 = box("pattern-row", { dir: "row", gap: 8, cross: "CENTER" });
  const pat = inst(input, { Type: "Text", State: "Default", Value: "Filled" }, { Text: PATTERN, "Left icon": false, Prefix: true, "Prefix text": "/", Suffix: true, "Suffix text": "/" });
  pat.name = "pattern";
  add(prow1, pat, { w: "fill" });
  const flags = tgFrame("flags");
  ["i", "m", "s"].forEach((l) => {
    const it = tgi(false, IC.search, l);
    it.name = "flag-" + l;
    layerOf(it, "icon").visible = false;
    flags.appendChild(it);
  });
  prow1.appendChild(flags);
  add(regex, prow1, { w: "fill" });
  // editor: marks are rectangles behind the text, placed from the measured advance of the mono face
  const ed = box("editor", { pad: [8, 12], h: 110, radius: "input", stroke: "border/default", fill: "bg/subtle", clip: true });
  const matches = [], whole = pen(), groups = [pen(), pen(), pen()];
  let lines = [];
  for (let i = 0; i < LINES.length; i++) {
    const t = await text(LINES[i], "Code/12 Tall", PL, "line-" + (i + 1));
    ed.appendChild(t);
    lines.push(t);
  }
  const cw = lines[0].width / LINES[0].length;
  LINES.forEach((ln, i) => {
    REGEX.lastIndex = 0;
    let m;
    while ((m = REGEX.exec(ln))) {
      const y = 8 + i * 21 + 1;
      whole.rect(12 + m.index * cw, y, m[0].length * cw, 19, 2);
      const gs = [m[1], m[2], m[3]];
      let at = m.index;
      gs.forEach((g, k) => {
        const a = ln.indexOf(g, at);
        groups[k].rect(12 + a * cw, y, g.length * cw, 19, 2);
        at = a + g.length;
      });
      matches.push({ line: i, m, gs });
    }
  });
  const tones = [["primary/subtle", whole], ["feedback/info/subtle", groups[0]], ["feedback/warning/subtle", groups[1]], ["feedback/success/subtle", groups[2]]];
  tones.reverse().forEach(([tok, p], k) => {
    const v = draw(ed, p, "marks " + (3 - k), { fill: tok });
    ed.insertChild(0, v);
  });
  add(regex, ed, { w: "fill" });
  regex.appendChild(await text(matches.length + " matches", S13M, PU, "summary"));
  const rows = box("matches", { gap: 4 });
  for (let n = 0; n < matches.length; n++) rows.appendChild(box("match-" + (n + 1), { dir: "row", gap: 8, cross: "CENTER" }));
  for (let n = 0; n < matches.length; n++) {
    const { m, gs } = matches[n];
    const r = rows.children[n];
    cell(r, await text(String(n + 1), S11, PH, "number"), 22, "RIGHT");
    r.appendChild(inst(rchip, { Tone: "Match" }, { Text: m[0] }));
    r.appendChild(await text(`${m.index}–${m.index + m[0].length}`, S11, PH, "range"));
    for (const [k, label] of [[0, "user"], [1, "host"], [2, "3"]]) {
      r.appendChild(await text(label, S11M, PU, "group-" + (k + 1) + "-name"));
      const c = inst(rchip, { Tone: "Group " + (k + 1) }, { Text: gs[k] });
      c.name = "group-" + (k + 1);
      r.appendChild(c);
    }
  }
  add(regex, rows, { w: "fill" });
}
MS.appendChild(regex);

// ---- board cards ------------------------------------------------------------------------------------------------------
const c = await H.cursor();
const CARDS = [
  ["Flame graph", "Frame spans · ruler · selected span", flame],
  ["Curve editor", "Smooth and free keys · handles · footer fields", curveEditor],
  ["Gradient editor", "Ramp · stops · color, location, opacity", gradient],
  ["Timeline editor", "Track list · keys · clips · playhead · curve", timeline],
  ["Key-value editor", "Enabled · secret · disabled · duplicate · empty", kvEditor],
  ["Problems panel", "Severity filters · files · rows", problems],
  ["Test explorer", "Suites · status · durations · failure", explorer],
  ["Regex tester", "Pattern · match marks · groups", regex],
];
for (const [caption, sub, master] of CARDS) {
  const k = await card(null, caption, sub);
  k.card.appendChild(master.createInstance());
  await burst(c, k.wrap);
}
c.done();
return Object.fromEntries(CARDS.map(([cap, , m]) => [cap, `${m.name} ${Math.round(m.width)}x${Math.round(m.height)}`]));
