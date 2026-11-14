// CUI developer tools drawn from the C source (src/cui_devtools.c, cui_devpanels.c, cui_graph.c, cui_flame.c + tests/component_shots.c):
// Pipeline, Query builder, Keymap, Commit graph, Dependency graph, Network waterfall, Trace viewer, HTTP request bar, Feature flags,
// API explorer. Row and part masters: Pipeline job, Query rule, Keymap key, Commit row, Dependency node, Waterfall row, Trace lane,
// Request param row, Flag row, API endpoint, API tag header, API param. Mono text reuses the Code/* styles made by 33-code.
const NEW = [
  "Pipeline job", "Pipeline", "Query rule", "Query builder", "Keymap key", "Keymap", "Commit row", "Commit graph",
  "Dependency node", "Dependency graph", "Waterfall row", "Network waterfall", "Trace lane", "Trace viewer",
  "Request param row", "HTTP request bar", "Flag row", "Feature flags", "API endpoint", "API tag header", "API param", "API explorer",
];
for (const n of NEW) setNamed(n)?.remove();

await figma.loadFontAsync({ family: "Menlo", style: "Regular" });
const pick = async (...names) => {
  for (const n of names) {
    try {
      if (await H.icon(n, ICON)) return n;
    } catch {}
  }
  throw new Error("no Lucide icon among " + names.join(", "));
};
const ICONS = ["circle-check", "circle-x", "triangle-alert", "chevrons-right", "clock", "chevron-right", "chevron-down", "trash-2", "x", "plus", "send", "play", "search"];
const IC = {};
for (const n of ICONS) IC[n] = await H.icon(n, ICON);
const SPIN = await pick("loader-circle", "loader");
const LOCK = await pick("lock-open", "unlock");
IC.lock = await H.icon(LOCK, ICON);
const MS = rootNamed(MASTERS);
const badge = setNamed("Badge");
const checkbox = setNamed("Checkbox");
const button = setNamed("Button");
const iconButton = setNamed("Icon button");
const input = setNamed("Input");
const segment = setNamed("Segment");
const sw = setNamed("Switch");

// ---- helpers ---------------------------------------------------------------------------------------------------------
const PL = "text/primary", PU = "text/secondary", PH = "text/placeholder";
const S13 = "Paragraph/Small Regular", S13M = "Paragraph/Small Medium", S11 = "Paragraph/Mini Regular", S11M = "Paragraph/Mini Medium";
// CUI tones on the semantic tokens: violet = primary, teal and neutral have no token of their own (approximated)
const TONE = { info: "feedback/info/default", success: "feedback/success/default", warning: "feedback/warning/default", danger: "feedback/error/default", violet: "primary/default", teal: "text/secondary", neutral: "text/placeholder" };
const TONE_SUB = { info: "feedback/info/subtle", success: "feedback/success/subtle", warning: "feedback/warning/subtle", danger: "feedback/error/subtle", violet: "primary/subtle", teal: "bg/muted", neutral: "bg/muted" };
const TONE_TXT = { info: "feedback/info/text", success: "feedback/success/text", warning: "feedback/warning/text", danger: "feedback/error/text", violet: "primary/default", teal: "text/secondary", neutral: "text/secondary" };
const spacer = (w, h) => box("spacer", { w, h });
const hline = () => box("divider", { fill: "border/default" });
const bottomBorder = (f, color = "border/default") => {
  stroke(f, color);
  f.strokeTopWeight = f.strokeLeftWeight = f.strokeRightWeight = 0;
  f.strokeBottomWeight = 1;
};
const tint = (f, token, a) => {
  setPaints(f, "fills", [a == null || a >= 1 ? solid(token) : Object.assign({}, solid(token), { opacity: a })]);
};
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
// fill token of a text node, whole run
const color = (t, token, a) => {
  setPaints(t, "fills", [a == null ? solid(token) : Object.assign({}, solid(token), { opacity: a })]);
};
// property of an instance nested in an instance (or master), found by layer name; layers hold the variant or prop keys
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
const slot = (root, name) => {
  const s = root.findOne((x) => x.name.toLowerCase() === name);
  if (!s) throw new Error("no slot " + name);
  return s;
};
const txt = (root, name) => {
  const t = root.findOne((x) => x.type === "TEXT" && x.name === name);
  if (!t) throw new Error("no text " + name);
  return t;
};
const field = (name, value, filled = true) => {
  const s = inst(input, { Type: "Text", State: "Default", Value: filled ? "Filled" : "Placeholder" }, { Text: value, "Left icon": false });
  s.name = name;
  return s;
};
const seg = (items, selIdx) => {
  const m = box("segmented", { dir: "row", pad: 4, gap: 4, radius: 10, fill: "bg/muted" });
  items.forEach((l, i) => m.appendChild(inst(segment, { Selected: i === selIdx ? "On" : "Off" }, { Label: l })));
  return m;
};
const ghostBtn = (label, icon) => inst(button, { Type: "Ghost", Size: "sm" }, icon ? { Label: label, "Left icon": true, "Left icon swap": icon.id } : { Label: label, "Left icon": false });
const ghostIcon = (icon) => inst(iconButton, { Type: "Ghost", Size: "sm" }, { Icon: icon.id });
// vector pen (as in 29-charts): paths in the parent's coordinates, translated to the vector's own origin
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
  p.poly = (pts) => {
    pts.forEach(([x, y], i) => (i ? p.L(x, y) : p.M(x, y)));
    return p.Z();
  };
  p.circle = (cx, cy, r) => {
    const k = r * 0.5523;
    p.M(cx + r, cy).C(cx + r, cy + k, cx + k, cy + r, cx, cy + r).C(cx - k, cy + r, cx - r, cy + k, cx - r, cy);
    p.C(cx - r, cy - k, cx - k, cy - r, cx, cy - r).C(cx + k, cy - r, cx + r, cy - k, cx + r, cy);
    return p.Z();
  };
  // horizontal S-curve between two points
  p.bump = (x1, y1, x2, y2) => {
    const xm = (x1 + x2) / 2;
    return p.M(x1, y1).C(xm, y1, xm, y2, x2, y2);
  };
  p.empty = () => cmds.length === 0;
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
// st: { fill, alpha, stroke, salpha, sw }; drawn out of the flow at its own place in the parent
function draw(parent, pn, name, st) {
  const n = pn.node(name, st.fill ? "NONZERO" : "NONE");
  const v = n.v;
  setPaints(v, "fills", st.fill ? [st.alpha ? Object.assign({}, solid(st.fill), { opacity: st.alpha }) : solid(st.fill)] : []);
  setPaints(v, "strokes", st.stroke ? [st.salpha ? Object.assign({}, solid(st.stroke), { opacity: st.salpha }) : solid(st.stroke)] : []);
  if (st.stroke) {
    v.strokeWeight = st.sw || 1;
    v.strokeJoin = "ROUND";
  }
  parent.appendChild(v);
  v.layoutPositioning = "ABSOLUTE";
  v.x = n.x;
  v.y = n.y;
  return v;
}
// absolute frame in an auto-layout parent (events, measures, ticks)
function floating(parent, name, x, y, w, h, o = {}) {
  const f = box(name, { fill: o.fill, stroke: o.stroke });
  parent.appendChild(f);
  f.layoutPositioning = "ABSOLUTE";
  f.resize(w, h);
  f.x = x;
  f.y = y;
  if (o.alpha != null) tint(f, o.fill, o.alpha);
  f.constraints = { horizontal: o.h || "MIN", vertical: o.v || "MIN" };
  return f;
}

// ---- 1. Pipeline: Pipeline job (Status), 920 wide, 4 stages ------------------------------------------------------------
const JOB = {
  Passed: [["circle-check", "success"], 0],
  Running: [[SPIN, "violet"], 0],
  Failed: [["circle-x", "danger"], 0],
  "Soft failed": [["triangle-alert", "warning"], 0],
  Skipped: [["chevrons-right", "neutral"], 1],
  Pending: [["clock", "neutral"], 0],
};
const pjob = await variants("Pipeline job", { Status: Object.keys(JOB) }, async ({ Status }) => {
  const [[icon, tone], muted] = JOB[Status];
  const b = box("job", { component: true, dir: "row", gap: 8, pad: [0, 10], cross: "CENTER", w: 209, h: 34, radius: 8, fill: "bg/surface", stroke: "border/default" });
  b.appendChild(await ico(icon, 14, TONE[tone], "status"));
  add(b, await text("job", S13, muted ? PH : PL, "name"), { w: "fill" });
  b.appendChild(await text("0s", S11, PH, "duration"));
  if (Status === "Skipped" || Status === "Pending") b.children[2].visible = false;
  return b;
}, { cols: 3 });
wire(pjob, [{ layer: "name", kind: "TEXT", name: "Name" }, { layer: "duration", kind: "TEXT", name: "Duration" }]);
const pipeline = box("Pipeline", { component: true, dir: "row", w: 920 });
{
  const STAGES = [
    ["Build", "passed", "3m 56s", [["linux-x64", "Passed", "2m 22s"], ["macos-arm64", "Passed", "3m 21s"], ["windows-x64", "Passed", "3m 56s"]]],
    ["Test", "failed", "1m 35s", [["unit", "Passed", "1m 04s", true], ["integration", "Running", "1m 35s"], ["lint", "Soft failed", "12s"]]],
    ["Package", "pending", "", [["docker image", "Pending"], ["release notes", "Skipped"]]],
    ["Deploy", "pending", "", [["staging", "Pending"], ["production", "Pending"]]],
  ];
  const STAGE_ICON = { passed: ["circle-check", "success"], failed: ["circle-x", "danger"], pending: ["clock", "neutral"] };
  for (let s = 0; s < STAGES.length; s++) {
    const [name, status, dur, jobs] = STAGES[s];
    if (s) {
      // link: a line level with the first job, a chevron on a chip in its middle
      const link = box("link", { w: 28, pad: [30, 0, 0, 0] });
      const lk = box("link-line", { dir: "row", w: 28, h: 34, align: "CENTER", cross: "CENTER" });
      const line = floating(lk, "line", 0, 16, 28, 1, { fill: "border/strong", h: "STRETCH" });
      const chip = box("chip", { pad: 1, radius: 8, fill: "bg/surface" });
      chip.appendChild(await ico("chevron-right", 14, PH, "chevron"));
      lk.appendChild(chip);
      link.appendChild(lk);
      pipeline.appendChild(link);
    }
    const col = box("stage", { gap: 6, w: 209 });
    const head = box("stage-header", { dir: "row", gap: 6, cross: "CENTER", h: 24 });
    head.appendChild(await ico(STAGE_ICON[status][0], 14, TONE[STAGE_ICON[status][1]], "status"));
    add(head, await text(name, S13M, PL, "name"), { w: "fill" });
    if (dur) head.appendChild(await text(dur, S11, PH, "duration"));
    add(col, head, { w: "fill" });
    for (const [jn, st, jd, sel] of jobs) {
      const j = inst(pjob, { Status: st }, jd ? { Name: jn, Duration: jd } : { Name: jn });
      if (sel) {
        j.strokes = [solid("primary/default")];
        j.strokeWeight = 1.5;
      }
      add(col, j, { w: "fill" });
    }
    pipeline.appendChild(col);
  }
}
MS.appendChild(pipeline);

// ---- 2. Query builder: Query rule (Kind), group header and footer, 720 wide ----------------------------------------------
const qrule = await variants("Query rule", { Kind: ["Choice", "Text", "Number"] }, async ({ Kind }) => {
  const [f, o, v] = { Choice: ["Status", "is", "Open"], Text: ["Assignee", "is", "me"], Number: ["Priority", ">", "2"] }[Kind];
  const r = box("rule", { component: true, dir: "row", gap: 8, cross: "CENTER", w: 720 });
  const fs = inst(input, { Type: "Select", State: "Default", Value: "Filled" }, { Text: f, "Left icon": false });
  fs.name = "field";
  add(r, fs, { w: 150 });
  const os = inst(input, { Type: "Select", State: "Default", Value: "Filled" }, { Text: o, "Left icon": false });
  os.name = "operator";
  add(r, os, { w: Kind === "Number" ? 76 : 150 });
  const vs = Kind === "Choice" ? inst(input, { Type: "Select", State: "Default", Value: "Filled" }, { Text: v, "Left icon": false }) : field("value", v);
  vs.name = "value";
  add(r, vs, { w: "fill" });
  const x = ghostIcon(IC.x);
  x.name = "remove";
  r.appendChild(x);
  return r;
}, { cols: 3 });
const qb = box("Query builder", { component: true, w: 720, gap: 12 });
{
  const group = async (depth, any, kids) => {
    const g = depth ? box("group", { gap: 8, pad: [10, 12], radius: 8, stroke: "border/default", fill: "bg/muted" }) : box("group", { gap: 8 });
    const h = box("group-header", { dir: "row", gap: 8, cross: "CENTER" });
    h.appendChild(await text("Match", S13, PU, "match"));
    h.appendChild(seg(["All", "Any"], any ? 1 : 0));
    add(h, await text("of these conditions", S13, PU, "of"), { w: "fill" });
    if (depth) h.appendChild(ghostIcon(IC["trash-2"]));
    add(g, h, { w: "fill" });
    for (const k of kids) add(g, k, { w: "fill" });
    const f = box("group-footer", { dir: "row", gap: 4 });
    f.appendChild(ghostBtn("Condition", IC.plus));
    if (depth + 1 < 3) f.appendChild(ghostBtn("Group", IC.plus));
    add(g, f, { w: "fill" });
    return g;
  };
  const inner = await group(1, true, [inst(qrule, { Kind: "Text" }), inst(qrule, { Kind: "Number" })]);
  add(qb, await group(0, false, [inst(qrule, { Kind: "Choice" }), inner]), { w: "fill" });
  add(qb, await text('Status is Open and (Assignee is "me" or Priority > 2)', S11, PU, "summary"), { w: "fill" });
}
MS.appendChild(qb);

// ---- 3. Keymap: Keymap key (State), ANSI keyboard at 46 px per unit ------------------------------------------------------
const U = 46;
const KEY = {
  Default: { fill: "bg/surface" },
  Dead: { fill: "bg/surface", dead: true },
  Held: { fill: "interaction/active", stroke: "primary/default", sw: 1.5 },
  File: { fill: TONE_SUB.violet, bar: TONE.violet },
  Navigate: { fill: TONE_SUB.info, bar: TONE.info },
  Edit: { fill: TONE_SUB.success, bar: TONE.success },
  Run: { fill: TONE_SUB.warning, bar: TONE.warning },
  Conflict: { fill: TONE_SUB.danger, bar: TONE.danger, stroke: "feedback/error/default", sw: 1.5, danger: true },
};
const kkey = await variants("Keymap key", { State: Object.keys(KEY) }, async ({ State }) => {
  const k = KEY[State];
  const b = box("key", { component: true, w: U - 4, h: U - 4, radius: 6, stroke: k.stroke || "border/default", sw: k.sw, fill: k.fill, pad: [4, 4, 6, 4], clip: true });
  const l = await text("K", S11M, PL, "label");
  if (k.dead) color(l, PH, 0.7);
  add(b, l, { w: "fill" });
  add(b, spacer(), { w: "fill", h: "fill" });
  const a = await text("Action", S11, k.danger ? "feedback/error/text" : PH, "action");
  add(b, a, { w: "fill" });
  trunc(a);
  if (!k.bar && !k.danger) a.visible = false;
  if (k.bar) {
    const bar = floating(b, "tone", 3, U - 4 - 5, U - 10, 2, { fill: k.bar, v: "MAX", h: "STRETCH" });
    bar.cornerRadius = 1;
  }
  return b;
}, { cols: 4 });
wire(kkey, [{ layer: "label", kind: "TEXT", name: "Label" }, { layer: "action", kind: "TEXT", name: "Action" }]);
const keymap = box("Keymap", { component: true, w: 900, gap: 12 });
{
  const bar = box("modifiers", { dir: "row", gap: 12, cross: "CENTER", wrap: 8 });
  bar.appendChild(seg(["No modifier 6", "Cmd 16", "Shift", "Opt", "Cmd+Shift 2"], 1));
  for (const [n, t] of [["File", "violet"], ["Navigate", "info"], ["Edit", "success"], ["Run and debug", "warning"]]) {
    const li = box("legend-item", { dir: "row", gap: 6, cross: "CENTER" });
    add(li, box("dot", { fill: TONE[t], radius: 3 }), { w: 10, h: 10 });
    li.appendChild(await text(n, S13, PU, "name"));
    bar.appendChild(li);
  }
  const cf = box("conflicts", { dir: "row", gap: 6, cross: "CENTER" });
  cf.appendChild(await ico("triangle-alert", 14, TONE.danger, "icon"));
  cf.appendChild(await text("1 conflict", S13, "feedback/error/text", "count"));
  bar.appendChild(cf);
  add(keymap, bar, { w: "fill" });
  // Cmd selected: bound keys (label -> action, set), the Cmd keys held, dead keys muted
  const BIND = {
    S: ["Save", "File"], O: ["Open", "File"], N: ["New file", "File"], W: ["Close tab", "File"], P: ["Go to file", "Navigate"], G: ["Go to line", "Navigate"],
    E: ["Recent files", "Navigate"], F: ["Find", "Edit"], H: ["Replace", "Edit"], Z: ["Undo", "Edit"], Y: ["Redo", "Edit"], "/": ["Comment", "Edit"],
    B: ["Build", "Run"], D: ["Debug", "Run"], R: ["2 actions", "Conflict"],
  };
  const DEAD = new Set(["`", "[", "]", "\\", "Caps", ";", "'", "Menu"]);
  const mk = async (label, w) => {
    const lab = label === "Space" ? " " : label;
    let State = "Default", props = { Label: lab };
    if (label === "Cmd") State = "Held";
    else if (BIND[label]) {
      State = BIND[label][1];
      props.Action = BIND[label][0];
    } else if (DEAD.has(label)) State = "Dead";
    const k = inst(kkey, { State }, props);
    k.name = "key " + label;
    k.layoutSizingHorizontal = "FIXED";
    k.resize(w * U - 4, U - 4);
    return k;
  };
  // row = list of [label, units] or a number (units of gap)
  const krow = async (items) => {
    const r = box("row", { dir: "row", gap: 4 });
    for (const it of items) {
      if (typeof it === "number") r.appendChild(spacer(it * U - 4, U - 4));
      else r.appendChild(await mk(it[0], it[1]));
    }
    return r;
  };
  const one = (s) => s.split(" ").map((x) => [x, 1]);
  const gap8 = () => spacer(1, 8);
  const main = box("main-block", { gap: 4 });
  main.appendChild(await krow([["Esc", 1], 1, ...one("F1 F2 F3 F4"), 0.5, ...one("F5 F6 F7 F8"), 0.5, ...one("F9 F10 F11 F12")]));
  main.appendChild(gap8());
  main.appendChild(await krow([...one("` 1 2 3 4 5 6 7 8 9 0 - ="), ["Bksp", 2]]));
  main.appendChild(await krow([["Tab", 1.5], ...one("Q W E R T Y U I O P [ ]"), ["\\", 1.5]]));
  main.appendChild(await krow([["Caps", 1.75], ...one("A S D F G H J K L ; '"), ["Enter", 2.25]]));
  main.appendChild(await krow([["Shift", 2.25], ...one("Z X C V B N M , . /"), ["Shift", 2.75]]));
  main.appendChild(await krow([["Ctrl", 1.25], ["Cmd", 1.25], ["Opt", 1.25], ["Space", 6.25], ["Opt", 1.25], ["Cmd", 1.25], ["Menu", 1.25], ["Ctrl", 1.25]]));
  const nav = box("nav-cluster", { gap: 4 });
  nav.appendChild(spacer(U - 4, U - 4));
  nav.appendChild(gap8());
  nav.appendChild(await krow([1, ["Home", 1], ["PgUp", 1]]));
  nav.appendChild(await krow([["Del", 1], ["End", 1], ["PgDn", 1]]));
  nav.appendChild(spacer(U - 4, U - 4));
  nav.appendChild(await krow([1, ["↑", 1]]));
  nav.appendChild(await krow([["←", 1], ["↓", 1], ["→", 1]]));
  const kb = box("keyboard", { dir: "row", gap: 24, pad: [0, 0, 0, 24] });
  kb.appendChild(main);
  kb.appendChild(nav);
  add(keymap, kb, { w: "hug" });
}
MS.appendChild(keymap);

// ---- 4. Commit graph: Commit row (Selected x Refs), lanes drawn as vectors over the list ------------------------------------
const crow = await variants("Commit row", { Selected: ["Off", "On"], Refs: ["None", "One", "Two"] }, async ({ Selected, Refs }) => {
  const b = box("commit-row", { component: true, dir: "row", gap: 10, pad: [0, 12, 0, 0], cross: "CENTER", w: 920, h: 30, fill: Selected === "On" ? "interaction/active" : undefined });
  b.appendChild(spacer(34, 30));
  b.children[0].name = "lanes";
  const msg = box("message-cell", { dir: "row", gap: 6, cross: "CENTER" });
  if (Refs !== "None") {
    const r1 = inst(badge, { Tone: "Success" }, { Dot: false, Label: "main" });
    r1.name = "ref 1";
    msg.appendChild(r1);
  }
  if (Refs === "Two") {
    const r2 = inst(badge, { Tone: "Neutral" }, { Dot: false, Label: "origin/main" });
    r2.name = "ref 2";
    msg.appendChild(r2);
  }
  const m = await text("message", S13, PL, "message");
  add(msg, m, { w: "fill" });
  trunc(m);
  add(b, msg, { w: "fill" });
  cell(b, await text("author", S11, PU, "author"), 120);
  cell(b, await text("date", S11, PH, "date"), 96);
  cell(b, await text("a91f3c2", "Code/11", PH, "hash"), 60);
  return b;
}, { cols: 3 });
wire(crow, [
  { layer: "message", kind: "TEXT", name: "Message" }, { layer: "author", kind: "TEXT", name: "Author" },
  { layer: "date", kind: "TEXT", name: "Date" }, { layer: "hash", kind: "TEXT", name: "Hash" },
]);
const COMMITS = [
  ["a91f3c2e", "Merge branch 'feature/trace-viewer'", "Maya Okafor", "2 hours ago", ["main", "origin/main"], [1, 4]],
  ["7be04d19", "Docs: the trace viewer and the waterfall", "Maya Okafor", "3 hours ago", [], [2]],
  ["c3d8a7f0", "Fix the ruler's last tick on narrow panels", "Jonas Berg", "5 hours ago", [], [3]],
  ["1f22b9e4", "Release 1.2", "Jonas Berg", "yesterday", ["tag: v1.2.0"], [6]],
  ["e8a0c55b", "Trace viewer: measure a range with Shift+drag", "Priya Nair", "yesterday", ["feature/trace-viewer"], [5]],
  ["4d9e1a77", "Trace viewer: lanes, spans and markers", "Priya Nair", "2 days ago", [], [6]],
  ["90b7f3c1", "Merge pull request #21 from fix/atlas", "Maya Okafor", "3 days ago", [], [7, 8]],
  ["52ce8d0a", "Faster soft shadows in software", "Lena Fischer", "3 days ago", [], [9]],
  ["b6f1e2d3", "Glyph atlas: compact after a zoom", "Aiko Tanaka", "4 days ago", ["fix/atlas"], [9]],
  ["0aa4c9e8", "Right to left layout", "Omid Saadat", "5 days ago", [], []],
];
const cgraph = box("Commit graph", { component: true, w: 920, h: 320, radius: 10, stroke: "border/default", fill: "bg/surface", clip: true });
{
  const ROW = 30, LX = (l) => 10 + l * 14;
  const LANE_TONE = ["info", "success", "warning", "violet", "danger"];
  const laneColor = (l) => TONE[LANE_TONE[l % LANE_TONE.length]];
  // lane assignment: a lane waits for the commit it expects next
  const state = [];
  const plan = [];
  COMMITS.forEach((c, i) => {
    let lane = state.indexOf(i);
    const incoming = lane >= 0;
    if (lane < 0) {
      lane = state.indexOf(null);
      if (lane < 0) lane = state.length;
    }
    const after = state.slice();
    while (after.length <= lane) after.push(null);
    const merging = [];
    state.forEach((e, l) => {
      if (e === i && l !== lane) merging.push(l);
    });
    for (const l of merging) after[l] = null;
    after[lane] = null;
    const links = [];
    c[5].forEach((p, k) => {
      let to = after.indexOf(p);
      if (to < 0) {
        if (k === 0) to = lane;
        else {
          to = after.indexOf(null);
          if (to < 0) to = after.length;
        }
        while (after.length <= to) after.push(null);
        after[to] = p;
      }
      links.push(to);
    });
    plan.push({ lane, incoming, merging, before: state.slice(), links });
    state.splice(0, state.length, ...after);
  });
  const rowsFrame = box("rows", { w: 920 });
  cgraph.appendChild(rowsFrame);
  COMMITS.forEach((c, i) => {
    const refs = c[4];
    const r = inst(crow, { Selected: i === 1 ? "On" : "Off", Refs: refs.length > 1 ? "Two" : refs.length ? "One" : "None" }, { Message: c[1], Author: c[2], Date: c[3], Hash: c[0].slice(0, 7) });
    if (refs.length === 1) {
      const lab = refs[0];
      nest(r, "ref 1", { Label: lab, Tone: lab.startsWith("tag: ") ? "Primary" : lab.includes("/") ? "Neutral" : "Success" });
    }
    add(rowsFrame, r, { w: "fill" });
  });
  // lines per lane colour: one stroke vector each; dots: filled vectors; merge commits ring; selected halo
  const lines = {}, dots = {};
  const L = (col) => (lines[col] = lines[col] || pen());
  const D = (col) => (dots[col] = dots[col] || pen());
  const halo = pen(), rings = [];
  plan.forEach((p, i) => {
    const oy = i * ROW, cy = oy + ROW / 2, x = LX(p.lane), col = laneColor(p.lane);
    p.before.forEach((e, l) => {
      if (e == null || l === p.lane || p.merging.includes(l)) return;
      L(laneColor(l)).M(LX(l), oy).L(LX(l), oy + ROW);
    });
    if (p.incoming) L(col).M(x, oy).L(x, cy);
    for (const l of p.merging) L(laneColor(l)).bump(LX(l), oy, x, cy);
    p.links.forEach((to, k) => {
      if (to === p.lane) L(col).M(x, cy).L(x, oy + ROW);
      else L(laneColor(k === 0 ? p.lane : to)).bump(x, cy, LX(to), oy + ROW);
    });
    if (i === 1) halo.circle(x, cy, 6.5);
    if (p.links.length > 1) rings.push([col, x, cy]);
    else D(col).circle(x, cy, 4.5);
  });
  draw(cgraph, halo, "selected halo", { fill: laneColor(plan[1].lane), alpha: 0.25 });
  for (const [col, pn] of Object.entries(lines)) draw(cgraph, pn, "lane lines", { stroke: col, sw: 1.5 });
  for (const [col, pn] of Object.entries(dots)) draw(cgraph, pn, "commit dots", { fill: col });
  for (const [col, x, cy] of rings) draw(cgraph, pen().circle(x, cy, 4.5), "merge commit", { fill: "bg/surface", stroke: col, sw: 1.5 });
}
MS.appendChild(cgraph);

// ---- 5. Dependency graph: Dependency node (Detail), nodes placed in layers, S-curve edges ---------------------------------------
const dnode = await variants("Dependency node", { Detail: ["Off", "On"] }, async ({ Detail }) => {
  const b = box("node", { component: true, dir: "row", gap: 8, pad: [8, 12], cross: "CENTER", radius: 6, fill: "bg/surface", stroke: "border/default" });
  b.minWidth = 72;
  add(b, box("tone", { fill: TONE.info, radius: 999 }), { w: 7, h: 7 });
  const col = box("labels", { gap: 0 });
  col.appendChild(await text("label", S13M, PL, "label"));
  if (Detail === "On") col.appendChild(await text("detail", S11, PH, "detail"));
  b.appendChild(col);
  return b;
}, { cols: 2 });
wire(dnode, [{ layer: "label", kind: "TEXT", name: "Label" }, { layer: "detail", kind: "TEXT", name: "Detail" }]);
const dgraph = box("Dependency graph", { component: true, w: 1000, h: 340, radius: 10, stroke: "border/default", fill: "bg/muted", clip: true });
{
  const NODES = [
    ["app", "executable", "violet", 0], ["ui", "libcui.a", "info", 1], ["net", "http client", "info", 1], ["storage", "sqlite", "teal", 1],
    ["render", "software, OpenGL", "info", 2], ["text", "fonts, shaping", "info", 2], ["tls", "mbedtls", "warning", 2],
    ["zlib", "", "neutral", 3], ["platform", "X11, Win32, Cocoa", "info", 3],
  ];
  const EDGES = [[0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [1, 8], [2, 6], [2, 7], [3, 7], [5, 7], [4, 8]];
  const SEL = 1;
  const lit = new Set([SEL, ...EDGES.filter((e) => e.includes(SEL)).flat()]);
  const els = [];
  NODES.forEach(([label, detail, tone, layer], i) => {
    const n = inst(dnode, { Detail: detail ? "On" : "Off" }, detail ? { Label: label, Detail: detail } : { Label: label });
    n.name = "node " + label;
    n.findOne((x) => x.name === "tone").fills = [solid(TONE[tone])];
    if (i === SEL) {
      n.strokes = [solid("primary/default")];
      n.strokeWeight = 2;
    }
    if (!lit.has(i)) n.opacity = 0.45;
    dgraph.appendChild(n);
    n.layoutPositioning = "ABSOLUTE";
    els.push({ n, layer });
  });
  // columns: x from the widest node of each layer, y centred per layer
  let x = 24;
  for (let layer = 0; layer <= 3; layer++) {
    const col = els.filter((e) => e.layer === layer);
    const h = col.reduce((s, e) => s + e.n.height, 0) + 18 * (col.length - 1);
    let y = Math.round((340 - h) / 2);
    for (const e of col) {
      e.n.x = x;
      e.n.y = y;
      y += e.n.height + 18;
    }
    x += Math.max(...col.map((e) => e.n.width)) + 64;
  }
  const edges = [], heads = [];
  for (const [a, b] of EDGES) {
    const A = els[a].n, B = els[b].n;
    const on = a === SEL || b === SEL;
    const x1 = A.x + A.width, y1 = A.y + A.height / 2, x2 = B.x, y2 = B.y + B.height / 2;
    const tone = on ? "primary/default" : "border/strong";
    const e = draw(dgraph, pen().bump(x1, y1, x2 - 5, y2), `edge ${NODES[a][0]} to ${NODES[b][0]}`, { stroke: tone, sw: on ? 2 : 1.25 });
    const h = draw(dgraph, pen().poly([[x2, y2], [x2 - 6, y2 - 3.5], [x2 - 6, y2 + 3.5]]), `arrow ${NODES[b][0]}`, { fill: tone });
    edges.push(e, h);
  }
  // edges under the nodes
  edges.forEach((v, i) => dgraph.insertChild(i, v));
}
MS.appendChild(dgraph);

// ---- 6. Network waterfall: Waterfall row (Selected x Status), phase bars in a slot --------------------------------------------
const WF = { name: 250, method: 48, status: 54, type: 56, size: 60 };
const END = 0.9558, PW = 462, SCALE = PW / END;
const wrow = await variants("Waterfall row", { Selected: ["Off", "On"], Result: ["Ok", "Error"] }, async ({ Selected, Result }) => {
  const b = box("waterfall-row", { component: true, dir: "row", gap: 8, pad: [0, 0, 0, 10], cross: "CENTER", w: 1000, h: 26, fill: Selected === "On" ? "interaction/active" : undefined });
  cell(b, await text("name", S13, Result === "Error" ? "feedback/error/text" : PL, "name"), WF.name);
  trunc(b.children[0]);
  cell(b, await text("GET", "Code/11", PU, "method"), WF.method);
  cell(b, await text("200", "Code/11", PL, "status"), WF.status);
  cell(b, await text("type", S11, PU, "type"), WF.type);
  cell(b, await text("0 B", S11, PU, "size"), WF.size, "RIGHT");
  const bar = box("bar", { dir: "row", pad: [0, 10], cross: "CENTER", clip: true });
  add(b, bar, { w: "fill", h: "fill" });
  return b;
}, { cols: 2 });
wire(wrow, [
  { layer: "name", kind: "TEXT", name: "Name" }, { layer: "method", kind: "TEXT", name: "Method" }, { layer: "status", kind: "TEXT", name: "Code" },
  { layer: "type", kind: "TEXT", name: "Type" }, { layer: "size", kind: "TEXT", name: "Size" },
]);
await slotify(wrow, "Phases", { frame: "bar" });
const waterfall = box("Network waterfall", { component: true, w: 1000, h: 340, radius: 10, stroke: "border/default", fill: "bg/surface", clip: true });
{
  const head = box("header", { dir: "row", gap: 8, pad: [0, 0, 0, 10], cross: "CENTER", h: 28, fill: "bg/muted" });
  for (const [n, w, al] of [["Name", WF.name], ["Method", WF.method], ["Status", WF.status], ["Type", WF.type], ["Size", WF.size, "RIGHT"]]) cell(head, await text(n, S11M, PH, n.toLowerCase()), w, al);
  const ruler = box("ruler", { dir: "row", pad: [0, 10], cross: "CENTER", clip: true });
  for (const [i, l] of ["0", "200 ms", "400 ms", "600 ms", "800 ms"].entries()) cell(ruler, await text(l, S11, PH, "tick " + l), Math.round(0.2 * SCALE * 10) / 10);
  add(head, ruler, { w: "fill", h: "fill" });
  add(waterfall, head, { w: "fill" });
  add(waterfall, hline(), { w: "fill", h: 1 });
  // requests: name, method, status, type, bytes, start, phases (queued, DNS, connect, TLS, waiting, download)
  const REQ = [
    ["shop.example.com", "GET", 200, "document", 18400, 0.0, [0.002, 0.018, 0.024, 0.031, 0.142, 0.012]],
    ["app.css", "GET", 200, "stylesheet", 42100, 0.232, [0.004, 0, 0, 0, 0.061, 0.022]],
    ["app.js", "GET", 200, "script", 186000, 0.233, [0.005, 0, 0, 0, 0.068, 0.094]],
    ["inter.woff2", "GET", 200, "font", 48200, 0.241, [0.003, 0.021, 0.019, 0.028, 0.044, 0.018]],
    ["session", "POST", 401, "fetch", 312, 0.402, [0.002, 0, 0, 0, 0.083, 0.001]],
    ["products?page=1", "GET", 200, "fetch", 9600, 0.404, [0.002, 0, 0, 0, 0.121, 0.006]],
    ["hero.avif", "GET", 200, "image", 212000, 0.41, [0.012, 0, 0, 0, 0.052, 0.188]],
    ["1042.webp", "GET", 304, "image", 0, 0.538, [0.006, 0, 0, 0, 0.038, 0]],
    ["1043.webp", "GET", 200, "image", 31200, 0.54, [0.008, 0, 0, 0, 0.041, 0.024]],
    ["collect", "POST", 0, "ping", 0, 0.702, [0.004, 0.026, 0.031, 0.036, 0.12, 0]],
  ];
  const PHASE = ["neutral", "teal", "warning", "violet", "success", "info"];
  const size = (n) => (n ? (n < 1000 ? n + " B" : n < 1e6 ? (n >= 1e5 ? Math.round(n / 1000) : (n / 1000).toFixed(1)) + " KB" : (n / 1e6).toFixed(1) + " MB") : "—");
  const body = box("rows", {});
  add(waterfall, body, { w: "fill", h: "fill" });
  REQ.forEach(([n, m, st, ty, by, start, ph], i) => {
    const r = inst(wrow, { Selected: i === 2 ? "On" : "Off", Result: st >= 400 ? "Error" : "Ok" }, { Name: n, Method: m, Code: st ? String(st) : "pending", Type: ty, Size: size(by) });
    if (st >= 300 && st < 400) color(txt(r, "status"), PH);
    const bar = slot(r, "phases");
    const lead = Math.round(start * SCALE * 10) / 10;
    if (lead >= 1) bar.appendChild(spacer(lead, 10));
    ph.forEach((d, k) => {
      const w = Math.round(d * SCALE * 10) / 10;
      if (w < 1 && k !== 0) return;
      const seg = box(["queued", "dns", "connect", "tls", "waiting", "download"][k], { w: Math.max(w, 1), h: k === 0 ? 2 : 10 });
      if (k === 0) tint(seg, "text/placeholder", 0.6);
      else if (k === 4) tint(seg, "feedback/success/default", 0.55);
      else seg.fills = [solid(TONE[PHASE[k]])];
      if (k) rad(seg, Math.min(2, w / 2));
      bar.appendChild(seg);
    });
    add(body, r, { w: "fill" });
  });
  // DOMContentLoaded and Load lines across the bar column
  const x0 = 10 + WF.name + WF.method + WF.status + WF.type + WF.size + 5 * 8 + 10;
  for (const [n, t, tone] of [["DOMContentLoaded", 0.395, "info"], ["Load", 0.68, "danger"]]) floating(body, n + " line", Math.round(x0 + t * SCALE), 0, 1, body.height || 260, { fill: TONE[tone], alpha: 0.6, v: "STRETCH" });
  add(waterfall, hline(), { w: "fill", h: 1 });
  const foot = box("footer", { dir: "row", gap: 12, wrap: 4, pad: [5, 0, 5, 10], cross: "CENTER", fill: "bg/muted" });
  foot.appendChild(await text("10 requests", S11, PU, "requests"));
  foot.appendChild(await text("547.8 KB transferred", S11, PU, "size"));
  foot.appendChild(await text("Finished in 919 ms", S11, PU, "finish"));
  foot.appendChild(await text("DOMContentLoaded 395 ms", S11, "feedback/info/text", "dcl"));
  foot.appendChild(await text("Load 680 ms", S11, "feedback/error/text", "load"));
  for (const k of [1, 2, 3, 4, 5]) {
    const li = box("legend-item", { dir: "row", gap: 4, cross: "CENTER" });
    const sw8 = box("swatch", { radius: 2 });
    if (k === 4) tint(sw8, "feedback/success/default", 0.55);
    else sw8.fills = [solid(TONE[PHASE[k]])];
    add(li, sw8, { w: 8, h: 8 });
    li.appendChild(await text(["", "DNS", "Connect", "TLS", "Waiting", "Download"][k], S11, PU, "label"));
    foot.appendChild(li);
  }
  add(waterfall, foot, { w: "fill" });
}
MS.appendChild(waterfall);

// ---- 7. Trace viewer: Trace lane (Zebra), spans in a slot, ruler, markers, measure ------------------------------------------------
const GUT = 150, TW = 1000;
const V0 = 0.0042, V1 = 0.0418;
const TRACK_W = TW - GUT - 1 - 16;
const TS_ = TRACK_W / (V1 - V0);
const tx = (t) => (t - V0) * TS_;
const tlane = await variants("Trace lane", { Zebra: ["Off", "On"] }, async ({ Zebra }) => {
  const b = box("lane", { component: true, dir: "row", w: TW, fill: Zebra === "On" ? "bg/subtle" : undefined });
  const g = box("gutter", { dir: "row", gap: 6, pad: [6, 8], cross: "MIN" });
  g.appendChild(await ico("chevron-down", 12, PH, "fold"));
  add(g, await text("Track", S11M, PU, "label"), { w: "fill" });
  add(b, g, { w: GUT, h: "fill" });
  add(b, box("divider", { fill: "border/default" }), { w: 1, h: "fill" });
  add(b, box("spans", { pad: [4, 8] }), { w: "fill" });
  bottomBorder(b);
  return b;
}, { cols: 2 });
wire(tlane, [{ layer: "label", kind: "TEXT", name: "Label" }, { layer: "fold", kind: "BOOLEAN", name: "Fold" }]);
await slotify(tlane, "Spans", { frame: "spans" });
const trace = box("Trace viewer", { component: true, w: TW, h: 320, radius: 10, stroke: "border/default", fill: "bg/surface", clip: true });
{
  // spans per track: [name, start, end, depth]
  const frame = (f) => (s) => [s[0], s[1] + f * 0.0166, s[2] + f * 0.0166, s[3]];
  const MAIN = [["Frame", 0.0004, 0.0151, 0], ["Input", 0.0006, 0.0019, 1], ["Update", 0.0021, 0.0092, 1], ["Physics", 0.0023, 0.0051, 2], ["Animation", 0.0053, 0.0068, 2],
    ["Scripts", 0.007, 0.009, 2], ["Layout", 0.0094, 0.0121, 1], ["Measure", 0.0095, 0.0108, 2], ["Paint", 0.0123, 0.0149, 1], ["Record", 0.0124, 0.0139, 2]];
  const RENDER = [["Submit", 0.0152, 0.0163, 0], ["Upload", 0.0153, 0.0157, 1], ["Encode", 0.0157, 0.0162, 1]];
  const rep = (a) => [0, 1, 2].flatMap((f) => a.map(frame(f)));
  const TRACKS = [
    ["Main thread", rep(MAIN)], ["Render", rep(RENDER)],
    ["Worker 1", [["Decode image", 0.0012, 0.0074, 0], ["Inflate", 0.0013, 0.0049, 1]]], ["Worker 2", [["Parse JSON", 0.0081, 0.0118, 0]]], ["GPU", [["Draw", 0.0164, 0.0271, 0]]],
  ];
  const SERIES = ["info", "success", "warning", "violet", "danger"];
  // head: ruler with ticks every 5 ms, markers strip
  const head = box("head", { dir: "row", fill: "bg/muted" });
  add(head, box("gutter", {}), { w: GUT, h: "fill" });
  add(head, box("divider", { fill: "border/default" }), { w: 1, h: "fill" });
  const hc = box("ruler-markers", {});
  const ruler = box("ruler", { h: 24, clip: true });
  const ticks = pen();
  for (let ms = 5; ms <= 40; ms += 5) {
    const x = 8 + tx(ms / 1000);
    ticks.M(x, 19).L(x, 24);
    const t = await text(ms + " ms", S11, PH, "tick " + ms);
    ruler.appendChild(t);
    t.layoutPositioning = "ABSOLUTE";
    t.x = Math.round(x + 3);
    t.y = 3;
  }
  draw(ruler, ticks, "ticks", { stroke: "border/strong", sw: 1 });
  add(hc, ruler, { w: "fill" });
  const strip = box("markers", { h: 18, clip: true });
  add(hc, strip, { w: "fill" });
  add(head, hc, { w: "fill" });
  bottomBorder(head);
  add(trace, head, { w: "fill" });
  const lanes = box("lanes", {});
  add(trace, lanes, { w: "fill", h: "fill" });
  TRACKS.forEach(([name, spans], li) => {
    const depth = Math.max(...spans.map((s) => s[3])) + 1;
    const r = inst(tlane, { Zebra: li % 2 ? "On" : "Off" }, { Label: name, Fold: depth > 1 });
    const sp = slot(r, "spans");
    for (let d = 0; d < depth; d++) {
      const row = box("depth " + d, { dir: "row", h: 20 });
      let at = 0;
      const mine = spans.filter((s) => s[3] === d && s[2] > V0 && s[1] < V1).sort((a, b) => a[1] - b[1]);
      for (const [n, s, e] of mine) {
        const a = Math.max(tx(s), 0), b = Math.min(tx(e), TRACK_W);
        if (b - a < 1 || a < at) continue;
        if (a - at >= 0.5) row.appendChild(spacer(Math.round((a - at) * 10) / 10, 1));
        const w = Math.round((b - a) * 10) / 10;
        const f = box(n, { dir: "row", pad: [0, 4], cross: "CENTER", w, h: 19, radius: 3, clip: true });
        tint(f, TONE[SERIES[[...n].reduce((s2, ch) => s2 + ch.charCodeAt(0), 0) % 5]], 0.35);
        if (n === "Update" && s > 0.0166) {
          f.strokes = [solid("primary/default")];
          f.strokeWeight = 1.5;
          f.strokeAlign = "INSIDE";
        }
        row.appendChild(f);
        f.setPluginData("w", String(w));
        at = b;
      }
      sp.appendChild(row);
      row.layoutSizingHorizontal = "FILL";
    }
    add(lanes, r, { w: "fill" });
  });
  // labels of the wide spans, after the layout settled
  for (const f of trace.findAll((n) => n.getPluginData("w"))) {
    if (+f.getPluginData("w") >= 40) {
      const lb = await text(f.name, S11, PL, "label");
      add(f, lb, { w: "fill" });
      trunc(lb);
    }
    f.setPluginData("w", "");
  }
  // markers: triangle, label, line through the lanes; measure range with its pill
  const MARKS = [["vsync", 0.0166, "neutral"], ["GC pause", 0.0273, "warning"], ["vsync", 0.0332, "neutral"]];
  for (const [n, t, tone] of MARKS) {
    const x = 8 + tx(t);
    draw(strip, pen().poly([[x - 4.5, 3], [x + 4.5, 3], [x, 9]]), "marker " + n, { fill: TONE[tone] });
    const l = await text(n, S11, PU, "marker label");
    strip.appendChild(l);
    l.layoutPositioning = "ABSOLUTE";
    l.x = Math.round(x + 7);
    l.y = 1;
    const lh = lanes.height || 220;
    draw(lanes, pen().M(GUT + 1 + x, 0).L(GUT + 1 + x, lh), "marker line " + n, { stroke: TONE[tone], salpha: 0.55, sw: 1 });
  }
  const m0 = GUT + 1 + 8 + tx(0.0161), m1 = GUT + 1 + 8 + tx(0.0236);
  const meas = floating(lanes, "measure", Math.round(m0), 0, Math.round(m1 - m0), lanes.height || 220, { fill: "primary/default", alpha: 0.08, v: "STRETCH" });
  meas.strokes = [solid("primary/default")];
  meas.strokeWeight = 1;
  meas.strokeTopWeight = meas.strokeBottomWeight = 0;
  const pill = box("measure-pill", { dir: "row", pad: [0, 8], radius: 999, fill: "primary/default", cross: "CENTER" });
  pill.appendChild(await text("7.5 ms", S11M, "text/on-primary", "duration"));
  ruler.appendChild(pill);
  pill.layoutPositioning = "ABSOLUTE";
  pill.x = Math.round(8 + tx(0.0161) + (tx(0.0236) - tx(0.0161)) / 2 - pill.width / 2);
  pill.y = 2;
}
MS.appendChild(trace);

// ---- 8. HTTP request bar: Request param row (State), response status ------------------------------------------------------------
const prow = await variants("Request param row", { State: ["Filled", "Fresh"] }, async ({ State }) => {
  const fresh = State === "Fresh";
  const r = box("param-row", { component: true, dir: "row", gap: 8, w: 760, cross: "CENTER" });
  const cb = inst(checkbox, { Checked: fresh ? "Off" : "On", State: fresh ? "Disabled" : "Default" }, { Label: false });
  cb.name = "enabled";
  r.appendChild(cb);
  const k = field("key", fresh ? "Key" : "status", !fresh);
  add(r, k, { w: 260 });
  add(r, field("value", fresh ? "Value" : "open", !fresh), { w: "fill" });
  const lock = inst(iconButton, { Type: "Ghost", Size: "sm", State: fresh ? "Disabled" : "Rest" }, { Icon: IC.lock.id });
  lock.name = "secret";
  r.appendChild(lock);
  const x = inst(iconButton, { Type: "Ghost", Size: "sm", State: fresh ? "Disabled" : "Rest" }, { Icon: IC.x.id });
  x.name = "remove";
  r.appendChild(x);
  return r;
}, { cols: 2 });
const reqbar = box("HTTP request bar", { component: true, w: 760, gap: 12 });
{
  const bar = box("request", { dir: "row", gap: 8, cross: "CENTER" });
  const method = inst(input, { Type: "Select", State: "Default", Value: "Filled" }, { Text: "POST", "Left icon": false });
  method.name = "method";
  add(bar, method, { w: 112 });
  const url = field("url", "https://api.example.com/v1/orders?status=open&limit=20");
  add(bar, url, { w: "fill" });
  bar.appendChild(inst(button, { Type: "Primary", Size: "md" }, { Label: "Send", "Left icon": true, "Left icon swap": IC.send.id }));
  add(reqbar, bar, { w: "fill" });
  const kv = box("params", { gap: 6 });
  const r1 = inst(prow, { State: "Filled" });
  nestField(r1, "key", "status");
  nestField(r1, "value", "open");
  add(kv, r1, { w: "fill" });
  const r2 = inst(prow, { State: "Filled" });
  nestField(r2, "key", "limit");
  nestField(r2, "value", "20");
  add(kv, r2, { w: "fill" });
  add(kv, inst(prow, { State: "Fresh" }), { w: "fill" });
  add(reqbar, kv, { w: "fill" });
  const resp = box("response", { dir: "row", gap: 10, wrap: 4, cross: "CENTER" });
  resp.appendChild(inst(badge, { Tone: "Success" }, { Dot: true, Label: "201 Created" }));
  resp.appendChild(await text("142 ms", S11, PU, "time"));
  resp.appendChild(await text("18.4 KB", S11, PU, "size"));
  add(reqbar, resp, { w: "fill" });
}
function nestField(root, layer, value) {
  nest(root, layer, { Text: value });
}
MS.appendChild(reqbar);

// ---- 9. Feature flags: Flag row, 860 wide ------------------------------------------------------------------------------------------------
const ENVS = ["dev", "stg", "prod"];
const frow = box("Flag row", { component: true, dir: "row", gap: 12, pad: [8, 12], cross: "CENTER", w: 860 });
{
  const left = box("flag", { gap: 2 });
  left.appendChild(await text("flag-key", "Code/13", PL, "key"));
  left.appendChild(await text("Description", S11, PH, "description"));
  add(frow, left, { w: "fill" });
  for (const e of ENVS) {
    const c = box("env-" + e, { dir: "row", gap: 6, cross: "CENTER", w: 128 });
    const s = inst(sw, { Checked: "Off", State: "Default" }, { Label: false });
    s.name = "switch-" + e;
    c.appendChild(s);
    c.appendChild(inst(button, { Type: "Ghost", Size: "sm" }, { Label: "100%", "Left icon": false }));
    c.children[1].name = "share-" + e;
    c.children[1].visible = false;
    frow.appendChild(c);
  }
  bottomBorder(frow);
}
wire(frow, [{ layer: "key", kind: "TEXT", name: "Key" }, { layer: "description", kind: "TEXT", name: "Description" }]);
MS.appendChild(frow);
const flags = box("Feature flags", { component: true, w: 860, gap: 8 });
{
  const f = inst(input, { Type: "Text", State: "Default", Value: "Placeholder" }, { Text: "Filter flags", "Left icon": true, "Left icon swap": IC.search.id });
  f.name = "filter";
  add(flags, f, { w: "fill" });
  const table = box("table", { radius: 8, stroke: "border/default", fill: "bg/surface", clip: true });
  const head = box("header", { dir: "row", gap: 12, pad: [8, 12], fill: "bg/muted", cross: "CENTER" });
  add(head, await text("Flag", S11M, PH, "flag"), { w: "fill" });
  for (const n of ["Development", "Staging", "Production"]) cell(head, await text(n, S11M, PH, n.toLowerCase()), 128);
  add(table, head, { w: "fill" });
  // key, description, on per env, share (warning when under 100)
  const FL = [
    ["new-checkout", "Single-page checkout with saved cards", [true, true, false], [100, 25, 100]],
    ["dark-mode-default", "Start new accounts in dark mode", [true, false, false], [100, 100, 100]],
    ["search-v2", "Ranked search with typo tolerance", [true, true, true], [100, 100, 5]],
    ["export-pdf", "Export reports as PDF", [false, false, false], [100, 100, 100]],
  ];
  FL.forEach(([key, desc, on, share], i) => {
    const r = inst(frow, {}, { Key: key, Description: desc });
    ENVS.forEach((e, k) => {
      if (!on[k]) return;
      nest(r, "switch-" + e, { Checked: "On" });
      const b = r.findOne((x) => x.name === "share-" + e);
      b.visible = true;
      nest(r, "share-" + e, { Label: share[k] + "%" });
      if (share[k] < 100) color(b.findOne((x) => x.type === "TEXT"), "feedback/warning/text");
    });
    if (i === FL.length - 1) r.strokeBottomWeight = 0;
    add(table, r, { w: "fill" });
  });
  add(flags, table, { w: "fill" });
}
MS.appendChild(flags);

// ---- 10. API explorer: API endpoint (Method x State), API tag header, API param ---------------------------------------------------------
const METHOD = { GET: "info", POST: "success", PUT: "warning", PATCH: "teal", DELETE: "danger" };
const aep = await variants("API endpoint", { Method: Object.keys(METHOD), State: ["Default", "Selected", "Deprecated"] }, async ({ Method, State }) => {
  const b = box("endpoint", { component: true, dir: "row", gap: 10, pad: [6, 10], cross: "CENTER", w: 820, fill: State === "Selected" ? "interaction/active" : undefined });
  const tag = box("method", { dir: "row", pad: [2, 0], radius: 4, fill: TONE_SUB[METHOD[Method]], align: "CENTER", cross: "CENTER" });
  add(tag, await text(Method, "Code/11", TONE_TXT[METHOD[Method]], "method-text"), {});
  add(b, tag, { w: 62 });
  const dep = State === "Deprecated";
  const p = await text("/path/{id}", "Code/13", dep ? PH : PL, "path");
  if (dep) p.textDecoration = "STRIKETHROUGH";
  b.appendChild(p);
  add(b, await text("Summary", S11, PH, "summary"), { w: "fill" });
  if (dep) b.appendChild(inst(badge, { Tone: "Warning" }, { Dot: false, Label: "Deprecated" }));
  return b;
}, { cols: 3 });
wire(aep, [{ layer: "summary", kind: "TEXT", name: "Summary" }]);
const atag = box("API tag header", { component: true, dir: "row", gap: 6, pad: [8, 10], cross: "CENTER", w: 820, fill: "bg/muted" });
atag.appendChild(await ico("chevron-down", 14, PH, "chevron"));
add(atag, await text("Tag", S13M, PL, "name"), { w: "fill" });
atag.appendChild(await text("0", S11, PH, "count"));
wire(atag, [{ layer: "name", kind: "TEXT", name: "Name" }, { layer: "count", kind: "TEXT", name: "Count" }]);
MS.appendChild(atag);
const aparam = box("API param", { component: true, dir: "row", gap: 10, cross: "MIN", w: 726 });
{
  const nm = box("name-cell", { dir: "row", gap: 2, w: 150 });
  nm.appendChild(await text("param", "Code/13", PL, "param-name"));
  nm.appendChild(await text("*", S13M, "feedback/error/text", "required"));
  aparam.appendChild(nm);
  cell(aparam, await text("string · query", S11, PH, "meta"), 110);
  add(aparam, await text("Description", S11, PU, "param-description"), { w: "fill" });
}
wire(aparam, [
  { layer: "param-name", kind: "TEXT", name: "Name" }, { layer: "required", kind: "BOOLEAN", name: "Required" },
  { layer: "meta", kind: "TEXT", name: "Meta" }, { layer: "param-description", kind: "TEXT", name: "Description" },
]);
MS.appendChild(aparam);
const api = box("API explorer", { component: true, w: 820, gap: 8 });
{
  const f = inst(input, { Type: "Text", State: "Default", Value: "Placeholder" }, { Text: "Filter endpoints", "Left icon": true, "Left icon swap": IC.search.id });
  f.name = "filter";
  add(api, f, { w: "fill" });
  const frame = box("endpoints", { radius: 8, stroke: "border/default", fill: "bg/surface", clip: true });
  // path with {params} in the accent colour
  const setPath = (r, path) => {
    const t = txt(r, "path");
    t.characters = path;
    for (const m of path.matchAll(/\{[^}]*\}/g)) t.setRangeFills(m.index, m.index + m[0].length, [solid("primary/default")]);
  };
  const tagHead = (name, count) => {
    const t = inst(atag, {}, { Name: name, Count: String(count) });
    return t;
  };
  const endpoint = (method, path, summary, state = "Default") => {
    const r = inst(aep, { Method: method, State: state }, { Summary: summary });
    if (state !== "Deprecated") setPath(r, path);
    else txt(r, "path").characters = path;
    return r;
  };
  add(frame, tagHead("Users", 5), { w: "fill" });
  add(frame, endpoint("GET", "/users", "List users"), { w: "fill" });
  add(frame, endpoint("POST", "/users", "Create a user"), { w: "fill" });
  add(frame, endpoint("GET", "/users/{id}", "Get a user", "Selected"), { w: "fill" });
  const open = box("params", { gap: 8, pad: [4, 12, 12, 82] });
  for (const [n, req, meta, desc] of [["id", true, "string · path", "The user's id"], ["fields", false, "string · query", "Comma separated fields to return"]]) {
    add(open, inst(aparam, {}, { Name: n, Required: req, Meta: meta, Description: desc }), { w: "fill" });
  }
  open.appendChild(inst(button, { Type: "Outline", Size: "sm" }, { Label: "Try it", "Left icon": true, "Left icon swap": IC.play.id }));
  add(frame, open, { w: "fill" });
  add(frame, endpoint("PATCH", "/users/{id}", "Update a user"), { w: "fill" });
  add(frame, endpoint("DELETE", "/users/{id}", "Delete a user"), { w: "fill" });
  add(frame, tagHead("Orders", 3), { w: "fill" });
  add(frame, endpoint("GET", "/orders", "List orders"), { w: "fill" });
  add(frame, endpoint("PUT", "/orders/{id}/status", "Set an order's status"), { w: "fill" });
  add(frame, endpoint("GET", "/v1/orders", "List orders (old)", "Deprecated"), { w: "fill" });
  add(api, frame, { w: "fill" });
}
MS.appendChild(api);

// ---- cards -------------------------------------------------------------------------------------------------------------------------------
const CARDS = [
  ["Pipeline", "Stages and jobs, one job selected", pipeline],
  ["Query builder", "Nested all and any groups of conditions", qb],
  ["Keymap", "Keyboard with the Cmd bindings by set", keymap],
  ["Commit graph", "Lanes, refs and a selected commit", cgraph],
  ["Dependency graph", "Layered nodes, the edges of one lit", dgraph],
  ["Network waterfall", "Request phases on a time ruler", waterfall],
  ["Trace viewer", "Lanes, spans, markers and a measured range", trace],
  ["HTTP request bar", "Method, URL, params and the response status", reqbar],
  ["Feature flags", "Flags by environment with their rollout share", flags],
  ["API explorer", "Endpoints by tag, one open with its params", api],
];
const c = await H.cursor();
for (const [caption, sub, master] of CARDS) {
  const k = await card(null, caption, sub);
  k.card.appendChild(master.createInstance());
  await burst(c, k.wrap);
}
c.done();
return Object.fromEntries(CARDS.map(([cap, , m]) => [cap, `${m.name} ${Math.round(m.width)}x${Math.round(m.height)}`]));
