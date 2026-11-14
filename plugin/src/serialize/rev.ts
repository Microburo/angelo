// Per-node fingerprint.
//
// A write op cites the read it came from; before touching a node the plugin
// fingerprints it again and compares. Different → the design moved since Claude
// read it, and the op is refused rather than overwriting someone's work.
// The fingerprint stays inside the plugin session, so it costs no tokens.

import { fnv1a } from "../angelo/hash";
import { Mains, mainOf } from "./node";

const SEP = "\u0001";

/**
 * Everything a write could collide with. Fields absent on a given node type are
 * skipped, so one list covers every tag.
 */
const FIELDS = [
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "visible",
  "locked",
  "opacity",
  "blendMode",
  "fills",
  "strokes",
  "strokeWeight",
  "strokeAlign",
  "strokeTopWeight",
  "strokeRightWeight",
  "strokeBottomWeight",
  "strokeLeftWeight",
  "dashPattern",
  "effects",
  "cornerRadius",
  "topLeftRadius",
  "topRightRadius",
  "bottomRightRadius",
  "bottomLeftRadius",
  "clipsContent",
  "isMask",
  "maskType",
  "layoutMode",
  "layoutWrap",
  "itemSpacing",
  "counterAxisSpacing",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "primaryAxisAlignItems",
  "counterAxisAlignItems",
  "primaryAxisSizingMode",
  "counterAxisSizingMode",
  "layoutSizingHorizontal",
  "layoutSizingVertical",
  "layoutGrow",
  "layoutPositioning",
  "layoutAlign",
  "constraints",
  "layoutGrids",
  "characters",
  "fontName",
  "fontSize",
  "lineHeight",
  "letterSpacing",
  "textCase",
  "textDecoration",
  "textAlignHorizontal",
  "textAlignVertical",
  "paragraphSpacing",
  "textAutoResize",
  "textTruncation",
  "maxLines",
  "fillStyleId",
  "strokeStyleId",
  "effectStyleId",
  "textStyleId",
  "gridStyleId",
  "boundVariables",
  "componentProperties",
  "variantProperties",
];

function valueOf(value: unknown): string {
  if (typeof value === "symbol") return "mixed";
  if (typeof value === "number") return String(Math.round(value * 100) / 100);
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value) ?? "null";
    } catch {
      return "?";
    }
  }
  return String(value);
}

// The fields a node type has: looked up once per type, not once per node
// (each `in` crosses the plugin sandbox)
const byType = new Map<string, string[]>();
function fieldsOf(node: SceneNode): string[] {
  let fields = byType.get(node.type);
  if (!fields) {
    fields = FIELDS.filter((field) => field in (node as any));
    byType.set(node.type, fields);
  }
  return fields;
}

/**
 * `mains` is the cache of the pass in progress (a read, or the check pass of a
 * batch); the diff after a write passes none, so a swapped instance is seen
 * with a fresh lookup.
 */
export async function revOf(node: SceneNode, mains?: Mains): Promise<string> {
  const any = node as any;
  const parts: string[] = [node.type, node.name];
  for (const field of fieldsOf(node)) {
    const value = any[field];
    if (value === undefined) continue;
    parts.push(`${field}:${valueOf(value)}`);
  }
  // Which component an instance points at, and the order of the children: a
  // reorder or a swap must invalidate the fingerprint too. The main component is
  // read through the async accessor: with documentAccess "dynamic-page" the
  // synchronous one throws, and the whole read dies on the first instance.
  if (node.type === "INSTANCE") {
    const main = await mainOf(node, mains);
    if (main) parts.push(`main:${main.id}`);
  }
  if (Array.isArray(any.children)) {
    parts.push(`kids:${any.children.map((child: BaseNode) => child.id).join(",")}`);
  }
  return fnv1a(parts.join(SEP));
}
