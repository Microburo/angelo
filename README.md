# Angelo

**Your Figma selection as compact text an AI agent can read and edit.**

Angelo is a Figma plugin, a local bridge and an MCP server. Select a frame in Figma, then ask your agent (Claude Code, Claude Desktop, Cursor or any MCP client) about it: the agent reads the design as a dense, line-based text format, changes it with typed operations or with the Figma Plugin API, and sees the result right away. You never copy, paste or export anything, and nothing leaves your computer.

On top of that channel, Angelo adds:

- **Notes**: a panel inside Figma where the designer leaves a note on a layer and the agent picks it up, does the work and replies in the panel, with a snapshot before and after and a one-click undo.
- **Web to Figma**: rebuilds a live web page as a structured Figma frame, with auto layout, components, real images and a check of the result against the page.

> Status: early, used daily in a design studio, APIs may still change. Feedback and issues are welcome.

## Contents

- [How it works](#how-it-works)
- [Install](#install)
- [The Angelo format](#the-angelo-format)
- [MCP tools](#mcp-tools)
- [Notes](#notes)
- [Web to Figma](#web-to-figma)
- [Agent skills](#agent-skills)
- [Security model](#security-model)
- [Development](#development)
- [Repository layout](#repository-layout)
- [Credits](#credits)
- [License](#license)

## How it works

```
┌──────────────────────────── Figma desktop ─────────────────────────────┐
│  Plugin main thread     serializes the selection, runs write ops       │
│        │ postMessage                                                   │
│  Plugin UI (iframe)     panel: connection, notes; holds the WebSocket  │
└────────┼───────────────────────────────────────────────────────────────┘
         │ ws://localhost:8787/plugin   (one client, Origin checked)
┌────────┴───────────────────────────────────────────────────────────────┐
│  Bridge (Node, 127.0.0.1:8787)   HTTP /rpc, /health, notes routes      │
└────────┬───────────────────────────────────────────────────────────────┘
         │ HTTP /rpc
┌────────┴───────────────────────────────────────────────────────────────┐
│  MCP server (stdio)       angelo_read · angelo_expand · angelo_apply   │
│                           local_figma_use · note_* tools               │
└────────┬───────────────────────────────────────────────────────────────┘
         │ stdio
     AI client (Claude Code, Claude Desktop, Cursor…)
```

1. The plugin walks the selection in Figma and serializes it into the Angelo format. The walk yields to Figma regularly, so a selection of thousands of nodes does not freeze the editor.
2. The plugin UI forwards it over a WebSocket to the bridge, a small Node server bound to `127.0.0.1`. The WebSocket lives in the iframe because Figma gives plugin iframes a `null` origin, which plain `fetch` calls cannot get past CORS with.
3. The MCP server talks to the bridge over HTTP and exposes the tools to the agent. It starts the bridge on its first call if none is running.
4. Writes travel the same way back: the agent sends typed operations (`angelo_apply`) or Plugin API JavaScript (`local_figma_use`), the plugin runs them and returns what changed.

The plugin has to stay open in Figma. When it is closed, the bridge answers "plugin disconnected" at once instead of hanging.

## Install

Requirements: Figma desktop, Node.js 20 or later.

### 1. The MCP server

Claude Code:

```bash
claude mcp add angelo -s user -- npx -y angelo-mcp
```

Claude Desktop: download [`angelo.mcpb`](https://unpkg.com/angelo-mcp/angelo.mcpb) and double-click it.

Cursor and other MCP clients (`~/.cursor/mcp.json` or the client's own file):

```json
{ "mcpServers": { "angelo": { "command": "npx", "args": ["-y", "angelo-mcp"] } } }
```

### 2. The Figma plugin

Until the plugin is published on the Figma Community, load it as a development plugin:

```bash
git clone https://github.com/Microburo/angelo.git
cd angelo
npm install
npm run build        # plugin/dist/code.js and plugin/dist/ui.html
```

In Figma desktop: **Plugins → Development → Import plugin from manifest…**, pick `plugin/manifest.json`, then run **Angelo**. The panel shows the connection state once the MCP server has started the bridge.

### 3. First read

Select a frame and ask your agent:

> Use Angelo to read my Figma selection.

### Without an MCP client

The same channel works from a terminal:

```bash
npm run bridge                     # start the bridge by hand
node tools/read.mjs                # current selection
node tools/read.mjs page           # whole page
node tools/read.mjs 1:234          # one node
node tools/read.mjs --expand 3     # chunk 3 of the last read
node tools/read.mjs --status
```

## The Angelo format

A read is plain text: a versioned header, a manifest of what the scope uses, then the layer tree, one node per line.

```
angelo/1 units:px file:"Shop" page:"Home" scope:selection(1) nodes:412 chunks:7

# vars
@ primitives modes[light|dark]
c.surface.default = #FFF | dark:#101010
n.space.md = 16

# styles
t.body = Inter Regular 14/20 ls:-0.01

# cmp
cmp.button = "Button" variants[variant: primary|secondary] props[label:TEXT="Send"]

# tree
FRAME#1:2 "Home" 1440x900 col gap:24 pad:48
  FRAME#1:5 "Header" 1440x80 row gap:16 pad:0,48 align:between,center
    <chunk 1 · 37 nodes · "Logo", "Nav", "Actions">
  FRAME#1:40 "Hero" 1440x620 col gap:32
    <chunk 2 · 64 nodes · "Copy", "Visual">
```

Design choices:

- **Real node ids** (`1:234`), so every line can be targeted by a write.
- **Variables by name** (`c.surface.default`), never opaque ids; a raw color equal to a local variable is flagged with the fix to apply.
- **Instances stay closed**: `ref(cmp.button){variant:primary} ov{label:"Send"}`, never walked into.
- **Chunks on demand**: a large scope comes back as its surface plus numbered holes of about 4,000 tokens each; the agent expands only what it needs.
- **Implied values left out**: positions under auto layout, default text properties, and a shared `*` line for what all children have in common. On a full site page this saves 13 % over the plain listing.
- **A `# warn` section** lists gaps between what is declared and what renders (invisible nodes, clipped children, missing fonts, unbound colors), each with an operation that fixes it.

Writes are typed operations on what was read (`set`, `insert`, `clone`, `reorder`, `each`), refused on any node that was not read or that changed since. Anything the operations cannot express goes through `local_figma_use`, the Plugin API with an `H` helper library in scope.

Full grammar and examples: [docs/format.md](docs/format.md).

## MCP tools

| Tool | What it does |
| --- | --- |
| `angelo_status` | Bridge and plugin state, open file, current selection |
| `angelo_read` | Reads the selection, the page or given node ids |
| `angelo_expand` | Returns one chunk of the last read |
| `angelo_apply` | Typed write operations on the last read |
| `local_figma_use` | Runs Plugin API JavaScript in the open file (`figma` and `H` in scope) |
| `note_*` | Notes workflow: list, claim, show, step, ask, plan, snapshot, finish, undo… |

Several agents can share one bridge: each tool takes an `agent` parameter, and each agent keeps its own read session.

## Notes

The plugin panel doubles as a note board. The designer selects layers, writes a note, can attach files, mention layers or components, and pick a skill or a model for it. The agent:

1. watches for notes (`node bridge/src/watch.mjs` emits one JSON line per event), claims one, and the panel shows it as Working;
2. reads only the targeted layers, makes the change, and records a reverse patch for every write;
3. replies in the panel with a short summary and an after picture.

The designer can undo a note in one click, answer questions the agent asks, and approve or reject a plan before larger changes. Permission prompts and questions from Claude Code show in the panel through hooks (`bridge/hooks/`). Up to five agents can work on notes at once.

The Notes workflow and panel UX are ported from [Retoucher](https://github.com/alicorak/retoucher) by Ali Çorak (MIT).

## Web to Figma

```bash
node tools/web-to-figma.mjs https://example.com             # desktop, into the open file
node tools/web-to-figma.mjs https://example.com --width 430 # the page as served to a phone
```

The page is captured headlessly as measured boxes (geometry, computed styles, texts, inline SVGs, images), rebuilt in Figma as a structured frame (auto layout, components for repeated blocks, Lucide icons, bound color variables, real images), then compared against the capture: every text, image and icon of the page must be present at its place. Missing or misplaced elements are fixed in place and checked again.

A Chrome extension (`extension/`, Manifest V3) sends the blocks of the current tab to Figma through the bridge, and pasting a URL in the plugin panel runs the same pipeline.

Commands and pipeline: [docs/web.md](docs/web.md) · known pitfalls: [docs/web-gotchas.md](docs/web-gotchas.md) · front-end techniques catalogue: [skill/web-to-figma/techniques.md](skill/web-to-figma/techniques.md).

## Agent skills

`skill/` holds [Agent Skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills) that teach the agent how to use Angelo well. Link the ones you want into `~/.claude/skills/`.

| Skill | Use |
| --- | --- |
| `angelo` (`skill/SKILL.md`) | Read and patch a selection: routing between typed operations and the Plugin API, the read → apply loop |
| `angelo-notes` | Handle notes from the panel |
| `figma-structured-build` | Build any design as a structured file: auto layout, few components, bound variables |
| `figma-local-images` | Put downloaded images into Figma nodes |
| `mobile-from-desktop` | Derive the mobile version of a desktop frame |
| `web-capture` | Capture a rendered page as measured boxes |
| `web-to-figma` | Rebuild a live page in Figma, end to end |

`tools/mini-ds/` rebuilds a small reference design system from scripted steps and compares the result with a stored fingerprint, a reproducible test of the write path ([tools/mini-ds/README.md](tools/mini-ds/README.md)).

## Security model

Angelo gives an AI agent write access to your open Figma file, so the local surface is kept narrow:

- **Localhost only.** The bridge binds `127.0.0.1`, never `0.0.0.0`. The plugin manifest allows no network domain except the local bridge (`devAllowedDomains`).
- **One plugin client.** The plugin WebSocket accepts a single connection, and only from a plugin iframe (`null` origin): a web page always sends its own origin and is refused.
- **No browser access to the write path.** `/rpc` and the notes routes refuse any request that carries an `Origin` header, so a web page you visit cannot post code to the bridge. The browser extension routes (`/stage`, `/capture`, `/job`) accept only the extension's pinned origin.
- **Code execution is the point.** `local_figma_use` runs the JavaScript the agent sends inside the plugin sandbox (`new Function`), with the same powers as any Figma plugin on the open file. Grant the MCP server to agents you trust, and review what they run if you need to.
- **Private plugin API.** The development manifest sets `enablePrivatePluginApi` so the plugin can read `figma.fileKey` (used to link notes to the file). Without it, the panel asks for the file link once.
- **Images.** `GET /img` serves only `img-*` files from `web-build-img/` folders inside the repository, to the plugin.
- **Extension permissions.** The Chrome extension asks for `debugger` (full-page screenshot through the DevTools protocol) and `<all_urls>` (to capture the tab you choose). It is optional and only needed for Web to Figma from the browser.
- **Headless self-correction.** `tools/autofix.mjs` starts Claude Code with `--permission-mode bypassPermissions` to fix a web build without prompts. It is only run on request, on the frame it is given.

Report a vulnerability through a private GitHub security advisory on this repository rather than a public issue.

## Development

```bash
npm install
npm run build            # plugin and extension (esbuild)
npm run watch            # plugin, rebuild on change
npx tsc --noEmit         # typecheck
```

Checks, none of which needs Figma:

| Command | Covers |
| --- | --- |
| `npm run verify` | Bridge, MCP and write path against a fake plugin (128 checks) |
| `npm run roundtrip` | Serialize → parse → serialize is stable on `tests/fixtures/` |
| `npm run web-check` | Web-to-Figma item selection and layout on the synthetic corpus in `tests/web/` |
| `npm run web-to-figma-check` | Failure paths of the web-to-figma orchestrator |
| `node npm/build.mjs --pack` | Builds the `angelo-mcp` npm package and `angelo.mcpb`; `node npm/smoke.mjs` runs it as a user would |

Some web tools are written in Python (image comparison, font handling): `pip install -r requirements.txt`.

The same checks run in CI on every push and pull request.

## Repository layout

```
plugin/      Figma plugin: serializer, parser, write ops, notes panel (TypeScript)
bridge/      Local bridge, MCP server, notes store, Claude Code hooks (Node)
extension/   Chrome extension for Web to Figma (optional)
tools/       Web to Figma pipeline, read CLI, checks, mini design system
skill/       Agent skills
grammar/     Component grammars used to recognize page blocks as components
docs/        Format reference, file map, web-to-figma docs
npm/         Packaging of the angelo-mcp npm package and Claude Desktop extension
tests/       Format fixtures and the synthetic web corpus
```

A map of every file, with the gotchas of plugin execution: [docs/files.md](docs/files.md).

## Credits

Angelo builds on the work of others:

- **[Retoucher](https://github.com/alicorak/retoucher)** by Ali Çorak (MIT): the Notes feature ports its features, workflow and panel UX.
- **[CUI](https://github.com/yappologistic/CUI)** by the CUI authors (MIT): Angelo's interface and component library take their visual design from CUI, with our own adjustments, rebuilt on Angelo's tokens.
- **[shadcn/ui kit for Figma, Community Edition](https://shadcn-ui-kit.pages.dev)** by Obra Studio BV (CC BY 4.0): reference for component structure only, extracted into `grammar/shadcn/`; no styles taken.
- **[shadcn/ui](https://ui.shadcn.com)** by shadcn (MIT): component descriptions.
- **[Lucide](https://lucide.dev)** (ISC, with icons derived from Feather, MIT): plugin and design system icons.

Full notices: [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES).

## License

[MIT](LICENSE) © 2026 Microburo
