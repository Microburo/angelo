// Image (Orientation × Ratio, aspect locked, bg/muted placeholder), Avatar (Type × Size, image 1:1 + pill),
// Badge (Tone, dot boolean), Item (Leading × State, line 2 and right icon booleans), board cards.
for (const n of ["Image", "Avatar", "Badge", "Item"]) setNamed(n)?.remove();
const BASE = 160;
const RATIOS = [
  ["Square", "1:1"],
  ...["5:4", "4:3", "3:2", "16:9", "2:1", "21:9"].map((r) => ["Landscape", r]),
  ...["4:5", "3:4", "2:3", "9:16", "1:2"].map((r) => ["Portrait", r]),
];
const image = await variants("Image", RATIOS.map(([Orientation, Ratio]) => ({ Orientation, Ratio })), async ({ Ratio }) => {
  const [w, h] = Ratio.split(":").map(Number);
  const f = figma.createComponent();
  f.resize(BASE, Math.round((BASE * h) / w));
  // placeholder: plain bg/muted fill (replace with a real image on use)
  f.fills = [solid("bg/muted")];
  f.clipsContent = true;
  if (f.lockAspectRatio) f.lockAspectRatio();
  return f;
}, { cols: 7 });
const square = image.children.find((n) => n.name.includes("Ratio=1:1"));

// avatar photo (assets/avatar.jpg, injected by run.mjs) over the Image placeholder
const photo = figma.createImage(figma.base64Decode(ASSETS.avatar)).hash;
const AV = { sm: [24, "Paragraph/Mini Medium"], md: [32, "Paragraph/Mini Medium"], lg: [40, "Paragraph/Small Medium"] };
// Initials inverse: bg/inverse fill, text/on-primary initials
const AVT = { Image: [undefined], Initials: ["primary/subtle", "primary/default"], "Initials inverse": ["bg/inverse", "text/on-primary"] };
const avatar = await variants("Avatar", { Type: Object.keys(AVT), Size: Object.keys(AV) }, async ({ Type, Size }) => {
  const [s, font] = AV[Size];
  const [bg, fg] = AVT[Type];
  const a = box("avatar", { component: true, dir: "row", w: s, h: s, radius: "avatar", align: "CENTER", cross: "CENTER", clip: true, fill: bg });
  if (Type === "Image") {
    const i = square.createInstance();
    i.name = "img";
    add(a, i, { w: "fill", h: "fill" });
    i.fills = [{ type: "IMAGE", imageHash: photo, scaleMode: "FILL" }];
  } else a.appendChild(await text("AB", font, fg, "initials"));
  return a;
}, { cols: 3 });
wire(avatar, [{ layer: "initials", kind: "TEXT", name: "Initials" }]);

const TONES = { Neutral: ["bg/muted", "text/secondary", "text/secondary"], Primary: ["primary/subtle", "primary/default", "primary/default"] };
for (const t of ["Success", "Warning", "Error", "Info"]) {
  const k = t.toLowerCase();
  TONES[t] = [`feedback/${k}/subtle`, `feedback/${k}/text`, `feedback/${k}/default`];
}
const badge = await variants("Badge", { Tone: Object.keys(TONES) }, async ({ Tone }) => {
  const [bg, fg, dotc] = TONES[Tone];
  const b = box("badge", { component: true, dir: "row", gap: 4, pad: [2, 8], radius: "badge", cross: "CENTER", fill: bg });
  const dot = box("dot", { w: 6, h: 6, radius: 999, fill: dotc });
  dot.visible = false;
  b.appendChild(dot);
  b.appendChild(await text(Tone, "Paragraph/Mini Medium", fg, "label"));
  return b;
}, { cols: 6 });
wire(badge, [
  { layer: "dot", kind: "BOOLEAN", name: "Dot", def: false },
  { layer: "label", kind: "TEXT", name: "Label" },
]);

const ICONS = ["chevron-right", "star", "folder", "file", "settings", "user-round", "bell", "more-horizontal"];
const icons = [];
for (const n of ICONS) icons.push(await H.icon(n, ICON));
const avLg = avatar.children.find((n) => n.name === "Type=Image, Size=lg");
const item = await variants("Item", { Leading: ["None", "Icon", "Image", "Avatar"], State: ["Default", "Hover"] }, async ({ Leading, State }) => {
  const b = box("item", { component: true, dir: "row", gap: 12, pad: [12, 16], w: 320, radius: "item", cross: "CENTER", fill: State === "Hover" ? "interaction/hover" : undefined });
  if (Leading === "Image") {
    const i = square.createInstance();
    i.name = "img";
    i.resize(40, 40);
    // V1: Default bound to radius/2, Hover kept at a raw 8
    if (CUI) rad(i, 8);
    else if (State === "Default") rad(i, 2);
    else i.cornerRadius = 8;
    b.appendChild(i);
  }
  if (Leading === "Avatar") {
    const a = avLg.createInstance();
    a.name = "avatar";
    b.appendChild(a);
  }
  if (Leading === "Icon") b.appendChild(await ico("folder", 20, "text/secondary", "left-icon"));
  const t = box("text", { gap: 2 });
  add(t, await text("Line 1", "Paragraph/Small Medium", "text/primary", "line-1"), { w: "fill" });
  add(t, await text("Line 2", "Paragraph/Small Regular", "text/secondary", "line-2"), { w: "fill" });
  add(b, t, { w: "fill" });
  b.appendChild(await ico("chevron-right", 18, "text/secondary", "right-icon"));
  return b;
}, { cols: 2 });
wire(item, [
  { layer: "left-icon", kind: "SWAP", name: "Left icon swap", def: icons[2].id, pref: icons },
  { layer: "line-1", kind: "TEXT", name: "Line 1" },
  { layer: "line-2", kind: "BOOLEAN", name: "Line 2", def: true },
  { layer: "line-2", kind: "TEXT", name: "Line 2 text" },
  { layer: "right-icon", kind: "BOOLEAN", name: "Right icon", def: true },
  { layer: "right-icon", kind: "SWAP", name: "Right icon swap", def: icons[0].id, pref: icons },
]);

const c = await H.cursor();
const body = null;
const ik = await card(body, "Image", "Orientation × Ratio", { w: 1180 });
const ir = box("ratios", { dir: "row", gap: 16, wrap: 24, w: 1100 });
for (const v of image.children) {
  const cell = box(v.name, { gap: 6 });
  cell.appendChild(v.createInstance());
  cell.appendChild(await text(v.name.split("Ratio=")[1], "Paragraph/Mini Regular", "text/secondary", "sub"));
  ir.appendChild(cell);
}
ik.card.appendChild(ir);
await burst(c, ik.wrap);

const ak = await card(body, "Avatar", "Type × Size");
const ar = box("avatars", { dir: "row", gap: 12, cross: "CENTER" });
for (const Type of Object.keys(AVT)) for (const Size of Object.keys(AV)) ar.appendChild(inst(avatar, { Type, Size }));
ak.card.appendChild(ar);
await burst(c, ak.wrap);
const bk = await card(body, "Badge", "Tone");
const br = box("badges", { dir: "row", gap: 8, cross: "CENTER" });
for (const Tone of Object.keys(TONES)) br.appendChild(inst(badge, { Tone }, { Dot: Tone !== "Neutral", Label: Tone }));
bk.card.appendChild(br);
await burst(c, bk.wrap);

const lk = await card(body, "Item", "Leading × State", { gap: 4 });
const rows = [
  [{ Leading: "None" }, { "Line 1": "Text only", "Line 2": false }],
  [{ Leading: "Icon" }, { "Line 1": "Documents", "Line 2 text": "12 files" }],
  [{ Leading: "Image", State: "Hover" }, { "Line 1": "Cover image", "Line 2 text": "Hover" }],
  [{ Leading: "Avatar" }, { "Line 1": "Jane Doe", "Line 2 text": "Designer", "Right icon": false }],
];
for (const [v, p] of rows) lk.card.appendChild(inst(item, v, p));
await burst(c, lk.wrap);
c.done();
return { image: image.children.length, avatar: avatar.children.length, badge: badge.children.length, item: item.children.length };
