// Minimal font manager for web captures: fetches the site's @font-face files, converts
// woff/woff2 to sfnt (Core Text can't activate woff2), activates them with Core Text
// (persistent scope, files stay in ~/.angelo/fonts, nothing copied to ~/Library/Fonts)
// and writes <capture dir>/fonts.json: CSS family → family name as Figma sees it.
// Web fonts are licensed to the site: local preview only, never redistribute.
//
// Usage: node tools/fonts.mjs <capture.json>      fetch + activate + map
//        node tools/fonts.mjs --list              files under ~/.angelo/fonts
//        node tools/fonts.mjs --off [host]        deactivate (all hosts by default)
//        node tools/fonts.mjs --set               FontZero set "angelo tests" from the whole store
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import wawoff2 from "wawoff2";

const HOME = process.env.ANGELO_HOME || join(homedir(), ".angelo");
const STORE = join(HOME, "fonts");
const BIN = join(HOME, "bin/angelo-fonts");
const AGENT = "http://127.0.0.1:44950/figma/font-files"; // Figma's local font agent
const args = process.argv.slice(2);

const files = (dir) =>
  existsSync(dir) ? readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : /\.(ttf|otf)$/.test(f) ? [join(dir, f)] : [])) : [];

// Swift activator compiled on first use
const activator = () => {
  if (!existsSync(BIN)) {
    mkdirSync(dirname(BIN), { recursive: true });
    const src = join(dirname(fileURLToPath(import.meta.url)), "fonts/activate.swift");
    execFileSync("swiftc", ["-O", src, "-o", BIN], { stdio: "inherit" });
  }
  return BIN;
};
const ctl = (mode, paths) => {
  if (!paths.length) return "";
  try {
    return execFileSync(activator(), [mode, ...paths], { encoding: "utf8" });
  } catch (e) {
    return e.stdout || String(e);
  }
};

// FontZero: the store as a source and the activated families in one set, removed there in one go.
// FontZero keeps library.json in memory and writes it back: quit while editing, reopened after
const ZERO = join(homedir(), "Library/Application Support/FontZero/library.json");
const SET = "angelo tests";
const zeroSet = (families) => {
  if (!existsSync(ZERO) || !families.length) return;
  let open = false;
  try {
    execFileSync("pgrep", ["-x", "FontZero"]);
    open = true;
  } catch {}
  if (open) execFileSync("osascript", ["-e", 'quit app "FontZero"']);
  for (let i = 0; open && i < 50; i++) {
    try {
      execFileSync("pgrep", ["-x", "FontZero"]);
      execFileSync("sleep", ["0.1"]);
    } catch {
      break;
    }
  }
  const lib = JSON.parse(readFileSync(ZERO, "utf8"));
  const url = `file://${encodeURI(STORE)}/`;
  lib.sources ||= [];
  if (!lib.sources.some((s) => s.url === url)) lib.sources.push({ url, label: SET, id: randomUUID().toUpperCase() });
  lib.sets ||= [];
  let set = lib.sets.find((s) => s.name === SET);
  if (!set) lib.sets.push((set = { name: SET, members: [], id: randomUUID().toUpperCase() }));
  // members must be FontZero's own family names (Figma's differ: opsz splits, mojibake): taken
  // from its index cache when it already covers the store, Figma's names otherwise
  let names = families;
  try {
    const idx = JSON.parse(readFileSync(join(homedir(), "Library/Caches/FontZero/index.json"), "utf8"));
    const own = idx.result.families.filter((f) => f.faces.some((x) => x.files.some((u) => u.url.startsWith(url)))).map((f) => f.name);
    if (own.length) names = own;
  } catch {}
  const added = names.filter((f) => !set.members.includes(f));
  set.members = [...set.members.filter((f) => names === families || names.includes(f)), ...added].sort();
  writeFileSync(ZERO, JSON.stringify(lib));
  // a quit app answers -600 to open for a moment: retried
  for (let i = 0; open && i < 20; i++) {
    try {
      execFileSync("open", ["-a", "FontZero"], { stdio: "ignore" });
      break;
    } catch {
      execFileSync("sleep", ["0.3"]);
    }
  }
  console.log(`FontZero: set "${SET}" ${set.members.length} families` + (added.length ? ` (+${added.length})` : ""));
};

if (args[0] === "--set") {
  // every family of the store as Figma's agent reads it
  const txt = await (await fetch(AGENT, { headers: { Origin: "https://www.figma.com" }, signal: AbortSignal.timeout(5000) })).text();
  const r = JSON.parse(txt.replace(/[\u0000-\u001f]/g, " "));
  const fams = Object.entries(r.fontFiles || {}).filter(([p]) => p.startsWith(STORE + "/")).flatMap(([, l]) => l.map((f) => f.family));
  zeroSet([...new Set(fams.filter(Boolean))]);
  process.exit(0);
}
if (args[0] === "--list") {
  for (const f of files(STORE)) console.log(f.replace(STORE + "/", ""));
  process.exit(0);
}
if (args[0] === "--off") {
  const list = files(args[1] ? join(STORE, args[1]) : STORE);
  process.stdout.write(ctl("off", list));
  console.log(`${list.length} file(s) disabled`);
  process.exit(0);
}

const capPath = args[0];
if (!capPath) {
  console.error("usage: node tools/fonts.mjs <capture.json> | --list | --off [host]");
  process.exit(1);
}
const cap = JSON.parse(readFileSync(capPath, "utf8"));
const faces = cap.faces || [];
if (!faces.length) {
  console.log("no @font-face in the capture (recapture with web-capture)");
  process.exit(0);
}
const host = new URL(cap.url).hostname.replace(/^www\./, "");
const dir = join(STORE, host);
mkdirSync(dir, { recursive: true });

// woff 1.0 → sfnt: inflate each table, rebuild the table directory
const unwoff = (b) => {
  const n = b.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20;
    const [off, comp, orig] = [b.readUInt32BE(o + 4), b.readUInt32BE(o + 8), b.readUInt32BE(o + 12)];
    const raw = b.subarray(off, off + comp);
    tables.push({ tag: b.subarray(o, o + 4), sum: b.readUInt32BE(o + 16), data: comp < orig ? inflateSync(raw) : raw });
  }
  const head = Buffer.alloc(12 + n * 16);
  b.copy(head, 0, 4, 8); // flavor
  const p = 2 ** Math.floor(Math.log2(n));
  head.writeUInt16BE(n, 4);
  head.writeUInt16BE(p * 16, 6);
  head.writeUInt16BE(Math.log2(p), 8);
  head.writeUInt16BE(n * 16 - p * 16, 10);
  const parts = [head];
  let off = head.length;
  tables.forEach((t, i) => {
    const r = 12 + i * 16;
    t.tag.copy(head, r);
    head.writeUInt32BE(t.sum, r + 4);
    head.writeUInt32BE(off, r + 8);
    head.writeUInt32BE(t.data.length, r + 12);
    const pad = (4 - (t.data.length % 4)) % 4;
    parts.push(t.data, Buffer.alloc(pad));
    off += t.data.length + pad;
  });
  return Buffer.concat(parts);
};

// family / style from the name table (typographic names 16/17 first, Windows Unicode first)
const names = (b) => {
  const n = b.readUInt16BE(4);
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    if (b.toString("latin1", r, r + 4) !== "name") continue;
    const t = b.readUInt32BE(r + 8);
    const count = b.readUInt16BE(t + 2), store = t + b.readUInt16BE(t + 4);
    const got = {};
    for (let j = 0; j < count; j++) {
      const q = t + 6 + j * 12;
      const [plat, , lang, id, len, so] = [0, 2, 4, 6, 8, 10].map((k) => b.readUInt16BE(q + k));
      if (![1, 2, 16, 17].includes(id)) continue;
      const s = b.subarray(store + so, store + so + len);
      // copied: swap16 works in place, and records sharing one string would swap it back
      const v = plat === 3 || plat === 0 ? Buffer.from(s).swap16().toString("utf16le") : s.toString("latin1");
      const rank = plat === 3 && lang === 0x409 ? 2 : plat === 3 ? 1 : 0;
      if (!got[id] || got[id].rank < rank) got[id] = { v, rank };
    }
    return { family: (got[16] || got[1])?.v, style: (got[17] || got[2])?.v };
  }
  return {};
};

// a variable font named after its default instance ("Manrope ExtraLight"): Figma lists it under the
// bare family ("Manrope"), whatever its font agent reports
const WEIGHT_WORD = / (Thin|Hairline|ExtraLight|Extra Light|UltraLight|Light|Regular|Book|Medium|SemiBold|Semi Bold|DemiBold|Bold|ExtraBold|Extra Bold|UltraBold|Black|Heavy)$/;
const isVariable = (b) => {
  const n = b.readUInt16BE(4);
  for (let i = 0; i < n; i++) if (b.toString("latin1", 12 + i * 16, 16 + i * 16) === "fvar") return true;
  return false;
};
const bare = (o, fam) => (o.variable && fam ? fam.replace(WEIGHT_WORD, "") : fam);

const t0 = Date.now();
const seen = new Map(); // src → file
const out = [];
const anon = []; // files whose name table says nothing
await Promise.all(
  faces.map(async (f) => {
    if (seen.has(f.src)) return;
    seen.set(f.src, null);
    try {
      const res = await fetch(f.src, { headers: { Referer: cap.url, "User-Agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/145 Safari/537.36" }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let b = Buffer.from(await res.arrayBuffer());
      const sig = b.toString("latin1", 0, 4);
      if (sig === "wOF2") b = Buffer.from(await wawoff2.decompress(b));
      else if (sig === "wOFF") b = unwoff(b);
      const ext = b.toString("latin1", 0, 4) === "OTTO" ? "otf" : "ttf";
      const file = join(dir, basename(new URL(f.src).pathname).replace(/\.(woff2?|ttf|otf)$/i, "") + "." + ext);
      writeFileSync(file, b);
      seen.set(f.src, file);
      const nm = names(b);
      // a name table with no real family (obfuscated web fonts): Figma never lists it
      if (!/\p{L}/u.test(nm.family || "")) {
        anon.push({ f, file });
        return;
      }
      out.push({ css: f.family, file, ...nm, variable: isVariable(b), face: `${f.weight} ${f.style}`, f });
    } catch (e) {
      console.log(`failed ${f.family} ${f.weight} ${f.style}: ${e.message} (${f.src})`);
    }
  })
);

// munged names (one family / style shared by files of different weights: "FB Web Use Only" Regular
// for all of them): Figma cannot tell them apart → treated as nameless, renamed from the @font-face below
{
  const by = new Map();
  for (const o of out) {
    const k = `${o.family}\u0000${o.style}`;
    by.set(k, [...(by.get(k) || []), o]);
  }
  const bad = new Set([...by.values()].filter((g) => new Set(g.map((o) => `${o.css} ${o.face}`)).size > 1).flat());
  if (bad.size) {
    console.log(`${bad.size} file(s) with garbled names (${[...new Set([...bad].map((o) => o.family))].join(", ")}): renamed from the @font-face`);
    out.splice(0, out.length, ...out.filter((o) => !bad.has(o)));
    for (const o of bad) anon.push({ f: o.f, file: o.file });
  }
}

// obfuscated name table: renamed from the @font-face (css family, weight, style). Several files for one
// weight (one per script: latin, cyril, greek…) would share a name → the latin one only, the rest fall back
{
  const WORDS = { 100: "Thin", 200: "Extra Light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semi Bold", 700: "Bold", 800: "Extra Bold", 900: "Black" };
  const groups = new Map();
  for (const a of anon) {
    const k = `${a.f.family}\u0000${a.f.weight}\u0000${a.f.style}`;
    groups.set(k, [...(groups.get(k) || []), a]);
  }
  // font-weight keywords (normal / bold) and ranges ("400 700": its first value) as numbers
  const weightOf = (f) => ({ normal: 400, bold: 700 })[String(f.weight).trim()] ?? parseFloat(f.weight);
  // Weights between two words (350, 375, 400 all round to Regular) must not share a name: Figma would keep one file for
  // all three. Exact weights choose first, then heavier to lighter; a word already taken → the next lighter one.
  const taken = new Set();
  const wordFor = (family, style, weight) => {
    const near = Math.round(weight / 100) * 100;
    if (!WORDS[near]) return null;
    const steps = Object.keys(WORDS).map(Number).sort((a, b) => (a <= near ? 0 : 1) - (b <= near ? 0 : 1) || (a <= near ? b - a : a - b));
    const w = steps.find((s) => !taken.has(`${family}\u0000${style}\u0000${s}`));
    if (w) taken.add(`${family}\u0000${style}\u0000${w}`);
    return WORDS[w];
  };
  const ordered = [...groups.values()].sort((a, b) => {
    const [x, y] = [weightOf(a[0].f), weightOf(b[0].f)];
    return (x % 100 !== 0) - (y % 100 !== 0) || y - x;
  });
  for (const g of ordered) {
    const pick = g.find((a) => /latin/i.test(a.f.src)) || (g.length === 1 ? g[0] : null);
    const { family, style } = g[0].f;
    const weight = weightOf(g[0].f);
    const word = pick && wordFor(family, style, weight);
    if (!word) {
      console.log(`font ${family} ${weight} has no readable family name: fallback`);
      continue;
    }
    const sty = (word + (style === "normal" ? "" : " Italic")).replace("Regular Italic", "Italic");
    try {
      execFileSync("uv", ["run", "-q", "--with", "fonttools", "python", join(dirname(fileURLToPath(import.meta.url)), "fonts/rename.py"), pick.file, family, sty], { stdio: "pipe" });
      const nm = names(readFileSync(pick.file));
      out.push({ css: family, file: pick.file, ...nm, variable: false, face: `${weight} ${style}` });
      console.log(`font ${family} ${weight}: name missing from the file, renamed "${family} ${sty}" from the @font-face`);
    } catch (e) {
      console.log(`font ${family} ${weight}: rename failed (${String(e.message).split("\n")[0]}): fallback`);
    }
  }
}

// a family renamed above: its other files carry a foreign name (script subsets: Thai files named
// "DB Heavent") and would be picked first by the mapping → dropped
{
  const renamed = new Set(out.filter((o) => o.family === o.css && o.style && anon.some((a) => a.file === o.file)).map((o) => o.css));
  const keep = out.filter((o) => !renamed.has(o.css) || o.family === o.css);
  if (keep.length < out.length) {
    console.log(`${out.length - keep.length} file(s) of another script under another name dropped (${[...renamed].join(", ")})`);
    out.splice(0, out.length, ...keep);
  }
}

// optical size axis: the browser sets it to the font size, Figma keeps its default → one pinned
// font per opsz value the page uses (fonttools via uv, cached next to the source file)
const OPSZ = join(dirname(fileURLToPath(import.meta.url)), "fonts/opsz.py");
const py = (...a) => JSON.parse(execFileSync("uv", ["run", "-q", "--with", "fonttools", "python", OPSZ, ...a], { encoding: "utf8" }));
const used = new Map(); // css family (lower case) → Set of font.opsz / font.size
(function walk(v) {
  if (Array.isArray(v)) return v.forEach(walk);
  if (!v || typeof v !== "object") return;
  if (v.font?.family && v.font.size) {
    const k = v.font.family.toLowerCase();
    if (!used.has(k)) used.set(k, new Set());
    used.get(k).add(v.font.opsz ?? v.font.size);
  }
  for (const x of Object.values(v)) if (x && typeof x === "object") walk(x);
})(cap.boxes || cap);
const opszOf = {}; // css family → { axis, fams: { value: Figma family } }
for (const o of [...out]) {
  const vals = used.get(o.css.toLowerCase());
  if (!vals) continue;
  let ax;
  try { ax = py("axis", o.file); } catch (e) { console.log(`opsz: fonttools unavailable (${e.message.split("\n")[0]})`); break; }
  if (!ax) continue;
  // 0 = optical sizing off → axis default, no pinned font needed
  const want = [...new Set([...vals].map((v) => (v === 0 ? ax.default : Math.min(ax.max, Math.max(ax.min, Math.round(v))))))].filter((v) => v !== ax.default);
  if (!want.length) continue;
  const pinned = py("pin", o.file, join(dir, "opsz"), ...want.map(String));
  const e = (opszOf[o.css.toLowerCase()] ||= { axis: ax, fams: {} });
  for (const [v, file] of Object.entries(pinned)) {
    e.fams[+v] = `${o.family} opsz${+v}`;
    out.push({ css: null, file, family: e.fams[+v], style: o.style });
  }
}

process.stdout.write(ctl("on", out.map((o) => o.file)));

// what Figma sees: poll its font agent until every file shows up (it lags a few seconds)
let agent = null;
for (let i = 0; i < 20; i++) {
  try {
    // the agent's JSON carries raw control characters: strip them before parsing
    const txt = await (await fetch(AGENT, { headers: { Origin: "https://www.figma.com" }, signal: AbortSignal.timeout(5000) })).text();
    const r = JSON.parse(txt.replace(/[\u0000-\u001f]/g, " "));
    const byPath = new Map();
    for (const [p, list] of Object.entries(r.fontFiles || {})) byPath.set(p, list);
    agent = byPath;
    if (out.every((o) => byPath.has(o.file))) break;
  } catch {
    break; // no agent (Figma closed): name table only
  }
  await new Promise((r) => setTimeout(r, 1000));
}

// CSS family → Figma family + its faces (style names vary: "Bold It", "Italic", "Oblique"…)
const map = {};
for (const o of out) {
  if (!o.css) continue; // pinned opsz font: reached through its family's opsz table
  // the agent lists by path: a file rewritten since an earlier run (renamed from its @font-face) can still be listed under
  // its old obfuscated name ("¶") → the name table wins when the agent shows no real family
  const listed = (agent?.get(o.file) || []).filter((f) => /\p{L}/u.test(f.family || ""));
  const seenBy = listed.length ? listed : [{ family: o.family, style: o.style }];
  for (let f of seenBy) {
    if (!f.family) continue;
    f = { ...f, family: bare(o, f.family) };
    const m = (map[o.css.toLowerCase()] ||= { family: f.family, faces: [] });
    // a site shipping each weight as its own family ("Inter Semi Bold" / "Regular"): the face keeps its family
    if (!m.faces.some((x) => x.style === f.style && (x.family || m.family) === f.family)) m.faces.push({ ...(f.family !== m.family ? { family: f.family } : {}), style: f.style, weight: f.weight ?? null, italic: !!f.italic });
  }
}
for (const [k, v] of Object.entries(opszOf)) if (map[k]) map[k].opsz = v;
const mapPath = join(dirname(capPath), "fonts.json");
writeFileSync(mapPath, JSON.stringify(map, null, 2) + "\n");
const missing = agent ? out.filter((o) => !agent.has(o.file)).length : null;
console.log(
  `${out.filter((o) => o.css).length}/${seen.size} file(s) enabled in ${dir}` + (out.some((o) => !o.css) ? ` + ${out.filter((o) => !o.css).length} with fixed opsz` : "") + `, ${Object.keys(map).length} families → ${mapPath}` +
    (agent ? (missing ? `, ${missing} not yet seen by Figma` : ", all seen by Figma") : ", Figma agent unreachable") +
    ` (${Date.now() - t0} ms)`
);
for (const [k, v] of Object.entries(map)) console.log(`  ${k} → ${v.family} (${v.faces.map((f) => f.style).join(", ")})`);
zeroSet([...new Set(Object.values(map).flatMap((v) => [v.family, ...v.faces.map((f) => f.family)]).filter(Boolean))]);
