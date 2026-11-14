// CUI data display: Data table (Table header cell, Table row), Tree view (Tree item), List panel (List row),
// Accordion (Accordion item), Timeline (Timeline item) + Progress ring, Reorder list (Reorder row), Data grid
// (Grid row, Score bar) + Filter bar (Filter chip), Code block (Code line), JSON viewer (JSON row), Property
// inspector (Inspector group, Prop field, Vec field, Property row, Vector row, Switch row), Log console (Log line).
const NEW = [
  "Table header cell", "Table row", "Data table", "Tree item", "Tree view", "List row", "List panel", "Accordion item", "Accordion",
  "Timeline item", "Timeline", "Progress ring", "Reorder row", "Reorder list", "Score bar", "Grid row", "Data grid", "Filter chip",
  "Filter bar", "Code line", "Code block", "JSON row", "JSON viewer", "Inspector group", "Inspector divider", "Prop field", "Vec field",
  "Property row", "Vector row", "Switch row", "Property inspector", "Log line", "Log console",
];
for (const n of NEW) setNamed(n)?.remove();
const ICONS = [
  "file-text", "chevrons-up-down", "arrow-up", "arrow-down", "chevron-down", "chevron-up", "chevron-right", "folder", "folder-open", "file",
  "users", "filter", "x", "rocket", "message-square", "circle-alert", "grip-vertical", "search", "trash-2", "copy",
];
const IC = {};
for (const n of ICONS) IC[n] = await H.icon(n, ICON);
const MS = rootNamed(MASTERS);
const avatar = setNamed("Avatar");
const badge = setNamed("Badge");
const checkbox = setNamed("Checkbox");
const button = setNamed("Button");
const iconButton = setNamed("Icon button");
const input = setNamed("Input");
const segment = setNamed("Segment");
const switchSet = setNamed("Switch");
const copyBtn = setNamed("Copy button");

// ---- helpers --------------------------------------------------------------------------------------------------
// override props of a nested instance (found by layer name) inside an instance
function over(root, layer, props) {
  const n = root.findOne((x) => x.type === "INSTANCE" && x.name === layer);
  if (!n) throw new Error("no nested instance " + layer);
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
// text of a nested layer painted run by run with color tokens: segs = [[chars, token], ...]
function colorize(root, layer, segs) {
  const t = root.findOne((n) => n.type === "TEXT" && n.name === layer);
  if (!t) throw new Error("no text " + layer);
  t.characters = segs.map((s) => s[0]).join("");
  let at = 0;
  for (const [s, c] of segs) {
    if (s.length) t.setRangeFills(at, at + s.length, [solid(c)]);
    at += s.length;
  }
}
// fixed-width text cell, optionally aligned
function cell(parent, t, w, align) {
  parent.appendChild(t);
  t.textAutoResize = "HEIGHT";
  t.resize(w, t.height);
  t.layoutSizingHorizontal = "FIXED";
  if (align) t.textAlignHorizontal = align;
  return t;
}
// bottom border only
const bottomBorder = (f, color = "border/default") => {
  stroke(f, color);
  f.strokeTopWeight = f.strokeLeftWeight = f.strokeRightWeight = 0;
  f.strokeBottomWeight = 1;
};
const hline = () => box("divider", { fill: "border/default" });

// ---- Data table: header cells (Sort × Align), rows (State) -----------------------------------------------------
const hcell = await variants("Table header cell", { Sort: ["None", "Idle", "Asc", "Desc"], Align: ["Left", "Right"] }, async ({ Sort, Align }) => {
  const active = Sort === "Asc" || Sort === "Desc";
  const b = box("header-cell", { component: true, dir: "row", gap: 4, cross: "CENTER", align: Align === "Right" ? "MAX" : "MIN" });
  b.appendChild(await text("Label", "Paragraph/Small Medium", active ? "text/primary" : "text/secondary", "label"));
  const ic = { Idle: "chevrons-up-down", Asc: "arrow-up", Desc: "arrow-down" }[Sort];
  if (ic) b.appendChild(await ico(ic, 14, active ? "text/primary" : "text/placeholder", "sort"));
  return b;
}, { cols: 4 });
wire(hcell, [{ layer: "label", kind: "TEXT", name: "Label" }]);
const headerCell = (sort, align, label) => inst(hcell, { Sort: sort, Align: align }, { Label: label });

const trow = await variants("Table row", { State: ["Default", "Selected"] }, async ({ State }) => {
  const b = box("table-row", { component: true, w: 600 });
  const row = box("content", { dir: "row", gap: 12, pad: [10, 16], cross: "CENTER", fill: State === "Selected" ? "interaction/hover" : undefined });
  const nm = box("name-cell", { dir: "row", gap: 10, cross: "CENTER" });
  const av = inst(avatar, { Type: "Initials", Size: "sm" }, { Initials: "JB" });
  av.name = "avatar";
  nm.appendChild(av);
  add(nm, await text("Name", "Paragraph/Small Regular", "text/primary", "name"), { w: "fill" });
  add(row, nm, { w: "fill" });
  cell(row, await text("Role", "Paragraph/Small Regular", "text/primary", "role"), 120);
  const st = box("status-cell", { dir: "row" });
  const bd = inst(badge, { Tone: "Success" }, { Dot: true, Label: "Active" });
  bd.name = "status";
  st.appendChild(bd);
  add(row, st, { w: 110 });
  cell(row, await text("Amount", "Paragraph/Small Regular", "text/primary", "amount"), 100, "RIGHT");
  add(b, row, { w: "fill" });
  add(b, hline(), { w: "fill", h: 1 });
  return b;
}, { cols: 2 });
wire(trow, [
  { layer: "name", kind: "TEXT", name: "Name" },
  { layer: "role", kind: "TEXT", name: "Role" },
  { layer: "amount", kind: "TEXT", name: "Amount" },
  { layer: "divider", kind: "BOOLEAN", name: "Divider", def: true },
]);
const tableRow = (state, name, initials, role, tone, status, amount, divider = true) => {
  const r = inst(trow, { State: state }, { Name: name, Role: role, Amount: amount, Divider: divider });
  over(r, "avatar", { Initials: initials });
  over(r, "status", { Tone: tone, Dot: true, Label: status });
  return r;
};
const table = box("Data table", { component: true, w: 600, radius: "panel", stroke: "border/default", fill: "bg/surface", clip: true });
{
  const head = box("header", { dir: "row", gap: 12, pad: [10, 16], cross: "CENTER", fill: "bg/subtle" });
  add(head, headerCell("Asc", "Left", "Name"), { w: "fill" });
  add(head, headerCell("None", "Left", "Role"), { w: 120 });
  add(head, headerCell("None", "Left", "Status"), { w: 110 });
  add(head, headerCell("None", "Right", "Amount"), { w: 100 });
  add(table, head, { w: "fill" });
  add(table, tableRow("Default", "Jonas Berg", "JB", "Owner", "Success", "Active", "$12,384"), { w: "fill" });
  add(table, tableRow("Selected", "Priya Nair", "PN", "Admin", "Success", "Active", "$9,846"), { w: "fill" });
  add(table, tableRow("Default", "Aiko Tanaka", "AT", "Editor", "Warning", "Invited", "$1,962", false), { w: "fill" });
  // header bottom border (the rows carry their own)
  bottomBorder(head);
}
MS.appendChild(table);
await slotify(table, "Rows", { from: 1 });

let titem, tree, lrow, list;
if (CUI) {
  // ---- Tree view: Tree item (Kind × Selected), indentation by row wrapper -----------------------------------------
  titem = await variants("Tree item", { Kind: ["Open", "Closed", "Leaf"], Selected: ["Off", "On"] }, async ({ Kind, Selected }) => {
    const on = Selected === "On";
    const b = box("tree-item", { component: true, dir: "row", gap: 8, pad: [6, 10], w: 280, radius: "item", cross: "CENTER", fill: on ? "interaction/hover" : undefined });
    if (Kind === "Leaf") b.appendChild(box("chevron", { w: 18, h: 18 }));
    else b.appendChild(await ico(Kind === "Open" ? "chevron-down" : "chevron-right", 18, "text/secondary", "chevron"));
    const icon = { Open: "folder-open", Closed: "folder", Leaf: "file" }[Kind];
    b.appendChild(await ico(icon, 18, on ? "text/primary" : "text/secondary", "icon"));
    add(b, await text("Label", "Paragraph/Small Regular", "text/primary", "label"), { w: "fill" });
    return b;
  }, { cols: 2 });
  wire(titem, [{ layer: "label", kind: "TEXT", name: "Label" }]);
  tree = box("Tree view", { component: true, w: 300, gap: 2, pad: 8, radius: "panel", stroke: "border/default", fill: "bg/surface" });
  [["Open", "Off", "src", 0], ["Open", "Off", "widgets", 1], ["Leaf", "Off", "button.c", 2], ["Leaf", "On", "slider.c", 2], ["Closed", "Off", "assets", 1]].forEach(([kind, sel, label, lvl], i) => {
    const w = box("row-" + (i + 1), { dir: "row", pad: [0, 0, 0, 24 * lvl] });
    add(w, inst(titem, { Kind: kind, Selected: sel }, { Label: label }), { w: "fill" });
    add(tree, w, { w: "fill" });
  });
  MS.appendChild(tree);

  // ---- List panel: List row (State) ------------------------------------------------------------------------------
  lrow = await variants("List row", { State: ["Default", "Selected"] }, async ({ State }) => {
    const b = box("list-row", { component: true, dir: "row", gap: 16, pad: [12, 16], w: 360, radius: "item", cross: "CENTER", fill: State === "Selected" ? "interaction/hover" : undefined });
    const av = inst(avatar, { Type: "Initials", Size: "lg" }, { Initials: "JB" });
    av.name = "avatar";
    b.appendChild(av);
    const t = box("text", { gap: 2 });
    add(t, await text("Title", "Paragraph/Medium Medium", "text/primary", "title"), { w: "fill" });
    add(t, await text("Subtitle", "Paragraph/Small Regular", "text/secondary", "subtitle"), { w: "fill" });
    add(b, t, { w: "fill" });
    b.appendChild(await text("45m", "Paragraph/Small Regular", "text/secondary", "trailing"));
    return b;
  }, { cols: 2 });
  wire(lrow, [
    { layer: "title", kind: "TEXT", name: "Title" },
    { layer: "subtitle", kind: "TEXT", name: "Subtitle" },
    { layer: "trailing", kind: "TEXT", name: "Trailing" },
  ]);
  list = box("List panel", { component: true, w: 392, gap: 2, pad: 8, radius: "panel", stroke: "border/default", fill: "bg/surface" });
  {
    const a = inst(lrow, { State: "Default" }, { Title: "Design review", Subtitle: "Tomorrow at 10:00", Trailing: "45m" });
    over(a, "avatar", { Initials: "JB" });
    add(list, a, { w: "fill" });
    const b = inst(lrow, { State: "Selected" }, { Title: "Release 1.0", Subtitle: "Ship it", Trailing: "2h" });
    over(b, "avatar", { Initials: "PN" });
    add(list, b, { w: "fill" });
  }
  MS.appendChild(list);
}

// ---- Accordion: item (Open), divider boolean -------------------------------------------------------------------
const aitem = await variants("Accordion item", { Open: ["Off", "On"] }, async ({ Open }) => {
  const on = Open === "On";
  const b = box("accordion-item", { component: true, w: 472 });
  const head = box("header", { dir: "row", gap: 12, pad: [20, 0, on ? 8 : 20, 0], cross: "CENTER" });
  add(head, await text("Question", "Paragraph/Medium Regular", "text/primary", "title"), { w: "fill" });
  head.appendChild(await ico(on ? "chevron-up" : "chevron-down", 18, "text/secondary", "chevron"));
  add(b, head, { w: "fill" });
  const body = box("content", { pad: [0, 0, 20, 0] });
  add(body, await text("Answer text that opens below the title.", "Paragraph/Small Regular", "text/secondary", "answer"), { w: "fill" });
  add(b, body, { w: "fill" });
  body.visible = on;
  add(b, hline(), { w: "fill", h: 1 });
  return b;
}, { cols: 2 });
wire(aitem, [
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "answer", kind: "TEXT", name: "Answer" },
  { layer: "divider", kind: "BOOLEAN", name: "Divider", def: true },
]);
const accordion = box("Accordion", { component: true, w: 520, pad: [0, 24], radius: "panel", stroke: "border/default", fill: "bg/surface" });
add(accordion, inst(aitem, { Open: "On" }, { Title: "Is it dependency free?", Answer: "Yes. Plain C99, native windowing, embedded fonts." }), { w: "fill" });
add(accordion, inst(aitem, { Open: "Off" }, { Title: "Can I bring my own renderer?", Divider: false }), { w: "fill" });
MS.appendChild(accordion);
await slotify(accordion, "Items");

let tline, timeline, ring;
if (CUI) {
  // ---- Timeline: item (Tone), Progress ring (Value) ---------------------------------------------------------------
  const TL = { Success: ["rocket", "success"], Info: ["message-square", "info"], Danger: ["circle-alert", "error"] };
  tline = await variants("Timeline item", { Tone: Object.keys(TL) }, async ({ Tone }) => {
    const [ic, k] = TL[Tone];
    const b = box("timeline-item", { component: true, dir: "row", gap: 16, w: 380 });
    const rail = box("rail", { gap: 4, pad: [0, 0, 4, 0], cross: "CENTER" });
    const dot = box("marker", { dir: "row", w: 28, h: 28, radius: 999, align: "CENTER", cross: "CENTER", fill: `feedback/${k}/subtle`, stroke: `feedback/${k}/default` });
    dot.appendChild(await ico(ic, 14, `feedback/${k}/text`, "icon"));
    rail.appendChild(dot);
    add(rail, box("connector", { fill: "border/strong" }), { w: 1, h: "fill" });
    add(b, rail, { h: "fill" });
    const body = box("content", { gap: 2, pad: [0, 0, 12, 0] });
    const head = box("head", { dir: "row", gap: 12, cross: "CENTER" });
    add(head, await text("Title", "Paragraph/Medium Medium", "text/primary", "title"), { w: "fill" });
    head.appendChild(await text("2m ago", "Paragraph/Small Regular", "text/secondary", "time"));
    add(body, head, { w: "fill" });
    add(body, await text("Description", "Paragraph/Small Regular", "text/secondary", "description"), { w: "fill" });
    add(b, body, { w: "fill" });
    return b;
  }, { cols: 3 });
  wire(tline, [
    { layer: "title", kind: "TEXT", name: "Title" },
    { layer: "time", kind: "TEXT", name: "Time" },
    { layer: "description", kind: "BOOLEAN", name: "Description", def: true },
    { layer: "description", kind: "TEXT", name: "Description text" },
    { layer: "connector", kind: "BOOLEAN", name: "Connector", def: true },
  ]);
  timeline = box("Timeline", { component: true, w: 380 });
  add(timeline, inst(tline, { Tone: "Success" }, { Title: "Deployed to production", Time: "2m ago", "Description text": "Release 1.0.3 is live." }), { w: "fill" });
  add(timeline, inst(tline, { Tone: "Info" }, { Title: "Review requested", Time: "1h ago", Description: false }), { w: "fill" });
  add(timeline, inst(tline, { Tone: "Danger" }, { Title: "Build failed", Time: "3h ago", Description: false, Connector: false }), { w: "fill" });
  MS.appendChild(timeline);

  // ring = two ellipse arcs and a centered label stacked with a negative gap (no absolute positioning)
  const RING = 110;
  ring = await variants("Progress ring", { Value: ["25", "72", "100"] }, async ({ Value }) => {
    const b = box("progress-ring", { component: true, dir: "row", gap: -RING, cross: "CENTER" });
    const track = figma.createEllipse();
    track.name = "track";
    track.fills = [solid("interaction/active")];
    track.arcData = { startingAngle: 0, endingAngle: Math.PI * 2, innerRadius: 0.82 };
    add(b, track, { w: RING, h: RING });
    const arc = figma.createEllipse();
    arc.name = "arc";
    arc.fills = [solid("primary/default")];
    arc.arcData = { startingAngle: -Math.PI / 2, endingAngle: -Math.PI / 2 + (Math.PI * 2 * Number(Value)) / 100, innerRadius: 0.82 };
    add(b, arc, { w: RING, h: RING });
    const lab = box("labels", { align: "CENTER", cross: "CENTER" });
    lab.appendChild(await text(Value + "%", "Display/2", "text/primary", "value"));
    lab.appendChild(await text("Onboarding", "Paragraph/Mini Regular", "text/secondary", "caption"));
    add(b, lab, { w: RING });
    return b;
  }, { cols: 3 });
  wire(ring, [{ layer: "caption", kind: "TEXT", name: "Label" }]);
}

// ---- Reorder list: row (State) ---------------------------------------------------------------------------------
const rrow = await variants("Reorder row", { State: ["Default", "Dragging"] }, async ({ State }) => {
  const drag = State === "Dragging";
  const b = box("reorder-row", { component: true, dir: "row", gap: 12, pad: 12, w: 320, radius: "item", cross: "CENTER", fill: "bg/surface", stroke: drag ? "border/strong" : "border/default" });
  if (drag) await b.setEffectStyleIdAsync(ES["Elevation/md"].id);
  b.appendChild(await ico("grip-vertical", 18, "text/placeholder", "grip"));
  add(b, await text("Task", "Paragraph/Small Regular", "text/primary", "title"), { w: "fill" });
  return b;
}, { cols: 2 });
wire(rrow, [{ layer: "title", kind: "TEXT", name: "Title" }]);
const reorder = box("Reorder list", { component: true, w: 320, gap: 8 });
[["Default", "Write the release notes"], ["Dragging", "Review the open pull requests"], ["Default", "Update the changelog"], ["Default", "Tag the release"]].forEach(([s, t]) => add(reorder, inst(rrow, { State: s }, { Title: t }), { w: "fill" }));
MS.appendChild(reorder);
await slotify(reorder, "Rows");

// ---- Data grid: Score bar, Grid row (Selected), Filter chip, Filter bar ------------------------------------------
const SB = 120;
const sbar = await variants("Score bar", { Value: ["72", "84", "88", "97"] }, ({ Value }) => {
  const b = box("score-bar", { component: true, dir: "row", w: SB, h: 4, radius: 999, fill: "interaction/active", clip: true });
  add(b, box("bar", { fill: "primary/default", radius: 999 }), { w: Math.round((SB * Number(Value)) / 100), h: "fill" });
  return b;
}, { cols: 4 });
const grow = await variants("Grid row", { Selected: ["Off", "On"] }, async ({ Selected }) => {
  const on = Selected === "On";
  const b = box("grid-row", { component: true, w: 700 });
  const row = box("content", { dir: "row", gap: 12, pad: [10, 16], cross: "CENTER", fill: on ? "interaction/hover" : undefined });
  const ck = inst(checkbox, { Checked: on ? "On" : "Off" }, { Label: false });
  ck.name = "check";
  row.appendChild(ck);
  const nm = box("name-cell", { dir: "row", gap: 10, cross: "CENTER" });
  const av = inst(avatar, { Type: "Initials", Size: "sm" }, { Initials: "JB" });
  av.name = "avatar";
  nm.appendChild(av);
  add(nm, await text("Name", "Paragraph/Small Regular", "text/primary", "name"), { w: "fill" });
  add(row, nm, { w: "fill" });
  const tm = box("team-cell", { dir: "row" });
  const bd = inst(badge, { Tone: "Neutral" }, { Label: "Engine" });
  bd.name = "team";
  tm.appendChild(bd);
  add(row, tm, { w: 110 });
  cell(row, await text("0", "Paragraph/Small Regular", "text/primary", "commits"), 90, "RIGHT");
  const sc = box("score-cell", { dir: "row", gap: 12, align: "MAX", cross: "CENTER" });
  const bar = inst(sbar, { Value: "97" });
  bar.name = "bar";
  sc.appendChild(bar);
  cell(sc, await text("0", "Paragraph/Small Regular", "text/secondary", "score"), 36, "RIGHT");
  add(row, sc, { w: 190 });
  add(b, row, { w: "fill" });
  add(b, hline(), { w: "fill", h: 1 });
  return b;
}, { cols: 2 });
wire(grow, [
  { layer: "name", kind: "TEXT", name: "Name" },
  { layer: "commits", kind: "TEXT", name: "Commits" },
  { layer: "score", kind: "TEXT", name: "Score" },
  { layer: "divider", kind: "BOOLEAN", name: "Divider", def: true },
]);
const gridRow = (sel, name, initials, team, commits, bar, score, divider = true) => {
  const r = inst(grow, { Selected: sel }, { Name: name, Commits: commits, Score: score, Divider: divider });
  over(r, "avatar", { Initials: initials });
  over(r, "team", { Label: team });
  over(r, "bar", { Value: bar });
  return r;
};
const grid = box("Data grid", { component: true, w: 700, radius: "panel", stroke: "border/default", fill: "bg/surface", clip: true });
{
  const head = box("header", { dir: "row", gap: 12, pad: [10, 16], cross: "CENTER", fill: "bg/subtle" });
  head.appendChild(inst(checkbox, { Checked: "Mixed" }, { Label: false }));
  add(head, headerCell("Idle", "Left", "Name"), { w: "fill" });
  add(head, headerCell("Idle", "Left", "Team"), { w: 110 });
  add(head, headerCell("Desc", "Right", "Commits"), { w: 90 });
  add(head, headerCell("Idle", "Right", "Score"), { w: 190 });
  bottomBorder(head);
  add(grid, head, { w: "fill" });
  add(grid, gridRow("Off", "Jonas Berg", "JB", "Engine", "884", "97", "97.2"), { w: "fill" });
  add(grid, gridRow("On", "Lena Fischer", "LF", "Platform", "640", "88", "88.1"), { w: "fill" });
  add(grid, gridRow("On", "Sam Whitfield", "SW", "Engine", "597", "84", "84.0"), { w: "fill" });
  add(grid, gridRow("Off", "Daniel Mensah", "DM", "Platform", "431", "72", "71.9", false), { w: "fill" });
}
MS.appendChild(grid);
await slotify(grid, "Rows", { from: 1 });

const fchip = box("Filter chip", { component: true, dir: "row", gap: 6, pad: [0, 12], h: 32, radius: "chip", cross: "CENTER", fill: "bg/muted", stroke: "border/input" });
fchip.appendChild(await ico("users", 16, "text/secondary", "icon"));
fchip.appendChild(await text("Team", "Paragraph/Small Regular", "text/secondary", "field"));
fchip.appendChild(await text("is", "Paragraph/Small Regular", "text/secondary", "operator"));
fchip.appendChild(await text("2 selected", "Paragraph/Small Medium", "text/primary", "value"));
fchip.appendChild(await ico("x", 16, "text/primary", "close"));
MS.appendChild(fchip);
wire(fchip, [
  { layer: "field", kind: "TEXT", name: "Field" },
  { layer: "value", kind: "TEXT", name: "Value" },
]);
const fbar = box("Filter bar", { component: true, dir: "row", gap: 12, cross: "CENTER", w: 700 });
add(fbar, inst(input, { State: "Default", Value: "Placeholder" }, { "Left icon": true, Text: "Search" }), { w: 240 });
fbar.appendChild(fchip.createInstance());
fbar.appendChild(inst(button, { Type: "Ghost", Size: "md" }, { Label: "Filter", "Left icon": true, "Left icon swap": IC.filter.id, "Right icon": true, "Right icon swap": IC["chevron-down"].id }));
fbar.appendChild(inst(button, { Type: "Ghost", Size: "md" }, { Label: "Clear all" }));
MS.appendChild(fbar);
await slotify(fbar, "Filters", { from: 1, to: 2 });

let cline, codeBlock, jrow, jsonView;
if (CUI) {
  // ---- Code block: Code line (Highlight), syntax colors from feedback tokens ---------------------------------------
  const KW = "feedback/error/text";
  const TY = "feedback/success/text";
  const FN = "feedback/info/text";
  const ST = "feedback/success/text";
  const NU = "feedback/warning/text";
  const PU = "text/secondary";
  const PL = "text/primary";
  cline = await variants("Code line", { Highlight: ["Off", "On"] }, async ({ Highlight }) => {
    const b = box("code-line", { component: true, dir: "row", gap: 16, pad: [1, 16], w: 640, cross: "CENTER", fill: Highlight === "On" ? "interaction/hover" : undefined });
    cell(b, await text("1", "Paragraph/Small Regular", "text/placeholder", "number"), 24, "RIGHT");
    add(b, await text("code", "Paragraph/Small Regular", "text/primary", "code"), { w: "fill" });
    return b;
  }, { cols: 2 });
  wire(cline, [{ layer: "number", kind: "TEXT", name: "Number" }]);
  codeBlock = box("Code block", { component: true, w: 640, radius: "panel", stroke: "border/default", fill: "bg/subtle", clip: true });
  {
    const head = box("header", { dir: "row", gap: 10, pad: [10, 16], cross: "CENTER", fill: "bg/surface" });
    bottomBorder(head);
    head.appendChild(await ico("file-text", 16, "text/secondary", "file-icon"));
    add(head, await text("counter.c", "Paragraph/Small Regular", "text/secondary", "filename"), { w: "fill" });
    const lang = inst(badge, { Tone: "Neutral" }, { Label: "c" });
    lang.name = "language";
    head.appendChild(lang);
    const cp = inst(copyBtn, { State: "Idle" });
    cp.name = "copy";
    head.appendChild(cp);
    add(codeBlock, head, { w: "fill" });
    const body = box("body", { pad: [16, 0] });
    const L = [
      [[["#include", KW], [" <", PU], ["cui/cui.h", PL], [">", PU]]],
      [[[" ", PL]]],
      [[["/* A counter with a button */", PU]]],
      [[["static", KW], [" ", PL], ["int", TY], [" clicks = ", PL], ["0", NU], [";", PU]]],
      [[[" ", PL]]],
      [[["void", TY], [" ", PL], ["frame", FN], ["(cui_ctx *ui) {", PL]]],
      [[["    ", PL], ["if", KW], [" (", PU], ["cui_button", FN], ["(ui, ", PL], ["\"Click me\"", ST], [", .variant = ", PL], ["CUI_BUTTON_PRIMARY", TY], [")) clicks++;", PL]], true],
      [[["    ", PL], ["cui_textf", FN], ["(ui, ", PL], ["\"Clicked %d times\"", ST], [", clicks);", PL]]],
      [[["}", PL]]],
    ];
    L.forEach(([segs, hl], i) => {
      const l = inst(cline, { Highlight: hl ? "On" : "Off" }, { Number: String(i + 1) });
      colorize(l, "code", segs);
      add(body, l, { w: "fill" });
    });
    add(codeBlock, body, { w: "fill" });
  }
  MS.appendChild(codeBlock);

  // ---- JSON viewer: JSON row (Kind), indentation by row wrapper -----------------------------------------------------
  jrow = await variants("JSON row", { Kind: ["Expanded", "Collapsed", "Leaf"] }, async ({ Kind }) => {
    const b = box("json-row", { component: true, dir: "row", gap: 6, pad: [2, 0], w: 480, cross: "CENTER" });
    if (Kind === "Leaf") b.appendChild(box("chevron", { w: 16, h: 16 }));
    else b.appendChild(await ico(Kind === "Expanded" ? "chevron-down" : "chevron-right", 16, "text/secondary", "chevron"));
    add(b, await text("code", "Paragraph/Small Regular", "text/primary", "code"), { w: "fill" });
    return b;
  }, { cols: 3 });
  jsonView = box("JSON viewer", { component: true, w: 520, pad: 16, radius: "panel", stroke: "border/default", fill: "bg/subtle" });
  {
    const key = (k) => [`"${k}"`, FN];
    const rows = [
      ["Expanded", 0, [["{", PL]]],
      ["Leaf", 1, [key("name"), [": ", PU], ["\"cui\"", ST], [",", PU]]],
      ["Leaf", 1, [key("version"), [": ", PU], ["\"1.1.0\"", ST], [",", PU]]],
      ["Leaf", 1, [key("private"), [": ", PU], ["false", NU], [",", PU]]],
      ["Leaf", 1, [key("downloads"), [": ", PU], ["128400", NU], [",", PU]]],
      ["Collapsed", 1, [key("platforms"), [": [ 3 items ],", PU]]],
      ["Collapsed", 1, [key("renderer"), [": { 4 keys },", PU]]],
      ["Collapsed", 1, [key("authors"), [": [ 2 items ]", PU]]],
      ["Leaf", 0, [["}", PL]]],
    ];
    rows.forEach(([kind, lvl, segs], i) => {
      const w = box("line-" + (i + 1), { dir: "row", pad: [0, 0, 0, 16 * lvl] });
      const r = inst(jrow, { Kind: kind });
      colorize(r, "code", segs);
      add(w, r, { w: "fill" });
      add(jsonView, w, { w: "fill" });
    });
  }
  MS.appendChild(jsonView);
}

// ---- Property inspector -------------------------------------------------------------------------------------------
const AXIS = { X: "feedback/error/text", Y: "feedback/success/text", Z: "feedback/info/text" };
const vec = await variants("Vec field", { Axis: Object.keys(AXIS) }, async ({ Axis }) => {
  const b = box("vec-field", { component: true, dir: "row", gap: 8, pad: [8, 12], w: 100, radius: "input", cross: "CENTER", stroke: "border/input", fill: "bg/surface" });
  b.minHeight = CTRL;
  b.strokesIncludedInLayout = false;
  b.appendChild(await text(Axis, "Paragraph/Small Regular", AXIS[Axis], "axis"));
  const v = await text("0.00", "Paragraph/Small Regular", "text/primary", "value");
  add(b, v, { w: "fill" });
  v.textAlignHorizontal = "RIGHT";
  return b;
}, { cols: 3 });
wire(vec, [{ layer: "value", kind: "TEXT", name: "Value" }]);

const pfield = await variants("Prop field", { Kind: ["Text", "Select", "Color", "Number"] }, async ({ Kind }) => {
  const b = box("prop-field", { component: true, w: 230, pad: [8, 12], radius: "input", stroke: "border/input", fill: "bg/surface", align: "CENTER" });
  b.minHeight = CTRL;
  b.strokesIncludedInLayout = false;
  const row = box("row", { dir: "row", gap: 8, cross: "CENTER" });
  if (Kind === "Color") row.appendChild(box("swatch", { w: 20, h: 20, radius: 999, fill: "feedback/warning/default", stroke: "border/default" }));
  const v = await text(Kind === "Color" ? "#C26A3D" : "Value", "Paragraph/Small Regular", "text/primary", "value");
  add(row, v, { w: "fill" });
  if (Kind === "Number") {
    v.textAlignHorizontal = "RIGHT";
    const sfx = await text("nits", "Paragraph/Small Regular", "text/secondary", "suffix");
    sfx.visible = false;
    row.appendChild(sfx);
  }
  if (Kind === "Select") row.appendChild(await ico("chevrons-up-down", 16, "text/secondary", "chevron"));
  add(b, row, { w: "fill" });
  if (Kind === "Number") {
    const rng = box("range", { dir: "row", fill: "interaction/active", radius: 999 });
    add(rng, box("range-fill", { fill: "text/secondary", radius: 999 }), { w: 96, h: "fill" });
    add(b, rng, { w: "fill", h: 2 });
    rng.visible = false;
  }
  return b;
}, { cols: 4 });
wire(pfield, [
  { layer: "value", kind: "TEXT", name: "Value" },
  { layer: "suffix", kind: "BOOLEAN", name: "Suffix", def: false },
  { layer: "suffix", kind: "TEXT", name: "Suffix text" },
  { layer: "range", kind: "BOOLEAN", name: "Range", def: false },
]);

// rows: label column + editor(s)
const LABEL_W = 150;
async function rowLabel(row) {
  cell(row, await text("Label", "Paragraph/Small Regular", "text/secondary", "label"), LABEL_W);
}
const prow = box("Property row", { component: true, dir: "row", gap: 12, pad: [4, 0], w: 420, cross: "CENTER" });
await rowLabel(prow);
{
  const e = inst(pfield, { Kind: "Text" });
  e.name = "editor";
  add(prow, e, { w: "fill" });
}
MS.appendChild(prow);
wire(prow, [{ layer: "label", kind: "TEXT", name: "Label" }]);
const vrow = box("Vector row", { component: true, dir: "row", gap: 8, pad: [4, 0], w: 420, cross: "CENTER" });
await rowLabel(vrow);
for (const a of Object.keys(AXIS)) {
  const e = inst(vec, { Axis: a });
  e.name = a.toLowerCase();
  add(vrow, e, { w: "fill" });
}
MS.appendChild(vrow);
wire(vrow, [{ layer: "label", kind: "TEXT", name: "Label" }]);
const srow = box("Switch row", { component: true, dir: "row", gap: 12, pad: [4, 0], w: 420, cross: "CENTER" });
await rowLabel(srow);
{
  const sw = inst(switchSet, { Checked: "Off" }, { Label: false });
  sw.name = "switch";
  srow.appendChild(sw);
}
MS.appendChild(srow);
wire(srow, [{ layer: "label", kind: "TEXT", name: "Label" }]);

const igroup = await variants("Inspector group", { Open: ["Off", "On"] }, async ({ Open }) => {
  const b = box("inspector-group", { component: true, dir: "row", gap: 8, pad: [10, 0], w: 420, cross: "CENTER" });
  b.appendChild(await ico(Open === "On" ? "chevron-down" : "chevron-right", 18, "text/secondary", "chevron"));
  add(b, await text("Group", "Paragraph/Small Medium", "text/primary", "title"), { w: "fill" });
  return b;
}, { cols: 2 });
wire(igroup, [{ layer: "title", kind: "TEXT", name: "Title" }]);
const idiv = box("Inspector divider", { component: true, w: 420, pad: [8, 0] });
add(idiv, box("line", { fill: "border/default" }), { w: "fill", h: 1 });
MS.appendChild(idiv);

const inspector = box("Property inspector", { component: true, w: 460, pad: [12, 20], gap: 2, radius: "surface", stroke: "border/default", fill: "bg/surface" });
{
  const group = (open, title) => add(inspector, inst(igroup, { Open: open ? "On" : "Off" }, { Title: title }), { w: "fill" });
  const vector = (label, x, y, z) => {
    const r = inst(vrow, {}, { Label: label });
    over(r, "x", { Value: x });
    over(r, "y", { Value: y });
    over(r, "z", { Value: z });
    add(inspector, r, { w: "fill" });
  };
  const prop = (label, kind, value, extra = {}) => {
    const r = inst(prow, {}, { Label: label });
    over(r, "editor", { Kind: kind, Value: value, ...extra });
    add(inspector, r, { w: "fill" });
  };
  group(true, "Transform");
  vector("Position", "12.50", "0.00", "-4.25");
  vector("Rotation", "0", "45", "0");
  vector("Scale", "1.00", "1.00", "1.00");
  add(inspector, idiv.createInstance(), { w: "fill" });
  group(true, "Material");
  prop("Name", "Text", "crate_large_02");
  prop("Shader", "Select", "Standard PBR");
  prop("Base color", "Color", "#C26A3D");
  prop("Roughness", "Number", "0.42", { Range: true });
  prop("Metallic", "Number", "0.00", { Range: true });
  prop("Emission", "Number", "1.6", { Suffix: true });
  add(inspector, inst(srow, {}, { Label: "Double sided" }), { w: "fill" });
  add(inspector, idiv.createInstance(), { w: "fill" });
  group(false, "Shadows");
}
MS.appendChild(inspector);
await slotify(inspector, "Properties");

let lline, console_;
if (CUI) {
  // ---- Log console: Log line (Level), toolbar -----------------------------------------------------------------------
  const LV = {
    Trace: { fg: "text/secondary", msg: "text/secondary" },
    Debug: { fg: "text/secondary", msg: "text/secondary" },
    Info: { fg: "feedback/info/text", msg: "text/primary" },
    Warn: { fg: "feedback/warning/text", msg: "feedback/warning/text", fill: "feedback/warning/subtle" },
    Error: { fg: "feedback/error/text", msg: "feedback/error/text", fill: "feedback/error/subtle" },
  };
  lline = await variants("Log line", { Level: Object.keys(LV) }, async ({ Level }) => {
    const l = LV[Level];
    const b = box("log-line", { component: true, dir: "row", gap: 12, pad: [3, 16], w: 760, cross: "CENTER", fill: l.fill });
    cell(b, await text("14:02:10.154", "Paragraph/Small Regular", "text/secondary", "time"), 92);
    cell(b, await text(Level.toLowerCase(), "Paragraph/Small Regular", l.fg, "level"), 44);
    add(b, await text("Message", "Paragraph/Small Regular", l.msg, "message"), { w: "fill" });
    return b;
  }, { cols: 5 });
  wire(lline, [
    { layer: "time", kind: "TEXT", name: "Time" },
    { layer: "message", kind: "TEXT", name: "Message" },
  ]);
  console_ = box("Log console", { component: true, w: 760, gap: 8 });
  {
    const bar = box("toolbar", { dir: "row", gap: 12, cross: "CENTER" });
    const levels = box("levels", { dir: "row", gap: 2, pad: 2, radius: 10, fill: "bg/muted" });
    ["Trace", "Debug", "Info", "Warn 3", "Error 1"].forEach((l) => levels.appendChild(inst(segment, { Selected: "On" }, { Label: l })));
    bar.appendChild(levels);
    add(bar, inst(input, { State: "Default", Value: "Placeholder" }, { "Left icon": true, Text: "Filter lines" }), { w: "fill" });
    bar.appendChild(inst(button, { Type: "Outline", Size: "md" }, { Label: "Follow", "Left icon": true, "Left icon swap": IC["arrow-down"].id }));
    bar.appendChild(inst(iconButton, { Type: "Ghost", Size: "md" }, { Icon: IC.copy.id }));
    bar.appendChild(inst(iconButton, { Type: "Ghost", Size: "md" }, { Icon: IC["trash-2"].id }));
    add(console_, bar, { w: "fill" });
    const lines = box("lines", { radius: "panel", stroke: "border/default", fill: "bg/subtle", clip: true });
    const LOG = [
      ["Info", "14:02:10.154", "Shaders compiled in 2.41 s"],
      ["Trace", "14:02:10.454", "gpu: uploaded 37 textures, 148.2 MB resident"],
      ["Info", "14:02:11.032", "Baking navmesh for 3 regions"],
      ["Debug", "14:02:11.888", "navmesh: harbor 18,204 polys, market 9,377 polys"],
      ["Warn", "14:02:12.839", "Texture props/barrel_d.png is 4096x4096; streaming budget is 2048"],
      ["Info", "14:02:12.983", "Lightmaps: 12 of 12 atlases up to date"],
      ["Error", "14:02:13.405", "Missing material 'dock_planks_wet' on mesh pier_03.obj (using fallback)"],
      ["Debug", "14:02:13.922", "audio: 96 voices, 48 kHz, latency 10.7 ms"],
      ["Info", "14:02:14.717", "Entering play mode"],
      ["Warn", "14:02:16.234", "Physics step took 21.4 ms (budget 16.6 ms) after the crane collision"],
    ];
    LOG.forEach(([lv, time, msg]) => add(lines, inst(lline, { Level: lv }, { Time: time, Message: msg }), { w: "fill" }));
    add(console_, lines, { w: "fill" });
  }
  MS.appendChild(console_);
}

// ---- board cards ----------------------------------------------------------------------------------------------------
const c = await H.cursor();

const k1 = await card(null, "Table", "Sortable header · selected row · cells hold components");
k1.card.appendChild(table.createInstance());
await burst(c, k1.wrap);

if (CUI) {
  const k2 = await card(null, "List and tree", "Tree view · list rows");
  const d2 = box("demo", { dir: "row", gap: 32 });
  d2.appendChild(tree.createInstance());
  d2.appendChild(list.createInstance());
  k2.card.appendChild(d2);
  await burst(c, k2.wrap);
}

const k3 = await card(null, "Accordion", "Open · closed");
k3.card.appendChild(accordion.createInstance());
await burst(c, k3.wrap);

if (CUI) {
  const k4 = await card(null, "Timeline and progress ring", "Tones · ring values", { gap: 24 });
  const d4 = box("demo", { dir: "row", gap: 64, cross: "CENTER" });
  d4.appendChild(timeline.createInstance());
  d4.appendChild(inst(ring, { Value: "72" }));
  k4.card.appendChild(d4);
  const r4 = box("rings", { dir: "row", gap: 24, cross: "CENTER" });
  for (const Value of ["25", "100"]) r4.appendChild(inst(ring, { Value }));
  k4.card.appendChild(r4);
  await burst(c, k4.wrap);
}

const k5 = await card(null, "Reorderable list", "Row being dragged lifts with a shadow");
k5.card.appendChild(reorder.createInstance());
await burst(c, k5.wrap);

const k6 = await card(null, "Data grid and filter bar", "Filter chips · sortable header · selected rows", { gap: 16 });
k6.card.appendChild(fbar.createInstance());
k6.card.appendChild(grid.createInstance());
await burst(c, k6.wrap);

if (CUI) {
  const k7 = await card(null, "Code block", "Highlighted syntax · highlighted line");
  k7.card.appendChild(codeBlock.createInstance());
  await burst(c, k7.wrap);
}

if (CUI) {
  const k8 = await card(null, "JSON viewer", "Typed colors · collapsed nodes");
  k8.card.appendChild(jsonView.createInstance());
  await burst(c, k8.wrap);
}

const k9 = await card(null, "Property inspector", "Folding groups · editor per type");
k9.card.appendChild(inspector.createInstance());
await burst(c, k9.wrap);

if (CUI) {
  const k10 = await card(null, "Log console", "Level filters · search · follow · tinted rows");
  k10.card.appendChild(console_.createInstance());
  await burst(c, k10.wrap);
}
c.done();
return {
  headerCell: hcell.children.length, tableRow: trow.children.length, treeItem: titem?.children.length, listRow: lrow?.children.length,
  accordionItem: aitem.children.length, timelineItem: tline?.children.length, ring: ring?.children.length, reorderRow: rrow.children.length,
  scoreBar: sbar.children.length, gridRow: grow.children.length, codeLine: cline?.children.length, jsonRow: jrow?.children.length,
  vec: vec.children.length, propField: pfield.children.length, inspectorGroup: igroup.children.length, logLine: lline?.children.length, cards: CUI ? 10 : 5,
};
