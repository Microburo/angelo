// Reads a page's block as a kind of component from the kit grammar (grammar/shadcn/grammar.json): the
// kit gives the structure, the slot names and the logic, the page keeps its own values.
// Similar shapes are not enough (an icon and a word is a button, a menu item, an avatar with a label
// and an alert alike), so a block is only read as a kind when the page itself proves that kind; the
// rest keeps the name the layout gave it.
import components from "./web-grammar-data.mjs";

const ROW_MIN_H = 20;
const ROW_MAX_H = 72;
const ROW_MIN_W = 120;
const BADGE_MAX_H = 30;
const BADGE_MAX_W = 200;
const AVATAR_MAX = 96;
const CARD_MIN_H = 88;
const CARD_MAX_SHARE = 0.7; // of the page's width: wider is a section with a background

const painted = (n) => !!n.bg && !/,\s*0\)$/.test(n.bg);
const drawn = (n) => painted(n) || !!n.border;
const square = (n) => Math.abs(n.w - n.h) <= 2;
const round = (n) => n.r >= Math.min(n.w, n.h) / 2 - 1;
const pressable = (n) => n.tag === "button" || (!!n.btn && n.tag === "a");
const holdsChip = (n) => (n.kids || []).some((k) => k.k === "frame" && ((drawn(k) && layersOf(k).includes("T")) || holdsChip(k)));

const kindOf = (n) => (n.k === "text" ? "T" : n.k === "svg" ? "I" : n.k === "img" ? "M" : n.k === "frame" && n.img && !n.kids?.length ? "M" : "");
export const layersOf = (n, out = []) => {
  const kind = kindOf(n);
  if (kind) out.push(kind);
  else for (const c of n.kids || []) layersOf(c, out);
  return out;
};

// The kit's own layers of a component, in order, spinner and other state-only layers left out.
export const kitSlots = (node, out = []) => {
  for (const c of node.children || []) {
    if (c.kind === "text") out.push({ name: c.name, t: "T" });
    else if (c.kind === "instance") { if (!/Spinner|Tabs Counter/.test(c.instance || "")) out.push({ name: c.name, t: /Lucide/.test(c.instance || "") ? "I" : "X" }); }
    else if (c.kind === "rectangle") { if (!c.hidden) out.push({ name: c.name, t: "M" }); }
    else kitSlots(c, out);
  }
  return out;
};

export function loadGrammar() {
  return new Map(components.map((c) => [c.name, { name: c.name, level: c.level, heights: c.heights, props: Object.keys(c.props || {}), slots: kitSlots(c.anatomy) }]));
}

// [displayed name, kit component, proof]; the first whose proof holds wins.
// (a kit is one name or a list of names, the first the grammar knows: the Angelo library and the previous kit
// do not always call a component alike)
const toggled = (n) => typeof n.on === "boolean";
const KINDS = [
  // the page's own declarations: a switch says so, an alert too; a chip is a pressable pill that holds a state
  ["Switch", ["Switch"], (n) => n.role === "switch" && n.h <= 40],
  ["Alert", ["Alert"], (n, l) => (n.role === "alert" || n.role === "status") && n.h > BADGE_MAX_H && l.filter((x) => x === "T").length >= 1 && l.length >= 2 && l.length <= 5],
  ["Chip", ["Chip"], (n, l) => pressable(n) && toggled(n) && n.r >= n.h / 3 && n.h >= 24 && n.h <= 44 && /^I?T$/.test(l.join(""))],
  // (a one-line field is an Input, whatever it shows: several lines are another thing)
  ["Textarea", "Input", (n) => n.tag === "textarea"],
  ["Input", "Input", (n) => ["input", "select"].includes(n.tag)],
  ["Avatar", "Avatar With Image", (n, l) => l.join("") === "M" && square(n) && round(n) && n.w <= AVATAR_MAX],
  ["Icon Button", "Icon Button", (n, l) => n.k === "frame" && l.join("") === "I" && (pressable(n) || n.tag === "a")],
  ["Badge", "Badge", (n, l) => /^I?TI?$/.test(l.join("")) && n.h <= BADGE_MAX_H && n.w <= BADGE_MAX_W && drawn(n) && n.tag !== "button" && n.tag !== "a"],
  ["Button", "Button", (n, l) => /^I?TI?$/.test(l.join("")) && pressable(n) && (drawn(n) || l[0] !== "I" || n.w < ROW_MIN_W)],
  // a leading icon or image is what makes a row of a line of words; chips inside make it a group of chips
  ["Row", "Dropdown Menu Item", (n, l, c) => n.dir === "H" && n.h >= ROW_MIN_H && n.h <= ROW_MAX_H && n.w >= ROW_MIN_W && c.count >= 2 && l.length <= 5 && /^[IM]T{1,2}[ITM]*$/.test(l.join("")) && !holdsChip(n)],
  ["Card", "Card", (n, l, c) => n.dir === "V" && n.h >= CARD_MIN_H && l.length >= 2 && n.w < CARD_MAX_SHARE * c.pageW && (((painted(n) || n.border) && n.r > 0) || (l[0] === "M" && c.count >= 2))],
];

// The kit's slot name for each of the page's layers: what comes before the text takes the kit's
// leading slot, the text its text slots, what is left its trailing slot.
export function slotNames(kit, layers) {
  if (kit.slots.every((s) => s.t === "X")) return []; // a free container: its content keeps its own names
  const texts = kit.slots.filter((s) => s.t === "T").map((s) => s.name);
  const firstText = kit.slots.findIndex((s) => s.t === "T");
  const others = kit.slots.filter((s) => s.t !== "T");
  const lead = firstText > 0 ? kit.slots[0].name : others[0]?.name;
  const trail = firstText >= 0 ? kit.slots.slice(firstText + 1).find((s) => s.t !== "T")?.name : others[1]?.name;
  const seen = new Map();
  const numbered = (name) => { const i = (seen.get(name) || 0) + 1; seen.set(name, i); return i > 1 ? `${name} ${i}` : name; };
  const first = layers.indexOf("T");
  let t = 0;
  return layers.map((kind, i) => {
    // one text slot per text, the next ones numbered after the last: a text never takes an icon's slot
    if (kind === "T") return texts.length ? numbered(texts[Math.min(t++, texts.length - 1)]) : null;
    const name = i < first || first < 0 ? lead : trail;
    return name ? numbered(name) : null;
  });
}

// { name, kit, level, slots } or null. ctx: { count, pageW }.
export function recognize(n, grammar, ctx) {
  if (n.lm) return null; // a landmark's own name says more than any kit component
  const layers = layersOf(n);
  for (const [name, kit, proof] of KINDS) {
    if (!proof(n, layers, ctx)) continue;
    const g = [].concat(kit).map((k) => grammar.get(k)).find(Boolean);
    if (!g) continue;
    return { name, kit: g.name, def: g, level: g.level, layers, slots: slotNames(g, layers) };
  }
  return null;
}
