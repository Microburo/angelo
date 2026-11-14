// Node host of web-icons-run.mjs: the captures of a folder, the frames named by a regex.
// Usage: node tools/web-icons.mjs --captures <dir> --frames "<frame name regex>" [--board "<frame name on the components page>"] [--clean]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { makeRpc, pluginFile } from "./web-lib.mjs";
import { swapIcons } from "./web-icons-run.mjs";

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const [captures, frames, board, clean] = [opt("--captures"), opt("--frames"), opt("--board"), args.includes("--clean")];
if (!captures || !frames) throw new Error("usage : --captures <dir> --frames <regex> [--board <frame>] [--clean]");

const pingFile = await pluginFile();

// every capture.json under the folder
const caps = [];
const scan = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) scan(p);
    else if (f === "capture.json") caps.push(JSON.parse(readFileSync(p, "utf8")));
  }
};
scan(captures);

const r = await swapIcons({ rpc: makeRpc(pingFile), caps, frames, board, clean });
console.log(`icons: ${r.total} replaced, ${r.names} names, ${r.kept} filled kept, ${r.cleaned} mains removed, ${Math.round(r.ms / 1000)} s`);
console.log(Object.entries(r.report).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · "));
if (r.missing.length) console.log("missing from the file: " + r.missing.join(", "));
if (r.odd.length) console.log("size not kept: " + r.odd.slice(0, 20).join(", "));
