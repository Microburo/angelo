// What closes a build, free of Node: hosts are web-to-figma.mjs (Node) and the plugin's bundle (web-core).

// The built frame takes on the rules of the file it lands in, when the file has any: enough styles or variables,
// its own or a library's seen in use (H.brand's `ruled`). A file without them keeps the site's look.
// Detached and polled: on a big frame with Figma in the background it outlasts the 30 s of one exec.
const ADAPT_KEY = "web-adapt";
const ADAPT_MAX_MS = 15 * 60 * 1000;
export async function adaptToFile(rpc, root, { grid = true } = {}) {
  await rpc(`figma.root.setPluginData(${JSON.stringify(ADAPT_KEY)}, "");
const save = (o) => figma.root.setPluginData(${JSON.stringify(ADAPT_KEY)}, JSON.stringify(o));
(async () => {
  try {
    const node = await H.byId(${JSON.stringify(root)});
    const brand = await H.brand(new Set([node.id]));
    if (!brand.ruled) return save({ skipped: true });
    save(await H.adapt(node, { grid: ${grid} }));
  } catch (e) { save({ error: String(e && e.message) }); }
})();
return 1`);
  const t0 = Date.now();
  let lost = 0;
  while (Date.now() - t0 < ADAPT_MAX_MS) {
    await new Promise((r) => setTimeout(r, 1000));
    let raw;
    try {
      raw = await rpc(`return figma.root.getPluginData(${JSON.stringify(ADAPT_KEY)})`);
      lost = 0;
    } catch (e) {
      if (++lost >= 5) return { error: e.message };
      continue;
    }
    if (!raw) continue;
    await rpc(`figma.root.setPluginData(${JSON.stringify(ADAPT_KEY)}, ""); return 1`).catch(() => {});
    return JSON.parse(raw);
  }
  return { error: `no reply after ${ADAPT_MAX_MS / 1000} s` };
}

// The job over (done, failed or cut short): the held cursor and its ring go
export const releaseCursor = (rpc) => rpc(`H.release(); for (const n of figma.currentPage.children.slice()) if (/^angelo-(cursor|ring)$/.test(n.name)) n.remove(); return 1`).catch(() => {});

// Families a capture draws with that this machine does not have: their texts fall back, a plugin cannot install a font
export async function missingFamilies(rpc, cap) {
  const used = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    if (v.font && typeof v.font.family === "string" && v.font.family) used.add(v.font.family);
    Object.values(v).forEach(walk);
  };
  walk(cap.boxes);
  const names = [...used].filter((f) => !/^(-apple-system|blinkmacsystemfont|system-ui|ui-sans-serif)$/i.test(f));
  return rpc(`const have = new Set((await figma.listAvailableFontsAsync()).map((f) => f.fontName.family.toLowerCase()));
return ${JSON.stringify(names)}.filter((f) => !have.has(f.toLowerCase()));`);
}
