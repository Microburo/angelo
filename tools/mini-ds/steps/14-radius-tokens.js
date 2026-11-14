// In-place patch: adds the component radius tokens row to the existing Radius card.
const label = async (a, b) => {
  const m = box("meta", { gap: 2 });
  m.appendChild(await text(a, "Paragraph/Mini Medium", "text/primary", "name"));
  m.appendChild(await text(b, "Paragraph/Mini Regular", "text/secondary", "value"));
  return m;
};
const rd = elements().find((n) => n.name === "Radius");
const row = await radiusComponents(rd, label);
return { tiles: row.children.map((n) => n.name) };
