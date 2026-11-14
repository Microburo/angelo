// Walk + chunking.
//
// A read never dumps a whole tree: the surface tree keeps the structure and
// replaces dense subtrees with numbered holes, <chunk n · N nodes>. Chunk
// boundaries are always whole subtrees, packed against a token budget, and the
// walk yields so Figma stays responsive on large frames.

import { Lines, indent, quote } from "./format";
import { Legend } from "./legend";
import {
  Detail,
  Mains,
  childrenOf,
  collectShared,
  detailLine,
  joinDetail,
  sharedParts,
  surfaceLine,
} from "./node";
import { revOf } from "./rev";

const NODE_LIMIT = 20000;
const DEPTH_LIMIT = 40;
const YIELD_MS = 250; // work between two yields, by the clock: a yield costs up to 1 s in Figma, a node count says nothing of the time spent

/** Rough detail cost in characters, per node type. */
const COST: Record<string, number> = {
  FRAME: 130,
  COMPONENT: 130,
  COMPONENT_SET: 110,
  SECTION: 90,
  GROUP: 80,
  INSTANCE: 110,
  TEXT: 150,
  VECTOR: 90,
  BOOLEAN_OPERATION: 90,
};

async function tick(state: Pass): Promise<void> {
  if (Date.now() - state.yieldedAt < YIELD_MS) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
  state.yieldedAt = Date.now();
}

export interface Model {
  node: SceneNode;
  children: Model[];
  nodes: number;
  /** Estimated tokens for the full detail of this subtree. */
  cost: number;
}

/** One read or expand: walk counters plus the per-pass caches. */
interface Pass {
  visited: number;
  yieldedAt: number;
  truncated: boolean;
  /** Filled during the walk so the manifest is complete before the first chunk. */
  legend: Legend;
  mains: Mains;
}

function newPass(legend: Legend): Pass {
  return { visited: 0, yieldedAt: Date.now(), truncated: false, legend, mains: new Map() };
}

function nodeCost(node: SceneNode): number {
  let chars = COST[node.type] ?? 90;
  if (node.type === "TEXT") chars += (node as TextNode).characters.length;
  chars += node.name.length;
  return Math.ceil(chars / 4);
}

async function buildModel(node: SceneNode, depth: number, state: Pass): Promise<Model> {
  state.visited += 1;
  await tick(state);
  await collectShared(node, state.legend, state.mains);
  const model: Model = { node, children: [], nodes: 1, cost: nodeCost(node) };
  if (depth >= DEPTH_LIMIT || state.visited >= NODE_LIMIT) {
    if (childrenOf(node).length) state.truncated = true;
    return model;
  }
  for (const child of childrenOf(node)) {
    const built = await buildModel(child, depth + 1, state);
    model.children.push(built);
    model.nodes += built.nodes;
    model.cost += built.cost;
  }
  return model;
}

export interface Chunk {
  n: number;
  /** Subtree roots this chunk covers. */
  ids: string[];
  names: string[];
  nodes: number;
  parentId: string;
}

export interface Session {
  sid: number;
  legend: Legend;
  chunks: Map<number, Chunk>;
  budget: number;
  /** Fingerprint of every node this read emitted — the write guard rail. */
  revs: Map<string, string>;
  /** The nodes themselves: a loaded page stays loaded, so the proxy outlives the read and saves a getNodeByIdAsync (~0.8 ms each) per op target. `removed` tells a stale one. */
  nodes: Map<string, SceneNode>;
}

function holeLine(chunk: Chunk): string {
  const shown = chunk.names.slice(0, 3).map(quote).join(", ");
  const more = chunk.names.length > 3 ? ", …" : "";
  return `<chunk ${chunk.n} · ${chunk.nodes} nodes · ${shown}${more}>`;
}

async function emitDetail(
  model: Model,
  depth: number,
  out: Lines,
  session: Session,
  state: Pass,
  own?: Detail
): Promise<void> {
  await tick(state);
  const detail = own ?? (await detailLine(model.node, session.legend, state.mains));
  out.push(indent(depth) + detail.line);
  for (const segment of detail.extra) out.push(indent(depth + 1) + "+ " + segment);
  session.revs.set(model.node.id, await revOf(model.node, state.mains));
  session.nodes.set(model.node.id, model.node);

  // What the children all repeat goes out once, on a `*` line ahead of them.
  const details: Detail[] = [];
  for (const child of model.children) {
    details.push(await detailLine(child.node, session.legend, state.mains));
  }
  const shared = sharedParts(details);
  if (shared.length) out.push(indent(depth + 1) + "* " + shared.join(" "));
  for (let i = 0; i < model.children.length; i++) {
    let child = details[i];
    if (shared.length) {
      const parts = child.parts.filter((part) => shared.indexOf(part) < 0);
      child = { ...child, parts, line: joinDetail(child.head, parts) };
    }
    await emitDetail(model.children[i], depth + 1, out, session, state, child);
  }
}

async function emitSurface(
  model: Model,
  depth: number,
  out: Lines,
  session: Session,
  state: Pass
): Promise<void> {
  await tick(state);
  out.push(indent(depth) + (await surfaceLine(model.node, session.legend, state.mains)));
  session.revs.set(model.node.id, await revOf(model.node, state.mains));
  session.nodes.set(model.node.id, model.node);

  const children = model.children;
  if (!children.length) return;

  const register = (run: Model[]): void => {
    if (!run.length) return;
    const n = session.chunks.size + 1;
    const chunk: Chunk = {
      n,
      ids: run.map((item) => item.node.id),
      names: run.map((item) => item.node.name),
      nodes: run.reduce((sum, item) => sum + item.nodes, 0),
      parentId: model.node.id,
    };
    session.chunks.set(n, chunk);
    out.push(indent(depth + 1) + holeLine(chunk));
  };

  const total = children.reduce((sum, child) => sum + child.cost, 0);
  if (total <= session.budget) {
    register(children);
    return;
  }

  let run: Model[] = [];
  let runCost = 0;
  for (const child of children) {
    if (child.cost > session.budget) {
      register(run);
      run = [];
      runCost = 0;
      await emitSurface(child, depth + 1, out, session, state);
      continue;
    }
    if (run.length && runCost + child.cost > session.budget) {
      register(run);
      run = [];
      runCost = 0;
    }
    run.push(child);
    runCost += child.cost;
  }
  register(run);
}

export interface ReadResult {
  tree: string;
  nodeCount: number;
  chunkCount: number;
  truncated: boolean;
  full: boolean;
}

export async function readRoots(
  roots: readonly SceneNode[],
  session: Session
): Promise<ReadResult> {
  const state = newPass(session.legend);
  const models: Model[] = [];
  for (const root of roots) models.push(await buildModel(root, 0, state));

  const totalCost = models.reduce((sum, model) => sum + model.cost, 0);
  const nodeCount = models.reduce((sum, model) => sum + model.nodes, 0);
  const out = new Lines();

  // Small enough to be useful in one shot: send the whole thing, no holes.
  const full = totalCost <= session.budget;
  for (const model of models) {
    if (full) await emitDetail(model, 0, out, session, state);
    else await emitSurface(model, 0, out, session, state);
  }

  return {
    tree: out.toString(),
    nodeCount,
    chunkCount: session.chunks.size,
    truncated: state.truncated,
    full,
  };
}

export async function expandChunk(
  chunk: Chunk,
  session: Session
): Promise<{ text: string; nodeCount: number }> {
  const out = new Lines();
  const state = newPass(session.legend);
  let nodeCount = 0;
  for (const id of chunk.ids) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || !("type" in node)) {
      out.push(`# missing #${id} (node removed since the read)`);
      continue;
    }
    const model = await buildModel(node as SceneNode, 0, state);
    nodeCount += model.nodes;
    await emitDetail(model, 0, out, session, state);
  }
  return { text: out.toString(), nodeCount };
}
