---
name: angelo-notes
description: Watch and handle notes a designer leaves in the Angelo Figma panel (notes watcher, claim, inspect, change the file with angelo, snapshot, reply, undo). Use when the designer says "/angelo-notes", "watch my notes", "handle the Figma notes", or a notes watcher event arrives.
---

# angelo-notes

The designer writes notes in the Angelo panel inside Figma (text, target layers, attached files, @mentions, options). You pick them up through the `angelo` MCP, change the file with angelo's own write tools, and reply in the panel. Workflow and panel UX ported from Retoucher (MIT, Copyright (c) 2026 Ali Çorak).

Read the `angelo` skill first for reading and writing Figma (`angelo_read`, `angelo_apply`, `local_figma_use`).

## Start

1. `note_offer_skills` with the skills that fit design work (name + one-line description), and `note_offer_models` with the models you can hand a note to as a helper agent (real names). The panel lists them per note.
2. `note_list` (pending) and handle each, oldest first.
3. Watch: `Monitor` on `node bridge/src/watch.mjs` (from the angelo repo, timeout_ms 1800000, description "notes Angelo"). Each new note, follow-up or message arrives as one JSON line: `note` (summary with id, targets, options) and, for a new note when nothing is in Working, `read` (path of the Angelo read of its first target, still the last read so `angelo_apply` works on it). The watcher keeps "Claude ready" on in the panel, claims each new note (Working) and stores its before picture. At expiry re-arm it, silently; never stop it on your own, the designer stops it. Without Monitor, fall back to `note_wait` (timeout_sec 280) in a loop.

## One note

Speed: the designer waits on every tool call you make (about 3 s each); the Figma side takes under 100 ms. A simple note (duplicate, rename, recolor, resize, rebind) is **one call**: the watcher event carries the target's tree inline (`tree`, short targets), so no file read and no `note_show` (only when the line says `file(s)` or the text points at something not in the tree); one `local_figma_use` (or `angelo_apply`) with `note` + `finish: "<reply>"` (+ `focus` when the changed layers are not the targets) that finds what to change and changes it in the same script, defensive (filter by structure, skip what already matches, return counts). No separate inspection call: inspect inside the change script. The note is done when the call returns; the after picture follows on its own.

1. A watcher note is already claimed; otherwise `note_claim` → the panel shows Working.
2. `note_show` only when the event line is not enough → text, targets (layer ids), attachments, mentions, options (skill, model, mode, references), thread, file key.
3. `note_step` before each stage of a long note (skip it for a simple one), in the designer's words ("Reading the hero", "Placing 5 of 12"). Short, no tool names.
4. Read only what the note targets: the file at the event's `read` path when it came with one, else `angelo_read` on the target ids, `angelo_expand` for a chunk. Never read the whole page to find one layer. Notes carry no picture: the structure is enough. Only when the structure truly blocks you, take one with `H.shot(node)` in `local_figma_use`.
5. Unclear intent: multiple choice → `note_ask_designer` (1–4 questions, waits); open question → `note_ask` and stop; more than a few changes or anything destructive → `note_plan` and stop until approved. Answers arrive as follow-ups through the watcher.
6. Before picture: done by the watcher; otherwise `note_snapshot` kind `before` with the main target node.
7. Change the file:
   - `angelo_apply` with `note: <id>` for set / insert / clone / reorder / each on the read `sid`.
   - `local_figma_use` with `note: <id>` for anything else. Create nodes with `H.frame` / `H.text`, or call `H.keep(node)` before changing a node, so Undo can restore it.
   - Text styling (family, style, size, spacing, line height) only with `note_text` with `note: <id>`; `note_fonts` lists the fonts installed locally.
   - Each of these records its own revert patch behind the note's Undo. A change made another way → `note_undo_patch` with the reverse.
8. `note_finish` with `focus` (or `finish` on the last change call): the changed layer ids (the first one becomes the after picture). Reply text: very concise and direct: one short line saying what changed, at most 2-3 terse "- " bullets only when needed (what was left out and why), no explanations, no restating the note, links as `[name](url)`. No tool names, no ids, no code. Pictures only when they help.

After `note_finish`, end the turn at once: no checks, no reading back, no terminal summary. The change call's reply is the proof.

Something you could not do → say it in the reply instead of guessing. Never mark a note done without an answer.

## Agents

Five agents at most work on notes: **main** (you, the main session) and four helpers, **Berta, Maximus, Nora, Rosa** (background agents: model `sonnet`, effort `medium`). The bridge assigns each claimed note an agent, shown in the event line (`#12 [working] → Berta`) and in the panel; a sixth note stays Pending until an agent is free, then arrives through the watcher. Figma runs one call at a time: every agent's call waits its turn (and for a running web-to-figma build), so agents never collide in the file; each agent has its own read, so a helper's read never voids yours.

- Note → **main**: do it yourself, as in "One note".
- Note → a helper: launch it at once as a background `Agent` (`model: "sonnet"`, `effort: "medium"`, `run_in_background: true`, name and description = the helper's name + note id), then go back to waiting. Brief: the event line, the `read` path, the note id, this skill's "One note" and "Rules", and "pass `agent: \"<Name>\"` on every `angelo_read`, `angelo_expand`, `angelo_apply` and `local_figma_use` call; end with `note_finish`". Its reply comes back as a notification: nothing to relay, the panel already shows it.
- **A note that splits** (independent parts: distinct layers, screens or frames, no node shared between parts) → `note_split` with the number of parts beyond yours; hand each helper you got one part (same brief + its part, "do not call `note_finish`, reply with the changed layer ids"), do your part, then one `note_finish` with every part's ids once all are back. No helper free → do every part yourself.
- A batch "at the same time" arrives already spread over several agents; a batch "in order" stays with one agent, who does its notes in order.
- `note.model` set on a note overrides the helper's model.

## Follow-ups

A watcher event with a new designer message is a follow-up: read the thread with `note_show`, answer the last message only. A plan approved → do it; changes asked → revise with `note_plan`. `note_rewrite` replaces your last reply when you got it wrong.

## Options on a note

- **Skill**: load and follow it for this note.
- **Model**: run the note's agent on that model (see Agents); for a note of yours, hand it to a background agent on that model with the same brief.
- **References** (design-reference links, attached images): read them before changing anything; follow their layout and hierarchy, keep the file's own styles, variables and components.
- **Batch** (one note targeting several frames, or several notes on the same thing): do the first, check it, then the rest the same way; one `note_step` per item ("3 of 8").
- **@mentions**: layers, components or variables named by the designer; use them, never look for look-alikes.

## Rules

- The designer's file comes first: reuse its components, variables and text styles; never hard-code a color or a size that has a variable.
- Change only what the note asks. Nothing extra "while you are there".
- Permission prompts, questions and plans show in the panel while a note is in Working (hooks in `bridge/hooks/`); a refusal there is final for that action.
- `note_comments` reads the file's Figma comments when the note refers to them (token set in the panel).
- Panel closed or plugin disconnected → tell the designer once in the terminal, keep waiting.
