// Text -> document.
//
// Strict on purpose: anything the serializer cannot have produced is an error
// with a line and a column, never a silent guess. A patch is applied against
// what was parsed, so a wrong guess here would write to the wrong node.

import { LexError, headTokens, readQuoted, tokens } from "./lex";
import {
  Doc,
  EntryItem,
  ExtraItem,
  HoleItem,
  NodeItem,
  SECTION_NAMES,
  Token,
  TreeItem,
} from "./types";

export class ParseError extends Error {
  constructor(message: string, readonly line: number, readonly col: number) {
    super(`line ${line}:${col} — ${message}`);
  }
}

const NODE_HEAD = /^([A-Z][A-Z_]*)#([0-9I][0-9:;I]*) /;
const HOLE = /^<chunk (\d+) · (\d+) nodes · (.*?)(, …)?>$/;
const SECTION = /^# ([a-z]+\+?)$/;
const BANNER = /^# (chunk \d+ of read .*|[0-9I][0-9:;I]* · .*)$/;

interface Cursor {
  lines: string[];
  at: number;
}

function fail(message: string, cursor: Cursor, col = 1): never {
  throw new ParseError(message, cursor.at + 1, col);
}

function lift<T>(cursor: Cursor, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof LexError) fail(error.message, cursor, error.at + 1);
    throw error;
  }
}

function indentOf(line: string, cursor: Cursor): number {
  let spaces = 0;
  while (line[spaces] === " ") spaces++;
  if (spaces % 2 !== 0) fail(`odd indentation (${spaces} spaces)`, cursor);
  return spaces / 2;
}

function parseNames(list: string | undefined, cursor: Cursor): string[] {
  if (!list) return [];
  const out: string[] = [];
  let rest = list;
  while (rest.length) {
    const quoted = lift(cursor, () => readQuoted(rest, 0));
    out.push(quoted.value);
    rest = rest.slice(quoted.end);
    if (rest.startsWith(", ")) rest = rest.slice(2);
    else if (rest.length) fail(`separator expected in the hole: "${rest}"`, cursor);
  }
  return out;
}

function parseNodeLine(line: string, depth: number, cursor: Cursor): NodeItem {
  const body = line.slice(depth * 2);
  const head = NODE_HEAD.exec(body);
  if (!head) fail("node line expected (TAG#id \"name\" …)", cursor, depth * 2 + 1);
  const after = head[0].length;
  const quoted = lift(cursor, () => readQuoted(body, after));
  const rest = body.slice(quoted.end);
  if (rest.length && rest[0] !== " ") {
    fail("space expected after the name", cursor, depth * 2 + quoted.end + 1);
  }
  return {
    kind: "node",
    depth,
    tag: head[1],
    id: head[2],
    name: quoted.value,
    tokens: lift(cursor, () =>
      tokens(rest.slice(1), depth * 2 + quoted.end + 1)
    ),
    extras: [],
    defaults: [],
    children: [],
  };
}

function parseDefaults(line: string, depth: number, cursor: Cursor): Token[] {
  const body = line.slice(depth * 2 + 2);
  return lift(cursor, () => tokens(body, depth * 2 + 2));
}

function parseExtra(line: string, depth: number, cursor: Cursor): ExtraItem {
  const body = line.slice(depth * 2 + 2);
  return {
    kind: "extra",
    tokens: lift(cursor, () => tokens(body, depth * 2 + 2)),
  };
}

function parseHole(line: string, depth: number, cursor: Cursor): HoleItem {
  const hole = HOLE.exec(line.slice(depth * 2));
  if (!hole) fail("malformed chunk hole", cursor, depth * 2 + 1);
  return {
    kind: "hole",
    depth,
    chunk: Number(hole[1]),
    nodes: Number(hole[2]),
    names: parseNames(hole[3], cursor),
    more: hole[4] !== undefined,
  };
}

/**
 * Tree lines, indentation into nesting. Stops at the first blank line or
 * section header, so a chunk can be followed by its addendum.
 */
function parseTree(cursor: Cursor): TreeItem[] {
  const roots: TreeItem[] = [];
  // stack[d] holds the node that owns depth d + 1.
  const stack: NodeItem[] = [];

  while (cursor.at < cursor.lines.length) {
    const line = cursor.lines[cursor.at];
    if (line === "") break;
    if (SECTION.test(line) || BANNER.test(line)) break;

    const depth = indentOf(line, cursor);
    const body = line.slice(depth * 2);
    if (depth > stack.length) {
      fail(`indentation jump (depth ${depth} under ${stack.length})`, cursor);
    }
    stack.length = depth;
    const parent = depth ? stack[depth - 1] : null;
    const into = parent ? parent.children : roots;

    if (body.startsWith("+ ")) {
      if (!parent) fail("\"+\" line without a parent node", cursor);
      parent.extras.push(parseExtra(line, depth, cursor));
      cursor.at++;
      continue;
    }
    if (body.startsWith("* ")) {
      // Shared by the children: one line, before the first of them.
      if (!parent) fail("\"*\" line without a parent node", cursor);
      if (parent.defaults.length) fail("second \"*\" line under the same node", cursor);
      if (parent.children.length) fail("\"*\" line after a child", cursor);
      parent.defaults = parseDefaults(line, depth, cursor);
      if (!parent.defaults.length) fail("empty \"*\" line", cursor);
      cursor.at++;
      continue;
    }
    if (body.startsWith("<")) {
      into.push(parseHole(line, depth, cursor));
      cursor.at++;
      continue;
    }
    if (body.startsWith("#")) {
      into.push({ kind: "comment", depth, text: body.slice(1).replace(/^ /, "") });
      cursor.at++;
      continue;
    }

    const node = parseNodeLine(line, depth, cursor);
    into.push(node);
    stack[depth] = node;
    cursor.at++;
  }
  return roots;
}

function parseEntries(cursor: Cursor): EntryItem[] {
  const out: EntryItem[] = [];
  while (cursor.at < cursor.lines.length) {
    const line = cursor.lines[cursor.at];
    if (line === "" || SECTION.test(line) || BANNER.test(line)) break;
    if (line.startsWith("@ ")) out.push({ kind: "group", text: line.slice(2) });
    else if (line.startsWith("#")) {
      out.push({ kind: "comment", text: line.slice(1).replace(/^ /, "") });
    } else {
      const split = line.indexOf(" = ");
      if (split <= 0) fail("entry expected (\"label = value\")", cursor);
      out.push({
        kind: "def",
        label: line.slice(0, split),
        value: line.slice(split + 3),
      });
    }
    cursor.at++;
  }
  return out;
}

export function parse(text: string): Doc {
  const cursor: Cursor = { lines: text.replace(/\n+$/, "").split("\n"), at: 0 };
  const doc: Doc = { version: null, head: [], banner: null, sections: [] };

  const first = cursor.lines[0] ?? "";
  if (/^angelo\//.test(first)) {
    const space = first.indexOf(" ");
    doc.version = space < 0 ? first : first.slice(0, space);
    doc.head = space < 0 ? [] : lift(cursor, () => headTokens(first.slice(space + 1), space + 1));
    cursor.at++;
  }

  while (cursor.at < cursor.lines.length) {
    const line = cursor.lines[cursor.at];
    if (line === "") {
      cursor.at++;
      continue;
    }

    const banner = BANNER.exec(line);
    if (banner) {
      if (doc.banner) fail("second banner in the same document", cursor);
      doc.banner = banner[1];
      cursor.at++;
      continue;
    }

    const section = SECTION.exec(line);
    if (section) {
      const name = section[1];
      if (!SECTION_NAMES.has(name)) fail(`unknown section "${name}"`, cursor);
      cursor.at++;
      if (name === "tree") {
        doc.sections.push({
          name: "tree",
          kind: "tree",
          implicit: false,
          items: parseTree(cursor),
        });
      } else if (name === "fonts") {
        const list = cursor.lines[cursor.at] ?? "";
        cursor.at++;
        doc.sections.push({
          name: "fonts",
          kind: "fonts",
          fonts: list ? list.split(", ") : [],
        });
      } else {
        doc.sections.push({ name, kind: "entries", entries: parseEntries(cursor) });
      }
      continue;
    }

    // A chunk carries its tree straight after the banner, with no `# tree`;
    // a bare fragment (no header, no manifest) is read the same way.
    const bare = doc.version === null && !doc.sections.length;
    if (!doc.banner && !bare) fail("line outside a section", cursor);
    const items = parseTree(cursor);
    if (!items.length) fail("line outside a section", cursor);
    doc.sections.push({ name: "tree", kind: "tree", implicit: true, items });
  }

  return doc;
}

/**
 * A node's tokens with its parent's `*` defaults folded in: a key the line
 * restates keeps the line's value, the rest comes from the defaults. This is
 * what a line means; `node.tokens` is only what it says.
 */
export function tokensOf(node: NodeItem, parent: NodeItem | null): Token[] {
  if (!parent || !parent.defaults.length) return node.tokens;
  const own = new Set(node.tokens.map((token) => token.key));
  const inherited = parent.defaults.filter((token) => !own.has(token.key));
  return node.tokens.concat(inherited);
}

/** Every node of a document, parents before children. */
export function nodesOf(doc: Doc): NodeItem[] {
  const out: NodeItem[] = [];
  const walk = (items: TreeItem[]): void => {
    for (const item of items) {
      if (item.kind !== "node") continue;
      out.push(item);
      walk(item.children);
    }
  };
  for (const section of doc.sections) {
    if (section.kind === "tree") walk(section.items);
  }
  return out;
}
