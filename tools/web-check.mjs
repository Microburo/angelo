// Offline regression check of the web → Figma method, without Figma: every case in
// tests/web/<case>/ (frozen capture.json + expect.json) goes through the same item
// selection as web-build.mjs, then generic checks and the case's expectations.
// Usage: node tools/web-check.mjs [case…]

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { Script } from "node:vm";
import { fileURLToPath } from "node:url";
import { selectItems, gradients } from "./web-items.mjs";
import { layoutTree } from "./web-layout.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../tests/web");
const only = process.argv.slice(2);
const cases = readdirSync(root).filter((d) => existsSync(join(root, d, "expect.json")) && (!only.length || only.includes(d)));

let failed = 0;
let todo = 0;
for (const name of cases) {
  const cap = JSON.parse(readFileSync(join(root, name, "capture.json"), "utf8"));
  const ex = JSON.parse(readFileSync(join(root, name, "expect.json"), "utf8"));
  const items = selectItems(cap, { height: ex.height, exclude: ex.exclude ? new RegExp(ex.exclude, "i") : null });
  const texts = items.filter((i) => i.text);
  const has = (t) => texts.some((i) => i.text.includes(t));
  const checks = [];
  const check = (label, ok, detail = "") => checks.push({ label, ok, detail });

  // Generic: what always renders wrong in Figma
  // one narrow glyph (a "·" separator, 3 px wide) is drawn, not hidden
  const tiny = texts.filter((i) => (i.w < 4 && [...i.text.trim()].length > 1) || i.h < 4);
  check("no text < 4 px (sr-only, vertical column)", !tiny.length, tiny.map((i) => i.text).join(", "));
  const out = items.filter((i) => i.x + i.w <= 0 || i.x >= cap.width);
  check("nothing outside the frame", !out.length, `${out.length} boxes`);
  const sprites = items.filter((i) => i.svg && /<use\b/.test(i.svg));
  check("icons without a <use> sprite (Figma does not resolve it)", !sprites.length, `${sprites.length} icons`);
  // a mask clips its content to its box: a layer past a masked ancestor (shimmer sweep parked
  // beside its text) is drawn in Figma where the page shows nothing
  // (a painted leaf: texts, vectors and containers overflow like any clip, the build never clips)
  const byId = new Map(cap.boxes.map((b) => [b.id, b]));
  const parents = new Set(cap.boxes.map((b) => b.p));
  const unmasked = items.filter((i) => !i.text && !i.svg && !parents.has(i.id)).filter((i) => {
    for (let a = byId.get(byId.get(i.id)?.p); a; a = byId.get(a.p)) if (a.mask) return i.x < a.x - 1 || i.y < a.y - 1 || i.x + i.w > a.x + a.w + 1 || i.y + i.h > a.y + a.h + 1;
    return false;
  });
  check("no layer outside a parent's mask", !unmasked.length, `${unmasked.length} : ${unmasked.slice(0, 3).map((i) => i.id).join(" · ")}`);
  // a round faint leaf fill (a few % alpha) is a glow: on the page it is blurred, drawn sharp in Figma
  // it shows as a grey disc
  const sharp = items.filter((i) => !i.text && !parents.has(i.id) && !i.blur && i.r >= Math.min(i.w, i.h) / 2 && Math.min(i.w, i.h) >= 40 && /rgba\([^)]*,\s*0?\.0\d*\)/.test(i.bg || ""));
  check("no sharp halo (almost transparent round background without blur)", !sharp.length, `${sharp.length} : ${sharp.slice(0, 3).map((i) => i.id).join(" · ")}`);
  // runs of different sizes on one row ("Diffs +") come back as one rect each: counted as two
  // lines, the build breaks between them
  const split = texts.filter((i) => (i.lines || []).some((l, k) => k && Math.min(l.y + l.h, i.lines[k - 1].y + i.lines[k - 1].h) - Math.max(l.y, i.lines[k - 1].y) >= Math.min(l.h, i.lines[k - 1].h) / 2));
  check("no text line split across one row", !split.length, `${split.length} : ${split.slice(0, 3).map((i) => i.text.slice(0, 20)).join(" · ")}`);
  // an svg whose markup was not kept (too long: a scatter of hundreds of dots) leaves its chart empty
  const bare = cap.boxes.filter((b) => b.img === "svg" && !b.svg && b.w * b.h >= 400 && (!ex.height || b.y < ex.height));
  check("no captured svg without its markup", !bare.length, `${bare.length} : ${bare.slice(0, 3).map((b) => b.hint || b.id).join(" · ")}`);
  // element contract (the capture half; web-compare checks the Figma half): every picture read
  // reaches the build, none caught mid-animation, none undecoded and left without a source
  const kept = new Set(items.filter((i) => i.src).map((i) => i.id));
  const lost = cap.boxes.filter((b) => b.img && b.img !== "svg" && b.w * b.h >= 400 && (!ex.height || b.y < ex.height) && !kept.has(b.id) && items.some((i) => i.id === b.id));
  check("no captured image lost before the build", !lost.length, `${lost.length} : ${lost.slice(0, 3).map((b) => b.hint || b.id).join(" · ")}`);
  const moving = cap.boxes.filter((b) => b.shot && b.anim);
  check("no shot taken mid-animation", !moving.length, `${moving.length} : ${moving.slice(0, 3).map((b) => b.hint || b.id).join(" · ")}`);
  const blank = cap.boxes.filter((b) => b.dec === 0 && !b.img);
  check("no undecoded image left without a source", !blank.length, `${blank.length} : ${blank.slice(0, 3).map((b) => b.hint || b.id).join(" · ")}`);
  const images = items.filter((i) => i.src).length;
  check(`images ≥ ${ex.images ?? 0}`, images >= (ex.images ?? 0), `${images}`);
  // paint order of the built tree: a text under an opaque box painted after it is invisible in Figma
  const { root: tree, comps } = layoutTree(cap, items.map(({ src, ...o }) => (src ? { ...o, img: true } : o)));
  // components kept as few as asked: their number, a component's variants and boolean names
  if (ex.maxComps) check(`at most ${ex.maxComps} components`, comps.length <= ex.maxComps, `${comps.length}`);
  const propsOf = (n) => (n.kids || []).flatMap((k) => [...(k.opt ? [k.prop || k.name] : []), ...(k.comp ? [] : propsOf(k))]);
  for (const [name, want] of Object.entries(ex.comps || {})) {
    const c = comps.find((x) => x.name === name);
    const got = c ? [...new Set(c.vars.flatMap((v) => propsOf(v.union)))].sort().join(", ") : "absent";
    check(`component ${name}: ${want.vars} variant(s), ${want.props.join(", ")}`, c && c.vars.length === want.vars && got === [...want.props].sort().join(", "), c ? `${c.vars.length} : ${got}` : got);
  }
  const order = [];
  // node opacity is relative to its parent in the tree: cumulative for the cover test
  const paint = (n, up = 1) => { n.cum = up * (n.op ?? 1); order.push(n); for (const k of n.revZ ? [...n.kids].reverse() : n.kids || []) paint(k, n.cum); };
  paint(tree);
  // a flow frame past the page sides is laid out from x 0 in Figma: everything in it shifts
  // (inside an absolute layer, an offset is kept as is)
  const wide = [];
  const flowOnly = (n) => { if (n.abs) return; if (n.k === "frame" && (n.x < -1 || n.x + n.w > cap.width + 1)) wide.push(n); if (!n.clip) (n.kids || []).forEach(flowOnly); }; // a clipping frame shows only its own bounds (carousel track)
  flowOnly(tree);
  check("no in-flow frame outside the page edges", !wide.length, `${wide.length} : ${wide.slice(0, 3).map((n) => `${n.hint || n.id} ${Math.round(n.x)}/${Math.round(n.w)}`).join(" · ")}`);
  // words glued in the built text where the browser's lines show a space (inline pieces apart on screen)
  const src = new Map(texts.map((i) => [i.id, i]));
  const flat = (t) => t.replace(/\s+/g, " ").trim();
  const glued = order.filter((n) => n.k === "text" && src.get(n.id)?.lines?.length).flatMap((n) => {
    const want = flat(src.get(n.id).lines.map((l) => l.t).join(" ")), got = flat(n.runs.map((r) => r.text).join(""));
    return want.replace(/ /g, "") === got.replace(/ /g, "") && got.split(" ").length < want.split(" ").length ? [got.slice(0, 30)] : [];
  });
  check("no glued word (space from the browser lines)", !glued.length, `${glued.length} : ${glued.slice(0, 3).join(" · ")}`);
  // the reverse: a space between two text nodes ("+" and "22" in React) the browser does not show
  const spaced = order.filter((n) => n.k === "text" && src.get(n.id)?.lines?.length).flatMap((n) => {
    const want = flat(src.get(n.id).lines.map((l) => l.t).join(" ")), got = flat(n.runs.map((r) => r.text).join(""));
    return want.replace(/ /g, "") === got.replace(/ /g, "") && got.split(" ").length > want.split(" ").length ? [got.slice(0, 30)] : [];
  });
  // a one-line text whose runs carry their own line height: Figma draws the line that tall, the
  // layout must plan it (else each row grows by the difference)
  // a text all but transparent (a carousel slide mid-fade, 3 %) is not seen: never a defect
  const seen = (n) => n.cum >= 0.1;
  const tall = order.filter((n) => n.k === "text" && seen(n) && n.n === 1 && n.runs.some((r) => r.font?.lh > n.h + 1));
  // the same text a pixel or two taller than its grid cell: the cell sets the row pitch, not the text
  const boxOf = new Map(cap.boxes.map((b) => [b.id, b]));
  const cellOf = (n) => { for (let b = boxOf.get(boxOf.get(n.id)?.p); b; b = boxOf.get(b.p)) { if (b.h < 1 || Math.abs(b.h - n.h) < 0.5) continue; return b.h < n.h && n.h - b.h <= 2.5 ? b : null; } return null; };
  const overCell = order.filter((n) => n.k === "text" && n.n === 1 && cellOf(n));
  check("no one-line text taller than its cell", !overCell.length, `${overCell.length} : ${overCell.slice(0, 3).map((n) => n.runs.map((r) => r.text).join("").slice(0, 20)).join(" · ")}`);
  // a box shorter than its line boxes (CSS text-box-trim): Figma trims to the cap height too
  const trimmed = order.filter((n) => { const s = src.get(n.id); return n.k === "text" && s?.font?.lh && s.lines?.length && s.h < s.lines.length * s.font.lh - 4 && s.h < s.lines.at(-1).y + s.lines.at(-1).h - s.lines[0].y - 4 && !n.trim; });
  check("no trimmed text (text-box-trim) built without trimming", !trimmed.length, `${trimmed.length} : ${trimmed.slice(0, 3).map((n) => n.runs.map((r) => r.text).join("").slice(0, 20)).join(" · ")}`);
  // content painted past an overflow-clipping box (a 1200 px logo in a 480 px card): the frame clips it
  const frameOf = new Map(order.filter((n) => n.k === "frame").map((n) => [n.id, n]));
  const spill = order.filter((n) => { for (let b = boxOf.get(boxOf.get(n.id)?.p); b; b = boxOf.get(b.p)) { const f = frameOf.get(b.id); if (b.clip && f && (n.x < b.x - 2 || n.y < b.y - 2 || n.x + n.w > b.x + b.w + 2 || n.y + n.h > b.y + b.h + 2)) return !f.clip; } return false; });
  check("no content overflowing an overflow box built without clipping", !spill.length, `${spill.length} : ${spill.slice(0, 3).map((n) => n.k + " " + n.id).join(" · ")}`);
  check("no text taller in Figma than expected (run line height)", !tall.length, `${tall.length} : ${tall.slice(0, 3).map((n) => n.runs.map((r) => r.text).join("").slice(0, 20)).join(" · ")}`);
  check("no extra space (absent from the browser lines)", !spaced.length, `${spaced.length} : ${spaced.slice(0, 3).join(" · ")}`);
  // an SVG image (shimmer sweep, glow) is mostly transparent: it covers nothing
  const svgImg = new Set(items.filter((i) => i.src && /^data:image\/svg|\.svg(\?|$)/i.test(i.src)).map((i) => i.id));
  const opaque = (n) => n.cum >= 1 && ((n.img && !svgImg.has(n.imgId ?? n.id)) || (n.bg && !/rgba\([^)]*,\s*0?\.\d+\)/.test(n.bg)));
  const area = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  // absolute layers at z auto overlapping keep the page's paint order: a board pushed out of the
  // flow stays under the panel over it
  const lifted = [];
  const sibs = (n) => {
    const ks = n.revZ ? [...(n.kids || [])].reverse() : n.kids || [];
    // CSS paint order at z auto: flow boxes first, then positioned / stacking-context ones, DOM order within each
    const rank = (n) => [n.pin || n.sc ? 1 : 0, n.id];
    const before = (x, y) => x[0] - y[0] || x[1] - y[1];
    ks.forEach((a, i) => { if (a.abs && !a.z && a.id != null) for (const b of ks.slice(i + 1)) if (b.abs && !b.z && b.id != null && area(a, b) > 0 && before(rank(b), rank(a)) < 0) lifted.push(`${b.hint || b.id} > ${a.hint || a.id}`); });
    ks.forEach(sibs);
  };
  sibs(tree);
  check("no in-flow block painted on a positioned layer", !lifted.length, `${lifted.length} : ${lifted.slice(0, process.env.ALL ? 99 : 3).join(" · ")}`);
  // a text the page itself hides (capture `hid`) may stay covered
  const hid = new Set(cap.boxes.filter((b) => b.hid).map((b) => b.id));
  // a one-line text indented to make room for an inline icon paints only past its indent
  const ink = (t) => (t.n === 1 && t.indent ? { ...t, x: t.x + t.indent, w: t.w - t.indent } : t);
  const buried = order.flatMap((t, i) => (t.k === "text" && seen(t) && !hid.has(t.id) && order.slice(i + 1).some((n) => n.k !== "text" && opaque(n) && area(n, ink(t)) >= 0.5 * ink(t).w * t.h) ? [t.runs.map((r) => r.text).join("").slice(0, 30)] : []));
  // a translucent image painted over texts is a texture (grain, noise): on the page it blends
  // (mix-blend-mode) and tiles (background-size); drawn normal and stretched it greys them out
  const veiled = order.flatMap((t, i) => (t.k === "text" && !hid.has(t.id) && order.slice(i + 1).some((n) => n.img && !n.blend && n.cum < 1 && !svgImg.has(n.imgId ?? n.id) && area(n, t) >= 0.5 * t.w * t.h) ? [t.runs.map((r) => r.text).join("").slice(0, 30)] : []));
  check("no translucent texture without blend over text (grain)", !veiled.length, `${veiled.length} : ${veiled.slice(0, 4).join(" · ")}`);
  check("no text covered by a fill painted after it (z-index)", !buried.length, `${buried.length} : ${buried.slice(0, 4).join(" · ")}`);
  // the reverse: a filled layer painted over siblings (an ::after scrim on a hero photo) built as their frame
  // puts its fill under them (a blended one reads the same either way)
  const ofDom = (k, n) => { for (let b = boxOf.get(k.id ?? k.kids?.[0]?.id); b; b = boxOf.get(b.p)) if (b.id === n.id) return true; return false; };
  const sunk = order.filter((n) => n.k === "frame" && n.id != null && (n.bg || n.grad) && !n.blend && (n.kids || []).some((k) => (k.id ?? k.kids?.[0]?.id) < n.id && (k.z ?? 0) === (n.z ?? 0) && !ofDom(k, n)));
  check("no fill painted on top built as a frame under what it covers", !sunk.length, `${sunk.length} : ${sunk.slice(0, 3).map((n) => n.hint || n.id).join(" · ")}`);
  // Figma drops a size set on an instance's sublayer: the occurrences of one variant give each image, shape
  // or drawing layer of the main one size (a width-filling one, one ratio), or some are drawn wrong
  const sizeAt = new Map();
  const unions = new Map(comps.flatMap((c) => c.vars.map((v) => [v.key, v.union])));
  const sized = (inst) => {
    const scan = (m, path, un) => {
      for (const k of m.kids || []) {
        if (k.ui == null || (k.comp && k !== inst)) continue;
        const p = path + "/" + k.ui, ku = un?.kids?.[k.ui];
        if (k.k === "img" || k.k === "rect" || k.k === "svg" || (k.k === "frame" && k.img && !k.kids?.length)) {
          // (a main's layer filling its height takes it from the instance, which Figma lets resize)
          const follows = ku?.sh === "FILL" && inst.sh === "FIXED";
          const v = k.sw === "FILL" ? (follows ? "fill" : k.h > 0 ? "r" + (k.w / k.h).toFixed(2) : "") : (k.sw === "FIXED" ? Math.round(k.w / 2) * 2 : "") + "x" + (k.sh === "FIXED" && !follows ? Math.round(k.h / 2) * 2 : "");
          const key = inst.comp + p;
          (sizeAt.get(key) || sizeAt.set(key, new Set()).get(key)).add(v);
        } else if (k.k === "frame") scan(k, p, ku);
      }
    };
    scan(inst, "", unions.get(inst.comp));
  };
  order.forEach((n) => n.comp && sized(n));
  // a fixed-size auto-layout frame squeezes a filling layer its padding leaves no room for (a 26 px search
  // icon in a 26 px box padded 16 at the top drawn 10 px high); a fixed one overflows, its own size kept
  const squeezed = order.filter((n) => n.dir && n.pad && (n.kids || []).some((k) => !k.abs && ((n.sh === "FIXED" && k.sh === "FILL" && k.h + n.pad[0] + n.pad[2] > n.h + 1) || (n.sw === "FIXED" && k.sw === "FILL" && k.w + n.pad[1] + n.pad[3] > n.w + 1))));
  check("no fixed frame whose padding squeezes the content", !squeezed.length, `${squeezed.length} : ${squeezed.slice(0, 3).map((n) => `${n.name || n.id} ${Math.round(n.w)}x${Math.round(n.h)} ${n.sw}/${n.sh} pad ${n.pad} ${n.dir}${n.clip ? " clip" : ""} kids ${n.kids.filter((k) => !k.abs).map((k) => `${k.k} ${Math.round(k.w)}x${Math.round(k.h)} ${k.sw}/${k.sh}`).join(", ")}`).join(" · ")}`);
  const clash = [...sizeAt].filter(([, v]) => v.size > 1);
  check("no variant with image layers of two sizes (instance size refused by Figma)", !clash.length, `${clash.length} : ${clash.slice(0, 3).map(([k, v]) => `${k} ${[...v].join("/")}`).join(" · ")}`);
  // an input's placeholder spans its field: a hugging one shrinks the field to its few words in Figma
  const fields = order.filter((n) => n.k === "text" && n.inField && n.sw === "HUG");
  check("no field (input) text at auto width", !fields.length, `${fields.length} : ${fields.slice(0, 3).map((n) => `${n.name || n.id} ${Math.round(n.w)} ${n.sw}`).join(" · ")}`);
  // a column of items each under a pinned image (sticky featured list): a gap between them is an empty band in Figma
  const pinMedia = (k) => k.k === "frame" && (k.kids || []).some((m) => m.abs && m.pin && Math.abs(m.h - k.h) <= 2 && Math.abs(m.y - k.y) <= 2);
  const banded = order.filter((n) => n.dir === "V" && !n.bg && n.gap > 0 && (n.kids || []).filter((k) => !k.abs).length > 1 && (n.kids || []).filter((k) => !k.abs).every(pinMedia) && n.gap >= 0.2 * Math.min(...n.kids.filter((k) => !k.abs).map((k) => k.h)));
  check("no column of pinned images leaving empty bands", !banded.length, `${banded.length} : ${banded.slice(0, 3).map((n) => `${n.name || n.id} gap ${Math.round(n.gap)}`).join(" · ")}`);
  // states of an animation all captured (tickers, typing demos): texts drawn over each other
  // compared line by line, against the larger line: runs of one paragraph (kicker + headline,
  // nested spans) and badges beside a label share boxes, not lines
  const linesOf = (t) => (t.lines?.length ? t.lines : [t]);
  const over = (a, b) => linesOf(a).some((l) => linesOf(b).some((m) => area(l, m) >= 0.5 * Math.max(l.w * l.h, m.w * m.h)));
  const stacked = texts.flatMap((a, i) => texts.slice(i + 1).filter((b) => a.text !== b.text && area(a, b) > 0 && over(a, b)).map((b) => `${a.text.slice(0, 20)} / ${b.text.slice(0, 20)}`));
  check("no text stacked on another (animation states)", !stacked.length, `${stacked.length} : ${stacked.slice(0, 3).join(" · ")}`);

  // Case expectations
  // a gradient blended in another space (Tailwind v4: in oklab) keeps the browser's curve: its
  // stops resampled for Figma's sRGB blend, more of them than the css lists
  const inSpace = cap.boxes.filter((b) => /gradient\([^)]*\bin (oklab|oklch|hsl|srgb-linear)\b/.test(b.bgImg || "") && items.some((i) => i.id === b.id));
  const sRgbOnly = inSpace.filter((b) => gradients(b.bgImg, b.w, b.h).some((g) => g.stops.length <= 2 && new Set(g.stops.map((s) => s.c.replace(/^rgba?\(([^,]+,[^,]+,[^,)]+).*$/, "$1"))).size > 1));
  check("gradients interpolated outside sRGB resampled", !sRgbOnly.length, `${sRgbOnly.length} : ${sRgbOnly.slice(0, 3).map((b) => b.hint || b.id).join(" · ")}`);
  for (const t of ex.texts || []) check(`text "${t}"`, has(t));
  for (const t of ex.absent || []) check(`absent "${t}"`, !has(t));
  // at most n texts holding the key (one state of a ticker shows through its clip)
  for (const [k, n] of Object.entries(ex.most || {})) {
    const got = texts.filter((i) => i.text.includes(k)).length;
    check(`at most ${n} text(s) "${k}"`, got <= n, `${got}`);
  }
  // boxes whose class (hint) holds the key, at least n of them (graphics drawn at their rest state)
  for (const [k, n] of Object.entries(ex.boxes || {})) {
    const ids = new Set(cap.boxes.filter((b) => (b.hint || "").includes(k)).map((b) => b.id));
    const got = items.filter((i) => ids.has(i.id)).length;
    check(`boxes "${k}" ≥ ${n}`, got >= n, `${got}`);
  }
  const todos = new Set(ex.todo || []);

  console.log(`\n${name} — ${items.length} nodes, ${images} images, ${texts.length} texts`);
  for (const c of checks) {
    const isTodo = [...todos].some((t) => c.label.includes(t));
    const mark = c.ok ? "ok  " : isTodo ? "todo" : "FAIL";
    if (!c.ok) isTodo ? todo++ : failed++;
    console.log(`  ${mark} ${c.label}${!c.ok && c.detail ? ` — ${c.detail}` : ""}`);
  }
}

// Every capture of the corpus, expectations or not: the one line of a field sits on the middle of its fixed height
if (!only.length) {
  const paths = [];
  const scan = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? scan(join(d, e.name)) : e.name === "capture.json" && paths.push(join(d, e.name))));
  scan(root);
  const off = [];
  const apart = [];
  let fields = 0, inputs = 0;
  for (const p of paths) {
    const cap = JSON.parse(readFileSync(p, "utf8"));
    const { root: tree, comps } = layoutTree(cap, selectItems(cap, {}).map(({ src, ...o }) => (src ? { ...o, img: true } : o)));
    const page = [];
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      if (n.k === "frame" && /^(input|select)$/.test(n.tag || "") && n.kids.length === 1 && n.kids[0].k === "text") {
        fields++;
        if ((n.dir === "H" ? n.align : n.justify) !== "CENTER" || n.sh === "HUG") off.push(`${p.slice(root.length + 1)} ${n.id}`);
      }
      if (n.field) page.push(n);
      walk(n.kids);
    };
    walk(tree);
    Object.values(comps || {}).forEach(walk);
    // a page's one-line fields, met twice or more: one Input, one variant
    inputs += page.length;
    const keys = new Set(page.map((n) => n.comp));
    if (page.length > 1 && (keys.size !== 1 || keys.has(undefined))) apart.push(`${p.slice(root.length + 1)} (${page.length} fields, ${keys.size} variants${keys.has(undefined) ? ", outside a component" : ""})`);
  }
  console.log(`\n${off.length ? "FAIL" : "ok  "} one-line fields centered: ${fields} of ${paths.length} captures${off.length ? ` — ${off.length} : ${off.slice(0, 5).join(" · ")}` : ""}`);
  if (off.length) failed++;
  console.log(`${apart.length ? "FAIL" : "ok  "} a single Input per page: ${inputs} fields${apart.length ? ` — ${apart.length} : ${apart.slice(0, 5).join(" · ")}` : ""}`);
  if (apart.length) failed++;
}
// the in-page script is evaluated as a plain script in the browser: a parse error there stops
// every capture, while the frozen cases above never load it
{
  let error = "";
  try {
    new Script(readFileSync(new URL("./web-capture-page.js", import.meta.url), "utf8"), { filename: "web-capture-page.js" });
  } catch (e) {
    error = e.message;
  }
  console.log(`\n${error ? "FAIL" : "ok  "} web-capture-page.js compiles${error ? ` — ${error}` : ""}`);
  if (error) failed++;
}
console.log(`\n${cases.length} cases, ${failed} failure(s), ${todo} todo`);
process.exit(failed ? 1 : 0);
