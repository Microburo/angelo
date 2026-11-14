// controls hug their content above a min height (input/select 40, textarea 96), so a Field slot
// swapped to any of them takes that control's own height
const hugMin = (b) => {
  b.minHeight = b.height;
  // cui: shadcn model, padding 8 top and bottom around the 20 px text line, border inside the box
  if (CUI && b.paddingLeft === 12 && b.paddingTop === 0) {
    pad(b, [8, 12]);
    b.strokesIncludedInLayout = false;
  }
  b.layoutSizingVertical = "HUG";
  return b;
};
// Input, Textarea, Select (State × Value), Field (label + exposed control swap + help text), board cards.
for (const n of ["Input", "Textarea", "Select", "Field"]) setNamed(n)?.remove();
const ICONS = ["search", "mail", "user-round", "lock", "calendar", "x", "eye", "plus"];
const icons = [];
for (const n of ICONS) icons.push(await H.icon(n, ICON));
const W = 280;
const ring = (State) => ({
  stroke: State.startsWith("Error") ? "feedback/error/default" : State === "Focus" ? "border/focus" : CUI ? "border/input" : "border/default",
  sw: State === "Focus" || State === "Error focus" ? 2 : 1,
  fill: State === "Disabled" ? "bg/muted" : "bg/surface",
});
const tone = (State, Value) => (State === "Disabled" ? "text/disabled" : Value === "Filled" ? "text/primary" : "text/placeholder");
const iconTone = (State) => (State === "Disabled" ? "text/disabled" : "text/secondary");
const STATES = ["Default", "Focus", "Error", "Error focus", "Disabled"];

// Select is Type=Select of Input (same ring, left icon and text, chevron in place of the affixes and right icon)
const input = await variants("Input", { Type: ["Text", "Select"], State: STATES, Value: ["Placeholder", "Filled"] }, async ({ Type, State, Value }) => {
  const r = ring(State);
  const b = box(Type === "Select" ? "select" : "input", { component: true, dir: "row", gap: 8, pad: [0, 12], w: W, h: CTRL, radius: "input", cross: "CENTER", fill: r.fill, stroke: r.stroke, sw: r.sw });
  // one swap property for both types, so one default (search); select instances override it with user-round
  const li = await ico("search", 18, iconTone(State), "left-icon");
  li.visible = false;
  b.appendChild(li);
  if (Type === "Select") {
    add(b, await text(Value === "Filled" ? "Option" : "Select an option", "Paragraph/Small Regular", tone(State, Value), "text"), { w: "fill" });
    b.appendChild(await ico("chevron-down", 18, iconTone(State), "chevron"));
    return hugMin(b);
  }
  // muted affixes around the value (currency symbol and code, URL scheme, unit), hidden by default
  const pre = await text("$", "Paragraph/Small Regular", iconTone(State), "prefix");
  pre.visible = false;
  b.appendChild(pre);
  add(b, await text(Value === "Filled" ? "Value" : "Placeholder", "Paragraph/Small Regular", tone(State, Value), "text"), { w: "fill" });
  const suf = await text("USD", "Paragraph/Small Regular", iconTone(State), "suffix");
  suf.visible = false;
  b.appendChild(suf);
  const ri = await ico("x", 18, iconTone(State), "right-icon");
  ri.visible = false;
  b.appendChild(ri);
  return hugMin(b);
}, { cols: 2 });
wire(input, [
  { layer: "left-icon", kind: "BOOLEAN", name: "Left icon", def: false },
  { layer: "left-icon", kind: "SWAP", name: "Left icon swap", def: icons[0].id, pref: icons },
  { layer: "text", kind: "TEXT", name: "Text" },
  { layer: "right-icon", kind: "BOOLEAN", name: "Right icon", def: false },
  { layer: "right-icon", kind: "SWAP", name: "Right icon swap", def: icons[5].id, pref: icons },
  { layer: "prefix", kind: "BOOLEAN", name: "Prefix", def: false },
  { layer: "prefix", kind: "TEXT", name: "Prefix text" },
  { layer: "suffix", kind: "BOOLEAN", name: "Suffix", def: false },
  { layer: "suffix", kind: "TEXT", name: "Suffix text" },
]);

const textarea = await variants("Textarea", { State: STATES, Value: ["Placeholder", "Filled"] }, async ({ State, Value }) => {
  const r = ring(State);
  const b = box("textarea", { component: true, pad: 12, w: W, h: 96, radius: "input", fill: r.fill, stroke: r.stroke, sw: r.sw });
  add(b, await text(Value === "Filled" ? "A longer value written over several lines" : "Placeholder", "Paragraph/Small Regular", tone(State, Value), "text"), { w: "fill" });
  hugMin(b);
  // resize grip: two diagonal strokes pinned to the bottom-right corner (no Lucide glyph for it)
  const g = figma.createVector();
  g.name = "resize";
  g.vectorPaths = [{ windingRule: "NONE", data: "M 8 0 L 0 8 M 8 4 L 4 8" }];
  g.strokes = [solid("text/placeholder")];
  g.strokeWeight = 1;
  g.strokeCap = "ROUND";
  b.appendChild(g);
  g.layoutPositioning = "ABSOLUTE";
  g.constraints = { horizontal: "MAX", vertical: "MAX" };
  g.x = b.width - 4 - g.width;
  g.y = b.height - 4 - g.height;
  return b;
}, { cols: 2 });
wire(textarea,[{ layer: "text", kind: "TEXT", name: "Text" }]);


const field = box("Field", { component: true, gap: 8, w: W });
add(field, await text("Label", "Paragraph/Small Medium", "text/primary", "label"), { w: "fill" });
const control = add(field, input.defaultVariant.createInstance(), { w: "fill" });
control.name = "control";
control.layoutSizingVertical = "HUG";
add(field, await text("Help text", "Paragraph/Mini Regular", "text/secondary", "help"), { w: "fill" });
rootNamed(MASTERS).appendChild(field);
wire(field, [
  { layer: "label", kind: "BOOLEAN", name: "Label", def: true },
  { layer: "label", kind: "TEXT", name: "Label text" },
  { layer: "control", kind: "SWAP", name: "Control", def: input.defaultVariant.id, pref: [input, textarea] },
  { layer: "help", kind: "BOOLEAN", name: "Help text", def: true },
  { layer: "help", kind: "TEXT", name: "Help" },
]);
control.isExposedInstance = true;

// board cards
const c = await H.cursor();
const body = null;
const show = [
  ["Empty", { State: "Default", Value: "Placeholder" }, { Text: " " }],
  ["Placeholder", { State: "Default", Value: "Placeholder" }, { "Left icon": true }],
  ["Filled", { State: "Default", Value: "Filled" }, { "Left icon": true, "Right icon": true }],
  ["Focus", { State: "Focus", Value: "Filled" }, {}],
  ["Error", { State: "Error", Value: "Filled" }, {}],
  ["Error focus", { State: "Error focus", Value: "Filled" }, {}],
  ["Disabled", { State: "Disabled", Value: "Placeholder" }, {}],
  ["Prefix and suffix", { State: "Default", Value: "Filled" }, { Text: "1,249.50", Prefix: true, Suffix: true }],
  ["Prefix", { State: "Default", Value: "Filled" }, { Text: "figma.com", Prefix: true, "Prefix text": "https://" }],
  ["Suffix", { State: "Default", Value: "Filled" }, { Text: "72", Suffix: true, "Suffix text": "kg" }],
];
const ik = await card(body, "Input", "States");
for (const [name, v, p] of show) {
  const row = box(name, { gap: 6 });
  row.appendChild(await text(name, "Paragraph/Mini Regular", "text/secondary", "sub"));
  row.appendChild(inst(input, v, p));
  ik.card.appendChild(row);
}
await burst(c, ik.wrap);

const tk = await card(body, "Textarea", "States");
for (const v of [{ State: "Default", Value: "Placeholder" }, { State: "Focus", Value: "Filled" }, { State: "Disabled", Value: "Filled" }]) tk.card.appendChild(inst(textarea, v));
await burst(c, tk.wrap);
const sk = await card(body, "Select", "States");
for (const v of [{ State: "Default", Value: "Placeholder" }, { State: "Focus", Value: "Filled" }, { State: "Error", Value: "Filled" }]) sk.card.appendChild(inst(input, { Type: "Select", ...v }, { "Left icon": v.State === "Focus", "Left icon swap": icons[2].id }));
await burst(c, sk.wrap);

const fk = await card(body, "Field", "One per form type");
const f1 = inst(field, {}, { "Label text": "Email", Help: "We never share it" });
fk.card.appendChild(f1);
const swapTo = (f, comp) => {
  const key = Object.keys(f.componentProperties).find((k) => k.startsWith("Control#"));
  f.setProperties({ [key]: comp.id });
};
const f2 = inst(field, {}, { "Label text": "Message", Help: "500 characters max" });
swapTo(f2, textarea.defaultVariant);
fk.card.appendChild(f2);
const f3 = inst(field, {}, { "Label text": "Country", "Help text": false });
swapTo(f3, input.children.find((v) => v.name === "Type=Select, State=Default, Value=Placeholder"));
{
  const ctl = f3.findOne((n) => n.name === "control");
  const key = Object.keys(ctl.componentProperties).find((k) => k.startsWith("Left icon swap#"));
  ctl.setProperties({ [key]: icons[2].id });
}
fk.card.appendChild(f3);
const f4 = inst(field, {}, { "Label text": "Password", Help: "At least 8 characters" });
const ctl = f4.findChild((n) => n.type === "INSTANCE");
ctl.setProperties({ State: "Error", Value: "Filled" });
fk.card.appendChild(f4);
await burst(c, fk.wrap);
c.done();
return { input: input.children.length, textarea: textarea.children.length, select: input.children.filter((v) => v.name.startsWith("Type=Select")).length };
