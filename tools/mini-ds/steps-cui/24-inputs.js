// CUI inputs: Number field, Input tag + Tag input, Code box + One time code, Strength segment + Password strength,
// Inline edit, Scrub field, Money field, Affix input (prefix and suffix), Shortcut recorder, Rating star + Rating,
// Combobox option + Combobox (searchable select panel), board cards.
const NEW = [
  "Number field", "Input tag", "Tag input", "Code box", "One time code", "Strength segment", "Password strength", "Inline edit",
  "Scrub field", "Money field", "Affix input", "Shortcut recorder", "Rating star", "Rating", "Combobox option", "Combobox",
];
for (const n of NEW) setNamed(n)?.remove();
const ICONS = ["minus", "plus", "x", "pencil", "keyboard", "search", "check", "eye"];
const IC = {};
for (const n of ICONS) IC[n] = await H.icon(n, ICON);
const MS = rootNamed(MASTERS);
const field = setNamed("Field");
const input = setNamed("Input");
const keycap = setNamed("Keycap");
// v1: only the cards ported from cui (ELEMENTS) and their masters are built (cui-only parts under if (CUI))
const keep = (caption) => CUI || ELEMENTS.includes(caption);
let numberField, tag, tagInput, TONES, segment, LEVELS, strength, inlineEdit, scrub, money, affix, recorder, STAR, ratingStar, rating;

// ---- shared bits -------------------------------------------------------------------------------------------------
const W = 280;
const ringOf = (State) => ({
  stroke: State === "Focus" ? "border/focus" : "border/input",
  sw: State === "Focus" ? 2 : 1,
  fill: State === "Disabled" ? "bg/muted" : "bg/surface",
});
const ink = (State) => (State === "Disabled" ? "text/disabled" : "text/primary");
const dim = (State) => (State === "Disabled" ? "text/disabled" : "text/secondary");
// input shell: 280 wide, hugs its 20 px line with padding 8 (shadcn), control height as a floor, border inside the box
const shell = (name, State, extra = {}) => {
  const r = ringOf(State);
  const b = box(name, { component: true, dir: "row", gap: 8, pad: [8, 12], w: W, radius: "input", cross: "CENTER", fill: r.fill, stroke: r.stroke, sw: r.sw, ...extra });
  b.minHeight = CTRL;
  b.strokesIncludedInLayout = false;
  return b;
};
// set component properties by name on an instance (variant axes included)
const setProps = (i, props) => {
  const defs = i.componentProperties;
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    const key = Object.keys(defs).find((d) => d === k || d.split("#")[0] === k);
    if (!key) throw new Error(`no property ${k} on ${i.name}`);
    out[key] = v;
  }
  i.setProperties(out);
};
// Field instance whose control is swapped to `comp` (its default variant), then tuned with `ctl`
const fieldOf = (comp, label, help, ctl = {}) => {
  const f = inst(field, {}, { "Label text": label, ...(help ? { Help: help } : { "Help text": false }) });
  const key = Object.keys(f.componentProperties).find((k) => k.startsWith("Control#"));
  f.setProperties({ [key]: (comp.defaultVariant || comp).id });
  const c = f.findChild((n) => n.type === "INSTANCE");
  if (Object.keys(ctl).length) setProps(c, ctl);
  return f;
};

if (CUI) {
  // ---- Number field: value, optional suffix, minus and plus ------------------------------------------------------------
  numberField = await variants("Number field", { State: ["Default", "Focus", "Disabled"] }, async ({ State }) => {
    const b = shell("number-field", State);
    add(b, await text("4", "Paragraph/Small Regular", ink(State), "value"), { w: "fill" });
    const sfx = await text("USD", "Paragraph/Small Regular", dim(State), "suffix");
    sfx.visible = false;
    b.appendChild(sfx);
    const step = box("stepper", { dir: "row", gap: 16, cross: "CENTER" });
    step.appendChild(await ico("minus", 18, dim(State), "minus"));
    step.appendChild(await ico("plus", 18, dim(State), "plus"));
    b.appendChild(step);
    return b;
  }, { cols: 3 });
  wire(numberField, [
    { layer: "value", kind: "TEXT", name: "Value" },
    { layer: "suffix", kind: "BOOLEAN", name: "Suffix", def: false },
    { layer: "suffix", kind: "TEXT", name: "Suffix text" },
  ]);

  // ---- Tag input: removable tags in a wrapping field --------------------------------------------------------------------
  tag = box("Input tag", { component: true, dir: "row", gap: 4, pad: [0, 8, 0, 10], h: 24, radius: "chip", cross: "CENTER", fill: "bg/muted" });
  tag.appendChild(await text("design", "Paragraph/Small Medium", "text/primary", "label"));
  tag.appendChild(await ico("x", 14, "text/primary", "remove"));
  MS.appendChild(tag);
  wire(tag, [{ layer: "label", kind: "TEXT", name: "Label" }]);

  tagInput = await variants("Tag input", { State: ["Default", "Focus"], Tags: ["Filled", "Empty"] }, async ({ State, Tags }) => {
    const r = ringOf(State);
    const b = box("tag-input", { component: true, dir: "row", gap: 6, wrap: 6, pad: [6, 8], w: 360, radius: "input", cross: "CENTER", fill: r.fill, stroke: r.stroke, sw: r.sw });
    b.minHeight = CTRL;
    if (Tags === "Filled") {
      ["design", "c99", "native"].forEach((l, i) => {
        const t = inst(tag, {}, { Label: l });
        t.name = "tag-" + (i + 1);
        b.appendChild(t);
      });
    } else {
      const ph = await text("Add a tag", "Paragraph/Small Regular", "text/placeholder", "placeholder");
      ph.paddingLeft = 4;
      b.appendChild(ph);
    }
    return b;
  }, { cols: 2 });
  wire(tagInput, [{ layer: "placeholder", kind: "TEXT", name: "Placeholder" }]);
}

// ---- One time code: boxes grouped 3 + 3 around a dash ----------------------------------------------------------------
const codeBox = await variants("Code box", { State: ["Empty", "Filled", "Active"] }, async ({ State }) => {
  const stroke = State === "Active" ? "border/focus" : State === "Filled" ? "border/input" : "border/strong";
  const b = box("code-box", { component: true, dir: "row", w: 44, minH: 52, radius: "input", align: "CENTER", cross: "CENTER", fill: "bg/surface", stroke, sw: State === "Active" ? 2 : 1 });
  const d = await text("4", "Paragraph/Large Medium", "text/primary", "digit");
  d.visible = State === "Filled";
  b.appendChild(d);
  return b;
}, { cols: 3 });
wire(codeBox, [{ layer: "digit", kind: "TEXT", name: "Digit" }]);
const DIGITS = ["4", "1", "8", "2", "7", "5"];
const otp = await variants("One time code", { Progress: ["Empty", "Half", "Full"] }, async ({ Progress }) => {
  const n = { Empty: 0, Half: 3, Full: 6 }[Progress];
  const b = box("one-time-code", { component: true, dir: "row", gap: 8, cross: "CENTER" });
  for (let i = 0; i < 6; i++) {
    if (i === 3) add(b, box("dash", { fill: "border/input", radius: 999 }), { w: 8, h: 2 });
    const state = i < n ? "Filled" : i === n ? "Active" : "Empty";
    const cb = inst(codeBox, { State: state }, state === "Filled" ? { Digit: DIGITS[i] } : {});
    cb.name = "box-" + (i + 1);
    b.appendChild(cb);
  }
  return b;
}, { cols: 3 });
await slotify(otp, "Boxes");

if (CUI) {
  // ---- Password strength: four segments and the verdict --------------------------------------------------------------------
  TONES = { Empty: "interaction/active", Weak: "feedback/error/default", Fair: "feedback/warning/default", Good: "feedback/success/default" };
  segment = await variants("Strength segment", { Tone: Object.keys(TONES) }, ({ Tone }) => box("strength-segment", { component: true, w: 40, h: 4, radius: 999, fill: TONES[Tone] }), { cols: 4 });
  LEVELS = {
    "Too short": { n: 0, tone: "Empty", text: "text/secondary" },
    Weak: { n: 1, tone: "Weak", text: "feedback/error/text" },
    Fair: { n: 2, tone: "Fair", text: "feedback/warning/text" },
    Good: { n: 3, tone: "Good", text: "feedback/success/text" },
    Strong: { n: 4, tone: "Good", text: "feedback/success/text" },
  };
  strength = await variants("Password strength", { Strength: Object.keys(LEVELS) }, async ({ Strength }) => {
    const l = LEVELS[Strength];
    const b = box("password-strength", { component: true, dir: "row", gap: 12, w: W, cross: "CENTER" });
    const segs = box("segments", { dir: "row", gap: 6, cross: "CENTER" });
    for (let i = 0; i < 4; i++) {
      const s = inst(segment, { Tone: i < l.n ? l.tone : "Empty" });
      s.name = "segment-" + (i + 1);
      add(segs, s, { w: "fill" });
    }
    add(b, segs, { w: "fill" });
    const lab = await text(Strength, "Paragraph/Small Medium", l.text, "label");
    lab.textAlignHorizontal = "RIGHT";
    add(b, lab, { w: 64 });
    return b;
  }, { cols: 3 });
  wire(strength, [{ layer: "label", kind: "TEXT", name: "Label" }]);

  // ---- Inline edit: text that turns into a field in place -----------------------------------------------------------------
  inlineEdit = await variants("Inline edit", { Size: ["Title", "Text"], State: ["Rest", "Hover", "Editing"] }, async ({ Size, State }) => {
    const title = Size === "Title";
    const b = box("inline-edit", { component: true, dir: "row", gap: 8, pad: [4, 8], radius: "input", cross: "CENTER", fill: State === "Hover" ? "bg/muted" : State === "Editing" ? "bg/surface" : undefined, stroke: State === "Editing" ? "border/focus" : undefined, sw: 2 });
    const sel = box("selection", { dir: "row", pad: [0, 2], radius: 4, fill: State === "Editing" ? "feedback/info/subtle" : undefined });
    sel.appendChild(await text(title ? "Q3 roadmap" : "Jonas Berg", title ? "Display/3" : "Paragraph/Small Medium", "text/primary", "text"));
    b.appendChild(sel);
    const pen = await ico("pencil", title ? 18 : 16, "text/secondary", "pencil");
    pen.visible = State === "Hover";
    b.appendChild(pen);
    return b;
  }, { cols: 3 });
  wire(inlineEdit, [{ layer: "text", kind: "TEXT", name: "Text" }]);

  // ---- Scrub field: label, value, suffix, hairline showing the position in the range ----------------------------------------
  scrub = await variants("Scrub field", { Fill: ["25", "80"], State: ["Default", "Focus"] }, async ({ Fill, State }) => {
    const r = ringOf(State);
    const b = box("scrub-field", { component: true, gap: 4, pad: [6, 12], w: 160, radius: "input", fill: r.fill, stroke: r.stroke, sw: r.sw });
    const row = box("row", { dir: "row", gap: 6, cross: "CENTER" });
    add(row, await text("Opacity", "Paragraph/Small Regular", "text/secondary", "label"), { w: "fill" });
    row.appendChild(await text(Fill, "Paragraph/Small Medium", "text/primary", "value"));
    row.appendChild(await text("%", "Paragraph/Small Regular", "text/secondary", "suffix"));
    add(b, row, { w: "fill" });
    const track = box("track", { dir: "row", fill: "interaction/active", radius: 999 });
    add(track, box("bar", { fill: "border/input", radius: 999 }), { w: Math.round((136 * Number(Fill)) / 100), h: "fill" });
    add(b, track, { w: "fill", h: 2 });
    return b;
  }, { cols: 2 });
  wire(scrub, [
    { layer: "label", kind: "TEXT", name: "Label" },
    { layer: "value", kind: "TEXT", name: "Value" },
    { layer: "suffix", kind: "TEXT", name: "Suffix" },
  ]);

  // ---- Money field: symbol, grouped digits, currency code -----------------------------------------------------------------
  money = await variants("Money field", { State: ["Default", "Focus", "Disabled"] }, async ({ State }) => {
    const b = shell("money-field", State);
    b.appendChild(await text("$", "Paragraph/Medium Regular", dim(State), "symbol"));
    add(b, await text("1,249.50", "Paragraph/Small Regular", ink(State), "value"), { w: "fill" });
    b.appendChild(await text("USD", "Paragraph/Small Regular", dim(State), "code"));
    return b;
  }, { cols: 3 });
  wire(money, [
    { layer: "symbol", kind: "TEXT", name: "Symbol" },
    { layer: "value", kind: "TEXT", name: "Value" },
    { layer: "code", kind: "TEXT", name: "Code" },
  ]);

  // ---- Affix input: muted text before and after the value ------------------------------------------------------------------
  affix = await variants("Affix input", { State: ["Default", "Focus", "Disabled"] }, async ({ State }) => {
    const b = shell("affix-input", State, { gap: 4 });
    b.appendChild(await text("https://", "Paragraph/Small Regular", dim(State), "prefix"));
    add(b, await text("figma.com", "Paragraph/Small Regular", ink(State), "value"), { w: "fill" });
    const sfx = await text("kg", "Paragraph/Small Regular", dim(State), "suffix");
    sfx.visible = false;
    b.appendChild(sfx);
    return b;
  }, { cols: 3 });
  wire(affix, [
    { layer: "prefix", kind: "BOOLEAN", name: "Prefix", def: true },
    { layer: "prefix", kind: "TEXT", name: "Prefix text" },
    { layer: "value", kind: "TEXT", name: "Value" },
    { layer: "suffix", kind: "BOOLEAN", name: "Suffix", def: false },
    { layer: "suffix", kind: "TEXT", name: "Suffix text" },
  ]);

  // ---- Shortcut recorder: empty hint, recording (pulsing dot), recorded keys with a clear button ----------------------------------
  recorder = await variants("Shortcut recorder", { State: ["Empty", "Recording", "Recorded"] }, async ({ State }) => {
    const b = shell("shortcut-recorder", State === "Recording" ? "Focus" : "Default", { w: 240, gap: 6, pad: [5, 12] }); // keycaps 26 tall
    if (State === "Recorded") {
      ["Ctrl", "Shift", "P"].forEach((k, i) => {
        const key = inst(keycap, {}, { Key: k });
        key.name = "key-" + (i + 1);
        b.appendChild(key);
      });
      add(b, box("spacer", { dir: "row" }), { w: "fill", h: 16 });
      b.appendChild(await ico("x", 18, "text/primary", "clear"));
    } else {
      if (State === "Recording") {
        b.appendChild(box("dot", { w: 8, h: 8, radius: 999, fill: "feedback/error/default" }));
        const key = inst(keycap, {}, { Key: "Ctrl" });
        key.name = "key-1";
        b.appendChild(key);
      }
      add(b, await text(State === "Recording" ? "Press keys" : "Record shortcut", "Paragraph/Small Regular", "text/placeholder", "hint"), { w: "fill" });
      if (State === "Empty") b.appendChild(await ico("keyboard", 18, "text/secondary", "icon"));
    }
    return b;
  }, { cols: 3 });
  wire(recorder, [{ layer: "hint", kind: "TEXT", name: "Hint" }]);

  // ---- Rating: five stars, filled up to the value ---------------------------------------------------------------------------------
  STAR = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 4.6 : 11;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    STAR.push([+(11 + r * Math.cos(a)).toFixed(2), +(11.6 + r * Math.sin(a)).toFixed(2)]);
  }
  ratingStar = await variants("Rating star", { Filled: ["Off", "On"] }, async ({ Filled }) => {
    const b = box("rating-star", { component: true, dir: "row", w: 24, h: 24, align: "CENTER", cross: "CENTER" });
    const v = figma.createVector();
    v.name = "star";
    v.vectorPaths = [{ windingRule: "NONZERO", data: STAR.map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`).join(" ") + " Z" }];
    const color = Filled === "On" ? "feedback/warning/default" : "interaction/active";
    v.fills = [solid(color)];
    v.strokes = [solid(color)];
    v.strokeWeight = 1.5;
    v.strokeJoin = "ROUND";
    b.appendChild(v);
    return b;
  }, { cols: 2 });
  rating = await variants("Rating", { Value: ["0", "1", "2", "3", "4", "5"] }, ({ Value }) => {
    const b = box("rating", { component: true, dir: "row", gap: 2, cross: "CENTER" });
    for (let i = 0; i < 5; i++) {
      const s = inst(ratingStar, { Filled: i < Number(Value) ? "On" : "Off" });
      s.name = "star-" + (i + 1);
      b.appendChild(s);
    }
    return b;
  }, { cols: 3 });
}

// ---- Combobox: floating panel with a filter field and the option list ---------------------------------------------------------------
const option = await variants("Combobox option", { State: ["Default", "Hover", "Selected"] }, async ({ State }) => {
  const b = box("combobox-option", { component: true, dir: "row", gap: 8, pad: [8, 12], w: 268, radius: 8, cross: "CENTER", fill: State === "Default" ? undefined : "interaction/hover" });
  add(b, await text("Option", "Paragraph/Small Regular", "text/primary", "label"), { w: "fill" });
  const ck = await ico("check", 16, "text/primary", "check");
  ck.visible = State === "Selected";
  b.appendChild(ck);
  return b;
}, { cols: 3 });
wire(option, [{ layer: "label", kind: "TEXT", name: "Label" }]);
const combobox = await variants("Combobox", { Query: ["None", "Filtered"] }, async ({ Query }) => {
  const filtered = Query === "Filtered";
  const b = box("combobox", { component: true, gap: 2, pad: 6, w: W, radius: "panel", fill: "bg/surface", stroke: "border/default" });
  await b.setEffectStyleIdAsync(ES["Elevation/lg"].id);
  const f = box("filter", { dir: "row", gap: 8, pad: [8, 12], cross: "CENTER" });
  f.appendChild(await ico("search", 16, "text/secondary", "filter-icon"));
  add(f, await text(filtered ? "ja" : "Search", "Paragraph/Small Regular", filtered ? "text/primary" : "text/placeholder", "filter-text"), { w: "fill" });
  add(b, f, { w: "fill" });
  const sep = box("separator", { pad: [4, 4] });
  add(sep, box("line", { fill: "border/default" }), { w: "fill", h: 1 });
  add(b, sep, { w: "fill" });
  const list = filtered ? [["Japan", "Hover"]] : [["Canada"], ["Denmark"], ["Germany", "Selected"], ["Japan"], ["Kenya"]];
  list.forEach(([l, s], i) => {
    const o = inst(option, { State: s || "Default" }, { Label: l });
    o.name = "option-" + (i + 1);
    add(b, o, { w: "fill" });
  });
  return b;
}, { cols: 2 });
wire(combobox, [{ layer: "filter-text", kind: "TEXT", name: "Query" }]);
await slotify(combobox, "Options", { from: 2 });

// ---- board cards ------------------------------------------------------------------------------------------------------------------------
const c = await H.cursor();
const body = null;
const sub = (s) => text(s, "Paragraph/Mini Regular", "text/secondary", "sub");
// small caption above a node
const stack = async (caption, node) => {
  const g = box(caption, { gap: 6 });
  g.appendChild(await sub(caption));
  g.appendChild(node);
  return g;
};

if (keep("Number field")) {
  const k1 = await card(body, "Number field", "Stepper · focus · suffix");
  k1.card.appendChild(fieldOf(numberField, "Seats", "Between 1 and 100"));
  k1.card.appendChild(await stack("Focus", inst(numberField, { State: "Focus" }, { Value: "12" })));
  k1.card.appendChild(await stack("Suffix", inst(numberField, {}, { Value: "24.00", Suffix: true })));
  k1.card.appendChild(await stack("Disabled", inst(numberField, { State: "Disabled" })));
  await burst(c, k1.wrap);
}

if (keep("Tag input")) {
  const k2 = await card(body, "Tag input", "Tags · empty · focus");
  k2.card.appendChild(fieldOf(tagInput, "Topics", "Enter or comma adds a tag"));
  k2.card.appendChild(await stack("Focus", inst(tagInput, { State: "Focus", Tags: "Filled" })));
  k2.card.appendChild(await stack("Empty", inst(tagInput, { Tags: "Empty" })));
  await burst(c, k2.wrap);
}

const k3 = await card(body, "One time code", "Empty · partial · full");
for (const Progress of ["Empty", "Half", "Full"]) k3.card.appendChild(inst(otp, { Progress }));
await burst(c, k3.wrap);

if (keep("Password strength")) {
  const k4 = await card(body, "Password strength", "Score 0 to 4");
  const pw = box("password", { gap: 8 });
  pw.appendChild(fieldOf(input, "Password", null, { Value: "Filled", Text: "•••••••••••••", "Right icon": true, "Right icon swap": IC.eye.id }));
  add(pw, inst(strength, { Strength: "Good" }), { w: "fill" });
  k4.card.appendChild(pw);
  for (const Strength of ["Too short", "Weak", "Fair", "Strong"]) k4.card.appendChild(await stack(Strength, inst(strength, { Strength })));
  await burst(c, k4.wrap);
}

if (keep("Inline edit")) {
  const k5 = await card(body, "Inline edit", "Rest · hover · editing");
  k5.card.appendChild(inst(inlineEdit, { Size: "Title", State: "Hover" }));
  for (const [label, State, value] of [["Owner", "Rest", "Jonas Berg"], ["Due", "Editing", "End of September"]]) {
    const row = box(label, { dir: "row", gap: 24, cross: "CENTER" });
    add(row, await text(label, "Paragraph/Small Regular", "text/secondary", "label"), { w: 56 });
    row.appendChild(inst(inlineEdit, { Size: "Text", State }, { Text: value }));
    k5.card.appendChild(row);
  }
  await burst(c, k5.wrap);
}

if (keep("Scrub field")) {
  const k6 = await card(body, "Scrub field", "Drag to change · hairline");
  const r6 = box("scrubs", { dir: "row", gap: 16 });
  r6.appendChild(inst(scrub, { Fill: "80" }));
  r6.appendChild(inst(scrub, { Fill: "25" }, { Label: "Radius", Value: "12.0", Suffix: "px" }));
  r6.appendChild(inst(scrub, { Fill: "25", State: "Focus" }, { Label: "Blur", Value: "24", Suffix: "px" }));
  k6.card.appendChild(r6);
  await burst(c, k6.wrap);
}

if (keep("Money field")) {
  const k7 = await card(body, "Money field", "Symbol · grouped digits · code");
  k7.card.appendChild(fieldOf(money, "Amount", null));
  k7.card.appendChild(await stack("Whole euros", inst(money, {}, { Symbol: "€", Value: "52,000", Code: "EUR" })));
  k7.card.appendChild(await stack("Focus", inst(money, { State: "Focus" }, { Value: "1249.5" })));
  k7.card.appendChild(await stack("Disabled", inst(money, { State: "Disabled" })));
  await burst(c, k7.wrap);
}

if (keep("Prefix and suffix")) {
  const k8 = await card(body, "Prefix and suffix", "Muted text around the value");
  k8.card.appendChild(fieldOf(affix, "Website", null));
  k8.card.appendChild(fieldOf(affix, "Weight", null, { Prefix: false, Suffix: true, Value: "72" }));
  k8.card.appendChild(await stack("Focus", inst(affix, { State: "Focus" })));
  k8.card.appendChild(await stack("Disabled", inst(affix, { State: "Disabled" })));
  await burst(c, k8.wrap);
}

if (keep("Shortcut recorder")) {
  const k9 = await card(body, "Shortcut recorder", "Empty · recording · recorded");
  for (const State of ["Empty", "Recording", "Recorded"]) k9.card.appendChild(await stack(State, inst(recorder, { State })));
  await burst(c, k9.wrap);
}

if (keep("Rating")) {
  const k10 = await card(body, "Rating", "0 to 5 stars");
  for (const Value of ["4", "2", "5", "0"]) k10.card.appendChild(await stack(Value + " of 5", inst(rating, { Value })));
  await burst(c, k10.wrap);
}

const k11 = await card(body, "Combobox", "Trigger · filter · options");
// select triggers carry the user-round swap (hidden icon), as on the Select card
const userRound = (await H.icon("user-round", ICON)).id;
const cols = box("columns", { dir: "row", gap: 24, cross: "MIN" });
const col1 = box("browse", { gap: 8 });
col1.appendChild(inst(input, { Type: "Select", State: "Focus", Value: "Filled" }, { Text: "Germany", "Left icon swap": userRound }));
col1.appendChild(inst(combobox, { Query: "None" }));
cols.appendChild(col1);
const col2 = box("filtered", { gap: 8 });
col2.appendChild(inst(input, { Type: "Select", State: "Focus", Value: "Filled" }, { Text: "Japan", "Left icon swap": userRound }));
col2.appendChild(inst(combobox, { Query: "Filtered" }));
cols.appendChild(col2);
k11.card.appendChild(cols);
await burst(c, k11.wrap);
c.done();
return {
  numberField: numberField?.children.length, tagInput: tagInput?.children.length, codeBox: codeBox.children.length, otp: otp.children.length,
  strength: strength?.children.length, inlineEdit: inlineEdit?.children.length, scrub: scrub?.children.length, money: money?.children.length,
  affix: affix?.children.length, recorder: recorder?.children.length, rating: rating?.children.length, combobox: combobox.children.length, cards: CUI ? 11 : 2,
};
