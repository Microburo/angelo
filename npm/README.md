# angelo-mcp

MCP server for the Angelo Figma plugin: your Figma selection becomes compact text your AI reads and edits, with no copy and paste. Everything runs on your computer.

## Install

Claude Code:

    claude mcp add angelo -s user -- npx -y angelo-mcp

Claude Desktop: download [angelo.mcpb](https://unpkg.com/angelo-mcp/angelo.mcpb) and double-click it.

Cursor and other MCP clients (`~/.cursor/mcp.json` or the client's own file):

    { "mcpServers": { "angelo": { "command": "npx", "args": ["-y", "angelo-mcp"] } } }

Then open the Angelo plugin in Figma, select a frame and ask your AI: "Use Angelo to read my Figma selection".

## How it works

The MCP server starts a local bridge on `127.0.0.1:8787` with its first call. The plugin connects to it from Figma; only one plugin at a time, and only from Figma. Nothing leaves your computer.

Requires Node.js 20 or later.

## License

MIT. The Notes feature ports Retoucher (MIT), see THIRD_PARTY_LICENSES.
