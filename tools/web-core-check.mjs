// plugin/dist/web-core.js gives the same tree as tools/ and sends Figma the same execs, on every capture of the
// corpus, run in a context with no Node at all (a fake plugin answers, Figma is not touched).
// Usage: node tools/web-core-check.mjs (after npm run build)
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { selectItems } from "./web-items.mjs";
import { layoutTree } from "./web-layout.mjs";
import { runBuild } from "./web-run.mjs";
import { sha1 } from "./web-sha1.mjs";
import { swapIcons } from "./web-icons-run.mjs";
import { adaptToFile, missingFamilies } from "./web-finish.mjs";

const MAX_KB = 400;
const MAX_MS = 1000;

const here = fileURLToPath(new URL("..", import.meta.url));
const bundle = join(here, "plugin/dist/web-core.js");
const kb = Math.round(statSync(bundle).size / 1024);
// (the web standards an iframe has and a bare vm context lacks)
const box = vm.createContext({ console, TextEncoder, TextDecoder, URL, atob, btoa, setTimeout });
vm.runInContext(readFileSync(bundle, "utf8"), box);
// one function for both sides, so each realm parses its own JSON and only JSON crosses over
box.runCore = vm.runInContext(`(text, height, exclude) => {
  const cap = JSON.parse(text);
  const items = WebCore.selectItems(cap, { height, exclude: exclude ? new RegExp(exclude, "i") : null });
  const t0 = Date.now();
  const { root, comps } = WebCore.layoutTree(cap, items.map(({ src, ...o }) => (src ? { ...o, img: true } : o)));
  return { ms: Date.now() - t0, json: JSON.stringify({ root, comps }) };
}`, box);

// A fake plugin's answer, as JSON. Images are never ready before pass 2: the lots don't depend on timing.
const answer = (code) => {
  if (code.includes("globalThis.__webFonts = f; return")) return "[]";
  if (code.includes("const out = { sigs: {}")) return JSON.stringify({ sigs: {}, fams: {}, cf: null });
  const st = /^const ST = (.*);$/m.exec(code);
  if (st) return JSON.stringify({ ST: { ...JSON.parse(st[1]), root: "ROOT", cf: "CF" }, nodes: 1, errors: [], nerr: 0 });
  if (code.includes("let checked = 0;")) return JSON.stringify({ checked: 0, fixed: 0, left: [], nleft: 0 });
  if (code.includes("let removed = 0, kept = 0;")) return JSON.stringify({ removed: 0, kept: 0, ms: 0 });
  return "[]";
};
box.answer = answer;
box.runExecs = vm.runInContext(`async (text, faces, height, exclude) => {
  const hash = [];
  const t0 = Date.now();
  await WebCore.runBuild({
    cap: JSON.parse(text),
    FACES: JSON.parse(faces),
    height,
    exclude: exclude ? new RegExp(exclude, "i") : null,
    rpc: async (code) => { hash.push(code); return JSON.parse(answer(code)); },
    images: () => ({ ready: () => false, value: () => null, get: async (id) => ({ id, url: "img-" + id, size: 1 }), cleanup: async () => {} }),
    log: () => {},
  });
  return { ms: Date.now() - t0, codes: JSON.stringify(hash) };
}`, box);
const nodeExecs = async (text, faces, height, exclude) => {
  const sent = [];
  await runBuild({
    cap: JSON.parse(text),
    FACES: JSON.parse(faces),
    height,
    exclude: exclude ? new RegExp(exclude, "i") : null,
    rpc: async (code) => { sent.push(code); return JSON.parse(answer(code)); },
    images: () => ({ ready: () => false, value: () => null, get: async (id) => ({ id, url: "img-" + id, size: 1 }), cleanup: async () => {} }),
    log: () => {},
  });
  return JSON.stringify(sent);
};

let fails = 0;
for (const s of ["", "abc", "é💊", "x".repeat(55), "x".repeat(56), "x".repeat(64), "x".repeat(1000)]) {
  if (sha1(s) !== createHash("sha1").update(s).digest("hex")) {
    fails += 1;
    console.log(`  DIFF sha1 over ${s.length} characters`);
  }
}

// The inlined engine is the bundle, escaped only where HTML would end the script
const ui = readFileSync(join(here, "plugin/dist/ui.html"), "utf8");
if (!ui.includes(readFileSync(bundle, "utf8").replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--"))) {
  fails += 1;
  console.log("  DIFF engine missing from ui.html");
}

// What the images of a capture give with no network (the re-encoding needs a real canvas)
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==";
box.runImages = vm.runInContext(`async (srcs) => {
  const f = WebCore.dataImages(srcs);
  const out = [];
  for (const s of srcs) out.push(await f.get(s.id));
  return JSON.stringify(out);
}`, box);
const pictures = JSON.parse(await box.runImages([
  { id: 1, src: `data:image/png;base64,${png}` },
  { id: 2, src: `data:image/svg+xml;base64,${btoa("<svg width='1'/>")}` },
  { id: 3, src: "data:image/svg+xml,%3Csvg%20width='1'/%3E" },
  { id: 4, src: "https://example.com/a.png" },
  { id: 5, src: "data:text/plain,hello" },
]));
const expected = [
  { id: 1, url: `data:image/png;base64,${png}`, size: `data:image/png;base64,${png}`.length },
  { id: 2, svg: "<svg width='1'/>" },
  { id: 3, svg: "<svg width='1'/>" },
  null,
  null,
];
if (JSON.stringify(pictures) !== JSON.stringify(expected)) {
  fails += 1;
  console.log(`  DIFF embedded images: ${JSON.stringify(pictures)}`);
}

// The closing passes: same execs from the bundle and from tools/, on a capture holding a Lucide drawing
const LUCIDE = { boxes: [{ id: 1, font: { family: "Geist" } }, { id: 2, svg: '<svg class="lucide lucide-chevron-left" data-rot="90"><path d="M1 1"/></svg>' }, { id: 3, svg: '<svg class="lucide lucide-clock2"><circle r="1"/></svg>' }] };
const closing = (code) => {
  if (code.includes("createNodeFromSvg")) return JSON.stringify([...code.matchAll(/lucide-[a-z0-9-]+/g)].map(() => ({ letters: "V", nums: [1] })));
  if (code.includes("H.icon(name)")) return JSON.stringify([{ id: "1:1", name: "chevron-up" }, { id: "1:2", name: "clock-2" }]);
  if (code.includes("keptFilled, more, odd")) return JSON.stringify({ done: { "clock-2": 1 }, keptFilled: 0, more: false, odd: [] });
  if (code.includes("return figma.root.getPluginData")) return JSON.stringify(JSON.stringify({ skipped: true }));
  if (code.includes("listAvailableFontsAsync")) return JSON.stringify(["Geist"]);
  return "1";
};
box.closing = closing;
box.runClosing = vm.runInContext(`async (text) => {
  const sent = [];
  const rpc = async (code) => { sent.push(code); return JSON.parse(closing(code)); };
  const cap = JSON.parse(text);
  const icons = await WebCore.swapIcons({ rpc, caps: [cap], root: "ROOT" });
  icons.ms = 0;
  const none = await WebCore.swapIcons({ rpc, caps: [{ boxes: [] }], root: "ROOT" });
  const adapted = await WebCore.adaptToFile(rpc, "ROOT");
  const fonts = await WebCore.missingFamilies(rpc, cap);
  return JSON.stringify({ sent, icons, none, adapted, fonts });
}`, box);
const nodeClosing = async (text) => {
  const sent = [];
  const rpc = async (code) => { sent.push(code); return JSON.parse(closing(code)); };
  const cap = JSON.parse(text);
  const icons = await swapIcons({ rpc, caps: [cap], root: "ROOT" });
  icons.ms = 0;
  const none = await swapIcons({ rpc, caps: [{ boxes: [] }], root: "ROOT" });
  const adapted = await adaptToFile(rpc, "ROOT");
  const fonts = await missingFamilies(rpc, cap);
  return JSON.stringify({ sent, icons, none, adapted, fonts });
};
const closed = await box.runClosing(JSON.stringify(LUCIDE));
if (closed !== (await nodeClosing(JSON.stringify(LUCIDE)))) {
  fails += 1;
  console.log("  DIFF closing passes");
}
// (and on a real page drawn with Lucide)
const shadcn = readFileSync(join(here, "tests/web/shadcn/card/capture.json"), "utf8");
const real = await box.runClosing(shadcn);
if (real !== (await nodeClosing(shadcn)) || !JSON.parse(real).sent[0].includes("createNodeFromSvg")) {
  fails += 1;
  console.log("  DIFF closing passes, shadcn capture");
}
const c = JSON.parse(closed);
// (exec sent: 1 table, 1 owners, 1 pass, then 3 for the adaptation and 1 for the fonts; a capture without Lucide sends none)
if (c.sent.length !== 7 || c.icons.total !== 1 || !c.sent[1].includes('["chevron-up"]') || !c.sent[1].includes('["clock-2"]') || !c.sent[2].includes('await walk(await H.byId("ROOT"))') || !c.adapted.skipped || c.fonts[0] !== "Geist" || c.none.total !== 0) {
  fails += 1;
  console.log(`  DIFF closing passes, content: ${c.sent.length} exec, ${JSON.stringify(c.icons)}`);
}

const root = join(here, "tests/web");
let [worst, worstCase, worstRun, worstRunCase, execs] = [0, "", 0, "", 0];
const cases = readdirSync(root).filter((d) => existsSync(join(root, d, "capture.json")));
for (const name of cases) {
  const text = readFileSync(join(root, name, "capture.json"), "utf8");
  const path = join(root, name, "expect.json");
  const ex = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const facesPath = join(root, name, "fonts.json");
  const faces = existsSync(facesPath) ? readFileSync(facesPath, "utf8") : "{}";
  const cap = JSON.parse(text);
  const items = selectItems(cap, { height: ex.height, exclude: ex.exclude ? new RegExp(ex.exclude, "i") : null });
  const { root: tree, comps } = layoutTree(cap, items.map(({ src, ...o }) => (src ? { ...o, img: true } : o)));
  const { ms, json } = box.runCore(text, ex.height, ex.exclude || null);
  if (ms > worst) [worst, worstCase] = [ms, name];
  if (json !== JSON.stringify({ root: tree, comps })) {
    fails += 1;
    console.log(`  DIFF tree ${name}`);
  }
  const run = await box.runExecs(text, faces, ex.height, ex.exclude || null);
  if (run.ms > worstRun) [worstRun, worstRunCase] = [run.ms, name];
  execs += JSON.parse(run.codes).length;
  if (run.codes !== (await nodeExecs(text, faces, ex.height, ex.exclude || null))) {
    fails += 1;
    console.log(`  DIFF exec ${name}`);
  }
}
console.log(`${cases.length} captures, ${execs} exec, ${fails} difference(s), ${kb} KB (max ${MAX_KB}), longest tree ${worst} ms on ${worstCase}, full preparation ${worstRun} ms on ${worstRunCase} (max ${MAX_MS})`);
process.exit(fails || kb > MAX_KB || worstRun > MAX_MS ? 1 : 0);
