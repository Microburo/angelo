// Typed ops.
//
// Not a second write path: the channel is the one local_figma_use already uses,
// the file guard is the same and a batch is one undo step. What the ops add is
// the guard rail — every op is checked against the read it came from, so a node
// the caller never read, or one that moved since, is refused instead of
// silently overwritten. Nothing is written until every op has passed.

import { autoCursor } from "../autocursor";
import type { AutoCursor } from "../autocursor";
import { checkProps } from "../angelo/validate";
import { Mains, childrenOf, detailLine, mainOf, typeTag } from "../serialize/node";
import { revOf } from "../serialize/rev";
import { Session } from "../serialize/tree";
import { RevertLog, applyPatch } from "./patch";
import { WRITABLE_KEYS, applyProps, preflight } from "./props";
import type { LayoutSim } from "./props";

const MAX_OPS = 200;
const MAX_CLONES = 200;
// Problems listed in a refusal; the count of the rest follows
const MAX_PROBLEMS = 12;
const MAX_TARGETS = 500;
/** Lines of diff a batch is worth reading; the rest is counted, not printed. */
const MAX_DIFF = 60;
/** Same, in characters (≈ 1.3k tokens on dense lines): a big `each` on long lines stays readable. */
const MAX_DIFF_CHARS = 2400;
/**
 * Layers around the change (children, siblings, ancestors) whose fingerprint is
 * refreshed after the batch, when the batch is what moved them: a write on a
 * child right after a write on its auto-layout parent needs no read in between.
 */
const FOLLOW_MAX = 300;
/** Props that never move or resize a layer, nor anything around it. */
const STILL = new Set(["name", "op", "blend", "locked", "clip", "r", "fill", "stroke", "dash", "constr"]);
const moves = (values: Record<string, string>): boolean => Object.keys(values).some((key) => !STILL.has(key));

const FILTERS = ["in", "type", "ref", "name"];

/** Angelo tag -> what figma.create* makes. */
const CREATE: Record<string, () => SceneNode> = {
  FRAME: () => figma.createFrame(),
  RECT: () => figma.createRectangle(),
  ELL: () => figma.createEllipse(),
  TEXT: () => figma.createText(),
  LINE: () => figma.createLine(),
  STAR: () => figma.createStar(),
  POLY: () => figma.createPolygon(),
};

interface Problem {
  where: string;
  message: string;
}

interface Plan {
  /** Runs in order once every op has been checked. */
  run: () => Promise<void>;
  /** Nodes it touches (cursor: precise or bulk animation), 1 by default */
  weight?: number;
}

function object(raw: unknown, field: string): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`\`${field}\`: object {key: "value"} expected`);
  }
  return raw as Record<string, string>;
}

function props(raw: unknown): Record<string, string> {
  return object(raw, "props");
}

function str(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`\`${field}\` missing`);
  return value;
}

/** `Label*`, `*icon*`, or an exact name. */
function globbed(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, (char) =>
    char === "*" ? "\u0000" : "\\" + char
  );
  return new RegExp("^" + escaped.replace(/\u0000/g, ".*") + "$").test(value);
}

function inside(node: BaseNode, ancestor: string): boolean {
  let current: BaseNode | null = node.parent;
  while (current) {
    if (current.id === ancestor) return true;
    current = current.parent;
  }
  return false;
}

export async function applyOps(
  params: Record<string, unknown>,
  session: Session | null
): Promise<unknown> {
  if (typeof params.file === "string" && params.file !== figma.root.name) {
    throw new Error(
      `plugin connected to "${figma.root.name}", expected "${params.file}" — relaunch the plugin in the right file`
    );
  }
  if (!session) {
    throw new Error("no read in progress — run angelo_read first");
  }
  if (params.sid !== undefined && Number(params.sid) !== session.sid) {
    throw new Error(
      `read ${params.sid} replaced by read ${session.sid} — run angelo_read again`
    );
  }
  const ops = params.ops;
  if (!Array.isArray(ops) || !ops.length) throw new Error("`ops`: non-empty list expected");
  if (ops.length > MAX_OPS) throw new Error(`${ops.length} ops — maximum ${MAX_OPS} per batch`);
  // The manifest lists only what the read references: a local variable or
  // style label it did not show is still writable, registered on demand.
  const labels = JSON.stringify(ops).match(/\b[cnsbpteg]\.[a-z0-9][a-z0-9.\-_]*/g) ?? [];
  if (labels.some((label) => !session.legend.hasLabel(label))) {
    await session.legend.registerLocals();
  }

  const problems: Problem[] = [];
  const plans: Plan[] = [];
  const touched = new Set<string>();
  // Touched nodes whose write may move the layers around them (not a recolor, a rename…)
  const movers = new Set<string>();
  // Main components seen in pass 1 (nothing is written there, so they hold);
  // the diff after pass 2 looks them up afresh, a `ref` may have swapped one.
  const mains: Mains = new Map();
  // Every node fetched or created on the way: the diff reuses them instead of
  // a getNodeByIdAsync per touched id.
  const fetched = new Map<string, SceneNode>();
  // Before-states and created nodes: they roll a batch back when Figma refuses an
  // op halfway, and make a note's Undo when the bridge asks for the patch
  const log = new RevertLog();
  const wantRevert = params.revert === true;
  // The cursor is created once pass 1 has counted its plans; the plans' closures
  // call it later, so it is declared here, before them
  let auto: Pick<AutoCursor, "visit" | "finish"> = { visit: async () => {}, finish: async () => {} };

  // `row` / `col` written earlier in the batch, for the checks of later ops
  const sim: LayoutSim = new Map();

  // ── pass 1: resolve and check. No write happens in this pass.
  const node = async (
    id: string,
    where: string,
    known?: SceneNode
  ): Promise<SceneNode | null> => {
    // The fingerprint table is consulted before the file: an id that is not in
    // it is refused on the spot, and we never pay for a lookup of it —
    // getNodeByIdAsync on a stray id can mean loading the whole document.
    const seen = session.revs.get(id);
    if (!seen) {
      problems.push({
        where,
        message: `#${id} never read in read ${session.sid} — run angelo_read or angelo_expand`,
      });
      return null;
    }
    const cached = session.nodes.get(id);
    const found = known ?? (cached && !cached.removed ? cached : await figma.getNodeByIdAsync(id));
    if (!found || !("type" in found) || found.type === "PAGE" || found.type === "DOCUMENT") {
      problems.push({
        where,
        message: `unknown node #${id} — removed since read ${session.sid}, run angelo_read again`,
      });
      return null;
    }
    const target = found as SceneNode;
    if (seen !== (await revOf(target, mains))) {
      problems.push({
        where,
        message: `#${id} changed since read ${session.sid} — run angelo_read again, the op overwrites nothing`,
      });
      return null;
    }
    fetched.set(id, target);
    return target;
  };

  /** The component (or set) a cmp.* label of this read names. */
  const componentOf = (label: string): ComponentNode | ComponentSetNode => {
    for (const candidate of session.legend.components.values()) {
      if (candidate.label === label) return candidate.owner;
    }
    throw new Error(
      `component "${label}" is not in read ${session.sid} (only the components its scope uses are known) — use a bare cmp.* label of the read manifest (variants go in props.ref), or read a scope that uses it`,
    );
  };

  // Nodes of closed chunks registered by `matching`: they count as read only if
  // the batch lands, so a refused or rolled-back one takes them back.
  const registered: string[] = [];
  const unregister = (): void => {
    for (const id of registered) {
      session.revs.delete(id);
      session.nodes.delete(id);
    }
    registered.length = 0;
  };

  // Matches an `each` found inside chunks the caller never expanded, for the reply.
  const unexpanded = { nodes: 0, chunks: 0 };

  // The candidates of an `each` are the read's scope, filtered — never a query
  // over the whole file. First what the caller saw, in the order the read
  // emitted it; then the subtrees of chunks it left closed, which belong to the
  // same read: a match there is fingerprinted on the spot (it counts as read
  // from now on) and printed in the diff like any other. Each match then goes
  // through the same guard as a single op, so one node that moved since the
  // read refuses the whole batch. The nodes come back fetched: the guard reuses them.
  const matching = async (filter: Record<string, unknown>): Promise<SceneNode[]> => {
    const want = {
      in: filter.in === undefined ? null : String(filter.in),
      type: filter.type === undefined ? null : String(filter.type),
      ref: filter.ref === undefined ? null : String(filter.ref),
      name: filter.name === undefined ? null : String(filter.name),
    };
    const owner = want.ref ? componentOf(want.ref) : null;
    if (want.in && !session.revs.has(want.in)) {
      throw new Error(
        `#${want.in} never read in read ${session.sid} — run angelo_read or angelo_expand`,
      );
    }
    // Synchronous filters first: most candidates fall here, without an await each
    const quick = (candidate: SceneNode): boolean => {
      if (want.type && typeTag(candidate) !== want.type) return false;
      if (want.name && !globbed(want.name, candidate.name)) return false;
      if (want.in && !inside(candidate, want.in)) return false;
      if (owner && candidate.type !== "INSTANCE") return false;
      return true;
    };
    // Only `ref` needs the main component, an async lookup
    const fromOwner = async (candidate: SceneNode): Promise<boolean> => {
      if (!owner) return true;
      const main = await mainOf(candidate as InstanceNode, mains);
      if (!main) return false;
      const from = main.parent && main.parent.type === "COMPONENT_SET" ? main.parent.id : main.id;
      return from === owner.id;
    };
    const out: SceneNode[] = [];
    const seen = new Set<string>();
    for (const id of Array.from(session.revs.keys())) {
      seen.add(id);
      if (id === want.in) continue;
      const cached = session.nodes.get(id);
      const found = cached && !cached.removed ? cached : await figma.getNodeByIdAsync(id);
      if (!found || !("type" in found)) continue;
      const candidate = found as SceneNode;
      if (!quick(candidate)) continue;
      if (owner && !(await fromOwner(candidate))) continue;
      out.push(candidate);
    }

    // Closed chunks: same depth as an expand (childrenOf stops at instances).
    let yieldedAt = Date.now();
    for (const chunk of Array.from(session.chunks.values())) {
      if (chunk.ids.every((id) => session.revs.has(id))) continue; // expanded
      if (want.in && chunk.parentId !== want.in) {
        const parent = session.nodes.get(chunk.parentId);
        if (!parent || parent.removed || (parent.id !== want.in && !inside(parent, want.in))) continue;
      }
      let found = 0;
      const stack: SceneNode[] = [];
      for (const id of chunk.ids.slice().reverse()) {
        const root = await figma.getNodeByIdAsync(id); // ids the read itself listed
        if (root && "type" in root && root.type !== "PAGE" && root.type !== "DOCUMENT") {
          stack.push(root as SceneNode);
        }
      }
      while (stack.length) {
        const candidate = stack.pop() as SceneNode;
        if (Date.now() - yieldedAt > 250) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          yieldedAt = Date.now();
        }
        const kids = childrenOf(candidate);
        for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
        if (seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        if (!quick(candidate) || !(await fromOwner(candidate))) continue;
        session.revs.set(candidate.id, await revOf(candidate, mains));
        session.nodes.set(candidate.id, candidate);
        registered.push(candidate.id);
        out.push(candidate);
        found += 1;
      }
      if (found) {
        unexpanded.nodes += found;
        unexpanded.chunks += 1;
      }
    }
    return out;
  };

  const container = (parent: SceneNode, where: string): any | null => {
    if (!("appendChild" in parent)) {
      problems.push({ where, message: `#${parent.id} (${parent.type}) cannot contain children` });
      return null;
    }
    if (parent.type === "INSTANCE") {
      problems.push({ where, message: `#${parent.id}: the children of an instance cannot be modified` });
      return null;
    }
    return parent as any;
  };

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i] as Record<string, unknown>;
    const where = `ops[${i}]`;
    try {
      switch (op.op) {
        case "set": {
          const id = str(op.id, "id");
          const values = props(op.props);
          if (!Object.keys(values).length) throw new Error("empty `props`");
          problems.push(...checkProps(values, where, WRITABLE_KEYS));
          const target = await node(id, where);
          if (!target) break;
          for (const message of await preflight(target, values, { legend: session.legend }, sim)) {
            problems.push({ where, message });
          }
          touched.add(id);
          if (moves(values)) movers.add(id);
          plans.push({
            run: async () => {
              await auto.visit(target);
              await applyProps(target, values, { legend: session.legend });
            },
          });
          break;
        }

        case "insert": {
          const parentId = str(op.parent, "parent");
          const tag = str(op.type, "type");
          const values = props(op.props);
          problems.push(...checkProps(values, where, WRITABLE_KEYS));
          const parent = await node(parentId, where);
          if (!parent) break;
          const into = container(parent, where);
          if (!into) break;
          const index = op.index === undefined ? null : Number(op.index);
          // Checked here: insertChild(NaN) would only throw in pass 2, after earlier ops ran
          if (index !== null && !Number.isInteger(index)) throw new Error("`index`: integer expected");

          let make: () => Promise<SceneNode>;
          if (tag === "INST") {
            const label = str(op.ref, "ref");
            const owner = componentOf(label);
            make = async () => {
              const component =
                owner.type === "COMPONENT_SET" ? owner.defaultVariant : owner;
              if (!component) throw new Error(`"${label}" has no default variant`);
              return component.createInstance();
            };
          } else {
            const create = CREATE[tag];
            if (!create) {
              throw new Error(
                `type "${tag}" cannot be created (FRAME, RECT, ELL, TEXT, LINE, STAR, POLY, INST)`
              );
            }
            make = async () => create();
          }

          touched.add(parentId);
          movers.add(parentId);
          plans.push({
            run: async () => {
              await auto.visit(into);
              const made = await make();
              log.created(made);
              if (index === null) into.appendChild(made);
              else into.insertChild(Math.max(0, Math.min(index, into.children.length)), made);
              if (typeof op.name === "string") made.name = op.name;
              await applyProps(made, values, { legend: session.legend });
              touched.add(made.id);
              fetched.set(made.id, made);
            },
          });
          break;
        }

        case "clone": {
          const id = str(op.id, "id");
          const count = op.count === undefined ? 1 : Number(op.count);
          if (!Number.isInteger(count) || count < 1 || count > MAX_CLONES) {
            throw new Error(`\`count\`: integer between 1 and ${MAX_CLONES}`);
          }
          const values = props(op.props);
          problems.push(...checkProps(values, where, WRITABLE_KEYS));
          const source = await node(id, where);
          if (!source) break;
          if (typeof (source as any).clone !== "function") {
            throw new Error(`#${id} (${source.type}) cannot be cloned`);
          }
          let into: any = null;
          if (op.parent !== undefined) {
            const parent = await node(str(op.parent, "parent"), where);
            if (!parent) break;
            into = container(parent, where);
            if (!into) break;
            touched.add(parent.id);
            movers.add(parent.id);
          }
          const index = op.index === undefined ? null : Number(op.index);
          if (index !== null && !Number.isInteger(index)) throw new Error("`index`: integer expected");
          // The copies change the children of the source's parent. When that parent was read and is
          // still as read, its fingerprint follows the batch (as an insert parent does); a parent
          // already changed by someone else stays refused.
          let host: SceneNode | null = null;
          const around: any = into ? null : source.parent;
          if (around && around.type !== "PAGE" && around.type !== "DOCUMENT") {
            const seen = session.revs.get(around.id);
            if (seen && seen === (await revOf(around as SceneNode, mains))) host = around as SceneNode;
          }
          if (host) movers.add(host.id);
          // Same parent: the copy sits where the source does, so the source answers
          // for it. Under another parent the layout context differs: left to pass 2.
          if (!into) {
            const messages = await preflight(source, values, { legend: session.legend }, new Map(sim));
            for (const message of messages) problems.push({ where, message });
          }
          plans.push({
            run: async () => {
              await auto.visit(source);
              for (let n = 0; n < count; n++) {
                const copy = (source as any).clone() as SceneNode;
                log.created(copy);
                const parent = into ?? source.parent;
                if (index === null) parent.appendChild(copy);
                else {
                  parent.insertChild(
                    Math.max(0, Math.min(index + n, parent.children.length)),
                    copy
                  );
                }
                // Free placement (page or frame without auto-layout): a copy lands
                // beside the source instead of on top of it, unless `at` says where.
                const free = !("layoutMode" in parent) || parent.layoutMode === "NONE";
                if (free && values.at === undefined) {
                  copy.x = source.x + (source.width + 40) * (n + 1);
                  copy.y = source.y;
                }
                await applyProps(copy, values, { legend: session.legend });
                touched.add(copy.id);
                fetched.set(copy.id, copy);
              }
              if (host) {
                touched.add(host.id);
                fetched.set(host.id, host);
              }
            },
          });
          break;
        }

        case "reorder": {
          const parentId = str(op.parent, "parent");
          const order = op.order;
          if (!Array.isArray(order) || !order.length) {
            throw new Error("`order`: list of ids expected");
          }
          const parent = await node(parentId, where);
          if (!parent) break;
          const into = container(parent, where);
          if (!into) break;
          const children = new Map<string, SceneNode>(
            into.children.map((child: SceneNode) => [child.id, child])
          );
          const wanted = order.map((value) => String(value));
          if (wanted.length !== children.size || wanted.some((id) => !children.has(id))) {
            throw new Error(
              `\`order\` must list the ${children.size} children of #${parentId}, once each`
            );
          }
          touched.add(parentId);
          movers.add(parentId);
          children.forEach((child, id) => {
            touched.add(id);
            fetched.set(id, child);
          });
          plans.push({
            run: async () => {
              await auto.visit(into);
              for (let index = 0; index < wanted.length; index++) {
                into.insertChild(index, children.get(wanted[index]));
              }
            },
          });
          break;
        }

        case "each": {
          const filter = object(op.match, "match") as Record<string, unknown>;
          const keys = Object.keys(filter);
          if (!keys.length) {
            throw new Error(
              "empty `match` — give at least one filter (in, type, ref, name): an op does not touch the whole read by default"
            );
          }
          const stray = keys.filter((key) => FILTERS.indexOf(key) < 0);
          if (stray.length) {
            throw new Error(`\`match\`: unknown filter "${stray.join(", ")}" (${FILTERS.join(", ")})`);
          }
          const values = props(op.props);
          if (!Object.keys(values).length) throw new Error("empty `props`");
          problems.push(...checkProps(values, where, WRITABLE_KEYS));

          const matches = await matching(filter);
          if (!matches.length) {
            throw new Error(
              "no node of the read matches `match` — check the filter against the read (type as printed: TEXT, FRAME, INST…; name takes * as wildcard)"
            );
          }
          if (matches.length > MAX_TARGETS) {
            throw new Error(`${matches.length} nodes targeted — maximum ${MAX_TARGETS} per op`);
          }
          const targets: SceneNode[] = [];
          for (const match of matches) {
            const target = await node(match.id, where, match);
            if (!target) continue;
            targets.push(target);
            touched.add(match.id);
            if (moves(values)) movers.add(match.id);
          }
          // One line per distinct refusal, with the first node it hits: 500 targets
          // refused for the same reason are one problem, not 500
          const refused = new Map<string, { id: string; count: number }>();
          for (const target of targets) {
            for (const message of await preflight(target, values, { legend: session.legend }, sim)) {
              const key = message.split(`#${target.id}`).join("#…");
              const entry = refused.get(key);
              if (entry) entry.count += 1;
              else refused.set(key, { id: target.id, count: 1 });
            }
          }
          refused.forEach((entry, message) => {
            problems.push({
              where,
              message: `${message.split("#…").join(`#${entry.id}`)} (${entry.count} of ${targets.length} matched nodes, first #${entry.id})`,
            });
          });
          plans.push({
            weight: targets.length,
            run: async () => {
              for (const target of targets) {
                await auto.visit(target);
                await applyProps(target, values, { legend: session.legend });
              }
            },
          });
          break;
        }

        default:
          throw new Error(
            `unknown op "${String(op.op)}" (set, insert, clone, reorder, each)`
          );
      }
    } catch (error: any) {
      problems.push({ where, message: String((error && error.message) || error) });
    }
  }

  if (problems.length) {
    unregister();
    const shown = problems.slice(0, MAX_PROBLEMS);
    throw new Error(
      `no change applied — ${problems.length} problem(s):\n` +
        shown.map((problem) => `  ${problem.where}: ${problem.message}`).join("\n") +
        (problems.length > shown.length ? `\n  … ${problems.length - shown.length} more, same batch` : "")
    );
  }

  // ── pass 2: write. One batch is one undo step, like one exec.
  //
  // Pass 1 rules out everything we can see coming; what is left is Figma
  // refusing an edit on the spot (a locked component, a prop the node turns out
  // not to accept). Then the ops before it are rolled back in the same undo
  // step: a batch lands whole or not at all.
  // The cursor visits each target before its change lands
  // `quiet`: no cursor (harnesses and benches; Figma throttles its timers in the background)
  if (params.quiet !== true) {
    auto = autoCursor(false, plans.reduce((sum, plan) => sum + (plan.weight ?? 1), 0), typeof params.agent === "string" ? params.agent : "main");
  }
  const settle = async () => {
    try {
      await auto.finish();
    } catch {}
  };

  // Fingerprints before the write: a node that comes out the same was already as asked
  const before = new Map<string, string>();
  touched.forEach((id) => {
    const rev = session.revs.get(id);
    if (rev) before.set(id, rev);
  });

  // Layers the batch may move without writing them: still as read now, so a
  // change after pass 2 is the batch's own doing, and their fingerprint follows.
  const followers = new Map<string, SceneNode>();
  const unfollowed = new Set<string>();
  const follow = async (candidate: BaseNode | null): Promise<void> => {
    if (!candidate || !("type" in candidate) || candidate.type === "PAGE" || candidate.type === "DOCUMENT") return;
    if (touched.has(candidate.id) || followers.has(candidate.id) || unfollowed.has(candidate.id)) return;
    const seen = session.revs.get(candidate.id);
    if (!seen) return;
    if (followers.size >= FOLLOW_MAX) {
      unfollowed.add(candidate.id);
      return;
    }
    if (seen === (await revOf(candidate as SceneNode, mains))) followers.set(candidate.id, candidate as SceneNode);
  };
  // Each parent once: siblings and ancestors are shared by the movers under it
  const parents = new Set<string>();
  for (const id of Array.from(movers)) {
    const target = fetched.get(id);
    if (!target || target.removed) continue;
    for (const kid of childrenOf(target)) await follow(kid);
    const up = target.parent;
    if (!up || parents.has(up.id)) continue;
    parents.add(up.id);
    if ("children" in up && up.type !== "PAGE" && up.type !== "DOCUMENT") {
      for (const sibling of (up as any).children as SceneNode[]) await follow(sibling);
    }
    let ancestor: BaseNode | null = up;
    while (ancestor && session.revs.has(ancestor.id)) {
      await follow(ancestor);
      ancestor = ancestor.parent;
    }
  }

  touched.forEach((id) => log.keep(fetched.get(id)));
  figma.commitUndo();
  let applied = 0;
  try {
    for (const plan of plans) {
      await plan.run();
      applied += 1;
    }
  } catch (error: any) {
    await settle();
    unregister();
    let back = "rolled back: nothing changed";
    try {
      const patch = await log.patch();
      const result = patch ? await applyPatch(patch, true) : null;
      if (result && (result.errors.length || result.missing.length)) {
        back = `rollback incomplete (${result.errors.concat(result.missing.map((id) => `#${id} missing`)).slice(0, 3).join("; ")}) — one Cmd+Z undoes the whole batch`;
      }
    } catch (failure: any) {
      back = `rollback failed (${String((failure && failure.message) || failure)}) — one Cmd+Z undoes the whole batch`;
    }
    figma.commitUndo();
    throw new Error(
      `ops[${applied}] failed on the Figma side: ${String((error && error.message) || error)}\n${back}`
    );
  }
  await settle();
  figma.commitUndo();

  // ── the real diff, re-serialized from the file, plus fresh fingerprints so a
  // second batch can build on this one without another read.
  const lines: string[] = [];
  const nodes = Array.from(touched);
  let hidden = 0;
  let chars = 0;
  let unchanged = 0;
  const same: string[] = [];
  for (const id of nodes) {
    const known = fetched.get(id);
    const found = known && !known.removed ? known : await figma.getNodeByIdAsync(id);
    if (!found || !("type" in found)) {
      lines.push(`# gone #${id}`);
      continue;
    }
    const target = found as SceneNode;
    // Fingerprints are refreshed for every node written, printed or not: a node
    // left with a stale one would be refused by the next batch.
    const rev = await revOf(target);
    session.revs.set(id, rev);
    session.nodes.set(id, target);
    if (before.get(id) === rev) {
      unchanged += 1;
      if (same.length < 3) same.push(`#${id}`);
      continue;
    }
    if (lines.length >= MAX_DIFF || chars >= MAX_DIFF_CHARS) {
      hidden += 1;
      continue;
    }
    const { line, extra } = await detailLine(target, session.legend);
    lines.push(line);
    chars += line.length;
    for (const segment of extra) {
      lines.push("  + " + segment);
      chars += segment.length + 4;
    }
  }
  if (hidden) lines.push(`# ${hidden} more node(s), not detailed`);
  for (const follower of Array.from(followers.values())) {
    if (follower.removed) continue;
    session.revs.set(follower.id, await revOf(follower));
    session.nodes.set(follower.id, follower);
  }

  const changed = nodes.length - unchanged;
  const which = same.join(", ") + (unchanged > same.length ? " …" : "");
  const head =
    `# applied ${applied} ops · ${changed} nodes` +
    (unchanged
      ? changed
        ? ` · ${unchanged} unchanged, already as asked (${which})`
        : ` · no change: ${which} already as asked`
      : "");

  return {
    sid: session.sid,
    applied,
    file: figma.root.name,
    page: figma.currentPage.name,
    angelo: [
      head,
      ...(unexpanded.nodes
        ? [`# each: ${unexpanded.nodes} of them inside ${unexpanded.chunks} chunk(s) not expanded`]
        : []),
      ...(unfollowed.size
        ? [`# ${unfollowed.size} layer(s) around the change not re-fingerprinted — angelo_read before writing on them`]
        : []),
      ...lines,
    ].join("\n"),
    ...(wantRevert ? { revert: await log.patch() } : {}),
  };
}
