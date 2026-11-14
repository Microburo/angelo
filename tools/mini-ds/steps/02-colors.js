// Colors board: a Board / Swatch component, one card for the raw ramps, one per semantic group.
const masters = rootNamed(MASTERS);
masters.layoutMode = "VERTICAL";
masters.primaryAxisSizingMode = "AUTO";
masters.counterAxisSizingMode = "AUTO";
masters.itemSpacing = 80;
pad(masters, 80);
masters.fills = [solid("bg/surface")];
rad(masters, "board"); // same rounding as the board cards
masters.findChild((n) => n.name === "Board / Swatch")?.remove();
masters.findChild((n) => n.name === "Board / title")?.remove();

// card title, used by card() on every element frame
const tt = box("Board / title", { component: true, dir: "row", gap: 8, pad: [0, 0, 40, 0] });
add(tt, await text("Raw palette", "Paragraph/Medium Regular", "text/primary", "title"));
masters.appendChild(tt);
// V1: title gap kept as a raw 8 (unbound)
tt.setBoundVariable("itemSpacing", null);
tt.itemSpacing = 8;
tt.layoutSizingHorizontal = "FILL";
wire(tt, [{ layer: "title", kind: "TEXT", name: "Title" }]);

const sw = box("Board / Swatch", { component: true, gap: 8, w: 104 });
// no outline on the chip; only white swatches get one (see swatch())
add(sw, box("chip", { fill: "color/neutral/200", radius: 2 }), { w: "fill", h: 48 });
// name and value stacked tight, 8 below the chip
const label = add(sw, box("label", { gap: 0 }), { w: "fill" });
add(label, await text("neutral/200", "Paragraph/Mini Medium", "text/primary", "name"), { w: "fill" });
add(label, await text("#E5E5E5", "Paragraph/Mini Regular", "text/secondary", "value"), { w: "fill" });
masters.appendChild(sw);
// board masters lead the masters frame, also when this step re-runs on an existing file
masters.insertChild(0, tt);
masters.insertChild(1, sw);
wire(sw, [
  { layer: "name", kind: "TEXT", name: "Name" },
  { layer: "value", kind: "TEXT", name: "Value" },
]);

const hexOf = async (v) => {
  let x = v;
  while (true) {
    const val = Object.values(x.valuesByMode)[0];
    if (val && val.type === "VARIABLE_ALIAS") x = await figma.variables.getVariableByIdAsync(val.id);
    else {
      const h = (n) => Math.round(n * 255).toString(16).padStart(2, "0");
      return ("#" + h(val.r) + h(val.g) + h(val.b)).toUpperCase() + (val.a < 1 ? ` · ${Math.round(val.a * 100)}%` : "");
    }
  }
};
const swatch = async (varName, label) => {
  const hex = await hexOf(vr(varName));
  const i = inst(sw, {}, { Name: label, Value: hex });
  // same variable as the master chip: keep the inherited fill (re-binding it leaves the black placeholder)
  if (varName !== "color/neutral/200") i.findChild((n) => n.name === "chip").fills = [solid(varName)];
  if (hex === "#FFFFFF") stroke(i.findChild((n) => n.name === "chip"), "border/default");
  return i;
};

const c = await H.cursor();
const body = null;

const raw = await card(body, "Primitives", "Raw palette");
for (const ramp of ["neutral", "red", "amber", "green", "blue", "teal", "brand"]) {
  const row = box(ramp, { dir: "row", gap: 8 });
  for (const s of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) row.appendChild(await swatch(`color/${ramp}/${s}`, `${ramp}/${s}`));
  raw.card.appendChild(row);
}
const misc = box("misc", { dir: "row", gap: 8 });
for (const n of ["white", "black", "alpha/black-8", "alpha/black-10", "alpha/black-14"]) misc.appendChild(await swatch(`color/${n}`, n));
raw.card.appendChild(misc);
await burst(c, raw.wrap);

const groups = {};
for (const name of Object.keys(V)) {
  if (V[name].resolvedType !== "COLOR" || name.startsWith("color/")) continue;
  const g = name.split("/").slice(0, name.startsWith("feedback/") ? 2 : 1).join("/");
  (groups[g] ||= []).push(name);
}
// semantic: one card, one row per group, same column grid as the raw palette
const sem = await card(body, "Semantic", "Aliases");
for (const [g, names] of Object.entries(groups)) {
  const row = box(g, { dir: "row", gap: 8 });
  for (const n of names) row.appendChild(await swatch(n, n));
  sem.card.appendChild(row);
}
await burst(c, sem.wrap);
c.done();
return { groups: Object.keys(groups).length };
