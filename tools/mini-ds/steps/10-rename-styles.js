// In-place patch: renames existing text styles to the size names (STYLE_NAME) and the labels and
// rows of the Typography board that show them. Nothing rebuilt.
const map = {};
for (const s of Object.values(TS)) {
  const [kind] = s.name.split("/");
  const next = STYLE_NAME(kind, s.fontSize, s.fontName.style);
  if (next !== s.name) map[s.name] = next;
}
for (const [from, to] of Object.entries(map)) TS[from].name = to;
const typo = rootNamed("Mini DS / Typography");
let labels = 0;
for (const row of typo.findAll((n) => n.type === "FRAME" && map[n.name])) {
  const to = map[row.name];
  row.name = to;
  const t = row.findOne((n) => n.type === "TEXT" && n.name === "name");
  if (t) {
    t.characters = to.replace("/", " / ");
    labels++;
  }
}
return { renamed: Object.keys(map).length, labels };
