// In-place patch: Avatar gets Type=Initials inverse (bg/inverse fill, text/on-primary initials),
// one variant per size, cloned from Initials; the Avatar card shows the new row.
const set = setNamed("Avatar");
const made = [];
for (const Size of ["sm", "md", "lg"]) {
  const name = `Type=Initials inverse, Size=${Size}`;
  set.findChild((n) => n.name === name)?.remove();
  const src = set.findChild((n) => n.name === `Type=Initials, Size=${Size}`);
  const v = src.clone();
  set.appendChild(v);
  v.name = name;
  v.fills = [solid("bg/inverse")];
  for (const t of own(v, "initials")) t.fills = [solid("text/on-primary")];
  made.push(v);
}
const ak = elements().find((n) => n.name === "Avatar");
const row = ak.findChild((n) => n.name === "avatars");
for (const n of row.children.filter((n) => n.name.startsWith("Type=Initials inverse"))) n.remove();
for (const Size of ["sm", "md", "lg"]) row.appendChild(inst(set, { Type: "Initials inverse", Size }));
return { variants: made.map((v) => v.name), row: row.children.length };
