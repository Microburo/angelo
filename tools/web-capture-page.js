// In-page half of the web capture, shared by tools/web-capture.mjs (puppeteer) and the
// browser extension (extension/, copied there by `npm run build`). Plain script, no imports:
// defines globalThis.__angeloCapture / __angeloSettle / __angeloBlocks.

// Scrolls through the page so lazy content loads, then back to the top.
// Scroll-linked effects (reveals, parallax, scrubbed animations, fade-outs on exit) depend on
// the scroll position, not on time. Each element below the fold is sampled at every step while
// it is in the viewport; its rest state is the most visible sample (highest opacity, then the
// one closest to the viewport centre, where a reader looks at it: scrubbed graphics are complete
// there, parallax layers not yet on their way out). Kept in __angeloRest, applied by __angeloCapture
// while it reads the page
// Back to the top of the page, checked: a plain scrollTo is smooth under `scroll-behavior:
// smooth` or eaten by a scroll library, and a page read while scrolled puts its fixed header
// where the scroll stopped (figma.com: header at y 3529)
// the browser's frame loop, unaffected by __angeloHold's freeze of the page's
globalThis.__angeloRaf ||= requestAnimationFrame.bind(globalThis);
// one frame, or 100 ms when none comes: a hidden or occluded window paints no frame and a bare
// requestAnimationFrame would hang the capture for good
globalThis.__angeloFrame = () => new Promise((r) => { globalThis.__angeloRaf(() => r()); (globalThis.__angeloReal?.setTimeout ?? setTimeout)(r, 100); });
// the capture's own waits run on real time: once web-capture.mjs's clock is frozen, the page's
// setTimeout / Date.now no longer move
globalThis.__angeloSleep = (ms) => new Promise((r) => (globalThis.__angeloReal?.setTimeout ?? setTimeout)(r, ms));
globalThis.__angeloNow = () => (globalThis.__angeloReal?.now ?? Date.now)();
// lets the page live for ms: the frozen clock advanced (instant), else real frames and time
// the page's scroll offsets, read off the scrolling element: a site may declare its own global
// scrollX() / scrollY() functions over window's (criterion: every position came out NaN)
globalThis.__angeloScrollX = () => (document.scrollingElement || document.documentElement).scrollLeft;
globalThis.__angeloScrollY = () => (document.scrollingElement || document.documentElement).scrollTop;
globalThis.__angeloPass = async (ms, step) => {
  const c = globalThis.__angeloClock;
  if (c?.frozen) return c.tick(ms, step);
  await globalThis.__angeloFrame();
  await globalThis.__angeloFrame();
  await globalThis.__angeloSleep(ms);
};
globalThis.__angeloTop = async () => {
  for (let i = 0; i < 20; i++) {
    window.scrollTo({ left: 0, top: 0, behavior: "instant" });
    document.documentElement.scrollTop = document.body.scrollTop = 0;
    await globalThis.__angeloPass(50);
    if (__angeloScrollX() === 0 && __angeloScrollY() === 0) return true;
  }
  return false;
};
// Readies the page for reading, the same in both capture paths (headless and extension):
// sections skipped by content-visibility rendered, native lazy images made eager, one quick
// scroll down the page on real time so what loads on intersection (lazy pictures, sections a
// script injects) is requested, then the images and the network waited out (bounded), back to
// the top. A page that locks its own scroll (a modal, a paywall) is unlocked for the pass only
globalThis.__angeloPrepareRun = async (opts, held) => {
  const budget = opts.budget ?? 12000;
  const now = globalThis.__angeloNow;
  const t0 = now();
  const left = () => budget - (now() - t0);
  const H = () => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  globalThis.__angeloRenderAll();
  const lazy = [...document.querySelectorAll('img[loading="lazy"]')];
  for (const i of lazy) i.loading = "eager";
  // the page scrolls inside one of its own elements (oatly: a framed app, the body held at 100vh):
  // it and its ancestors are made as tall as its content, in px, until __angeloRelock, so the page is
  // as tall as what it holds for the capture, the scroll and the shot. Its direct children keep the
  // height they have now: a hero sized on the scroller's height (oatly: card = window - header)
  // would otherwise grow with it, without end
  let inner = null;
  if (H() <= innerHeight + 1) {
    for (const el of document.body.querySelectorAll("*")) {
      if (el.clientHeight < innerHeight * 0.5 || el.clientWidth < innerWidth * 0.5 || el.scrollHeight <= el.clientHeight + 1) continue;
      if (!/auto|scroll/.test(getComputedStyle(el).overflowY)) continue;
      if (!inner || el.scrollHeight > inner.scrollHeight) inner = el;
    }
  }
  if (inner) {
    inner.scrollTop = 0;
    const delta = inner.scrollHeight - inner.clientHeight;
    const chain = [];
    for (let e = inner; e; e = e.parentElement) chain.push([e, getComputedStyle(e).height]);
    const kids = [...inner.children].map((k) => [k, getComputedStyle(k)]).map(([k, cs]) => [k, cs.height, cs.minHeight, cs.display]);
    const saved = [];
    const pin = (e, props) => { saved.push([e, e.getAttribute("style")]); for (const [p, v] of props) e.style.setProperty(p, v, "important"); };
    for (const [k, h, mh, d] of kids) if (d !== "none" && h.endsWith("px")) pin(k, [["height", h], ["min-height", mh === "auto" ? "0px" : mh]]);
    for (const [e, h] of chain) pin(e, [["height", parseFloat(h) + delta + "px"], ["max-height", "none"]]);
    const grow = document.createElement("style");
    grow.textContent = "html, body { overflow: visible !important; } [data-angelo-scroller] { overflow: visible !important; }";
    inner.setAttribute("data-angelo-scroller", "");
    document.head.append(grow);
    globalThis.__angeloRelock = () => {
      grow.remove();
      inner.removeAttribute("data-angelo-scroller");
      for (const [e, st] of saved.reverse()) st === null ? e.removeAttribute("style") : e.setAttribute("style", st);
      delete globalThis.__angeloRelock;
    };
  }
  const locked = H() > innerHeight + 1 && /hidden|clip/.test(getComputedStyle(document.documentElement).overflowY + getComputedStyle(document.body).overflowY);
  let unlock;
  if (locked) {
    unlock = document.createElement("style");
    unlock.textContent = "html, body { overflow: visible !important; }";
    document.head.append(unlock);
    held.unlock = unlock;
  }
  // 3/4 of a window per step, 120 ms each: an IntersectionObserver fires on the next frame and
  // its loader sets the src; a page that grows as it is scrolled (endless feed) stops at half
  // the budget or MAX px
  const MAX = 30000;
  const step = Math.max(300, Math.round(innerHeight * 0.75));
  // a virtualized list (cos product cards) mounts a card's pictures on approach and unmounts
  // them once scrolled past: what the pass takes out is kept and put back after it, where the
  // slot it left is still empty (a gallery that swaps its slides refills or moves them: left alone,
  // else its pictures pile up), one node per slot
  const gone = [];
  const watch = new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.removedNodes) {
      if (n.nodeType === 1 && (n.tagName === "IMG" || n.querySelector("img")) && m.target.isConnected) gone.push([n, m.target, m.nextSibling]);
    }
  });
  watch.observe(document.body, { childList: true, subtree: true });
  held.watch = watch;
  // a real scroll, frame by frame (a fifth of a window each, ~12000 px/s), not jumps: every scroll
  // event and observer the page listens to fires as it would under a hand, a short dwell every
  // window for the loaders it sets off
  let steps = 0;
  const px = Math.max(60, Math.round(innerHeight / 5));
  for (let y = 0, dwell = 0; y < Math.min(H(), MAX) - innerHeight && left() > budget / 2; ) {
    y += px;
    window.scrollTo({ left: 0, top: y, behavior: "instant" });
    steps++;
    await globalThis.__angeloFrame();
    if ((dwell += px) >= step) { dwell = 0; await globalThis.__angeloSleep(60); }
  }
  // images still loading, and no new resource for 500 ms (what the scroll set off)
  const pending = () => [...document.images].filter((i) => !i.complete && (i.currentSrc || i.src));
  let seen = performance.getEntriesByType("resource").length;
  let quietFrom = now();
  while (left() > 0) {
    await globalThis.__angeloSleep(100);
    const n = performance.getEntriesByType("resource").length;
    if (n !== seen) { seen = n; quietFrom = now(); }
    if (!pending().length && now() - quietFrom >= 500) break;
  }
  unlock?.remove();
  await globalThis.__angeloTop();
  // back at the top, a virtualized list remounts the rows near it with fresh pictures that load
  // and fade or slide in (cos coats: the first two card rows read grey or half in): their loads
  // and reveals waited out, 3 s at most
  const moving = () => document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming().endTime !== Infinity).length;
  for (let t1 = now(), calm = 0; now() - t1 < 3000 && calm < 300; ) {
    await globalThis.__angeloSleep(100);
    calm = pending().length || moving() ? 0 : calm + 100;
  }
  watch.disconnect();
  let kept = 0;
  // the put-back nodes are the page's no more: once captured they come out again (__angeloUnkeep),
  // else the framework remounts its own picture next to them (cos: grey slot above, image below)
  globalThis.__angeloKept = [];
  // a slot that kept a placeholder (a skeleton div, an img not loaded) counts as empty: one with a
  // loaded picture of its own (a gallery that refilled it) is left alone. The slot's unloaded img
  // (cos: an empty tag remounted at the top) is hidden while the kept one stands in, one per slot
  const skip = { back: 0, detached: 0, filled: 0 };
  // shown too: a picture faded out until it scrolls in again (opacity 0 on it or up to the slot)
  // paints the grey slot all the same
  const shown = (i, top) => { for (let e = i; e && e !== top.parentElement; e = e.parentElement) { const cs = getComputedStyle(e); if (+cs.opacity === 0 || cs.visibility === "hidden" || cs.display === "none") return false; } return true; };
  const loaded = (i, top) => i.complete && i.naturalWidth > 1 && !/^data:/.test(i.currentSrc || i.src) && shown(i, top);
  const used = new Set();
  globalThis.__angeloHid = [];
  for (const [n, parent, next] of gone) {
    if (n.isConnected) { skip.back++; continue; }
    if (!parent.isConnected) { skip.detached++; continue; }
    const own = [...parent.querySelectorAll("img")];
    if (used.has(parent) || own.some((i) => loaded(i, parent))) { skip.filled++; continue; }
    used.add(parent);
    for (const i of own) { globalThis.__angeloHid.push([i, i.style.visibility]); i.style.visibility = "hidden"; }
    for (const i of n.tagName === "IMG" ? [n] : n.querySelectorAll("img")) i.loading = "eager";
    parent.insertBefore(n, next?.parentNode === parent ? next : null);
    globalThis.__angeloKept.push(n);
    kept++;
    // the put-back node is the page's no more: its reveal never plays again (cos: the picture
    // taken out at opacity 0, its fade-in class gone with its state) and the capture skips what
    // paints nothing → the picture and what wraps it up to the node shown by force
    globalThis.__angeloShow(n);
  }
  // the put-back pictures still loading get their own short wait
  for (const t1 = now(); kept && pending().length && now() - t1 < 4000; ) await globalThis.__angeloSleep(100);
  await globalThis.__angeloLottieSample();
  return { lazy: lazy.length, steps, locked, inner: inner ? `${inner.tagName.toLowerCase()}${inner.className && typeof inner.className === "string" ? "." + inner.className.trim().split(/\s+/)[0] : ""}` : null, gone: gone.length, kept, skip, pending: pending().length, ms: Math.round(now() - t0) };
};
// an interrupted pass (a throw, the page navigating) must not leave its observer or the unlock style behind
globalThis.__angeloPrepare = async (opts = {}) => {
  const held = {};
  try {
    return await globalThis.__angeloPrepareRun(opts, held);
  } catch (error) {
    held.watch?.disconnect();
    held.unlock?.remove();
    throw error;
  }
};
// A node the capture owns (put back by __angeloPrepare) painted visible: every img in it and the
// chain up to the node, where the page left opacity 0 or visibility hidden. Overlays off that
// chain (a hover chevron, a skeleton veil) keep their state
globalThis.__angeloShow = (n) => {
  for (const i of n.tagName === "IMG" ? [n] : n.querySelectorAll("img")) {
    for (let e = i; e; e = e === n ? null : e.parentElement) {
      const cs = getComputedStyle(e);
      if (+cs.opacity === 0) e.style.setProperty("opacity", "1", "important");
      if (cs.visibility === "hidden") e.style.setProperty("visibility", "visible", "important");
    }
  }
};
globalThis.__angeloUnkeep = () => {
  for (const n of globalThis.__angeloKept || []) n.remove();
  for (const [i, v] of globalThis.__angeloHid || []) i.style.visibility = v;
  globalThis.__angeloKept = [];
  globalThis.__angeloHid = [];
};
globalThis.__angeloRestProps = ["transform", "translate", "scale", "rotate", "opacity", "clip-path", "filter"];
// the turn an element and its ancestors give it, clockwise in degrees as CSS has it
// letter-spacing in px: the computed value keeps a percentage as written (-2 % of the font size)
// filter: invert(x) / brightness(y) on an element or an ancestor changes the colours it paints (chloe's header and
// logo over the hero: drawn black, invert(1) brightness(2) shows them white). Figma has no such filter on a fill or a
// text: the colour is baked, each filter in CSS order, the element's own first
globalThis.__angeloFilterColor = (el, color) => {
  let f = "";
  for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const v = getComputedStyle(e).filter; if (v && v !== "none") f += " " + v; }
  if (!/invert\(|brightness\(/.test(f)) return color;
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(color || "");
  if (!m) return color;
  let c = [+m[1], +m[2], +m[3]].map((x) => x / 255);
  for (const [, k, n, pc] of f.matchAll(/(invert|brightness)\(([\d.]+)(%?)\)/g)) {
    const a = +n / (pc ? 100 : 1);
    c = c.map((x) => (k === "invert" ? x + (1 - 2 * x) * a : Math.min(1, x * a)));
  }
  const [r, g, b] = c.map((x) => Math.round(x * 255));
  return m[4] !== undefined ? `rgba(${r}, ${g}, ${b}, ${m[4]})` : `rgb(${r}, ${g}, ${b})`;
};
globalThis.__angeloLs = (cs) => {
  const v = parseFloat(cs.letterSpacing) || 0;
  return /%$/.test(cs.letterSpacing) ? (v / 100) * parseFloat(cs.fontSize) : v;
};
globalThis.__angeloTurn = (el) => {
  let a = 0;
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    const t = getComputedStyle(e).transform;
    if (t && t !== "none") { const m = new DOMMatrix(t); a += (Math.atan2(m.b, m.a) * 180) / Math.PI; }
    const r = getComputedStyle(e).rotate;
    if (r && r !== "none") a += parseFloat(r.split(" ").at(-1)) || 0;
  }
  return a;
};
globalThis.__angeloSettle = async (opts = {}) => {
  const quiet = opts.quiet ?? 1500;
  const t0 = globalThis.__angeloNow();
  const clock = globalThis.__angeloClock;
  const H = () => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  const frame = () => globalThis.__angeloPass(20);
  const state = (el) => { const cs = getComputedStyle(el); return globalThis.__angeloRestProps.map((p) => cs.getPropertyValue(p)); };
  const OP = globalThis.__angeloRestProps.indexOf("opacity");
  globalThis.__angeloRenderAll();
  await globalThis.__angeloTop();
  // a demo played on load (a chat typing its answer, "Thinking…" then the reply): wait for the
  // DOM to stay quiet before reading it, 4 s at least (a demo pauses between its steps), bounded
  // (a ticker never stops; a short quiet spell gets between its ticks). On the owned clock, page
  // time: 20 s of demo play in a fraction of it
  clock?.freeze();
  const now = clock ? () => performance.now() : globalThis.__angeloNow;
  await new Promise((done) => {
    let last = now();
    const mo = new MutationObserver(() => (last = now()));
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });
    const t0 = now();
    const over = () => !((now() - last < quiet || now() - t0 < 4000) && now() - t0 < 20000);
    if (clock) (async () => { while (!over()) await clock.tick(250); mo.disconnect(); done(); })();
    else {
      const tick = (globalThis.__angeloReal?.setInterval ?? setInterval)(() => {
        if (!over()) return;
        (globalThis.__angeloReal?.clearInterval ?? clearInterval)(tick);
        mo.disconnect();
        done();
      }, 250);
    }
  });
  const t1 = globalThis.__angeloNow();
  // state of each element below the fold as the page lands, and its best sample so far
  const vh = innerHeight;
  const land = new Map();
  for (const el of document.body.querySelectorAll("*")) if (el.getBoundingClientRect().top >= vh) land.set(el, state(el));
  const best = new Map();
  // its last state seen while wholly on screen: back to the landing one there, the shown state
  // was passing (video controls shown at play, then hidden), not a reveal
  const last = new Map();
  const live = new Set(land.keys());
  // half a window: every element up to a window high is mostly on screen at some step
  const STEP = Math.max(300, Math.round(vh / 2));
  const end = H() - vh;
  // a reveal started by the scroll (fade-in on intersection) runs as a CSS transition or
  // animation: jump the finite ones on screen to their end (same end state as waiting, no
  // 1.5 s per step), or it is sampled half-way (a whole grid read at opacity 0 and dropped);
  // a few frames more for the ones a script starts late (staggered by setTimeout)
  let capped = 0;
  const calm = async () => {
    for (let i = 0; ; i++) {
      const run = document.getAnimations().filter((a) => {
        if (a.playState !== "running" || !Number.isFinite(a.effect?.getComputedTiming().endTime)) return false;
        const r = a.effect.target?.getBoundingClientRect?.();
        return r && r.bottom > 0 && r.top < innerHeight;
      });
      if (!run.length) return;
      if (i >= 4) { capped++; return; }
      for (const a of run) try { a.finish(); } catch {}
      await frame();
    }
  };
  for (let s = STEP; live.size && s < end + STEP; s += STEP) {
    window.scrollTo(0, Math.min(s, end));
    if (clock) {
      // page time for what the step set off to land: a spring chasing the scroll, a reveal's
      // transition, a stagger; 40 ms frames (a spring caps its step near that)
      await clock.tick(1500, 40);
    } else {
      await frame();
      await calm();
      // a scroll-linked fade eased by a spring (inline opacity chasing the scroll) lags the jump:
      // read at once, a block that lands at 1 is kept at 0.75; wait while what is on screen still
      // fades, 150 ms at most (only the steps inside such a scene pay)
      // inline opacity alone, the one a script chases: a marquee moves its transform every frame,
      // a pulse loops its opacity in CSS, either would hold every step
      const onScreen = [...live].filter((el) => { if (!el.style.opacity) return false; const r = el.getBoundingClientRect(); return r.top < vh && r.bottom > 0; });
      const snap = () => onScreen.map((el) => parseFloat(el.style.opacity));
      for (let prev = snap(), t = globalThis.__angeloNow(); globalThis.__angeloNow() - t < 150; ) {
        await frame();
        const now = snap();
        // near its end, a spring creeps for long: within 0.01 a frame is landed
        if (now.every((v, i) => Math.abs(v - prev[i]) < 0.01)) break;
        prev = now;
      }
    }
    for (const el of live) {
      const top = el.getBoundingClientRect().top;
      if (top >= vh) continue;
      // gone well above the viewport: its samples are done
      if (top < -STEP * 2) { live.delete(el); continue; }
      const now = state(el);
      const r = el.getBoundingClientRect();
      const score = [parseFloat(now[OP]), -Math.abs(r.top + r.height / 2 - vh / 2)];
      // mostly on screen: a scene layer one viewport high under a sticky header is never wholly in it
      if (Math.min(r.bottom, vh) - Math.max(r.top, 0) >= 0.6 * Math.min(r.height, vh)) last.set(el, now);
      const b = best.get(el);
      if (!b || score[0] > b.score[0] || (score[0] === b.score[0] && score[1] > b.score[1])) best.set(el, { now, score });
    }
  }
  const rest = new Map();
  const same = (a, b) => a.every((v, i) => v === b[i]);
  for (const [el, { now }] of best) if (!same(now, land.get(el)) && !(last.has(el) && same(last.get(el), land.get(el)))) rest.set(el, now);
  globalThis.__angeloRest = rest;
  await globalThis.__angeloTop();
  // back at the top, what the scroll left off screen (a video paused, its controls shown) is told
  // it is in view, as in the full-page shot (only when web-capture.mjs wrapped the observers)
  globalThis.__angeloInView?.();
  await globalThis.__angeloPass(600);
  // where the time went: the quiet wait, the scroll
  return { quiet: t1 - t0, scroll: globalThis.__angeloNow() - t1, capped };
};

// Applies the rest states (no transition, so the computed style is the final one at once) and
// returns the undo; run in the same task as the reads so the page's scripts never see it
globalThis.__angeloAtRest = () => {
  const saved = [];
  for (const [el, vals] of globalThis.__angeloRest || []) {
    if (!el.isConnected) continue;
    for (const [i, p] of ["transition", ...globalThis.__angeloRestProps].entries()) {
      saved.push([el, p, el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]);
      el.style.setProperty(p, i ? vals[i - 1] : "none", "important");
    }
  }
  // a bar stuck to the window's bottom (cos: a card's name and price, held over its pictures until
  // they are scrolled past) is read where it ends up, at the end of its box, not across the pictures
  for (const el of document.body.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    if (cs.position !== "sticky" || cs.bottom === "auto" || cs.top !== "auto") continue;
    for (const [p, v] of [["position", "relative"], ["bottom", "auto"]]) {
      saved.push([el, p, el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]);
      el.style.setProperty(p, v, "important");
    }
  }
  return () => { for (const [el, p, v, pr] of saved.reverse()) v ? el.style.setProperty(p, v, pr) : el.style.removeProperty(p); };
};

// Visual boxes of the page (layout + computed styles + text + image urls) in preorder.
// opts.skip: elements left out (blocks not picked), the vertical bands they free are closed up
// opts.names: Map element → block name, carried as `block` on its box
// opts.until: page y (css px) the capture stops at, boxes crossing it are cut there
// content-visibility: auto skips sections far from the viewport (no text rects, a blank lower
// half in the full-page shot) and sizes them by a placeholder: all rendered, at their real height.
// Called by the capture too: the extension captures without settling
globalThis.__angeloRenderAll = () => {
  if (document.getElementById("angelo-render-all")) return;
  const cv = document.createElement("style");
  cv.id = "angelo-render-all";
  cv.textContent = "* { content-visibility: visible !important; }";
  document.head.append(cv);
};
// Lottie (lottie-web svg renderer) animations are read at whatever frame they play: many start or
// loop through an empty one (duolingo: every illustration captured as `<g display:none>`). Each is
// sampled for a few seconds on real time and its fullest frame (most painted shapes) is kept, then put
// back before the read (__angeloCapture). A detached copy of the children, nothing else of the page moves.
const lottieScore = (s) => [...s.querySelectorAll("path[d]")].filter((p) => p.getClientRects().length).length;
globalThis.__angeloLottieSample = async (ms = 3000) => {
  const all = [...document.querySelectorAll("svg")].filter((s) => s.querySelector('[clip-path^="url(#__lottie_element"]'));
  if (!all.length) return 0;
  const best = (globalThis.__angeloLottie ||= new Map());
  for (const t0 = globalThis.__angeloNow(); globalThis.__angeloNow() - t0 < ms; ) {
    for (const s of all) {
      if (!s.isConnected) continue;
      const n = lottieScore(s);
      if (n > (best.get(s)?.n ?? 0)) best.set(s, { n, html: s.innerHTML });
    }
    await globalThis.__angeloSleep(100);
  }
  return all.length;
};
globalThis.__angeloLottiePut = () => {
  for (const [s, b] of globalThis.__angeloLottie || []) if (s.isConnected && lottieScore(s) < b.n) s.innerHTML = b.html;
};
globalThis.__angeloCapture = (opts = {}) => {
  // big boxes' elements, for the blocks shot in view afterwards (__angeloFrameShots)
  globalThis.__angeloEls = new Map();
  globalThis.__angeloLottiePut();
  globalThis.__angeloRenderAll();
  if (globalThis.__angeloHeld) return globalThis.__angeloRead(opts);
  const undo = globalThis.__angeloAtRest();
  try { return globalThis.__angeloRead(opts); } finally { undo(); }
};
// Holds the rest states across the async screenshots (canvas layer, reference shot), so the
// shots match the capture: __angeloHold(true) before, __angeloHold(false) after
// Endless animations (logo marquees, tickers) are paused too: running, the capture and the
// shots taken seconds later show them at different offsets. CSS ones are paused, scripted ones
// (an inline transform moved each frame) stand still on the owned clock (web-capture.mjs)
globalThis.__angeloHold = (on) => {
  if (on && !globalThis.__angeloHeld) {
    const undo = globalThis.__angeloAtRest();
    const paused = document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming().endTime === Infinity);
    for (const a of paused) a.pause();
    // a demo step caught mid-way (two list items sliding past each other, 650 of 1420 ms): shown
    // where it lands, paused 1 ms short of its end so no finish callback starts the next step;
    // only steps that hold their end (fill forwards, transitions), the rest end on another style
    // (on the owned clock, those it holds paused count as running)
    const clock = globalThis.__angeloClock;
    clock?.freeze();
    clock?.hold();
    const landing = document.getAnimations().filter((a) => {
      const t = a.effect?.getComputedTiming();
      // clock-driven only: a scroll-driven one has no end in time
      return (a.playState === "running" || (clock?.held.has(a) && a.playState === "paused" && a.currentTime < t?.endTime - 1)) && t && a.timeline instanceof DocumentTimeline && Number.isFinite(t.endTime) && (/forwards|both/.test(t.fill) || a instanceof CSSTransition);
    }).map((a) => [a, a.currentTime]);
    for (const [a] of landing) { a.pause(); a.currentTime = a.effect.getComputedTiming().endTime - 1; }
    // a scroll-linked fade writes its inline style from the scroll event (frozen frames or not):
    // the scroll back to the top drops the held !important value for its own (a block read at 0.2);
    // put back as soon as it is written, before any read or paint
    const rest = globalThis.__angeloRest || new Map();
    const guard = new MutationObserver((ms) => {
      for (const el of new Set(ms.map((m) => m.target))) {
        const vals = rest.get(el);
        if (vals) globalThis.__angeloRestProps.forEach((p, i) => {
          if (el.style.getPropertyPriority(p) !== "important") el.style.setProperty(p, vals[i], "important");
        });
      }
    });
    for (const el of rest.keys()) if (el.isConnected) guard.observe(el, { attributes: true, attributeFilter: ["style"] });
    globalThis.__angeloHeld = () => {
      guard.disconnect();
      undo();
      for (const a of paused) a.play();
      for (const [a, t] of landing) { a.currentTime = t; a.play(); }
      clock?.run();
    };
  }
  if (!on && globalThis.__angeloHeld) { globalThis.__angeloHeld(); globalThis.__angeloHeld = null; }
};
// Modern CSS colors (oklch, oklab, lab, lch, color()) as sRGB rgb()/rgba(), the only syntax the
// capture regexes and the build read: painted on a 1×1 canvas with alpha forced to 1, the alpha
// kept from the source string (premultiplied readback loses it for faint colors)
globalThis.__angeloSrgb = (() => {
  const MODERN = /\b(?:oklch|oklab|lab|lch|color)\((?:[^()]|\([^()]*\))*\)/g;
  const seen = new Map();
  let ctx;
  const one = (c) => {
    if (seen.has(c)) return seen.get(c);
    ctx ||= Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
    const am = /\/\s*([\d.]+)(%?)\s*\)$/.exec(c);
    const a = am ? Math.round((am[2] ? +am[1] / 100 : +am[1]) * 1000) / 1000 : 1;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = am ? c.replace(/\/\s*[\d.]+%?\s*\)$/, "/ 1)") : c;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    const out = a < 1 ? `rgba(${r}, ${g}, ${b}, ${a})` : `rgb(${r}, ${g}, ${b})`;
    seen.set(c, out);
    return out;
  };
  return (v) => (typeof v === "string" && v.includes("(") ? v.replace(MODERN, one) : v);
})();
globalThis.__angeloRead = (opts = {}) => {
  // every computed style read below sees sRGB colors
  const srgb = globalThis.__angeloSrgb;
  const getComputedStyle = (el, pseudo) => new Proxy(window.getComputedStyle(el, pseudo), {
    get: (t, k) => {
      const v = t[k];
      if (k === "getPropertyValue") return (p) => srgb(t.getPropertyValue(p));
      return typeof v === "function" ? v.bind(t) : srgb(v);
    },
  });
  const skip = opts.skip || new Set();
  const names = opts.names || new Map();
  const until = opts.until || Infinity;
  // background-image kept short, unless it holds a data url (an inline svg cut short no longer parses)
  const clipBg = (v) => (/url\(["']?data:/.test(v) ? v.slice(0, 200_000) : v.slice(0, 600));
  let boxes = [];
  const px = (v) => Math.round(parseFloat(v) || 0);
  // the width of a space in an element's font: a word gap is rebuilt from it, not from a guess
  const spaceCanvas = document.createElement("canvas").getContext("2d");
  const spaceWidth = (el) => {
    spaceCanvas.font = getComputedStyle(el).font;
    return Math.round(spaceCanvas.measureText(" ").width * 100) / 100;
  };
  // a box's corners: one radius, plus the four of them when they differ (joined buttons: rounded-r-none)
  const corners = (b, s) => {
    const c = ["TopLeft", "TopRight", "BottomRight", "BottomLeft"].map((k) => px(s[`border${k}Radius`]));
    if (Math.max(...c)) b.r = c[0] || Math.max(...c);
    if (Math.max(...c) && c.some((v) => v !== c[0])) b.rs = c;
  };
  // type sizes keep their decimals: a fluid size (19.19 px) rounded to 19 narrows every label by 1 %,
  // which adds up along a row
  const fine = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;
  // <use href="/sprite.svg#id">: the external sprite, read once per file (same origin, cached)
  const sprites = new Map();
  const spriteSymbol = (ref) => {
    const [file, id] = new URL(ref, location.href).href.split("#");
    if (!sprites.has(file)) {
      let doc = null;
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", file, false);
        xhr.send();
        if (xhr.status === 200) doc = new DOMParser().parseFromString(xhr.responseText, "image/svg+xml");
      } catch {}
      sprites.set(file, doc);
    }
    return sprites.get(file)?.getElementById(id) || null;
  };
  const visibleColor = (c) => c && c !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(c);
  // Visible fraction once ancestors with overflow clipping are applied
  const cut = (r, c) => {
    const w = Math.max(0, Math.min(r.right, c.r) - Math.max(r.left, c.l));
    const h = Math.max(0, Math.min(r.bottom, c.b) - Math.max(r.top, c.t));
    return (w * h) / Math.max(1, r.width * r.height);
  };
  // Text as the browser laid it out: one entry per rendered line, measured word by word
  // (an inline span after a kicker starts mid-line, not at its box's left edge)
  const linesOf = (el, nodes = [...el.childNodes]) => {
    const lines = [];
    for (const tn of nodes) {
      if (tn.nodeType !== 3) continue;
      const range = document.createRange();
      const rectOf = (a, b) => {
        range.setStart(tn, a);
        range.setEnd(tn, b);
        return [...range.getClientRects()].filter((q) => q.width > 0);
      };
      for (const m of tn.textContent.matchAll(/\S+/g)) {
        const qs = rectOf(m.index, m.index + m[0].length);
        if (!qs.length) continue;
        // a word hyphenated by the browser (hyphens: auto) spans two lines: split where the
        // glyphs drop, the line it leaves is marked `hy`
        let pieces = [[m[0], qs[0]]];
        if (qs.length > 1 && Math.abs(qs[qs.length - 1].top - qs[0].top) >= 2) {
          let k = 1;
          // a char's last rect is its glyph's line (the one before the break also carries the hyphen)
          while (k < m[0].length && Math.abs((rectOf(m.index + k, m.index + k + 1).at(-1)?.top ?? qs[0].top) - qs[0].top) < 2) k++;
          // (a hyphen is drawn only by hyphenation; a break between CJK characters or forced by
          // overflow-wrap draws none)
          const hy = getComputedStyle(el).hyphens === "auto" || m[0][k - 1] === "­" ? 1 : 0;
          if (k < m[0].length) pieces = [[m[0].slice(0, k), qs[0], hy], [m[0].slice(k), qs[qs.length - 1]]];
        }
        for (const [w, q, hy] of pieces) {
          const l = lines[lines.length - 1];
          // right-to-left text runs from right to left: the next word sits before the line, not after it
          if (l && !l.hy && Math.abs(q.top - l.top) < 2 && getComputedStyle(el).direction === "rtl" && q.right <= l.left + 1) {
            l.words.push(w);
            l.node = tn;
            l.left = q.left;
          } else if (l && !l.hy && Math.abs(q.top - l.top) < 2 && q.left >= l.right - 1) {
            // a piece glued to the previous one (footnote mark, period after a link) takes no space
            if (q.left - l.right < 1.5 && tn !== l.node) l.words[l.words.length - 1] += w;
            else {
              // words set far apart (an inline pill between two text nodes): the space takes the gap
              if (!/justify/.test(getComputedStyle(el).textAlign) && q.left - l.right > 0.6 * px(getComputedStyle(tn.parentElement).fontSize)) (l.gaps ||= []).push([l.words.join(" ").length, Math.round(q.left - l.right), spaceWidth(tn.parentElement)]);
              l.words.push(w);
            }
            l.node = tn;
            l.right = q.right;
          } else lines.push({ top: q.top, left: q.left, right: q.right, h: q.height, words: [w], node: tn });
          if (hy) lines[lines.length - 1].hy = 1;
        }
      }
    }
    return lines.map((l) => ({ t: l.words.join(" "), x: Math.round(l.left + __angeloScrollX()), y: Math.round((l.top + __angeloScrollY()) * 10) / 10, w: Math.round(l.right - l.left), h: Math.round(l.h * 10) / 10, ...(l.hy && { hy: 1 }), ...(l.gaps && { gaps: l.gaps }) }));
  };
  // CSS counters in tree order, computed once and only on a page that shows one: an element's value is
  // what its ::before displays (a line number incremented on the element or on the pseudo itself)
  let counters = null;
  const counterAt = (name, el) => {
    if (!counters) {
      counters = new Map();
      const cur = {};
      const pairs = (v) => [...(v || "").matchAll(/([\w-]+)\s+(-?\d+)/g)];
      const apply = (s) => {
        for (const m of pairs(s.counterReset)) cur[m[1]] = +m[2];
        for (const m of pairs(s.counterIncrement)) cur[m[1]] = (cur[m[1]] || 0) + +m[2];
      };
      for (const e of document.querySelectorAll("*")) {
        apply(getComputedStyle(e));
        apply(getComputedStyle(e, "::before"));
        counters.set(e, { ...cur });
      }
    }
    return counters.get(el)?.[name] ?? 0;
  };
  // The words a pseudo-element shows: strings, attr() and counter() of its content. An icon font's
  // private-use glyph is no text.
  const contentText = (el, content) => {
    let out = "";
    for (const m of content.matchAll(/"((?:[^"\\]|\\.)*)"|attr\(([\w-]+)\)|counter\(([\w-]+)(?:,\s*([\w-]+))?\)/g)) {
      if (m[1] !== undefined) out += m[1].replace(/\\(.)/g, "$1");
      else if (m[2]) out += el.getAttribute(m[2]) || "";
      else {
        const v = counterAt(m[3], el);
        out += m[4] === "decimal-leading-zero" ? String(v).padStart(2, "0") : String(v);
      }
    }
    out = out.trim();
    return /[-]/.test(out) ? "" : out;
  };
  // A pseudo-element that only shows words (a line number, a suffix): a text box, measured since a
  // pseudo has no client rect. Inline, it sits at the start of the element's first line box or the end
  // of its last one.
  const measure = document.createElement("canvas").getContext("2d");
  const pseudoText = (el, r, which, parent, op, clip, ps) => {
    const text = contentText(el, ps.content);
    const o = op * +ps.opacity;
    if (!text || !o || ps.visibility === "hidden") return;
    const cs = getComputedStyle(el);
    const size = parseFloat(ps.fontSize);
    const ls = __angeloLs(ps);
    measure.font = `${ps.fontStyle} ${ps.fontWeight} ${ps.fontSize} ${ps.fontFamily}`;
    const lh = ps.lineHeight === "normal" ? null : parseFloat(ps.lineHeight);
    const w = parseFloat(ps.width) || Math.ceil(measure.measureText(text).width + ls * text.length);
    const h = parseFloat(ps.height) || lh || Math.round(size * 1.2);
    const L = r.left + px(cs.borderLeftWidth), T = r.top + px(cs.borderTopWidth);
    const R = r.right - px(cs.borderRightWidth), B = r.bottom - px(cs.borderBottomWidth);
    let x, y;
    if (ps.position === "absolute" || ps.position === "fixed") {
      x = ps.left !== "auto" ? L + parseFloat(ps.left) : ps.right !== "auto" ? R - parseFloat(ps.right) - w : L + px(cs.paddingLeft);
      y = ps.top !== "auto" ? T + parseFloat(ps.top) : ps.bottom !== "auto" ? B - parseFloat(ps.bottom) - h : T + px(cs.paddingTop);
    } else {
      const rects = el.getClientRects();
      const line = which === "::after" ? rects[rects.length - 1] : rects[0];
      const inline = cs.display === "inline" && line;
      x = which === "::after" ? (inline ? line.right : R - px(cs.paddingRight)) - w : inline ? line.left : L + px(cs.paddingLeft);
      y = inline ? line.top : T + px(cs.paddingTop);
    }
    if (x + w <= clip.l || x >= clip.r || y + h <= clip.t || y >= clip.b) return;
    const b = { id: boxes.length, p: parent, tag: which, x: Math.round(x + __angeloScrollX()), y: Math.round(y + __angeloScrollY()), w: Math.round(w), h: Math.round(h), text };
    b.font = { family: ps.fontFamily.split(",")[0].replace(/["']/g, "").trim(), size, weight: +ps.fontWeight, lh, ls, color: ps.color, align: ps.textAlign, transform: ps.textTransform !== "none" ? ps.textTransform : undefined };
    if (o < 1) b.op = Math.round(o * 100) / 100;
    boxes.push(b);
  };
  // ::before / ::after that draw something (rules, dividers, gradient scrims): their box from the computed
  // style, absolute ones against the element's padding box
  const pseudo = (el, r, which, parent, op, clip) => {
    const ps = getComputedStyle(el, which);
    if (!ps.content || ps.content === "none" || ps.content === "normal" || ps.display === "none") return;
    const pbg = visibleColor(ps.backgroundColor) ? ps.backgroundColor : null;
    const psides = ["Top", "Right", "Bottom", "Left"].map((k) => (visibleColor(ps[`border${k}Color`]) && ps[`border${k}Style`] !== "none" ? px(ps[`border${k}Width`]) : 0));
    const pimg = ps.backgroundImage !== "none" ? ps.backgroundImage : null;
    if (!pbg && !pimg && !psides.some(Boolean)) return pseudoText(el, r, which, parent, op, clip, ps);
    const cs = getComputedStyle(el);
    const box = ps.boxSizing === "border-box";
    let w = parseFloat(ps.width) || 0;
    let h = parseFloat(ps.height) || 0;
    if (!box) {
      w += px(ps.paddingLeft) + px(ps.paddingRight) + psides[1] + psides[3];
      h += px(ps.paddingTop) + px(ps.paddingBottom) + psides[0] + psides[2];
    }
    if (w < 1 || h < 1) return;
    const L = r.left + px(cs.borderLeftWidth), T = r.top + px(cs.borderTopWidth);
    const R = r.right - px(cs.borderRightWidth), B = r.bottom - px(cs.borderBottomWidth);
    let x = L, y = T;
    if (ps.position === "absolute" || ps.position === "fixed") {
      // margins move it from there (a 26 px arrow centred by left: 50% and a negative margin)
      x = ps.left !== "auto" ? L + parseFloat(ps.left) + px(ps.marginLeft) : ps.right !== "auto" ? R - parseFloat(ps.right) - px(ps.marginRight) - w : L;
      y = ps.top !== "auto" ? T + parseFloat(ps.top) + px(ps.marginTop) : ps.bottom !== "auto" ? B - parseFloat(ps.bottom) - px(ps.marginBottom) - h : T;
    } else if (which === "::after") {
      x = L + px(cs.paddingLeft);
      y = B - px(cs.paddingBottom) - h;
    } else {
      x = L + px(cs.paddingLeft);
      y = T + px(cs.paddingTop);
    }
    // a flex item of its element (a chevron after a menu button's label, display: flex, gap 8): past
    // the element's content on the main axis, placed on the cross axis by align-self / align-items
    if (ps.position !== "absolute" && ps.position !== "fixed" && /flex$/.test(cs.display) && !/reverse/.test(cs.flexDirection)) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const c = range.getBoundingClientRect();
      if (c.width > 0 && c.height > 0) {
        const row = cs.flexDirection === "row";
        const gap = px(row ? cs.columnGap : cs.rowGap);
        const align = ps.alignSelf !== "auto" ? ps.alignSelf : cs.alignItems;
        const [s0, s1, size] = row ? [T + px(cs.paddingTop), B - px(cs.paddingBottom), h] : [L + px(cs.paddingLeft), R - px(cs.paddingRight), w];
        const cross = /center/.test(align) ? (s0 + s1 - size) / 2 : /end/.test(align) ? s1 - size : s0;
        if (row) {
          x = which === "::after" ? c.right + gap + px(ps.marginLeft) : c.left - gap - px(ps.marginRight) - w;
          y = cross;
        } else {
          y = which === "::after" ? c.bottom + gap + px(ps.marginTop) : c.top - gap - px(ps.marginBottom) - h;
          x = cross;
        }
      }
    }
    // inline in the element's text (a chevron drawn by borders after a link's label): it sits past
    // the last glyph, its bottom margin edge on the baseline, wherever the text is aligned
    if (ps.position !== "absolute" && ps.position !== "fixed" && /^inline/.test(ps.display)) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const lines = [...range.getClientRects()].filter((q) => q.width > 0);
      const at = which === "::after" ? lines[lines.length - 1] : lines[0];
      if (at) {
        const ctx = document.createElement("canvas").getContext("2d");
        ctx.font = cs.font;
        const base = at.bottom - (ctx.measureText("x").fontBoundingBoxDescent || 0);
        x = which === "::after" ? at.right + px(ps.marginLeft) : at.left - px(ps.marginRight) - w;
        y = base - px(ps.marginBottom) - h;
        if (ps.position === "relative") { x += parseFloat(ps.left) || 0; y += parseFloat(ps.top) || 0; }
      }
    }
    // transform (a glow centred on a corner by translate(-50%, -50%)) about its origin; its blur
    // is drawn before it, so scaled with it
    // the individual translate / scale properties apply before transform (a hover fill parked
    // below its button by translate: 0 100%, cut by the button's clip)
    const m = new DOMMatrix();
    if (ps.translate !== "none") {
      const [tx, ty = "0px"] = ps.translate.split(" ");
      const tv = (v, full) => (v.endsWith("%") ? (full * parseFloat(v)) / 100 : parseFloat(v) || 0);
      m.translateSelf(tv(tx, w), tv(ty, h));
    }
    // the rotate property (a lone angle) comes between translate and scale
    if (/^-?[\d.]+deg$/.test(ps.rotate)) m.rotateSelf(parseFloat(ps.rotate));
    if (ps.scale !== "none") {
      const [sx, sy = sx] = ps.scale.split(" ").map(parseFloat);
      m.scaleSelf(sx, sy);
    }
    if (ps.transform !== "none") m.multiplySelf(new DOMMatrix(ps.transform));
    let rot = 0;
    if (!m.isIdentity) {
      const [cx, cy] = ps.transformOrigin.split(" ").map((v, i) => [x, y][i] + parseFloat(v));
      if (Math.abs(m.b) > 1e-3 && Math.abs(m.c) > 1e-3) {
        // turned (a chevron drawn by two borders, rotated 45deg): the box keeps its own size, turned
        // about its centre, which lands where the transform sends it
        rot = Math.round(Math.atan2(m.b, m.a) * 1800 / Math.PI) / 10;
        const [mx, my] = [x + w / 2 - cx, y + h / 2 - cy];
        w *= Math.hypot(m.a, m.b); h *= Math.hypot(m.c, m.d);
        [x, y] = [cx + m.e + m.a * mx + m.c * my - w / 2, cy + m.f + m.b * mx + m.d * my - h / 2];
      } else [x, y, w, h] = [cx + m.e + (x - cx) * m.a, cy + m.f + (y - cy) * m.d, w * Math.abs(m.a), h * Math.abs(m.d)];
    }
    // an image alone, not repeated, at a px or % size (a shimmer sweep parked at its start, a
    // progress fill at 0px 100%) paints only its background rect; what shows is that rect inside
    // the box and the clip
    let [l, t, rr, bb] = [x, y, x + w, y + h];
    // at auto, an svg's own size (a select's 8 px arrow, stretched to its 30 px box otherwise)
    const svgSrc = ps.backgroundSize.split(",")[0].trim().startsWith("auto") && /^url\("data:image\/svg\+xml([^,]*),(.*)"\)$/.exec(pimg || "");
    const svgTag = svgSrc ? /<svg[^>]*>/.exec(/base64/.test(svgSrc[1]) ? atob(svgSrc[2]) : decodeURIComponent(svgSrc[2]))?.[0] || "" : "";
    const [svgW, svgH] = ["width", "height"].map((a) => new RegExp(`\\s${a}=["']?([\\d.]+)(?:px)?["'\\s>]`).exec(svgTag)?.[1]);
    const size = svgW && svgH ? [null, svgW, "px", svgH, "px"] : /^([\d.]+)(px|%) ([\d.]+)(px|%)$/.exec(ps.backgroundSize);
    if (pimg && !pbg && !psides.some(Boolean) && size && /no-repeat/.test(ps.backgroundRepeat)) {
      const [sw, sh] = [size[2] === "%" ? (w * size[1]) / 100 : +size[1], size[4] === "%" ? (h * size[3]) / 100 : +size[3]];
      const at = (v, full, s) => (v.endsWith("%") ? ((full - s) * parseFloat(v)) / 100 : parseFloat(v) || 0);
      const [px0, py0] = ps.backgroundPosition.split(",")[0].trim().split(/\s+/);
      const bx = x + at(px0, w, sw), by = y + at(py0 ?? "50%", h, sh);
      [l, t, rr, bb] = [Math.max(l, bx), Math.max(t, by), Math.min(rr, bx + sw), Math.min(bb, by + sh)];
    }
    [l, t, rr, bb] = [Math.max(l, clip.l), Math.max(t, clip.t), Math.min(rr, clip.r), Math.min(bb, clip.b)];
    if (rr - l < 1 || bb - t < 1) return;
    [x, y, w, h] = [l, t, rr - l, bb - t];
    const pfb = /blur\(([\d.]+)px\)/.exec(ps.filter);
    const b = { id: boxes.length, p: parent, tag: which, x: Math.round(x + __angeloScrollX()), y: Math.round(y + __angeloScrollY()), w: Math.round(w), h: Math.round(h) };
    if (rot) b.rot = rot;
    if (pbg) b.bg = pbg;
    // an icon drawn by an image mask over a flat fill (gov.uk crest on ::before), as on a real element
    const pMask = [ps.maskImage, ps.webkitMaskImage].map((v) => /url\((?:"((?:[^"\\]|\\.)+)"|'((?:[^'\\]|\\.)+)'|([^)]+))\)/.exec(v || "")?.slice(1).find(Boolean)?.replace(/\\(.)/g, "$1")).find(Boolean);
    if (pMask && pbg) b.maskIcon = new URL(pMask, location.href).href;
    if (pfb && +pfb[1]) b.fblur = Math.round(+pfb[1] * Math.abs(m.a));
    if (pimg) b.bgImg = clipBg(pimg);
    if (ps.mixBlendMode !== "normal") b.blend = ps.mixBlendMode;
    const tile = /^([\d.]+)px/.exec(ps.backgroundSize);
    if (pimg && tile && !/no-repeat/.test(ps.backgroundRepeat)) b.tile = +tile[1];
    corners(b, ps);
    const lead = psides.findIndex((v) => v);
    if (lead >= 0) {
      b.border = { w: psides[lead], c: ps[`border${["Top", "Right", "Bottom", "Left"][lead]}Color`] };
      if (psides.some((v) => v !== b.border.w)) b.border.sides = psides;
    }
    const o = op * +ps.opacity;
    if (o < 1) b.op = Math.round(o * 100) / 100;
    // positioned like any box: painted with the positioned layers, not under the flow
    if (/^(absolute|fixed)$/.test(ps.position)) b.pin = 1;
    if (ps.position !== "static" && parseInt(ps.zIndex)) b.z = parseInt(ps.zIndex);
    boxes.push(b);
  };
  // what the page calls this element, for naming components: a component attribute, else a
  // readable class (hashed CSS-in-JS / CSS-module classes skipped), else its ARIA role
  const nameHint = (el) => {
    const attr = el.getAttribute("data-component") || el.getAttribute("data-testid") || el.getAttribute("data-name");
    if (attr) return attr.slice(0, 40);
    // hashed: a CSS-in-JS prefix or a segment mixing letters and digits; utility: a style word first
    const hashed = (c) => /^(css|sc|jsx|dcr|emotion|svelte|tw)-/.test(c) || c.split(/[-_]+/).some((t) => t.length >= 5 && /\d/.test(t) && /[a-z]/i.test(t)) || /^[a-z]{1,3}$/i.test(c);
    const utility = (c) => /^(show|hide|text|bg|font|flex|grid|block|inline|align|justify|items|gap|[mp][trblxy]?|w|h|min|max|sr|u)-/.test(c);
    const cls = [...el.classList].map((c) => c.replace(/^js-/, "")).find((c) => !hashed(c) && !utility(c) && !/^(is|has)-|^(active|selected|hidden|visible|open|clearfix|container|wrapper|inner)$/.test(c));
    if (cls) return cls.slice(0, 40);
    return el.getAttribute("role") || null;
  };
  const holes = [];
  const unseen = [];
  const texts = [];
  // the URL an image loads (or will, once lazy-loaded): src, else the widest srcset candidate
  // (its own, a <picture> source's, or a data- copy kept for the lazy loader)
  const lazySrc = (el) => {
    const sets = [el.getAttribute("srcset"), el.dataset.srcset, ...(el.parentElement?.tagName === "PICTURE" ? [...el.parentElement.querySelectorAll("source")].map((x) => x.getAttribute("srcset") || x.dataset.srcset) : [])];
    for (const set of sets) {
      if (!set) continue;
      const best = set.split(/,\s+/).map((c) => c.trim().split(/\s+/)).sort((a, b) => (parseFloat(b[1]) || 1) - (parseFloat(a[1]) || 1))[0];
      if (best?.[0]) return new URL(best[0], location.href).href;
    }
    const src = el.getAttribute("src") || el.dataset.src;
    return src && !src.startsWith("data:") ? new URL(src, location.href).href : el.src && !el.src.startsWith("data:") ? el.src : "";
  };
  // a <picture> whose <img> is mounted only once scrolled into view (React lazy): the first
  // <source> matching the viewport, so the frame is not left empty
  const pictureSrc = (el) => {
    if (el.querySelector("img")) return null;
    const src = [...el.querySelectorAll("source")].find((x) => (x.getAttribute("srcset") || x.dataset.srcset) && (!x.media || matchMedia(x.media).matches));
    return src ? lazySrc(src) || null : null;
  };
  // The tree as it renders: an open shadow root stands in for its host's light children, a <slot>
  // for what it shows (its assigned elements, else its fallback). Porsche paints its header, the
  // scrim and the arrow of every tile there
  const expand = (list) => list.flatMap((c) => {
    if (c.tagName !== "SLOT") return [c];
    const own = c.assignedElements({ flatten: true });
    return own.length ? own : expand([...c.children]);
  });
  const kidsOf = (el) => expand([...(el.shadowRoot || el).children]);
  // the shadow wrappers that already stand in for their host's paint: walked through, not painted twice
  const standIns = new Set();
  // The upright labels of an svg <text>, one box per line (tspan), at their rendered size. [] = paints
  // nothing, null = not a plain label (turned, skewed, on a path, painted by a gradient): stays in the svg
  const svgTextBoxes = (n, svgEl) => {
    const m = n.getScreenCTM?.();
    if (!m || m.a <= 0 || Math.abs(m.b) > 1e-3 || Math.abs(m.c) > 1e-3 || Math.abs(m.a - m.d) > 1e-3) return null;
    if (n.querySelector("textPath")) return null;
    if (!n.checkVisibility()) return [];
    const kids = [...n.children];
    if (kids.some((c) => c.tagName.toLowerCase() !== "tspan")) return null;
    if (kids.length && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) return null;
    let o = 1;
    for (let e = n; e && e !== svgEl.parentElement; e = e.parentElement) o *= +getComputedStyle(e).opacity;
    const out = [];
    for (const s of kids.length ? kids : [n]) {
      const t = s.textContent.replace(/\s+/g, " ").trim(), q = s.getBoundingClientRect(), cs = getComputedStyle(s);
      if (!t || !o || q.width < 1 || q.height < 1) continue;
      if (cs.fill.startsWith("url(") || (cs.stroke !== "none" && parseFloat(cs.strokeWidth) > 0)) return null;
      if (!visibleColor(cs.fill)) continue;
      const [x, y] = [q.left + __angeloScrollX(), q.top + __angeloScrollY()];
      const k = {
        tag: "text", x: Math.round(x), y: Math.round(y), w: Math.round(q.width), h: Math.round(q.height), pin: 1, text: t,
        font: { family: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(), size: fine(parseFloat(cs.fontSize) * m.a), weight: +cs.fontWeight, lh: fine(q.height), ls: __angeloLs(cs) * m.a || 0, color: cs.fill, align: "start" },
        lines: [{ t, x, y, w: q.width, h: q.height }], tx: Math.round(x), tw: Math.round(q.width),
      };
      if (o < 1) k.op = Math.round(o * 100) / 100;
      out.push(k);
    }
    return out;
  };
  const walk = (el, parent, clip = { l: -1e9, t: -1e9, r: 1e9, b: 1e9 }, op = 1) => {
    if (standIns.has(el)) {
      const q = el.getBoundingClientRect();
      pseudo(el, q, "::before", parent, op, clip);
      for (const c of kidsOf(el)) walk(c, parent, clip, op);
      pseudo(el, q, "::after", parent, op, clip);
      return;
    }
    if (skip.has(el)) {
      // a full-width band of the flow left out is closed up afterwards; a narrower block
      // leaves its space, an overlay never had any
      const q = el.getBoundingClientRect();
      const flow = !/^(fixed|absolute)$/.test(getComputedStyle(el).position);
      if (flow && q.width >= innerWidth * 0.6) holes.push([q.top + __angeloScrollY(), q.bottom + __angeloScrollY()]);
      return;
    }
    const cs = getComputedStyle(el);
    // a closed native select paints its chosen option as its own text, its options paint nothing
    const kids = el.tagName === "SELECT" ? [] : kidsOf(el);
    // a lazy image not loaded yet (below the fold, faded in on load) shows once scrolled to:
    // kept at full opacity, its URL taken from what it will load
    const lazy = el.tagName === "IMG" && !(el.complete && el.naturalWidth) && !!lazySrc(el);
    // a slider hides its inactive slides by sliding a sized fade mask off them (mask-position, not opacity):
    // a box whose mask window shows nothing at all is not on the page
    const maskGone = () => {
      const img = cs.maskImage || cs.webkitMaskImage;
      const size = cs.maskSize || cs.webkitMaskSize;
      const pos = cs.maskPosition || cs.webkitMaskPosition;
      const g = /^linear-gradient\(to (left|right),\s*(.*)\)$/.exec(img || "");
      const sz = /^([\d.]+)% 100%$/.exec(size || "");
      const px = /^([\d.]+)%/.exec(pos || "");
      if (!g || !sz || !px) return false;
      const alphas = [];
      for (const st of g[2].split(/,\s*(?![^(]*\))/)) {
        const c = /^rgba?\(([^)]*)\)$/.exec(st.trim());
        if (!c) return false; // stop positions, calc(): not read
        const v = c[1].split(",").map(Number);
        alphas.push(v.length > 3 ? v[3] : 1);
      }
      if (alphas.length < 2) return false;
      const big = +sz[1] / 100, start = ((big - 1) * +px[1]) / 100;
      for (let i = 0; i <= 20; i++) {
        const f = (start + i / 20) / big;
        const t = Math.min(1, Math.max(0, g[1] === "right" ? f : 1 - f)) * (alphas.length - 1);
        const k = Math.min(alphas.length - 2, Math.floor(t));
        if (alphas[k] + (alphas[k + 1] - alphas[k]) * (t - k) > 0.02) return false;
      }
      return true;
    };
    if (cs.display === "none" || cs.visibility === "hidden" || (+cs.opacity === 0 && !lazy) || maskGone()) {
      // guard: a large in-flow block with content, invisible only at this moment (a reveal the
      // settle missed), is reported, not silently lost
      const q = el.getBoundingClientRect();
      const big = cs.display !== "none" && cs.position !== "fixed" && q.width >= innerWidth * 0.3 && q.height >= 150;
      if (big && (el.querySelector("img, video, canvas, svg") || (el.textContent || "").trim().length > 40))
        unseen.push({ y: Math.round(q.top + __angeloScrollY()), h: Math.round(q.height), what: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") });
      return;
    }
    // effective opacity: ancestors multiply (the Figma rebuild is flat)
    if (!lazy) op *= +cs.opacity;
    let r = el.getBoundingClientRect();
    // a spinning icon's rect is that of its turned box (19 px for a 16 px loader, caught mid-turn)
    if (el.localName === "svg" && cs.animationName !== "none" && parseFloat(cs.width) > 0 && parseFloat(cs.height) > 0) {
      const [w, h] = [parseFloat(cs.width), parseFloat(cs.height)];
      r = new DOMRect(r.x + (r.width - w) / 2, r.y + (r.height - h) / 2, w, h);
    }
    // screen-reader-only content (sr-only: a clipped box 1 px wide or high, or clip: rect(1px…))
    // is not part of the render
    const srOnly = (cs, r) => cs.position === "absolute" && (cs.overflow === "hidden" || /inset\(.*99/.test(cs.clipPath)) && (Math.min(r.width, r.height) <= 2 || /^rect\(\s*[01]px,\s*[01]px/.test(cs.clip));
    if (srOnly(cs, r)) return;
    // a zero-size wrapper whose content overflows it (an absolute image in a 0-high <picture>)
    // is seen through, like display: contents
    const zero = r.width < 1 || r.height < 1;
    if (zero && cs.display !== "contents" && !(kids.length && cs.overflowX === "visible" && cs.overflowY === "visible")) return;
    // drop what the clipping ancestors hide: containers only when fully hidden, leaves under
    // half, except painted layers (gradient blobs, glows), cropped to what shows instead
    const tag0 = el.tagName.toLowerCase();
    const paint = !kids.length && !/^(img|svg|picture|video|canvas)$/.test(tag0) && ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    // media wider than its clip (a 3008 px hero centred in a 1440 px band) show cropped, never dropped
    // a leaf custom element (<vimeo-video>, a player) renders in its shadow tree, out of the walk:
    // shot like a canvas
    const opaque = tag0.includes("-") && el.getRootNode() === document && !el.children.length && !el.textContent.trim() && (!el.shadowRoot || !!el.shadowRoot.querySelector("video, canvas, img, svg, iframe"));
    const media = /^(img|video|canvas)$/.test(tag0) || opaque;
    let seen = cs.display === "contents" || zero ? 1 : cut(r, clip);
    // a row whose content overflows its box (a ticker of labels shifted under its window: the row
    // sits out of the window, its shown label in it) is judged by what it holds
    const holds = (e, d) => [...e.children].some((c) => cut(c.getBoundingClientRect(), clip) > 0 || (d && holds(c, d - 1)));
    if (seen === 0 && kids.length && cs.overflowX === "visible" && cs.overflowY === "visible" && holds(el, 2)) seen = 1;
    if (seen === 0 || (seen < 0.5 && !kids.length && !paint && !media)) return;
    // an ancestor clipping at the box's own edges hides its outer shadow
    const outer = clip;
    // a scroll lock on the body (a paywall or modal sets overflow: hidden) clips nothing in a
    // full-page capture: the whole document is shot
    if ((cs.overflowX !== "visible" || cs.overflowY !== "visible") && el !== document.body) {
      clip = { l: Math.max(clip.l, r.left), t: Math.max(clip.t, r.top), r: Math.min(clip.r, r.right), b: Math.min(clip.b, r.bottom) };
    }
    // clip-path: inset() clips like overflow, each edge moved in (or out, when negative);
    // tickers show one value of a stacked list through it
    const ins = /^inset\(([^)]*?)(?:\s+round[^)]*)?\)/.exec(cs.clipPath);
    if (ins) {
      const v = ins[1].trim().split(/\s+/);
      const [t, rt, bt, lt] = [v[0], v[1] ?? v[0], v[2] ?? v[0], v[3] ?? v[1] ?? v[0]];
      const len = (s, full) => (s.endsWith("%") ? (parseFloat(s) / 100) * full : parseFloat(s) || 0);
      clip = { l: Math.max(clip.l, r.left + len(lt, r.width)), t: Math.max(clip.t, r.top + len(t, r.height)), r: Math.min(clip.r, r.right - len(rt, r.width)), b: Math.min(clip.b, r.bottom - len(bt, r.height)) };
    }
    // a mask paints nothing outside the border box: it clips the content like overflow
    if ([cs.maskImage, cs.webkitMaskImage].some((m) => m && m !== "none")) {
      clip = { l: Math.max(clip.l, r.left), t: Math.max(clip.t, r.top), r: Math.min(clip.r, r.right), b: Math.min(clip.b, r.bottom) };
    }
    const tag = el.tagName.toLowerCase();
    // a paragraph of inline pieces (text, links, sup, spans) read as one text with styled runs:
    // read piece by piece, a span starting mid-line loses where it starts; hidden pieces (a
    // display: none fallback copy, an sr-only twin) are skipped, inline-block pieces (nowrap
    // groups) are text too, a <br> is a line the lines already carry
    // an inline chip (code, kbd, tag): painted, on one line, no taller than 1.5 line heights of its
    // paragraph — its text is a run, its fill a layer under the text
    const painted = (s) => visibleColor(s.backgroundColor) || s.backgroundImage !== "none" || ["Top", "Right", "Bottom", "Left"].some((k) => visibleColor(s[`border${k}Color`]) && px(s[`border${k}Width`]));
    const chip = (c, e) => {
      const rs = c.getClientRects(), ps = getComputedStyle(e);
      return rs.length === 1 && rs[0].height <= 1.5 * (ps.lineHeight === "normal" ? 1.2 * px(ps.fontSize) : px(ps.lineHeight));
    };
    const plain = (e) => [...e.children].every((c) => {
      const s = getComputedStyle(c);
      if (s.display === "none" || srOnly(s, c.getBoundingClientRect()) || c.tagName === "BR") return true;
      if (/^(img|svg|video|canvas|input|button|select|textarea|picture|iframe)$/i.test(c.tagName) || !plain(c)) return false;
      return painted(s) ? /^inline(-block|-flex)?$/.test(s.display) && chip(c, e) : /^inline(-block)?$/.test(s.display);
    });
    let pieces = null;
    const breaks = new Map();
    // a hard break kept through whitespace collapsing: a marker until the text is collapsed
    const brk = (n) => "\0".repeat(breaks.get(n) || 0);
    const hard = (t) => t.replace(/ ?(\0+) ?/g, (m, z) => "\n".repeat(z.length));
    // a list whose inline-block items each sit on their own line, or in CSS columns (gov.uk footer),
    // is not a paragraph: one text per item
    const listed = /^(ul|ol)$/.test(tag) && el.children.length > 1 && (/^\d/.test(cs.columnCount) || new Set([...el.children].map((c) => Math.round(c.getBoundingClientRect().top))).size === el.children.length);
    // an inline-block whose parent is no paragraph (a svg logo beside it, gov.uk licence text with
    // its link) is read as one itself: nobody else would
    const orphan = cs.display === "inline-block" && el.parentElement && !plain(el.parentElement);
    if (el.children.length && (!/^inline\b/.test(cs.display) || orphan) && !listed && plain(el)) {
      // a <br> between two pieces is a hard break: counted on the piece after it (two = a blank line)
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: (n) => (n.nodeType === 3 || n.tagName === "BR" ? 1 : 3) });
      const ns = [];
      let brs = 0;
      const hid = (e) => { for (; e !== el; e = e.parentElement) if (srOnly(getComputedStyle(e), e.getBoundingClientRect())) return true; return false; };
      // a piece faded to opacity 0 (a description revealed on hover) is not painted: left out
      let faded = false;
      for (let n; (n = tw.nextNode()); ) {
        if (n.nodeType === 1) { if (ns.length && n.checkVisibility()) brs++; continue; }
        if (!n.parentElement.checkVisibility() || hid(n.parentElement)) continue;
        if (brs && n.textContent.trim()) { breaks.set(n, brs); brs = 0; }
        if (n.textContent.trim() && !n.parentElement.checkVisibility({ opacityProperty: true })) faded = true;
        else ns.push(n);
      }
      if (ns.filter((n) => n.textContent.trim()).length > 1 || (faded && ns.some((n) => n.textContent.trim()))) pieces = ns;
    }
    // a text slotted into a screen-reader-only wrapper of the shadow tree (porsche <p-link>: the
    // arrow button's label, a 1 px span) is not painted
    const slotHidden = (n) => { for (let e = n.assignedSlot?.parentElement; e; e = e.parentElement) if (srOnly(getComputedStyle(e), e.getBoundingClientRect())) return true; return false; };
    // collapsed like CSS white-space: a no-break space (U+00A0, U+202F) is kept, it binds words on a line
    let ownText = pieces ? hard(pieces.map((n) => brk(n) + n.textContent).join("").replace(/[^\S\u00a0\u202f]+/g, " ").trim()) : [...el.childNodes]
      .filter((n) => n.nodeType === 3 && n.textContent.trim() && !slotHidden(n))
      .map((n) => n.textContent.replace(/[^\S\u00a0\u202f]+/g, " ").trim())
      .join(" ");
    // an icon-font glyph: an empty element whose ::before / ::after content is one private-use char
    // (oatly <i class="Icon …">, font oatly-icons) is drawn as text in that font
    let glyphCs = null;
    if (!ownText && !el.firstChild) {
      for (const w of ["::before", "::after"]) {
        const ps = getComputedStyle(el, w);
        const m = ps.display !== "none" && /^"([\ue000-\uf8ff])"$/.exec(ps.content);
        if (m) { ownText = m[1]; glyphCs = ps; break; }
      }
    }
    // the value of a text input is painted by the browser, not a text node (oatly filter comboboxes:
    // "Stacked", "Austria"); a password stays out
    // nor one reduced to a pixel (a combobox's parked input: a stray "0" once its text overflows)
    if (!ownText && tag === "input" && r.width > 1 && r.height > 1 && /^(text|search|email|url|tel|number|submit|button)?$/.test(el.getAttribute("type") || "") && el.value) ownText = el.value.replace(/\s+/g, " ").trim();
    if (tag === "select") ownText = (el.selectedOptions[0]?.textContent || "").replace(/\s+/g, " ").trim();
    // an empty field paints its hint, in the style of ::placeholder (a password's hint is not a secret)
    // an empty date field paints the browser's own hint, in its shadow tree: rebuilt from the locale's field order
    if (!ownText && tag === "input" && el.type === "date" && !el.value && r.width > 1 && r.height > 1) {
      const lang = (navigator.language || "en").slice(0, 2);
      const hint = { fr: { day: "jj", month: "mm", year: "aaaa" }, de: { day: "tt", month: "mm", year: "jjjj" }, es: { day: "dd", month: "mm", year: "aaaa" }, it: { day: "gg", month: "mm", year: "aaaa" } }[lang] || { day: "dd", month: "mm", year: "yyyy" };
      ownText = new Intl.DateTimeFormat(navigator.language, { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(2000, 0, 2)).map((p) => hint[p.type] || p.value).join("");
    }
    if (!ownText && (tag === "textarea" || tag === "input") && !el.value && el.placeholder) { ownText = el.placeholder.replace(/\s+/g, " ").trim(); glyphCs = getComputedStyle(el, "::placeholder"); }
    // a web component paints its own box in its shadow tree (porsche <p-tag>: a grey pill around
    // a slotted label): the wrapper there that covers the host stands in for the host's paint
    const wrap = el.shadowRoot && !painted(cs) && [...el.shadowRoot.querySelectorAll("*")].find((e) => {
      const q = e.getBoundingClientRect(), s = getComputedStyle(e);
      return Math.abs(q.left - r.left) < 2 && Math.abs(q.top - r.top) < 2 && Math.abs(q.width - r.width) < 2 && Math.abs(q.height - r.height) < 2 && (painted(s) || (s.backdropFilter && s.backdropFilter !== "none") || (px(s.borderTopLeftRadius) > 0 && (s.overflowX !== "visible" || s.overflowY !== "visible")));
    });
    if (wrap) standIns.add(wrap);
    const pcs = wrap ? getComputedStyle(wrap) : cs;
    // display: contents has no box: its background and image are never painted (the computed style still reads them)
    const bg = cs.display === "contents" ? "rgba(0, 0, 0, 0)" : pcs.backgroundColor;
    // background-clip: text paints the gradient inside the glyphs, never as a box
    const clipText = [cs.backgroundClip, cs.webkitBackgroundClip].some((v) => /\btext\b/.test(v || ""));
    // every layer sized 0 on one axis paints nothing (a hover underline parked at 0px 3px, grown on hover)
    const zeroSize = pcs.backgroundSize.split(",").every((v) => v.trim().split(/\s+/).some((d) => /^0(px|%)?$/.test(d)));
    const bgImg = pcs.backgroundImage !== "none" && !clipText && !zeroSize && cs.display !== "contents" ? pcs.backgroundImage : null;
    // gradient mask + backdrop filter (frosted / darkened scrims over images)
    const mask = [cs.maskImage, cs.webkitMaskImage].find((m) => m && /gradient\(/.test(m));
    const bdf = pcs.backdropFilter && pcs.backdropFilter !== "none" ? pcs.backdropFilter : null;
    // per side [top, right, bottom, left]; `sides` only when they differ (rules, underlines)
    const sides = ["Top", "Right", "Bottom", "Left"].map((k) => (visibleColor(pcs[`border${k}Color`]) ? px(pcs[`border${k}Width`]) : 0));
    const lead = sides.findIndex((w) => w);
    let border = lead < 0 ? null : { w: sides[lead], c: pcs[`border${["Top", "Right", "Bottom", "Left"][lead]}Color`] };
    // a stroke has one paint: sides of another colour than most (border-top: 6px solid red on a black card) become inner shadows
    const sideNames = ["Top", "Right", "Bottom", "Left"];
    const sideColors = sideNames.map((k, i) => (sides[i] ? pcs[`border${k}Color`] : null));
    const colorCount = (c) => sideColors.filter((x) => x === c).length;
    const mainColor = sideColors.filter(Boolean).sort((a, b) => colorCount(b) - colorCount(a))[0];
    const oddSides = [];
    if (sideColors.some((c) => c && c !== mainColor)) {
      sideColors.forEach((c, i) => { if (c && c !== mainColor) { oddSides.push({ c, x: i === 3 ? sides[i] : i === 1 ? -sides[i] : 0, y: i === 0 ? sides[i] : i === 2 ? -sides[i] : 0, blur: 0, spread: 0, inset: true }); sides[i] = 0; } });
      border = { w: Math.max(...sides), c: mainColor };
    }
    if (border && sides.some((w) => w !== border.w)) border.sides = sides;
    // box-shadow layers (commas inside rgba() kept): color x y blur spread [inset]
    const layers = pcs.boxShadow === "none" ? [] : pcs.boxShadow.split(/,(?![^(]*\))/).map((l) => {
      const m = /(rgba?\([^)]*\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px(?:\s+(-?[\d.]+)px)?/.exec(l);
      return m && { c: m[1], x: +m[2], y: +m[3], blur: +m[4], spread: +(m[5] || 0), inset: /\binset\b/.test(l) };
    }).filter((l) => l && visibleColor(l.c));
    layers.push(...oddSides);
    // a flat inset ring (0 0 0 Npx inset) paints a border inside the box: kept as one
    const ring = layers.find((l) => l.inset && !l.x && !l.y && !l.blur && l.spread > 0);
    if (!border && ring) border = { w: ring.spread, c: ring.c };
    // outer box-shadows: the first, the others in `more`
    // (0 0 0 0 paints nothing: Tailwind's ring stack leaves it on every input)
    const outs = layers.filter((l) => !l.inset && (l.x || l.y || l.blur || l.spread));
    const sh = outs[0];
    // cut by a clip around the box; a 1 px ring in a 1 px margin (m-px) just fits, it is not
    const room = sh ? Math.min(1, sh.blur + sh.spread - 0.5) : 1;
    const shadowCut = outer.l >= r.left - room && outer.t >= r.top - room && outer.r <= r.right + room && outer.b <= r.bottom + room;
    // inner shadows (a selected card's accent line, inset 0 -4px 0 red) follow the outer ones; the ring taken as a border is not one
    const inners = layers.filter((l) => l.inset && (l.x || l.y || l.blur || l.spread) && !(ring === l && border?.c === l.c && border?.w === l.spread));
    const shadowLayers = [...(sh && !shadowCut ? outs : []), ...inners].map((l) => ({ c: l.c, x: l.x, y: l.y, blur: l.blur, spread: l.spread, ...(l.inset ? { inset: 1 } : {}) }));
    const shadow = shadowLayers.length ? { ...shadowLayers[0], ...(shadowLayers.length > 1 ? { more: shadowLayers.slice(1) } : {}) } : null;
    const img = tag === "img" ? el.currentSrc || lazySrc(el) : tag === "svg" ? "svg" : tag === "picture" ? pictureSrc(el) : null;
    // the visible part of a clipped leaf (Figma frames here do not clip): images and painted layers
    let crop = null;
    // an image fitted inside its box (a logo of another ratio): the box shrinks to the painted part,
    // or the build fills it edge to edge and crops the logo; fitted in the whole box, before any clip
    // (fitted in the visible part, an image cut by its card shrinks to that part's height)
    const fit = tag === "img" && /contain|scale-down/.test(cs.objectFit) && el.naturalWidth && el.naturalHeight;
    if (fit) {
      let k = Math.min(r.width / el.naturalWidth, r.height / el.naturalHeight);
      if (cs.objectFit === "scale-down") k = Math.min(k, 1);
      const [iw, ih] = [el.naturalWidth * k, el.naturalHeight * k];
      const [px, py] = cs.objectPosition.split(" ").map((v) => (v.endsWith("%") ? parseFloat(v) / 100 : 0.5));
      if (iw < r.width - 1 || ih < r.height - 1) {
        const [left, top] = [r.left + (r.width - iw) * px, r.top + (r.height - ih) * py];
        r = { left, top, width: iw, height: ih, right: left + iw, bottom: top + ih };
      }
    }
    // an image covering its box off centre (object-position left top), or overflowing the clip
    // around it (a zoom at rest, scale(1.1) inside an overflow-hidden wrapper): where the whole image
    // sits, a crop (Figma's FILL covers the visible part from the centre, without the zoom)
    let cover = null, sits = null;
    if (tag === "img" && cs.objectFit === "cover" && el.naturalWidth && el.naturalHeight) {
      const k = Math.max(r.width / el.naturalWidth, r.height / el.naturalHeight);
      const [iw, ih] = [el.naturalWidth * k, el.naturalHeight * k];
      const [px, py] = cs.objectPosition.split(" ").map((v) => (v.endsWith("%") ? parseFloat(v) / 100 : /^0(px)?$/.test(v) ? 0 : 0.5));
      const over = seen < 1 && cs.transform !== "none" && (r.left < clip.l - 1 || r.top < clip.t - 1 || r.right > clip.r + 1 || r.bottom > clip.b + 1);
      sits = { left: r.left + (r.width - iw) * px, top: r.top + (r.height - ih) * py, width: iw, height: ih };
      if ((iw > r.width + 1 && Math.abs(px - 0.5) > 0.01) || (ih > r.height + 1 && Math.abs(py - 0.5) > 0.01) || over) cover = sits;
    }
    if (cover) crop = [Math.round(cover.left - r.left), Math.round(cover.top - r.top), Math.round(cover.width), Math.round(cover.height)];
    if (seen < 1 && (media || (!kids.length && !ownText && tag !== "svg"))) {
      const l = Math.max(r.left, clip.l), t = Math.max(r.top, clip.t);
      // an image stretched to its box (a logo half out of a marquee): where the whole box sits,
      // from the visible part, so the image is cut there, not squeezed into what shows
      // (a centred cover image cut by its clip, a terrain strip whose top only shows: where it is painted)
      const whole = cover || sits || ((tag === "img" && (cs.objectFit === "fill" || fit)) ? r : null);
      if (whole) crop = [Math.round(whole.left - l), Math.round(whole.top - t), Math.round(whole.width), Math.round(whole.height)];
      r = { left: l, top: t, width: Math.min(r.right, clip.r) - l, height: Math.min(r.bottom, clip.b) - t };
    }
    const id = boxes.length;
    const b = {
      id,
      p: parent,
      tag,
      x: Math.round(r.left + __angeloScrollX()),
      y: Math.round(r.top + __angeloScrollY()),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
    if (visibleColor(bg)) b.bg = __angeloFilterColor(el, bg);
    if (bgImg) b.bgImg = clipBg(bgImg);
    // a texture (grain, noise): blended with what is under it, tiled at its background size
    if (cs.mixBlendMode !== "normal") b.blend = cs.mixBlendMode;
    const tile = /^([\d.]+)px/.exec(cs.backgroundSize);
    if (bgImg && tile && !/no-repeat/.test(cs.backgroundRepeat)) {
      b.tile = +tile[1];
      // a rule drawn by a repeated gradient (dotted line): its thickness and where it sits in the box
      const th = /^[\d.]+px\s+([\d.]+)px/.exec(cs.backgroundSize);
      if (th) [b.tileH, b.tileY, b.tileX] = [+th[1], cs.backgroundPositionY, cs.backgroundPositionX];
    }
    if (crop) b.crop = crop;
    if (mask) {
      b.mask = mask.slice(0, 600);
      // how several mask layers combine (intersect: two fades both apply), and a sized mask, which tiles
      const comp = cs.maskComposite || cs.webkitMaskComposite;
      if (comp && !/^(add|source-over)\b/.test(comp)) b.maskComp = comp.split(",")[0].trim();
      if (cs.maskSize && !/^auto\b/.test(cs.maskSize)) b.maskSize = cs.maskSize;
    }
    // (porsche <p-icon>: the mask sits on the img of its shadow tree, the stand-in `pcs`)
    // an icon drawn by an image mask over a flat fill (a span, no content): the mask's url, made
    // an svg in its fill colour by __angeloMaskIcons (else a filled square)
    // quoted urls may hold escaped quotes (an inline svg data url: <svg display=\"block\" …>)
    const maskUrl = [pcs.maskImage, pcs.webkitMaskImage, cs.maskImage, cs.webkitMaskImage].map((m) => /url\((?:"((?:[^"\\]|\\.)+)"|'((?:[^'\\]|\\.)+)'|([^)]+))\)/.exec(m || "")?.slice(1).find(Boolean)?.replace(/\\(.)/g, "$1")).find(Boolean);
    if (maskUrl && visibleColor(bg) && (!kids.length || (wrap && kids.length === 1 && kids[0] === wrap && !kidsOf(wrap).length)) && !ownText) b.maskIcon = new URL(maskUrl, location.href).href;
    if (bdf) b.bdf = bdf;
    if (border) b.border = border;
    if (shadow) b.shadow = shadow;
    corners(b, pcs);
    // overflow clipping: what its content paints past its edges never shows
    if (cs.overflowX !== "visible" || cs.overflowY !== "visible" || (wrap && (pcs.overflowX !== "visible" || pcs.overflowY !== "visible"))) b.clip = 1;
    if (img) b.img = img;
    // a native checkbox / radio is painted by the browser, whatever its CSS background: drawn as an svg
    if (tag === "input" && /^(checkbox|radio)$/.test(el.type) && cs.appearance !== "none" && r.width > 1 && r.height > 1) {
      const w = r.width, h = r.height, tint = cs.accentColor === "auto" ? "rgb(0, 117, 255)" : cs.accentColor;
      const radio = el.type === "radio";
      const shape = (extra) => (radio ? `<circle cx="${w / 2}" cy="${h / 2}" r="${w / 2 - 0.5}" ${extra}/>` : `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="2" ${extra}/>`);
      const mark = radio ? `<circle cx="${w / 2}" cy="${h / 2}" r="${w / 4}" fill="#fff"/>` : `<path d="M${w * 0.23} ${h * 0.52}L${w * 0.42} ${h * 0.71}L${w * 0.77} ${h * 0.31}" fill="none" stroke="#fff" stroke-width="2"/>`;
      b.svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${el.checked ? shape(`fill="${tint}" stroke="${tint}"`) + mark : shape(`fill="#fff" stroke="#767676"`)}</svg>`;
      delete b.bg;
    }
    // contract flags for web-compare: an <img> not decoded when read (a box at risk of staying
    // empty), a big box still animating (its reference pixels may be caught mid-reveal)
    if (tag === "img" && !(el.complete && el.naturalWidth)) b.dec = 0;
    if ((img || b.w * b.h >= 12000) && el.getAnimations().some((a) => a.playState === "running")) b.anim = 1;
    // canvas (2D / WebGL) and video have no markup: their pixels are shot apart, page hidden (__angeloIsolate)
    if (tag === "canvas" || tag === "video" || opaque) {
      [b.canvas, b.py] = [1, b.y];
      // its id: a blank shot is retaken on this element alone (web-capture)
      el.setAttribute("data-angelo-media", b.id);
      // the player's still, when the frame never paints
      const poster = el.getAttribute("poster");
      if (poster) b.poster = new URL(poster, location.href).href;
    }
    // an iframe (ad, embed) has no readable DOM: shot in view apart (__angeloFrameShots)
    if (tag === "iframe" && b.w * b.h >= 2500) el.setAttribute("data-angelo-frame", b.id);
    if (b.w * b.h >= 12000) globalThis.__angeloEls?.set(b.id, el);
    // filter: blur → a layer blur, scaled by the transform (the blur is drawn before it)
    const fb = /blur\(([\d.]+)px\)/.exec(cs.filter);
    // filter on an image: brightness / saturate / contrast → Figma image filters (-1…1; brightness
    // in stops, log2, Figma's exposure scale)
    // (a filter on a wrapper reaches the image too: a group of avatars greyed from its avatars)
    let filters = "";
    if (b.img || bgImg) for (let e = el; e && e !== document.body; e = e.parentElement) { const f = getComputedStyle(e).filter; if (f && f !== "none") filters += " " + f; }
    if (filters) {
      const v = (k) => { const m = new RegExp(k + "\\(([\\d.]+)(%?)\\)").exec(filters); return m ? +m[1] / (m[2] ? 100 : 1) : 1; };
      const cl = (x) => Math.round(Math.max(-1, Math.min(1, x)) * 100) / 100;
      // (grayscale(g) takes the same share of the saturation away; v() reads 1 when absent)
      const gray = /grayscale\(/.test(filters) ? v("grayscale") : 0;
      const fx = { exposure: cl(Math.log2(v("brightness") || 0.01)), saturation: cl(v("saturate") * (1 - gray) - 1), contrast: cl(v("contrast") - 1) };
      // brightness(0) [invert(1)]: a logo flattened to black or white (an svg is recoloured, Figma has no filter for a vector)
      if (v("brightness") < 0.05 && /brightness\(/.test(filters)) fx.mono = /invert\((1|100%)\)/.test(filters) ? "#ffffff" : "#000000";
      // invert(x) without brightness(0): each paint of an svg inverted, before the brightness (chloe's black logo shown
      // white by invert(1) brightness(2)); a raster image has no Figma filter for it
      else if (/invert\(/.test(filters)) fx.invert = cl(v("invert"));
      for (const k in fx) if (!fx[k]) delete fx[k];
      if (Object.keys(fx).length) b.fx = fx;
    }
    if (fb && +fb[1]) b.fblur = Math.round(+fb[1] * Math.abs(new DOMMatrix(cs.transform === "none" ? undefined : cs.transform).a));
    // out of the flow: drawn over its parent, it takes none of its space
    if (/^(absolute|fixed)$/.test(cs.position)) b.pin = 1;
    // stacking: a positioned box with a z-index paints over (or under) its siblings out of DOM
    // order, and so does a flex / grid item, static or not
    const pd = el.parentElement && getComputedStyle(el.parentElement).display;
    const stacks = cs.position !== "static" || /flex|grid/.test(pd);
    if (stacks && parseInt(cs.zIndex)) b.z = parseInt(cs.zIndex);
    // a stacking context of its own (z-index 0, transform, opacity, filter…) keeps the z-index
    // of its content inside it: a z 3 layer in a z 0 background never paints over its cousins
    else if ((stacks && cs.zIndex !== "auto") || /^(fixed|sticky)$/.test(cs.position) || cs.transform !== "none" || +cs.opacity < 1 ||
      cs.filter !== "none" || cs.isolation === "isolate" || cs.mixBlendMode !== "normal" || (cs.maskImage || "none") !== "none" ||
      cs.clipPath !== "none" || /transform|opacity|filter/.test(cs.willChange) || /paint|layout|strict|content/.test(cs.contain)) b.sc = 1;
    if (names.has(el)) b.block = names.get(el);
    if (op < 1) b.op = Math.round(op * 100) / 100;
    const hint = nameHint(el);
    if (hint) b.hint = hint;
    // what a design system says the element is: its name, tone and size, the component library's own vocabulary
    const slot = el.getAttribute("data-slot");
    if (slot) {
      b.slot = slot;
      const [variant, size] = [el.getAttribute("data-variant"), el.getAttribute("data-size")];
      if (variant) b.slotVariant = variant;
      if (size) b.slotSize = size;
    }
    // what the page itself declares a widget to be (a switch, an alert, a tab…) and its on/off state:
    // the proof the component grammar needs, no shape guessing
    const role = el.getAttribute("role");
    if (role) b.role = role;
    if (tag === "input" && /^(checkbox|radio)$/.test(el.type)) b.role = b.role || el.type;
    const on = ["aria-checked", "aria-pressed", "aria-selected"].map((a) => el.getAttribute(a)).find((v) => v === "true" || v === "false");
    if (on) b.on = on === "true";
    else if (tag === "input" && /^(checkbox|radio)$/.test(el.type)) b.on = el.checked;
    const svgTexts = [];
    if (tag === "svg") {
      // what the link or button holding the drawing tells a screen reader: the only name a bare icon has
      const host = el.closest("a,button,[role=button]");
      const said = host && (host.getAttribute("aria-label") || host.getAttribute("title"));
      if (said) b.said = said.trim().slice(0, 40);
      // sprite <use href="#id"> → the referenced symbol's own markup, kept as vectors
      let svg = el.outerHTML;
      const use = el.querySelector("use");
      const ref = use && (use.getAttribute("href") || use.getAttribute("xlink:href"));
      // (a <use> of an element of the svg itself is part of its drawing, not a sprite: lottie masks)
      let sym = ref && ref.startsWith("#") ? document.getElementById(ref.slice(1)) : ref && ref.includes("#") ? spriteSymbol(ref) : null;
      if (sym && el.contains(sym)) sym = null;
      // a <use> beside the svg's own shapes is one part of its drawing, not a sprite icon: the symbol
      // would replace the whole svg (a header drawn as one svg reduced to its one <use>)
      const inDefs = "defs,clipPath,mask,symbol,pattern,marker";
      if (sym && [...el.querySelectorAll("path,circle,rect,ellipse,line,polyline,polygon,text,image")].some((n) => !n.closest(inDefs))) sym = null;
      if (sym) {
        const inner = sym.querySelector("svg");
        // the symbol's shapes inherit the <use> svg's paint (fill-current: the text color)
        // the symbol's own paint wins over the inherited one (an outline icon: <symbol fill="none">, drawn filled otherwise)
        const own = [...sym.attributes].filter((a) => /^(fill|stroke|stroke-.*|opacity|fill-rule|clip-rule)$/.test(a.name) && !/currentColor/i.test(a.value)).map((a) => ` ${a.name}="${a.value}"`).join("");
        const fill = (sym.hasAttribute("fill") && !/currentColor/i.test(sym.getAttribute("fill"))) || !cs.fill || cs.fill.startsWith("url(") ? "" : ` fill="${cs.fill}"`;
        // (an svg nested in the symbol too: without its own paint it would come out black)
        svg = inner ? (inner.hasAttribute("fill") ? inner.outerHTML : inner.outerHTML.replace("<svg", `<svg${fill}`)) : `<svg xmlns="http://www.w3.org/2000/svg"${fill}${own} viewBox="${sym.getAttribute("viewBox") || el.getAttribute("viewBox") || `0 0 ${r.width} ${r.height}`}">${sym.innerHTML}</svg>`;
      }
      // fill / stroke set by the page CSS (classes, inherited) do not travel with the markup:
      // the computed paint of each shape is written on it, in the live tree before serialising
      if (!sym) {
        const clone = el.cloneNode(true);
        const live = [el, ...el.querySelectorAll("*")], copy = [clone, ...clone.querySelectorAll("*")];
        live.forEach((n, i) => {
          if (!/^(svg|path|circle|rect|ellipse|line|polyline|polygon|g)$/.test(n.tagName.toLowerCase())) return;
          const ns = getComputedStyle(n);
          // geometry and transform set through CSS (style="x:…; width:…", transform: translateY()) are
          // ignored by Figma's svg import: written as attributes (oatly bar chart: bars had no size)
          const tg = n.tagName.toLowerCase();
          if (tg === "rect") for (const k of ["x", "y", "width", "height"]) {
            const v = parseFloat(ns[k]);
            if (!copy[i].hasAttribute(k) && Number.isFinite(v) && /px$/.test(ns[k])) copy[i].setAttribute(k, String(v));
          }
          if (tg !== "svg" && ns.transform !== "none" && !copy[i].hasAttribute("transform")) copy[i].setAttribute("transform", ns.transform);
          copy[i].setAttribute("fill", ns.fill.startsWith("url(") ? copy[i].getAttribute("fill") || ns.fill : ns.fill);
          if (tg !== "svg" && +ns.opacity < 1 && !copy[i].hasAttribute("opacity")) copy[i].setAttribute("opacity", ns.opacity);
          if (ns.stroke !== "none") {
            copy[i].setAttribute("stroke", ns.stroke);
            // the width, caps and joins set by CSS travel with it (a filled glyph stroked at 0 stays thin)
            copy[i].setAttribute("stroke-width", String(parseFloat(ns.strokeWidth)));
            copy[i].setAttribute("stroke-linecap", ns.strokeLinecap);
            copy[i].setAttribute("stroke-linejoin", ns.strokeLinejoin);
            // a dash set by CSS too (a dashed outline drawn as a solid line otherwise)
            if (ns.strokeDasharray && ns.strokeDasharray !== "none") copy[i].setAttribute("stroke-dasharray", ns.strokeDasharray.replace(/px/g, ""));
          }
        });
        // shapes switched off (lottie keeps every layer, `display: none` outside its frame: thousands of
        // them) paint nothing: dropped unless something is referenced inside them or they sit in defs
        for (let i = copy.length - 1; i > 0; i--) {
          if (live[i].style?.display === "none" && !copy[i].querySelector("[id]") && !copy[i].id && !copy[i].closest("defs,clipPath,mask,symbol,pattern,marker")) copy[i].remove();
        }
        // a layer held at opacity 0 by the page CSS (a hover outline over the fills) paints nothing
        // either, unless the drawing refers to something inside it
        const source = el.outerHTML;
        const referred = (n) => [n, ...n.querySelectorAll("[id]")].some((e) => e.id && source.includes(`#${e.id}`));
        for (let i = copy.length - 1; i > 0; i--) {
          if (getComputedStyle(live[i]).opacity === "0" && !copy[i].closest(inDefs) && !referred(live[i])) copy[i].remove();
        }
        for (let i = copy.length - 1; i > 0; i--) {
          if (!clone.contains(copy[i])) continue;
          const tn = live[i].tagName.toLowerCase();
          // an html overlay in the drawing (link hit areas): Figma's svg import has no use for it
          if (tn === "foreignobject") copy[i].remove();
          // a symbol of another svg: drawn in place, placed and scaled as the <use> does
          else if (tn === "use") {
            const ref = live[i].getAttribute("href") || live[i].getAttribute("xlink:href") || "";
            const target = ref.startsWith("#") ? document.getElementById(ref.slice(1)) : ref.includes("#") ? spriteSymbol(ref) : null;
            if (!target || el.contains(target)) continue;
            const num = (k) => parseFloat(live[i].getAttribute(k)) || 0;
            const vb = (target.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
            const [sx, sy] = vb.length === 4 && num("width") && num("height") ? [num("width") / vb[2], num("height") / vb[3]] : [1, 1];
            const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
            g.setAttribute("transform", `translate(${num("x") - (vb[0] || 0) * sx} ${num("y") - (vb[1] || 0) * sy}) scale(${sx} ${sy})`);
            g.setAttribute("fill", getComputedStyle(live[i]).fill);
            g.innerHTML = target.innerHTML;
            copy[i].replaceWith(g);
          }
          // a label drawn upright by <text>: a real text box over the svg, in the page's font and at
          // its rendered size (Figma's import knows neither the web font nor the page's CSS)
          else if (tn === "text" && !live[i].closest(inDefs)) {
            const boxesOf = svgTextBoxes(live[i], el);
            if (boxesOf) { svgTexts.unshift(...boxesOf); copy[i].remove(); }
          }
        }
        svg = clone.outerHTML;
        // a mask built on an svg filter (inverted luminance): Figma's import drops the filter, the mask
        // turns black and hides what it masks (teenage store bag). Mask removed, the drawing stays whole
        for (const m of el.querySelectorAll("mask[id]")) {
          if (![m, ...m.querySelectorAll("*")].some((n) => getComputedStyle(n).filter !== "none")) continue;
          const id = m.id.replace(/[^\w-]/g, "\\$&");
          svg = svg.replace(new RegExp(`\\smask=["']url\\(["']?#${id}["']?\\)["']`, "g"), "").replace(new RegExp(`mask\\s*:\\s*url\\(["']?#${id}["']?\\)\\s*;?`, "g"), "");
          svg = svg.replace(new RegExp(`<mask\\b[^>]*\\sid=["']${id}["'][^>]*>[\\s\\S]*?</mask>`), "");
        }
      }
      // currentColor resolves to the svg's computed color; its alpha (disabled states) goes to
      // the node's opacity, Figma's svg import drops rgba alpha
      const ca = /rgba\(([^,]+),([^,]+),([^,]+),\s*([\d.]+)\)/.exec(cs.color);
      if (ca && /currentColor/.test(svg)) {
        svg = svg.replace(/currentColor/g, `rgb(${ca[1]},${ca[2]},${ca[3]})`);
        b.op = Math.round(op * +ca[4] * 100) / 100;
      } else svg = svg.replace(/currentColor/g, cs.color);
      if (!/xmlns=/.test(svg)) svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
      // CSS custom properties resolve here (Figma's import paints them black); the root gets the
      // box size (percent shapes) and the text font (inherited from the page, not the svg)
      svg = svg.replace(/var\((--[\w-]+)(?:,\s*([^)]*))?\)/g, (m, k, d) => cs.getPropertyValue(k).trim() || (d || "").trim() || m);
      // a viewBox of another ratio than its box: the browser fits it whole, Figma's resize would stretch
      // it (a 24×24 chevron in a 35×19 box drawn wide). The viewBox grows to the box's ratio, same drawing
      const par = (el.getAttribute("preserveAspectRatio") || "xMidYMid meet").trim();
      const vb0 = (el.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
      // a quarter turn (see below): the drawing fills the box on its side, the fit is made against the box turned back
      const turn = ((Math.round(__angeloTurn(el)) % 360) + 360) % 360;
      const side = turn % 180 === 90, rw = side ? r.height : r.width, rh = side ? r.width : r.height;
      if (!sym && vb0.length === 4 && vb0.every(Number.isFinite) && vb0[2] > 0 && vb0[3] > 0 && r.width > 0 && r.height > 0 && par !== "none" && !/slice/.test(par) && Math.abs(vb0[2] / vb0[3] / (rw / rh) - 1) > 0.02) {
        const k = Math.max(vb0[2] / rw, vb0[3] / rh);
        const vw = rw * k, vh = rh * k;
        const at = (a) => (a === "Min" ? 0 : a === "Max" ? 1 : 0.5);
        const al = /x(Min|Mid|Max)Y(Min|Mid|Max)/.exec(par) || [0, "Mid", "Mid"];
        const box = `${vb0[0] - (vw - vb0[2]) * at(al[1])} ${vb0[1] - (vh - vb0[3]) * at(al[2])} ${vw} ${vh}`;
        const root = /^<svg[^>]*>/.exec(svg)[0];
        const next = root.replace(/\s(width|height|viewBox)=("[^"]*"|'[^']*')/g, "").replace("<svg", `<svg width="${r.width}" height="${r.height}" viewBox="${box}"`);
        svg = next + svg.slice(root.length);
      }
      // a size in % (circle's card icons: width="100%" height="40") is read by Figma as px: 100 wide, the
      // drawing squashed once resized to its 40×40 box. The root takes the box's px size
      svg = svg.replace(/^<svg[^>]*>/, (root) => root.replace(/\s(width|height)=("[^"]*%"|'[^']*%')/g, (m, k) => ` ${k}="${Math.round(k === "width" ? r.width : r.height)}"`));
      const head = /^<svg[^>]*>/.exec(svg)[0];
      const add = [];
      if (!/\swidth=/.test(head)) add.push(`width="${Math.round(r.width)}"`);
      if (!/\sheight=/.test(head)) add.push(`height="${Math.round(r.height)}"`);
      if (/<text[\s>]/.test(svg)) add.push(`font-family="${cs.fontFamily.replace(/"/g, "'")}" font-size="${px(cs.fontSize)}" font-weight="${cs.fontWeight}"`);
      if (add.length) svg = svg.replace("<svg", `<svg ${add.join(" ")}`);
      // a quarter turn from the svg or above it (a rotate-90 button): in the drawing, since a layer of an
      // instance can't be rotated; data-rot tells the icon pass which way it was turned
      if (turn && turn % 90 === 0) {
        const vb = /\sviewBox="([^"]*)"/.exec(head)?.[1].trim().split(/[\s,]+/).map(Number);
        const [cx, cy] = vb?.length === 4 ? [vb[0] + vb[2] / 2, vb[1] + vb[3] / 2] : [r.width / 2, r.height / 2];
        // on its side, the drawing turned about its centre spans the viewBox's height across: the viewBox turns with it
        const turned = side && vb?.length === 4 ? (h) => h.replace(/\s(width|height|viewBox)="[^"]*"/g, "").replace("<svg", `<svg width="${r.width}" height="${r.height}" viewBox="${cx - vb[3] / 2} ${cy - vb[2] / 2} ${vb[3]} ${vb[2]}"`) : (h) => h;
        svg = svg.replace(/^<svg([^>]*)>/, (h, at) => turned(`<svg${at} data-rot="${turn}">`) + `<g transform="rotate(${turn} ${cx} ${cy})">`).replace(/<\/svg>\s*$/, "</g></svg>");
      }
      // a chart of hundreds of shapes is long: whitespace between tags and long decimals go, the
      // markup is kept up to a much higher bound (an empty chart otherwise)
      // (below 1 a value keeps 3 significant digits: an image pattern's scale(0.0002) cut to 0.0 draws nothing)
      svg = svg.replace(/>\s+</g, "><").replace(/(\d+\.\d)\d+/g, (m, cut) => (+m < 1 ? String(+(+m).toPrecision(3)) : cut));
      b.svg = svg.length < 400000 ? svg : null;
    }
    if (ownText) {
      b.text = ownText;
      texts.push([b, el]);
      // underline / strike: not inherited but painted through inline descendants (a link's span)
      const decoOf = (e) => {
        for (let x = e; x; x = x.parentElement) {
          const s = getComputedStyle(x);
          // a transparent decoration (an underline faded in on hover) is not painted
          if (/underline/.test(s.textDecorationLine) && visibleColor(s.textDecorationColor)) return ["UNDERLINE", s];
          if (/line-through/.test(s.textDecorationLine) && visibleColor(s.textDecorationColor)) return ["STRIKETHROUGH", s];
          if (s.display !== "inline") return [];
        }
        return [];
      };
      // an explicit thickness / underline offset in px (auto left to Figma: its own line is thinner and higher)
      const px = (v) => (/^-?[\d.]+px$/.test(v) ? fine(v) : undefined);
      const fontOf = (cs, clipText, e, [deco, ds] = decoOf(e)) => ({
        family: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
        size: fine(cs.fontSize),
        weight: +cs.fontWeight,
        italic: cs.fontStyle !== "normal" || undefined,
        // width (font-stretch, %) when not normal: the Condensed / Wide face of the family
        stretch: parseFloat(cs.fontStretch) && parseFloat(cs.fontStretch) !== 100 ? parseFloat(cs.fontStretch) : undefined,
        lh: cs.lineHeight === "normal" ? null : fine(cs.lineHeight),
        ls: __angeloLs(cs),
        color: __angeloFilterColor(e, cs.color),
        // logical alignment resolved: in right-to-left text, start is the right edge
        align: cs.direction === "rtl" && (cs.textAlign === "start" || cs.textAlign === "end") ? (cs.textAlign === "start" ? "right" : "left") : cs.textAlign,
        transform: cs.textTransform !== "none" ? cs.textTransform : undefined,
        deco,
        decoW: ds && px(ds.textDecorationThickness),
        decoY: ds && deco === "UNDERLINE" ? px(ds.textUnderlineOffset) : undefined,
        // superscript drawn by the font (numr / sups features) or by vertical-align
        sup: /"(numr|sups)"/.test(cs.fontFeatureSettings) || /^(super|sub)$/.test(cs.verticalAlign) || undefined,
        fill: clipText && /gradient\(/.test(cs.backgroundImage) ? cs.backgroundImage.slice(0, 600) : undefined,
        // optical size when not the font size (auto): an explicit "opsz" setting, or 0 = axis default
        opsz: /"opsz"\s+([\d.]+)/.test(cs.fontVariationSettings) ? +RegExp.$1 : cs.fontOpticalSizing === "none" ? 0 : undefined,
        // other axes set by hand (wdth 98…): applied on the Figma variable font; wght is the weight
        axes: (() => {
          const a = {};
          for (const m of cs.fontVariationSettings.matchAll(/"(\w{4})"\s+(-?[\d.]+)/g)) if (!/^(opsz|wght)$/.test(m[1])) a[m[1]] = +m[2];
          return Object.keys(a).length ? a : undefined;
        })(),
      });
      b.font = fontOf(glyphCs || cs, clipText, el);
      // a text slotted into a web component's shadow DOM is styled from its slot (porsche: <p-display>
      // reads 16 px black on the host, the page paints it 100 px white): the slot's style is the text's
      const slotted = el.shadowRoot && [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim() && n.assignedSlot);
      if (slotted) b.font = fontOf(getComputedStyle(slotted.assignedSlot), clipText, slotted.assignedSlot);
      // a text set on its side (writing-mode, or a quarter-turn transform on it or above it): its
      // turn, clockwise in degrees as CSS has it; its lines are then columns
      {
        let a = (/^vertical/.test(cs.writingMode) ? 90 : cs.writingMode === "sideways-lr" ? -90 : 0) + __angeloTurn(el);
        a = ((Math.round(a / 90) * 90) % 360 + 360) % 360;
        if (a) b.font.rot = a > 180 ? a - 360 : a;
      }
      let none = false;
      if (pieces) {
        // whitespace collapsed across pieces as the browser does; same-style neighbours join
        const runs = [];
        for (const n of pieces) {
          const se = n.assignedSlot || n.parentElement;
          const pcs = getComputedStyle(se);
          const font = fontOf(pcs, [pcs.backgroundClip, pcs.webkitBackgroundClip].some((v) => /\btext\b/.test(v || "")), se);
          let text = n.textContent.replace(/[^\S\u00a0\u202f]+/g, " ");
          const prev = runs[runs.length - 1];
          if (prev && breaks.has(n)) { prev.text = prev.text.replace(/ $/, ""); text = "\n".repeat(breaks.get(n)) + text.replace(/^ /, ""); }
          if (!prev || prev.text.endsWith(" ")) text = text.replace(/^ /, "");
          // a piece set at font-size 0 paints nothing (an off-screen consent label)
          if (!text || font.size < 1) continue;
          if (prev && JSON.stringify(prev.font) === JSON.stringify(font)) prev.text += text;
          else runs.push({ text, font });
        }
        if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/ $/, "");
        // one run: all the text is one styled inline (a counter in an 88 px span), its font is the text's
        if (runs.length > 1) b.runs = runs;
        else if (runs.length) b.font = runs[0].font;
        none = !runs.length;
      }
      if (none || b.font.size < 1) { delete b.text; delete b.font; delete b.runs; texts.pop(); }
      let lines = b.text ? linesOf(el, pieces || undefined) : [];
      // a rolling ticker held mid-roll (digits sliding in under a mask / overflow): only the lines
      // at least half inside the clip show; the text keeps those, sits on them, or is dropped
      // a line wholly past a side of the clip paints nothing (an icon button hiding its label with text-indent: -5000px)
      const sy = __angeloScrollY(), sx = __angeloScrollX(), inside = (l) => Math.min(l.y - sy + l.h, clip.b) - Math.max(l.y - sy, clip.t) >= l.h / 2 && Math.min(l.x - sx + l.w, clip.r) - Math.max(l.x - sx, clip.l) > 0;
      // (a line-clamped text keeps its hidden lines: the truncation below cuts them, Figma draws the ellipsis)
      const clamped = [el, el.parentElement].some((e) => e && parseInt(getComputedStyle(e).webkitLineClamp) > 0);
      if (lines.length && !clamped && !lines.every(inside)) {
        lines = lines.filter(inside);
        delete b.runs;
        if (!lines.length) { delete b.text; delete b.font; texts.pop(); }
        else {
          b.text = lines.map((l) => l.t).join(" ");
          const top = Math.min(...lines.map((l) => l.y)), bot = Math.max(...lines.map((l) => l.y + l.h));
          const left = Math.min(...lines.map((l) => l.x)), right = Math.max(...lines.map((l) => l.x + l.w));
          [b.x, b.y, b.w, b.h, b.tx, b.tw] = [Math.round(left), Math.round(top), Math.round(right - left), Math.round(bot - top), left, right - left];
        }
      }
      if (lines.length) b.lines = lines;
      // generated text in flow (::before / ::after content: "…", open-quote / close-quote from
      // quotes) reads as part of the text; a negative indent hangs the opening mark outside
      const q = (cs.quotes.match(/"[^"]*"/g) || []).map((s) => s.slice(1, -1));
      const gen = (w) => {
        const ps = getComputedStyle(el, w);
        if (ps.display === "none" || /^(absolute|fixed)$/.test(ps.position)) return "";
        let t = "";
        for (const m of (ps.content || "").matchAll(/"((?:[^"\\]|\\.)*)"|(open|close)-quote/g)) t += m[1] != null ? m[1].replace(/\\(.)/g, "$1") : m[2] === "open" ? q[0] ?? "\u201c" : q[1] ?? "\u201d";
        return t.trim() ? t : "";
      };
      const [pre, post] = glyphCs ? ["", ""] : [gen("::before"), gen("::after")];
      if (b.text && (pre || post)) {
        b.text = pre + b.text + post;
        if (b.runs) [b.runs[0].text, b.runs[b.runs.length - 1].text] = [pre + b.runs[0].text, b.runs[b.runs.length - 1].text + post];
        if (b.lines) [b.lines[0].t, b.lines[b.lines.length - 1].t] = [pre + b.lines[0].t, b.lines[b.lines.length - 1].t + post];
        if (pre && (parseFloat(cs.textIndent) < 0 || parseFloat(getComputedStyle(el, "::before").marginLeft) < 0)) b.font.hang = 1;
      }
      // the same mark written in the text itself
      if (b.text && !pre && parseFloat(cs.textIndent) < 0 && /^[«"“‘'„‹(\[]/.test(b.text.trim())) b.font.hang = 1;
      // content box of the block that wraps the text (inline ancestors skipped): a paragraph
      // node rebuilt at this width wraps where the browser did
      let blk = el;
      while (blk.parentElement && /^(inline|contents)$/.test(getComputedStyle(blk).display)) blk = blk.parentElement;
      const bcs = getComputedStyle(blk);
      const br = blk.getBoundingClientRect();
      b.tx = Math.round(br.left + __angeloScrollX() + px(bcs.borderLeftWidth) + px(bcs.paddingLeft));
      b.tw = Math.round(blk.clientWidth - px(bcs.paddingLeft) - px(bcs.paddingRight));
      // a textarea's text starts under its padding: without a line, the layout would stick it to the top of the box
      if (tag === "textarea" && !b.lines) b.lines = [{ t: b.text, x: b.tx, y: Math.round((br.top + __angeloScrollY() + px(bcs.borderTopWidth) + px(bcs.paddingTop)) * 10) / 10, w: b.tw, h: Math.round(px(b.font?.size) * 1.2 || 15) }];
      // a text cut by its own block: one line with text-overflow: ellipsis, or N lines with -webkit-line-clamp
      // (the browser still lays out the hidden part; Figma truncates the full text itself)
      const clamp = parseInt(bcs.webkitLineClamp) || 0;
      // (N lines: the browser breaks at words and puts the ellipsis after the last kept one; Figma would cut mid-word,
      // so the kept lines are written out with it, Figma's own truncation trims it only when it does not fit)
      if (clamp && blk.scrollHeight > blk.clientHeight + 1) {
        b.trunc = clamp;
        if (b.lines) b.lines = b.lines.slice(0, clamp);
        if (clamp > 1 && b.lines?.length === clamp && !b.runs) {
          b.lines[clamp - 1] = { ...b.lines[clamp - 1], t: b.lines[clamp - 1].t.replace(/[\s.,;:]+$/, "") + "\u2026" };
          b.text = b.lines.map((l) => l.t.trim()).join(" ");
        }
      }
      else if (!clamp && bcs.textOverflow === "ellipsis" && bcs.overflowX !== "visible" && blk.scrollWidth > blk.clientWidth + 1) { b.trunc = 1; if (b.lines) b.lines = b.lines.slice(0, 1); }
    }
    // a row item that takes the row's slack (flex-grow): it stretches when the row is resized
    const par = el.parentElement && getComputedStyle(el.parentElement);
    if (par && par.display.includes("flex") && par.flexDirection.startsWith("row") && parseFloat(cs.flexGrow) > 0 && cs.position !== "absolute" && cs.position !== "fixed") b.fg = 1;
    if (cs.display.includes("flex")) {
      b.flex = { dir: cs.flexDirection, gap: px(cs.columnGap || cs.gap), justify: cs.justifyContent, align: cs.alignItems, wrap: cs.flexWrap };
    } else if (cs.display.includes("grid")) {
      b.grid = { cols: cs.gridTemplateColumns.split(" ").length, gap: px(cs.columnGap) };
    }
    const pad = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px);
    if (pad.some(Boolean)) b.pad = pad;
    // a negative top margin pulls the box above its parent's padding (an icon raised 2.75 em)
    const mt = px(cs.marginTop);
    if (mt < 0) b.mt = Math.round(mt * 10) / 10;
    boxes.push(b);
    for (const k of svgTexts) boxes.push({ id: boxes.length, p: b.p, ...k });
    // a paragraph's inline chips: fill and border only, pinned under its text (z -1)
    if (pieces) for (const c of el.querySelectorAll("*")) {
      const s = getComputedStyle(c);
      if (!painted(s) || !c.checkVisibility()) continue;
      // cropped to the paragraph's clip, like any painted layer
      const q0 = c.getBoundingClientRect(), l = Math.max(q0.left, clip.l), t = Math.max(q0.top, clip.t);
      const q = { left: l, top: t, width: Math.min(q0.right, clip.r) - l, height: Math.min(q0.bottom, clip.b) - t };
      if (q.width < 1 || q.height < 1) continue;
      const k = { id: boxes.length, p: b.p, tag: c.tagName.toLowerCase(), x: Math.round(q.left + __angeloScrollX()), y: Math.round(q.top + __angeloScrollY()), w: Math.round(q.width), h: Math.round(q.height), pin: 1, z: -1 };
      if (visibleColor(s.backgroundColor)) k.bg = s.backgroundColor;
      const bw = px(s.borderTopWidth);
      if (bw && visibleColor(s.borderTopColor)) k.border = { w: bw, c: s.borderTopColor };
      corners(k, s);
      boxes.push(k);
    }
    if (/^(svg|img|video|canvas)$/.test(tag)) return;
    pseudo(el, r, "::before", id, op, clip);
    // a paragraph's inline pieces are in its runs
    if (!pieces) for (const c of kids) walk(c, id, clip, op);
    pseudo(el, r, "::after", id, op, clip);
  };
  // the shot never scrolls sideways: what lies left or right of the viewport (carousel slides
  // waiting off-screen, a skip link parked at -9999 px) is not on the page
  walk(document.body, -1, { l: 0, t: -1e9, r: innerWidth, b: until - __angeloScrollY() });
  // texts the page itself hides under a later layer (a chat panel over a board): hit-tested at
  // the middle of their first line, scrolled into view; only a cover that paints (fill, image,
  // media) counts, and never a fixed / sticky one (it covers only at this scroll position)
  const sx0 = __angeloScrollX(), sy0 = __angeloScrollY();
  const paints = (e) => {
    const cs = getComputedStyle(e);
    return visibleColor(cs.backgroundColor) || cs.backgroundImage !== "none" || /^(IMG|VIDEO|CANVAS|svg)$/.test(e.tagName);
  };
  for (const [b, el] of texts) {
    const l = b.lines?.[0] || b;
    const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue; // a line without geometry
    window.scrollTo({ left: 0, top: Math.max(0, cy - innerHeight / 2), behavior: "instant" });
    const hit = document.elementFromPoint(cx - __angeloScrollX(), cy - __angeloScrollY());
    if (!hit || el.contains(hit) || hit.contains(el)) continue;
    let covers = false;
    for (let e = hit; e && !e.contains(el); e = e.parentElement) {
      if (/^(fixed|sticky)$/.test(getComputedStyle(e).position)) { covers = false; break; }
      covers ||= paints(e);
    }
    if (covers) b.hid = 1;
  }
  window.scrollTo({ left: sx0, top: sy0, behavior: "instant" });
  if (until < Infinity) {
    // preorder: a parent is kept before its children are looked at
    const kept = new Set([-1]);
    boxes = boxes.filter((b) => b.y < until && kept.has(b.p) && kept.add(b.id));
    for (const b of boxes) {
      b.h = Math.min(b.h, Math.round(until - b.y));
      if (b.lines) b.lines = b.lines.filter((l) => l.y < until);
    }
  }
  // close up the bands left out: every vertical coordinate moves up by the holes above it
  // except where a kept block lies (a sticky header over the hero left out keeps its height)
  const kept = [...names.keys()].filter((el) => ![...skip].some((x) => el.contains(x))).map((el) => {
    const q = el.getBoundingClientRect();
    return [q.top + __angeloScrollY(), q.bottom + __angeloScrollY()];
  });
  const cutOut = (ranges, [t, b]) => ranges.flatMap(([u, v]) => (b <= u || t >= v ? [[u, v]] : [[u, Math.max(u, t)], [Math.min(v, b), v]].filter(([x, y]) => y > x)));
  holes.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const h of holes) {
    const l = merged[merged.length - 1];
    if (l && h[0] <= l[1]) l[1] = Math.max(l[1], h[1]);
    else merged.push([...h]);
  }
  for (const k of kept) merged.splice(0, merged.length, ...cutOut(merged, k));
  const lift = (v) => v - merged.reduce((s, [t, b]) => s + Math.max(0, Math.min(v, b) - t), 0);
  if (merged.length) {
    for (const b of boxes) {
      const y = lift(b.y);
      b.h = Math.round(lift(b.y + b.h) - y);
      b.y = Math.round(y);
      for (const l of b.lines || []) l.y = Math.round(lift(l.y) * 10) / 10;
    }
  }
  // scrollHeight can be the viewport when the body scrolls itself: the boxes' bottom wins
  // (a box is cut at the bottom of its clipping ancestors: a tall list inside a clipped card adds nothing)
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const clipEdge = new Map();
  const edge = (b) => {
    if (clipEdge.has(b.id)) return clipEdge.get(b.id);
    const up = byId.get(b.p);
    const e = up ? Math.min(edge(up), up.clip && up.h >= 1 ? up.y + up.h : Infinity) : Infinity;
    clipEdge.set(b.id, e);
    return e;
  };
  const bottom = boxes.reduce((m, b) => Math.max(m, Math.min(b.y + b.h, edge(b))), 0);
  // @font-face of the families in use; cross-origin sheets are listed for the node side
  const used = new Set(boxes.filter((b) => b.font).map((b) => b.font.family.toLowerCase()));
  const faces = [], sheets = [];
  const take = (rule, base) => {
    const fam = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
    if (!used.has(fam.toLowerCase())) return;
    const urls = [...rule.style.getPropertyValue("src").matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => new URL(m[1], base).href);
    const src = urls.find((u) => /\.woff2(\?|#|$)/i.test(u)) || urls.find((u) => /\.(woff|ttf|otf)(\?|#|$)/i.test(u)) || urls[0];
    if (src) faces.push({ family: fam, weight: rule.style.getPropertyValue("font-weight") || "400", style: rule.style.getPropertyValue("font-style") || "normal", src });
  };
  const scan = (rules, base) => {
    for (const r of rules) {
      if (r instanceof CSSFontFaceRule) take(r, base);
      else if (r.cssRules) scan(r.cssRules, base);
    }
  };
  for (const sh of document.styleSheets) {
    try { scan(sh.cssRules, sh.href || location.href); } catch { if (sh.href) sheets.push(sh.href); }
  }
  // the page background painted by <html> (canvas): no box carries it, the body is narrower than the page
  const canvasBg = getComputedStyle(document.documentElement).backgroundColor;
  return { title: document.title, ...(visibleColor(canvasBg) && { canvas: canvasBg }), unseen, holes: merged.map(([t, b]) => [Math.round(t), Math.round(b)]), height: Math.round(Math.min(lift(until), Math.max(lift(document.documentElement.scrollHeight), bottom))), boxes, faces, sheets, used: [...used] };
};

// Canvases (2D / WebGL) and videos only show through a screenshot: isolate(true) hides everything else
// (backgrounds included) so a transparent shot holds the canvas pixels alone
globalThis.__angeloIsolate = (on) => {
  let st = document.getElementById("__angelo-isolate");
  if (!on) return st && st.remove();
  if (!st) {
    st = document.createElement("style");
    st.id = "__angelo-isolate";
    // gutter kept: the beyond-viewport shot drops the scrollbar, the layout would widen (cos: videos
    // shot ~1 % lower down the page, a transparent band atop each). Only when there is one: forced on a
    // page without it, the layout narrows by its width (vmfa: a 16/9 video 15 px narrower, a black band)
    const gutter = innerWidth - document.documentElement.clientWidth > 0 ? "html { scrollbar-gutter: stable !important } " : "";
    st.textContent = gutter + "html, body { background: transparent !important } * { visibility: hidden !important } canvas, video, [data-angelo-media] { visibility: visible !important }";
    document.head.appendChild(st);
  }
};
// the isolated shot (PNG data url of the page from its top, `scale` px per css px) → each canvas
// box gets its pixels as a PNG data url (b.img), cut at its page position before holes closed up
// Mask icons (see maskIcon): the svg fetched, every painted shape filled with the box's colour
// (an alpha mask keeps the shape, not its colour), sized to the box; the flat fill dropped.
// One that is not an svg (a png mask) stays a filled box
globalThis.__angeloMaskIcons = async (cap) => {
  const urls = [...new Set(cap.boxes.filter((b) => b.maskIcon).map((b) => b.maskIcon))];
  const text = new Map(await Promise.all(urls.map(async (u) => [u, await fetch(u).then((r) => (r.ok ? r.text() : null)).catch(() => null)])));
  for (const b of cap.boxes.filter((b) => b.maskIcon)) {
    const src = text.get(b.maskIcon);
    const svg = src && /<svg[\s>]/.test(src) && new DOMParser().parseFromString(src, "image/svg+xml").querySelector("svg");
    delete b.maskIcon;
    if (!svg) continue;
    const [sw, sh] = ["width", "height"].map((k) => parseFloat(svg.getAttribute(k)));
    if (!svg.getAttribute("viewBox") && sw && sh) svg.setAttribute("viewBox", `0 0 ${sw} ${sh}`);
    svg.setAttribute("width", b.w);
    svg.setAttribute("height", b.h);
    // the root's own fill / stroke recoloured like its children: an outline icon's fill="none" stays none
    // (chloe's header icons, drawn filled otherwise); no fill at all = black by default, the mask colour then
    if (!svg.hasAttribute("fill") && !svg.style?.fill) svg.setAttribute("fill", b.bg);
    for (const e of [svg, ...svg.querySelectorAll("*")]) {
      for (const k of ["fill", "stroke"]) {
        const v = e.getAttribute(k) ?? e.style?.[k];
        if (v && v !== "none" && !/^url\(/.test(v)) { e.setAttribute(k, b.bg); e.style?.removeProperty(k); }
      }
    }
    b.svg = new XMLSerializer().serializeToString(svg);
    b.img = "svg";
    delete b.bg;
  }
  return cap;
};

globalThis.__angeloCanvasFill = async (cap, shot, scale = 1) => {
  const im = new Image();
  im.src = shot;
  await im.decode();
  for (const b of cap.boxes.filter((b) => b.canvas)) {
    const c = document.createElement("canvas");
    [c.width, c.height] = [Math.round(b.w * scale), Math.round(b.h * scale)];
    // a box under half a pixel: nothing to read (getImageData throws on a 0-wide source)
    if (!c.width || !c.height) { delete b.py; b.blank = 1; delete b.img; continue; }
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(im, b.x * scale, b.py * scale, c.width, c.height, 0, 0, c.width, c.height);
    delete b.py;
    // a frame not painted yet (player still loading, iframe off screen): one flat colour, or
    // nothing at all → marked blank, never placed as an image
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let lo = 255, hi = 0;
    for (let i = 0; i < px.length; i += 4 * 97) for (let k = 0; k < 4; k++) { lo = Math.min(lo, px[i + k]); hi = Math.max(hi, px[i + k]); }
    if (hi - lo <= 8) { b.blank = 1; delete b.img; continue; }
    delete b.blank;
    b.img = c.toDataURL("image/png");
    // a frame painted in a corner only (player laid out before its iframe took its size: the
    // hero video at a sixth of its box) → partial, shot again by the caller
    const at = (x, y) => (y * c.width + x) * 4;
    const bgAt = at(c.width - 1, c.height - 1);
    let [x0, y0, x1, y1] = [c.width, c.height, -1, -1];
    for (let y = 0; y < c.height; y += 4) for (let x = 0; x < c.width; x += 4) {
      const i = at(x, y);
      if (Math.max(...[0, 1, 2, 3].map((k) => Math.abs(px[i + k] - px[bgAt + k]))) <= 8) continue;
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
    if ((x1 - x0) * (y1 - y0) < c.width * c.height * 0.25) b.partial = 1;
    else delete b.partial;
  }
};

// A media box the isolated shot left empty (video off screen: the compositor paints no frame
// beyond the viewport) → its still taken from the element itself, no scroll: the current frame
// drawn into a canvas (object-fit kept); a cross-origin video taints that canvas → a CORS copy
// of the same source, seeked to the same time; a 2D canvas → its own pixels; then its poster.
// Boxes still empty keep `blank`
// Iframes (ads, embeds) load and paint only near the viewport, and their cross-origin DOM is not
// readable: each scrolled into view, given time to load, then its pixels taken from the viewport.
// Same for a big block read empty while the page shows something there (a carousel rendered only
// in view, a player): the outermost box with nothing captured inside, no captured leaf over it.
// shot(rect) → a data URL, or null when nothing painted (an ad slot left empty)
// The URL an <img> shows or will load: current source, src, else the widest srcset candidate;
// none for a data: placeholder
globalThis.__angeloSrcOf = (i) => {
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return ""; } };
  for (const u of [i.currentSrc, i.getAttribute("src"), i.dataset.src]) if (u && !/^data:/.test(u)) return abs(u);
  const set = i.getAttribute("srcset") || i.dataset.srcset || "";
  const best = set.split(/,\s+/).map((c) => c.trim().split(/\s+/)).filter((c) => c[0] && !/^data:/.test(c[0])).sort((a, b) => (parseFloat(b[1]) || 1) - (parseFloat(a[1]) || 1))[0];
  return best ? abs(best[0]) : "";
};
// The picture a slot will show, from the page's own data: the inline JSON the page ships (Next
// __NEXT_DATA__, application/json state, a JSON literal in a script) holds the record of what the
// slot links to (its href, its last path segment, or the id digits it ends with), and that record
// an image URL (cos: initialResult.items[].primaryImage.src beside id). Parsed once per page
globalThis.__angeloPageData = () => {
  if (globalThis.__angeloData) return globalThis.__angeloData;
  const parse = (x) => { try { const o = JSON.parse(x); return o && typeof o === "object" ? o : null; } catch { return null; } };
  const objs = [];
  for (const s of document.scripts) {
    const t = s.textContent;
    if (s.src || t.length < 500) continue;
    let o = parse(t);
    if (!o) { const a = t.indexOf("{"), z = t.lastIndexOf("}"); if (a >= 0 && z > a) o = parse(t.slice(a, z + 1)); }
    if (o) objs.push(o);
  }
  return (globalThis.__angeloData = objs);
};
globalThis.__angeloDataPic = (el) => {
  const a = el.querySelector("a[href]") || el.closest("a[href]");
  if (!a) return null;
  let path;
  try { path = new URL(a.getAttribute("href"), location.href).pathname.replace(/\/+$/, ""); } catch { return null; }
  const seg = path.split("/").pop() || "";
  const id = /(\d{6,})$/.exec(seg)?.[1];
  // strongest key first: the path, its last segment, its trailing id
  const keys = [path, seg.length >= 6 ? seg : null, id].filter(Boolean);
  const IMG = /^(https?:)?\/\/[^\s"'<>]+\.(?:jpe?g|png|webp|avif|gif)(?:\?[^\s"'<>]*)?$/i;
  // [key path, url] of every picture in a record: the path names its role (primaryImage.src)
  const pics = (o, out = [], depth = 0, at = "") => {
    if (!o || typeof o !== "object" || depth > 6) return out;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string") { if (IMG.test(v)) out.push([at + k, v]); }
      else pics(v, out, depth + 1, at + k + ".");
    }
    return out;
  };
  const hit = (o, key) => Object.values(o).some((v) => typeof v === "string" && (v === key || (key.length >= 6 && (v.endsWith(key) || v.endsWith(key + "/")))));
  // the smallest record holding the key and a picture: a product, not the list around it
  const find = (o, key, depth = 0) => {
    if (!o || typeof o !== "object" || depth > 40) return null;
    if (Array.isArray(o)) { for (const v of o) { const r = find(v, key, depth + 1); if (r) return r; } return null; }
    for (const v of Object.values(o)) { const r = find(v, key, depth + 1); if (r) return r; }
    if (!hit(o, key)) return null;
    const found = pics(o);
    if (!found.length) return null;
    return (found.find(([k]) => /primary|main|hero|cover|default|thumb/i.test(k)) || found[0])[1];
  };
  for (const key of keys) for (const o of globalThis.__angeloPageData()) {
    const u = find(o, key);
    if (!u) continue;
    let url = new URL(u, location.href).href;
    // sized like the page's own pictures of that CDN (cos: ?imwidth=…), not the original
    const like = [...document.images].map((i) => i.currentSrc).find((c) => c && c.includes("?") && c.startsWith(new URL(url).origin));
    if (like && !url.includes("?")) url += like.slice(like.indexOf("?"));
    return url;
  }
  return null;
};
// budget: a page holding dozens of embeds or empty blocks (teenage.engineering/now, 123 000 px) spends
// up to ~50 s on each one; past the budget the rest is left out and counted, the capture goes on
globalThis.__angeloFrameShots = async (cap, shot, { max = 40, wait = 1800, budget = 60000 } = {}) => {
  const leaf = (b) => !!(b.text || b.img || b.svg || b.canvas || b.tag === "iframe" || /url\(|gradient\(/.test((b.bgImg || "") + (typeof b.bg === "string" ? b.bg : "")));
  const kids = new Map();
  for (const b of cap.boxes) { const list = kids.get(b.p); if (list) list.push(b); else kids.set(b.p, [b]); }
  const full = new Map();
  const inked = (b) => { if (!full.has(b.id)) full.set(b.id, leaf(b) || (kids.get(b.id) || []).some(inked)); return full.get(b.id); };
  const byId = new Map(cap.boxes.map((b) => [b.id, b]));
  const leaves = cap.boxes.filter(leaf);
  const over = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  // texts over more than 2 % of the box, or leaves adding up to a tenth of it (a stretched link over
  // a card of texts and thumbnails): the shot would paint what the capture already holds. A badge
  // over a picture stays under that (cos: a vertical "New" tag, 1.5 % of the card)
  // (one pass over the leaves for both sums, added in the same order as before)
  const covered = (b) => { let text = 0, all = 0; for (const l of leaves) { const o = over(l, b); all += o; if (l.text) text += o; } return [text, all]; };
  const blind = cap.boxes.filter((b) => {
    if (!(b.w >= 120 && b.h >= 100 && b.h <= innerHeight - 40 && globalThis.__angeloEls?.get(b.id)?.isConnected && !inked(b) && byId.get(b.p) && inked(byId.get(b.p)))) return false;
    const [text, all] = covered(b);
    return text <= b.w * b.h * 0.02 && all <= b.w * b.h * 0.1;
  });
  const frames = cap.boxes.filter((b) => b.tag === "iframe" && !b.img && document.querySelector(`[data-angelo-frame="${b.id}"]`)).concat(blind).slice(0, max);
  let got = 0;
  const via = { dom: 0, mount: 0, data: 0, shot: 0 };
  // the URL of a picture the box holds whatever its paint state (left at opacity 0, still loading,
  // mounted by the scroll): the build fetches it, no shot to take. A small overlay (a hover icon)
  // is not it: the picture spans a quarter of the box, or has no layout and a real size
  const urlIn = (el, b) => {
    for (const i of el.querySelectorAll("img")) {
      const u = globalThis.__angeloSrcOf(i);
      if (!u) continue;
      const q = i.getBoundingClientRect();
      if (q.width && q.height ? q.width * q.height >= b.w * b.h * 0.25 : i.naturalWidth >= 120) return u;
    }
    return "";
  };
  const take = (b, u, how) => { b.img = u; b.via = how; got++; via[how]++; };
  const t0 = globalThis.__angeloNow();
  let skipped = 0;
  for (const [n, b] of frames.entries()) {
    if (globalThis.__angeloNow() - t0 > budget) { skipped = frames.length - n; break; }
    const el = b.tag === "iframe" ? document.querySelector(`[data-angelo-frame="${b.id}"]`) : globalThis.__angeloEls.get(b.id);
    if (b.tag !== "iframe") { const u = urlIn(el, b); if (u) { take(b, u, "dom"); continue; } }
    el.scrollIntoView({ block: "center", behavior: "instant" });
    await globalThis.__angeloSleep(b.tag === "iframe" ? wait : wait / 2);
    // a reveal played by the scroll (picture sliding in) is waited out, else the shot catches it
    // mid-way; one still running after that is flagged for web-compare
    const moving = () => (el.getAnimations ? el.getAnimations({ subtree: true }) : []).filter((a) => a.playState === "running" && a.effect?.getComputedTiming().endTime !== Infinity);
    if (moving().length) await Promise.race([Promise.all(moving().map((a) => a.finished.catch(() => {}))), globalThis.__angeloSleep(1500)]);
    // pictures mounted by the scroll into view (a virtualized card): loaded, decoded and at rest
    // (a JS-driven slide-in has no animation to wait on) before the shot, else it catches the
    // grey slot with the picture half in (cos), 3 s at most
    const imgs = () => [...el.querySelectorAll("img")].filter((i) => i.currentSrc || i.src);
    const at = () => imgs().map((i) => { const q = i.getBoundingClientRect(); return `${q.x},${q.y},${q.width},${q.height}`; }).join(";");
    // a block read empty mounts its picture only once in view (cos: grey slot first): waited for
    for (let t1 = globalThis.__angeloNow(), last = at(); globalThis.__angeloNow() - t1 < 3000; ) {
      await globalThis.__angeloPass(120);
      const now = at();
      if ((b.tag === "iframe" || imgs().length) && imgs().every((i) => i.complete) && now === last) break;
      last = now;
    }
    // decode() never settles on some pictures (cos coats: a put-back card hung the capture): bounded
    await Promise.race([Promise.all(imgs().map((i) => i.decode().catch(() => {}))), globalThis.__angeloSleep(1500)]);
    await globalThis.__angeloPass(2);
    if (b.tag !== "iframe") {
      // mounted by the scroll: its URL, not its pixels (the page may still be fading it in)
      const u = urlIn(el, b);
      if (u) { take(b, u, "mount"); continue; }
      // never mounted (the page's virtualization did not wake, or unmounts under the capture):
      // the picture the page's data names for what the slot links to
      const d = globalThis.__angeloDataPic(el);
      if (d) { take(b, d, "data"); continue; }
    }
    let r = el.getBoundingClientRect();
    // a cover-sized embed (oatly: a Vimeo background scaled past its card, overflow hidden) shows only
    // what its clipping ancestors let through: the shot is cut to that, not to the whole player
    if (b.tag === "iframe") {
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
        const q = a.getBoundingClientRect();
        const [l, t] = [Math.max(r.left, q.left), Math.max(r.top, q.top)];
        r = new DOMRect(l, t, Math.max(0, Math.min(r.right, q.right) - l), Math.max(0, Math.min(r.bottom, q.bottom) - t));
      }
    }
    // the block grown since the capture (cos: grey placeholder left on top, the mounted picture
    // stacked under it, 745 px for 376): the loaded picture at the captured size is shot instead
    if (Math.abs(r.height - b.h) > 4 || Math.abs(r.width - b.w) > 4) {
      const fit = imgs().filter((i) => i.complete).map((i) => i.getBoundingClientRect())
        .find((q) => Math.abs(q.width - b.w) <= b.w * 0.1 && Math.abs(q.height - b.h) <= b.h * 0.1);
      if (fit) r = fit;
    }
    const x = Math.max(0, r.left), y = Math.max(0, r.top);
    const w = Math.min(innerWidth, r.right) - x, h = Math.min(innerHeight, r.bottom) - y;
    if (w < 8 || h < 8) continue;
    // a player that has not painted yet shoots flat (null): asked again, 4 times at most
    let src = null;
    for (let k = 0; k < (b.tag === "iframe" ? 4 : 1) && !src; k++) {
      if (k) await globalThis.__angeloSleep(1500);
      src = await Promise.race([shot({ x, y, w, h }), globalThis.__angeloSleep(10000).then(() => null)]);
    }
    if (src) { b.img = src; b.shot = true; got++; via.shot++; if (moving().length) b.anim = 1; }
  }
  await globalThis.__angeloTop();
  return { frames: frames.length, got, skipped, ...via };
};

// Pictures served by the page's own origin, read by the page itself and carried as data URLs: a
// bot wall (Akamai, jacquemus) answers 403 to the build's curl but not to the page's own fetch.
// Other origins stay URLs (cross-origin fetch is opaque from here). Bounded per file and in total.
globalThis.__angeloInlineImages = async (cap, { perFile = 4_000_000, total = 24_000_000 } = {}) => {
  const own = (u) => { try { return /^https?:$/.test(new URL(u).protocol) && new URL(u).origin === location.origin; } catch { return false; } };
  const boxes = cap.boxes.filter((b) => typeof b.img === "string" && own(b.img));
  const urls = [...new Set(boxes.map((b) => b.img))];
  const done = new Map();
  let used = 0, next = 0;
  const toData = (blob) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
  const worker = async () => {
    while (next < urls.length) {
      const u = urls[next++];
      try {
        const res = await fetch(u, { credentials: "include" });
        const blob = res.ok ? await res.blob() : null;
        if (!blob || !/^image\//.test(blob.type) || blob.size > perFile || used + blob.size > total) continue;
        used += blob.size;
        done.set(u, await toData(blob));
      } catch {}
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  for (const b of boxes) if (done.has(b.img)) b.img = done.get(b.img);
  return { urls: urls.length, inlined: done.size };
};

globalThis.__angeloMediaStill = async (cap) => {
  const flat = (g, w, h) => {
    const px = g.getImageData(0, 0, w, h).data;
    let lo = 255, hi = 0;
    for (let i = 0; i < px.length; i += 4 * 97) for (let k = 0; k < 4; k++) { lo = Math.min(lo, px[i + k]); hi = Math.max(hi, px[i + k]); }
    return hi - lo <= 8;
  };
  const wait = (v, ev, ms) => new Promise((ok) => {
    const t = setTimeout(() => ok(false), ms);
    v.addEventListener(ev, () => { clearTimeout(t); ok(true); }, { once: true });
    v.addEventListener("error", () => { clearTimeout(t); ok(false); }, { once: true });
  });
  // the frame as the box shows it: object-fit cover / contain / fill, object-position in %
  const draw = (src, sw, sh, b, fit, pos) => {
    const k = Math.min(2, devicePixelRatio || 1);
    const c = document.createElement("canvas");
    [c.width, c.height] = [Math.round(b.w * k), Math.round(b.h * k)];
    if (!c.width || !c.height) return null;
    const g = c.getContext("2d", { willReadFrequently: true });
    let [dw, dh] = [c.width, c.height];
    if (fit === "cover" || fit === "contain") {
      const f = (fit === "cover" ? Math.max : Math.min)(c.width / sw, c.height / sh);
      [dw, dh] = [sw * f, sh * f];
    } else if (fit === "none") [dw, dh] = [sw * k, sh * k];
    const [px, py] = (pos || "50% 50%").split(" ").map((v) => (/%$/.test(v) ? parseFloat(v) / 100 : 0.5));
    g.drawImage(src, (c.width - dw) * px, (c.height - dh) * (py ?? 0.5), dw, dh);
    if (flat(g, c.width, c.height)) return null;
    return c.toDataURL("image/jpeg", 0.9);
  };
  const frame = async (v, b) => {
    const cs = getComputedStyle(v);
    const go = (x) => draw(x, x.videoWidth, x.videoHeight, b, cs.objectFit, cs.objectPosition);
    if (v.readyState < 2) {
      if (v.preload === "none") v.preload = "auto";
      // a player that loads its stream when it comes into view (nyt-betamax: the reference, shot while
      // scrolling, shows the frame; the capture at the top found none): brought into view and waited on
      const [sx, sy] = [__angeloScrollX(), __angeloScrollY()];
      v.scrollIntoView({ block: "center", behavior: "instant" });
      try {
        await globalThis.__angeloFrame?.();
        if (v.readyState < 2 && !(await wait(v, "loadeddata", 5000))) return null;
      } finally {
        window.scrollTo({ left: sx, top: sy, behavior: "instant" });
      }
    }
    try {
      return go(v);
    } catch {
      // tainted: the same source, CORS asked; works when the CDN answers it
      const src = v.currentSrc || v.src;
      if (!src) return null;
      const u = document.createElement("video");
      [u.crossOrigin, u.muted, u.preload, u.src] = ["anonymous", true, "auto", src];
      if (!(await wait(u, "loadeddata", 5000))) return null;
      if (v.currentTime) { u.currentTime = v.currentTime; await wait(u, "seeked", 3000); }
      try { return go(u); } catch { return null; } finally { u.removeAttribute("src"); u.load(); }
    }
  };
  for (const b of cap.boxes.filter((b) => b.canvas && (b.blank || b.partial || !b.img))) {
    const el = document.querySelector(`[data-angelo-media="${b.id}"]`);
    const v = el && (el.tagName === "VIDEO" ? el : (el.shadowRoot || el).querySelector("video"));
    let img = null;
    if (v) img = await frame(v, b).catch(() => null);
    else if (el && el.tagName === "CANVAS") {
      try { img = draw(el, el.width, el.height, b, "fill"); } catch {}
    }
    const poster = b.poster || (v && v.poster) || null;
    if (img || poster) {
      b.img = img || poster;
      delete b.blank;
      delete b.partial;
    } else b.blank = 1;
  }
  return cap;
};

// Logical blocks of the page, in document order: header / nav / section / footer at level 1,
// sub-sections below (up to 3 levels). Wrappers that only hold one big child are seen through.
// → [{ el, level, parent (index or -1), kind, name }]
globalThis.__angeloBlocks = () => {
  const out = [];
  const shown = (el) => {
    if (/^(script|style|link|meta|noscript|template|br)$/i.test(el.tagName)) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4;
  };
  const kids = (el) => [...el.children].filter(shown);
  const pinned = (el) => /^(fixed|absolute)$/.test(getComputedStyle(el).position);
  const height = (el) => el.getBoundingClientRect().height;
  // an absolute box holding a large share of its parent is content laid out by hand (a side
  // column), not an overlay
  const big = (el, parent) => {
    const r = el.getBoundingClientRect(), pr = parent.getBoundingClientRect();
    return getComputedStyle(el).position === "absolute" && r.width * r.height >= pr.width * pr.height * 0.2;
  };
  const inFlow = (el) => kids(el).filter((c) => !pinned(c) || big(c, el));
  // see through wrappers: a box whose flow holds a single child (overlays and skip links aside)
  const unwrap = (el) => {
    for (;;) {
      const k = inFlow(el);
      if (k.length !== 1) return el;
      el = k[0];
    }
  };
  // children read top to bottom, none beside another: bands of a page, not columns
  const stacked = (els) => {
    const rs = els.map((el) => el.getBoundingClientRect()).sort((a, b) => a.top - b.top);
    return rs.every((r, i) => !i || r.top >= rs[i - 1].bottom - 4);
  };
  // a bar across the top of the page, fixed or not, holding links
  const bar = (el) => {
    const r = el.getBoundingClientRect();
    return r.top + __angeloScrollY() <= 40 && r.width >= innerWidth * 0.9 && r.height <= 200 && el.querySelectorAll("a, button").length >= 3;
  };
  const SEMANTIC = /^(header|nav|main|section|article|aside|footer|form|figure|ul|ol)$/;
  const LEAF = /^(h[1-6]|p|span|a|img|svg|picture|video|button|label|input|textarea|select|strong|em|small|br|hr)$/;
  // a block has structure: a semantic tag, or several visible elements of its own
  const isBlock = (el, parent) => {
    const tag = el.tagName.toLowerCase();
    if (LEAF.test(tag)) return false;
    const r = el.getBoundingClientRect(), pr = parent.getBoundingClientRect();
    // a narrow column counts when it is a rail of several items (thumbnails, side menu)
    // a column wrapping a single box (a sticky panel) counts by what it wraps
    const n = kids(unwrap(el)).length;
    if (r.height < 48 || (r.width < pr.width * 0.25 && !(r.height >= 300 && n >= 3))) return false;
    return SEMANTIC.test(tag) || el.getAttribute("role") || n >= 2;
  };
  const clip = (t) => t.replace(/\s+/g, " ").trim().slice(0, 32);
  const label = (el) => {
    const h = el.querySelector("h1, h2, h3, h4, [role=heading]");
    if (h && shown(h) && clip(h.innerText || "")) return clip(h.innerText);
    return clip(el.getAttribute("aria-label") || el.id || "");
  };
  const kindOf = (el, level, first, last) => {
    const tag = el.tagName.toLowerCase(), role = el.getAttribute("role");
    if (tag === "nav" || role === "navigation") return "nav";
    if (level > 1) return "sub-section";
    if (pinned(el) && el.getBoundingClientRect().top + __angeloScrollY() > 40) return "overlay";
    if (tag === "header" || role === "banner" || bar(el)) return "header";
    if (tag === "footer" || role === "contentinfo") return "footer";
    if (level === 1 && first && el.querySelector("nav")) return "header";
    // (the last band full of links is a footer, unless taller than the screen: a grid of cards)
    if (level === 1 && last && el.querySelectorAll("a").length >= 4 && height(el) <= innerHeight) return "footer";
    return "section";
  };
  const NAMES = { header: "Header", footer: "Footer", nav: "Nav", overlay: "Overlay", section: "Section", "sub-section": "Sub-section", column: "Column", sidebar: "Sidebar" };
  // side by side sub-blocks are columns, a narrow one a sidebar (thumbnails rail, side menu)
  const side = (el) => el.getBoundingClientRect().width < el.parentElement.getBoundingClientRect().width * 0.25 ? "sidebar" : "column";
  const add = (list, level, parent) => {
    const row = list.length >= 2 && !stacked(list);
    list.forEach((el, k) => {
      let kind = kindOf(el, level, k === 0, k === list.length - 1);
      if (kind === "sub-section" && row) kind = side(el);
      const lab = /^(section|sub-section|column|sidebar)$/.test(kind) ? label(el) : "";
      const i = out.push({ el, level, parent, kind, name: lab ? `${NAMES[kind]} — ${lab}` : `${NAMES[kind]} ${k + 1}` }) - 1;
      if (/^(header|footer|nav)$/.test(kind)) out[i].name = NAMES[kind];
      if (level >= 3 || kind === "overlay") return;
      const inner = unwrap(el);
      const subs = kids(inner).filter((c) => isBlock(c, inner));
      if (subs.length >= 2) add(subs, level + 1, i);
    });
  };
  // level 1: the page spine, <main> opened so its sections sit next to the header, and so is
  // a box taking most of the page (an app shell holding header, sections and footer)
  // a fixed bar left beside the page wrapper while unwrapping is the header
  const bars = [];
  let body = document.body;
  for (;;) {
    const k = inFlow(body);
    if (k.length !== 1) break;
    bars.push(...kids(body).filter((c) => pinned(c) && bar(c)));
    body = k[0];
  }
  let top = [...bars, ...kids(body)];
  for (let k = 0; k < 4; k++) {
    const total = top.filter((el) => !pinned(el)).reduce((s, el) => s + height(el), 0);
    const opened = top.flatMap((el) => {
      const inner = inFlow(unwrap(el));
      // opened only into bands stacked top to bottom: side-by-side columns stay one section
      const open = el.tagName === "MAIN" || el.getAttribute("role") === "main" || (!pinned(el) && height(el) >= total * 0.7);
      return open && inner.length >= 2 && stacked(inner) ? kids(unwrap(el)) : [el];
    });
    if (opened.length === top.length) break;
    top = opened;
  }
  // the element under the pointer one level below a block: the child of its unwrapped box
  // holding the pointer, so hovering drills down the page one level at a time
  // every element one level below a block, named as a pick names it: what a headless run looks a
  // picked name up in when the page's own list does not hold it (web-capture.mjs --part)
  globalThis.__angeloSubs = (block) =>
    kids(unwrap(block)).map((el) => {
      const tag = el.tagName.toLowerCase();
      const lab = label(el) || (LEAF.test(tag) ? clip(el.innerText || el.getAttribute("alt") || "") : "");
      return { el, name: lab ? `Sub-section — ${lab}` : `Sub-section ${tag}` };
    });
  globalThis.__angeloSub = (block, target) => globalThis.__angeloSubs(block).find((s) => s.el.contains(target)) || null;
  // skip links and other small pinned leaves are not blocks
  add(top.filter((el) => height(el) >= 24 && !(LEAF.test(el.tagName.toLowerCase()) && height(el) < 200)), 1, -1);
  // fixed layers nested off the spine (cookie banners, chat widgets in an app shell): overlays,
  // even when the fixed wrapper itself has no size and only its content shows
  const listed = out.map((b) => b.el);
  const floating = [...document.body.querySelectorAll("*")].filter((el) => {
    if (getComputedStyle(el).position !== "fixed" || listed.some((b) => b === el || b.contains(el) || el.contains(b))) return false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).position === "fixed") return false;
    return !bar(el) && (shown(el) || [...el.querySelectorAll("*")].some(shown));
  });
  // an app shell's own chrome is fixed too, but docked to an edge and holding links: a bar along
  // the top is its header, a rail down a side its sidebar (kept with the page, never an overlay)
  const dock = (el) => {
    const r = el.getBoundingClientRect();
    if (el.querySelectorAll("a, button").length < 3) return "";
    if (r.top <= 40 && r.height <= 200 && r.width >= innerWidth * 0.5) return "header";
    if (r.height >= innerHeight * 0.8 && r.width <= innerWidth * 0.35 && (r.left <= 4 || r.right >= document.documentElement.clientWidth - 4)) return "sidebar";
    return "";
  };
  let k = 0;
  for (const el of floating) {
    const kind = dock(el);
    if (kind) out.push({ el, level: 1, parent: -1, kind, name: NAMES[kind] });
    else out.push({ el, level: 1, parent: -1, kind: "overlay", name: `${NAMES.overlay} ${++k}` });
  }
  return out;
};
