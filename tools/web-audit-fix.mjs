// Applies a web-audit report to the frames in place, controls only (painted box up to 64 px): the source's height, fixed, centred,
// no vertical padding; a lone text hugs inside the source's side padding; otherwise the source's width, fixed, the right inset set
// when an icon closes the box. A layer inside an instance is fixed on the layer its main holds, shared by every use of that main:
// it never takes a height only some uses want. It keeps the lowest one, a taller use makes up its own with padding.
// A stacked control stays stacked when it is an instance (its layout belongs to its main): centred along its own axis.
// Never rebuilds anything.
// Usage: node tools/web-audit-fix.mjs --report <audit.json> [--slug <one>] [--only h] [--dry]

import { readFileSync } from "node:fs";
import { makeRpc, pluginFile } from "./web-lib.mjs";

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const [file, one, only] = [opt("--report"), opt("--slug"), opt("--only")];
const dry = args.includes("--dry");
const rpc = makeRpc(await pluginFile());

// A text without ink reads its content box, so equal insets say nothing unless they are wider than a side padding.
const centred = (q) => Math.abs(q.cap.l - q.cap.r) <= 2 && (q.hugs || q.leaf === "icon" || q.cap.l > 16);
const carrierOf = (id) => id.split(";").pop();

// Heights wanted of each layer held by a main, across every use the report names.
const wanted = {};
const report = JSON.parse(readFileSync(file, "utf8"));
const pagesOf = report.filter((p) => !one || p.slug === one);
for (const page of pagesOf) for (const v of page.variants) for (const q of v.issues)
  if (q.kind === "box" && q.cap.h <= 64 && q.id.startsWith("I") && q.bad.includes("h")) (wanted[carrierOf(q.id)] ||= []).push(q.cap.h);

const fix = (items) => rpc(`
const items = ${JSON.stringify(items)}, wanted = ${JSON.stringify(wanted)}, dry = ${dry}, only = ${JSON.stringify(only || "")};
const out = { h: 0, gaps: 0, held: 0, hug: 0, w: 0, right: 0, skipped: [] };
const done = new Set();
const mainOf = (n) => { let p = n.parent; while (p && p.type !== "COMPONENT" && p.type !== "PAGE") p = p.parent; return p && p.type === "COMPONENT" ? p : null; };
const setHeight = (n, h, c) => {
  n.layoutSizingVertical = "FIXED";
  n.resize(n.width, h);
  n.paddingTop = 0; n.paddingBottom = 0;
  if (n.layoutMode === "VERTICAL") { n.primaryAxisAlignItems = "CENTER"; n.counterAxisAlignItems = c ? "CENTER" : "MIN"; }
  else n.counterAxisAlignItems = "CENTER";
};
for (const q of items) {
  try {
    const inside = q.id.startsWith("I");
    const id = q.id.split(";").pop();
    const n = await figma.getNodeByIdAsync(id);
    if (!n || !n.layoutMode || n.layoutMode === "NONE") { out.skipped.push(q.name + " " + q.id + " without auto layout"); continue; }
    const first = !done.has(id);
    done.add(id);
    if (dry) { for (const b of q.bad) out[b === "h" ? "h" : b === "w" ? "w" : "right"]++; continue; }
    // a one-line control stacked by the build: a row, when it is ours to change
    if (first && n.layoutMode === "VERTICAL" && n.type !== "INSTANCE") {
      const kids = n.children.map((k) => [k, k.layoutSizingHorizontal, k.layoutSizingVertical]);
      const [sw, sh] = [n.layoutSizingHorizontal, n.layoutSizingVertical];
      n.layoutMode = "HORIZONTAL";
      for (const [k, a, b] of kids) { k.layoutSizingHorizontal = a; k.layoutSizingVertical = b; }
      n.layoutSizingHorizontal = sw; n.layoutSizingVertical = sh;
    }
    if (q.bad.includes("h")) {
      if (!inside) {
        // a margin taken inside the box when it was flattened goes back to the column holding it
        const margin = n.height - q.cap.h, p = n.parent;
        const stacked = p && p.layoutMode === "VERTICAL" && p.type !== "INSTANCE" && p.children.indexOf(n) < p.children.length - 1;
        if (n.paddingBottom >= margin && margin > 1.5 && stacked) { p.itemSpacing = Math.max(p.itemSpacing, margin); out.gaps++; }
        setHeight(n, q.cap.h, q.centred);
        out.h++;
      }
      else {
        const asked = wanted[id] || [q.cap.h];
        const low = Math.min(...asked);
        const m = mainOf(n);
        const uses = m ? (await m.getInstancesAsync()).length : Infinity;
        // every use agrees: the layer itself takes it; otherwise it never rises above what it holds
        const target = asked.every((h) => h === low) && asked.length >= uses ? low : Math.min(low, n.height);
        if (first && Math.abs(n.height - target) > 0.5) { setHeight(n, target, q.centred); out.h++; }
        if (first && n.layoutMode === "VERTICAL") { n.primaryAxisAlignItems = "CENTER"; n.counterAxisAlignItems = q.centred ? "CENTER" : "MIN"; }
        // a nested layer can't be resized: it hugs, its padding makes up the height (a text at the top keeps it there)
        if (q.cap.h > target + 0.5) {
          const seen = await figma.getNodeByIdAsync(q.id);
          if (seen) {
            const content = Math.max(...seen.children.map((k) => k.height));
            const extra = Math.max(0, q.cap.h - content);
            const top = seen.paddingTop === 0 && seen.paddingBottom > 0;
            seen.layoutSizingVertical = "HUG";
            seen.paddingTop = top ? 0 : extra / 2;
            seen.paddingBottom = top ? extra : extra / 2;
            out.held++;
          }
        }
      }
    }
    if (only === "h" || (inside && !first)) continue;
    if (q.hugs && (q.bad.includes("w") || q.bad.includes("l") || q.bad.includes("r"))) {
      n.paddingLeft = q.cap.l; n.paddingRight = q.cap.r;
      n.layoutSizingHorizontal = "HUG";
      n.primaryAxisAlignItems = "CENTER";
      out.hug++;
    } else if (q.bad.includes("w") && !inside) {
      n.layoutSizingHorizontal = "FIXED";
      n.resize(q.cap.w, n.height);
      out.w++;
    } else if (q.bad.includes("w")) out.skipped.push(q.name + " " + q.id + " width inside an instance");
    // an icon alone in the middle of its box in the source: centred, no side padding to get wrong
    if (q.leaf === "icon" && q.lastIcon && q.centred && n.layoutMode === "HORIZONTAL" && (q.bad.includes("l") || q.bad.includes("r"))) {
      n.paddingLeft = 0; n.paddingRight = 0;
      n.primaryAxisAlignItems = "CENTER";
      out.right++;
    } else if (q.lastIcon && q.bad.includes("r")) { n.paddingRight = Math.max(0, n.paddingRight + q.cap.r - q.fig.r); out.right++; }
  } catch (e) { out.skipped.push(q.name + " " + q.id + " " + String(e.message).slice(0, 80)); }
}
return out;`);

const total = { h: 0, gaps: 0, held: 0, hug: 0, w: 0, right: 0, skipped: 0 };
for (const page of pagesOf) {
  const items = page.variants.flatMap((v) => v.issues)
    .filter((q) => q.kind === "box" && q.cap.h <= 64 && (only !== "h" || q.bad.includes("h")))
    .map((q) => ({ ...q, centred: centred(q) }));
  if (!items.length) continue;
  for (let i = 0; i < items.length; i += 40) {
    const r = await fix(items.slice(i, i + 40));
    for (const k of ["h", "gaps", "held", "hug", "w", "right"]) total[k] += r[k];
    total.skipped += r.skipped.length;
    for (const s of r.skipped) console.log("  " + page.slug + " : " + s);
  }
}
console.log(JSON.stringify(total));
