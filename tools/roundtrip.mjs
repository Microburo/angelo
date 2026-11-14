// Roundtrip test: serialize -> parse -> re-serialize must be identical.
//
// The fixtures in tests/fixtures/ were captured from a real file through
// /rpc, so they are the serializer's own output. Re-emitting them from the
// parsed document and comparing is what keeps the two sides of the grammar
// from drifting: a token the parser mis-splits comes back joined differently,
// and a patch would then write to the wrong place.
//
//   node tools/roundtrip.mjs [file…]

import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(root, "plugin/dist/angelo.mjs");

let grammar;
try {
  grammar = await import(bundle);
} catch {
  console.error("plugin/dist/angelo.mjs missing: run `npm run build` first");
  process.exit(2);
}
const { emit, nodesOf, parse, validate } = grammar;

/** The first line that differs, with its neighbours. */
function firstDiff(expected, actual) {
  const a = expected.split("\n");
  const b = actual.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    return [
      `  line ${i + 1}`,
      `  expected: ${JSON.stringify(a[i] ?? null)}`,
      `  actual  : ${JSON.stringify(b[i] ?? null)}`,
    ].join("\n");
  }
  return "  (identical line by line, different length)";
}

const args = process.argv.slice(2);
async function fixtures(dir) {
  const names = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of names.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await fixtures(path)));
    else if (entry.name.endsWith(".angelo")) out.push(path);
  }
  return out;
}

const files = args.length
  ? args.map((file) => resolve(file))
  : await fixtures(join(root, "tests/fixtures"));

let failed = 0;
for (const file of files) {
  const name = file.slice(root.length + 1);
  const raw = await readFile(file, "utf8");
  // The trailing newline is an artefact of writing the capture to disk; the
  // serializer does not emit one.
  const text = raw.replace(/\n+$/, "");

  let doc;
  try {
    doc = parse(text);
  } catch (error) {
    console.log(`FAIL ${name}\n  parse: ${error.message}`);
    failed++;
    continue;
  }

  const again = emit(doc);
  const problems = validate(doc);
  const nodes = nodesOf(doc).length;

  if (again !== text) {
    console.log(`FAIL ${name} (${nodes} nodes)\n${firstDiff(text, again)}`);
    failed++;
    continue;
  }
  if (problems.length) {
    console.log(`FAIL ${name} (${nodes} nodes) — validator`);
    for (const problem of problems.slice(0, 10)) {
      console.log(`  ${problem.where}: ${problem.message}`);
    }
    if (problems.length > 10) console.log(`  … ${problems.length - 10} de plus`);
    failed++;
    continue;
  }

  // Parsing the re-emitted text must give the same document again: proves the
  // emitter did not produce something only the first parse could read.
  const stable = emit(parse(again));
  if (stable !== again) {
    console.log(`FAIL ${name} — second pass unstable\n${firstDiff(again, stable)}`);
    failed++;
    continue;
  }

  console.log(`ok   ${name} — ${nodes} nodes, ${text.split("\n").length} lines`);
}

console.log(
  failed
    ? `\n${failed}/${files.length} failed`
    : `\n${files.length}/${files.length} round trips identical`
);
process.exit(failed ? 1 : 0);
