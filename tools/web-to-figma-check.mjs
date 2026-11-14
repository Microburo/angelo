// web-to-figma end to end against a fake plugin, no Figma: what happens to the frame and the run when a step fails.
// Frame left alone at stage time, optional step failing, plugin lost during the adaptation, capture failing.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, statSync, chmodSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { caseName } from "./web-lib.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const sent = [];
let pollFails = 0;
const answer = (code) => {
  if (code.includes("c.hold();")) return "1:1";
  if (code.includes("globalThis.__webFonts = f; return")) return [];
  if (code.includes("const out = { sigs: {}")) return { sigs: {}, fams: {}, cf: null };
  const st = /^const ST = (.*);$/m.exec(code);
  if (st) return { ST: { ...JSON.parse(st[1]), root: "1:1", cf: "CF" }, nodes: 1, errors: [], nerr: 0 };
  if (code.includes("let checked = 0;")) return { checked: 0, fixed: 0, left: [], nleft: 0 };
  if (code.includes("let removed = 0, kept = 0;")) return { removed: 0, kept: 0, ms: 0 };
  if (code.includes("return figma.root.getPluginData")) return JSON.stringify({ skipped: true });
  return [];
};
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const { method, params } = JSON.parse(body || "{}");
    res.setHeader("content-type", "application/json");
    if (method === "ping") return res.end(JSON.stringify({ result: { file: "fake" } }));
    sent.push(params.code);
    if (params.code.includes("return figma.root.getPluginData") && pollFails-- > 0) return res.end(JSON.stringify({ error: "plugin disconnected" }));
    res.end(JSON.stringify({ result: { value: answer(params.code) } }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const run = (argv, env = {}) =>
  new Promise((resolve) => {
    const c = spawn(process.execPath, ["tools/web-to-figma.mjs", ...argv], { cwd: repo, env: { ...process.env, ANGELO_PORT: String(port), ...env } });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.on("close", (code) => resolve({ code, out }));
  });

const results = [];
const check = (name, ok, r) => {
  results.push(ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${name}`);
  if (!ok && r) console.log(`     exit ${r.code} : ${r.out.trim().split("\n").slice(-3).join(" | ").slice(0, 300)}`);
};

const dir = mkdtempSync(join(tmpdir(), "angelo-check-"));
try {
  const names = ["docs.stripe.com", "docs.figma.com", "www.linear.app", "localhost"].map(caseName).join(" ");
  check("case folders: subdomains apart, plain hosts unchanged", names === "docs-stripe docs-figma linear localhost");

  // the smallest capture of the corpus
  const web = join(repo, "tests/web");
  const small = readdirSync(web)
    .map((d) => join(web, d, "capture.json"))
    .filter((f) => statSync(f, { throwIfNoEntry: false })?.isFile())
    .sort((a, b) => statSync(a).size - statSync(b).size)[0];
  const cap = join(dir, "capture.json");
  copyFileSync(small, cap);
  const given = ["https://example.test/", "--capture", cap];

  let r = await run(given);
  check("clean run exits 0", r.code === 0 && !/failed steps/.test(r.out), r);
  const stage = sent.find((c) => c.includes("c.hold();"));
  check("stage does not empty an existing frame", stage && !stage.includes("k.remove()"));
  check("stage does not resize an existing frame", stage && !stage.includes("prev.resize"));

  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "python3"), "#!/bin/sh\nexit 3\n");
  chmodSync(join(bin, "python3"), 0o755);
  sent.length = 0;
  r = await run(given, { PATH: `${bin}:${process.env.PATH}` });
  check("failing audit: exit 1, listed", r.code === 1 && /failed steps: capture audit/.test(r.out), r);
  check("failing audit: adaptation still ran", sent.some((c) => c.includes("return figma.root.getPluginData")));

  pollFails = 2;
  r = await run(given);
  check("2 polls lost: still exit 0", r.code === 0, r);

  pollFails = 99;
  r = await run(given);
  pollFails = 0;
  check("plugin lost: adaptation listed", r.code === 1 && /failed steps: file adaptation/.test(r.out), r);

  sent.length = 0;
  r = await run(["http://127.0.0.1:9/", "--out", join(dir, "dead")]);
  check("capture failed: non zero, no build", r.code !== 0 && !sent.some((c) => /^const ST = /m.test(c)), r);
  check("capture failed: cursor released", sent.some((c) => c.includes("H.release()")));
} finally {
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
const ok = results.filter(Boolean).length;
console.log(`${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
