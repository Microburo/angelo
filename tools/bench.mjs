// Grammar micro-benchmark: parse → emit → validate over tests/fixtures.
//
//   node tools/bench.mjs [--rounds 200]
//
// Measures the pure TS side of the pipeline (the part that runs without
// Figma). Serialisation itself needs the plugin and is not timed here.

import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { emit, parse, validate } = await import(join(root, "plugin/dist/angelo.mjs"));

const argv = process.argv.slice(2);
const at = argv.indexOf("--rounds");
const ROUNDS = at === -1 ? 200 : Number(argv[at + 1]);

async function fixtures(dir) {
  const out = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await fixtures(path)));
    else if (entry.name.endsWith(".angelo")) out.push(path);
  }
  return out;
}

const texts = [];
for (const file of await fixtures(join(root, "tests/fixtures"))) {
  texts.push((await readFile(file, "utf8")).replace(/\n+$/, ""));
}
const bytes = texts.reduce((n, t) => n + t.length, 0);

function time(label, fn) {
  for (let i = 0; i < 20; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < ROUNDS; i++) fn();
  const ms = (performance.now() - t0) / ROUNDS;
  console.log(`${label.padEnd(10)} ${ms.toFixed(3)} ms/round  (${(bytes / ms / 1000).toFixed(1)} MB/s)`);
}

const docs = texts.map(parse);
time("parse", () => texts.forEach(parse));
time("emit", () => docs.forEach(emit));
time("validate", () => docs.forEach(validate));
time("all", () => texts.forEach((t) => validate(parse(t)) && emit(parse(t))));
console.log(`${texts.length} fixtures · ${bytes} chars · ${ROUNDS} rounds`);
