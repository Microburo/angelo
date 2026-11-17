// Node lookup for ids that come from a caller (Claude, a note, a patch).
//
// A malformed id is refused at once: Figma would otherwise wait 10 s and answer
// "Unable to establish connection to Figma". The document root is never returned:
// it is not a scene node and loading it pulls the whole file.

export const NODE_ID = /^I?\d+:\d+(;\d+:\d+)*$/;

const usable = (node: BaseNode | null): node is BaseNode => !!node && "type" in node && node.type !== "DOCUMENT";

/** A node by id, or an error that says what to do instead. */
export async function nodeOf(id: string): Promise<BaseNode> {
  if (!NODE_ID.test(id)) {
    throw new Error(
      `invalid target "${id}" — use "selection", "page" or a node id such as 1:234 (ids come from angelo_read or angelo_status)`,
    );
  }
  let node: BaseNode | null = null;
  try {
    node = await figma.getNodeByIdAsync(id);
  } catch (error) {
    throw new Error(
      `node ${id} not found in this file (Figma gave up loading it) — use an id from angelo_read or angelo_status`,
    );
  }
  if (node && "type" in node && node.type === "DOCUMENT") {
    throw new Error(`${id} is the document itself — target a page or a layer`);
  }
  if (!usable(node)) {
    throw new Error(`unknown node: ${id} — use an id from angelo_read or angelo_status`);
  }
  return node;
}

/** Same checks, but a bad, missing or document id gives null (callers that skip what is gone). */
export async function nodeOrNull(id: unknown): Promise<BaseNode | null> {
  const s = typeof id === "string" ? id : id == null ? "" : String(id);
  if (!NODE_ID.test(s)) return null;
  try {
    const node = await figma.getNodeByIdAsync(s);
    return usable(node) ? node : null;
  } catch {
    return null;
  }
}
