// Saves the image fills used by the mini DS (Avatar photo) into tools/mini-ds/assets/ so a rebuild
// elsewhere reuses the same bytes. Usage: node tools/mini-ds/export-assets.mjs
import { writeFile, mkdir } from "node:fs/promises";
import { makeRpc, pluginFile } from "../web-lib.mjs";

const rpc = makeRpc(await pluginFile());
const res = await rpc(`
const set = figma.currentPage.findOne((n) => n.type === "COMPONENT_SET" && n.name === "Avatar");
const img = set.findOne((n) => n.name === "img");
const p = img.fills.find((f) => f.type === "IMAGE");
const bytes = await figma.getImageByHash(p.imageHash).getBytesAsync();
return { b64: figma.base64Encode(bytes), paint: { scaleMode: p.scaleMode, rotation: p.rotation, filters: p.filters, imageTransform: p.imageTransform, scalingFactor: p.scalingFactor } };
`);
const dir = new URL("assets/", import.meta.url);
await mkdir(dir, { recursive: true });
await writeFile(new URL("avatar.jpg", dir), Buffer.from(res.b64, "base64"));
await writeFile(new URL("avatar.paint.json", dir), JSON.stringify(res.paint, null, 1));
console.log("avatar.jpg", Buffer.from(res.b64, "base64").length, "bytes", JSON.stringify(res.paint));
