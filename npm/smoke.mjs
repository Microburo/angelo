// Smoke test of a packed angelo-mcp tarball, as a user would run it: npx on the tarball, MCP over
// stdio, the bridge started by the first call. Runs on a spare port so a live bridge is untouched.
//
//   node npm/smoke.mjs [npm/dist/angelo-mcp-<version>.tgz] [--port 8799]

import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "dist");
const tgz = resolve(process.argv.slice(2).find((a) => a.endsWith(".tgz")) ?? join(dist, readdirSync(dist).find((f) => f.endsWith(".tgz"))));
const at = process.argv.indexOf("--port");
const port = at > 0 ? process.argv[at + 1] : "8799";
// a fresh npm cache: nothing reused from earlier runs, like a first install
const cache = mkdtempSync(join(tmpdir(), "angelo-smoke-"));

const t0 = Date.now();
const mcp = spawn("npx", ["-y", "--cache", cache, "--package", tgz, "angelo-mcp"], {
  env: { ...process.env, ANGELO_PORT: port },
  stdio: ["pipe", "pipe", "inherit"],
});
let buf = "";
const waiting = new Map();
mcp.stdout.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    waiting.get(msg.id)?.(msg);
  }
});
let next = 1;
const call = (method, params = {}) =>
  new Promise((ok, fail) => {
    const id = next++;
    const timer = setTimeout(() => fail(new Error(`${method}: no answer in 60 s`)), 60000);
    waiting.set(id, (msg) => (clearTimeout(timer), msg.error ? fail(new Error(JSON.stringify(msg.error))) : ok(msg.result)));
    mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });

try {
  await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
  mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const tInit = Date.now() - t0;
  const { tools } = await call("tools/list");
  const status = await call("tools/call", { name: "angelo_status", arguments: {} });
  const text = status.content.map((c) => c.text).join("\n");
  const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.status, () => "down");
  console.log(`init ${tInit} ms (cold npx) · ${tools.length} tools · bridge :${port} → ${health}`);
  console.log(text.split("\n").slice(0, 6).join("\n"));
} catch (error) {
  console.error("FAILED:", error.message);
  process.exitCode = 1;
} finally {
  mcp.kill();
}
