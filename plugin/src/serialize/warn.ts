// Declared vs rendered: what the tree says is not always what Figma paints.
// Each check flags a gap the reader would otherwise find by blind probing, and
// hands back the fix op. Flagged nodes are registered in the session, so the
// fix is one angelo_apply without another read.
//
// Checks on the read's own nodes (instance interiors excluded):
//   invisible  — opacity 0, or a cumulative opacity under 10 %
//   clipped    — an auto-layout child cut by its clipping parent
//   font       — a text whose font is not installed (rendered with a fallback)
//   raw hex    — an unbound solid equal to a local colour token
// Checks reaching into components (instances are opaque):
//   regionfill — vector regions painting over the node's bound fill

import { hex, num } from "./format";
import { Legend } from "./legend";
import { Mains, mainOf, paintsToken, regionFillToken } from "./node";
import { revOf } from "./rev";
import type { Session } from "./tree";

const MAX_COMPONENTS = 300;
const MAX_VECTORS = 3000;
const MAX_NODES = 5000;
const FAINT = 0.1;
const OVERFLOW = 1; // px tolerance before a clipped child counts as cut
const MAX_CANDIDATES = 3;

type Host = SceneNode & ChildrenMixin;

function hasChildren(node: BaseNode): node is Host {
  return "findAllWithCriteria" in node;
}

/** Vectors owned by `root`, not the copies inside its nested instances. */
function ownVectors(root: BaseNode): VectorNode[] {
  if (root.type === "VECTOR") return [root as VectorNode];
  if (!hasChildren(root)) return [];
  return root
    .findAllWithCriteria({ types: ["VECTOR"] })
    .filter((node) => node.id.indexOf(";") < 0) as VectorNode[];
}

function labelOf(node: BaseNode, legend: Legend): string {
  let cursor: BaseNode | null = node;
  while (cursor && cursor.type !== "PAGE") {
    if (cursor.type === "COMPONENT") return legend.component(cursor as ComponentNode);
    cursor = cursor.parent;
  }
  return "-";
}

const TAG: Record<string, string> = {
  FRAME: "FRAME",
  GROUP: "GROUP",
  COMPONENT: "CMP",
  COMPONENT_SET: "SET",
  INSTANCE: "INST",
  TEXT: "TEXT",
  RECTANGLE: "RECT",
  ELLIPSE: "ELL",
  VECTOR: "VEC",
  LINE: "LINE",
  STAR: "STAR",
  POLYGON: "POLY",
  BOOLEAN_OPERATION: "BOOL",
  SECTION: "SECTION",
};

function tag(node: SceneNode): string {
  return `${TAG[node.type] ?? node.type}#${node.id}`;
}

/** Product of the opacities above `node`, up to the page. */
function inheritedOpacity(node: BaseNode): number {
  let product = 1;
  let cursor = node.parent;
  while (cursor && cursor.type !== "PAGE" && cursor.type !== "DOCUMENT") {
    if ("opacity" in cursor) product *= (cursor as SceneNode & BlendMixin).opacity;
    cursor = cursor.parent;
  }
  return product;
}

/** Local colour tokens by resolved default-mode hex, aliases (semantic) first. */
async function colourTokens(): Promise<Map<string, Variable[]>> {
  const byHex = new Map<string, Variable[]>();
  let locals: Variable[] = [];
  let collections: VariableCollection[] = [];
  try {
    [locals, collections] = await Promise.all([
      figma.variables.getLocalVariablesAsync("COLOR"),
      figma.variables.getLocalVariableCollectionsAsync(),
    ]);
  } catch {
    return byHex;
  }
  const defaults = new Map<string, string>();
  for (const collection of collections) defaults.set(collection.id, collection.defaultModeId);
  const byId = new Map<string, Variable>();
  for (const variable of locals) byId.set(variable.id, variable);

  const resolve = (variable: Variable): { color: RGBA | null; alias: boolean } => {
    let current: Variable | undefined = variable;
    let alias = false;
    for (let hop = 0; current && hop < 10; hop++) {
      const mode = defaults.get(current.variableCollectionId);
      const raw: VariableValue | undefined = mode ? current.valuesByMode[mode] : undefined;
      if (raw && typeof raw === "object" && "type" in raw) {
        alias = true;
        current = byId.get((raw as VariableAlias).id);
        continue;
      }
      if (raw && typeof raw === "object" && "r" in raw) return { color: raw as RGBA, alias };
      return { color: null, alias };
    }
    return { color: null, alias };
  };

  const aliased = new Set<string>();
  for (const variable of locals) {
    const { color, alias } = resolve(variable);
    if (!color) continue;
    if (alias) aliased.add(variable.id);
    const key = hex(color);
    const bucket = byHex.get(key);
    if (bucket) bucket.push(variable);
    else byHex.set(key, [variable]);
  }
  for (const bucket of byHex.values()) {
    bucket.sort(
      (a, b) =>
        Number(aliased.has(b.id)) - Number(aliased.has(a.id)) || a.name.localeCompare(b.name)
    );
  }
  return byHex;
}

/** The single unbound visible solid of a paint list, or null. */
function rawSolid(paints: readonly Paint[] | typeof figma.mixed): SolidPaint | null {
  if (!Array.isArray(paints)) return null;
  const visible = (paints as Paint[]).filter((paint) => paint.visible !== false);
  if (visible.length !== 1 || visible[0].type !== "SOLID") return null;
  const solid = visible[0] as SolidPaint;
  if ((solid as any).boundVariables?.color) return null;
  return solid;
}

async function ownNodeChecks(
  roots: readonly SceneNode[],
  session: Session,
  track: (node: SceneNode) => Promise<void>
): Promise<string[]> {
  const legend = session.legend;
  const lines: string[] = [];
  let tokens: Map<string, Variable[]> | null = null;
  // Role words rank the tokens: a text wants c.text.*, a stroke c.border.*.
  const candidates = async (paint: SolidPaint, role: RegExp): Promise<string[]> => {
    if (!tokens) tokens = await colourTokens();
    const found = (tokens.get(hex(paint.color, paint.opacity)) ?? []).slice();
    found.sort((a, b) => Number(role.test(b.name)) - Number(role.test(a.name)));
    return found.slice(0, MAX_CANDIDATES).map((variable) => legend.addVariable(variable));
  };

  // Raw colours repeat: one line per colour and fix, listing the nodes.
  const raw = new Map<string, { head: string; fix: string; ids: string[] }>();
  const rawHit = (node: SceneNode, head: string, fix: string): void => {
    const key = `${head}|${fix}`;
    const entry = raw.get(key);
    if (entry) entry.ids.push(tag(node));
    else raw.set(key, { head, fix, ids: [tag(node)] });
  };

  let visited = 0;
  const stack: Array<{ node: SceneNode; opacity: number; root: boolean }> = roots.map(
    (root) => ({ node: root, opacity: inheritedOpacity(root), root: true })
  );
  while (stack.length) {
    const { node, opacity, root } = stack.pop()!;
    if (++visited > MAX_NODES) {
      lines.push(`! scan stopped (${MAX_NODES} nodes)`);
      break;
    }
    if (node.removed || !node.visible) continue;

    const own = "opacity" in node ? (node as BlendMixin & SceneNode).opacity : 1;
    const total = opacity * own;
    if (own === 0) {
      lines.push(`! ${tag(node)} op:0 renders nothing → op:1`);
      await track(node);
      continue;
    }
    if (total < FAINT && opacity >= FAINT) {
      lines.push(`! ${tag(node)} op:${num(own)} cumulative ${num(total)} → op:1`);
      await track(node);
      continue;
    }

    if (node.type === "TEXT" && (node as TextNode).hasMissingFont) {
      const font = (node as TextNode).fontName;
      const name = font === figma.mixed ? "mixed" : `${font.family} ${font.style}`;
      lines.push(`! ${tag(node)} font "${name}" missing, rendered with a fallback → font:<installed>`);
      await track(node);
    }

    const parent = node.parent as (SceneNode & Partial<FrameNode>) | null;
    if (
      !root &&
      parent &&
      parent.clipsContent === true &&
      parent.layoutMode &&
      parent.layoutMode !== "NONE" &&
      (node as any).layoutPositioning !== "ABSOLUTE"
    ) {
      const box = node.absoluteBoundingBox;
      const frame = parent.absoluteBoundingBox;
      if (box && frame) {
        const dx = Math.max(frame.x - box.x, box.x + box.width - (frame.x + frame.width));
        const dy = Math.max(frame.y - box.y, box.y + box.height - (frame.y + frame.height));
        if (dx > OVERFLOW || dy > OVERFLOW) {
          const axis = dx > OVERFLOW && dy > OVERFLOW ? "x,y" : dx > OVERFLOW ? "x" : "y";
          lines.push(
            `! ${tag(node)} cut by ${tag(parent)} clip (${axis} +${num(Math.round(Math.max(dx, dy)))}) → #${parent.id} clip:off, or resize`
          );
          await track(node);
          await track(parent);
        }
      }
    }

    if ("fills" in node) {
      const solid = rawSolid((node as GeometryMixin & SceneNode).fills);
      if (solid && !(node as any).fillStyleId) {
        const labels = await candidates(solid, node.type === "TEXT" ? /text|fg|foreground/i : /bg|background|surface|fill/i);
        if (labels.length) {
          rawHit(node, `fill:${hex(solid.color, solid.opacity)}`, `fill:${labels.join(" | ")}`);
          await track(node);
        }
      }
      const stroke = rawSolid((node as GeometryMixin & SceneNode).strokes);
      const weight = (node as any).strokeWeight;
      if (stroke && !(node as any).strokeStyleId && typeof weight === "number" && weight > 0) {
        const labels = await candidates(stroke, /border|stroke|outline|divider/i);
        if (labels.length) {
          const align = String((node as any).strokeAlign ?? "INSIDE").toLowerCase();
          rawHit(
            node,
            `stroke ${hex(stroke.color, stroke.opacity)}`,
            `stroke:${num(weight)} ${align} ${labels.join(" | ")}`
          );
          await track(node);
        }
      }
    }

    if (node.type === "INSTANCE" || !("children" in node)) continue;
    for (const child of (node as ChildrenMixin).children) {
      stack.push({ node: child as SceneNode, opacity: total, root: false });
    }
  }
  for (const { head, fix, ids } of raw.values()) {
    lines.push(
      ids.length === 1
        ? `! ${ids[0]} ${head} raw = token → ${fix}`
        : `! ${head} raw on ${ids.length} nodes = token → ${fix} · ${ids.join(" ")}`
    );
  }
  return lines;
}

async function regionFillChecks(
  roots: readonly SceneNode[],
  session: Session,
  mains: Mains,
  track: (node: SceneNode) => Promise<void>
): Promise<string[]> {
  const legend = session.legend;
  const lines: string[] = [];
  const queue: BaseNode[] = [...roots];
  const queued = new Set<string>(roots.map((root) => root.id));
  for (const entry of legend.components.values()) {
    if (queued.has(entry.owner.id)) continue;
    queued.add(entry.owner.id);
    queue.push(entry.owner);
  }

  let vectors = 0;
  let components = 0;
  for (let i = 0; i < queue.length; i++) {
    const host = queue[i];
    if (host.removed) continue;
    if (host.type === "COMPONENT" || host.type === "COMPONENT_SET") {
      if (++components > MAX_COMPONENTS) break;
    }

    for (const vector of ownVectors(host)) {
      if (++vectors > MAX_VECTORS) break;
      const masked = await regionFillToken(vector, legend);
      if (!masked) continue;
      const own = (await paintsToken(vector.fills, legend)) ?? "none";
      // Region bound to a token, node raw: the render is right, the declared
      // fill lies — rebinding the node repaints the regions with the token.
      // Region raw: it hides the node's fill — the regions inherit the node.
      const fix = masked.startsWith("#") || masked === "mixed" ? "regionfill:inherit" : `fill:${masked}`;
      lines.push(
        `! ${labelOf(vector, legend)} VEC#${vector.id} regionfill:${masked} vs fill:${own} → ${fix}`
      );
      await track(vector);
    }
    if (vectors > MAX_VECTORS) break;

    // One level of nesting per host: an icon fixed inside a card is scanned
    // through the card's instance, without a swap property to reach it.
    if (!hasChildren(host)) continue;
    for (const nested of host.findAllWithCriteria({ types: ["INSTANCE"] })) {
      const main = await mainOf(nested as InstanceNode, mains);
      if (!main || queued.has(main.id)) continue;
      queued.add(main.id);
      queue.push(main);
    }
  }
  if (vectors > MAX_VECTORS || components > MAX_COMPONENTS) {
    lines.push(`! scan stopped (${MAX_COMPONENTS} components / ${MAX_VECTORS} vectors)`);
  }
  return lines;
}

export async function warnSection(
  roots: readonly SceneNode[],
  session: Session,
  mains: Mains
): Promise<string[]> {
  const track = async (node: SceneNode): Promise<void> => {
    if (session.revs.has(node.id)) return;
    session.revs.set(node.id, await revOf(node, mains));
    session.nodes.set(node.id, node);
  };
  const own = await ownNodeChecks(roots, session, track);
  const regions = await regionFillChecks(roots, session, mains, track);
  return [...own, ...regions];
}
