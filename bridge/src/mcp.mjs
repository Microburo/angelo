// Angelo MCP server: a thin stdio client in front of the local bridge.
// Starts the bridge itself when it is not already listening.
//
// Two families of tools over one channel: angelo_* reads the selection as compact
// text, local_figma_use runs arbitrary Plugin API JS. Same plugin, same undo
// model, same file guard.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { noteLine } from "./note-line.mjs";
import { figmaRunning, makeClient } from "./client.mjs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.ANGELO_PORT ?? 8787);
const BASE = `http://127.0.0.1:${PORT}`;

const MAX_RESULT = 50_000; // chars — anti context-blowup cap on exec results

const PLUGIN_HINT =
  "Angelo plugin closed in Figma Desktop. Open it (Plugins → Development → Angelo) and leave it open.";

// Finding, starting and replacing the bridge is shared with the watcher (client.mjs).
const client = makeClient({ role: "mcp", entry: fileURLToPath(import.meta.url), port: PORT });
const ensureBridge = client.ensure;

// Hello every few seconds: the bridge knows a Claude session is there (shown in the plugin and
// in the extension), and a bridge that is gone or too old to answer is started again here,
// without waiting for the next tool call. Never while Figma is closed: nothing to bridge to.
const HELLO_MS = 5000;
let helloBusy = false;
setInterval(async () => {
  if (helloBusy) return;
  helloBusy = true;
  try {
    if (!(await client.hello()) && (await figmaRunning())) await ensureBridge();
  } catch {}
  helloBusy = false;
}, HELLO_MS).unref();
client.hello().catch(() => {});

// The bridge is assumed up: a call costs one round trip, not a health probe
// plus a call. Only a refused connection starts the bridge and retries. A
// closed plugin is reported by the bridge itself (503 "plugin disconnected").
async function bridgeFetch(path, method, body, timeout) {
  const call = () =>
    fetch(BASE + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timeout ? AbortSignal.timeout(timeout) : undefined,
    });
  try {
    return await call();
  } catch (error) {
    if (error.name === "TimeoutError") throw error;
    if (!(await ensureBridge())) throw new Error(`bridge unreachable on ${BASE} (npm run bridge)`);
    return call();
  }
}

async function rpc(method, params, extra) {
  const response = await bridgeFetch("/rpc", "POST", { method, params, ...extra });
  const payload = await response.json().catch(() => ({ error: "unreadable bridge response" }));
  if (!response.ok || payload.error) {
    throw new Error(payload.error === "plugin disconnected" ? PLUGIN_HINT : payload.error);
  }
  return payload.result;
}

// Agent making the call (main or a helper: Berta, Maximus, Nora, Rosa). The bridge gives each
// agent its turn in Figma, the plugin keeps one read per agent: a helper's read never voids
// another agent's sid.
const AGENT_ARG = z.any().optional().describe('your agent name when the note was handed to you (e.g. "Berta"); default "main"');
const agentName = (a) => (typeof a === "string" && /^[A-Za-z][\w-]{0,39}$/.test(a) ? a : "main");

// `finish` on a change call: the note is answered and done right after a successful change.
async function finishAfter(note, finish, focus) {
  if (note == null || typeof finish !== "string" || !finish.trim()) return "";
  const ids = Array.isArray(focus) ? focus.filter((f) => typeof f === "string") : [];
  try {
    await finishNote(String(note), finish, ids);
    return `#${note} done`;
  } catch (error) {
    return `#${note} not finished: ${error.message} (call note_finish)`;
  }
}

function text(value) {
  return { content: [{ type: "text", text: value }] };
}

function fail(value) {
  return { content: [{ type: "text", text: `Error: ${value}` }], isError: true };
}

const server = new McpServer({ name: "angelo", version: "0.1.0" });

server.registerTool(
  "local_figma_use",
  {
    title: "Figma local exec",
    description:
      "Run Figma Plugin API JS (~56 ms) in the file where the Angelo plugin is open (Figma Desktop, local " +
      "fonts). Reply starts with [file › page]; `file` refuses any other file. Plain Plugin API only (no " +
      "figma.createAutoLayout / node.query / node.set / node.screenshot). Not atomic: on error, earlier changes " +
      "stay; one script = one undo step. In scope: `figma` + `H`: hex(h), solid(h,opacity?), byId(id)*, " +
      "find(root,name), findAll(root,predOrName), frame({layoutMode,name,spacing,padding,fills,parent}), " +
      "text(chars,{font,style,size,fills,name,parent})*, loadFonts(root)* [every font under root], " +
      "varByName(name)*, bindFill(node,variable), shot(node,scale?)* [PNG, longest side ≤1024, max 6], " +
      "pause(ms)* [lets Figma repaint], cursor(name?)* → c.stage({name,width,height?,after?|x,y})* [empty root " +
      "frame shown at once], c.to(node|[x,y]), c.idle(ms), c.reveal(node), c.ring.follow(node|null), c.done() " +
      "— live agent cursor + ring, removed when the exec ends. * = async. Timeout 30 s. To read a design, " +
      "use angelo_read.",
    // Both arguments stay loose on purpose: a schema rejection would surface as a
    // protocol error, and callers expect a readable isError instead.
    inputSchema: {
      code: z.any().optional().describe("Plugin API JS (`figma`, `H` in scope), top-level await + return"),
      file: z.any().optional().describe("Expected figma.root.name — refused in any other file"),
      note: z.any().optional().describe("Note id being worked on: the change is recorded behind the note's Undo button (create nodes with H.frame/H.text or call H.keep(node) before changing a node)"),
      finish: z.any().optional().describe("with note: reply text — on success the note is marked done (simple note = this one call, no note_finish)"),
      focus: z.any().optional().describe("with finish: changed layer ids (default: the note's targets)"),
      agent: AGENT_ARG,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true, // runs arbitrary JS: can delete or alter any node
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ code, file, note, agent, finish, focus }) => {
    if (typeof code !== "string" || code.trim() === "") {
      return fail(
        "`code` parameter required (non-empty string) — Figma Plugin API JS, `figma` and `H` in scope."
      );
    }
    if (file !== undefined && typeof file !== "string") {
      return fail("`file` parameter: string expected.");
    }

    let result;
    try {
      result = await rpc("exec", { code, file, agent: agentName(agent), ...(note != null ? { note: String(note) } : {}) });
    } catch (error) {
      return fail(String(error.message || error));
    }

    const where = result.file ? `[${result.file} › ${result.page}]` : "";
    const images = (result.images || []).map((image) => ({
      type: "image",
      data: image.data,
      mimeType: "image/png",
    }));

    if (result.error) {
      const lines = [`Error: ${result.error}`];
      if (result.at) lines.push(`  line ${result.at.line}:${result.at.col} → ${result.at.src}`);
      if (where) lines.push(where);
      if (result.at || result.images) {
        lines.push("Changes made before the error are kept — one Cmd+Z undoes the whole script.");
      }
      return { content: [{ type: "text", text: lines.join("\n") }, ...images], isError: true };
    }

    let body = JSON.stringify(result.value ?? null);
    if (body.length > MAX_RESULT) {
      body =
        body.slice(0, MAX_RESULT) +
        `\n… [truncated: ${body.length} chars in total — return less data]`;
    }
    const done = await finishAfter(note, finish, focus);
    const head = [where, result.undo ? `(undo ${result.undo})` : "", done].filter(Boolean).join(" ");
    return { content: [{ type: "text", text: head ? `${head}\n${body}` : body }, ...images] };
  }
);

server.registerTool(
  "angelo_status",
  {
    title: "Angelo status",
    description:
      "Angelo channel state: bridge, Figma plugin, file and current selection (ids, names, sizes). Call before angelo_read when unsure.",
    inputSchema: {},
  },
  async () => {
    const state = await ensureBridge();
    if (!state) return text(`bridge: not running on ${BASE}\nstart it with: npm run bridge`);
    const lines = [
      `bridge: ok (${BASE})${state.version ? ` · code ${state.version} · pid ${state.pid}` : " · old code (no version)"}${state.stale ? " · source changed, restarts as soon as it is idle" : ""}`,
      `plugin: ${state.plugin ? `connected since ${state.pluginSince}` : "disconnected"}`,
    ];
    if (state.links) lines.push(`extension: ${state.links.extension ? "panel open in the browser" : "no panel open"}`);
    if (client.outdated()) lines.push("mcp: this MCP server runs old code (source changed since it started) → /mcp reconnect angelo");
    const manifest = join(here, "..", "..", "plugin", "manifest.json");
    if (!state.plugin) lines.push(PLUGIN_HINT, ...(existsSync(manifest) ? [`manifest: ${manifest} (Plugins → Development → Import plugin from manifest…)`] : []));
    if (state.selection) {
      lines.push(`page: ${state.selection.page}`, `selection: ${state.selection.count} node(s)`);
      for (const node of state.selection.nodes ?? []) {
        lines.push(`  ${node.type} #${node.id} "${node.name}" ${node.width}x${node.height}`);
      }
    }
    return text(lines.join("\n"));
  }
);

server.registerTool(
  "angelo_read",
  {
    title: "Angelo read",
    description:
      "Read the Figma selection (or a node, or the page) as Angelo: manifest of what the scope references " +
      "(variables with alias targets, styles, components, fonts; any local label stays writable) + surface tree with numbered holes <chunk n>; angelo_expand opens a hole. Defaults " +
      "are omitted: no at: on auto-layout children, no autosize: when size: implies it, no text prop equal " +
      "to the bound style. A `# warn` section lists where the render differs from the declared props (invisible " +
      "opacity, clipped child, missing font, raw hex equal to a token, vector regions inside components) " +
      "each ending with `→ <fix op>`; its nodes are writable by angelo_apply without another read.",
    inputSchema: {
      target: z.string().optional().describe('"selection" (default), "page", or a node id like "1:234"'),
      budget: z.number().optional().describe("token budget per chunk (default 4000)"),
      manifest: z.string().optional().describe('"full" lists every local variable and style (default "used")'),
      agent: AGENT_ARG,
    },
  },
  async ({ target, budget, manifest, agent }) => {
    const result = await rpc("read", { target: target ?? "selection", budget, manifest, agent: agentName(agent) });
    return text(result.angelo);
  }
);

server.registerTool(
  "angelo_expand",
  {
    title: "Angelo expand",
    description:
      "Open a hole of the last read: full detail (geometry, fills, strokes, effects, text) of the chunk's nodes. chunk: n, or id: one node.",
    inputSchema: {
      chunk: z.number().optional().describe("chunk number shown in the tree"),
      id: z.string().optional().describe('node id, e.g. "1:234"'),
      agent: AGENT_ARG,
    },
  },
  async ({ chunk, id, agent }) => {
    if (chunk === undefined && id === undefined) {
      throw new Error("give chunk: n or id: \"1:234\"");
    }
    const result = await rpc("expand", { ...(id === undefined ? { chunk } : { id }), agent: agentName(agent) });
    return text(result.angelo);
  }
);

server.registerTool(
  "angelo_apply",
  {
    title: "Angelo apply",
    description:
      "Batch of typed ops on nodes of the last read. Props use the read vocabulary: at:10,20 · wh:320x48 · " +
      "gap:16 · pad:24,16 · align:between,center · size:fill,hug · r:8 · fill:c.surface.default | #FFF | " +
      "p.gray-6 · stroke:1 inside #EBEBEB (0,0,1,0 = per side) · font:t.display-l | \"TWK Everett Regular 56\" · " +
      "text:\"…\" · lh ls case deco talign rot op autosize hidden:on|off · regionfill:inherit (VEC, from a # warn line). gap/pad/r take a number or a " +
      "variable label (pad:s.gap-16 binds, pad:16 unbinds). Instances: ref:(cmp.button){size:l,state:hover} " +
      "switches component/variants (overrides survive), ov:{label=\"Send\", icon=on} sets instance props " +
      "(INSTANCE_SWAP takes a cmp.* label). Ops: {op:\"set\", id, props} · {op:\"insert\", parent, " +
      "type:FRAME|RECT|ELL|TEXT|LINE|STAR|POLY|INST, ref (cmp.* if INST), index?, name?, props?} · " +
      "{op:\"clone\", id, count?, parent?, index?, props?} (outside auto-layout, without at:, copies land beside the source) · {op:\"reorder\", parent, order:[ids]} · " +
      "{op:\"each\", match:{in?:ancestor id, type?:Angelo tag, ref?:cmp.*, name?:exact or glob \"Label*\"}, " +
      "props} (same props on every matching node of the read; 500 max, one filter minimum). Everything is " +
      "checked before any write: an unread node, a node changed since the read or an invalid prop refuses the " +
      "whole batch. One batch = one undo step; the reply is the real diff. Not expressible (gradient, image, " +
      "mixed text, vectors) → local_figma_use.",
    inputSchema: {
      ops: z.any().describe("ops list (see description), 200 max per batch"),
      sid: z.any().optional().describe("read number — refused if a later read replaced it"),
      file: z.any().optional().describe("expected figma.root.name — refused in any other file"),
      note: z.any().optional().describe("note id being worked on: the batch is recorded behind the note's Undo button"),
      finish: z.any().optional().describe("with note: reply text — on success the note is marked done (simple note = this one call, no note_finish)"),
      focus: z.any().optional().describe("with finish: changed layer ids (default: the note's targets)"),
      agent: AGENT_ARG,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ ops, sid, file, note, agent, finish, focus }) => {
    if (!Array.isArray(ops) || ops.length === 0) {
      return fail("`ops` parameter required: non-empty list of ops {op, …}.");
    }
    if (file !== undefined && typeof file !== "string") {
      return fail("`file` parameter: string expected.");
    }

    let result;
    try {
      result = await rpc("apply", { ops, sid, file, agent: agentName(agent), ...(note != null ? { note: String(note) } : {}) });
    } catch (error) {
      return fail(String(error.message || error));
    }

    const where = result.file ? `[${result.file} › ${result.page}]` : "";
    const done = await finishAfter(note, finish, focus);
    const head = [where, result.undo ? `(undo ${result.undo})` : "", done].filter(Boolean).join(" ");
    return text(head ? `${head}\n${result.angelo}` : result.angelo);
  }
);


// ---------- notes: the designer's requests from the plugin panel (bridge/src/notes.mjs) ----------
// Ported from Retoucher (MIT, Copyright (c) 2026 Ali Çorak — see THIRD_PARTY_LICENSES).

async function api(path, { method = "GET", body, timeout = 15000 } = {}) {
  const response = await bridgeFetch(path, method, body, timeout);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `bridge ${response.status}`);
  return payload;
}

// Reply + done in one go. The after picture follows in the background: the designer sees the
// answer at once, the before/after pair shows up a moment later. focus defaults to the targets.
async function finishNote(id, text, focus, images) {
  if (!focus?.length) focus = ((await api(`/notes/${id}`)).nodes || []).map((n) => n.id);
  if (focus.length) await api(`/notes/${id}`, { method: "PATCH", body: { focus } });
  await api(`/notes/${id}/messages`, { method: "POST", body: { from: "claude", text, status: "done", images } });
  if (focus.length) {
    rpc("export", { id: focus[0], maxPx: 1600 })
      .then(({ data }) => api(`/notes/${id}/snapshot`, { method: "POST", body: { kind: "after", image: data } }))
      .catch(() => {});
  }
}

// "Claude ready" stays on in the panel for a while after each wait, as long as the session watches
let watchingUntil = 0;
setInterval(() => {
  if (Date.now() < watchingUntil) fetch(`${BASE}/presence`, { method: "POST" }).catch(() => {});
}, 4000).unref();

const seen = new Map();

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const readImages = (list) =>
  (Array.isArray(list) ? list : []).map((im) => ({
    mime: MIME[String(im.path).split(".").pop().toLowerCase()] || "image/png",
    data: readFileSync(im.path).toString("base64"),
    link: im.link,
    caption: im.caption,
  }));
const imagesArg = z
  .array(z.object({ path: z.string(), link: z.string().optional(), caption: z.string().optional() }))
  .optional()
  .describe("pictures shown under the message (references, versions): [{ path, link?, caption? }]");
const noteId = z.union([z.string(), z.number()]).describe('note id, e.g. "15"');

async function waitAnswer(promptId, waitSec) {
  const wait = Math.max(1, Math.min(Number(waitSec) || 45, 280)) * 1000;
  const p = await api(`/permissions/${promptId}?wait=${wait}`, { timeout: wait + 5000 }).catch(() => null);
  if (!p) return "that question is gone (expired or answered elsewhere)";
  if (p.status === "answered") {
    return p.decision === "skip"
      ? "The designer skipped the questions: decide with the most sensible default and say which in the note."
      : JSON.stringify({ answers: p.answers }, null, 2);
  }
  return `no answer yet: call note_check_answer with prompt_id "${promptId}"`;
}

function tool(name, description, inputSchema, run, annotations) {
  server.registerTool(name, { title: name, description, inputSchema, ...(annotations ? { annotations } : {}) }, async (args) => {
    try {
      return text(String(await run(args)));
    } catch (error) {
      return fail(String(error.message || error));
    }
  });
}

function registerNoteTools() {
  const msg = (id, body) => api(`/notes/${id}/messages`, { method: "POST", body: { from: "claude", ...body } });

  tool(
    "note_wait",
    "Wait for the next note, follow-up or message from the Angelo panel in Figma. Returns as soon as something arrives, or after timeout_sec with \"nothing yet\": call it again. While you wait the panel shows \"Claude ready\". Notes already waiting come back on the first call. Handle each with the angelo-notes skill.",
    { timeout_sec: z.number().optional().describe("how long to wait (default 45, max 280)") },
    async ({ timeout_sec }) => {
      const timeout = Math.max(1, Math.min(Number(timeout_sec) || 45, 280)) * 1000;
      watchingUntil = Date.now() + timeout + 90000;
      const items = await api("/notes/wait", { method: "POST", body: { timeout, seen: Object.fromEntries(seen) }, timeout: timeout + 10000 });
      watchingUntil = Date.now() + 90000;
      for (const it of items) seen.set(it.id, it.updatedAt);
      return items.length ? items.map(noteLine).join("\n") + "\n\nnote_claim, then note_show, for each." : "nothing yet: call note_wait again";
    }
  );
  tool(
    "note_list",
    "Notes by status (pending, working, question, done; comma-separated).",
    { status: z.string().optional().describe('default "pending"') },
    async ({ status }) => {
      const items = await api(`/notes?status=${encodeURIComponent(status || "pending")}`);
      return items.length ? items.map(noteLine).join("\n") : "(none)";
    }
  );
  tool(
    "note_show",
    "Everything about a note: text, targets (layer ids), attachments, mentions, options, thread, file key, Figma URL.",
    { id: noteId },
    async ({ id }) => JSON.stringify(await api(`/notes/${id}`), null, 2)
  );
  tool("note_claim", "Mark a note as being worked on (the panel shows Working, steps reset).", { id: noteId }, async ({ id }) => {
    const it = await api(`/notes/${id}`, { method: "PATCH", body: { status: "working" } });
    return `#${id} working → ${it.agent}`;
  });
  tool(
    "note_split",
    "A note made of independent parts (distinct layers or screens, no shared node): reserve free helper agents for its parts. Returns the helpers you got (maybe fewer than asked, or none: then do every part yourself). Hand each helper its part as a background agent; you finish the note once all parts are back.",
    { id: noteId, parts: z.number().describe("number of independent parts besides the one you keep (1-4)") },
    async ({ id, parts }) => {
      const r = await api(`/notes/${id}/split`, { method: "POST", body: { parts } });
      return r.helpers.length ? `#${id}: ${r.agent} + ${r.helpers.join(", ")}` : `#${id}: no helper free, ${r.agent} does every part`;
    }
  );
  tool(
    "note_step",
    "Show what you are doing now under Working in the panel. Short, in the designer's words.",
    { id: noteId, text: z.string().describe('e.g. "Placing 5 of 12"') },
    async ({ id, text: t }) => {
      await api(`/notes/${id}/progress`, { method: "POST", body: { text: t } });
      return "ok";
    }
  );
  tool(
    "note_finish",
    "Reply and mark the note done. Markdown, very concise and direct: one short line, at most 2-3 terse \"- \" bullets only when needed, no explanations, [name](url) links. Optional pictures shown under the reply. focus: changed layer ids → the panel offers to select them and the first one is the after picture (no separate note_focus / note_snapshot needed).",
    { id: noteId, text: z.string(), images: imagesArg, focus: z.array(z.string()).optional().describe("changed layer ids") },
    async ({ id, text: t, images, focus }) => {
      await finishNote(id, t, focus?.length ? focus : [], readImages(images));
      return `#${id} done`;
    }
  );
  tool(
    "note_ask",
    "Ask the designer an open question in the note and stop; the answer arrives later as a follow-up (note_wait).",
    { id: noteId, text: z.string() },
    async ({ id, text: t }) => {
      await msg(id, { text: t, status: "question" });
      return `#${id} waiting for the designer`;
    }
  );
  tool(
    "note_plan",
    "Show a plan with Approve / Change buttons and stop; approval or changes arrive as a follow-up.",
    { id: noteId, text: z.string().describe("the plan, numbered, in markdown") },
    async ({ id, text: t }) => {
      await msg(id, { text: t, status: "question", kind: "plan" });
      return `#${id} plan shown`;
    }
  );
  tool(
    "note_say",
    "Write in the note without changing its status, optionally with pictures.",
    { id: noteId, text: z.string(), images: imagesArg },
    async ({ id, text: t, images }) => {
      await msg(id, { text: t, images: readImages(images) });
      return "ok";
    }
  );
  tool("note_rewrite", "Replace your last reply on the note.", { id: noteId, text: z.string() }, async ({ id, text: t }) => {
    await msg(id, { text: t, replaceLast: true });
    return "ok";
  });
  tool(
    "note_ask_designer",
    "Ask 1–4 multiple-choice questions as a card in the panel and wait for the answers (the designer can also write their own). Without an answer within wait_sec, returns a prompt_id for note_check_answer.",
    {
      id: noteId,
      questions: z
        .array(
          z.object({
            question: z.string(),
            header: z.string().optional(),
            multiSelect: z.boolean().optional(),
            options: z.array(z.object({ label: z.string(), description: z.string().optional() })),
          })
        )
        .min(1)
        .max(4),
      wait_sec: z.number().optional().describe("default 45"),
    },
    async ({ id, questions, wait_sec }) => {
      const p = await api("/permissions", { method: "POST", body: { kind: "question", title: "Claude has a question", questions, noteId: String(id) } });
      return waitAnswer(p.id, wait_sec);
    }
  );
  tool(
    "note_check_answer",
    "Wait for the answer to a note_ask_designer card.",
    { prompt_id: z.string(), wait_sec: z.number().optional() },
    async ({ prompt_id, wait_sec }) => waitAnswer(prompt_id, wait_sec)
  );
  tool(
    "note_snapshot",
    "Store a before or after picture shown in the note: give a node id (exported by the plugin) or a PNG path.",
    { id: noteId, kind: z.enum(["before", "after"]), node: z.string().optional().describe('node id, e.g. "1:234"'), png_path: z.string().optional() },
    async ({ id, kind, node, png_path }) => {
      let image;
      if (node) image = (await rpc("export", { id: node, maxPx: 1600 })).data;
      else if (png_path) image = readFileSync(png_path).toString("base64");
      else throw new Error("node or png_path required");
      await api(`/notes/${id}/snapshot`, { method: "POST", body: { kind, image } });
      return `${kind} saved`;
    }
  );
  tool(
    "note_undo_patch",
    "Add a revert patch behind the note's Undo button, newest first: { set:[{id, props}], remove:[ids], move:[{id, parent, index}], swap:[{id, componentKey|componentId}], bind:[{id, field, variableId|null}], variables:[{id, modeId, value}], text:[…] }. angelo_apply / local_figma_use / note_text with `note` already record theirs. replace:true drops what was there.",
    { id: noteId, patch: z.record(z.any()), replace: z.boolean().optional() },
    async ({ id, patch, replace }) => {
      await api(`/notes/${id}/patch`, { method: "POST", body: { patch, replace: replace === true } });
      return "undo saved";
    }
  );
  tool(
    "note_focus",
    "Layers the panel offers to select (\"Select N layers\").",
    { id: noteId, ids: z.array(z.string()) },
    async ({ id, ids }) => {
      await api(`/notes/${id}`, { method: "PATCH", body: { focus: ids } });
      return "ok";
    }
  );
  tool(
    "note_comments",
    "Figma comment threads of the note's file, open ones by default (needs a token, set in the panel).",
    { id: noteId, all: z.boolean().optional().describe("include resolved threads") },
    async ({ id, all }) => {
      const it = await api(`/notes/${id}`);
      if (!it.fileKey) throw new Error("the note has no file key: the designer pastes the file link once in the panel");
      return JSON.stringify(await api(`/comments/${it.fileKey}${all ? "" : "?open=1"}`, { timeout: 20000 }), null, 2);
    }
  );
  tool(
    "note_fonts",
    "Fonts installed on the designer's computer as Figma sees them (Angelo loads local fonts).",
    { query: z.string().optional().describe('part of a family name, e.g. "Waldenburg"') },
    async ({ query }) => {
      const r = await rpc("fonts", { query: query || "" });
      return r.fonts.length ? r.fonts.map((f) => `${f.family}: ${f.styles.join(", ")}`).join("\n") : "(no matching fonts)";
    }
  );
  tool(
    "note_text",
    "Change text styling across layers: font family/style (closest weight kept when style is omitted), size, size delta, letter spacing, line height, per text range, filtered by match. With `note`, Undo is recorded.",
    {
      note: noteId.optional(),
      ops: z.array(
        z.object({
          nodeIds: z.array(z.string()).optional().describe("text layers, or frames whose text layers all change"),
          within: z.string().optional().describe("a frame, section or page id: every text layer inside"),
          family: z.string().optional(),
          style: z.string().optional(),
          fontSize: z.number().optional(),
          fontSizeDelta: z.number().optional(),
          letterSpacing: z.object({ unit: z.enum(["PIXELS", "PERCENT"]), value: z.number() }).optional(),
          lineHeight: z.object({ unit: z.enum(["PIXELS", "PERCENT", "AUTO"]), value: z.number().optional() }).optional(),
          match: z.object({ family: z.string().optional(), style: z.string().optional(), minSize: z.number().optional(), maxSize: z.number().optional() }).optional(),
        })
      ),
    },
    async ({ note, ops }) => {
      const r = await rpc("text", { ops, ...(note != null ? { note: String(note) } : {}) });
      return [
        `changed ${r.changedLayers} text layers (${r.changedRanges} ranges)${r.undo ? `; undo ${r.undo}` : ""}`,
        ...(r.skipped || []).map((k) => `skipped ${k.name || k.id || k.op}: ${k.reason}`),
      ].join("\n");
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  );
  tool(
    "note_offer_models",
    "Tell the panel which models you can hand a note to (as a helper agent), with their real names, so the designer can pick one per note.",
    { models: z.array(z.object({ id: z.string(), name: z.string() })) },
    async ({ models }) => `${(await api("/models", { method: "POST", body: { models } })).count} models offered`
  );
  tool(
    "note_offer_skills",
    "Tell the panel which skills you have, so the designer can pick one per note.",
    { skills: z.array(z.object({ name: z.string(), description: z.string().optional() })) },
    async ({ skills }) => `${(await api("/skills", { method: "POST", body: { skills } })).count} skills offered`
  );
}

registerNoteTools();

await server.connect(new StdioServerTransport());

// Start the bridge with the session, not with the first call: the panel in Figma finds it
// on its next reconnection attempt (up to 5 s apart) and is connected by the time a tool runs.
ensureBridge().catch(() => {});
