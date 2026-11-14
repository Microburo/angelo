// CUI developer views drawn from the C source (src/ + tests/component_shots.c): Markdown view, Code editor, Diff viewer,
// Terminal, Hex viewer, Blame, Coverage, Stack trace. Row sets: Code row, Diff row, Diff fold, Blame row, Coverage row,
// Source line, Stack frame, Stack fold. Mono text styles (Code/*) are created once in Menlo, the only installed mono family.
const NEW = [
  "Markdown view", "Code row", "Code editor", "Diff row", "Diff fold", "Diff viewer", "Terminal", "Hex viewer", "Blame row", "Blame",
  "Coverage row", "Coverage", "Source line", "Stack frame", "Stack fold", "Stack trace",
];
for (const n of NEW) setNamed(n)?.remove();

// ---- mono text styles ------------------------------------------------------------------------------------------------
const MONO = { family: "Menlo", style: "Regular" };
await figma.loadFontAsync(MONO);
await figma.loadFontAsync({ family: "Inter", style: "Italic" });
for (const [n, [size, lh]] of Object.entries({ "Code/11": [11, 16], "Code/12": [12, 20], "Code/12 Tall": [12, 21], "Code/13": [13, 21], "Code/13 Compact": [13, 19] })) {
  if (TS[n]) continue;
  const s = figma.createTextStyle();
  s.name = n;
  s.fontName = MONO;
  s.fontSize = size;
  s.lineHeight = { unit: "PIXELS", value: lh };
  TS[n] = s;
}

const ICONS = ["chevron-down", "chevron-right", "chevrons-up-down", "arrow-up", "arrow-down", "folder-open", "file", "circle-alert", "minus", "play"];
const IC = {};
for (const n of ICONS) IC[n] = await H.icon(n, ICON);
const MS = rootNamed(MASTERS);
const badge = setNamed("Badge");
const checkbox = setNamed("Checkbox");
const button = setNamed("Button");
const iconButton = setNamed("Icon button");
const input = setNamed("Input");
const segment = setNamed("Segment");
const copyBtn = setNamed("Copy button");

// ---- helpers ---------------------------------------------------------------------------------------------------------
// syntax colors (cui__syntax_colors) on the semantic tokens
const KW = "feedback/error/text", TY = "feedback/success/text", ST = "feedback/success/text", NU = "feedback/warning/text";
const FN = "feedback/info/text", CM = "text/placeholder", PU = "text/secondary", PL = "text/primary";
const C_KW = new Set("if else for while do return static const struct typedef enum union break continue switch case default sizeof goto extern volatile inline".split(" "));
const JS_KW = new Set("function let var const for of in if else return new class import export from await async while do break continue switch case default typeof throw try catch".split(" "));
const C_TY = new Set("int char void float double long short unsigned signed bool size_t uint8_t uint16_t uint32_t uint64_t int32_t FILE".split(" "));
const CONSTS = new Set(["true", "false", "NULL", "null", "None", "True", "False", "undefined"]);
// cui__tokenize: whitespace, comments, preprocessor, strings, numbers, identifiers (keyword, type, const, call), punctuation
function tokenize(src, lang) {
  const kws = lang === "js" ? JS_KW : C_KW;
  const out = [];
  const push = (s, t) => {
    if (!s) return;
    const l = out[out.length - 1];
    if (l && l[1] === t) l[0] += s;
    else out.push([s, t]);
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    let j = i + 1;
    if (/\s/.test(ch)) {
      while (j < src.length && /\s/.test(src[j])) j++;
      push(src.slice(i, j), PL);
    } else if (src.startsWith("//", i)) {
      j = src.length;
      push(src.slice(i), CM);
    } else if (src.startsWith("/*", i)) {
      const e = src.indexOf("*/", i + 2);
      j = e < 0 ? src.length : e + 2;
      push(src.slice(i, j), CM);
    } else if (lang !== "js" && ch === "#" && /[a-z]/.test(src[i + 1] || "")) {
      while (j < src.length && /\w/.test(src[j])) j++;
      push(src.slice(i, j), KW);
      if (src.slice(i, j) === "#include") {
        const m = /^\s*<[^>]*>/.exec(src.slice(j));
        if (m) {
          push(m[0].match(/^\s*/)[0], PL);
          push(m[0].trim(), ST);
          j += m[0].length;
        }
      }
    } else if (ch === '"' || ch === "'" || (lang === "js" && ch === "`")) {
      while (j < src.length && src[j] !== ch) j += src[j] === "\\" ? 2 : 1;
      j = Math.min(j + 1, src.length);
      push(src.slice(i, j), ST);
    } else if (/[0-9]/.test(ch)) {
      while (j < src.length && /[\w.]/.test(src[j])) j++;
      push(src.slice(i, j), NU);
    } else if (/[A-Za-z_]/.test(ch)) {
      while (j < src.length && /\w/.test(src[j])) j++;
      const w = src.slice(i, j);
      let t = PL;
      if (kws.has(w)) t = KW;
      else if (C_TY.has(w) || (/^[A-Z]/.test(w) && w.length > 1 && !CONSTS.has(w))) t = TY;
      else if (CONSTS.has(w)) t = NU;
      else if (src[j] === "(") t = FN;
      push(w, t);
    } else {
      push(ch, PU);
    }
    i = j;
  }
  return out;
}
// text painted run by run with color tokens: segs = [[chars, token], ...]
function paint(t, segs) {
  t.characters = segs.map((s) => s[0]).join("");
  let at = 0;
  for (const [s, c] of segs) {
    if (s.length) t.setRangeFills(at, at + s.length, [solid(c)]);
    at += s.length;
  }
}
function colorize(root, layer, segs) {
  const t = root.findOne((n) => n.type === "TEXT" && n.name === layer);
  if (!t) throw new Error("no text " + layer);
  paint(t, segs);
}
// text node of a master already painted
async function ctext(segs, style, name) {
  const t = await text(segs.map((s) => s[0]).join("") || " ", style, PL, name);
  paint(t, segs);
  return t;
}
const blank = (segs) => (segs.length ? segs : [[" ", PL]]);
// fill of a nested layer of an instance
function tint(root, layer, color) {
  const n = root.findOne((x) => x.name === layer);
  if (!n) throw new Error("no layer " + layer);
  if (n.type === "TEXT") n.fills = [solid(color)];
  else n.fills = [solid(color)];
  return n;
}
// fixed-width text cell, optionally aligned
function cell(parent, t, w, align) {
  parent.appendChild(t);
  t.textAutoResize = "HEIGHT";
  t.resize(w, t.height);
  t.layoutSizingHorizontal = "FIXED";
  if (align) t.textAlignHorizontal = align;
  return t;
}
const bottomBorder = (f, color = "border/default") => {
  stroke(f, color);
  f.strokeTopWeight = f.strokeLeftWeight = f.strokeRightWeight = 0;
  f.strokeBottomWeight = 1;
};
const hline = () => box("divider", { fill: "border/default" });
const spacer = () => box("spacer");
// scene viewport frame: CUI draws these at a fixed height
const viewport = (name, w, h, fill) => box(name, { w, h, radius: 10, stroke: "border/default", fill, clip: true });

// ---- 1. Markdown view -----------------------------------------------------------------------------------------------
// runs = [[chars, flag?]]: b bold, i italic, s strike, c code, l link
async function rich(runs, style, color, name) {
  const t = await text(runs.map((r) => r[0]).join(""), style, color, name);
  let at = 0;
  for (const [s, f] of runs) {
    const a = at, b = at + s.length;
    at = b;
    if (f === "b") t.setRangeFontName(a, b, { family: "Inter", style: "Semi Bold" });
    if (f === "i") t.setRangeFontName(a, b, { family: "Inter", style: "Italic" });
    if (f === "s") t.setRangeTextDecoration(a, b, "STRIKETHROUGH");
    if (f === "c") t.setRangeFontName(a, b, MONO);
    if (f === "l") {
      t.setRangeFills(a, b, [solid("primary/default")]);
      t.setRangeTextDecoration(a, b, "UNDERLINE");
    }
  }
  return t;
}
const md = box("Markdown view", { component: true, w: 640 });
{
  // block gaps of cui_markdown: after a heading 8, after text 12, before a level 3 heading 18 (16 on the scale)
  const block = (pre, child) => {
    const b = box("block", { pad: [pre, 0, 0, 0] });
    add(b, child, { w: "fill" });
    add(md, b, { w: "fill" });
  };
  block(0, await text("Tern 2.4 release notes", "Display/3", PL, "h2"));
  block(8, await rich([
    ["The "], ["beta", "s"], [" sync engine is now the default. It batches writes, so "], ["a 2,000 item import takes 3.1 s", "b"],
    [" instead of 14 s. Run "], ["tern migrate", "c"], [" once after updating; the "], ["upgrade guide", "l"], [" lists every "], ["breaking", "i"], [" change."],
  ], "Paragraph/Small Regular", PL, "paragraph"));
  block(16, await text("What changed", "Paragraph/Large Medium", PL, "h3"));
  const bullet = async (label, color = PL) => {
    const r = box("bullet-item", { dir: "row", gap: 8, cross: "CENTER" });
    add(r, box("dot", { fill: "text/secondary", radius: 999 }), { w: 4, h: 4 });
    add(r, await text(label, "Paragraph/Small Regular", color, "item"), { w: "fill" });
    return r;
  };
  const list = box("bullets", { gap: 4 });
  add(list, await bullet("The offline banner waits 2 s before it appears"), { w: "fill" });
  const sub = box("sub-list", { gap: 4, pad: [0, 0, 0, 16] });
  add(sub, await bullet("It no longer flickers on a slow network"), { w: "fill" });
  add(sub, await bullet("Retry keeps your scroll position"), { w: "fill" });
  add(list, sub, { w: "fill" });
  add(list, await bullet("Attachments upload in the background"), { w: "fill" });
  block(8, list);
  block(16, await text("Before you ship", "Paragraph/Large Medium", PL, "h3"));
  const tasks = box("tasks", { gap: 4 });
  for (const [done, label] of [[true, "Update the changelog"], [false, "Rerun the sync benchmark on Android"], [false, "Tag the release"]]) {
    const r = box("task", { dir: "row", gap: 8, cross: "CENTER" });
    const cb = inst(checkbox, { Checked: done ? "On" : "Off" }, { Label: false });
    cb.name = "checkbox";
    r.appendChild(cb);
    add(r, await text(label, "Paragraph/Small Regular", done ? PU : PL, "task-label"), { w: "fill" });
    add(tasks, r, { w: "fill" });
  }
  block(8, tasks);
  const quote = box("quote", { dir: "row", gap: 12 });
  add(quote, box("rail", { fill: "border/strong" }), { w: 3, h: "fill" });
  add(quote, await text("Builds made before March 4 still read the old cache format, but they write the new one.", "Paragraph/Small Regular", PU, "quote-text"), { w: "fill" });
  block(12, quote);
  const code = box("code-block", { radius: "panel", stroke: "border/default", fill: "bg/subtle", clip: true });
  {
    const head = box("header", { dir: "row", gap: 8, pad: [8, 12], cross: "CENTER", align: "MAX" });
    head.appendChild(inst(badge, { Tone: "Neutral" }, { Label: "c" }));
    const cp = inst(copyBtn, { State: "Idle" });
    cp.name = "copy";
    head.appendChild(cp);
    add(code, head, { w: "fill" });
    const body = box("body", { pad: [4, 16, 12, 16] });
    const src = ["int sync_flush(sync_queue *q) {", "    if (q->count == 0) return 0;   /* nothing to send */", "    return send_batch(q->items, q->count);", "}"];
    const segs = src.flatMap((l, i) => (i ? [["\n", PL], ...tokenize(l, "c")] : tokenize(l, "c")));
    add(body, await ctext(segs, "Code/13 Compact", "code"), { w: "fill" });
    add(code, body, { w: "fill" });
  }
  block(12, code);
  // table: left, right and center aligned columns
  const table = box("table", { radius: "panel", stroke: "border/default", fill: "bg/surface", clip: true });
  const trow = async (cols, head, last) => {
    const r = box(head ? "table-header" : "table-row", { dir: "row", gap: 12, pad: [8, 12], cross: "CENTER", fill: head ? "bg/muted" : undefined });
    const st = head ? "Paragraph/Small Medium" : "Paragraph/Small Regular";
    add(r, await text(cols[0], st, PL, "platform"), { w: "fill" });
    cell(r, await text(cols[1], st, PL, "cold-start"), 120, "RIGHT");
    cell(r, await text(cols[2], st, PL, "vs-23"), 100, "CENTER");
    if (!last) bottomBorder(r);
    add(table, r, { w: "fill" });
  };
  await trow(["Platform", "Cold start", "vs 2.3"], true);
  await trow(["macOS", "412 ms", "-18%"]);
  await trow(["Windows", "498 ms", "-11%"]);
  await trow(["Android", "731 ms", "-9%"], false, true);
  block(12, table);
  const foot = box("footer", { gap: 16 });
  add(foot, hline(), { w: "fill", h: 1 });
  const fr = box("replay", { dir: "row", gap: 12, cross: "CENTER" });
  fr.appendChild(inst(button, { Type: "Outline", Size: "sm" }, { Label: "Replay as a stream", "Left icon": true, "Left icon swap": IC.play.id }));
  fr.appendChild(await text("Click a link or a task box", "Paragraph/Small Regular", PU, "status"));
  add(foot, fr, { w: "fill" });
  block(16, foot);
}
MS.appendChild(md);

// ---- 2. Code editor: Code row (State), viewport 760 x 356 ------------------------------------------------------------
const crow = await variants("Code row", { State: ["Plain", "Current"] }, async ({ State }) => {
  const cur = State === "Current";
  const b = box("code-row", { component: true, dir: "row", gap: 16, pad: [0, 12], w: 760, fill: cur ? "interaction/hover" : undefined });
  cell(b, await text("1", "Code/13", cur ? PL : "text/placeholder", "number"), 16, "RIGHT");
  add(b, await text("code", "Code/13", PL, "code"), { w: "fill" });
  return b;
}, { cols: 2 });
wire(crow, [{ layer: "number", kind: "TEXT", name: "Number" }]);
const EDITOR_SRC = [
  "/* tile_cache.c: a small LRU cache of decoded map tiles */", "#include <stdint.h>", "#include <stdlib.h>", "#include <string.h>", "",
  "#define CACHE_SLOTS 64", "", "typedef struct {", "    uint32_t key;           /* zoom << 24 | y << 12 | x */", "    uint32_t last_used;",
  "    uint8_t *pixels;", "} tile;", "", "static tile cache[CACHE_SLOTS];", "static uint32_t clock_now;", "",
  "static uint32_t tile_key(int zoom, int x, int y) {",
];
const editor = box("Code editor", { component: true, w: 760, gap: 8 });
{
  const view = viewport("editor", 760, 356, "bg/subtle");
  EDITOR_SRC.forEach((l, i) => {
    const r = inst(crow, { State: i === 13 ? "Current" : "Plain" }, { Number: String(i + 1) });
    colorize(r, "code", blank(tokenize(l, "c")));
    add(view, r, { w: "fill" });
  });
  add(editor, view, { w: "fill" });
  const st = box("status", { dir: "row", gap: 16 });
  for (const s of ["Ln 14, Col 32", "42 lines", "Spaces: 4"]) st.appendChild(await text(s, "Paragraph/Small Regular", "text/placeholder", "status-item"));
  add(editor, st, { w: "fill" });
}
MS.appendChild(editor);

// ---- 3. Diff viewer: Diff row (Kind), Diff fold, split view 900 x 372 -------------------------------------------------
async function dside(id, fill, sign, signTone) {
  const s = box(id + "-side", { dir: "row", gap: 4, pad: [0, 8], cross: "CENTER", fill, clip: true });
  cell(s, await text("1", "Code/12 Tall", "text/placeholder", id + "-no"), 24, "RIGHT");
  cell(s, await text(sign, "Code/12 Tall", signTone || "text/placeholder", id + "-sign"), 12, "CENTER");
  s.appendChild(await text("code", "Code/12 Tall", PL, id + "-code"));
  return s;
}
const DK = {
  Context: [undefined, undefined, " ", " "],
  Change: ["feedback/error/subtle", "feedback/success/subtle", "-", "+"],
  Added: ["bg/muted", "feedback/success/subtle", " ", "+"],
  Removed: ["feedback/error/subtle", "bg/muted", "-", " "],
};
const drow = await variants("Diff row", { Kind: Object.keys(DK) }, async ({ Kind }) => {
  const [lf, rf, ls, rs] = DK[Kind];
  const b = box("diff-row", { component: true, dir: "row", w: 900, h: 21 });
  add(b, await dside("old", lf, ls, "feedback/error/text"), { w: "fill", h: "fill" });
  add(b, box("divider", { fill: "border/default" }), { w: 1, h: "fill" });
  add(b, await dside("new", rf, rs, "feedback/success/text"), { w: "fill", h: "fill" });
  return b;
}, { cols: 4 });
wire(drow, [{ layer: "old-no", kind: "TEXT", name: "Old line" }, { layer: "new-no", kind: "TEXT", name: "New line" }]);
const dfold = box("Diff fold", { component: true, dir: "row", gap: 8, pad: [0, 12], w: 900, h: 21, cross: "CENTER", fill: "primary/subtle" });
dfold.appendChild(await ico("chevrons-up-down", 12, "text/secondary", "fold-icon"));
add(dfold, await text("14 unchanged lines", "Paragraph/Mini Regular", PU, "label"), { w: "fill" });
MS.appendChild(dfold);
wire(dfold, [{ layer: "label", kind: "TEXT", name: "Label" }]);
const diff = box("Diff viewer", { component: true, w: 900, gap: 8 });
{
  const bar = box("toolbar", { dir: "row", gap: 8, cross: "CENTER" });
  const mode = box("mode", { dir: "row", pad: 4, gap: 4, radius: 10, fill: "bg/muted" });
  mode.appendChild(inst(segment, { Selected: "On" }, { Label: "Split" }));
  mode.appendChild(inst(segment, { Selected: "Off" }, { Label: "Inline" }));
  bar.appendChild(mode);
  add(bar, spacer(), { w: "fill", h: 1 });
  bar.appendChild(await text("Change 1 of 6", "Paragraph/Small Regular", PU, "change-count"));
  bar.appendChild(inst(iconButton, { Type: "Outline", Size: "sm" }, { Icon: IC["arrow-up"].id }));
  bar.appendChild(inst(iconButton, { Type: "Outline", Size: "sm" }, { Icon: IC["arrow-down"].id }));
  add(diff, bar, { w: "fill" });
  const view = viewport("view", 900, 372, "bg/surface");
  const head = box("header", { dir: "row", h: 32, cross: "CENTER" });
  const oh = box("old-title", { dir: "row", pad: [0, 12], cross: "CENTER" });
  add(oh, await text("config.c (main)", "Paragraph/Small Medium", PU, "old-title-text"), { w: "fill" });
  add(head, oh, { w: "fill", h: "fill" });
  add(head, box("divider", { fill: "border/default" }), { w: 1, h: "fill" });
  const nh = box("new-title", { dir: "row", pad: [0, 12], gap: 8, cross: "CENTER" });
  add(nh, await text("config.c", "Paragraph/Small Medium", PU, "new-title-text"), { w: "fill" });
  nh.appendChild(await text("+10", "Paragraph/Small Regular", "feedback/success/text", "added"));
  nh.appendChild(await text("−8", "Paragraph/Small Regular", "feedback/error/text", "removed"));
  add(head, nh, { w: "fill", h: "fill" });
  bottomBorder(head);
  add(view, head, { w: "fill" });
  const rows = box("rows", { pad: [4, 0] });
  const R = (kind, o, ot, n, nt) => {
    const r = inst(drow, { Kind: kind }, { "Old line": o ? String(o) : " ", "New line": n ? String(n) : " " });
    colorize(r, "old-code", blank(ot ? tokenize(ot, "c") : []));
    colorize(r, "new-code", blank(nt ? tokenize(nt, "c") : []));
    add(rows, r, { w: "fill" });
  };
  const F = (label) => add(rows, inst(dfold, {}, { Label: label }), { w: "fill" });
  R("Context", 1, '#include "config.h"', 1, '#include "config.h"');
  R("Added", 0, "", 2, '#include "log.h"');
  R("Context", 2, "#include <stdio.h>", 3, "#include <stdio.h>");
  F("14 unchanged lines");
  R("Context", 17, "int parse_line(char *line, char *key, char *val) {", 18, "int parse_line(char *line, char *key, char *val) {");
  R("Change", 20, "    if (!eq) return 0;", 21, "    if (!eq || eq == line) return 0;");
  R("Context", 21, "    *eq = 0;", 22, "    *eq = 0;");
  R("Change", 23, "    strcpy(value, eq + 1);", 24, '    snprintf(value, LINE_MAX, "%s", eq + 1);');
  R("Context", 24, "}", 25, "}");
  F("12 unchanged lines");
  R("Context", 37, '    FILE *f = fopen(path, "r");', 38, '    FILE *f = fopen(path, "r");');
  R("Added", 0, "", 39, "    if (!f) {");
  R("Added", 0, "", 40, '        log_error("cannot open %s", path);');
  R("Added", 0, "", 41, "        return -1;");
  R("Added", 0, "", 42, "    }");
  R("Change", 38, "    int count = 0;", 43, "    char buf[LINE_MAX]; int loaded = 0;");
  add(view, rows, { w: "fill" });
  add(diff, view, { w: "fill" });
}
MS.appendChild(diff);

// ---- 4. Terminal 820 x 380, light ANSI palette on the feedback tokens -------------------------------------------------
const term = box("Terminal", { component: true, w: 820, h: 380, radius: 10, stroke: "border/default", fill: "bg/surface", clip: true });
{
  const out = box("output", { pad: [4, 8] });
  const GREEN = "feedback/success/text", MAG = "feedback/warning/text", CYAN = "feedback/info/text", DIM = "text/placeholder";
  const L = (segs) => ctext(segs, "Code/13 Compact", "line").then((t) => out.appendChild(t));
  const prompt = (cmd) => L([["~/fieldnotes $ ", DIM], [cmd, PL]]);
  await prompt("cmake --build build -j8");
  for (const [pc, f] of [[14, "cui_core.c"], [28, "cui_layout.c"], [42, "cui_text.c"], [56, "cui_widgets.c"], [70, "cui_viz.c"], [84, "cui_month.c"]]) {
    await L([[`[${String(pc).padStart(3)}%] `, PL], ["Building C object", GREEN], [` src/CMakeFiles/cui.dir/${f}.o`, PL]]);
  }
  await L([["src/cui_month.c:212:14: ", PL], ["warning:", MAG], [" unused variable 'span'", PL]]);
  await L([["  212 |     float span = r.w / 7;", PU]]);
  await L([["      |           ", PU], ["^~~~", GREEN]]);
  await L([["[ 92%] ", PL], ["Linking C static library libcui.a", GREEN]]);
  await L([["[100%] Built target cui", PL]]);
  await prompt("ctest --output-on-failure");
  await L([["█".repeat(20), CYAN], [" 40/40 tests", PL]]);
  await L([["100% tests passed", GREEN], [", 0 tests failed out of 40", PL]]);
  await L([["Total Test time (real) =   3.18 sec", PL]]);
  add(term, out, { w: "fill", h: "fill" });
  add(term, hline(), { w: "fill", h: 1 });
  const inp = box("input-row", { dir: "row", pad: [0, 8], h: 34, cross: "CENTER" });
  inp.appendChild(await text("~/fieldnotes $ ", "Code/13 Compact", PU, "prompt"));
  add(term, inp, { w: "fill" });
}
MS.appendChild(term);

// ---- 5. Hex viewer: PNG header, 16 bytes per row, marks and a selection ------------------------------------------------
const bytes = [];
bytes.push(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
bytes.push(0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 5, 0, 0, 0, 2, 0xd0, 8, 6, 0, 0, 0, 0x7a, 0x7a, 0xf4, 0x8e);
bytes.push(0, 0, 0, 0x10, 0x74, 0x45, 0x58, 0x74, ...[..."Software"].map((c) => c.charCodeAt(0)), 0, ...[..."CUI 1.0"].map((c) => c.charCodeAt(0)), 0x2c, 0x91, 0x0b, 0x5d);
bytes.push(0, 0, 0, 9, 0x70, 0x48, 0x59, 0x73, 0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1, 0x00, 0x9a, 0x9c, 0x18);
bytes.push(0, 0, 0x20, 0, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c);
{
  let s = 0x9e3779b9;
  while (bytes.length < 16 * 14) {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    bytes.push(s & 255);
  }
}
const MARKS = [[0, 7, "feedback/info/subtle"], [8, 32, "primary/subtle"], [33, 60, "feedback/success/subtle"]];
const SEL = [16, 23];
const tintOf = (i) => (i >= SEL[0] && i <= SEL[1] ? "primary/default" : (MARKS.find((m) => i >= m[0] && i <= m[1]) || [])[2] || "-");
const hex2 = (b) => b.toString(16).toUpperCase().padStart(2, "0");
// a row part: consecutive bytes of one tint share a frame (split at the middle gap for the hex part)
async function runs(r, split, label) {
  const area = box(label, { dir: "row", cross: "CENTER" });
  const groups = [];
  for (let i = 0; i < 16; i++) {
    const key = tintOf(r * 16 + i);
    const g = groups[groups.length - 1];
    if (g && g.key === key && !(split && i === 8)) g.items.push(i);
    else groups.push({ key, items: [i] });
  }
  for (const [gi, g] of groups.entries()) {
    if (gi && split) {
      area.appendChild(await text(" ", "Code/12", PL, "sep"));
      if (g.items[0] === 8) add(area, box("gap", { w: 8 }));
    }
    const run = box("run", { dir: "row", fill: g.key === "-" ? undefined : g.key });
    const s = g.items.map((i) => (split ? hex2(bytes[r * 16 + i]) : (bytes[r * 16 + i] >= 32 && bytes[r * 16 + i] < 127 ? String.fromCharCode(bytes[r * 16 + i]) : "."))).join(split ? " " : "");
    run.appendChild(await text(s, "Code/12", g.key === "primary/default" ? "text/on-primary" : split ? PL : PU, "bytes"));
    area.appendChild(run);
  }
  return area;
}
const hexv = box("Hex viewer", { component: true, w: 760, gap: 12 });
{
  const view = viewport("view", 760, 300, "bg/subtle");
  const head = box("header", { dir: "row", gap: 16, pad: [0, 12], h: 21, cross: "CENTER" });
  cell(head, await text("Offset", "Code/12", "text/placeholder", "offset"), 44);
  const ha = box("columns", { dir: "row", cross: "CENTER" });
  ha.appendChild(await text("00 01 02 03 04 05 06 07", "Code/12", "text/placeholder", "low"));
  ha.appendChild(await text(" ", "Code/12", PL, "sep"));
  add(ha, box("gap", { w: 8 }));
  ha.appendChild(await text("08 09 0A 0B 0C 0D 0E 0F", "Code/12", "text/placeholder", "high"));
  head.appendChild(ha);
  head.appendChild(await text("Text", "Code/12", "text/placeholder", "ascii"));
  add(view, head, { w: "fill" });
  const rows = box("rows", { pad: [4, 0] });
  for (let r = 0; r < 14; r++) {
    const row = box("hex-row", { dir: "row", gap: 16, pad: [0, 12], h: 20, cross: "CENTER" });
    cell(row, await text((r * 16).toString(16).toUpperCase().padStart(4, "0"), "Code/12", "text/placeholder", "offset"), 44);
    row.appendChild(await runs(r, true, "hex"));
    row.appendChild(await runs(r, false, "ascii"));
    add(rows, row, { w: "fill" });
  }
  add(view, rows, { w: "fill" });
  add(hexv, view, { w: "fill" });
  const bar = box("goto", { dir: "row", gap: 12, cross: "CENTER" });
  const inp = inst(input, { State: "Default", Value: "Placeholder" }, { "Left icon": false, Text: "Go to offset" });
  inp.resize(150, inp.height);
  inp.layoutSizingHorizontal = "FIXED";
  bar.appendChild(inp);
  bar.appendChild(await text("0010 to 0017, 8 bytes selected", "Paragraph/Small Regular", PU, "status"));
  add(hexv, bar, { w: "fill" });
}
MS.appendChild(hexv);

// ---- 6. Blame: Blame row (Start), 900 x 320 --------------------------------------------------------------------------
const brow = await variants("Blame row", { Start: ["On", "Off"] }, async ({ Start }) => {
  const on = Start === "On";
  const b = box("blame-row", { component: true, dir: "row", w: 900, h: 20, cross: "CENTER" });
  if (on) {
    b.strokes = [solid("border/default")];
    b.strokeWeight = 1;
    b.strokeAlign = "INSIDE";
    b.strokeBottomWeight = b.strokeLeftWeight = b.strokeRightWeight = 0;
  }
  add(b, box("edge", { fill: "feedback/info/default" }), { w: 3, h: "fill" });
  const g = box("gutter", { dir: "row", gap: 8, pad: [0, 8], cross: "CENTER" });
  g.strokes = [solid("border/default")];
  g.strokeWeight = 1;
  g.strokeAlign = "INSIDE";
  g.strokeTopWeight = g.strokeBottomWeight = g.strokeLeftWeight = 0;
  if (on) {
    cell(g, await text("Author", "Paragraph/Mini Medium", PU, "author"), 92);
    add(g, await text("2 weeks ago", "Paragraph/Mini Regular", "text/placeholder", "age"), { w: "fill" });
    g.appendChild(await text("a1b2c3d", "Code/12", PU, "hash"));
  } else {
    add(g, spacer(), { w: "fill", h: 1 });
  }
  add(b, g, { w: 277, h: "fill" });
  const body = box("body", { dir: "row", gap: 12, cross: "CENTER" });
  cell(body, await text("120", "Code/12", "text/placeholder", "number"), 32, "RIGHT");
  body.appendChild(await text("code", "Code/12", PL, "code"));
  add(b, body, { w: "fill" });
  return b;
}, { cols: 2 });
wire(brow, [
  { layer: "number", kind: "TEXT", name: "Number" },
  { layer: "author", kind: "TEXT", name: "Author" },
  { layer: "age", kind: "TEXT", name: "Age" },
  { layer: "hash", kind: "TEXT", name: "Hash" },
]);
const COMMITS = [
  ["a1b2c3d", "Maya Okafor", "2 years ago", 0], ["b2c3d4e", "Jonas Berg", "1 year ago", 0.468], ["c3d4e5f", "Priya Nair", "6 weeks ago", 0.936],
  ["d4e5f6a", "Omid Saadat", "2 weeks ago", 0.983], ["e5f6a7b", "Aiko Tanaka", "yesterday", 1],
];
const BLAME = [
  ['#include "cui_internal.h"', 0], ["", 0], ["/* the width a component asks for */", 1], ["static float measure(cui_node *n) {", 1],
  ["    float w = n->pad[1] + n->pad[3];", 2], ["    for (int c = n->first; c >= 0; c = next(c))", 2], ["        w += width_of(c) + n->gap;", 2],
  ["    return w - n->gap;", 1], ["}", 1], ["", 0], ["void cui__layout(cui_ctx *ui) {", 3], ["    for (int i = 0; i < ui->node_count; i++)", 3],
  ["        measure(&ui->nodes[i]);", 4], ["    place(ui, 0);  /* the root */", 3], ["}", 3],
];
const blame = box("Blame", { component: true, w: 900, h: 320, radius: 10, stroke: "border/default", fill: "bg/surface", clip: true });
BLAME.forEach(([src, ci], i) => {
  const start = i === 0 || BLAME[i - 1][1] !== ci;
  const [hash, author, age, heat] = COMMITS[ci];
  const r = start ? inst(brow, { Start: "On" }, { Number: String(120 + i), Author: author, Age: age, Hash: hash }) : inst(brow, { Start: "Off" }, { Number: String(120 + i) });
  colorize(r, "code", blank(tokenize(src, "c")));
  r.findOne((n) => n.name === "edge").opacity = 0.15 + 0.85 * heat;
  add(blame, r, { w: "fill" });
});
MS.appendChild(blame);

// ---- 7. Coverage: Coverage row (Kind), 820 x 372 ----------------------------------------------------------------------
const crv = await variants("Coverage row", { Kind: ["Folder", "File"] }, async ({ Kind }) => {
  const folder = Kind === "Folder";
  const b = box("coverage-row", { component: true, dir: "row", gap: 12, pad: [0, 12], w: 820, h: 30, cross: "CENTER" });
  const name = box("name-cell", { dir: "row", gap: 4, cross: "CENTER" });
  add(name, box("indent"), { w: 16, h: 1 });
  if (folder) {
    name.appendChild(await ico("chevron-down", 14, "text/placeholder", "chevron"));
    name.appendChild(await ico("folder-open", 14, "text/secondary", "icon"));
  } else {
    add(name, box("chevron-space"), { w: 14, h: 1 });
    name.appendChild(await ico("file", 14, "text/placeholder", "icon"));
  }
  name.appendChild(await text("name", folder ? "Paragraph/Small Medium" : "Paragraph/Small Regular", PL, "name"));
  add(b, name, { w: "fill" });
  const lines = box("lines-cell", { dir: "row", gap: 12, cross: "CENTER" });
  const bar = box("bar", { dir: "row", cross: "CENTER" });
  const track = box("track", { dir: "row", fill: "interaction/active", radius: 999 });
  add(track, box("bar-fill", { fill: "feedback/success/default", radius: 999 }), { w: 60, h: "fill" });
  add(bar, track, { w: "fill", h: 6 });
  add(lines, bar, { w: 90, h: 12 });
  cell(lines, await text("0.0%", "Paragraph/Mini Regular", PL, "lines-pct"), 54, "RIGHT");
  add(b, lines, { w: 156 });
  cell(b, await text("0.0%", "Paragraph/Mini Regular", PL, "branches-pct"), 70, "RIGHT");
  cell(b, await text("0.0%", "Paragraph/Mini Regular", PL, "functions-pct"), 70, "RIGHT");
  return b;
}, { cols: 2 });
wire(crv, [
  { layer: "name", kind: "TEXT", name: "Name" },
  { layer: "lines-pct", kind: "TEXT", name: "Lines" },
  { layer: "branches-pct", kind: "TEXT", name: "Branches" },
  { layer: "functions-pct", kind: "TEXT", name: "Functions" },
]);
// path, lines, hit, branches, hit, functions, hit
const FILES = [
  ["src/core/layout.c", 1840, 1702, 620, 541, 88, 86], ["src/core/state.c", 420, 401, 96, 90, 31, 31], ["src/core/draw.c", 960, 610, 300, 160, 54, 40],
  ["src/text/shape.c", 2210, 1490, 802, 411, 120, 88], ["src/text/atlas.c", 640, 598, 140, 131, 30, 30], ["src/render/gl.c", 1300, 410, 260, 60, 70, 22],
  ["src/render/software.c", 2400, 2210, 900, 799, 140, 136], ["src/main.c", 120, 120, 10, 10, 4, 4],
];
const sums = (prefix) => {
  const t = [0, 0, 0, 0, 0, 0];
  for (const f of FILES) if (f[0].startsWith(prefix)) for (let k = 0; k < 6; k++) t[k] += f[k + 1];
  return t;
};
const TREE = [
  [0, "Folder", "All files", ""], [1, "Folder", "src", "src/"],
  [2, "Folder", "core", "src/core/"], [3, "File", "draw.c", "src/core/draw.c"], [3, "File", "layout.c", "src/core/layout.c"], [3, "File", "state.c", "src/core/state.c"],
  [2, "Folder", "render", "src/render/"], [3, "File", "gl.c", "src/render/gl.c"], [3, "File", "software.c", "src/render/software.c"],
  [2, "Folder", "text", "src/text/"], [3, "File", "atlas.c", "src/text/atlas.c"], [3, "File", "shape.c", "src/text/shape.c"],
  [2, "File", "main.c", "src/main.c"],
];
const pct = (hit, total) => (total ? (Math.round((hit / total) * 1000) / 10).toFixed(1) + "%" : "—");
const toneOf = (hit, total) => {
  const p = total ? (hit / total) * 100 : 100;
  return p >= 80 ? "success" : p >= 50 ? "warning" : "error";
};
const cov = box("Coverage", { component: true, w: 820, h: 372, radius: 10, stroke: "border/default", fill: "bg/surface", clip: true });
{
  const head = box("header", { dir: "row", gap: 12, pad: [0, 12], h: 30, cross: "CENTER", fill: "bg/muted" });
  const file = box("file-cell", { dir: "row", gap: 4, cross: "CENTER" });
  file.appendChild(await text("File", "Paragraph/Mini Medium", PL, "file"));
  file.appendChild(await ico("arrow-up", 12, "text/primary", "sort"));
  add(head, file, { w: "fill" });
  cell(head, await text("Lines", "Paragraph/Mini Medium", "text/placeholder", "lines"), 156, "RIGHT");
  cell(head, await text("Branches", "Paragraph/Mini Medium", "text/placeholder", "branches"), 70, "RIGHT");
  cell(head, await text("Functions", "Paragraph/Mini Medium", "text/placeholder", "functions"), 70, "RIGHT");
  bottomBorder(head);
  add(cov, head, { w: "fill" });
  const rows = box("rows");
  for (const [depth, kind, label, path] of TREE) {
    const t = kind === "Folder" ? sums(path) : FILES.find((f) => f[0] === path).slice(1);
    const r = inst(crv, { Kind: kind }, { Name: label, Lines: pct(t[1], t[0]), Branches: pct(t[3], t[2]), Functions: pct(t[5], t[4]) });
    const ind = r.findOne((n) => n.name === "indent");
    if (depth) ind.resize(depth * 16, ind.height);
    else ind.visible = false;
    const lt = toneOf(t[1], t[0]);
    r.findOne((n) => n.name === "bar-fill").fills = [solid(`feedback/${lt}/default`)];
    const fillW = Math.max(0, Math.round((t[1] / t[0]) * 90));
    const bf = r.findOne((n) => n.name === "bar-fill");
    bf.resize(fillW || 1, bf.height);
    for (const [layer, hit, total] of [["lines-pct", t[1], t[0]], ["branches-pct", t[3], t[2]], ["functions-pct", t[5], t[4]]]) tint(r, layer, `feedback/${toneOf(hit, total)}/text`);
    add(rows, r, { w: "fill" });
  }
  add(cov, rows, { w: "fill" });
}
MS.appendChild(cov);

// ---- 8. Stack trace: Source line (Hit), Stack frame (Chevron), Stack fold -----------------------------------------------
const sline = await variants("Source line", { Hit: ["Off", "On"] }, async ({ Hit }) => {
  const on = Hit === "On";
  const b = box("source-line", { component: true, dir: "row", gap: 16, pad: [0, 12, 0, 0], w: 600, h: 20, cross: "CENTER", fill: on ? "feedback/error/subtle" : undefined });
  add(b, box("bar", { fill: on ? "feedback/error/default" : undefined }), { w: 2, h: "fill" });
  cell(b, await text("1", "Code/12", on ? "feedback/error/text" : "text/placeholder", "number"), 16, "RIGHT");
  add(b, await text("code", "Code/12", PL, "code"), { w: "fill" });
  return b;
}, { cols: 2 });
wire(sline, [{ layer: "number", kind: "TEXT", name: "Number" }]);
const sframe = await variants("Stack frame", { Chevron: ["Open", "Closed", "None"] }, async ({ Chevron }) => {
  const b = box("stack-frame", { component: true, dir: "row", gap: 8, pad: [4, 12], w: 760, radius: 4, cross: "CENTER" });
  b.appendChild(await ico({ Open: "chevron-down", Closed: "chevron-right", None: "minus" }[Chevron], 14, "text/secondary", "chevron"));
  b.appendChild(await text("function", "Code/13", PL, "function"));
  add(b, await text("src/file.js:1:1", "Code/11", "text/placeholder", "location"), { w: "fill" });
  return b;
}, { cols: 3 });
wire(sframe, [{ layer: "function", kind: "TEXT", name: "Function" }, { layer: "location", kind: "TEXT", name: "Location" }]);
const sfold = box("Stack fold", { component: true, dir: "row", gap: 8, pad: [4, 12], w: 760, cross: "CENTER" });
sfold.appendChild(await ico("chevron-right", 14, "text/secondary", "chevron"));
add(sfold, await text("3 library frames", "Paragraph/Mini Regular", "text/placeholder", "label"), { w: "fill" });
MS.appendChild(sfold);
wire(sfold, [{ layer: "label", kind: "TEXT", name: "Label" }]);
const stack = box("Stack trace", { component: true, w: 760, radius: "panel", stroke: "border/default", fill: "bg/surface", clip: true });
{
  const head = box("head", { dir: "row", gap: 12, pad: [12, 16], cross: "CENTER", fill: "feedback/error/subtle" });
  head.appendChild(await ico("circle-alert", 18, "feedback/error/text", "icon"));
  const msg = box("message", { gap: 4 });
  add(msg, await text("TypeError", "Paragraph/Small Medium", "feedback/error/text", "title"), { w: "fill" });
  add(msg, await text("Cannot read properties of undefined (reading 'items')", "Paragraph/Small Regular", PL, "message"), { w: "fill" });
  add(head, msg, { w: "fill" });
  const cp = inst(copyBtn, { State: "Idle" });
  cp.name = "copy";
  head.appendChild(cp);
  bottomBorder(head);
  add(stack, head, { w: "fill" });
  const frames = box("frames", { pad: [4, 0] });
  add(frames, inst(sframe, { Chevron: "Open" }, { Function: "total", Location: "src/cart.js:3:29" }), { w: "fill" });
  const wrap = box("source-wrap", { pad: [0, 12, 8, 32] });
  const src = box("source", { radius: 6, fill: "bg/subtle", pad: [4, 0], clip: true });
  ["function total(cart) {", "  let sum = 0;", "  for (const item of cart.items) {", "    sum += item.price * item.qty;", "  }", "  return sum;"].forEach((l, i) => {
    const r = inst(sline, { Hit: i === 2 ? "On" : "Off" }, { Number: String(i + 1) });
    colorize(r, "code", blank(tokenize(l, "js")));
    add(src, r, { w: "fill" });
  });
  add(wrap, src, { w: "fill" });
  add(frames, wrap, { w: "fill" });
  add(frames, inst(sframe, { Chevron: "Closed" }, { Function: "checkout", Location: "src/checkout.js:3:18" }), { w: "fill" });
  add(frames, inst(sfold, {}, { Label: "3 library frames" }), { w: "fill" });
  add(frames, inst(sframe, { Chevron: "None" }, { Function: "onRequest", Location: "src/server.js:41:9" }), { w: "fill" });
  add(stack, frames, { w: "fill" });
}
MS.appendChild(stack);

// ---- board cards ------------------------------------------------------------------------------------------------------
const c = await H.cursor();
const CARDS = [
  ["Markdown view", "Headings · lists · tasks · quote · code · table", md],
  ["Code editor", "Gutter · current line · status row", editor],
  ["Diff viewer", "Split view · folds · tinted sides", diff],
  ["Terminal", "ANSI colors · prompt row", term],
  ["Hex viewer", "Marks · selection · ASCII column", hexv],
  ["Blame", "Age edge · author run · commit hash", blame],
  ["Coverage", "Folder tree · tone bars · sorted header", cov],
  ["Stack trace", "Open frame source · folded library frames", stack],
];
for (const [caption, sub, master] of CARDS) {
  const k = await card(null, caption, sub);
  k.card.appendChild(master.createInstance());
  await burst(c, k.wrap);
}
c.done();
return Object.fromEntries(CARDS.map(([cap, , m]) => [cap, `${m.name} ${Math.round(m.width)}x${Math.round(m.height)}`]));
