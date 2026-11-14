import * as esbuild from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

await mkdir(join(root, "dist"), { recursive: true });

// Every Lucide drawing as one JSON string, svg wrapper dropped: all the icons share it.
const lucide = {
  name: "lucide",
  setup(build) {
    build.onResolve({ filter: /^virtual:lucide$/ }, (a) => ({ path: a.path, namespace: "lucide" }));
    build.onLoad({ filter: /.*/, namespace: "lucide" }, async () => {
      const dir = join(root, "../node_modules/lucide-static/icons");
      const table = {};
      for (const f of (await readdir(dir)).filter((n) => n.endsWith(".svg")).sort()) {
        const svg = await readFile(join(dir, f), "utf8");
        table[f.slice(0, -4)] = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/>\s+</g, "><").trim();
      }
      return { contents: `export default ${JSON.stringify(JSON.stringify(table))};`, loader: "js" };
    });
  },
};

// The kit's components, structure only: no anatomy, no description.
const kit = {
  name: "kit",
  setup(build) {
    build.onResolve({ filter: /^virtual:kit$/ }, (a) => ({ path: a.path, namespace: "kit" }));
    build.onLoad({ filter: /.*/, namespace: "kit" }, async () => {
      const { components } = JSON.parse(await readFile(join(root, "../grammar/shadcn/grammar.json"), "utf8"));
      const { kitSlots } = await import("../tools/web-grammar.mjs");
      const table = components.map((c) => ({
        name: c.name,
        level: c.level,
        heights: c.heights,
        axes: Object.fromEntries(Object.entries(c.axes || {}).map(([k, v]) => [k, v.options])),
        props: Object.fromEntries(Object.entries(c.props || {}).map(([k, v]) => [k, v.type])),
        slots: kitSlots(c.anatomy),
      }));
      return { contents: `export default ${JSON.stringify(JSON.stringify(table))};`, loader: "js" };
    });
  },
};

const options = {
  entryPoints: [join(root, "src/code.ts")],
  outfile: join(root, "dist/code.js"),
  bundle: true,
  format: "iife",
  target: "es2017",
  logLevel: "info",
  plugins: [lucide, kit],
  banner: { js: "// Lucide icons (lucide-static), ISC License, https://lucide.dev/license" },
};

// The grammar again, as an ES module node can import: the roundtrip test and
// verify read the same source as the plugin, never a copy of it.
const grammar = {
  entryPoints: [join(root, "src/angelo/index.ts")],
  outfile: join(root, "dist/angelo.mjs"),
  bundle: true,
  format: "esm",
  target: "node18",
  logLevel: "info",
};

// The kit's data embedded in place of the module that reads it from disk.
const grammarData = {
  name: "grammar-data",
  setup(build) {
    build.onResolve({ filter: /web-grammar-data\.mjs$/ }, (a) => ({ path: a.path, namespace: "grammar-data" }));
    build.onLoad({ filter: /.*/, namespace: "grammar-data" }, async () => {
      const { components } = JSON.parse(await readFile(join(root, "../grammar/shadcn/grammar.json"), "utf8"));
      return { contents: `export default ${JSON.stringify(components)};`, loader: "js" };
    });
  },
};

// Capture → tree of components, for the UI iframe. platform "browser": a Node import fails the build.
const webCore = {
  entryPoints: [join(root, "src/web-core.mjs")],
  outfile: join(root, "dist/web-core.js"),
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "WebCore",
  platform: "browser",
  target: "es2021",
  logLevel: "info",
  define: { "process.env.ANGELO_GUARD": "undefined" },
  plugins: [grammarData],
};

// The iframe only gets ui.html: the engine goes inside it, escaped so its text can't close the script.
async function copyUi() {
  const core = await readFile(join(root, "dist/web-core.js"), "utf8").catch(() => "");
  const html = await readFile(join(root, "src/ui.html"), "utf8");
  const inline = core.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
  // Build stamp: in the page (sent to the bridge in the plugin's hello) and beside it, so the
  // bridge can tell a plugin still running the previous build.
  const code = await readFile(join(root, "dist/code.js"), "utf8").catch(() => "");
  const stamp = createHash("sha256").update(html).update(core).update(code).digest("hex").slice(0, 12);
  await writeFile(join(root, "dist/ui.html"), html.replace("/* web-core */", () => inline).replace("/* angelo-build */", stamp));
  await writeFile(join(root, "dist/build.txt"), stamp);
}
const copyUiOnEnd = {
  name: "copy-ui",
  setup(build) {
    build.onEnd(copyUi);
  },
};

if (watch) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [lucide, kit, copyUiOnEnd],
  });
  const grammarCtx = await esbuild.context(grammar);
  const coreCtx = await esbuild.context({ ...webCore, plugins: [grammarData, copyUiOnEnd] });
  await ctx.watch();
  await grammarCtx.watch();
  await coreCtx.watch();
  const { watch } = await import("node:fs");
  watch(join(root, "src/ui.html"), () => {
    copyUi().then(() => console.log("ui.html copied"));
  });
  console.log("watching plugin sources…");
} else {
  await esbuild.build(options);
  await esbuild.build(grammar);
  await esbuild.build(webCore);
  await copyUi();
}
