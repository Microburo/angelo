// cui flavor: Checkbox, Radio (Checked × State, label boolean) as V1; CUI Slider (label and value over the track,
// Single or Range, Slider thumb), board cards.
for (const n of ["Checkbox", "Radio", "Slider", "Slider thumb"]) setNamed(n)?.remove();
await H.icon("check", ICON);
await H.icon("minus", ICON);

const checkbox = await variants("Checkbox", { Checked: ["Off", "On", "Mixed"], State: ["Default", "Disabled"] }, async ({ Checked, State }) => {
  const dis = State === "Disabled";
  const on = Checked !== "Off";
  const b = box("checkbox", { component: true, dir: "row", gap: 8, cross: "CENTER" });
  const ctl = box("control", { dir: "row", w: 18, h: 18, radius: "checkbox", align: "CENTER", cross: "CENTER", fill: on ? (dis ? "primary/disabled" : "primary/default") : dis ? "bg/muted" : "bg/surface", stroke: on ? undefined : "border/strong" });
  if (on) ctl.appendChild(await ico(Checked === "On" ? "check" : "minus", 14, dis ? "text/disabled" : "text/on-primary", "mark"));
  b.appendChild(ctl);
  b.appendChild(await text("Label", "Paragraph/Small Regular", dis ? "text/disabled" : "text/primary", "label"));
  return b;
}, { cols: 2 });
wire(checkbox, [
  { layer: "label", kind: "BOOLEAN", name: "Label", def: true },
  { layer: "label", kind: "TEXT", name: "Label text" },
]);

const radio = await variants("Radio", { Checked: ["Off", "On"], State: ["Default", "Disabled"] }, async ({ Checked, State }) => {
  const dis = State === "Disabled";
  const on = Checked === "On";
  const b = box("radio", { component: true, dir: "row", gap: 8, cross: "CENTER" });
  const ctl = box("control", { dir: "row", w: 18, h: 18, radius: 999, align: "CENTER", cross: "CENTER", fill: dis ? "bg/muted" : "bg/surface", stroke: on ? (dis ? "primary/disabled" : "primary/default") : "border/strong", sw: on ? 5 : 1 });
  b.appendChild(ctl);
  b.appendChild(await text("Label", "Paragraph/Small Regular", dis ? "text/disabled" : "text/primary", "label"));
  return b;
}, { cols: 2 });
wire(radio, [
  { layer: "label", kind: "BOOLEAN", name: "Label", def: true },
  { layer: "label", kind: "TEXT", name: "Label text" },
]);

// <slider> CUI slider: label and value over a 4 px track, dark fill up to a white thumb; Range = two thumbs
const sthumb = box("Slider thumb", { component: true, w: 18, h: 18, radius: 999, fill: "bg/surface", stroke: "border/default" });
await sthumb.setEffectStyleIdAsync(ES["Elevation/sm"].id);
rootNamed(MASTERS).appendChild(sthumb);
const slider = await variants("Slider", { Type: ["Single", "Range"], State: ["Default", "Disabled"] }, async ({ Type, State }) => {
  const dis = State === "Disabled";
  const range = Type === "Range";
  const b = box("slider", { component: true, gap: 12, w: 280 });
  const head = box("head", { dir: "row", align: "SPACE_BETWEEN", cross: "CENTER" });
  head.appendChild(await text(range ? "Price" : "Volume", "Paragraph/Small Medium", dis ? "text/disabled" : "text/primary", "label"));
  head.appendChild(await text(range ? "25 – 70" : "62", "Paragraph/Small Regular", dis ? "text/disabled" : "text/secondary", "value"));
  add(b, head, { w: "fill" });
  // segments sized to the value on a 280 px rail minus the thumbs (Volume 62 %, Price 25 – 70 %)
  const rail = box("rail", { dir: "row", h: 18, cross: "CENTER" });
  const fill = dis ? "primary/disabled" : "primary/default";
  // only the rail ends are round; segment ends meeting a thumb are square, so the bar runs flush into it
  const seg = (name, color, w, ends) => {
    const s = add(rail, box(name, { fill: color, radius: 999 }), { w, h: 4 });
    if (!ends.includes("L")) for (const k of ["topLeftRadius", "bottomLeftRadius"]) num(s, k, 0, "radius");
    if (!ends.includes("R")) for (const k of ["topRightRadius", "bottomRightRadius"]) num(s, k, 0, "radius");
  };
  const thumb = (name) => rail.appendChild(Object.assign(sthumb.createInstance(), { name }));
  if (range) {
    seg("track-start", "interaction/active", 61, "L");
    thumb("thumb-start");
    seg("progress", fill, "fill", "");
    thumb("thumb-end");
    seg("track-end", "interaction/active", 73, "R");
  } else {
    seg("progress", fill, 162, "L");
    thumb("thumb");
    seg("track", "interaction/active", "fill", "R");
  }
  add(b, rail, { w: "fill" });
  return b;
}, { cols: 2 });
wire(slider, [
  { layer: "head", kind: "BOOLEAN", name: "Header", def: true },
  { layer: "label", kind: "TEXT", name: "Label" },
  { layer: "value", kind: "TEXT", name: "Value" },
]);
// </slider>

const c = await H.cursor();
const body = null;
// checkbox and radio share one element frame: checkbox row, then radio row
const k = await card(body, "Checkbox · Radio", "Checked × State");
const cbRow = box("checkbox", { dir: "row", gap: 24 });
for (const v of [{ Checked: "Off" }, { Checked: "On" }, { Checked: "Mixed" }, { Checked: "On", State: "Disabled" }]) cbRow.appendChild(inst(checkbox, v, { "Label text": v.State || v.Checked }));
k.card.appendChild(cbRow);
const rRow = box("radio", { dir: "row", gap: 24 });
for (const v of [{ Checked: "Off" }, { Checked: "On" }, { Checked: "Off", State: "Disabled" }, { Checked: "On", State: "Disabled" }]) rRow.appendChild(inst(radio, v, { "Label text": [v.State, v.Checked].filter(Boolean).join(" ") }));
k.card.appendChild(rRow);
await burst(c, k.wrap);
// <slider-card>
const ks = await card(body, "Slider", "Single · range · disabled");
const sRow = box("slider", { dir: "row", gap: 40 });
for (const State of ["Default", "Disabled"]) {
  const col = box(State.toLowerCase(), { gap: 32 });
  for (const Type of ["Single", "Range"]) col.appendChild(inst(slider, { Type, State }));
  sRow.appendChild(col);
}
ks.card.appendChild(sRow);
await burst(c, ks.wrap);
// </slider-card>
c.done();
return { checkbox: checkbox.children.length, radio: radio.children.length, slider: slider.children.length };
