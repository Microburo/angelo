// Captures every site of a design profile corpus (desktop 1440 + phone 430) with web-capture,
// then checks each capture against the success criteria before it can feed the profile.
// Usage: node tools/profile-capture.mjs <profile> [--only case1,case2] [--force]
// Reads profiles/<profile>/sites.csv (case,url,year,status,note), writes
// profiles/<profile>/captures/<case>[-430]/{capture.json,page.jpg} and captures.csv.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const profile = args[0];
if (!profile) {
  console.error("usage: node tools/profile-capture.mjs <profile> [--only a,b] [--force]");
  process.exit(1);
}
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const only = opt("--only")?.split(",");
const force = args.includes("--force");
const root = join("profiles", profile);

// success criteria: a capture below these is a blocked page, a consent wall or a shell
const MIN = { boxes: 60, texts: 25, height: 1200 };

const rows = readFileSync(join(root, "sites.csv"), "utf8").trim().split("\n").slice(1)
  .map((l) => l.split(","))
  .map(([kase, url, year, status]) => ({ kase, url, year, status }))
  .filter((r) => !only || only.includes(r.kase));

const report = [];
for (const r of rows) {
  for (const width of [1440, 430]) {
    const dir = join(root, "captures", width === 430 ? `${r.kase}-430` : r.kase);
    const out = join(dir, "capture.json");
    mkdirSync(dir, { recursive: true });
    const t0 = Date.now();
    let error = "";
    if (force || !existsSync(out)) {
      try {
        execFileSync("node", ["tools/web-capture.mjs", r.url, out, "--width", String(width), "--shot", join(dir, "page.jpg")],
          { stdio: ["ignore", "ignore", "pipe"], timeout: 120000 });
      } catch (e) {
        error = String(e.stderr || e.message).split("\n").find((l) => l.trim()) || "failed";
      }
    }
    const s = (Date.now() - t0) / 1000;
    let boxes = 0, texts = 0, height = 0;
    if (existsSync(out)) {
      const c = JSON.parse(readFileSync(out, "utf8"));
      boxes = c.boxes.length;
      texts = c.boxes.filter((b) => b.text && b.x > -1000).length;
      height = c.height;
    }
    const ok = !error && boxes >= MIN.boxes && texts >= MIN.texts && height >= MIN.height;
    report.push({ ...r, width, ok, boxes, texts, height, s: s.toFixed(1), error });
    console.log(`${ok ? "ok  " : "FAIL"} ${r.kase.padEnd(16)} ${String(width).padEnd(5)} ${boxes} boxes ${texts} texts h${height} ${s.toFixed(1)} s ${error}`);
  }
}
const head = "case,width,status,ok,boxes,texts,height,seconds,error";
const lines = report.map((x) => [x.kase, x.width, x.status, x.ok, x.boxes, x.texts, x.height, x.s, JSON.stringify(x.error)].join(","));
writeFileSync(join(root, "captures.csv"), [head, ...lines].join("\n") + "\n");
console.log(`${report.filter((x) => x.ok).length}/${report.length} captures valides → ${join(root, "captures.csv")}`);
