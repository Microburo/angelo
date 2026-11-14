// Builds the public npm package `angelo-mcp` into npm/dist: the MCP server and the bridge, each
// bundled with its dependencies into one file (no install step, no install scripts), side by
// side so the MCP finds server.mjs next to itself. Web-to-figma jobs, which run tools/ scripts,
// are not part of it.
//
//   node npm/build.mjs            → npm/dist
//   node npm/build.mjs --pack     → also npm/dist/angelo-mcp-<version>.tgz (npm pack)

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "npm", "dist");
const repo = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const meta = JSON.parse(readFileSync(join(root, "npm", "package.json"), "utf8"));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: { mcp: join(root, "bridge/src/mcp.mjs"), server: join(root, "bridge/src/server.mjs") },
  outdir: out,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  minify: true,
  legalComments: "linked",
  // ws loads these native speed-ups only when installed
  external: ["bufferutil", "utf-8-validate"],
  // CommonJS dependencies (ws) call require() inside an ES module bundle
  banner: { js: '#!/usr/bin/env node\nimport { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  logLevel: "warning",
});

writeFileSync(join(out, "package.json"), JSON.stringify({ ...meta, version: repo.version }, null, 2) + "\n");
for (const f of ["README.md", "LICENSE"]) copyFileSync(join(root, "npm", f), join(out, f));
copyFileSync(join(root, "THIRD_PARTY_LICENSES"), join(out, "THIRD_PARTY_LICENSES"));

// Claude Desktop extension: the same two bundles in a zip with an MCPB manifest, run by the
// Node that Claude Desktop ships (nothing downloaded at install)
const stage = join(root, "npm", ".mcpb");
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "server"), { recursive: true });
for (const f of ["mcp.mjs", "server.mjs"]) copyFileSync(join(out, f), join(stage, "server", f));
writeFileSync(
  join(stage, "manifest.json"),
  JSON.stringify(
    {
      manifest_version: "0.2",
      name: "angelo",
      display_name: "Angelo for Figma",
      version: repo.version,
      description: "Your Figma selection as compact text Claude reads and edits, through the Angelo plugin.",
      author: { name: meta.author },
      license: meta.license,
      keywords: meta.keywords,
      server: {
        type: "node",
        entry_point: "server/mcp.mjs",
        mcp_config: { command: "node", args: ["${__dirname}/server/mcp.mjs"] },
      },
      compatibility: { platforms: ["darwin", "win32"], runtimes: { node: ">=20.0.0" } },
    },
    null,
    2
  ) + "\n"
);
execFileSync("zip", ["-qr", join(out, "angelo.mcpb"), "manifest.json", "server"], { cwd: stage });
rmSync(stage, { recursive: true, force: true });

const kb = (f) => Math.round(statSync(join(out, f)).size / 1024);
console.log(`angelo.mcpb ${kb("angelo.mcpb")} KB`);
console.log(`angelo-mcp ${repo.version}: mcp.mjs ${kb("mcp.mjs")} KB · server.mjs ${kb("server.mjs")} KB`);

if (process.argv.includes("--pack")) {
  const file = execFileSync("npm", ["pack", "--silent"], { cwd: out, encoding: "utf8" }).trim();
  console.log(`packed ${join(out, file)} (${kb(file)} KB)`);
}
