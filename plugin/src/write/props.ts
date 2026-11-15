// Writable props: the read vocabulary, applied back.
//
// A prop is an Angelo token — `at:10,20`, `gap:16`, `fill:c.surface.default` —
// so a patch is written in the language the read was shown in. Keys this table
// does not list are refused by name; what it cannot express (gradients, images,
// mixed text styling) is refused with a pointer to local_figma_use rather than
// guessed at.

import { fontKey, loadFont } from "../fonts";
import { slug } from "../serialize/format";
import { Legend } from "../serialize/legend";
import { CORNER_FIELDS, PAD_FIELDS } from "../serialize/node";

export interface WriteCtx {
  legend: Legend;
}

type Applier = (node: any, value: string, ctx: WriteCtx) => Promise<void> | void;

const ALIGN: Record<string, string> = {
  start: "MIN",
  center: "CENTER",
  end: "MAX",
  between: "SPACE_BETWEEN",
  baseline: "BASELINE",
};

const CONSTRAINT: Record<string, string> = {
  min: "MIN",
  max: "MAX",
  center: "CENTER",
  stretch: "STRETCH",
  scale: "SCALE",
};

const SIZING: Record<string, string> = {
  fixed: "FIXED",
  hug: "HUG",
  fill: "FILL",
};

const CASE: Record<string, string> = {
  upper: "UPPER",
  lower: "LOWER",
  title: "TITLE",
  original: "ORIGINAL",
};

const DECO: Record<string, string> = {
  underline: "UNDERLINE",
  strike: "STRIKETHROUGH",
  none: "NONE",
};

const TALIGN: Record<string, string> = {
  left: "LEFT",
  center: "CENTER",
  right: "RIGHT",
  justified: "JUSTIFIED",
};

const TVALIGN: Record<string, string> = {
  top: "TOP",
  center: "CENTER",
  bottom: "BOTTOM",
};

const AUTOSIZE: Record<string, string> = {
  none: "NONE",
  width_and_height: "WIDTH_AND_HEIGHT",
  height: "HEIGHT",
  truncate: "TRUNCATE",
};

function numbers(value: string): number[] {
  return value.split(",").map(Number);
}

function must(node: any, field: string, key: string): void {
  if (!(field in node)) {
    throw new Error(`${key}: this node (${node.type}) has no ${field}`);
  }
}

/**
 * `gap`, `pad` and `align` exist on a plain frame but change nothing until it
 * has an autolayout. Writing them there would report success and move nothing,
 * so they are refused with the fix to put in the same batch.
 */
function autolayout(node: any, key: string): void {
  must(node, "layoutMode", key);
  if (node.layoutMode === "NONE") {
    throw new Error(
      `${key}: #${node.id} has no autolayout — set row:on or col:on first in the same batch`
    );
  }
}

function flag(value: string, key: string): boolean {
  if (value === "on") return true;
  if (value === "off") return false;
  throw new Error(`${key}: "on" or "off" expected`);
}

function pick(map: Record<string, string>, value: string, key: string): string {
  const found = map[value];
  if (!found) {
    throw new Error(`${key}: "${value}" is not in the vocabulary (${Object.keys(map).join(", ")})`);
  }
  return found;
}

function rgb(hex: string): RGB {
  const text = hex.length === 4
    ? hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3]
    : hex.slice(1, 7);
  return {
    r: parseInt(text.slice(0, 2), 16) / 255,
    g: parseInt(text.slice(2, 4), 16) / 255,
    b: parseInt(text.slice(4, 6), 16) / 255,
  };
}

function alpha(hex: string): number {
  return hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;
}

function labelled<T extends { label: string; id: string }>(
  entries: Iterable<T>,
  label: string
): T | null {
  for (const entry of entries) if (entry.label === label) return entry;
  return null;
}

/**
 * A paint, from the same text the read showed: a hex, `none`, a paint style
 * (`p.*`) or a colour variable (`c.*`) — the label, never an opaque id.
 */
/** What `setPaints` would refuse, without writing. */
function checkPaint(node: any, field: "fills" | "strokes", value: string, ctx: WriteCtx): void {
  const key = field === "fills" ? "fill" : "stroke";
  must(node, field, key);
  if (value === "none" || HEX_PAINT.test(value)) return;
  const style = labelled(ctx.legend.styles.values(), value);
  if (style) {
    if (style.style.type !== "PAINT") {
      throw new Error(`${key}: ${value} is a ${style.style.type.toLowerCase()} style, a paint style or a colour variable is expected`);
    }
    return;
  }
  const variable = labelled(ctx.legend.vars.values(), value);
  if (variable) {
    if (variable.variable.resolvedType !== "COLOR") {
      throw new Error(`${key}: variable ${value} has type ${variable.variable.resolvedType}, a colour is expected`);
    }
    return;
  }
  throw new Error(
    `paint "${value}" is not supported for writing (gradient, image, or label outside the last read) — use local_figma_use`
  );
}

const HEX_PAINT = /^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3}([0-9A-Fa-f]{2})?)?$/;

async function setPaints(
  node: any,
  field: "fills" | "strokes",
  value: string,
  ctx: WriteCtx
): Promise<void> {
  must(node, field, field === "fills" ? "fill" : "stroke");
  if (value === "none") {
    node[field] = [];
    return;
  }
  if (HEX_PAINT.test(value)) {
    node[field] = [{ type: "SOLID", color: rgb(value), opacity: alpha(value) }];
    return;
  }
  checkPaint(node, field, value, ctx);
  const style = labelled(ctx.legend.styles.values(), value);
  if (style) {
    if (field === "fills") await node.setFillStyleIdAsync(style.id);
    else await node.setStrokeStyleIdAsync(style.id);
    return;
  }
  const variable = labelled(ctx.legend.vars.values(), value);
  if (variable) {
    // The paint keeps a colour of its own under the binding: give it the variable's
    // current value, as Figma does, so detaching later leaves the same colour (not black)
    let color: RGB = { r: 0, g: 0, b: 0 };
    try {
      const resolved: any = variable.variable.resolveForConsumer(node).value;
      if (resolved && typeof resolved.r === "number") color = { r: resolved.r, g: resolved.g, b: resolved.b };
    } catch {
      // unresolved alias or remote mode: the binding still drives the render
    }
    const solid: SolidPaint = { type: "SOLID", color };
    node[field] = [
      figma.variables.setBoundVariableForPaint(solid, "color", variable.variable),
    ];
    return;
  }
  throw new Error(
    `paint "${value}" is not supported for writing (gradient, image, or label outside the last read) — use local_figma_use`
  );
}

async function setFont(node: any, value: string, ctx: WriteCtx): Promise<void> {
  if (node.type !== "TEXT") throw new Error("font: TEXT node expected");
  const style = labelled(ctx.legend.styles.values(), value);
  if (style) {
    await node.setTextStyleIdAsync(style.id);
    return;
  }
  const parts = value.split(" ");
  const size = Number(parts[parts.length - 1]);
  if (!parts.length || !isFinite(size)) {
    throw new Error("font: \"Family Style Size\" or a text style expected");
  }
  const family = parts.slice(0, -2).join(" ");
  const weight = parts[parts.length - 2];
  if (!family || !weight) throw new Error("font: family and style expected before the size");
  const fontName: FontName = { family, style: weight };
  await loadFont(fontName);
  node.fontName = fontName;
  node.fontSize = size;
}

/** The text itself: the font in place has to be loaded first, always. */
async function setCharacters(node: any, value: string): Promise<void> {
  if (node.type !== "TEXT") throw new Error("text: TEXT node expected");
  const font = node.fontName;
  if (typeof font === "symbol") {
    throw new Error(
      "text: this text has several fonts (mixed) — use local_figma_use"
    );
  }
  await loadFont(font as FontName);
  node.characters = unquote(value, "text");
}

/**
 * A quoted value, decoded. The parser keeps `text:"a\nb"` exactly as written,
 * so a prop arrives quoted and escaped; this is the inverse of `quote()` in
 * serialize/format, down to `\s` standing for a non-breaking space.
 */
function unquote(value: string, key: string): string {
  if (value.length < 2 || value[0] !== '"' || value[value.length - 1] !== '"') {
    throw new Error(`${key}: quoted string expected`);
  }
  const body = value.slice(1, -1);
  let out = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") {
      out += body[i];
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) throw new Error(`${key}: empty escape`);
    out += next === "n" ? "\n" : next === "s" ? "\u00a0" : next;
    i++;
  }
  return out;
}

function unit(value: string): LineHeight | LetterSpacing {
  return value.endsWith("%")
    ? { value: Number(value.slice(0, -1)), unit: "PERCENT" }
    : { value: Number(value), unit: "PIXELS" };
}

const NUMBER = /^-?\d+(\.\d+)?$/;
const REF = /^\(([a-z][a-z0-9.\-_]*)\)(?:\{(.*)\})?$/;
const OV = /^\{(.*)\}$/;

function floatVar(label: string, ctx: WriteCtx, key: string): Variable {
  const entry = labelled(ctx.legend.vars.values(), label);
  if (!entry) {
    throw new Error(
      `${key}: "${label}" is neither a number nor a variable of the last read`
    );
  }
  if (entry.variable.resolvedType !== "FLOAT") {
    throw new Error(
      `${key}: variable ${label} has type ${entry.variable.resolvedType}, a number is expected`
    );
  }
  return entry.variable;
}

/**
 * A number, or the variable the read showed in its place. Spacing and radius are
 * what a design system tokenizes: writing the resolved number back would leave a
 * hard value where the file had a token. So a label binds, and a number unbinds
 * first — Figma keeps the alias otherwise, and the number never shows up.
 */
function setNumber(
  node: any,
  field: string,
  value: string,
  key: string,
  ctx: WriteCtx
): void {
  must(node, field, key);
  if (NUMBER.test(value)) {
    const bound = node.boundVariables && node.boundVariables[field];
    if (bound && typeof node.setBoundVariable === "function") {
      node.setBoundVariable(field, null);
    }
    node[field] = Number(value);
    return;
  }
  if (typeof node.setBoundVariable !== "function") {
    throw new Error(`${key}: this node (${node.type}) carries no variable`);
  }
  node.setBoundVariable(field, floatVar(value, ctx, key));
}

/**
 * `a=1, b="x,y"` -> `{a: "1", b: "\"x,y\""}`. A comma inside a quoted value is
 * part of the value: the read quotes text overrides, and they contain commas.
 */
function pairs(body: string, key: string, sign: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!body.trim()) return out;
  const parts: string[] = [];
  let token = "";
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === '"' && body[i - 1] !== "\\") quoted = !quoted;
    if (char === "," && !quoted) {
      parts.push(token);
      token = "";
      continue;
    }
    token += char;
  }
  parts.push(token);
  for (const part of parts) {
    const at = part.indexOf(sign);
    if (at < 0) {
      throw new Error(`${key}: "${part.trim()}" is not a name${sign}value`);
    }
    out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return out;
}

function componentFor(
  label: string,
  ctx: WriteCtx,
  key: string
): ComponentNode | ComponentSetNode {
  const entry = labelled(ctx.legend.components.values(), label);
  if (!entry) {
    throw new Error(
      `${key}: component "${label}" is not in the last read (only the components its scope uses are known) — read a scope that uses it, or swap with local_figma_use`
    );
  }
  return entry.owner as ComponentNode | ComponentSetNode;
}

/** The one name that slugs to `given`, or a refusal naming the candidates. */
function oneOf(names: string[], given: string, what: string, key: string): string {
  const matches = names.filter((name) => slug(name) === given);
  if (!matches.length) {
    throw new Error(`${key}: "${given}" is not ${what} (${names.join(", ") || "none"})`);
  }
  if (matches.length > 1) {
    throw new Error(`${key}: "${given}" matches ${matches.join(" and ")} — ambiguous`);
  }
  return matches[0];
}

/**
 * Variant names and values, from the slugs the read showed back to the set's own
 * spelling. Two properties that slug the same are refused, never guessed.
 */
function variantNames(
  set: ComponentSetNode,
  given: Record<string, string>,
  key: string
): Record<string, string> {
  const defs = set.componentPropertyDefinitions;
  const variants = Object.keys(defs).filter((name) => defs[name].type === "VARIANT");
  const out: Record<string, string> = {};
  for (const name of Object.keys(given)) {
    const real = oneOf(variants, name, `a variant of ${set.name}`, key);
    const options = defs[real].variantOptions || [];
    out[real] = oneOf(options, given[name], `a value of ${real}`, key);
  }
  return out;
}

/** Every font inside an instance, loaded. */
async function loadInstanceFonts(node: any): Promise<void> {
  if (typeof node.findAllWithCriteria !== "function") return;
  const seen = new Set<string>();
  const waits: Promise<void>[] = [];
  const add = (font: FontName): void => {
    const id = fontKey(font);
    if (seen.has(id)) return;
    seen.add(id);
    waits.push(loadFont(font));
  };
  for (const text of node.findAllWithCriteria({ types: ["TEXT"] }) as any[]) {
    if (!text.characters.length) {
      if (typeof text.fontName !== "symbol") add(text.fontName as FontName);
      continue;
    }
    for (const font of text.getRangeAllFontNames(0, text.characters.length)) {
      add(font as FontName);
    }
  }
  await Promise.all(waits);
}

/**
 * setProperties with the fonts in place: a TEXT property rewrites the characters
 * of the instance's text nodes, and Figma refuses that on an unloaded font.
 */
async function setProperties(node: any, values: Record<string, any>): Promise<void> {
  await loadInstanceFonts(node);
  node.setProperties(values);
}

/**
 * `ref(cmp.button){size:l}` — the instance's main component and its variants, in
 * the shape the read showed them. Variants of the set already in place go through
 * setProperties, which keeps the overrides; another component is swapped in.
 */
async function resolveRef(node: any, value: string, ctx: WriteCtx): Promise<() => Promise<void>> {
  if (node.type !== "INSTANCE") throw new Error("ref: INST node expected");
  const match = REF.exec(value);
  if (!match) throw new Error("ref: ref(cmp.x){variant:value} expected");
  const owner = componentFor(match[1], ctx, "ref");
  const given = pairs(match[2] || "", "ref", ":");
  const current = await node.getMainComponentAsync();

  if (owner.type !== "COMPONENT_SET") {
    if (Object.keys(given).length) {
      throw new Error(`ref: ${match[1]} has no variants`);
    }
    return async () => {
      if (!current || current.id !== owner.id) node.swapComponent(owner);
    };
  }

  const names = variantNames(owner, given, "ref");
  const from = current && current.parent;
  if (from && from.type === "COMPONENT_SET" && from.id === owner.id) {
    return async () => {
      if (Object.keys(names).length) await setProperties(node, names);
    };
  }
  // Another set, or no main component at all: swap to the variant that matches,
  // the set's default standing in for whatever the op did not name.
  const base = owner.defaultVariant ? owner.defaultVariant.variantProperties || {} : {};
  const wanted: Record<string, string> = { ...base, ...names };
  const target = owner.children.filter((child) => {
    if (child.type !== "COMPONENT") return false;
    const props = (child as ComponentNode).variantProperties || {};
    return Object.keys(wanted).every((name) => props[name] === wanted[name]);
  })[0];
  if (!target) {
    throw new Error(
      `ref: no variant of ${owner.name} for ${Object.keys(wanted)
        .map((name) => `${name}=${wanted[name]}`)
        .join(", ")}`
    );
  }
  return async () => {
    node.swapComponent(target as ComponentNode);
  };
}

/**
 * `ov{label="Envoyer", icon=on}` — the instance's component properties. The read
 * slugs their names and drops Figma's `#1:2` suffix; the write looks the real
 * keys back up on the instance itself.
 */
async function resolveOverrides(node: any, value: string, ctx: WriteCtx): Promise<() => Promise<void>> {
  if (node.type !== "INSTANCE") throw new Error("ov: INST node expected");
  const match = OV.exec(value);
  if (!match) throw new Error("ov: ov{name=value} expected");
  const given = pairs(match[1], "ov", "=");
  const owned: Record<string, any> = node.componentProperties || {};
  const names = Object.keys(owned);
  const bare = (name: string): string => name.replace(/#\d+:\d+$/, "");
  const out: Record<string, any> = {};
  for (const name of Object.keys(given)) {
    const real = oneOf(
      names.map(bare),
      name,
      "a property of this instance",
      "ov"
    );
    const key = names.filter((candidate) => bare(candidate) === real)[0];
    const raw = given[name];
    switch (owned[key].type) {
      case "TEXT":
        out[key] = unquote(raw, "ov");
        break;
      case "BOOLEAN":
        if (raw !== "on" && raw !== "off") {
          throw new Error(`ov: ${name} is a boolean — ${name}=on or ${name}=off expected`);
        }
        out[key] = raw === "on";
        break;
      case "INSTANCE_SWAP": {
        if (raw === "swap") {
          throw new Error(`ov: ${name} expects the component label (cmp.x), not "swap"`);
        }
        const target = componentFor(raw, ctx, "ov");
        const component = target.type === "COMPONENT_SET" ? target.defaultVariant : target;
        if (!component) throw new Error(`ov: ${raw} has no default variant`);
        out[key] = component.id;
        break;
      }
      default:
        throw new Error(`ov: ${name} is a variant — use ref(cmp.x){${name}:…}`);
    }
  }
  return () => setProperties(node, out);
}

export const WRITABLE: Record<string, Applier> = {
  name: (node, value) => {
    node.name = value;
  },
  at: (node, value) => {
    const [x, y] = numbers(value);
    node.x = x;
    node.y = y;
  },
  wh: (node, value) => {
    const [width, height] = value.split("x").map(Number);
    if (typeof node.resize !== "function") {
      throw new Error("wh: this node cannot be resized");
    }
    node.resize(width, height);
  },
  rot: (node, value) => {
    must(node, "rotation", "rot");
    node.rotation = Number(value);
  },
  op: (node, value) => {
    must(node, "opacity", "op");
    node.opacity = Number(value);
  },
  blend: (node, value) => {
    must(node, "blendMode", "blend");
    node.blendMode = value.toUpperCase().replace(/-/g, "_");
  },
  hidden: (node, value) => {
    node.visible = !flag(value, "hidden");
  },
  locked: (node, value) => {
    node.locked = flag(value, "locked");
  },
  row: (node, value) => {
    must(node, "layoutMode", "row");
    node.layoutMode = flag(value, "row") ? "HORIZONTAL" : "NONE";
  },
  col: (node, value) => {
    must(node, "layoutMode", "col");
    node.layoutMode = flag(value, "col") ? "VERTICAL" : "NONE";
  },
  wrap: (node, value) => {
    must(node, "layoutWrap", "wrap");
    node.layoutWrap = flag(value, "wrap") ? "WRAP" : "NO_WRAP";
  },
  clip: (node, value) => {
    must(node, "clipsContent", "clip");
    node.clipsContent = flag(value, "clip");
  },
  gap: (node, value, ctx) => {
    autolayout(node, "gap");
    if (value === "auto") {
      node.primaryAxisAlignItems = "SPACE_BETWEEN";
      return;
    }
    const [main, counter] = value.split("/");
    setNumber(node, "itemSpacing", main, "gap", ctx);
    if (counter !== undefined) setNumber(node, "counterAxisSpacing", counter, "gap", ctx);
  },
  pad: (node, value, ctx) => {
    autolayout(node, "pad");
    const parts = value.split(",");
    const sides =
      parts.length === 1
        ? [parts[0], parts[0], parts[0], parts[0]]
        : parts.length === 2
          ? [parts[0], parts[1], parts[0], parts[1]]
          : parts;
    PAD_FIELDS.forEach((field, index) => setNumber(node, field, sides[index], "pad", ctx));
  },
  align: (node, value) => {
    autolayout(node, "align");
    const [primary, counter] = value.split(",");
    node.primaryAxisAlignItems = pick(ALIGN, primary, "align");
    node.counterAxisAlignItems = pick(ALIGN, counter, "align");
  },
  size: (node, value) => {
    must(node, "layoutSizingHorizontal", "size");
    const [horizontal, vertical] = value.split(",");
    if (horizontal !== "-") node.layoutSizingHorizontal = pick(SIZING, horizontal, "size");
    if (vertical !== "-") node.layoutSizingVertical = pick(SIZING, vertical, "size");
  },
  grow: (node, value) => {
    must(node, "layoutGrow", "grow");
    node.layoutGrow = Number(value);
  },
  constr: (node, value) => {
    must(node, "constraints", "constr");
    const [horizontal, vertical] = value.split(",");
    node.constraints = {
      horizontal: pick(CONSTRAINT, horizontal, "constr"),
      vertical: pick(CONSTRAINT, vertical, "constr"),
    };
  },
  r: (node, value, ctx) => {
    const parts = value.split(",");
    if (parts.length === 1) {
      // The four corners, one by one: a uniform radius can still be bound corner
      // by corner, and `cornerRadius` takes no variable.
      if ("topLeftRadius" in node) {
        for (const field of CORNER_FIELDS) setNumber(node, field, parts[0], "r", ctx);
        return;
      }
      must(node, "cornerRadius", "r");
      if (!NUMBER.test(parts[0])) {
        throw new Error(`r: this node (${node.type}) only accepts a number`);
      }
      node.cornerRadius = Number(parts[0]);
      return;
    }
    must(node, "topLeftRadius", "r");
    CORNER_FIELDS.forEach((field, index) => setNumber(node, field, parts[index], "r", ctx));
  },
  strokew: (node, value) => {
    must(node, "strokeWeight", "strokew");
    const parts = numbers(value);
    if (parts.length === 1) {
      node.strokeWeight = parts[0];
      return;
    }
    node.strokeTopWeight = parts[0];
    node.strokeRightWeight = parts[1];
    node.strokeBottomWeight = parts[2];
    node.strokeLeftWeight = parts[3];
  },
  dash: (node, value) => {
    must(node, "dashPattern", "dash");
    node.dashPattern = numbers(value);
  },
  fill: (node, value, ctx) => setPaints(node, "fills", value, ctx),
  // Only `inherit`: the regions take the node's own (bound) fills back.
  regionfill: async (node, value) => {
    if (node.type !== "VECTOR") throw new Error("regionfill: VEC node expected");
    if (value !== "inherit") throw new Error("regionfill: only the value \"inherit\" can be written");
    // Reassigning the node fills repaints every region with them. Rewriting the
    // network instead makes Figma hand the old region paint to node.fills.
    node.fills = node.fills.slice();
  },
  stroke: (node, value, ctx) => {
    // Same shape as the read: weight (one number, or four per side), alignment, paint.
    const parts = value.split(" ");
    WRITABLE.strokew(node, parts[0], ctx);
    node.strokeAlign = parts[1].toUpperCase();
    return setPaints(node, "strokes", parts.slice(2).join(" "), ctx);
  },
  ref: async (node, value, ctx) => (await resolveRef(node, value, ctx))(),
  ov: async (node, value, ctx) => (await resolveOverrides(node, value, ctx))(),
  font: (node, value, ctx) => setFont(node, value, ctx),
  text: (node, value) => setCharacters(node, value),
  lh: (node, value) => {
    must(node, "lineHeight", "lh");
    node.lineHeight = unit(value);
  },
  ls: (node, value) => {
    must(node, "letterSpacing", "ls");
    node.letterSpacing = unit(value);
  },
  case: (node, value) => {
    must(node, "textCase", "case");
    node.textCase = pick(CASE, value, "case");
  },
  deco: (node, value) => {
    must(node, "textDecoration", "deco");
    node.textDecoration = pick(DECO, value, "deco");
  },
  talign: (node, value) => {
    must(node, "textAlignHorizontal", "talign");
    node.textAlignHorizontal = pick(TALIGN, value, "talign");
  },
  tvalign: (node, value) => {
    must(node, "textAlignVertical", "tvalign");
    node.textAlignVertical = pick(TVALIGN, value, "tvalign");
  },
  pspace: (node, value) => {
    must(node, "paragraphSpacing", "pspace");
    node.paragraphSpacing = Number(value);
  },
  truncate: (node, value) => {
    must(node, "maxLines", "truncate");
    // maxLines is ignored (reads back null) while truncation is off
    const lines = Number(value);
    node.textTruncation = lines > 0 ? "ENDING" : "DISABLED";
    if (lines > 0) node.maxLines = lines;
  },
  autosize: (node, value) => {
    must(node, "textAutoResize", "autosize");
    node.textAutoResize = pick(AUTOSIZE, value, "autosize");
  },
};

const BLENDS = [
  "PASS_THROUGH", "NORMAL", "DARKEN", "MULTIPLY", "LINEAR_BURN", "COLOR_BURN", "LIGHTEN", "SCREEN",
  "LINEAR_DODGE", "COLOR_DODGE", "OVERLAY", "SOFT_LIGHT", "HARD_LIGHT", "DIFFERENCE", "EXCLUSION",
  "HUE", "SATURATION", "COLOR", "LUMINOSITY",
];

/** Layout mode a node will have at this point of the batch, by node id (pass 1 only). */
export type LayoutSim = Map<string, string>;

/**
 * What `applyProps` would refuse on this node, found without writing anything.
 *
 * The grammar check sees a token alone; this one sees the node: a key the node type
 * does not carry, a value outside the vocabulary, a label the read does not know,
 * `gap` on a frame with no autolayout. Pass 1 runs it so those refusals leave the
 * file untouched instead of failing in pass 2 with earlier ops already applied.
 * `sim` carries `row` / `col` set earlier in the batch, so "set row:on first in the
 * same batch" keeps working across ops.
 */
export async function preflight(
  node: any,
  props: Record<string, string>,
  ctx: WriteCtx,
  sim: LayoutSim
): Promise<string[]> {
  const out: string[] = [];
  const modeOf = (n: any): string =>
    sim.get(n.id) ?? (n && "layoutMode" in n ? n.layoutMode : "NONE");
  const laidOut = (key: string): void => {
    must(node, "layoutMode", key);
    if (modeOf(node) === "NONE") {
      throw new Error(`${key}: #${node.id} has no autolayout — set row:on or col:on first in the same batch`);
    }
  };
  const inFlow = (key: string, what: string): void => {
    const parent = node.parent;
    if (!parent || modeOf(parent) === "NONE") {
      throw new Error(
        `${key}: ${what} needs an autolayout parent — set row:on or col:on on #${parent ? parent.id : "?"} first in the same batch`
      );
    }
  };
  const numberOrVar = (field: string, value: string, key: string): void => {
    must(node, field, key);
    if (NUMBER.test(value)) return;
    if (typeof node.setBoundVariable !== "function") {
      throw new Error(`${key}: this node (${node.type}) carries no variable`);
    }
    floatVar(value, ctx, key);
  };
  const textOnly = (field: string, key: string): void => {
    if (node.type !== "TEXT") throw new Error(`${key}: TEXT node expected`);
    must(node, field, key);
  };

  for (const key of Object.keys(props)) {
    const value = props[key];
    try {
      switch (key) {
        case "wh": {
          if (typeof node.resize !== "function") throw new Error("wh: this node cannot be resized");
          if (value.split("x").some((part) => Number(part) < 0)) throw new Error("wh: sizes cannot be negative");
          break;
        }
        case "rot":
          must(node, "rotation", key);
          break;
        case "op":
          must(node, "opacity", key);
          break;
        case "blend":
          must(node, "blendMode", key);
          if (BLENDS.indexOf(value.toUpperCase().replace(/-/g, "_")) < 0) {
            throw new Error(`blend: "${value}" is not in the vocabulary (${BLENDS.map((b) => b.toLowerCase().replace(/_/g, "-")).join(", ")})`);
          }
          break;
        case "row":
        case "col":
          must(node, "layoutMode", key);
          sim.set(node.id, flag(value, key) ? (key === "row" ? "HORIZONTAL" : "VERTICAL") : "NONE");
          break;
        case "wrap":
          must(node, "layoutWrap", key);
          if (flag(value, key)) laidOut(key);
          break;
        case "clip":
          must(node, "clipsContent", key);
          break;
        case "gap": {
          laidOut(key);
          if (value === "auto") break;
          const [main, counter] = value.split("/");
          numberOrVar("itemSpacing", main, key);
          if (counter !== undefined) numberOrVar("counterAxisSpacing", counter, key);
          break;
        }
        case "pad":
          laidOut(key);
          for (const part of value.split(",")) numberOrVar("paddingLeft", part, key);
          break;
        case "align": {
          laidOut(key);
          const [primary, counter] = value.split(",");
          pick(ALIGN, primary, key);
          pick(ALIGN, counter, key);
          break;
        }
        case "size": {
          must(node, "layoutSizingHorizontal", key);
          const own = "layoutMode" in node && modeOf(node) !== "NONE";
          const parent = node.parent;
          const flow = !!parent && modeOf(parent) !== "NONE";
          for (const axis of value.split(",")) {
            if (axis === "-") continue;
            pick(SIZING, axis, key);
            if (axis === "fill") inFlow(key, "fill");
            else if (axis === "hug" && !own && !(node.type === "TEXT" && flow)) {
              throw new Error(`size: hug needs an autolayout on #${node.id} (set row:on or col:on first in the same batch), or a text inside an autolayout parent`);
            }
          }
          break;
        }
        case "grow":
          // Outside an autolayout parent Figma stores the value with no effect: left as is
          must(node, "layoutGrow", key);
          break;
        case "constr": {
          must(node, "constraints", key);
          const [horizontal, vertical] = value.split(",");
          pick(CONSTRAINT, horizontal, key);
          pick(CONSTRAINT, vertical, key);
          break;
        }
        case "r": {
          const parts = value.split(",");
          if (parts.length === 1 && !("topLeftRadius" in node)) {
            must(node, "cornerRadius", key);
            if (!NUMBER.test(parts[0])) throw new Error(`r: this node (${node.type}) only accepts a number`);
            break;
          }
          for (const part of parts) numberOrVar("topLeftRadius", part, key);
          break;
        }
        case "strokew":
          must(node, "strokeWeight", key);
          if (value.split(",").length === 4) must(node, "strokeTopWeight", key);
          break;
        case "dash":
          must(node, "dashPattern", key);
          break;
        case "fill":
          checkPaint(node, "fills", value, ctx);
          break;
        case "regionfill":
          if (node.type !== "VECTOR") throw new Error("regionfill: VEC node expected");
          if (value !== "inherit") throw new Error("regionfill: only the value \"inherit\" can be written");
          break;
        case "stroke": {
          const parts = value.split(" ");
          must(node, "strokeWeight", key);
          if (parts[0].split(",").length === 4) must(node, "strokeTopWeight", key);
          checkPaint(node, "strokes", parts.slice(2).join(" "), ctx);
          break;
        }
        case "ref":
          await resolveRef(node, value, ctx);
          break;
        case "ov":
          await resolveOverrides(node, value, ctx);
          break;
        case "font": {
          if (node.type !== "TEXT") throw new Error("font: TEXT node expected");
          const style = labelled(ctx.legend.styles.values(), value);
          if (style) {
            if (style.style.type !== "TEXT") throw new Error(`font: ${value} is a ${style.style.type.toLowerCase()} style, a text style is expected`);
            break;
          }
          const parts = value.split(" ");
          const size = Number(parts[parts.length - 1]);
          if (parts.length < 3 || !isFinite(size)) {
            throw new Error(`font: "${value}" is neither "Family Style Size" nor a text style of the read (t.*) — angelo_read with manifest:"full" lists them`);
          }
          const fontName: FontName = { family: parts.slice(0, -2).join(" "), style: parts[parts.length - 2] };
          try {
            await loadFont(fontName);
          } catch {
            throw new Error(`font: "${fontName.family} ${fontName.style}" is not available — use a font already in the read`);
          }
          break;
        }
        case "text":
          if (node.type !== "TEXT") throw new Error("text: TEXT node expected");
          if (typeof node.fontName === "symbol") {
            throw new Error("text: this text has several fonts (mixed) — use local_figma_use");
          }
          unquote(value, key);
          break;
        case "lh":
          textOnly("lineHeight", key);
          break;
        case "ls":
          textOnly("letterSpacing", key);
          break;
        case "pspace":
          textOnly("paragraphSpacing", key);
          break;
        case "truncate":
          textOnly("maxLines", key);
          break;
        case "case":
          textOnly("textCase", key);
          pick(CASE, value, key);
          break;
        case "deco":
          textOnly("textDecoration", key);
          pick(DECO, value, key);
          break;
        case "talign":
          textOnly("textAlignHorizontal", key);
          pick(TALIGN, value, key);
          break;
        case "tvalign":
          textOnly("textAlignVertical", key);
          pick(TVALIGN, value, key);
          break;
        case "autosize":
          textOnly("textAutoResize", key);
          pick(AUTOSIZE, value, key);
          break;
        default:
          break;
      }
    } catch (error: any) {
      out.push(String((error && error.message) || error));
    }
  }
  return out;
}

export const WRITABLE_KEYS = new Set(Object.keys(WRITABLE));

export async function applyProps(
  node: SceneNode,
  props: Record<string, string>,
  ctx: WriteCtx
): Promise<string[]> {
  const done: string[] = [];
  for (const key of Object.keys(props)) {
    await WRITABLE[key](node as any, props[key], ctx);
    done.push(key);
  }
  return done;
}
