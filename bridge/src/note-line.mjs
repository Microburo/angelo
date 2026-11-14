// One line per note, shared by note_wait (MCP) and the notes watcher.
export function noteLine(it) {
  const last = it.thread.at(-1);
  const fromUser = last?.from === "user";
  const kind = fromUser ? (it.status === "working" ? " (message while working)" : " (follow-up)") : "";
  const opts = [
    it.scope === "file" ? "whole file" : "",
    it.variations > 1 ? `${it.variations} versions` : "",
    it.useComments ? `comments: ${it.useComments}` : "",
    it.model ? `model ${it.modelName || it.model} (id ${it.model})` : "",
    it.planFirst ? "plan first" : "",
    it.skill ? `skill ${it.skill}` : "",
    it.library ? `library ${it.library}` : "",
    it.references ? `references: ${it.references.count} from Mobbin` : "",
    it.mentions?.length ? `${it.mentions.length} mention(s)` : "",
    it.attachments?.length ? `${it.attachments.length} file(s)` : "",
    it.batchId ? `batch ${it.batchId} (${it.batchMode})` : "",
    it.priority === "urgent" ? "urgent" : "",
  ].filter(Boolean).join(", ");
  const where = it.scope === "file"
    ? "whole file"
    : it.nodes.length
    ? it.nodes.map((n) => `${n.name} (${n.id})`).join(", ")
    : `page "${it.pageName || "?"}"`;
  const agent = it.agent ? ` → ${it.agent}` : "";
  return `#${it.id} [${it.status}]${agent}${kind}${opts ? ` [${opts}]` : ""}: ${(fromUser ? last.text : it.note).replace(/\s+/g, " ").slice(0, 300)} — ${where}`;
}
