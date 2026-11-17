// Angelo bridge: the only process both sides can reach.
//
//   Figma plugin  --WebSocket /plugin-->  bridge :8787  <--HTTP /rpc--  MCP
//
// The plugin must stay open; when it is not connected, /rpc answers
// "plugin disconnected" instead of hanging.
//
// Three barriers guard the plugin socket, inherited from figma-local-mcp:
//   1. bind 127.0.0.1 — the `ws` default is '::', reachable from the LAN
//   2. Origin check — the plugin iframe is sandboxed, so a real Origin is a third party
//   3. one client only — a stolen slot would let a third party answer Claude with
//      fabricated Figma results, which Claude would then trust
// HTTP /rpc is a separate surface: several local clients (MCP, tools/read.mjs)
// share one plugin connection through it. A browser always sends an Origin, local
// clients never do: /rpc refuses any Origin (a web page could otherwise POST an exec).
//
// Notes (notes.mjs): designer notes on layers, answered by Claude. The panel uses the
// plugin socket (frames notes/note-*/perm-*); local tools and hooks use HTTP /notes,
// /permissions, /presence…, which refuse any Origin like /rpc. A `note` param on
// apply/exec/text keeps the plugin's revert patch on that note for the panel's Undo.
// /stage, /capture and /job answer the browser extension only (its pinned Origin).
//
// Hub: every element says hello (POST /hello for the MCP, the watcher and the extension, a
// `hello` frame for the plugin) with its role and code version; the bridge answers with its
// own version and the state of every link, and pushes that state to the plugin when it
// changes. A bridge whose source changed on disk hands over to a successor once idle.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { caseName, makeRpc, stagePage } from "../../tools/web-lib.mjs";
import { createNotes } from "./notes.mjs";
import { makeLog } from "./log.mjs";
import { hashFiles, importGraph, statSignature } from "./version.mjs";

const PORT = Number(process.env.ANGELO_PORT ?? 8787);
const HOST = process.env.ANGELO_HOST ?? "127.0.0.1";
// The bridge runs code in Figma for whoever reaches it: off the loopback only when asked for
const ALLOW_LAN = process.env.ANGELO_ALLOW_LAN === "1";
if (!["127.0.0.1", "::1", "localhost"].includes(HOST) && !ALLOW_LAN) {
  console.error(`ANGELO_HOST=${HOST} is not a loopback address: refused (set ANGELO_ALLOW_LAN=1 to accept)`);
  process.exit(1);
}
// DNS rebinding: a web page whose name resolves to 127.0.0.1 sends its own name as Host
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const hostAllowed = (header) =>
  ALLOW_LAN || (typeof header === "string" && LOCAL_HOSTS.has(header.replace(/:\d+$/, "").toLowerCase()));
const DEFAULT_TIMEOUT = 30000;
const READ_TIMEOUT = 120000;
const EXEC_TIMEOUT = Number(process.env.ANGELO_EXEC_TIMEOUT) || 30000;
const OPEN = 1; // WebSocket.readyState
const HEARTBEAT_MS = Number(process.env.ANGELO_HEARTBEAT ?? 20000);

// Figma sandboxes the plugin iframe → Origin absent or 'null'. A browser always
// sends its real Origin and cannot spoof it from JS, so any web Origin is a
// third party, never the plugin.
const originAllowed = (origin) => origin === undefined || origin === "null";

// The extension's id comes from the public key pinned in its manifest: sha256 of the key,
// first 32 hex digits mapped to a-p
const EXTENSION_ORIGIN = (() => {
  try {
    const { key } = JSON.parse(readFileSync(new URL("../../extension/manifest.json", import.meta.url), "utf8"));
    const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
    return "chrome-extension://" + [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
  } catch {
    return null;
  }
})();
const MAX_CAPTURE = 50_000_000;

/** @type {import("ws").WebSocket | null} */
let plugin = null;
let pluginSince = null;
let selection = null;
let selectionAt = null;

const pending = new Map();
let nextId = 1;
// Ids are unique to this process: the panel sends a late answer on whatever socket it
// holds, so an answer to a call of the bridge before a restart must not match a new one.
const BOOT = Date.now().toString(36);

// The panel reconnects on a backoff (up to 5 s): a bridge that just started, or a plugin
// that just dropped (reload after a build), is a plugin about to connect, not a closed one.
const BOOT_GRACE = 6000;
const DROP_GRACE = 3000;
const startedAt = Date.now();
let droppedAt = 0;
const arrivals = new Set();
function pluginSoon() {
  const left = Math.max(startedAt + BOOT_GRACE, droppedAt + DROP_GRACE) - Date.now();
  if (left <= 0 || (plugin && plugin.readyState === OPEN)) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      arrivals.delete(done);
      resolve();
    };
    const timer = setTimeout(done, left);
    arrivals.add(done);
  });
}

// ANGELO_DRY: load every module then leave (a successor checked before a hand-over)
const DRY = process.env.ANGELO_DRY === "1";
const log = makeLog({ silent: DRY });

// The code this process runs: the entry and all it imports, hashed at start. ANGELO_VERSION_EXTRA
// adds one watched file (tests change it instead of the source).
const ENTRY = fileURLToPath(import.meta.url);
const WATCHED = [...importGraph(ENTRY), ...(process.env.ANGELO_VERSION_EXTRA ? [resolve(process.env.ANGELO_VERSION_EXTRA)] : [])];
const VERSION = hashFiles(WATCHED);
let stale = false;

// The extension's worker keeps the background.js it was loaded with until the extension is
// reloaded: this is the hash of the files on disk, for the worker to compare with its own.
const EXTENSION_FILES = ["background.js", "manifest.json"].map((f) => fileURLToPath(new URL("../../extension/" + f, import.meta.url)));
const extensionVersion = () => {
  const hash = createHash("sha256");
  for (const file of EXTENSION_FILES) {
    try {
      hash.update(readFileSync(file));
    } catch {}
  }
  return hash.digest("hex").slice(0, 12);
};

// Who said hello lately, by role. A peer beats every few seconds while it is alive (the
// extension only while its overlay is open: its worker sleeps otherwise).
const PEER_TTL = 15000;
const PEER_ROLES = new Set(["mcp", "watch", "tool"]);
const peers = new Map();
let pluginVersion = null;
const peerOn = (role) => {
  const peer = peers.get(role);
  return Boolean(peer && Date.now() - peer.at < PEER_TTL);
};
// the plugin build on disk (plugin/build.mjs): a plugin that says another one runs an old build
const PLUGIN_BUILD = fileURLToPath(new URL("../../plugin/dist/build.txt", import.meta.url));
const pluginStale = () => {
  if (!pluginVersion || pluginVersion === "dev" || !pluginOpen()) return false;
  try {
    return readFileSync(PLUGIN_BUILD, "utf8").trim() !== pluginVersion;
  } catch {
    return false;
  }
};
const bridgeInfo = () => ({ version: VERSION, pid: process.pid, boot: BOOT, stale });
const links = () => ({
  bridge: true,
  plugin: pluginOpen(),
  pluginStale: pluginStale(),
  claude: peerOn("mcp") || peerOn("watch"),
  extension: peerOn("extension"),
});

// A call past its timeout may still be running in Figma: the caller hears it at once, but the
// call keeps its place (`finished`) until the plugin answers, so the next call does not start
// its own clock behind it. Bounded: an answer lost for good frees the line after LATE_HOLD.
const LATE_HOLD = Number(process.env.ANGELO_LATE_HOLD) || 120000;
function callPlugin(method, params, timeout) {
  if (!plugin || plugin.readyState !== OPEN) {
    return Promise.reject(new Error("plugin disconnected"));
  }
  const id = `${BOOT}-${nextId++}`;
  const frame = JSON.stringify({ type: "request", id, method, params: params ?? {} });
  let finish;
  const finished = new Promise((r) => (finish = r));
  const call = new Promise((resolve, reject) => {
    const entry = { resolve, reject, finish, method, late: false, timer: null };
    entry.timer = setTimeout(() => {
      entry.late = true;
      reject(new Error(`no answer from Figma after ${Math.round(timeout / 1000)}s on ${method} — it may still be running there: read before retrying`));
      entry.timer = setTimeout(() => {
        pending.delete(id);
        log(`${method}: no late answer after ${Math.round(LATE_HOLD / 1000)}s, the line moves on`);
        finish();
      }, LATE_HOLD);
    }, timeout);
    pending.set(id, entry);
    plugin.send(frame);
  });
  call.finished = finished;
  return call;
}

// Notes from the panel (bridge/src/notes.mjs): its frames ride the plugin socket, its HTTP
// routes refuse any Origin like /rpc. Panel open = plugin connected.
const pluginOpen = () => Boolean(plugin && plugin.readyState === OPEN);
const sendPlugin = (obj) => {
  if (pluginOpen()) plugin.send(JSON.stringify(obj));
};
// the plugin shows every link: told at once when one changes
let linksSent = "";
function pushLinks() {
  const now = JSON.stringify(links());
  if (now === linksSent) return;
  linksSent = now;
  sendPlugin({ type: "links", links: links() });
}
if (!DRY) setInterval(pushLinks, 2000).unref();

// /rpc calls in progress (queued included): the bridge is not idle while one waits its turn
let inflight = 0;
// rid → { outcome, watchers, at }: the calls a client may resend
const recentCalls = new Map();
const RID_TTL = 10 * 60 * 1000;

// ---------- Figma turn: one plugin call at a time ----------
// Several agents (main and its helpers) share one plugin: each call waits for its turn in a
// FIFO, so two agents never run code in Figma at once. An agent's call (it carries `agent`)
// also waits for a web-to-figma build or stage to end before joining the line; the build's
// own calls carry no agent, so they never wait behind it. The panel sees who holds Figma and
// who waits.
const FREE_METHODS = new Set(["ping", "selection"]);
let figmaTail = Promise.resolve();
const figmaQueue = { holder: null, waiting: [] };
let queueTimer = null;
function pushQueue() {
  if (queueTimer) return;
  queueTimer = setTimeout(() => {
    queueTimer = null;
    sendPlugin({ type: "figmaQueue", holder: figmaQueue.holder, waiting: [...new Set(figmaQueue.waiting)] });
  }, 150);
}
// A call waits QUEUE_MAX at most, then says nothing ran (under the HTTP client's own 300 s).
// `left` (an HTTP caller): a caller that hung up while waiting is dropped from the line, its
// call never runs behind its back.
const QUEUE_MAX = Number(process.env.ANGELO_QUEUE_MAX) || 150000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitTurn(previous, deadline, left) {
  let timer;
  const expired = new Promise((r) => (timer = setTimeout(() => r("timeout"), Math.max(0, deadline - Date.now()))));
  const turn = previous.then(() => "turn");
  let watchLeft = Boolean(left);
  try {
    for (;;) {
      const outcome = await Promise.race([turn, expired, ...(watchLeft ? [left.promise.then(() => "left")] : [])]);
      // another request carries the same call now (a retry with its rid): keep its place
      if (outcome === "left" && !left.gone()) {
        watchLeft = false;
        continue;
      }
      return outcome;
    }
  } finally {
    clearTimeout(timer);
  }
}
class NotRun extends Error {}
async function inTurn(agent, run, left = null) {
  const label = agent || "tool";
  figmaQueue.waiting.push(label);
  pushQueue();
  let release = null;
  let call = null;
  let holding = false;
  const deadline = Date.now() + QUEUE_MAX;
  try {
    // (a model job works through the MCP itself: its calls are an agent's, waiting for it to end
    // would be waiting for themselves)
    if (agent) {
      while ((job && !jobAgent) || staging) {
        if (left?.gone()) throw new NotRun("caller left while a build held Figma — nothing ran");
        if (Date.now() > deadline) throw new NotRun(`Figma busy with ${job ?? "a staged frame"} for ${Math.round(QUEUE_MAX / 1000)}s — nothing ran, retry later`);
        await sleep(400);
      }
    }
    const previous = figmaTail;
    figmaTail = new Promise((r) => (release = r));
    const outcome = await waitTurn(previous, deadline, left);
    if (outcome !== "turn") {
      // the line keeps its order: this place frees once the one before it has
      const free = release;
      release = null;
      previous.then(free);
      throw new NotRun(
        outcome === "left"
          ? "caller left before its turn — nothing ran"
          : `Figma held by ${figmaQueue.holder ?? "another call"} for ${Math.round(QUEUE_MAX / 1000)}s — nothing ran, retry later`,
      );
    }
    figmaQueue.waiting.splice(figmaQueue.waiting.indexOf(label), 1);
    figmaQueue.holder = label;
    holding = true;
    pushQueue();
    call = run();
    return await call;
  } finally {
    if (!holding) {
      const at = figmaQueue.waiting.indexOf(label);
      if (at >= 0) figmaQueue.waiting.splice(at, 1);
    }
    const done = () => {
      if (holding && figmaQueue.holder === label) figmaQueue.holder = null;
      if (release) release();
      pushQueue();
    };
    if (call?.finished) call.finished.then(done);
    else done();
  }
}

const notes = createNotes({
  send: sendPlugin,
  call: (method, params, timeout) => inTurn(null, () => callPlugin(method, params, timeout)),
  panelOpen: pluginOpen,
  log,
});

function settle(response) {
  const entry = pending.get(response.id);
  if (!entry) return;
  pending.delete(response.id);
  clearTimeout(entry.timer);
  if (entry.late) log(`${entry.method}: late answer from Figma (${response.ok ? "ok" : "error"}), the line moves on`);
  else if (response.ok) entry.resolve(response.result);
  else entry.reject(new Error(response.error || "plugin error"));
  entry.finish();
}

function dropPending(reason) {
  for (const [id, entry] of pending) {
    pending.delete(id);
    clearTimeout(entry.timer);
    if (!entry.late) entry.reject(new Error(reason));
    entry.finish();
  }
}

const handle = async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);

  const json = (status, body) => {
    const payload = JSON.stringify(body);
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(payload),
    });
    response.end(payload);
  };
  json.raw = (status, type, buf) => {
    response.writeHead(status, { "content-type": type, "content-length": buf.length, "cache-control": "no-store" });
    response.end(buf);
  };

  if (!hostAllowed(request.headers.host)) {
    log(`${request.method} ${url.pathname}: host refused (${request.headers.host ?? "missing"})`);
    json(403, { error: "host refused" });
    return;
  }

  // an image file downloaded by a web tool, read by the plugin itself (raw bytes, never inside
  // an exec): only img-* files of a web-build-img directory in this repo
  if (request.method === "GET" && url.pathname === "/img") {
    const p = resolve(url.searchParams.get("p") || "");
    const type = { png: "image/png", jpg: "image/jpeg", gif: "image/gif" }[p.split(".").pop()];
    if (!p.startsWith(ROOT) || !/\/web-build-img\/([\w-]+\/)*img-[\w-]+\.(png|jpg|gif)$/.test(p) || !type || !existsSync(p)) {
      json(404, { error: "unknown image" });
      return;
    }
    const b = readFileSync(p);
    response.writeHead(200, { "content-type": type, "content-length": b.length, "access-control-allow-origin": "*" });
    response.end(b);
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    json(200, {
      ok: true,
      plugin: pluginOpen(),
      pluginSince,
      selection,
      selectionAt,
      pending: pending.size,
      ...bridgeInfo(),
      busy: busy(),
      links: links(),
    });
    return;
  }

  const readJson = async (limit, hint = "split the call") => {
    // Bytes, not characters: the limit is what crosses the wire, and a multi-byte character
    // split across two chunks is decoded whole once the body is in
    const parts = [];
    let size = 0;
    // An oversized body is read to its end and dropped: leaving the loop early destroys the
    // request, and the next call on the same kept-alive connection then waits 6 s and fails.
    let tooLarge = false;
    for await (const chunk of request) {
      if (tooLarge) continue;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        parts.length = 0;
      } else parts.push(chunk);
    }
    if (tooLarge) {
      log(`${url.pathname}: body too large (> ${limit} bytes)`);
      const cap = limit >= 1_000_000 ? `${Math.round(limit / 1_000_000)} MB` : `${Math.round(limit / 1000)} KB`;
      json(413, { error: `body too large (over ${cap}) — ${hint}` });
      return null;
    }
    const body = Buffer.concat(parts).toString("utf8");
    try {
      return JSON.parse(body || "{}");
    } catch {
      json(400, { error: "invalid JSON" });
      return null;
    }
  };

  // hello: who is there and with which code. A local client sends no Origin and names its role;
  // the extension is known by its pinned Origin alone; any other Origin is a web page.
  if (request.method === "POST" && url.pathname === "/hello") {
    const origin = request.headers.origin;
    if (origin !== undefined && (!EXTENSION_ORIGIN || origin !== EXTENSION_ORIGIN)) {
      json(403, { error: "origin refused" });
      return;
    }
    const payload = await readJson(2000);
    if (!payload) return;
    const role = origin === undefined ? payload.role : "extension";
    if (origin === undefined && !PEER_ROLES.has(role)) {
      json(400, { error: "unknown role" });
      return;
    }
    const known = peerOn(role);
    peers.set(role, { at: Date.now(), version: typeof payload.version === "string" ? payload.version.slice(0, 40) : null });
    if (!known) {
      log(`hello ${role}${payload.version ? " " + String(payload.version).slice(0, 40) : ""}`);
      pushLinks();
    }
    json(200, { ok: true, bridge: bridgeInfo(), links: links(), job, ...(role === "extension" ? { extension: extensionVersion() } : {}) });
    return;
  }

  // browser extension: a capture made in the page → web-to-figma on the file open in Figma
  if (url.pathname === "/stage" || url.pathname === "/capture" || url.pathname === "/job" || url.pathname === "/mobile") {
    // Dia's service worker sends no Origin on GET: /job is read-only and a page's no-cors GET
    // gets an opaque reply, so a missing Origin is accepted there only
    const origin = request.headers.origin;
    const readOnly = request.method === "GET" && url.pathname === "/job" && origin === undefined;
    if (!EXTENSION_ORIGIN || (origin !== EXTENSION_ORIGIN && !readOnly)) {
      log(`${request.method} ${url.pathname}: origin refused (${origin ?? "missing"})`);
      json(403, { error: "origin refused" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/job") {
      json(200, { job, last: lastStatus, plugin: pluginOpen(), boot: BOOT });
      return;
    }
    if (request.method === "POST" && url.pathname === "/stage") {
      const payload = await readJson(10_000);
      if (!payload) return;
      const result = await onStage(payload);
      // refusals and cancels logged: the page overlay is the only other place they show
      if (result.error || payload.cancel) log(`stage ${payload.cancel ? "cancelled by the page" : "refused: " + result.error}`);
      json(result.error ? 409 : 200, result);
      return;
    }
    if (request.method === "POST" && url.pathname === "/capture") {
      const payload = await readJson(MAX_CAPTURE, "pick fewer blocks, or send the page without its screenshot");
      if (!payload) return;
      const result = await onCapture(payload);
      if (result.error) log(`capture refused: ${result.error}`);
      json(result.error ? 409 : 200, result);
      return;
    }
    if (request.method === "POST" && url.pathname === "/mobile") {
      const payload = await readJson(10_000);
      if (!payload) return;
      const result = await onMobile(payload);
      if (result.error) log(`mobile refused: ${result.error}`);
      json(result.error ? 409 : 200, result);
      return;
    }
  }

  if (request.method === "POST" && url.pathname === "/rpc") {
    if (request.headers.origin !== undefined) {
      json(403, { error: "origin refused" });
      return;
    }
    const payload = await readJson(1_000_000);
    if (!payload) return;
    const method = payload.method;
    if (typeof method !== "string") {
      json(400, { error: "method missing" });
      return;
    }
    // A cached selection answers without waking the plugin.
    if (method === "selection" && payload.cached && selection) {
      json(200, { result: selection, cached: true, at: selectionAt });
      return;
    }
    // `rid`: a client that resends a call it is not sure went through (connection reset) gets
    // the first one's outcome, the call never runs twice
    const rid = typeof payload.rid === "string" && payload.rid ? payload.rid.slice(0, 80) : null;
    const seen = rid ? recentCalls.get(rid) : null;
    if (seen) {
      seen.watchers++;
      const { status: code, body } = await seen.outcome;
      json(code, { ...body, replay: true });
      return;
    }
    let gone = false;
    let hungUp;
    const record = rid ? { watchers: 0, at: Date.now(), outcome: null } : null;
    const left = {
      promise: new Promise((r) => (hungUp = r)),
      gone: () => gone && !(record && record.watchers > 0),
    };
    response.on("close", () => {
      if (!response.writableFinished) {
        gone = true;
        hungUp();
      }
    });
    const outcome = rpcOutcome(method, payload.params, left);
    if (record) {
      record.outcome = outcome;
      recentCalls.set(rid, record);
      for (const [key, r] of recentCalls) if (Date.now() - r.at > RID_TTL) recentCalls.delete(key);
      // a call that never ran may be sent again for real
      outcome.then((o) => o.notRun && recentCalls.get(rid) === record && recentCalls.delete(rid));
    }
    const { status: code, body } = await outcome;
    json(code, body);
    return;
  }

  if (await notes.http(request, url, json, readJson)) return;

  json(404, { error: "unknown: " + url.pathname });
};

// The outcome of one /rpc call, as { status, body, notRun }
async function rpcOutcome(method, rawParams, left) {
  inflight++;
  try {
    // a note id on a write: the plugin captures a revert, stored behind the note's Undo
    let params = rawParams;
    const noteId = params && typeof params === "object" && (method === "apply" || method === "exec" || method === "text") && params.note != null ? String(params.note) : null;
    // `revert: true` with no note: the caller keeps the patch itself (tools/stress, scripts)
    const ownRevert = !noteId && params && typeof params === "object" && params.revert === true;
    if (params && typeof params === "object" && "note" in params) {
      const { note, ...rest } = params;
      params = noteId ? { ...rest, revert: true } : rest;
    }
    const timeout =
      method === "read" || method === "expand"
        ? READ_TIMEOUT
        : method === "exec"
        ? EXEC_TIMEOUT
        : DEFAULT_TIMEOUT;
    const agent = params && typeof params === "object" && typeof params.agent === "string" ? params.agent.slice(0, 40) : null;
    try {
      await pluginSoon();
      const result = FREE_METHODS.has(method)
        ? await callPlugin(method, params, timeout)
        : await inTurn(agent, () => callPlugin(method, params, timeout), left);
      if (result && typeof result === "object" && "revert" in result) {
        if (noteId) {
          // Say what really happened: an agent told "kept" stops worrying about Undo
          const kept = notes.addRevert(noteId, result.revert);
          result.undo =
            kept === "kept"
              ? `kept on note #${noteId}`
              : kept === "missing"
              ? `not kept: note #${noteId} not found — the change is in the file, Cmd+Z in Figma undoes it`
              : `nothing to keep on note #${noteId}: no revertible change`;
          // A script reached past what the log kept: the agent must hear it where it reads Undo
          if (result.undoGap) {
            result.undo += ` — ${result.undoGap}`;
            delete result.undoGap;
          }
        }
        if (!ownRevert) delete result.revert;
      }
      return { status: 200, body: { result } };
    } catch (error) {
      const message = String(error.message || error);
      const notRun = error instanceof NotRun || message === "plugin disconnected";
      return { status: notRun ? 503 : 502, body: { error: message }, notRun };
    }
  } finally {
    inflight--;
  }
}

// One bad request (unparsable path, client gone mid-upload, unwritable file) ends in an answer:
// an unhandled rejection would kill the bridge, and every client with it
const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    log(`${request.method} ${request.url} : ${error.message || error}`);
    if (response.headersSent) response.destroy();
    else response.writeHead(500, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify({ error: String(error.message || error) }));
  });
});

// Text pasted in the plugin goes to the first route that takes it; anything else is refused.
// A route runs a repo tool against the file open in Figma, one job at a time, its output
// lines shown in the plugin as they come.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ROUTES = [
  { name: "web-to-figma", match: (t) => /^https?:\/\/\S+$/.test(t), args: (t, file, mobile) => ["tools/web-to-figma.mjs", t, "--file", file, ...(mobile ? ["--width", "430"] : [])] },
];
let job = null;
// the running job's process group (its own tools run under it) and whether a stop was asked
let jobChild = null;
let jobStopped = false;
// the running job is a model run (tools/autofix.mjs), not a build: agents' calls go through
let jobAgent = false;
let lastStatus = null;
// frames built and waiting for their self-correction
const toCorrect = [];

function status(text, done = false) {
  lastStatus = { text, done, at: Date.now() };
  sendPlugin({ type: "status", text, done });
}

// A model run (tools/autofix.mjs) has no end of its own: past this it is killed, the slot freed
const AUTOFIX_LIMIT = Number(process.env.ANGELO_AUTOFIX_TIMEOUT) || 10 * 60 * 1000;

// Runs one repo tool against the file open in Figma; null when started, else the reason.
// `next`: a job to start once this one ends unstopped (desktop then phone)
// `limit`: ms after which the job is killed with its tools; what was queued behind it still runs
async function runJob(name, args, next, limit) {
  if (job) return `busy: ${job}`;
  let file;
  try {
    // a plugin that is reconnecting (bridge just restarted, plugin just reloaded) is waited for
    await pluginSoon();
    if (job) return `busy: ${job}`;
    file = (await callPlugin("ping", {}, DEFAULT_TIMEOUT)).file;
  } catch (error) {
    return String(error.message || error);
  }
  if (job) return `busy: ${job}`;
  const argv = args(file);
  // the npm package ships the bridge without the repo's tools
  if (!existsSync(join(ROOT, argv[0]))) return `${name}: only in the Angelo repository`;
  job = name;
  jobAgent = argv[0] === "tools/autofix.mjs";
  log(job);
  status(`${name}…`);
  const t0 = Date.now();
  // detached: its own process group, so a stop kills the tools it runs too (capture, build, compare)
  const child = spawn(process.execPath, argv, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true });
  jobChild = child;
  jobStopped = false;
  let last = "";
  let error = "";
  let ended = false;
  let built = null;
  let timedOut = false;
  let timer = null;
  const kills = [];
  const onLine = (raw) => {
    const line = raw.trim();
    if (!line) return;
    log(`  ${line}`);
    const frame = /^frame (\d+:\d+) in Figma/.exec(line);
    if (frame) built = frame[1];
    // a crash ends on node's version line: the thrown error is the line worth showing
    if (/^\w*Error\b/.test(line)) error = line;
    status((last = line));
  };
  // a chunk can end mid-line: the rest waits for the next chunk (or the end)
  const reader = () => {
    let carry = "";
    const read = (chunk) => {
      const parts = (carry + String(chunk)).split("\n");
      carry = parts.pop();
      parts.forEach(onLine);
    };
    read.flush = () => {
      if (carry) onLine(carry);
      carry = "";
    };
    return read;
  };
  const out = reader();
  const err = reader();
  child.stdout.on("data", out);
  child.stderr.on("data", err);
  // a spawn that fails may never reach "close": the job slot must free itself either way
  const end = (code) => {
    if (ended) return;
    ended = true;
    out.flush();
    err.flush();
    clearTimeout(timer);
    kills.forEach(clearTimeout);
    job = null;
    jobChild = null;
    log(`${name} exit ${code}${jobStopped ? " (stopped)" : timedOut ? " (timeout)" : ""}`);
    // a job that dies before its build leaves the staged frame's cursor held
    if (code !== 0) releaseCursor();
    const s = ((Date.now() - t0) / 1000).toFixed(1);
    // self-correction is part of web-to-figma (skill step 6): every built frame is checked then
    // fixed in place once the build chain (desktop, then phone) is over; a stop drops the queue
    if (jobStopped) toCorrect.length = 0;
    else if (built && name.startsWith("web-to-figma")) toCorrect.push({ id: built, name });
    const chained = next && !jobStopped;
    const correct = !chained && !jobStopped && toCorrect.length > 0;
    status(jobStopped ? `stopped after ${s} s` : timedOut ? `${name.split(" ")[0]} timed out after ${Math.round(limit / 1000)} s: killed, the frame stays as it was` : code === 0 ? `done in ${s} s` : `failed (${code}): ${error || last}`, !chained && !correct);
    if (chained) next().then((refused) => refused && status(refused, true));
    else if (correct) onCheck(toCorrect.shift(), null).catch((e) => status(`autofix: ${e.message || e}`, true));
  };
  child.on("error", (e) => {
    error = e.message;
    end(1);
  });
  child.on("close", end);
  if (limit > 0) {
    timer = setTimeout(() => {
      if (ended) return;
      timedOut = true;
      log(`${name}: no end after ${Math.round(limit / 1000)} s, killing its process group`);
      const group = -child.pid;
      try { process.kill(group, "SIGTERM"); } catch {}
      // deaf to SIGTERM, or a grandchild keeping the pipes open ("close" never comes): killed for
      // good, and the slot freed whatever the streams do
      kills.push(setTimeout(() => {
        try { process.kill(group, "SIGKILL"); } catch {}
        kills.push(setTimeout(() => end(null), 1000));
      }, 3000));
    }, limit);
  }
  return null;
}

// The cursor a staged frame or a dead job left held: freed in turn, never on top of a running call
const releaseCursor = () => inTurn(null, () => callPlugin("exec", { code: "H.release();" }, DEFAULT_TIMEOUT)).catch(() => {});

// Stop from the plugin: the running job and every tool under it, the bridge stays up. A frame
// being staged (capture still in the page) only gets its cursor released
async function onStop() {
  if (jobChild) {
    jobStopped = true;
    log("stop requested from the plugin");
    const group = -jobChild.pid;
    try { process.kill(group, "SIGTERM"); } catch {}
    // a tool deaf to SIGTERM (a sync exec waiting on Figma) is killed for good 3 s later
    const child = jobChild;
    setTimeout(() => { if (jobChild === child) try { process.kill(group, "SIGKILL"); } catch {} }, 3000);
    return;
  }
  if (staging) await staging;
  releaseCursor();
  status("nothing running in the bridge (a capture in the page stops from the page)", true);
}

// the page at phone width, captured headless (the browser tab cannot render as a phone); blocks picked
// in the tab = the same blocks at phone width (--part), rebuilt in the `<host> · 430` frame when it holds them
const runMobile = (url, part) => {
  const picked = typeof part === "string" ? part.trim() : "";
  return runJob(`web-to-figma ${url} (mobile${picked ? ` · ${picked}` : ""})`, (file) => [...ROUTES[0].args(url, file, true), ...(picked ? ["--part", picked] : [])]);
};

async function onMobile({ url, part }) {
  try {
    new URL(url);
  } catch {
    return { error: "invalid url" };
  }
  const refused = await runMobile(url, part);
  return refused ? { error: refused } : { ok: true };
}

async function onPaste(text, mobile) {
  const route = ROUTES.find((r) => r.match(text));
  if (!route) return status("not a URL: nothing to do", true);
  const refused = await runJob(`${route.name} ${text}${mobile ? " (mobile)" : ""}`, (file) => route.args(text, file, mobile));
  if (refused) status(refused, refused.startsWith("busy") ? false : true);
}

// The web case a built frame comes from, read off its name (`host[/path][ · part]`, phone build
// `host · 430`): its capture folder, or null when the frame is no web-to-figma build
const webCaseOf = (name) => {
  const m = /^([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\/\S*)?(?: · (\d{3,4}))?(?: · |$)/i.exec(String(name).trim());
  if (!m) return null;
  const base = join(ROOT, "tests/web", caseName(m[1]) + (m[2] ? `-${m[2]}` : ""));
  // a frozen case (expect.json) keeps its capture: the latest run sits in last/
  const dir = existsSync(join(base, "expect.json")) && existsSync(join(base, "last/capture.json")) ? join(base, "last") : base;
  return existsSync(join(dir, "capture.json")) && existsSync(join(dir, "page.jpg")) ? dir : null;
};

// The panel's check on one selected frame: a web build is fixed in place against its capture by
// tools/web-fix.mjs (deterministic, seconds: sizes, alignment, spacing, page height and fill), which
// then runs the compare (missing images placed again); only what it leaves off (fix.json `rest`, with
// node ids) goes to Claude (autofix --issues). Anything else is checked by the plugin itself (`web: false`)
const FIX_REST_MAX = 20; // lines of fix.json `rest` sent to Claude at most
async function onCheck({ id, name }, ws) {
  // the reference is contextual: the page frame the node sits in (its top-level ancestor) names the web case
  let top = null;
  if (typeof id === "string") {
    try {
      const code = `const n = await figma.getNodeByIdAsync(${JSON.stringify(id)}); let t = n; while (t.parent && t.parent.type !== "PAGE") t = t.parent;
const a = n.absoluteBoundingBox, b = t.absoluteBoundingBox;
return { id: t.id, name: t.name, box: a && b ? [a.x - b.x, a.y - b.y, a.width, a.height].map(Math.round) : null };`;
      top = (await inTurn(null, () => callPlugin("exec", { code, label: "check · reference" }, DEFAULT_TIMEOUT))).value || null;
    } catch {}
  }
  const dir = top && webCaseOf(top.name);
  if (!dir) {
    if (ws) return ws.send(JSON.stringify({ type: "check", web: false }));
    // queued after a build but no case to compare against (no page.jpg): the next one, or done
    status(`autofix skipped: no reference for ${top?.name ?? id}`, !toCorrect.length);
    if (toCorrect.length) return onCheck(toCorrect.shift(), null);
    return;
  }
  // what the fixer could not settle, a short list with its nodes: the only thing worth a model run
  const rest = async () => {
    let left = [];
    try {
      left = JSON.parse(readFileSync(join(dir, "fix.json"), "utf8")).rest || [];
    } catch {}
    if (left.length) return runJob(`autofix ${name}`, (file) => ["tools/autofix.mjs", "--file", file, "--root", top.id, "--case", dir, "--issues", JSON.stringify(left.slice(0, FIX_REST_MAX))], null, AUTOFIX_LIMIT);
    if (toCorrect.length) return onCheck(toCorrect.shift(), null).then(() => null);
    status(`${top.name}: matches the capture`, true);
    return null;
  };
  const refused = await runJob(`auto-correction ${top.name}`, (file) => ["tools/web-fix.mjs", dir, "--file", file, "--root", top.id], rest);
  if (refused) status(refused, true);
}

// What the panel's own check could not settle on a node (lint, # warn with several answers): Claude fixes it
async function onFix({ id, name, issues }) {
  if (typeof id !== "string" || !Array.isArray(issues) || !issues.length) return status("fix: nothing to send", true);
  const list = JSON.stringify(issues.map(String).slice(0, 60));
  const refused = await runJob(`fix ${name}`, (file) => ["tools/autofix.mjs", "--file", file, "--root", id, "--issues", list], null, AUTOFIX_LIMIT);
  if (refused) status(refused, true);
}

// Figma frame name: the host, plus the picked blocks when only part of the page is sent
// host + path (another page of the same site gets its own frame; the home stays the host alone)
// + the picked blocks: the same page and section sent again replaces its frame
const frameName = (url, part) => {
  const u = new URL(url);
  const path = u.pathname.replace(/\/+$/, "");
  // (a lone % in a path is no escape sequence: kept as is)
  const page = u.hostname + (() => { try { return decodeURIComponent(path); } catch { return path; } })();
  return typeof part === "string" && part.trim() ? `${page} · ${part.trim().slice(0, 120)}` : page;
};

// { url, width } from the extension as soon as Go is clicked: the empty frame and the held
// cursor show in Figma while the page still scrolls and captures. web-to-figma's own stagePage
// then takes that frame over (same name). Nothing held is left behind on a cancel: { cancel }.
let staging = null;
async function onStage({ url, part, width, cancel }) {
  if (cancel) {
    // a job running owns the cursor now (its first cursor replaced the held one): nothing to release
    if (job) return { ok: true };
    // the stage exec may still be placing the frame: a release sent before its hold() would be
    // a no-op and leave the cursor held for good
    if (staging) await staging;
    releaseCursor();
    status("capture cancelled in the page", true);
    return { ok: true };
  }
  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return { error: "invalid url" };
  }
  if (!Number.isFinite(width) || width < 100 || width > 10000) return { error: "invalid width" };
  if (job) return { error: `busy: ${job}` };
  // a second stage (another tab) would overwrite `staging` and its finally would clear the
  // first one's: one staged frame at a time, like one job at a time
  if (staging) return { error: "busy: a frame is being staged" };
  let file;
  try {
    await pluginSoon();
    file = (await callPlugin("ping", {}, DEFAULT_TIMEOUT)).file;
  } catch (error) {
    return { error: String(error.message || error) };
  }
  if (job) return { error: `busy: ${job}` };
  if (staging) return { error: "busy: a frame is being staged" };
  staging = stagePage(makeRpc(file), { name: frameName(url, part), width: Math.round(width), keep: true })
    .catch((error) => log(`stage: ${error.message || error}`))
    .finally(() => (staging = null));
  status(`${host}: frame staged, capturing in the page…`);
  return { ok: true };
}

// { url, capture } from the extension: saved next to the other web cases, then built
async function onCapture({ url, part, capture, shot: given, shotError, mobile }) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return { error: "invalid url" };
  }
  if (!capture || !Array.isArray(capture.boxes)) return { error: "invalid capture" };
  // the page as the browser rendered it (JPEG, base64): web-compare's reference
  // a shot that is no JPEG (empty when the browser could not render the full page) only loses
  // the check: the build itself goes on
  let shot = given;
  if (shotError) log(`screenshot failed on the browser side: ${shotError}`);
  if (shot !== undefined && (typeof shot !== "string" || !shot.startsWith("/9j/"))) {
    log(`screenshot ignored (${typeof shot}, ${String(shot).length} chars, starts with "${String(shot).slice(0, 12)}"): build without check`);
    shot = undefined;
  }
  if (job) return { error: `busy: ${job}` };
  if (capturing) return { error: "busy: a capture is being saved" };
  capturing = true;
  try {
    return await saveAndBuild({ url, part, capture, shot, host, mobile });
  } finally {
    capturing = false;
  }
}

let capturing = false;
async function saveAndBuild({ url, part, capture, shot, host, mobile }) {
  // the frame staged at Go is still being placed: the build takes it over once it is there
  if (staging) await staging;
  if (job) return { error: `busy: ${job}` };
  // a frozen case (expect.json, guarded by web-check) keeps its capture: the run goes beside it
  const base = join(ROOT, "tests/web", caseName(host));
  const dir = existsSync(join(base, "expect.json")) ? join(base, "last") : base;
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "capture.json");
  writeFileSync(path, JSON.stringify({ url, ...capture }));
  const ref = join(dir, "page.jpg");
  if (shot) writeFileSync(ref, Buffer.from(shot, "base64"));
  else rmSync(ref, { force: true });
  const refused = await runJob(`web-to-figma ${url} (extension)`, (file) => ["tools/web-to-figma.mjs", url, "--file", file, "--capture", path, "--name", frameName(url, part), ...(typeof part === "string" && part.trim() ? ["--home", frameName(url, ""), "--part", part.trim()] : [])], mobile === true ? () => runMobile(url, part) : undefined);
  return refused ? { error: refused } : { ok: true, boxes: capture.boxes.length };
}

const sockets = new WebSocketServer({ noServer: true });
const RECONNECT_GRACE = 8000;
let dropTimer = null;
let pluginInstance = null;

server.on("upgrade", (request, socket, head) => {
  let pathname;
  try {
    pathname = new URL(request.url ?? "/", `http://${HOST}:${PORT}`).pathname;
  } catch {}
  if (pathname !== "/plugin") {
    socket.destroy();
    return;
  }
  if (!hostAllowed(request.headers.host)) {
    log(`connection refused (Host: ${request.headers.host ?? "missing"})`);
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  const origin = request.headers.origin;
  if (!originAllowed(origin)) {
    log(`connection refused (Origin: ${origin})`);
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  sockets.handleUpgrade(request, socket, head, (ws) => {
    // One plugin at a time. Taking over the slot would let a third party
    // intercept the calls and answer with fabricated Figma results.
    if (plugin && plugin.readyState === OPEN) {
      log("connection refused (plugin already connected)");
      ws.close(1013, "Plugin already connected");
      return;
    }

    plugin = ws;
    pluginSince = new Date().toISOString();
    pluginVersion = null;
    log("plugin connected");
    ws.send(JSON.stringify({ type: "hello", bridge: bridgeInfo(), links: links() }));
    linksSent = JSON.stringify(links());
    for (const done of [...arrivals]) done();
    notes.push();

    // A socket that died without a close (machine asleep, Figma frozen) would hold the only
    // slot for good: a holder that misses two pings in a row is let go. A live one never is.
    let missed = 0;
    ws.on("pong", () => (missed = 0));
    const beat = setInterval(() => {
      if (ws.readyState !== OPEN) return;
      if (missed >= 2) {
        log("plugin silent (2 pings unanswered): socket closed");
        ws.terminate();
        return;
      }
      missed++;
      try {
        ws.ping();
      } catch {}
    }, HEARTBEAT_MS);

    ws.on("message", (raw) => {
      let frame;
      try {
        frame = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!frame || typeof frame !== "object") return;
      if (frame.type === "response") settle(frame);
      else if (frame.type === "hello") {
        pluginVersion = typeof frame.version === "string" ? frame.version.slice(0, 40) : null;
        log(`hello plugin${pluginVersion ? " " + pluginVersion : ""}`);
        // the same panel back after a drop sends the answers it held; another one (reloaded)
        // never will: the calls of the old one fail now instead of at their timeout
        const instance = typeof frame.instance === "string" ? frame.instance.slice(0, 40) : null;
        clearTimeout(dropTimer);
        dropTimer = null;
        if (pending.size && (!instance || instance !== pluginInstance)) {
          dropPending("plugin reloaded during the call — it may have run in Figma: read before retrying");
        }
        pluginInstance = instance;
        pushLinks();
      } else if (frame.type === "event" && frame.event === "selection") {
        selection = frame.data;
        selectionAt = new Date().toISOString();
      } else if (frame.type === "paste" && typeof frame.text === "string") {
        onPaste(frame.text.trim(), frame.mobile === true).catch((error) => status(`failed: ${error.message || error}`, true));
      } else if (frame.type === "check") {
        onCheck(frame, ws).catch((error) => status(`check failed: ${error.message || error}`, true));
      } else if (frame.type === "fix") {
        onFix(frame).catch((error) => status(`fix failed: ${error.message || error}`, true));
      } else if (frame.type === "stop") {
        onStop().catch((error) => status(`stop failed: ${error.message || error}`, true));
      } else if (typeof frame.type === "string") {
        notes.frame(frame).catch((error) => log(`${frame.type} : ${error.message || error}`));
      }
    });

    ws.on("close", () => {
      clearInterval(beat);
      if (plugin === ws) {
        plugin = null;
        pluginSince = null;
        droppedAt = Date.now();
        log("plugin disconnected");
        // a panel that comes back at once (socket blip, bridge-side reset) answers what it holds
        clearTimeout(dropTimer);
        dropTimer = setTimeout(() => {
          dropTimer = null;
          if (!pluginOpen()) dropPending("plugin disconnected during the call — it may have run in Figma: read before retrying");
        }, RECONNECT_GRACE);
        linksSent = "";
      }
    });

    ws.on("error", () => {});
  });
});

// ---------- life cycle: one bridge per port, replaced cleanly ----------

const busy = () => Boolean(job || staging || capturing || pending.size || inflight);

// Stop without leaving anyone hanging: the running job and its tools end, calls in flight get
// a clear error, the plugin is told why its socket closes (it reconnects by itself).
let closing = false;
function shutdown(reason, code = 0) {
  if (closing) return;
  closing = true;
  log(`stopping: ${reason}`);
  if (jobChild) {
    jobStopped = true;
    try {
      process.kill(-jobChild.pid, "SIGTERM");
    } catch {}
  }
  dropPending(`bridge stopped (${reason})`);
  try {
    if (plugin) plugin.close(1012, "bridge restarting");
  } catch {}
  server.close();
  setTimeout(() => process.exit(code), 150);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (error) => {
  log(`exception : ${error?.stack || error}`);
  shutdown("exception", 1);
});
process.on("unhandledRejection", (error) => log(`unhandled rejection: ${error?.stack || error}`));

// A successor waits for the port its predecessor is leaving; anyone else finding the port
// taken leaves it to the bridge already there.
const TAKEOVER = process.env.ANGELO_TAKEOVER === "1";
let listenTries = 0;
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    if (TAKEOVER && listenTries++ < 50) {
      setTimeout(() => server.listen(PORT, HOST), 100);
      return;
    }
    log(`port ${PORT} already in use — a bridge is probably already running`);
    process.exit(0);
  }
  log("server error:", String(error.message || error));
  process.exit(1);
});

// Source changed under this process: it runs old code. Once nothing is in flight, the new
// code is loaded dry (a syntax error keeps the old bridge up), then a successor takes the port.
const STALE_CHECK_MS = 2000;
let signature = statSignature(WATCHED);
let refused = null; // version that failed its dry load: not tried again until the next change
let handing = false;
function checkStale() {
  if (closing || handing) return;
  const now = statSignature(WATCHED);
  if (now !== signature) {
    signature = now;
    const was = stale;
    stale = diskVersion() !== VERSION;
    if (stale && !was) log(`source changed (${VERSION} → ${diskVersion()}): restarting as soon as nothing is running`);
  }
  if (!stale || busy() || process.env.ANGELO_NO_RESTART === "1") return;
  const target = diskVersion();
  if (target === refused) return;
  handing = true;
  const probe = spawn(process.execPath, [ENTRY], { env: { ...process.env, ANGELO_DRY: "1" }, stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  probe.stderr.on("data", (chunk) => (err = (err + chunk).slice(-2000)));
  probe.on("error", () => (handing = false));
  probe.on("close", (code) => {
    if (code !== 0) {
      refused = target;
      handing = false;
      log(`new code unreadable, the old bridge stays: ${err.trim().split("\n").slice(0, 6).join(" | ")}`);
      return;
    }
    if (busy()) {
      handing = false;
      return;
    }
    spawn(process.execPath, [ENTRY], { detached: true, stdio: "ignore", env: { ...process.env, ANGELO_TAKEOVER: "1" } }).unref();
    shutdown(`taken over by the new code ${target}`);
  });
}
function diskVersion() {
  const extra = process.env.ANGELO_VERSION_EXTRA ? [resolve(process.env.ANGELO_VERSION_EXTRA)] : [];
  return hashFiles([...importGraph(ENTRY), ...extra]);
}

if (DRY) process.exit(0);

setInterval(checkStale, STALE_CHECK_MS).unref();

server.listen(PORT, HOST, () => {
  log(`bridge on http://${HOST}:${PORT} (ws /plugin) · code ${VERSION} · pid ${process.pid}`);
});

// The bridge is spawned detached and would outlive Figma: every 5 min, exit
// once Figma desktop is gone (pgrep exit code 1 = no match). The next MCP
// call respawns it through ensureBridge().
const FIGMA_WATCH_MS = 5 * 60 * 1000;
setInterval(() => {
  spawn("pgrep", ["-x", "Figma"], { stdio: "ignore" }).on("exit", (code) => {
    if (code === 1) shutdown("Figma closed");
  });
}, FIGMA_WATCH_MS).unref();
