// URL → Figma in one command: the root frame shows in Figma first (< 1 s), then capture,
// site fonts, the build into that same frame, then the check against the page screenshot.
// Usage: node tools/web-to-figma.mjs <url> [--file <Figma file>] [--out tests/web/<case>] [web-build options]
//        --capture <capture.json> : a capture made elsewhere (browser extension), the capture step is skipped
//        --faithful : keep the site's look in a file that has its own tokens

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { adaptToFile, caseName, makeRpc, stagePage, sheetFaces, swapSections, pluginFile } from "./web-lib.mjs";
import { releaseCursor } from "./web-finish.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
// trailing sentence punctuation is never part of a pasted URL ("…/collections." opens a 404 page)
const url = args[0]?.replace(/[.,;:!?]+$/, "");
if (!url) throw new Error("usage: web-to-figma.mjs <url> [--file <Figma file>] [web-build options]");
// no --file: the file the plugin is open in (its ping names it)
const file = opt("--file") || (await pluginFile());
const host = new URL(url).hostname.replace(/^www\./, "");
const given = opt("--capture");
// --width 430: the phone version. Its own case folder and frame (`<host> · 430`), the desktop ones stay as they are
const view = Number(opt("--width", 1440));
const mobile = view !== 1440;
// a frozen case (expect.json) of another page of the same host is never overwritten: this page gets its path in the name
const caseDir = () => {
  const d = join("tests/web", caseName(host) + (mobile ? `-${view}` : ""));
  if (!existsSync(join(d, "expect.json"))) return d;
  let was = "";
  try { was = new URL(JSON.parse(readFileSync(join(d, "capture.json"), "utf8")).url).pathname; } catch {}
  const path = new URL(url).pathname;
  if (was.replace(/\/$/, "") === path.replace(/\/$/, "")) return d;
  return `${d}-${path.replace(/^\/|\/$/g, "").replace(/[^a-z0-9]+/gi, "-") || "home"}`;
};
const out = given ? dirname(given) : opt("--out", caseDir());
// everything else goes to web-build as is
const OWN = ["--file", "--out", "--capture", "--home", "--part", "--width", "--only"];
// --home <frame name> --part "A + B": the picked sections, rebuilt in the full-page frame of that name when it holds them
const parts = (opt("--part") || "").split(" + ").map((s) => s.trim()).filter(Boolean);
const name = opt("--name", mobile ? `${host} · ${view}` : host);
// a headless --part: only those blocks are captured, rebuilt in a staging frame, then swapped into the
// full-page frame of the same name (the extension names it by its own rule: pass --home then)
const home = opt("--home") || (parts.length && !given ? name : undefined);
const rest = args.slice(1).filter((a, i, all) => !OWN.includes(a) && !OWN.includes(all[i - 1]) && a !== "--faithful");
const dir = dirname(fileURLToPath(import.meta.url));
const t0 = Date.now();
// a hung step must not hold the bridge's one job slot for good
const LIMIT = 30 * 60 * 1000;
const node = (script, ...a) => execFileSync("node", [join(dir, script), ...a], { stdio: "inherit", timeout: LIMIT });
const ms = () => `${Date.now() - t0} ms`;
// everything but the capture and the build: a failure is said and listed, the frame built stays usable
const failed = [];
const step = async (label, fn) => {
  try {
    await fn();
  } catch (e) {
    failed.push(label);
    console.log(`${label}: failed, continuing without this step (${String(e.message).split("\n")[0]})`);
  }
};

const width = given ? JSON.parse(readFileSync(given, "utf8")).width : view;
const rpc = makeRpc(file);
const root = await stagePage(rpc, { name: parts.length && !given ? `${name} · ${parts.join(" + ")}` : name, width, keep: true });
console.log(`frame ${root} in Figma at ${ms()}`);
try {
  mkdirSync(out, { recursive: true });
  const cap = given || join(out, "capture.json");
  if (given) {
    // the browser could not read cross-origin stylesheets: their @font-face resolved here
    const data = JSON.parse(readFileSync(cap, "utf8"));
    if (data.sheets) {
      await sheetFaces(data);
      writeFileSync(cap, JSON.stringify(data));
    }
  } else {
    node("web-capture.mjs", url, cap, "--shot", join(out, "page.jpg"), "--width", String(view), ...(parts.length ? ["--part", parts.join(" + ")] : []), ...(opt("--exclude") ? ["--exclude", opt("--exclude")] : []), ...(opt("--only") ? ["--only", opt("--only")] : []));
    console.log(`capture at ${ms()}`);
  }
  // what the page shows but the capture lacks, said before the build (both capture paths)
  await step("capture audit", () => execFileSync("python3", ["-I", join(dir, "web-audit.py"), cap, join(out, "page.jpg"), "--fill"], { stdio: "inherit", timeout: LIMIT }));
  await step("fonts", () => node("fonts.mjs", cap));
  node("web-build.mjs", cap, "--file", file, "--root", root, ...rest);
  // a page drawn with Lucide: its svgs become the file's own Icon components
  const capText = readFileSync(cap, "utf8");
  if (/class=\\"[^"]*\blucide-/.test(capText)) await step("Lucide icons", async () => {
    // (the mains too, as the plugin does: an icon held in a component is drawn by its wrapper otherwise)
    const site = (() => { try { return new URL(JSON.parse(capText).url).hostname.replace(/^www\./, ""); } catch { return name; } })();
    const board = `Components · ${site}`;
    const hasBoard = await rpc(`const page = figma.root.children.find((p) => /^💊 Components$/.test(p.name));
if (!page) return false;
await page.loadAsync();
return page.children.some((n) => n.name === ${JSON.stringify(board)});`);
    node("web-icons.mjs", "--captures", dirname(cap), "--frames", `^${(await rpc(`return (await H.byId(${JSON.stringify(root)})).name`)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, ...(hasBoard ? ["--board", board, "--clean"] : []));
  });
  // the build checked against the page screenshot: what drifts or differs is corrected next
  // --fix: an image the check finds missing or empty is placed again (no picture left out)
  await step("page comparison", () => node("web-compare.mjs", out, "--file", file, "--root", root, "--fix"));
  // after the check, which measures fidelity to the page: from here the frame follows the file's rules, not the site's
  if (!args.includes("--faithful")) await step("file adaptation", async () => {
    // a section going into a full-page frame leaves its staging frame: width and grid are the page's business
    const a = await adaptToFile(rpc, root, { grid: !(home && parts.length) });
    if (a.error) throw new Error(`${a.error}, the site rendering is kept`);
    if (a.skipped) console.log("adaptation: no style or variable in this file, the site rendering is kept");
    else {
      console.log(`adaptation: ${a.nodes} nodes in ${a.ms} ms · ${a.tokens.colors} colors, ${a.tokens.texts} texts, ${a.tokens.grids} grids (${a.source.colors}/${a.source.texts}) · bound ${a.bound}, unbound ${a.unbound}, gradients ${a.gradients}${a.grid ? ` · grid ${a.grid}` : ""}`);
      for (const k of ["far", "missingFonts", "failed"]) if (a[k]?.length) console.log(`  ${k} : ${a[k].join(" · ")}`);
    }
  });
  // a section already in the full-page frame is rebuilt there, in place (the check above ran on the
  // rebuilt section alone); not found there = it stays in its own frame
  if (home && parts.length) await step("in-place redo", async () => {
    const r = await swapSections(rpc, { temp: root, home, parts });
    if (!r.swapped) console.log(`in place: no (${r.reason}), section kept in its frame`);
    else for (const p of r.parts) console.log(`in place: "${p.name}" redone in ${home} (${p.old} → ${p.now})${Math.abs(p.w - p.wasW) > 2 ? ` · width ${p.wasW} → ${p.w} (capture at another width)` : ""}${p.warn ? ` · size not carried over: ${p.warn}` : ""}`);
  });
  console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (failed.length) {
    console.log(`built, but failed steps: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
} finally {
  await releaseCursor(rpc);
}
