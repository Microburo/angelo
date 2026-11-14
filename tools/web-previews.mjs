// A documentation's rendered examples → Figma: one hug frame per page (padding 80), holding the page's
// component, its examples as variants. A frame already there is never rebuilt, only finished.
// Usage: node tools/web-previews.mjs <base url> --only "<css selector>" --list <slugs.txt> --out <dir> --label <frame prefix> [--skip "<regex>"]

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRpc, pluginFile } from "./web-lib.mjs";

const args = process.argv.slice(2);
const opt = (k) => args[args.indexOf(k) + 1];
const [base, only, list, out, label] = [args[0], opt("--only"), opt("--list"), opt("--out"), opt("--label")];
// --skip "<regex>": examples left out, by heading
const skip = args.includes("--skip") ? opt("--skip") : "";
const board = args.includes("--board") ? opt("--board") : "";
const dir = dirname(fileURLToPath(import.meta.url));
const file = await pluginFile();
const rpc = makeRpc(file);
const slugs = readFileSync(list, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
const title = (s) => s.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
// frames laid out in reading order, a new row past this width
const ROW = 12000, GAP = 300;
// the page the batch started on: browsing another page in Figma meanwhile loses no frame
const pageId = await rpc(`return figma.currentPage.id`);
const PAGE = `const page = await figma.getNodeByIdAsync(${JSON.stringify(pageId)}); await page.loadAsync();`;
const exists = (name) => rpc(`${PAGE} return page.children.some((n) => n.type === "FRAME" && n.name === ${JSON.stringify(name)})`);
// a build lands on the current page: back on the batch's page first
const focus = () => rpc(`${PAGE} if (figma.currentPage !== page) await figma.setCurrentPageAsync(page); return 1`);

// blocks → components → one set (several examples) in the frame, padding 80, hug
const finish = (name, comp) => rpc(`
${PAGE}
const root = page.children.find((n) => n.type === "FRAME" && n.name === ${JSON.stringify(name)});
if (!root) throw new Error("frame missing from the batch page");
// a detached instance keeps the layers its family's other occurrences hold, hidden, and the main's size:
// they go, and a frame that lost one takes back the height its content needs
const tidy = (n) => {
  if (n.type === "INSTANCE" || !n.children) return false;
  let hit = false;
  for (const k of [...n.children]) {
    if (!k.visible) { k.remove(); hit = true; }
    else if (tidy(k)) hit = true;
  }
  if (hit && n.layoutMode === "NONE") {
    const flow = n.children.filter((k) => k.layoutPositioning !== "ABSOLUTE");
    const need = flow.length ? Math.max(...flow.map((k) => k.y + k.height)) : 0;
    if (flow.length === 1 && need > n.height + 0.5) n.resizeWithoutConstraints(n.width, need);
  }
  return hit;
};
const openUp = (set) => { for (const n of [root, set]) if (n) n.clipsContent = false; };
if (root.children.some((k) => k.type === "COMPONENT" || k.type === "COMPONENT_SET")) {
  const held = root.children[0];
  for (const v of held.type === "COMPONENT_SET" ? held.children : [held]) tidy(v);
  openUp(held);
  return { done: 1 };
}
const skip = ${JSON.stringify(skip)};
for (const k of [...root.children]) if (skip && new RegExp(skip, "i").test(k.name.replace(/\\s*#$/, ""))) k.remove();
const blocks = [...root.children];
if (!blocks.length) { root.remove(); return { empty: 1 }; }
const made = [];
for (let b of blocks) {
  const label = b.name.replace(/\\s*#$/, "");
  if (b.type === "INSTANCE") { b = b.detachInstance(); tidy(b); }
  if ("paddingBottom" in b && b.layoutMode !== "NONE") { b.paddingBottom = 0; b.primaryAxisSizingMode = b.layoutMode === "VERTICAL" ? "AUTO" : b.primaryAxisSizingMode; b.counterAxisSizingMode = b.layoutMode === "HORIZONTAL" ? "AUTO" : b.counterAxisSizingMode; }
  let c;
  if (b.type === "FRAME") c = figma.createComponentFromNode(b);
  else { c = figma.createComponent(); c.resize(Math.max(b.width, 1), Math.max(b.height, 1)); root.appendChild(c); c.appendChild(b); b.x = 0; b.y = 0; }
  c.name = label;
  made.push(c);
}
root.layoutMode = "VERTICAL";
root.primaryAxisSizingMode = "AUTO";
root.counterAxisSizingMode = "AUTO";
root.paddingTop = root.paddingRight = root.paddingBottom = root.paddingLeft = 80;
root.itemSpacing = 0;
if (made.length === 1) { made[0].name = ${JSON.stringify(comp)}; made[0].layoutSizingHorizontal = "HUG"; openUp(made[0]); return { variants: 1, w: root.width, h: root.height }; }
made.forEach((c, i) => { c.name = "Variant=" + (i ? c.name.replace(/[=,]/g, " ") : "Demo"); });
const set = figma.combineAsVariants(made, root);
set.name = ${JSON.stringify(comp)};
set.layoutMode = "VERTICAL";
set.primaryAxisSizingMode = "AUTO";
set.counterAxisSizingMode = "AUTO";
set.itemSpacing = 40;
// a control hanging past its example (carousel arrows) stays visible
openUp(set);
return { variants: made.length, w: root.width, h: root.height };`);

const place = (names) => rpc(`
const names = ${JSON.stringify(names)};
${PAGE}
const first = page.children.find((n) => n.name === names[0]);
let x = first ? first.x : 0, y = first ? first.y : 0, bottom = y;
const x0 = x;
for (const name of names) {
  const n = page.children.find((k) => k.type === "FRAME" && k.name === name);
  if (!n) continue;
  if (x > x0 && x + n.width > x0 + ${ROW}) { x = x0; y = bottom + ${GAP}; }
  n.x = x; n.y = y;
  x += n.width + ${GAP};
  bottom = Math.max(bottom, y + n.height);
}
return 1;`);

const t0 = Date.now();
const report = [];
for (const slug of slugs) {
  const name = `${label} · ${slug}`, t1 = Date.now();
  try {
    if (!(await exists(name))) await focus(), execFileSync("node", [join(dir, "web-to-figma.mjs"), `${base}/${slug}`, "--only", only, "--out", join(out, slug), "--name", name, "--pace", "0", "--hold", "0", "--reveal", "400"], { stdio: ["ignore", "ignore", "inherit"], timeout: 300000 });
    const r = await finish(name, title(slug));
    // --board "<frame>": the page's icons become the file's own components
    if (board && !r.empty && !r.done) execFileSync("node", [join(dir, "web-icons.mjs"), "--captures", join(out, slug), "--frames", `^${name}$`, "--board", board, "--clean"], { stdio: ["ignore", "ignore", "inherit"], timeout: 120000 });
    await place(slugs.map((s) => `${label} · ${s}`));
    report.push([slug, r.empty ? "empty" : r.done ? "already" : `${r.variants} variant(s)`, Math.round((Date.now() - t1) / 1000) + " s"]);
  } catch (e) {
    report.push([slug, "FAILED " + String(e.message).split("\n")[0].slice(0, 120), Math.round((Date.now() - t1) / 1000) + " s"]);
    // a failed page leaves no half frame nor cursor behind
    await rpc(`${PAGE} H.release(); for (const n of page.children.slice()) if (/^angelo-(cursor|ring)$/.test(n.name) || (n.type === "FRAME" && n.name === ${JSON.stringify(name)} && !n.children.some((k) => k.type === "COMPONENT" || k.type === "COMPONENT_SET"))) n.remove(); return 1`).catch(() => {});
  }
  console.log(report.at(-1).join(" · "));
}
console.log(`total ${Math.round((Date.now() - t0) / 1000)} s · ${report.filter((r) => /variant/.test(r[1])).length} components · ${report.filter((r) => /FAILED|empty/.test(r[1])).length} to redo`);
