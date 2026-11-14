// H.adapt: a frame made elsewhere takes on the rules of the file it now lives in. Each color, text and grid goes to
// the nearest token of the file (variables, then styles, then, without any, the values the file really uses), bound
// when a token can be bound. In place, nothing is rebuilt; { dry: true } reports the mapping and writes nothing.
// Components are not swapped yet: the frame keeps its own, adapted.

import { nearestColor, nearestGrid, nearestText, type ColorToken, type GridToken, type TextToken } from "./adapt-rules.mjs";

const YIELD_MS = 250; // work between two yields: a long walk must not freeze Figma, and a yield costs up to 1 s when Figma is in the background
const HARVEST_MAX = 20000; // nodes read to learn a file's values when it declares none
const USAGE_COLORS = 24, USAGE_TEXTS = 24; // the values most used, beyond that it is noise
const USAGE_MIN_COLOR = 3, USAGE_MIN_TEXT = 2; // a value met less often is an accident, not a rule
const LOCAL_MIN_COLORS = 4, LOCAL_MIN_TEXTS = 3; // below that, a file's declared tokens are a start, not its rules
const FAR_COLOR = 0.15; // OKLab distance a person reads as another color: reported, for the eye to judge
const LOGO = /\blogo\b/i; // a logo keeps its colors, whoever's it is

let lastYield = Date.now();
const breathe = async (): Promise<void> => {
  if (Date.now() - lastYield < YIELD_MS) return;
  await new Promise((r) => setTimeout(r, 0));
  lastYield = Date.now();
};

const hexOf = (c: RGB): string => "#" + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();

export interface Brand {
  colors: ColorToken[];
  texts: TextToken[];
  grids: GridToken[];
  source: { colors: string; texts: string };
  ruled: boolean;
}

// A color variable's value in its collection's default mode, through aliases.
const resolveColor = async (v: Variable): Promise<RGBA | null> => {
  let cur: Variable | null = v;
  for (let i = 0; cur && i < 8; i++) {
    const col: VariableCollection | null = await figma.variables.getVariableCollectionByIdAsync(cur.variableCollectionId);
    const value: VariableValue | undefined = col ? cur.valuesByMode[col.defaultModeId] : undefined;
    if (value && typeof value === "object" && "type" in value && value.type === "VARIABLE_ALIAS") cur = await figma.variables.getVariableByIdAsync(value.id);
    else if (value && typeof value === "object" && "r" in value) return { a: 1, ...(value as RGB | RGBA) } as RGBA;
    else return null;
  }
  return null;
};

const colorOfVariable = async (v: Variable): Promise<ColorToken | null> => {
  const c = await resolveColor(v);
  return c && { id: v.id, kind: "variable", name: v.name, r: c.r, g: c.g, b: c.b, opacity: c.a };
};
const colorOfStyle = (s: PaintStyle): ColorToken | null => {
  const p = s.paints.length === 1 ? s.paints[0] : null;
  return p && p.type === "SOLID" ? { id: s.id, kind: "style", name: s.name, ...p.color, opacity: p.opacity ?? 1 } : null;
};
const textOfStyle = (s: TextStyle): TextToken => ({ id: s.id, name: s.name, family: s.fontName.family, style: s.fontName.style, size: s.fontSize });

// A page parsed from a site earlier is that site's look, not the file's rules (the web build tags what it creates)
const builtFromWeb = (n: any): boolean => n.type !== "PAGE" && (!!n.getPluginData("w") || !!n.children?.[0]?.getPluginData("w"));
// This plugin's own interface tokens, pushed into a file to design the plugin: not that file's rules either
const pluginCollections = async (): Promise<Set<string>> => new Set((await figma.variables.getLocalVariableCollectionsAsync()).filter((c) => /^angelo plugin$/i.test(c.name)).map((c) => c.id));

// What the file uses, for a file without declared tokens or whose tokens live in a library: styles and variables seen
// on nodes (remote ones included: nothing else lists them), and plain values by frequency. The frame being adapted
// is no witness of the file's rules.
const harvest = async (skip: Set<string>, want: { colors: boolean; texts: boolean }): Promise<{ colors: ColorToken[]; texts: TextToken[] }> => {
  const styleSeen = new Set<string>(), varSeen = new Set<string>();
  const colors: ColorToken[] = [], texts: TextToken[] = [];
  const rawColors = new Map<string, { c: RGB; n: number }>(), rawTexts = new Map<string, { t: TextToken; n: number }>();
  let read = 0;
  const own = await pluginCollections();
  const seeColorStyle = async (id: string) => {
    if (styleSeen.has(id)) return;
    styleSeen.add(id);
    const s = await figma.getStyleByIdAsync(id).catch(() => null);
    const t = s && s.type === "PAINT" ? colorOfStyle(s as PaintStyle) : null;
    if (t) colors.push(t);
  };
  const seePaints = async (paints: unknown, styleId: unknown) => {
    if (typeof styleId === "string" && styleId) return seeColorStyle(styleId);
    if (!Array.isArray(paints)) return;
    for (const p of paints as Paint[]) {
      if (p.type !== "SOLID" || p.visible === false) continue;
      const bound = p.boundVariables?.color?.id;
      if (bound) {
        if (!varSeen.has(bound)) {
          varSeen.add(bound);
          const v = await figma.variables.getVariableByIdAsync(bound).catch(() => null);
          const t = v && !own.has(v.variableCollectionId) && (await colorOfVariable(v));
          if (t) colors.push(t);
        }
        continue;
      }
      const k = hexOf(p.color);
      const e = rawColors.get(k);
      if (e) e.n++;
      else rawColors.set(k, { c: p.color, n: 1 });
    }
  };
  const seeText = async (n: TextNode) => {
    for (const seg of n.getStyledTextSegments(["fontName", "fontSize", "textStyleId"])) {
      if (seg.textStyleId) {
        if (!styleSeen.has(seg.textStyleId)) {
          styleSeen.add(seg.textStyleId);
          const s = await figma.getStyleByIdAsync(seg.textStyleId).catch(() => null);
          if (s && s.type === "TEXT") texts.push(textOfStyle(s as TextStyle));
        }
        continue;
      }
      const k = `${seg.fontName.family}|${seg.fontName.style}|${seg.fontSize}`;
      const e = rawTexts.get(k);
      if (e) e.n++;
      else rawTexts.set(k, { t: { name: `${seg.fontName.family} ${seg.fontName.style} ${seg.fontSize}`, family: seg.fontName.family, style: seg.fontName.style, size: seg.fontSize }, n: 1 });
    }
  };
  const visit = async (n: any): Promise<void> => {
    if (read >= HARVEST_MAX || skip.has(n.id) || builtFromWeb(n)) return;
    read++;
    await breathe();
    if (want.colors) {
      if ("fills" in n && n.type !== "TEXT") await seePaints(n.fills, n.fillStyleId);
      if ("strokes" in n) await seePaints(n.strokes, n.strokeStyleId);
    }
    if (n.type === "TEXT") {
      if (want.texts) await seeText(n);
      if (want.colors) await seePaints(n.fills === figma.mixed ? null : n.fills, n.fillStyleId === figma.mixed ? "" : n.fillStyleId);
    }
    if ("children" in n) for (const k of n.children) await visit(k);
  };
  const current = figma.currentPage;
  await visit(current);
  for (const p of figma.root.children) {
    if (p === current || read >= HARVEST_MAX) continue;
    await p.loadAsync();
    await visit(p);
  }
  // plain values too, even beside styles: one style seen on a node must not swallow every color of the frame
  for (const { c } of [...rawColors.values()].filter((e) => e.n >= USAGE_MIN_COLOR).sort((a, b) => b.n - a.n).slice(0, USAGE_COLORS)) colors.push({ kind: "raw", name: hexOf(c), ...c, opacity: 1 });
  for (const { t } of [...rawTexts.values()].filter((e) => e.n >= USAGE_MIN_TEXT).sort((a, b) => b.n - a.n).slice(0, USAGE_TEXTS)) texts.push(t);
  return { colors, texts };
};

// The file's rules. `skip` = node ids that are no witness (the frame being adapted).
export const readBrand = async (skip: Set<string> = new Set()): Promise<Brand> => {
  const [vars, paints, textStyles, gridStyles] = await Promise.all([figma.variables.getLocalVariablesAsync("COLOR"), figma.getLocalPaintStylesAsync(), figma.getLocalTextStylesAsync(), figma.getLocalGridStylesAsync()]);
  const colors: ColorToken[] = [];
  const own = await pluginCollections();
  for (const v of vars) {
    if (own.has(v.variableCollectionId)) continue;
    const t = await colorOfVariable(v);
    if (t) colors.push(t);
  }
  for (const s of paints) {
    const t = colorOfStyle(s);
    if (t) colors.push(t);
  }
  const texts = textStyles.map(textOfStyle);
  // too few declared tokens to stand for a whole page: what the file uses completes them
  const want = { colors: colors.length < LOCAL_MIN_COLORS, texts: texts.length < LOCAL_MIN_TEXTS };
  const source = { colors: !want.colors ? "local" : colors.length ? "local+usage" : "usage", texts: !want.texts ? "local" : texts.length ? "local+usage" : "usage" };
  if (want.colors || want.texts) {
    const h = await harvest(skip, want);
    const known = new Set([...colors, ...texts].map((t) => t.id).filter(Boolean));
    if (want.colors) colors.push(...h.colors.filter((t) => !t.id || !known.has(t.id)));
    if (want.texts) texts.push(...h.texts.filter((t) => !t.id || !known.has(t.id)));
  }
  const grids: GridToken[] = gridStyles.map((s) => ({ id: s.id, name: s.name, grids: s.layoutGrids }));
  // a grid on a top frame gives the width it was drawn for too
  for (const n of figma.currentPage.children) {
    if (n.type === "FRAME" && !skip.has(n.id) && n.layoutGrids.length) grids.push({ name: n.name, width: n.width, grids: n.layoutGrids });
  }
  // one stray variable or style is no design system: rules are named tokens in numbers, plain values never count
  const ruled = colors.filter((t) => t.id).length >= LOCAL_MIN_COLORS || texts.filter((t) => t.id).length >= LOCAL_MIN_TEXTS;
  return { colors, texts, grids, source, ruled };
};

export interface AdaptReply {
  ms: number;
  steps: { brand: number; mains: number; exclusive: number; fonts: number; walk: number };
  dry: boolean;
  nodes: number;
  source: Brand["source"];
  tokens: { colors: number; texts: number; grids: number };
  colors: string[];
  texts: string[];
  grid?: string;
  bound: number;
  unbound: number;
  gradients: number;
  logos: number;
  ghosts: number;
  sharedMains: string[];
  far: string[];
  missingFonts: string[];
  failed?: string[];
}

// The mains only this frame draws from. Changing a main used elsewhere would change a page nobody asked to touch:
// such a main stays as it is, and the instances here take the new values as overrides.
// One pass over the file, not getInstancesAsync per main: the file is read once whatever the number of mains.
const exclusiveMains = async (root: any, mains: any[]): Promise<{ own: any[]; shared: any[]; firstUse: Map<string, any> }> => {
  const own = new Map<string, any>(mains.map((m) => [m.id, m]));
  // for each use of a main: inside the frame, or else the mains it sits in (none = a page nobody asked to touch)
  const uses = new Map<string, { inRoot: boolean; hosts: string[] }[]>();
  const firstUse = new Map<string, any>();
  for (const page of figma.root.children) {
    await page.loadAsync();
    for (const i of page.findAllWithCriteria({ types: ["INSTANCE"] })) {
      await breathe();
      let m: ComponentNode | null = null;
      try { m = await i.getMainComponentAsync(); } catch { continue; }
      if (!m || !own.has(m.id)) continue;
      const hosts: string[] = [];
      let inRoot = false;
      for (let p: BaseNode | null = i; p && p.type !== "PAGE"; p = p.parent) {
        if (p === root) inRoot = true;
        if (own.has(p.id)) hosts.push(p.id);
      }
      if (!uses.has(m.id)) uses.set(m.id, []);
      uses.get(m.id)!.push({ inRoot, hosts });
      if (inRoot && !firstUse.has(m.id)) firstUse.set(m.id, i);
    }
  }
  // removing a main can leave another one used only by it: until nothing moves
  for (let moved = true; moved; ) {
    moved = false;
    for (const id of [...own.keys()]) {
      if ((uses.get(id) ?? []).every((u) => u.inRoot || u.hosts.some((h) => own.has(h)))) continue;
      own.delete(id);
      moved = true;
    }
  }
  return { own: [...own.values()], shared: mains.filter((m) => !own.has(m.id)), firstUse };
};

// Every main a frame's instances draw from, nested ones included: what is bound in a main needs no override.
const localMains = async (root: any): Promise<any[]> => {
  const out = new Map<string, any>();
  const visit = async (scope: any): Promise<void> => {
    if (!scope.findAllWithCriteria) return;
    const uses: any[] = scope.findAllWithCriteria({ types: ["INSTANCE"] });
    if (scope.type === "INSTANCE") uses.push(scope);
    for (const i of uses) {
      await breathe();
      let m: ComponentNode | null = null;
      try { m = await i.getMainComponentAsync(); } catch { /* a ghost or a deleted main */ }
      if (!m || m.remote || out.has(m.id)) continue;
      out.set(m.id, m);
      await visit(m);
    }
  };
  await visit(root);
  return [...out.values()];
};

// await H.adapt(node, { dry: true }) reports · H.adapt(node) applies · no node = the selection · { grid: false } leaves the frame's grid and width
export const adapt = async (target?: any, opts?: { dry?: boolean; grid?: boolean }): Promise<AdaptReply> => {
  const t0 = Date.now();
  const root = target ?? (figma.currentPage.selection.length === 1 ? figma.currentPage.selection[0] : null);
  if (!root) throw new Error("H.adapt: pass a node or select one frame");
  const dry = !!opts?.dry;
  const brand = await readBrand(new Set([root.id]));
  const colorMap = new Map<string, number>(), textMap = new Map<string, number>();
  const tally = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);
  const missing = new Set<string>(), failed = new Set<string>(), far = new Set<string>();
  // What a node stands on: the original color and what it turns into.
  type Backdrop = { was: RGB; on: RGB } | null;
  const nearest = (c: RGB, bg: Backdrop) => {
    const m = nearestColor(c, brand.colors, bg);
    if (m) {
      tally(colorMap, `${hexOf(c)} → ${m.token.name}`);
      if (m.dist > FAR_COLOR) far.add(`${hexOf(c)} → ${m.token.name} (${m.dist.toFixed(2)})`);
    }
    return m;
  };
  const stats = { nodes: 0, bound: 0, unbound: 0, gradients: 0, logos: 0, ghosts: 0 };

  const fontReady = new Map<string, boolean>();
  const load = async (f: FontName): Promise<boolean> => {
    const k = `${f.family}|${f.style}`;
    if (!fontReady.has(k)) fontReady.set(k, await figma.loadFontAsync(f).then(() => true, () => false));
    if (!fontReady.get(k)) missing.add(`${f.family} ${f.style}`);
    return fontReady.get(k)!;
  };
  // Every font at once: loaded one by one, each costs a timer wake-up, a full second when Figma is in the background.
  const loadFonts = async (scopes: any[]): Promise<void> => {
    const wanted = new Map<string, FontName>();
    const want = (f: FontName) => wanted.set(`${f.family}|${f.style}`, f);
    for (const scope of scopes) {
      const texts: TextNode[] = scope.type === "TEXT" ? [scope] : scope.findAllWithCriteria ? scope.findAllWithCriteria({ types: ["TEXT"] }) : [];
      for (const n of texts) {
        await breathe();
        for (const seg of n.getStyledTextSegments(["fontName", "fontSize", "textStyleId"])) {
          want(seg.fontName);
          if (seg.textStyleId) continue;
          const m = nearestText({ family: seg.fontName.family, style: seg.fontName.style, size: seg.fontSize }, brand.texts);
          if (m && !m.far) want({ family: m.token.family, style: m.token.style });
        }
      }
    }
    await Promise.all([...wanted].map(async ([k, f]) => fontReady.set(k, await figma.loadFontAsync(f).then(() => true, () => false))));
  };

  // A solid paint turned to its token. A style can't carry another opacity, so a translucent color takes its value only.
  const paintOf = (p: SolidPaint, t: ColorToken, variable: Variable | null): SolidPaint => {
    const next: SolidPaint = { ...p, color: { r: t.r, g: t.g, b: t.b } };
    return variable ? figma.variables.setBoundVariableForPaint(next, "color", variable) : next;
  };
  const variableOf = async (t: ColorToken): Promise<Variable | null> => (t.kind === "variable" && t.id ? figma.variables.getVariableByIdAsync(t.id) : null);

  // A container's own opaque fill is the backdrop of what it holds; an image or a gradient on top makes it unknown.
  const backdropOf = (n: any, parent: Backdrop): Backdrop => {
    const fills = n.fills;
    if (!Array.isArray(fills)) return parent;
    const top = [...fills].reverse().find((p: Paint) => p.visible !== false && (p.opacity ?? 1) > 0);
    if (!top) return parent;
    if (top.type !== "SOLID") return null;
    if ((top.opacity ?? 1) < 0.99) return parent;
    const m = nearestColor(top.color, brand.colors);
    return { was: top.color, on: m ? m.token : top.color };
  };
  // Where a main is really used: its text has to stay readable there, and a main has no background of its own.
  const contextOf = (n: any): Backdrop => {
    const chain: any[] = [];
    try {
      for (let p = n.parent; p && p.type !== "PAGE"; p = p.parent) chain.unshift(p);
    } catch { return null; }
    return chain.reduce<Backdrop>((bg, p) => backdropOf(p, bg), null);
  };

  const adaptPaints = async (n: any, field: "fills" | "strokes", styleField: "fillStyleId" | "strokeStyleId", setStyle: "setFillStyleIdAsync" | "setStrokeStyleIdAsync", bg: Backdrop): Promise<void> => {
    if (!(field in n) || n[field] === figma.mixed || !Array.isArray(n[field]) || n[styleField]) return;
    const paints = n[field] as readonly Paint[];
    if (!paints.length) return;
    const next: Paint[] = [];
    let changed = false, styleId: string | null = null;
    for (const p of paints) {
      if (p.type.startsWith("GRADIENT") && p.visible !== false) stats.gradients++;
      if (p.type !== "SOLID" || p.visible === false || p.boundVariables?.color) { next.push(p); continue; }
      const m = nearest(p.color, bg);
      if (!m) { next.push(p); continue; }
      const opacity = p.opacity ?? 1;
      if (m.token.kind === "style" && paints.length === 1 && Math.abs(opacity - m.token.opacity) < 0.005) { styleId = m.token.id!; stats.bound++; continue; }
      if (m.token.kind === "variable") stats.bound++;
      else stats.unbound++;
      if (!dry) next.push(paintOf(p, m.token, await variableOf(m.token)));
      changed = true;
    }
    if (dry) return;
    if (styleId) await n[setStyle](styleId);
    else if (changed) n[field] = next;
  };

  const adaptText = async (n: TextNode, bg: Backdrop): Promise<void> => {
    const segs = n.getStyledTextSegments(["fontName", "fontSize", "textStyleId", "fills", "fillStyleId"]);
    for (const seg of segs) {
      // In an instance a run inherits the style of its adapted main and keeps its own size: styled, yet off the style.
      const held = seg.textStyleId ? brand.texts.find((t) => t.id === seg.textStyleId) : undefined;
      const offStyle = !!held && (Math.abs(held.size - seg.fontSize) > 0.01 || held.family !== seg.fontName.family || held.style !== seg.fontName.style);
      const m = !seg.textStyleId || offStyle ? nearestText({ family: seg.fontName.family, style: seg.fontName.style, size: seg.fontSize }, brand.texts) : null;
      if (m?.far) far.add(`${seg.fontName.family} ${seg.fontName.style} ${seg.fontSize} → ${m.token.name} (${m.dist.toFixed(2)}, kept)`);
      if (m && !m.far) {
        tally(textMap, `${seg.fontName.family} ${seg.fontName.style} ${seg.fontSize} → ${m.token.name}`);
        const to = { family: m.token.family, style: m.token.style };
        if (!(await load(to)) || !(await load(seg.fontName))) stats.unbound++;
        else {
          if (m.token.id) stats.bound++;
          else stats.unbound++;
          if (!dry) {
            if (m.token.id) {
              // Setting the style a run already has keeps its local size: drop the link first.
              if (offStyle) await n.setRangeTextStyleIdAsync(seg.start, seg.end, "");
              await n.setRangeTextStyleIdAsync(seg.start, seg.end, m.token.id);
            } else {
              n.setRangeFontName(seg.start, seg.end, to);
              n.setRangeFontSize(seg.start, seg.end, m.token.size);
            }
          }
        }
      }
      if (seg.fillStyleId || seg.fills.length !== 1 || seg.fills[0].type !== "SOLID" || seg.fills[0].boundVariables?.color) continue;
      const p = seg.fills[0];
      const c = nearest(p.color, bg);
      if (!c) continue;
      const asStyle = c.token.kind === "style" && Math.abs((p.opacity ?? 1) - c.token.opacity) < 0.005;
      if (asStyle || c.token.kind === "variable") stats.bound++;
      else stats.unbound++;
      if (dry) continue;
      if (!(await load(seg.fontName))) continue;
      if (asStyle) await n.setRangeFillStyleIdAsync(seg.start, seg.end, c.token.id!);
      else n.setRangeFills(seg.start, seg.end, [paintOf(p, c.token, await variableOf(c.token))]);
    }
  };

  const seen = new Set<string>();
  const adaptNode = async (n: any, bg: Backdrop): Promise<void> => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    await breathe();
    // a layer of an instance can vanish while a neighbour's override is written, and Figma redraws the instance:
    // reading it throws. Nothing to adapt there: its new self, read from the parent again, is visited instead
    let name: string;
    try { name = n.name; } catch { stats.ghosts++; return; }
    stats.nodes++;
    if (LOGO.test(name)) { stats.logos++; return; }
    // read before the fills change, on the original values
    const inner = "children" in n ? backdropOf(n, bg) : bg;
    try {
      if (n.type === "TEXT") await adaptText(n, bg);
      else await adaptPaints(n, "fills", "fillStyleId", "setFillStyleIdAsync", bg);
      await adaptPaints(n, "strokes", "strokeStyleId", "setStrokeStyleIdAsync", bg);
    } catch (e) {
      failed.add(`${name}: ${(e as Error).message}`);
    }
    let i = 0;
    for (;;) {
      let kid: any;
      try { kid = n.children?.[i]; } catch { stats.ghosts++; return; }
      if (!kid) return;
      await adaptNode(kid, inner);
      i++;
    }
  };

  // Mains first: an instance's inherited layers then come bound and stay untouched, only its overrides are left.
  const t1 = Date.now();
  const mains = await localMains(root);
  const t2 = Date.now();
  const { own, shared, firstUse } = await exclusiveMains(root, mains);
  const t3 = Date.now();
  await loadFonts([...own, root]);
  const t4 = Date.now();
  // A text style set on a main resets the size its instances override (a 40 px "96%" in a card whose main
  // reads 17 px falls to 17): their runs are read first and written back once the mains are adapted.
  const held: { n: TextNode; segs: any[] }[] = [];
  if (!dry && own.length && root.findAllWithCriteria) {
    for (const n of root.findAllWithCriteria({ types: ["TEXT"] }) as TextNode[]) {
      if (!n.id.startsWith("I")) continue;
      try {
        // (only the runs sized apart from their main: the others follow it and stay bound)
        const main = (await figma.getNodeByIdAsync(n.id.split(";").pop()!)) as TextNode | null;
        const segs = n.getStyledTextSegments(["fontName", "fontSize", "lineHeight", "letterSpacing"]).filter((s) => !main || main.type !== "TEXT" || main.fontSize !== s.fontSize);
        if (segs.length) held.push({ n, segs });
      } catch { /* a ghost */ }
    }
  }
  for (const m of own) {
    const use = firstUse.get(m.id);
    await adaptNode(m, use ? contextOf(use) : null);
  }
  for (const { n, segs } of held) {
    await breathe();
    try {
      for (const s of segs) {
        const now = n.getRangeFontSize(s.start, s.end);
        if (now === s.fontSize && JSON.stringify(n.getRangeFontName(s.start, s.end)) === JSON.stringify(s.fontName)) continue;
        if (!(await load(s.fontName))) continue;
        n.setRangeFontName(s.start, s.end, s.fontName);
        n.setRangeFontSize(s.start, s.end, s.fontSize);
        n.setRangeLineHeight(s.start, s.end, s.lineHeight);
        n.setRangeLetterSpacing(s.start, s.end, s.letterSpacing);
      }
    } catch { /* a ghost, or a run the main no longer has */ }
  }
  await adaptNode(root, contextOf(root));
  const steps = { brand: t1 - t0, mains: t2 - t1, exclusive: t3 - t2, fonts: t4 - t3, walk: Date.now() - t4 };

  // The grid, and the width it was drawn for: full-width sections follow, the content inside keeps its own layout.
  let grid: string | undefined;
  if (opts?.grid !== false && "layoutGrids" in root && brand.grids.length) {
    const g = nearestGrid(root.width, brand.grids)!;
    grid = g.name + (g.width ? ` (${Math.round(root.width)} → ${Math.round(g.width)} px)` : "");
    if (!dry) {
      if (g.id) await root.setGridStyleIdAsync(g.id);
      else root.layoutGrids = g.grids as LayoutGrid[];
      if (g.width && Math.abs(g.width - root.width) > 0.5) {
        const old = root.width;
        if (root.layoutMode && root.layoutMode !== "NONE") for (const k of root.children) if (Math.abs(k.width - old) < 1 && "layoutSizingHorizontal" in k && k.layoutPositioning !== "ABSOLUTE") k.layoutSizingHorizontal = "FILL";
        root.resize(g.width, root.height);
      }
    }
  }

  const ranked = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`);
  const reply: AdaptReply = {
    ms: Date.now() - t0,
    steps,
    dry,
    nodes: stats.nodes,
    source: brand.source,
    tokens: { colors: brand.colors.length, texts: brand.texts.length, grids: brand.grids.length },
    colors: ranked(colorMap).slice(0, 40),
    texts: ranked(textMap).slice(0, 40),
    grid,
    bound: stats.bound,
    unbound: stats.unbound,
    gradients: stats.gradients,
    logos: stats.logos,
    ghosts: stats.ghosts,
    sharedMains: shared.map((m) => m.name).slice(0, 20),
    far: [...far].slice(0, 20),
    missingFonts: [...missing],
  };
  if (failed.size) reply.failed = [...failed].slice(0, 20);
  return reply;
};
