// Foundations board: spacing bars (width bound), radius tiles, elevation cards, grid frames.
const c = await H.cursor();
const body = null;

const label = async (a, b) => {
  const m = box("meta", { gap: 2 });
  m.appendChild(await text(a, "Paragraph/Mini Medium", "text/primary", "name"));
  m.appendChild(await text(b, "Paragraph/Mini Regular", "text/secondary", "value"));
  return m;
};

const sp = await card(body, "Spacing", "space/*");
const spaceNum = (n) => +n.split("/")[1];
for (const name of Object.keys(V).filter((n) => /^space\/\d+$/.test(n)).sort((a, b) => spaceNum(a) - spaceNum(b))) {
  const row = box(name, { dir: "row", gap: 16, cross: "CENTER" });
  add(row, await label(name, `${V[name].valuesByMode[Object.keys(V[name].valuesByMode)[0]]} px`), { w: 80 });
  const bar = figma.createRectangle();
  bar.name = "bar";
  bar.fills = [solid("primary/subtle")];
  bar.strokes = [solid("border/strong")];
  bar.strokeAlign = "INSIDE";
  row.appendChild(bar);
  bar.resize(10, 16);
  bar.setBoundVariable("width", vr(name));
  sp.card.appendChild(row);
}
await burst(c, sp.wrap);

const rd = await card(body, "Radius", "radius/*");
const tiles = box("tiles", { dir: "row", gap: 24 });
rd.card.appendChild(tiles);
for (const name of Object.keys(V).filter((n) => /^radius\/\d+$/.test(n))) {
  const t = box(name, { gap: 8 });
  add(t, box("tile", { fill: "primary/subtle", stroke: "border/strong", radius: +name.split("/")[1] }), { w: 64, h: 64 });
  t.appendChild(await label(name, name.split("/")[1] + " px"));
  tiles.appendChild(t);
}
await radiusComponents(rd.card, label);

const el = await card(body, "Elevation", "Elevation/*", { gap: 32 });
const els = box("cards", { dir: "row", gap: 32 });
el.card.appendChild(els);
for (const k of ["sm", "md", "lg"]) {
  const t = box(k, { fill: "bg/surface", radius: 12, pad: 24, gap: 4, w: 160, h: 120, align: "MAX" });
  await t.setEffectStyleIdAsync(ES[`Elevation/${k}`].id);
  t.appendChild(await label(`Elevation/${k}`, ["y 1 · blur 2 · 0", "y 4 · blur 12 · −2", "y 12 · blur 32 · −6"][["sm", "md", "lg"].indexOf(k)]));
  els.appendChild(t);
}
await burst(c, rd.wrap);
await burst(c, el.wrap);

const gr = await card(body, "Grid", "Grid/*");
for (const [name, w] of [["Grid/Desktop 1440", 1440], ["Grid/Mobile 430", 430]]) {
  const g = box(name, { gap: 8 });
  g.appendChild(await label(name, w === 1440 ? "12 col · margin 20 · gutter 20" : "6 col · margin 12 · gutter 4"));
  const f = add(g, box("frame", { fill: "bg/subtle" }), { w, h: 200 });
  await f.setGridStyleIdAsync(GS[name].id);
  gr.card.appendChild(g);
}
await burst(c, gr.wrap);
c.done();
return { ok: true };
