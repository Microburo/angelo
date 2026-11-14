// Offline check of mini DS steps, without Figma: prelude + step parse as one async body, and every
// literal Lucide name passed to H.icon() / ico() exists in lucide-static.
// Usage: node tools/mini-ds/syntax.mjs [--flavor cui] <step> [step…]
import { readFile, access } from "node:fs/promises";

const here = new URL("./", import.meta.url);
const icons = new URL("../../node_modules/lucide-static/icons/", here);
const fi = process.argv.indexOf("--flavor");
const FLAVOR = fi > 0 ? process.argv[fi + 1] : "v1";
const steps = process.argv.slice(2).filter((s, i, a) => s !== "--flavor" && a[i - 1] !== "--flavor");
const prelude = `const WIPE = false;\nconst FLAVOR = "${FLAVOR}";\nconst ASSETS = {};\n` + (await readFile(new URL("prelude.js", here), "utf8"));
const AsyncFunction = (async () => {}).constructor;
let bad = 0;
for (const step of steps) {
  const dir = FLAVOR === "v1" ? "steps" : `steps-${FLAVOR}`;
  let body;
  try {
    body = await readFile(new URL(`${dir}/${step}.js`, here), "utf8");
  } catch {
    // v1 ported steps share the cui source
    body = await readFile(new URL(FLAVOR === "v1" ? `steps-cui/${step}.js` : `steps/${step}.js`, here), "utf8");
  }
  const errs = [];
  try {
    new AsyncFunction("figma", "H", prelude + "\n" + body);
  } catch (e) {
    errs.push("syntax: " + e.message);
  }
  const names = new Set([...body.matchAll(/(?:H\.icon|ico)\(\s*"([a-z0-9-]+)"/g)].map((m) => m[1]));
  for (const m of body.matchAll(/\b(?:ICONS|icons?)\s*=\s*\[([^\]]*)\]/g)) for (const s of m[1].matchAll(/"([a-z0-9-]+)"/g)) names.add(s[1]);
  // Figma vectorPaths accept only absolute M L C Q Z commands
  for (const m of body.matchAll(/["'`](M\s*-?[0-9][^"'`]*)["'`]/g)) {
    const bad = m[1].replace(/\$\{[^}]*\}/g, "0").match(/[A-Za-z]/g)?.filter((c) => !"MLCQZ".includes(c));
    if (bad?.length) errs.push(`vector path uses ${[...new Set(bad)].join("")}: ${m[1].slice(0, 40)}`);
  }
  for (const n of names) {
    try {
      await access(new URL(`${n}.svg`, icons));
    } catch {
      errs.push("unknown lucide icon: " + n);
    }
  }
  console.log(`${step}: ${errs.length ? errs.join(" · ") : "ok"} (${names.size} icons)`);
  bad += errs.length;
}
process.exit(bad ? 1 : 0);
