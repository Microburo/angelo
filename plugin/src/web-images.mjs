// The images of a capture for a host with no network and no sips: only what the capture carries as
// data URLs (the extension attaches them). Same contract and limits as fetchImages (tools/web-lib.mjs).
import { MAX_IMG, MAX_SIDE } from "../../tools/web-place.mjs";

const formatOf = (b) => (b[0] === 0x89 && b[1] === 0x50 ? "png" : b[0] === 0xff && b[1] === 0xd8 ? "jpeg" : b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 ? "gif" : null);

// Longest side read from the header, 0 when it can't be read (the picture is then decoded)
function sideOf(b, format) {
  if (format === "png") return Math.max((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]);
  if (format !== "jpeg") return 0;
  for (let i = 2; i + 8 < b.length; i += 2 + ((b[i + 2] << 8) | b[i + 3])) {
    if (b[i] !== 0xff) return 0;
    if (b[i + 1] >= 0xc0 && b[i + 1] <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(b[i + 1])) return Math.max((b[i + 5] << 8) | b[i + 6], (b[i + 7] << 8) | b[i + 8]);
  }
  return 0;
}

const toBase64 = (b) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

// Formats Figma can't read become PNG; a picture too large or too heavy is scaled down, same format
async function reencode(bytes, format) {
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const out = format === "jpeg" ? "image/jpeg" : "image/png";
  let side = Math.min(Math.max(bitmap.width, bitmap.height), MAX_SIDE);
  for (;;) {
    const k = side / Math.max(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * k)), Math.max(1, Math.round(bitmap.height * k)));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: out, quality: 0.9 });
    if (blob.size <= MAX_IMG) {
      bitmap.close();
      return { bytes: new Uint8Array(await blob.arrayBuffer()), format: out.slice(6) };
    }
    side *= 0.8;
    if (side < 64) {
      bitmap.close();
      throw new Error("too heavy");
    }
  }
}

async function one(src) {
  const base64 = /^data:[^;,]+;base64,(.*)$/s.exec(src);
  const text = !base64 && /^data:[^,]*,(.*)$/s.exec(src);
  if (!base64 && !text) return null;
  if (text) {
    const markup = text[1].replace(/(%[0-9a-f]{2})+/gi, (m) => { try { return decodeURIComponent(m); } catch { return m; } });
    return /<svg[\s>]/i.test(markup.slice(0, 400)) ? { svg: markup } : null;
  }
  const raw = atob(base64[1]);
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  if (/<svg[\s>]/i.test(raw.slice(0, 400))) return { svg: new TextDecoder().decode(bytes) };
  const format = formatOf(bytes);
  const keep = format && bytes.length <= MAX_IMG && (format === "gif" || (sideOf(bytes, format) || Infinity) <= MAX_SIDE);
  if (keep) return { url: `data:image/${format};base64,${base64[1]}` };
  const made = await reencode(bytes, format);
  return { url: `data:image/${made.format};base64,${toBase64(made.bytes)}` };
}

// One at a time: the decoding runs on the iframe's thread, which also shows the progress
export function dataImages(srcs) {
  const done = new Map();
  const work = new Map();
  let tail = Promise.resolve();
  for (const it of srcs) {
    tail = tail.then(async () => {
      let item = null;
      try {
        const got = await one(it.src);
        // the lot budgets count what the exec carries
        if (got) item = { id: it.id, ...got, ...(got.url ? { size: got.url.length } : {}) };
      } catch {}
      done.set(it.id, item);
      return item;
    });
    work.set(it.id, tail);
  }
  return {
    ready: (id) => done.has(id),
    value: (id) => done.get(id) || null,
    get: (id) => work.get(id) || Promise.resolve(null),
    cleanup: async () => {},
  };
}
