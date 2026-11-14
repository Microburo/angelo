// Components already in Figma take the names the pipeline gives them today, in place, nothing rebuilt:
// a main is matched by the structure keys its build left on it (fdslSig, then fdslFam), the component
// (set), its variant labels and the instances still carrying the old name follow. Without --apply it
// only reports. A family split or merged since its build is reported, never moved.
// Usage: node tools/web-rename.mjs [case…] [--keep "<name>"…] [--apply]

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRpc, pluginFile } from "./web-lib.mjs";
import { selectItems } from "./web-items.mjs";
import { layoutTree } from "./web-layout.mjs";
import { hashLike } from "./web-components.mjs";
import { isCssFragment } from "../plugin/src/lint-rules.mjs";

const COMP_PAGE = "💊 Components";
const SAME_SIZE = 2; // px
const ROOT = fileURLToPath(new URL("../tests/web", import.meta.url));
const args = process.argv.slice(2);
const apply = args.includes("--apply");
// --keep "<name in Figma>", repeatable: a proposal judged wrong, left as it is
const keep = new Set(args.flatMap((a, i) => (args[i - 1] === "--keep" ? [a] : [])));
const wanted = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--keep");

const siteOf = (cap, name) => { try { return new URL(cap.url).hostname.replace(/^www\./, ""); } catch { return name; } };
const rpc = makeRpc(await pluginFile());

const started = Date.now();
const live = await rpc(`
const cp = figma.root.children.find((p) => p.name === ${JSON.stringify(COMP_PAGE)});
if (!cp) return [];
await cp.loadAsync();
const out = [];
for (const board of cp.children.filter((n) => n.getPluginData("fdslSite"))) {
  for (const m of board.findAllWithCriteria({ types: ["COMPONENT"] })) {
    const sig = m.getPluginData("fdslSig");
    if (!sig) continue;
    const set = m.parent.type === "COMPONENT_SET" ? m.parent : null;
    out.push({ site: board.getPluginData("fdslSite"), id: m.id, name: m.name, w: m.width, h: m.height, sig, fam: m.getPluginData("fdslFam"), holder: (set || m).id, holderName: (set || m).name, inSet: !!set });
  }
}
return out;`);
console.log(`${live.length} variants read in Figma, ${Date.now() - started} ms`);

const cases = readdirSync(ROOT).filter((d) => existsSync(join(ROOT, d, "capture.json")) && (!wanted.length || wanted.includes(d)));
const holders = [], variants = [];
let split = 0, unmatched = 0, seen = 0, refused = 0, worse = 0;
for (const name of cases) {
  const cap = JSON.parse(readFileSync(join(ROOT, name, "capture.json"), "utf8"));
  const mains = live.filter((m) => m.site === siteOf(cap, name));
  if (!mains.length) continue;
  seen++;
  const ex = existsSync(join(ROOT, name, "expect.json")) ? JSON.parse(readFileSync(join(ROOT, name, "expect.json"), "utf8")) : {};
  const tree = layoutTree(cap, selectItems(cap, { height: ex.height, exclude: ex.exclude ? new RegExp(ex.exclude, "i") : null }));
  // holder id → the names today's pipeline gives what it holds
  const named = new Map();
  const take = (m, comp, v) => {
    if (!named.has(m.holder)) named.set(m.holder, { holder: m.holder, old: m.holderName, inSet: m.inSet, names: new Set(), labels: new Map() });
    const h = named.get(m.holder);
    h.names.add(comp.name);
    if (m.inSet && !v.label.includes("=")) h.labels.set(m.id, { old: m.name, label: "Variant=" + v.label });
    else if (m.inSet) h.labels.set(m.id, { old: m.name, label: v.label });
  };
  const matched = new Set();
  // the signature names one exact structure; the family only counts when it leaves no choice, and the
  // main's size has to agree in both cases (a wide and a narrow button share a family)
  const fits = (m, v) => Math.abs(m.w - v.union.w) <= SAME_SIZE && Math.abs(m.h - v.union.h) <= SAME_SIZE;
  const link = (m, comp, v) => {
    if (!fits(m, v)) { refused++; return; }
    matched.add(m.id);
    take(m, comp, v);
  };
  const open = [];
  for (const comp of tree.comps) for (const v of comp.vars) {
    const m = mains.find((x) => x.sig === v.sig);
    if (m) link(m, comp, v);
    else open.push({ comp, v });
  }
  for (const { comp, v } of open) {
    const left = mains.filter((x) => x.fam === comp.fam && !matched.has(x.id));
    if (left.length === 1 && comp.vars.length === 1) link(left[0], comp, v);
  }
  unmatched += mains.filter((m) => !matched.has(m.id)).length;
  for (const h of named.values()) {
    // a family merged since its build: its parts keep their name until a rebuild of that component
    if (h.names.size > 1) { split++; console.log(`${name} · ${h.old}: now spans ${h.names.size} components (${[...h.names].join(", ")}), left as is`); continue; }
    const fresh = [...h.names][0];
    // a build name that is only a CSS fragment is no better than the one in Figma
    if (fresh.split(/[\s/]+/).some((w) => isCssFragment(w) || (w !== "Glyph" && hashLike(w.toLowerCase())))) { worse++; console.log(`${name} · ${h.old}: proposed name unreadable (${fresh}), left as is`); }
    else if (keep.has(h.old)) console.log(`${name} · ${h.old}: kept (proposed: ${fresh})`);
    else if (fresh !== h.old) holders.push({ id: h.holder, name: fresh, old: h.old, site: name });
    // labels stay unique in their set: one already used keeps the old label
    const used = new Set();
    for (const [id, l] of h.labels) {
      if (used.has(l.label)) continue;
      used.add(l.label);
      if (l.label !== l.old) variants.push({ id, name: l.label });
    }
  }
}
for (const h of holders.slice(0, 40)) console.log(`${h.site} · ${h.old} → ${h.name}`);
if (holders.length > 40) console.log(`… and ${holders.length - 40} more`);
console.log(`${seen} sites present · ${holders.length} components to rename · ${variants.length} variant labels · ${split} families split since, left · ${unmatched} variants without a match · ${refused} dropped, different size · ${worse} unreadable proposed names, left`);

if (apply && (holders.length || variants.length)) {
  const t = Date.now();
  const r = await rpc(`
const renames = ${JSON.stringify(holders)}, labels = ${JSON.stringify(variants)};
let done = 0, instances = 0, failed = [];
for (const l of labels) { const m = await figma.getNodeByIdAsync(l.id); try { if (m) { m.name = l.name; done++; } } catch (e) { failed.push(l.id + " " + e.message); } }
for (const h of renames) {
  const n = await figma.getNodeByIdAsync(h.id);
  if (!n) continue;
  n.name = h.name;
  done++;
  // (an instance with its default name has already followed; one named after the family alone has not)
  const head = (s) => s.split("/")[0];
  for (const m of n.type === "COMPONENT_SET" ? n.children : [n]) for (const i of await m.getInstancesAsync()) {
    if (i.name === h.old) { i.name = h.name; instances++; }
    else if (i.name === head(h.old) && head(h.old) !== head(h.name)) { i.name = head(h.name); instances++; }
  }
}
return { done, instances, failed };`);
  console.log(`applied: ${r.done} names, ${r.instances} instances, ${r.failed.length} failures, ${Date.now() - t} ms`);
  r.failed.slice(0, 5).forEach((f) => console.log("  " + f));
} else if (!apply) console.log("nothing written (--apply to apply)");
