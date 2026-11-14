// The manifest: the shared half of a read, never chunked — variables (all
// modes, alias targets included), styles, components and fonts the scope
// references. fullManifest lists every local variable and style instead.

import { ANGELO_VERSION, hex, num, quote, slug } from "./format";
import { Legend } from "./legend";

const MAX_VARIABLES = 600;
const MAX_STYLES = 300;

export function valueToken(
  value: VariableValue,
  resolvedType: string,
  aliasLabel: (id: string) => string | null
): string {
  if (value && typeof value === "object" && "type" in value) {
    const alias = value as VariableAlias;
    const label = aliasLabel(alias.id);
    return `->${label ?? alias.id}`;
  }
  if (resolvedType === "COLOR" && value && typeof value === "object") {
    return hex(value as RGBA);
  }
  if (typeof value === "number") return num(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return quote(value);
  return String(value);
}

async function variableSection(legend: Legend, full: boolean): Promise<string[]> {
  const lines: string[] = [];

  let locals: Variable[] = [];
  let collections: VariableCollection[] = [];
  try {
    [locals, collections] = await Promise.all([
      figma.variables.getLocalVariablesAsync(),
      figma.variables.getLocalVariableCollectionsAsync(),
    ]);
  } catch {
    locals = [];
    collections = [];
  }

  const byId = new Map<string, Variable>();
  for (const variable of locals) byId.set(variable.id, variable);

  // Full: every local variable. Focused (default): what the read references,
  // closed over aliases so every value line resolves to a listed label.
  if (full) await legend.registerLocals(MAX_VARIABLES, MAX_STYLES);
  // Paint styles print their bound variable: it must be listed too.
  for (const entry of legend.styles.values()) {
    if (entry.style.type !== "PAINT") continue;
    for (const paint of (entry.style as PaintStyle).paints) {
      const alias = (paint as any).boundVariables?.color;
      if (alias && typeof alias.id === "string") await legend.variable(alias.id);
    }
  }
  const pending = Array.from(legend.vars.values()).map((entry) => entry.variable);
  while (pending.length) {
    const variable = pending.pop()!;
    for (const raw of Object.values(variable.valuesByMode)) {
      if (!raw || typeof raw !== "object" || !("type" in raw)) continue;
      const id = (raw as VariableAlias).id;
      if (legend.vars.has(id)) continue;
      const target = byId.get(id);
      if (target) legend.addVariable(target);
      else await legend.variable(id);
      const entry = legend.vars.get(id);
      if (entry) pending.push(entry.variable);
    }
  }
  for (const entry of legend.vars.values()) byId.set(entry.id, entry.variable);

  const aliasLabel = (id: string): string | null => {
    const entry = legend.vars.get(id);
    if (entry) return entry.label;
    const variable = byId.get(id);
    return variable ? legend.addVariable(variable) : null;
  };

  const collectionById = new Map<string, VariableCollection>();
  for (const collection of collections) collectionById.set(collection.id, collection);

  const groups = new Map<string, Variable[]>();
  for (const entry of legend.vars.values()) {
    const variable = entry.variable;
    const key = variable.variableCollectionId;
    const bucket = groups.get(key);
    if (bucket) bucket.push(variable);
    else groups.set(key, [variable]);
  }

  for (const [collectionId, variables] of groups) {
    let collection = collectionById.get(collectionId) ?? null;
    if (!collection) {
      try {
        collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
      } catch {
        collection = null;
      }
    }
    const modes = collection ? collection.modes : [];
    const defaultModeId = collection ? collection.defaultModeId : null;
    const header = collection
      ? `@ ${slug(collection.name)}${
          modes.length > 1
            ? ` modes[${modes.map((mode) => slug(mode.name)).join("|")}]`
            : ""
        }${collection.remote ? " lib" : ""}`
      : "@ ?";
    lines.push(header);

    variables.sort((a, b) => a.name.localeCompare(b.name));
    for (const variable of variables) {
      const label = legend.vars.get(variable.id)!.label;
      const values: string[] = [];
      const modeList = modes.length
        ? modes
        : Object.keys(variable.valuesByMode).map((modeId) => ({
            modeId,
            name: modeId,
          }));
      for (const mode of modeList) {
        const raw = variable.valuesByMode[mode.modeId];
        if (raw === undefined) continue;
        const token = valueToken(raw, variable.resolvedType, aliasLabel);
        values.push(
          mode.modeId === defaultModeId || modeList.length === 1
            ? token
            : `${slug(mode.name)}:${token}`
        );
      }
      lines.push(`${label} = ${values.join(" | ")}`);
    }
  }

  let listedLocals = 0;
  for (const variable of locals) if (legend.vars.has(variable.id)) listedLocals++;
  if (locals.length > listedLocals) {
    lines.push(
      `# +${locals.length - listedLocals} local variables not listed${
        full ? "" : ' (manifest:"full"; any local label is writable)'
      }`
    );
  }
  return lines;
}

async function paintStyleToken(style: PaintStyle, legend: Legend): Promise<string> {
  const tokens: string[] = [];
  for (const paint of style.paints) {
    if (paint.type === "SOLID") {
      const alias = (paint as any).boundVariables?.color;
      if (alias && typeof alias.id === "string") {
        const label = await legend.variable(alias.id);
        if (label) {
          tokens.push(label);
          continue;
        }
      }
      tokens.push(hex(paint.color, paint.opacity));
    } else {
      tokens.push(paint.type.toLowerCase().replace("gradient_", "grad."));
    }
  }
  return tokens.join("+");
}

function textStyleToken(style: TextStyle): string {
  const parts = [`${style.fontName.family} ${style.fontName.style}`, num(style.fontSize)];
  if (style.lineHeight.unit === "PIXELS") parts.push(`/${num(style.lineHeight.value)}`);
  else if (style.lineHeight.unit === "PERCENT") parts.push(`/${num(style.lineHeight.value)}%`);
  if (style.letterSpacing.value) {
    parts.push(
      `ls:${num(style.letterSpacing.value)}${
        style.letterSpacing.unit === "PERCENT" ? "%" : ""
      }`
    );
  }
  if (style.textCase !== "ORIGINAL") parts.push(`case:${style.textCase.toLowerCase()}`);
  if (style.textDecoration !== "NONE") parts.push(`deco:${style.textDecoration.toLowerCase()}`);
  if (style.paragraphSpacing) parts.push(`pspace:${num(style.paragraphSpacing)}`);
  return parts.join(" ").replace(/ \//g, "/");
}

function effectStyleToken(style: EffectStyle): string {
  return style.effects
    .map((effect) => {
      if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
        const kind = effect.type === "DROP_SHADOW" ? "drop" : "inner";
        return `${kind}(${num(effect.offset.x)},${num(effect.offset.y)},${num(
          effect.radius
        )},${hex(effect.color)})`;
      }
      if (effect.type === "LAYER_BLUR") return `blur(${num(effect.radius)})`;
      if (effect.type === "BACKGROUND_BLUR") return `bgblur(${num(effect.radius)})`;
      return effect.type.toLowerCase();
    })
    .join("+");
}

function gridStyleToken(style: GridStyle): string {
  return style.layoutGrids
    .map((grid) => {
      if (grid.pattern === "GRID") return `square ${num(grid.sectionSize)}`;
      const axis = grid.pattern === "COLUMNS" ? "cols" : "rows";
      const count = grid.count === Infinity ? "auto" : String(grid.count);
      return `${axis} ${count} g:${num(grid.gutterSize ?? 0)} m:${num(grid.offset ?? 0)}`;
    })
    .join(" + ");
}

async function styleSection(legend: Legend, full: boolean): Promise<string[]> {
  const lines: string[] = [];
  if (full) await legend.registerLocals(MAX_VARIABLES, MAX_STYLES);
  let unlisted = 0;
  try {
    const [paints, texts, effects, grids] = await Promise.all([
      figma.getLocalPaintStylesAsync(),
      figma.getLocalTextStylesAsync(),
      figma.getLocalEffectStylesAsync(),
      figma.getLocalGridStylesAsync(),
    ]);
    for (const style of [...texts, ...paints, ...effects, ...grids]) {
      if (!legend.styles.has(style.id)) unlisted++;
    }
  } catch {
    // local styles unavailable (e.g. restricted file): referenced ones still show
  }

  const entries = Array.from(legend.styles.values());
  entries.sort((a, b) => a.label.localeCompare(b.label));
  for (const entry of entries) {
    const style = entry.style;
    let token = "";
    if (style.type === "PAINT") token = await paintStyleToken(style as PaintStyle, legend);
    else if (style.type === "TEXT") token = textStyleToken(style as TextStyle);
    else if (style.type === "EFFECT") token = effectStyleToken(style as EffectStyle);
    else if (style.type === "GRID") token = gridStyleToken(style as GridStyle);
    lines.push(`${entry.label} = ${token}${entry.remote ? " lib" : ""}`);
  }
  if (unlisted) {
    lines.push(
      `# +${unlisted} local styles not listed${full ? "" : ' (manifest:"full"; any local label is writable)'}`
    );
  }
  return lines;
}

function componentSection(legend: Legend): string[] {
  const lines: string[] = [];
  const entries = Array.from(legend.components.values());
  entries.sort((a, b) => a.label.localeCompare(b.label));
  for (const entry of entries) {
    const parts = [`${entry.label} = ${quote(entry.name)}`];
    const owner = entry.owner;
    if (owner.type === "COMPONENT_SET") {
      const groups = (owner as ComponentSetNode).variantGroupProperties;
      const variants = Object.keys(groups)
        .map((key) => `${slug(key)}: ${groups[key].values.map((v) => slug(v)).join("|")}`)
        .join(" · ");
      if (variants) parts.push(`variants[${variants}]`);
    }
    let definitions: ComponentPropertyDefinitions | null = null;
    try {
      definitions = (owner as any).componentPropertyDefinitions ?? null;
    } catch {
      definitions = null;
    }
    if (definitions) {
      const props = Object.keys(definitions)
        .filter((key) => definitions![key].type !== "VARIANT")
        .map((key) => {
          const definition = definitions![key];
          const name = slug(key.replace(/#\d+:\d+$/, ""));
          // Same shape as an instance's ov{}: the default value says the type
          // (quoted = text, on/off = boolean), a swap slot is named as such.
          if (definition.type === "TEXT") {
            return `${name}=${quote(String(definition.defaultValue))}`;
          }
          if (definition.type === "BOOLEAN") {
            return `${name}=${definition.defaultValue ? "on" : "off"}`;
          }
          return `${name}:${definition.type === "INSTANCE_SWAP" ? "swap" : definition.type}`;
        })
        .join(", ");
      if (props) parts.push(`props[${props}]`);
    }
    if (entry.remote) parts.push("lib");
    lines.push(parts.join(" "));
  }
  return lines;
}

export interface ManifestOptions {
  scopeLabel: string;
  pageName: string;
  nodeCount: number;
  chunkCount: number;
  /** true when the tree carries full detail and has no holes. */
  full: boolean;
  truncated: boolean;
  /** List every local variable and style, not only the referenced ones. */
  fullManifest?: boolean;
}

export async function buildManifest(
  legend: Legend,
  options: ManifestOptions
): Promise<string> {
  const sections: string[] = [];

  const variables = await variableSection(legend, options.fullManifest === true);
  if (variables.length) sections.push(["# vars", ...variables].join("\n"));

  const styles = await styleSection(legend, options.fullManifest === true);
  if (styles.length) sections.push(["# styles", ...styles].join("\n"));

  const components = componentSection(legend);
  if (components.length) sections.push(["# cmp", ...components].join("\n"));

  if (legend.fonts.size) {
    sections.push(["# fonts", Array.from(legend.fonts).sort().join(", ")].join("\n"));
  }

  const header = [
    ANGELO_VERSION,
    "units:px",
    `file:${quote(figma.root.name)}`,
    `page:${quote(options.pageName)}`,
    `scope:${options.scopeLabel}`,
    `nodes:${options.nodeCount}`,
    options.full ? "detail:full" : `chunks:${options.chunkCount}`,
    options.truncated ? "truncated" : "",
  ]
    .filter((part) => part !== "")
    .join(" ");

  return [header, ...sections].join("\n\n");
}
