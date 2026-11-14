// Round-trip benchmark of the hot paths: MCP → bridge → plugin and back, with a fake
// plugin standing in for Figma (answers at once, so only the channel is timed).
//
//   node tools/bench-rpc.mjs [--root <repo>] [--rounds 300] [--notes 60] [--backoff 5000]
//
// --root: another checkout (a `git worktree` of an older commit) to compare against.
// --notes: notes seeded in the store before the run (0 = empty store).
// --backoff: delay between two connection attempts of the waiting plugin (the panel's cap).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebSocket } from "ws";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const root = resolve(arg("--root", join(dirname(fileURLToPath(import.meta.url)), "..")));
const ROUNDS = Number(arg("--rounds", 300));
const NOTES = Number(arg("--notes", 60));
const BACKOFF = Number(arg("--backoff", 5000));
const PORT = String(3100 + (process.pid % 800));
const BASE = `http://127.0.0.1:${PORT}`;
const data = mkdtempSync(join(tmpdir(), "angelo-bench-"));
const env = { ...process.env, ANGELO_PORT: PORT, ANGELO_DATA: data };

if (NOTES) {
  const items = Array.from({ length: NOTES }, (_, i) => ({
    id: String(i + 1), status: "done", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    fileKey: null, nodes: [{ id: `1:${i}`, name: "Card", type: "FRAME", w: 320, h: 200 }],
    note: "Fix spacing to the 8 pt grid", attachments: [],
    thread: [{ from: "claude", text: "Done.\n- spacing on the 8 pt grid", at: "2026-01-01T00:00:00.000Z" }],
    patch: { set: Array.from({ length: 20 }, (_, k) => ({ id: `1:${k}`, props: { itemSpacing: 16, paddingLeft: 24 } })), remove: [], move: [], swap: [], bind: [], variables: [], text: [] },
  }));
  writeFileSync(join(data, "notes.json"), JSON.stringify({ seq: NOTES, items, skills: [], models: [] }));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = (ms) => {
  const s = ms.slice().sort((a, b) => a - b);
  return { med: s[Math.floor(s.length / 2)], p95: s[Math.floor(s.length * 0.95)] };
};
const rows = [];
const row = (label, ms, unit = "ms") => {
  const { med, p95 } = stats(ms);
  rows.push({ label, med, p95 });
  console.log(`${label.padEnd(34)} ${med.toFixed(2).padStart(8)} ${unit}   p95 ${p95.toFixed(2)}`);
};

async function up() {
  for (let i = 0; i < 400; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {}
    await wait(5);
  }
  throw new Error("bridge did not start");
}
const startBridge = async () => {
  const child = spawn(process.execPath, [join(root, "bridge/src/server.mjs")], { env, stdio: "ignore" });
  await up();
  return child;
};
const stopBridge = (child) => new Promise((r) => (child.on("exit", r), child.kill()));

// ── bridge start: spawn → /health answers
const starts = [];
for (let i = 0; i < 10; i++) {
  const t0 = performance.now();
  const child = await startBridge();
  starts.push(performance.now() - t0);
  await stopBridge(child);
}
row("bridge start", starts);

const bridge = await startBridge();
process.on("exit", () => {
  rmSync(data, { recursive: true, force: true });
});

// ── MCP cold start: spawn → initialize → tools/list
const connectMcp = async () => {
  const client = new Client({ name: "bench", version: "1" }, { capabilities: {} });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, "bridge/src/mcp.mjs")], env, stderr: "ignore" }));
  const { tools } = await client.listTools();
  return { client, tools };
};
const colds = [];
let listBytes = 0;
for (let i = 0; i < 10; i++) {
  const t0 = performance.now();
  const { client, tools } = await connectMcp();
  colds.push(performance.now() - t0);
  listBytes = JSON.stringify(tools).length;
  await client.close();
}
row("mcp cold start (+ tools/list)", colds);

// ── fake plugin: a mid-size read (~1 300 lines), a 10-op diff, a small exec value
const line = (i) => `    FRAME#12:${i} "Card ${i}" wh:320x200 col gap:16 pad:24,16 fill:c.surface.default r:n.radius.md stroke:1 inside c.border.subtle`;
const TREE = Array.from({ length: 1300 }, (_, i) => line(i)).join("\n");
const READ = `angelo/1 units:px file:"Bench" page:"Home" scope:selection(1) nodes:1300 detail:full\n\n# tree\n${TREE}`;
const DIFF = `# applied 10 ops · 10 nodes\n${Array.from({ length: 10 }, (_, i) => line(i)).join("\n")}`;
let pushed = 0;
const plugin = new WebSocket(`ws://127.0.0.1:${PORT}/plugin`);
await new Promise((r) => plugin.on("open", r));
plugin.on("message", (raw) => {
  const frame = JSON.parse(raw);
  if (frame.type !== "request") {
    pushed += 1;
    return;
  }
  const ctx = { file: "Bench", page: "Home" };
  const result =
    frame.method === "read"
      ? { sid: 1, angelo: READ, nodes: 1300, chunks: [], full: true }
      : frame.method === "apply"
      ? { ...ctx, sid: 1, applied: 10, angelo: DIFF }
      : { ...ctx, value: { ok: true, count: 12 }, images: [] };
  plugin.send(JSON.stringify({ type: "response", id: frame.id, ok: true, result }));
});

const { client, tools } = await connectMcp();
const name = (suffix) => tools.find((t) => t.name.endsWith(suffix)).name;
const OPS = Array.from({ length: 10 }, (_, i) => ({ op: "set", id: `12:${i}`, props: "gap:24 pad:32,16 fill:c.surface.raised" }));
const calls = {
  "status (bridge up)": { name: name("_status"), arguments: {} },
  [`read (${Math.round(READ.length / 1000)} KB)`]: { name: name("_read"), arguments: {} },
  "apply (10 set ops)": { name: name("_apply"), arguments: { ops: OPS, sid: 1 } },
  "local_figma_use (small script)": { name: "local_figma_use", arguments: { code: "return figma.currentPage.selection.length" } },
};
for (const [label, call] of Object.entries(calls)) {
  for (let i = 0; i < 30; i++) await client.callTool(call);
  const ms = [];
  for (let i = 0; i < ROUNDS; i++) {
    const t0 = performance.now();
    const out = await client.callTool(call);
    ms.push(performance.now() - t0);
    if (out.isError) throw new Error(`${label}: ${out.content[0].text}`);
  }
  row(label, ms);
}

// ── notes: what an idle watching session sends to the panel, and a write kept on a note
if (tools.some((t) => t.name === "note_wait")) {
  await wait(300);
  pushed = 0;
  const t0 = performance.now();
  await client.callTool({ name: "note_wait", arguments: { timeout_sec: 1 } });
  await wait(9000);
  const sec = (performance.now() - t0) / 1000;
  console.log(`${"idle watching: frames to panel".padEnd(34)} ${String(pushed).padStart(8)} in ${sec.toFixed(0)} s`);
  rows.push({ label: "idle watching: frames to panel", med: pushed, p95: pushed });

  const created = await (await fetch(`${BASE}/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note: "bench" }) })).json();
  const noted = { name: name("_apply"), arguments: { ops: OPS, sid: 1, note: created.id } };
  const ms = [];
  for (let i = 0; i < 100; i++) {
    const t = performance.now();
    await client.callTool(noted);
    ms.push(performance.now() - t);
  }
  row("apply (10 set ops) on a note", ms);
  const steps = [];
  for (let i = 0; i < 100; i++) {
    const t = performance.now();
    await client.callTool({ name: "note_step", arguments: { id: created.id, text: `Placing ${i} of 100` } });
    steps.push(performance.now() - t);
  }
  row("note_step", steps);
}
await client.close();
plugin.close();
await stopBridge(bridge);

// ── no bridge yet: the MCP starts it. Spawn of the MCP → first answer of a tool.
const listening = () => {
  try {
    return execFileSync("lsof", ["-ti", `tcp:${PORT}`, "-sTCP:LISTEN"], { encoding: "utf8" }).split("\n").filter(Boolean).map(Number);
  } catch {
    return [];
  }
};
const killBridge = async () => {
  for (let i = 0; i < 100; i++) {
    const pids = listening();
    if (!pids.length && i > 2) return;
    for (const pid of pids) process.kill(pid);
    await wait(20);
  }
};
process.on("exit", () => listening().forEach((pid) => process.kill(pid)));
const through = [];
for (let i = 0; i < 7; i++) {
  const t0 = performance.now();
  const cold = await connectMcp();
  const out = await cold.client.callTool({ name: name("_status"), arguments: {} });
  through.push(performance.now() - t0);
  if (out.isError) throw new Error(`cold status: ${out.content[0].text}`);
  await cold.client.close();
  await killBridge();
}
row("mcp spawn → status, no bridge", through);

// ── same, with the plugin open in Figma and waiting on its reconnection backoff: the
// first read of a session. The attempt that just failed is the worst case.
const firstOk = [];
let refused = 0;
for (let i = 0; i < 3; i++) {
  let stop = false;
  let socket = null;
  const dial = () => {
    if (stop) return;
    socket = new WebSocket(`ws://127.0.0.1:${PORT}/plugin`);
    socket.on("message", (raw) => {
      const frame = JSON.parse(raw);
      if (frame.type === "request") socket.send(JSON.stringify({ type: "response", id: frame.id, ok: true, result: { sid: 1, angelo: READ, nodes: 1300, chunks: [], full: true } }));
    });
    socket.on("error", () => {});
    socket.on("close", () => setTimeout(dial, BACKOFF));
  };
  dial();
  await wait(50);
  const t0 = performance.now();
  const cold = await connectMcp();
  for (;;) {
    const out = await cold.client.callTool({ name: name("_read"), arguments: {} });
    if (!out.isError) break;
    refused += 1;
    await wait(250);
  }
  firstOk.push(performance.now() - t0);
  stop = true;
  socket.close();
  await cold.client.close();
  await killBridge();
}
row(`mcp spawn → first read ok (${BACKOFF} ms)`, firstOk);
console.log(`${"  reads refused, plugin open".padEnd(34)} ${String(refused).padStart(8)} in 3 runs`);

console.log(`${tools.length} tools · tools/list ${listBytes} chars · ${ROUNDS} rounds · ${NOTES} notes seeded · ${root}`);
process.exit(0);
