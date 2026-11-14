// Lays the element frames out one row per tier (TIERS: foundations first, then simple to composed), the masters 300 after the widest row,
// masters laid on a grid of COLS auto-layout columns (build order, balanced by height),
// then checks the success criteria: absolute children, solid paints not bound to a variable, texts without a text style.
const els = elements().sort((a, b) => ELEMENTS.indexOf(a.name) - ELEMENTS.indexOf(b.name));
// one row per TIERS entry, cards 80 apart, top aligned; 400 between rows (tiers read apart); cards outside TIERS close the last row
const rows = TIERS.map((names) => els.filter((r) => names.includes(r.name)));
rows[rows.length - 1].push(...els.filter((r) => !TIERS.flat().includes(r.name)));
let y = 0, maxX = 0;
for (const row of rows) {
  if (!row.length) continue;
  let x = 0, rowH = 0;
  for (const r of row) {
    r.x = x;
    r.y = y;
    x += r.width + 80;
    rowH = Math.max(rowH, r.height);
  }
  maxX = Math.max(maxX, x);
  y += rowH + 400;
}
const m = rootNamed(MASTERS);
if (mastersHere(m)) {
  m.x = maxX + 260;
  m.y = 0;
}
// masters grid: Board / * stay on top, sets and components flow in build order into COLS columns of about equal height
const COLS = 10;
let grid = m.findChild((n) => n.name === "columns");
const placed = grid ? grid.children.flatMap((col) => [...col.children]) : [];
const loose = m.children.filter((n) => n !== grid && !n.name.startsWith("Board / "));
const items = [...placed, ...loose];
if (!grid) {
  grid = box("columns", { dir: "row", gap: 80 });
  m.appendChild(grid);
}
for (const col of [...grid.children]) col.name = "old-" + col.name;
const cols = Array.from({ length: COLS }, (_, i) => {
  const col = box(`column-${i + 1}`, { gap: 80 });
  grid.appendChild(col);
  return col;
});
const totalH = items.reduce((s, n) => s + n.height + 80, 0);
let acc = 0;
for (const n of items) {
  const i = Math.min(COLS - 1, Math.floor((acc + n.height / 2) / (totalH / COLS)));
  cols[i].appendChild(n);
  acc += n.height + 80;
}
for (const col of [...grid.children]) if (col.name.startsWith("old-")) col.remove();
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
// leftovers of a step that failed midway: top-level nodes of the board page that are neither cards nor the masters frame
out.strays = figma.currentPage.children.filter((n) => n !== m && !n.getPluginData(ELEMENT)).map((n) => n.name);
for (const k of ["absolute", "unboundPaint", "noStyle", "strays"]) out[k] = { count: out[k].length, sample: out[k].slice(0, 6) };
figma.viewport.scrollAndZoomIntoView(mastersHere(m) ? roots : els);
return out;
