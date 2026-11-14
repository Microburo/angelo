// In-place patch: client brand ramp color/brand/50–900 in Primitives (dark khaki), shown as a row after teal on the Primitives card. Semantic aliases untouched.
const BRAND = "f7f7ef ecebd9 d9d6b3 c0bc88 a19c62 847f48 6b6639 55512f 433f27 34311f";
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const hex = (h) => ({ r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255, a: 1 });
const prim = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === "Primitives");
const pm = prim.modes[0].modeId;
const list = BRAND.split(" ");
STEPS.forEach((s, i) => {
  const name = `color/brand/${s}`;
  const v = V[name] || figma.variables.createVariable(name, prim, "COLOR");
  v.setValueForMode(pm, hex(list[i]));
  v.scopes = [];
  V[name] = v;
});

const raw = elements().find((n) => n.name === "Primitives");
raw.findChild((n) => n.name === "brand")?.remove();
const teal = raw.findChild((n) => n.name === "teal");
const row = teal.clone();
row.name = "brand";
raw.insertChild(raw.children.indexOf(teal) + 1, row);
row.children.forEach((i, k) => {
  const s = STEPS[k];
  const props = {};
  for (const key of Object.keys(i.componentProperties)) {
    if (key.startsWith("Name")) props[key] = `brand/${s}`;
    if (key.startsWith("Value")) props[key] = "#" + list[k].toUpperCase();
  }
  i.setProperties(props);
  i.findChild((n) => n.name === "chip").fills = [solid(`color/brand/${s}`)];
});
return { row: row.children.length };
