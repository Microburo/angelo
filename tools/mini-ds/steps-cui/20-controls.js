// CUI controls V1 lacks: Switch, Segmented control, Tabs, Chip, Keycap, Radio card, Progress, board cards.
const NEW = ["Switch", "Segment", "Segmented control", "Tab", "Tabs", "Chip", "Keycap", "Radio card", "Progress"];
for (const n of NEW) setNamed(n)?.remove();
for (const n of ["check", "layout-grid", "rocket", "building-2"]) await H.icon(n, ICON);

// Switch: 36 × 20 track, 16 thumb pushed to the end when on
const sw = await variants("Switch", { Checked: ["Off", "On"], State: ["Default", "Disabled"] }, async ({ Checked, State }) => {
  const dis = State === "Disabled";
  const on = Checked === "On";
  const b = box("switch", { component: true, dir: "row", gap: 8, cross: "CENTER" });
  const track = box("track", { dir: "row", w: 36, h: 20, radius: 999, cross: "CENTER", align: on ? "MAX" : "MIN", fill: on ? (dis ? "primary/disabled" : "primary/default") : dis ? "interaction/disabled" : "secondary/active" });
  num(track, "paddingLeft", 2);
  num(track, "paddingRight", 2);
  const thumb = box("thumb", { w: 16, h: 16, radius: 999, fill: "bg/surface" });
  await thumb.setEffectStyleIdAsync(ES["Elevation/sm"].id);
  track.appendChild(thumb);
  b.appendChild(track);
  b.appendChild(await text("Label", "Paragraph/Small Regular", dis ? "text/disabled" : "text/primary", "label"));
  return b;
}, { cols: 2 });
wire(sw, [
  { layer: "label", kind: "BOOLEAN", name: "Label", def: true },
  { layer: "label", kind: "TEXT", name: "Label text" },
]);

// Segmented control: segments on a muted rail, the selected one raised on the surface
const segment = await variants("Segment", { Selected: ["Off", "On"] }, async ({ Selected }) => {
  const on = Selected === "On";
  const b = box("segment", { component: true, dir: "row", gap: 6, pad: [0, 12], h: 28, radius: 8, align: "CENTER", cross: "CENTER", fill: on ? "bg/surface" : undefined });
  if (on) await b.setEffectStyleIdAsync(ES["Elevation/sm"].id);
  b.appendChild(await text("Segment", "Paragraph/Small Medium", on ? "text/primary" : "text/secondary", "label"));
  return b;
}, { cols: 2 });
wire(segment, [{ layer: "label", kind: "TEXT", name: "Label" }]);
const seg = box("Segmented control", { component: true, dir: "row", gap: 2, pad: 2, radius: 10, fill: "bg/muted" });
["Day", "Week", "Month"].forEach((l, i) => seg.appendChild(inst(segment, { Selected: i === 1 ? "On" : "Off" }, { Label: l })));
rootNamed(MASTERS).appendChild(seg);
await slotify(seg, "Segments");

// Tabs: label over a 2 px indicator, the row on a 1 px bottom border
const tab = await variants("Tab", { Selected: ["Off", "On"] }, async ({ Selected }) => {
  const on = Selected === "On";
  const b = box("tab", { component: true, gap: 8, pad: [8, 0, 0, 0], cross: "CENTER" });
  b.appendChild(await text("Tab", "Paragraph/Small Medium", on ? "text/primary" : "text/secondary", "label"));
  add(b, box("indicator", { fill: on ? "primary/default" : undefined }), { w: "fill", h: 2 });
  return b;
}, { cols: 2 });
wire(tab, [{ layer: "label", kind: "TEXT", name: "Label" }]);
const tabs = box("Tabs", { component: true, dir: "row", gap: 24, stroke: "border/default" });
tabs.strokeTopWeight = tabs.strokeLeftWeight = tabs.strokeRightWeight = 0;
tabs.strokeBottomWeight = 1;
["Overview", "Activity", "Settings"].forEach((l, i) => tabs.appendChild(inst(tab, { Selected: i === 0 ? "On" : "Off" }, { Label: l })));
rootNamed(MASTERS).appendChild(tabs);
await slotify(tabs, "Tabs");

// Chip: pill, check icon when selected
const chip = await variants("Chip", { Selected: ["Off", "On"], State: ["Default", "Disabled"] }, async ({ Selected, State }) => {
  const on = Selected === "On";
  const dis = State === "Disabled";
  const tone = dis ? "text/disabled" : "text/primary";
  const b = box("chip", { component: true, dir: "row", gap: 6, pad: [0, 14], h: 32, radius: "chip", cross: "CENTER", fill: on ? "bg/muted" : "bg/surface", stroke: on && !dis ? "border/input" : "border/strong" });
  if (on) b.appendChild(await ico("check", 16, tone, "check"));
  b.appendChild(await text("Chip", "Paragraph/Small Medium", tone, "label"));
  return b;
}, { cols: 2 });
wire(chip, [{ layer: "label", kind: "TEXT", name: "Label" }]);

// Keycap: one key of a shortcut
const keycap = box("Keycap", { component: true, dir: "row", pad: [2, 6], radius: 4, align: "CENTER", cross: "CENTER", stroke: "border/input", fill: "bg/surface" });
keycap.minWidth = 24;
keycap.appendChild(await text("Ctrl", "Paragraph/Small Medium", "text/secondary", "key"));
rootNamed(MASTERS).appendChild(keycap);
wire(keycap, [{ layer: "key", kind: "TEXT", name: "Key" }]);

// Radio card: icon tile, title (+ optional badge), description, radio at the end
const radio = setNamed("Radio");
const badge = setNamed("Badge");
const rcard = await variants("Radio card", { Selected: ["Off", "On"] }, async ({ Selected }) => {
  const on = Selected === "On";
  const b = box("radio-card", { component: true, dir: "row", gap: 12, pad: 16, w: 360, radius: "panel", cross: "MIN", fill: on ? "bg/subtle" : "bg/surface", stroke: on ? "primary/default" : "border/default" });
  const tile = box("tile", { dir: "row", w: 36, h: 36, radius: 8, align: "CENTER", cross: "CENTER", fill: "bg/muted" });
  tile.appendChild(await ico("rocket", 18, "text/primary", "icon"));
  b.appendChild(tile);
  const t = box("text", { gap: 2 });
  const head = box("head", { dir: "row", gap: 8, cross: "CENTER" });
  head.appendChild(await text("Title", "Paragraph/Small Medium", "text/primary", "title"));
  const bd = inst(badge, { Tone: "Neutral" }, { Label: "Default" });
  bd.name = "badge";
  bd.visible = false;
  head.appendChild(bd);
  add(t, head, { w: "fill" });
  add(t, await text("Description on one or two lines", "Paragraph/Small Regular", "text/secondary", "description"), { w: "fill" });
  add(b, t, { w: "fill" });
  const r = inst(radio, { Checked: on ? "On" : "Off" }, { Label: false });
  r.name = "radio";
  b.appendChild(r);
  return b;
}, { cols: 2 });
const rocket = await H.icon("rocket", ICON);
const rcIcons = [rocket, await H.icon("building-2", ICON), await H.icon("layout-grid", ICON)];
wire(rcard, [
  { layer: "icon", kind: "SWAP", name: "Icon", def: rocket.id, pref: rcIcons },
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "badge", kind: "BOOLEAN", name: "Badge", def: false },
  { layer: "description", kind: "TEXT", name: "Description" },
]);

// Progress: 6 px track, bar width = value
const progress = await variants("Progress", { Value: ["25", "60", "100"] }, async ({ Value }) => {
  const b = box("progress", { component: true, dir: "row", w: 240, h: 6, radius: 999, fill: "interaction/active", clip: true });
  add(b, box("bar", { fill: "primary/default", radius: 999 }), { w: Math.round((240 * Number(Value)) / 100), h: "fill" });
  return b;
}, { cols: 3 });

// board cards
const c = await H.cursor();
const body = null;
const label = (s) => text(s, "Paragraph/Mini Regular", "text/secondary", "sub");

const k1 = await card(body, "Switch", "Checked × State");
const r1 = box("switches", { dir: "row", gap: 24 });
for (const v of [{ Checked: "Off" }, { Checked: "On" }, { Checked: "Off", State: "Disabled" }, { Checked: "On", State: "Disabled" }]) r1.appendChild(inst(sw, v, { "Label text": [v.State, v.Checked].filter(Boolean).join(" ") }));
k1.card.appendChild(r1);
await burst(c, k1.wrap);

const k2 = await card(body, "Segmented control", "Segments on a rail");
k2.card.appendChild(seg.createInstance());
await burst(c, k2.wrap);

const k3 = await card(body, "Tabs", "Selected · default");
add(k3.card, tabs.createInstance(), { w: 360 });
await burst(c, k3.wrap);

const k4 = await card(body, "Chip", "Selected × State");
const r4 = box("chips", { dir: "row", gap: 8 });
[["Design", "On"], ["Engineering", "Off"], ["Marketing", "On"], ["Sales", "Off"]].forEach(([l, s]) => r4.appendChild(inst(chip, { Selected: s }, { Label: l })));
k4.card.appendChild(r4);
const r4b = box("disabled", { dir: "row", gap: 8 });
r4b.appendChild(inst(chip, { Selected: "On", State: "Disabled" }, { Label: "Disabled" }));
r4b.appendChild(inst(chip, { Selected: "Off", State: "Disabled" }, { Label: "Disabled" }));
k4.card.appendChild(r4b);
await burst(c, k4.wrap);

const k5 = await card(body, "Keycap", "Shortcut keys");
const r5 = box("keys", { dir: "row", gap: 4, cross: "CENTER" });
for (const key of ["Ctrl", "Shift", "P"]) r5.appendChild(inst(keycap, {}, { Key: key }));
k5.card.appendChild(r5);
await burst(c, k5.wrap);

const k6 = await card(body, "Radio card", "Selected · default");
k6.card.appendChild(inst(rcard, { Selected: "On" }, { Title: "Starter", Description: "One workspace, up to 3 seats", Badge: true }));
k6.card.appendChild(inst(rcard, { Selected: "Off" }, { Title: "Team", Description: "Shared projects and roles", Icon: rcIcons[1].id }));
k6.card.appendChild(inst(rcard, { Selected: "Off" }, { Title: "Enterprise", Description: "SSO, audit log, dedicated support", Icon: rcIcons[2].id }));
await burst(c, k6.wrap);

const k7 = await card(body, "Progress", "Value");
for (const Value of ["25", "60", "100"]) {
  const row = box(Value, { gap: 6 });
  row.appendChild(await label(Value + " %"));
  row.appendChild(inst(progress, { Value }));
  k7.card.appendChild(row);
}
await burst(c, k7.wrap);
c.done();
return { switch: sw.children.length, segment: segment.children.length, tab: tab.children.length, chip: chip.children.length, radioCard: rcard.children.length, progress: progress.children.length };
