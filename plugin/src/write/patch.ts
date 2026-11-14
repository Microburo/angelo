// Revert patches: what a note's Undo puts back.
//
// Capture is opt-in (`revert: true` on apply / exec / text, set by the bridge when
// the call names a note), so a plain write pays nothing. Before-states are taken
// before the write; at the end only what really changed goes into the patch, so a
// node read but left alone costs nothing on Undo.
//
// Patch shape (newest first per key, the bridge prepends later batches):
//   move  [{id, parentId, index, width, height}]  put back into its old parent
//   swap  [{id, componentId, componentKey}]        old main component of an instance
//   text  [{id, segments}]                         ranges of a text job
//   set   [{id, props}]                            layer fields, x/y/width/height
//   bind  [{id, field, variableId}]                variable bindings (null unbinds)
//   variables [{id, name, description, valuesByMode}]
//   remove [id]                                    nodes the write created

export const SIMPLE_PROPS = [
  "name", "visible", "locked", "opacity", "rotation", "clipsContent",
  "cornerRadius", "topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius",
  "layoutMode", "layoutWrap", "primaryAxisSizingMode", "counterAxisSizingMode",
  "primaryAxisAlignItems", "counterAxisAlignItems", "itemSpacing", "counterAxisSpacing",
  "paddingLeft", "paddingRight", "paddingTop", "paddingBottom",
  "layoutSizingHorizontal", "layoutSizingVertical", "layoutPositioning", "layoutAlign", "layoutGrow",
  "strokeWeight", "strokeAlign", "fills", "strokes", "effects",
  "fontName", "fontSize", "textAlignHorizontal", "textAlignVertical", "textAutoResize", "characters",
  "description", "letterSpacing", "lineHeight", "textCase", "textDecoration",
  "minWidth", "maxWidth", "minHeight", "maxHeight",
];
// Style ids have async setters; '' detaches the style
const STYLE_SETTERS: Record<string, string> = {
  fillStyleId: "setFillStyleIdAsync",
  strokeStyleId: "setStrokeStyleIdAsync",
  textStyleId: "setTextStyleIdAsync",
  effectStyleId: "setEffectStyleIdAsync",
  gridStyleId: "setGridStyleIdAsync",
};
const GEOMETRY = ["x", "y", "width", "height"];

export interface Patch {
  move?: Array<{ id: string; parentId: string; index: number; width?: number; height?: number }>;
  swap?: Array<{ id: string; componentId?: string; componentKey?: string }>;
  text?: Array<{ id: string; segments: any[] }>;
  set?: Array<{ id: string; props: Record<string, unknown> }>;
  bind?: Array<{ id: string; field: string; variableId: string | null }>;
  variables?: Array<{ id: string; name?: string; description?: string; valuesByMode?: Record<string, unknown> }>;
  remove?: string[];
}

export interface PatchResult {
  restored: number;
  removed: number;
  missing: string[];
  errors: string[];
}

// figma.mixed is a symbol: a mixed field is not restorable as one value, skip it
const plain = (value: unknown): unknown =>
  typeof value === "symbol" ? undefined : value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function stateOf(node: any): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const key of SIMPLE_PROPS.concat(GEOMETRY, Object.keys(STYLE_SETTERS))) {
    if (!(key in node)) continue;
    let value: unknown;
    try {
      value = plain(node[key]);
    } catch {
      continue;
    }
    if (value !== undefined) props[key] = value;
  }
  return props;
}

interface Kept {
  node: SceneNode;
  props: Record<string, unknown>;
  parentId: string | null;
  index: number;
  main: Promise<ComponentNode | null> | null;
}

/** Records before-states and created nodes during one write, then emits the patch. */
export class RevertLog {
  private kept = new Map<string, Kept>();
  private made = new Map<string, SceneNode>();

  keep(node: BaseNode | null | undefined): void {
    if (!node || !("type" in node) || node.type === "PAGE" || node.type === "DOCUMENT") return;
    if (this.kept.has(node.id) || this.made.has(node.id)) return;
    const scene = node as SceneNode;
    const parent = scene.parent;
    this.kept.set(scene.id, {
      node: scene,
      props: stateOf(scene),
      parentId: parent ? parent.id : null,
      index: parent && "children" in parent ? (parent as any).children.indexOf(scene) : -1,
      main: scene.type === "INSTANCE" ? scene.getMainComponentAsync().catch(() => null) : null,
    });
  }

  created(node: BaseNode | null | undefined): void {
    if (node && "type" in node && !this.kept.has(node.id)) this.made.set(node.id, node as SceneNode);
  }

  /** Only what differs from the before-state; null when nothing changed. */
  async patch(): Promise<Patch | null> {
    const out: Required<Patch> = { move: [], swap: [], text: [], set: [], bind: [], variables: [], remove: [] };
    for (const [id, k] of Array.from(this.kept)) {
      const node = k.node as any;
      if (node.removed) continue;
      const now = stateOf(node);
      const props: Record<string, unknown> = {};
      for (const key of Object.keys(k.props)) {
        if (JSON.stringify(now[key]) !== JSON.stringify(k.props[key])) props[key] = k.props[key];
      }
      // Layout-driven geometry follows by itself: restoring it would pin a hug/fill size
      // (resize sets FIXED) or fight the auto-layout parent over x/y
      const sizing = (axis: string) => k.props[axis] === now[axis] && k.props[axis] !== "FIXED" && k.props[axis] !== undefined;
      if (sizing("layoutSizingHorizontal")) delete props.width;
      if (sizing("layoutSizingVertical")) delete props.height;
      const flowParent = node.parent && node.parent.layoutMode && node.parent.layoutMode !== "NONE";
      if (flowParent && node.layoutPositioning !== "ABSOLUTE") {
        delete props.x;
        delete props.y;
      }
      const parent = node.parent;
      const index = parent && "children" in parent ? parent.children.indexOf(node) : -1;
      if (k.parentId && (!parent || parent.id !== k.parentId || index !== k.index)) {
        const fixed = !sizing("layoutSizingHorizontal") && !sizing("layoutSizingVertical");
        out.move.push({
          id,
          parentId: k.parentId,
          index: k.index,
          ...(fixed ? { width: k.props.width as number, height: k.props.height as number } : {}),
        });
      }
      if (k.main) {
        const before = await k.main;
        const after = await (node as InstanceNode).getMainComponentAsync().catch(() => null);
        if (before && after && before.id !== after.id) {
          out.swap.push({ id, componentId: before.id, componentKey: before.remote ? before.key : undefined });
        }
      }
      if (Object.keys(props).length) out.set.push({ id, props });
    }
    // Ascending index per parent, so earlier slots are filled before later ones
    out.move.sort((a, b) => a.index - b.index);
    // Children before parents: removing a parent first would leave its children ids missing
    out.remove = Array.from(this.made.values())
      .filter((n) => !n.removed)
      .map((n) => n.id)
      .reverse();
    const empty = Object.values(out).every((list) => !list.length);
    return empty ? null : out;
  }
}

async function componentFrom(ref: { componentId?: string; componentKey?: string }): Promise<ComponentNode | null> {
  if (ref.componentId) {
    const c = await figma.getNodeByIdAsync(ref.componentId);
    if (c && c.type === "COMPONENT") return c;
  }
  if (ref.componentKey) return figma.importComponentByKeyAsync(ref.componentKey);
  return null;
}

export async function loadTextFonts(node: BaseNode): Promise<void> {
  if (node.type !== "TEXT") return;
  if (node.fontName === figma.mixed) {
    for (const s of node.getStyledTextSegments(["fontName"])) await figma.loadFontAsync(s.fontName);
  } else {
    await figma.loadFontAsync(node.fontName as FontName);
  }
}

/** Puts text ranges back as they were (the revert of a text job). */
async function revertText(entries: Patch["text"], result: PatchResult): Promise<void> {
  for (const t of entries || []) {
    const node = await figma.getNodeByIdAsync(t.id);
    if (!node || node.type !== "TEXT") {
      result.missing.push(t.id);
      continue;
    }
    try {
      await loadTextFonts(node);
      for (const s of t.segments || []) {
        const end = Math.min(s.end, node.characters.length);
        if (s.start >= end) continue;
        await figma.loadFontAsync(s.fontName);
        node.setRangeFontName(s.start, end, s.fontName);
        if (s.fontSize) node.setRangeFontSize(s.start, end, s.fontSize);
        if (s.letterSpacing) node.setRangeLetterSpacing(s.start, end, s.letterSpacing);
        if (s.lineHeight) node.setRangeLineHeight(s.start, end, s.lineHeight);
      }
      result.restored++;
    } catch (e: any) {
      result.errors.push(`${t.id} text: ${e.message}`);
    }
  }
}

/** Applies a revert patch as one undo step. */
export async function applyPatch(patch: Patch): Promise<PatchResult> {
  const result: PatchResult = { restored: 0, removed: 0, missing: [], errors: [] };
  if (!patch || typeof patch !== "object") throw new Error("patch: object expected");
  figma.commitUndo();
  // Moves first: a layer goes back into its old parent before the layers that held it are removed
  for (const m of patch.move || []) {
    const node = (await figma.getNodeByIdAsync(m.id)) as any;
    const parent = (await figma.getNodeByIdAsync(m.parentId)) as any;
    if (!node || !parent || !("insertChild" in parent)) {
      result.missing.push(m.id);
      continue;
    }
    try {
      parent.insertChild(typeof m.index === "number" && m.index >= 0 ? Math.min(m.index, parent.children.length) : parent.children.length, node);
      if (m.width && m.height && "resize" in node) node.resize(m.width, m.height);
      result.restored++;
    } catch (e: any) {
      result.errors.push(`${m.id} move: ${e.message}`);
    }
  }
  // Swaps next: an instance gets its old main component back before its properties are restored
  for (const sw of patch.swap || []) {
    const node = await figma.getNodeByIdAsync(sw.id);
    if (!node || node.type !== "INSTANCE") {
      result.missing.push(sw.id);
      continue;
    }
    try {
      const comp = await componentFrom(sw);
      if (!comp) {
        result.missing.push(sw.componentId || sw.componentKey || sw.id);
        continue;
      }
      node.swapComponent(comp);
      result.restored++;
    } catch (e: any) {
      result.errors.push(`${sw.id} swap: ${e.message}`);
    }
  }
  await revertText(patch.text, result);
  for (const entry of patch.set || []) {
    const node = (await figma.getNodeByIdAsync(entry.id)) as any;
    if (!node) {
      result.missing.push(entry.id);
      continue;
    }
    try {
      await loadTextFonts(node);
      const props = entry.props || {};
      if (props.fontName) await figma.loadFontAsync(props.fontName as FontName);
      // Layout mode first, size last: order matters in auto layout
      for (const key of SIMPLE_PROPS) {
        if (!(key in props) || !(key in node)) continue;
        try {
          node[key] = props[key];
        } catch (e: any) {
          result.errors.push(`${entry.id}.${key}: ${e.message}`);
        }
      }
      if (("x" in props || "y" in props) && "x" in node) {
        try {
          if ("x" in props) node.x = props.x;
          if ("y" in props) node.y = props.y;
        } catch (e: any) {
          result.errors.push(`${entry.id}.xy: ${e.message}`);
        }
      }
      if (("width" in props || "height" in props) && "resize" in node) {
        try {
          node.resize("width" in props ? props.width : node.width, "height" in props ? props.height : node.height);
        } catch (e: any) {
          result.errors.push(`${entry.id}.size: ${e.message}`);
        }
      }
      for (const [key, setter] of Object.entries(STYLE_SETTERS)) {
        if (!(key in props) || !(setter in node)) continue;
        try {
          await node[setter](props[key] || "");
        } catch (e: any) {
          result.errors.push(`${entry.id}.${key}: ${e.message}`);
        }
      }
      // Instance properties (variant, boolean, text, swap), as node.componentProperties gives them: { name: value }
      if (props.componentProperties && node.type === "INSTANCE") {
        try {
          node.setProperties(props.componentProperties);
        } catch (e: any) {
          result.errors.push(`${entry.id}.componentProperties: ${e.message}`);
        }
      }
      result.restored++;
    } catch (e: any) {
      result.errors.push(`${entry.id}: ${e.message}`);
    }
  }
  for (const b of patch.bind || []) {
    const node = (await figma.getNodeByIdAsync(b.id)) as any;
    if (!node || !("setBoundVariable" in node)) {
      result.missing.push(b.id);
      continue;
    }
    try {
      const v = b.variableId ? await figma.variables.getVariableByIdAsync(b.variableId) : null;
      node.setBoundVariable(b.field, v);
      result.restored++;
    } catch (e: any) {
      result.errors.push(`${b.id}.${b.field} bind: ${e.message}`);
    }
  }
  for (const v of patch.variables || []) {
    const variable = await figma.variables.getVariableByIdAsync(v.id);
    if (!variable) {
      result.missing.push(v.id);
      continue;
    }
    try {
      if ("name" in v && v.name !== undefined) variable.name = v.name;
      if ("description" in v && v.description !== undefined) variable.description = v.description;
      for (const [modeId, value] of Object.entries(v.valuesByMode || {})) variable.setValueForMode(modeId, value as VariableValue);
      result.restored++;
    } catch (e: any) {
      result.errors.push(`${v.id} variable: ${e.message}`);
    }
  }
  for (const id of patch.remove || []) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) {
      result.missing.push(id);
      continue;
    }
    try {
      node.remove();
      result.removed++;
    } catch (e: any) {
      result.errors.push(`${id}: ${e.message}`);
    }
  }
  figma.commitUndo();
  return result;
}
