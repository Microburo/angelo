// Runs mini design system build steps in the Figma file where the Angelo plugin is open.
// Usage: node tools/mini-ds/run.mjs <step> [step…]   (steps/<step>.js, each one exec ≤ 30 s)
// Every step gets prelude.js prepended: token helpers, auto-layout boxes, icons, props.
import { readFile } from "node:fs/promises";
import { makeRpc, pluginFile } from "../web-lib.mjs";

const here = new URL("./", import.meta.url);
// assets (Avatar photo) injected as base64 so the build is self-contained in any file
const b64 = async (name) => (await readFile(new URL(`assets/${name}`, here))).toString("base64");
const WIPE = process.argv.includes("--wipe");
// --flavor <name>: steps-<name>/<step>.js replaces steps/<step>.js when present (default flavor = V1)
const fi = process.argv.indexOf("--flavor");
const FLAVOR = fi > 0 ? process.argv[fi + 1] : "v1";
const assets = `const WIPE = ${WIPE};\nconst FLAVOR = "${FLAVOR}";\nconst ASSETS = { avatar: "${await b64("avatar.jpg")}" };\n`;
const prelude = assets + (await readFile(new URL("prelude.js", here), "utf8"));
const file = await pluginFile();
const rpc = makeRpc(file);
// "build" = full rebuild of the validated version in the open file (patches 10+ are for an existing page only)
const BUILD = ["00-reset", "01-tokens", "02-colors", "03-type", "04-foundations", "05-actions", "06-inputs", "07-selection", "08-display", "09-check"];
// cui flavor: CUI component library looks (yappologistic/CUI) on our tokens, plus the components V1 lacks
// v1: CUI steps ported into V1 (green dots on the CUI board), shared source in steps-cui/ unless steps/ has its own
const PORTED = ["20-controls", "21-feedback", "22-menus", "23-actions", "24-inputs", "25-pickers", "26-navigation", "27-overlays", "28-data", "30-planning", "31-motion", "32-ai"];
const FLAVOR_BUILD = { v1: [...BUILD.slice(0, -1), ...PORTED, "09-check"], cui: [...BUILD.slice(0, -1), "20-controls", "21-feedback", "22-menus", "23-actions", "24-inputs", "25-pickers", "26-navigation", "27-overlays", "28-data", "29-charts", "30-planning", "31-motion", "32-ai", "09-check"] };
const args = process.argv.slice(2).filter((s, i, a) => s !== "--wipe" && s !== "--flavor" && a[i - 1] !== "--flavor");
const steps = args.flatMap((s) => (s === "build" ? FLAVOR_BUILD[FLAVOR] || BUILD : [s]));
const source = async (step) => {
  if (FLAVOR !== "v1") {
    try {
      return await readFile(new URL(`steps-${FLAVOR}/${step}.js`, here), "utf8");
    } catch {}
  }
  try {
    return await readFile(new URL(`steps/${step}.js`, here), "utf8");
  } catch (e) {
    if (FLAVOR === "v1") return readFile(new URL(`steps-cui/${step}.js`, here), "utf8");
    throw e;
  }
};
for (const step of steps) {
  const body = await source(step);
  const t0 = Date.now();
  const value = await rpc(prelude + "\n" + body, step);
  console.log(`${step}: ${Date.now() - t0} ms`, JSON.stringify(value));
}
