// Rebuilds a web-capture.mjs capture in Figma through the bridge (exec), live: flat absolute
// boxes, texts and inline SVGs, then local images; by default an auto layout tree where every
// UI block is a component instance (web-layout.mjs), components already on the page reused.
// Usage: node tools/web-build.mjs <capture.json> --file <Figma file> [--height 900]
//        [--exclude "regex on text"] [--name "Frame name"] [--font Geist] [--img-dir dir] [--max-img n]
//        [--flat] [--root frameId] [--from y] [--drop id,id] [--img "id=src,…"] [--svg "id=path"] [--font-map "Family=Fallback,…"] [--lot 250] [--pace 83] [--hold 50] [--reveal 0]

import { readFileSync, existsSync, appendFileSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { runBuild } from "./web-run.mjs";
import { makeRpc, fetchImages } from "./web-lib.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const num = (k) => (args.includes(k) ? Number(opt(k)) : undefined);
const cap = JSON.parse(readFileSync(args[0], "utf8"));
const late = opt("--late");
// --font-map "Brand Serif=Georgia,…" : a fallback per missing family (serif titles…)
const fontMap = Object.fromEntries((opt("--font-map") || "").split(",").filter(Boolean).map((p) => p.split("=").map((x) => x.trim().toLowerCase())));
// fonts.json next to the capture (tools/fonts.mjs): site fonts activated, with their faces
const facesPath = join(dirname(args[0]), "fonts.json");
const pairs = (k) => Object.fromEntries((opt(k) || "").split(",").filter(Boolean).map((p) => [Number(p.split("=")[0]), p.slice(p.indexOf("=") + 1)]));
// --svg "15=/path/logo.svg" : the file's markup
const svgOver = Object.fromEntries(Object.entries(pairs("--svg")).map(([id, path]) => [id, readFileSync(path, "utf8")]));

let r;
try {
  r = await runBuild({
    cap,
    rpc: makeRpc(opt("--file")),
    images: (srcs) => fetchImages(srcs, opt("--img-dir", join(dirname(args[0]), "web-build-img"))),
    FACES: existsSync(facesPath) ? JSON.parse(readFileSync(facesPath, "utf8")) : {},
    height: num("--height"),
    exclude: opt("--exclude") ? new RegExp(opt("--exclude"), "i") : null,
    name: opt("--name"),
    fallbackFont: opt("--font"),
    fontMap,
    LOT: num("--lot"),
    PACE: num("--pace"),
    REVEAL_MS: num("--reveal"),
    HOLD: num("--hold"),
    drop: (opt("--drop") || "").split(",").filter(Boolean).map(Number),
    // --img "65=file:///…/frame.jpg,…"
    imgOver: pairs("--img"),
    svgOver,
    flatMode: args.includes("--flat"),
    stage: opt("--root"),
    maxImg: num("--max-img"),
    late,
    trace: !!process.env.ANGELO_TRACE,
  });
} catch (e) {
  if (!e.stopped) throw e;
  console.error(e.message);
  process.exit(1);
}

if (!late) {
  // site fonts Figma did not list yet: swapped in by a detached run once it does (log beside the capture)
  if (r.LATE.length) {
    const out = openSync(join(dirname(args[0]), "late.log"), "a");
    spawn(process.execPath, [fileURLToPath(import.meta.url), ...args, "--late", `${r.rootId},${r.cfId || ""}`], { detached: true, stdio: ["ignore", out, out] }).unref();
    console.log(`fonts pending: texts update in the background as soon as Figma lists them (late.log)`);
  }

  // One line per run, to see the method improve over time
  const log = join(dirname(fileURLToPath(import.meta.url)), "../tests/web/runs.csv");
  if (!existsSync(log)) appendFileSync(log, "date,url,height,nodes,pass1_ms,images,placed,total_ms\n");
  appendFileSync(log, [new Date().toISOString().slice(0, 16), cap.url, r.height, r.nodes, r.pass1Ms, r.images, r.placed, r.totalMs].join(",") + "\n");
}
