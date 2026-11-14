// H.lint: reads the file's main components into the neutral tree of lint-rules.mjs and runs the same rules
// as the pipeline. Mains only: an instance is a leaf, its own depth belongs to its component.

import { kitComponent } from "./kit";
import { kitKey, lint as runRules, summarize, type LintComponent, type LintIssue, type LintLayer } from "./lint-rules.mjs";

const YIELD_MS = 250; // work between two yields, by the clock: a long walk must not freeze Figma, and a yield costs up to 1 s
const ISSUES_MAX = 200; // the reply stays readable; `limit` asks for more
const ICON_MAX = 64; // px: a lone vector above that is a drawing, not an icon

const VECTORS = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON"]);
const visiblePaints = (p: unknown): Paint[] => (Array.isArray(p) ? (p as Paint[]).filter((x) => x.visible !== false) : []);

const visibleEffects = (n: any): boolean => Array.isArray(n.effects) && n.effects.some((e: Effect) => e.visible !== false);
// clipsContent is on by default in Figma: it only does something when a child really passes the frame's box
const cuts = (n: any): boolean => !!n.clipsContent && n.children.some((k: any) => k.x < 0 || k.y < 0 || k.x + k.width > n.width || k.y + k.height > n.height);

let lastYield = Date.now();
const breathe = async (): Promise<void> => {
  if (Date.now() - lastYield < YIELD_MS) return;
  await new Promise((r) => setTimeout(r, 0));
  lastYield = Date.now();
};

// A node of a slot's content can be a ghost whose properties throw: it reads as an unknown shape, never as a failure.
const layerOf = async (n: any, isRoot: boolean): Promise<LintLayer> => {
  await breathe();
  const refs = n.componentPropertyReferences || {};
  const base = { name: n.name as string, abs: n.layoutPositioning === "ABSOLUTE", optional: !isRoot && (n.visible === false || !!refs.visible), boolProp: refs.visible as string | undefined, swapProp: refs.mainComponent as string | undefined };
  if (n.type === "TEXT") return { ...base, kind: "text" };
  if (n.type === "INSTANCE") {
    let main: ComponentNode | null = null;
    try { main = await n.getMainComponentAsync(); } catch { /* a ghost or a deleted main: stays an instance */ }
    return { ...base, kind: main && /^icon\s*\//i.test(main.name) ? "icon" : "instance" };
  }
  if (VECTORS.has(n.type)) return { ...base, kind: n.width <= ICON_MAX && n.height <= ICON_MAX ? "icon" : "shape" };
  const fills = visiblePaints(n.fills);
  const image = fills.some((p) => p.type === "IMAGE");
  if (!("children" in n)) return { ...base, kind: image ? "image" : "shape" };
  const strokes = visiblePaints(n.strokes);
  let kids: LintLayer[] = [];
  try { kids = await Promise.all(n.children.map((k: any) => layerOf(k, false))); } catch { /* slot ghosts */ }
  if (image && !kids.length) return { ...base, kind: "image" };
  // a frame of nothing but vectors, small enough, is one drawn icon: its paths are not layers to name or swap
  if (kids.length && n.children.every((k: any) => VECTORS.has(k.type)) && n.width <= ICON_MAX && n.height <= ICON_MAX && !fills.length && !strokes.length) return { ...base, kind: "icon" };
  return {
    ...base,
    kind: "frame",
    auto: n.layoutMode !== undefined && n.layoutMode !== "NONE",
    // (what the frame does to its content counts: a shadow, an opacity, a clip that really cuts a child)
    painted: fills.length > 0 || strokes.length > 0 || visibleEffects(n) || (n.opacity ?? 1) < 1 || cuts(n),
    padded: !!(n.paddingLeft || n.paddingRight || n.paddingTop || n.paddingBottom),
    slot: n.type === "SLOT",
    kids,
  };
};

const componentOf = async (c: ComponentNode | ComponentSetNode): Promise<LintComponent> => {
  const defs = c.componentPropertyDefinitions;
  const axes: Record<string, string[]> = {};
  const props: { name: string; type: string }[] = [];
  for (const key of Object.keys(defs)) {
    if (defs[key].type === "VARIANT") axes[key] = defs[key].variantOptions || [];
    else props.push({ name: key, type: defs[key].type });
  }
  const mains = c.type === "COMPONENT_SET" ? (c.children as ComponentNode[]) : [c];
  const variants: LintLayer[] = [];
  for (const m of mains) variants.push(await layerOf(m, true));
  const def = kitComponent(kitKey(c.name));
  return { id: c.id, name: c.name, kit: def?.name, level: def?.level, axes, props, variants };
};

// Mains under a node, a list of nodes, or the selection (the whole page when nothing is selected), and the mains
// their instances use: a page built of instances is judged by the components it is made of.
const mainsOf = async (target?: any): Promise<(ComponentNode | ComponentSetNode)[]> => {
  const roots: any[] = target ? (Array.isArray(target) ? target : [target]) : figma.currentPage.selection.length ? [...figma.currentPage.selection] : [figma.currentPage];
  const out = new Map<string, ComponentNode | ComponentSetNode>();
  const add = (n: any) => { if (n.type === "COMPONENT_SET" || (n.type === "COMPONENT" && n.parent?.type !== "COMPONENT_SET")) out.set(n.id, n); };
  for (const r of roots) {
    if (r.type === "COMPONENT" && r.parent?.type === "COMPONENT_SET") { add(r.parent); continue; }
    add(r);
    if (!r.findAllWithCriteria) continue;
    r.findAllWithCriteria({ types: ["COMPONENT_SET", "COMPONENT"] }).forEach(add);
    const uses: any[] = r.findAllWithCriteria({ types: ["INSTANCE"] });
    if (r.type === "INSTANCE") uses.push(r);
    for (const i of uses) {
      await breathe();
      let m: ComponentNode | null = null;
      try { m = await i.getMainComponentAsync(); } catch { /* a ghost or a deleted main */ }
      if (m) add(m.parent?.type === "COMPONENT_SET" ? m.parent : m);
    }
  }
  return Array.from(out.values());
};

export interface LintReply {
  ms: number;
  components: number;
  errors: number;
  warnings: number;
  infos: number;
  byRule: Record<string, number>;
  clean: number;
  issues: LintIssue[];
  truncated?: number;
}

// await H.lint() · H.lint(node | [nodes]) · H.lint(node, { rule: "name-px", limit: 500 })
export const lintNodes = async (target?: any, opts?: { rule?: string; limit?: number }): Promise<LintReply> => {
  const t0 = Date.now();
  const comps: LintComponent[] = [];
  for (const m of await mainsOf(target)) comps.push(await componentOf(m));
  const all = runRules(comps);
  const s = summarize(comps, all);
  const kept = opts?.rule ? all.filter((i) => i.rule === opts.rule) : all;
  const limit = opts?.limit ?? ISSUES_MAX;
  const reply: LintReply = { ms: Date.now() - t0, ...s, issues: kept.slice(0, limit) };
  if (kept.length > limit) reply.truncated = kept.length - limit;
  return reply;
};
