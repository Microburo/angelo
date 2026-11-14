// Node -> Angelo line(s).
//
// Two levels, as decided for the format:
//   surface : type, id, name, size, layout mode. Always sent.
//   detail  : geometry, paints, strokes, effects, text, overrides. Per chunk.

import { hex, num, pct, quote, slug } from "./format";
import { Legend } from "./legend";

const TYPE_TAG: Record<string, string> = {
  FRAME: "FRAME",
  GROUP: "GROUP",
  COMPONENT: "CMP",
  COMPONENT_SET: "SET",
  INSTANCE: "INST",
  TEXT: "TEXT",
  RECTANGLE: "RECT",
  ELLIPSE: "ELL",
  POLYGON: "POLY",
  STAR: "STAR",
  LINE: "LINE",
  VECTOR: "VEC",
  BOOLEAN_OPERATION: "BOOL",
  SECTION: "SECT",
  SLICE: "SLICE",
  STICKY: "STICKY",
  CONNECTOR: "CONN",
  SHAPE_WITH_TEXT: "SHAPE",
  TABLE: "TABLE",
  EMBED: "EMBED",
  LINK_UNFURL: "LINK",
  MEDIA: "MEDIA",
  WIDGET: "WIDGET",
  WASHI_TAPE: "TAPE",
  CODE_BLOCK: "CODE",
};

const ALIGN: Record<string, string> = {
  MIN: "start",
  CENTER: "center",
  MAX: "end",
  SPACE_BETWEEN: "between",
  BASELINE: "baseline",
};

const CONSTRAINT: Record<string, string> = {
  MIN: "min",
  MAX: "max",
  CENTER: "center",
  STRETCH: "stretch",
  SCALE: "scale",
};

const SIZING: Record<string, string> = {
  FIXED: "fixed",
  HUG: "hug",
  FILL: "fill",
};

export function typeTag(node: BaseNode): string {
  return TYPE_TAG[node.type] ?? node.type;
}

/** Instances and boolean ops are opaque: we never walk inside them. */
export function isOpaque(node: SceneNode): boolean {
  return node.type === "INSTANCE" || node.type === "BOOLEAN_OPERATION";
}

export function childrenOf(node: SceneNode): readonly SceneNode[] {
  if (isOpaque(node)) return [];
  const container = node as SceneNode & ChildrenMixin;
  return "children" in container ? container.children : [];
}

function anyNode(node: SceneNode): any {
  return node as any;
}

/**
 * Main components resolved so far in one read, keyed by instance id. The walk,
 * the line and the fingerprint all need the main of an instance, and
 * getMainComponentAsync is a round trip each time; one pass asks once.
 */
export type Mains = Map<string, ComponentNode | null>;

export async function mainOf(
  node: InstanceNode,
  mains?: Mains
): Promise<ComponentNode | null> {
  const cached = mains && mains.get(node.id);
  if (cached !== undefined) return cached;
  let main: ComponentNode | null = null;
  try {
    main = await node.getMainComponentAsync();
  } catch {
    main = null;
  }
  if (mains) mains.set(node.id, main);
  return main;
}

/**
 * The component an INSTANCE_SWAP property points at. Its value is a component
 * id the property itself hands out, never an unread guess. Cached in `mains`
 * under a `swap:` key: ten cards sharing one icon resolve it once.
 */
async function swapTarget(id: string, mains?: Mains): Promise<ComponentNode | null> {
  const key = `swap:${id}`;
  const cached = mains && mains.get(key);
  if (cached !== undefined) return cached;
  let target: ComponentNode | null = null;
  try {
    const node = await figma.getNodeByIdAsync(id);
    if (node && node.type === "COMPONENT") target = node as ComponentNode;
  } catch {
    target = null;
  }
  if (mains) mains.set(key, target);
  return target;
}

/**
 * Region fills of a vector network override the node's own fills when drawn:
 * a vector bound to a token can still render the region's raw paint. Shown
 * only when they differ from the node fills, since that gap is what misleads.
 */
export async function regionFillToken(node: VectorNode, legend: Legend): Promise<string | null> {
  let regions: readonly VectorRegion[];
  try {
    regions = node.vectorNetwork.regions || [];
  } catch {
    return null;
  }
  const own = await paintsToken(node.fills, legend);
  const seen = new Set<string>();
  for (const region of regions) {
    if (!region.fills || !region.fills.length) continue;
    const token = await paintsToken(region.fills, legend);
    if (token && token !== own) seen.add(token);
  }
  if (!seen.size) return null;
  return seen.size === 1 ? [...seen][0] : "mixed";
}

/** `bound` is the node's boundVariables, read once by the caller: the getter builds the map each time. */
async function boundVar(
  bound: any,
  field: string,
  legend: Legend
): Promise<string | null> {
  if (!bound) return null;
  const entry = bound[field];
  if (!entry) return null;
  const alias = Array.isArray(entry) ? entry[0] : entry;
  if (!alias || typeof alias.id !== "string") return null;
  return legend.variable(alias.id);
}

async function paintToken(paint: Paint, legend: Legend): Promise<string> {
  const opacity = paint.opacity === undefined ? 1 : paint.opacity;
  if (paint.type === "SOLID") {
    const alias = (paint as any).boundVariables?.color;
    if (alias && typeof alias.id === "string") {
      const label = await legend.variable(alias.id);
      if (label) return opacity < 0.999 ? `${label}@${pct(opacity)}%` : label;
    }
    return hex(paint.color, opacity);
  }
  if (
    paint.type === "GRADIENT_LINEAR" ||
    paint.type === "GRADIENT_RADIAL" ||
    paint.type === "GRADIENT_ANGULAR" ||
    paint.type === "GRADIENT_DIAMOND"
  ) {
    const kind = paint.type.replace("GRADIENT_", "").toLowerCase();
    const stops = paint.gradientStops
      .map((stop) => `${hex(stop.color)}@${pct(stop.position)}%`)
      .join(",");
    return `grad.${kind}(${stops})`;
  }
  if (paint.type === "IMAGE") {
    return `img(${(paint.scaleMode ?? "FILL").toLowerCase()})`;
  }
  if (paint.type === "VIDEO") return "video";
  return paint.type.toLowerCase();
}

export async function paintsToken(
  paints: readonly Paint[] | symbol,
  legend: Legend
): Promise<string | null> {
  if (typeof paints === "symbol") return "mixed";
  if (!paints || paints.length === 0) return null;
  // Hidden paints are dropped rather than written as "none": the line says what
  // the node paints, and a token that paints nothing is noise.
  const visible = paints.filter((paint) => paint.visible !== false);
  if (!visible.length) return null;
  const tokens: string[] = [];
  for (const paint of visible) tokens.push(await paintToken(paint, legend));
  return tokens.join("+");
}

async function effectToken(effect: Effect, legend: Legend): Promise<string> {
  if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
    const kind = effect.type === "DROP_SHADOW" ? "drop" : "inner";
    const alias = (effect as any).boundVariables?.color;
    let color = hex(effect.color);
    if (alias && typeof alias.id === "string") {
      const label = await legend.variable(alias.id);
      if (label) color = label;
    }
    const spread = effect.spread ? `,${num(effect.spread)}` : "";
    return `${kind}(${num(effect.offset.x)},${num(effect.offset.y)},${num(
      effect.radius
    )}${spread},${color})`;
  }
  if (effect.type === "LAYER_BLUR") return `blur(${num(effect.radius)})`;
  if (effect.type === "BACKGROUND_BLUR") return `bgblur(${num(effect.radius)})`;
  if (effect.type === "TEXTURE") return `texture(${num(effect.noiseSize)})`;
  if (effect.type === "NOISE") return "noise";
  return effect.type.toLowerCase();
}

/**
 * A number, or the label of the variable bound to it. Spacing and radius are the
 * fields a design system tokenizes: showing the resolved number would make a
 * patch write it back as a hex-equivalent — a hard value where the file had a
 * token. The label goes out instead, and the write side binds it again.
 */
async function numOrVar(
  bound: any,
  field: string,
  value: number,
  legend: Legend
): Promise<string> {
  const label = await boundVar(bound, field, legend);
  return label ?? num(value);
}

export const PAD_FIELDS = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];

async function padToken(node: any, legend: Legend, bound: any): Promise<string | null> {
  const values = PAD_FIELDS.map((field) => node[field] ?? 0);
  if (values.every((value) => !value) && !bound) return null;
  const parts: string[] = [];
  for (let i = 0; i < PAD_FIELDS.length; i++) {
    parts.push(await numOrVar(bound, PAD_FIELDS[i], values[i], legend));
  }
  const [top, right, bottom, left] = parts;
  // The shorthand is decided on what gets emitted, not on the numbers: two sides
  // holding different variables that resolve to the same value stay apart.
  if (top === right && right === bottom && bottom === left) {
    return top === "0" ? null : `pad:${top}`;
  }
  if (top === bottom && left === right) return `pad:${top},${left}`;
  return `pad:${top},${right},${bottom},${left}`;
}

/** Layout mode + spacing + alignment: cheap enough to live in the surface tree. */
export async function layoutTokens(
  node: SceneNode,
  legend: Legend
): Promise<string[]> {
  const out: string[] = [];
  const target = anyNode(node);
  const mode = target.layoutMode;
  if (!mode || mode === "NONE") return out;

  out.push(mode === "VERTICAL" ? "col" : "row");
  if (target.layoutWrap === "WRAP") out.push("wrap");
  const bound = target.boundVariables;

  if (target.primaryAxisAlignItems === "SPACE_BETWEEN") {
    out.push("gap:auto");
  } else if (target.itemSpacing) {
    const gapVar = await boundVar(bound, "itemSpacing", legend);
    const counter =
      target.layoutWrap === "WRAP" && target.counterAxisSpacing
        ? `/${num(target.counterAxisSpacing)}`
        : "";
    out.push(`gap:${gapVar ?? num(target.itemSpacing)}${counter}`);
  }

  const pad = await padToken(target, legend, bound);
  if (pad) out.push(pad);

  const primary = ALIGN[target.primaryAxisAlignItems] ?? "start";
  const counterAxis = ALIGN[target.counterAxisAlignItems] ?? "start";
  if (primary !== "start" || counterAxis !== "start") {
    out.push(`align:${primary},${counterAxis}`);
  }
  return out;
}

/** How the node sizes itself inside its parent. */
function sizingOf(node: SceneNode): { horizontal: string | null; vertical: string | null } {
  const target = anyNode(node);
  return {
    horizontal: SIZING[target.layoutSizingHorizontal] ?? null,
    vertical: SIZING[target.layoutSizingVertical] ?? null,
  };
}

function sizingTokens(node: SceneNode): string[] {
  const { horizontal, vertical } = sizingOf(node);
  if (!horizontal && !vertical) return [];
  if (horizontal === "fixed" && vertical === "fixed") return [];
  return [`size:${horizontal ?? "-"},${vertical ?? "-"}`];
}

/**
 * The auto-resize a text node gets from its `size:` token. Figma keeps the two
 * in step (hug width ⇔ width_and_height, hug height alone ⇔ height, fixed ⇔
 * none), so `autosize:` only goes out when it says something `size:` does not.
 */
function impliedAutoResize(node: SceneNode): string {
  const { horizontal, vertical } = sizingOf(node);
  if (horizontal === "hug") return "WIDTH_AND_HEIGHT";
  if (vertical === "hug") return "HEIGHT";
  return "NONE";
}

/** A child laid out by an auto-layout parent: its position is the parent's. */
function placedByParent(node: SceneNode): boolean {
  const parent = anyNode(node).parent;
  if (!parent || !parent.layoutMode || parent.layoutMode === "NONE") return false;
  return anyNode(node).layoutPositioning !== "ABSOLUTE";
}

export const CORNER_FIELDS = [
  "topLeftRadius",
  "topRightRadius",
  "bottomRightRadius",
  "bottomLeftRadius",
];

async function radiusToken(node: SceneNode, legend: Legend): Promise<string | null> {
  const target = anyNode(node);
  const corners = CORNER_FIELDS.map((field) => target[field]);
  if (corners.some((value) => typeof value !== "number")) {
    // No per-corner numbers (a star, a polygon): only the uniform radius exists.
    return typeof target.cornerRadius === "number" && target.cornerRadius
      ? `r:${num(target.cornerRadius)}`
      : null;
  }
  const parts: string[] = [];
  const bound = target.boundVariables;
  for (let i = 0; i < CORNER_FIELDS.length; i++) {
    parts.push(await numOrVar(bound, CORNER_FIELDS[i], corners[i], legend));
  }
  if (parts.every((value) => value === parts[0])) {
    return parts[0] === "0" ? null : `r:${parts[0]}`;
  }
  return `r:${parts.join(",")}`;
}

function rotationOf(node: SceneNode): number {
  const target = anyNode(node);
  return typeof target.rotation === "number" ? target.rotation : 0;
}

/** Size, present on the surface line: "1440x900". */
export function sizeToken(node: SceneNode): string | null {
  const target = anyNode(node);
  if (typeof target.width !== "number" || typeof target.height !== "number") {
    return null;
  }
  return `${num(target.width)}x${num(target.height)}`;
}

export async function instanceTokens(
  node: InstanceNode,
  legend: Legend,
  mains?: Mains
): Promise<string[]> {
  const out: string[] = [];
  const main = await mainOf(node, mains);
  if (!main) {
    out.push("ref(?)");
    return out;
  }
  const label = legend.component(main);
  const variantOf =
    main.parent && main.parent.type === "COMPONENT_SET"
      ? main.variantProperties
      : null;
  const variants = variantOf
    ? Object.keys(variantOf)
        .map((key) => `${slug(key)}:${slug(String(variantOf[key]))}`)
        .join(",")
    : "";
  out.push(`ref(${label})${variants ? `{${variants}}` : ""}`);

  const properties = node.componentProperties;
  if (properties) {
    const overrides: string[] = [];
    for (const key of Object.keys(properties)) {
      const property = properties[key];
      if (property.type === "VARIANT") continue;
      const name = slug(key.replace(/#\d+:\d+$/, ""));
      if (property.type === "TEXT") {
        overrides.push(`${name}=${quote(String(property.value))}`);
      } else if (property.type === "BOOLEAN") {
        overrides.push(`${name}=${property.value ? "on" : "off"}`);
      } else if (property.type === "INSTANCE_SWAP") {
        // The swapped-in component's label, the same one the write side takes.
        const target = await swapTarget(String(property.value), mains);
        overrides.push(`${name}=${target ? legend.component(target) : "swap"}`);
      }
    }
    if (overrides.length) out.push(`ov{${overrides.join(", ")}}`);
  }
  return out;
}

/** Line height / letter spacing as the text style section prints them. */
function unitToken(value: LineHeight | LetterSpacing): string | null {
  if (value.unit === "PIXELS") return num(value.value);
  if (value.unit === "PERCENT") return `${num(value.value)}%`;
  return null;
}

async function textTokens(node: TextNode, legend: Legend): Promise<string[]> {
  const out: string[] = [];
  const styleId = node.textStyleId;
  // The bound text style, when the manifest lists it: whatever the node repeats
  // from it is already on the reader's screen and stays out of the line.
  let style: TextStyle | null = null;
  if (typeof styleId === "string" && styleId) {
    const label = await legend.style(styleId);
    if (label) {
      out.push(`font:${label}`);
      const entry = legend.styles.get(styleId);
      if (entry && entry.style.type === "TEXT") style = entry.style as TextStyle;
    }
  }

  if (typeof node.fontName !== "symbol") {
    legend.font(node.fontName);
    if (!out.length) {
      const size = typeof node.fontSize === "number" ? num(node.fontSize) : "mixed";
      out.push(`font:${node.fontName.family} ${node.fontName.style} ${size}`);
    }
  } else {
    out.push("font:mixed");
  }

  if (typeof node.lineHeight !== "symbol") {
    const lineHeight = unitToken(node.lineHeight);
    if (lineHeight && !(style && unitToken(style.lineHeight) === lineHeight)) {
      out.push(`lh:${lineHeight}`);
    }
  }
  if (typeof node.letterSpacing !== "symbol" && node.letterSpacing.value) {
    const spacing = unitToken(node.letterSpacing);
    if (spacing && !(style && unitToken(style.letterSpacing) === spacing)) {
      out.push(`ls:${spacing}`);
    }
  }
  if (
    typeof node.textCase !== "symbol" &&
    node.textCase !== "ORIGINAL" &&
    !(style && style.textCase === node.textCase)
  ) {
    out.push(`case:${node.textCase.toLowerCase()}`);
  }
  if (
    typeof node.textDecoration !== "symbol" &&
    node.textDecoration !== "NONE" &&
    !(style && style.textDecoration === node.textDecoration)
  ) {
    out.push(`deco:${node.textDecoration.toLowerCase()}`);
  }
  if (node.textAlignHorizontal !== "LEFT") {
    out.push(`talign:${node.textAlignHorizontal.toLowerCase()}`);
  }
  if (node.textAlignVertical !== "TOP") {
    out.push(`tvalign:${node.textAlignVertical.toLowerCase()}`);
  }
  if (
    typeof node.paragraphSpacing === "number" &&
    node.paragraphSpacing &&
    !(style && style.paragraphSpacing === node.paragraphSpacing)
  ) {
    out.push(`pspace:${num(node.paragraphSpacing)}`);
  }
  if (node.textTruncation === "ENDING") {
    out.push(`truncate:${node.maxLines ?? 1}`);
  }
  if (node.textAutoResize !== impliedAutoResize(node)) {
    out.push(`autosize:${node.textAutoResize.toLowerCase()}`);
  }
  return out;
}

async function segmentLines(node: TextNode, legend: Legend): Promise<string[]> {
  const mixed =
    typeof node.fontName === "symbol" ||
    typeof node.fontSize === "symbol" ||
    typeof node.fills === "symbol" ||
    typeof node.textStyleId === "symbol";
  if (!mixed) return [];
  const segments = node.getStyledTextSegments([
    "fontName",
    "fontSize",
    "fills",
    "textStyleId",
    "textDecoration",
    "textCase",
    "letterSpacing",
    "lineHeight",
    "hyperlink",
  ]);
  const lines: string[] = [];
  for (const segment of segments) {
    const parts: string[] = [`seg:${segment.start}-${segment.end}`];
    let styled = false;
    if (segment.textStyleId) {
      const label = await legend.style(segment.textStyleId);
      if (label) {
        parts.push(`font:${label}`);
        styled = true;
      }
    }
    // The resolved family only when no style label carries it already.
    if (segment.fontName) legend.font(segment.fontName);
    if (segment.fontName && !styled) {
      parts.push(
        `font:${segment.fontName.family} ${segment.fontName.style} ${num(
          segment.fontSize
        )}`
      );
    }
    const fill = await paintsToken(segment.fills, legend);
    if (fill) parts.push(`fill:${fill}`);
    if (segment.textCase && segment.textCase !== "ORIGINAL") {
      parts.push(`case:${segment.textCase.toLowerCase()}`);
    }
    if (segment.textDecoration && segment.textDecoration !== "NONE") {
      parts.push(`deco:${segment.textDecoration.toLowerCase()}`);
    }
    if (segment.hyperlink) {
      parts.push(
        `link:${
          segment.hyperlink.type === "URL"
            ? quote(segment.hyperlink.value ?? "")
            : "node"
        }`
      );
    }
    parts.push(`text:${quote(segment.characters)}`);
    lines.push(parts.join(" "));
  }
  return lines;
}

function gridTokens(node: SceneNode): string[] {
  const grids = anyNode(node).layoutGrids as readonly LayoutGrid[] | undefined;
  if (!grids || !grids.length) return [];
  const out: string[] = [];
  for (const grid of grids) {
    if (grid.visible === false) continue;
    if (grid.pattern === "GRID") {
      out.push(`grid:square ${num(grid.sectionSize)}`);
      continue;
    }
    const axis = grid.pattern === "COLUMNS" ? "cols" : "rows";
    const count = grid.count === Infinity ? "auto" : String(grid.count);
    const gutter = grid.gutterSize ? ` g:${num(grid.gutterSize)}` : "";
    const margin = grid.offset ? ` m:${num(grid.offset)}` : "";
    out.push(`grid:${axis} ${count}${gutter}${margin}`);
  }
  return out;
}

/** Every variable alias reachable under a boundVariables map. */
function collectAliases(value: unknown, out: Set<string>): void {
  if (!value || typeof value !== "object") return;
  const alias = value as VariableAlias;
  if (alias.type === "VARIABLE_ALIAS" && typeof alias.id === "string") {
    out.add(alias.id);
    return;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    collectAliases((value as Record<string, unknown>)[key], out);
  }
}

const STYLE_FIELDS = [
  "fillStyleId",
  "strokeStyleId",
  "effectStyleId",
  "gridStyleId",
  "textStyleId",
] as const;

/**
 * Register what one node borrows from the shared half of the file: fonts,
 * styles, variables, components. Called on every node of a read before the
 * manifest is built, so the manifest is complete even when the tree comes back
 * as holes — a chunk must never introduce a name the reader has not seen.
 */
export async function collectShared(
  node: SceneNode,
  legend: Legend,
  mains?: Mains
): Promise<void> {
  const target = node as any;

  for (const field of STYLE_FIELDS) {
    const id = target[field];
    if (typeof id === "string" && id) await legend.style(id);
  }

  const aliases = new Set<string>();
  collectAliases(target.boundVariables, aliases);
  for (const id of aliases) await legend.variable(id);

  if (node.type === "TEXT") {
    const text = node as TextNode;
    if (typeof text.fontName !== "symbol") {
      legend.font(text.fontName);
    } else {
      for (const segment of text.getStyledTextSegments(["fontName", "textStyleId"])) {
        legend.font(segment.fontName);
        if (segment.textStyleId) await legend.style(segment.textStyleId);
      }
    }
  }

  if (node.type === "INSTANCE") {
    const main = await mainOf(node as InstanceNode, mains);
    if (main) legend.component(main);
    // Swap targets go in the manifest too: `ov{icon=cmp.x}` must name a known label.
    const properties = (node as InstanceNode).componentProperties || {};
    for (const key of Object.keys(properties)) {
      const property = properties[key];
      if (property.type !== "INSTANCE_SWAP") continue;
      const target = await swapTarget(String(property.value), mains);
      if (target) legend.component(target);
    }
  }
}

/** The surface line: enough to read the structure, nothing that costs. */
export async function surfaceLine(
  node: SceneNode,
  legend: Legend,
  mains?: Mains
): Promise<string> {
  const parts = [`${typeTag(node)}#${node.id}`, quote(node.name)];
  const size = sizeToken(node);
  if (size) parts.push(size);
  if (node.visible === false) parts.push("hidden");
  if (node.type === "INSTANCE") {
    for (const token of await instanceTokens(node as InstanceNode, legend, mains)) {
      parts.push(token);
    }
  } else {
    for (const token of await layoutTokens(node, legend)) parts.push(token);
  }
  return parts.join(" ");
}

export interface Detail {
  /** `TAG#id "name"`. */
  head: string;
  /** One token per entry, in line order: `stroke:2 center c.text.primary` is one. */
  parts: string[];
  line: string;
  extra: string[];
}

/** Everything else about one node, as a single line (text segments excepted). */
export async function detailLine(
  node: SceneNode,
  legend: Legend,
  mains?: Mains
): Promise<Detail> {
  const target = anyNode(node);
  const head = `${typeTag(node)}#${node.id} ${quote(node.name)}`;
  const parts: string[] = [];
  const extra: string[] = [];

  // Position only where it is the node's own: a child placed by an auto-layout
  // parent would read it back as a number Figma recomputes anyway.
  if (typeof target.x === "number" && typeof target.y === "number" && !placedByParent(node)) {
    parts.push(`at:${num(target.x)},${num(target.y)}`);
  }
  const size = sizeToken(node);
  if (size) parts.push(`wh:${size}`);

  const rotation = rotationOf(node);
  if (Math.abs(rotation) > 0.01) parts.push(`rot:${num(rotation)}`);

  if (node.visible === false) parts.push("hidden");
  if (node.locked) parts.push("locked");
  if (target.isMask) {
    parts.push(`mask${target.maskType ? `:${target.maskType.toLowerCase()}` : ""}`);
  }
  if (target.clipsContent === true) parts.push("clip");
  if (typeof target.opacity === "number" && target.opacity < 0.999) {
    parts.push(`op:${num(target.opacity)}`);
  }
  if (target.blendMode && target.blendMode !== "PASS_THROUGH" && target.blendMode !== "NORMAL") {
    parts.push(`blend:${target.blendMode.toLowerCase()}`);
  }

  if (node.type === "INSTANCE") {
    for (const token of await instanceTokens(node as InstanceNode, legend, mains)) {
      parts.push(token);
    }
  } else {
    for (const token of await layoutTokens(node, legend)) parts.push(token);
  }
  for (const token of sizingTokens(node)) parts.push(token);
  if (target.layoutGrow) parts.push(`grow:${num(target.layoutGrow)}`);
  if (target.layoutPositioning === "ABSOLUTE") parts.push("abs");
  if (target.constraints) {
    const horizontal = CONSTRAINT[target.constraints.horizontal] ?? "min";
    const vertical = CONSTRAINT[target.constraints.vertical] ?? "min";
    if (horizontal !== "min" || vertical !== "min") {
      parts.push(`constr:${horizontal},${vertical}`);
    }
  }

  if (node.type === "TEXT") {
    for (const token of await textTokens(node as TextNode, legend)) {
      parts.push(token);
    }
  }

  const fillStyleId = target.fillStyleId;
  if (typeof fillStyleId === "string" && fillStyleId) {
    const label = await legend.style(fillStyleId);
    if (label) parts.push(`fill:${label}`);
  } else if ("fills" in target) {
    const fill = await paintsToken(target.fills, legend);
    if (fill) parts.push(`fill:${fill}`);
  }

  const strokeStyleId = target.strokeStyleId;
  let stroke: string | null = null;
  const strokes = "strokes" in target ? target.strokes : null;
  if (strokes && strokes.length) {
    if (typeof strokeStyleId === "string" && strokeStyleId) {
      stroke = await legend.style(strokeStyleId);
    }
    if (!stroke) stroke = await paintsToken(strokes, legend);
  }
  // Strokes can be present and still paint nothing (every paint hidden); the
  // node keeps its radius and effects either way, so only this block is skipped.
  if (stroke) {
    // One weight, or the four sides (top,right,bottom,left) in its place.
    const weight =
      typeof target.strokeWeight === "number"
        ? num(target.strokeWeight)
        : [
            target.strokeTopWeight,
            target.strokeRightWeight,
            target.strokeBottomWeight,
            target.strokeLeftWeight,
          ]
            .map((value) => num(value ?? 0))
            .join(",");
    const align = (target.strokeAlign ?? "INSIDE").toLowerCase();
    parts.push(`stroke:${weight} ${align} ${stroke}`);
    if (target.dashPattern && target.dashPattern.length) {
      parts.push(`dash:${target.dashPattern.map((v: number) => num(v)).join(",")}`);
    }
  }

  const radius = await radiusToken(node, legend);
  if (radius) parts.push(radius);

  const effectStyleId = target.effectStyleId;
  const effects = target.effects as readonly Effect[] | undefined;
  if (typeof effectStyleId === "string" && effectStyleId) {
    const label = await legend.style(effectStyleId);
    if (label) parts.push(`fx:${label}`);
  } else if (effects && effects.length) {
    const tokens: string[] = [];
    for (const effect of effects) {
      if (effect.visible === false) continue;
      tokens.push(await effectToken(effect, legend));
    }
    if (tokens.length) parts.push(`fx:${tokens.join("+")}`);
  }

  for (const token of gridTokens(node)) parts.push(token);

  if (node.type === "BOOLEAN_OPERATION") {
    parts.push(`bool:${(node as BooleanOperationNode).booleanOperation.toLowerCase()}`);
  }
  if (node.type === "VECTOR") {
    const paths = (node as VectorNode).vectorPaths;
    parts.push(`vec:${paths ? paths.length : 0}paths`);
    const regionFill = await regionFillToken(node as VectorNode, legend);
    if (regionFill) parts.push(`regionfill:${regionFill}`);
  }

  if (node.type === "TEXT") {
    const text = node as TextNode;
    const segments = await segmentLines(text, legend);
    if (segments.length > 1) {
      extra.push(...segments);
    } else {
      parts.push(`text:${quote(text.characters)}`);
    }
  }

  return { head, parts, line: joinDetail(head, parts), extra };
}

export function joinDetail(head: string, parts: string[]): string {
  return parts.length ? `${head} ${parts.join(" ")}` : head;
}

/** Keys never lifted to a `*` line: a node's own place, or repeatable keys. */
const UNSHARED = new Set(["at", "wh", "text", "grid", "g", "m", "font"]);

function partKey(part: string): string {
  const end = part.search(/[:({]/);
  return end < 0 ? part : part.slice(0, end);
}

/**
 * The tokens every one of these lines carries, verbatim: lifted to one `*` line
 * under the parent, each child line then says only what is its own. Order is
 * the first child's. Two children at least, or there is nothing to share.
 */
export function sharedParts(details: Detail[]): string[] {
  if (details.length < 2) return [];
  const [first, ...rest] = details;
  return first.parts.filter(
    (part) =>
      !UNSHARED.has(partKey(part)) && rest.every((other) => other.parts.indexOf(part) >= 0)
  );
}
