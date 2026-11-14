// Document -> text.
//
// Nothing here keeps the original line around: a document is rebuilt from its
// fields alone, which is what makes `parse -> emit` a real test of the parser
// rather than a copy of its input.

import { Doc, ExtraItem, Section, Token, TreeItem } from "./types";

/** Same escaping as serialize/format.ts quote(), kept in sync by the roundtrip. */
export function quote(text: string): string {
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(new RegExp("[\\u2028\\u2029]", "g"), "\\n")
    .replace(new RegExp("\\u00a0", "g"), "\\s");
  return '"' + escaped + '"';
}

export function emitToken(token: Token): string {
  if (token.shape === "flag") return token.key;
  if (token.shape === "bare") return token.value ?? "";
  if (token.shape === "attached") return token.key + (token.value ?? "");
  return `${token.key}:${token.value ?? ""}`;
}

function emitTokens(tokens: Token[]): string {
  return tokens.map(emitToken).join(" ");
}

export function emitNodeHead(tag: string, id: string, name: string): string {
  return `${tag}#${id} ${quote(name)}`;
}

function emitExtra(extra: ExtraItem, depth: number): string {
  return "  ".repeat(depth) + "+ " + emitTokens(extra.tokens);
}

function emitTree(items: TreeItem[], out: string[]): void {
  for (const item of items) {
    const pad = "  ".repeat(item.depth);
    if (item.kind === "comment") {
      out.push(pad + "#" + (item.text ? " " + item.text : ""));
      continue;
    }
    if (item.kind === "hole") {
      // The separator is unconditional on the serializer's side, so it is here
      // too: a hole with no names still reads `· >`.
      const names = item.names.map(quote).join(", ");
      out.push(
        `${pad}<chunk ${item.chunk} · ${item.nodes} nodes · ${names}${
          item.more ? ", …" : ""
        }>`
      );
      continue;
    }
    const tokens = emitTokens(item.tokens);
    out.push(pad + emitNodeHead(item.tag, item.id, item.name) + (tokens ? " " + tokens : ""));
    for (const extra of item.extras) out.push(emitExtra(extra, item.depth + 1));
    if (item.defaults.length) {
      out.push("  ".repeat(item.depth + 1) + "* " + emitTokens(item.defaults));
    }
    emitTree(item.children, out);
  }
}

function emitSection(section: Section): string {
  if (section.kind === "tree") {
    const lines: string[] = [];
    emitTree(section.items, lines);
    return (section.implicit ? [] : ["# tree"]).concat(lines).join("\n");
  }
  if (section.kind === "fonts") {
    return ["# fonts", section.fonts.join(", ")].join("\n");
  }
  const lines = [`# ${section.name}`];
  for (const entry of section.entries) {
    if (entry.kind === "group") lines.push("@ " + entry.text);
    else if (entry.kind === "comment") {
      lines.push("#" + (entry.text ? " " + entry.text : ""));
    } else lines.push(`${entry.label} = ${entry.value}`);
  }
  return lines.join("\n");
}

export function emit(doc: Doc): string {
  const blocks: string[] = [];
  if (doc.version) {
    const head = emitTokens(doc.head);
    blocks.push(doc.version + (head ? " " + head : ""));
  }
  if (doc.banner) blocks.push("# " + doc.banner);
  for (const section of doc.sections) blocks.push(emitSection(section));
  return blocks.join("\n\n");
}
