// What the image and board execs send to the plugin, free of Node (see web-run.mjs).
export const BATCH = 10;
export const BATCH_BYTES = 900_000;
// What one image may weigh, and Figma's limit on a side ("Image is too large")
export const MAX_IMG = 4_000_000;
export const MAX_SIDE = 4096;
// In an exec: an image's bytes from its url, served by the bridge or carried in the exec (a data url)
export const BYTES_JS = `const bytesOf = async (url) => url.startsWith("data:") ? figma.base64Decode(url.slice(url.indexOf(",") + 1)) : new Uint8Array(await (await fetch(url)).arrayBuffer());`;

// Places fetched images ({id, svg} | {id, url}) into the nodes named `img:<id>` under rootId,
// instance sublayers included, in one exec with one short glide. Returns one boolean per image.
// slotIds (optional): image id → the node ids of its slots, recorded by the build; without it, or
// when one is gone, the slots are found by walking the root and moreIds
// mixed (optional): the mains whose instances show different pictures (see mixedMains)
export async function placeImages(rpc, rootId, B, moreIds = [], slotIds = null, mixed = []) {
  const known = slotIds && Object.fromEntries(B.map((b) => [b.id, slotIds[b.id] || null]));
  // Figma losing its server for a moment fails the exec midway: the same lot again, slots already
  // done are skipped
  for (let tries = 3; ; tries--) {
    try { return await placeLot(rpc, rootId, B, moreIds, known, mixed); }
    catch (e) {
      if (tries <= 1 || !/Unable to establish connection/.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
// The mains whose slots hold more than one picture: an svg put in such a main would show in every
// instance, over the others' pictures. slotIds: image id → node ids, srcs: [{ id, src }]
export function mixedMains(slotIds, srcs) {
  const seen = new Map();
  for (const s of srcs) for (const id of slotIds[s.id] || []) {
    const main = id.split(";").pop();
    (seen.get(main) || seen.set(main, new Set()).get(main)).add(s.src);
  }
  return [...seen].filter(([, pictures]) => pictures.size > 1).map(([main]) => main);
}
function placeLot(rpc, rootId, B, moreIds, known, mixed) {
  return rpc(`
const root = await H.byId(${JSON.stringify(rootId)});
const B = ${JSON.stringify(B)};
const MIXED = new Set(${JSON.stringify(mixed)});
const mixedMain = (r) => MIXED.has(r.id.split(";").pop());
// a slot is a layer named img:<id>, or a frame whose image background is marked in plugin data;
// one id may have several slots (a component's main and its first instance)
const slots = new Map();
const add = (k, n) => (slots.get(k) || slots.set(k, []).get(k)).push(n);
const KNOWN = ${JSON.stringify(known)};
let walk = !KNOWN;
if (KNOWN) for (const [k, ids] of Object.entries(KNOWN)) {
  if (!ids) { walk = true; break; }
  const ns = await Promise.all(ids.map((id) => H.byId(id)));
  if (ns.some((n) => !n || n.removed)) { walk = true; break; }
  ns.forEach((n) => add(k, n));
}
if (walk) {
  slots.clear();
  for (const top of [root, ...(await Promise.all(${JSON.stringify(moreIds)}.map((id) => H.byId(id))))])
    // an instance sublayer gone while the walk runs throws on any read: not a slot
    for (const n of top.findAll((n) => { try { return n.name.startsWith("img:") || ("layoutMode" in n && !!n.getPluginData("img")); } catch { return false; } })) add(n.name.startsWith("img:") ? n.name.slice(4) : n.getPluginData("img"), n);
}
const c = await H.cursor();
// the cursor follows slots on this page only (mains sit on the components page)
const onPage = (n) => { for (; n && n.type !== "PAGE"; n = n.parent); return n === figma.currentPage; };
const first = slots.get(String(B.find((b) => !b.drop)?.id))?.find(onPage);
if (first) { c.ring.follow(first); await c.to(first, 230); }
const out = [];
// natural width from the header bytes (getSizeAsync may wait on Figma's server): PNG, GIF, JPEG
const widthOf = (u) => {
  if (u[0] === 0x89 && u[1] === 0x50) return (u[16] << 24) | (u[17] << 16) | (u[18] << 8) | u[19];
  if (u[0] === 0x47 && u[1] === 0x49) return u[6] | (u[7] << 8);
  if (u[0] === 0xff && u[1] === 0xd8) for (let i = 2; i + 8 < u.length; i += 2 + ((u[i + 2] << 8) | u[i + 3])) {
    if (u[i] !== 0xff) return 0;
    if (u[i + 1] >= 0xc0 && u[i + 1] <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(u[i + 1])) return (u[i + 7] << 8) | u[i + 8];
  }
  return 0;
};
// a tiled background (background-size in px, set on any slot of the id, the main included): TILE at that size
// (a component reused from an earlier build: its main is not a slot of this one, the instance
// slot carries no plugin data → read the main, else keep its TILE fill)
// a cropped image (cut by a clipping ancestor): its whole box [dx, dy, w, h] against the slot,
// on the slot or on its main
// (a CSS filter on the image, brightness / saturate / contrast, read the same way → the fill's filters)
const dataOf = async (r, key) => {
  const own = r.getPluginData(key);
  if (own || !r.id.startsWith("I")) return own ? JSON.parse(own) : null;
  const m = await figma.getNodeByIdAsync(r.id.split(";").pop());
  return m && m.getPluginData(key) ? JSON.parse(m.getPluginData(key)) : null;
};
const cropOf = (r) => dataOf(r, "crop");
${BYTES_JS}
const imgFill = async (rs, url) => {
  const f = await imgFill1(rs, url), fx = await dataOf(rs[0], "fx");
  // (mono and invert recolour a vector, no image filter for them)
  const { mono, invert, ...filters } = fx || {};
  return Object.keys(filters).length ? { ...f, filters } : f;
};
const imgFill1 = async (rs, url) => {
  const u = await bytesOf(url), im = figma.createImage(u);
  const k = await cropOf(rs[0]);
  if (k) return { type: "IMAGE", imageHash: im.hash, scaleMode: "CROP", imageTransform: [[rs[0].width / k[2], 0, -k[0] / k[2]], [0, rs[0].height / k[3], -k[1] / k[3]]] };
  const mains = [];
  for (const r of rs) if (r.id.startsWith("I")) { const m = await figma.getNodeByIdAsync(r.id.split(";").pop()); if (m) mains.push(m); }
  const tile = Math.max(0, ...[...rs, ...mains].map((r) => +r.getPluginData("tile") || 0));
  const kept = mains.flatMap((m) => (Array.isArray(m.fills) ? m.fills : [])).find((f) => f.type === "IMAGE" && f.scaleMode === "TILE");
  if (!tile && kept) return { type: "IMAGE", imageHash: im.hash, scaleMode: "TILE", scalingFactor: kept.scalingFactor };
  if (!tile) return { type: "IMAGE", imageHash: im.hash, scaleMode: "FILL" };
  const width = widthOf(u) || (await im.getSizeAsync()).width;
  return { type: "IMAGE", imageHash: im.hash, scaleMode: "TILE", scalingFactor: tile / width };
};
const inInst = (r) => { for (let p = r.parent; p && p !== root; p = p.parent) if (p.type === "INSTANCE") return true; return false; };
// mains that take an svg in this build: an instance slot mirroring one of them already shows it
// (two blocks — a looped list's copy — can point at the same main)
const svgMains = new Set(B.filter((b) => b.svg).flatMap((b) => (slots.get(String(b.id)) || []).filter((r) => !inInst(r) && !mixedMain(r)).map((r) => r.id)));
const mirrored = async (r) => {
  if (!r.id.startsWith("I")) return false;
  const mid = r.id.split(";").pop();
  if (svgMains.has(mid)) return true;
  // a main reused from an earlier build: its svg is the layer right after it
  const m = await figma.getNodeByIdAsync(mid), nx = m && m.parent && m.parent.children[m.parent.children.indexOf(m) + 1];
  return !!(nx && nx.name === "svg");
};
for (const b of B) {
  const rs = slots.get(String(b.id));
  if (!rs) { out.push(false); continue; }
  // an image that could not be had: its slot shows what is under it, not a grey box
  if (b.drop) {
    for (const r of rs) {
      const f = Array.isArray(r.fills) ? r.fills : [];
      if (f[0] && f[0].type === "SOLID" && ["r", "g", "b"].every((k) => Math.abs(f[0].color[k] - 0.92) < 1e-3)) r.fills = f.slice(1);
      r.setPluginData("img", "");
    }
    out.push(false);
    continue;
  }
  // an svg placed in a component's main shows in every instance: a copy on the root would stay
  // put while the layout moves (badge left over the next block)
  const viaMain = b.svg && rs.some((r) => !inInst(r) && !mixedMain(r));
  let bad = false;
  for (const r of rs) {
  if (b.svg && r.getPluginData("svgdone") === String(b.id)) continue;
  // a main shared with other pictures stays empty: each instance gets its own svg over it
  if (b.svg && !inInst(r) && mixedMain(r)) { r.fills = []; r.name = "image"; r.setPluginData("img", ""); continue; }
  // shown through its main: only the placeholder goes
  if (b.svg && inInst(r) && !mixedMain(r) && (viaMain || (await mirrored(r)))) {
    r.fills = []; r.name = "image";
    // an svg left by an earlier build keeps its white frame: cleared on the mirror too
    const nx = r.parent.children[r.parent.children.indexOf(r) + 1];
    if (nx && nx.name === "svg" && nx.fills.length) nx.fills = [];
    continue;
  }
  c.ring.follow(r);
  if ("layoutMode" in r) {
    // image background of a frame: the image replaces the placeholder, the gradient layers over it stay
    if (b.url) r.fills = [await imgFill(rs, b.url), ...r.fills.slice(1)];
    // svg background: imported as is under the frame's content, covering it like a CSS background
    // (an instance can't take a new layer: only the placeholder goes, never a grey box left behind)
    else if (b.svg) {
      r.fills = r.fills.filter((f) => !(f.type === "SOLID" && ["r", "g", "b"].every((k) => Math.abs(f.color[k] - 0.92) < 1e-3)));
      if (!inInst(r)) {
        try {
          const v = figma.createNodeFromSvg(b.svg);
          v.fills = []; v.name = "svg";
          v.rescale(Math.max(r.width / v.width, r.height / v.height));
          r.insertChild(0, v);
          if (r.layoutMode !== "NONE") v.layoutPositioning = "ABSOLUTE";
          v.x = (r.width - v.width) / 2; v.y = (r.height - v.height) / 2;
          r.clipsContent = true;
        } catch (e) { bad = true; }
      } else bad = true;
    }
    r.setPluginData("img", "");
    continue;
  }
  if (b.svg) {
    // vector slot: the svg imported as is, fitted and centred inside the slot
    // the imported frame comes white: its own fill would hide what is under the logo
    // an svg Figma's parser refuses: the slot is cleared, the image counted as missing
    let v;
    try { v = figma.createNodeFromSvg(b.svg); } catch (e) { r.fills = []; r.setPluginData("img", ""); bad = true; continue; }
    v.fills = [];
    // brightness(0) [invert(1)] on the logo: every paint of the vector takes that one color
    const fxv = await dataOf(r, "fx");
    const mono = fxv?.mono;
    // brightness(x) on an svg file: Figma has no filter for a vector, each paint is scaled by 2^exposure
    // invert(x) first, as CSS applies the filters in order (chloe's logo: invert(1) brightness(2))
    if (!mono && (fxv?.exposure || fxv?.invert)) {
      const m = 2 ** (fxv.exposure || 0), i = fxv.invert || 0, iv = (x) => x + (1 - 2 * x) * i;
      const sc = (c) => ({ r: Math.min(1, iv(c.r) * m), g: Math.min(1, iv(c.g) * m), b: Math.min(1, iv(c.b) * m) });
      const masked = (n) => { for (; n && n !== v; n = n.parent) if (n.isMask) return true; return false; };
      for (const n of v.findAll((n) => "fills" in n && !masked(n))) {
        if (Array.isArray(n.fills) && n.fills.length) n.fills = n.fills.map((f) => (f.type === "SOLID" ? { ...f, color: sc(f.color) } : f.type.startsWith("GRADIENT") ? { ...f, gradientStops: f.gradientStops.map((s) => ({ ...s, color: { ...sc(s.color), a: s.color.a } })) } : f));
        if (Array.isArray(n.strokes) && n.strokes.length) n.strokes = n.strokes.map((f) => (f.type === "SOLID" ? { ...f, color: sc(f.color) } : f));
      }
    }
    if (mono) {
      const c = { r: parseInt(mono.slice(1, 3), 16) / 255, g: parseInt(mono.slice(3, 5), 16) / 255, b: parseInt(mono.slice(5, 7), 16) / 255 };
      // (never the clip shape of a clipPath: a mask group holds it, painted it would show as a box)
      const masked = (n) => { for (; n && n !== v; n = n.parent) if (n.isMask) return true; return false; };
      for (const n of v.findAll((n) => "fills" in n && !masked(n))) {
        if (Array.isArray(n.fills) && n.fills.length) n.fills = n.fills.map((f) => (f.type === "SOLID" || f.type.startsWith("GRADIENT") ? { type: "SOLID", color: c, opacity: f.opacity ?? 1 } : f));
        if (Array.isArray(n.strokes) && n.strokes.length) n.strokes = n.strokes.map((f) => ({ type: "SOLID", color: c, opacity: f.opacity ?? 1 }));
      }
    }
    // cropped: drawn at its whole box, cut by a clipping frame the size of the slot
    const k = await cropOf(r);
    v.rescale(k ? Math.min(k[2] / v.width, k[3] / v.height) : Math.min(r.width / v.width, r.height / v.height)); v.name = "svg";
    if (k) {
      const f = figma.createFrame();
      f.name = "svg"; f.fills = []; f.clipsContent = true; f.resize(r.width, r.height);
      f.appendChild(v);
      v.x = k[0] + (k[2] - v.width) / 2; v.y = k[1] + (k[3] - v.height) / 2;
      v = f;
    }
    // an instance can't take a new layer: inside one, the svg goes right over its outermost
    // instance, in that instance's parent (stays with its section, not loose on the root),
    // out of the flow when that parent is an auto layout
    let at = r;
    for (let p = r.parent; p && p !== root; p = p.parent) if (p.type === "INSTANCE") at = p;
    const host = at.parent;
    host.insertChild(host.children.indexOf(at) + 1, v);
    if (host.layoutMode && host.layoutMode !== "NONE") v.layoutPositioning = "ABSOLUTE";
    v.x = r.absoluteTransform[0][2] - host.absoluteTransform[0][2] + (r.width - v.width) / 2;
    v.y = r.absoluteTransform[1][2] - host.absoluteTransform[1][2] + (r.height - v.height) / 2;
    r.fills = [];
    r.setPluginData("svgdone", String(b.id));
  } else {
    r.fills = [await imgFill(rs, b.url), ...r.fills.slice(1)];
  }
  r.name = "image";
  }
  out.push(!bad);
}
// the ring stays a moment on the last image placed, visible by eye
await c.idle(200);
c.done();
return out;`);
}

// Plugin-side layout of the components page, shared by web-build and web-boards (sent as code)
export const BOARD_JS = String.raw`
// components board of the site, white, on the components page (created when missing). One column
// grew past what Figma handles (hundreds of mains, tens of thousands of px tall): the board is as
// small as it can be — its components in wrapped rows, tallest first, at the width (≤ 4000 px)
// giving the smallest area, kept near square
const BOARD_MAX = 4000, BOARD_PAD = 80, BOARD_GAP = 80;
// rows filled in the given order at each candidate width: the width of the best area, rows held
// apart by the gap (squeezed rows read as one component)
const packW = (items, gap, pad, maxW) => {
  const widest = Math.max(1, ...items.map((i) => i.width));
  let best = null;
  for (let W = widest + 2 * pad; ; W = Math.min(W + 40, Math.max(W + 1, maxW))) {
    let x = 0, row = 0, H = 0, used = 0;
    for (const it of items) {
      if (x > 0 && x + it.width > W - 2 * pad) { H += row + gap; x = 0; row = 0; }
      x += it.width + gap; row = Math.max(row, it.height); used = Math.max(used, x - gap);
    }
    const w = used + 2 * pad, h = H + row + 2 * pad;
    const score = w * h * (1 + 0.25 * Math.abs(Math.log(w / h)));
    if (!best || score < best.score) best = { score, w };
    if (W >= maxW || used + 2 * pad < W - widest) break;
  }
  return best.w;
};
const boardLayout = (f) => {
  const items = [...f.children].sort((a, b) => b.height - a.height || b.width - a.width);
  items.forEach((c, i) => { if (f.children[i] !== c) f.insertChild(i, c); });
  f.layoutMode = "HORIZONTAL"; f.layoutWrap = "WRAP";
  f.primaryAxisSizingMode = "FIXED"; f.counterAxisSizingMode = "AUTO";
  f.itemSpacing = f.counterAxisSpacing = BOARD_GAP; f.counterAxisAlignContent = "AUTO"; f.counterAxisAlignItems = "MIN";
  f.paddingTop = f.paddingBottom = f.paddingLeft = f.paddingRight = BOARD_PAD;
  if (items.length) f.resize(Math.min(BOARD_MAX, packW(items, BOARD_GAP, BOARD_PAD, BOARD_MAX)), Math.max(1, f.height));
};
// the sites' boards side by side on one row, in their current order: a board that grew never
// overlaps its neighbour
const boardsRow = (cp) => {
  let x = 0;
  for (const f of [...cp.children].filter((n) => n.getPluginData("fdslSite")).sort((a, b) => a.x - b.x)) {
    f.x = x; f.y = 0; x += f.width + 400;
  }
};
// a set's variants on one row, wrapped to the next only where the row would pass the board width
const setLayout = (set) => {
  set.layoutMode = "HORIZONTAL"; set.layoutWrap = "WRAP"; set.counterAxisSizingMode = "AUTO";
  set.itemSpacing = set.counterAxisSpacing = 40; set.paddingTop = set.paddingBottom = set.paddingLeft = set.paddingRight = 40;
  set.primaryAxisSizingMode = "FIXED";
  const row = set.children.reduce((t, c) => t + c.width + 40, 40);
  const widest = set.children.reduce((m, c) => Math.max(m, c.width), 0) + 80;
  set.resize(Math.max(widest, Math.min(row, BOARD_MAX - 2 * BOARD_PAD)), Math.max(1, set.height));
};
`;
