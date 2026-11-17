// Text jobs: font family, style, size, spacing over ranges, with the fonts
// installed on this computer (the plugin runs inside the designer's Figma, so
// local fonts load here). Each job returns what changed plus a revert patch.

import { loadFont } from "../fonts";
import { loadTextFonts } from "./patch";
import { nodeOrNull } from "../lookup";

export interface FontFamily {
  family: string;
  styles: string[];
}

export async function listFonts(query?: unknown): Promise<FontFamily[]> {
  const q = String(query || "").toLowerCase().trim();
  const families = new Map<string, string[]>();
  for (const f of await figma.listAvailableFontsAsync()) {
    const n = f.fontName;
    if (q && !n.family.toLowerCase().includes(q)) continue;
    if (!families.has(n.family)) families.set(n.family, []);
    families.get(n.family)!.push(n.style);
  }
  return Array.from(families)
    .slice(0, 60)
    .map(([family, styles]) => ({ family, styles }));
}

// "Bold Italic" → { weight: 700, italic: true }, so a style maps to the closest one in another family
const WEIGHTS: Array<[RegExp, number]> = [
  [/thin|hairline/, 100],
  [/extra ?light|ultra ?light/, 200],
  [/light/, 300],
  [/medium/, 500],
  [/semi ?bold|demi ?bold/, 600],
  [/extra ?bold|ultra ?bold/, 800],
  [/black|heavy/, 900],
  [/bold/, 700],
];

function styleInfo(style: string): { weight: number; italic: boolean } {
  const s = String(style).toLowerCase();
  const w = WEIGHTS.find(([re]) => re.test(s));
  return { weight: w ? w[1] : 400, italic: /italic|oblique/.test(s) };
}

function closestStyle(fromStyle: string, styles: string[]): string | null {
  const want = styleInfo(fromStyle);
  let best: string | null = null;
  let bestScore = Infinity;
  for (const st of styles) {
    const got = styleInfo(st);
    const score = Math.abs(got.weight - want.weight) + (got.italic === want.italic ? 0 : 1000);
    if (score < bestScore) {
      best = st;
      bestScore = score;
    }
  }
  return best;
}

export interface TextOp {
  nodeIds?: string[];
  within?: string;
  family?: string;
  style?: string;
  fontSize?: number;
  fontSizeDelta?: number;
  letterSpacing?: LetterSpacing;
  lineHeight?: LineHeight;
  match?: { family?: string; style?: string; minSize?: number; maxSize?: number };
}

async function textNodesIn(op: TextOp): Promise<TextNode[]> {
  const out: TextNode[] = [];
  for (const id of [...(op.nodeIds || []), ...(op.within ? [op.within] : [])]) {
    const node = await nodeOrNull(id);
    if (!node) continue;
    let page: BaseNode | null = node;
    while (page && page.type !== "PAGE") page = page.parent;
    if (page) await (page as PageNode).loadAsync();
    if (node.type === "TEXT") out.push(node);
    else if ("findAllWithCriteria" in node) out.push(...(node as ChildrenMixin).findAllWithCriteria({ types: ["TEXT"] }));
  }
  return Array.from(new Map(out.map((n) => [n.id, n])).values());
}

// `textStyleId` rides along: a range edit detaches the text style, Undo links it again
const SEG_FIELDS: Array<"fontName" | "fontSize" | "letterSpacing" | "lineHeight" | "textStyleId"> = ["fontName", "fontSize", "letterSpacing", "lineHeight", "textStyleId"];

export async function runTextOps(ops: unknown, revert: boolean): Promise<Record<string, unknown>> {
  if (!Array.isArray(ops) || !ops.length) throw new Error("text: non-empty `ops` list expected");
  const result = { changedLayers: 0, changedRanges: 0, skipped: [] as Array<Record<string, unknown>> };
  const back: Array<{ id: string; segments: any[] }> = [];
  // a layer touched by several ops counts once
  const layers = new Set<string>();
  const families = new Map<string, string[]>();
  const stylesOf = async (family: string) => {
    if (!families.has(family)) {
      families.set(family, ((await listFonts(family)).find((f) => f.family === family) || { styles: [] }).styles);
    }
    return families.get(family)!;
  };
  figma.commitUndo();
  for (const op of ops as TextOp[]) {
    if (op.family && !(await stylesOf(op.family)).length) {
      result.skipped.push({ op: op.family, reason: `font "${op.family}" not available in this Figma` });
      continue;
    }
    for (const node of await textNodesIn(op)) {
      if (node.hasMissingFont) {
        result.skipped.push({ id: node.id, name: node.name, reason: "font missing on this machine" });
        continue;
      }
      const before: any[] = [];
      let touched = false;
      try {
        await loadTextFonts(node);
        for (const seg of node.getStyledTextSegments(SEG_FIELDS)) {
          const m = op.match || {};
          if (m.family && seg.fontName.family !== m.family) continue;
          if (m.style && seg.fontName.style !== m.style) continue;
          if (m.minSize && seg.fontSize < m.minSize) continue;
          if (m.maxSize && seg.fontSize > m.maxSize) continue;
          before.push({
            start: seg.start,
            end: seg.end,
            fontName: seg.fontName,
            fontSize: seg.fontSize,
            letterSpacing: seg.letterSpacing,
            lineHeight: seg.lineHeight,
            ...(seg.textStyleId ? { textStyleId: seg.textStyleId } : {}),
          });
          if (op.family || op.style) {
            const family = op.family || seg.fontName.family;
            const style = op.style || closestStyle(seg.fontName.style, await stylesOf(family)) || seg.fontName.style;
            await loadFont({ family, style });
            node.setRangeFontName(seg.start, seg.end, { family, style });
          }
          if (typeof op.fontSize === "number") node.setRangeFontSize(seg.start, seg.end, op.fontSize);
          else if (typeof op.fontSizeDelta === "number") {
            node.setRangeFontSize(seg.start, seg.end, Math.max(1, seg.fontSize + op.fontSizeDelta));
          }
          if (op.letterSpacing) node.setRangeLetterSpacing(seg.start, seg.end, op.letterSpacing);
          if (op.lineHeight) node.setRangeLineHeight(seg.start, seg.end, op.lineHeight);
          touched = true;
          result.changedRanges++;
        }
      } catch (e: any) {
        result.skipped.push({ id: node.id, name: node.name, reason: e.message });
      }
      // Newest first, like the note's patch: a layer touched by several ops ends on its earliest state
      if (touched) {
        layers.add(node.id);
        result.changedLayers = layers.size;
        back.unshift({ id: node.id, segments: before });
      }
    }
  }
  figma.commitUndo();
  if (result.changedLayers) {
    figma.notify(`Text changed in ${result.changedLayers} layer${result.changedLayers > 1 ? "s" : ""}`);
  }
  return revert ? { ...result, revert: back.length ? { text: back } : null } : result;
}
