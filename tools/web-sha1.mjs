// SHA-1 of a string's UTF-8 bytes, as hex: the same digest as node:crypto, for the plugin's iframe where
// crypto.subtle is async (and absent on an insecure origin). Names a main's fonts, no security role.
export function sha1(text) {
  const bytes = new TextEncoder().encode(text);
  const blocks = ((bytes.length + 8) >> 6) + 1;
  const words = new Uint32Array(blocks * 16);
  bytes.forEach((b, i) => { words[i >> 2] |= b << (24 - (i % 4) * 8); });
  words[bytes.length >> 2] |= 0x80 << (24 - (bytes.length % 4) * 8);
  words[blocks * 16 - 2] = Math.floor((bytes.length * 8) / 2 ** 32);
  words[blocks * 16 - 1] = (bytes.length * 8) >>> 0;
  const rot = (x, n) => (x << n) | (x >>> (32 - n));
  let [h0, h1, h2, h3, h4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Int32Array(80);
  for (let b = 0; b < blocks; b++) {
    for (let t = 0; t < 80; t++) w[t] = t < 16 ? words[b * 16 + t] : rot(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let [a, c, d, e, f] = [h0, h1, h2, h3, h4];
    for (let t = 0; t < 80; t++) {
      const [mix, k] = t < 20 ? [(c & d) | (~c & e), 0x5a827999] : t < 40 ? [c ^ d ^ e, 0x6ed9eba1] : t < 60 ? [(c & d) | (c & e) | (d & e), 0x8f1bbcdc] : [c ^ d ^ e, 0xca62c1d6];
      const next = (rot(a, 5) + mix + f + k + w[t]) | 0;
      f = e; e = d; d = rot(c, 30); c = a; a = next;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + c) | 0; h2 = (h2 + d) | 0; h3 = (h3 + e) | 0; h4 = (h4 + f) | 0;
  }
  return [h0, h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, "0")).join("");
}
