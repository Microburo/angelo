// CUI AI interfaces: Task status, Reasoning, Tool payload, Tool call, Plan step, Agent plan, Agent status, Source mark,
// Citation, Source card, Source hover card, Attachment chip, Model picker, Model option, Model menu, Composer,
// Prompt suggestion, Response actions, Context meter, Voice orb, one board card per catalog page.
const NEW = !CUI ? ["Task status", "Plan step", "Agent plan", "Agent status", "Attachment chip", "Model picker", "Model option", "Model menu", "Composer toolbar", "Composer"] : [
  "Task status", "Reasoning", "Tool payload", "Tool call", "Plan step", "Agent plan", "Agent status", "Source mark", "Citation",
  "Source card", "Source hover card", "Attachment chip", "Model picker", "Model option", "Model menu", "Composer toolbar", "Composer",
  "Prompt suggestion", "Response actions", "Context meter", "Voice orb",
];
for (const n of NEW) setNamed(n)?.remove();
const ICONS = !CUI ? ["check", "x", "ellipsis", "chevron-down", "chevron-up", "file-text", "layers", "zap", "box", "plus", "arrow-up", "square"] : [
  "check", "x", "ellipsis", "chevron-down", "chevron-up", "globe", "file-text", "terminal", "layers", "zap", "box", "plus", "arrow-up", "square",
  "code-xml", "chart-bar", "pencil", "bug", "copy", "refresh-cw", "thumbs-up", "thumbs-down", "share-2",
];
const IC = {};
for (const n of ICONS) IC[n] = await H.icon(n, ICON);
const pick = (...n) => n.map((k) => IC[k]);
const button = setNamed("Button");
const iconButton = setNamed("Icon button");
const badge = setNamed("Badge");
const MS = rootNamed(MASTERS);
const row = (name, kids, gap = 16, cross = "CENTER") => {
  const r = box(name, { dir: "row", gap, cross });
  for (const k of kids) r.appendChild(k);
  return r;
};

// ring: auto-layout circle whose inside stroke is the track; an arc donut child fills it (single flow child)
function ring(name, size, thick, track, arc, frac, component) {
  const f = box(name, { component, dir: "row", w: size, h: size, radius: 999, stroke: track, sw: thick, align: "CENTER", cross: "CENTER" });
  if (arc) {
    const e = figma.createEllipse();
    e.name = "arc";
    e.fills = [solid(arc)];
    e.strokes = [];
    const r = size / 2;
    e.arcData = { startingAngle: -Math.PI / 2, endingAngle: -Math.PI / 2 + 2 * Math.PI * frac, innerRadius: (r - thick) / r };
    add(f, e, { w: "fill", h: "fill" });
  }
  return f;
}

// v1 (green dots): Agent plan and status, Composer and model picker; the rest is cui only
let reasoning, toolCall, citation, scard, hcard, sug, actions, meter, ORB, orb;
// ---- Task status: ring (pending), arc spinner (running), check disc (done), cross disc (error) ------------------
const taskStatus = await variants("Task status", { Status: ["Pending", "Running", "Done", "Error"] }, async ({ Status }) => {
  if (Status === "Pending") return ring("task-status", 18, 2, "border/input", null, 0, true);
  if (Status === "Running") return ring("task-status", 18, 2, "border/strong", "text/primary", 0.25, true);
  const done = Status === "Done";
  const b = box("task-status", { component: true, dir: "row", w: 18, h: 18, radius: 999, fill: done ? "feedback/success/default" : "feedback/error/default", align: "CENTER", cross: "CENTER" });
  b.appendChild(await ico(done ? "check" : "x", 12, "text/on-primary", done ? "check" : "cross"));
  return b;
}, { cols: 4 });
const tstatus = (Status) => {
  const i = inst(taskStatus, { Status });
  i.name = "status";
  return i;
};

if (CUI) {
// ---- Reasoning: header with chevron, folded or open with the thoughts behind a left rule -----------------------------
reasoning = await variants("Reasoning", { Open: ["Off", "On"] }, async ({ Open }) => {
  const on = Open === "On";
  const b = box("reasoning", { component: true, gap: 12, w: 520 });
  const head = box("header", { dir: "row", gap: 8, cross: "CENTER" });
  head.appendChild(await text("Thought for 8s", "Paragraph/Small Regular", "text/secondary", "title"));
  head.appendChild(await ico(on ? "chevron-up" : "chevron-down", 16, "text/secondary", "chevron"));
  b.appendChild(head);
  if (on) {
    const body = box("body", { dir: "row", gap: 16 });
    add(body, box("rule", { fill: "border/default" }), { w: 2, h: "fill" });
    const col = box("thoughts", { gap: 12 });
    add(col, await text("The question is about perceived speed: how little work a frame does, and how fast input reaches the screen.", "Paragraph/Small Regular", "text/secondary", "thought-1"), { w: "fill" });
    add(col, await text("Look for sources on retained and immediate mode, text rendering and motion.", "Paragraph/Small Regular", "text/secondary", "thought-2"), { w: "fill" });
    add(body, col, { w: "fill" });
    add(b, body, { w: "fill" });
  }
  return b;
}, { cols: 2 });
wire(reasoning, [
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "thought-1", kind: "TEXT", name: "Thoughts" },
]);

// ---- Tool payload: label over a code box, JSON tinted by token colors ---------------------------------------------------
async function json(chars, name) {
  const t = await text(chars, "Paragraph/Small Regular", "text/primary", name);
  const paint = (re, tok) => {
    for (const m of chars.matchAll(re)) t.setRangeFills(m.index, m.index + m[0].length, [solid(tok)]);
  };
  paint(/"[^"]*"/g, "feedback/success/text");
  paint(/"[^"]*"(?=:)/g, "feedback/info/text");
  paint(/(?<=: )\d+/g, "feedback/warning/text");
  return t;
}
const payload = box("Tool payload", { component: true, gap: 8, w: 472 });
payload.appendChild(await text("Input", "Paragraph/Small Regular", "text/secondary", "label"));
const codeBox = box("code-box", { pad: [14, 16], radius: "panel", fill: "bg/subtle", stroke: "border/default" });
add(codeBox, await json('{"query": "immediate mode gui performance", "limit": 5}', "code"), { w: "fill" });
add(payload, codeBox, { w: "fill" });
MS.appendChild(payload);
wire(payload, [
  { layer: "label", kind: "TEXT", name: "Label" },
  { layer: "code", kind: "TEXT", name: "Code" },
]);

// ---- Tool call: icon, name, detail, time, status; opens onto input and output --------------------------------------------
const TC = [
  { Status: "Done", Open: "Off" },
  { Status: "Done", Open: "On" },
  { Status: "Running", Open: "Off" },
  { Status: "Error", Open: "Off" },
];
toolCall = await variants("Tool call", TC, async ({ Status, Open }) => {
  const b = box("tool-call", { component: true, gap: 12, pad: [14, 16], w: 520, radius: "panel", fill: "bg/surface", stroke: Status === "Error" ? "feedback/error/default" : "border/default" });
  const head = box("header", { dir: "row", gap: 12, cross: "CENTER" });
  head.appendChild(await ico("globe", 18, "text/secondary", "icon"));
  head.appendChild(await text("web_search", "Paragraph/Small Medium", "text/primary", "name"));
  add(head, await text("immediate mode gui performance", "Paragraph/Small Regular", "text/secondary", "detail"), { w: "fill" });
  head.appendChild(await text("1.4s", "Paragraph/Small Regular", "text/secondary", "time"));
  head.appendChild(tstatus(Status));
  if (Status === "Done") head.appendChild(await ico(Open === "On" ? "chevron-up" : "chevron-down", 16, "text/secondary", "chevron"));
  add(b, head, { w: "fill" });
  if (Open === "On") {
    const d = box("details", { gap: 12 });
    const i = payload.createInstance();
    i.name = "input";
    add(d, i, { w: "fill" });
    const o = payload.createInstance();
    o.name = "output";
    o.setProperties({ [Object.keys(o.componentProperties).find((k) => k.startsWith("Label"))]: "Output", [Object.keys(o.componentProperties).find((k) => k.startsWith("Code"))]: '{"results": [{"title": "Immediate mode GUIs", "count": 5}]}' });
    add(d, o, { w: "fill" });
    add(b, d, { w: "fill" });
  }
  return b;
}, { cols: 2 });
wire(toolCall, [
  { layer: "icon", kind: "SWAP", name: "Icon", def: IC.globe.id, pref: pick("globe", "file-text", "terminal") },
  { layer: "name", kind: "TEXT", name: "Tool name" },
  { layer: "detail", kind: "TEXT", name: "Detail" },
  { layer: "time", kind: "TEXT", name: "Time" },
]);

}
// ---- Plan step: status icon on a rail, title and detail ------------------------------------------------------------------
const planStep = await variants("Plan step", { Status: ["Done", "Error", "Running", "Pending"] }, async ({ Status }) => {
  const reached = Status === "Done" || Status === "Error";
  const b = box("plan-step", { component: true, dir: "row", gap: 16, pad: [0, 0, 16, 0], w: 340 });
  const rail = box("rail", { gap: 4, cross: "CENTER", pad: [0, 0, 4, 0] });
  rail.appendChild(tstatus(Status));
  add(rail, box("line", { fill: reached ? "feedback/success/default" : "border/strong" }), { w: 2, h: "fill" });
  add(b, rail, { h: "fill" });
  const t = box("text", { gap: 2 });
  add(t, await text("Search for sources", "Paragraph/Medium Regular", reached ? "text/primary" : "text/secondary", "title"), { w: "fill" });
  add(t, await text("3 results", "Paragraph/Small Regular", Status === "Error" ? "feedback/error/text" : "text/secondary", "detail"), { w: "fill" });
  add(b, t, { w: "fill" });
  return b;
}, { cols: 4 });
wire(planStep, [
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "detail", kind: "BOOLEAN", name: "Detail", def: true },
  { layer: "detail", kind: "TEXT", name: "Detail text" },
  { layer: "line", kind: "BOOLEAN", name: "Rail", def: true },
]);
const step = (Status, title, detail, last) => {
  const i = inst(planStep, { Status }, { Title: title, "Detail text": detail || "-", Detail: !!detail, Rail: !last });
  i.name = "step-" + title.split(" ")[0].toLowerCase();
  return i;
};

// ---- Agent plan: header (title, count, bar) over the steps --------------------------------------------------------------
const plan = box("Agent plan", { component: true, gap: 20, pad: 24, w: 420, radius: "surface", fill: "bg/surface", stroke: "border/default" });
const ph = box("header", { dir: "row", gap: 12, cross: "CENTER" });
add(ph, await text("Research plan", "Paragraph/Medium Medium", "text/primary", "title"), { w: "fill" });
ph.appendChild(await text("1 of 5", "Paragraph/Small Regular", "text/secondary", "count"));
const bar = box("bar", { dir: "row", w: 64, h: 6, radius: 999, fill: "interaction/active", clip: true });
add(bar, box("fill", { fill: "text/primary" }), { w: 14, h: "fill" });
ph.appendChild(bar);
add(plan, ph, { w: "fill" });
const steps = box("steps", {});
add(steps, step("Done", "Search for sources", "3 results"), { w: "fill" });
add(steps, step("Error", "Open the sources", "One link timed out"), { w: "fill" });
add(steps, step("Running", "Read the attached report", "Page 12 of 40"), { w: "fill" });
add(steps, step("Pending", "Compare the numbers with last quarter"), { w: "fill" });
add(steps, step("Pending", "Draft the summary", null, true), { w: "fill" });
add(plan, steps, { w: "fill" });
MS.appendChild(plan);
await slotify(plan, "Steps", { frame: "steps" });
wire(plan, [
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "count", kind: "TEXT", name: "Count" },
]);

// ---- Agent status: pill with loader dots, check or cross -----------------------------------------------------------------
const astatus = await variants("Agent status", { Status: ["Running", "Done", "Error"] }, async ({ Status }) => {
  const b = box("agent-status", { component: true, dir: "row", gap: 10, pad: [8, 16], radius: 999, cross: "CENTER", fill: "bg/subtle", stroke: "border/default" });
  if (Status === "Running") b.appendChild(await ico("ellipsis", 18, "text/primary", "status"));
  else b.appendChild(tstatus(Status));
  b.appendChild(await text("Reading quarterly-report.pdf", "Paragraph/Small Regular", Status === "Error" ? "feedback/error/text" : "text/secondary", "label"));
  if (Status !== "Error") b.appendChild(await text("14s", "Paragraph/Small Regular", "text/secondary", "time"));
  return b;
}, { cols: 3 });
wire(astatus, [
  { layer: "label", kind: "TEXT", name: "Label" },
  { layer: "time", kind: "TEXT", name: "Time" },
]);

if (CUI) {
// ---- Source mark (colored initial), Citation chip, Source card, Source hover card ------------------------------------------
const MARK = { Amber: "warning", Green: "success", Rose: "error" };
const mark = await variants("Source mark", { Tone: Object.keys(MARK) }, async ({ Tone }) => {
  const k = MARK[Tone];
  const b = box("source-mark", { component: true, dir: "row", w: 20, h: 20, radius: 6, align: "CENTER", cross: "CENTER", fill: `feedback/${k}/subtle` });
  b.appendChild(await text("F", "Paragraph/Mini Medium", `feedback/${k}/text`, "letter"));
  return b;
}, { cols: 3 });
wire(mark, [{ layer: "letter", kind: "TEXT", name: "Letter" }]);
const markOf = (Tone, Letter) => {
  const i = inst(mark, { Tone }, { Letter });
  i.name = "mark";
  return i;
};

citation = await variants("Citation", { Active: ["Off", "On"] }, async ({ Active }) => {
  const b = box("citation", { component: true, dir: "row", pad: [4, 12], radius: 999, cross: "CENTER", fill: Active === "On" ? "interaction/active" : "bg/muted" });
  b.appendChild(await text("fieldnotes.dev", "Paragraph/Small Medium", "text/primary", "label"));
  return b;
}, { cols: 2 });
wire(citation, [{ layer: "label", kind: "TEXT", name: "Label" }]);

scard = box("Source card", { component: true, gap: 12, pad: 14, w: 250, radius: "panel", fill: "bg/subtle", stroke: "border/default" });
const sh = box("header", { dir: "row", gap: 8, cross: "CENTER" });
sh.appendChild(markOf("Amber", "F"));
add(sh, await text("fieldnotes.dev", "Paragraph/Small Regular", "text/secondary", "domain"), { w: "fill" });
sh.appendChild(await text("1", "Paragraph/Small Regular", "text/secondary", "number"));
add(scard, sh, { w: "fill" });
add(scard, await text("Immediate mode GUIs and why they keep coming back", "Paragraph/Small Medium", "text/primary", "title"), { w: "fill" });
MS.appendChild(scard);
wire(scard, [
  { layer: "domain", kind: "TEXT", name: "Domain" },
  { layer: "number", kind: "TEXT", name: "Number" },
  { layer: "title", kind: "TEXT", name: "Title" },
]);

hcard = box("Source hover card", { component: true, gap: 12, pad: 20, w: 340, radius: "panel", fill: "bg/surface", stroke: "border/default" });
await hcard.setEffectStyleIdAsync(ES["Elevation/lg"].id);
const hh = box("header", { dir: "row", gap: 8, cross: "CENTER" });
hh.appendChild(markOf("Green", "G"));
hh.appendChild(await text("glyphlab.io", "Paragraph/Small Regular", "text/secondary", "domain"));
hcard.appendChild(hh);
add(hcard, await text("Notes on subpixel text positioning", "Paragraph/Small Medium", "text/primary", "title"), { w: "fill" });
add(hcard, await text("Shaping, hinting and subpixel positioning explained with examples.", "Paragraph/Small Regular", "text/secondary", "snippet"), { w: "fill" });
MS.appendChild(hcard);
wire(hcard, [
  { layer: "domain", kind: "TEXT", name: "Domain" },
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "snippet", kind: "TEXT", name: "Snippet" },
]);

}
// ---- Attachment chip, Model picker, Model option, Model menu --------------------------------------------------------------
const chipFile = box("Attachment chip", { component: true, dir: "row", gap: 8, pad: [6, 10, 6, 6], radius: 12, cross: "CENTER", fill: "bg/subtle", stroke: "border/default" });
const tile = box("tile", { dir: "row", w: 28, h: 28, radius: 8, align: "CENTER", cross: "CENTER", fill: "bg/surface" });
tile.appendChild(await ico("file-text", 16, "text/secondary", "icon"));
chipFile.appendChild(tile);
chipFile.appendChild(await text("quarterly-report.pdf", "Paragraph/Small Medium", "text/primary", "name"));
chipFile.appendChild(await ico("x", 16, "text/primary", "remove"));
MS.appendChild(chipFile);
wire(chipFile, [{ layer: "name", kind: "TEXT", name: "Name" }]);

const picker = await variants("Model picker", { Open: ["Off", "On"] }, async ({ Open }) => {
  const on = Open === "On";
  const b = box("model-picker", { component: true, dir: "row", gap: 8, pad: [0, 10], h: 32, radius: "button", cross: "CENTER", fill: on ? "bg/muted" : undefined, stroke: on ? "border/default" : undefined });
  b.appendChild(await ico("layers", 18, "text/secondary", "icon"));
  b.appendChild(await text("Atlas", "Paragraph/Small Medium", "text/primary", "label"));
  b.appendChild(await ico(on ? "chevron-up" : "chevron-down", 16, "text/secondary", "chevron"));
  return b;
}, { cols: 2 });
wire(picker, [
  { layer: "icon", kind: "SWAP", name: "Icon", def: IC.layers.id, pref: pick("layers", "zap", "box") },
  { layer: "label", kind: "TEXT", name: "Label" },
]);

const option = await variants("Model option", { Selected: ["Off", "On"] }, async ({ Selected }) => {
  const b = box("model-option", { component: true, dir: "row", gap: 12, pad: [10, 12], w: 320, radius: "item", cross: "MIN" });
  b.appendChild(await ico("layers", 20, "text/secondary", "icon"));
  const t = box("text", { gap: 2 });
  const head = box("head", { dir: "row", gap: 8, cross: "CENTER" });
  head.appendChild(await text("Atlas", "Paragraph/Small Medium", "text/primary", "name"));
  const bd = inst(badge, { Tone: "Neutral" }, { Label: "New" });
  bd.name = "badge";
  bd.visible = false;
  head.appendChild(bd);
  add(t, head, { w: "fill" });
  add(t, await text("Longer answers, reads files and code", "Paragraph/Small Regular", "text/secondary", "description"), { w: "fill" });
  add(b, t, { w: "fill" });
  const ck = await ico("check", 18, "text/primary", "check");
  ck.visible = Selected === "On";
  b.appendChild(ck);
  return b;
}, { cols: 2 });
wire(option, [
  { layer: "icon", kind: "SWAP", name: "Icon", def: IC.layers.id, pref: pick("layers", "zap", "box") },
  { layer: "name", kind: "TEXT", name: "Name" },
  { layer: "badge", kind: "BOOLEAN", name: "Badge", def: false },
  { layer: "description", kind: "TEXT", name: "Description" },
]);
const opt = (name, desc, icon, selected, withBadge) => {
  const i = inst(option, { Selected: selected ? "On" : "Off" }, { Name: name, Description: desc, Icon: IC[icon].id, Badge: !!withBadge });
  i.name = name.toLowerCase().replace(/ /g, "-");
  return i;
};
const mmenu = box("Model menu", { component: true, gap: 2, pad: 8, radius: "panel", fill: "bg/surface", stroke: "border/default" });
await mmenu.setEffectStyleIdAsync(ES["Elevation/lg"].id);
mmenu.appendChild(opt("Atlas", "Longer answers, reads files and code", "layers", true, true));
mmenu.appendChild(opt("Atlas Fast", "Short answers in about a second", "zap", false));
mmenu.appendChild(opt("Atlas Mini", "Runs on your own machine", "box", false));
MS.appendChild(mmenu);
await slotify(mmenu, "Options");

// ---- Composer toolbar: attach, model, spacer, send (State switch: Draft · Empty disabled · Busy stop) -------------------------
const cbar = await variants("Composer toolbar", { State: ["Draft", "Empty", "Busy"] }, async ({ State }) => {
  const bar = box("composer-toolbar", { component: true, dir: "row", gap: 12, cross: "CENTER", w: 528 });
  const attach = inst(iconButton, { Type: CUI ? "Outline" : "Secondary", Size: "md" }, { Icon: IC.plus.id });
  attach.name = "attach";
  bar.appendChild(attach);
  const model = inst(picker, { Open: "Off" });
  model.name = "model";
  bar.appendChild(model);
  add(bar, box("spacer", { dir: "row" }), { w: "fill", h: 1 });
  const send = inst(iconButton, { Type: "Primary", Size: "md", State: State === "Empty" ? "Disabled" : CUI ? "Rest" : "Default" }, { Icon: (State === "Busy" ? IC.square : IC["arrow-up"]).id });
  send.name = "send";
  bar.appendChild(send);
  return bar;
}, { cols: 3 });
// ---- Composer: Files slot (attachments), draft, Composer toolbar (exposed instance) ------------------------------------------
const composer = box("composer", { component: true, gap: 12, pad: 16, w: 560, radius: "surface", fill: "bg/surface", stroke: "border/default" });
composer.name = "Composer";
await composer.setEffectStyleIdAsync(ES["Elevation/md"].id);
const files = box("attachments", { dir: "row", gap: 8 });
for (const n of ["file-1", "file-2"]) {
  const c = chipFile.createInstance();
  c.name = n;
  if (n === "file-2") c.setProperties({ [Object.keys(c.componentProperties)[0]]: "metrics.csv" });
  files.appendChild(c);
}
add(composer, files, { w: "fill" });
add(composer, await text("Summarize the report and compare it with last quarter.", "Paragraph/Medium Regular", "text/primary", "draft"), { w: "fill" });
const cbarInst = inst(cbar, { State: "Draft" });
cbarInst.name = "toolbar";
add(composer, cbarInst, { w: "fill" });
MS.appendChild(composer);
cbarInst.isExposedInstance = true;
wire(composer, [
  { layer: "attachments", kind: "BOOLEAN", name: "Attachments", def: true },
  { layer: "draft", kind: "TEXT", name: "Draft" },
]);
// attachment chips in a Files slot; the frame keeps its Attachments visibility binding
{
  const vis = Object.keys(composer.componentPropertyDefinitions).find((k) => k.startsWith("Attachments#"));
  await slotify(composer, "Files", { frame: "attachments" });
  for (const f of own(composer, "Files")) f.componentPropertyReferences = { ...f.componentPropertyReferences, visible: vis };
}

if (CUI) {
// ---- Prompt suggestion, Response actions, Context meter -----------------------------------------------------------------------
const suggestion = await variants("Prompt suggestion", { Hover: ["Off", "On"] }, async ({ Hover }) => {
  const b = box("prompt-suggestion", { component: true, dir: "row", gap: 12, pad: [14, 16], w: 300, radius: "surface", cross: "MIN", fill: Hover === "On" ? "interaction/hover" : "bg/surface", stroke: "border/default" });
  b.appendChild(await ico("code-xml", 20, "text/secondary", "icon"));
  const t = box("text", { gap: 2 });
  add(t, await text("Explain this code", "Paragraph/Small Medium", "text/primary", "title"), { w: "fill" });
  add(t, await text("Walk through what it does", "Paragraph/Small Regular", "text/secondary", "description"), { w: "fill" });
  add(b, t, { w: "fill" });
  return b;
}, { cols: 2 });
wire(suggestion, [
  { layer: "icon", kind: "SWAP", name: "Icon", def: IC["code-xml"].id, pref: pick("code-xml", "chart-bar", "pencil", "bug") },
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "description", kind: "TEXT", name: "Description" },
]);
sug = (Hover, icon, title, desc) => inst(suggestion, { Hover }, { Icon: IC[icon].id, Title: title, Description: desc });

const RA = [
  { Vote: "None", Copied: "Off" },
  { Vote: "Up", Copied: "Off" },
  { Vote: "Down", Copied: "Off" },
  { Vote: "None", Copied: "On" },
];
actions = await variants("Response actions", RA, async ({ Vote, Copied }) => {
  const b = box("response-actions", { component: true, dir: "row", gap: 4, cross: "CENTER" });
  const btn = (name, icon, active) => {
    const i = inst(iconButton, { Type: "Ghost", Size: "md", State: active ? "Hover" : "Rest" }, { Icon: IC[icon].id });
    i.name = name;
    b.appendChild(i);
  };
  btn("copy", Copied === "On" ? "check" : "copy");
  btn("regenerate", "refresh-cw");
  btn("vote-up", "thumbs-up", Vote === "Up");
  btn("vote-down", "thumbs-down", Vote === "Down");
  btn("share", "share-2");
  return b;
}, { cols: 2 });

const LEVEL = { Normal: ["text/primary", 0.57], Warning: ["feedback/warning/default", 0.85], Danger: ["feedback/error/default", 0.97] };
meter = await variants("Context meter", { Level: Object.keys(LEVEL) }, async ({ Level }) => {
  const [color, frac] = LEVEL[Level];
  const b = box("context-meter", { component: true, dir: "row", gap: 8, cross: "CENTER" });
  b.appendChild(ring("ring", 20, 3, "border/default", color, frac));
  b.appendChild(await text("57%", "Paragraph/Small Regular", "text/secondary", "percent"));
  return b;
}, { cols: 3 });
wire(meter, [{ layer: "percent", kind: "TEXT", name: "Percent" }]);

// ---- Voice orb: dotted thinking ring around concentric circles (halo, halo, body, core, sheen) ---------------------------------
ORB = {
  Idle: [172, 148, 132, 84, 36],
  Listening: [216, 184, 156, 96, 40],
  Thinking: [168, 144, 128, 80, 34],
  Speaking: [208, 176, 160, 100, 44],
};
const LAYERS = [
  ["halo-outer", "feedback/info/subtle", 0.45],
  ["halo-inner", "feedback/info/subtle", 0.85],
  ["body", "feedback/info/default", 1],
  ["core", "feedback/info/subtle", 0.4],
  ["sheen", "feedback/info/subtle", 0.7],
];
orb = await variants("Voice orb", { State: Object.keys(ORB) }, async ({ State }) => {
  const stage = box("voice-orb", { component: true, dir: "row", w: 248, h: 248, radius: 999, align: "CENTER", cross: "CENTER" });
  if (State === "Thinking") {
    stage.strokes = [solid("feedback/info/default")];
    stage.strokeWeight = 5;
    stage.strokeAlign = "INSIDE";
    stage.dashPattern = [0.1, 62];
    stage.strokeCap = "ROUND";
  }
  let parent = stage;
  ORB[State].forEach((size, i) => {
    const [name, fill, opacity] = LAYERS[i];
    const c = box(name, { dir: "row", w: size, h: size, radius: 999, align: "CENTER", cross: "CENTER", fill });
    c.opacity = opacity;
    parent.appendChild(c);
    parent = c;
  });
  return stage;
}, { cols: 4 });

}
// ---- board cards --------------------------------------------------------------------------------------------------------------
const c = await H.cursor();
const body = null;
const label = (s) => text(s, "Paragraph/Mini Regular", "text/secondary", "sub");
const make = (set, variant, props, name) => {
  const i = inst(set, variant, props);
  if (name) i.name = name;
  return i;
};

if (CUI) {
const k1 = await card(body, "Reasoning and tool calls", "Thinking · folded · tool call states");
k1.card.appendChild(make(reasoning, { Open: "On" }, { Title: "Thinking for 6s" }, "reasoning-open"));
k1.card.appendChild(make(reasoning, { Open: "Off" }, { Title: "Thought for 8s" }, "reasoning-folded"));
k1.card.appendChild(make(toolCall, { Status: "Done", Open: "On" }, { "Tool name": "web_search" }, "tool-open"));
k1.card.appendChild(make(toolCall, { Status: "Running", Open: "Off" }, { Icon: IC["file-text"].id, "Tool name": "read_file", Detail: "quarterly-report.pdf", Time: "3.2s" }, "tool-running"));
k1.card.appendChild(make(toolCall, { Status: "Error", Open: "Off" }, { Icon: IC.terminal.id, "Tool name": "run_tests", Detail: "ctest --output-on-failure", Time: "12s" }, "tool-error"));
await burst(c, k1.wrap);

}
const k2 = await card(body, "Agent plan and status", "Plan with rail · status pills");
const side = box("statuses", { gap: 12 });
side.appendChild(make(astatus, { Status: "Running" }, { Label: "Reading quarterly-report.pdf", Time: "14s" }, "status-running"));
side.appendChild(make(astatus, { Status: "Done" }, { Label: "Searched 12 sites", Time: "9s" }, "status-done"));
side.appendChild(make(astatus, { Status: "Error" }, { Label: "Could not reach the API" }, "status-error"));
k2.card.appendChild(row("plan-and-status", [plan.createInstance(), side], 24, "MIN"));
await burst(c, k2.wrap);

if (CUI) {
const k3 = await card(body, "Sources and citations", "Citations · hover card · source cards");
add(k3.card, await text("They do very little work per frame: the interface is rebuilt from your data, laid out once and drawn in a handful of batches.", "Paragraph/Large Regular", "text/primary", "answer"), { w: 640 });
const cites = box("citations", { dir: "row", gap: 8, cross: "CENTER" });
cites.appendChild(await text("Sources", "Paragraph/Small Regular", "text/secondary", "sources-label"));
cites.appendChild(make(citation, { Active: "Off" }, { Label: "fieldnotes.dev" }, "cite-1"));
cites.appendChild(make(citation, { Active: "On" }, { Label: "glyphlab.io" }, "cite-2"));
cites.appendChild(make(citation, { Active: "Off" }, { Label: "motionbook.dev" }, "cite-3"));
k3.card.appendChild(cites);
k3.card.appendChild(hcard.createInstance());
const slist = box("source-list", { dir: "row", gap: 16, cross: "MIN" });
slist.appendChild(make(scard, {}, {}, "source-1"));
const s2 = make(scard, {}, { Domain: "glyphlab.io", Number: "2", Title: "Notes on subpixel text positioning" }, "source-2");
slist.appendChild(s2);
const s3 = make(scard, {}, { Domain: "motionbook.dev", Number: "3", Title: "Spring physics for interface motion" }, "source-3");
slist.appendChild(s3);
k3.card.appendChild(slist);
await burst(c, k3.wrap);

}
const k4 = await card(body, "Composer and model picker", "Draft · empty · busy · model menu");
// empty composer: placeholder draft (text/placeholder) and disabled send
const composerAs = async (state, name) => {
  const i = make(composer, {}, state === "Draft" ? {} : { Attachments: false }, name);
  const t = i.findOne((x) => x.name === "toolbar");
  t.setProperties({ [Object.keys(t.componentProperties).find((k) => k.split("#")[0] === "State")]: state });
  if (state === "Empty") {
    const d = i.findOne((x) => x.name === "draft");
    d.characters = "Ask anything";
    d.fills = [solid("text/placeholder")];
  }
  return i;
};
k4.card.appendChild(await composerAs("Draft", "composer-draft"));
k4.card.appendChild(await composerAs("Empty", "composer-empty"));
k4.card.appendChild(await composerAs("Busy", "composer-busy"));
k4.card.appendChild(await label("Model picker · open"));
k4.card.appendChild(make(picker, { Open: "On" }, {}, "picker-open"));
k4.card.appendChild(mmenu.createInstance());
await burst(c, k4.wrap);

if (CUI) {
const k5 = await card(body, "Suggestions, response actions and the context meter", "Prompts · actions · ring levels");
const g1 = row("suggestions-1", [sug("Off", "code-xml", "Explain this code", "Walk through what it does"), sug("Off", "chart-bar", "Analyze a dataset", "Find trends and outliers")], 16, "MIN");
const g2 = row("suggestions-2", [sug("On", "pencil", "Draft an email", "Clear and friendly"), sug("Off", "bug", "Debug an error", "Paste the stack trace")], 16, "MIN");
k5.card.appendChild(g1);
k5.card.appendChild(g2);
k5.card.appendChild(row("actions-and-meter", [make(actions, { Vote: "Up", Copied: "Off" }, {}, "actions"), make(meter, { Level: "Normal" }, { Percent: "57%" }, "meter")], 48));
k5.card.appendChild(await label("Copied · downvoted · amber past 80 % · red past 95 %"));
k5.card.appendChild(row("variants", [make(actions, { Vote: "None", Copied: "On" }, {}, "actions-copied"), make(actions, { Vote: "Down", Copied: "Off" }, {}, "actions-down"), make(meter, { Level: "Warning" }, { Percent: "85%" }, "meter-warning"), make(meter, { Level: "Danger" }, { Percent: "97%" }, "meter-danger")], 32));
await burst(c, k5.wrap);

const k6 = await card(body, "Voice orb", "Idle · listening · thinking · speaking");
const orbs = box("orbs", { dir: "row", gap: 24, cross: "MIN" });
for (const State of Object.keys(ORB)) {
  const col = box(State.toLowerCase(), { gap: 8, cross: "CENTER" });
  col.appendChild(make(orb, { State }, {}, "orb-" + State.toLowerCase()));
  col.appendChild(await text(State, "Paragraph/Small Regular", "text/secondary", "caption"));
  orbs.appendChild(col);
}
k6.card.appendChild(orbs);
await burst(c, k6.wrap);
}
c.done();
return {
  taskStatus: taskStatus.children.length, toolCall: toolCall?.children.length, planStep: planStep.children.length, composer: composer.children.length, composerToolbar: cbar.children.length,
  actions: actions?.children.length, meter: meter?.children.length, orb: orb?.children.length, cards: CUI ? 6 : 2,
};
