// CUI feedback and surfaces V1 lacks: Alert, Toast, Tooltip, Empty state, Metric card, Plan card, board cards.
for (const n of ["Alert", "Toast", "Tooltip", "Empty state", ...(CUI ? ["Metric card", "Plan card"] : [])]) setNamed(n)?.remove();
const button = setNamed("Button");
const badge = setNamed("Badge");
const progress = setNamed("Progress");

// Alert: tone tint, tone icon, title + description, optional close
const TONE = {
  Info: ["info", "feedback/info"],
  Success: ["circle-check", "feedback/success"],
  Warning: ["triangle-alert", "feedback/warning"],
  Error: ["circle-alert", "feedback/error"],
};
const alertIcons = [];
for (const [ic] of Object.values(TONE)) alertIcons.push(await H.icon(ic, ICON));
await H.icon("x", ICON);
const alert = await variants("Alert", { Tone: Object.keys(TONE) }, async ({ Tone }) => {
  const [ic, k] = TONE[Tone];
  const b = box("alert", { component: true, dir: "row", gap: 12, pad: 16, w: 420, radius: "panel", cross: "MIN", fill: `${k}/subtle` });
  b.appendChild(await ico(ic, 18, `${k}/text`, "icon"));
  const t = box("text", { gap: 2 });
  add(t, await text(Tone === "Info" ? "Heads up" : Tone, "Paragraph/Small Medium", `${k}/text`, "title"), { w: "fill" });
  add(t, await text("A short sentence that says what happened and what to do next.", "Paragraph/Small Regular", "text/primary", "description"), { w: "fill" });
  add(b, t, { w: "fill" });
  const x = await ico("x", 16, "text/secondary", "close");
  x.visible = false;
  b.appendChild(x);
  return b;
}, { cols: 2 });
wire(alert, [
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "description", kind: "TEXT", name: "Description" },
  { layer: "close", kind: "BOOLEAN", name: "Close", def: false },
]);

// Toast: floating surface, success icon, text, action, close
const toast = box("Toast", { component: true, dir: "row", gap: 12, pad: [14, 16], w: 380, radius: "panel", cross: "CENTER", fill: "bg/surface", stroke: "border/default" });
await toast.setEffectStyleIdAsync(ES["Elevation/lg"].id);
toast.appendChild(await ico("circle-check", 18, "feedback/success/default", "icon"));
const tt = box("text", { gap: 2 });
add(tt, await text("Changes saved", "Paragraph/Small Medium", "text/primary", "title"), { w: "fill" });
add(tt, await text("Your project is up to date.", "Paragraph/Small Regular", "text/secondary", "description"), { w: "fill" });
add(toast, tt, { w: "fill" });
const undo = inst(button, { Type: "Ghost", Size: "sm" }, { Label: "Undo" });
undo.name = "action";
toast.appendChild(undo);
toast.appendChild(await ico("x", 16, "text/secondary", "close"));
rootNamed(MASTERS).appendChild(toast);
wire(toast, [
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "description", kind: "BOOLEAN", name: "Description", def: true },
  { layer: "description", kind: "TEXT", name: "Description text" },
  { layer: "action", kind: "BOOLEAN", name: "Action", def: true },
]);

// Tooltip: inverse pill, small medium text
const tooltip = box("Tooltip", { component: true, dir: "row", pad: [6, 10], radius: "tooltip", cross: "CENTER", fill: "bg/inverse" });
tooltip.appendChild(await text("Tooltip", "Paragraph/Mini Medium", "text/on-primary", "label"));
rootNamed(MASTERS).appendChild(tooltip);
wire(tooltip, [{ layer: "label", kind: "TEXT", name: "Label" }]);

// Empty state: dashed surface, icon disc, title, description, primary action
const empty = box("Empty state", { component: true, gap: 12, pad: 40, w: 420, radius: "surface", cross: "CENTER", stroke: "border/strong" });
empty.dashPattern = [6, 4];
const disc = box("disc", { dir: "row", w: 48, h: 48, radius: 999, align: "CENTER", cross: "CENTER", fill: "bg/muted" });
disc.appendChild(await ico("inbox", 22, "text/secondary", "icon"));
empty.appendChild(disc);
const et = await text("No projects yet", "Paragraph/Medium Medium", "text/primary", "title");
et.textAlignHorizontal = "CENTER";
add(empty, et, { w: "fill" });
const ed = await text("Create a project to start collecting feedback from your team.", "Paragraph/Small Regular", "text/secondary", "description");
ed.textAlignHorizontal = "CENTER";
add(empty, ed, { w: "fill" });
const ea = inst(button, { Type: "Primary", Size: "sm" }, { Label: "New project", "Left icon": true });
ea.name = "action";
empty.appendChild(ea);
rootNamed(MASTERS).appendChild(empty);
wire(empty, [
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "description", kind: "TEXT", name: "Description" },
  { layer: "action", kind: "BOOLEAN", name: "Action", def: true },
]);

// Metric card and Plan card: cui flavor only (not ported to v1)
const cards = CUI ? await (async () => {
// Metric card: icon + label, display value, trend, sparkline (stroke bound to info)
const metric = box("Metric card", { component: true, gap: 12, pad: 24, w: 340, radius: "surface", fill: "bg/surface", stroke: "border/default" });
const mh = box("head", { dir: "row", gap: 8, cross: "CENTER" });
mh.appendChild(await ico("download", 18, "text/secondary", "icon"));
mh.appendChild(await text("Weekly installs", "Paragraph/Small Regular", "text/secondary", "label"));
metric.appendChild(mh);
const mv = box("value-row", { dir: "row", gap: 12, cross: "CENTER" });
mv.appendChild(await text("3,912", "Display/1", "text/primary", "value"));
const tr = box("trend", { dir: "row", gap: 4, cross: "CENTER" });
tr.appendChild(await ico("trending-up", 16, "feedback/success/text", "trend-icon"));
tr.appendChild(await text("+8.1 % vs last week", "Paragraph/Small Medium", "feedback/success/text", "delta"));
mv.appendChild(tr);
metric.appendChild(mv);
const spark = figma.createVector();
spark.name = "sparkline";
const pts = [[0, 44], [44, 34], [88, 40], [132, 26], [176, 32], [220, 16], [264, 8], [292, 4]];
spark.vectorPaths = [{ windingRule: "NONE", data: pts.map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`).join(" ") }];
spark.strokes = [solid("feedback/info/default")];
spark.strokeWeight = 2;
spark.strokeCap = "ROUND";
spark.strokeJoin = "ROUND";
spark.fills = [];
add(metric, spark, { w: "fill" });
rootNamed(MASTERS).appendChild(metric);
wire(metric, [
  { layer: "label", kind: "TEXT", name: "Label" },
  { layer: "value", kind: "TEXT", name: "Value" },
  { layer: "delta", kind: "TEXT", name: "Delta" },
  { layer: "sparkline", kind: "BOOLEAN", name: "Sparkline", def: true },
]);

// Plan card: title + description, badge, progress, two actions
const plan = box("Plan card", { component: true, gap: 16, pad: 24, w: 400, radius: "surface", fill: "bg/surface", stroke: "border/default" });
const ph = box("head", { dir: "row", gap: 12, cross: "MIN" });
const pt = box("text", { gap: 2 });
add(pt, await text("Team plan", "Paragraph/Medium Medium", "text/primary", "title"), { w: "fill" });
add(pt, await text("5 of 8 seats used", "Paragraph/Small Regular", "text/secondary", "description"), { w: "fill" });
add(ph, pt, { w: "fill" });
const pb = inst(badge, { Tone: "Neutral" }, { Label: "Renews Dec 1" });
pb.name = "badge";
ph.appendChild(pb);
add(plan, ph, { w: "fill" });
const pp = inst(progress, { Value: "60" });
pp.name = "progress";
add(plan, pp, { w: "fill" });
const pa = box("actions", { dir: "row", gap: 8 });
pa.appendChild(inst(button, { Type: "Secondary", Size: "md" }, { Label: "Add seats" }));
pa.appendChild(inst(button, { Type: "Ghost", Size: "md" }, { Label: "Billing" }));
plan.appendChild(pa);
rootNamed(MASTERS).appendChild(plan);
wire(plan, [
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "description", kind: "TEXT", name: "Description" },
  { layer: "badge", kind: "BOOLEAN", name: "Badge", def: true },
]);
return { metric, plan };
})() : null;

// board cards
const c = await H.cursor();
const body = null;
const ka = await card(body, "Alert", "Tone");
for (const Tone of Object.keys(TONE)) ka.card.appendChild(inst(alert, { Tone }, { Close: Tone === "Info" }));
await burst(c, ka.wrap);

const kt = await card(body, "Toast", "Floating · action");
kt.card.appendChild(toast.createInstance());
kt.card.appendChild(inst(toast, {}, { Title: "Link copied", Description: false, Action: false }));
await burst(c, kt.wrap);

const kp = await card(body, "Tooltip", "Inverse");
const tr2 = box("tips", { dir: "row", gap: 12, cross: "CENTER" });
tr2.appendChild(inst(tooltip, {}, { Label: "Copy link" }));
tr2.appendChild(inst(tooltip, {}, { Label: "Ctrl K to search" }));
kp.card.appendChild(tr2);
await burst(c, kp.wrap);

const ke = await card(body, "Empty state", "Dashed surface · action");
ke.card.appendChild(empty.createInstance());
await burst(c, ke.wrap);

if (cards) {
  const kc = await card(body, "Card", "Metric · plan");
  const row = box("cards", { dir: "row", gap: 24, cross: "MIN" });
  row.appendChild(cards.metric.createInstance());
  row.appendChild(cards.plan.createInstance());
  kc.card.appendChild(row);
  await burst(c, kc.wrap);
}
c.done();
return { alert: alert.children.length, components: cards ? 5 : 3 };
