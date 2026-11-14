// CUI dropdown menu: Menu item (Tone × State, icon, label, shortcut), Menu (section label, items,
// separator, danger item on a floating panel), board card with its trigger button.
for (const n of ["Menu item", "Menu"]) setNamed(n)?.remove();
const button = setNamed("Button");
const ICONS = ["pencil", "copy", "trash-2", "settings", "download", "user-round"];
const icons = [];
for (const n of ICONS) icons.push(await H.icon(n, ICON));

const item = await variants("Menu item", { Tone: ["Default", "Danger"], State: ["Default", "Hover"] }, async ({ Tone, State }) => {
  const danger = Tone === "Danger";
  const fg = danger ? "feedback/error/text" : "text/primary";
  const b = box("menu-item", { component: true, dir: "row", gap: 10, pad: [8, 10], w: 228, radius: 8, cross: "CENTER", fill: State === "Hover" ? (danger ? "feedback/error/subtle" : "interaction/hover") : undefined });
  b.appendChild(await ico(danger ? "trash-2" : "pencil", 18, danger ? fg : "text/secondary", "icon"));
  add(b, await text(danger ? "Delete" : "Rename", "Paragraph/Small Regular", fg, "label"), { w: "fill" });
  const sc = await text("F2", "Paragraph/Small Regular", "text/secondary", "shortcut");
  sc.visible = !danger;
  b.appendChild(sc);
  return b;
}, { cols: 2 });
wire(item, [
  { layer: "icon", kind: "SWAP", name: "Icon", def: icons[0].id, pref: icons },
  { layer: "label", kind: "TEXT", name: "Label" },
  { layer: "shortcut", kind: "BOOLEAN", name: "Shortcut", def: true },
  { layer: "shortcut", kind: "TEXT", name: "Shortcut text" },
]);

const menu = box("Menu", { component: true, gap: 2, pad: 6, radius: "panel", fill: "bg/surface", stroke: "border/default" });
await menu.setEffectStyleIdAsync(ES["Elevation/lg"].id);
const sec = box("section", { dir: "row", pad: [6, 10, 4, 10] });
sec.appendChild(await text("Project", "Paragraph/Small Medium", "text/secondary", "section-label"));
add(menu, sec, { w: "fill" });
menu.appendChild(inst(item, { State: "Hover" }, { Label: "Rename", "Shortcut text": "F2" }));
menu.appendChild(inst(item, {}, { Label: "Duplicate", "Shortcut text": "Ctrl D", Icon: icons[1].id }));
const sep = box("separator", { pad: [4, 4] });
add(sep, box("line", { fill: "border/default" }), { w: "fill", h: 1 });
add(menu, sep, { w: "fill" });
menu.appendChild(inst(item, { Tone: "Danger" }, { Label: "Delete", Shortcut: false, Icon: icons[2].id }));
rootNamed(MASTERS).appendChild(menu);
wire(menu, [
  { layer: "section", kind: "BOOLEAN", name: "Section", def: true },
  { layer: "section-label", kind: "TEXT", name: "Section label" },
]);
await slotify(menu, "Items", { from: 1 });

const c = await H.cursor();
const body = null;
const k = await card(body, "Menu", "Trigger · items · danger", { gap: 8 });
k.card.appendChild(inst(button, { Type: "Secondary", Size: "md" }, { Label: "Options", "Left icon": true, "Left icon swap": icons[3].id, "Right icon": true }));
k.card.appendChild(menu.createInstance());
await burst(c, k.wrap);
c.done();
return { menuItem: item.children.length, menu: menu.children.length };
