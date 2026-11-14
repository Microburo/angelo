// CUI Button and Icon button: Type (Primary, Secondary, Outline, Ghost, Danger) × State (Rest, Hover,
// Pressed, Focus, Disabled) × Size (sm 30, md 36, lg 44), radius/button = control radius 10.
// Focus = Rest look + Focus/ring effect (2 px gap, 2 px blue ring).
for (const n of ["Button", "Icon button"]) setNamed(n)?.remove();
const ICONS = ["plus", "arrow-right", "chevron-down", "check", "search", "x", "settings", "heart", "download", "trash-2", "copy", "pencil"];
const icons = [];
for (const n of ICONS) icons.push(await H.icon(n, ICON));
const TYPES = ["Primary", "Secondary", "Outline", "Ghost", "Danger"];
const STATES = ["Rest", "Hover", "Pressed", "Focus", "Disabled"];
const SIZE = {
  sm: { h: 30, px: 12, font: "Paragraph/Small Medium", icon: 16 },
  md: { h: 36, px: 16, font: "Paragraph/Small Medium", icon: 16 },
  lg: { h: 44, px: 20, font: "Paragraph/Medium Medium", icon: 18 },
};
const FILL = {
  Primary: ["primary/default", "primary/hover", "primary/active"],
  Secondary: ["secondary/default", "secondary/hover", "secondary/active"],
  Outline: ["bg/surface", "interaction/hover", "interaction/active"],
  Ghost: [undefined, "interaction/hover", "interaction/active"],
  Danger: ["danger/default", "danger/hover", "danger/active"],
};
const look = (type, state) => {
  const i = { Hover: 1, Pressed: 2 }[state] || 0;
  if (state === "Disabled") return { fill: type === "Ghost" ? undefined : "interaction/disabled", stroke: type === "Outline" ? "border/default" : undefined, text: "text/disabled" };
  const onDark = type === "Primary" || type === "Danger";
  return { fill: FILL[type][i], stroke: type === "Outline" ? "border/strong" : undefined, text: onDark ? "text/on-primary" : "text/primary" };
};
const focus = async (b, state) => {
  if (state === "Focus") await b.setEffectStyleIdAsync(ES["Focus/ring"].id);
};

const button = await variants("Button", { Type: TYPES, State: STATES, Size: Object.keys(SIZE) }, async ({ Type, State, Size }) => {
  const s = SIZE[Size];
  const l = look(Type, State);
  const b = box("button", { component: true, dir: "row", gap: 8, pad: [0, s.px], h: s.h, radius: "button", align: "CENTER", cross: "CENTER", fill: l.fill, stroke: l.stroke });
  await focus(b, State);
  const li = await ico("plus", s.icon, l.text, "left-icon");
  li.visible = false;
  b.appendChild(li);
  b.appendChild(await text("Button", s.font, l.text, "label"));
  const ri = await ico("chevron-down", s.icon, l.text, "right-icon");
  ri.visible = false;
  b.appendChild(ri);
  return b;
}, { cols: 15 });
wire(button, [
  { layer: "left-icon", kind: "BOOLEAN", name: "Left icon", def: false },
  { layer: "left-icon", kind: "SWAP", name: "Left icon swap", def: icons[0].id, pref: icons },
  { layer: "label", kind: "TEXT", name: "Label" },
  { layer: "right-icon", kind: "BOOLEAN", name: "Right icon", def: false },
  { layer: "right-icon", kind: "SWAP", name: "Right icon swap", def: icons[2].id, pref: icons },
]);

const iconButton = await variants("Icon button", { Type: TYPES, State: STATES, Size: Object.keys(SIZE) }, async ({ Type, State, Size }) => {
  const s = SIZE[Size];
  const l = look(Type, State);
  const b = box("icon-button", { component: true, dir: "row", w: s.h, h: s.h, radius: "icon-button", align: "CENTER", cross: "CENTER", fill: l.fill, stroke: l.stroke });
  await focus(b, State);
  b.appendChild(await ico("plus", s.icon + 2, l.text, "icon"));
  return b;
}, { cols: 15 });
wire(iconButton, [{ layer: "icon", kind: "SWAP", name: "Icon", def: icons[0].id, pref: icons }]);

const c = await H.cursor();
const body = null;

const bc = await card(body, "Button", "Type × State");
for (const Type of TYPES) {
  const row = box(Type, { dir: "row", gap: 16, cross: "CENTER" });
  for (const State of STATES) row.appendChild(inst(button, { Type, State, Size: "md" }, { Label: State === "Rest" ? Type : State }));
  bc.card.appendChild(row);
}
const sizes = box("sizes", { dir: "row", gap: 12, cross: "CENTER" });
sizes.appendChild(inst(button, { Size: "sm" }, { Label: "Small" }));
sizes.appendChild(inst(button, { Size: "md", Type: "Secondary" }, { Label: "Options", "Left icon": true, "Left icon swap": icons[6].id, "Right icon": true }));
sizes.appendChild(inst(button, { Size: "lg" }, { Label: "Download", "Left icon": true, "Left icon swap": icons[8].id }));
bc.card.appendChild(await text("Size · icons", "Paragraph/Mini Regular", "text/secondary", "sub"));
bc.card.appendChild(sizes);
await burst(c, bc.wrap);

const ic = await card(body, "Icon button", "Type × State · Size");
for (const Type of TYPES) {
  const row = box(Type, { dir: "row", gap: 16, cross: "CENTER" });
  for (const State of STATES) row.appendChild(inst(iconButton, { Type, State, Size: "md" }));
  for (const Size of ["sm", "lg"]) row.appendChild(inst(iconButton, { Type, Size }));
  ic.card.appendChild(row);
}
await burst(c, ic.wrap);
c.done();
return { button: button.children.length, iconButton: iconButton.children.length };
