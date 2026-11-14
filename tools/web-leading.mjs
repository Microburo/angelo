// One type rule for a whole library, set in place: a single line height in percent (default 130 %), so the rhythm holds whatever
// the size, and font sizes on an even scale (12 14 16 18 20 24 28 32 36 ...), a size off the scale taking the next one up.
// A control's height no longer depends on them: a painted box up to 64 px holding one line of text keeps its height, fixed,
// its text centred, no vertical padding. Other boxes follow their text. Multi-style texts are set range by range.
// Mains and frames first, then what instances override.
// Usage: node tools/web-leading.mjs --pages "<page>" [--slug <frame name>] [--frames "<page>><frame>"] [--percent 130] [--dry]

import { makeRpc, pluginFile } from "./web-lib.mjs";

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const [pages, frames, one] = [opt("--pages"), opt("--frames"), opt("--slug")];
const percent = Number(opt("--percent") || 130);
const dry = args.includes("--dry");
const rpc = makeRpc(await pluginFile());

const pageOf = `const pageOf = async (name) => { const p = figma.root.children.find((q) => q.name === name); if (p) await p.loadAsync(); return p; };`;
const roots = [];
if (frames && !one) {
  const [page, frame] = frames.split(">");
  roots.push(...(await rpc(`${pageOf}
const p = await pageOf(${JSON.stringify(page)});
return p.children.filter((n) => n.name === ${JSON.stringify(frame)}).map((n) => n.id);`)));
}
if (pages) roots.push(...(await rpc(`${pageOf}
const p = await pageOf(${JSON.stringify(pages)});
return p.children.filter((n) => n.type === "FRAME" && (${JSON.stringify(one || "")} === "" || n.name === ${JSON.stringify(one || "")})).map((n) => n.id);`)));

const pass = (id) => rpc(`
const root = await figma.getNodeByIdAsync(${JSON.stringify(id)});
const dry = ${dry}, percent = ${percent};
const SCALE = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 128];
const onScale = (v) => SCALE.find((s) => s >= v - 0.01) || Math.ceil(v / 2) * 2;
const safe = (f, d) => { try { return f(); } catch { return d; } };
const seen = (l) => (l === figma.mixed ? [] : l || []).filter((p) => p.visible !== false);
const painted = (n) => seen(n.fills).length > 0 || seen(n.strokes).length > 0;
const own = [], inside = [];
const walk = (n, deep) => {
  if (n.type === "TEXT") (deep ? inside : own).push(n);
  const kids = safe(() => n.children, null);
  if (kids) for (const k of kids) walk(k, deep || n.type === "INSTANCE");
};
walk(root, false);

const off = (t) => t.getStyledTextSegments(["lineHeight", "fontSize"]).filter((s) => s.lineHeight.unit !== "PERCENT" || Math.abs(s.lineHeight.value - percent) > 0.01 || onScale(s.fontSize) !== s.fontSize);
const out = { name: root.name, texts: own.length, inside: inside.length, changed: 0, overrides: 0, fixed: 0, sizes: {}, resized: [], failed: [] };
const apply = async (t, segs) => {
  for (const s of t.getStyledTextSegments(["fontName"])) await figma.loadFontAsync(s.fontName);
  for (const s of segs) {
    t.setRangeFontSize(s.start, s.end, onScale(s.fontSize));
    t.setRangeLineHeight(s.start, s.end, { unit: "PERCENT", value: percent });
  }
};
const tally = (segs) => { for (const s of segs) if (onScale(s.fontSize) !== s.fontSize) { const k = s.fontSize + "→" + onScale(s.fontSize); out.sizes[k] = (out.sizes[k] || 0) + 1; } };
for (const t of own) {
  try {
    const segs = off(t);
    if (!segs.length) continue;
    out.changed++;
    tally(segs);
    if (dry) continue;
    const box = t.parent;
    const control = box && box.layoutMode && box.layoutMode !== "NONE" && painted(box) && box.height <= 64 && t.characters.indexOf("\\n") < 0 && t.height <= t.fontSize * 2.1;
    const h0 = box.height;
    if (control && box.layoutSizingVertical === "HUG" && box.layoutMode === "HORIZONTAL") {
      box.layoutSizingVertical = "FIXED";
      box.resize(box.width, h0);
      box.paddingTop = 0; box.paddingBottom = 0;
      box.counterAxisAlignItems = "CENTER";
      out.fixed++;
    }
    await apply(t, segs);
    if (control && Math.abs(box.height - h0) > 0.5) out.resized.push(box.name + " " + h0 + "→" + box.height);
  } catch (e) { out.failed.push(t.id + " " + String(e.message).slice(0, 90)); }
}
for (const t of inside) {
  try {
    const segs = off(t);
    if (!segs.length) continue;
    out.overrides++;
    tally(segs);
    if (!dry) await apply(t, segs);
  } catch (e) { out.failed.push(t.id + " " + String(e.message).slice(0, 90)); }
}
return out;`);

// An instance whose sizing was set to hug keeps hugging once its main has a fixed height and no vertical padding: it collapses
// onto its text. It takes the main's height back; a nested one follows the copy held by its own main.
const heights = (id) => rpc(`
const root = await figma.getNodeByIdAsync(${JSON.stringify(id)});
const dry = ${dry};
const out = { hug: 0, set: 0, nested: 0, stuck: [] };
const walk = async (x, deep) => {
  let kids = null;
  try {
    if (x.type === "INSTANCE") {
      const m = await x.getMainComponentAsync();
      if (m && m.layoutSizingVertical === "FIXED" && x.layoutSizingVertical === "HUG") {
        out.hug++;
        // (a nested instance can't be resized: its minimum height holds it)
        if (deep) { out.nested++; if (!dry && Math.abs(x.height - m.height) > 0.5) { if (x.height < m.height) x.minHeight = m.height; else out.stuck.push(x.id + " " + x.height + ">" + m.height); } }
        else if (!dry) { x.layoutSizingVertical = "FIXED"; x.resize(x.width, m.height); out.set++; }
      }
    }
    kids = x.children;
  } catch (e) { out.stuck.push(x.id + " " + String(e.message).slice(0, 70)); }
  if (kids) for (const k of kids) await walk(k, deep || x.type === "INSTANCE");
};
await walk(root, false);
return out;`);

const total = { texts: 0, inside: 0, changed: 0, overrides: 0, fixed: 0, resized: 0, failed: 0 };
const sizes = {};
const t0 = Date.now();
for (const id of roots) {
  const r = await pass(id);
  for (const k of ["texts", "inside", "changed", "overrides", "fixed"]) total[k] += r[k];
  total.resized += r.resized.length;
  total.failed += r.failed.length;
  for (const [k, v] of Object.entries(r.sizes)) sizes[k] = (sizes[k] || 0) + v;
  for (const q of r.resized) console.log("  size " + r.name + ": " + q);
  for (const f of r.failed) console.log("  failed " + r.name + ": " + f);
}
const back = { hug: 0, set: 0, nested: 0, stuck: 0 };
for (const id of roots) {
  const r = await heights(id);
  for (const k of ["hug", "set", "nested"]) back[k] += r[k];
  back.stuck += r.stuck.length;
  for (const q of r.stuck) console.log("  height not rendered: " + q);
}
console.log("instance heights " + JSON.stringify(back));
console.log("body " + (Object.entries(sizes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(" · ") || "none"));
console.log(JSON.stringify({ ...total, ms: Date.now() - t0 }));
