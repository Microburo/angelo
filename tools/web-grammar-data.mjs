// The kit's components as data. Node reads them from disk; the plugin's build swaps this module for the same
// data embedded in the bundle (plugin/build.mjs), so web-grammar.mjs and everything above it stay free of Node.
import { readFileSync } from "node:fs";

// WEB_GRAMMAR=angelo reads the Angelo library (grammar/angelo, compiled from the V1 Figma components); the default is
// still the previous kit until the pilot is measured.
const dir = process.env.WEB_GRAMMAR === "angelo" ? "angelo" : "shadcn";
export default JSON.parse(readFileSync(new URL(`../grammar/${dir}/grammar.json`, import.meta.url), "utf8")).components;
