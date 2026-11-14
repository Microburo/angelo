// Arbitrary Plugin API execution, ported from figma-local-mcp.
//
// One exec is one undo step: commitUndo runs before and after, so a script that
// throws halfway can still be undone with a single Cmd+Z. Failures come back in
// the payload rather than as a rejection, because the caller wants to show the
// failing line next to the changes that survived it.

import { adapt, readBrand } from "./adapt";
import { AutoCursor, autoCursor } from "./autocursor";
import { makeCursor, pause, release } from "./cursor";
import { loadFont } from "./fonts";
import { icon } from "./icons";
import { kit } from "./kit";
import { lintNodes } from "./lint";
import { Patch, RevertLog } from "./write/patch";

const MAX_IMAGES = 6;
const SHOT_MAX_DIM = 1024; // px, longest side by default

export interface ExecImage {
  label: string;
  data: string;
}

export interface ExecLocation {
  line: number;
  col: number;
  src: string;
}

export interface ExecResult {
  file: string;
  page: string;
  value?: unknown;
  images: ExecImage[];
  error?: string;
  at?: ExecLocation | null;
  revert?: Patch | null;
}

const toRgb = (h: string): RGB => {
  let s = h.replace("#", "");
  if (s.length === 3) {
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const n = parseInt(s, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
};

// One H per exec: H.shot collects the images of that exec only.
const makeH = (
  images: ExecImage[],
  cursors: Set<SceneNode>,
  auto: AutoCursor,
  log: RevertLog | null,
  agent: string
): Record<string, any> => ({
  // '#ff0000' → normalised {r,g,b}
  hex: toRgb,

  // '#ff0000' → SOLID paint
  solid: (h: string, opacity?: number) => ({
    type: "SOLID",
    color: toRgb(h),
    opacity: opacity === undefined ? 1 : opacity,
  }),

  // getNodeByIdAsync shorthand (the sync one is deprecated)
  byId: async (id: string) => {
    const node = await figma.getNodeByIdAsync(id);
    log?.keep(node);
    return node;
  },

  // Records a node's state before the script changes it, for a note's Undo (no-op otherwise).
  // Nodes from byId / getNodeByIdAsync and the selection are kept already; found ones are not:
  // H.keep(node | [nodes], { deep: true }) also keeps the descendants. Returns what it got.
  keep: (target: any, opts?: { deep?: boolean }) => {
    if (log) {
      for (const node of Array.isArray(target) ? target : [target]) {
        log.keep(node);
        if (opts && opts.deep && node && "findAll" in node) node.findAll(() => true).forEach((n: SceneNode) => log.keep(n));
      }
    }
    return target;
  },

  // First node named `name` under root
  find: (root: any, name: string) => root.findOne((n: any) => n.name === name),

  // Every node matching a predicate, or a name when given a string
  findAll: (root: any, predOrName: any) => {
    const pred =
      typeof predOrName === "function" ? predOrName : (n: any) => n.name === predOrName;
    return root.findAll(pred);
  },

  // Auto-layout frame by default (VERTICAL, sizing AUTO/AUTO)
  frame: (opts?: any) => {
    const o = opts || {};
    const f = figma.createFrame();
    log?.created(f);
    f.layoutMode = o.layoutMode || "VERTICAL";
    f.primaryAxisSizingMode = o.primaryAxisSizingMode || "AUTO";
    f.counterAxisSizingMode = o.counterAxisSizingMode || "AUTO";
    if (o.name) f.name = o.name;
    if (o.spacing !== undefined) f.itemSpacing = o.spacing;
    if (o.padding !== undefined) {
      f.paddingTop = o.padding;
      f.paddingBottom = o.padding;
      f.paddingLeft = o.padding;
      f.paddingRight = o.padding;
    }
    if (o.fills) f.fills = o.fills;
    if (o.parent) o.parent.appendChild(f);
    return f;
  },

  // Text node — loads the font before writing, which is mandatory
  text: async (chars: string, opts?: any) => {
    const o = opts || {};
    const font = o.font || { family: "Inter", style: o.style || "Regular" };
    await loadFont(font);
    const t = figma.createText();
    log?.created(t);
    t.fontName = font;
    t.characters = chars;
    if (o.size) t.fontSize = o.size;
    if (o.fills) t.fills = o.fills;
    if (o.name) t.name = o.name;
    if (o.parent) o.parent.appendChild(t);
    return t;
  },

  // Loads every font used by the texts under root (or root itself) → "Family Style" list
  loadFonts: async (root: any) => {
    const texts: any[] =
      root.type === "TEXT" ? [root] : root.findAllWithCriteria({ types: ["TEXT"] });
    const seen = new Map<string, FontName>();
    for (const t of texts) {
      if (t.characters.length === 0) {
        if (t.fontName !== figma.mixed) {
          seen.set(`${t.fontName.family}|${t.fontName.style}`, t.fontName);
        }
        continue;
      }
      for (const f of t.getRangeAllFontNames(0, t.characters.length)) {
        seen.set(`${f.family}|${f.style}`, f);
      }
    }
    const fonts = Array.from(seen.values());
    await Promise.all(fonts.map((f) => loadFont(f)));
    return fonts.map((f) => `${f.family} ${f.style}`);
  },

  // Local variable by exact name, or null
  varByName: async (name: string) => {
    const vars = await figma.variables.getLocalVariablesAsync();
    return vars.filter((v) => v.name === name)[0] || null;
  },

  // Binds a colour variable onto a node's fill
  bindFill: (node: any, variable: Variable) => {
    const paint = figma.variables.setBoundVariableForPaint(
      { type: "SOLID", color: { r: 0, g: 0, b: 0 } },
      "color",
      variable
    );
    node.fills = [paint];
    return node;
  },

  // Lucide component of the file by name, created on first use, null if Lucide has no such name:
  // (await H.icon("plus")).createInstance() · H.icon("plus", { stroke: 1.5 }) draws a missing one thinner
  icon,

  // What a kit component is made of (level, heights, axes, props, slots): H.kit("Button"), H.kit() lists the names
  kit,

  // Structure, naming, variant and property rules on the file's components:
  // await H.lint() (selection, else page) · H.lint(node | [nodes], { rule, limit }) → { ms, clean, errors, byRule, issues }
  lint: lintNodes,

  // The file's rules, and a frame made elsewhere taking them on, in place:
  // await H.brand() → { colors, texts, grids, source } · await H.adapt(node, { dry: true }) reports · H.adapt(node, { grid: false }) applies
  brand: readBrand,
  adapt,

  // Lets Figma repaint mid-script (live progress)
  pause,

  // Labelled cursor + gradient ring (replaces the automatic one for this exec): c.stage({name,width,height?,after?|x,y}), c.to(node|[x,y], maxMs?), c.idle(ms), c.reveal(node), c.put(node, maxMs?), c.ring.follow(node|null), c.hold() (stays idling until the next cursor), c.done()
  cursor: (name?: string) => {
    auto.yieldTo();
    return makeCursor(cursors, name ?? agent);
  },
  // Removes a held cursor (a job that ends without a next cursor)
  release,

  // PNG of the node, returned as an image in the MCP response.
  // Default scale keeps the longest side under SHOT_MAX_DIM.
  shot: async (node: any, scale?: number) => {
    if (images.length >= MAX_IMAGES) {
      throw new Error(`H.shot: ${MAX_IMAGES} images max per exec`);
    }
    const s = scale || Math.min(1, SHOT_MAX_DIM / Math.max(node.width, node.height));
    const bytes = await node.exportAsync({
      format: "PNG",
      constraint: { type: "SCALE", value: s },
    });
    const label = `${node.name} (${Math.round(node.width)}x${Math.round(
      node.height
    )} @${s.toFixed(2)})`;
    images.push({ label, data: figma.base64Encode(bytes) });
    return `[image ${images.length}: ${label}]`;
  },
});

// figma.mixed (a symbol) and undefined do not survive postMessage → JSON-safe values
const toJSONSafe = (v: unknown): unknown => {
  if (v === undefined) return null;
  const s = JSON.stringify(v, (_k, x) => (typeof x === "symbol" ? "MIXED" : x));
  return s === undefined ? null : JSON.parse(s);
};

// QuickJS stack: "at … (<input>:L:C)". The new Function header is 2 lines, plus
// the async wrapper line — hence 3. Changing WRAPPER changes this offset.
const USER_LINE_OFFSET = 3;

const locate = (err: unknown, code: string): ExecLocation | null => {
  const stack = String((err as any) && (err as any).stack);
  const m = /<input>:(\d+):(\d+)/.exec(stack);
  if (!m) return null;
  const line = Number(m[1]) - USER_LINE_OFFSET;
  const src = code.split("\n")[line - 1];
  if (src === undefined) return null;
  return { line, col: Number(m[2]), src: src.trim().slice(0, 160) };
};

const context = () => ({ file: figma.root.name, page: figma.currentPage.name });

// The `figma` a script sees when its changes must be revertible: create* calls register the
// new node, getNodeByIdAsync keeps the node it returns. Methods stay bound to the real API.
// The proxy stands on an empty target: `figma`'s own methods are frozen, and a get trap may not
// return anything else for a frozen property ("proxy: inconsistent get").
const recording = (log: RevertLog): PluginAPI => {
  const bound = new Map<PropertyKey, unknown>();
  const note = (made: unknown) => {
    if (made && typeof (made as any).then === "function") {
      return (made as Promise<unknown>).then((n) => (log.created(n as BaseNode), n));
    }
    log.created(made as BaseNode);
    return made;
  };
  return new Proxy({} as PluginAPI, {
    has: (_, prop) => prop in figma,
    set: (_, prop, value) => Reflect.set(figma, prop, value),
    get(_, prop) {
      const value = (figma as any)[prop];
      if (typeof value !== "function") return value;
      if (!bound.has(prop)) {
        const name = String(prop);
        bound.set(
          prop,
          name === "getNodeByIdAsync"
            ? async (id: string) => {
                const n = await figma.getNodeByIdAsync(id);
                log.keep(n);
                return n;
              }
            : /^(create|group$|flatten$|union$|subtract$|intersect$|exclude$)/.test(name)
            ? (...args: unknown[]) => note(value.apply(figma, args))
            : value.bind(figma)
        );
      }
      return bound.get(prop);
    },
  });
};

// Closing pass of the last exec; any request touching the document awaits it first
let closing: Promise<void> = Promise.resolve();
// A closing pass that never ends must not turn every later request into a timeout until the plugin is reloaded.
const CLOSING_MAX_MS = 6000;
export const settled = (): Promise<void> => Promise.race([closing, pause(CLOSING_MAX_MS)]);

// quiet: no agent cursor and no closing wait. Plugin timers are clamped to ~1 s, so the
// nodechange settle of a cursor pass costs 1–6 s per exec: tools issuing many small execs
// (the auto-correction loop) pass it.
export async function runExec(code: string, file?: unknown, quiet = false, revert = false, agent = "main"): Promise<ExecResult> {
  // File guard: refuse to run in a file the caller did not expect.
  if (typeof file === "string" && file !== figma.root.name) {
    return {
      ...context(),
      images: [],
      error: `plugin connected to "${figma.root.name}", expected "${file}" — relaunch the plugin in the right file`,
    };
  }

  const images: ExecImage[] = [];
  const cursors = new Set<SceneNode>();
  // A cursor that will not go (parent gone with it) must not skip the closing
  // commitUndo nor turn the result into a rejection.
  const dropCursors = () =>
    cursors.forEach((c) => {
      try {
        if (!c.removed) c.remove();
      } catch {}
    });
  // Every write shows the agent cursor on what it touches (nothing on a read)
  const auto = autoCursor(!quiet, 0, agent);
  const settle = async () => {
    try {
      await auto.finish();
    } catch {}
  };
  const log = revert ? new RevertLog() : null;
  if (log) figma.currentPage.selection.slice(0, 50).forEach((n) => log.keep(n));
  figma.commitUndo();
  // The cursor's closing pass, the drop of script cursors and the undo commit run
  // after the reply: a read-only script no longer waits for the nodechange settle.
  const close = () => {
    closing = settle().then(() => {
      dropCursors();
      figma.commitUndo();
    }).catch(() => {});
  };
  try {
    const fn = new Function("figma", "H", `return (async () => {\n${code}\n})()`);
    const value = await fn(log ? recording(log) : figma, makeH(images, cursors, auto, log, agent));
    const back = log ? { revert: await log.patch() } : {};
    close();
    return { ...context(), value: toJSONSafe(value), images, ...back };
  } catch (err: any) {
    // What ran before the throw is still in the file: its revert stays usable
    const back = log ? { revert: await log.patch().catch(() => null) } : {};
    close();
    return {
      ...context(),
      images,
      error: (err && err.message) || String(err),
      at: locate(err, code),
      ...back,
    };
  }
}
