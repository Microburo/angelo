// CUI actions: Button group (Group button, Group divider), Copy button, Hold button, Split button, Toggle group
// (Toggle item), Confirm button, Status button, Reaction, Speed dial (Speed dial action), Theme switcher and
// toggle, User menu (trigger, Panel separator, panel), Swipe actions (Swipe action, Swipe row), board cards.
const NEW = [
  "Group button", "Group divider", "Button group", "Copy button", "Hold button", "Split button", "Toggle item", "Toggle group",
  "Confirm button", "Status button", "Reaction", "Speed dial action", "Speed dial", "Theme switcher", "Theme toggle",
  "User menu trigger", "Panel separator", "User menu", "Swipe action", "Swipe row",
];
for (const n of NEW) setNamed(n)?.remove();
const NAMES = [
  "bold", "italic", "underline", "code", "copy", "check", "trash-2", "triangle-alert", "save", "loader-circle", "circle-alert",
  "download", "play", "chevron-down", "chevrons-up-down", "list", "layout-grid", "calendar", "thumbs-up", "heart", "smile",
  "party-popper", "plus", "x", "file-text", "image", "sun", "moon", "monitor", "user-round", "credit-card", "settings", "log-out", "archive",
];
const IC = {};
for (const n of NAMES) IC[n] = await H.icon(n, ICON);
const pick = (...n) => n.map((k) => IC[k]);
const button = setNamed("Button");
const iconButton = setNamed("Icon button");
const avatar = setNamed("Avatar");
const menuItem = setNamed("Menu item");
const MS = rootNamed(MASTERS);
// v1: only the cards ported from cui (ELEMENTS) and their masters are built (cui-only parts under if (CUI))
const keep = (caption) => CUI || ELEMENTS.includes(caption);
let gbtn, gdiv, bgroup, copyBtn, holdBtn, confirmBtn, statusBtn, STATUS, tgroup, TONE, sact, srow;

if (CUI) {
  // ---- Button group: bordered row of Group button items split by Group divider --------------------------------
  gbtn = await variants("Group button", { State: ["Default", "Hover"] }, async ({ State }) => {
    const b = box("group-button", { component: true, dir: "row", gap: 8, pad: [0, 16], h: 34, align: "CENTER", cross: "CENTER", fill: State === "Hover" ? "interaction/hover" : undefined });
    b.appendChild(await ico("bold", 16, "text/primary", "icon"));
    b.appendChild(await text("Label", "Paragraph/Small Medium", "text/primary", "label"));
    return b;
  }, { cols: 2 });
  wire(gbtn, [
    { layer: "icon", kind: "SWAP", name: "Icon", def: IC.bold.id, pref: pick("bold", "italic", "underline", "code") },
    { layer: "label", kind: "TEXT", name: "Label" },
  ]);
  gdiv = box("Group divider", { component: true, w: 1, h: 34, fill: "border/strong" });
  MS.appendChild(gdiv);
  bgroup = box("Button group", { component: true, dir: "row", pad: 1, radius: "button", stroke: "border/strong", fill: "bg/surface", clip: true });
  [["bold", "Bold"], ["italic", "Italic"], ["underline", "Underline"]].forEach(([ic, label], i) => {
    if (i) add(bgroup, gdiv.createInstance(), { h: "fill" });
    const it = inst(gbtn, {}, { Icon: IC[ic].id, Label: label });
    it.name = "item-" + (i + 1);
    bgroup.appendChild(it);
  });
  MS.appendChild(bgroup);

  // ---- Copy button: ghost icon button, a check once copied -----------------------------------------------------
  copyBtn = await variants("Copy button", { State: ["Idle", "Copied"] }, async ({ State }) => {
    const b = box("copy-button", { component: true, dir: "row" });
    const i = inst(iconButton, { Type: "Ghost", Size: "md" }, { Icon: (State === "Copied" ? IC.check : IC.copy).id });
    i.name = "button";
    b.appendChild(i);
    return b;
  }, { cols: 2 });

  // ---- Pill action buttons (Hold, Confirm, Status): 36 px pill, optional progress line along the bottom edge -----
  // look: { fill, fg, icon, label, line (bar color), bar (bar width) }
  async function pill(name, l) {
    const b = box(name, { component: true, h: CTRL, radius: "button", fill: l.fill, clip: true });
    const row = box("content", { dir: "row", gap: 8, pad: [0, 16], align: "CENTER", cross: "CENTER" });
    if (l.icon) row.appendChild(await ico(l.icon, 16, l.fg, "icon"));
    row.appendChild(await text(l.label, "Paragraph/Small Medium", l.fg, "label"));
    add(b, row, { w: "fill", h: "fill" });
    const track = box("line", { dir: "row" });
    add(track, box("bar", { fill: l.line || "danger/active" }), { w: l.bar || 60, h: "fill" });
    add(b, track, { w: "fill", h: 3 });
    track.visible = !!l.line;
    return b;
  }
  holdBtn = await variants("Hold button", { Progress: ["Idle", "Holding"] }, ({ Progress }) =>
    pill("hold-button", { fill: "danger/default", fg: "text/on-primary", icon: "trash-2", label: "Hold to delete", line: Progress === "Holding" ? "danger/active" : undefined, bar: 64 }), { cols: 2 });
  wire(holdBtn, [
    { layer: "label", kind: "TEXT", name: "Label" },
    { layer: "icon", kind: "SWAP", name: "Icon", def: IC["trash-2"].id, pref: pick("trash-2", "x", "archive") },
  ]);

  // ---- Confirm button: Idle (secondary) then Armed (danger, countdown line) -------------------------------------
  confirmBtn = await variants("Confirm button", { State: ["Idle", "Armed"] }, ({ State }) =>
    State === "Idle"
      ? pill("confirm-button", { fill: "secondary/default", fg: "text/primary", icon: "trash-2", label: "Delete project" })
      : pill("confirm-button", { fill: "danger/default", fg: "text/on-primary", icon: "triangle-alert", label: "Click to confirm", line: "feedback/error/subtle", bar: 90 }), { cols: 2 });
  wire(confirmBtn, [{ layer: "label", kind: "TEXT", name: "Label" }]);

  // ---- Status button: idle, busy (spinner), success, error ------------------------------------------------------
  STATUS = {
    Idle: { fill: "primary/default", icon: "save", label: "Save changes" },
    Busy: { fill: "primary/hover", icon: "loader-circle", label: "Saving..." },
    Success: { fill: "feedback/success/default", icon: "check", label: "Saved" },
    Error: { fill: "danger/default", icon: "circle-alert", label: "Failed" },
  };
  statusBtn = await variants("Status button", { State: Object.keys(STATUS) }, ({ State }) => pill("status-button", { ...STATUS[State], fg: "text/on-primary" }), { cols: 4 });
  wire(statusBtn, [{ layer: "label", kind: "TEXT", name: "Label" }]);
}

// ---- Split button: main action, divider, chevron part -----------------------------------------------------------
const SPLIT = {
  Primary: { fill: "primary/default", fg: "text/on-primary", div: "primary/active", open: "primary/hover" },
  Secondary: { fill: "secondary/default", fg: "text/primary", div: "border/strong", open: "secondary/hover" },
  ...(CUI ? { Outline: { fill: "bg/surface", fg: "text/primary", div: "border/default", open: "interaction/hover", stroke: "border/strong" } } : {}),
};
const split = await variants("Split button", { Variant: Object.keys(SPLIT), State: ["Rest", "Open"] }, async ({ Variant, State }) => {
  const s = SPLIT[Variant];
  const b = box("split-button", { component: true, dir: "row", h: CTRL, radius: "button", fill: s.fill, stroke: s.stroke, clip: true, cross: "CENTER" });
  const main = box("main", { dir: "row", gap: 8, pad: [0, 16], align: "CENTER", cross: "CENTER" });
  main.appendChild(await ico("save", 16, s.fg, "icon"));
  main.appendChild(await text("Save", "Paragraph/Small Medium", s.fg, "label"));
  add(b, main, { h: "fill" });
  const wrap = box("divider", { pad: [8, 0] });
  add(wrap, box("line", { fill: s.div }), { w: "fill", h: "fill" });
  add(b, wrap, { w: 1, h: "fill" });
  const chev = box("chevron", { dir: "row", pad: [0, 10], align: "CENTER", cross: "CENTER", fill: State === "Open" ? s.open : undefined });
  chev.appendChild(await ico("chevron-down", 16, s.fg, "chevron-icon"));
  add(b, chev, { h: "fill" });
  return b;
}, { cols: 2 });
wire(split, [
  { layer: "label", kind: "TEXT", name: "Label" },
  { layer: "icon", kind: "BOOLEAN", name: "Icon", def: true },
  { layer: "icon", kind: "SWAP", name: "Icon swap", def: IC.save.id, pref: pick("save", "download", "play") },
]);

// ---- Toggle item / Toggle group / Theme switcher ---------------------------------------------------------------------
const titem = await variants("Toggle item", { Selected: ["Off", "On"] }, async ({ Selected }) => {
  const on = Selected === "On";
  const fg = on ? "text/primary" : "text/secondary";
  const b = box("toggle-item", { component: true, dir: "row", gap: 6, pad: [0, 8], h: 30, radius: 8, align: "CENTER", cross: "CENTER", fill: on ? "bg/muted" : undefined });
  b.appendChild(await ico("bold", 16, fg, "icon"));
  b.appendChild(await text("Label", "Paragraph/Small Medium", fg, "label"));
  return b;
}, { cols: 2 });
wire(titem, [
  { layer: "icon", kind: "SWAP", name: "Icon", def: IC.bold.id, pref: pick("bold", "italic", "underline", "code", "list", "layout-grid", "calendar", "sun", "moon", "monitor") },
  { layer: "label", kind: "BOOLEAN", name: "Label", def: true },
  { layer: "label", kind: "TEXT", name: "Label text" },
]);
const tgItem = (on, icon, label) => {
  const i = inst(titem, { Selected: on ? "On" : "Off" }, { Icon: IC[icon].id, "Label text": label || "Label", Label: !!label });
  return i;
};
const tgFrame = (name) => box(name, { component: true, dir: "row", gap: 2, pad: 3, radius: 12, stroke: "border/default", fill: "bg/surface", cross: "CENTER" });
if (CUI) {
  tgroup = await variants("Toggle group", { Display: ["Icons", "Labels"] }, async ({ Display }) => {
    const b = tgFrame("toggle-group");
    const list = Display === "Icons" ? [["bold", 1], ["italic", 1], ["underline", 0], ["code", 0]] : [["list", 0, "List"], ["layout-grid", 1, "Board"], ["calendar", 0, "Calendar"]];
    list.forEach(([ic, on, label], i) => {
      const it = tgItem(!!on, ic, label);
      it.name = "item-" + (i + 1);
      b.appendChild(it);
    });
    return b;
  }, { cols: 2 });
}

const tswitch = await variants("Theme switcher", { Mode: ["Light", "Dark", "System"] }, async ({ Mode }) => {
  const b = tgFrame("theme-switcher");
  [["Light", "sun"], ["Dark", "moon"], ["System", "monitor"]].forEach(([m, ic]) => {
    const it = tgItem(m === Mode, ic);
    it.name = m.toLowerCase();
    b.appendChild(it);
  });
  return b;
}, { cols: 3 });
await slotify(tswitch, "Options");
const ttoggle = await variants("Theme toggle", { Mode: ["Light", "Dark"] }, async ({ Mode }) => {
  const b = box("theme-toggle", { component: true, dir: "row" });
  const i = inst(iconButton, { Type: CUI ? "Outline" : "Secondary", Size: "md" }, { Icon: (Mode === "Light" ? IC.sun : IC.moon).id });
  i.name = "button";
  b.appendChild(i);
  return b;
}, { cols: 2 });

// ---- Reaction: pill with icon and count, filled when active --------------------------------------------------------
const reaction = await variants("Reaction", { Active: ["Off", "On"] }, async ({ Active }) => {
  const on = Active === "On";
  const b = box("reaction", { component: true, dir: "row", gap: 6, pad: [0, 10], h: 28, radius: "chip", cross: "CENTER", fill: on ? "primary/subtle" : "bg/surface", stroke: on ? "primary/default" : "border/strong" });
  b.appendChild(await ico("thumbs-up", 16, on ? "text/primary" : "text/secondary", "icon"));
  b.appendChild(await text("12", "Paragraph/Small Medium", on ? "text/primary" : "text/secondary", "count"));
  return b;
}, { cols: 2 });
wire(reaction, [
  { layer: "icon", kind: "SWAP", name: "Icon", def: IC["thumbs-up"].id, pref: pick("thumbs-up", "heart", "smile", "party-popper") },
  { layer: "count", kind: "TEXT", name: "Count" },
]);

// ---- Speed dial: round floating button, actions fanned above it when open -----------------------------------------
const sdAction = box("Speed dial action", { component: true, dir: "row", gap: 12, cross: "CENTER" });
const sdTip = box("tip", { dir: "row", pad: [4, 8], radius: "tooltip", fill: "bg/inverse", cross: "CENTER" });
sdTip.appendChild(await text("New note", "Paragraph/Mini Medium", "text/on-primary", "label"));
sdAction.appendChild(sdTip);
const sdBtn = box("button", { dir: "row", w: 40, h: 40, radius: 999, fill: "bg/surface", stroke: "border/default", align: "CENTER", cross: "CENTER" });
await sdBtn.setEffectStyleIdAsync(ES["Elevation/sm"].id);
sdBtn.appendChild(await ico("file-text", 18, "text/primary", "icon"));
sdAction.appendChild(sdBtn);
MS.appendChild(sdAction);
wire(sdAction, [
  { layer: "label", kind: "TEXT", name: "Label" },
  { layer: "icon", kind: "SWAP", name: "Icon", def: IC["file-text"].id, pref: pick("file-text", "image", "plus") },
]);
const sdial = await variants("Speed dial", { Open: ["Off", "On"] }, async ({ Open }) => {
  const on = Open === "On";
  const b = box("speed-dial", { component: true, gap: 12, cross: "MAX" });
  if (on) {
    [["file-text", "New note"], ["image", "Upload image"]].forEach(([ic, label], i) => {
      const a = inst(sdAction, {}, { Icon: IC[ic].id, Label: label });
      a.name = "action-" + (i + 1);
      b.appendChild(a);
    });
  }
  const fab = box("fab", { dir: "row", w: 48, h: 48, radius: 999, fill: "primary/default", align: "CENTER", cross: "CENTER" });
  await fab.setEffectStyleIdAsync(ES["Elevation/md"].id);
  fab.appendChild(await ico(on ? "x" : "plus", 20, "text/on-primary", "icon"));
  b.appendChild(fab);
  return b;
}, { cols: 2 });
await slotify(sdial, "Actions", { to: 2, only: "Open=On" });

// ---- User menu: trigger (avatar, name, detail) and the account panel -----------------------------------------------
const utrig = await variants("User menu trigger", { Type: ["Full", "Compact"], State: ["Rest", "Open"] }, async ({ Type, State }) => {
  const full = Type === "Full";
  const b = box("user-menu-trigger", { component: true, dir: "row", gap: 12, pad: full ? 8 : 4, w: full ? 260 : undefined, radius: "item", cross: "CENTER", fill: State === "Open" ? "interaction/hover" : undefined });
  // full trigger shows the photo avatar, compact keeps the initials
  const av = full ? inst(avatar, { Type: "Image", Size: "md" }, { Initials: "MO" }) : inst(avatar, { Type: "Initials", Size: "lg" }, { Initials: "MO" });
  av.name = "avatar";
  b.appendChild(av);
  if (full) {
    const t = box("text");
    const head = box("head", { dir: "row", gap: 6, cross: "CENTER" });
    head.appendChild(await text("Maya Okafor", "Paragraph/Small Medium", "text/primary", "name"));
    head.appendChild(box("status", { w: 8, h: 8, radius: 999, fill: "feedback/success/default" }));
    t.appendChild(head);
    t.appendChild(await text("maya@fieldwork.studio", "Paragraph/Small Regular", "text/secondary", "detail"));
    add(b, t, { w: "fill" });
    b.appendChild(await ico("chevrons-up-down", 16, "text/secondary", "chevron"));
  }
  return b;
}, { cols: 2 });
wire(utrig, [
  { layer: "name", kind: "TEXT", name: "Name" },
  { layer: "detail", kind: "TEXT", name: "Detail" },
  { layer: "status", kind: "BOOLEAN", name: "Status", def: true },
]);
const psep = box("Panel separator", { component: true, pad: [4, 4], w: 228 });
add(psep, box("line", { fill: "border/default" }), { w: "fill", h: 1 });
MS.appendChild(psep);
const umenu = box("User menu", { component: true, gap: 2, pad: 6, w: 260, radius: "panel", fill: "bg/surface", stroke: "border/default" });
await umenu.setEffectStyleIdAsync(ES["Elevation/lg"].id);
const uhead = box("header", { dir: "row", gap: 12, pad: [10, 10, 8, 10], cross: "CENTER" });
const uav = inst(avatar, { Type: "Image", Size: "md" }, { Initials: "MO" });
uav.name = "avatar";
uhead.appendChild(uav);
const utext = box("text");
utext.appendChild(await text("Maya Okafor", "Paragraph/Small Medium", "text/primary", "name"));
utext.appendChild(await text("maya@fieldwork.studio", "Paragraph/Small Regular", "text/secondary", "detail"));
add(uhead, utext, { w: "fill" });
add(umenu, uhead, { w: "fill" });
add(umenu, psep.createInstance(), { w: "fill" });
[["user-round", "Profile", "Ctrl P"], ["credit-card", "Billing"], ["settings", "Settings", "Ctrl ,"]].forEach(([ic, label, sc]) => {
  const it = inst(menuItem, {}, { Icon: IC[ic].id, Label: label, Shortcut: !!sc, ...(sc ? { "Shortcut text": sc } : {}) });
  it.name = label.toLowerCase();
  add(umenu, it, { w: "fill" });
});
const psep2 = psep.createInstance();
psep2.name = "separator-2";
add(umenu, psep2, { w: "fill" });
const lo = inst(menuItem, {}, { Icon: IC["log-out"].id, Label: "Log out", Shortcut: false });
lo.name = "log-out";
add(umenu, lo, { w: "fill" });
MS.appendChild(umenu);
wire(umenu, [
  { layer: "name", kind: "TEXT", name: "Name" },
  { layer: "detail", kind: "TEXT", name: "Detail" },
]);
await slotify(umenu, "Items", { from: 2 });

if (CUI) {
  // ---- Swipe actions: action tile, and a row with its actions revealed ------------------------------------------------
  TONE = { Success: "feedback/success/default", Info: "feedback/info/default", Danger: "danger/default" };
  sact = await variants("Swipe action", { Tone: Object.keys(TONE) }, async ({ Tone }) => {
    const b = box("swipe-action", { component: true, gap: 4, w: 72, h: 56, fill: TONE[Tone], align: "CENTER", cross: "CENTER" });
    b.appendChild(await ico("check", 18, "text/on-primary", "icon"));
    b.appendChild(await text("Done", "Paragraph/Mini Medium", "text/on-primary", "label"));
    return b;
  }, { cols: 3 });
  wire(sact, [
    { layer: "icon", kind: "SWAP", name: "Icon", def: IC.check.id, pref: pick("check", "archive", "trash-2") },
    { layer: "label", kind: "TEXT", name: "Label" },
  ]);
  srow = await variants("Swipe row", { State: ["Rest", "Left open", "Right open"] }, async ({ State }) => {
    const b = box("swipe-row", { component: true, dir: "row", w: 360, h: 56, radius: "item", fill: "bg/surface", stroke: "border/default", clip: true });
    if (State === "Left open") {
      const a = inst(sact, { Tone: "Success" }, { Icon: IC.check.id, Label: "Done" });
      a.name = "left-action";
      add(b, a, { h: "fill" });
    }
    const content = box("content", { dir: "row", pad: [0, 16], cross: "CENTER", clip: true });
    content.appendChild(await text("Quarterly report", "Paragraph/Small Medium", "text/primary", "title"));
    add(b, content, { w: "fill", h: "fill" });
    if (State === "Right open") {
      const a1 = inst(sact, { Tone: "Info" }, { Icon: IC.archive.id, Label: "Archive" });
      a1.name = "right-action-1";
      add(b, a1, { h: "fill" });
      const a2 = inst(sact, { Tone: "Danger" }, { Icon: IC["trash-2"].id, Label: "Delete" });
      a2.name = "right-action-2";
      add(b, a2, { h: "fill" });
    }
    return b;
  }, { cols: 3 });
  wire(srow, [{ layer: "title", kind: "TEXT", name: "Title" }]);
}

// ---- board cards ----------------------------------------------------------------------------------------------------------
const c = await H.cursor();
const body = null;
const label = (s) => text(s, "Paragraph/Mini Regular", "text/secondary", "sub");
const row = (name, items, gap = 16) => {
  const r = box(name, { dir: "row", gap, cross: "CENTER" });
  items.forEach((i) => r.appendChild(i));
  return r;
};

if (keep("Button group, copy and hold to confirm")) {
  const k1 = await card(body, "Button group, copy and hold to confirm", "Group · copy · hold");
  k1.card.appendChild(row("actions", [bgroup.createInstance(), inst(copyBtn, { State: "Idle" }), inst(holdBtn, { Progress: "Idle" })], 24));
  k1.card.appendChild(await label("Copied · holding"));
  k1.card.appendChild(row("states", [inst(copyBtn, { State: "Copied" }), inst(holdBtn, { Progress: "Holding" })], 24));
  await burst(c, k1.wrap);
}

const k2 = await card(body, "Split button", "Variant × State");
for (const State of ["Rest", "Open"]) {
  k2.card.appendChild(row(State, Object.keys(SPLIT).map((Variant) => inst(split, { Variant, State }, { Label: { Primary: "Save", Secondary: "Run", Outline: "Export" }[Variant], "Icon swap": { Primary: IC.save, Secondary: IC.play, Outline: IC.download }[Variant].id }))));
}
await burst(c, k2.wrap);

if (keep("Toggle group")) {
  const k3 = await card(body, "Toggle group", "Icons · labels");
  k3.card.appendChild(row("groups", [inst(tgroup, { Display: "Icons" }), inst(tgroup, { Display: "Labels" })], 24));
  await burst(c, k3.wrap);
}

if (keep("Confirm button")) {
  const k4 = await card(body, "Confirm button", "Idle · armed");
  k4.card.appendChild(row("states", [inst(confirmBtn, { State: "Idle" }, { Label: "Delete project" }), inst(confirmBtn, { State: "Armed" }, { Label: "Click to confirm" })]));
  await burst(c, k4.wrap);
}

if (keep("Status button")) {
  const k5 = await card(body, "Status button", "Idle · busy · success · error");
  k5.card.appendChild(row("states", Object.keys(STATUS).map((State) => inst(statusBtn, { State }, { Label: STATUS[State].label }))));
  await burst(c, k5.wrap);
}

const k6 = await card(body, "Reactions", "Active × count");
k6.card.appendChild(row("reactions", [
  inst(reaction, { Active: "On" }, { Count: "12" }),
  inst(reaction, { Active: "Off" }, { Icon: IC.heart.id, Count: "4" }),
  inst(reaction, { Active: "Off" }, { Icon: IC.smile.id, Count: "7" }),
  inst(reaction, { Active: "On" }, { Icon: IC["party-popper"].id, Count: "2" }),
], 8));
await burst(c, k6.wrap);

const k7 = await card(body, "Speed dial", "Closed · open");
k7.card.appendChild(row("states", [inst(sdial, { Open: "Off" }), inst(sdial, { Open: "On" })], 64));
await burst(c, k7.wrap);

const k8 = await card(body, "Theme switcher and toggle", "Switcher · toggle");
k8.card.appendChild(row("switchers", ["Light", "Dark", "System"].map((Mode) => inst(tswitch, { Mode })), 24));
k8.card.appendChild(row("toggles", ["Light", "Dark"].map((Mode) => inst(ttoggle, { Mode })), 24));
await burst(c, k8.wrap);

const k9 = await card(body, "User menu", "Trigger · account panel", { gap: 8 });
k9.card.appendChild(inst(utrig, { Type: "Full", State: "Open" }));
k9.card.appendChild(umenu.createInstance());
k9.card.appendChild(inst(utrig, { Type: "Compact", State: "Rest" }));
await burst(c, k9.wrap);

if (keep("Swipe actions")) {
  const k10 = await card(body, "Swipe actions", "Rest · left · right");
  for (const State of ["Rest", "Left open", "Right open"]) k10.card.appendChild(inst(srow, { State }));
  await burst(c, k10.wrap);
}
c.done();
const out = {
  groupButton: gbtn?.children.length, holdButton: holdBtn?.children.length, splitButton: split.children.length, toggleItem: titem.children.length,
  confirmButton: confirmBtn?.children.length, statusButton: statusBtn?.children.length, reaction: reaction.children.length,
  userMenuTrigger: utrig.children.length, swipeRow: srow?.children.length, cards: CUI ? 10 : 5,
};
return out;
