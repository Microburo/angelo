// CUI planning and social: Kanban board (card, column header), Week calendar (event, day head, slot, hour),
// Gantt chart (day, task, bar), Node editor (pin row, graph node), Chat (bubble, message, divider, typing),
// Comments, Presence / counter / ticker, Carousel (slide, dot), Image compare (pane), Card stack, board cards.
const NEW = [
  "Kanban card", "Kanban column header", "Kanban column", "Kanban board",
  "Calendar event", "Calendar day head", "Calendar slot", "Calendar hour", "Week calendar",
  "Gantt day", "Gantt task", "Gantt bar", "Gantt chart",
  "Pin row", "Graph node", "Node editor",
  "Chat bubble", "Chat message", "Chat divider", "Typing indicator", "Chat",
  "Comment actions", "Comment", "Comments",
  "Presence avatar", "Presence", "Counter", "Ticker dot", "Ticker item", "Ticker",
  "Carousel slide", "Carousel dot", "Carousel",
  "Compare pane", "Image compare", "Stack card", "Stack peek", "Card stack",
];
for (const n of NEW) setNamed(n)?.remove();
const ICONS = ["plus", "message-square", "heart", "image", "check-check", "ellipsis", "trending-up", "trending-down", "chevrons-left-right"];
const IC = {};
for (const n of ICONS) IC[n] = await H.icon(n, ICON);
const MS = rootNamed(MASTERS);
const avatar = setNamed("Avatar");
const badge = setNamed("Badge");
const iconButton = setNamed("Icon button");
const progress = setNamed("Progress");
const slider = setNamed("Slider");

// ---- helpers ------------------------------------------------------------------------------------------------------
const sub = (root, name) => root.findOne((n) => n.name === name);
// set properties on an instance (nested ones included), matching names with or without the "#id" suffix
function setIn(node, props) {
  const defs = node.componentProperties;
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    const key = Object.keys(defs).find((d) => d === k || d.split("#")[0] === k);
    if (!key) throw new Error(`no property ${k} on ${node.name}`);
    out[key] = v;
  }
  node.setProperties(out);
  return node;
}
// one border side only (box() strokes all four)
function side(f, which, w = 1) {
  for (const k of ["Top", "Right", "Bottom", "Left"]) f[`stroke${k}Weight`] = k === which ? w : 0;
}
const row = (name, items, gap = 16, o = {}) => {
  const r = box(name, { dir: "row", gap, cross: o.cross || "CENTER" });
  items.forEach((i) => r.appendChild(i));
  return r;
};
const initials = (root, layer, v) => setIn(sub(root, layer), { Initials: v });
// ONE vector with several subpaths drawn over an auto-layout frame, out of the flow (the only absolute child of a
// drawing); `d` is in the frame's own coordinates. Works whether Figma keeps or normalises the path origin.
function overlay(parent, name, d, { stroke: s, fill: f, w = 1.5, index } = {}) {
  const v = figma.createVector();
  v.name = name;
  v.vectorPaths = [{ windingRule: "NONZERO", data: d }];
  v.strokes = s ? [solid(s)] : [];
  if (s) {
    v.strokeWeight = w;
    v.strokeCap = "ROUND";
    v.strokeJoin = "ROUND";
  }
  v.fills = f ? [solid(f)] : [];
  if (index != null) parent.insertChild(index, v);
  else parent.appendChild(v);
  v.layoutPositioning = "ABSOLUTE";
  const first = (s2) => s2.match(/M\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/).slice(1, 3).map(Number);
  const [ix, iy] = first(d);
  const [rx, ry] = first(v.vectorPaths[0].data);
  v.x = ix - rx;
  v.y = iy - ry;
  return v;
}
const rect = (x, y, w, h) => `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
// center of a node relative to a frame
const centerIn = (frame, n) => [
  n.absoluteTransform[0][2] - frame.absoluteTransform[0][2] + n.width / 2,
  n.absoluteTransform[1][2] - frame.absoluteTransform[1][2] + n.height / 2,
];
const tone = (t) => ({
  Info: ["feedback/info/subtle", "feedback/info/default"],
  Success: ["feedback/success/subtle", "feedback/success/default"],
  Warning: ["feedback/warning/subtle", "feedback/warning/default"],
  Error: ["feedback/error/subtle", "feedback/error/default"],
  Primary: ["primary/subtle", "primary/default"],
})[t];

// ======================================================= Kanban board ================================================
const kcard = await variants("Kanban card", { State: ["Rest", "Lifted"] }, async ({ State }) => {
  const lift = State === "Lifted";
  const b = box("kanban-card", { component: true, gap: 12, pad: 16, w: 272, radius: "panel", fill: "bg/surface", stroke: lift ? "border/strong" : "border/default" });
  if (lift) await b.setEffectStyleIdAsync(ES["Elevation/lg"].id);
  const tag = inst(badge, { Tone: "Neutral" }, { Label: "Tag" });
  tag.name = "tag";
  b.appendChild(tag);
  add(b, await text("Card title", "Paragraph/Medium Medium", "text/primary", "title"), { w: "fill" });
  const pr = inst(progress, { Value: "60" });
  pr.name = "progress";
  pr.visible = false;
  b.appendChild(pr);
  const foot = box("footer", { dir: "row", align: "SPACE_BETWEEN", cross: "CENTER" });
  const who = inst(avatar, { Type: "Initials", Size: "sm" }, { Initials: "JB" });
  who.name = "assignee";
  foot.appendChild(who);
  const cm = box("comments", { dir: "row", gap: 4, cross: "CENTER" });
  cm.appendChild(await ico("message-square", 16, "text/secondary", "comment-icon"));
  cm.appendChild(await text("2", "Paragraph/Small Regular", "text/secondary", "count"));
  foot.appendChild(cm);
  add(b, foot, { w: "fill" });
  return b;
}, { cols: 2 });
wire(kcard, [
  { layer: "tag", kind: "BOOLEAN", name: "Tag", def: true },
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "progress", kind: "BOOLEAN", name: "Progress", def: false },
  { layer: "count", kind: "TEXT", name: "Comments" },
]);

const KDOT = { Neutral: "text/placeholder", Info: "feedback/info/default", Success: "feedback/success/default" };
const khead = await variants("Kanban column header", { Tone: Object.keys(KDOT) }, async ({ Tone }) => {
  const b = box("kanban-column-header", { component: true, dir: "row", gap: 8, pad: [4, 4, 4, 8], w: 272, cross: "CENTER" });
  b.appendChild(box("dot", { w: 8, h: 8, radius: 999, fill: KDOT[Tone] }));
  b.appendChild(await text("Column", "Paragraph/Small Medium", "text/primary", "name"));
  b.appendChild(await text("3", "Paragraph/Small Regular", "text/secondary", "count"));
  add(b, box("space"), { w: "fill", h: 1 });
  const plus = inst(iconButton, { Type: "Ghost", Size: "sm" }, { Icon: IC.plus.id });
  plus.name = "add";
  b.appendChild(plus);
  return b;
}, { cols: 3 });
wire(khead, [
  { layer: "name", kind: "TEXT", name: "Name" },
  { layer: "count", kind: "TEXT", name: "Count" },
]);

function kcell(spec) {
  const c = inst(kcard, {}, { Tag: true, Title: spec.title, Comments: String(spec.n), Progress: !!spec.progress });
  setIn(sub(c, "tag"), { Tone: spec.tone, Label: spec.tag });
  initials(c, "assignee", spec.who);
  if (spec.progress) setIn(sub(c, "progress"), { Value: String(spec.progress) });
  return c;
}
// column = header + Cards slot; Target On = drop target outline
const kcolSet = await variants("Kanban column", { Target: ["Off", "On"] }, async ({ Target }) => {
  const c = box("kanban-column", { component: true, gap: 8, pad: 8, w: 288, radius: "surface", fill: "bg/subtle", stroke: Target === "On" ? "border/strong" : undefined });
  const h = inst(khead, { Tone: "Neutral" }, { Name: "Column", Count: "2" });
  h.name = "header";
  add(c, h, { w: "fill" });
  for (const t of ["Card title", "Card title"]) add(c, inst(kcard, {}, { Title: t }), { w: "fill" });
  return c;
}, { cols: 2 });
await slotify(kcolSet, "Cards", { from: 1 });
function kcol(name, kind, label, count, items, target) {
  const c = inst(kcolSet, { Target: target ? "On" : "Off" });
  c.name = name;
  setIn(sub(c, "header"), { Tone: kind, Name: label, Count: count });
  const cards = c.findChild((n) => n.type === "SLOT");
  for (const k of [...cards.children]) k.remove();
  for (const it of items) {
    if (it === "slot") {
      const s = box("drop-slot", { radius: "panel", fill: "bg/muted", stroke: "border/strong" });
      add(cards, s, { w: "fill", h: 96 });
    } else add(cards, kcell(it), { w: "fill" });
  }
  return c;
}
const kboard = box("Kanban board", { component: true, dir: "row", gap: 16, cross: "MIN" });
kboard.appendChild(kcol("column-backlog", "Neutral", "Backlog", "3", [
  { tag: "Perf", tone: "Success", title: "Virtualize the activity feed", who: "JB", n: 2 },
  { tag: "Docs", tone: "Primary", title: "Dark mode screenshots", who: "AT", n: 3 },
]));
kboard.appendChild(kcol("column-progress", "Info", "In progress", "2 / 3", [
  { tag: "A11y", tone: "Info", title: "Keyboard nav in the date range picker", who: "MO", n: 4, progress: 60 },
  "slot",
  { tag: "Platform", tone: "Warning", title: "IME composition on Windows", who: "DM", n: 2, progress: 25 },
], true));
kboard.appendChild(kcol("column-done", "Success", "Done", "1", [{ tag: "Motion", tone: "Primary", title: "Spring presets", who: "RD", n: 3 }]));
MS.appendChild(kboard);
await slotify(kboard, "Columns");

// ======================================================= Week calendar ===============================================
let CT, cevent, cal;
if (CUI) {
  CT = { Info: tone("Info"), Success: tone("Success"), Warning: tone("Warning"), Error: tone("Error"), Primary: tone("Primary") };
  cevent = await variants("Calendar event", [...Object.keys(CT).map((Tone) => ({ Tone, Layout: "Block" })), { Tone: "Info", Layout: "Inline" }], async ({ Tone, Layout }) => {
    const [subtle, strong] = CT[Tone];
    const inline = Layout === "Inline";
    const b = box("calendar-event", { component: true, dir: "row", w: 116, h: inline ? 22 : undefined, radius: 6, fill: subtle, clip: true, cross: inline ? "CENTER" : undefined });
    add(b, box("bar", { fill: strong }), { w: 3, h: "fill" });
    const t = box("text", { dir: inline ? "row" : "col", gap: inline ? 6 : 0, pad: inline ? [0, 8] : [6, 8], cross: inline ? "CENTER" : undefined });
    add(t, await text("Event", "Paragraph/Mini Medium", "text/primary", "title"), inline ? {} : { w: "fill" });
    add(t, await text("9:30", "Paragraph/Mini Regular", "text/secondary", "time"), inline ? {} : { w: "fill" });
    if (!inline) {
      const pl = await text("Room 2", "Paragraph/Mini Regular", "text/secondary", "place");
      pl.visible = false;
      add(t, pl, { w: "fill" });
    }
    add(b, t, { w: "fill" });
    return b;
  }, { cols: 6 });
  wire(cevent, [
    { layer: "title", kind: "TEXT", name: "Title" },
    { layer: "time", kind: "TEXT", name: "Time" },
    { layer: "place", kind: "BOOLEAN", name: "Place", def: false },
    { layer: "place", kind: "TEXT", name: "Place text" },
  ]);
  const dayhead = await variants("Calendar day head", { Today: ["Off", "On"] }, async ({ Today }) => {
    const on = Today === "On";
    const b = box("calendar-day-head", { component: true, dir: "row", gap: 8, w: 120, h: 56, align: "CENTER", cross: "CENTER" });
    b.appendChild(await text("Mon", "Paragraph/Small Regular", on ? "text/primary" : "text/secondary", "day"));
    const n = box("number-disc", { dir: "row", w: 32, h: 32, radius: 999, align: "CENTER", cross: "CENTER", fill: on ? "bg/inverse" : undefined });
    n.appendChild(await text("2", "Paragraph/Small Medium", on ? "text/on-primary" : "text/primary", "number"));
    b.appendChild(n);
    return b;
  }, { cols: 2 });
  wire(dayhead, [
    { layer: "day", kind: "TEXT", name: "Day" },
    { layer: "number", kind: "TEXT", name: "Number" },
  ]);
  const slot = await variants("Calendar slot", { Size: ["Hour", "Half"] }, async ({ Size }) => {
    const b = box("calendar-slot", { component: true, w: 116, h: Size === "Hour" ? 44 : 22, stroke: "border/default" });
    side(b, "Bottom");
    return b;
  }, { cols: 2 });
  const hour = box("Calendar hour", { component: true, w: 56, h: 44, pad: [0, 8, 0, 0], cross: "MAX" });
  hour.appendChild(await text("09:00", "Paragraph/Mini Regular", "text/secondary", "label"));
  MS.appendChild(hour);
  wire(hour, [{ layer: "label", kind: "TEXT", name: "Label" }]);

  // one half-hour = 22 px, the grid starts at 09:00; a day is a list of [event, halves] and gap numbers (halves)
  const EV = (Tone, title, time, extra = {}) => ({ Tone, Layout: extra.inline ? "Inline" : "Block", title, time, place: extra.place });
  const WEEK = [
    ["Mon", "2", [1, [EV("Info", "Standup", "9:30", { inline: 1 }), 1], 2, [EV("Primary", "Design review", "11:00 – 12:30", { place: "Room 2" }), 3], 9]],
    ["Tue", "3", [1, [EV("Info", "Standup", "9:30", { inline: 1 }), 1], 5, [EV("Success", "Lunch with Maya", "12:30 – 13:30"), 2], 7]],
    ["Wed", "4", [2, [EV("Warning", "Release planning", "10:00 – 11:30", { place: "Room 4" }), 3], 4, [EV("Success", "Focus time", "13:30 – 16:00", { place: "No meetings" }), 5], 2]],
    ["Thu", "5", [1, [EV("Info", "Standup", "9:30", { inline: 1 }), 1], 8, [EV("Error", "Customer call", "14:00 – 15:00"), 2], 4]],
    ["Fri", "6", [12, [EV("Primary", "Demo day", "15:00 – 16:30", { place: "All hands" }), 3], 1]],
    ["Sat", "7", [2, [EV("Success", "Gym", "10:00 – 11:30"), 3], 11]],
    ["Sun", "8", [16]],
  ];
  cal = box("Week calendar", { component: true, radius: "surface", fill: "bg/surface", stroke: "border/default", clip: true });
  const chead = box("header", { dir: "row", stroke: "border/default" });
  side(chead, "Bottom");
  chead.appendChild(box("gutter-space", { w: 56, h: 56 }));
  WEEK.forEach(([d, n], i) => chead.appendChild(inst(dayhead, { Today: i === 3 ? "On" : "Off" }, { Day: d, Number: n })));
  add(cal, chead, { w: "fill" });
  const cbody = box("body", { dir: "row" });
  const gutter = box("gutter", { w: 56 });
  for (let h = 9; h < 17; h++) gutter.appendChild(inst(hour, {}, { Label: String(h).padStart(2, "0") + ":00" }));
  cbody.appendChild(gutter);
  for (const [d, , items] of WEEK) {
    const col = box("day-" + d.toLowerCase(), { w: 120, pad: [0, 2], stroke: "border/default" });
    side(col, "Left");
    let at = 0;
    const gap = (n) => {
      while (n > 0) {
        const full = at % 2 === 0 && n >= 2;
        col.appendChild(inst(slot, { Size: full ? "Hour" : "Half" }));
        at += full ? 2 : 1;
        n -= full ? 2 : 1;
      }
    };
    for (const it of items) {
      if (typeof it === "number") gap(it);
      else {
        const [e, halves] = it;
        const ev = inst(cevent, { Tone: e.Tone, Layout: e.Layout }, { Title: e.title, Time: e.time });
        if (e.place) setIn(ev, { Place: true, "Place text": e.place });
        add(col, ev, { w: "fill", h: halves * 22 });
        at += halves;
      }
    }
    cbody.appendChild(col);
  }
  add(cal, cbody, { w: "fill" });
  MS.appendChild(cal);
}

// ======================================================= Gantt chart =================================================
let gbar, gchart;
if (CUI) {
  const DAY = 26;
  const ROWH = 40;
  const gday = await variants("Gantt day", { Kind: ["Weekday", "Weekend", "Today"] }, async ({ Kind }) => {
    const b = box("gantt-day", { component: true, dir: "row", w: DAY, h: 32, align: "CENTER", cross: "CENTER" });
    const color = Kind === "Today" ? "feedback/error/text" : Kind === "Weekend" ? "text/placeholder" : "text/secondary";
    b.appendChild(await text("26", Kind === "Today" ? "Paragraph/Small Medium" : "Paragraph/Small Regular", color, "label"));
    return b;
  }, { cols: 3 });
  wire(gday, [{ layer: "label", kind: "TEXT", name: "Label" }]);
  const gtask = await variants("Gantt task", { Tone: ["Success", "Info", "Warning"] }, async ({ Tone }) => {
    const b = box("gantt-task", { component: true, dir: "row", gap: 12, pad: [0, 16], w: 220, h: ROWH, cross: "CENTER", stroke: "border/default" });
    side(b, "Bottom");
    b.appendChild(box("marker", { w: 8, h: 8, radius: Tone === "Warning" ? 2 : 999, fill: tone(Tone)[1] }));
    add(b, await text("Task", "Paragraph/Small Regular", "text/primary", "name"), { w: "fill" });
    const o = inst(avatar, { Type: "Initials", Size: "sm" }, { Initials: "MO" });
    o.name = "owner";
    b.appendChild(o);
    return b;
  }, { cols: 3 });
  wire(gtask, [
    { layer: "name", kind: "TEXT", name: "Name" },
    { layer: "owner", kind: "BOOLEAN", name: "Owner", def: true },
  ]);
  gbar = await variants("Gantt bar", { Tone: ["Success", "Info"], Progress: ["Some", "None"] }, async ({ Tone, Progress }) => {
    const [subtle, strong] = tone(Tone);
    const b = box("gantt-bar", { component: true, dir: "row", w: 160, h: 24, radius: 6, clip: true, fill: Progress === "None" ? subtle : undefined, cross: "CENTER" });
    if (Progress === "Some") {
      const p = box("progress", { dir: "row", pad: [0, 10], fill: strong, cross: "CENTER", clip: true });
      p.appendChild(await text("Task", "Paragraph/Small Medium", "text/on-primary", "label"));
      add(b, p, { w: 88, h: "fill" });
      add(b, box("rest", { fill: subtle }), { w: "fill", h: "fill" });
    } else {
      const t = box("track", { dir: "row", pad: [0, 10], cross: "CENTER" });
      t.appendChild(await text("Task", "Paragraph/Small Medium", "text/primary", "label"));
      add(b, t, { w: "fill" });
    }
    return b;
  }, { cols: 2 });
  wire(gbar, [{ layer: "label", kind: "TEXT", name: "Label" }]);

  // start day (0 = Oct 26), length in days, progress; row 4 is the milestone
  const GTASKS = [
    { name: "Research", tone: "Success", who: "MO", start: 0, len: 6, pct: 1 },
    { name: "Wireframes", tone: "Success", who: "AT", start: 4, len: 6, pct: 1 },
    { name: "Design system", tone: "Success", who: "RD", start: 8, len: 7, pct: 0.7 },
    { name: "Core engine", tone: "Info", who: "JB", start: 5, len: 15, pct: 0.55 },
    { name: "Beta", tone: "Warning", milestone: 22 },
    { name: "Launch", tone: "Success", who: "PN", start: 24, len: 3, pct: 0 },
  ];
  gchart = box("Gantt chart", { component: true, dir: "row", radius: "surface", fill: "bg/surface", stroke: "border/default", clip: true });
  const gleft = box("task-list", { w: 220 });
  const ghead = box("task-head", { pad: [0, 16, 12, 16], h: 56, align: "MAX", fill: "bg/subtle", stroke: "border/default" });
  side(ghead, "Bottom");
  ghead.appendChild(await text("Task", "Paragraph/Small Regular", "text/secondary", "title"));
  add(gleft, ghead, { w: "fill" });
  for (const t of GTASKS) {
    const r = inst(gtask, { Tone: t.tone }, { Name: t.name, Owner: !!t.who });
    if (t.who) initials(r, "owner", t.who);
    add(gleft, r, { w: "fill" });
  }
  gleft.strokes = [solid("border/default")];
  gleft.strokeWeight = 1;
  gleft.strokeAlign = "INSIDE";
  side(gleft, "Right");
  gchart.appendChild(gleft);

  const gright = box("timeline");
  const timehead = box("timeline-head", { fill: "bg/subtle", stroke: "border/default" });
  side(timehead, "Bottom");
  const months = box("months", { dir: "row", h: 24 });
  for (const [label, days] of [["October 2026", 6], ["November 2026", 21]]) {
    const m = box("month-" + label.slice(0, 3).toLowerCase(), { dir: "row", pad: [0, 8], w: days * DAY, h: 24, cross: "CENTER" });
    m.appendChild(await text(label, "Paragraph/Small Medium", "text/secondary", "month"));
    months.appendChild(m);
  }
  timehead.appendChild(months);
  const days = box("days", { dir: "row" });
  const WEEKEND = [5, 6, 12, 13, 19, 20, 26];
  for (let i = 0; i < 27; i++) {
    const n = i < 6 ? 26 + i : i - 5;
    days.appendChild(inst(gday, { Kind: i === 10 ? "Today" : WEEKEND.includes(i) ? "Weekend" : "Weekday" }, { Label: String(n) }));
  }
  timehead.appendChild(days);
  gright.appendChild(timehead);
  const rows = box("rows", { w: 27 * DAY });
  // weekend bands first: out of the flow, under the rows
  overlay(rows, "weekends", [[5, 2], [12, 2], [19, 2], [26, 1]].map(([d, n]) => rect(d * DAY, 0, n * DAY, GTASKS.length * ROWH)).join(" "), { fill: "bg/subtle" });
  const GX = (t) => (t.milestone != null ? [t.milestone * DAY + DAY / 2 - 8, t.milestone * DAY + DAY / 2 + 8] : [t.start * DAY + 2, (t.start + t.len) * DAY - 2]);
  GTASKS.forEach((t, i) => {
    const r = box("row-" + (i + 1), { dir: "row", w: 27 * DAY, h: ROWH, cross: "CENTER", stroke: "border/default" });
    side(r, "Bottom");
    const [x0, x1] = GX(t);
    if (x0 > 0) r.appendChild(box("lead", { w: x0, h: 1 }));
    if (t.milestone != null) {
      const d = figma.createVector();
      d.name = "milestone";
      d.vectorPaths = [{ windingRule: "NONZERO", data: "M 8 0 L 16 8 L 8 16 L 0 8 Z" }];
      d.fills = [solid("feedback/warning/default")];
      d.strokes = [];
      r.appendChild(d);
    } else {
      const bar = inst(gbar, { Tone: t.tone, Progress: t.pct > 0 ? "Some" : "None" }, { Label: t.name });
      add(r, bar, { w: x1 - x0, h: 24 });
      if (t.pct > 0) {
        const p = sub(bar, "progress");
        p.resize(Math.round((x1 - x0) * t.pct), 24);
      }
    }
    rows.appendChild(r);
  });
  // dependencies as elbow arrows (one vector), today as a line (one vector): over the rows
  const deps = [[0, 1], [1, 2], [0, 3], [3, 4], [4, 5]];
  const elbows = deps.map(([a, b]) => {
    const ex = GX(GTASKS[a])[1];
    const ey = a * ROWH + ROWH / 2;
    const sx = GX(GTASKS[b])[0];
    const sy = b * ROWH + ROWH / 2;
    return `M ${ex} ${ey} L ${ex + 8} ${ey} L ${ex + 8} ${sy - 20} L ${sx - 12} ${sy - 20} L ${sx - 12} ${sy} L ${sx} ${sy} M ${sx - 5} ${sy - 3.5} L ${sx} ${sy} L ${sx - 5} ${sy + 3.5}`;
  });
  overlay(rows, "dependencies", elbows.join(" "), { stroke: "text/secondary", w: 1.5 });
  const tx = 10 * DAY + DAY / 2;
  overlay(rows, "today-line", `M ${tx} 0 L ${tx} ${GTASKS.length * ROWH}`, { stroke: "feedback/error/default", w: 1.5 });
  gright.appendChild(rows);
  gchart.appendChild(gright);
  MS.appendChild(gchart);
}

// ======================================================= Node editor =================================================
let pinrow, gnode, nedit;
if (CUI) {
  const PIN = { Color: "feedback/info/default", Float: "feedback/warning/default", Vector: "feedback/success/default" };
  pinrow = await variants("Pin row", { Side: ["Input", "Output"], Pin: Object.keys(PIN) }, async ({ Side, Pin }) => {
    const out = Side === "Output";
    const b = box("pin-row", { component: true, dir: "row", gap: 8, pad: [6, 12], w: 168, cross: "CENTER" });
    const dot = box("pin", { dir: "row", w: 12, h: 12, radius: 999, stroke: PIN[Pin], sw: 2, fill: "bg/surface", align: "CENTER", cross: "CENTER" });
    dot.appendChild(box("core", { w: 8, h: 8, radius: 999, fill: PIN[Pin] }));
    const label = await text("Label", "Paragraph/Small Regular", "text/primary", "label");
    if (out) {
      label.textAlignHorizontal = "RIGHT";
      add(b, label, { w: "fill" });
      b.appendChild(dot);
    } else {
      b.appendChild(dot);
      add(b, label, { w: "fill" });
    }
    return b;
  }, { cols: 3 });
  wire(pinrow, [
    { layer: "label", kind: "TEXT", name: "Label" },
    { layer: "core", kind: "BOOLEAN", name: "Linked", def: true },
  ]);
  // node kinds: [side, pin type, label, linked] pins, "swatch", "slider", "value"
  const KINDS = {
    UV: [["Output", "Vector", "UV", 1]],
    "Brick texture": [["Input", "Vector", "Vector", 1], ["Output", "Color", "Color", 1], ["Output", "Float", "Alpha", 0]],
    Mix: [["Input", "Color", "Color A", 1], ["Input", "Color", "Color B", 0], "swatch", ["Input", "Float", "Factor", 0], "slider", ["Output", "Color", "Color", 1]],
    "Material output": [["Input", "Color", "Base color", 1], ["Input", "Float", "Roughness", 1], ["Input", "Vector", "Normal", 0]],
    Roughness: ["value", "slider", ["Output", "Float", "Value", 1]],
    Multiply: [["Input", "Float", "A", 1], ["Input", "Float", "B", 0], ["Output", "Float", "Result", 1]],
  };
  const NODE_COMBOS = [...Object.keys(KINDS).map((Kind) => ({ Kind, Selected: "Off" })), { Kind: "Multiply", Selected: "On" }];
  gnode = await variants("Graph node", NODE_COMBOS, async ({ Kind, Selected }) => {
    const sel = Selected === "On";
    const b = box("graph-node", { component: true, w: 168, radius: "panel", fill: "bg/surface", stroke: sel ? "primary/default" : "border/default", sw: sel ? 2 : 1, clip: true });
    const head = box("header", { pad: [10, 12], stroke: "border/default" });
    side(head, "Bottom");
    head.appendChild(await text(Kind, "Paragraph/Small Medium", "text/primary", "title"));
    add(b, head, { w: "fill" });
    const body = box("body", { pad: [4, 0, 8, 0] });
    for (const it of KINDS[Kind]) {
      if (typeof it !== "string") {
        const [Side, Pin, label, linked] = it;
        const p = inst(pinrow, { Side, Pin }, { Label: label, Linked: !!linked });
        p.name = "pin-" + label.toLowerCase().replace(/ /g, "-");
        add(body, p, { w: "fill" });
      } else if (it === "swatch") {
        const r = box("swatch-row", { dir: "row", gap: 8, pad: [4, 12], cross: "CENTER" });
        r.appendChild(box("swatch", { w: 28, h: 20, radius: 6, fill: "feedback/warning/default" }));
        r.appendChild(await text("#B8683F", "Paragraph/Small Regular", "text/primary", "hex"));
        add(body, r, { w: "fill" });
      } else if (it === "slider") {
        const r = box("slider-row", { dir: "row", pad: [4, 12], cross: "CENTER" });
        add(r, inst(slider, { Type: "Single", State: "Default" }, { Header: false }), { w: "fill" });
        add(body, r, { w: "fill" });
      } else {
        const r = box("value-row", { dir: "row", pad: [6, 12], align: "SPACE_BETWEEN", cross: "CENTER" });
        r.appendChild(await text("Value", "Paragraph/Small Medium", "text/primary", "value-label"));
        r.appendChild(await text("0.62", "Paragraph/Small Regular", "text/secondary", "value-number"));
        add(body, r, { w: "fill" });
      }
    }
    add(b, body, { w: "fill" });
    return b;
  }, { cols: 4 });
  wire(gnode, [{ layer: "title", kind: "TEXT", name: "Title" }]);

  nedit = box("Node editor", { component: true, dir: "row", gap: 56, pad: 32, radius: "surface", fill: "bg/subtle", stroke: "border/default", clip: true, cross: "MIN" });
  const N = {};
  const mkNode = (id, Kind, Selected = "Off") => {
    N[id] = inst(gnode, { Kind, Selected });
    N[id].name = "node-" + id;
    return N[id];
  };
  const ncol = (name, pads, nodes, gap = 40) => {
    const c = box(name, { gap, pad: pads });
    nodes.forEach((n) => c.appendChild(n));
    nedit.appendChild(c);
  };
  ncol("column-1", [0, 0, 0, 0], [mkNode("uv", "UV")]);
  ncol("column-2", [0, 0, 0, 0], [mkNode("brick", "Brick texture"), mkNode("rough", "Roughness")], 56);
  ncol("column-3", [12, 0, 0, 0], [mkNode("mix", "Mix"), mkNode("mult", "Multiply", "On")], 48);
  ncol("column-4", [110, 0, 0, 0], [mkNode("out", "Material output")]);
  MS.appendChild(nedit);
  // links: cubic curves between pin centers, all in ONE vector, over the nodes
  const pinAt = (id, label) => centerIn(nedit, sub(sub(N[id], "pin-" + label), "pin"));
  const LINKS = [["uv", "uv", "brick", "vector"], ["brick", "color", "mix", "color-a"], ["mix", "color", "out", "base-color"], ["rough", "value", "mult", "a"], ["mult", "result", "out", "roughness"]];
  const curves = LINKS.map(([a, la, b, lb]) => {
    const [x1, y1] = pinAt(a, la);
    const [x2, y2] = pinAt(b, lb);
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + dx).toFixed(1)} ${y1.toFixed(1)} ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  });
  overlay(nedit, "links", curves.join(" "), { stroke: "text/secondary", w: 2 });
}

// ======================================================= Chat ========================================================
const bubble = await variants("Chat bubble", [{ Side: "Other", Group: "Single" }, { Side: "Other", Group: "Grouped" }, { Side: "Mine", Group: "Single" }], async ({ Side, Group }) => {
  const mine = Side === "Mine";
  const b = box("chat-bubble", { component: true, dir: "row", pad: [10, 16], radius: 18, fill: mine ? "primary/default" : "bg/muted", cross: "CENTER" });
  if (Group === "Grouped") num(b, "bottomLeftRadius", 6, "radius");
  b.appendChild(await text("Message", "Paragraph/Small Regular", mine ? "text/on-primary" : "text/primary", "text"));
  return b;
}, { cols: 3 });
wire(bubble, [{ layer: "text", kind: "TEXT", name: "Text" }]);
const cmsg = await variants("Chat message", [{ Side: "Other", Avatar: "On" }, { Side: "Other", Avatar: "Off" }, { Side: "Mine", Avatar: "Off" }], async ({ Side, Avatar }) => {
  const mine = Side === "Mine";
  const av = Avatar === "On";
  const b = box("chat-message", { component: true, dir: "row", gap: 8, cross: mine ? "MIN" : "MAX", align: mine ? "MAX" : "MIN" });
  if (!mine) {
    if (av) {
      const a = inst(avatar, { Type: "Initials", Size: "md" }, { Initials: "JB" });
      a.name = "avatar";
      b.appendChild(a);
    } else b.appendChild(box("avatar-space", { w: 32, h: 32 }));
  }
  const col = box("body", { gap: 4, cross: mine ? "MAX" : "MIN" });
  if (!mine && !av) {
    const meta = box("meta", { dir: "row", gap: 8, pad: [0, 0, 0, 4], cross: "CENTER" });
    meta.appendChild(await text("Jonas Berg", "Paragraph/Mini Medium", "text/secondary", "name"));
    meta.appendChild(await text("9:41", "Paragraph/Mini Regular", "text/secondary", "time"));
    col.appendChild(meta);
  }
  const bub = inst(bubble, { Side: mine ? "Mine" : "Other", Group: !mine && !av ? "Grouped" : "Single" });
  bub.name = "bubble";
  col.appendChild(bub);
  if (mine) {
    const st = box("status", { dir: "row", gap: 4, pad: [0, 8, 0, 0], cross: "CENTER" });
    st.appendChild(await ico("check-check", 14, "text/secondary", "status-icon"));
    st.appendChild(await text("Read 9:43", "Paragraph/Mini Regular", "text/secondary", "status-text"));
    st.visible = false;
    col.appendChild(st);
  }
  b.appendChild(col);
  return b;
}, { cols: 3 });
wire(cmsg, [
  { layer: "meta", kind: "BOOLEAN", name: "Meta", def: true },
  { layer: "name", kind: "TEXT", name: "Name" },
  { layer: "time", kind: "TEXT", name: "Time" },
  { layer: "status", kind: "BOOLEAN", name: "Status", def: false },
  { layer: "status-text", kind: "TEXT", name: "Status text" },
]);
const cdiv = box("Chat divider", { component: true, dir: "row", gap: 16, w: 472, cross: "CENTER" });
add(cdiv, box("line-left", { fill: "border/default" }), { w: "fill", h: 1 });
cdiv.appendChild(await text("Today", "Paragraph/Small Regular", "text/secondary", "label"));
add(cdiv, box("line-right", { fill: "border/default" }), { w: "fill", h: 1 });
MS.appendChild(cdiv);
wire(cdiv, [{ layer: "label", kind: "TEXT", name: "Label" }]);
const typing = box("Typing indicator", { component: true, dir: "row", gap: 8, cross: "CENTER" });
const tav = inst(avatar, { Type: "Initials", Size: "md" }, { Initials: "J" });
tav.name = "avatar";
typing.appendChild(tav);
const tb = box("dots-bubble", { dir: "row", pad: [8, 16], radius: 18, fill: "bg/muted", cross: "CENTER" });
tb.appendChild(await ico("ellipsis", 20, "text/secondary", "dots"));
typing.appendChild(tb);
typing.appendChild(await text("Jonas is typing", "Paragraph/Small Regular", "text/secondary", "label"));
MS.appendChild(typing);
wire(typing, [{ layer: "label", kind: "TEXT", name: "Label" }]);

const chat = box("Chat", { component: true, gap: 16, pad: 24, w: 520, radius: "surface", fill: "bg/surface", stroke: "border/default" });
add(chat, inst(cdiv), { w: "fill" });
const msg = (variant, text2, o = {}) => {
  const m = inst(cmsg, variant);
  setIn(sub(m, "bubble"), { Text: text2 });
  if (o.name) setIn(m, { Name: o.name, Time: o.time });
  if (o.status) setIn(m, { Status: true, "Status text": o.status });
  return m;
};
const g1 = box("group-jonas", { gap: 4 });
add(g1, msg({ Side: "Other", Avatar: "Off" }, "Did the data grid make it into 1.1?", { name: "Jonas Berg", time: "9:41" }), { w: "fill" });
add(g1, msg({ Side: "Other", Avatar: "On" }, "I need it for the billing page."), { w: "fill" });
add(chat, g1, { w: "fill" });
const g2 = box("group-me", { gap: 4 });
add(g2, msg({ Side: "Mine", Avatar: "Off" }, "It did. 2,000 rows scroll at 60 fps on my laptop."), { w: "fill" });
add(g2, msg({ Side: "Mine", Avatar: "Off" }, "Shift and Ctrl clicks select like a spreadsheet.", { status: "Read 9:43" }), { w: "fill" });
add(chat, g2, { w: "fill" });
chat.appendChild(inst(typing));
MS.appendChild(chat);
await slotify(chat, "Messages");

// ======================================================= Comments ====================================================
// Comment actions: like (count) and reply; Liked switch paints the like in the error tone
const cActions = await variants("Comment actions", { Liked: ["Off", "On"] }, async ({ Liked }) => {
  const fg = Liked === "On" ? (CUI ? "danger/default" : "feedback/error/default") : "text/secondary";
  const actions = box("comment-actions", { component: true, dir: "row", gap: 16, pad: [4, 0, 0, 0], cross: "CENTER" });
  const like = box("like", { dir: "row", gap: 4, cross: "CENTER" });
  like.appendChild(await ico("heart", 16, fg, "like-icon"));
  like.appendChild(await text("12", "Paragraph/Small Medium", fg, "likes"));
  actions.appendChild(like);
  const reply = box("reply", { dir: "row", gap: 4, cross: "CENTER" });
  reply.appendChild(await ico("message-square", 16, "text/secondary", "reply-icon"));
  reply.appendChild(await text("Reply", "Paragraph/Small Medium", "text/secondary", "reply-label"));
  actions.appendChild(reply);
  return actions;
}, { cols: 2 });
wire(cActions, [{ layer: "likes", kind: "TEXT", name: "Likes" }]);
const comment = await variants("Comment", { Size: ["Root", "Reply"] }, async ({ Size }) => {
  const root = Size === "Root";
  const b = box("comment", { component: true, dir: "row", gap: 12, w: 480, cross: "MIN" });
  const a = inst(avatar, { Type: "Initials", Size: root ? "lg" : "md" }, { Initials: "TR" });
  a.name = "avatar";
  b.appendChild(a);
  const col = box("content", { gap: 4 });
  const head = box("head", { dir: "row", gap: 8, cross: "CENTER" });
  head.appendChild(await text("Tomas Rivera", "Paragraph/Small Medium", "text/primary", "name"));
  const bd = inst(badge, { Tone: "Neutral" }, { Label: "Author" });
  bd.name = "badge";
  bd.visible = false;
  head.appendChild(bd);
  head.appendChild(await text("2h", "Paragraph/Mini Regular", "text/secondary", "time"));
  col.appendChild(head);
  add(col, await text("The new numbers match the staging run. I would still test the import on a large file before Friday.", "Paragraph/Small Regular", "text/primary", "body"), { w: "fill" });
  const actions = cActions.defaultVariant.createInstance();
  actions.name = "actions";
  col.appendChild(actions);
  add(b, col, { w: "fill" });
  return b;
}, { cols: 2 });
for (const v of comment.children) own(v, "actions")[0].isExposedInstance = true;
wire(comment, [
  { layer: "name", kind: "TEXT", name: "Name" },
  { layer: "badge", kind: "BOOLEAN", name: "Badge", def: false },
  { layer: "time", kind: "TEXT", name: "Time" },
  { layer: "body", kind: "TEXT", name: "Body" },
]);
const comments = box("Comments", { component: true, gap: 12, pad: 24, w: 560, radius: "surface", fill: "bg/surface", stroke: "border/default" });
{
  const r = inst(comment, { Size: "Root" }, { Badge: true });
  setIn(sub(r, "actions"), { Liked: "On" });
  add(comments, r, { w: "fill" });
  // thread line runs under the root avatar (centered at 20 px), replies indented along it
  const thread = box("thread", { pad: [0, 0, 0, 19] });
  const replies = box("replies", { gap: 12, pad: [0, 0, 0, 24], stroke: "border/default" });
  side(replies, "Left", 2);
  const r1 = inst(comment, { Size: "Reply" }, { Name: "Priya Nair", Time: "1h", Body: "Agreed. I have a 2 GB export we can use." });
  setIn(sub(r1, "actions"), { Likes: "3" });
  initials(r1, "avatar", "PN");
  const r2 = inst(comment, { Size: "Reply" }, { Name: "Maya Okafor", Time: "40m · edited", Body: "Scheduled it for 3 pm." });
  setIn(sub(r2, "actions"), { Likes: "0" });
  initials(r2, "avatar", "MO");
  add(replies, r1, { w: "fill" });
  add(replies, r2, { w: "fill" });
  add(thread, replies, { w: "fill" });
  add(comments, thread, { w: "fill" });
}
MS.appendChild(comments);
await slotify(comments, "Thread");

// ======================================================= Presence, counter, ticker ===================================
const RING = { Primary: "primary/default", Success: "feedback/success/default", Warning: "feedback/warning/default", Info: "feedback/info/default", Error: "feedback/error/default" };
const pav = await variants("Presence avatar", { Ring: Object.keys(RING) }, async ({ Ring }) => {
  const b = box("presence-avatar", { component: true, dir: "row", w: 48, h: 48, pad: 3, radius: 999, stroke: RING[Ring], sw: 2, fill: "bg/surface", align: "CENTER", cross: "CENTER" });
  const a = inst(avatar, { Type: "Initials", Size: "lg" }, { Initials: "MO" });
  a.name = "avatar";
  b.appendChild(a);
  return b;
}, { cols: 5 });
const presence = box("Presence", { component: true, dir: "row", gap: -12, cross: "CENTER" });
[["Primary", "MO", 1], ["Success", "JB", 1], ["Warning", "PN", 1], ["Info", "LF", 0.5], ["Error", "AT", 1]].forEach(([Ring, who, op]) => {
  const p = inst(pav, { Ring });
  initials(p, "avatar", who);
  p.opacity = op;
  p.name = "user-" + who.toLowerCase();
  presence.appendChild(p);
});
const more = box("more", { dir: "row", w: 48, h: 48, radius: 999, stroke: "border/default", fill: "bg/surface", align: "CENTER", cross: "CENTER" });
more.appendChild(await text("+2", "Paragraph/Small Medium", "text/secondary", "count"));
presence.appendChild(more);
MS.appendChild(presence);
await slotify(presence, "Users");
const counter = box("Counter", { component: true, dir: "row", cross: "CENTER" });
counter.appendChild(await text("$48,210", "Display/1", "text/primary", "value"));
MS.appendChild(counter);
wire(counter, [{ layer: "value", kind: "TEXT", name: "Value" }]);
const tdot = box("Ticker dot", { component: true, w: 4, h: 4, radius: 999, fill: "text/placeholder" });
MS.appendChild(tdot);
const titem = await variants("Ticker item", { Trend: ["Good", "Bad"] }, async ({ Trend }) => {
  const good = Trend === "Good";
  const fg = good ? "feedback/success/text" : "feedback/error/text";
  const b = box("ticker-item", { component: true, dir: "row", gap: 8, cross: "CENTER" });
  b.appendChild(await text("Revenue", "Paragraph/Small Regular", "text/secondary", "label"));
  b.appendChild(await text("$48.2k", "Paragraph/Small Medium", "text/primary", "value"));
  const t = box("trend", { dir: "row", gap: 4, cross: "CENTER" });
  t.appendChild(await ico(good ? "trending-up" : "trending-down", 16, fg, "trend-icon"));
  t.appendChild(await text("+6.9%", "Paragraph/Small Medium", fg, "delta"));
  b.appendChild(t);
  return b;
}, { cols: 2 });
wire(titem, [
  { layer: "label", kind: "TEXT", name: "Label" },
  { layer: "value", kind: "TEXT", name: "Value" },
  { layer: "trend-icon", kind: "SWAP", name: "Trend icon", def: IC["trending-up"].id, pref: [IC["trending-up"], IC["trending-down"]] },
  { layer: "delta", kind: "TEXT", name: "Delta" },
]);
const ticker = box("Ticker", { component: true, dir: "row", gap: 24, pad: [8, 0], w: 640, clip: true, cross: "CENTER" });
[["Revenue", "$48.2k", "+6.9%", "Good", "trending-up"], ["Active users", "12,408", "+3.1%", "Good", "trending-up"], ["Churn", "1.7%", "-0.6%", "Good", "trending-down"], ["Latency", "182 ms", "-8.4%", "Good", "trending-down"]].forEach(([l, v, d, Trend, ic], i) => {
  if (i) {
    const dot = tdot.createInstance();
    dot.name = "separator-" + i;
    ticker.appendChild(dot);
  }
  const it = inst(titem, { Trend }, { Label: l, Value: v, Delta: d, "Trend icon": IC[ic].id });
  it.name = "item-" + (i + 1);
  ticker.appendChild(it);
});
MS.appendChild(ticker);
await slotify(ticker, "Items");

// ======================================================= Carousel ====================================================
let carousel, compare, stack;
if (CUI) {
  const slide = await variants("Carousel slide", { Style: ["Text", "Image"] }, async ({ Style }) => {
    const img = Style === "Image";
    const b = box("carousel-slide", { component: true, gap: 8, pad: 32, w: 560, h: 220, radius: "surface", fill: img ? "bg/muted" : "bg/inverse", clip: true });
    const media = box("media", { dir: "row", align: "CENTER", cross: "CENTER" });
    if (img) media.appendChild(await ico("image", 32, "text/secondary", "image-icon"));
    add(b, media, { w: "fill", h: "fill" });
    add(b, await text("ARM64 runners", "Display/3", img ? "text/primary" : "text/on-primary", "title"), { w: "fill" });
    add(b, await text("Linux and macOS jobs can run on ARM64 machines in every plan.", "Paragraph/Medium Regular", img ? "text/secondary" : "text/placeholder", "description"), { w: "fill" });
    return b;
  }, { cols: 2 });
  wire(slide, [
    { layer: "title", kind: "TEXT", name: "Title" },
    { layer: "description", kind: "TEXT", name: "Description" },
  ]);
  const cdot = await variants("Carousel dot", { Active: ["Off", "On"] }, async ({ Active }) => {
    const on = Active === "On";
    return box("carousel-dot", { component: true, w: on ? 20 : 6, h: 6, radius: 999, fill: on ? "primary/default" : "text/placeholder" });
  }, { cols: 2 });
  carousel = await variants("Carousel", { Slide: ["Text", "Image"] }, async ({ Slide }) => {
    const b = box("carousel", { component: true, gap: 12, w: 560, cross: "CENTER" });
    add(b, inst(slide, { Style: Slide }), { w: "fill" });
    const dots = box("dots", { dir: "row", gap: 6, cross: "CENTER" });
    (Slide === "Text" ? ["Off", "On", "Off"] : ["On", "Off", "Off"]).forEach((Active, i) => {
      const d = inst(cdot, { Active });
      d.name = "dot-" + (i + 1);
      dots.appendChild(d);
    });
    b.appendChild(dots);
    return b;
  }, { cols: 2 });

  // ======================================================= Image compare, card stack ===================================
  const pane = await variants("Compare pane", { Side: ["Before", "After"] }, async ({ Side }) => {
    const before = Side === "Before";
    const b = box("compare-pane", { component: true, gap: 8, pad: 16, w: 220, h: 230, fill: before ? "bg/muted" : "feedback/info/subtle" });
    const top = box("top", { dir: "row", align: before ? "MIN" : "MAX" });
    const tag = inst(badge, { Tone: "Neutral" }, { Label: Side });
    tag.name = "tag";
    top.appendChild(tag);
    add(b, top, { w: "fill" });
    const media = box("media", { dir: "row", align: "CENTER", cross: "CENTER" });
    media.appendChild(await ico("image", 28, "text/secondary", "image-icon"));
    add(b, media, { w: "fill", h: "fill" });
    return b;
  }, { cols: 2 });
  compare = box("Image compare", { component: true, dir: "row", w: 440, h: 230, radius: "surface", clip: true });
  add(compare, inst(pane, { Side: "Before" }), { w: 220, h: "fill" });
  add(compare, box("divider", { fill: "bg/surface" }), { w: 2, h: "fill" });
  add(compare, inst(pane, { Side: "After" }), { w: "fill", h: "fill" });
  MS.appendChild(compare);
  {
    const handle = box("handle", { dir: "row", w: 32, h: 32, radius: 999, fill: "bg/surface", align: "CENTER", cross: "CENTER" });
    await handle.setEffectStyleIdAsync(ES["Elevation/md"].id);
    handle.appendChild(await ico("chevrons-left-right", 16, "text/primary", "handle-icon"));
    compare.appendChild(handle);
    handle.layoutPositioning = "ABSOLUTE";
    handle.x = 221 - 16;
    handle.y = (230 - 32) / 2;
  }
  const scard = box("Stack card", { component: true, gap: 8, pad: 24, w: 240, h: 200, radius: "surface", fill: "bg/muted", stroke: "border/default", clip: true });
  await scard.setEffectStyleIdAsync(ES["Elevation/md"].id);
  {
    const media = box("media", { dir: "row", align: "CENTER", cross: "CENTER" });
    media.appendChild(await ico("image", 32, "text/secondary", "image-icon"));
    add(scard, media, { w: "fill", h: "fill" });
    add(scard, await text("Kyoto", "Display/3", "text/primary", "title"), { w: "fill" });
    add(scard, await text("Swipe right to save", "Paragraph/Small Regular", "text/secondary", "description"), { w: "fill" });
  }
  MS.appendChild(scard);
  wire(scard, [
    { layer: "title", kind: "TEXT", name: "Title" },
    { layer: "description", kind: "TEXT", name: "Description" },
  ]);
  const peek = box("Stack peek", { component: true, w: 224, h: 10, radius: 12, fill: "bg/subtle", stroke: "border/default" });
  MS.appendChild(peek);
  stack = box("Card stack", { component: true, gap: 4, cross: "CENTER" });
  stack.appendChild(scard.createInstance());
  stack.children[0].name = "top-card";
  for (const [i, w] of [[1, 224], [2, 208]]) {
    const p = peek.createInstance();
    p.name = "behind-" + i;
    add(stack, p, { w, h: 10 });
  }
  MS.appendChild(stack);
}

// ======================================================= board cards ================================================
const c = await H.cursor();
const body = null;
const label = (s) => text(s, "Paragraph/Mini Regular", "text/secondary", "sub");

const k1 = await card(body, "Kanban board", "Columns, cards, drop slot, lifted card");
k1.card.appendChild(kboard.createInstance());
k1.card.appendChild(await label("Lifted card · column headers"));
k1.card.appendChild(row("states", [inst(kcard, { State: "Lifted" }, { Tag: true, Title: "Audit the color tokens for contrast", Comments: "3" }), ...Object.keys(KDOT).map((Tone) => inst(khead, { Tone }, { Name: Tone === "Neutral" ? "Backlog" : Tone === "Info" ? "In progress" : "Done" }))], 24, { cross: "MIN" }));
await burst(c, k1.wrap);

if (CUI) {
  const k2 = await card(body, "Week calendar", "Events snapped to 15 minutes, today circled");
  k2.card.appendChild(cal.createInstance());
  k2.card.appendChild(await label("Event tones"));
  k2.card.appendChild(row("events", Object.keys(CT).map((Tone) => inst(cevent, { Tone, Layout: "Block" }, { Title: Tone, Time: "10:00 – 11:00" })), 12, { cross: "MIN" }));
  await burst(c, k2.wrap);
}

if (CUI) {
  const k3 = await card(body, "Gantt chart", "Task list, timeline, dependencies, milestone");
  k3.card.appendChild(gchart.createInstance());
  k3.card.appendChild(await label("Bars"));
  const barRow = row("bars", [], 16);
  for (const [Tone, Progress, w] of [["Success", "Some", 180], ["Info", "Some", 180], ["Success", "None", 120], ["Info", "None", 120]]) {
    const b = inst(gbar, { Tone, Progress }, { Label: "Task" });
    add(barRow, b, { w, h: 24 });
  }
  k3.card.appendChild(barRow);
  await burst(c, k3.wrap);
}

if (CUI) {
  const k4 = await card(body, "Node editor", "Nodes, pins and curved links");
  k4.card.appendChild(nedit.createInstance());
  k4.card.appendChild(await label("Pin types · selected node"));
  k4.card.appendChild(row("pins", [inst(pinrow, { Side: "Input", Pin: "Color" }, { Label: "Color" }), inst(pinrow, { Side: "Input", Pin: "Float" }, { Label: "Float", Linked: false }), inst(pinrow, { Side: "Output", Pin: "Vector" }, { Label: "Vector" }), inst(gnode, { Kind: "Multiply", Selected: "On" })], 24, { cross: "MIN" }));
  await burst(c, k4.wrap);
}

const k5 = await card(body, "Chat", "Grouped bubbles, own messages, typing");
k5.card.appendChild(chat.createInstance());
await burst(c, k5.wrap);

const k6 = await card(body, "Comments", "Thread line, replies, likes");
k6.card.appendChild(comments.createInstance());
await burst(c, k6.wrap);

const k7 = await card(body, "Presence, counter and ticker", "Overlapping avatars · odometer value · scrolling KPIs");
k7.card.appendChild(row("presence-counter", [presence.createInstance(), counter.createInstance()], 40));
const tk = ticker.createInstance();
k7.card.appendChild(tk);
k7.card.appendChild(await label("Trend: good · bad"));
k7.card.appendChild(row("trends", [inst(titem, { Trend: "Good" }, { Label: "Builds", Value: "1,204", Delta: "+12.0%" }), inst(titem, { Trend: "Bad" }, { Label: "Errors", Value: "38", Delta: "+4.2%" })], 32));
await burst(c, k7.wrap);

if (CUI) {
  const k8 = await card(body, "Carousel", "Text slide · image slide");
  for (const Slide of ["Text", "Image"]) k8.card.appendChild(inst(carousel, { Slide }));
  await burst(c, k8.wrap);
}

if (CUI) {
  const k9 = await card(body, "Image compare and card stack", "Divider handle · stacked cards");
  k9.card.appendChild(row("media", [compare.createInstance(), stack.createInstance()], 64, { cross: "MIN" }));
  await burst(c, k9.wrap);
}
c.done();
return {
  kanbanCard: kcard.children.length, calendarEvent: cevent?.children.length, ganttBar: gbar?.children.length, graphNode: gnode?.children.length,
  pinRow: pinrow?.children.length, chatMessage: cmsg.children.length, comment: comment.children.length, commentActions: cActions.children.length, presenceAvatar: pav.children.length, cards: CUI ? 9 : 4,
};
