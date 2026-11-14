#!/usr/bin/env node
// Rearrange the components page: every site's board and component set packed as small as it can be
// (wrapped rows, tallest first, width of the smallest area ≤ 4000 px) (web-build lays out the boards it touches; this one fixes every board at once)
// Usage: node tools/web-boards.mjs [--file <figma file name>]
import { makeRpc, BOARD_JS } from "./web-lib.mjs";

const i = process.argv.indexOf("--file");
const rpc = makeRpc(i > 0 ? process.argv[i + 1] : undefined);
const t0 = Date.now();
const r = await rpc(`
${BOARD_JS}
const cp = figma.root.children.find((p) => p.name === "💊 Components");
if (!cp) return { boards: 0 };
await cp.loadAsync();
const boards = cp.children.filter((n) => n.getPluginData("fdslSite"));
let sets = 0;
for (const f of boards) {
  for (const s of f.findAll((c) => c.type === "COMPONENT_SET")) { setLayout(s); sets++; }
  boardLayout(f);
}
boardsRow(cp);
return { boards: boards.map((f) => ({ name: f.name, w: Math.round(f.width), h: Math.round(f.height), components: f.children.length })), sets };
`);
console.log(JSON.stringify(r, null, 1), `${Date.now() - t0} ms`);
