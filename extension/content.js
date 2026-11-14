// Overlay on the page: the detected blocks outlined and named, a click picks blocks, the panel
// sends the page (or the picked blocks only) to Figma through the bridge.
// Injected again on each toolbar click: the second click toggles the overlay.

(() => {
  if (globalThis.__angeloOverlay) return globalThis.__angeloOverlay.toggle();
  // an overlay left by an earlier load of the extension (reloaded since): its world is orphaned,
  // its Go would run stale code → removed, this injection takes over
  for (const old of document.querySelectorAll("angelo-overlay")) old.remove();

  // one orange, fading with depth: section opaque, then more transparent per level
  const COLORS = ["rgb(255 122 0 / 100%)", "rgb(255 122 0 / 62%)", "rgb(255 122 0 / 34%)"];
  const color = (level) => COLORS[(level - 1) % COLORS.length];
  const host = document.createElement("angelo-overlay");
  host.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;z-index:2147483646;";
  const root = host.attachShadow({ mode: "open" });
  // lucide icons (ISC), stroke set by the panel css
  const svg = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
  const I = {
    code: svg('<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>'),
    x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    minus: svg('<path d="M5 12h14"/>'),
    plus: svg('<path d="M5 12h14"/><path d="M12 5v14"/>'),
    swap: svg('<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>'),
    search: svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    desktop: svg('<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>'),
    mobile: svg('<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>'),
    both: svg('<path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8"/><path d="M10 19v-3.96 3.15"/><path d="M7 19h5"/><rect width="6" height="10" x="16" y="12" rx="2"/>'),
    scan: svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
    send: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>'),
  };
  root.innerHTML = `<style>
    :host { all: initial; --accent: #0d99ff; }
    * { box-sizing: border-box; font-family: -apple-system, "SF Pro Text", system-ui, sans-serif; }
    .box { position: absolute; pointer-events: none; border-radius: 2px; }
    /* the innermost blocks tile the page: a dark veil, a 1 px white seam between neighbours (right and bottom edges only, never doubled) */
    .box.fill { background: rgb(10 12 24 / 40%); box-shadow: inset -1px -1px 0 rgb(255 255 255 / 75%); }
    .box.fill.lit { background: transparent; }
    .box.hov { outline: 2px solid var(--accent); outline-offset: -2px; background: color-mix(in srgb, var(--accent) 9%, transparent); }
    .box.fill.hov.lit { background: color-mix(in srgb, var(--accent) 9%, transparent); }
    .box.on, .box.fill.on, .box.fill.on.lit { outline: 2px solid var(--c); outline-offset: -2px; background: color-mix(in srgb, var(--c) 14%, transparent); }
    /* a block's name as a pill: level dot, name, size */
    .tag { position: absolute; top: 6px; left: 6px; max-width: calc(100% - 12px); display: flex; align-items: center; gap: 6px; padding: 3px 9px 3px 7px; font-size: 11px; line-height: 14px; font-weight: 500; color: #fff; background: rgb(18 18 22 / 88%); border-radius: 999px; box-shadow: 0 0 0 1px rgb(255 255 255 / 12%), 0 4px 14px rgb(0 0 0 / 35%); backdrop-filter: blur(8px); white-space: nowrap; }
    .tag::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--c); flex: none; }
    .tag .n { overflow: hidden; text-overflow: ellipsis; }
    .tag .d { color: rgb(255 255 255 / 55%); font-variant-numeric: tabular-nums; flex: none; }
    /* panel: white card, hairline divider, lucide icons */
    .panel { --ink: #161618; --mute: #8e8e93; --line: #e6e6e8; --soft: #f4f4f5; --ok: #5cc469; position: fixed; right: 16px; bottom: 16px; width: 320px; max-height: 72vh; display: flex; flex-direction: column; color: var(--ink); font-size: 13px; pointer-events: auto; border-radius: 20px; background: #fff; box-shadow: 0 0 0 1px rgb(0 0 0 / 5%), 0 2px 6px rgb(0 0 0 / 5%), 0 16px 40px rgb(0 0 0 / 12%); overflow: hidden; }
    .panel.left { right: auto; left: 16px; }
    svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; flex: none; }
    .head { display: flex; align-items: center; gap: 10px; padding: 14px 12px 14px 16px; border-bottom: 1px solid var(--line); }
    .logo { width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center; color: #fff; background: var(--ink); }
    .logo svg { width: 14px; height: 14px; stroke-width: 2; }
    .ttl { font-weight: 600; font-size: 15px; letter-spacing: -.01em; }
    .grow { flex: 1; }
    button { font: inherit; border: 0; padding: 0; margin: 0; cursor: pointer; background: transparent; color: var(--ink); }
    button.ico { flex: none; width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; color: var(--ink); transition: background .12s; }
    button.ico:hover { background: var(--soft); }
    button.ico.quiet { color: var(--mute); }
    button.ico.quiet:hover { color: var(--ink); }
    button:disabled { opacity: .35; cursor: default; }
    button:disabled:hover { background: transparent; }
    .scope { display: flex; align-items: center; gap: 8px; padding: 12px 16px 8px; color: var(--mute); font-size: 12px; }
    .scope .sub { flex: 1; }
    .scope .sub b { color: var(--ink); font-weight: 600; }
    button.link { flex: none; padding: 2px 8px; border-radius: 999px; background: var(--soft); color: var(--ink); font-size: 11px; }
    button.link:hover { background: var(--line); }
    .find { position: relative; padding: 0 12px 8px; }
    .find svg { position: absolute; left: 22px; top: 8px; width: 15px; height: 15px; color: var(--mute); pointer-events: none; }
    .find input { width: 100%; padding: 7px 10px 7px 32px; border: 0; border-radius: 9px; outline: 0; font: inherit; font-size: 12px; color: var(--ink); background: var(--soft); }
    .find input::placeholder { color: var(--mute); }
    .find input:focus { box-shadow: 0 0 0 1.5px var(--ink); background: #fff; }
    .list { overflow: auto; padding: 0 8px; flex: 1; min-height: 0; }
    .list::-webkit-scrollbar { width: 6px; background: transparent; }
    .list::-webkit-scrollbar-thumb { background: #d4d4d8; border-radius: 3px; }
    .row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 8px; cursor: pointer; white-space: nowrap; overflow: hidden; font-size: 12px; }
    .row:hover, .row.hov { background: var(--soft); }
    .row.on { background: color-mix(in srgb, var(--c) 14%, transparent); }
    .row .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; }
    .row .sz { flex: none; color: var(--mute); font-size: 11px; font-variant-numeric: tabular-nums; }
    .row .ck { flex: none; width: 16px; height: 16px; border-radius: 50%; display: none; place-items: center; color: #fff; background: var(--c); }
    .row .ck svg { width: 10px; height: 10px; stroke-width: 3; }
    .row.on .ck { display: grid; }
    .row.on .sz { display: none; }
    .none { padding: 14px; text-align: center; color: var(--mute); font-size: 12px; }
    .dot { width: 8px; height: 8px; border-radius: 2.5px; flex: none; }
    .half { display: flex; align-items: center; gap: 8px; padding: 10px 16px 12px; color: var(--mute); font-size: 12px; cursor: pointer; user-select: none; }
    .half input { display: none; }
    .sw { width: 26px; height: 15px; border-radius: 999px; background: var(--line); position: relative; transition: background .15s; flex: none; }
    .sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 11px; height: 11px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgb(0 0 0 / 20%); transition: transform .15s; }
    .half input:checked + .sw { background: var(--ink); }
    .half input:checked + .sw::after { transform: translateX(11px); }
    /* foot: state pill, status line, actions */
    .foot { display: flex; align-items: center; gap: 4px; padding: 12px 10px 12px 16px; border-top: 1px solid var(--line); }
    .pill { flex: none; width: 22px; height: 9px; border-radius: 999px; background: var(--ok); margin-right: 8px; transition: background .2s; }
    .panel.busy .pill { background: #f5a623; animation: pulse 1.1s ease-in-out infinite; }
    .panel.err .pill { background: #ef4444; }
    /* a link is down (bridge, or the Figma plugin): grey pill, the reason in place of the idle text */
    .panel[data-link] .pill { background: #9ca3af; animation: none; }
    .panel[data-link="bridge"] .status:empty::before { content: "no bridge: open Claude Code (a capture still saves to a file)"; }
    .panel[data-link="plugin"] .status:empty::before { content: "plugin closed: open Angelo in Figma"; }
    .panel[data-link="restart"] .status:empty::before { content: "bridge restarting…"; }
    @keyframes pulse { 50% { opacity: .35; } }
    .status { flex: 1; min-width: 0; color: var(--mute); font-size: 13px; line-height: 17px; word-break: break-word; }
    .status:empty::before { content: "send this page"; }
    .panel.busy .status:empty::before { content: "capturing…"; }
    /* capture running: head and foot only, the actions put away */
    .panel.busy .scope, .panel.busy .find, .panel.busy .list, .panel.busy .half, .panel.busy .foot button { display: none; }
    /* collapsed by hand: the head and the foot */
    .panel.min .scope, .panel.min .find, .panel.min .list, .panel.min .half { display: none; }
    /* phone only: built headless from the URL, the blocks and the half switch do not apply */
    .panel.phone .list, .panel.phone .find, .panel.phone .scope, .panel.phone .half, .panel.phone .scan { display: none; }
  </style>
  <div class="boxes"></div>
  <div class="panel">
    <div class="head"><span class="logo">${I.code}</span><span class="ttl">Angelo</span><span class="grow"></span><button class="ico quiet dock" title="Dock left / right">${I.swap}</button><button class="ico quiet fold" title="Collapse">${I.minus}</button><button class="ico close" title="Close">${I.x}</button></div>
    <div class="scope"><span class="sub"></span><button class="link clear" hidden>Clear</button></div>
    <div class="find">${I.search}<input type="text" placeholder="Filter blocks" spellcheck="false"></div>
    <div class="list"></div>
    <label class="half"><input type="checkbox"><span class="sw"></span>Top half of the page only</label>
    <div class="foot"><span class="pill"></span><span class="status"></span><button class="ico dev" title="Both: this tab, then the URL at phone width">${I.both}</button><button class="ico scan" title="Rescan">${I.scan}</button><button class="ico go" title="Send to Figma">${I.send}</button></div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  document.documentElement.appendChild(host);

  let blocks = [];
  let picked = new Set();
  let hover = -1;
  // the element one level below the hovered block, not yet a block: clicking it adds it
  let sub = null;
  let shown = true;

  const ancestorsOf = (i) => { const a = []; for (let p = blocks[i].parent; p >= 0; p = blocks[p].parent) a.push(p); return a; };
  const isUnder = (i, top) => ancestorsOf(i).includes(top);

  const scan = () => {
    blocks = globalThis.__angeloBlocks();
    picked = new Set();
    render();
  };

  let busy = false;
  let listKey = "";
  let query = "";
  const render = () => {
    if (busy) return;
    const boxes = $(".boxes");
    boxes.textContent = "";
    // a hovered sub-element (not a block) is cut out of the fills it lies on: black 0 % there
    const hole = sub && sub.el.getBoundingClientRect();
    const box = (b, cls, tag) => {
      const r = b.el.getBoundingClientRect();
      const d = document.createElement("div");
      d.className = "box" + cls;
      d.style.cssText = `--c:${color(b.level)};left:${r.left + scrollX}px;top:${r.top + scrollY}px;width:${r.width}px;height:${r.height}px;`;
      if (hole && cls.includes(" fill")) {
        const x0 = Math.max(hole.left, r.left) - r.left, y0 = Math.max(hole.top, r.top) - r.top;
        const x1 = Math.min(hole.right, r.right) - r.left, y1 = Math.min(hole.bottom, r.bottom) - r.top;
        if (x1 > x0 && y1 > y0) d.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x0}px ${y0}px, ${x1}px ${y0}px, ${x1}px ${y1}px, ${x0}px ${y1}px, ${x0}px ${y0}px)`;
      }
      if (tag) {
        d.innerHTML = `<div class="tag"><span class="n"></span><span class="d"></span></div>`;
        d.querySelector(".n").textContent = b.name;
        d.querySelector(".d").textContent = `${Math.round(r.width)}×${Math.round(r.height)}`;
      }
      boxes.appendChild(d);
    };
    // only the innermost blocks are filled: nested fills would stack (20 % over 20 %)
    const parents = new Set(blocks.map((b) => b.parent));
    const lit = (i) => hover >= 0 && !sub && (i === hover || isUnder(i, hover));
    blocks.forEach((b, i) => box(b, (parents.has(i) ? "" : " fill" + (lit(i) ? " lit" : "")) + (picked.has(i) ? " on" : "") + (hover === i && !sub ? " hov" : ""), picked.has(i) || (hover === i && !sub) || b.level === 1));
    if (sub) box(sub, " hov", true);
    const list = $(".list");
    // the row of the hovered block lit too (no rebuild: only its class moves)
    const mark = () => list.querySelectorAll(".row").forEach((r) => r.classList.toggle("hov", +r.dataset.i === hover));
    // the rows are rebuilt only when blocks, picks or the filter change: a rebuild under the pointer (hover, page
    // scroll) swallows the click and throws the list back to its top
    const key = blocks.map((b) => b.name + b.level).join("|") + "#" + [...picked].join(",") + "?" + query;
    if (key === listKey) return mark();
    listKey = key;
    const top = list.scrollTop;
    list.textContent = "";
    blocks.forEach((b, i) => {
      if (query && !b.name.toLowerCase().includes(query)) return;
      const r = b.el.getBoundingClientRect();
      const row = document.createElement("div");
      row.className = "row" + (picked.has(i) ? " on" : "");
      row.dataset.i = i;
      row.style.cssText = `--c:${color(b.level)};padding-left:${8 + (query ? 0 : (b.level - 1) * 14)}px`;
      row.innerHTML = `<span class="dot" style="background:${color(b.level)}"></span><span class="nm"></span><span class="sz">${Math.round(r.width)}×${Math.round(r.height)}</span><span class="ck">${I.check}</span>`;
      row.querySelector(".nm").textContent = b.name;
      row.onmouseenter = () => { hover = i; render(); };
      row.onclick = () => { toggle(i); b.el.scrollIntoView({ block: "start", behavior: "instant" }); };
      list.appendChild(row);
    });
    if (!list.children.length) list.innerHTML = `<div class="none">No block matches</div>`;
    list.scrollTop = top;
    mark();
    $(".sub").innerHTML = `<b>${blocks.length}</b> blocks · ${picked.size ? `<b>${picked.size}</b> picked` : "whole page"}`;
    $(".clear").hidden = !picked.size;
  };

  // a picked block replaces its picked ancestors and descendants
  const toggle = (i) => {
    if (picked.has(i)) picked.delete(i);
    else {
      for (const j of [...picked]) if (isUnder(j, i) || isUnder(i, j)) picked.delete(j);
      picked.add(i);
    }
    render();
  };

  // the deepest block under the pointer
  const blockAt = (target) => {
    let best = -1;
    blocks.forEach((b, i) => { if (b.el.contains(target) && (best < 0 || b.level > blocks[best].level)) best = i; });
    return best;
  };
  // the hovered block, and inside it the sub-element under the pointer (one level down)
  const subAt = (i, target) => {
    if (i < 0) return null;
    const s = globalThis.__angeloSub(blocks[i].el, target);
    return s && !blocks.some((b) => b.el === s.el) ? { ...s, level: blocks[i].level + 1, parent: i, kind: "sub-section" } : null;
  };
  const inPanel = (e) => e.composedPath().includes(host);
  const onMove = (e) => {
    if (inPanel(e)) return;
    const i = blockAt(e.target);
    const s = subAt(i, e.target);
    if (i !== hover || s?.el !== sub?.el) { hover = i; sub = s; render(); }
  };
  const onClick = (e) => {
    if (inPanel(e)) return;
    let i = blockAt(e.target);
    if (i < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const s = subAt(i, e.target);
    // a sub-element becomes a block, listed under its parent
    if (s) {
      i = s.parent + 1;
      while (i < blocks.length && isUnder(i, s.parent)) i++;
      blocks.splice(i, 0, s);
      blocks.forEach((b) => { if (b.parent >= i) b.parent++; });
      picked = new Set([...picked].map((j) => (j >= i ? j + 1 : j)));
      sub = null;
    }
    toggle(i);
  };
  let frame = 0;
  const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(render); };

  const listen = (on) => {
    const f = on ? addEventListener : removeEventListener;
    f("mousemove", onMove, true);
    f("click", onClick, true);
    f("scroll", onScroll, true);
    f("resize", onScroll, true);
  };

  // the overlay is hidden while the page is captured: a step that never ends would leave no trace,
  // so the last step and its start are kept for the watchdog in send
  let step = { text: "", at: 0 };
  const say = (t) => {
    step = { text: t, at: Date.now() };
    $(".status").textContent = t;
    $(".panel").classList.toggle("err", /fail|error|unreachable|stuck|reload|needs|refus/i.test(t));
  };
  // one message to the worker: its answer is always an object (a listener that replied nothing,
  // or a worker restarted under the call, answers undefined, which the callers read as a reply)
  const ask = async (msg) => (await chrome.runtime.sendMessage(msg)) ?? { error: "no answer from the extension worker" };
  // the frame staged at Go keeps its cursor held until told otherwise; sendMessage throws at
  // once (not a rejection) when the extension was reloaded under this tab
  // capture running: outlines gone, the panel collapsed to a notice (kept on screen, the page stays as is)
  const wait = () => { busy = true; $(".boxes").textContent = ""; $(".panel").classList.add("busy"); host.style.display = ""; };
  const idle = () => { busy = false; $(".panel").classList.remove("busy"); host.style.display = ""; render(); };
  // a pixel shot of the page: the notice is off for it (and only it), back right after
  const unseen = async (fn) => {
    host.style.display = "none";
    await new Promise((r) => setTimeout(r, 60));
    try { return await fn(); } finally { host.style.display = ""; }
  };
  // What a scrolled shot must not repeat: fixed layers (a header, a cookie bar) are set absolute
  // where they stand at the top of the page, sticky ones relative (their place in the flow), so
  // each shows once. Returns the undo.
  const pinFixed = () => {
    const kept = [];
    for (const el of document.querySelectorAll("*")) {
      if (el === host) continue;
      const pos = getComputedStyle(el).position;
      if (pos !== "fixed" && pos !== "sticky") continue;
      kept.push([el, el.getAttribute("style")]);
      if (pos === "sticky") { el.style.cssText += ";position:relative !important;top:auto !important;bottom:auto !important"; continue; }
      const r = el.getBoundingClientRect();
      el.style.cssText += `;position:absolute !important;top:${r.top + scrollY}px !important;left:${r.left + scrollX}px !important;right:auto !important;bottom:auto !important;width:${r.width}px !important;height:${r.height}px !important;margin:0 !important`;
      // a transform or a transformed ancestor moves it off its place: brought back by the difference
      const q = el.getBoundingClientRect();
      if (Math.abs(q.top - r.top) > 1 || Math.abs(q.left - r.left) > 1) el.style.cssText += `;top:${r.top + scrollY + r.top - q.top}px !important;left:${r.left + scrollX + r.left - q.left}px !important`;
    }
    return () => { for (const [el, st] of kept.reverse()) st === null ? el.removeAttribute("style") : el.setAttribute("style", st); };
  };
  // The reference shot, taken like GoFullPage: scrolled one viewport at a time, each visible tab
  // stitched by the worker. Throws when the document does not scroll (the caller shoots it whole).
  const stripShot = async (height, vw, vh) => {
    const root = document.documentElement;
    // the debugger shots before it leave their infobar up for a moment (-40 px of viewport: a 100vh
    // hero is shot 40 px shorter than captured, the page below shifts up): wait for the capture's height
    for (let t = Date.now(); innerHeight < vh && Date.now() - t < 6000; ) await globalThis.__angeloSleep(150);
    const [x0, y0, smooth] = [scrollX, scrollY, root.style.scrollBehavior];
    root.style.scrollBehavior = "auto";
    window.scrollTo(0, 0);
    await globalThis.__angeloPass(100);
    const unpin = pinFixed();
    try {
      // (viewport height at the shot, read next to the capture's: a 100vh hero follows it)
      globalThis.__angeloVhShot = innerHeight;
      const start = await ask({ type: "strip", start: true, width: vw, height });
      if (start.error) throw new Error(start.error);
      const last = Math.max(0, Math.min(height, Math.max(root.scrollHeight, document.body.scrollHeight)) - innerHeight);
      for (let y = 0; ; y = Math.min(y + innerHeight, last)) {
        window.scrollTo(0, y);
        // the page's own reveals and lazy pictures get the time to land
        await globalThis.__angeloPass(500);
        if (Math.abs(scrollY - y) > 2) throw new Error("the page does not scroll");
        // a lazy picture that came into view is loaded and decoded before the tile is taken
        // (porsche: whole rows of cards shot black, their image still on its way)
        const t0 = Date.now();
        while (Date.now() - t0 < 5000) {
          const wait = [...document.images].filter((i) => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 40 && r.height > 40 && getComputedStyle(i).visibility !== "hidden"; });
          if (wait.every((i) => i.complete && i.naturalWidth > 0)) { await Promise.all(wait.map((i) => i.decode().catch(() => {}))); break; }
          await globalThis.__angeloSleep(150);
        }
        // a player in view (oatly: Vimeo backgrounds) paints late: shot flat, the reference would show
        // an empty card where the build, rightly, has the video
        if ([...document.querySelectorAll("iframe")].some((f) => { const r = f.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 40 && r.height > 40; })) await globalThis.__angeloSleep(1800);
        // a block still hydrating (skeleton shorter than its content, nytimes rail) is shot once the
        // document height and its text stop changing, 3 s at most
        const sig = () => `${Math.max(root.scrollHeight, document.body.scrollHeight)}:${document.body.innerText.length}`;
        for (let s = sig(), same = 0, t1 = Date.now(); same < 2 && Date.now() - t1 < 3000; ) {
          await globalThis.__angeloSleep(300);
          const n = sig();
          same = n === s ? same + 1 : 0;
          s = n;
        }
        await globalThis.__angeloPass(200);
        const t = await ask({ type: "strip", y: scrollY, innerWidth });
        if (t.error) throw new Error(t.error);
        if (y >= last) break;
      }
      return await ask({ type: "strip" });
    } finally {
      unpin();
      root.style.scrollBehavior = smooth;
      window.scrollTo(x0, y0);
    }
  };
  const unstage = () => { try { chrome.runtime.sendMessage({ type: "stage", cancel: true }).catch(() => {}); } catch {} };

  // Every picture a box points at, inside the capture: a file must build with no network.
  const attachImages = async (cap) => {
    const bgUrl = (b) => (/url\((?:"([^"]+)"|'([^']+)'|([^)]+))\)/.exec(b.bgImg || "") || []).slice(1).find(Boolean);
    const remote = (u) => typeof u === "string" && /^https?:/.test(u);
    const urls = [...new Set(cap.boxes.flatMap((b) => [b.img, bgUrl(b)]).filter(remote))];
    const got = new Map();
    let next = 0;
    const worker = async () => {
      while (next < urls.length) {
        const u = urls[next++];
        const { data } = await ask({ type: "bytes", url: u });
        if (data) got.set(u, data);
        say(`attaching pictures: ${got.size}/${urls.length}`);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    for (const b of cap.boxes) {
      if (got.has(b.img)) b.img = got.get(b.img);
      const bg = bgUrl(b);
      if (got.has(bg)) b.bgImg = b.bgImg.replace(bg, () => got.get(bg));
    }
    return { urls: urls.length, got: got.size };
  };
  const saveFile = (name, text) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  };

  // Anything thrown on the way (settle, capture, the worker gone) must give the
  // page back: overlay shown, scroll released, isolation off, button enabled.
  const send = async () => {
    const go = $(".go");
    go.disabled = true;
    // a capture script out of step with this overlay (extension reloaded, tab not): stop clean
    if (typeof globalThis.__angeloPrepare !== "function" || typeof globalThis.__angeloFrameShots !== "function") {
      say("extension updated: reload this tab, then click the Angelo icon again");
      go.disabled = false;
      return;
    }
    // a step stuck past 45 s (a shot waiting for a frame, a scroll that never settles): the overlay
    // comes back with the step name, the capture keeps waiting behind it
    const watch = setInterval(() => {
      const s = Math.round((Date.now() - step.at) / 1000);
      if (host.style.display === "none" && s > 45) { host.style.display = ""; $(".status").textContent = `stuck ${s} s at: ${step.text}`; }
    }, 5000);
    try {
      await (device === "mobile" ? sendMobile(go) : sendInner(go));
    } catch (e) {
      // the root error first, in the console: what follows must not hide it
      console.error("[angelo]", e);
      unstage();
      globalThis.__angeloIsolate?.(false);
      globalThis.__angeloHold?.(false);
      idle();
      // the extension reloaded since this tab was: its overlay can no longer reach the worker
      say(/context invalidated/i.test(e?.message) ? "extension reloaded: reload this tab" : `failed: ${e?.message || e}`);
      go.disabled = false;
    } finally {
      clearInterval(watch);
      globalThis.__angeloRelock?.();
    }
  };

  const sendInner = async (go) => {
    // kept: the picked blocks, their ancestors (backgrounds, page frame) and everything under them
    const keep = new Set();
    for (const i of picked) [i, ...ancestorsOf(i)].forEach((k) => keep.add(k));
    // nothing picked = the whole page, floating overlays (chat, cookie banners) aside
    const overlay = (i) => [i, ...ancestorsOf(i)].some((k) => blocks[k].kind === "overlay");
    const kept = (i) => (!picked.size ? !overlay(i) : keep.has(i) || [...picked].some((p) => isUnder(i, p)));
    const skip = new Set(blocks.filter((_, i) => !kept(i)).map((b) => b.el));
    const names = new Map(blocks.filter((_, i) => kept(i)).map((b) => [b.el, b.name]));
    // Figma answers at once: empty frame + cursor, while the page scrolls and captures below.
    // A refusal (bridge down, plugin closed, busy) stops here, before the long part.
    // the Figma frame is named after the picked blocks: another section of the page gets its own
    // frame, the same section sent again replaces its frame
    const part = [...picked].sort((a, b) => a - b).map((i) => blocks[i].name).join(" + ");
    // layout width, scrollbar excluded: innerWidth counts it and the first FILL child of each
    // row then absorbs the extra 15 px (image narrower than its card in Figma)
    const vw = document.documentElement.clientWidth || innerWidth;
    const staged = await ask({ type: "stage", url: location.href, part, width: vw });
    // no bridge: the capture goes to a file, with its pictures, for the Figma plugin to build
    const offline = /bridge unreachable/.test(staged.error || "");
    if (staged.error && !offline) { say(staged.error); go.disabled = false; return; }
    wait();
    // same preparation as the headless capture: content-visibility rendered (the height below is
    // real), lazy content loaded by one quick scroll, images and network waited out, back to the top
    say("preparing the page (lazy content)…");
    const prep = await globalThis.__angeloPrepare();
    if (prep.gone) say(`pictures unmounted by the scroll: ${prep.gone}, put back ${prep.kept} (already back ${prep.skip.back}, slot gone ${prep.skip.detached}, slot refilled ${prep.skip.filled})`);
    if (prep.inner) say(`inner scroller released: ${prep.inner}`);
    if (prep.pending) say(`${prep.pending} images still loading after ${prep.ms} ms, capturing anyway…`);
    const t0 = Date.now();
    // scrollHeight can be the viewport when the body scrolls itself
    const full = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    const height = $(".half input").checked ? Math.round(full / 2) : full;
    globalThis.__angeloHold(true);
    prep.vh = innerHeight;
    say("reading the page boxes…");
    const capture = await globalThis.__angeloMaskIcons(globalThis.__angeloCapture({ skip, names, until: height }));
    say("reading the page's own pictures…");
    const own = await globalThis.__angeloInlineImages(capture);
    prep.inlined = own;
    // canvases (2D / WebGL): their pixels alone, the rest of the page hidden
    const canvases = capture.boxes.filter((b) => b.canvas);
    if (canvases.length) {
      say("shooting canvases…");
      const bottom = Math.ceil(Math.max(...canvases.map((b) => b.py + b.h)));
      let layer;
      try {
        layer = await unseen(async () => {
          globalThis.__angeloIsolate(true);
          const r = await ask({ type: "shot", dpr: devicePixelRatio, width: vw, height: bottom, alpha: true });
          // the shot's debugger leaves its infobar up (-40 px of viewport, the vh-sized blocks above
          // shrink): each canvas is cut where it stands now, not where the capture read it
          // (porsche: the footer cut 82 px too low, its content shifted up in Figma)
          for (const b of canvases) {
            const el = document.querySelector(`[data-angelo-media="${b.id}"]`);
            if (!el) continue;
            const now = el.getBoundingClientRect().top + scrollY;
            if (Math.abs(now - b.py) >= 1) { (prep.shifted ||= []).push([b.id, Math.round(b.py), Math.round(now)]); b.py = now; }
          }
          return r;
        });
      } finally {
        globalThis.__angeloIsolate(false);
      }
      if (layer.data) await globalThis.__angeloCanvasFill(capture, "data:image/png;base64," + layer.data);
    }
    // media the shot left empty (a video off screen): its still from the element, else its poster
    if (canvases.some((b) => b.blank || b.partial || !b.img)) {
      say("media stills…");
      await globalThis.__angeloMediaStill(capture);
    }
    // iframes (ads, embeds) and blocks read empty (a carousel rendered in view): each scrolled into view, shot from the viewport
    {
      say("shooting iframes and blocks read empty…");
      const fr = await globalThis.__angeloFrameShots(capture, (rect) => unseen(async () => (await ask({ type: "view", rect, dpr: devicePixelRatio })).data || null));
      prep.shots = fr;
      say(`shot in view: ${fr.got}/${fr.frames}${fr.skipped ? `, ${fr.skipped} left out (time budget)` : ""}`);
    }
    // the reference screenshot, overlay still hidden: the build is checked against it
    let shot;
    // the beyond-viewport shot grows the view to the page height: the scrollbar goes and the layout
    // widens by its width (full-bleed images at a fixed ratio grow taller, cos: +0.9 % drift down
    // the page); its gutter is kept so the shot is laid out at the captured width
    const gutter = document.documentElement.style.scrollbarGutter;
    document.documentElement.style.scrollbarGutter = "stable";
    try {
      // (the reference only serves the bridge's check)
      if (offline) shot = {};
      else {
        say(`reference shot, ${height} px…`);
        // scrolled and stitched like GoFullPage (the page's reveals run); the beyond-viewport shot
        // when the document does not scroll or a tile fails
        shot = await unseen(() => stripShot(height, vw, prep.vh)).catch((e) => ({ error: e.message || String(e) }));
        if (shot.error) {
          say(`reference shot (${shot.error}), whole page at once…`);
          shot = await unseen(() => ask({ type: "shot", dpr: devicePixelRatio, width: vw, height }));
        }
      }
    } finally {
      document.documentElement.style.scrollbarGutter = gutter;
      prep.vhShot = globalThis.__angeloVhShot;
      globalThis.__angeloHold(false);
      globalThis.__angeloUnkeep();
    }
    if (offline) {
      prep.attached = await attachImages(capture);
      const name = `${location.hostname.replace(/^www\./, "")}.angelo.json`;
      saveFile(name, JSON.stringify({ url: location.href, width: vw, prep, ...capture }));
      idle();
      say(`no bridge: saved ${name}, ${prep.attached.got}/${prep.attached.urls} pictures. Drop it on the Angelo plugin in Figma`);
      go.disabled = false;
      return;
    }
    say(`${capture.boxes.length} boxes captured in ${Date.now() - t0} ms, sending…${shot.error ? ` (${shot.error}, no check)` : ""}`);
    const res = await ask({ type: "send", url: location.href, part, capture: { width: vw, prep, ...capture }, shot: shot.data, shotError: shot.error, mobile: device === "both" });
    if (res.error) { unstage(); idle(); say(res.error); go.disabled = false; return; }
    await follow();
    idle();
    go.disabled = false;
  };

  // the build runs in the bridge: its last line until done (a desktop + phone run goes on
  // through both jobs). A loop, not a timer chain: a throw on a later poll (extension reloaded,
  // worker gone) lands in send's catch instead of leaving the button disabled for good
  const follow = async () => {
    let boot = null;
    for (;;) {
      const j = await ask({ type: "job" });
      if (j.error) { say(j.error); break; }
      // another bridge process answers: the one that ran the build is gone, and the build with it
      if (boot && j.boot && j.boot !== boot && !j.job) { say("bridge restarted during the build: send again (failed)"); break; }
      boot = j.boot || boot;
      if (j.last) say(j.last.text);
      // no job and no status: nothing left to wait for
      if (!j.job && !(j.last && !j.last.done)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  };

  // ---------- links: the same state as the Figma plugin shows, asked every 2 s while shown ----------
  // The worker says hello to the bridge and answers with every link; the pill's tooltip lists
  // them, the idle line names the one that is down. A worker gone for good (extension reloaded
  // under this tab) ends the poll: the new worker injects a fresh overlay by itself.
  const LINK_MS = 2000;
  const showLinks = (st) => {
    const l = st.links || {};
    const down = !l.bridge ? "bridge" : st.bridge?.stale ? "restart" : !l.plugin ? "plugin" : "";
    const panel = $(".panel");
    if (down) panel.dataset.link = down;
    else delete panel.dataset.link;
    $(".pill").title = [
      `bridge: ${l.bridge ? "connected" : "no bridge"}`,
      `Figma plugin: ${l.plugin ? "connected" : l.bridge ? "closed" : "unknown"}`,
      `Claude: ${l.claude ? "connected" : l.bridge ? "no session seen" : "unknown"}`,
    ].join("\n");
    // a refusal shown before the link came back ("plugin disconnected", "bridge unreachable") is stale now
    if (!down && !busy && /plugin disconnected|bridge unreachable|needs the bridge/.test($(".status").textContent)) say("");
  };
  const poll = async () => {
    if (!shown || document.hidden) return;
    try {
      const st = await chrome.runtime.sendMessage({ type: "status", busy });
      if (st) showLinks(st);
    } catch {
      clearInterval(linkTimer);
    }
  };
  const linkTimer = setInterval(poll, LINK_MS);
  setTimeout(poll, 0);

  // phone only: nothing captured in this tab, the bridge captures the URL at 430 headless
  const sendMobile = async (go) => {
    const part = [...picked].sort((a, b) => a - b).map((i) => blocks[i].name).join(" + ");
    const res = await ask({ type: "mobile", url: location.href, part });
    if (res.error) { say(/bridge unreachable/.test(res.error) ? "mobile needs the bridge (npm run bridge)" : res.error); go.disabled = false; return; }
    say("mobile capture started in the bridge…");
    await follow();
    go.disabled = false;
  };

  // one button cycles the target: this tab, the URL at phone width (430, headless, whole page), both
  const DEVICES = [
    ["desktop", "Desktop: this tab as it is"],
    ["mobile", "Mobile: the URL at phone width (430), captured headless by the bridge, whole page"],
    ["both", "Both: this tab, then the URL at phone width"],
  ];
  let device = "both";
  $(".dev").onclick = (e) => {
    const [d, title] = DEVICES[(DEVICES.findIndex(([k]) => k === device) + 1) % DEVICES.length];
    device = d;
    e.currentTarget.innerHTML = I[d];
    e.currentTarget.title = title;
    $(".panel").classList.toggle("phone", device === "mobile");
  };

  // panel chrome: filter, clear the picks, dock side, collapse
  const find = $(".find input");
  find.oninput = () => { query = find.value.trim().toLowerCase(); render(); };
  // typing must not trigger the page's own shortcuts
  for (const t of ["keydown", "keyup", "keypress"]) find.addEventListener(t, (e) => e.stopPropagation());
  $(".clear").onclick = () => { picked = new Set(); render(); };
  $(".dock").onclick = () => $(".panel").classList.toggle("left");
  $(".fold").onclick = (e) => { const m = $(".panel").classList.toggle("min"); e.currentTarget.innerHTML = m ? I.plus : I.minus; };
  $(".close").onclick = () => globalThis.__angeloOverlay.toggle();
  $(".scan").onclick = () => { find.value = ""; query = ""; scan(); };
  $(".go").onclick = send;
  $(".panel").onmouseleave = () => { hover = -1; sub = null; render(); };

  globalThis.__angeloOverlay = {
    toggle() {
      shown = !shown;
      // a closed overlay is not put back after the extension updates itself
      if (!shown) try { chrome.runtime.sendMessage({ type: "bye" }).catch(() => {}); } catch {}
      else poll();
      host.style.display = shown ? "" : "none";
      listen(shown);
      if (shown) scan();
    },
  };
  listen(true);
  scan();
})();
