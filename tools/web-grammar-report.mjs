#!/usr/bin/env node
// Dry run on frozen captures, nothing is written to Figma: how the kit grammar reads each component
// the layout finds. Usage: web-grammar-report.mjs <case> [case…]
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectItems } from "./web-items.mjs";
import { layoutTree } from "./web-layout.mjs";
import { loadGrammar, recognize } from "./web-grammar.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../tests/web");
const args = process.argv.slice(2);
const grammar = loadGrammar();
const text = (u) => (u.runs ? u.runs.map((x) => x.text).join("") : (u.kids || []).map(text).join(" ")).trim().replace(/\s+/g, " ").slice(0, 44);
const depth = (u) => (u.kids?.length ? 1 + Math.max(...u.kids.map(depth)) : 0);

for (const name of args.filter((a) => !a.startsWith("--"))) {
  const cap = JSON.parse(readFileSync(join(root, name, "capture.json"), "utf8"));
  const exPath = join(root, name, "expect.json");
  const ex = existsSync(exPath) ? JSON.parse(readFileSync(exPath, "utf8")) : {};
  const items = selectItems(cap, { height: ex.height, exclude: ex.exclude ? new RegExp(ex.exclude, "i") : null });
  const t = layoutTree(cap, items);
  const pageW = t.root.w;
  const rows = t.comps.map((c) => {
    const u = c.vars[0].union;
    return { old: c.name, count: c.count, u, read: recognize(u, grammar, { count: c.count, pageW }) };
  });
  const hits = rows.filter((r) => r.read);
  const by = {};
  for (const r of hits) by[r.read.name] = (by[r.read.name] || 0) + 1;
  console.log(`\n== ${name}: ${hits.length}/${rows.length} read · ` + Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · "));
  for (const r of hits) {
    console.log(`  ${r.read.name.padEnd(12)} ${r.old.slice(0, 26).padEnd(27)} x${String(r.count).padEnd(3)} ${Math.round(r.u.w)}x${Math.round(r.u.h)} d${depth(r.u)} [${r.read.layers.join("")}] ${r.read.slots.join(", ").slice(0, 40).padEnd(41)} "${text(r.u)}"`);
  }
  const missed = rows.filter((x) => !x.read && x.u.k === "frame");
  console.log(`  unread frames ${missed.length}: ` + missed.slice(0, 24).map((x) => `${x.old} "${text(x.u).slice(0, 22)}"`).join(" · ").slice(0, 900));
}
