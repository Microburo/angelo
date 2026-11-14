// CUI pickers and capture inputs: Dropzone, Avatar upload, Signature pad, Calendar (Calendar day, Calendar weekday,
// Calendar grid, Calendar header, Calendar), Date picker, Color picker (Color swatch), Multi-select (Multi chip,
// Multi option), Date range picker (Range preset), Time picker (Wheel item, Wheel column), Wheel picker, Time dial,
// Ruler slider, Histogram slider (Histogram bar, Histogram thumb), board cards.
const NEW = [
  "Dropzone", "Avatar upload", "Signature pad",
  "Calendar day", "Calendar weekday", "Calendar grid", "Calendar header", "Calendar", "Date picker",
  "Color swatch", "Color picker", "Multi chip", "Multi option", "Multi-select",
  "Range preset", "Date range picker", "Wheel item", "Wheel column", "Time picker", "Wheel picker", "Time dial",
  "Ruler slider", "Histogram bar", "Histogram thumb", "Histogram slider",
];
for (const n of NEW) setNamed(n)?.remove();
const ICONS = ["upload", "pencil", "camera", "x", "calendar", "clock", "chevron-left", "chevron-right", "chevron-down", "chevrons-up-down", "rotate-ccw"];
const IC = {};
for (const n of ICONS) IC[n] = await H.icon(n, ICON);
const MS = rootNamed(MASTERS);
const button = setNamed("Button");
const iconButton = setNamed("Icon button");
const input = setNamed("Input");
const checkbox = setNamed("Checkbox");
const W = 280;
// v1: only the cards ported from cui (ELEMENTS) and their masters are built (cui-only parts under if (CUI))
const keep = (caption) => CUI || ELEMENTS.includes(caption);
let sig, swatch, colorPicker, chipTag, option, multi, wheelPicker, dial, ruler, bar, thumb, hist;

// nested instance by layer name: set its properties (keys given without their #id suffix)
function setIn(root, name, props) {
  const n = root.findOne((x) => x.type === "INSTANCE" && x.name === name);
  if (!n) throw new Error("no nested instance " + name);
  const defs = n.componentProperties;
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    const key = Object.keys(defs).find((d) => d.split("#")[0] === k);
    if (!key) throw new Error(`no property ${k} on ${name}`);
    out[key] = v;
  }
  n.setProperties(out);
  return n;
}
// closed circle path (4 cubic arcs)
const circlePath = (cx, cy, r) => {
  const k = (0.5523 * r).toFixed(2);
  return `M ${cx + r} ${cy} C ${cx + r} ${cy + +k} ${cx + +k} ${cy + r} ${cx} ${cy + r} C ${cx - k} ${cy + r} ${cx - r} ${cy + +k} ${cx - r} ${cy} C ${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} C ${cx + +k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} Z`;
};
// one-vector drawing as a single auto-layout child
function drawing(name, d, { fill, stroke: strokeColor, sw = 1, cap = "NONE" }) {
  const v = figma.createVector();
  v.name = name;
  v.vectorPaths = [{ windingRule: "NONZERO", data: d }];
  v.fills = fill ? [solid(fill)] : [];
  v.strokes = strokeColor ? [solid(strokeColor)] : [];
  if (strokeColor) {
    v.strokeWeight = sw;
    v.strokeCap = cap;
    v.strokeJoin = "ROUND";
  }
  return v;
}
const label = (s) => text(s, "Paragraph/Mini Regular", "text/secondary", "sub");

// ---- Dropzone: dashed zone, icon disc, title, hint; Active = file hovering over it ----------------------------------
const dz = await variants("Dropzone", { State: ["Idle", "Active"], Layout: ["Default", "Compact"] }, async ({ State, Layout }) => {
  const act = State === "Active";
  const compact = Layout === "Compact";
  const b = box("dropzone", { component: true, dir: compact ? "row" : "col", gap: 12, pad: compact ? [8, 16] : [40, 24], w: 420, minH: compact ? 56 : 180, radius: "panel", align: "CENTER", cross: "CENTER", fill: act ? "bg/muted" : "bg/surface", stroke: act ? "primary/default" : "border/strong", sw: act ? 2 : 1 });
  b.dashPattern = act ? [8, 6] : [6, 6];
  const disc = box("disc", { dir: "row", w: compact ? 32 : 44, h: compact ? 32 : 44, radius: 999, align: "CENTER", cross: "CENTER", fill: act ? "interaction/active" : "bg/muted" });
  disc.appendChild(await ico("upload", compact ? 16 : 20, "text/primary", "icon"));
  b.appendChild(disc);
  const t = box("text", { dir: compact ? "row" : "col", gap: compact ? 8 : 2, cross: "CENTER" });
  t.appendChild(await text(act ? "Release to add" : "Drop files here", "Paragraph/Small Medium", "text/primary", "title"));
  t.appendChild(await text("PNG, JPG or PDF, up to 25 MB", "Paragraph/Small Regular", "text/secondary", "description"));
  b.appendChild(t);
  return b;
}, { cols: 2 });
wire(dz, [
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "description", kind: "TEXT", name: "Description" },
]);

// ---- Avatar upload: 88 px avatar with a pencil badge (negative gap overlap), camera on hover ------------------------
const au = await variants("Avatar upload", { State: ["Default", "Hover"] }, async ({ State }) => {
  const hov = State === "Hover";
  const b = box("avatar-upload", { component: true, dir: "row", gap: 16, cross: "CENTER" });
  const wrap = box("avatar-wrap", { dir: "row", gap: -20, cross: "MAX" });
  const face = box("face", { dir: "row", w: 88, h: 88, radius: "avatar", align: "CENTER", cross: "CENTER", fill: hov ? "bg/inverse" : "feedback/warning/subtle" });
  if (hov) face.appendChild(await ico("camera", 28, "text/on-primary", "camera"));
  else face.appendChild(await text("MO", "Display/2", "feedback/warning/text", "initials"));
  wrap.appendChild(face);
  const badge = box("badge", { dir: "row", w: 28, h: 28, radius: 999, align: "CENTER", cross: "CENTER", fill: "bg/surface", stroke: "border/default" });
  await badge.setEffectStyleIdAsync(ES["Elevation/sm"].id);
  badge.appendChild(await ico("pencil", 14, "text/primary", "pencil"));
  wrap.appendChild(badge);
  b.appendChild(wrap);
  const t = box("text", { gap: 2 });
  t.appendChild(await text("Profile photo", "Paragraph/Small Medium", "text/primary", "title"));
  t.appendChild(await text("Drop an image on the avatar", "Paragraph/Small Regular", "text/secondary", "description"));
  b.appendChild(t);
  return b;
}, { cols: 2 });
wire(au, [
  { layer: "initials", kind: "TEXT", name: "Initials" },
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "description", kind: "TEXT", name: "Description" },
]);

// ---- Signature pad: panel, Clear button once drawn, ink stroke (one vector), baseline with a cross ---------------------
if (CUI) sig = await variants("Signature pad", { State: ["Empty", "Signed"] }, async ({ State }) => {
  const signed = State === "Signed";
  const b = box("signature-pad", { component: true, gap: 8, pad: 16, w: 420, h: 180, radius: "panel", stroke: "border/default", fill: "bg/surface" });
  const head = box("head", { dir: "row", align: "MAX", cross: "CENTER", h: 30 });
  const clear = inst(button, { Type: "Ghost", Size: "sm" }, { Label: "Clear", "Left icon": true, "Left icon swap": IC["rotate-ccw"].id });
  clear.name = "clear";
  clear.visible = signed;
  head.appendChild(clear);
  add(b, head, { w: "fill" });
  const area = box("area", { dir: "row", align: "CENTER", cross: "CENTER" });
  if (signed) area.appendChild(drawing("ink", "M 0 40 C 25 70 45 70 70 40 C 95 10 115 10 140 40 C 165 70 185 70 210 40 C 235 10 255 10 280 40", { stroke: "text/primary", sw: 3, cap: "ROUND" }));
  else area.appendChild(await text("Sign here", "Paragraph/Small Regular", "text/placeholder", "hint"));
  add(b, area, { w: "fill", h: "fill" });
  const base = box("baseline", { dir: "row", gap: 8, cross: "MAX" });
  base.appendChild(await ico("x", 14, "text/secondary", "cross"));
  add(base, box("line", { fill: "border/strong" }), { w: "fill", h: 1 });
  add(b, base, { w: "fill" });
  return b;
}, { cols: 2 });

// ---- Calendar day: 36 px cell; selected = dark disc, today = ring, range = muted band with disc ends ---------------------
const KIND = {
  Default: { fg: "text/primary" },
  Outside: { fg: "text/secondary" },
  Today: { fg: "text/primary", ring: true },
  Selected: { fg: "text/on-primary", disc: true },
  Range: { fg: "text/primary", band: "all" },
  "Range start": { fg: "text/on-primary", band: "right", disc: true },
  "Range end": { fg: "text/on-primary", band: "left", disc: true },
};
const day = await variants("Calendar day", { Kind: Object.keys(KIND) }, async ({ Kind }) => {
  const k = KIND[Kind];
  const b = box("day", { component: true, dir: "row", w: 36, minH: 36, fill: k.band ? "bg/muted" : undefined });
  // the band rounds on the side the disc sits on, so it flows behind it
  if (k.band === "right") for (const f of ["topLeftRadius", "bottomLeftRadius"]) num(b, f, CUI ? 18 : 999, "radius");
  if (k.band === "left") for (const f of ["topRightRadius", "bottomRightRadius"]) num(b, f, CUI ? 18 : 999, "radius");
  const dot = box("dot", { dir: "row", radius: 999, align: "CENTER", cross: "CENTER", fill: k.disc ? "primary/default" : undefined, stroke: k.ring ? "border/input" : undefined, sw: 1.5 });
  dot.appendChild(await text("14", "Paragraph/Small Regular", k.fg, "label"));
  add(b, dot, { w: "fill", h: "fill" });
  return b;
}, { cols: 4 });
wire(day, [{ layer: "label", kind: "TEXT", name: "Day" }]);

const weekday = box("Calendar weekday", { component: true, dir: "row", w: 36, h: 28, align: "CENTER", cross: "CENTER" });
weekday.appendChild(await text("Mo", "Paragraph/Small Regular", "text/secondary", "label"));
MS.appendChild(weekday);
wire(weekday, [{ layer: "label", kind: "TEXT", name: "Weekday" }]);

// ---- Calendar grid: weekday row + weeks of day instances, November 2026 (Sunday the 1st) and December 2026 --------------
const MODES = {
  Single: { days: 30, start: 6, prev: 31 },
  "Range November": { days: 30, start: 6, prev: 31, range: [3, 14], blank: true },
  "Range December": { days: 31, start: 1, prev: 30, blank: true },
};
const grid = await variants("Calendar grid", { Mode: Object.keys(MODES) }, async ({ Mode }) => {
  const m = MODES[Mode];
  const b = box("calendar-grid", { component: true });
  const wk = box("weekdays", { dir: "row" });
  ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].forEach((d, i) => {
    const w = inst(weekday, {}, { Weekday: d });
    w.name = "wd-" + (i + 1);
    wk.appendChild(w);
  });
  b.appendChild(wk);
  const rows = Math.ceil((m.start + m.days) / 7);
  for (let r = 0; r < rows; r++) {
    const row = box("week-" + (r + 1), { dir: "row" });
    for (let c = 0; c < 7; c++) {
      const n = r * 7 + c - m.start + 1;
      let kind = "Default";
      let lab = String(n);
      if (n < 1 || n > m.days) {
        kind = "Outside";
        lab = m.blank ? " " : String(n < 1 ? m.prev + n : n - m.days);
      } else if (m.range) {
        const [a, z] = m.range;
        kind = n === a ? "Range start" : n === z ? "Range end" : n > a && n < z ? "Range" : "Default";
      } else if (n === 14) kind = "Selected";
      else if (n === 5) kind = "Today";
      const d = inst(day, { Kind: kind }, { Day: lab });
      d.name = "day-" + (r * 7 + c + 1);
      row.appendChild(d);
    }
    b.appendChild(row);
  }
  return b;
}, { cols: 3 });

// ---- Calendar header: month title with previous / next icon buttons ------------------------------------------------------
const slot = (name, dir) => {
  const s = box(name, { dir: "row", w: 30, h: 30, align: "CENTER", cross: "CENTER" });
  if (dir) {
    const bt = inst(iconButton, { Type: "Ghost", Size: "sm" }, { Icon: IC[dir === "prev" ? "chevron-left" : "chevron-right"].id });
    bt.name = dir;
    s.appendChild(bt);
  }
  return s;
};
const hdr = await variants("Calendar header", { Layout: ["Standard", "Range left", "Range right"] }, async ({ Layout }) => {
  const b = box("calendar-header", { component: true, dir: "row", gap: 4, w: 252, cross: "CENTER" });
  const t = await text("November 2026", "Paragraph/Medium Medium", "text/primary", "title");
  if (Layout === "Standard") {
    add(b, t, { w: "fill" });
    b.appendChild(slot("prev-slot", "prev"));
    b.appendChild(slot("next-slot", "next"));
  } else {
    t.textAlignHorizontal = "CENTER";
    if (Layout === "Range left") {
      b.appendChild(slot("prev-slot", "prev"));
      add(b, t, { w: "fill" });
      b.appendChild(slot("spacer-slot"));
    } else {
      b.appendChild(slot("spacer-slot"));
      add(b, t, { w: "fill" });
      b.appendChild(slot("next-slot", "next"));
    }
  }
  return b;
}, { cols: 3 });
wire(hdr, [{ layer: "title", kind: "TEXT", name: "Title" }]);

// ---- Calendar: header + single-month grid on a bordered surface ----------------------------------------------------------
const cal = box("Calendar", { component: true, gap: 12, pad: 20, radius: "surface", stroke: "border/default", fill: "bg/surface" });
cal.appendChild(inst(hdr, { Layout: "Standard" }, { Title: "November 2026" }));
cal.children[0].name = "header";
cal.appendChild(inst(grid, { Mode: "Single" }));
cal.children[1].name = "grid";
MS.appendChild(cal);

// ---- Date picker: label, input-like trigger with calendar icon, calendar popover when open ---------------------------------
const datePicker = await variants("Date picker", { State: ["Closed", "Open"] }, async ({ State }) => {
  const open = State === "Open";
  const b = box("date-picker", { component: true, gap: 8 });
  b.appendChild(await text("Due date", "Paragraph/Small Medium", "text/primary", "label"));
  const tr = inst(input, { State: open ? "Focus" : "Default", Value: "Filled" }, { "Left icon": true, "Left icon swap": IC.calendar.id, Text: "Nov 14, 2026" });
  tr.name = "trigger";
  b.appendChild(tr);
  if (open) {
    const pop = cal.createInstance();
    pop.name = "popover";
    await pop.setEffectStyleIdAsync(ES["Elevation/lg"].id);
    b.appendChild(pop);
  }
  return b;
}, { cols: 2 });
wire(datePicker, [{ layer: "label", kind: "TEXT", name: "Label" }]);

// ---- Color picker: swatch presets, trigger, popover with saturation square and hue bar -------------------------------------
// Gradients bind their stops to tokens when the plugin API accepts it; otherwise they fall back to a token fill.
const GRAD = { saturation: "", hue: "" };
function gradientFill(node, key, paints, fallback) {
  const lin = (stops, vertical) => ({
    type: "GRADIENT_LINEAR",
    gradientTransform: vertical ? [[0, 1, 0], [-1, 0, 1]] : [[1, 0, 0], [0, 1, 0]],
    gradientStops: stops.map(([token, position, a]) => ({ position, color: { r: 0, g: 0, b: 0, a: a ?? 1 }, boundVariables: { color: figma.variables.createVariableAlias(vr(token)) } })),
  });
  const bound = (n) => n.fills.length > 0 && n.fills.every((f) => f.type === "SOLID" || f.gradientStops.every((s) => s.boundVariables && s.boundVariables.color));
  try {
    node.fills = paints.map(([stops, vertical]) => lin(stops, vertical));
    if (!bound(node)) throw new Error("stops not bound");
    // a vertical fade to the dark token only works when its first stop kept alpha 0
    if (node.fills.length > 1 && node.fills[1].gradientStops[0].color.a > 0.05) node.fills = [node.fills[0]];
    GRAD[key] = "gradient bound";
  } catch (e) {
    node.fills = [solid(fallback)];
    GRAD[key] = "token fill (" + e.message + ")";
  }
}
const SWATCH = {
  Red: "danger/default",
  Amber: "feedback/warning/default",
  Green: "feedback/success/default",
  Blue: "feedback/info/default",
  Black: "primary/default",
  Silver: "secondary/active",
};
if (CUI) {
  swatch = await variants("Color swatch", { Color: Object.keys(SWATCH), Selected: ["Off", "On"] }, async ({ Color, Selected }) => {
    const on = Selected === "On";
    const b = box("swatch", { component: true, dir: "row", pad: 3, w: 26, h: 26, radius: 999, align: "CENTER", cross: "CENTER", stroke: on ? "primary/default" : undefined, sw: 2 });
    add(b, box("color", { fill: SWATCH[Color], radius: 999 }), { w: "fill", h: "fill" });
    return b;
  }, { cols: 2 });

  colorPicker = await variants("Color picker", { State: ["Closed", "Open"] }, async ({ State }) => {
    const open = State === "Open";
    const b = box("color-picker", { component: true, gap: 8, w: 252 });
    const tr = box("trigger", { dir: "row", gap: 8, pad: [0, 12, 0, 8], h: CTRL, radius: "input", cross: "CENTER", fill: "bg/surface", stroke: open ? "border/focus" : "border/input", sw: open ? 2 : 1 });
    const sw = inst(swatch, { Color: "Blue", Selected: "Off" });
    sw.name = "swatch";
    tr.appendChild(sw);
    add(tr, await text("#2563EB", "Paragraph/Small Regular", "text/primary", "value"), { w: "fill" });
    tr.appendChild(await ico("chevron-down", 18, "text/secondary", "chevron"));
    add(b, tr, { w: "fill" });
    if (open) {
      const panel = box("popover", { gap: 12, pad: 12, radius: "panel", fill: "bg/surface", stroke: "border/default" });
      await panel.setEffectStyleIdAsync(ES["Elevation/lg"].id);
      const sv = box("saturation", { radius: 8 });
      add(panel, sv, { w: "fill", h: 140 });
      gradientFill(sv, "saturation", [[[["bg/surface", 0], ["feedback/info/default", 1]], false], [[["bg/inverse", 0, 0], ["bg/inverse", 1, 1]], true]], "feedback/info/default");
      const hue = box("hue", { radius: 6 });
      add(panel, hue, { w: "fill", h: 12 });
      gradientFill(hue, "hue", [[[["danger/default", 0], ["feedback/warning/default", 0.25], ["feedback/success/default", 0.5], ["feedback/info/default", 0.75], ["danger/default", 1]], false]], "bg/muted");
      const presets = box("presets", { dir: "row", gap: 4, align: "SPACE_BETWEEN" });
      Object.keys(SWATCH).forEach((c, i) => {
        const s = inst(swatch, { Color: c, Selected: c === "Blue" ? "On" : "Off" });
        s.name = "preset-" + (i + 1);
        presets.appendChild(s);
      });
      add(panel, presets, { w: "fill" });
      add(b, panel, { w: "fill" });
    }
    return b;
  }, { cols: 2 });
  wire(colorPicker, [{ layer: "value", kind: "TEXT", name: "Value" }]);

  // ---- Multi-select: chips with remove buttons in the field, checkbox list with select all -----------------------------------
  chipTag = box("Multi chip", { component: true, dir: "row", gap: 4, pad: [0, 6, 0, 10], h: 28, radius: "chip", cross: "CENTER", fill: "bg/muted" });
  chipTag.appendChild(await text("Rust", "Paragraph/Small Medium", "text/primary", "label"));
  chipTag.appendChild(await ico("x", 14, "text/secondary", "remove"));
  MS.appendChild(chipTag);
  wire(chipTag, [
    { layer: "label", kind: "TEXT", name: "Label" },
    { layer: "remove", kind: "BOOLEAN", name: "Remove", def: true },
  ]);

  option = await variants("Multi option", { Checked: ["Off", "On"] }, async ({ Checked }) => {
    const b = box("multi-option", { component: true, dir: "row", gap: 12, pad: [0, 12], w: 276, h: 36, radius: "item", cross: "CENTER" });
    const cb = inst(checkbox, { Checked }, { Label: false });
    cb.name = "checkbox";
    b.appendChild(cb);
    add(b, await text("Option", "Paragraph/Small Regular", "text/primary", "label"), { w: "fill" });
    return b;
  }, { cols: 2 });
  wire(option, [{ layer: "label", kind: "TEXT", name: "Label" }]);

  multi = await variants("Multi-select", { State: ["Closed", "Open"] }, async ({ State }) => {
    const open = State === "Open";
    const b = box("multi-select", { component: true, gap: 8, w: 300 });
    b.appendChild(await text("Languages", "Paragraph/Small Medium", "text/primary", "label"));
    const tr = box("trigger", { dir: "row", gap: 8, pad: [4, 12, 4, 8], radius: "input", cross: "CENTER", fill: "bg/surface", stroke: open ? "border/focus" : "border/input", sw: open ? 2 : 1 });
    tr.minHeight = CTRL;
    const chips = box("chips", { dir: "row", gap: 6, cross: "CENTER" });
    ["C", "Rust", "Swift"].forEach((l, i) => {
      const ch = inst(chipTag, {}, { Label: l });
      ch.name = "chip-" + (i + 1);
      chips.appendChild(ch);
    });
    add(tr, chips, { w: "fill" });
    tr.appendChild(await ico("chevrons-up-down", 18, "text/secondary", "chevrons"));
    add(b, tr, { w: "fill" });
    if (open) {
      const panel = box("panel", { gap: 2, pad: 6, radius: "panel", fill: "bg/surface", stroke: "border/default" });
      await panel.setEffectStyleIdAsync(ES["Elevation/lg"].id);
      const head = box("head", { dir: "row", pad: [6, 12], align: "SPACE_BETWEEN", cross: "CENTER" });
      head.appendChild(await text("3 selected", "Paragraph/Small Regular", "text/secondary", "count"));
      head.appendChild(await text("Select all", "Paragraph/Small Medium", "text/primary", "select-all"));
      add(panel, head, { w: "fill" });
      [["C", "On"], ["C++", "Off"], ["Rust", "On"], ["Zig", "Off"], ["Go", "Off"], ["Swift", "On"]].forEach(([l, ck], i) => {
        const o = inst(option, { Checked: ck }, { Label: l });
        o.name = "option-" + (i + 1);
        add(panel, o, { w: "fill" });
      });
      add(b, panel, { w: "fill" });
    }
    return b;
  }, { cols: 2 });
  wire(multi, [{ layer: "label", kind: "TEXT", name: "Label" }]);
}

// ---- Date range picker: trigger, presets list, two-month range calendar ---------------------------------------------------
const preset = await variants("Range preset", { State: ["Default", "Hover"] }, async ({ State }) => {
  const b = box("range-preset", { component: true, dir: "row", pad: [0, 12], w: 132, h: 32, radius: "item", cross: "CENTER", fill: State === "Hover" ? "interaction/hover" : undefined });
  add(b, await text("Today", "Paragraph/Small Regular", "text/primary", "label"), { w: "fill" });
  return b;
}, { cols: 2 });
wire(preset, [{ layer: "label", kind: "TEXT", name: "Label" }]);

const rangePicker = await variants("Date range picker", { State: ["Closed", "Open"] }, async ({ State }) => {
  const open = State === "Open";
  const b = box("date-range-picker", { component: true, gap: 8 });
  const tr = inst(input, { State: open ? "Focus" : "Default", Value: "Filled" }, { "Left icon": true, "Left icon swap": IC.calendar.id, Text: "Nov 3 – Nov 14, 2026" });
  tr.name = "trigger";
  b.appendChild(tr);
  if (open) {
    const pop = box("popover", { dir: "row", radius: "panel", fill: "bg/surface", stroke: "border/default", clip: true });
    await pop.setEffectStyleIdAsync(ES["Elevation/lg"].id);
    const list = box("presets", { gap: 2, pad: 12 });
    ["Today", "Yesterday", "Last 7 days", "Last 30 days", "This month", "Last month", "This year"].forEach((l, i) => {
      const p = inst(preset, {}, { Label: l });
      p.name = "preset-" + (i + 1);
      list.appendChild(p);
    });
    pop.appendChild(list);
    add(pop, box("divider", { fill: "border/default" }), { w: 1, h: "fill" });
    const months = box("months", { dir: "row", gap: 24, pad: 16 });
    for (const [side, mode, title, layout] of [["left", "Range November", "November 2026", "Range left"], ["right", "Range December", "December 2026", "Range right"]]) {
      const col = box("month-" + side, { gap: 12 });
      const h = inst(hdr, { Layout: layout }, { Title: title });
      h.name = "header-" + side;
      col.appendChild(h);
      const g = inst(grid, { Mode: mode });
      g.name = "grid-" + side;
      col.appendChild(g);
      months.appendChild(col);
    }
    pop.appendChild(months);
    b.appendChild(pop);
  }
  return b;
}, { cols: 2 });
await slotify(rangePicker, "Presets", { frame: "presets", only: "State=Open" });

// ---- Wheel item / Wheel column: drums of options, the selected one on a band; used by the time picker and the date reel ----
const POS = {
  Selected: { fill: "primary/default", fg: "text/on-primary", font: "Paragraph/Small Medium" },
  "Selected light": { fill: "bg/muted", fg: "text/primary", font: "Paragraph/Small Regular" },
  Near: { fg: "text/primary", font: "Paragraph/Small Regular" },
  "Near muted": { fg: "text/secondary", font: "Paragraph/Small Regular" },
  Far: { fg: "text/disabled", font: "Paragraph/Small Regular" },
};
const wheelItem = await variants("Wheel item", { Position: Object.keys(POS) }, async ({ Position }) => {
  const p = POS[Position];
  const b = box("wheel-item", { component: true, dir: "row", w: 80, h: 34, radius: 8, align: "CENTER", cross: "CENTER", fill: p.fill });
  b.appendChild(await text("12", p.font, p.fg, "label"));
  return b;
}, { cols: 5 });
wire(wheelItem, [{ layer: "label", kind: "TEXT", name: "Label" }]);

const COLS = {
  Hours: { w: 80, rows: [["3", "Far"], ["4", "Near"], ["5", "Near"], ["6", "Selected"], ["7", "Near"], ["8", "Near"], ["9", "Far"]] },
  Minutes: { w: 80, rows: [["00", "Far"], ["15", "Near"], ["30", "Near"], ["45", "Selected"], [" ", "Near"], [" ", "Near"], [" ", "Near"]] },
  Period: { w: 80, rows: [[" ", "Near"], [" ", "Near"], ["AM", "Near"], ["PM", "Selected"], [" ", "Near"], [" ", "Near"], [" ", "Near"]] },
  Days: { w: 72, rows: [["12", "Far"], ["13", "Near muted"], ["14", "Selected light"], ["15", "Near muted"], ["16", "Far"]] },
  Months: { w: 150, rows: [["September", "Far"], ["October", "Near muted"], ["November", "Selected light"], ["December", "Near muted"], ["January", "Far"]] },
  Years: { w: 90, rows: [["2024", "Far"], ["2025", "Near muted"], ["2026", "Selected light"], ["2027", "Near muted"], ["2028", "Far"]] },
};
const wheelCol = await variants("Wheel column", { Content: Object.keys(COLS) }, async ({ Content }) => {
  const k = COLS[Content];
  const b = box("wheel-column", { component: true, w: k.w });
  k.rows.forEach(([l, pos], i) => {
    const it = inst(wheelItem, { Position: pos }, { Label: l });
    it.name = "item-" + (i + 1);
    add(b, it, { w: "fill" });
  });
  return b;
}, { cols: 6 });

// ---- Time picker: input-like trigger with a clock, popover of hour / minute / period wheels -------------------------------
const timePicker = await variants("Time picker", { State: ["Closed", "Open"] }, async ({ State }) => {
  const open = State === "Open";
  const b = box("time-picker", { component: true, gap: 8 });
  const tr = inst(input, { State: open ? "Focus" : "Default", Value: "Filled" }, { "Left icon": true, "Left icon swap": IC.clock.id, Text: "09:30" });
  tr.name = "trigger";
  b.appendChild(tr);
  if (open) {
    const pop = box("popover", { dir: "row", gap: 0, pad: 8, radius: "panel", fill: "bg/surface", stroke: "border/default" });
    await pop.setEffectStyleIdAsync(ES["Elevation/lg"].id);
    ["Hours", "Minutes", "Period"].forEach((c, i) => {
      if (i) add(pop, box("divider-" + i, { fill: "border/default" }), { w: 1, h: "fill" });
      const col = inst(wheelCol, { Content: c });
      col.name = c.toLowerCase();
      pop.appendChild(col);
    });
    b.appendChild(pop);
  }
  return b;
}, { cols: 2 });

if (CUI) {
  // ---- Wheel picker: date reel, three joined wheels on one band ------------------------------------------------------------
  wheelPicker = box("Wheel picker", { component: true, dir: "row", gap: 0, pad: [8, 12], radius: "panel", stroke: "border/default", fill: "bg/surface" });
  ["Days", "Months", "Years"].forEach((c) => {
    const col = inst(wheelCol, { Content: c });
    col.name = c.toLowerCase();
    wheelPicker.appendChild(col);
  });
  MS.appendChild(wheelPicker);

  // ---- Time dial: HH : MM readout and a round face with the hand (hand + knob + hub = one vector) ---------------------------
  dial = box("Time dial", { component: true, gap: 16, cross: "CENTER" });
  const readout = box("readout", { dir: "row", gap: 8, cross: "CENTER" });
  const hourChip = box("hour", { dir: "row", pad: [4, 12], radius: 12, fill: "bg/muted" });
  hourChip.appendChild(await text("07", "Display/1", "text/primary", "hours"));
  readout.appendChild(hourChip);
  readout.appendChild(await text(":", "Display/1", "text/secondary", "colon"));
  readout.appendChild(await text("25", "Display/1", "text/secondary", "minutes"));
  dial.appendChild(readout);
  const face = box("face", { w: 232, h: 232, pad: 12, radius: 999, fill: "bg/subtle", align: "SPACE_BETWEEN", cross: "CENTER" });
  face.appendChild(await text("12", "Paragraph/Medium Medium", "text/primary", "hour-12"));
  const mid = box("middle", { dir: "row", align: "SPACE_BETWEEN", cross: "CENTER" });
  mid.appendChild(await text("9", "Paragraph/Medium Medium", "text/primary", "hour-9"));
  // hub at the centre of this 120 px zone: the vector (hub at its top-right) sits by padding
  const zone = box("hand-zone", { w: 120, h: 120, pad: [57, 0, 0, 4] });
  zone.appendChild(drawing("hand", `M 56 3 L 16 72.3 ${circlePath(16, 72.3, 16)} ${circlePath(56, 3, 3)}`, { fill: "primary/default", stroke: "primary/default", sw: 2, cap: "ROUND" }));
  mid.appendChild(zone);
  mid.appendChild(await text("3", "Paragraph/Medium Medium", "text/primary", "hour-3"));
  add(face, mid, { w: "fill" });
  face.appendChild(await text("6", "Paragraph/Medium Medium", "text/primary", "hour-6"));
  dial.appendChild(face);
  MS.appendChild(dial);

  // ---- Ruler slider: label, big value + unit, marker, tape of ticks (one vector), labelled majors ---------------------------
  ruler = box("Ruler slider", { component: true, gap: 4, cross: "CENTER" });
  ruler.appendChild(await text("Height", "Paragraph/Small Medium", "text/secondary", "label"));
  const val = box("value-row", { dir: "row", gap: 6, cross: "MAX" });
  val.appendChild(await text("172", "Display/1", "text/primary", "value"));
  val.appendChild(await text("cm", "Paragraph/Medium Regular", "text/secondary", "unit"));
  ruler.appendChild(val);
  ruler.appendChild(drawing("marker", "M 0 0 L 12 0 L 6 9 Z", { fill: "primary/default" }));
  let ticks = "";
  for (let v = 153; v <= 191; v++) {
    const x = 172 + (v - 172) * 9;
    ticks += `M ${x} 0 L ${x} ${v % 10 === 0 ? 22 : v % 5 === 0 ? 16 : 10} `;
  }
  ruler.appendChild(drawing("tape", ticks, { stroke: "border/strong", sw: 1 }));
  const marks = box("marks", { dir: "row", gap: 58, pad: [0, 0, 0, 47], w: 342 });
  for (const v of ["160", "170", "180", "190"]) {
    const m = box("mark-" + v, { dir: "row", w: 32, align: "CENTER" });
    m.appendChild(await text(v, "Paragraph/Small Regular", "text/secondary", "tick-" + v));
    marks.appendChild(m);
  }
  ruler.appendChild(marks);
  MS.appendChild(ruler);
  wire(ruler, [
    { layer: "label", kind: "TEXT", name: "Label" },
    { layer: "value", kind: "TEXT", name: "Value" },
    { layer: "unit", kind: "TEXT", name: "Unit" },
  ]);

  // ---- Histogram slider: distribution bars (lit inside the range), range track with two thumbs --------------------------------
  bar = await variants("Histogram bar", { State: ["In range", "Outside"] }, async ({ State }) => {
    const b = box("histogram-bar", { component: true, w: 10, h: 40, radius: 2, fill: State === "In range" ? "primary/default" : "interaction/active" });
    return b;
  }, { cols: 2 });
  thumb = box("Histogram thumb", { component: true, dir: "row", w: 18, h: 18, radius: 999, fill: "bg/surface", stroke: "border/strong" });
  await thumb.setEffectStyleIdAsync(ES["Elevation/sm"].id);
  MS.appendChild(thumb);

  hist = box("Histogram slider", { component: true, gap: 12, pad: 24, w: 360, radius: "panel", stroke: "border/default", fill: "bg/surface" });
  const hhead = box("head", { dir: "row", align: "SPACE_BETWEEN", cross: "CENTER" });
  hhead.appendChild(await text("Price", "Paragraph/Small Medium", "text/primary", "label"));
  hhead.appendChild(await text("$40 – $160", "Paragraph/Small Regular", "text/secondary", "range"));
  add(hist, hhead, { w: "fill" });
  const bars = box("bars", { dir: "row", gap: 2, align: "SPACE_BETWEEN", cross: "MAX", h: 56 });
  for (let i = 0; i < 24; i++) {
    const lit = i >= 4 && i < 20;
    const b = inst(bar, { State: lit ? "In range" : "Outside" });
    b.name = "bar-" + (i + 1);
    b.resize(10, Math.round(4 + 52 * Math.exp(-Math.pow((i - 11.5) / 6.5, 2))));
    bars.appendChild(b);
  }
  add(hist, bars, { w: "fill" });
  const track = box("track", { dir: "row", cross: "CENTER", h: 20 });
  add(track, box("track-left", { fill: "interaction/active", radius: 999 }), { w: 52, h: 4 });
  const t1 = thumb.createInstance();
  t1.name = "thumb-low";
  track.appendChild(t1);
  add(track, box("track-range", { fill: "primary/default", radius: 999 }), { w: "fill", h: 4 });
  const t2 = thumb.createInstance();
  t2.name = "thumb-high";
  track.appendChild(t2);
  add(track, box("track-right", { fill: "interaction/active", radius: 999 }), { w: 52, h: 4 });
  add(hist, track, { w: "fill" });
  hist.appendChild(await text("1,204 listings in range", "Paragraph/Small Regular", "text/secondary", "caption"));
  MS.appendChild(hist);
  wire(hist, [
    { layer: "label", kind: "TEXT", name: "Label" },
    { layer: "range", kind: "TEXT", name: "Range" },
    { layer: "caption", kind: "TEXT", name: "Caption" },
  ]);
}

// ---- board cards ---------------------------------------------------------------------------------------------------------------
const c = await H.cursor();
const body = null;
const row = (name, gap = 24) => box(name, { dir: "row", gap, cross: "MIN" });

const k1 = await card(body, "Dropzone", "Idle · active · compact");
const d1 = row("default");
d1.appendChild(inst(dz, { State: "Idle", Layout: "Default" }));
d1.appendChild(inst(dz, { State: "Active", Layout: "Default" }));
k1.card.appendChild(d1);
const d2 = row("compact");
d2.appendChild(inst(dz, { State: "Idle", Layout: "Compact" }));
d2.appendChild(inst(dz, { State: "Active", Layout: "Compact" }));
k1.card.appendChild(d2);
await burst(c, k1.wrap);

const k2 = await card(body, "Avatar upload", "Default · hover");
const r2 = row("states", 40);
r2.appendChild(inst(au, { State: "Default" }));
r2.appendChild(inst(au, { State: "Hover" }, { Title: "Profile photo", Description: "Click or drop to replace" }));
k2.card.appendChild(r2);
await burst(c, k2.wrap);

if (keep("Signature pad")) {
  const k3 = await card(body, "Signature pad", "Empty · signed");
  const r3 = row("states");
  r3.appendChild(inst(sig, { State: "Empty" }));
  r3.appendChild(inst(sig, { State: "Signed" }));
  k3.card.appendChild(r3);
  await burst(c, k3.wrap);
}

const k4 = await card(body, "Date picker and calendar", "Closed · open · inline");
const r4 = row("pickers");
r4.appendChild(inst(datePicker, { State: "Closed" }));
r4.appendChild(inst(datePicker, { State: "Open" }));
const inline = row("inline-calendar");
inline.appendChild(cal.createInstance());
r4.appendChild(inline);
k4.card.appendChild(r4);
await burst(c, k4.wrap);

if (keep("Color picker")) {
  const k5 = await card(body, "Color picker", "Closed · open");
  const r5 = row("states");
  r5.appendChild(inst(colorPicker, { State: "Closed" }));
  r5.appendChild(inst(colorPicker, { State: "Open" }));
  k5.card.appendChild(r5);
  await burst(c, k5.wrap);
}

if (keep("Multi-select")) {
  const k6 = await card(body, "Multi-select", "Closed · open");
  const r6 = row("states");
  r6.appendChild(inst(multi, { State: "Closed" }));
  r6.appendChild(inst(multi, { State: "Open" }));
  k6.card.appendChild(r6);
  await burst(c, k6.wrap);
}

const k7 = await card(body, "Date range picker", "Closed · open with presets");
k7.card.appendChild(inst(rangePicker, { State: "Closed" }));
k7.card.appendChild(inst(rangePicker, { State: "Open" }));
await burst(c, k7.wrap);

const k8 = await card(body, "Time picker", "24 hour · 12 hour open");
const r8 = row("states");
r8.appendChild(inst(timePicker, { State: "Closed" }));
const open12 = inst(timePicker, { State: "Open" });
setIn(open12, "trigger", { Text: "6:45 PM" });
r8.appendChild(open12);
k8.card.appendChild(r8);
await burst(c, k8.wrap);

if (keep("Wheel picker and time dial")) {
  const k9 = await card(body, "Wheel picker and time dial", "Date reel · time dial");
  const r9 = row("pickers", 40);
  r9.appendChild(wheelPicker.createInstance());
  r9.appendChild(dial.createInstance());
  k9.card.appendChild(r9);
  await burst(c, k9.wrap);
}

if (keep("Ruler and histogram sliders")) {
  const k10 = await card(body, "Ruler and histogram sliders", "Ruler · histogram");
  const r10 = row("sliders", 40);
  r10.appendChild(ruler.createInstance());
  r10.appendChild(hist.createInstance());
  k10.card.appendChild(r10);
  await burst(c, k10.wrap);
}
c.done();
return { dropzone: dz.children.length, calendarDay: day.children.length, grid: grid.children.length, swatch: swatch?.children.length, wheelItem: wheelItem.children.length, wheelColumn: wheelCol.children.length, gradients: GRAD, cards: CUI ? 10 : 5 };
