// FNV-1a, 32 bits, base36.
//
// Short enough to keep one per node in a session, wide enough to notice a real
// edit. It answers one question — "has this node moved since the read?" — and
// is never a security boundary.

export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
