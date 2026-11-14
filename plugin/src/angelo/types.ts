// The Angelo document, as data.
//
// Pure types + vocabulary: no Figma globals anywhere in this folder, so the
// same code runs inside the plugin and in node (roundtrip test, verify).

/**
 * One token of a node line.
 *
 *   pair     `fill:#FFF`        key + ":" + value
 *   flag     `hidden`           key alone
 *   attached `ref(cmp.x){a:b}`  key + value, no separator
 *   bare     `1456x3000`        value alone (the size on a surface line)
 */
export type TokenShape = "pair" | "flag" | "attached" | "bare";

export interface Token {
  key: string;
  value: string | null;
  shape: TokenShape;
}

export interface NodeItem {
  kind: "node";
  depth: number;
  /** FRAME, TEXT, INST, … as emitted, not the Figma type. */
  tag: string;
  /** Real Figma node id: "1:234", or "I1:2;3:4" inside an instance. */
  id: string;
  /** Decoded name (the quoting is re-applied on emit). */
  name: string;
  tokens: Token[];
  /** `+ seg:0-6 …` lines under a text node with mixed styling. */
  extras: ExtraItem[];
  /**
   * `* constr:scale,scale stroke:2 center c.text.primary` under this node:
   * tokens every child line shares, written once. A child line restating a
   * key wins over the default; `tokensOf` gives a child its full set.
   */
  defaults: Token[];
  children: TreeItem[];
}

export interface ExtraItem {
  kind: "extra";
  tokens: Token[];
}

export interface HoleItem {
  kind: "hole";
  depth: number;
  chunk: number;
  nodes: number;
  names: string[];
  /** The hole line ends with ", …" because more than three names were packed. */
  more: boolean;
}

export interface TreeCommentItem {
  kind: "comment";
  depth: number;
  text: string;
}

export type TreeItem = NodeItem | HoleItem | TreeCommentItem;

export type EntryItem =
  /** `@ primitives modes[light|dark] lib` */
  | { kind: "group"; text: string }
  /** `c.surface.default = #FFF | dark:#101010` */
  | { kind: "def"; label: string; value: string }
  /** `# +12 local styles not listed` */
  | { kind: "comment"; text: string };

export type Section =
  | { name: string; kind: "entries"; entries: EntryItem[] }
  | { name: "fonts"; kind: "fonts"; fonts: string[] }
  | { name: "tree"; kind: "tree"; implicit: boolean; items: TreeItem[] };

export interface Doc {
  /** "angelo/1" on a read, null on a chunk (which carries a banner instead). */
  version: string | null;
  head: Token[];
  /** `# chunk 1 of read 4 · in #855:172 · 40 nodes`, text after "# ". */
  banner: string | null;
  sections: Section[];
}

/** Keys that take a value, with the grammar of the value they expect. */
export const PAIR_KEYS: Record<string, string> = {
  // geometry + flags
  at: "x,y",
  wh: "WxH",
  rot: "deg",
  op: "0..1",
  blend: "mode",
  mask: "type",
  // layout
  gap: "n|auto|n/n",
  pad: "n|n,n|n,n,n,n",
  align: "primary,counter",
  size: "h,v",
  grow: "n",
  constr: "h,v",
  // text
  font: "style|family style size",
  lh: "n|n%",
  ls: "n|n%",
  case: "case",
  deco: "deco",
  talign: "align",
  tvalign: "align",
  pspace: "n",
  truncate: "lines",
  autosize: "mode",
  text: '"…"',
  seg: "start-end",
  link: '"…"|node',
  // paint
  fill: "paint",
  stroke: "weight align paint",
  strokew: "t,r,b,l",
  dash: "n,n,…",
  r: "n|tl,tr,br,bl",
  fx: "effect",
  grid: "axis count",
  g: "n",
  m: "n",
  // shapes
  bool: "op",
  vec: "Npaths",
};

/** Keys whose value runs over the following words until the next known key. */
export const GREEDY_KEYS = new Set(["font", "stroke", "grid"]);

/** Valueless keywords. `mask` also exists as a pair (`mask:alpha`). */
export const FLAG_KEYS = new Set([
  "hidden",
  "locked",
  "clip",
  "abs",
  "mask",
  "wrap",
  "col",
  "row",
]);

/** Keys written without a separator, `ref(…)` and `ov{…}`. */
export const ATTACHED_KEYS = new Set(["ref", "ov"]);

/** Header keys, which are their own small vocabulary. */
export const HEAD_KEYS = new Set([
  "units",
  "file",
  "page",
  "scope",
  "nodes",
  "chunks",
  "detail",
]);

export const HEAD_FLAGS = new Set(["truncated"]);

export const TAGS = new Set([
  "FRAME",
  "GROUP",
  "CMP",
  "SET",
  "INST",
  "TEXT",
  "RECT",
  "ELL",
  "POLY",
  "STAR",
  "LINE",
  "VEC",
  "BOOL",
  "SECT",
  "SLICE",
  "STICKY",
  "CONN",
  "SHAPE",
  "TABLE",
  "EMBED",
  "LINK",
  "MEDIA",
  "WIDGET",
  "TAPE",
  "CODE",
]);

export const SECTION_NAMES = new Set([
  "vars",
  "styles",
  "cmp",
  "fonts",
  "tree",
  "vars+",
  "styles+",
  "cmp+",
]);
