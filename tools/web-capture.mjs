// Captures a rendered web page as a flat list of visual boxes (layout + computed
// styles + text + image urls), for rebuilding it in Figma through Angelo.
// Usage: node tools/web-capture.mjs <url> <out.json> [--width 1440] [--height 900] [--shot out.png]

import { createRequire } from "node:module";
import { readdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { sheetFaces } from "./web-lib.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const [url, out] = args;
if (!url || !out) {
  console.error("usage: node tools/web-capture.mjs <url> <out.json> [--width 1440] [--height 900] [--shot out.png]");
  process.exit(1);
}
const width = Number(opt("--width", 1440));
// a phone width reads the page as a phone: touch, meta viewport, the mobile user agent (sites branch on it)
const mobile = width < 700;
const vh = Number(opt("--height", mobile ? 932 : 900)); // app layouts with inner scroll panels grow with the viewport
const view = (height) => ({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
const shot = opt("--shot");

// puppeteer lives in the npx cache, not in this repo; the npm cache may have moved (npmrc `cache=`)
const npmCache = (() => {
  try {
    return execFileSync("npm", ["config", "get", "cache"], { encoding: "utf8" }).trim();
  } catch {
    return join(homedir(), ".npm");
  }
})();
const npx = join(npmCache, "_npx");
const dir = (existsSync(npx) ? readdirSync(npx) : []).map((d) => join(npx, d, "node_modules/puppeteer")).find(existsSync);
if (!dir) throw new Error(`puppeteer not found in ${npx} (npx puppeteer browsers install chrome)`);
const puppeteer = createRequire(dir + "/")("puppeteer");

const t0 = Date.now();
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport(view(vh));
await page.setUserAgent(
  mobile
    ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
    : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
);
// The page's clock, owned before its scripts keep a reference to it: timers, frame callbacks,
// performance.now / Date.now and its CSS / WAAPI animations run on real time until
// __angeloClock.freeze(); from then nothing moves unless __angeloClock.tick(ms) advances it, frame by
// frame. Springs, staggered reveals and demos land in a few real ms (a spring chasing the scroll
// lags a real-time read), and the capture and the shots taken seconds later see one instant
// (marquees, tickers, demo steps at the same offset)
await page.evaluateOnNewDocument(() => {
  const W = window, P = performance;
  const R = { st: W.setTimeout.bind(W), ct: W.clearTimeout.bind(W), raf: W.requestAnimationFrame.bind(W), caf: W.cancelAnimationFrame.bind(W), pnow: P.now.bind(P) };
  // the real ones, for the capture's own waits
  globalThis.__angeloReal = { setTimeout: R.st, setInterval: W.setInterval.bind(W), clearInterval: W.clearInterval.bind(W), now: Date.now.bind(Date) };
  globalThis.__angeloRaf = R.raf;
  const dateOff = Date.now() - R.pnow();
  let frozen = false, lag = 0, vt = 0, seq = 0;
  const now = () => (frozen ? vt : R.pnow() - lag);
  const timers = new Map(); // id → { at, fn, args, every, real }
  const frames = new Map(); // id → { cb, real }
  const held = new Set(); // animations paused by the clock, stepped by tick
  const call = (fn, args) => { try { typeof fn === "function" ? fn(...args) : (0, eval)(String(fn)); } catch (e) { reportError(e); } };
  const fire = (id) => {
    const t = timers.get(id);
    if (!t) return;
    if (t.every == null) timers.delete(id);
    else { t.at += t.every; if (!frozen) t.real = R.st(() => fire(id), t.every); }
    call(t.fn, t.args);
  };
  const add = (fn, ms, args, every) => {
    const id = ++seq, d = Math.max(0, Number(ms) || 0);
    // an interval is clamped as the browser does: a 0 ms one would never let tick move on
    const t = { at: now() + d, fn, args, every: every ? Math.max(4, d) : null };
    if (!frozen) t.real = R.st(() => fire(id), d);
    timers.set(id, t);
    return id;
  };
  const arm = (id, f) => (f.real = R.raf(() => { frames.delete(id); call(f.cb, [now()]); }));
  W.setTimeout = (fn, ms, ...args) => add(fn, ms, args, false);
  W.setInterval = (fn, ms, ...args) => add(fn, ms, args, true);
  W.clearTimeout = W.clearInterval = (id) => { const t = timers.get(id); if (t) { R.ct(t.real); timers.delete(id); } };
  W.requestAnimationFrame = (cb) => { const id = ++seq, f = { cb }; if (!frozen) arm(id, f); frames.set(id, f); return id; };
  W.cancelAnimationFrame = (id) => { const f = frames.get(id); if (f) { R.caf(f.real); frames.delete(id); } };
  P.now = now;
  Date.now = () => Math.round(now() + dateOff);
  const hold = () => {
    for (const a of document.getAnimations()) if (a.timeline === document.timeline && a.playState === "running") { a.pause(); held.add(a); }
  };
  const macrotask = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = r; c.port2.postMessage(0); });
  globalThis.__angeloClock = {
    get frozen() { return frozen; },
    held,
    hold,
    freeze() {
      if (frozen) return;
      vt = now(); frozen = true;
      for (const t of timers.values()) R.ct(t.real);
      for (const f of frames.values()) R.caf(f.real);
      hold();
    },
    run() {
      if (!frozen) return;
      lag = R.pnow() - vt; frozen = false;
      for (const [id, t] of timers) t.real = R.st(() => fire(id), Math.max(0, t.at - vt));
      for (const [id, f] of frames) arm(id, f);
      for (const a of held) if (a.playState === "paused") a.play();
      held.clear();
    },
    // frame by frame: due timers in time order, the frame callbacks, the held animations moved on,
    // then a real macrotask (promise chains and the page's message-channel schedulers run)
    async tick(ms, step = 16) {
      if (!frozen) return;
      for (const end = vt + ms; vt < end; ) {
        const d = Math.min(step, end - vt);
        vt += d;
        // a 0 ms timeout that sets another forever: bounded
        for (let n = 0; n < 2000; n++) {
          let id = null, at = Infinity;
          for (const [i, t] of timers) if (t.at <= vt && t.at < at) { at = t.at; id = i; }
          if (id == null) break;
          fire(id);
        }
        const due = [...frames];
        for (const [id] of due) frames.delete(id);
        for (const [, f] of due) call(f.cb, [vt]);
        hold();
        for (const a of held) if (a.playState === "paused") try { a.currentTime = (a.currentTime ?? 0) + d; } catch {}
        await macrotask();
      }
    },
  };
  // intersection observers, kept with their targets: __angeloInView tells them all is on screen, the
  // state of the full-page shot (a video paused off screen shows its controls, playing it hides them)
  const IO = window.IntersectionObserver, all = [];
  window.IntersectionObserver = class extends IO {
    constructor(cb, o) { super(cb, o); this.__cb = cb; this.__t = new Set(); all.push(this); }
    observe(t) { this.__t.add(t); super.observe(t); }
    unobserve(t) { this.__t.delete(t); super.unobserve(t); }
    disconnect() { this.__t.clear(); super.disconnect(); }
  };
  globalThis.__angeloInView = () => {
    for (const o of all) {
      const es = [...o.__t].filter((t) => t.isConnected).map((t) => {
        const r = t.getBoundingClientRect();
        return { target: t, isIntersecting: true, intersectionRatio: 1, boundingClientRect: r, intersectionRect: r, rootBounds: null, time: performance.now() };
      });
      if (es.length) try { o.__cb.call(o, es, o); } catch {}
    }
  };
});
// canvases: their pixels alone, shot with the rest of the page hidden on a transparent background
async function media(data) {
  data = await page.evaluate((d) => globalThis.__angeloMaskIcons(d), data);
  const canvases = data.boxes.filter((b) => b.canvas);
  if (!canvases.length) return data;
  const bottom = Math.ceil(Math.max(...canvases.map((b) => b.py + b.h)));
  await page.evaluate(() => globalThis.__angeloIsolate(true));
  const png = await page.screenshot({ type: "png", omitBackground: true, captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: bottom }, encoding: "base64" });
  await page.evaluate(() => globalThis.__angeloIsolate(false));
  data = await page.evaluate(async (d, shot) => (await globalThis.__angeloCanvasFill(d, shot), d), data, "data:image/png;base64," + png);
  // a blank shot (frame not painted): the element alone, brought on screen, until it paints
  // (6 s at most), else its poster; still blank → said out loud below
  await page.evaluate(() => globalThis.__angeloIsolate(true));
  for (const b of data.boxes.filter((b) => b.blank || b.partial)) {
    const el = await page.$(`[data-angelo-media="${b.id}"]`);
    for (const t0 = Date.now(); el && (b.blank || b.partial) && Date.now() - t0 < 6000; ) {
      await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
      await new Promise((r) => setTimeout(r, 500));
      const one = await el.screenshot({ type: "png", omitBackground: true, encoding: "base64" }).catch(() => null);
      if (!one) break;
      const r = await page.evaluate(async (b, shot) => { const o = { ...b, x: 0, py: 0 }; await globalThis.__angeloCanvasFill({ boxes: [o] }, shot); return o; }, b, "data:image/png;base64," + one);
      if (!r.blank) { b.img = r.img; delete b.blank; }
      if (!r.blank) b.partial = r.partial;
    }
    if ((b.blank || b.partial) && b.poster) { b.img = b.poster; delete b.blank; delete b.partial; }
  }
  await page.evaluate(() => globalThis.__angeloIsolate(false));
  if (!(await page.evaluate(() => globalThis.__angeloTop()))) console.log("WARNING page left scrolled after the media: page.jpg shifted");
  return data;
}

await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });

// Consent walls (CMP dialogs, often in an iframe) hide content that only renders once accepted:
// the "accept" button is clicked in whichever frame shows one, then the page settles again
const ACCEPT = /^(accept( all| all cookies| cookies)?|allow( all)?( cookies)?|agree|i agree|ok|got it|tout accepter|accepter( et fermer| tout| tous les cookies)?|autoriser( tous les)?( cookies)?|j'accepte|alle akzeptieren|aceptar( todo)?|accetta( tutto)?)$/i;
const consent = async () => {
  for (const f of page.frames()) {
    const hit = await f.evaluate((src) => {
      const re = new RegExp(src, "i");
      // walks open shadow roots too: a consent web component (<te-consent>) keeps its buttons there,
      // sometimes as a plain element with a pointer cursor instead of a button, even an svg <text> (no innerText, no click())
      const all = (root) => [...root.querySelectorAll("*")].flatMap((e) => (e.shadowRoot ? [e, ...all(e.shadowRoot)] : [e]));
      const clickable = (e) => e.matches("button, [role=button], a") || (getComputedStyle(e).cursor === "pointer" && !e.children.length);
      const label = (e) => (e.innerText ?? e.textContent ?? e.getAttribute("aria-label") ?? "").trim() || (e.getAttribute("aria-label") || "").trim();
      const b = all(document).filter(clickable).find((e) => re.test(label(e)) && e.getBoundingClientRect().width > 0);
      if (!b) return false;
      b.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
      return label(b);
    }, ACCEPT.source).catch(() => false);
    if (hit) { console.log(`consent: clicked "${hit}"`); return true; }
  }
  return false;
};
if (await consent()) await page.waitForNetworkIdle({ idleTime: 800, timeout: 15000 }).catch(() => {});

// interstitials the visitor would close, hidden before anything is read or shot: a fixed modal dialog
// over the whole viewport (chloe's country selector, its scrim dimming the hero), and a small floating
// widget pinned to a bottom corner above everything (a live-chat launcher)
const interstitials = await page.evaluate(() => {
  let n = 0;
  for (const e of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(e);
    if (cs.position !== "fixed" || cs.display === "none" || cs.visibility === "hidden") continue;
    const own = e.getBoundingClientRect();
    // a launcher's wrapper may be 0 wide (chloe's: 0×72 at the right edge, its 72 px button overflowing): the box
    // is what it paints, its descendants included
    const rs = [own, ...[...e.querySelectorAll("*")].map((k) => k.getBoundingClientRect())].filter((b) => b.width && b.height);
    if (!rs.length) continue;
    const r = { left: Math.min(...rs.map((b) => b.left)), right: Math.max(...rs.map((b) => b.right)), top: Math.min(...rs.map((b) => b.top)), bottom: Math.max(...rs.map((b) => b.bottom)) };
    r.width = r.right - r.left; r.height = r.bottom - r.top;
    const modal = (e.matches("[role=dialog], [role=alertdialog], [aria-modal=true], dialog") || e.querySelector(":scope > [role=dialog], :scope > [aria-modal=true]"))
      && r.width >= innerWidth * 0.95 && r.height >= innerHeight * 0.9;
    const widget = Number(cs.zIndex) >= 10000 && r.width <= 120 && r.height <= 120 && innerHeight - r.bottom <= 60
      && (r.left <= 60 || innerWidth - r.right <= 60) && !e.innerText.trim();
    if (modal || widget) { e.style.setProperty("display", "none", "important"); n++; }
  }
  return n;
});
if (interstitials) console.log(`interstitials: ${interstitials} layer(s) hidden (modal dialog, floating widget)`);

// --exclude "<text regex>": the overlay holding that text (cookie banner…) and the translucent scrim dimming the page
// behind it are hidden before anything is read or shot, so neither capture.json nor page.jpg holds them
const hideExcluded = (re) => page.evaluate((src) => {
  const rx = new RegExp(src, "i");
  const pinned = (e) => ["fixed", "sticky"].includes(getComputedStyle(e).position);
  const hidden = [];
  const hide = (e) => { e.style.setProperty("display", "none", "important"); hidden.push(e); };
  for (const e of document.querySelectorAll("body *")) {
    if (e.children.length || !rx.test(e.textContent || "")) continue;
    let top = null;
    for (let a = e.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement)
      if (pinned(a) && a.getBoundingClientRect().height < innerHeight) top = a;
    if (top && !hidden.includes(top)) hide(top);
  }
  if (hidden.length)
    for (const e of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(e), r = e.getBoundingClientRect();
      if (cs.position === "fixed" && !e.textContent.trim() && /^rgba\(.*,\s*0?\.\d+\)$/.test(cs.backgroundColor) && r.width >= innerWidth * 0.95 && r.height >= innerHeight * 0.9) hide(e);
    }
  return hidden.length;
}, re.source);
if (opt("--exclude")) console.log(`exclusion: ${await hideExcluded(new RegExp(opt("--exclude")))} layer(s) hidden`);

// in-page half: one source with the browser extension
await page.evaluate(readFileSync(new URL("./web-capture-page.js", import.meta.url), "utf8"));
// lazy content (native lazy images, pictures and sections loaded on intersection) fetched on real
// time, before the settle: its scroll runs on page time, too fast for the browser to request
// them, and a low-res placeholder swapped on their load (lqip) is read instead. Same routine as
// the extension
const prep = await page.evaluate(() => globalThis.__angeloPrepare());
console.log(`preparation: ${prep.lazy} lazy images, ${prep.steps} scroll steps${prep.locked ? " (scroll locked, lifted)" : ""}, ${prep.pending} images still loading, ${prep.ms} ms`);

// --only "<css selector>": the page reduced to the content of those elements, each shrunk to what it
// renders, named after the heading above it and stacked, before anything is read or shot
// (a component's rendered demos, without the docs around them)
if (opt("--only")) {
  const res = await page.evaluate((sel) => {
    const picks = [...document.querySelectorAll(sel)];
    if (!picks.length) return null;
    const heads = [...document.querySelectorAll("h1, h2, h3, h4")];
    const seen = {};
    const named = picks.map((el) => {
      const head = heads.filter((h) => h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
      // the heading's anchor link leaves a trailing #
      const base = head ? head.textContent.trim().replace(/\s*#$/, "") : "Item";
      seen[base] = (seen[base] || 0) + 1;
      // a fixed child (a form control's hidden helper input) sits outside the example, wherever the example is
      const rects = [...el.children].filter((k) => getComputedStyle(k).position !== "fixed").map((k) => k.getBoundingClientRect()).filter((r) => r.width && r.height);
      const w = Math.ceil(Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left)));
      const h = Math.ceil(Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top)));
      return { el, name: seen[base] > 1 ? `${base} ${seen[base]}` : base, w, h };
    });
    for (const { el, w, h } of named) {
      if (!(w > 0 && h > 0)) continue;
      el.style.setProperty("padding", "0", "important");
      el.style.setProperty("width", `${w}px`, "important");
      el.style.setProperty("height", `${h}px`, "important");
      el.style.setProperty("flex", "none", "important");
    }
    const sheets = [...document.body.querySelectorAll(":scope > style, :scope > link")];
    const box = document.createElement("div");
    box.style.cssText = "display:flex;flex-direction:column;align-items:flex-start;gap:40px";
    box.append(...named.map((n) => n.el));
    document.body.replaceChildren(...sheets, box);
    window.scrollTo(0, 0);
    globalThis.__angeloOnly = named.map((n) => [n.el, n.name]);
    return { kept: picks.length, h: Math.ceil(box.getBoundingClientRect().height) };
  }, opt("--only"));
  if (!res) throw new Error(`--only: nothing matches "${opt("--only")}"`);
  // the viewport shrinks to the content: the document never stays taller than what it holds
  await page.setViewport(view(Math.max(1, res.h)));
  console.log(`isolated: ${res.kept} element(s), ${res.h} px`);
}

// app shell: the document never scrolls, a panel inside it does (sidebar + scrolling main): the
// page read at viewport height holds one screen of it → the viewport grows by what the panel hides
const MAX_VH = 16000;
const innerLeft = () => page.evaluate(() => {
  const H = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  if (H > innerHeight + 1) return 0;
  let best = 0;
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (!/auto|scroll|overlay/.test(cs.overflowY) || el.clientWidth < innerWidth / 2) continue;
    best = Math.max(best, el.scrollHeight - el.clientHeight);
  }
  return best > 200 ? best : 0;
});
// one round: what the grown panel loads on view (an endless result grid) is left out
const left = await innerLeft();
const grown = Math.min(MAX_VH, vh + left);
if (left) {
  await page.setViewport(view(grown));
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
}
if (grown > vh) console.log(`inner scrolling panel: window ${vh} → ${grown} px${grown === MAX_VH ? " (cap)" : ""}`);

const settled = await page.evaluate(() => globalThis.__angeloSettle());
console.log(`settle: wait ${settled.quiet} ms, scroll ${settled.scroll} ms (${settled.capped} steps at the max wait)`);
// a consent wall shown late (after a delay or the first scroll): accepted now, else it stays in page.jpg
// what the scroll fetched (a section loaded on intersection) lands, then its own animations play
// on the page clock
await page.waitForNetworkIdle({ idleTime: 300, timeout: 3000 }).catch(() => {});
if (await consent()) await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
await page.evaluate(() => globalThis.__angeloPass(1500, 40));
// a scroll lock the page sets itself while a scroll scene plays (overflow hidden + a stable gutter
// on the root, released ~1 s later): read inside it, the page lays out 15 px narrower than the
// frame and every full-width block is off by the gutter → waited out (4 s of page time at most)
const narrowBy = () => page.evaluate(() => (/hidden|clip/.test(getComputedStyle(document.documentElement).overflowY + getComputedStyle(document.body).overflowY) ? innerWidth - document.body.getBoundingClientRect().width : 0));
let narrow = await narrowBy();
for (const t = Date.now(); narrow > 1 && Date.now() - t < 4000; narrow = await narrowBy()) await page.evaluate(() => globalThis.__angeloPass(100));
if (narrow > 1) console.log(`WARNING page narrower than the window by ${Math.round(narrow)} px (scroll locked?): full-width blocks will be shifted`);
// rest states held through the canvas and reference shots
await page.evaluate(() => globalThis.__angeloHold(true));
// guard: a page read while scrolled puts its fixed header where the scroll stopped
if (!(await page.evaluate(() => globalThis.__angeloTop()))) console.log("WARNING page left scrolled: positions of fixed blocks are wrong");
if (args.includes("--blocks")) {
  // the blocks the page offers (level 1 = sections, below = sub-sections), to pick names for --part
  const list = await page.evaluate(() => globalThis.__angeloBlocks().map((b) => ({ name: b.name, level: b.level })));
  const seen = {};
  for (const b of list) console.log(`${"  ".repeat(b.level - 1)}${b.name}${(seen[b.name] = (seen[b.name] || 0) + 1) > 1 ? `#${seen[b.name]}` : ""}`);
  await browser.close();
  process.exit(0);
}
// --part "A + B": only those blocks (and what is under them) are read, the others' bands closed up,
// as the extension does for picked blocks; a name given twice by the page is told apart as Name#2
const picked = (opt("--part") || "").split(" + ").map((s) => s.trim()).filter(Boolean);
let data = await page.evaluate((picked) => {
  const blocks = globalThis.__angeloBlocks();
  // the whole page too carries the block names (layers named after them): a section redone later is found by name
  if (!picked.length) return globalThis.__angeloCapture({ names: new Map(globalThis.__angeloOnly || blocks.map((b) => [b.el, b.name])) });
  const ancestorsOf = (i) => { const a = []; for (let p = blocks[i].parent; p >= 0; p = blocks[p].parent) a.push(p); return a; };
  const isUnder = (i, top) => ancestorsOf(i).includes(top);
  const at = picked.map((p) => {
    const [, name, n] = /^(.*?)(?:#(\d+))?$/.exec(p);
    const hits = blocks.map((b, i) => (b.name === p || (n && b.name === name) ? i : -1)).filter((i) => i >= 0);
    const i = n ? hits.filter((k) => blocks[k].name === name)[Number(n) - 1] : hits[0];
    // (a bare repeated name is the first, as --blocks lists it: Name, Name#2, Name#3)
    if (i === undefined) throw new Error(`block "${p}": ${hits.length ? "several blocks of that name, add #2, #3…" : "not found (node tools/web-capture.mjs <url> <out> --blocks)"}`);
    return i;
  });
  const keep = new Set();
  for (const i of at) [i, ...ancestorsOf(i)].forEach((k) => keep.add(k));
  const kept = (i) => keep.has(i) || at.some((p) => isUnder(i, p));
  globalThis.__angeloSkipped = blocks.filter((_, i) => !kept(i)).map((b) => b.el);
  return globalThis.__angeloCapture({
    skip: new Set(globalThis.__angeloSkipped),
    names: new Map(blocks.filter((_, i) => kept(i)).map((b) => [b.el, b.name])),
    until: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
  });
}, picked);
data = await media(data);

await sheetFaces(data);

// reference for web-compare: jpg when the path says so; media shots laid over their element
// (a full-page shot leaves iframes / videos off screen unpainted: blank bands read as gaps),
// composed on a blank page (the site's CSP may refuse data: images)
if (shot) {
  const full = await page.screenshot({ type: "png", fullPage: true, encoding: "base64" });
  // what the page paints over a media (a video's pause button, z-index above it) is taken back from
  // the shot once the media frame is laid, or the frame hides it
  const byId = new Map(data.boxes.map((b) => [b.id, b]));
  const chain = (b) => { const c = []; for (let k = b; k; k = byId.get(k.p)) c.push(k); return c; };
  const above = (b, m) => {
    const up = new Set(chain(m).map((k) => k.id));
    if (up.has(b.id)) return false;
    for (const k of chain(b)) {
      if (up.has(k.id) || k.id === m.id) return false;
      if (k.z > 0 || (k.pin && k.id > m.id)) return true;
    }
    return false;
  };
  const media = data.boxes.filter((b) => b.canvas && b.img).map((m) => ({
    x: m.x, y: m.y, w: m.w, h: m.h, img: m.img,
    over: data.boxes.filter((b) => b.w > 0 && b.h > 0 && b.x >= m.x && b.y >= m.y && b.x + b.w <= m.x + m.w && b.y + b.h <= m.y + m.h && above(b, m)).map(({ x, y, w, h }) => ({ x, y, w, h })),
  }));
  const blank = await browser.newPage();
  const url = await blank.evaluate(async (full, media, jpg, width) => {
    const load = async (src) => { const im = new Image(); im.crossOrigin = "anonymous"; im.src = src; await im.decode(); return im; };
    const base = await load("data:image/png;base64," + full);
    const c = document.createElement("canvas");
    [c.width, c.height] = [base.naturalWidth, base.naturalHeight];
    const g = c.getContext("2d");
    g.drawImage(base, 0, 0);
    const s = c.width / width;
    for (const b of media) {
      const im = await load(b.img).catch(() => null);
      if (!im) continue;
      g.drawImage(im, b.x * s, b.y * s, b.w * s, b.h * s);
      for (const o of b.over) g.drawImage(base, o.x * s, o.y * s, o.w * s, o.h * s, o.x * s, o.y * s, o.w * s, o.h * s);
    }
    return c.toDataURL(jpg ? "image/jpeg" : "image/png", 0.8);
  }, full, media, /\.jpe?g$/i.test(shot), width);
  await blank.close();
  writeFileSync(shot, Buffer.from(url.split(",")[1], "base64"));
}
await page.evaluate(() => globalThis.__angeloHold(false));
await browser.close();
writeFileSync(out, JSON.stringify({ url, width, ...data }));
console.log(`${data.boxes.length} boxes, ${data.faces.length} @font-face, height ${data.height}, ${Date.now() - t0} ms → ${out}`);
