// CUI motion pages as static frames: Text effects (Shimmer text, Typewriter text, Reveal text, Word rotate), Rolling numbers
// (Roll digit, Rolling number), Gradient text and spotlight cards (solid-token approximation), Loaders (Loader mark, Loader),
// Dock (Count badge, Dock item, Dock), Control tiles, Now playing / Waveform / Voice player / Tab bar (Tab bar item, Tab bar), board cards.
// Gradient stops cannot be bound to variables, so "Gradient text" steps through solid tones and "Spotlight card" lights its border.
// v1 (green dots): Control tile only
const NEW = !CUI ? ["Control tile"] : [
  "Count badge", "Loader mark", "Loader", "Shimmer text", "Typewriter text", "Reveal text", "Word rotate", "Roll digit", "Rolling number",
  "Gradient text", "Spotlight card", "Dock item", "Dock", "Control tile", "Now playing", "Waveform", "Voice player", "Tab bar item", "Tab bar",
];
for (const n of NEW) setNamed(n)?.remove();
const ICONS = !CUI ? ["wifi", "radio", "moon", "share-2", "sun"] : [
  "music", "skip-back", "skip-forward", "play", "pause", "house", "search", "inbox", "user-round", "folder", "mail", "calendar",
  "square-terminal", "palette", "settings", "trash-2", "wifi", "radio", "moon", "share-2", "sun", "rocket", "bell",
];
const IC = {};
for (const n of ICONS) IC[n] = await H.icon(n, ICON);
const pick = (...n) => n.map((k) => IC[k]);
const tooltip = setNamed("Tooltip");
const iconButton = setNamed("Icon button");
const progress = setNamed("Progress");
const MS = rootNamed(MASTERS);
// set a component property on an instance by its base name
const setProp = (i, name, value) => {
  const key = Object.keys(i.componentProperties).find((k) => k.split("#")[0] === name);
  if (!key) throw new Error(`no property ${name} on ${i.name}`);
  i.setProperties({ [key]: value });
};
const part = (i, name) => i.findOne((n) => n.name === name);

// ---- Control tile: quick setting, square or wide, on (inverse) or off -----------------------------------------------------
const tile = await variants("Control tile", { Size: ["Square", "Wide"], State: ["On", "Off"] }, async ({ Size, State }) => {
  const on = State === "On";
  const wide = Size === "Wide";
  const b = box("control-tile", { component: true, dir: wide ? "row" : "col", gap: 12, pad: wide ? [12, 14] : 14, w: wide ? 308 : 148, minH: wide ? 64 : 112, radius: "surface", fill: on ? "bg/inverse" : "bg/subtle", stroke: on ? undefined : "border/default", cross: wide ? "CENTER" : undefined, align: wide ? undefined : "SPACE_BETWEEN" });
  const disc = box("disc", { dir: "row", w: 36, h: 36, radius: 999, fill: on ? "primary/active" : "bg/surface", align: "CENTER", cross: "CENTER" });
  disc.appendChild(await ico("wifi", 18, on ? "text/on-primary" : "text/primary", "icon"));
  b.appendChild(disc);
  const t = box("text");
  t.appendChild(await text("Wi-Fi", "Paragraph/Small Medium", on ? "text/on-primary" : "text/primary", "title"));
  t.appendChild(await text("Home", "Paragraph/Small Regular", on ? "text/placeholder" : "text/secondary", "detail"));
  add(b, t, wide ? { w: "fill" } : undefined);
  return b;
}, { cols: 2 });
wire(tile, [
  { layer: "icon", kind: "SWAP", name: "Icon", def: IC.wifi.id, pref: pick("wifi", "radio", "moon", "share-2", "sun") },
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "detail", kind: "TEXT", name: "Detail" },
]);

// tile card, shared by both flavors
async function tileCard(c, body, row) {
  const k6 = await card(body, "Control tiles", "Square · wide · on · off", { gap: 12 });
  const tl = (Size, State, Icon, Title, Detail) => inst(tile, { Size, State }, { Icon: IC[Icon].id, Title, Detail });
  k6.card.appendChild(row("wifi-hotspot", [tl("Square", "On", "wifi", "Wi-Fi", "Home"), tl("Square", "Off", "radio", "Hotspot", "Off")], 12));
  k6.card.appendChild(row("focus-airshare", [tl("Square", "On", "moon", "Focus", "Until 6 pm"), tl("Square", "Off", "share-2", "AirShare", "Contacts only")], 12));
  k6.card.appendChild(tl("Wide", "On", "sun", "Dark appearance", "On"));
  await burst(c, k6.wrap);
}
if (!CUI) {
  const c = await H.cursor();
  const row = (name, items, gap = 16, cross = "CENTER") => {
    const r = box(name, { dir: "row", gap, cross });
    items.forEach((i) => r.appendChild(i));
    return r;
  };
  await tileCard(c, null, row);
  c.done();
  return { controlTile: tile.children.length, cards: 1 };
}

// ---- Count badge: solid red pill with a number (dock item, tab bar item) -------------------------------------------
const countBadge = box("Count badge", { component: true, dir: "row", pad: [0, 5], h: 18, radius: 999, fill: "danger/default", align: "CENTER", cross: "CENTER" });
countBadge.minWidth = 18;
countBadge.appendChild(await text("3", "Paragraph/Mini Medium", "text/on-primary", "count"));
MS.appendChild(countBadge);
wire(countBadge, [{ layer: "count", kind: "TEXT", name: "Count" }]);

// ---- Loader mark: dot, bar or cell in three tones, resized by the loader that uses it -------------------------------
const TONES = { Strong: "text/secondary", Medium: "text/placeholder", Soft: "border/strong" };
const mark = await variants("Loader mark", { Shape: ["Dot", "Bar", "Cell"], Tone: Object.keys(TONES) }, ({ Shape, Tone }) =>
  box("loader-mark", { component: true, w: 10, h: 10, radius: Shape === "Cell" ? 2 : 999, fill: TONES[Tone] }), { cols: 3 });
const m = (Shape, Tone, w, h = w) => {
  const i = inst(mark, { Shape, Tone });
  i.resize(w, h);
  return i;
};

// ---- Loader: five styles in a 40 px cell ------------------------------------------------------------------------------
const loader = await variants("Loader", { Style: ["Dots", "Bars", "Pulse", "Orbit", "Grid"] }, async ({ Style }) => {
  const b = box("loader", { component: true, dir: "row", w: 40, h: 40, align: "CENTER", cross: "CENTER" });
  if (Style === "Dots") {
    const r = box("dots", { dir: "row", gap: 4, cross: "CENTER" });
    [[6, "Strong"], [8, "Strong"], [6, "Medium"]].forEach(([s, t], i) => {
      const d = m("Dot", t, s);
      d.name = "dot-" + (i + 1);
      r.appendChild(d);
    });
    b.appendChild(r);
  } else if (Style === "Bars") {
    const r = box("bars", { dir: "row", gap: 4, cross: "CENTER" });
    [26, 30, 22, 16].forEach((h, i) => {
      const bar = m("Bar", i < 2 ? "Strong" : "Medium", 4, h);
      bar.name = "bar-" + (i + 1);
      r.appendChild(bar);
    });
    b.appendChild(r);
  } else if (Style === "Pulse") {
    const ring = box("ring", { dir: "row", w: 30, h: 30, radius: 999, stroke: "border/strong", sw: 3, align: "CENTER", cross: "CENTER" });
    const core = m("Dot", "Strong", 10);
    core.name = "core";
    ring.appendChild(core);
    b.appendChild(ring);
  } else if (Style === "Orbit") {
    // faint ring with a comet arc on top: the arc overlaps the ring through a negative gap
    const r = box("orbit", { dir: "row", cross: "CENTER" });
    num(r, "itemSpacing", -30);
    const track = figma.createEllipse();
    track.name = "track";
    track.arcData = { startingAngle: 0, endingAngle: Math.PI * 2, innerRadius: 0.82 };
    track.fills = [solid("border/default")];
    add(r, track, { w: 30, h: 30 });
    const comet = figma.createEllipse();
    comet.name = "comet";
    comet.arcData = { startingAngle: -1.3, endingAngle: 0.5, innerRadius: 0.82 };
    comet.fills = [solid("text/secondary")];
    add(r, comet, { w: 30, h: 30 });
    b.appendChild(r);
  } else {
    const g = box("grid", { gap: 3 });
    const SZ = [[14, 14, 12], [14, 10, 8], [12, 8, 6]];
    const TN = [["Strong", "Strong", "Medium"], ["Strong", "Medium", "Soft"], ["Medium", "Soft", "Soft"]];
    for (let y = 0; y < 3; y++) {
      const row = box("row-" + (y + 1), { dir: "row", gap: 3 });
      for (let x = 0; x < 3; x++) {
        const cell = box("slot-" + (x + 1), { dir: "row", w: 14, h: 14, align: "CENTER", cross: "CENTER" });
        const c = m("Cell", TN[y][x], SZ[y][x]);
        c.name = "cell";
        cell.appendChild(c);
        row.appendChild(cell);
      }
      g.appendChild(row);
    }
    b.appendChild(g);
  }
  return b;
}, { cols: 5 });

// ---- Shimmer text: loader dots and a muted sentence with a bright stretch -----------------------------------------------
const SHIMMER = ["Thinking about", "your", "question..."];
const shimmer = await variants("Shimmer text", { Highlight: ["Start", "Middle", "End"] }, async ({ Highlight }) => {
  const b = box("shimmer-text", { component: true, dir: "row", gap: 8, cross: "CENTER" });
  const l = inst(loader, { Style: "Dots" });
  l.name = "loader";
  l.resize(24, 24);
  b.appendChild(l);
  const words = box("words", { dir: "row", gap: 4, cross: "CENTER" });
  const at = { Start: 0, Middle: 1, End: 2 }[Highlight];
  for (let i = 0; i < SHIMMER.length; i++) words.appendChild(await text(SHIMMER[i], "Paragraph/Medium Regular", i === at ? "text/primary" : "text/secondary", "word-" + (i + 1)));
  b.appendChild(words);
  return b;
}, { cols: 3 });
wire(shimmer, [{ layer: "loader", kind: "BOOLEAN", name: "Loader", def: true }]);

// ---- Typewriter text: sentence uncovered up to a caret ------------------------------------------------------------------
const typewriter = box("Typewriter text", { component: true, dir: "row", cross: "CENTER" });
typewriter.appendChild(await text("CUI draws a full frame in a fraction of a millisecon", "Paragraph/Medium Regular", "text/primary", "content"));
typewriter.appendChild(box("caret", { w: 2, h: 18, fill: "text/primary" }));
MS.appendChild(typewriter);
wire(typewriter, [
  { layer: "content", kind: "TEXT", name: "Text" },
  { layer: "caret", kind: "BOOLEAN", name: "Caret", def: true },
]);

// ---- Reveal text: words fading and lifting in one after another ----------------------------------------------------------
const REVEAL = ["The release build", "finished in", "3 minutes", "42 seconds."];
const reveal = await variants("Reveal text", { Stage: ["Revealing", "Done"] }, async ({ Stage }) => {
  const b = box("reveal-text", { component: true, dir: "row", gap: 6, cross: "CENTER" });
  const tones = Stage === "Done" ? ["text/primary", "text/primary", "text/primary", "text/primary"] : ["text/primary", "text/primary", "text/secondary", "text/placeholder"];
  for (let i = 0; i < REVEAL.length; i++) b.appendChild(await text(REVEAL[i], "Display/4", tones[i], "chunk-" + (i + 1)));
  return b;
}, { cols: 2 });

// ---- Word rotate: the new word rolls up over the old one, the width follows the word -----------------------------------
const rotate = await variants("Word rotate", { State: ["Settled", "Rolling"] }, async ({ State }) => {
  const b = box("word-rotate", { component: true, dir: "row", gap: 8, cross: "CENTER" });
  b.appendChild(await text("Deploying to", "Display/3", "text/primary", "prefix"));
  // clipped slot centered on the boundary of the two words: lower half of the old one, upper half of the new one
  const slot = box("slot", { align: "CENTER", clip: true, h: 27 });
  const old = await text("staging.", "Display/3", "text/placeholder", "previous");
  old.visible = State === "Rolling";
  slot.appendChild(old);
  slot.appendChild(await text("eu-west.", "Display/3", "text/primary", "word"));
  b.appendChild(slot);
  return b;
}, { cols: 2 });
wire(rotate, [{ layer: "prefix", kind: "TEXT", name: "Prefix" }]);

// ---- Roll digit / Rolling number -----------------------------------------------------------------------------------------------
const roll = await variants("Roll digit", { State: ["Settled", "Rolling"] }, async ({ State }) => {
  const b = box("roll-digit", { component: true, align: "CENTER", clip: true, h: 34 });
  const prev = await text("1", "Display/2", "text/placeholder", "previous");
  prev.visible = State === "Rolling";
  b.appendChild(prev);
  b.appendChild(await text("3", "Display/2", "text/primary", "digit"));
  return b;
}, { cols: 2 });
wire(roll, [
  { layer: "digit", kind: "TEXT", name: "Digit" },
  { layer: "previous", kind: "TEXT", name: "Previous" },
]);
const number = await variants("Rolling number", { State: ["Settled", "Rolling"] }, async ({ State }) => {
  const b = box("rolling-number", { component: true, dir: "row", cross: "CENTER" });
  b.appendChild(await text("$", "Display/2", "text/primary", "prefix"));
  b.appendChild(await text(State === "Rolling" ? "48,2" : "48,238", "Display/2", "text/primary", "head"));
  if (State === "Rolling") {
    const r1 = inst(roll, { State: "Rolling" }, { Digit: "3", Previous: "1" });
    r1.name = "roll-1";
    b.appendChild(r1);
    const r2 = inst(roll, { State: "Rolling" }, { Digit: "8", Previous: "0" });
    r2.name = "roll-2";
    b.appendChild(r2);
  }
  return b;
}, { cols: 2 });
wire(number, [{ layer: "prefix", kind: "TEXT", name: "Prefix" }]);

// ---- Gradient text: solid tone steps stand in for the blend (stops cannot be variable bound) ----------------------------
const BLEND = {
  Accent: ["primary/default", "primary/hover", "primary/active", "text/secondary"],
  Custom: ["feedback/info/default", "feedback/info/text", "feedback/success/text", "feedback/success/default"],
};
const CHUNKS = ["Ki", "ln ", "2.", "4"];
const gradient = await variants("Gradient text", { Blend: Object.keys(BLEND) }, async ({ Blend }) => {
  const b = box("gradient-text", { component: true, dir: "row", cross: "CENTER" });
  for (let i = 0; i < CHUNKS.length; i++) b.appendChild(await text(CHUNKS[i], "Display/1", BLEND[Blend][i], "chunk-" + (i + 1)));
  return b;
}, { cols: 2 });

// ---- Spotlight card: rest, lit border under the pointer, beam border ---------------------------------------------------------
const SPOT = { Rest: { fill: "bg/surface", stroke: "border/default" }, Lit: { fill: "bg/subtle", stroke: "border/input" }, Beam: { fill: "bg/subtle", stroke: "primary/default" } };
const spot = await variants("Spotlight card", { State: Object.keys(SPOT) }, async ({ State }) => {
  const s = SPOT[State];
  const b = box("spotlight-card", { component: true, gap: 16, pad: 20, w: 300, radius: "panel", fill: s.fill, stroke: s.stroke });
  const head = box("head", { dir: "row", gap: 12, cross: "CENTER" });
  const tile = box("tile", { dir: "row", w: 36, h: 36, radius: 8, align: "CENTER", cross: "CENTER", fill: "bg/muted" });
  tile.appendChild(await ico("rocket", 18, "text/primary", "icon"));
  head.appendChild(tile);
  const t = box("text");
  t.appendChild(await text("OpenGL 3.3", "Paragraph/Small Medium", "text/primary", "title"));
  t.appendChild(await text("Compiling shaders", "Paragraph/Small Regular", "text/secondary", "description"));
  add(head, t, { w: "fill" });
  add(b, head, { w: "fill" });
  const p = inst(progress, { Value: "60" });
  p.name = "progress";
  add(b, p, { w: "fill" });
  return b;
}, { cols: 3 });
wire(spot, [
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "description", kind: "TEXT", name: "Description" },
]);

// ---- Dock item: app tile growing with the pointer, optional count badge and running dot -------------------------------
const DTONE = {
  Info: ["feedback/info/default", "text/on-primary"],
  Success: ["feedback/success/default", "text/on-primary"],
  Danger: ["danger/default", "text/on-primary"],
  Warning: ["feedback/warning/default", "text/on-primary"],
  Dark: ["bg/inverse", "text/on-primary"],
  Plain: ["bg/muted", "text/primary"],
};
const DSCALE = { Rest: [46, 24, 12], Neighbor: [54, 28, 14], Active: [70, 34, 16] };
const ditem = await variants("Dock item", { Tone: Object.keys(DTONE), Scale: Object.keys(DSCALE) }, async ({ Tone, Scale }) => {
  const [bg, fg] = DTONE[Tone];
  const [s, isz, r] = DSCALE[Scale];
  const b = box("dock-item", { component: true, gap: 4, cross: "CENTER" });
  // badge overlaps the tile's top right corner: negative gap, row fixed to the tile width so the badge overflows
  // without widening the item
  const row = box("tile-row", { dir: "row", w: s, cross: "MIN" });
  row.clipsContent = false;
  num(row, "itemSpacing", -10);
  const tile = box("tile", { dir: "row", w: s, h: s, radius: r, fill: bg, align: "CENTER", cross: "CENTER" });
  tile.appendChild(await ico("folder", isz, fg, "icon"));
  row.appendChild(tile);
  const bd = inst(countBadge, {}, { Count: "3" });
  bd.name = "badge";
  bd.visible = false;
  row.appendChild(bd);
  b.appendChild(row);
  const slot = box("dot-slot", { dir: "row", w: 6, h: 6, align: "CENTER", cross: "CENTER" });
  const dot = box("running", { w: 4, h: 4, radius: 999, fill: "text/secondary" });
  dot.visible = false;
  slot.appendChild(dot);
  b.appendChild(slot);
  return b;
}, { cols: 3 });
wire(ditem, [
  { layer: "icon", kind: "SWAP", name: "Icon", def: IC.folder.id, pref: pick("folder", "mail", "calendar", "music", "square-terminal", "palette", "settings", "trash-2") },
  { layer: "badge", kind: "BOOLEAN", name: "Badge", def: false },
  { layer: "running", kind: "BOOLEAN", name: "Running", def: false },
]);

// ---- Dock: capsule of items, the one under the pointer largest, neighbours following -----------------------------------
const APPS = [
  ["folder", "Info", { Running: true }], ["mail", "Success", { Badge: true }], ["calendar", "Danger", {}], ["music", "Warning", { Running: true }],
  ["square-terminal", "Dark", {}], ["palette", "Info", {}], null, ["settings", "Plain", {}], ["trash-2", "Plain", {}],
];
const dock = await variants("Dock", { Pointer: ["Away", "Over Music"] }, async ({ Pointer }) => {
  // bottom padding + item gap 4 + dot slot 6 = top padding: tiles sit centred in the capsule
  const b = box("dock", { component: true, dir: "row", gap: 8, pad: [16, 16, 6, 16], radius: 999, fill: "bg/subtle", stroke: "border/default", cross: "CENTER" });
  await b.setEffectStyleIdAsync(ES["Elevation/lg"].id);
  let n = 0;
  APPS.forEach((a, i) => {
    if (!a) {
      const sep = box("separator", { dir: "row", w: 1, h: 34, fill: "border/strong" });
      b.appendChild(sep);
      return;
    }
    const over = Pointer === "Over Music" ? 3 : -9;
    const Scale = i === over ? "Active" : Math.abs(i - over) === 1 ? "Neighbor" : "Rest";
    const it = inst(ditem, { Tone: a[1], Scale }, { Icon: IC[a[0]].id, ...a[2] });
    it.name = "item-" + ++n;
    b.appendChild(it);
  });
  return b;
}, { cols: 2 });

// ---- Now playing: artwork, title, transport, scrubber with times ----------------------------------------------------------
const player = await variants("Now playing", { Playing: ["On", "Off"] }, async ({ Playing }) => {
  const b = box("now-playing", { component: true, gap: 12, pad: 16, w: 360, radius: "surface", fill: "bg/surface", stroke: "border/default" });
  const top = box("top", { dir: "row", gap: 12, cross: "CENTER" });
  const art = box("art", { dir: "row", w: 64, h: 64, radius: 12, fill: "danger/default", align: "CENTER", cross: "CENTER" });
  art.appendChild(await ico("music", 28, "text/on-primary", "art-icon"));
  top.appendChild(art);
  const t = box("text");
  t.appendChild(await text("Low Tide", "Paragraph/Medium Medium", "text/primary", "title"));
  t.appendChild(await text("Marlow Avenue", "Paragraph/Small Regular", "text/secondary", "artist"));
  add(top, t, { w: "fill" });
  const ctl = box("controls", { dir: "row", gap: 4, cross: "CENTER" });
  const prev = inst(iconButton, { Type: "Ghost", Size: "md" }, { Icon: IC["skip-back"].id });
  prev.name = "previous";
  ctl.appendChild(prev);
  const play = box("play", { dir: "row", w: 40, h: 40, radius: 999, fill: "primary/default", align: "CENTER", cross: "CENTER" });
  play.appendChild(await ico(Playing === "On" ? "pause" : "play", 18, "text/on-primary", "play-icon"));
  ctl.appendChild(play);
  const next = inst(iconButton, { Type: "Ghost", Size: "md" }, { Icon: IC["skip-forward"].id });
  next.name = "next";
  ctl.appendChild(next);
  top.appendChild(ctl);
  add(b, top, { w: "fill" });
  const bar = box("scrubber", { dir: "row", gap: 12, cross: "CENTER" });
  bar.appendChild(await text("1:16", "Paragraph/Mini Regular", "text/secondary", "elapsed"));
  const track = box("track", { dir: "row", radius: 999, fill: "interaction/active", clip: true });
  add(track, box("played", { fill: "primary/default" }), { w: 90, h: "fill" });
  add(bar, track, { w: "fill", h: 4 });
  bar.appendChild(await text("-2:26", "Paragraph/Mini Regular", "text/secondary", "remaining"));
  add(b, bar, { w: "fill" });
  return b;
}, { cols: 2 });
wire(player, [
  { layer: "title", kind: "TEXT", name: "Title" },
  { layer: "artist", kind: "TEXT", name: "Artist" },
]);

// ---- Waveform: peaks as two vectors, the played part dark, the rest light ------------------------------------------------
const PEAKS = Array.from({ length: 44 }, (_, i) => Math.round(6 + 24 * Math.abs(Math.sin(i * 0.71) * Math.cos(i * 0.29 + 1))));
const H_WAVE = 34;
const peaks = (from, to) => {
  const out = [];
  for (let i = from; i < to; i++) {
    const x = (i - from) * 6;
    const h = PEAKS[i];
    out.push(`M ${x} ${(H_WAVE - h) / 2} L ${x} ${(H_WAVE + h) / 2}`);
  }
  return out.join(" ");
};
const wave = await variants("Waveform", { Played: ["None", "Part"] }, async ({ Played }) => {
  const b = box("waveform", { component: true, dir: "row", gap: 6, cross: "CENTER" });
  const cut = Played === "Part" ? 17 : 0;
  const vec = (name, from, to, color) => {
    const v = figma.createVector();
    v.name = name;
    v.vectorPaths = [{ windingRule: "NONE", data: peaks(from, to) }];
    v.strokes = [solid(color)];
    v.strokeWeight = 3;
    v.strokeCap = "ROUND";
    v.fills = [];
    b.appendChild(v);
  };
  if (cut) vec("played", 0, cut, "primary/default");
  vec("rest", cut, PEAKS.length, "text/placeholder");
  return b;
}, { cols: 2 });

// ---- Voice player: play button, waveform, time -----------------------------------------------------------------------------------
const voice = box("Voice player", { component: true, dir: "row", gap: 12, pad: 12, radius: "surface", fill: "bg/surface", stroke: "border/default", cross: "CENTER" });
const vp = inst(iconButton, { Type: "Secondary", Size: "md" }, { Icon: IC.play.id });
vp.name = "play";
voice.appendChild(vp);
const vw = inst(wave, { Played: "Part" });
vw.name = "waveform";
voice.appendChild(vw);
voice.appendChild(await text("0:42", "Paragraph/Small Regular", "text/secondary", "time"));
MS.appendChild(voice);
wire(voice, [{ layer: "time", kind: "TEXT", name: "Time" }]);

// ---- Tab bar item / Tab bar: icon over label, the selected one on a rounded pill -----------------------------------------
const titem = await variants("Tab bar item", { Selected: ["Off", "On"] }, async ({ Selected }) => {
  const on = Selected === "On";
  const fg = on ? "text/primary" : "text/secondary";
  const b = box("tab-bar-item", { component: true, gap: 2, w: 80, h: 52, radius: 14, align: "CENTER", cross: "CENTER", fill: on ? "bg/muted" : undefined });
  const row = box("icon-row", { dir: "row", cross: "MIN" });
  num(row, "itemSpacing", -10);
  row.appendChild(await ico("house", 22, fg, "icon"));
  const bd = inst(countBadge, {}, { Count: "4" });
  bd.name = "badge";
  bd.visible = false;
  row.appendChild(bd);
  b.appendChild(row);
  b.appendChild(await text("Home", "Paragraph/Mini Medium", fg, "label"));
  return b;
}, { cols: 2 });
wire(titem, [
  { layer: "icon", kind: "SWAP", name: "Icon", def: IC.house.id, pref: pick("house", "search", "inbox", "user-round", "bell") },
  { layer: "label", kind: "TEXT", name: "Label" },
  { layer: "badge", kind: "BOOLEAN", name: "Badge", def: false },
]);
const tabbar = box("Tab bar", { component: true, dir: "row", gap: 4, pad: 6, radius: "surface", fill: "bg/surface", stroke: "border/default" });
await tabbar.setEffectStyleIdAsync(ES["Elevation/md"].id);
[["house", "Home", 1, false], ["search", "Search", 0, false], ["inbox", "Inbox", 0, true], ["user-round", "Profile", 0, false]].forEach(([ic, label, on, badge], i) => {
  const it = inst(titem, { Selected: on ? "On" : "Off" }, { Icon: IC[ic].id, Label: label, Badge: badge });
  it.name = "item-" + (i + 1);
  tabbar.appendChild(it);
});
MS.appendChild(tabbar);

// ---- board cards ------------------------------------------------------------------------------------------------------------------------
const c = await H.cursor();
const body = null;
const label = (s) => text(s, "Paragraph/Mini Regular", "text/secondary", "sub");
const row = (name, items, gap = 16, cross = "CENTER") => {
  const r = box(name, { dir: "row", gap, cross });
  items.forEach((i) => r.appendChild(i));
  return r;
};
const col = (name, items, gap = 8, cross) => {
  const r = box(name, { gap, cross });
  items.forEach((i) => r.appendChild(i));
  return r;
};

const k1 = await card(body, "Text effects", "Shimmer · typewriter · reveal · word rotate", { gap: 24 });
k1.card.appendChild(col("shimmer", ["Start", "Middle", "End"].map((Highlight) => inst(shimmer, { Highlight })), 8));
k1.card.appendChild(inst(typewriter));
k1.card.appendChild(row("reveal", [inst(reveal, { Stage: "Revealing" })]));
k1.card.appendChild(row("reveal-done", [inst(reveal, { Stage: "Done" })]));
k1.card.appendChild(row("rotate", ["Settled", "Rolling"].map((State) => inst(rotate, { State })), 48));
await burst(c, k1.wrap);

const k2 = await card(body, "Rolling numbers", "Settled · mid-roll · settled", { gap: 24 });
for (const [State, head, name] of [["Settled", "48,210", "Before"], ["Rolling", null, "Rolling up"], ["Settled", null, "After"]]) {
  const i = inst(number, { State });
  if (head) part(i, "head").characters = head;
  k2.card.appendChild(col(name, [await label(name), i], 6));
}
await burst(c, k2.wrap);

const k3 = await card(body, "Gradient text and spotlight cards", "Tonal steps stand in for the blend · lit border", { gap: 24 });
k3.card.appendChild(row("gradient", ["Accent", "Custom"].map((Blend) => inst(gradient, { Blend })), 48));
k3.card.appendChild(row("spotlight", ["Rest", "Lit", "Beam"].map((State) => inst(spot, { State })), 24, "MIN"));
await burst(c, k3.wrap);

const k4 = await card(body, "Loaders", "Dots · bars · pulse · orbit · grid", { gap: 16 });
k4.card.appendChild(row("loaders", ["Dots", "Bars", "Pulse", "Orbit", "Grid"].map((Style) => inst(loader, { Style })), 40));
await burst(c, k4.wrap);

const k5 = await card(body, "Dock", "Pointer away · over Music", { gap: 12, cross: "CENTER" });
const tip = inst(tooltip, {}, { Label: "Music" });
k5.card.appendChild(inst(dock, { Pointer: "Away" }));
k5.card.appendChild(tip);
k5.card.appendChild(inst(dock, { Pointer: "Over Music" }));
await burst(c, k5.wrap);

await tileCard(c, body, row);

const k7 = await card(body, "Now playing, waveform and tab bar", "Player · voice · tabs", { gap: 24 });
k7.card.appendChild(row("players", [inst(player, { Playing: "On" }), inst(player, { Playing: "Off" }, { Title: "Slow Fade", Artist: "Harbor Lights" })], 24, "MIN"));
k7.card.appendChild(row("voice", [inst(voice)], 24));
k7.card.appendChild(row("tabs", [inst(tabbar)], 24));
await burst(c, k7.wrap);
c.done();
return {
  loaderMark: mark.children.length, loader: loader.children.length, dockItem: ditem.children.length, dock: dock.children.length, controlTile: tile.children.length,
  nowPlaying: player.children.length, waveform: wave.children.length, tabBarItem: titem.children.length, cards: 7,
};
