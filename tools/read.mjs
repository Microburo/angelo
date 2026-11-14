#!/usr/bin/env node
// Terminal client for the bridge — used to eyeball density without the MCP.
//
//   node tools/read.mjs                 read the current selection
//   node tools/read.mjs page            read the whole page
//   node tools/read.mjs 1:234           read one node
//   node tools/read.mjs --expand 3      open chunk 3 of the last read
//   node tools/read.mjs --status        bridge + plugin + selection
//   …  --budget 6000                    tokens per chunk
//   …  --quiet                          only the footer (token count)

const PORT = Number(process.env.ANGELO_PORT ?? 8787);
const BASE = `http://127.0.0.1:${PORT}`;

const argv = process.argv.slice(2);
function flag(name) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  argv.splice(index, value && !value.startsWith("--") ? 2 : 1);
  return value ?? true;
}

const status = flag("status");
const expand = flag("expand");
const budget = flag("budget");
const quiet = flag("quiet");
const target = argv[0];

async function call(method, params, extra) {
  const response = await fetch(`${BASE}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params, ...extra }),
  });
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error);
  return payload.result;
}

try {
  if (status) {
    const response = await fetch(`${BASE}/health`);
    console.log(JSON.stringify(await response.json(), null, 2));
  } else if (expand !== undefined) {
    const result = await call("expand", /^\d+$/.test(String(expand)) ? { chunk: Number(expand) } : { id: String(expand) });
    report(result);
  } else {
    const result = await call("read", {
      target: target ?? "selection",
      budget: budget ? Number(budget) : undefined,
    });
    report(result);
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(1);
}

function report(result) {
  const angelo = result.angelo ?? "";
  if (!quiet) console.log(angelo);
  const tokens = Math.ceil(angelo.length / 4);
  const lines = angelo ? angelo.split("\n").length : 0;
  console.error(
    `\n— ${result.nodes ?? "?"} nodes · ${lines} lines · ~${tokens} tokens${
      result.chunks ? ` · ${result.chunks.length} chunks` : ""
    }${result.full ? " · detail:full" : ""}`
  );
}
