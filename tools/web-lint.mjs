#!/usr/bin/env node
// Component lint on frozen captures, nothing written to Figma: what the layout would produce, measured by the
// same rules as H.lint. Usage: web-lint.mjs [case…] [--list] [--rule <id>] [--json <file>]
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectItems } from "./web-items.mjs";
import { layoutTree } from "./web-layout.mjs";
import { loadGrammar } from "./web-grammar.mjs";
import { kitKey, lint, summarize } from "../plugin/src/lint-rules.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../tests/web");
const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const [only, json, list] = [opt("--rule"), opt("--json"), args.includes("--list")];
const skip = new Set([only, json].filter(Boolean));
const asked = args.filter((a) => !a.startsWith("--") && !skip.has(a));
const cases = asked.length ? asked : readdirSync(root).filter((d) => existsSync(join(root, d, "capture.json")));
// (same lookup as the plugin: a component belongs to the kit by the name it carries, case ignored)
const KIT = new Map([...loadGrammar().values()].map((c) => [c.name.toLowerCase(), c]));

const hasParts = (s) => /=/.test(s);
const axesOf = (labels) => {
  const axes = {};
  for (const l of labels) {
    if (!hasParts(l)) { (axes.Variant ||= new Set()).add(l); continue; }
    for (const part of l.split(",")) { const [k, v] = part.split("=").map((x) => x.trim()); (axes[k] ||= new Set()).add(v); }
  }
  return Object.fromEntries(Object.entries(axes).map(([k, v]) => [k, [...v]]));
};
const layer = (n, isRoot) => {
  // (what the frame does to its content counts, as in H.lint: a shadow, an opacity, a clip)
  const painted = !!(n.bg || n.grad || n.border || n.img || n.shadow || n.blur || n.op || n.blend || n.clip);
  const padded = (n.pad || []).some(Boolean);
  const nested = !isRoot && (n.comp || n.inst);
  // (a drawing larger than an icon is an illustration, a logo: same threshold as H.lint)
  const kind = n.k === "text" ? "text" : n.k === "svg" ? (Math.max(n.w, n.h) <= 64 ? "icon" : "shape") : n.k === "img" ? "image" : n.k === "frame" ? (nested ? "instance" : "frame") : "shape";
  const prop = n.opt ? n.prop || n.name || n.k : undefined;
  return { name: n.name || n.k, kind, auto: !!n.dir, painted, padded, abs: !!n.abs, slot: !!n.slot, optional: !!n.opt, boolProp: prop, swapProp: kind === "icon" && nested ? n.name || "icon" : undefined, kids: kind === "frame" ? (n.kids || []).map((k) => layer(k, false)) : undefined };
};
const neutral = (c) => {
  const labels = c.vars.map((v) => v.label);
  const axes = c.vars.length > 1 ? axesOf(labels) : {};
  const variants = c.vars.map((v) => layer(v.union, true));
  const props = [];
  const collect = (l) => { if (l.boolProp) props.push({ name: l.boolProp, type: "BOOLEAN" }); (l.kids || []).forEach(collect); };
  variants.forEach(collect);
  const seen = new Set();
  const def = KIT.get(kitKey(c.name));
  return { name: c.name, count: c.count, kit: def?.name, level: def?.level, axes, props: props.filter((p) => !seen.has(p.name) && seen.add(p.name)), variants };
};

const total = {};
const report = [];
let [nComps, clean] = [0, 0];
for (const name of cases) {
  const dir = join(root, name);
  const cap = JSON.parse(readFileSync(join(dir, "capture.json"), "utf8"));
  const ex = existsSync(join(dir, "expect.json")) ? JSON.parse(readFileSync(join(dir, "expect.json"), "utf8")) : {};
  const t0 = Date.now();
  const tree = layoutTree(cap, selectItems(cap, { height: ex.height, exclude: ex.exclude ? new RegExp(ex.exclude, "i") : null }));
  const comps = tree.comps.map(neutral);
  const issues = lint(comps);
  const s = summarize(comps, issues);
  report.push({ name, ...s, ms: Date.now() - t0, issues });
  for (const [k, v] of Object.entries(s.byRule)) total[k] = (total[k] || 0) + v;
  nComps += s.components;
  clean += (s.clean * s.components) / 100;
  console.log(`${name.padEnd(16)} ${String(s.components).padStart(4)} comps  ${String(s.clean).padStart(3)} % clean  ${String(s.errors).padStart(4)} err ${String(s.warnings).padStart(4)} warn ${String(s.infos).padStart(4)} info  ${Date.now() - t0} ms`);
  if (list) for (const i of issues) if (!only || i.rule === only) console.log(`  ${i.rule.padEnd(15)} ${i.component} · ${i.at}${i.detail ? " · " + i.detail : ""}`);
}
console.log(`\n${nComps} components, ${nComps ? Math.round((100 * clean) / nComps) : 100} % clean`);
for (const [k, v] of Object.entries(total).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(16)} ${v}`);
if (json) writeFileSync(json, JSON.stringify(report, null, 1));
