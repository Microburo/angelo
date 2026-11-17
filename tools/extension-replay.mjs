// The browser extension's requests replayed against a bridge started here, no Chrome, no Figma:
// same Origin, paths and payload keys as extension/background.js, a fake plugin on the socket.
// Guards the extension ↔ bridge contract (origin pin, /stage, /capture, /mobile, /job, job lines).
//
//   node tools/extension-replay.mjs [tests/web/<case>/capture.json]

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { caseName } from "./web-lib.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = process.argv[2] || join(repo, "tests/web/example/capture.json");
// a host of its own: the bridge saves the capture under tests/web/<case>, never over a real case
const URL_SENT = "https://angelo-replay.test/";
const caseDir = join(repo, "tests/web", caseName(new URL(URL_SENT).hostname));
if (existsSync(caseDir)) throw new Error(`${caseDir} exists: remove it first`);

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail !== undefined ? `\n     ${String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 300)}` : ""}`);
};

// the extension's side of the contract, read off its source
const manifest = JSON.parse(readFileSync(join(repo, "extension/manifest.json"), "utf8"));
const worker = readFileSync(join(repo, "extension/background.js"), "utf8");
const hex = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32);
const ORIGIN = "chrome-extension://" + [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
const bridgeUrl = /const BRIDGE = "([^"]+)"/.exec(worker)?.[1];
check("worker targets the bridge's default address", bridgeUrl === "http://127.0.0.1:8787", bridgeUrl);
check("manifest allows that host", manifest.host_permissions.some((p) => p === "<all_urls>" || p.startsWith("http://127.0.0.1")));
for (const path of ["/stage", "/capture", "/mobile", "/job"]) check(`worker calls ${path}`, worker.includes(`call("${path}"`) || worker.includes(`post("${path}"`));
check("capture script copied (node extension/build.mjs)", existsSync(join(repo, "extension/lib/capture.js")) && readFileSync(join(repo, "extension/lib/capture.js"), "utf8") === readFileSync(join(repo, "tools/web-capture-page.js"), "utf8"));
const page = readFileSync(join(repo, "tools/web-capture-page.js"), "utf8");
const used = [...new Set(readFileSync(join(repo, "extension/content.js"), "utf8").match(/__angelo[A-Za-z]+/g))].filter((g) => !["__angeloOverlay", "__angeloVhShot"].includes(g));
const missing = used.filter((g) => !page.includes(`globalThis.${g} =`));
check(`overlay's ${used.length} capture globals all defined by the capture script`, !missing.length, missing);

// a free port: the bridge of a working session (8787) is left alone
const port = await new Promise((r) => { const s = createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const bridge = spawn(process.execPath, ["bridge/src/server.mjs"], { cwd: repo, env: { ...process.env, ANGELO_PORT: String(port) }, stdio: ["ignore", "ignore", "pipe"] });
let log = "";
bridge.stderr.on("data", (d) => (log += d));
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms) => { for (const t = Date.now(); Date.now() - t < ms; await sleep(100)) if (await fn()) return true; return false; };

// as background.js `call`: fetch + json, Origin as Chrome sets it for the extension's worker
const call = async (path, body, origin = ORIGIN) => {
  const res = await fetch(base + path, { ...(body ? { method: "POST", body: JSON.stringify(body) } : {}), headers: { ...(body ? { "content-type": "application/json" } : {}), ...(origin ? { origin } : {}) } });
  return { status: res.status, ...(await res.json()) };
};

let plugin;
try {
  check("bridge up", await until(() => fetch(base + "/health").then((r) => r.ok, () => false), 5000), log);

  const { url: _, ...capture } = JSON.parse(readFileSync(fixture, "utf8"));
  const width = capture.width || 1440;
  // payloads as background.js builds them from the overlay's messages
  const stage = { url: URL_SENT, part: "", width };
  const send = { url: URL_SENT, part: "", capture: { width, prep: {}, ...capture }, shot: undefined, shotError: "replay: no shot", mobile: false };

  let r = await call("/capture", send, null);
  check("POST /capture without Origin refused (403)", r.status === 403, r);
  r = await call("/capture", send, "https://evil.example");
  check("POST /capture from a web Origin refused (403)", r.status === 403, r);
  r = await call("/stage", stage, "chrome-extension://" + "a".repeat(32));
  check("POST /stage from another extension refused (403)", r.status === 403, r);
  r = await call("/job");
  check("GET /job answers { job, last, plugin }", r.status === 200 && "job" in r && "last" in r && r.plugin === false, r);
  r = await call("/job", null, null);
  check("GET /job without Origin accepted (Dia)", r.status === 200, r);

  // plugin closed: every start is refused with a reason the overlay shows as is
  r = await call("/stage", stage);
  check("/stage, plugin closed → 409 plugin disconnected", r.status === 409 && r.error === "plugin disconnected", r);
  r = await call("/mobile", { url: URL_SENT, part: "" });
  check("/mobile, plugin closed → 409 plugin disconnected", r.status === 409 && r.error === "plugin disconnected", r);
  r = await call("/capture", { url: URL_SENT, capture: {} });
  check("/capture without boxes → 409 invalid capture", r.status === 409 && r.error === "invalid capture", r);
  r = await call("/stage", { ...stage, width: undefined });
  check("/stage without width → 409 invalid width", r.status === 409 && r.error === "invalid width", r);

  // a fake plugin on the socket (no Origin, like Figma's sandboxed iframe): same answers as web-to-figma-check
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
  const statuses = [];
  plugin = new WebSocket(`ws://127.0.0.1:${port}/plugin`);
  plugin.on("message", (raw) => {
    const f = JSON.parse(String(raw));
    if (f.type === "status") statuses.push(f.text);
    if (f.type !== "request") return;
    plugin.send(JSON.stringify({ type: "response", id: f.id, ok: true, result: f.method === "ping" ? { file: "fake" } : { value: answer(f.params.code || "") } }));
  });
  await new Promise((ok, no) => { plugin.on("open", ok); plugin.on("error", no); });

  r = await call("/stage", stage);
  check("/stage, plugin open → 200 { ok }", r.status === 200 && r.ok === true, r);
  r = await call("/capture", send);
  check("/capture → 200 { ok, boxes }", r.status === 200 && r.ok === true && r.boxes === capture.boxes.length, r);
  check("capture saved as the case's capture.json", existsSync(join(caseDir, "capture.json")));
  r = await call("/job");
  check("/job shows the running build", typeof r.job === "string" && r.job.startsWith("web-to-figma " + URL_SENT), r);
  r = await call("/capture", send);
  check("second /capture while it runs → 409 busy", r.status === 409 && /^busy: /.test(r.error || ""), r);
  // as the overlay's follow(): polled until no job and a final status
  const ended = await until(async () => { const j = await call("/job"); return !j.job && j.last?.done; }, 180000);
  r = await call("/job");
  check("job ends, /job gives a final status", ended, r);
  check("bridge saw the frame line of web-to-figma", /frame 1:1 in Figma/.test(log), log.split("\n").slice(-8).join(" | "));
  check("bridge logged the job's exit", /web-to-figma .* \(extension\) exit \d+/.test(log), log.split("\n").slice(-8).join(" | "));
  check("plugin got the job's status lines", statuses.length > 2, statuses);
  console.log(`\nlast status: ${r.last?.text}\n${log.split("\n").filter((l) => /exit \d|fail|Error/.test(l)).map((l) => "  " + l.trim()).join("\n")}`);
} finally {
  plugin?.terminate();
  bridge.kill("SIGTERM");
  rmSync(caseDir, { recursive: true, force: true });
}

const bad = results.filter((ok) => !ok).length;
console.log(`\n${results.length - bad}/${results.length}`);
process.exit(bad ? 1 : 0);
