// Captures or compares the mini DS fingerprint of the Figma file where the Angelo plugin is open.
// Usage: node tools/mini-ds/fingerprint.mjs save     → writes reference/v1.json (validated version)
//        node tools/mini-ds/fingerprint.mjs compare  → lists every difference with the reference
//        node tools/mini-ds/fingerprint.mjs dump <file> → writes the live fingerprint to <file> (offline diffing)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { makeRpc, pluginFile } from "../web-lib.mjs";

const here = new URL("./", import.meta.url);
const refUrl = new URL("reference/v1.json", here);
const prelude = await readFile(new URL("prelude.js", here), "utf8");
const body = await readFile(new URL("steps/fingerprint.js", here), "utf8");
const rpc = makeRpc(await pluginFile());
const live = await rpc(prelude + "\n" + body);

const mode = process.argv[2] || "compare";
if (mode === "dump") {
  await writeFile(process.argv[3], JSON.stringify(live, null, 1));
  console.log(`dumped to ${process.argv[3]}`);
} else if (mode === "save") {
  await mkdir(new URL("reference/", here), { recursive: true });
  await writeFile(refUrl, JSON.stringify(live, null, 1));
  console.log(`saved: ${live.variables.length} variables, ${live.styles.length} styles, ${live.frames.length} element frames`);
} else {
  const ref = JSON.parse(await readFile(refUrl, "utf8"));
  const diffs = [];
  const walk = (a, b, path) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    // nested slot sublayers can be unreadable through the API on one side: not a difference
    if (a?.unreadable || b?.unreadable) return;
    if (a && b && typeof a === "object" && typeof b === "object") {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], `${path}/${a?.n || b?.n || ""}${Array.isArray(a) ? `[${k}]` : `.${k}`}`);
    } else diffs.push(`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  };
  walk(ref, live, "");
  console.log(diffs.length ? diffs.slice(0, 80).join("\n") + (diffs.length > 80 ? `\n… ${diffs.length - 80} more` : "") : "identical to reference/v1.json");
  console.log(`${diffs.length} difference(s)`);
}
