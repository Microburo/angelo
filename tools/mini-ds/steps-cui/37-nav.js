// CUI navigation and media views drawn from the C source (tests/component_shots.c + src/cui_*.c): Guided tour, Docking,
// Image viewer and cropper, Tree table + Path bar, File browser. Floating layers (tour scrim, popups, zoom pill) are drawn in flow.
const NEW = [
  "Tour card", "Guided tour", "Docking", "Image viewer and cropper", "Path bar", "Tree table", "File browser",
];
for (const n of NEW) setNamed(n)?.remove();

const ICONS = [
  "chevron-down", "chevron-right", "folder", "folder-open", "file", "file-text", "image", "code", "archive", "music",
  "arrow-left", "arrow-right", "arrow-up", "refresh-cw", "search", "house", "monitor", "download", "users", "x", "minus", "plus",
  "maximize-2", "layers", "box", "square-terminal", "sliders-horizontal", "rotate-ccw", "globe", "building-2", "sun", "palette", "audio-lines",
];
const IC = {};
for (const n of ICONS) IC[n] = await H.icon(n, ICON);
const MS = rootNamed(MASTERS);
const button = setNamed("Button");
const iconButton = setNamed("Icon button");
const input = setNamed("Input");
const skeleton = setNamed("Skeleton");
const spinner = setNamed("Spinner");
const hcell = setNamed("Table header cell");
const crumb = setNamed("Breadcrumb item");
const menuItem = setNamed("Menu item");
const docTab = setNamed("Document tab");
const treeItem = setNamed("Tree item");
const logLine = setNamed("Log line");
const invGroup = setNamed("Inspector group");
const propField = setNamed("Prop field");
const vecField = setNamed("Vec field");
const sw = setNamed("Switch");

const PL = "text/primary", PU = "text/secondary", PH = "text/placeholder";
const hline = () => box("divider", { fill: "border/default" });
const spacer = () => box("spacer");
const bottomBorder = (f, color = "border/default") => {
  stroke(f, color);
  f.strokeTopWeight = f.strokeLeftWeight = f.strokeRightWeight = 0;
  f.strokeBottomWeight = 1;
};
const viewport = (name, w, h, fill) => box(name, { w, h, radius: 8, stroke: "border/default", fill, clip: true });
// text cell with horizontal padding 12, fixed width, optional right alignment
async function tcell(chars, w, right, style = "Paragraph/Small Regular", color = PU, name = "cell") {
  const b = box(name, { dir: "row", pad: [0, 12], w, align: right ? "MAX" : undefined, cross: "CENTER" });
  b.appendChild(await text(chars, style, color, name + "-text"));
  return b;
}
const elevate = async (n) => n.setEffectStyleIdAsync(ES["Elevation/lg"].id);
// scene label above a viewport
const label = (chars) => text(chars, "Paragraph/Small Medium", PU, "label");

// ---- 1. Guided tour: Tour card (step 2 of 4, bottom-end of the Export button) over the app ---------------------------
const tour = box("Tour card", { component: true, w: 300, pad: [16, 18], gap: 8, radius: "panel", fill: "bg/surface", stroke: "border/default" });
await elevate(tour);
{
  const top = box("top", { dir: "row", cross: "CENTER", gap: 8 });
  add(top, await text("2 of 4", "Paragraph/Mini Medium", PH, "count"), { w: "fill" });
  top.appendChild(inst(iconButton, { Type: "Ghost", Size: "sm" }, { Icon: IC.x.id }));
  add(tour, top, { w: "fill" });
  add(tour, await text("Export anywhere", "Paragraph/Medium Medium", PL, "title"), { w: "fill" });
  add(tour, await text("Send a report to PDF, Markdown or your team's drive. Shift+Export repeats the last one.", "Paragraph/Small Regular", PU, "body"), { w: "fill" });
  const foot = box("footer", { dir: "row", gap: 6, pad: [6, 0, 0, 0], cross: "CENTER" });
  const dots = box("dots", { dir: "row", gap: 6, cross: "CENTER" });
  for (let i = 0; i < 4; i++) add(dots, box("dot", { radius: 999, fill: i === 1 ? "text/primary" : "border/strong" }), { w: i === 1 ? 14 : 6, h: 6 });
  foot.appendChild(dots);
  add(foot, spacer(), { w: "fill", h: 1 });
  foot.appendChild(inst(button, { Type: "Ghost", Size: "sm" }, { Label: "Back" }));
  foot.appendChild(inst(button, { Type: "Primary", Size: "sm" }, { Label: "Next" }));
  add(tour, foot, { w: "fill" });
}
wire(tour, [
  { layer: "count", kind: "TEXT", name: "Step" }, { layer: "title", kind: "TEXT", name: "Title" }, { layer: "body", kind: "TEXT", name: "Body" },
]);
MS.appendChild(tour);

const scene = box("Guided tour", { component: true, w: 820, pad: 20, gap: 16, fill: "bg/canvas" });
{
  const app = box("app", { radius: "panel", stroke: "border/default", fill: "bg/surface", clip: true });
  const bar = box("toolbar", { dir: "row", pad: 12, gap: 8, cross: "CENTER" });
  const sbox = box("search", { w: 200 });
  add(sbox, inst(input, { Type: "Text", Value: "Placeholder" }, { Text: "Search", "Left icon": true, "Left icon swap": IC.search.id }), { w: "fill" });
  bar.appendChild(sbox);
  add(bar, spacer(), { w: "fill", h: 1 });
  bar.appendChild(inst(button, { Type: "Outline", Size: "md" }, { Label: "Share", "Left icon": true, "Left icon swap": IC.users.id }));
  bar.appendChild(inst(button, { Type: "Primary", Size: "md" }, { Label: "Export", "Left icon": true, "Left icon swap": IC.download.id }));
  add(app, bar, { w: "fill" });
  add(app, hline(), { w: "fill", h: 1 });
  const body = box("content", { pad: 20, gap: 10 });
  add(body, await text("Q3 field report", "Paragraph/Large Medium", PL, "heading"), { w: "fill" });
  add(body, await text("Survey results from the coastal sites, with photos and the soil samples sent to the lab.", "Paragraph/Small Regular", PU, "paragraph"), { w: "fill" });
  for (const w of [648, 540, 590]) add(body, inst(skeleton, { Shape: "Line" }), { w });
  add(app, body, { w: "fill" });
  add(scene, app, { w: "fill" });
  const place = box("tour-place", { dir: "row", align: "MAX" });
  place.appendChild(tour.createInstance());
  add(scene, place, { w: "fill" });
}
MS.appendChild(scene);

// ---- 2. Docking: toolbar + dockspace dock1 h0.22([Scene tree, Assets], h0.6(v0.62([Viewport],[Log]), [Inspector])) ----
function leaf(tabs, body) {
  const l = box("dock-leaf", { fill: "bg/muted", clip: true });
  const strip = box("tab-strip", { dir: "row" });
  for (const [title, icon, sel] of tabs) strip.appendChild(inst(docTab, { State: sel ? "Selected" : "Default", Dirty: "Off" }, { Title: title, Icon: IC[icon].id }));
  add(l, strip, { w: "fill" });
  add(l, body, { w: "fill", h: "fill" });
  return l;
}
const dividerV = () => box("splitter", { fill: "border/default" });
const win = box("Docking", { component: true, w: 960, h: 560, radius: 12, stroke: "border/default", fill: "bg/surface", clip: true });
{
  const chrome = box("chrome", { dir: "row", pad: 8, gap: 4, cross: "CENTER", fill: "bg/muted" });
  bottomBorder(chrome);
  for (const n of ["layers", "folder", "box", "square-terminal", "sliders-horizontal"]) chrome.appendChild(inst(iconButton, { Type: "Secondary", Size: "sm" }, { Icon: IC[n].id }));
  add(chrome, spacer(), { w: "fill", h: 1 });
  chrome.appendChild(inst(button, { Type: "Outline", Size: "sm" }, { Label: "Reset layout", "Left icon": true, "Left icon swap": IC["rotate-ccw"].id }));
  add(win, chrome, { w: "fill" });
  const dock = box("dockspace", { dir: "row" });

  // left: Scene tree
  const tree = box("scene-tree", { pad: 8, fill: "bg/surface" });
  const node = (kind, lvl, name, selected) => {
    const w = box("node", { pad: [0, 0, 0, lvl * 16] });
    add(w, inst(treeItem, { Kind: kind, Selected: selected ? "On" : "Off" }, { Label: name }), { w: "fill" });
    add(tree, w, { w: "fill" });
  };
  node("Open", 0, "harbor_town"); node("Leaf", 1, "Terrain"); node("Open", 1, "Pier");
  for (const [n, s] of [["pier_01"], ["pier_02"], ["crate_large_01"], ["crate_large_02", true]]) node("Leaf", 2, n, s);
  node("Closed", 1, "Lights");
  add(dock, leaf([["Scene tree", "layers", true], ["Assets", "folder", false]], tree), { w: 210, h: "fill" });
  add(dock, dividerV(), { w: 1, h: "fill" });

  // middle: Viewport over Log
  const mid = box("middle");
  const vp = box("viewport-body", { fill: "bg/muted" });
  {
    const head = box("vp-head", { dir: "row", pad: 8 });
    head.appendChild(await text("Perspective", "Paragraph/Small Medium", PU, "vp-label"));
    add(vp, head, { w: "fill" });
    const stage = box("stage", { gap: 10, align: "CENTER", cross: "CENTER" });
    const crate = box("crate", { radius: 2, stroke: "primary/default", sw: 2 });
    add(stage, crate, { w: 72, h: 72 });
    for (const w of [140, 200, 270, 340, 420]) add(stage, box("grid-line", { fill: "border/default" }), { w, h: 1 });
    add(vp, stage, { w: "fill", h: "fill" });
    const foot = box("vp-foot", { dir: "row", pad: 8 });
    foot.appendChild(await text("1280 x 720  16.4 ms", "Code/11", PH, "vp-stats"));
    add(vp, foot, { w: "fill" });
  }
  add(mid, leaf([["Viewport", "box", true]], vp), { w: "fill", h: 317 });
  add(mid, box("splitter", { fill: "border/default" }), { w: "fill", h: 1 });
  const log = box("log-body", { fill: "bg/surface" });
  for (const [lvl, t, m] of [
    ["Info", "10:42:01", "cmake --build build -j8"], ["Info", "10:42:03", "[ 24%] Building C object src/cui_core.c.o"],
    ["Warn", "10:42:05", "cui_grid.c:412: unused variable 'rows'"], ["Info", "10:42:07", "[ 91%] Linking C executable gallery"],
    ["Info", "10:42:08", "Build finished in 6.8 s"],
  ]) add(log, inst(logLine, { Level: lvl }, { Time: t, Message: m }), { w: "fill" });
  add(mid, leaf([["Log", "square-terminal", true]], log), { w: "fill", h: "fill" });
  add(dock, mid, { w: 449, h: "fill" });
  add(dock, dividerV(), { w: 1, h: "fill" });

  // right: Inspector
  const insp = box("inspector-body", { pad: [4, 12], fill: "bg/surface" });
  const prow = async (name, child) => {
    const r = box("property", { dir: "row", gap: 8, pad: [4, 0], cross: "CENTER" });
    add(r, await text(name, "Paragraph/Small Regular", PU, "property-name"), { w: 72 });
    add(r, child, { w: "fill" });
    add(insp, r, { w: "fill" });
  };
  const vec = (vals) => {
    const r = box("vec", { dir: "row", gap: 4 });
    ["X", "Y", "Z"].forEach((a, i) => add(r, inst(vecField, { Axis: a }, { Value: vals[i] }), { w: "fill" }));
    return r;
  };
  add(insp, inst(invGroup, { Open: "On" }, { Title: "Transform" }), { w: "fill" });
  await prow("Position", vec(["12.5", "0", "-4.2"]));
  await prow("Rotation", vec(["0", "45", "0"]));
  add(insp, inst(invGroup, { Open: "On" }, { Title: "Material" }), { w: "fill" });
  await prow("Shader", inst(propField, { Kind: "Select" }, { Value: "Standard PBR" }));
  await prow("Base color", inst(propField, { Kind: "Color" }, { Value: "#C26A3D" }));
  await prow("Roughness", inst(propField, { Kind: "Number" }, { Value: "0.42" }));
  await prow("Cast shadows", inst(sw, { Checked: "On" }, { Label: false }));
  add(dock, leaf([["Inspector", "sliders-horizontal", true]], insp), { w: "fill", h: "fill" });
  add(win, dock, { w: "fill", h: "fill" });
}
MS.appendChild(win);

// ---- 3. Image viewer and cropper (token placeholder instead of the photo) ----------------------------------------------
function photo(parent, hills, field, sun) {
  const sky = box("sky", { dir: "row", pad: 24, align: "MAX", fill: "feedback/info/subtle" });
  add(sky, box("sun", { fill: "feedback/warning/default", radius: 999 }), { w: sun, h: sun });
  add(parent, sky, { w: "fill", h: "fill" });
  add(parent, box("far-hills", { fill: "bg/muted" }), { w: "fill", h: hills });
  add(parent, box("near-field", { fill: "feedback/success/subtle" }), { w: "fill", h: field });
}
const viewer = box("Image viewer and cropper", { component: true, w: 900, dir: "row", gap: 20 });
{
  const left = box("viewer-col", { gap: 8 });
  left.appendChild(await label("Viewer"));
  const view = viewport("viewer", undefined, 300, "bg/muted");
  photo(view, 48, 90, 40);
  const zrow = box("zoom-row", { dir: "row", pad: 10, align: "MAX" });
  const pill = box("zoom-pill", { dir: "row", pad: 3, cross: "CENTER", radius: 16, fill: "bg/surface", stroke: "border/default" });
  await elevate(pill);
  pill.appendChild(inst(iconButton, { Type: "Ghost", Size: "sm" }, { Icon: IC.minus.id }));
  const pct = box("zoom-value", { dir: "row", align: "CENTER", cross: "CENTER", w: 52 });
  pct.appendChild(await text("160%", "Paragraph/Small Medium", PL, "zoom-text"));
  pill.appendChild(pct);
  pill.appendChild(inst(iconButton, { Type: "Ghost", Size: "sm" }, { Icon: IC.plus.id }));
  pill.appendChild(inst(iconButton, { Type: "Ghost", Size: "sm" }, { Icon: IC["maximize-2"].id }));
  zrow.appendChild(pill);
  // the pill floats over the photo in CUI: here it sits under it, inside the viewer frame
  const vwrap = box("viewer-frame", { radius: 8, stroke: "border/default", fill: "bg/muted", clip: true, h: 300 });
  view.strokes = [];
  view.resize(view.width, 244);
  view.layoutSizingVertical = "FIXED";
  add(vwrap, view, { w: "fill", h: "fill" });
  add(vwrap, zrow, { w: "fill" });
  add(left, vwrap, { w: "fill" });
  add(viewer, left, { w: "fill" });

  const right = box("cropper-col", { gap: 8 });
  right.appendChild(await label("Cropper"));
  const crop = box("cropper", { radius: 8, stroke: "border/default", fill: "bg/inverse", clip: true, align: "CENTER", cross: "CENTER", h: 300 });
  const ring = box("crop-circle", { radius: 999, stroke: "bg/surface", sw: 2, clip: true });
  photo(ring, 36, 66, 32);
  add(crop, ring, { w: 220, h: 220 });
  add(right, crop, { w: "fill" });
  add(viewer, right, { w: "fill" });
}
MS.appendChild(viewer);

// ---- 4. Path bar (file path + scene graph with a children menu) and Tree table -----------------------------------------
async function pathbar(segs, o = {}) {
  const b = box("path-bar", { dir: "row", gap: 4, pad: [4, 8], cross: "CENTER", radius: 8, stroke: "border/default", fill: "bg/surface", w: o.w });
  if (o.home) b.appendChild(await ico("house", 14, "icon/default", "home-icon"));
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (i > 0 || o.home) b.appendChild(await ico("chevron-right", 12, "text/placeholder", "separator"));
    if (s.icon) b.appendChild(await ico(s.icon, 14, "icon/default", "node-icon"));
    b.appendChild(inst(crumb, { Current: i === segs.length - 1 ? "On" : "Off" }, { Label: s.label }));
  }
  return b;
}
const pb = box("Path bar", { component: true, w: 680, pad: 20, gap: 16, fill: "bg/canvas" });
{
  add(pb, await pathbar([{ label: "maya" }, { label: "..." }, { label: "render" }, { label: "cui_render_sw.c" }], { w: 300, home: true }));
  const sg = await pathbar([
    { label: "World", icon: "globe" }, { label: "Harbor", icon: "layers" }, { label: "Dock_North", icon: "layers" },
    { label: "Crane_02", icon: "box" }, { label: "Hook", icon: "box" },
  ], { w: 620 });
  add(pb, sg);
  // the children popup of Harbor, in flow under the bar
  const place = box("menu-place", { pad: [0, 0, 0, 96] });
  const menu = box("harbor-menu", { w: 200, pad: 4, radius: "panel", fill: "bg/surface", stroke: "border/default" });
  await elevate(menu);
  for (const [n, ic, on] of [["Dock_North", "layers", true], ["Dock_South", "layers"], ["Lighthouse", "building-2"], ["Warehouse_A", "building-2"], ["Water", "box"]])
    add(menu, inst(menuItem, { Tone: "Default", State: on ? "Hover" : "Default" }, { Icon: IC[ic].id, Label: n, Shortcut: false }), { w: "fill" });
  place.appendChild(menu);
  add(pb, place);
}
MS.appendChild(pb);

const TT = [
  // name, level, kind, icon, size, modified, type, selected
  ["cui", 0, "open", "folder-open", "7 items", "Today 10:42", "Folder"],
  ["include", 1, "closed", "folder", "1 item", "Nov 4, 2026", "Folder"],
  ["src", 1, "open", "folder-open", "6 items", "Today 10:42", "Folder"],
  ["render", 2, "closed", "folder", "2 items", "Nov 2, 2026", "Folder"],
  ["platform", 2, "closed", "folder", "2 items", "Oct 30, 2026", "Folder"],
  ["cui_core.c", 2, "file", "file", "24.3 KB", "Yesterday 18:47", "C source"],
  ["cui_grid.c", 2, "file", "file", "27.9 KB", "Today 10:42", "C source"],
  ["cui_treetable.c", 2, "file", "file", "26.4 KB", "Today 10:37", "C source", true],
  ["cui_widgets.c", 2, "file", "file", "52.6 KB", "Nov 3, 2026", "C source"],
  ["docs", 1, "closed", "folder", "3 items", "Today 10:40", "Folder"],
  ["tests", 1, "open", "folder-open", "3 items", "Today 10:36", "Folder"],
  ["loading", 2, "loading"],
  ["CMakeLists.txt", 1, "file", "file", "5.9 KB", "Today 10:42", "CMake"],
  ["LICENSE", 1, "file", "file-text", "1.1 KB", "Mar 2, 2026", "Text"],
  ["README.md", 1, "file", "file-text", "9.7 KB", "Nov 1, 2026", "Markdown"],
];
async function trow([name, lvl, kind, icon, size, mod, type, sel]) {
  const row = box("tree-row", { dir: "row", pad: [6, 0], cross: "CENTER", fill: sel ? "primary/subtle" : undefined });
  const nm = box("name", { dir: "row", pad: [0, 12], cross: "CENTER", w: 240 });
  if (lvl) add(nm, box("indent"), { w: lvl * 16, h: 1 });
  const chev = box("chevron", { dir: "row", align: "CENTER", cross: "CENTER" });
  add(nm, chev, { w: 20, h: 20 });
  const lab = box("label", { dir: "row", gap: 8, cross: "CENTER" });
  if (kind === "loading") {
    chev.appendChild(inst(spinner, { Size: "sm" }));
    lab.appendChild(await text("Loading", "Paragraph/Small Regular", PU, "name-text"));
  } else {
    if (kind !== "file") chev.appendChild(await ico(kind === "open" ? "chevron-down" : "chevron-right", 14, "icon/default", "chevron-icon"));
    lab.appendChild(await ico(icon, 16, "icon/default", "node-icon"));
    lab.appendChild(await text(name, "Paragraph/Small Regular", PL, "name-text"));
  }
  add(nm, lab, { w: "fill" });
  row.appendChild(nm);
  if (kind !== "loading") {
    row.appendChild(await tcell(size, 96, true, undefined, PU, "size"));
    row.appendChild(await tcell(mod, 150, false, undefined, PU, "modified"));
    add(row, await tcell(type, 110, false, undefined, PU, "kind"), { w: "fill" });
  }
  return row;
}
const tt = box("Tree table", { component: true, w: 760, gap: 8 });
{
  add(tt, await pathbar([{ label: "cui" }, { label: "src" }, { label: "cui_treetable.c" }], { w: undefined }), { w: "fill" });
  const view = viewport("tree-table", 760, 424, "bg/surface");
  const hdr = box("header", { dir: "row", cross: "CENTER" });
  bottomBorder(hdr);
  add(hdr, inst(hcell, { Sort: "Asc", Align: "Left" }, { Label: "Name" }), { w: 240 });
  add(hdr, inst(hcell, { Sort: "None", Align: "Right" }, { Label: "Size" }), { w: 96 });
  add(hdr, inst(hcell, { Sort: "None", Align: "Left" }, { Label: "Modified" }), { w: 150 });
  add(hdr, inst(hcell, { Sort: "None", Align: "Left" }, { Label: "Kind" }), { w: "fill" });
  // the header cell has no inset of its own: align the labels with the row cells (12 px)
  for (const c of hdr.children) c.paddingLeft = c.paddingRight = 12;
  hdr.paddingTop = hdr.paddingBottom = 8;
  add(view, hdr, { w: "fill" });
  for (const r of TT) add(view, await trow(r), { w: "fill" });
  add(tt, view, { w: "fill" });
  add(tt, await text("cui_treetable.c, 26.4 KB", "Paragraph/Small Regular", PU, "status"), { w: "fill" });
}
MS.appendChild(tt);

// ---- 5. File browser (picker closed): nav toolbar, places, list panel, Save as button ----------------------------------
const FB = [
  ["assets", true, "", "Oct 10, 2024"], ["build", true, "", "Oct 15, 2024"], ["src", true, "", "Oct 15, 2024"],
  ["CMakeLists.txt", false, "1.8 KB", "Oct 2, 2024"], ["cover.png", false, "470.8 KB", "Oct 4, 2024"],
  ["field-report-q3.pdf", false, "2.7 MB", "Oct 12, 2024"], ["main.c", false, "12.5 KB", "Oct 15, 2024"],
  ["README.md", false, "6.2 KB", "Oct 7, 2024"], ["samples-10.csv", false, "140 KB", "Sep 22, 2024"],
  ["samples-2.csv", false, "89 KB", "Sep 21, 2024"], ["site-photos.zip", false, "174 MB", "Oct 8, 2024"], ["theme.mp3", false, "5.1 MB", "Sep 11, 2024"],
];
const FB_ICON = { png: "image", c: "code", h: "code", txt: "file-text", md: "file-text", pdf: "file-text", zip: "archive", mp3: "music", csv: "file" };
const fb = box("File browser", { component: true, w: 900, gap: 10 });
{
  const br = box("browser", { gap: 8, h: 360 });
  const bar = box("toolbar", { dir: "row", gap: 4, cross: "CENTER" });
  bar.appendChild(inst(iconButton, { Type: "Ghost", State: "Disabled", Size: "md" }, { Icon: IC["arrow-left"].id }));
  bar.appendChild(inst(iconButton, { Type: "Ghost", State: "Disabled", Size: "md" }, { Icon: IC["arrow-right"].id }));
  bar.appendChild(inst(iconButton, { Type: "Ghost", Size: "md" }, { Icon: IC["arrow-up"].id }));
  add(bar, await pathbar([{ label: "maya" }, { label: "Projects" }, { label: "fieldnotes" }], { w: undefined }), { w: "fill" });
  const filter = box("filter", { w: 180 });
  add(filter, inst(input, { Type: "Text", Value: "Placeholder" }, { Text: "Filter", "Left icon": true, "Left icon swap": IC.search.id }), { w: "fill" });
  bar.appendChild(filter);
  bar.appendChild(inst(iconButton, { Type: "Ghost", Size: "md" }, { Icon: IC["refresh-cw"].id }));
  add(br, bar, { w: "fill" });

  const body = box("body", { dir: "row", gap: 8 });
  const places = box("places", { gap: 2 });
  for (const [n, ic] of [["maya", "house"], ["Desktop", "monitor"], ["Documents", "file-text"], ["Projects", "folder"]]) {
    const r = box("place", { dir: "row", pad: [6, 8], gap: 8, cross: "CENTER", radius: 8 });
    r.appendChild(await ico(ic, 16, "icon/default", "place-icon"));
    add(r, await text(n, "Paragraph/Small Regular", PL, "place-name"), { w: "fill" });
    add(places, r, { w: "fill" });
  }
  add(body, places, { w: 150, h: "fill" });

  const list = box("list", { radius: 8, stroke: "border/default", fill: "bg/surface", clip: true });
  const head = box("list-header", { dir: "row", pad: [6, 12], gap: 12, cross: "CENTER" });
  bottomBorder(head);
  add(head, await text("Name", "Paragraph/Mini Medium", PU, "col-name"), { w: "fill" });
  const dh = await text("Date modified", "Paragraph/Mini Medium", PU, "col-date");
  head.appendChild(dh);
  dh.textAutoResize = "HEIGHT"; dh.resize(150, dh.height); dh.layoutSizingHorizontal = "FIXED";
  const sh = await text("Size", "Paragraph/Mini Medium", PU, "col-size");
  head.appendChild(sh);
  sh.textAutoResize = "HEIGHT"; sh.resize(76, sh.height); sh.layoutSizingHorizontal = "FIXED"; sh.textAlignHorizontal = "RIGHT";
  add(list, head, { w: "fill" });
  for (const [name, dir, size, date] of FB) {
    const r = box("list-row", { dir: "row", pad: [6, 12], gap: 12, cross: "CENTER" });
    const nm = box("name", { dir: "row", gap: 8, cross: "CENTER" });
    nm.appendChild(await ico(dir ? "folder" : FB_ICON[name.split(".").pop().toLowerCase()] || "file", 16, "icon/default", "entry-icon"));
    nm.appendChild(await text(name, "Paragraph/Small Regular", dir ? PL : PU, "entry-name"));
    add(r, nm, { w: "fill" });
    const d = await text(date, "Paragraph/Small Regular", PU, "entry-date");
    r.appendChild(d);
    d.textAutoResize = "HEIGHT"; d.resize(150, d.height); d.layoutSizingHorizontal = "FIXED";
    const s = await text(dir ? "—" : size, "Paragraph/Small Regular", PU, "entry-size");
    r.appendChild(s);
    s.textAutoResize = "HEIGHT"; s.resize(76, s.height); s.layoutSizingHorizontal = "FIXED"; s.textAlignHorizontal = "RIGHT";
    add(list, r, { w: "fill" });
  }
  add(body, list, { w: "fill", h: "fill" });
  add(br, body, { w: "fill", h: "fill" });
  add(fb, br, { w: "fill" });
  const foot = box("footer", { dir: "row", gap: 8 });
  foot.appendChild(inst(button, { Type: "Secondary", Size: "md" }, { Label: "Save as…", "Left icon": true, "Left icon swap": IC.download.id }));
  add(fb, foot, { w: "fill" });
}
MS.appendChild(fb);

// ---- board cards ------------------------------------------------------------------------------------------------------
const c = await H.cursor();
const CARDS = [
  ["Guided tour", "Step card over the app · dots · back and next", [scene]],
  ["Docking", "Toolbar · tab strips · scene tree · viewport · log · inspector", [win]],
  ["Image viewer and cropper", "Zoom pill · round crop", [viewer]],
  ["Tree table and path bar", "Sorted header · tree rows · path bar with a children menu", [tt, pb]],
  ["File browser and picker", "Navigation toolbar · places · list panel · Save as", [fb]],
];
for (const [caption, sub, masters] of CARDS) {
  const k = await card(null, caption, sub);
  for (const m of masters) k.card.appendChild(m.createInstance());
  await burst(c, k.wrap);
}
c.done();
return Object.fromEntries(CARDS.map(([cap, , ms]) => [cap, ms.map((m) => `${m.name} ${Math.round(m.width)}x${Math.round(m.height)}`).join(" + ")]));
