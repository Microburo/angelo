// Code version of a running Angelo process: a hash of the entry file and of every file it
// imports by a relative path (bridge/src, plus what it pulls from tools/). Taken once at
// start and again from disk later, the two differ as soon as the source changed under a
// process still running the old code.

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']+)["']/g;

/** Absolute paths of `entry` and of its relative imports, transitively, sorted. */
export function importGraph(entry) {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      return; // a missing import fails at load, not here
    }
    seen.add(file);
    if (!/\.(mjs|js)$/.test(file)) return;
    for (const m of source.matchAll(IMPORT)) walk(resolve(dirname(file), m[1]));
  };
  walk(resolve(entry));
  return [...seen].sort();
}

/** 12 hex digits over the content of `files` (a missing file counts as empty). */
export function hashFiles(files) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file + "\0");
    try {
      hash.update(readFileSync(file));
    } catch {}
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

/** Cheap change probe: sizes and mtimes, no read. */
export function statSignature(files) {
  return files
    .map((file) => {
      try {
        const s = statSync(file);
        return `${s.size}:${s.mtimeMs}`;
      } catch {
        return "-";
      }
    })
    .join("|");
}

export const codeVersion = (entry, extra = []) => hashFiles([...importGraph(entry), ...extra]);
