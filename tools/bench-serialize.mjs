// Serializer benchmark outside Figma: plugin/src/serialize/tree.ts bundled as is, run on a
// synthetic node tree (plain objects, no sandbox crossing), so what is timed is the walk
// itself plus the yields it takes.
//
//   node tools/bench-serialize.mjs [--nodes 1300] [--rounds 30] [--clamp 1000]
//
// --clamp: floor of every setTimeout in ms, the way Figma throttles a plugin's timers
// (docs/files.md). 0 = node's own timers.

import * as esbuild from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(name) ? Number(argv[argv.indexOf(name) + 1]) : fallback);
const NODES = arg("--nodes", 1300);
const ROUNDS = arg("--rounds", 30);
const CLAMP = arg("--clamp", 0);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const out = mkdtempSync(join(tmpdir(), "angelo-bench-ser-"));
process.on("exit", () => rmSync(out, { recursive: true, force: true }));
await esbuild.build({
  stdin: {
    contents: 'export { readRoots } from "./serialize/tree"; export { Legend } from "./serialize/legend";',
    resolveDir: join(root, "plugin/src"),
    loader: "ts",
  },
  outfile: join(out, "ser.mjs"),
  bundle: true,
  format: "esm",
  logLevel: "silent",
});
const { readRoots, Legend } = await import(pathToFileURL(join(out, "ser.mjs")).href);

// ── the yields: every timer the walk sets is counted, and floored when --clamp is given
let timers = 0;
const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...rest) => {
  timers += 1;
  return realTimeout(fn, Math.max(ms || 0, CLAMP), ...rest);
};
globalThis.figma = {
  mixed: Symbol("mixed"),
  variables: { getVariableByIdAsync: async () => null, getLocalVariablesAsync: async () => [] },
  getStyleByIdAsync: async () => null,
  getNodeByIdAsync: async () => null,
};

// ── a page of cards: auto-layout frames, a title and a body text in each
let seq = 0;
const solid = (v) => [{ type: "SOLID", visible: true, opacity: 1, color: { r: v, g: v, b: v }, boundVariables: {} }];
const base = (type, name, w, h, parent) => ({
  id: `1:${++seq}`, type, name, parent, removed: false, visible: true, locked: false,
  x: 0, y: 0, width: w, height: h, rotation: 0, opacity: 1, blendMode: "PASS_THROUGH",
  fills: solid(1), strokes: [], effects: [], boundVariables: {},
  fillStyleId: "", strokeStyleId: "", effectStyleId: "",
  layoutSizingHorizontal: "FIXED", layoutSizingVertical: "HUG", layoutAlign: "INHERIT", layoutGrow: 0,
  layoutPositioning: "AUTO", constraints: { horizontal: "MIN", vertical: "MIN" },
});
const frame = (name, w, h, parent) => ({
  ...base("FRAME", name, w, h, parent),
  children: [], layoutMode: "VERTICAL", itemSpacing: 16, counterAxisSpacing: 0, layoutWrap: "NO_WRAP",
  paddingLeft: 24, paddingRight: 24, paddingTop: 16, paddingBottom: 16,
  primaryAxisAlignItems: "MIN", counterAxisAlignItems: "MIN", primaryAxisSizingMode: "AUTO", counterAxisSizingMode: "FIXED",
  cornerRadius: 8, topLeftRadius: 8, topRightRadius: 8, bottomLeftRadius: 8, bottomRightRadius: 8,
  strokeWeight: 1, strokeAlign: "INSIDE", clipsContent: false,
});
const text = (chars, parent) => ({
  ...base("TEXT", chars, 272, 20, parent),
  characters: chars, fills: solid(0.1), textStyleId: "", fontSize: 14, fontName: { family: "Inter", style: "Regular" },
  lineHeight: { unit: "AUTO" }, letterSpacing: { unit: "PERCENT", value: 0 }, textAlignHorizontal: "LEFT",
  textAlignVertical: "TOP", textAutoResize: "HEIGHT", textCase: "ORIGINAL", textDecoration: "NONE", paragraphSpacing: 0,
  getStyledTextSegments: () => [{
    characters: chars, start: 0, end: chars.length, fontSize: 14, fontName: { family: "Inter", style: "Regular" },
    fills: solid(0.1), textStyleId: "", fillStyleId: "", lineHeight: { unit: "AUTO" }, letterSpacing: { unit: "PERCENT", value: 0 },
    textCase: "ORIGINAL", textDecoration: "NONE", boundVariables: {},
  }],
});
function page(count) {
  seq = 0;
  const top = frame("Page", 1440, 4000, { type: "PAGE" });
  while (seq < count) {
    const card = frame(`Card ${seq}`, 320, 200, top);
    top.children.push(card);
    for (let i = 0; i < 3 && seq < count; i++) {
      const row = frame("Row", 272, 40, card);
      card.children.push(row);
      row.children.push(text(`Title ${seq}`, row), text("A body line of ordinary length for the card", row));
    }
  }
  return top;
}

const session = (budget) => ({ sid: 1, legend: new Legend(), chunks: new Map(), budget, revs: new Map(), nodes: new Map() });
const median = (ms) => ms.slice().sort((a, b) => a - b)[Math.floor(ms.length / 2)];

const tree = page(NODES);
const rounds = CLAMP ? Math.min(ROUNDS, 3) : ROUNDS;
for (const [label, budget] of [["full detail", 1e9], ["surface + chunks", 2500]]) {
  if (!CLAMP) for (let i = 0; i < 5; i++) await readRoots([tree], session(budget));
  const ms = [];
  let yields = 0;
  let chars = 0;
  for (let i = 0; i < rounds; i++) {
    timers = 0;
    const t0 = performance.now();
    const result = await readRoots([tree], session(budget));
    ms.push(performance.now() - t0);
    yields = timers;
    chars = result.tree.length;
  }
  console.log(`serialize ${label.padEnd(18)} ${median(ms).toFixed(2).padStart(9)} ms   ${yields} yields · ${seq} nodes · ${chars} chars`);
}
console.log(`${rounds} rounds · timers floored at ${CLAMP} ms`);
process.exit(0);
