// Capture a whole page as fixtures: the read, then every chunk it points to.
//
//   node tools/capture.mjs [selection|page|1:234] [out-dir]
//
// The point is coverage, not speed: a roundtrip test is only worth what its
// corpus covers, and the rare forms (overrides, mixed text segments,
// gradients, rotation, masks) only show up in some subtrees. Expanding a chunk
// can open new ones, so we keep asking for the next number until the plugin
// says it does not exist.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] ?? "page";
const out = resolve(process.argv[3] ?? join(root, "tests/fixtures/live"));
const base = process.env.ANGELO_URL ?? "http://127.0.0.1:8787";
const MAX_CHUNKS = 500;

async function rpc(method, params) {
  const response = await fetch(`${base}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  const payload = await response.json();
  if (payload.error) throw new Error(String(payload.error));
  return payload.result;
}

await mkdir(out, { recursive: true });

const read = await rpc("read", { target });
await writeFile(join(out, "read.angelo"), read.angelo);
console.log(`read.angelo — ${read.nodes} nodes, ${read.chunks.length} chunks, sid ${read.sid}`);

let written = 1;
for (let n = 1; n <= MAX_CHUNKS; n++) {
  let chunk;
  try {
    chunk = await rpc("expand", { chunk: n });
  } catch (error) {
    if (/unknown/.test(String(error.message))) break;
    throw error;
  }
  await writeFile(join(out, `chunk-${String(n).padStart(3, "0")}.angelo`), chunk.angelo);
  written++;
}
console.log(`${written} files in ${out}`);
