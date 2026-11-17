// Angelo plugin — main thread.
//
// Owns the Figma API side: serialization and selection tracking. It never talks
// to the network itself; the UI iframe holds the WebSocket to the local bridge
// and relays frames both ways.

import { runExec, settled } from "./exec";
import { nodeOf } from "./lookup";
import { exportForRpc, initNotes, onNotesMessage } from "./notes";
import { renderAddendum, snapshot } from "./serialize/addendum";
import { quote } from "./serialize/format";
import { Legend } from "./serialize/legend";
import { buildManifest } from "./serialize/manifest";
import { warnSection } from "./serialize/warn";
import { Chunk, Session, expandChunk, readRoots } from "./serialize/tree";
import { applyOps } from "./write/apply";
import { applyPatch } from "./write/patch";
import { listFonts, runTextOps } from "./write/text";

const DEFAULT_BUDGET = 4000;

interface Request {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

// One read session per agent (main and its helpers): an agent's read voids only its own
// earlier sid. Sids stay unique across agents, so a sid passed by the wrong agent is refused.
let sessionCounter = 0;
const sessions = new Map<string, Session>();
const agentOf = (params: Record<string, unknown>): string =>
  typeof params.agent === "string" && params.agent ? params.agent : "main";

const UI_WIDTH = 272;
let uiWidth = UI_WIDTH;
let uiHeight = 40;
figma.showUI(__html__, { width: UI_WIDTH, height: uiHeight, themeColors: true });

// The UI asks for a new size (activity list shown or gone, notes panel opened or folded):
// by default the window grows or shrinks upwards, so its bottom edge, the bar, stays where
// it is on screen; a drag on the panel's corner keeps the top edge. Position is in canvas space.
function resizeTo(width: number, height: number, anchor: "bottom" | "top" = "bottom"): void {
  const w = Math.max(200, Math.min(1200, Math.round(width)));
  const h = Math.max(32, Math.min(1400, Math.round(height)));
  const dh = h - uiHeight;
  if (!dh && w === uiWidth) return;
  const { canvasSpace } = figma.ui.getPosition();
  figma.ui.resize(w, h);
  if (anchor === "bottom" && dh) figma.ui.reposition(canvasSpace.x, canvasSpace.y - dh / figma.viewport.zoom);
  uiWidth = w;
  uiHeight = h;
}

// Sessions hold node proxies (up to the read budget): keep the agents seen most recently
const MAX_SESSIONS = 6;

/** A fresh session, not yet registered: a read that fails keeps the agent's previous sid. */
function newSession(budget: number): Session {
  sessionCounter += 1;
  return {
    sid: sessionCounter,
    legend: new Legend(),
    chunks: new Map<number, Chunk>(),
    budget,
    revs: new Map<string, string>(),
    nodes: new Map<string, SceneNode>(),
  };
}

function register(agent: string, session: Session): void {
  sessions.delete(agent);
  sessions.set(agent, session);
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value as string;
    if (oldest === "main" && sessions.size > 1) {
      // the main agent keeps its read; the oldest helper goes instead
      const main = sessions.get("main") as Session;
      sessions.delete("main");
      sessions.set("main", main);
      continue;
    }
    sessions.delete(oldest);
  }
}

function selectionSummary(): Record<string, unknown> {
  const nodes = figma.currentPage.selection;
  return {
    page: figma.currentPage.name,
    count: nodes.length,
    nodes: nodes.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      width: "width" in node ? Math.round(node.width) : null,
      height: "height" in node ? Math.round(node.height) : null,
    })),
  };
}

async function resolveRoots(
  target: unknown
): Promise<{ roots: SceneNode[]; label: string }> {
  if (typeof target === "string" && target !== "selection" && target !== "page") {
    const node = await nodeOf(target);
    if (node.type === "PAGE") {
      const page = node as PageNode;
      return { roots: page.children.slice(), label: `page:${quote(page.name)}` };
    }
    return { roots: [node as SceneNode], label: `#${target}` };
  }
  if (target === "page") {
    return {
      roots: figma.currentPage.children.slice(),
      label: `page:${quote(figma.currentPage.name)}`,
    };
  }
  const selection = figma.currentPage.selection;
  if (!selection.length) throw new Error("empty selection in Figma");
  return { roots: selection.slice(), label: `selection(${selection.length})` };
}

async function handleRead(params: Record<string, unknown>): Promise<unknown> {
  const budget =
    typeof params.budget === "number" && params.budget > 200
      ? params.budget
      : DEFAULT_BUDGET;
  const { roots, label } = await resolveRoots(params.target);
  const active = newSession(budget);

  const result = await readRoots(roots, active);
  // Before the manifest: a flagged nested component registers its label there.
  const warnings = await warnSection(roots, active, new Map());
  const manifest = await buildManifest(active.legend, {
    scopeLabel: label,
    pageName: figma.currentPage.name,
    nodeCount: result.nodeCount,
    chunkCount: result.chunkCount,
    full: result.full,
    truncated: result.truncated,
    fullManifest: params.manifest === "full",
  });

  const chunks = Array.from(active.chunks.values()).map((chunk) => ({
    n: chunk.n,
    nodes: chunk.nodes,
    names: chunk.names,
  }));

  register(agentOf(params), active);
  return {
    sid: active.sid,
    angelo: `${manifest}\n\n${warnings.length ? `# warn\n${warnings.join("\n")}\n\n` : ""}# tree\n${result.tree}`,
    nodes: result.nodeCount,
    chunks,
    full: result.full,
  };
}

async function handleExpand(params: Record<string, unknown>): Promise<unknown> {
  const active = sessions.get(agentOf(params));
  if (!active) throw new Error("no read in progress — run read first");

  if (typeof params.id === "string") {
    const node = await nodeOf(params.id);
    const before = snapshot(active.legend);
    const result = await readRoots([node as SceneNode], active);
    const addendum = await renderAddendum(active.legend, before);
    const header = `# ${params.id} · ${result.nodeCount} nodes${
      result.full ? " · detail:full" : ` · chunks:${active.chunks.size}`
    }`;
    return {
      sid: active.sid,
      angelo: [header, result.tree, addendum].filter(Boolean).join("\n\n"),
      nodes: result.nodeCount,
      full: result.full,
    };
  }

  const n = Number(params.chunk);
  const chunk = active.chunks.get(n);
  if (!chunk) {
    const available = Array.from(active.chunks.keys()).join(", ");
    throw new Error(
      `unknown chunk ${params.chunk} in read ${active.sid}` +
        (available ? ` (available: ${available})` : "")
    );
  }

  const before = snapshot(active.legend);
  const result = await expandChunk(chunk, active);
  const addendum = await renderAddendum(active.legend, before);
  const header = `# chunk ${chunk.n} of read ${active.sid} · in #${chunk.parentId} · ${result.nodeCount} nodes`;
  return {
    sid: active.sid,
    angelo: [header, result.text, addendum].filter(Boolean).join("\n\n"),
    nodes: result.nodeCount,
  };
}

// One call touches the file at a time, whoever sent it (bridge, the panel's own buttons):
// a read never sees an exec half done, and an exec the bridge gave up on still finishes
// before the next one starts. ping and selection stay outside so the bridge can probe.
let turn: Promise<unknown> = Promise.resolve();

function dispatch(request: Request): Promise<unknown> {
  if (request.method === "ping" || request.method === "selection") return run(request);
  const mine = turn.then(() => run(request));
  turn = mine.catch(() => {});
  return mine;
}

async function run(request: Request): Promise<unknown> {
  const params = request.params && typeof request.params === "object" ? request.params : {};
  // Previous exec still closing (cursor drain, undo commit): let it finish first
  if (request.method !== "ping" && request.method !== "selection") await settled();
  switch (request.method) {
    case "ping":
      return {
        plugin: "angelo",
        api: figma.apiVersion,
        file: figma.root.name,
        page: figma.currentPage.name,
        selection: selectionSummary(),
      };
    case "selection":
      return selectionSummary();
    case "read":
      return handleRead(params);
    case "expand":
      return handleExpand(params);
    case "exec":
      // The executor reports its own failures inside the payload (file, page,
      // the failing line, the images taken before the throw), so it is never
      // turned into an RPC rejection here.
      if (typeof params.code !== "string") throw new Error("exec: `code` missing");
      return runExec(params.code, params.file, params.quiet === true, params.revert === true, agentOf(params));
    case "apply": {
      // A sid held by another agent: say so, "replaced by read N" would send the agent the wrong way
      const mine = sessions.get(agentOf(params)) ?? null;
      if (params.sid !== undefined && (!mine || Number(params.sid) !== mine.sid)) {
        for (const [owner, other] of sessions) {
          if (other !== mine && other.sid === Number(params.sid)) {
            throw new Error(`read ${params.sid} belongs to agent "${owner}", not "${agentOf(params)}" — run angelo_read as "${agentOf(params)}"`);
          }
        }
      }
      return applyOps(params, mine);
    }
    // Notes: a note's Undo, local fonts, text jobs, pictures for the note
    case "patch":
      return applyPatch(params as any);
    case "fonts":
      return { fonts: await listFonts(params.query) };
    case "text":
      return runTextOps(params.ops, params.revert === true);
    case "export":
      return exportForRpc(params);
    default:
      throw new Error(`unknown method: ${request.method}`);
  }
}

function post(message: Record<string, unknown>): void {
  figma.ui.postMessage(message);
}

function postSelection(): void {
  post({ kind: "event", event: "selection", data: selectionSummary() });
}

figma.ui.onmessage = async (message: any) => {
  if (!message || typeof message !== "object") return;

  if (message.kind === "size") {
    if (typeof message.height === "number") {
      resizeTo(typeof message.width === "number" ? message.width : uiWidth, message.height, message.anchor === "top" ? "top" : "bottom");
    }
    return;
  }

  if (message.kind === "close") {
    figma.closePlugin();
    return;
  }

  if (message.kind === "notes") {
    try {
      await onNotesMessage(message);
    } catch (error: any) {
      figma.notify(String((error && error.message) || error), { error: true });
    }
    return;
  }

  if (message.kind === "status") {
    postSelection();
    return;
  }

  // onboarding ── first-run guide of the panel: finished or skipped once; opens the Claude Desktop download
  if (message.kind === "onboarding") {
    if (message.type === "get") {
      const done = await figma.clientStorage.getAsync("onboarding.done");
      post({ kind: "onboarding", type: "state", done: done === true });
    }
    if (message.type === "set" && typeof message.done === "boolean") await figma.clientStorage.setAsync("onboarding.done", message.done);
    if (message.type === "open" && /^https:\/\//.test(message.url || "")) figma.openExternal(message.url);
    return;
  }
  // ── onboarding

  if (message.kind !== "rpc") return;
  const request = message.request as Request;
  if (!request || typeof request !== "object" || typeof request.id !== "string" || !request.id) return;
  if (typeof request.method !== "string") {
    post({ kind: "rpc", response: { id: request.id, ok: false, error: "malformed request: `method` missing" } });
    return;
  }
  try {
    const result = await dispatch(request);
    post({ kind: "rpc", response: { id: request.id, ok: true, result } });
  } catch (error: any) {
    post({
      kind: "rpc",
      response: {
        id: request.id,
        ok: false,
        error: String((error && error.message) || error),
      },
    });
  }
};

const onChange = (): void => {
  postSelection();
};
figma.on("selectionchange", onChange);
figma.on("currentpagechange", onChange);
initNotes(post, (w, h) => resizeTo(w, h, "top"));

postSelection();
