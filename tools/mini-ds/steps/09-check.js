// Lays the element frames out one row per tier (TIERS order, 40 apart, top aligned), the masters 300 after,
// then checks the success criteria: absolute children, solid paints not bound to a variable, texts without a text style.
const els = elements().sort((a, b) => ELEMENTS.indexOf(a.name) - ELEMENTS.indexOf(b.name));
// one row per TIERS entry, cards 40 apart, 400 between rows; cards outside TIERS close the last row
// within a row, TIERS order wins over ELEMENTS order
const rows = TIERS.map((names) => els.filter((r) => names.includes(r.name)).sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name)));
rows[rows.length - 1].push(...els.filter((r) => !TIERS.flat().includes(r.name)));
let y = 0, maxX = 0;
for (const row of rows) {
  if (!row.length) continue;
  let x = 0, rowH = 0;
  for (const r of row) {
    r.x = x;
    r.y = y;
    x += r.width + 40;
    rowH = Math.max(rowH, r.height);
  }
  maxX = Math.max(maxX, x);
  y += rowH + 400;
}
const m = rootNamed(MASTERS);
// masters placed next to the cards only when they share the board page
if (mastersHere(m)) {
  m.x = maxX + 260;
  m.y = 0;
}
const roots = [...els, m];
const out = { nodes: 0, instances: 0, absolute: [], unboundPaint: [], noStyle: [], components: 0, sets: 0 };
const todo = [...roots];
while (todo.length) {
  const n = todo.pop();
  out.nodes++;
  if (n.type === "INSTANCE") out.instances++;
  if (n.type === "COMPONENT_SET") out.sets++;
  if (n.type === "COMPONENT") out.components++;
  if (n.layoutPositioning === "ABSOLUTE") out.absolute.push(n.name);
  for (const k of ["fills", "strokes"]) {
    const ps = n[k];
    if (Array.isArray(ps) && ps.some((p) => p.type === "SOLID" && p.visible !== false && !p.boundVariables?.color) && !roots.includes(n)) out.unboundPaint.push(`${n.name} ${k}`);
  }
  if (n.type === "TEXT" && !n.textStyleId) out.noStyle.push(n.name);
  if ("children" in n && n.type !== "INSTANCE") todo.push(...n.children);
}
for (const k of ["absolute", "unboundPaint", "noStyle"]) out[k] = { count: out[k].length, sample: out[k].slice(0, 6) };
figma.viewport.scrollAndZoomIntoView(roots);
return out;
