// Automatic agent cursor: any write (exec or apply) shows the cursor and the
// gradient ring on the nodes it touches, without code in the script.
// - created lazily on the first change: a read-only job shows nothing
// - apply knows its targets: visit(node) glides there before the change lands
// - exec listens to nodechange; reflow-only changes (a hug parent resizing, a fill
//   child following) are ignored unless nothing else changed
// - a script that calls H.cursor() takes over: the auto cursor steps aside
// Changes are delivered when the script yields, in batches ~100 ms later; a fully
// synchronous script only shows the closing pass.

import { Cursor, makeCursor, pause } from "./cursor";

// Few nodes → precise (glide + dwell on each) · beyond PRECISE_MAX → bulk (quick hops, ring follows)
const PRECISE_MAX = 12;
const STEP_MS = 160; // precise: glide per node
const HOP_MS = 40; // bulk: glide per node
const DWELL_MS = 70; // stays on each node so the ring is seen around it
const QUEUE_MAX = 10; // pending nodes kept (latest win)
const DRAIN_MS = 2000; // closing pass budget, well under the 30 s exec timeout
const VISIT_MS = 3000; // apply: past this, the ring jumps from node to node
const REST_MS = 225; // stays on the last node before leaving
const SETTLE_MS = 150; // nodechange events come in batches ~100 ms after the write

// Properties that change as a consequence of layout, not of the script's intent
const REFLOW = new Set(["x", "y", "width", "height", "relativeTransform", "minWidth", "maxWidth", "minHeight", "maxHeight"]);

export interface AutoCursor {
  // apply: shows the node about to change (cursor glides there, ring around it)
  visit: (n: SceneNode) => Promise<void>;
  // Script drives its own cursor: remove ours and stop listening
  yieldTo: () => void;
  // End of the job: show what is left (capped), then remove the cursor
  finish: () => Promise<void>;
}

const isCursorNode = (n: BaseNode | null): boolean => {
  for (let p = n; p && p.type !== "PAGE"; p = p.parent) if (/^angelo-(cursor|ring)$/.test(p.name)) return true;
  return false;
};

// The nearest node the user can actually see
const visibleOf = (n: SceneNode): SceneNode | null => {
  let best: SceneNode | null = null;
  for (let p: BaseNode | null = n; p && p.type !== "PAGE" && p.type !== "DOCUMENT"; p = p.parent) {
    const s = p as SceneNode;
    if (!s.visible) best = null;
    else if (!best && s.absoluteBoundingBox && s.width > 0 && s.height > 0) best = s;
  }
  return best;
};

// listen: exec (unknown targets, nodechange) · false: apply (visit per target, `expected` known up front)
// name: the agent shown on the cursor (main or a helper)
export function autoCursor(listen: boolean, expected = 0, name = "main"): AutoCursor {
  const page = figma.currentPage;
  const live = new Set<SceneNode>();
  const queue: SceneNode[] = [];
  const reflow: SceneNode[] = [];
  let cursor: Cursor | null = null;
  let starting: Promise<void> | null = null;
  let off = false;
  let pumping: Promise<void> | null = null;
  let draining = false;
  const t0 = Date.now();
  // exec: switches to bulk once more distinct nodes than PRECISE_MAX have changed
  const seen = new Set<string>();
  const bulk = () => expected > PRECISE_MAX || seen.size > PRECISE_MAX;

  const show = async (n: SceneNode, maxMs: number, dwell: number) => {
    if (!cursor || n.removed) return;
    cursor.ring.follow(n);
    await cursor.to(n, maxMs);
    if (dwell) await cursor.idle(dwell);
  };

  const pump = async () => {
    while (queue.length && cursor && !off) {
      const n = queue.shift()!;
      if (bulk()) await show(n, HOP_MS, 0);
      else if (!draining) await show(n, STEP_MS, DWELL_MS);
      else {
        const each = DRAIN_MS / (queue.length + 1);
        await show(n, Math.max(120, Math.min(STEP_MS, each * 0.7)), each > 300 ? DWELL_MS : 0);
      }
    }
  };
  const kick = () => {
    if (!pumping) pumping = pump().finally(() => (pumping = null));
  };

  const ensure = () => {
    if (cursor || off) return Promise.resolve();
    if (!starting) {
      starting = makeCursor(live, name)
        .then((c) => {
          if (off) c.done();
          else cursor = c;
        })
        .catch(() => {})
        .finally(() => (starting = null));
    }
    return starting;
  };

  const push = (into: SceneNode[], v: SceneNode) => {
    const i = into.indexOf(v);
    if (i >= 0) into.splice(i, 1);
    into.push(v);
    if (into.length > QUEUE_MAX) into.splice(0, into.length - QUEUE_MAX);
  };

  const onChange = (e: NodeChangeEvent) => {
    if (off) return;
    let added = false;
    for (const ch of e.nodeChanges) {
      if (ch.type === "DELETE" || ch.origin !== "LOCAL" || ch.node.removed) continue;
      const n = ch.node as SceneNode;
      if (isCursorNode(n)) continue;
      const v = visibleOf(n);
      if (!v) continue;
      if (ch.type === "PROPERTY_CHANGE" && ch.properties.every((p) => REFLOW.has(p))) {
        push(reflow, v);
        continue;
      }
      seen.add(n.id);
      push(queue, v);
      added = true;
    }
    if (added) ensure().then(kick);
  };

  let listening = false;
  if (listen) {
    try {
      page.on("nodechange", onChange);
      listening = true;
    } catch {}
  }
  const unlisten = () => {
    if (!listening) return;
    listening = false;
    try {
      page.off("nodechange", onChange);
    } catch {}
  };

  const close = () => {
    off = true;
    unlisten();
    queue.length = 0;
    if (cursor) cursor.done();
    cursor = null;
    live.forEach((n) => {
      try {
        if (!n.removed) n.remove();
      } catch {}
    });
  };

  return {
    visit: async (n) => {
      if (off) return;
      const v = visibleOf(n);
      if (!v) return;
      await ensure();
      if (!cursor) return;
      if (Date.now() - t0 > VISIT_MS) cursor.ring.follow(v);
      else if (bulk()) await show(v, HOP_MS, 0);
      else await show(v, STEP_MS, DWELL_MS);
    },
    yieldTo: close,
    finish: async () => {
      if (off) return;
      if (listening) {
        // The last changes reach the listener only once the script has yielded, in batches
        const t = Date.now();
        while (!cursor && !starting && !queue.length && !reflow.length && Date.now() - t < SETTLE_MS) await pause(16);
        // One more beat for the rest of the batch, only when a change was seen: a timer
        // costs up to 1 s in Figma, and a read-only script has nothing left to wait for
        if (cursor || starting || queue.length || reflow.length) await pause(16);
        unlisten();
        // Only reflow seen (a script that only moved or resized nodes): show that
        if (!queue.length && !cursor && reflow.length) queue.push(...reflow);
        if (queue.length) await ensure();
      }
      if (!cursor) return close();
      draining = true;
      const end = Date.now() + DRAIN_MS + 1500;
      while ((pumping || queue.length) && Date.now() < end && !off) {
        kick();
        await pause(30);
      }
      if (cursor && !off) await cursor.idle(REST_MS);
      close();
    },
  };
}
