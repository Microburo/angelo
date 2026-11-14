// Variables (Primitives + Semantic aliases), text styles bound to font tokens, elevation effect
// styles bound to shadow tokens, grid styles. Line height stays 130 % inside each text style.
const hex = (h, a = 1) => ({ r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255, a });
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const RAMPS = {
  neutral: "fafafa f5f5f5 e5e5e5 d4d4d4 a3a3a3 737373 525252 404040 262626 171717", // true gray (R = G = B)
  teal: "f0fdfa ccfbf1 99f6e4 5eead4 2dd4bf 14b8a6 0d9488 0f766e 115e59 134e4a",
  red: "fef2f2 fee2e2 fecaca fca5a5 f87171 ef4444 dc2626 b91c1c 991b1b 7f1d1d",
  amber: "fffbeb fef3c7 fde68a fcd34d fbbf24 f59e0b d97706 b45309 92400e 78350f",
  green: "f0fdf4 dcfce7 bbf7d0 86efac 4ade80 22c55e 16a34a 15803d 166534 14532d",
  blue: "eff6ff dbeafe bfdbfe 93c5fd 60a5fa 3b82f6 2563eb 1d4ed8 1e40af 1e3a8a",
};

// client brand ramp: dark khaki (created after elevation, V1 variable order)
const BRAND = "f7f7ef ecebd9 d9d6b3 c0bc88 a19c62 847f48 6b6639 55512f 433f27 34311f";

const prim = figma.variables.createVariableCollection("Primitives");
const pm = prim.modes[0].modeId;
prim.renameMode(pm, "Value");
const mk = (name, type, value, scopes, col = prim, mode = pm) => {
  const v = figma.variables.createVariable(name, col, type);
  v.setValueForMode(mode, value);
  v.scopes = scopes;
  V[name] = v;
  return v;
};

// raw colors: hidden from pickers, used through Semantic
for (const [ramp, list] of Object.entries(RAMPS)) list.split(" ").forEach((h, i) => mk(`color/${ramp}/${STEPS[i]}`, "COLOR", hex(h), []));
mk("color/white", "COLOR", hex("ffffff"), []);
mk("color/black", "COLOR", hex("000000"), []);
for (const a of [8, 10, 14]) mk(`color/alpha/black-${a}`, "COLOR", hex("000000", a / 100), []);

for (const s of [4, 8, 12, 16, 24, 32, 40, 48, 56, 64, 72, 80, 100, 120, 140, 160, 180, 200, 220]) mk(`space/${s}`, "FLOAT", s, ["GAP", "WIDTH_HEIGHT"]);
// radius/24 = the element cards' rounding (radius/board), kept in scale order (decided 2026-11-08)
for (const r of [0, 2, 4, 8, 12, 16, 24, 999]) mk(`radius/${r}`, "FLOAT", r, ["CORNER_RADIUS"]);
const SHADOWS = { sm: [1, 2, 0, 8], md: [4, 12, -2, 10], lg: [12, 32, -6, 14] };
for (const [k, [y, blur, spread]] of Object.entries(SHADOWS)) {
  mk(`elevation/${k}/y`, "FLOAT", y, ["EFFECT_FLOAT"]);
  mk(`elevation/${k}/blur`, "FLOAT", blur, ["EFFECT_FLOAT"]);
  mk(`elevation/${k}/spread`, "FLOAT", spread, ["EFFECT_FLOAT"]);
}
BRAND.split(" ").forEach((h, i) => mk(`color/brand/${STEPS[i]}`, "COLOR", hex(h), []));
// off-grid space steps used by components (added after the brand ramp, V1 variable order)
for (const s of [2, 6, 10, 14, 20]) mk(`space/${s}`, "FLOAT", s, ["GAP", "WIDTH_HEIGHT"]);

// semantic colors alias the raw ones
const sem = figma.variables.createVariableCollection("Semantic");
const sm = sem.modes[0].modeId;
sem.renameMode(sm, "Light");
const SEM = {
  "bg/canvas": "neutral/100", "bg/surface": "white", "bg/subtle": "neutral/50", "bg/muted": "neutral/100", "bg/inverse": "neutral/900",
  "text/primary": "neutral/900", "text/secondary": "neutral/500", "text/placeholder": "neutral/400", "text/disabled": "neutral/400", "text/on-primary": "white",
  "border/default": "neutral/200", "border/strong": "neutral/300", "border/focus": "neutral/900",
  "primary/default": "neutral/900", "primary/hover": "neutral/800", "primary/active": "neutral/700", "primary/disabled": "neutral/200", "primary/subtle": "neutral/100",
  "interaction/hover": "neutral/100", "interaction/active": "neutral/200", "interaction/disabled": "neutral/100",
  "feedback/success/default": "green/600", "feedback/success/subtle": "green/50", "feedback/success/text": "green/700",
  "feedback/warning/default": "amber/500", "feedback/warning/subtle": "amber/50", "feedback/warning/text": "amber/700",
  "feedback/error/default": "red/600", "feedback/error/subtle": "red/50", "feedback/error/text": "red/700",
  "feedback/info/default": "blue/600", "feedback/info/subtle": "blue/50", "feedback/info/text": "blue/700",
  "shadow/sm": "alpha/black-8", "shadow/md": "alpha/black-10", "shadow/lg": "alpha/black-14",
  // added with the CUI port, after the original set (V1 variable order)
  "border/input": "neutral/300", "secondary/default": "neutral/100", "secondary/hover": "neutral/200", "secondary/active": "neutral/300",
  "icon/default": "neutral/700",
};
// component radii, in their own "Components" collection, alias the radius scale:
// change the rounding of a component family in one place
const comp = figma.variables.createVariableCollection("Components");
const cm = comp.modes[0].modeId;
comp.renameMode(cm, "Value");
const RADIUS = { button: 999, "icon-button": 999, input: 8, checkbox: 4, badge: 999, item: 8, avatar: 999, chip: 999, panel: 8, surface: 16, tooltip: 4, board: 24 };
for (const [k, r] of Object.entries(RADIUS)) mk(`radius/${k}`, "FLOAT", figma.variables.createVariableAlias(vr(`radius/${r}`)), ["CORNER_RADIUS"], comp, cm);
// font tokens in their own "Typography" collection; sizes split display / paragraph, largest first
const ty = figma.variables.createVariableCollection("Typography");
const tm = ty.modes[0].modeId;
ty.renameMode(tm, "Value");
mk("family/display", "STRING", DISPLAY_FONT.family, ["FONT_FAMILY"], ty, tm);
mk("family/paragraph", "STRING", "Inter", ["FONT_FAMILY"], ty, tm);
mk("weight/regular", "STRING", "Regular", ["FONT_STYLE"], ty, tm);
mk("weight/medium", "STRING", "Medium", ["FONT_STYLE"], ty, tm);
for (const s of [40, 36, 30, 24]) mk(`size/display/${s}`, "FLOAT", s, ["FONT_SIZE"], ty, tm);
for (const s of [17, 15, 13, 11]) mk(`size/paragraph/${s}`, "FLOAT", s, ["FONT_SIZE"], ty, tm);
for (const [name, raw] of Object.entries(SEM)) {
  const scopes = name.startsWith("text/") ? ["TEXT_FILL"] : name.startsWith("icon/") ? ["SHAPE_FILL"] : name.startsWith("border/") ? ["STROKE_COLOR"] : name.startsWith("shadow/") ? ["EFFECT_COLOR"] : ["FRAME_FILL", "SHAPE_FILL", "STROKE_COLOR"];
  mk(name, "COLOR", figma.variables.createVariableAlias(vr(`color/${raw}`)), scopes, sem, sm);
}

// text styles: family, weight and size bound; 130 % line height
const TYPE = [
  // largest first, as listed in the styles panel
  ...[17, 15, 13, 11].flatMap((s) => ["Regular", "Medium"].map((w) => ["Paragraph", s, w])),
  ...[40, 36, 30, 24].map((s) => ["Display", s, "Medium"]),
];
for (const [kind, size, weight] of TYPE) {
  const st = figma.createTextStyle();
  st.name = STYLE_NAME(kind, size, weight);
  st.fontName = { family: kind === "Display" ? DISPLAY_FONT.family : "Inter", style: weight };
  st.fontSize = size;
  st.lineHeight = { unit: "PERCENT", value: 130 };
  st.setBoundVariable("fontFamily", vr(`family/${kind.toLowerCase()}`));
  st.setBoundVariable("fontStyle", vr(`weight/${weight.toLowerCase()}`));
  st.setBoundVariable("fontSize", vr(`size/${kind.toLowerCase()}/${size}`));
}

// elevation: drop shadow with every parameter bound
for (const k of Object.keys(SHADOWS)) {
  let e = { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 0 }, radius: 0, spread: 0, visible: true, blendMode: "NORMAL", showShadowBehindNode: false };
  e = figma.variables.setBoundVariableForEffect(e, "color", vr(`shadow/${k}`));
  e = figma.variables.setBoundVariableForEffect(e, "offsetY", vr(`elevation/${k}/y`));
  e = figma.variables.setBoundVariableForEffect(e, "radius", vr(`elevation/${k}/blur`));
  e = figma.variables.setBoundVariableForEffect(e, "spread", vr(`elevation/${k}/spread`));
  const es = figma.createEffectStyle();
  es.name = `Elevation/${k}`;
  es.effects = [e];
}

// grids: black 10 %
const grid = (name, count, margin, gutter) => {
  const g = figma.createGridStyle();
  g.name = name;
  g.layoutGrids = [{ pattern: "COLUMNS", alignment: "STRETCH", count, offset: margin, gutterSize: gutter, visible: true, color: { r: 0, g: 0, b: 0, a: 0.1 } }];
};
grid("Grid/Desktop 1440", 12, 20, 20);
grid("Grid/Mobile 430", 6, 12, 4);

return { variables: Object.keys(V).length, textStyles: TYPE.length, effects: 3, grids: 2 };
