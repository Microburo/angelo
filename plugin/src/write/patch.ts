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

// Fonts go through the per-run cache: with Figma in the background a chain of loadFontAsync
// calls stalls from the 7th on (about 9 s each), a text job over 8 layers then hits the 30 s timeout
import { loadFont } from "../fonts";
import { nodeOrNull } from "../lookup";

export const SIMPLE_PROPS = [
  "name", "visible", "locked", "opacity", "blendMode", "rotation", "clipsContent", "constraints",
  "cornerRadius", "topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius",
  "layoutMode", "layoutWrap", "primaryAxisSizingMode", "counterAxisSizingMode",
  "primaryAxisAlignItems", "counterAxisAlignItems", "itemSpacing", "counterAxisSpacing",
  "paddingLeft", "paddingRight", "paddingTop", "paddingBottom",
  "layoutSizingHorizontal", "layoutSizingVertical", "layoutPositioning", "layoutAlign", "layoutGrow",
  "strokeWeight", "strokeTopWeight", "strokeRightWeight", "strokeBottomWeight", "strokeLeftWeight",
  "strokeAlign", "dashPattern", "fills", "strokes", "effects",
  "fontName", "fontSize", "textAlignHorizontal", "textAlignVertical", "textAutoResize", "characters",
  "description", "letterSpacing", "lineHeight", "textCase", "textDecoration",
  "paragraphSpacing", "textTruncation", "maxLines",
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

/** Scalar variable bindings, `{ field: variableId }`. Paint bindings travel inside `fills` / `strokes`. */
function bindingsOf(node: any): Record<string, string> {
  const out: Record<string, string> = {};
  let bound: Record<string, any> | undefined;
  try {
    bound = node.boundVariables;
  } catch {
    return out;
  }
  for (const [field, alias] of Object.entries(bound || {})) {
    if (alias && !Array.isArray(alias) && typeof alias.id === "string") out[field] = alias.id;
  }
  return out;
}

/** Instance props other than variants (those come back with the swap), `{ name: value }`. */
function instancePropsOf(node: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (node.type !== "INSTANCE") return out;
  try {
    for (const [name, prop] of Object.entries(node.componentProperties as Record<string, any>)) {
      if (prop.type !== "VARIANT") out[name] = prop.value;
    }
  } catch {
    // unreadable instance: nothing to restore
  }
  return out;
}

interface Kept {
  node: SceneNode;
  props: Record<string, unknown>;
  bound: Record<string, string>;
  instanceProps: Record<string, unknown>;
  parentId: string | null;
  index: number;
  main: Promise<ComponentNode | null> | null;
  // Free-positioned children of a frame without auto-layout: turning auto-layout on moves them
  // all, and turning it back off leaves them where the flow put them
  kids: Array<{ node: SceneNode; x: number; y: number; width: number; height: number }> | null;
}

function freeKidsOf(node: any): Kept["kids"] {
  try {
    if (node.type === "INSTANCE" || node.layoutMode !== "NONE" || !Array.isArray(node.children)) return null;
    return node.children.map((c: SceneNode) => ({ node: c, x: c.x, y: c.y, width: c.width, height: c.height }));
  } catch {
    return null;
  }
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
      bound: bindingsOf(scene),
      instanceProps: instancePropsOf(scene),
      parentId: parent ? parent.id : null,
      index: parent && "children" in parent ? (parent as any).children.indexOf(scene) : -1,
      main: scene.type === "INSTANCE" ? scene.getMainComponentAsync().catch(() => null) : null,
      kids: freeKidsOf(scene),
    });
  }

  // Layers kept by keepTree across the whole write, and the roots whose layers were not all kept
  private deep = 0;
  readonly partial: string[] = [];

  /**
   * A node and its layers, for a script that may reach them through `.children`: up to `max`
   * layers per write in all. A root left partly kept is listed in `partial`.
   */
  keepTree(node: BaseNode | null | undefined, max: number): void {
    this.keep(node);
    if (!node || !("children" in node) || node.type === "PAGE" || node.type === "DOCUMENT") return;
    const stack: SceneNode[] = (node as any).children.slice().reverse();
    while (stack.length) {
      if (this.deep >= max) {
        if (this.partial.indexOf(node.id) < 0) this.partial.push(node.id);
        return;
      }
      const layer = stack.pop() as SceneNode;
      if (!this.kept.has(layer.id)) {
        this.keep(layer);
        this.deep += 1;
      }
      const kids = (layer as any).children;
      if (Array.isArray(kids)) for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
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
      // Instance props the write changed (text, boolean, swap slot)
      const propsNow = instancePropsOf(node);
      const instanceProps: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(k.instanceProps)) {
        if (name in propsNow && propsNow[name] !== value) instanceProps[name] = value;
      }
      if (Object.keys(instanceProps).length) props.componentProperties = instanceProps;
      if (Object.keys(props).length) out.set.push({ id, props });
      // Auto-layout turned on by the write: once `layoutMode` is back to NONE (entry above),
      // the children go back to where they were
      if (k.kids && node.layoutMode && node.layoutMode !== "NONE") {
        for (const kid of k.kids) {
          if (kid.node.removed || kid.node.parent !== node) continue;
          const at: Record<string, unknown> = { x: kid.x, y: kid.y };
          if (kid.node.width !== kid.width || kid.node.height !== kid.height) {
            at.width = kid.width;
            at.height = kid.height;
          }
          out.set.push({ id: kid.node.id, props: at });
        }
      }
      // Bindings the write dropped or replaced: `set` puts the value back, `bind` the variable
      const boundNow = bindingsOf(node);
      for (const field of new Set(Object.keys(k.bound).concat(Object.keys(boundNow)))) {
        if (k.bound[field] !== boundNow[field]) out.bind.push({ id, field, variableId: k.bound[field] || null });
      }
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
    const c = await nodeOrNull(ref.componentId);
    if (c && c.type === "COMPONENT") return c;
  }
  if (ref.componentKey) return figma.importComponentByKeyAsync(ref.componentKey);
  return null;
}

export async function loadTextFonts(node: BaseNode): Promise<void> {
  if (node.type !== "TEXT") return;
  if (node.fontName === figma.mixed) {
    for (const s of node.getStyledTextSegments(["fontName"])) await loadFont(s.fontName);
  } else {
    await loadFont(node.fontName as FontName);
  }
}

/** Puts text ranges back as they were (the revert of a text job). */
async function revertText(entries: Patch["text"], result: PatchResult): Promise<void> {
  for (const t of entries || []) {
    const node = await nodeOrNull(t.id);
    if (!node || node.type !== "TEXT") {
      result.missing.push(t.id);
      continue;
    }
    try {
      await loadTextFonts(node);
      for (const s of t.segments || []) {
        const end = Math.min(s.end, node.characters.length);
        if (s.start >= end) continue;
        await loadFont(s.fontName);
        node.setRangeFontName(s.start, end, s.fontName);
        if (s.fontSize) node.setRangeFontSize(s.start, end, s.fontSize);
        if (s.letterSpacing) node.setRangeLetterSpacing(s.start, end, s.letterSpacing);
        if (s.lineHeight) node.setRangeLineHeight(s.start, end, s.lineHeight);
        if (s.textStyleId) await node.setRangeTextStyleIdAsync(s.start, end, s.textStyleId);
      }
      result.restored++;
    } catch (e: any) {
      result.errors.push(`${t.id} text: ${e.message}`);
    }
  }
}

/** Applies a revert patch as one undo step. */
/** `sameStep`: the revert joins the undo step in progress (a batch rolling itself back). */
export async function applyPatch(patch: Patch, sameStep = false): Promise<PatchResult> {
  const result: PatchResult = { restored: 0, removed: 0, missing: [], errors: [] };
  if (!patch || typeof patch !== "object") throw new Error("patch: object expected");
  if (!sameStep) figma.commitUndo();
  // Moves first: a layer goes back into its old parent before the layers that held it are removed
  for (const m of patch.move || []) {
    const node = (await nodeOrNull(m.id)) as any;
    const parent = (await nodeOrNull(m.parentId)) as any;
    if (!node || !parent || !("insertChild" in parent)) {
      result.missing.push(m.id);
      continue;
    }
    try {
      let index = typeof m.index === "number" && m.index >= 0 ? Math.min(m.index, parent.children.length) : parent.children.length;
      // Within the same parent Figma counts the index before taking the node out:
      // moving a layer towards the end needs one slot more, or it stays where it is
      const current = parent.children.indexOf(node);
      if (current >= 0 && current < index) index += 1;
      parent.insertChild(Math.min(index, parent.children.length), node);
      if (m.width && m.height && "resize" in node) node.resize(m.width, m.height);
      result.restored++;
    } catch (e: any) {
      result.errors.push(`${m.id} move: ${e.message}`);
    }
  }
  // Swaps next: an instance gets its old main component back before its properties are restored
  for (const sw of patch.swap || []) {
    const node = await nodeOrNull(sw.id);
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
    const node = (await nodeOrNull(entry.id)) as any;
    if (!node) {
      result.missing.push(entry.id);
      continue;
    }
    try {
      await loadTextFonts(node);
      const props = entry.props || {};
      if (props.fontName) await loadFont(props.fontName as FontName);
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
    const node = (await nodeOrNull(b.id)) as any;
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
    const node = await nodeOrNull(id);
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
  if (!sameStep) figma.commitUndo();
  return result;
}
