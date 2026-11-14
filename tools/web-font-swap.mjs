// Swap one font family for another in place, on whole pages or named frames: mains first, so their
// instances follow, then whatever still overrides it. Styles are matched by name, mixed texts per run.
// Usage: node tools/web-font-swap.mjs --map "Geist=Inter" --pages "<page>[,<page>]" [--frames "<page>><frame>"]

import { makeRpc, pluginFile } from "./web-lib.mjs";

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const [from, to] = (opt("--map") || "").split("=").map((s) => s.trim());
if (!from || !to) throw new Error('--map "From=To" required');
const pages = (opt("--pages") || "").split(",").map((s) => s.trim()).filter(Boolean);
const frames = (opt("--frames") || "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.split(">").map((x) => x.trim()));
const rpc = makeRpc(await pluginFile());

const pass = (scope) => rpc(`
const FROM = ${JSON.stringify(from)}, TO = ${JSON.stringify(to)}, BUDGET = 20000, t0 = Date.now();
const [pageName, frameName] = ${JSON.stringify(scope)};
const page = figma.root.children.find((p) => p.name === pageName);
if (!page) return { missing: pageName };
await page.loadAsync();
const root = frameName ? page.children.find((n) => n.name === frameName) : page;
if (!root) return { missing: pageName + " > " + frameName };
const avail = (await figma.listAvailableFontsAsync()).filter((f) => f.fontName.family === TO).map((f) => f.fontName.style);
const squash = (s) => s.toLowerCase().replace(/\\s+/g, "");
const styleOf = (s) => avail.find((a) => squash(a) === squash(s)) || avail.find((a) => a === "Regular");
const loaded = new Set();
const use = async (fn) => { const k = fn.family + "/" + fn.style; if (!loaded.has(k)) { await figma.loadFontAsync(fn); loaded.add(k); } };
const texts = root.findAllWithCriteria({ types: ["TEXT"] });
const has = (t) => t.fontName === figma.mixed ? t.getStyledTextSegments(["fontName"]).some((s) => s.fontName.family === FROM) : t.fontName.family === FROM;
const isMain = (t) => !t.id.startsWith("I");
const todo = texts.filter(has).sort((a, b) => isMain(b) - isMain(a));
let done = 0, failed = [];
for (const t of todo) {
  if (Date.now() - t0 > BUDGET) break;
  if (!has(t)) continue;
  try {
    for (const s of t.getStyledTextSegments(["fontName"])) {
      await use(s.fontName);
      if (s.fontName.family !== FROM) continue;
      const fn = { family: TO, style: styleOf(s.fontName.style) };
      await use(fn);
      t.setRangeFontName(s.start, s.end, fn);
    }
    done++;
  } catch (e) { failed.push(t.name + ": " + e.message); }
}
return { done, left: root.findAllWithCriteria({ types: ["TEXT"] }).filter(has).length, failed: failed.slice(0, 5) };`);

const scopes = [...pages.map((p) => [p]), ...frames];
for (const scope of scopes) {
  let total = 0, r, stale = 0;
  do {
    r = await pass(scope);
    if (r.missing) { console.log(`not found: ${r.missing}`); break; }
    total += r.done;
    stale = r.done ? 0 : stale + 1;
    for (const f of r.failed) console.log(`  failed ${f}`);
  } while (r.left && stale < 2);
  if (!r.missing) console.log(`${scope.join(" > ")}: ${total} text(s) in ${to}, ${r.left} left`);
}
