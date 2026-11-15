// Grammar validator.
//
// The parser refuses what it cannot read; the validator refuses what it can
// read but the serializer would never write — a value in the wrong shape, an
// id that is not a Figma id, a duplicate node, a flag on a node that cannot
// carry it. It runs on the plugin side before any op touches the file.

import { Doc, NodeItem, TAGS, Token } from "./types";
import { nodesOf } from "./parse";

export interface Problem {
  /** Node id, or "head" / "tree" for document-level problems. */
  where: string;
  message: string;
}

const NUM = /^-?\d+(\.\d+)?$/;
const PCT = /^-?\d+(\.\d+)?%$/;
const ID = /^I?\d+:\d+(;\d+:\d+)*$/;
const HEXC = /^#([0-9A-F]{3}|[0-9A-F]{6}|[0-9A-F]{8})$/;
const LABEL = /^[a-z][a-z0-9.\-_]*$/;

const ALIGNS = new Set(["start", "center", "end", "between", "baseline"]);
const SIZINGS = new Set(["fixed", "hug", "fill", "-"]);
const CONSTRAINTS = new Set(["min", "max", "center", "stretch", "scale"]);

function nums(value: string, counts: number[]): boolean {
  const parts = value.split(",");
  if (counts.indexOf(parts.length) < 0) return false;
  return parts.every((part) => NUM.test(part));
}

/**
 * Numbers, or the labels of the variables bound in their place: spacing and
 * radius are tokenized, and the read shows the token rather than the value it
 * resolves to, side by side with plain numbers on the same key.
 */
function numsOrVars(value: string, counts: number[]): boolean {
  const parts = value.split(",");
  if (counts.indexOf(parts.length) < 0) return false;
  return parts.every((part) => NUM.test(part) || LABEL.test(part));
}

function pairOf(value: string, allowed: Set<string>): boolean {
  const parts = value.split(",");
  return parts.length === 2 && parts.every((part) => allowed.has(part));
}

/** A paint: hex, legend label, gradient, image, or several joined by "+". */
function paint(value: string): boolean {
  return value.split("+").every((part) => {
    const token = part.split("@")[0];
    if (HEXC.test(token)) return true;
    if (token === "mixed" || token === "video") return true;
    if (/^img\(/.test(token) || /^grad\.[a-z]+\(/.test(token)) return true;
    return LABEL.test(token);
  });
}

function checkToken(token: Token, where: string, out: Problem[]): void {
  const value = token.value ?? "";
  const bad = (what: string): void => {
    out.push({
      where,
      message: `${token.key}:${value} — ${what}`,
    });
  };

  switch (token.key) {
    case "at":
      if (!nums(value, [2])) bad("two numbers expected");
      return;
    case "wh":
      if (!/^-?\d+(\.\d+)?x-?\d+(\.\d+)?$/.test(value)) bad("WxH expected");
      return;
    case "rot":
    case "grow":
    case "pspace":
    case "g":
    case "m":
      if (!NUM.test(value)) bad("number expected");
      return;
    case "op":
      if (!NUM.test(value) || Number(value) < 0 || Number(value) > 1) {
        bad("opacity between 0 and 1 expected");
      }
      return;
    case "truncate":
      if (!/^\d+$/.test(value)) bad("line count expected");
      return;
    case "gap":
      if (value !== "auto") {
        const [main, counter] = value.split("/");
        if (!NUM.test(main) && !LABEL.test(main)) bad("number, variable or auto expected");
        if (counter !== undefined && !NUM.test(counter) && !LABEL.test(counter)) {
          bad("invalid counter spacing");
        }
      }
      return;
    case "pad":
      if (!numsOrVars(value, [1, 2, 4])) bad("1, 2 or 4 numbers or variables expected");
      return;
    case "r":
      if (!numsOrVars(value, [1, 4])) bad("1 or 4 numbers or variables expected");
      return;
    case "dash":
      if (!value.split(",").every((part) => NUM.test(part))) bad("numbers expected");
      return;
    case "strokew":
      if (!nums(value, [1, 4])) bad("1 or 4 numbers expected");
      return;
    case "align":
      if (!pairOf(value, ALIGNS)) bad("primary,counter expected");
      return;
    case "size":
      if (!pairOf(value, SIZINGS)) bad("fixed|hug|fill|- on both axes expected");
      return;
    case "constr":
      if (!pairOf(value, CONSTRAINTS)) bad("constraints h,v expected");
      return;
    case "lh":
    case "ls":
      if (!NUM.test(value) && !PCT.test(value)) bad("number or percentage expected");
      return;
    case "fill":
    case "regionfill":
      if (!paint(value)) bad("invalid paint");
      return;
    case "stroke": {
      const parts = value.split(" ");
      if (parts.length < 3) {
        bad("weight, alignment and paint expected");
        return;
      }
      if (parts[0] !== "mixed" && !nums(parts[0], [1, 4])) bad("invalid weight (1 or 4 numbers)");
      if (["inside", "outside", "center"].indexOf(parts[1]) < 0) bad("invalid alignment");
      if (!paint(parts.slice(2).join(" "))) bad("invalid paint");
      return;
    }
    case "font": {
      // `font:t.body` (a style) or `font:Family Style Size`.
      const parts = value.split(" ");
      if (parts.length === 1) {
        if (value !== "mixed" && !LABEL.test(value)) bad("style or font expected");
      } else {
        const size = parts[parts.length - 1];
        if (size !== "mixed" && !NUM.test(size)) bad("size expected last");
      }
      return;
    }
    case "grid": {
      const parts = value.split(" ");
      if (["cols", "rows", "square"].indexOf(parts[0]) < 0) bad("invalid axis");
      if (parts.length < 2) bad("count or step expected");
      else if (parts[1] !== "auto" && !NUM.test(parts[1])) bad("invalid count");
      return;
    }
    case "seg":
      if (!/^\d+-\d+$/.test(value)) bad("start-end expected");
      return;
    case "vec":
      if (!/^\d+paths$/.test(value)) bad("Npaths expected");
      return;
    case "text":
    case "link":
      // Already decoded by the lexer; a quoted value is all the grammar asks.
      if (value !== "node" && !/^".*"$/.test(value)) bad("string expected");
      return;
    case "row":
    case "col":
    case "wrap":
    case "hidden":
    case "locked":
    case "clip":
      // A keyword alone on a node line, on/off as a write prop.
      if (token.shape === "flag") return;
      if (value !== "on" && value !== "off") bad("\"on\" or \"off\" expected");
      return;
    case "ref":
      if (!/^\((\?|[a-z][a-z0-9.\-_]*)\)(\{.*\})?$/.test(value)) bad("ref(cmp…) expected");
      return;
    case "ov":
      if (!/^\{.*\}$/.test(value)) bad("ov{…} expected");
      return;
    default:
      return;
  }
}

/**
 * Keys the serializer legitimately writes more than once on a line: one `grid:`
 * per layout grid (each with its own `g:`/`m:`), and on a segment line a style
 * label followed by the resolved family (`font:t.body font:TWK Everett 12`, as
 * older reads wrote it — the family now goes out only without a label).
 */
const REPEATABLE = new Set(["grid", "g", "m", "font"]);

function checkTokens(tokens: Token[], node: NodeItem, out: Problem[]): void {
  const keys = new Set<string>();
  for (const token of tokens) {
    if (token.shape === "bare") continue;
    if (keys.has(token.key) && !REPEATABLE.has(token.key)) {
      out.push({ where: node.id, message: `repeated key "${token.key}"` });
    }
    keys.add(token.key);
    checkToken(token, node.id, out);
  }
}

/**
 * Props of a write op: the same vocabulary as a node line, one key at a time.
 * `allowed` is the writable subset — the write side owns that list, the shape
 * of each value is checked here, so read and write never drift apart.
 */
export function checkProps(
  props: Record<string, unknown>,
  where: string,
  allowed: Set<string>
): Problem[] {
  const out: Problem[] = [];
  for (const key of Object.keys(props)) {
    if (!allowed.has(key)) {
      out.push({ where, message: `read-only property "${key}"` });
      continue;
    }
    const value = props[key];
    if (typeof value !== "string") {
      out.push({ where, message: `"${key}": text value expected` });
      continue;
    }
    checkToken({ key, value, shape: "pair" }, where, out);
  }
  return out;
}

export function validate(doc: Doc): Problem[] {
  const out: Problem[] = [];

  if (doc.version && doc.version !== "angelo/1") {
    out.push({ where: "head", message: `unsupported version: ${doc.version}` });
  }
  if (doc.version) {
    const units = doc.head.filter((token) => token.key === "units")[0];
    if (!units) out.push({ where: "head", message: "units missing" });
    else if (units.value !== "px") {
      out.push({ where: "head", message: `units:${units.value} not supported` });
    }
  }

  const seen = new Set<string>();
  for (const node of nodesOf(doc)) {
    if (!ID.test(node.id)) {
      out.push({ where: node.id, message: "Figma node id expected (1:234)" });
    }
    if (seen.has(node.id)) {
      out.push({ where: node.id, message: "node present twice" });
    }
    seen.add(node.id);
    if (!TAGS.has(node.tag)) {
      out.push({ where: node.id, message: `unknown type "${node.tag}"` });
    }
    checkTokens(node.tokens, node, out);
    if (node.tag === "INST" && node.children.length) {
      out.push({ where: node.id, message: "an instance has no children in Angelo" });
    }
    for (const extra of node.extras) {
      if (!extra.tokens.length || extra.tokens[0].key !== "seg") {
        out.push({ where: node.id, message: "\"+\" line without seg:" });
        continue;
      }
      checkTokens(extra.tokens, node, out);
    }
    if (node.defaults.length) {
      checkTokens(node.defaults, node, out);
      if (node.defaults.some((token) => token.shape === "bare")) {
        out.push({ where: node.id, message: "\"*\" line with a value but no key" });
      }
      if (!node.children.some((item) => item.kind === "node")) {
        out.push({ where: node.id, message: "\"*\" line without a child" });
      }
    }
  }
  return out;
}
