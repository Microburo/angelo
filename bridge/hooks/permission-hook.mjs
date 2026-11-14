#!/usr/bin/env node
// Ported from Retoucher (https://github.com/alicorak/retoucher), MIT License, Copyright (c) 2026 Ali Çorak. See THIRD_PARTY_LICENSES.
// Claude Code PermissionRequest hook: asks the permission in the angelo Figma panel instead of the terminal,
// only while the panel is open and Claude is working on a note. Otherwise, or after WAIT_MS without an
// answer, it prints nothing and Claude Code asks in the terminal as usual. The angelo tools that only read
// Figma or talk to the panel are allowed without asking, so the note loop never stalls on them.
import { readStdin, noteInPanel, askPanel } from "./hook-lib.mjs";

const WAIT_MS = 110_000; // keep under the hook's timeout (120 s)

const out = (decision) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision } }));
  process.exit(0);
};
const passThrough = () => process.exit(0); // no decision: the terminal asks

// note_text changes the file, so the designer still decides it
const SAFE = /^mcp__angelo__(angelo_status|angelo_read|angelo_expand|note_(?!text$)[a-z_]+)$/;

const MCP_TITLES = {
  local_figma_use: "Edit the Figma file",
  angelo_apply: "Edit the Figma file",
  note_text: "Change text in the Figma file",
};
function describe(tool, input = {}) {
  const json = (s) => JSON.stringify(s, null, 2);
  if (tool === "Bash") return { title: "Run a command", sub: input.description || "", detail: input.command || "" };
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
    return { title: tool === "Write" ? "Write a file" : "Edit a file", sub: input.file_path || input.notebook_path || "", detail: json(input).slice(0, 3000) };
  }
  if (tool === "Read") return { title: "Read a file", sub: input.file_path || "", detail: "" };
  if (tool === "WebFetch") return { title: "Open a web page", sub: input.url || "", detail: input.prompt || "" };
  if (tool === "WebSearch") return { title: "Search the web", sub: input.query || "", detail: "" };
  const m = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (m) return { title: MCP_TITLES[m[2]] || `Use ${m[2].replace(/_/g, " ")}`, sub: input.description || input.query || "", detail: json(input).slice(0, 3000) };
  return { title: `Use ${tool}`, sub: input.description || "", detail: json(input).slice(0, 3000) };
}

// "Always allow" saves what the terminal would offer as "don't ask again"
function alwaysRule(tool, suggestions) {
  const rules = (suggestions || []).filter((s) => s.type === "addRules" && s.behavior === "allow");
  const updates = rules.length ? rules : [{ type: "addRules", rules: [{ toolName: tool }], behavior: "allow", destination: "localSettings" }];
  const label = updates.flatMap((u) => u.rules.map((r) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName))).join(", ");
  return { updates, label };
}

const input = JSON.parse((await readStdin()) || "{}");
const tool = input.tool_name || "";
if (SAFE.test(tool)) out({ behavior: "allow" });
// questions and plan approval go through ask-hook.mjs (PreToolUse), which can pass the answers on
if (!tool || tool === "AskUserQuestion" || tool === "ExitPlanMode") passThrough();

const note = await noteInPanel();
if (!note) passThrough();
const { updates, label } = alwaysRule(tool, input.permission_suggestions);
const p = await askPanel({ kind: "permission", ...describe(tool, input.tool_input), rule: label, noteId: note.id }, WAIT_MS);
if (!p) passThrough();
if (p.decision === "once") out({ behavior: "allow" });
if (p.decision === "always") out({ behavior: "allow", updatedPermissions: updates });
out({ behavior: "deny", message: "The designer declined this in the Figma panel. Do not retry it; say in the note what you could not do, or ask with note_ask." });
