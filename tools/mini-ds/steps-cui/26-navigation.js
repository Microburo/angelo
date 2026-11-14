// CUI navigation: Sidebar (Nav item), Breadcrumb (Breadcrumb item), Pagination (Page button), Stepper (Step, Step connector),
// Table of contents (TOC item), App chrome: Menu bar (Menu bar item, Menu bar menu), Toolbar (Toolbar separator), Document
// tabs (Document tab), Status bar (Status item, Status progress), board cards.
const NEW = [
  "Nav item", "Sidebar", "Breadcrumb item", "Breadcrumb", "Page button", "Pagination", "Step", "Step connector", "Stepper",
  "TOC item", "Table of contents", "Menu bar item", "Menu bar", "Menu bar menu", "Toolbar separator", "Toolbar",
  "Document tab", "Document tabs", "Status item", "Status progress", "Status bar",
];
for (const n of NEW) setNamed(n)?.remove();
const ICONS = [
  "inbox", "folder", "calendar", "settings", "check", "chevron-right", "chevron-left", "ellipsis", "file-text", "code", "x",
  "git-branch", "bell", "folder-open", "save", "plus", "undo-2", "redo-2", "bold", "italic", "underline", "list", "link", "image",
  "play", "share-2",
];
const IC = {};
for (const n of ICONS) IC[n] = await H.icon(n, ICON);
const pick = (...n) => n.map((k) => IC[k]);
const button = setNamed("Button");
const iconButton = setNamed("Icon button");
const menuItem = setNamed("Menu item");
const MS = rootNamed(MASTERS);

// ---- Nav item: icon, label, optional trailing count; selected = shared highlight on the item -----------------------
const navItem = await variants("Nav item", { State: ["Default", "Hover", "Selected"] }, async ({ State }) => {
  const on = State === "Selected";
  const fg = on ? "text/primary" : "text/secondary";
  const b = box("nav-item", { component: true, dir: "row", gap: 12, pad: [8, 12], w: 240, radius: "item", cross: "CENTER", fill: on ? "interaction/active" : State === "Hover" ? "interaction/hover" : undefined });
  b.appendChild(await ico("inbox", 18, State === "Hover" ? "text/primary" : fg, "icon"));
  add(b, await text("Inbox", on ? "Paragraph/Small Medium" : "Paragraph/Small Regular", State === "Hover" ? "text/primary" : fg, "label"), { w: "fill" });
  const n = await text("12", "Paragraph/Small Regular", "text/secondary", "count");
  n.visible = false;
  b.appendChild(n);
  return b;
}, { cols: 3 });
wire(navItem, [
  { layer: "icon", kind: "SWAP", name: "Icon", def: IC.inbox.id, pref: pick("inbox", "folder", "calendar", "settings") },
  { layer: "label", kind: "TEXT", name: "Label" },
  { layer: "count", kind: "BOOLEAN", name: "Count", def: false },
  { layer: "count", kind: "TEXT", name: "Count text" },
]);

// Sidebar: section label over the items, one selected
const sidebar = box("Sidebar", { component: true, gap: 4, pad: 8, w: 256, radius: "panel", fill: "bg/subtle" });
const sec = box("section", { pad: [6, 12, 6, 12] });
sec.appendChild(await text("Workspace", "Paragraph/Small Medium", "text/secondary", "section-label"));
add(sidebar, sec, { w: "fill" });
[["inbox", "Inbox", "Selected", "12"], ["folder", "Projects"], ["calendar", "Calendar"], ["settings", "Settings"]].forEach(([ic, label, State, count], i) => {
  const it = inst(navItem, { State: State || "Default" }, { Icon: IC[ic].id, Label: label, ...(count ? { Count: true, "Count text": count } : {}) });
  it.name = "item-" + (i + 1);
  add(sidebar, it, { w: "fill" });
});
MS.appendChild(sidebar);
wire(sidebar, [{ layer: "section-label", kind: "TEXT", name: "Section label" }]);
await slotify(sidebar, "Items", { from: 1 });


// ---- cui only: breadcrumb, pagination, stepper, table of contents, app chrome ----------------------------------------
let crumb, breadcrumb, page, pagination, step, connector, stepper, toc, contents, barItem, menubar, dropdown, tsep, toolbar, docTab, docTabs, statusItem, sprog, statusbar;
if (CUI) {
  // ---- Breadcrumb: items split by a chevron, the last one is the current page ---------------------------------------------
  crumb = await variants("Breadcrumb item", { Current: ["Off", "On"] }, async ({ Current }) => {
    const on = Current === "On";
    const b = box("breadcrumb-item", { component: true, dir: "row", cross: "CENTER" });
    b.appendChild(await text("Home", on ? "Paragraph/Medium Medium" : "Paragraph/Medium Regular", on ? "text/primary" : "text/secondary", "label"));
    return b;
  }, { cols: 2 });
  wire(crumb, [{ layer: "label", kind: "TEXT", name: "Label" }]);
  breadcrumb = box("Breadcrumb", { component: true, dir: "row", gap: 12, cross: "CENTER" });
  for (const [i, label] of ["Home", "Projects", "CUI"].entries()) {
    if (i) breadcrumb.appendChild(await ico("chevron-right", 16, "text/placeholder", "separator-" + i));
    const it = inst(crumb, { Current: i === 2 ? "On" : "Off" }, { Label: label });
    it.name = "item-" + (i + 1);
    breadcrumb.appendChild(it);
  }
  MS.appendChild(breadcrumb);

  // ---- Pagination: previous, page buttons (one selected), ellipsis, next --------------------------------------------------------
  page = await variants("Page button", { Selected: ["Off", "On"] }, async ({ Selected }) => {
    const on = Selected === "On";
    const b = box("page-button", { component: true, dir: "row", w: 30, h: 30, radius: "button", align: "CENTER", cross: "CENTER", fill: on ? "interaction/active" : undefined });
    b.appendChild(await text("1", on ? "Paragraph/Medium Medium" : "Paragraph/Medium Regular", on ? "text/primary" : "text/secondary", "label"));
    return b;
  }, { cols: 2 });
  wire(page, [{ layer: "label", kind: "TEXT", name: "Label" }]);
  pagination = box("Pagination", { component: true, dir: "row", gap: 4, cross: "CENTER" });
  {
    const prev = inst(iconButton, { Type: "Ghost", Size: "sm" }, { Icon: IC["chevron-left"].id });
    prev.name = "previous";
    pagination.appendChild(prev);
    ["1", "2", "3", "4"].forEach((n) => {
      const p = inst(page, { Selected: n === "3" ? "On" : "Off" }, { Label: n });
      p.name = "page-" + n;
      pagination.appendChild(p);
    });
    const gap = box("gap", { dir: "row", w: 30, h: 30, align: "CENTER", cross: "CENTER" });
    gap.appendChild(await ico("ellipsis", 16, "text/secondary", "ellipsis"));
    pagination.appendChild(gap);
    const last = inst(page, {}, { Label: "10" });
    last.name = "page-10";
    pagination.appendChild(last);
    const next = inst(iconButton, { Type: "Ghost", Size: "sm" }, { Icon: IC["chevron-right"].id });
    next.name = "next";
    pagination.appendChild(next);
  }
  MS.appendChild(pagination);

  // ---- Stepper: numbered circles (done = check) with labels, joined by connectors ---------------------------------------
  step = await variants("Step", { State: ["Done", "Current", "Upcoming"] }, async ({ State }) => {
    const b = box("step", { component: true, dir: "row", gap: 8, cross: "CENTER" });
    const circle = box("circle", {
      dir: "row", w: 24, h: 24, radius: 999, align: "CENTER", cross: "CENTER",
      fill: State === "Done" ? "primary/default" : undefined,
      stroke: State === "Done" ? undefined : State === "Current" ? "primary/default" : "border/input",
      sw: 1.5,
    });
    if (State === "Done") circle.appendChild(await ico("check", 14, "text/on-primary", "check"));
    else circle.appendChild(await text("2", "Paragraph/Mini Medium", State === "Current" ? "text/primary" : "text/secondary", "number"));
    b.appendChild(circle);
    b.appendChild(await text("Step", State === "Current" ? "Paragraph/Medium Medium" : "Paragraph/Medium Regular", State === "Upcoming" ? "text/secondary" : "text/primary", "label"));
    return b;
  }, { cols: 3 });
  wire(step, [
    { layer: "label", kind: "TEXT", name: "Label" },
    { layer: "number", kind: "TEXT", name: "Number" },
  ]);
  connector = await variants("Step connector", { Filled: ["Off", "On"] }, ({ Filled }) =>
    box("step-connector", { component: true, w: 48, h: 2, fill: Filled === "On" ? "primary/default" : "border/default" }), { cols: 2 });
  stepper = box("Stepper", { component: true, dir: "row", gap: 12, w: 560, cross: "CENTER" });
  [["Account", "Done", "2"], ["Workspace", "Current", "2"], ["Invite", "Upcoming", "3"], ["Done", "Upcoming", "4"]].forEach(([label, State, n], i) => {
    if (i) add(stepper, Object.assign(inst(connector, { Filled: i === 1 ? "On" : "Off" }), { name: "connector-" + i }), { w: "fill" });
    const s = inst(step, { State }, { Label: label, ...(State === "Done" ? {} : { Number: n }) });
    s.name = "step-" + (i + 1);
    stepper.appendChild(s);
  });
  MS.appendChild(stepper);

  // ---- Table of contents: rail on the left (read part darker, active marker 2 px), indented entries -------------------
  toc = await variants("TOC item", { State: ["Default", "Read", "Active"], Level: ["Top", "Nested"] }, async ({ State, Level }) => {
    const active = State === "Active";
    const b = box("toc-item", { component: true, pad: [6, 0, 6, Level === "Top" ? 16 : 28], w: 220, stroke: active ? "primary/default" : State === "Read" ? "border/input" : "border/default", cross: "MIN" });
    b.strokeTopWeight = b.strokeRightWeight = b.strokeBottomWeight = 0;
    b.strokeLeftWeight = active ? 2 : 1;
    add(b, await text("Introduction", active ? "Paragraph/Small Medium" : "Paragraph/Small Regular", active ? "text/primary" : "text/secondary", "label"), { w: "fill" });
    return b;
  }, { cols: 3 });
  wire(toc, [{ layer: "label", kind: "TEXT", name: "Label" }]);
  contents = box("Table of contents", { component: true, gap: 12, w: 220 });
  add(contents, await text("On this page", "Paragraph/Small Medium", "text/secondary", "title"), { w: "fill" });
  const rail = box("entries");
  [["Introduction", "Read", "Top"], ["Install", "Read", "Top"], ["With CMake", "Read", "Nested"], ["Without CMake", "Read", "Nested"], ["First window", "Active", "Top"], ["Next steps", "Default", "Top"]].forEach(([label, State, Level], i) => {
    const it = inst(toc, { State, Level }, { Label: label });
    it.name = "entry-" + (i + 1);
    add(rail, it, { w: "fill" });
  });
  add(contents, rail, { w: "fill" });
  MS.appendChild(contents);
  wire(contents, [{ layer: "title", kind: "TEXT", name: "Title" }]);

  // ---- Menu bar: titles on a bar (hover / open fill), dropdown panel made of Menu items ---------------------------------
  barItem = await variants("Menu bar item", { State: ["Default", "Hover", "Open"] }, async ({ State }) => {
    const b = box("menu-bar-item", { component: true, dir: "row", pad: [4, 10], radius: 8, cross: "CENTER", fill: State === "Hover" ? "interaction/hover" : State === "Open" ? "interaction/active" : undefined });
    b.appendChild(await text("File", "Paragraph/Small Regular", "text/primary", "label"));
    return b;
  }, { cols: 3 });
  wire(barItem, [{ layer: "label", kind: "TEXT", name: "Label" }]);
  menubar = box("Menu bar", { component: true, dir: "row", gap: 4, pad: [6, 8], w: 560, cross: "CENTER", fill: "bg/subtle", stroke: "border/default" });
  menubar.strokeTopWeight = menubar.strokeLeftWeight = menubar.strokeRightWeight = 0;
  ["File", "Edit", "View", "Go", "Help"].forEach((label, i) => {
    const it = inst(barItem, {}, { Label: label });
    it.name = "item-" + (i + 1);
    menubar.appendChild(it);
  });
  MS.appendChild(menubar);
  dropdown = box("Menu bar menu", { component: true, gap: 2, pad: 6, radius: "panel", fill: "bg/surface", stroke: "border/default" });
  await dropdown.setEffectStyleIdAsync(ES["Elevation/lg"].id);
  dropdown.appendChild(Object.assign(inst(menuItem, { State: "Hover" }, { Label: "Open...", "Shortcut text": "Ctrl O", Icon: IC["folder-open"].id }), { name: "open" }));
  dropdown.appendChild(Object.assign(inst(menuItem, {}, { Label: "Save", "Shortcut text": "Ctrl S", Icon: IC.save.id }), { name: "save" }));
  const dsep = box("separator", { pad: [4, 4] });
  add(dsep, box("line", { fill: "border/default" }), { w: "fill", h: 1 });
  add(dropdown, dsep, { w: "fill" });
  dropdown.appendChild(Object.assign(inst(menuItem, {}, { Label: "Close window", "Shortcut text": "Ctrl Shift W", Icon: IC.x.id }), { name: "close" }));
  MS.appendChild(dropdown);

  // ---- Toolbar: small ghost icon buttons (Icon button), separators, spacer, labelled buttons at the end --------------------
  tsep = box("Toolbar separator", { component: true, dir: "row", pad: [0, 6], cross: "CENTER" });
  add(tsep, box("line", { fill: "border/strong" }), { w: 1, h: 20 });
  MS.appendChild(tsep);
  toolbar = box("Toolbar", { component: true, dir: "row", gap: 4, pad: [6, 12], w: 760, cross: "CENTER", fill: "bg/subtle", stroke: "border/default" });
  toolbar.strokeTopWeight = toolbar.strokeLeftWeight = toolbar.strokeRightWeight = 0;
  {
    const tool = (name, icon, State) => {
      const t = inst(iconButton, { Type: "Ghost", Size: "sm", ...(State ? { State } : {}) }, { Icon: IC[icon].id });
      t.name = name;
      toolbar.appendChild(t);
    };
    const sep = (n) => toolbar.appendChild(Object.assign(tsep.createInstance(), { name: "separator-" + n }));
    tool("new", "plus");
    tool("open", "folder-open");
    tool("save", "save");
    sep(1);
    tool("undo", "undo-2");
    tool("redo", "redo-2", "Disabled");
    sep(2);
    tool("bold", "bold", "Pressed");
    tool("italic", "italic");
    tool("underline", "underline");
    sep(3);
    tool("list", "list", "Pressed");
    tool("link", "link");
    tool("image", "image");
    add(toolbar, box("spacer"), { w: "fill", h: 1 });
    toolbar.appendChild(Object.assign(inst(button, { Type: "Ghost", Size: "sm" }, { Label: "Preview", "Left icon": true, "Left icon swap": IC.play.id }), { name: "preview" }));
    toolbar.appendChild(Object.assign(inst(button, { Type: "Ghost", Size: "sm" }, { Label: "Share", "Left icon": true, "Left icon swap": IC["share-2"].id }), { name: "share" }));
  }
  MS.appendChild(toolbar);

  // ---- Document tab: icon, title, dirty dot or close x; the selected tab is raised on the surface -------------------------
  docTab = await variants("Document tab", { State: ["Default", "Selected"], Dirty: ["Off", "On"] }, async ({ State, Dirty }) => {
    const sel = State === "Selected";
    const b = box("document-tab", { component: true, dir: "row", gap: 8, pad: [0, 16], h: 36, cross: "CENTER", fill: sel ? "bg/surface" : undefined, stroke: sel ? "border/default" : undefined });
    if (sel) {
      b.strokeBottomWeight = 0;
      num(b, "topLeftRadius", 10, "radius");
      num(b, "topRightRadius", 10, "radius");
    }
    b.appendChild(await ico("file-text", 16, sel ? "text/primary" : "text/secondary", "icon"));
    b.appendChild(await text("README.md", "Paragraph/Small Regular", sel ? "text/primary" : "text/secondary", "title"));
    const dot = box("dirty-dot", { w: 8, h: 8, radius: 999, fill: "text/secondary" });
    dot.visible = Dirty === "On";
    b.appendChild(dot);
    const x = await ico("x", 14, "text/secondary", "close");
    x.visible = Dirty === "Off" && sel;
    b.appendChild(x);
    return b;
  }, { cols: 2 });
  wire(docTab, [
    { layer: "icon", kind: "SWAP", name: "Icon", def: IC["file-text"].id, pref: pick("file-text", "code") },
    { layer: "title", kind: "TEXT", name: "Title" },
  ]);
  docTabs = box("Document tabs", { component: true, dir: "row", w: 720, cross: "MAX", fill: "bg/subtle", stroke: "border/default" });
  docTabs.strokeTopWeight = docTabs.strokeLeftWeight = docTabs.strokeRightWeight = 0;
  [["README.md", "file-text", "Default", "Off"], ["tile_cache.c", "code", "Selected", "On"], ["tile_cache.h", "code", "Default", "Off"], ["CHANGELOG.md", "file-text", "Default", "On"]].forEach(([title, icon, State, Dirty], i) => {
    const it = inst(docTab, { State, Dirty }, { Title: title, Icon: IC[icon].id });
    it.name = "tab-" + (i + 1);
    docTabs.appendChild(it);
  });
  MS.appendChild(docTabs);

  // ---- Status bar: 11 px items (hover fill), tone on the icon, 64 px progress, spacer pushes the rest right ------------------
  statusItem = await variants("Status item", [{ State: "Default", Tone: "Neutral" }, { State: "Hover", Tone: "Neutral" }, { State: "Default", Tone: "Success" }], async ({ State, Tone }) => {
    const hover = State === "Hover";
    const b = box("status-item", { component: true, dir: "row", gap: 6, pad: [0, 8], h: 24, radius: 6, cross: "CENTER", fill: hover ? "interaction/hover" : undefined });
    b.appendChild(await ico("git-branch", 14, Tone === "Success" ? "feedback/success/text" : "text/secondary", "icon"));
    b.appendChild(await text("main", "Paragraph/Mini Regular", hover ? "text/primary" : "text/secondary", "label"));
    return b;
  }, { cols: 3 });
  wire(statusItem, [
    { layer: "icon", kind: "BOOLEAN", name: "Icon", def: true },
    { layer: "icon", kind: "SWAP", name: "Icon swap", def: IC["git-branch"].id, pref: pick("git-branch", "check", "bell") },
    { layer: "label", kind: "TEXT", name: "Label" },
    { layer: "label", kind: "BOOLEAN", name: "Show label", def: true },
  ]);
  sprog = box("Status progress", { component: true, dir: "row", w: 64, h: 4, radius: 999, fill: "interaction/active", clip: true });
  add(sprog, box("bar", { fill: "primary/default", radius: 999 }), { w: 40, h: "fill" });
  MS.appendChild(sprog);
  statusbar = box("Status bar", { component: true, dir: "row", gap: 2, pad: [0, 8], w: 880, h: 32, cross: "CENTER", fill: "bg/subtle", stroke: "border/default" });
  statusbar.strokeBottomWeight = statusbar.strokeLeftWeight = statusbar.strokeRightWeight = 0;
  {
    const si = (name, props, variant = {}) => statusbar.appendChild(Object.assign(inst(statusItem, variant, props), { name }));
    si("branch", { Icon: true, "Icon swap": IC["git-branch"].id, Label: "main" });
    si("saved", { Icon: true, "Icon swap": IC.check.id, Label: "Saved" }, { Tone: "Success" });
    const idx = box("indexing", { dir: "row", gap: 2, cross: "CENTER" });
    idx.appendChild(Object.assign(inst(statusItem, {}, { Icon: false, Label: "Indexing 62%" }), { name: "indexing-label" }));
    idx.appendChild(sprog.createInstance());
    statusbar.appendChild(idx);
    add(statusbar, box("spacer"), { w: "fill", h: 1 });
    si("position", { Icon: false, Label: "Ln 48, Col 17" });
    si("spaces", { Icon: false, Label: "Spaces: 4" });
    si("encoding", { Icon: false, Label: "UTF-8" });
    si("language", { Icon: false, Label: "Markdown" });
    si("notifications", { Icon: true, "Icon swap": IC.bell.id, "Show label": false });
  }
  MS.appendChild(statusbar);
}

// ---- board cards ------------------------------------------------------------------------------------------------------------------
const c = await H.cursor();
const body = null;
const sub = (s) => text(s, "Paragraph/Mini Regular", "text/secondary", "sub");

const k1 = await card(body, "Sidebar navigation", "Section · items · shared highlight");
k1.card.appendChild(sidebar.createInstance());
k1.card.appendChild(await sub("Nav item · Default, Hover, Selected"));
const r1 = box("states", { gap: 4 });
["Default", "Hover", "Selected"].forEach((State) => r1.appendChild(inst(navItem, { State }, { Label: State, Icon: IC.folder.id })));
k1.card.appendChild(r1);
await burst(c, k1.wrap);

if (CUI) {
  const k2 = await card(body, "Breadcrumb, pagination and stepper", "Path · pages · steps", { gap: 32 });
  k2.card.appendChild(breadcrumb.createInstance());
  k2.card.appendChild(pagination.createInstance());
  k2.card.appendChild(stepper.createInstance());
  await burst(c, k2.wrap);

  const k3 = await card(body, "Table of contents", "Rail · active marker · levels");
  k3.card.appendChild(contents.createInstance());
  await burst(c, k3.wrap);

  const k4 = await card(body, "Menu bar", "Titles · open menu", { gap: 8 });
  const bar4 = menubar.createInstance();
  bar4.findOne((n) => n.name === "item-1" && n.type === "INSTANCE").setProperties({ State: "Open" });
  k4.card.appendChild(bar4);
  k4.card.appendChild(dropdown.createInstance());
  await burst(c, k4.wrap);

  const k5 = await card(body, "Toolbar", "Ghost buttons · toggles · separators");
  k5.card.appendChild(toolbar.createInstance());
  await burst(c, k5.wrap);

  const k6 = await card(body, "Document tabs", "Selected · dirty · default");
  k6.card.appendChild(docTabs.createInstance());
  k6.card.appendChild(await sub("Document tab · State × Dirty"));
  const r6 = box("variants", { dir: "row", gap: 16, cross: "MAX" });
  for (const State of ["Default", "Selected"]) for (const Dirty of ["Off", "On"]) r6.appendChild(inst(docTab, { State, Dirty }, { Title: `${State} · ${Dirty === "On" ? "dirty" : "saved"}` }));
  k6.card.appendChild(r6);
  await burst(c, k6.wrap);

  const k7 = await card(body, "Status bar", "Items · tone · progress");
  k7.card.appendChild(statusbar.createInstance());
  k7.card.appendChild(await sub("Status item · Default, Hover, Success"));
  const r7 = box("items", { dir: "row", gap: 16, cross: "CENTER" });
  r7.appendChild(inst(statusItem, {}, { Label: "main" }));
  r7.appendChild(inst(statusItem, { State: "Hover" }, { Label: "Hover" }));
  r7.appendChild(inst(statusItem, { Tone: "Success" }, { Label: "Saved", "Icon swap": IC.check.id }));
  k7.card.appendChild(r7);
  await burst(c, k7.wrap);
}
c.done();
return {
  navItem: navItem.children.length, page: page?.children.length, step: step?.children.length, toc: toc?.children.length,
  menuBarItem: barItem?.children.length, docTab: docTab?.children.length, statusItem: statusItem?.children.length, cards: CUI ? 7 : 1,
};
