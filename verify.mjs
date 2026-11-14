// Checks the three socket barriers and the response shapes against the real
// bridge + MCP, with a fake plugin standing in for Figma. Needs no Figma.
//
//   node verify.mjs
//
// Ported from figma-local-mcp/verify.mjs and extended to the angelo_* tools.
// The bridge is started here as a controlled child so nothing is left behind;
// the MCP finds it already listening and does not spawn its own.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebSocket } from "ws";
import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = "3077";
const wsUrl = `ws://127.0.0.1:${PORT}/plugin`;
const DATA = mkdtempSync(join(tmpdir(), "angelo-notes-"));
// its own log, a short heartbeat (a mute plugin is let go within the run), and one extra watched
// file: changing it stands for a change of the bridge's source
const LOG = join(DATA, "bridge.log");
const EXTRA = join(DATA, "version-extra.txt");
writeFileSync(EXTRA, "1");
const env = { ...process.env, ANGELO_PORT: PORT, ANGELO_DATA: DATA, ANGELO_LOG: LOG, ANGELO_VERSION_EXTRA: EXTRA, ANGELO_HEARTBEAT: "400" };

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── bridge under our control
const bridge = spawn(process.execPath, [join(here, "bridge/src/server.mjs")], {
  env,
  stdio: ["ignore", "ignore", "pipe"],
});
bridge.stderr.on("data", (d) => process.stdout.write("  [bridge] " + d));

// this very child must be the one listening: a bridge left on the port (old code) would answer
// every check in its place while this one exits quietly
const listening = await new Promise((res) => {
  bridge.stderr.on("data", (d) => /bridge on /.test(d) && res(true));
  bridge.on("exit", () => res(false));
  setTimeout(() => res(false), 3000);
});
if (!listening) {
  console.log(`FAIL  bridge unreachable on 127.0.0.1:${PORT} — port already taken? (lsof -ti :${PORT})`);
  bridge.kill();
  process.exit(1);
}

// bridges started detached during the run (a successor, a replaced legacy bridge): ended by pid
const strays = new Set();
const stop = () => {
  try {
    bridge.kill();
  } catch {}
  for (const pid of strays) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
};
process.on("exit", stop);

// ── MCP in front of it
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(here, "bridge/src/mcp.mjs")],
  env,
  stderr: "pipe",
});
const client = new Client({ name: "verify", version: "1" }, { capabilities: {} });
await client.connect(transport);
transport.stderr?.on("data", (d) => process.stdout.write("  [mcp] " + d));
await wait(200);

// ── 1. bound to 127.0.0.1 only, not reachable from the LAN
const listen = execSync(`lsof -nP -iTCP:${PORT} -sTCP:LISTEN || true`).toString();
check(
  "1. bind 127.0.0.1 only",
  listen.includes("127.0.0.1:" + PORT) && !listen.includes(`*:${PORT}`),
  listen.trim().split("\n").pop()?.trim().slice(-30)
);

const lanIp = execSync("ipconfig getifaddr en0 2>/dev/null || true").toString().trim();
if (lanIp) {
  const lanRefused = await new Promise((res) => {
    const c = new WebSocket(`ws://${lanIp}:${PORT}/plugin`);
    c.on("open", () => res(false));
    c.on("error", () => res(true));
    setTimeout(() => res(true), 1500);
  });
  check("1b. LAN connection refused", lanRefused, `via ${lanIp}`);
}

// ── 2. a web Origin is a third party, never the sandboxed plugin iframe
const originRefused = await new Promise((res) => {
  const c = new WebSocket(wsUrl, { origin: "https://evil.example" });
  c.on("open", () => res(false));
  c.on("error", (e) => res(e.message.includes("403")));
  setTimeout(() => res(false), 1500);
});
check("2. web Origin (evil.example) refused 403", originRefused);

// ── HTTP: a web page may POST to 127.0.0.1 (no preflight for text/plain): /rpc refuses any
// Origin, /capture answers the extension's pinned Origin only
const httpStatus = (path, origin, body) =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method: "POST", headers: origin ? { origin, "content-type": "text/plain" } : {}, body })
    .then((r) => r.status)
    .catch(() => 0);
check("2b. /rpc with a web Origin refused 403", (await httpStatus("/rpc", "https://evil.example", '{"method":"exec"}')) === 403);
check("2c. /capture with a web Origin refused 403", (await httpStatus("/capture", "https://evil.example", "{}")) === 403);
const ext = await (async () => {
  const { createHash } = await import("node:crypto");
  const { readFileSync } = await import("node:fs");
  const { key } = JSON.parse(readFileSync(join(here, "extension/manifest.json"), "utf8"));
  const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return "chrome-extension://" + [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
})();
check("2d. /capture from the extension Origin past the barrier (invalid capture → 409)", (await httpStatus("/capture", ext, '{"url":"https://a.b","capture":{}}')) === 409);

// ── fake plugin: no Origin, like the sandboxed iframe. Answers the Angelo frames.
const FILE = "Demo - site";
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==";

const execs = [];
const execAgents = [];
let inFlight = 0;
let maxInFlight = 0;
function attach(socket) {
  socket.on("message", (data) => {
    const frame = JSON.parse(data);
    if (frame.type !== "request") return;
    const reply = (result) =>
      socket.send(JSON.stringify({ type: "response", id: frame.id, ok: true, result }));
    const ctx = { file: FILE, page: "Home" };
    const params = frame.params || {};

    if (frame.method === "exec") {
      const { code, file } = params;
      execs.push(code);
      execAgents.push(params.agent ?? null);
      // "slow": stays in the plugin 250 ms, to see whether two calls ever overlap
      if (code === "slow") {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return setTimeout(() => {
          inFlight--;
          reply({ ...ctx, value: params.agent ?? null, images: [] });
        }, 250);
      }
      if (file && file !== FILE) {
        return reply({
          ...ctx,
          images: [],
          error: `plugin connected to "${FILE}", expected "${file}"`,
        });
      }
      if (code === "boom") {
        return reply({
          ...ctx,
          images: [],
          error: "x is not defined",
          at: { line: 2, col: 5, src: "x.name = 1" },
        });
      }
      if (code === "shot") {
        return reply({
          ...ctx,
          value: "[image 1: Card]",
          images: [{ label: "Card", data: PNG_1PX }],
        });
      }
      return reply({ ...ctx, value: { ok: code, file: file ?? null }, images: [] });
    }

    if (frame.method === "apply") {
      const ops = params.ops || [];
      // Stands in for the plugin's first pass: an op on a node the read never
      // emitted is refused whole, so nothing is written.
      if (ops.some((op) => op.id === "9:99")) {
        return socket.send(
          JSON.stringify({
            type: "response",
            id: frame.id,
            ok: false,
            error:
              "no change applied — 1 problem(s):\n" +
              "  ops[0]: #9:99 never read in read 1 — run angelo_read or angelo_expand",
          })
        );
      }
      return reply({
        ...ctx,
        sid: 1,
        applied: ops.length,
        angelo: `# applied ${ops.length} ops · 1 nodes\nFRAME#1:2 "Card" at:0,0 wh:320x200 col gap:16`,
        ...(params.revert ? { revert: { set: [{ id: "1:2", props: { opacity: 1 } }], remove: [] } } : {}),
      });
    }

    if (frame.method === "read") {
      return reply({
        sid: 1,
        angelo: `angelo/1 units:px file:"${FILE}" page:"Home" scope:${
          params.target ?? "selection"
        } nodes:2 detail:full\n\n# tree\nFRAME#1:2 "Card" 320x200 col`,
        nodes: 2,
        chunks: [],
        full: true,
      });
    }

    reply({ ...ctx, method: frame.method });
  });
}

const plugin = new WebSocket(wsUrl);
await new Promise((r) => plugin.on("open", r));
attach(plugin);
await wait(100);
check("3. plugin without Origin accepted", plugin.readyState === 1);

// ── 4. local_figma_use: nominal, header, image, error location, file guard
const callExec = (args) => client.callTool({ name: "local_figma_use", arguments: args });

const ok = await callExec({ code: "return 42" });
check(
  "4. nominal exec",
  !ok.isError && ok.content[0].text.includes("return 42"),
  ok.content[0].text.slice(0, 40)
);
check(
  "4b. [file › page] header",
  ok.content[0].text.startsWith(`[${FILE} › Home]\n`),
  ok.content[0].text.split("\n")[0]
);

const shot = await callExec({ code: "shot" });
const img = shot.content.find((c) => c.type === "image");
check(
  "4c. image returned as MCP content",
  !shot.isError && img?.mimeType === "image/png" && img.data === PNG_1PX
);

const boom = await callExec({ code: "boom" });
const bt = boom.content[0].text;
check(
  "4d. error carries line + source + context",
  boom.isError && bt.includes("line 2:5 → x.name = 1") && bt.includes(`[${FILE} › Home]`),
  bt.split("\n")[1]
);

const good = await callExec({ code: "lock", file: FILE });
check("4e. `file` forwarded to the plugin", !good.isError && good.content[0].text.includes(`"file":"${FILE}"`));
const wrong = await callExec({ code: "lock", file: "Other - file" });
check(
  "4f. wrong file → isError",
  wrong.isError && wrong.content[0].text.includes('expected "Other - file"')
);
const badType = await callExec({ code: "x", file: 3 });
check("4g. non-string `file` → isError", badType.isError === true);

// ── 5. the plugin slot cannot be stolen
const hijack = await new Promise((res) => {
  const a = new WebSocket(wsUrl);
  a.on("open", () => a.on("close", (code) => res(code === 1013)));
  a.on("error", () => res(true));
  setTimeout(() => res(false), 1500);
});
check("5. second connection (slot theft) refused 1013", hijack);
const stillOk = await callExec({ code: "after hijack" });
check(
  "5b. legitimate plugin still served",
  !stillOk.isError && stillOk.content[0].text.includes("after hijack")
);

// ── 6. a malformed frame must not take the bridge down
plugin.send("not-json{{{");
await wait(400);
const alive = await callExec({ code: "still alive" });
check("6. malformed JSON: process survives", !alive.isError && alive.content[0].text.includes("still alive"));

// a bad request ends in an answer, never in the bridge's death (an unhandled rejection kills it)
const rawHttp = (text, abortAfter) =>
  new Promise((res) => {
    const s = connect(Number(PORT), "127.0.0.1", () => {
      s.write(text);
      if (abortAfter) setTimeout(() => s.destroy(), abortAfter);
    });
    s.on("close", res);
    s.on("error", res);
    setTimeout(() => s.destroy(), 800);
  });
const bridgeUp = async () => {
  await wait(150);
  return fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.ok).catch(() => false);
};
await httpStatus("/stage", ext, '{"url":"https://x.example/100%","width":1440}');
check("6b. URL with a lone % at /stage: process survives", await bridgeUp());
const staged = execs.find((c) => c.includes("c.hold();"));
check("6b'. /stage leaves an existing frame as it is", !!staged && !staged.includes("k.remove()") && !staged.includes("prev.resize"));
await rawHttp("GET // HTTP/1.1\r\nHost: x\r\n\r\n");
check("6c. unparsable request path: process survives", await bridgeUp());
await rawHttp("GET // HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
check("6d. unparsable upgrade path: process survives", await bridgeUp());
await rawHttp(`POST /capture HTTP/1.1\r\nHost: x\r\nOrigin: ${ext}\r\nContent-Length: 100000\r\n\r\n{"url":`, 100);
check("6e. upload aborted by the client: process survives", await bridgeUp());

// ── 7. input validation (loose schema on purpose → readable isError)
const noArg = await callExec({});
check("7. missing `code` → isError", noArg.isError === true, noArg.content[0].text.slice(0, 50));
const blank = await callExec({ code: "   " });
check("7b. blank `code` → isError", blank.isError === true);

// ── 8. annotations say the tool is destructive
const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
check(
  "8. five angelo tools + 21 note tools exposed",
  names.join(",") ===
    "angelo_apply,angelo_expand,angelo_read,angelo_status,local_figma_use," +
      "note_ask,note_ask_designer,note_check_answer,note_claim,note_comments,note_finish,note_focus,note_fonts," +
      "note_list,note_offer_models,note_offer_skills,note_plan,note_rewrite,note_say,note_show,note_snapshot," +
      "note_split,note_step,note_text,note_undo_patch,note_wait",
  names.join(",")
);
const a = tools.find((t) => t.name === "local_figma_use")?.annotations;
check(
  "8b. annotations exposed",
  a && a.destructiveHint === true && a.readOnlyHint === false && a.openWorldHint === true,
  JSON.stringify(a)
);

// ── 9. the angelo_* family shares the same channel
const read = await client.callTool({ name: "angelo_read", arguments: {} });
check(
  "9. angelo_read over the same plugin",
  !read.isError && read.content[0].text.startsWith("angelo/1 "),
  read.content[0].text.split("\n")[0]?.slice(0, 48)
);
const status = await client.callTool({ name: "angelo_status", arguments: {} });
check(
  "9b. angelo_status reports the plugin connected",
  !status.isError && status.content[0].text.includes("plugin: connected"),
  status.content[0].text.split("\n")[1]
);

const callApply = (args) => client.callTool({ name: "angelo_apply", arguments: args });

const applied = await callApply({ ops: [{ op: "set", id: "1:2", props: { gap: "16" } }] });
check(
  "9c. angelo_apply returns the real diff",
  !applied.isError && applied.content[0].text.includes("# applied 1 ops"),
  applied.content[0].text.split("\n")[1]?.slice(0, 48)
);
check(
  "9d. apply diff carries the [file › page] header",
  applied.content[0].text.startsWith(`[${FILE} › Home]\n`),
  applied.content[0].text.split("\n")[0]
);
const noOps = await callApply({});
check("9e. missing `ops` → isError", noOps.isError === true, noOps.content[0].text.slice(0, 48));
const emptyOps = await callApply({ ops: [] });
check("9f. empty `ops` → isError", emptyOps.isError === true);
const unread = await callApply({ ops: [{ op: "set", id: "9:99", props: { gap: "16" } }] });
check(
  "9g. op on an unread node → readable refusal, nothing written",
  unread.isError === true && /never read in read/.test(unread.content[0].text),
  unread.content[0].text.split("\n")[0]?.slice(0, 48)
);

// ── 10. a stale close must not kill the live client, and errors stay isError
plugin.close();
await wait(300);
let shape = "throw McpError";
const disc = await callExec({ code: "x" }).catch((e) => {
  shape = "McpError: " + e.message;
  return null;
});
if (disc) shape = disc.isError ? "isError" : "neither error nor isError";
check("10. plugin disconnected → isError (not a protocol error)", shape === "isError", shape);
check("10b. actionable message", disc?.content[0].text.includes("Figma Desktop"), disc?.content[0].text);

// ── 11. the plugin can come back after a clean disconnect
const plugin2 = new WebSocket(wsUrl);
const reconnected = await new Promise((res) => {
  plugin2.on("open", () => res(true));
  plugin2.on("error", () => res(false));
  setTimeout(() => res(false), 1500);
});
check("11. plugin reconnection accepted", reconnected);
if (reconnected) {
  attach(plugin2);
  const back = await callExec({ code: "back" });
  check("11b. served again after reconnection", !back.isError && back.content[0].text.includes("back"));
}

// ── 15. notes: HTTP refuses any Origin, the panel follows over the plugin socket
if (reconnected) {
  const B = `http://127.0.0.1:${PORT}`;
  const post = (path, body) =>
    fetch(B + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  const frames = [];
  plugin2.on("message", (d) => {
    const f = JSON.parse(d);
    if (f.type !== "request") frames.push(f);
  });
  const lastNotes = () => frames.filter((f) => f.type === "notes").at(-1);
  check("15a. /notes with a web Origin refused 403", (await httpStatus("/notes", "https://evil.example", '{"note":"x"}')) === 403);
  check("15a'. /permissions with a web Origin refused 403", (await httpStatus("/permissions", "https://evil.example", "{}")) === 403);
  const created = await post("/notes", { note: "Make it blue", nodes: [{ id: "1:2", name: "Card", type: "FRAME" }], fileKey: "k1" });
  await wait(150);
  check("15b. created note pushed to the panel", lastNotes()?.items.some((i) => i.id === created.id && i.note === "Make it blue"));
  const waited = await client.callTool({ name: "note_wait", arguments: { timeout_sec: 2 } });
  check("15c. note_wait returns the waiting note", waited.content[0].text.includes(`#${created.id}`), waited.content[0].text.split("\n")[0]);
  plugin2.send(JSON.stringify({ type: "note-reply", id: created.id, text: "and bigger" }));
  await wait(150);
  const replied = lastNotes()?.items.find((i) => i.id === created.id);
  check("15d. panel reply stored as unread user message", replied?.unread === true && replied.thread.at(-1)?.text === "and bigger");
  const applied = await client.callTool({ name: "angelo_apply", arguments: { ops: [{ op: "set", id: "1:2", props: "op:0.5" }], note: created.id } });
  await wait(150);
  check(
    "15e. apply with a note keeps its revert on the note, not in the reply",
    !applied.isError && applied.content[0].text.includes("undo") && !applied.content[0].text.includes("revert") &&
      lastNotes()?.items.find((i) => i.id === created.id)?.hasPatch === true,
    applied.content[0].text.split("\n")[0]
  );
  const perm = await post("/permissions", { kind: "plan", plan: "1. Blue", noteId: created.id });
  await wait(100);
  check("15f. pending plan pushed to the panel", lastNotes()?.perms.some((p) => p.id === perm.id));
  setTimeout(() => plugin2.send(JSON.stringify({ type: "perm-answer", id: perm.id, decision: "approve" })), 200);
  const answered = await fetch(`${B}/permissions/${perm.id}?wait=3000`).then((r) => r.json());
  check("15g. panel answer releases the held wait", answered.status === "answered" && answered.decision === "approve");

  // Claude Code hooks: prompts go to the panel only while a note is in Working, else the terminal asks
  const runHook = (file, input, port = PORT) =>
    new Promise((res) => {
      const t0 = Date.now();
      const h = spawn(process.execPath, [join(here, "bridge/hooks", file)], { env: { ...process.env, ANGELO_PORT: port } });
      let out = "";
      h.stdout.on("data", (c) => (out += c));
      h.on("close", () => res({ out: out ? JSON.parse(out) : null, ms: Date.now() - t0 }));
      h.stdin.end(JSON.stringify(input));
    });
  const answerNext = (kind, answer) => {
    const timer = setInterval(() => {
      const p = lastNotes()?.perms.find((x) => x.kind === kind && x.status === "pending");
      if (!p) return;
      clearInterval(timer);
      plugin2.send(JSON.stringify({ type: "perm-answer", id: p.id, ...answer }));
    }, 50);
  };
  const bash = { tool_name: "Bash", tool_input: { command: "ls", description: "List files" } };
  const idle = await runHook("permission-hook.mjs", bash);
  check("15i. hook leaves the terminal asking while no note is in Working", idle.out === null, `${idle.ms} ms`);
  await fetch(`${B}/notes/${created.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: '{"status":"working"}' });
  const safe = await runHook("permission-hook.mjs", { tool_name: "mcp__angelo__note_step", tool_input: {} });
  check("15j. angelo note tools allowed without asking", safe.out?.hookSpecificOutput?.decision?.behavior === "allow");
  answerNext("permission", { decision: "once" });
  const once = await runHook("permission-hook.mjs", bash);
  check("15k. permission answered in the panel allows the tool", once.out?.hookSpecificOutput?.decision?.behavior === "allow", `${once.ms} ms`);
  answerNext("question", { decision: "answer", answers: { "Which color?": "Blue" } });
  const asked = await runHook("ask-hook.mjs", { tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Which color?", options: [{ label: "Blue" }] }] } });
  check("15l. panel answers go back as AskUserQuestion input", asked.out?.hookSpecificOutput?.updatedInput?.answers?.["Which color?"] === "Blue");
  const down = await runHook("permission-hook.mjs", bash, "3078");
  check("15m. bridge down: hook stays silent and fast", down.out === null && down.ms < 3000, `${down.ms} ms`);
  plugin2.send(JSON.stringify({ type: "note-undo", id: created.id }));
  await wait(300);
  const undone = lastNotes()?.items.find((i) => i.id === created.id);
  check("15h. panel Undo runs the patch and marks the note reverted", undone?.reverted === true && undone.thread.at(-1)?.from === "system");

  // ── 17. multi-agent: one Figma call at a time, notes spread over main and four helpers
  const rpcCall = (params) =>
    fetch(B + "/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method: "exec", params }) }).then((r) => r.json());
  const patch = (id, body) =>
    fetch(`${B}/notes/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  maxInFlight = 0;
  const t0 = Date.now();
  const runs = await Promise.all(["Berta", "Rosa", "Nora"].map((agent) => rpcCall({ code: "slow", agent })));
  check("17a. three agents' calls never overlap in Figma", maxInFlight === 1 && Date.now() - t0 >= 700, `max ${maxInFlight} at once, ${Date.now() - t0} ms`);
  check("17b. each call answered to its own agent", runs.map((r) => r.result?.value).join() === "Berta,Rosa,Nora");
  check("17c. the panel is told who waits for Figma", frames.some((f) => f.type === "figmaQueue" && f.waiting.length > 0));
  execAgents.length = 0;
  await callExec({ code: "return 1" });
  await callExec({ code: "return 1", agent: "Maximus" });
  check("17d. MCP passes the agent to the plugin, main by default", execAgents.join() === "main,Maximus", execAgents.join());

  for (const it of lastNotes().items) await patch(it.id, { status: "done" });
  const six = [];
  for (let k = 0; k < 6; k++) six.push(await post("/notes", { note: `part ${k}`, nodes: [{ id: "1:2", name: "Card", type: "FRAME" }], fileKey: "k1" }));
  const claims = [];
  for (const n of six) claims.push(await patch(n.id, { status: "working" }).then(async (r) => ({ status: r.status, ...(await r.json()) })));
  check("17e. a lone note goes to main", claims[0].agent === "main", claims[0].agent);
  check("17f. five notes at once → five distinct agents", new Set(claims.slice(0, 5).map((c) => c.agent)).size === 5, claims.slice(0, 5).map((c) => c.agent).join());
  await wait(150);
  check("17g. a sixth note waits (409, stays pending)", claims[5].status === 409 && lastNotes().items.find((i) => i.id === six[5].id)?.status === "pending", `${claims[5].status} ${claims[5].error || ""}`);
  const held = await post("/notes/wait", { timeout: 1000, seen: {} });
  check("17h. the watcher is not handed a note no agent can take", !held.some((i) => i.id === six[5].id));
  await patch(six[1].id, { status: "done" });
  const sixth = await patch(six[5].id, { status: "working" }).then((r) => r.json());
  check("17i. a freed agent takes the waiting note", sixth.agent === claims[1].agent, sixth.agent);
  await patch(six[2].id, { status: "done" });
  await patch(six[3].id, { status: "done" });
  const split = await client.callTool({ name: "note_split", arguments: { id: six[0].id, parts: 3 } });
  check("17j. a split note gets the free helpers only", /\+ \w+, \w+$/.test(split.content[0].text) && !split.content[0].text.includes(claims[4].agent + ","), split.content[0].text);
  for (const n of six) await patch(n.id, { status: "done" });
  const b1 = await post("/notes", { note: "batch a", batchId: "b9", nodes: [], fileKey: "k1" });
  const b2 = await post("/notes", { note: "batch b", batchId: "b9", nodes: [], fileKey: "k1" });
  const a1 = await patch(b1.id, { status: "working" }).then((r) => r.json());
  const a2 = await patch(b2.id, { status: "working" }).then((r) => r.json());
  check("17k. a batch in order stays with one agent", a1.agent && a1.agent === a2.agent, `${a1.agent} / ${a2.agent}`);
  await patch(b1.id, { status: "done" });
  await patch(b2.id, { status: "done" });
  // a simple note in one call: the change call carries the reply
  const quick = await post("/notes", { note: "quick", nodes: [], fileKey: "k1" });
  await patch(quick.id, { status: "working" });
  const one = await callExec({ code: "return 1", note: quick.id, finish: "Done in one call." });
  await wait(150);
  const q = lastNotes().items.find((i) => i.id === quick.id);
  check("17l. finish on a change call marks the note done", q?.status === "done" && /done/.test(one.content[0].text), `${q?.status} · ${one.content[0].text.split("\n")[0]}`);
}

// ── 12. grammar: the pure core (lex / parse / emit / validate)
//
// Imported from the very bundle the plugin ships, so what is checked here is
// the code that really reads and writes Angelo — no second copy of the grammar.
// The negative cases carry the weight: a parser that guesses a token boundary
// would make a patch write to the wrong node.
let grammar = null;
try {
  grammar = await import(join(here, "plugin/dist/angelo.mjs"));
} catch {}

if (!grammar) {
  check("12. grammar loaded", false, "plugin/dist/angelo.mjs missing — `npm run build`");
} else {
  const { emit, nodesOf, parse, validate } = grammar;

  const MIN = [
    'angelo/1 units:px file:"F" page:"P" scope:selection(1) nodes:2 detail:full',
    "",
    "# tree",
    'FRAME#1:2 "a" at:0,0 wh:10x10 col gap:8 pad:4',
    '  TEXT#1:3 "t" at:4,4 wh:2x2 font:TWK Everett Regular 12 fill:#FFF',
    '    + seg:0-1 font:TWK Everett Regular 12 text:"a"',
  ].join("\n");

  const doc = parse(MIN);
  const again = emit(doc);
  check("12. document minimal: round trip identical", again === MIN, again === MIN ? "" : again);
  const clean = validate(doc);
  check("12b. validator silent on a valid document", clean.length === 0, clean.map((p) => p.message).join(" | "));
  check("12c. nodes read", nodesOf(doc).length === 2, String(nodesOf(doc).length));

  const font = nodesOf(doc)[1].tokens.filter((t) => t.key === "font")[0];
  check("12d. greedy value kept whole", font?.value === "TWK Everett Regular 12", font?.value);

  const trap = parse('RECT#1:9 "wh:12 hidden" at:0,0 wh:8x8');
  const trapped = nodesOf(trap)[0];
  check(
    "12e. trap name not re-read as a token",
    trapped.name === "wh:12 hidden" && trapped.tokens.length === 2,
    `${trapped.name} / ${trapped.tokens.length} tokens`
  );

  const over = parse('INST#1:4 "c" ref(cmp.card){size:l,tone:dark} ov{title="A, b: c", icon=swap}');
  const ov = nodesOf(over)[0].tokens.filter((t) => t.key === "ov")[0];
  check(
    "12f. comma inside quotes not split",
    ov?.value === '{title="A, b: c", icon=swap}',
    ov?.value
  );

  // Anything the serializer cannot have written is an error with a line and a
  // column, never a silent guess.
  const refuses = (label, text, needle) => {
    let message = "accepted (no error)";
    try {
      parse(text);
    } catch (error) {
      message = error.message;
    }
    check(label, /^line \d+:\d+ — /.test(message) && message.includes(needle), message);
  };

  refuses("12g. unknown token refused", 'FRAME#1:2 "a" zzz:1', "unknown token");
  refuses("12h. odd indentation refused", 'FRAME#1:2 "a"\n RECT#1:3 "b"', "odd indentation");
  refuses("12i. depth jump refused", 'FRAME#1:2 "a"\n    RECT#1:3 "b"', "indentation jump");
  refuses("12j. unterminated string refused", 'FRAME#1:2 "a', "unterminated string");
  refuses(
    "12k. unbalanced parentheses refused",
    'FRAME#1:2 "a" fill:grad.linear(#FFF',
    "unbalanced parentheses"
  );
  refuses("12l. unknown section refused", "angelo/1 units:px\n\n# zzz\nx = 1", "unknown section");
  refuses("12m. unknown header key refused", "angelo/1 zzz:1", "unknown header key");
  refuses(
    "12n. second banner refused",
    "# chunk 1 of read 7 · in #1:10 · 5 nodes\n\n# chunk 2 of read 7 · in #1:10 · 5 nodes",
    "second banner"
  );
  refuses("12o. \"+\" line without parent refused", '+ seg:0-1 text:"a"', "without a parent node");
  refuses(
    "12p. word after a keyword with no value refused",
    'FRAME#1:2 "a" hidden Regular',
    "takes no value"
  );
  refuses("12q. malformed hole refused", 'FRAME#1:2 "a"\n  <chunk 1 · nodes>', "malformed chunk hole");

  // What the parser can read but the serializer would never write.
  const rejects = (label, text, needle) => {
    const problems = validate(parse(text));
    const joined = problems.map((p) => `${p.where}: ${p.message}`).join(" | ");
    check(label, problems.some((p) => p.message.includes(needle)), joined || "no problem");
  };

  rejects("12r. non-Figma id flagged", 'FRAME#1:2:3 "a" at:0,0', "Figma node id");
  rejects("12s. unknown type flagged", 'ZORG#1:2 "a" at:0,0', "unknown type");
  rejects("12t. duplicate node flagged", 'FRAME#1:2 "a"\nFRAME#1:2 "b"', "present twice");
  rejects("12u. instance with children flagged", 'INST#1:2 "c"\n  TEXT#1:3 "t"', "no children");
  rejects("12v. \"+\" line without seg: flagged", 'TEXT#1:2 "t"\n  + fill:#FFF', "without seg:");
  rejects("12w. repeated key flagged", 'FRAME#1:2 "a" op:0.5 op:0.5', "repeated");
  rejects("12x. at: with a single value flagged", 'FRAME#1:2 "a" at:1', "two numbers");
  rejects("12y. align: outside vocabulary flagged", 'FRAME#1:2 "a" align:top,bottom', "primary,counter");
  rejects("12z. incomplete stroke: flagged", 'FRAME#1:2 "a" stroke:1 inside', "alignment and paint expected");

  // ── 13. write props go through the same validator as a read line, so the two
  // sides of the vocabulary cannot drift apart.
  const { checkProps } = grammar;
  const WRITABLE = new Set(["at", "gap", "fill", "align", "op", "pad", "r", "ref", "ov", "stroke", "strokew"]);
  const props = (values) => checkProps(values, "1:2", WRITABLE);

  check("13. valid props accepted", props({ at: "10,20", gap: "16", fill: "#FFF" }).length === 0);
  const notWritable = props({ vec: "3paths" });
  check(
    "13b. out-of-scope prop refused by name",
    notWritable.length === 1 && /read-only property "vec"/.test(notWritable[0].message),
    notWritable[0]?.message
  );
  const notText = props({ gap: 16 });
  check(
    "13c. non-text value refused",
    notText.length === 1 && /text value expected/.test(notText[0].message),
    notText[0]?.message
  );
  const badShape = props({ at: "10", align: "top,bottom", op: "2" });
  check(
    "13d. invalid shapes flagged one by one",
    badShape.length === 3,
    badShape.map((problem) => problem.message).join(" | ")
  );

  // Spacing and radius carry either a number or the variable the read showed in
  // its place: writing the resolved number back is what unbinds a token, and it
  // has to stay sayable on the same key.
  check(
    "13e. pad / r / gap accept variable labels",
    props({ pad: "s.gap-16,16", r: "n.radius-s", gap: "s.gap-16/8" }).length === 0,
    props({ pad: "s.gap-16,16", r: "n.radius-s", gap: "s.gap-16/8" })
      .map((problem) => problem.message)
      .join(" | ")
  );
  check(
    "13f. pad with three values still refused",
    props({ pad: "1,2,3" }).length === 1
  );
  check(
    "13g. pad with a part outside the vocabulary refused",
    props({ pad: "16,Large" }).length === 1
  );
  check(
    "13h. instance ref / ov accepted",
    props({ ref: "(cmp.button){size:l,state:hover}", ov: '{label="Send", icon=on}' }).length === 0,
    props({ ref: "(cmp.button){size:l}", ov: "{icon=on}" })
      .map((problem) => problem.message)
      .join(" | ")
  );
  check(
    "13i. ref without parentheses refused",
    props({ ref: "cmp.button" }).length === 1
  );
  check(
    "13j. ov without braces refused",
    props({ ov: "label=x" }).length === 1
  );
  // Per-side weights ride on stroke: itself (top,right,bottom,left), the old
  // strokew: key stays accepted for reads captured before.
  check(
    "13k. stroke with one weight or four weights accepted",
    props({ stroke: "1 inside #EBEBEB" }).length === 0 &&
      props({ stroke: "0,0,1,0 inside c.border" }).length === 0 &&
      props({ strokew: "0,0,1,0" }).length === 0
  );
  check(
    "13l. stroke with three weights refused",
    props({ stroke: "0,0,1 inside #EBEBEB" }).length === 1
  );

  // ── 14. `*` line: what every child repeats, said once under the parent. A
  // child line restates a key to differ; tokensOf() is what a line means.
  const { tokensOf } = grammar;
  const STAR = [
    'CMP#3:1045 "Icon / plus" at:0,0 wh:24x24 clip',
    "  * constr:scale,scale stroke:2 center c.text.primary vec:1paths",
    '  VEC#3:1043 "Vector" at:5,12 wh:14x0',
    '  VEC#3:1044 "Vector" at:12,5 wh:0x14 stroke:1 inside #000',
  ].join("\n");
  const star = parse(STAR);
  check("14. \"*\" line: round trip identical", emit(star) === STAR, emit(star));
  const starProblems = validate(star);
  check(
    "14b. validator silent on a valid \"*\" line",
    starProblems.length === 0,
    starProblems.map((p) => p.message).join(" | ")
  );
  const [icon, a, b] = nodesOf(star);
  const say = (tokens) => tokens.map((t) => (t.value === null ? t.key : `${t.key}:${t.value}`)).join(" ");
  check(
    "14c. tokensOf inherits the parent defaults",
    say(tokensOf(a, icon)) ===
      "at:5,12 wh:14x0 constr:scale,scale stroke:2 center c.text.primary vec:1paths",
    say(tokensOf(a, icon))
  );
  check(
    "14d. the child line wins over the default",
    say(tokensOf(b, icon)) ===
      "at:12,5 wh:0x14 stroke:1 inside #000 constr:scale,scale vec:1paths" &&
      a.tokens.length === 2,
    say(tokensOf(b, icon))
  );
  refuses("14e. \"*\" line without parent refused", "* fill:#FFF", "without a parent node");
  refuses(
    "14f. \"*\" line after a child refused",
    'FRAME#1:2 "a"\n  RECT#1:3 "b"\n  * fill:#FFF',
    "after a child"
  );
  refuses(
    "14g. second \"*\" line refused",
    'FRAME#1:2 "a"\n  * fill:#FFF\n  * op:0.5',
    "second \"*\" line"
  );
  rejects("14h. \"*\" line without a child flagged", 'FRAME#1:2 "a"\n  * fill:#FFF', "without a child");
  rejects(
    "14i. invalid value on a \"*\" line flagged",
    'FRAME#1:2 "a"\n  * op:3\n  RECT#1:3 "b"',
    "opacity"
  );
}

// ── 16. hub: hello handshake, link state, heartbeat, log, stale bridge replaced
{
  const B = `http://127.0.0.1:${PORT}`;
  const getHealth = (port = PORT) => fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) }).then((r) => r.json()).catch(() => null);
  const hello = (body, origin) =>
    fetch(`${B}/hello`, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) })
      .then(async (r) => ({ status: r.status, ...(await r.json()) }))
      .catch(() => ({ status: 0 }));
  // a plugin whose frames are kept from the first one on
  const openPlugin = (options) =>
    new Promise((res) => {
      const ws = new WebSocket(wsUrl, options);
      const frames = [];
      let closed = null;
      ws.on("message", (d) => {
        try {
          frames.push(JSON.parse(d));
        } catch {}
      });
      ws.on("close", (code) => (closed = code));
      ws.on("open", () => res({ ws, frames, code: () => closed }));
      ws.on("error", () => res(null));
    });
  const until = async (test, ms = 3000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(50)) {
      const v = await test();
      if (v) return v;
    }
    return null;
  };

  const h0 = await getHealth();
  check("16a. /health names the code version, pid and boot", /^[0-9a-f]{12}$/.test(h0?.version) && h0.pid === bridge.pid && typeof h0.boot === "string" && h0.stale === false, `${h0?.version} pid ${h0?.pid}`);
  check("16b. the MCP said hello by itself: Claude link on", h0?.links?.claude === true && h0.links.bridge === true);
  const local = await hello({ role: "tool", version: "t1" });
  check("16c. hello from a local client answers with the bridge and every link", local.status === 200 && local.bridge?.version === h0?.version && typeof local.links?.plugin === "boolean" && local.extension === undefined);
  check("16d. hello with a web Origin refused 403", (await hello({ role: "mcp" }, "https://evil.example")).status === 403);
  check("16e. hello as the extension without its pinned Origin refused", (await hello({ role: "extension" })).status === 400);

  // the plugin: told the links on connect, then on each change
  plugin2.close();
  await wait(200);
  const p3 = await openPlugin();
  await wait(150);
  const first = p3?.frames.find((f) => f.type === "hello");
  check("16f. plugin greeted on connect with the bridge version and the links", first?.bridge?.version === h0?.version && first.links?.extension === false && first.links.claude === true, JSON.stringify(first?.links));
  const asExt = await hello({ role: "extension", version: "0.1.0" }, ext);
  check("16g. hello from the extension Origin: links + the extension code on disk", asExt.status === 200 && /^[0-9a-f]{12}$/.test(asExt.extension) && asExt.links?.extension === true && asExt.links.plugin === true);
  const pushed = await until(() => p3.frames.find((f) => f.type === "links" && f.links.extension === true), 1500);
  check("16h. a link that changes is pushed to the plugin", Boolean(pushed));
  p3.ws.send(JSON.stringify({ type: "hello", role: "plugin", version: "not-the-build-on-disk" }));
  await wait(200);
  const built = existsSync(join(here, "plugin/dist/build.txt"));
  check("16i. a plugin running another build than the one on disk is flagged", (await getHealth())?.links?.pluginStale === built, built ? "build.txt present" : "no build.txt: not flagged");

  // heartbeat: a socket that stops answering frees the slot, a live one keeps it
  check("16j. a live plugin outlasts the heartbeat", (await wait(1500), p3.ws.readyState === 1 && (await getHealth())?.plugin === true));
  p3.ws.close();
  await wait(200);
  const mute = await openPlugin({ autoPong: false });
  const freed = await until(async () => mute.ws.readyState === 3 && (await getHealth())?.plugin === false, 4000);
  check("16k. a mute plugin (no pong) is let go and the slot freed", Boolean(freed));

  const logText = existsSync(LOG) ? readFileSync(LOG, "utf8") : "";
  check("16l. the bridge log is kept in a file", /bridge on /.test(logText) && /hello mcp/.test(logText) && /plugin silent/.test(logText), LOG);

  // stale bridge: the source changes under it → a successor takes the port, nobody restarts anything
  const p4 = await openPlugin();
  attach(p4.ws);
  const exited = new Promise((res) => bridge.on("exit", () => res(true)));
  writeFileSync(EXTRA, "2");
  const h1 = await until(async () => {
    const h = await getHealth();
    return h && h.version && h.version !== h0.version ? h : null;
  }, 8000);
  if (h1?.pid) strays.add(h1.pid);
  check("16m. source changed: a new bridge answers with the new version", Boolean(h1) && h1.pid !== h0.pid && h1.stale === false, h1 ? `${h0.version} → ${h1.version}` : "no successor");
  check("16n. the old bridge left by itself", (await Promise.race([exited, wait(2000).then(() => false)])) === true);
  check("16o. the plugin was told why its socket closed (1012)", (await until(() => p4.code() === 1012, 1500)) === true, `close code ${p4.code()}`);
  // the panel reconnects on its own timer: here, right away
  const p5 = await until(() => openPlugin(), 3000);
  if (p5) attach(p5.ws);
  const after = p5 ? await callExec({ code: "after-restart" }).catch((e) => ({ isError: true, content: [{ text: String(e.message) }] })) : null;
  check("16p. plugin and MCP served by the successor, nothing restarted by hand", Boolean(after) && !after.isError && after.content[0].text.includes("after-restart"), after?.content?.[0]?.text?.slice(0, 60));
  check("16q. the successor greets the plugin with its own version", p5?.frames.find((f) => f.type === "hello")?.bridge?.version === h1?.version);
  p5?.ws.close();

  // a bridge from before the handshake (no version in /health) cannot replace itself: the MCP does
  const OLD = "3079";
  const legacySrc = `require("http").createServer((q, r) => { const u = q.url.split("?")[0]; const b = u === "/health" ? { ok: true, plugin: false, pending: 0 } : u === "/job" ? { job: null } : null; r.writeHead(b ? 200 : 404, { "content-type": "application/json" }); r.end(JSON.stringify(b || { error: "inconnu" })); }).listen(${OLD}, "127.0.0.1");`;
  // (named like the real one: the MCP only ends a process that is an Angelo bridge)
  const legacy = spawn(process.execPath, ["-e", legacySrc, "bridge/src/server.mjs"], { stdio: "ignore" });
  const legacyGone = new Promise((res) => legacy.on("exit", () => res(true)));
  await until(() => getHealth(OLD), 2000);
  const t2 = new StdioClientTransport({ command: process.execPath, args: [join(here, "bridge/src/mcp.mjs")], env: { ...env, ANGELO_PORT: OLD, ANGELO_LOG: join(DATA, "bridge-old.log") }, stderr: "pipe" });
  const c2 = new Client({ name: "verify-legacy", version: "1" }, { capabilities: {} });
  await c2.connect(t2);
  const st = await c2.callTool({ name: "angelo_status", arguments: {} }).catch(() => null);
  const h2 = await until(async () => {
    const h = await getHealth(OLD);
    return h?.version ? h : null;
  }, 5000);
  if (h2?.pid) strays.add(h2.pid);
  check("16r. a bridge without a version is replaced by the MCP", Boolean(h2) && (await Promise.race([legacyGone, wait(1000).then(() => false)])) === true, st?.content?.[0]?.text?.split("\n")[0]);
  await c2.close();
  try {
    legacy.kill();
  } catch {}
}

await client.close();
stop();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
