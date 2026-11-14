// Button and Icon button (Type × State × Size), then the Components board with their cards.
for (const n of ["Button", "Icon button"]) setNamed(n)?.remove();
const ICONS = ["plus", "arrow-right", "chevron-down", "check", "search", "x", "settings", "heart", "download", "trash-2"];
const icons = [];
for (const n of ICONS) icons.push(await H.icon(n, ICON));
const TYPES = ["Primary", "Secondary", "Ghost"];
const STATES = ["Default", "Hover", "Active", "Disabled"];
const SIZE = {
  sm: { h: 32, px: 12, font: "Paragraph/Small Medium", icon: 18 },
  md: { h: 40, px: 16, font: "Paragraph/Small Medium", icon: 18 },
  lg: { h: 48, px: 20, font: "Paragraph/Medium Medium", icon: 20 },
};
const look = (type, state) => {
  const dis = state === "Disabled";
  if (type === "Primary") return { fill: dis ? "primary/disabled" : { Default: "primary/default", Hover: "primary/hover", Active: "primary/active" }[state], text: dis ? "text/disabled" : "text/on-primary" };
  if (type === "Secondary") return { fill: { Default: "bg/surface", Hover: "interaction/hover", Active: "interaction/active", Disabled: "bg/surface" }[state], stroke: "border/default", text: dis ? "text/disabled" : "text/primary" };
  return { fill: { Hover: "interaction/hover", Active: "interaction/active" }[state], text: dis ? "text/disabled" : "text/primary" };
};

const button = await variants("Button", { Type: TYPES, State: STATES, Size: Object.keys(SIZE) }, async ({ Type, State, Size }) => {
  const s = SIZE[Size];
  const l = look(Type, State);
  const b = box("button", { component: true, dir: "row", gap: 8, pad: [0, s.px], h: s.h, radius: "button", align: "CENTER", cross: "CENTER", fill: l.fill, stroke: l.stroke });
  const li = await ico("plus", s.icon, l.text, "left-icon");
  li.visible = false;
  b.appendChild(li);
  b.appendChild(await text("Button", s.font, l.text, "label"));
  const ri = await ico("arrow-right", s.icon, l.text, "right-icon");
  ri.visible = false;
  b.appendChild(ri);
  return b;
}, { cols: 12 });
wire(button, [
  { layer: "left-icon", kind: "BOOLEAN", name: "Left icon", def: false },
  { layer: "left-icon", kind: "SWAP", name: "Left icon swap", def: icons[0].id, pref: icons },
  { layer: "label", kind: "TEXT", name: "Label" },
  { layer: "right-icon", kind: "BOOLEAN", name: "Right icon", def: false },
  { layer: "right-icon", kind: "SWAP", name: "Right icon swap", def: icons[1].id, pref: icons },
]);

const iconButton = await variants("Icon button", { Type: TYPES, State: STATES, Size: Object.keys(SIZE) }, async ({ Type, State, Size }) => {
  const s = SIZE[Size];
  const l = look(Type, State);
  const b = box("icon-button", { component: true, dir: "row", w: s.h, h: s.h, radius: "icon-button", align: "CENTER", cross: "CENTER", fill: l.fill, stroke: l.stroke });
  b.appendChild(await ico("plus", 20, l.text, "icon"));
  return b;
}, { cols: 12 });
wire(iconButton, [{ layer: "icon", kind: "SWAP", name: "Icon", def: icons[0].id, pref: icons }]);

// board
const c = await H.cursor();
const body = null;

const bc = await card(body, "Button", "Type × State");
for (const Type of TYPES) {
  const row = box(Type, { dir: "row", gap: 12, cross: "CENTER" });
  for (const State of STATES) row.appendChild(inst(button, { Type, State, Size: "md" }, { Label: State }));
  bc.card.appendChild(row);
}
const sizes = box("sizes", { dir: "row", gap: 12, cross: "CENTER" });
for (const Size of ["sm", "md", "lg"]) sizes.appendChild(inst(button, { Size }, { Label: `Size ${Size}`, "Left icon": true, "Right icon": Size === "lg" }));
bc.card.appendChild(await text("Size · icons", "Paragraph/Mini Regular", "text/secondary", "sub"));
bc.card.appendChild(sizes);
await burst(c, bc.wrap);

const ic = await card(body, "Icon button", "Type × State · Size");
for (const Type of TYPES) {
  const row = box(Type, { dir: "row", gap: 12, cross: "CENTER" });
  for (const State of STATES) row.appendChild(inst(iconButton, { Type, State, Size: "md" }));
  for (const Size of ["sm", "lg"]) row.appendChild(inst(iconButton, { Type, Size }));
  ic.card.appendChild(row);
}
await burst(c, ic.wrap);
c.done();
return { button: button.children.length, iconButton: iconButton.children.length };
