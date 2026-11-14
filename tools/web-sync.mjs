// A documentation page's frame already in Figma against its capture, example by example, without rebuilding anything.
// Text case and per-corner radii are patched in place; text the capture holds and the variant doesn't show is listed.
// --capture: captures each page again first (4 at a time). --dry: patches nothing.
// Usage: node tools/web-sync.mjs <base url> --only "<css selector>" --list <slugs.txt> --out <dir> --label <frame prefix> [--skip "<regex>"] [--slug <one>] [--capture] [--dry]

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRpc, pluginFile } from "./web-lib.mjs";
import { cased } from "./web-items.mjs";

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const [base, only, list, out, label, skip, one] = [args[0], opt("--only"), opt("--list"), opt("--out"), opt("--label"), opt("--skip"), opt("--slug")];
const dry = args.includes("--dry");
const dir = dirname(fileURLToPath(import.meta.url));
const skipRe = skip ? new RegExp(skip, "i") : null;
const slugs = one ? [one] : readFileSync(list, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);

if (args.includes("--capture")) {
  const run = promisify(execFile);
  const queue = [...slugs];
  const failed = [];
  await Promise.all([1, 2, 3, 4].map(async () => {
    for (let slug; (slug = queue.shift()); ) {
      const to = join(out, slug);
      mkdirSync(to, { recursive: true });
      try { await run("node", [join(dir, "web-capture.mjs"), `${base}/${slug}`, join(to, "capture.json"), "--shot", join(to, "page.jpg"), "--width", "1440", "--only", only], { timeout: 180000 }); }
      catch (e) { failed.push(slug + " : " + String(e.message).split("\n")[0]); }
    }
  }));
  console.log(`capture : ${slugs.length - failed.length}/${slugs.length}`);
  for (const f of failed) console.log("  failed " + f);
}

const rpc = makeRpc(await pluginFile());

// the capture's examples, in order, each with the texts it paints and the boxes whose corners differ, x/y from the example's corner
const expected = (cap) => {
  const byId = new Map(cap.boxes.map((b) => [String(b.id), b]));
  const blockOf = (b) => { for (let n = b; n; n = byId.get(String(n.p))) if (n.block) return n; return null; };
  const blocks = [];
  const seen = new Map();
  for (const b of cap.boxes) if (b.block && !blockOf(byId.get(String(b.p)) || {})) { const e = { name: String(b.block).replace(/\s*#$/, ""), texts: [], rs: [] }; blocks.push(e); seen.set(b, e); }
  for (const b of cap.boxes) {
    const host = blockOf(b);
    if (!host || !seen.has(host)) continue;
    if (b.text) seen.get(host).texts.push(cased(b.text, b.font?.transform).replace(/\s+/g, " ").trim());
    if (b.rs) seen.get(host).rs.push({ x: b.x - host.x, y: b.y - host.y, w: b.w, h: b.h, rs: b.rs });
  }
  return blocks.filter((e) => !(skipRe && skipRe.test(e.name)));
};

// one variant against one example: texts set to the captured case, corners set, what's missing named
const sync = (name, index, want) => rpc(`
let root = null;
for (const p of figma.root.children) {
  await p.loadAsync();
  root = p.children.find((n) => n.type === "FRAME" && n.name === ${JSON.stringify(name)});
  if (root) break;
}
const held = root ? root.children.find((k) => k.type === "COMPONENT" || k.type === "COMPONENT_SET") : null;
if (!held) return null;
const v = (held.type === "COMPONENT_SET" ? held.children : [held])[${index}];
if (!v) return null;
const want = ${JSON.stringify(want)}, dry = ${dry}, log = { absent: [], spaces: [], cased: [], corners: [], stuck: [] };
const o = v.absoluteTransform;
const nodes = [];
const walk = (n) => {
  // (a stale instance sublayer reads as nothing)
  try { if (!n.visible) return; const b = n.absoluteBoundingBox; if (b) nodes.push({ n, x: b.x - o[0][2], y: b.y - o[1][2], w: b.width, h: b.height }); } catch { return; }
  if (n.children) for (const k of n.children) walk(k);
};
walk(v);
const texts = nodes.filter((e) => e.n.type === "TEXT");
const bare = (s) => s.replace(/\\s+/g, "");
const all = bare(texts.map((e) => e.n.characters).join("")).toLowerCase();
const recase = async (t, from, to) => {
  for (const f of t.getRangeAllFontNames(0, t.characters.length)) await figma.loadFontAsync(f);
  for (let i = 0; i < to.length; i++) {
    if (t.characters[from + i] === to[i]) continue;
    t.insertCharacters(from + i + 1, to[i], "BEFORE");
    t.deleteCharacters(from + i, from + i + 1);
  }
};
for (const s of want.texts) {
  const near = texts.find((e) => e.n.characters.replace(/\\s+/g, " ").includes(s));
  if (near) continue;
  const low = s.toLowerCase();
  const twin = texts.find((e) => e.n.characters.toLowerCase().includes(low));
  if (twin && twin.n.characters.toLowerCase().indexOf(low) >= 0 && low.length === s.length) {
    log.cased.push(s);
    if (!dry) { try { await recase(twin.n, twin.n.characters.toLowerCase().indexOf(low), s); } catch (e) { log.stuck.push(s + " : " + String(e)); } }
    continue;
  }
  if (texts.some((e) => bare(e.n.characters).toLowerCase().includes(bare(low)))) { log.spaces.push(s); continue; }
  if (all.includes(bare(low))) continue;
  log.absent.push(s);
}
for (const c of want.rs) {
  const hit = nodes.filter((e) => e.n.type !== "TEXT" && "topLeftRadius" in e.n && Math.abs(e.x - c.x) <= 4 && Math.abs(e.y - c.y) <= 4 && Math.abs(e.w - c.w) <= 4 && Math.abs(e.h - c.h) <= 4);
  const cap = (r) => Math.min(r, c.w / 2, c.h / 2);
  const box = hit.find((e) => (e.n.fills && e.n.fills.length) || (e.n.strokes && e.n.strokes.length)) || hit[0];
  if (!box) { log.stuck.push("coins " + Math.round(c.x) + "," + Math.round(c.y)); continue; }
  const now = [box.n.topLeftRadius, box.n.topRightRadius, box.n.bottomRightRadius, box.n.bottomLeftRadius];
  if (now.every((r, i) => Math.abs(r - cap(c.rs[i])) < 0.5)) continue;
  log.corners.push(box.n.name + " " + now.map(Math.round).join("/") + "→" + c.rs.map(cap).map(Math.round).join("/"));
  if (dry) continue;
  try { [box.n.topLeftRadius, box.n.topRightRadius, box.n.bottomRightRadius, box.n.bottomLeftRadius] = c.rs.map(cap); }
  catch (e) { log.stuck.push(box.n.name + " : " + String(e)); }
}
return log;`);

const clip = (s) => (s.length > 60 ? s.slice(0, 60) + "…" : s);
const totals = { absent: 0, spaces: 0, cased: 0, corners: 0, stuck: 0 };
for (const slug of slugs) {
  const f = join(out, slug, "capture.json");
  if (!existsSync(f)) continue;
  const want = expected(JSON.parse(readFileSync(f, "utf8")));
  const lines = [];
  for (let i = 0; i < want.length; i++) {
    if (!want[i].texts.length && !want[i].rs.length) continue;
    const r = await sync(`${label} · ${slug}`, i, want[i]);
    if (!r) continue;
    for (const k of Object.keys(totals)) {
      totals[k] += r[k].length;
      if (r[k].length) lines.push(`  ${want[i].name} · ${k} : ${r[k].map(clip).join(" | ")}`);
    }
  }
  if (lines.length) console.log(`${slug}\n${lines.join("\n")}`);
}
console.log(JSON.stringify(totals));
