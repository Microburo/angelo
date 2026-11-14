// In-place patch: semantic colors in one card, one row per group, on the same column grid as the
// raw palette (swatches 104 wide, gap 8). Replaces the former row of one card per group.
const sw = rootNamed(MASTERS).findChild((n) => n.name === "Board / Swatch");
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
const swatch = async (varName) => {
  const hex = await hexOf(vr(varName));
  const i = inst(sw, {}, { Name: varName, Value: hex });
  i.findChild((n) => n.name === "chip").fills = [solid(varName)];
  if (hex === "#FFFFFF") stroke(i.findChild((n) => n.name === "chip"), "border/default");
  return i;
};

const c = await H.cursor();
const root = rootNamed("Mini DS / Colors");
const body = root.findChild((n) => n.name === "body");
c.ring.follow(root);
body.findChild((n) => n.name === "semantic")?.remove();

const groups = {};
for (const name of Object.keys(V)) {
  if (V[name].resolvedType !== "COLOR" || name.startsWith("color/")) continue;
  const g = name.split("/").slice(0, name.startsWith("feedback/") ? 2 : 1).join("/");
  (groups[g] ||= []).push(name);
}
const sem = await card(body, "Semantic", "Aliases");
for (const [g, names] of Object.entries(groups)) {
  const row = box(g, { dir: "row", gap: 8 });
  for (const n of names) row.appendChild(await swatch(n));
  sem.card.appendChild(row);
}
await c.reveal(sem.wrap);
c.done();
return { groups: Object.keys(groups).length, swatches: Object.values(groups).flat().length };
