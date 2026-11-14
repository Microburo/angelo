// Typed ops.
//
// Not a second write path: the channel is the one local_figma_use already uses,
// the file guard is the same and a batch is one undo step. What the ops add is
// the guard rail — every op is checked against the read it came from, so a node
// the caller never read, or one that moved since, is refused instead of
// silently overwritten. Nothing is written until every op has passed.

import { autoCursor } from "../autocursor";
import { checkProps } from "../angelo/validate";
import { Mains, detailLine, mainOf, typeTag } from "../serialize/node";
import { revOf } from "../serialize/rev";
import { Session } from "../serialize/tree";
import { RevertLog } from "./patch";
import { WRITABLE_KEYS, applyProps } from "./props";

const MAX_OPS = 200;
const MAX_CLONES = 200;
const MAX_TARGETS = 500;
/** Lines of diff an op is worth reading; the rest is counted, not printed. */
const MAX_DIFF = 60;

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
  // Main components seen in pass 1 (nothing is written there, so they hold);
  // the diff after pass 2 looks them up afresh, a `ref` may have swapped one.
  const mains: Mains = new Map();
  // Every node fetched or created on the way: the diff reuses them instead of
  // a getNodeByIdAsync per touched id.
  const fetched = new Map<string, SceneNode>();
  // A note's Undo: before-states and created nodes, only when the bridge asks
  const log = params.revert === true ? new RevertLog() : null;

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
      problems.push({ where, message: `unknown node #${id}` });
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
    throw new Error(`component "${label}" missing from read ${session.sid}`);
  };

  // The candidates of an `each` are what the caller read, filtered — never a
  // query over the file. The fingerprint table is walked in insertion order,
  // which is the order the read emitted the nodes in; each match then goes
  // through the same guard as a single op, so one node that moved since the read
  // refuses the whole batch. The nodes come back fetched: the guard reuses them.
  const matching = async (filter: Record<string, unknown>): Promise<SceneNode[]> => {
    const want = {
      in: filter.in === undefined ? null : String(filter.in),
      type: filter.type === undefined ? null : String(filter.type),
      ref: filter.ref === undefined ? null : String(filter.ref),
      name: filter.name === undefined ? null : String(filter.name),
    };
    const owner = want.ref ? componentOf(want.ref) : null;
    if (want.in && !session.revs.has(want.in)) {
      throw new Error(`#${want.in} never read in read ${session.sid}`);
    }
    const out: SceneNode[] = [];
    for (const id of Array.from(session.revs.keys())) {
      if (id === want.in) continue;
      const cached = session.nodes.get(id);
      const found = cached && !cached.removed ? cached : await figma.getNodeByIdAsync(id);
      if (!found || !("type" in found)) continue;
      const candidate = found as SceneNode;
      if (want.type && typeTag(candidate) !== want.type) continue;
      if (want.name && !globbed(want.name, candidate.name)) continue;
      if (want.in && !inside(candidate, want.in)) continue;
      if (owner) {
        if (candidate.type !== "INSTANCE") continue;
        const main = await mainOf(candidate, mains);
        if (!main) continue;
        const from =
          main.parent && main.parent.type === "COMPONENT_SET" ? main.parent.id : main.id;
        if (from !== owner.id) continue;
      }
      out.push(candidate);
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
          touched.add(id);
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
          plans.push({
            run: async () => {
              await auto.visit(into);
              const made = await make();
              if (index === null) into.appendChild(made);
              else into.insertChild(Math.max(0, Math.min(index, into.children.length)), made);
              if (typeof op.name === "string") made.name = op.name;
              await applyProps(made, values, { legend: session.legend });
              log?.created(made);
              touched.add(made.id);
              fetched.set(made.id, made);
            },
          });
          break;
        }

        case "clone": {
          const id = str(op.id, "id");
          const count = op.count === undefined ? 1 : Number(op.count);
          if (!(count >= 1) || count > MAX_CLONES) {
            throw new Error(`\`count\`: between 1 and ${MAX_CLONES}`);
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
          }
          const index = op.index === undefined ? null : Number(op.index);
          if (index !== null && !Number.isInteger(index)) throw new Error("`index`: integer expected");
          plans.push({
            run: async () => {
              await auto.visit(source);
              for (let n = 0; n < count; n++) {
                const copy = (source as any).clone() as SceneNode;
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
                log?.created(copy);
                touched.add(copy.id);
                fetched.set(copy.id, copy);
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
          if (!matches.length) throw new Error("no node of the read matches `match`");
          if (matches.length > MAX_TARGETS) {
            throw new Error(`${matches.length} nodes targeted — maximum ${MAX_TARGETS} per op`);
          }
          const targets: SceneNode[] = [];
          for (const match of matches) {
            const target = await node(match.id, where, match);
            if (!target) continue;
            targets.push(target);
            touched.add(match.id);
          }
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
    throw new Error(
      `no change applied — ${problems.length} problem(s):\n` +
        problems.map((problem) => `  ${problem.where}: ${problem.message}`).join("\n")
    );
  }

  // ── pass 2: write. One batch is one undo step, like one exec.
  //
  // Pass 1 rules out everything we can see coming; what is left is Figma
  // refusing an edit on the spot (a locked component, a prop the node turns out
  // not to accept). The ops before it stay applied — so say which op broke and
  // that one Cmd+Z takes the whole batch back, rather than pretend it did not
  // happen.
  // The cursor visits each target before its change lands
  const auto = autoCursor(false, plans.reduce((sum, plan) => sum + (plan.weight ?? 1), 0), typeof params.agent === "string" ? params.agent : "main");
  const settle = async () => {
    try {
      await auto.finish();
    } catch {}
  };
  if (log) touched.forEach((id) => log.keep(fetched.get(id)));
  figma.commitUndo();
  let applied = 0;
  try {
    for (const plan of plans) {
      await plan.run();
      applied += 1;
    }
  } catch (error: any) {
    await settle();
    figma.commitUndo();
    throw new Error(
      `ops[${applied}] failed on the Figma side: ${String((error && error.message) || error)}\n` +
        `${applied} op(s) applied before — one Cmd+Z undoes the whole batch.`
    );
  }
  await settle();
  figma.commitUndo();

  // ── the real diff, re-serialized from the file, plus fresh fingerprints so a
  // second batch can build on this one without another read.
  const lines: string[] = [];
  const nodes = Array.from(touched);
  let hidden = 0;
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
    session.revs.set(id, await revOf(target));
    session.nodes.set(id, target);
    if (lines.length >= MAX_DIFF) {
      hidden += 1;
      continue;
    }
    const { line, extra } = await detailLine(target, session.legend);
    lines.push(line);
    for (const segment of extra) lines.push("  + " + segment);
  }
  if (hidden) lines.push(`# ${hidden} more node(s), not detailed`);

  return {
    sid: session.sid,
    applied,
    file: figma.root.name,
    page: figma.currentPage.name,
    angelo: [`# applied ${applied} ops · ${nodes.length} nodes`, ...lines].join("\n"),
    ...(log ? { revert: await log.patch() } : {}),
  };
}
