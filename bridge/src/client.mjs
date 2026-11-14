// What every local client of the bridge shares (MCP, notes watcher): find the bridge, say
// hello, start it when it is absent, and replace one that cannot replace itself.
//
// A current bridge watches its own source and hands over to a successor once idle. A bridge
// started before that existed (no `version` in /health) runs old code for good: it is the
// one case a client ends by pid, and only when nothing is in flight on it.

import { execFile, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeVersion } from "./version.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = join(here, "server.mjs");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (cmd, args) =>
  new Promise((resolve) => execFile(cmd, args, { timeout: 3000 }, (error, stdout) => resolve(error ? "" : String(stdout))));

export const figmaRunning = async () => (await run("pgrep", ["-x", "Figma"])).trim() !== "";

/**
 * @param {{ role: "mcp" | "watch" | "tool", entry: string, port?: number }} options
 * `entry`: the client's own entry file, hashed at start so it can tell when it runs old code.
 */
export function makeClient({ role, entry, port = Number(process.env.ANGELO_PORT ?? 8787) }) {
  const base = `http://127.0.0.1:${port}`;
  const version = codeVersion(entry);

  async function health() {
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  /** The bridge's answer ({ bridge, links, job }), or null: absent, or too old to know hello. */
  async function hello() {
    try {
      const response = await fetch(`${base}/hello`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role, version }),
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  function spawnBridge() {
    spawn(process.execPath, [SERVER], { detached: true, stdio: "ignore", env: process.env }).unref();
  }

  // The bridge listens ~45 ms after its spawn: probe often at first, 3 s in all.
  async function waitUp(accept = () => true) {
    for (let i = 0; i < 40; i++) {
      await sleep(i < 10 ? 20 : 100);
      const state = await health();
      if (state && accept(state)) return state;
    }
    return null;
  }

  // A bridge from before the handshake. Ended only when idle, and only if the process holding
  // the port really is an Angelo bridge.
  async function replaceLegacy(state) {
    if (state.pending) return state;
    try {
      const response = await fetch(`${base}/job`, { signal: AbortSignal.timeout(1500) });
      if (response.ok && (await response.json()).job) return state;
    } catch {}
    const pid = Number((await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])).trim().split("\n")[0]);
    if (!pid || pid === process.pid) return state;
    const command = await run("ps", ["-p", String(pid), "-o", "command="]);
    if (!/bridge\/src\/server\.mjs/.test(command)) return state;
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return state;
    }
    for (let i = 0; i < 30 && (await health()); i++) await sleep(50);
    spawnBridge();
    return (await waitUp((s) => typeof s.version === "string")) ?? (await health());
  }

  // One start at a time: two calls finding no bridge share the same spawn.
  let starting = null;
  /** Health of a bridge that is up and current, started or replaced when needed; null if none. */
  function ensure() {
    if (!starting) {
      starting = (async () => {
        const state = await health();
        if (state) return typeof state.version === "string" ? state : replaceLegacy(state);
        spawnBridge();
        return waitUp();
      })().finally(() => (starting = null));
    }
    return starting;
  }

  /** True once the client's own source changed on disk: it runs old code until restarted. */
  const outdated = () => codeVersion(entry) !== version;

  return { base, version, health, hello, ensure, outdated };
}
