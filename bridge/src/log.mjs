// Bridge log: stderr when someone holds it, and always a file, so a bridge spawned detached
// (stdio ignored) still leaves a trace of a failed job. Capped: past MAX the file becomes
// <file>.1 (the previous .1 is dropped), so the two together never exceed 2 x MAX.

import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MAX = 2_000_000;
const CHECK_EVERY = 200; // lines between two size checks

export const logPath = () => process.env.ANGELO_LOG || join(homedir(), ".angelo", "bridge.log");

export function makeLog({ file = logPath(), tag = "angelo", silent = false } = {}) {
  let lines = 0;
  let broken = false;
  const rotate = () => {
    try {
      if (statSync(file).size > MAX) renameSync(file, file + ".1");
    } catch {}
  };
  if (!silent) {
    try {
      mkdirSync(dirname(file), { recursive: true });
    } catch {}
    rotate();
  }
  // a closed stderr (the parent that piped it is gone) must not take the process down
  process.stderr.on("error", () => {});
  return (...parts) => {
    const text = parts.join(" ");
    try {
      process.stderr.write(`[${tag}] ${text}\n`);
    } catch {}
    if (silent || broken) return;
    try {
      appendFileSync(file, `${new Date().toISOString()} ${process.pid} ${text}\n`);
      if (++lines % CHECK_EVERY === 0) rotate();
    } catch {
      broken = true; // unwritable log: stderr only, never an exception in the caller
    }
  };
}
