// Ported from Retoucher (https://github.com/alicorak/retoucher), MIT License, Copyright (c) 2026 Ali Çorak. See THIRD_PARTY_LICENSES.
// Notes watcher: pushes each new note from the Angelo panel to stdout, one JSON
// line per note, with the path of the Angelo read of its target (Monitor
// truncates long events, so the read itself goes to a file). Meant to run under Claude
// Code's Monitor tool, so the session is woken by notes instead of holding a
// blocking note_wait call. Keeps the panel's "Claude ready" on while it runs.
//
//   node bridge/src/watch.mjs        (npm run notes-watch)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { noteLine } from "./note-line.mjs";
import { figmaRunning, makeClient } from "./client.mjs";

const BASE = `http://127.0.0.1:${Number(process.env.ANGELO_PORT ?? 8787)}`;
const DATA = process.env.ANGELO_DATA || join(homedir(), ".angelo", "notes");
const SEEN = join(DATA, "watch-seen.json"); // survives a re-arm: a note is pushed once
const HOLD = 280000;

const emit = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let seen = {};
try {
  seen = JSON.parse(readFileSync(SEEN, "utf8"));
} catch {}
const saveSeen = () => {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(SEEN, JSON.stringify(seen));
};

async function call(path, body, timeout = 15000, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw new Error(payload.error || `bridge ${response.status}`);
  return payload;
}

const client = makeClient({ role: "watch", entry: fileURLToPath(import.meta.url) });

// Every 4 s: "Claude ready" in the panel, hello to the bridge (role and version), and a look at
// this file's own source, since a watcher cannot swap its code while it runs.
let told = false;
setInterval(() => {
  fetch(`${BASE}/presence`, { method: "POST" }).catch(() => {});
  client.hello().catch(() => {});
  if (!told && client.outdated()) {
    told = true;
    emit({ status: "watch.mjs changed on disk: this watcher runs old code, re-arm it" });
  }
}, 4000);

// A new note is claimed at once (the panel shows Working without waiting for Claude's first
// turn): the bridge gives it an agent (main or a free helper). Then the read of its first
// target, made in that agent's own read session so it voids no other agent's sid, and its
// before picture. Follow-ups carry no read: the agent may be applying on its last one.
// null = all agents busy, the note comes back once one is free.
async function claim(it) {
  let agent = null;
  try {
    agent = (await call(`/notes/${it.id}`, { status: "working" }, 15000, "PATCH")).agent;
  } catch (error) {
    if (/agents busy/.test(error.message)) return null;
  }
  agent = agent || "main";
  if (it.scope === "file" || !it.nodes.length) return { agent, read: null };
  let read = null;
  if (!it.unread) {
    try {
      const { result } = await call("/rpc", { method: "read", params: { target: it.nodes[0].id, agent } }, 120000);
      read = join(DATA, "reads", `${it.id}.angelo`);
      mkdirSync(dirname(read), { recursive: true });
      writeFileSync(read, result.angelo);
    } catch (error) {
      read = `read failed: ${error.message}`;
    }
  }
  try {
    const { result } = await call("/rpc", { method: "export", params: { id: it.nodes[0].id, maxPx: 1600, agent } }, 120000);
    await call(`/notes/${it.id}/snapshot`, { kind: "before", image: result.data });
  } catch {}
  return { agent, read };
}

// A short target goes inline (its tree section only), so a simple note needs no file read.
const INLINE_TREE = 1500;
function inlineTree(path) {
  try {
    const tree = readFileSync(path, "utf8").split("# tree\n")[1];
    return tree && tree.length <= INLINE_TREE ? { tree: tree.trim() } : {};
  } catch {
    return {};
  }
}

// The bridge restarts by itself when its source changes (a second or so): that is retried
// quietly. Only a bridge still away after QUIET is reported, once, and started again here,
// unless Figma is closed (the bridge stops with it, on purpose).
const QUIET = 8000;
let downSince = 0;
let down = false;
for (;;) {
  try {
    const items = await call("/notes/wait", { timeout: HOLD, seen }, HOLD + 10000);
    if (down) emit({ status: "bridge back" });
    down = false;
    downSince = 0;
    for (const it of items) {
      let read = null;
      if (it.status === "pending") {
        const got = await claim(it);
        if (!got) continue;
        it.agent = got.agent;
        read = got.read;
      }
      seen[it.id] = it.status === "pending" ? "claimed" : it.updatedAt;
      emit(read ? { note: noteLine(it), read, ...inlineTree(read) } : { note: noteLine(it) });
    }
    if (items.length) saveSeen();
  } catch (error) {
    if (error.name === "TimeoutError") continue;
    if (!downSince) downSince = Date.now();
    const figma = await figmaRunning();
    if (figma) await client.ensure().catch(() => null);
    if (!down && Date.now() - downSince > QUIET) {
      down = true;
      emit({ status: figma ? "bridge unreachable, retrying" : "Figma closed: bridge stopped, waiting" });
    }
    await sleep(down ? 5000 : 1000);
  }
}
