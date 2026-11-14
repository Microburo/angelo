// Self-correction of the selected Figma node, run headless by Claude Code. Two contexts:
// - a frame built by web-to-figma (--case): web-to-figma skill step 6, differences against the
//   capture → cause from data → in-place patch → web-compare → again. The page is never rebuilt.
// - --case and --issues together: what tools/web-fix.mjs left off on a web build (fix.json `rest`,
//   each line with its node id), the only part of step 6 still handed to a model
// - any other node (--issues): the checks the plugin panel could not settle alone (lint of the
//   components it is or uses, # warn lines with several answers) → fixed in place → checked again.
// Progress goes to stdout one short line at a time (the bridge relays each line to the plugin panel),
// the final report to <case>/autofix.md, or tests/autofix/<node id>.md.
//
// Usage: node tools/autofix.mjs --file <Figma file> --root <node id> (--case <dir> | --issues <json>)
//        [--focus <node id> --box x,y,w,h] [--model sonnet] [--effort medium]

import { spawn } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const file = opt("--file");
const root = opt("--root");
const caseDir = opt("--case") ? relative(ROOT, resolve(opt("--case"))) : null;
// the node selected inside the page frame, and its box in that frame (x,y,w,h): the part to make conform
const focus = opt("--focus");
const box = opt("--box");
const issues = opt("--issues") ? JSON.parse(opt("--issues")) : null;
if (!file || !root || (!caseDir && !issues)) throw new Error("usage: autofix.mjs --file <Figma file> --root <id> (--case <dir> | --issues <json>)");

// the bridge runs detached, outside any shell PATH: the installed CLI, not a session shim
const CLI = [process.env.CLAUDE_BIN, join(homedir(), ".local/bin/claude")].find((p) => p && existsSync(p));
if (!CLI) throw new Error("claude CLI not found (~/.local/bin/claude, or CLAUDE_BIN)");

const common = [
  `Work through the angelo MCP only (angelo_read, angelo_apply, local_figma_use); read before writing, never getNodeByIdAsync an id you did not read. Do not commit.`,
  `End with a short report in French: what was fixed (before → after), what is not fixable here and why.`,
];
const prompt = caseDir && issues
  ? [
      `Fix what the deterministic fixer (tools/web-fix.mjs) left off in the Figma frame #${root} of the file "${file}", built by web-to-figma from the case ${caseDir}/. Capture coordinates are relative to the frame; the reference is ${caseDir}/capture.json (boxes: text, font, lines, x/y/w/h), page.jpg only to look:`,
      ...issues.map((i) => `- ${i}`),
      `Only these nodes are in scope. The page is already in Figma: patch in place, never rebuild. Find the cause in the node's auto-layout (sizing, padding, gap, alignment) before touching x/y.`,
      `After the patches: node tools/web-fix.mjs ${caseDir} --file "${file}" --root ${root} (re-runs the fixer and the compare; its last line says what is left).`,
      ...common,
    ]
  : caseDir
  ? [
      focus
        ? `Fix the Figma node #${focus} so it conforms to its reference. It sits in the page frame #${root} of the file "${file}", built by web-to-figma from the case ${caseDir}/; its box in that frame is x,y,w,h = ${box}. The reference is the same region of ${caseDir}/page.jpg, with the matching boxes of capture.json (text, fonts, sizes, colours, spacing). Crop both sides to that region, list every difference, fix them all. Only this node and what it holds are in scope.`
        : `Self-correct the Figma frame #${root} in the file "${file}", built by web-to-figma from the case ${caseDir}/.`,
      `Follow skill/web-to-figma/SKILL.md step 6 (and its Working discipline) to the letter. The page is already in Figma: never rebuild it, patch its nodes in place, a section beyond repair goes through --part only.`,
      `web-compare has just run: start from ${caseDir}/compare-*.jpg, overlay-*.jpg, elements.json, figma.json vs capture.json. After each patch: node tools/web-compare.mjs ${caseDir} --file "${file}" --root ${root}.`,
      `A generic cause belongs in tools/web-* with npm run web-check, never a one-off hack.`,
      ...common,
    ]
  : [
      `Fix the Figma node #${root} (selected in the file "${file}") and the components it is or uses. The plugin's check left these issues:`,
      ...issues.map((i) => `- ${i}`),
      `Lint rules and their meaning: plugin/src/lint-rules.mjs (RULES). Component structure: skill figma-structured-build; layout and tokens: skill design-standards. Fix in place, on the main component when the issue is the component's (rename an axis value, turn a two-variant difference into a boolean property, …), keeping every existing instance working.`,
      `Check again after the fixes: local_figma_use \`return await H.lint(await H.byId("${root}"))\` and angelo_read on the node (its # warn section), until clean or only issues that need a designer's decision remain.`,
      ...common,
    ];

const child = spawn(
  CLI,
  ["-p", prompt.join("\n"), "--model", opt("--model", "sonnet"), "--effort", opt("--effort", "medium"), "--permission-mode", "bypassPermissions", "--output-format", "stream-json", "--verbose"],
  { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }
);

// one short line per tool call: what the panel shows while the loop runs
const hint = (name, input = {}) => {
  const short = name.replace(/^mcp__\w+__/, "");
  const detail = input.description || input.label || input.command || input.file_path || input.pattern || "";
  return `${short}${detail ? ` · ${String(detail).split("\n")[0].slice(0, 90)}` : ""}`;
};

let buffer = "";
let report = "";
let failed = null;
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop();
  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "assistant") {
      for (const part of event.message?.content || []) {
        if (part.type === "tool_use") console.log(hint(part.name, part.input));
      }
    } else if (event.type === "result") {
      report = event.result || "";
      if (event.is_error) failed = report.split("\n")[0] || event.subtype;
    }
  }
});
child.stderr.on("data", (chunk) => process.stderr.write(chunk));
child.on("close", (code) => {
  let out = null;
  if (report) {
    out = caseDir ? join(caseDir, "autofix.md") : join("tests/autofix", `${root.replace(/[^\w-]/g, "-")}.md`);
    mkdirSync(resolve(ROOT, out, ".."), { recursive: true });
    writeFileSync(join(ROOT, out), report + "\n");
  }
  if (failed || code !== 0) {
    console.error(`Error: autofix ${failed || `exit ${code}`}`);
    process.exit(1);
  }
  // the last line the panel keeps: the report's first line, the rest is in the report file
  console.log(`${report.split("\n").find((l) => l.trim()) || "autofix done"}${out ? ` (${out})` : ""}`);
});
