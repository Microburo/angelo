// The in-page capture lives in tools/ (shared with puppeteer): the extension gets a copy,
// Chrome only loads files from its own folder.
import { copyFile, mkdir } from "node:fs/promises";

await mkdir(new URL("./lib/", import.meta.url), { recursive: true });
await copyFile(new URL("../tools/web-capture-page.js", import.meta.url), new URL("./lib/capture.js", import.meta.url));
console.log("extension/lib/capture.js");
