// CUI overlays and feedback: Popover, Dialog, Sheet, Command palette (Command item, Command hint), Hover card,
// Confirm popover, Expandable text and card, Meter, Spinner, Skeleton, Banner, Countdown (Countdown tile),
// Onboarding checklist (Checklist step, Checklist ring), Undo toast, board cards.
const NEW = [
  "Popover", "Dialog header", "Dialog footer", "Dialog", "Sheet", "Command item", "Command hint", "Command palette", "Hover card", "Confirm popover",
  "Expandable text", "Expandable card", "Meter", "Spinner", "Skeleton", "Banner", "Countdown tile", "Countdown",
  "Checklist step", "Checklist ring", "Onboarding checklist", "Undo toast",
];
for (const n of NEW) setNamed(n)?.remove();
const ICONS = [
  "list-filter", "x", "user-plus", "plus", "moon", "settings", "search", "arrow-right", "check", "credit-card", "shield", "chevron-down",
  "chevron-up", "trash-2", "archive", "clock", "user-round", "bell", "mail", "lock",
];
const IC = {};
for (const n of ICONS) IC[n] = await H.icon(n, ICON);
const pick = (...n) => n.map((k) => IC[k]);
const button = setNamed("Button");
const iconButton = setNamed("Icon button");
const avatar = setNamed("Avatar");
const badge = setNamed("Badge");
const checkbox = setNamed("Checkbox");
const keycap = setNamed("Keycap");
const item = setNamed("Item");
const field = setNamed("Field");
const progress = setNamed("Progress");
const MS = rootNamed(MASTERS);
// confirm action: Danger button in cui; v1 has no Danger type, so a Primary button painted with the error tone
const action = (danger, size, label) => {
  const b = inst(button, { Type: danger && CUI ? "Danger" : "Primary", Size: size }, { Label: label });
  if (danger && !CUI) b.fills = [solid("feedback/error/default")];
  return b;
};

// override a property of a nested instance (layer name) inside an instance or a main component
const nested = (root, layer, prop, value) => {
  const n = root.findOne((x) => x.name === layer);
  if (!n) throw new Error("no layer " + layer);
  const key = Object.keys(n.componentProperties).find((d) => d.split("#")[0] === prop);
  if (!key) throw new Error(`no property ${prop} on ${layer}`);
  n.setProperties({ [key]: value });
};
// frame with only its top or bottom border
const edge = (f, side) => {
  f.strokeTopWeight = side === "top" ? 1 : 0;
  f.strokeBottomWeight = side === "bottom" ? 1 : 0;
  f.strokeLeftWeight = f.strokeRightWeight = 0;
};
// unit-circle arc as cubic segments (clockwise on screen, y down): centre c, radius r, start angle a0, sweep
const arcPath = (c, r, a0, sweep) => {
  const n = Math.ceil(sweep / (Math.PI / 2) - 1e-9);
  const step = sweep / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const P = (t) => [c + r * Math.cos(t), c + r * Math.sin(t)];
  const T = (t) => [-Math.sin(t), Math.cos(t)];
  let d = "";
  for (let i = 0; i < n; i++) {
    const t0 = a0 + i * step;
    const t1 = t0 + step;
    const [x0, y0] = P(t0);
    const [x3, y3] = P(t1);
    const [ax, ay] = T(t0);
    const [bx, by] = T(t1);
    if (!i) d += `M ${x0} ${y0} `;
    d += `C ${x0 + k * r * ax} ${y0 + k * r * ay} ${x3 - k * r * bx} ${y3 - k * r * by} ${x3} ${y3} `;
  }
  return d.trim();
};

// ---- Skeleton: muted placeholder, three shapes -------------------------------------------------------------------
const SKEL = { Line: [240, 12, CUI ? 6 : 999], Block: [240, 96, 12], Circle: [40, 40, 999] };
const skeleton = await variants("Skeleton", { Shape: Object.keys(SKEL) }, ({ Shape }) => {
  const [w, h, r] = SKEL[Shape];
  return box("skeleton", { component: true, w, h, radius: r, fill: "bg/muted" });
}, { cols: 3 });

// ---- Spinner: track ring (frame stroke) with one arc vector --------------------------------------------------------
const SPIN = { sm: [16, 2], md: [24, 2], lg: [32, 3] };
const spinner = await variants("Spinner", { Size: Object.keys(SPIN) }, ({ Size }) => {
  const [s, sw] = SPIN[Size];
  const b = box("spinner", { component: true, dir: "row", w: s, h: s, radius: 999, align: "CENTER", cross: "CENTER", stroke: "interaction/active", sw });
  const r = s / 2 - sw / 2;
  const v = figma.createVector();
  v.name = "arc";
  v.vectorPaths = [{ windingRule: "NONE", data: arcPath(r, r, -Math.PI / 2, Math.PI * 1.5) }];
  v.strokes = [solid("icon/default")];
  v.strokeWeight = sw;
  v.strokeCap = "ROUND";
  v.fills = [];
  b.appendChild(v);
  return b;
}, { cols: 3 });

// ---- Meter: label and value over a 6 px track, bar tone turns amber then red near the limit ------------------------
const METER = { Normal: ["primary/default", 0.4], Warning: ["feedback/warning/default", 0.8], Critical: [CUI ? "danger/default" : "feedback/error/default", 0.92] };
const meter = await variants("Meter", { Level: Object.keys(METER) }, async ({ Level }) => {
  const [fill, pct] = METER[Level];
  const b = box("meter", { component: true, gap: 8, w: 320 });
  const head = box("head", { dir: "row", gap: 12, cross: "CENTER" });
  add(head, await text("Storage", "Paragraph/Small Medium", "text/primary", "label"), { w: "fill" });
  head.appendChild(await text("18.4 / 20 GB", "Paragraph/Small Regular", "text/secondary", "value"));
  add(b, head, { w: "fill" });
  const track = box("track", { dir: "row", radius: 999, fill: "interaction/active", clip: true });
  add(track, box("bar", { radius: 999, fill }), { w: Math.round(320 * pct), h: 6 });
  add(b, track, { w: "fill", h: 6 });
  return b;
}, { cols: 3 });
wire(meter, [
  { layer: "label", kind: "TEXT", name: "Label" },
  { layer: "value", kind: "TEXT", name: "Value" },
]);

// ---- Popover: floating panel with a title, options and an action ---------------------------------------------------
const popover = box("Popover", { component: true, gap: 12, pad: 16, w: 280, radius: "panel", fill: "bg/surface", stroke: "border/default" });
await popover.setEffectStyleIdAsync(ES["Elevation/lg"].id);
popover.appendChild(await text("Filters", "Paragraph/Small Medium", "text/primary", "title"));
const popOpts = box("options", { gap: 10 });
[["Only active", "Off"], ["Only mine", "On"]].forEach(([l, v], i) => {
  const o = inst(checkbox, { Checked: v }, { "Label text": l });
  o.name = "option-" + (i + 1);
  popOpts.appendChild(o);
});
add(popover, popOpts, { w: "fill" });
const popAct = box("footer", { dir: "row", align: "MAX" });
const popApply = inst(button, { Type: "Primary", Size: "sm" }, { Label: "Apply" });
popApply.name = "apply";
popAct.appendChild(popApply);
add(popover, popAct, { w: "fill" });
MS.appendChild(popover);
wire(popover, [{ layer: "title", kind: "TEXT", name: "Title" }]);
await slotify(popover, "Options", { frame: "options" });

// ---- Dialog: header (title, close) + Content slot + footer (Tone switch: Default · Danger) -------------------------
const dHeader = box("dialog-header", { component: true, dir: "row", gap: 12, cross: "CENTER", w: 392 });
dHeader.name = "Dialog header";
add(dHeader, await text("Dialog title", "Paragraph/Large Medium", "text/primary", "title"), { w: "fill" });
const dClose = inst(iconButton, { Type: "Ghost", Size: "sm" }, { Icon: IC.x.id });
dClose.name = "close";
dHeader.appendChild(dClose);
MS.appendChild(dHeader);
wire(dHeader, [
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "close", kind: "BOOLEAN", name: "Close" },
]);
const dFooter = await variants("Dialog footer", { Tone: ["Default", "Danger"], Size: ["md", "sm"] }, async ({ Tone, Size }) => {
  const md = Size === "md";
  const f = box("dialog-footer", { component: true, dir: "row", gap: 8, align: "MAX", pad: md ? [8, 0, 0, 0] : 0, w: md ? 392 : 268 });
  const cancel = inst(button, { Type: "Secondary", Size }, { Label: "Cancel" });
  cancel.name = "cancel";
  f.appendChild(cancel);
  const ok = action(Tone === "Danger", Size, "Confirm");
  ok.name = "confirm";
  f.appendChild(ok);
  return f;
}, { cols: 2 });
const dialog = box("dialog", { component: true, gap: 16, pad: 24, w: 440, radius: "surface", fill: "bg/surface", stroke: "border/default" });
dialog.name = "Dialog";
await dialog.setEffectStyleIdAsync(ES["Elevation/lg"].id);
const dh = dHeader.createInstance();
dh.name = "header";
add(dialog, dh, { w: "fill" });
const content = box("content", { gap: 16 });
add(content, await text("A short sentence on what this will do and what happens next.", "Paragraph/Small Regular", "text/secondary", "description"), { w: "fill" });
add(dialog, content, { w: "fill" });
const df = dFooter.defaultVariant.createInstance();
df.name = "footer";
add(dialog, df, { w: "fill" });
MS.appendChild(dialog);
dh.isExposedInstance = true;
df.isExposedInstance = true;
await slotify(dialog, "Content", { frame: "content" });

let sheet, cmdItem, cmdHint, palette;
if (CUI) {
  // ---- Sheet: panel against one edge, title with close, list of items -------------------------------------------------
  sheet = await variants("Sheet", { Side: ["Right", "Left"] }, async ({ Side }) => {
    const b = box("sheet", { component: true, gap: 16, pad: 24, w: 400, fill: "bg/surface", stroke: "border/default" });
    b.strokeTopWeight = b.strokeBottomWeight = 0;
    b.strokeLeftWeight = Side === "Right" ? 1 : 0;
    b.strokeRightWeight = Side === "Left" ? 1 : 0;
    await b.setEffectStyleIdAsync(ES["Elevation/lg"].id);
    const head = box("header", { dir: "row", gap: 12, cross: "CENTER" });
    add(head, await text("Notifications", "Paragraph/Large Medium", "text/primary", "title"), { w: "fill" });
    const x = inst(iconButton, { Type: "Ghost", Size: "sm" }, { Icon: IC.x.id });
    x.name = "close";
    head.appendChild(x);
    add(b, head, { w: "fill" });
    const list = box("list", { gap: 4 });
    [["Maya Okafor", "Commented on Roadmap"], ["Jonas Berg", "Assigned you to Grid rewrite"], ["Priya Nair", "Shared Q4 planning"]].forEach(([l1, l2], i) => {
      const it = inst(item, { Leading: "Avatar" }, { "Line 1": l1, "Line 2 text": l2, "Right icon": false });
      it.name = "item-" + (i + 1);
      add(list, it, { w: "fill" });
    });
    add(b, list, { w: "fill" });
    return b;
  }, { cols: 2 });
  wire(sheet, [{ layer: "title", kind: "TEXT", name: "Title" }]);

  // ---- Command palette: search row, grouped commands (Command item), hints footer (Command hint) -----------------------
  cmdItem = await variants("Command item", { State: ["Default", "Selected"] }, async ({ State }) => {
    const b = box("command-item", { component: true, dir: "row", gap: 12, pad: [10, 12], w: 540, radius: "item", cross: "CENTER", fill: State === "Selected" ? "interaction/active" : undefined });
    b.appendChild(await ico("plus", 18, "text/secondary", "icon"));
    add(b, await text("Command", "Paragraph/Medium Regular", "text/primary", "label"), { w: "fill" });
    const keys = box("keys", { dir: "row", gap: 4, cross: "CENTER" });
    keys.appendChild(inst(keycap, {}, { Key: "Ctrl" }));
    keys.appendChild(inst(keycap, {}, { Key: "N" }));
    keys.children[0].name = "key-1";
    keys.children[1].name = "key-2";
    b.appendChild(keys);
    return b;
  }, { cols: 2 });
  wire(cmdItem, [
    { layer: "icon", kind: "SWAP", name: "Icon", def: IC.plus.id, pref: pick("plus", "user-plus", "moon", "settings", "search") },
    { layer: "label", kind: "TEXT", name: "Label" },
    { layer: "keys", kind: "BOOLEAN", name: "Shortcut", def: true },
  ]);
  cmdHint = box("Command hint", { component: true, dir: "row", gap: 6, cross: "CENTER" });
  const hintKeys = box("keys", { dir: "row", gap: 4, cross: "CENTER" });
  const hk1 = inst(keycap, {}, { Key: "Esc" });
  hk1.name = "key-1";
  const hk2 = inst(keycap, {}, { Key: "Esc" });
  hk2.name = "key-2";
  hintKeys.appendChild(hk1);
  hintKeys.appendChild(hk2);
  cmdHint.appendChild(hintKeys);
  cmdHint.appendChild(await text("Close", "Paragraph/Small Regular", "text/secondary", "label"));
  MS.appendChild(cmdHint);
  wire(cmdHint, [
    { layer: "key-2", kind: "BOOLEAN", name: "Second key", def: true },
    { layer: "label", kind: "TEXT", name: "Label" },
  ]);

  palette = box("Command palette", { component: true, w: 580, radius: "surface", fill: "bg/surface", stroke: "border/default", clip: true });
  await palette.setEffectStyleIdAsync(ES["Elevation/lg"].id);
  const pSearch = box("search", { dir: "row", gap: 12, pad: [16, 20], cross: "CENTER", stroke: "border/default" });
  edge(pSearch, "bottom");
  pSearch.appendChild(await ico("search", 20, "text/secondary", "search-icon"));
  add(pSearch, await text("Type a command or search", "Paragraph/Medium Regular", "text/placeholder", "placeholder"), { w: "fill" });
  add(palette, pSearch, { w: "fill" });
  const pList = box("list", { gap: 2, pad: 8 });
  const pGroup = async (label, n) => {
    const sec = box("section-" + n, { dir: "row", pad: [8, 12, 4, 12] });
    sec.appendChild(await text(label, "Paragraph/Small Medium", "text/secondary", "section-label-" + n));
    add(pList, sec, { w: "fill" });
  };
  const pCmd = (n, State, icon, label, keys) => {
    const it = inst(cmdItem, { State }, { Icon: IC[icon].id, Label: label, Shortcut: !!keys });
    it.name = "command-" + n;
    if (keys) {
      nested(it, "key-1", "Key", keys[0]);
      nested(it, "key-2", "Key", keys[1]);
    }
    add(pList, it, { w: "fill" });
  };
  await pGroup("Actions", 1);
  pCmd(1, "Selected", "plus", "New project", ["Ctrl", "N"]);
  pCmd(2, "Default", "user-plus", "Invite teammate");
  await pGroup("Preferences", 2);
  pCmd(3, "Default", "moon", "Toggle dark mode", ["Ctrl", "J"]);
  pCmd(4, "Default", "settings", "Open settings");
  add(palette, pList, { w: "fill" });
  const pFoot = box("footer", { dir: "row", gap: 20, pad: [10, 16], cross: "CENTER", fill: "bg/subtle", stroke: "border/default" });
  edge(pFoot, "top");
  [["↑", "↓", "Navigate"], ["Enter", null, "Select"], ["Esc", null, "Close"]].forEach(([k1, k2, label], i) => {
    const h = inst(cmdHint, {}, { Label: label, "Second key": !!k2 });
    h.name = "hint-" + (i + 1);
    nested(h, "key-1", "Key", k1);
    if (k2) nested(h, "key-2", "Key", k2);
    pFoot.appendChild(h);
  });
  add(palette, pFoot, { w: "fill" });
  MS.appendChild(palette);
}

// ---- Hover card: avatar, name with status, description, meta line --------------------------------------------------
const hover = box("Hover card", { component: true, dir: "row", gap: 12, pad: 16, w: 320, radius: "panel", cross: "MIN", fill: "bg/surface", stroke: "border/default" });
await hover.setEffectStyleIdAsync(ES["Elevation/lg"].id);
const hAv = inst(avatar, { Type: "Initials", Size: "lg" }, { Initials: "JB" });
hAv.name = "avatar";
hover.appendChild(hAv);
const hText = box("text", { gap: 4 });
const hHead = box("head", { dir: "row", gap: 6, cross: "CENTER" });
hHead.appendChild(await text("Jonas Berg", "Paragraph/Small Medium", "text/primary", "name"));
hHead.appendChild(box("status", { w: 8, h: 8, radius: 999, fill: "feedback/success/default" }));
hText.appendChild(hHead);
add(hText, await text("Engineer on the rendering team.", "Paragraph/Small Regular", "text/secondary", "description"), { w: "fill" });
const hMeta = box("meta", { dir: "row", gap: 6, cross: "CENTER" });
hMeta.appendChild(await ico("clock", 14, "text/secondary", "clock"));
hMeta.appendChild(await text("Usually replies within an hour", "Paragraph/Mini Regular", "text/secondary", "detail"));
hText.appendChild(hMeta);
add(hover, hText, { w: "fill" });
MS.appendChild(hover);
wire(hover, [
  { layer: "name", kind: "TEXT", name: "Name" },
  { layer: "status", kind: "BOOLEAN", name: "Status", def: true },
  { layer: "description", kind: "TEXT", name: "Description" },
  { layer: "meta", kind: "BOOLEAN", name: "Detail", def: true },
  { layer: "detail", kind: "TEXT", name: "Detail text" },
]);

// ---- Confirm popover: small question anchored to its button, Content slot + Dialog footer (Size sm, Tone switch) ----
const confirm = box("confirm-popover", { component: true, gap: 12, pad: 16, w: 300, radius: "panel", fill: "bg/surface", stroke: "border/default" });
confirm.name = "Confirm popover";
await confirm.setEffectStyleIdAsync(ES["Elevation/lg"].id);
const cText = box("content", { gap: 4 });
add(cText, await text("Delete feature/grid?", "Paragraph/Small Medium", "text/primary", "title"), { w: "fill" });
add(cText, await text("The branch and its 12 commits are removed from the remote.", "Paragraph/Small Regular", "text/secondary", "description"), { w: "fill" });
add(confirm, cText, { w: "fill" });
const cFoot = inst(dFooter, { Tone: "Danger", Size: "sm" });
cFoot.name = "footer";
add(confirm, cFoot, { w: "fill" });
nested(confirm, "confirm", "Label", "Delete branch");
MS.appendChild(confirm);
cFoot.isExposedInstance = true;
await slotify(confirm, "Content", { frame: "content" });

// ---- Expandable text (clamped to 2 lines, Show more link) and Expandable card (header, chevron, body) -----------------
const LONG = "CUI is a component library for C. It draws everything itself, so an app looks the same on Windows, macOS and Linux, and it ships the parts most apps need: inputs, pickers, menus, dialogs, tables, charts and more.";
const xtext = await variants("Expandable text", { Open: ["Off", "On"] }, async ({ Open }) => {
  const on = Open === "On";
  const b = box("expandable-text", { component: true, gap: 8, w: 520 });
  const t = await text(LONG, "Paragraph/Medium Regular", "text/primary", "body");
  t.textAutoResize = "HEIGHT";
  add(b, t, { w: "fill" });
  if (!on) {
    // clamp to two lines with an ellipsis (the fade is not drawn)
    t.textTruncation = "ENDING";
    t.maxLines = 2;
  }
  b.appendChild(await text(on ? "Show less" : "Show more", "Paragraph/Small Medium", "text/primary", "toggle"));
  return b;
}, { cols: 2 });
wire(xtext, [{ layer: "body", kind: "TEXT", name: "Text" }]);
const xcard = await variants("Expandable card", { Open: ["Off", "On"] }, async ({ Open }) => {
  const on = Open === "On";
  const b = box("expandable-card", { component: true, w: 520, radius: "panel", fill: "bg/surface", stroke: on ? "border/strong" : "border/default", clip: true });
  const head = box("header", { dir: "row", gap: 12, pad: 16, cross: "CENTER" });
  head.appendChild(await ico("credit-card", 20, "text/secondary", "icon"));
  const t = box("text", { gap: 2 });
  add(t, await text("Billing", "Paragraph/Small Medium", "text/primary", "title"), { w: "fill" });
  add(t, await text("Pro plan, renews on December 1", "Paragraph/Small Regular", "text/secondary", "description"), { w: "fill" });
  add(head, t, { w: "fill" });
  const bd = inst(badge, { Tone: "Success" }, { Label: "Active" });
  bd.name = "badge";
  head.appendChild(bd);
  head.appendChild(await ico(on ? "chevron-up" : "chevron-down", 18, "text/secondary", "chevron"));
  add(b, head, { w: "fill" });
  if (on) {
    const body = box("body", { dir: "row", gap: 8, pad: 16, stroke: "border/default" });
    edge(body, "top");
    body.appendChild(inst(button, { Type: "Secondary", Size: "md" }, { Label: "Change plan" }));
    body.appendChild(inst(button, { Type: "Ghost", Size: "md" }, { Label: "Invoices" }));
    add(b, body, { w: "fill" });
  }
  return b;
}, { cols: 2 });
wire(xcard, [
  { layer: "icon", kind: "SWAP", name: "Icon", def: IC["credit-card"].id, pref: pick("credit-card", "shield", "bell", "mail", "lock") },
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "description", kind: "TEXT", name: "Description" },
  { layer: "badge", kind: "BOOLEAN", name: "Badge", def: true },
]);
await slotify(xcard, "Body", { frame: "body", only: "Open=On" });

let BANNER, banner, ctile, countdown;
if (CUI) {
  // ---- Banner: full-width tinted strip with message, action and close --------------------------------------------------
  BANNER = { Neutral: ["bg/muted", "text/primary"] };
  for (const t of ["Info", "Success", "Warning", "Error"]) BANNER[t] = [`feedback/${t.toLowerCase()}/subtle`, `feedback/${t.toLowerCase()}/text`];
  banner = await variants("Banner", { Tone: Object.keys(BANNER) }, async ({ Tone }) => {
    const [fill, fg] = BANNER[Tone];
    const b = box("banner", { component: true, dir: "row", gap: 16, pad: [12, 16], w: 640, cross: "CENTER", fill, stroke: "border/strong" });
    edge(b, "bottom");
    const content = box("content", { dir: "row", gap: 16, align: "CENTER", cross: "CENTER" });
    content.appendChild(await text("CUI 1.1 is out: data grid, kanban and forty new components.", "Paragraph/Small Regular", fg, "message"));
    const act = box("action", { dir: "row", gap: 6, cross: "CENTER" });
    act.appendChild(await text("Read the notes", "Paragraph/Small Medium", fg, "action-label"));
    act.appendChild(await ico("arrow-right", 16, fg, "action-icon"));
    content.appendChild(act);
    add(b, content, { w: "fill" });
    b.appendChild(await ico("x", 18, fg, "close"));
    return b;
  }, { cols: 1 });
  wire(banner, [
    { layer: "message", kind: "TEXT", name: "Message" },
    { layer: "action", kind: "BOOLEAN", name: "Action", def: true },
    { layer: "action-label", kind: "TEXT", name: "Action text" },
    { layer: "close", kind: "BOOLEAN", name: "Close", def: true },
  ]);

  // ---- Countdown: tiles with a value and a label; full (4 tiles) or compact (h:m:s) -----------------------------------
  ctile = await variants("Countdown tile", { Size: ["Large", "Compact"] }, async ({ Size }) => {
    const large = Size === "Large";
    const b = box("countdown-tile", { component: true, gap: 8, cross: "CENTER" });
    const face = box("face", { dir: "row", w: large ? 68 : 44, h: large ? 72 : 44, radius: large ? "panel" : "button", align: "CENTER", cross: "CENTER", fill: "bg/surface", stroke: "border/default" });
    face.appendChild(await text("00", large ? "Display/1" : "Display/3", "text/primary", "value"));
    b.appendChild(face);
    if (large) b.appendChild(await text("Label", "Paragraph/Small Regular", "text/secondary", "label"));
    return b;
  }, { cols: 2 });
  wire(ctile, [
    { layer: "value", kind: "TEXT", name: "Value" },
    { layer: "label", kind: "TEXT", name: "Label" },
  ]);
  countdown = await variants("Countdown", { Format: ["Full", "Compact"] }, async ({ Format }) => {
    const full = Format === "Full";
    const b = box("countdown", { component: true, dir: "row", gap: full ? 16 : 8, cross: full ? "MIN" : "CENTER" });
    const parts = full ? [["02", "Days"], ["05", "Hours"], ["42", "Minutes"], ["18", "Seconds"]] : [["05", "Hours"], ["42", "Minutes"], ["18", "Seconds"]];
    for (let i = 0; i < parts.length; i++) {
      if (!full && i) b.appendChild(await text(":", "Paragraph/Medium Medium", "text/secondary", "sep-" + i));
      const t = inst(ctile, { Size: full ? "Large" : "Compact" }, { Value: parts[i][0], ...(full ? { Label: parts[i][1] } : {}) });
      t.name = parts[i][1].toLowerCase();
      b.appendChild(t);
    }
    return b;
  }, { cols: 2 });
}

// ---- Onboarding checklist: header with progress ring, steps (done, current with action, todo) -------------------------
const cring = await variants("Checklist ring", { Value: ["25", "50", "100"] }, ({ Value }) => {
  const p = Number(Value) / 100;
  // track = frame stroke (inside, not counted by the layout); ONE arc ellipse as the only auto-layout child, covering it
  const b = box("checklist-ring", { component: true, dir: "row", w: 44, h: 44, radius: 999, stroke: "interaction/active", sw: 4 });
  b.strokesIncludedInLayout = false;
  const arc = figma.createEllipse();
  arc.name = "arc";
  arc.resize(44, 44);
  arc.arcData = { startingAngle: -Math.PI / 2, endingAngle: -Math.PI / 2 + 2 * Math.PI * p, innerRadius: 36 / 44 };
  arc.fills = [solid("primary/default")];
  arc.strokes = [];
  b.appendChild(arc);
  return b;
}, { cols: 3 });
const cstep = await variants("Checklist step", { State: ["Done", "Current", "Todo"] }, async ({ State }) => {
  const done = State === "Done";
  const cur = State === "Current";
  const b = box("checklist-step", { component: true, dir: "row", gap: 16, pad: cur ? 12 : [8, 12], w: 392, radius: cur ? 12 : undefined, cross: "MIN", fill: cur ? "bg/subtle" : undefined });
  const mark = box("mark", { dir: "row", w: 22, h: 22, radius: 999, align: "CENTER", cross: "CENTER", fill: done ? "feedback/success/default" : undefined, stroke: done ? undefined : "border/input", sw: 2 });
  if (done) mark.appendChild(await ico("check", 12, "text/on-primary", "check"));
  b.appendChild(mark);
  const t = box("text", { gap: 4 });
  add(t, await text("Step title", "Paragraph/Small Medium", done ? "text/secondary" : "text/primary", "title"), { w: "fill" });
  if (cur) {
    add(t, await text("A line on what this step does and why it matters.", "Paragraph/Small Regular", "text/secondary", "description"), { w: "fill" });
    const a = inst(button, { Type: "Primary", Size: "sm" }, { Label: "Connect", "Right icon": true, "Right icon swap": IC["arrow-right"].id });
    a.name = "action";
    const row = box("actions", { dir: "row", pad: [8, 0, 0, 0] });
    row.appendChild(a);
    t.appendChild(row);
  }
  add(b, t, { w: "fill" });
  return b;
}, { cols: 3 });
wire(cstep, [
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "description", kind: "TEXT", name: "Description" },
]);
const checklist = box("Onboarding checklist", { component: true, gap: 12, pad: 24, w: 440, radius: "surface", fill: "bg/surface", stroke: "border/default" });
const clHead = box("header", { dir: "row", gap: 16, cross: "CENTER" });
const clText = box("text", { gap: 2 });
clText.appendChild(await text("Set up your workspace", "Paragraph/Medium Medium", "text/primary", "title"));
clText.appendChild(await text("1 of 4 complete", "Paragraph/Small Regular", "text/secondary", "summary"));
add(clHead, clText, { w: "fill" });
const clRing = inst(cring, { Value: "25" });
clRing.name = "ring";
clHead.appendChild(clRing);
add(checklist, clHead, { w: "fill" });
const clSteps = box("steps", { gap: 4 });
[["Done", "Create your workspace"], ["Current", "Connect a repository"], ["Todo", "Import your data"], ["Todo", "Turn on notifications"]].forEach(([State, title], i) => {
  const s = inst(cstep, { State }, { Title: title, ...(State === "Current" ? { Description: "Link GitHub or GitLab to sync issues and pull requests." } : {}) });
  s.name = "step-" + (i + 1);
  add(clSteps, s, { w: "fill" });
});
add(checklist, clSteps, { w: "fill" });
MS.appendChild(checklist);
wire(checklist, [
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "summary", kind: "TEXT", name: "Summary" },
]);
await slotify(checklist, "Steps", { frame: "steps" });

// ---- Undo toast: message, Undo, close, draining timer line along the bottom --------------------------------------------
const undo = box("Undo toast", { component: true, w: 380, radius: "panel", fill: "bg/surface", stroke: "border/default", clip: true });
await undo.setEffectStyleIdAsync(ES["Elevation/lg"].id);
const uRow = box("content", { dir: "row", gap: 12, pad: [14, 16], cross: "CENTER" });
add(uRow, await text("3 conversations archived", "Paragraph/Small Medium", "text/primary", "message"), { w: "fill" });
const uAct = inst(button, { Type: "Secondary", Size: "sm" }, { Label: "Undo" });
uAct.name = "action";
uRow.appendChild(uAct);
uRow.appendChild(await ico("x", 16, "text/secondary", "close"));
add(undo, uRow, { w: "fill" });
const uTimer = box("timer", { dir: "row", pad: [0, 16, 8, 16] });
add(uTimer, box("bar", { radius: 999, fill: "text/secondary" }), { w: 240, h: 3 });
add(undo, uTimer, { w: "fill" });
MS.appendChild(undo);
wire(undo, [
  { layer: "message", kind: "TEXT", name: "Message" },
  { layer: "action", kind: "BOOLEAN", name: "Action", def: true },
  { layer: "timer", kind: "BOOLEAN", name: "Timer", def: true },
]);

// ---- board cards ---------------------------------------------------------------------------------------------------------
const c = await H.cursor();
const body = null;
const label = (s) => text(s, "Paragraph/Mini Regular", "text/secondary", "sub");
const row = (name, items, gap = 16, cross = "CENTER") => {
  const r = box(name, { dir: "row", gap, cross });
  items.forEach((i) => r.appendChild(i));
  return r;
};
// muted frame standing for the scrim (bound to bg/muted), the overlay sits on it
const SCRIM = "bg/muted";
const pageTitle = () => text("Projects", "Display/3", "text/primary", "page-title");
const trigger = (labelText, icon) => inst(button, { Type: "Secondary", Size: "md" }, { Label: labelText, "Left icon": true, "Left icon swap": IC[icon].id });

const k1 = await card(body, "Popover", "Anchored to its trigger", { gap: 8 });
k1.card.appendChild(trigger("Filters", "list-filter"));
k1.card.appendChild(popover.createInstance());
await burst(c, k1.wrap);

const k2 = await card(body, "Dialog", "Default · danger, over the scrim");
// dialog instance: header title, description, footer tone and confirm label; extra content stacked in the slot
const dialogInst = async (title, desc, tone, confirm, extra) => {
  const d = dialog.createInstance();
  nested(d, "header", "Title", title);
  d.findOne((x) => x.name === "description").characters = desc;
  if (extra) add(d.findOne((x) => x.name === "content" || x.name === "Content"), extra, { w: "fill" });
  nested(d, "footer", "Tone", tone);
  nested(d, "confirm", "Label", confirm);
  return d;
};
const s2 = box("scrim-form", { w: 600, pad: 40, radius: "panel", cross: "CENTER", fill: SCRIM });
s2.appendChild(await dialogInst("Edit profile", "Changes are visible to your team.", "Default", "Save", inst(field, {}, { "Label text": "Name", "Help text": false })));
k2.card.appendChild(s2);
const s2b = box("scrim-danger", { w: 600, pad: 40, radius: "panel", cross: "CENTER", fill: SCRIM });
s2b.appendChild(await dialogInst("Delete project?", "This removes the project for everyone. You cannot undo this.", "Danger", "Delete project"));
k2.card.appendChild(s2b);
await burst(c, k2.wrap);

if (CUI) {
  const k3 = await card(body, "Sheet", "Right · left edge");
  for (const Side of ["Right", "Left"]) {
    const sc = box("scrim-" + Side.toLowerCase(), { dir: "row", w: 720, h: 360, radius: "panel", fill: SCRIM, clip: true });
    const page = box("page", { pad: 32 });
    page.appendChild(await pageTitle());
    const sh = inst(sheet, { Side });
    if (Side === "Left") sc.appendChild(sh);
    add(sc, page, { w: "fill", h: "fill" });
    if (Side === "Right") sc.appendChild(sh);
    sh.layoutSizingVertical = "FILL";
    k3.card.appendChild(sc);
  }
  await burst(c, k3.wrap);

  const k4 = await card(body, "Command palette", "Search · groups · hints");
  const s4 = box("scrim", { w: 660, pad: 40, radius: "panel", cross: "CENTER", fill: SCRIM });
  s4.appendChild(palette.createInstance());
  k4.card.appendChild(s4);
  await burst(c, k4.wrap);
}

const k5 = await card(body, "Hover card", "Shown on the pointer rest", { gap: 8 });
const sentence = row("sentence", [], 6);
sentence.appendChild(await text("Assigned to", "Paragraph/Medium Regular", "text/primary", "before"));
const link = await text("@jonas", "Paragraph/Medium Medium", "text/primary", "link");
link.textDecoration = "UNDERLINE";
sentence.appendChild(link);
sentence.appendChild(await text("and due Friday.", "Paragraph/Medium Regular", "text/primary", "after"));
k5.card.appendChild(sentence);
k5.card.appendChild(hover.createInstance());
await burst(c, k5.wrap);

const k6 = await card(body, "Confirm popover", "Danger · default", { gap: 8 });
k6.card.appendChild(trigger("Delete branch", "trash-2"));
k6.card.appendChild(confirm.createInstance());
k6.card.appendChild(await label("Default tone"));
const cd = confirm.createInstance();
cd.findOne((x) => x.name === "title").characters = "Publish changes?";
cd.findOne((x) => x.name === "description").characters = "Everyone with the link will see the new version.";
nested(cd, "footer", "Tone", "Default");
nested(cd, "confirm", "Label", "Publish");
k6.card.appendChild(cd);
await burst(c, k6.wrap);

const k7 = await card(body, "Expandable text and card", "Clamped · open · closed");
k7.card.appendChild(inst(xtext, { Open: "Off" }));
const xc1 = inst(xcard, { Open: "On" });
k7.card.appendChild(xc1);
k7.card.appendChild(inst(xcard, { Open: "Off" }, { Icon: IC.shield.id, Title: "Security", Description: "Two-factor authentication is on", Badge: false }));
await burst(c, k7.wrap);

const k8 = await card(body, "Progress, meter, spinner and skeleton", "Progress · meter levels · spinner · skeleton");
const progBlock = box("progress", { gap: 8, w: 320 });
const progHead = box("head", { dir: "row", gap: 12, cross: "CENTER" });
add(progHead, await text("Uploading", "Paragraph/Small Medium", "text/primary", "label"), { w: "fill" });
progHead.appendChild(await text("60%", "Paragraph/Small Regular", "text/secondary", "value"));
add(progBlock, progHead, { w: "fill" });
add(progBlock, inst(progress, { Value: "60" }), { w: "fill" });
k8.card.appendChild(progBlock);
for (const Level of Object.keys(METER)) k8.card.appendChild(inst(meter, { Level }));
const loaders = row("loaders", [], 16);
for (const Size of Object.keys(SPIN)) loaders.appendChild(inst(spinner, { Size }));
loaders.appendChild(inst(skeleton, { Shape: "Circle" }));
const skLines = box("lines", { gap: 8 });
add(skLines, inst(skeleton, { Shape: "Line" }), { w: 200 });
add(skLines, inst(skeleton, { Shape: "Line" }), { w: 140 });
loaders.appendChild(skLines);
k8.card.appendChild(loaders);
k8.card.appendChild(inst(skeleton, { Shape: "Block" }));
await burst(c, k8.wrap);

if (CUI) {
  const k9 = await card(body, "Banner and countdown", "Tones · full · compact");
  for (const Tone of Object.keys(BANNER)) k9.card.appendChild(inst(banner, { Tone }));
  k9.card.appendChild(row("countdowns", [inst(countdown, { Format: "Full" }), inst(countdown, { Format: "Compact" })], 48, "MIN"));
  await burst(c, k9.wrap);
}

const k10 = await card(body, "Onboarding checklist", "Ring · done · current · todo");
k10.card.appendChild(checklist.createInstance());
await burst(c, k10.wrap);

const k11 = await card(body, "Undo toast", "With timer · without", { gap: 8 });
k11.card.appendChild(trigger("Archive 3 conversations", "archive"));
k11.card.appendChild(undo.createInstance());
k11.card.appendChild(inst(undo, {}, { Message: "Message deleted", Timer: false }));
await burst(c, k11.wrap);
c.done();
return {
  skeleton: skeleton.children.length, spinner: spinner.children.length, meter: meter.children.length, dialog: dialog.children.length, dialogFooter: dFooter.children.length,
  sheet: sheet?.children.length, commandItem: cmdItem?.children.length, confirmPopover: confirm.children.length, expandable: xtext.children.length + xcard.children.length,
  banner: banner?.children.length, countdown: ctile && ctile.children.length + countdown.children.length, checklist: cring.children.length + cstep.children.length, cards: CUI ? 11 : 8,
};
