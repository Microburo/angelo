// In-place patch: largest size first, in the Typography board rows and in the local text styles list.
const rank = (name) => -TS[name].fontSize * 10 + (name.endsWith("Medium") && name.startsWith("Paragraph") ? 1 : 0);
const typo = rootNamed("Mini DS / Typography");
let moved = 0;
for (const c of typo.findAll((n) => n.type === "FRAME" && n.name === "card")) {
  const rows = c.children.filter((n) => TS[n.name]);
  if (!rows.length) continue;
  const first = c.children.indexOf(rows[0]);
  rows.sort((a, b) => rank(a.name) - rank(b.name)).forEach((r, i) => c.insertChild(first + i, r));
  moved += rows.length;
}
// styles move only inside their own folder (Paragraph, Display)
const order = [];
for (const folder of ["Paragraph", "Display"]) {
  const list = Object.keys(TS).filter((n) => n.startsWith(folder + "/")).sort((a, b) => rank(a) - rank(b));
  list.forEach((n, i) => figma.moveLocalTextStyleAfter(TS[n], i ? TS[list[i - 1]] : null));
  order.push(...list);
}
return { moved, styles: order };
