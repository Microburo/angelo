// Token cost of what Angelo sends to Claude: the fixtures (serializer output),
// the MCP tool descriptions + schemas (paid on every session) and the skill.
//
//   node tools/tokens.mjs [file…]        extra files are counted after the corpus
//   node tools/tokens.mjs --fixtures     corpus only, no MCP spawn
//
// No tokenizer ships with the project, so the count is an estimate: words up to
// six letters are one token, longer ones one more per six letters, a digit run
// one per three digits, a hex color one per two hex digits, every other symbol
// one, a newline plus its indent one, a plain space none (it glues to the next
// word). Good to ±10 % on this kind of text; chars/3.5 is printed beside it.

import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PIECE = /\n[ \t]*|[ \t]+|#[0-9A-Fa-f]{3,8}\b|[A-Za-z]+|\d+|[^\sA-Za-z\d]/g;

export function estimate(text) {
  let n = 0;
  for (const match of text.matchAll(PIECE)) {
    const piece = match[0];
    if (piece[0] === "\n") n += 1;
    else if (piece[0] === " " || piece[0] === "\t") n += 0;
    else if (piece[0] === "#" && piece.length > 1) n += 1 + Math.ceil((piece.length - 1) / 2);
    else if (/^[A-Za-z]/.test(piece)) n += 1 + Math.floor((piece.length - 1) / 6);
    else if (/^\d/.test(piece)) n += Math.ceil(piece.length / 3);
    else n += 1;
  }
  return n;
}

function row(label, text) {
  const tokens = estimate(text);
  const ratio = Math.round(text.length / 3.5);
  console.log(`${label.padEnd(34)} ${String(tokens).padStart(6)} tok   ${String(ratio).padStart(6)} chars/3.5`);
  return tokens;
}

async function angeloFiles(dir) {
  const out = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await angeloFiles(path)));
    else if (entry.name.endsWith(".angelo")) out.push(path);
  }
  return out;
}

async function report() {
  const args = process.argv.slice(2);
  const fixturesOnly = args.includes("--fixtures");
  const extra = args.filter((arg) => !arg.startsWith("--"));

  console.log("# fixtures");
  const totals = {};
  for (const file of await angeloFiles(join(root, "tests/fixtures"))) {
    const name = file.slice(root.length + 1).replace("tests/fixtures/", "");
    const text = (await readFile(file, "utf8")).replace(/\n+$/, "");
    const group = name.split("/")[0];
    totals[group] = (totals[group] ?? 0) + row(name, text);
  }
  for (const group of Object.keys(totals)) {
    console.log(`${("Σ " + group).padEnd(34)} ${String(totals[group]).padStart(6)} tok`);
  }
  console.log(
    `${"Σ fixtures".padEnd(34)} ${String(Object.values(totals).reduce((a, b) => a + b, 0)).padStart(6)} tok`
  );

  console.log("\n# skill");
  row("skill/SKILL.md", await readFile(join(root, "skill/SKILL.md"), "utf8"));

  if (!fixturesOnly) {
    // The real tool list, as a client sees it: description + input schema.
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const client = new Client({ name: "tokens", version: "0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(root, "bridge/src/mcp.mjs")],
        env: { ...process.env, ANGELO_PORT: "3078" },
      })
    );
    const { tools } = await client.listTools();
    console.log("\n# MCP tools (description + schema, per session)");
    let sum = 0;
    for (const tool of tools) {
      const schema = JSON.stringify(tool.inputSchema);
      sum += row(`${tool.name} (desc)`, tool.description ?? "");
      sum += row(`${tool.name} (schema)`, schema);
    }
    console.log(`${"Σ tools".padEnd(34)} ${String(sum).padStart(6)} tok`);
    await client.close();
  }

  if (extra.length) {
    console.log("\n# extra");
    for (const file of extra) {
      row(file, (await readFile(resolve(file), "utf8")).replace(/\n+$/, ""));
    }
  }
}

// `estimate` is importable on its own; the report runs only as a script.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await report();
}
