// Service worker: injects the overlay on the toolbar click, and talks to the Angelo bridge
// (the page itself cannot reach 127.0.0.1: CORS, CSP, local network access).

const BRIDGE = "http://127.0.0.1:8787";

const FILES = ["lib/capture.js", "content.js"];
const inject = (tabId) => chrome.scripting.executeScript({ target: { tabId }, files: FILES });

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await inject(tab.id);
  } catch (error) {
    // a restricted page (chrome://, the web store): nothing to inject into, say so on the icon
    console.warn("[angelo] cannot inject here:", error?.message || error);
    chrome.action.setBadgeText({ tabId: tab.id, text: "!" }).catch(() => {});
    setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: "" }).catch(() => {}), 2500);
  }
});

// One call to the bridge. Bounded (a bridge that accepts and never answers must not hang the
// overlay). Only idempotent calls are retried (the bridge restarts by itself when its source
// changes, which leaves the port closed for a fraction of a second): a browser cannot tell a
// refused connection from one cut after the request went through, and a second POST /capture
// could start a second job. A POST is sent once, after a liveness check that rides out a restart.
// Errors: `unreachable` = nothing listening (the offline fallback may apply); `pending` = the
// request may have reached the bridge and still be running.
const RETRY_GAPS = [300, 700, 1200];
const IDEMPOTENT = /^\/(hello|job)$/;
const call = async (path, init = {}, wait = 40000) => {
  const safe = IDEMPOTENT.test(path) || !init.method || init.method === "GET";
  const secs = Math.round(wait / 1000);
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(BRIDGE + path, { ...init, signal: AbortSignal.timeout(wait) });
      try {
        return await res.json();
      } catch (error) {
        if (error?.name === "SyntaxError") return { error: `unreadable bridge response on ${path} (HTTP ${res.status})`, pending: !safe };
        throw error;
      }
    } catch (error) {
      if (error && error.name === "TimeoutError") {
        return safe
          ? { error: `bridge silent for ${secs} s on ${path}` }
          : { error: `no reply from the bridge in ${secs} s on ${path}: the job may still run, check Figma`, pending: true };
      }
      if (!safe) return { error: `connection to the bridge lost during ${path}: it may have been received, check Figma`, pending: true };
      if (i >= RETRY_GAPS.length) return { error: "bridge unreachable (it starts with Claude Code, or: npm run bridge)", unreachable: true };
      await new Promise((r) => setTimeout(r, RETRY_GAPS[i]));
    }
  }
};
const post = async (path, body, wait) => {
  const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  if (!IDEMPOTENT.test(path)) {
    const alive = await call("/hello", { method: "POST", headers: init.headers, body: JSON.stringify({ role: "extension", version: chrome.runtime.getManifest().version }) }, 3000);
    if (alive.error) return alive;
  }
  return call(path, init, wait);
};

// base64 of bytes: the native encoder where the browser has it, else chunked
const b64 = (bytes) => {
  if (typeof bytes.toBase64 === "function") return bytes.toBase64();
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

// ---------- self-update ----------
// The worker keeps the background.js it was registered with until the extension is reloaded,
// whatever is on disk. What it was loaded from is hashed once at install/reload and kept (the
// Cache API survives the worker's sleep); the bridge answers hello with the hash of the files
// on disk. Different → the extension reloads itself and puts the overlay back in the tabs
// that had it. Never twice for the same target, never during a capture.
const META = "https://angelo.invalid/";
const meta = {
  async get(key) {
    try {
      const hit = await (await caches.open("angelo")).match(META + key);
      return hit ? await hit.json() : null;
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      await (await caches.open("angelo")).put(META + key, new Response(JSON.stringify(value)));
    } catch {}
  },
};
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
// same recipe as the bridge (extensionVersion in bridge/src/server.mjs)
const diskHash = async () => {
  const parts = await Promise.all(["background.js", "manifest.json"].map(async (f) => new Uint8Array(await (await fetch(chrome.runtime.getURL(f), { cache: "no-store" })).arrayBuffer())));
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return hex(await crypto.subtle.digest("SHA-256", all)).slice(0, 12);
};

chrome.runtime.onInstalled.addListener(async () => {
  await meta.set("loaded", await diskHash().catch(() => null));
  const tabs = (await meta.get("reopen")) || [];
  await meta.set("reopen", []);
  await meta.set("tabs", {}); // the overlays put back register again on their first poll
  for (const tabId of tabs) inject(tabId).catch(() => {});
});

// Tabs showing the overlay → when each last said it was capturing (0: idle). Kept with meta, not
// in worker memory: the worker is stopped after 30 s without events, which happens as soon as
// every overlay sits in a hidden tab (no poll there), and a reload would then forget those tabs.
// Updates are chained: two tabs polling at once must not overwrite each other.
const BUSY_FRESH = 10000; // ms: a capturing overlay polls every 2 s
let tabsChain = Promise.resolve();
const updateTabs = (change) => (tabsChain = tabsChain.then(async () => {
  const tabs = (await meta.get("tabs")) || {};
  change(tabs);
  await meta.set("tabs", tabs);
  return tabs;
}));

const selfUpdate = async (target, capturing, tabs) => {
  if (!target || capturing) return false;
  let loaded = await meta.get("loaded");
  if (!loaded) {
    // never recorded (first run of this code): what is on disk now is what was loaded
    loaded = await diskHash().catch(() => null);
    await meta.set("loaded", loaded);
  }
  if (!loaded || loaded === target || (await meta.get("reloadedFor")) === target) return false;
  await meta.set("reloadedFor", target);
  await meta.set("reopen", Object.keys(tabs).map(Number));
  chrome.runtime.reload();
  return true;
};

// The state of every link, asked by the overlay every 2 s while it is shown
const linkStatus = async (tabId, capturing) => {
  const tabs = tabId === undefined
    ? (await meta.get("tabs")) || {}
    : await updateTabs((t) => { t[tabId] = capturing ? Date.now() : 0; });
  // a capture running in another tab holds the reload too
  const busy = Object.values(tabs).some((at) => Date.now() - at < BUSY_FRESH);
  const res = await post("/hello", { role: "extension", version: chrome.runtime.getManifest().version }, 3000);
  if (res.error || !res.links) return { links: { bridge: false, plugin: false, claude: false }, error: res.error };
  if (await selfUpdate(res.extension, busy, tabs)) return { links: res.links, reloading: true };
  return { links: res.links, bridge: res.bridge, job: res.job };
};

// Full-page JPEG of the tab as the user sees it (session, cookies): the reference web-compare
// checks the Figma build against. captureVisibleTab only sees the viewport, hence the debugger.
// One shot of a long page comes back empty past the GPU texture limit (Dia: 14957 css px at
// dpr 2): shot in tiles, stitched at 1x css in an OffscreenCanvas (dimension limit 32767)
const MAX_SHOT = 30000; // css px
const TILE_PX = 8000; // device px per tile
const SHOT_WAIT = 20000; // ms per tile
// height: asked by the page, Page.getLayoutMetrics can answer the viewport (Dia)
// alpha: transparent PNG (the canvases alone, page hidden by __angeloIsolate)
const shoot = async (tabId, width, asked, alpha, dpr = 1) => {
  const target = { tabId };
  await chrome.debugger.attach(target, "1.3");
  try {
    const { cssContentSize } = await chrome.debugger.sendCommand(target, "Page.getLayoutMetrics");
    const height = Math.min(Math.ceil(asked || cssContentSize.height), MAX_SHOT);
    const tile = Math.max(500, Math.floor(TILE_PX / dpr));
    const type = alpha ? "image/png" : "image/jpeg";
    if (alpha) await chrome.debugger.sendCommand(target, "Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    // a beyond-viewport shot can wait forever for a frame (cos coats: page left blank, debugger
    // attached): each tile is bounded, the capture goes on without its reference
    const grab = (y, h) => {
      let timer;
      return Promise.race([
        chrome.debugger.sendCommand(target, "Page.captureScreenshot", {
          ...(alpha ? { format: "png" } : { format: "jpeg", quality: 90 }), captureBeyondViewport: true, clip: { x: 0, y, width, height: h, scale: 1 },
        }),
        new Promise((_, no) => { timer = setTimeout(() => no(new Error(`tile at y ${y} of ${height} px timed out`)), SHOT_WAIT); }),
      ]).finally(() => clearTimeout(timer));
    };
    try {
      // the first beyond-viewport shot resizes the view and can come back stretched (nyt: top tile
      // drawn 2x tall): a throwaway shot first, the tiles after it are taken at the settled size
      await grab(0, Math.min(tile, height));
      for (let y = 0; y < height; y += tile) {
        const h = Math.min(tile, height - y);
        const { data } = await grab(y, h);
        if (!data) throw new Error(`empty tile at y ${y}`);
        const bmp = await createImageBitmap(await (await fetch(`data:${type};base64,${data}`)).blob());
        ctx.drawImage(bmp, 0, y, width, h);
        bmp.close();
      }
    } finally {
      if (alpha) await chrome.debugger.sendCommand(target, "Emulation.setDefaultBackgroundColorOverride", {});
    }
    const blob = await canvas.convertToBlob(alpha ? { type } : { type, quality: 0.8 });
    return { data: b64(new Uint8Array(await blob.arrayBuffer())) };
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
};

// One rect of the viewport as the compositor shows it (iframes included): JPEG data URL, or
// null when the rect is flat (an ad slot that never filled)
const view = async (windowId, { x, y, w, h }, dpr = 1) => {
  const url = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  const bmp = await createImageBitmap(await (await fetch(url)).blob());
  const s = bmp.width / Math.max(1, Math.round(bmp.width / dpr));
  const [W, H] = [Math.round(w), Math.round(h)];
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, x * s, y * s, w * s, h * s, 0, 0, W, H);
  bmp.close();
  const px = ctx.getImageData(0, 0, W, H).data;
  let n = 0, sum = 0, sq = 0;
  for (let i = 0; i < px.length; i += 16) { const l = (px[i] + px[i + 1] + px[i + 2]) / 3; n++; sum += l; sq += l * l; }
  if (Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)) <= 10) return { data: null };
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 })).arrayBuffer());
  return { data: "data:image/jpeg;base64," + b64(bytes) };
};

// Reference shot by scrolling, as GoFullPage does: the page is scrolled one viewport at a time and
// each visible tab is stitched into a canvas at 1x css. The page's own scroll-triggered reveals
// run (a hero caption shown when it enters the view) and lazy pictures load, which a
// beyond-viewport shot never wakes. captureVisibleTab answers at most 2 calls a second.
// One canvas per tab: two tabs capturing must not draw into each other's shot.
const strips = new Map();
let lastStrip = 0;
const STRIP_GAP = 600; // ms between two captureVisibleTab calls
const strip = async (tab, m) => {
  const key = tab.id;
  if (m.abort) { strips.delete(key); return {}; }
  if (m.start) strips.set(key, new OffscreenCanvas(m.width, Math.min(m.height, MAX_SHOT)));
  const canvas = strips.get(key);
  if (!canvas) throw new Error("no shot started");
  if (m.y !== undefined) {
    const wait = lastStrip + STRIP_GAP - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastStrip = Date.now();
    const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    lastStrip = Date.now();
    const bmp = await createImageBitmap(await (await fetch(url)).blob());
    const s = bmp.width / m.innerWidth;
    canvas.getContext("2d").drawImage(bmp, 0, 0, bmp.width, bmp.height, 0, m.y, bmp.width / s, bmp.height / s);
    bmp.close();
    return {};
  }
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
  strips.delete(key);
  return { data: b64(new Uint8Array(await blob.arrayBuffer())) };
};

// A picture as a data URL, for a capture saved to a file: the worker's fetch has no CORS, the page's has.
const MAX_ATTACHED = 30_000_000;
const imageData = async (url) => {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return {};
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_ATTACHED) return {};
  return { data: `data:${res.headers.get("content-type")?.split(";")[0] || "image/png"};base64,${b64(bytes)}` };
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // these three act on the sender's tab: a message from anywhere else has none
  if (["shot", "strip", "view"].includes(msg.type) && !sender.tab) { reply({ error: `${msg.type}: no tab on this message` }); return; }
  if (msg.type === "shot") {
    shoot(sender.tab.id, msg.width, msg.height, msg.alpha, msg.dpr).catch((e) => ({ error: `screenshot: ${e.message || e}` })).then(reply);
    return true;
  }
  if (msg.type === "strip") {
    strip(sender.tab, msg).catch((e) => { strips.delete(sender.tab.id); return { error: `strip: ${e.message || e}` }; }).then(reply);
    return true;
  }
  if (msg.type === "view") {
    view(sender.tab.windowId, msg.rect, msg.dpr).catch((e) => ({ error: `view: ${e.message || e}` })).then(reply);
    return true;
  }
  if (msg.type === "stage") {
post("/stage", { url: msg.url, part: msg.part, width: msg.width, cancel: msg.cancel }).then(reply);
    return true;
  }
  if (msg.type === "send") {
post("/capture", { url: msg.url, part: msg.part, capture: msg.capture, shot: msg.shot, shotError: msg.shotError, mobile: msg.mobile }, 90000).then(reply);
    return true;
  }
  if (msg.type === "mobile") {
post("/mobile", { url: msg.url, part: msg.part }).then(reply);
    return true;
  }
  if (msg.type === "job") {
    call("/job", {}, 5000).then(reply);
    return true;
  }
  if (msg.type === "status") {
    linkStatus(sender.tab?.id, msg.busy).catch((e) => ({ links: { bridge: false }, error: String(e.message || e) })).then(reply);
    return true;
  }
  if (msg.type === "bye") {
    const tabId = sender.tab?.id;
    if (tabId !== undefined) updateTabs((t) => { delete t[tabId]; }).catch(() => {});
    return;
  }
  if (msg.type === "bytes") {
    imageData(msg.url).catch(() => ({})).then(reply);
    return true;
  }
});
