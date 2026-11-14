// Notes: a designer leaves a note on layers or the page in the plugin panel, Claude picks it up,
// works on it with the Angelo tools and answers in the note. Ported from Retoucher
// (MIT, Copyright (c) 2026 Ali Çorak — see THIRD_PARTY_LICENSES) onto the Angelo bridge:
//   - the panel talks over the plugin WebSocket (frames below), never over HTTP
//   - local tools (MCP, hooks) use HTTP routes that refuse any Origin, like /rpc
//   - waiting (new notes, answers) is a long poll held by the bridge, not a polling loop
//
// Panel → bridge frames: notes-get, note-create, note-reply, note-delete, note-undo,
//   note-img, perm-answer, note-config, notes-comments
// Bridge → panel frames: notes (whole state, debounced), note-created, note-img,
//   notes-comments, note-error
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const STATUSES = ["pending", "working", "question", "done"];
// "main" is the main session; the four helpers take the notes it hands out (5 at once at most)
export const AGENTS = ["main", "Berta", "Maximus", "Nora", "Rosa"];
const LISTENING_MS = 12000;
const PERM_TTL = 15 * 60 * 1000;
const DECISIONS = { permission: ["once", "always", "deny"], question: ["answer", "skip"], plan: ["approve", "revise"] };
const PATCH_KEYS = ["set", "remove", "move", "swap", "bind", "variables", "text"];
const MODEL_ID = /^[A-Za-z0-9._:-]{1,60}$/;
const IMG_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const MAX_BODY = 120 * 1024 * 1024;

const now = () => new Date().toISOString();
const str = (v, n = 120) => String(v ?? "").replace(/[\u0000-\u001f]/g, "").slice(0, n);
const emptyPatch = () => Object.fromEntries(PATCH_KEYS.map((k) => [k, []]));

const cleanQuestions = (qs) =>
  (Array.isArray(qs) ? qs : [])
    .slice(0, 4)
    .map((q) => ({
      question: String(q?.question ?? "").slice(0, 500),
      header: String(q?.header ?? "").slice(0, 40),
      multiSelect: !!q?.multiSelect,
      options: (Array.isArray(q?.options) ? q.options : [])
        .slice(0, 6)
        .map((o) => ({ label: String(o?.label ?? "").slice(0, 120), description: String(o?.description ?? "").slice(0, 400) })),
    }))
    .filter((q) => q.question);

export function createNotes({ send, call, panelOpen, log = () => {} }) {
  const DATA = process.env.ANGELO_DATA ? process.env.ANGELO_DATA : join(homedir(), ".angelo", "notes");
  const IMAGES = join(DATA, "images");
  const DB = join(DATA, "notes.json");
  const CONFIG = join(DATA, "config.json");
  mkdirSync(IMAGES, { recursive: true });

  let db = { seq: 0, items: [], skills: [], models: [] };
  try {
    db = { ...db, ...JSON.parse(readFileSync(DB, "utf8")) };
  } catch {}

  const save = () => {
    const tmp = DB + ".tmp";
    writeFileSync(tmp, JSON.stringify(db, null, 2));
    renameSync(tmp, DB);
  };
  const find = (id) => db.items.find((i) => i.id === String(id));

  const config = () => {
    try {
      return JSON.parse(readFileSync(CONFIG, "utf8"));
    } catch {
      return {};
    }
  };
  const figmaToken = () => process.env.FIGMA_TOKEN || config().figmaToken || null;

  // ---------- presence: Claude is "listening" while a wait is held or it beat recently ----------
  let beatAt = 0;
  let waiting = 0;
  const listening = () => waiting > 0 || Date.now() - beatAt < LISTENING_MS;
  let lastListening = false;
  setInterval(() => {
    if (listening() !== lastListening) changed();
  }, 2000).unref();

  // ---------- permissions, questions, plans: memory only ----------
  const perms = new Map();
  let permSeq = 0;
  const publicPerm = (p) => ({
    id: p.id, kind: p.kind, status: p.status, decision: p.decision, answers: p.answers, feedback: p.feedback,
    title: p.title, sub: p.sub, detail: p.detail, rule: p.rule, questions: p.questions, plan: p.plan,
    noteId: p.noteId, createdAt: p.createdAt,
  });
  const prunePerms = () => {
    for (const [k, p] of perms) if (Date.now() - p.at > PERM_TTL) perms.delete(k);
  };

  // ---------- waiters (long polls) ----------
  const waiters = new Set();
  const wake = () => {
    for (const w of [...waiters]) w.check();
  };
  let pushTimer = null;
  function changed() {
    lastListening = listening();
    wake();
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      push();
    }, 50);
  }

  const imagePath = (file) => join(IMAGES, file);
  function publicItem(it) {
    const { imageFile, attachments = [], ...rest } = it;
    return {
      ...rest,
      attachments: attachments.map((a) => ({ n: a.n, name: a.name, mime: a.mime, size: a.size || null, path: imagePath(a.file) })),
      nodes: (it.nodes || []).map((n, i) => ({ ...n, imagePath: n.hasImage ? imagePath(`${it.id}-t${i + 1}.png`) : null })),
      imagePath: imageFile ? imagePath(imageFile) : null,
      hasBefore: existsSync(imagePath(`${it.id}-before.png`)),
      hasAfter: existsSync(imagePath(`${it.id}-after.png`)),
    };
  }
  // the panel needs no local paths and no raw patch, only whether Undo is possible
  function panelItem(it) {
    const { imageFile, attachments = [], patch, ...rest } = it;
    return {
      ...rest,
      hasImage: !!imageFile,
      attachments: attachments.map((a) => ({ n: a.n, name: a.name, mime: a.mime, size: a.size || null })),
      hasPatch: !!patch && PATCH_KEYS.some((k) => patch[k]?.length),
      hasBefore: existsSync(imagePath(`${it.id}-before.png`)),
      hasAfter: existsSync(imagePath(`${it.id}-after.png`)),
    };
  }
  function figmaUrl(it) {
    if (!it.fileKey || !it.nodes?.length) return null;
    const realId = it.nodes[0].id;
    return `https://www.figma.com/design/${it.fileKey}/${encodeURIComponent(it.fileName || "file")}?node-id=${realId.replace(":", "-")}`;
  }

  const meta = () => ({
    claude: listening(),
    comments: !!figmaToken(),
    skills: db.skills || [],
    models: db.models || [],
    count: db.items.length,
  });
  function push() {
    prunePerms();
    send({
      type: "notes",
      items: db.items.map(panelItem),
      perms: [...perms.values()].filter((p) => p.status === "pending").map(publicPerm),
      meta: meta(),
    });
  }

  // ---------- operations shared by HTTP and frames ----------
  function create(b) {
    if (!b.note || !String(b.note).trim()) throw Object.assign(new Error("note required"), { code: 400 });
    const id = String(++db.seq);
    let imageFile = null;
    if (b.image) {
      imageFile = `${id}.png`;
      writeFileSync(imagePath(imageFile), Buffer.from(b.image, "base64"));
    }
    const attachments = [];
    for (const a of (Array.isArray(b.attachments) ? b.attachments : []).slice(0, 8)) {
      if (!a || !a.data) continue;
      const buf = Buffer.from(a.data, "base64");
      const mime = String(a.mime || "application/octet-stream").slice(0, 80);
      const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(a.name || ""));
      const ext = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : m ? m[1].toLowerCase() : "bin";
      const n = attachments.length + 1;
      const file = `${id}-att${n}.${ext}`;
      writeFileSync(imagePath(file), buf);
      attachments.push({ n, file, mime, size: buf.length, name: str(a.name || file) });
    }
    const nodes = [];
    for (const raw of (Array.isArray(b.nodes) ? b.nodes : []).slice(0, 12)) {
      if (!raw || !raw.id) continue;
      const i = nodes.length + 1;
      const node = { id: String(raw.id), name: str(raw.name), type: String(raw.type || ""), w: raw.w ?? null, h: raw.h ?? null };
      if (raw.page) node.page = str(raw.page);
      if (raw.pageId) node.pageId = String(raw.pageId);
      if (raw.image) {
        writeFileSync(imagePath(`${id}-t${i}.png`), Buffer.from(raw.image, "base64"));
        node.hasImage = true;
      }
      nodes.push(node);
    }
    if (!imageFile && nodes[0]?.hasImage) imageFile = `${id}-t1.png`;
    const it = {
      id,
      status: "pending",
      createdAt: now(),
      updatedAt: now(),
      fileKey: b.fileKey ? str(b.fileKey, 80) : null,
      fileName: b.fileName ? str(b.fileName) : null,
      pageName: b.pageName ? str(b.pageName) : null,
      pageId: b.pageId ? str(b.pageId, 40) : null,
      nodes,
      note: String(b.note).trim().slice(0, 20000),
      intent: b.intent ? str(b.intent, 20) : "change",
      priority: b.priority === "urgent" ? "urgent" : "normal",
      imageFile,
      batchId: b.batchId ? str(b.batchId, 40) : null,
      batchMode: b.batchMode === "parallel" ? "parallel" : b.batchId ? "order" : null,
      mentions: (Array.isArray(b.mentions) ? b.mentions : [])
        .slice(0, 20)
        .filter((m) => m && m.name)
        .map((m) => ({
          kind: str(m.kind, 20), id: m.id ? str(m.id, 80) : null, key: m.key ? str(m.key, 80) : null,
          name: str(m.name), sub: str(m.sub, 40), library: m.library ? str(m.library) : null,
        })),
      library: b.library ? str(b.library) : null,
      variations: Math.max(1, Math.min(6, Number(b.variations) || 1)),
      useComments: b.useComments === "summarize" ? "summarize" : b.useComments ? "apply" : null,
      references: b.references && b.references.source === "mobbin"
        ? { source: "mobbin", count: Math.max(2, Math.min(16, Number(b.references.count) || 6)) }
        : null,
      model: b.model && MODEL_ID.test(b.model) ? String(b.model) : null,
      modelName: b.model && b.modelName ? str(b.modelName, 60) : null,
      planFirst: !!b.planFirst,
      skill: b.skill ? str(b.skill) : null,
      scope: b.scope === "file" ? "file" : null,
      attachments,
      thread: [],
    };
    db.items.push(it);
    save();
    changed();
    return it;
  }

  function message(it, b) {
    const from = b.from === "claude" ? "claude" : "user";
    if (!b.text || !String(b.text).trim()) throw Object.assign(new Error("text required"), { code: 400 });
    if (from === "claude" && b.status && !STATUSES.includes(b.status)) throw Object.assign(new Error("bad status"), { code: 400 });
    const images = [];
    if (from === "claude" && Array.isArray(b.images)) {
      for (const im of b.images.slice(0, 16)) {
        if (!im || !IMG_EXT[im.mime] || !im.data) continue;
        const buf = Buffer.from(String(im.data), "base64");
        if (!buf.length || buf.length > 8 * 1024 * 1024) continue;
        const k = (it.imgSeq = (it.imgSeq || 0) + 1);
        const file = `${it.id}-m${k}.${IMG_EXT[im.mime]}`;
        writeFileSync(imagePath(file), buf);
        images.push({
          k, file, mime: im.mime,
          link: /^https:\/\//.test(im.link || "") ? String(im.link).slice(0, 500) : null,
          caption: im.caption ? String(im.caption).slice(0, 120) : null,
        });
      }
    }
    const text = String(b.text).trim().slice(0, 20000);
    const prev = from === "claude" && b.replaceLast ? it.thread.findLast((t) => t.from === "claude") : null;
    if (prev) {
      prev.text = text;
      if (images.length) prev.images = images;
    } else {
      it.thread.push({
        from, text, at: now(),
        ...(from === "claude" && b.kind === "plan" ? { kind: "plan" } : {}),
        ...(images.length ? { images } : {}),
      });
    }
    // a user message is unread until Claude answers; it re-opens a finished note
    if (from === "user") {
      it.unread = true;
      if (it.status !== "working") it.status = "pending";
    } else it.unread = false;
    if (from === "claude" && b.status) it.status = b.status;
    it.updatedAt = now();
    save();
    changed();
  }

  // The agent a note goes to when it enters Working: a batch "in order" stays with the agent of
  // its first note; a lone note with nothing in Working goes to main; otherwise the first free
  // helper, main last. null = all five busy (the note waits in Pending).
  // agents on a note in Working: its own agent and the helpers it was split between
  function busyAgents(except) {
    const busy = new Set();
    for (const i of db.items) {
      if (i === except || i.status !== "working") continue;
      if (i.agent) busy.add(i.agent);
      for (const h of i.helpers || []) busy.add(h);
    }
    return busy;
  }

  // A note split into independent parts: up to `parts` free helpers are reserved on it (none
  // when all are busy: its own agent does every part)
  function split(it, parts) {
    const busy = busyAgents(it);
    if (it.agent) busy.add(it.agent);
    it.helpers = AGENTS.slice(1).filter((a) => !busy.has(a)).slice(0, Math.max(0, Math.min(4, Number(parts) || 0)));
    it.updatedAt = now();
    save();
    changed();
    return it.helpers;
  }

  function pickAgent(it) {
    const working = db.items.filter((i) => i !== it && i.status === "working" && i.agent);
    if (it.batchId && it.batchMode === "order") {
      const mate = db.items.find((i) => i !== it && i.batchId === it.batchId && i.agent && i.status === "working");
      if (mate) return mate.agent;
    }
    const busy = busyAgents(it);
    if (it.agent && !busy.has(it.agent)) return it.agent;
    if (!working.length) return "main";
    return [...AGENTS.slice(1), AGENTS[0]].find((a) => !busy.has(a)) || null;
  }

  function setStatus(it, b) {
    if (b.status) {
      if (!STATUSES.includes(b.status)) throw Object.assign(new Error("bad status"), { code: 400 });
      if (b.status !== "working") it.helpers = [];
      if (b.status === "working" && it.status !== "working") {
        const agent = pickAgent(it);
        if (!agent) throw Object.assign(new Error("agents busy: all five are on a note"), { code: 409 });
        it.agent = agent;
      }
      if (b.status === "working" && it.status !== "working") it.progress = [];
      if (b.status === "working") it.unread = false;
      it.status = b.status;
    }
    if (Array.isArray(b.focus)) it.focus = b.focus.map(String).slice(0, 500);
    it.updatedAt = now();
    save();
    changed();
  }

  // a revert goes in front: the newest change is undone first, the oldest state wins
  function addPatch(it, patch, replace = false) {
    if (!patch || !PATCH_KEYS.some((k) => Array.isArray(patch[k]) && patch[k].length)) return false;
    const old = replace || !it.patch ? emptyPatch() : it.patch;
    it.patch = Object.fromEntries(PATCH_KEYS.map((k) => [k, [...(Array.isArray(patch[k]) ? patch[k] : []), ...(old[k] || [])]]));
    it.reverted = false;
    it.updatedAt = now();
    save();
    changed();
    return true;
  }

  function remove(it) {
    db.items = db.items.filter((i) => i !== it);
    const files = [it.imageFile, `${it.id}-before.png`, `${it.id}-after.png`,
      ...(it.attachments || []).map((a) => a.file),
      ...it.thread.flatMap((t) => t.images || []).map((im) => im.file),
      ...(it.nodes || []).map((n, i) => (n.hasImage ? `${it.id}-t${i + 1}.png` : null))];
    for (const f of files) if (f) rmSync(imagePath(f), { force: true });
    save();
    changed();
  }

  async function undo(it) {
    if (!it.patch) throw new Error("nothing to undo");
    const result = await call("patch", it.patch, 60000);
    it.reverted = true;
    it.thread.push({ from: "system", text: "Change reverted from the plugin.", at: now() });
    it.updatedAt = now();
    save();
    changed();
    return result;
  }

  function imageFile(it, kind) {
    const tgt = /^t(\d+)$/.exec(kind);
    const att = /^att(\d+)$/.exec(kind);
    const msg = /^m(\d+)$/.exec(kind);
    if (msg) {
      const im = it.thread.flatMap((t) => t.images || []).find((x) => x.k === Number(msg[1]));
      return im ? { file: im.file, mime: im.mime } : null;
    }
    if (att) {
      const a = (it.attachments || []).find((x) => x.n === Number(att[1]));
      return a ? { file: a.file, mime: a.mime } : null;
    }
    if (tgt) return it.nodes?.[Number(tgt[1]) - 1]?.hasImage ? { file: `${it.id}-t${tgt[1]}.png`, mime: "image/png" } : null;
    if (kind === "selection") return it.imageFile ? { file: it.imageFile, mime: "image/png" } : null;
    if (kind === "before" || kind === "after") return { file: `${it.id}-${kind}.png`, mime: "image/png" };
    return null;
  }

  function setConfig(b) {
    const token = String(b.figmaToken || "").trim();
    if (token && !/^figd_[A-Za-z0-9_-]{10,200}$/.test(token)) throw Object.assign(new Error("that does not look like a Figma token (figd_…)"), { code: 400 });
    const cfg = config();
    if (token) cfg.figmaToken = token;
    else delete cfg.figmaToken;
    writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    changed();
  }

  async function fileComments(fileKey) {
    const token = figmaToken();
    if (!token) throw Object.assign(new Error("no Figma token: set it in the panel (Options → Comments) or FIGMA_TOKEN"), { code: 412 });
    const r = await fetch(`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/comments`, {
      headers: { "X-Figma-Token": token },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw Object.assign(new Error(`Figma API ${r.status}: ${(await r.text()).slice(0, 200)}`), { code: 502 });
    const { comments = [] } = await r.json();
    const threads = new Map();
    for (const c of comments.filter((c) => !c.parent_id)) {
      threads.set(c.id, { id: c.id, nodeId: c.client_meta?.node_id || null, resolved: !!c.resolved_at, messages: [] });
    }
    for (const c of comments.slice().sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      const t = threads.get(c.parent_id || c.id);
      if (t) t.messages.push({ who: c.user?.handle || "someone", text: c.message, at: c.created_at });
    }
    return [...threads.values()];
  }

  function answerPerm(p, b) {
    if (!DECISIONS[p.kind].includes(b.decision)) throw Object.assign(new Error("decision: " + DECISIONS[p.kind].join("|")), { code: 400 });
    if (p.status !== "pending") throw Object.assign(new Error("already " + p.status), { code: 409 });
    const answers = p.kind === "question" && b.answers && typeof b.answers === "object"
      ? Object.fromEntries(p.questions.map((q) => [q.question, String(b.answers[q.question] ?? "").slice(0, 2000)]))
      : null;
    Object.assign(p, { status: "answered", decision: b.decision, answers, feedback: b.feedback ? String(b.feedback).slice(0, 4000) : null });
    changed();
  }

  // hold a request until test() returns a value, the timeout passes, or the client leaves
  function hold(request, timeoutMs, test, counts = false) {
    return new Promise((resolve) => {
      const first = test();
      if (first) return resolve(first);
      const w = {
        check() {
          const v = test();
          if (v) done(v);
        },
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      const gone = () => done(null);
      request.on("close", gone);
      waiters.add(w);
      if (counts) {
        waiting++;
        changed();
      }
      let over = false;
      function done(v) {
        if (over) return;
        over = true;
        clearTimeout(timer);
        waiters.delete(w);
        request.off("close", gone);
        if (counts) {
          waiting--;
          beatAt = Date.now();
          changed();
        }
        resolve(v);
      }
    });
  }

  // ---------- HTTP for local tools (MCP, hooks): any Origin is refused ----------
  const ROUTE = /^\/(notes|permissions|presence|skills|models|comments|notes-config)(\/|$)/;
  async function http(request, url, json, readJson) {
    if (!ROUTE.test(url.pathname)) return false;
    if (request.headers.origin !== undefined) {
      json(403, { error: "origin refused" });
      return true;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    const m = request.method;
    const body = async () => (m === "GET" || m === "DELETE" ? {} : (await readJson(MAX_BODY)) ?? null);
    try {
      if (parts[0] === "presence" && m === "POST") {
        beatAt = Date.now();
        // a beat changes nothing the panel shows unless Claude was not listening
        if (!lastListening) changed();
        json(200, { ok: true });
        return true;
      }
      if (parts[0] === "notes-config" && m === "POST") {
        const b = await body();
        if (!b) return true;
        setConfig(b);
        json(200, { ok: true, comments: !!figmaToken() });
        return true;
      }
      if (parts[0] === "skills" || parts[0] === "models") {
        if (m === "GET") {
          json(200, db[parts[0]] || []);
          return true;
        }
        const b = await body();
        if (!b) return true;
        if (parts[0] === "skills") {
          db.skills = (Array.isArray(b.skills) ? b.skills : []).slice(0, 200).filter((k) => k && k.name)
            .map((k) => ({ name: str(k.name), description: str(k.description, 200) }));
        } else {
          db.models = (Array.isArray(b.models) ? b.models : []).slice(0, 20).filter((x) => x && x.id && MODEL_ID.test(x.id))
            .map((x) => ({ id: String(x.id), name: str(x.name || x.id, 60) }));
        }
        save();
        changed();
        json(200, { ok: true, count: db[parts[0]].length });
        return true;
      }
      if (parts[0] === "comments" && parts.length === 2 && m === "GET") {
        let threads = await fileComments(parts[1]);
        if (url.searchParams.get("open") === "1") threads = threads.filter((t) => !t.resolved);
        json(200, threads);
        return true;
      }
      if (parts[0] === "permissions") {
        prunePerms();
        if (parts.length === 1 && m === "GET") {
          const status = url.searchParams.get("status");
          json(200, [...perms.values()].filter((p) => !status || p.status === status).map(publicPerm));
          return true;
        }
        if (parts.length === 1 && m === "POST") {
          const b = await body();
          if (!b) return true;
          const kind = DECISIONS[b.kind] ? b.kind : "permission";
          const p = {
            id: String(++permSeq), kind, at: Date.now(), createdAt: now(), status: "pending",
            decision: null, answers: null, feedback: null,
            title: str(b.title, 120), sub: str(b.sub, 300), detail: String(b.detail ?? "").slice(0, 4000), rule: str(b.rule, 200),
            noteId: b.noteId ? str(b.noteId, 12) : null,
            questions: kind === "question" ? cleanQuestions(b.questions) : null,
            plan: kind === "plan" ? String(b.plan ?? "").slice(0, 20000) : null,
          };
          perms.set(p.id, p);
          changed();
          json(201, publicPerm(p));
          return true;
        }
        const p = perms.get(parts[1]);
        if (!p) {
          json(404, { error: "not found" });
          return true;
        }
        // ?wait=ms holds until the panel answers
        if (parts.length === 2 && m === "GET") {
          const wait = Math.min(Number(url.searchParams.get("wait")) || 0, 300000);
          if (wait > 0) await hold(request, wait, () => p.status !== "pending" && p);
          json(200, publicPerm(p));
          return true;
        }
        if (parts.length === 2 && m === "POST") {
          const b = await body();
          if (!b) return true;
          answerPerm(p, b);
          json(200, publicPerm(p));
          return true;
        }
        if (parts[2] === "expire" && m === "POST") {
          if (p.status === "pending") p.status = "expired";
          changed();
          json(200, publicPerm(p));
          return true;
        }
      }
      if (parts[0] !== "notes") {
        json(404, { error: "no route" });
        return true;
      }
      // panel state for hooks: is the panel open, and which note is Claude on
      if (parts[1] === "health" && m === "GET") {
        const working = db.items.filter((i) => i.status === "working").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        json(200, { ok: true, panel: panelOpen(), claude: listening(), working: working ? working.id : null, count: db.items.length, data: DATA });
        return true;
      }
      // long poll: notes waiting or with an unread message, not in `seen` ({ id: updatedAt })
      if (parts[1] === "wait" && m === "POST") {
        const b = await body();
        if (!b) return true;
        const seen = b.seen && typeof b.seen === "object" ? b.seen : {};
        const timeout = Math.max(1000, Math.min(Number(b.timeout) || 45000, 600000));
        const fresh = () => {
          // a pending note waits here until an agent is free to take it
          const f = db.items.filter((i) => (i.status === "pending" || i.unread) && seen[i.id] !== i.updatedAt && (i.status !== "pending" || pickAgent(i)));
          return f.length ? f : null;
        };
        const got = await hold(request, timeout, fresh, true);
        json(200, (got || []).map(publicItem));
        return true;
      }
      if (parts.length === 1 && m === "GET") {
        const status = url.searchParams.get("status");
        const fileKey = url.searchParams.get("fileKey");
        const unread = url.searchParams.get("unread") === "1";
        let items = db.items;
        if (status) items = items.filter((i) => status.split(",").includes(i.status) || (unread && i.unread));
        if (fileKey) items = items.filter((i) => i.fileKey === fileKey);
        json(200, items.map(publicItem));
        return true;
      }
      if (parts.length === 1 && m === "POST") {
        const b = await body();
        if (!b) return true;
        json(201, publicItem(create(b)));
        return true;
      }
      const it = find(parts[1]);
      if (!it) {
        json(404, { error: "not found" });
        return true;
      }
      if (parts[2] === "image" && parts.length === 4 && m === "GET") {
        const f = imageFile(it, parts[3]);
        if (!f || !existsSync(imagePath(f.file))) {
          json(404, { error: "no image" });
          return true;
        }
        const buf = readFileSync(imagePath(f.file));
        json.raw(200, f.mime, buf);
        return true;
      }
      if (parts.length === 2 && m === "GET") {
        json(200, { ...publicItem(it), figmaUrl: figmaUrl(it) });
        return true;
      }
      if (parts.length === 2 && m === "PATCH") {
        const b = await body();
        if (!b) return true;
        setStatus(it, b);
        json(200, publicItem(it));
        return true;
      }
      if (parts.length === 2 && m === "DELETE") {
        remove(it);
        json(200, { ok: true });
        return true;
      }
      if (parts[2] === "messages" && m === "POST") {
        const b = await body();
        if (!b) return true;
        message(it, b);
        json(200, publicItem(it));
        return true;
      }
      if (parts[2] === "split" && m === "POST") {
        const b = await body();
        if (!b) return true;
        if (it.status !== "working") throw Object.assign(new Error("split: the note is not in Working"), { code: 409 });
        json(200, { agent: it.agent, helpers: split(it, b.parts) });
        return true;
      }
      if (parts[2] === "progress" && m === "POST") {
        const b = await body();
        if (!b) return true;
        if (!b.text || !String(b.text).trim()) throw Object.assign(new Error("text required"), { code: 400 });
        it.progress = [...(it.progress || []), { text: String(b.text).replace(/\s+/g, " ").trim().slice(0, 200), at: now() }].slice(-40);
        it.updatedAt = now();
        save();
        changed();
        json(200, { ok: true });
        return true;
      }
      if (parts[2] === "snapshot" && m === "POST") {
        const b = await body();
        if (!b) return true;
        if (!["before", "after"].includes(b.kind) || !b.image) throw Object.assign(new Error("kind (before|after) and image required"), { code: 400 });
        writeFileSync(imagePath(`${it.id}-${b.kind}.png`), Buffer.from(b.image, "base64"));
        it.updatedAt = now();
        save();
        changed();
        json(200, { ok: true });
        return true;
      }
      if (parts[2] === "patch" && m === "POST") {
        const b = await body();
        if (!b) return true;
        if (!addPatch(it, b.patch, b.replace === true)) throw Object.assign(new Error(`patch needs one of: ${PATCH_KEYS.join(", ")}`), { code: 400 });
        json(200, { ok: true });
        return true;
      }
      if (parts[2] === "undo" && m === "POST") {
        json(200, { ok: true, result: await undo(it) });
        return true;
      }
      json(404, { error: "no route" });
    } catch (error) {
      json(error.code && error.code >= 400 && error.code < 600 ? error.code : 500, { error: String(error.message || error) });
    }
    return true;
  }

  // ---------- frames from the panel ----------
  const FRAMES = new Set(["notes-get", "note-create", "note-reply", "note-delete", "note-undo", "note-img", "perm-answer", "note-config", "notes-comments"]);
  async function frame(f) {
    if (!FRAMES.has(f.type)) return false;
    const fail = (error) => send({ type: "note-error", ref: f.ref ?? null, op: f.type, error: String(error.message || error) });
    try {
      if (f.type === "notes-get") push();
      else if (f.type === "note-create") {
        const it = create(f.note || {});
        send({ type: "note-created", ref: f.ref ?? null, id: it.id });
      } else if (f.type === "perm-answer") {
        const p = perms.get(String(f.id));
        if (!p) throw new Error("that prompt is gone");
        answerPerm(p, f);
      } else if (f.type === "note-config") setConfig(f);
      else if (f.type === "notes-comments") {
        const threads = await fileComments(String(f.fileKey || ""));
        send({ type: "notes-comments", fileKey: f.fileKey, threads });
      } else {
        const it = find(f.id);
        if (!it) throw new Error("note not found");
        if (f.type === "note-reply") message(it, { from: "user", text: f.text });
        else if (f.type === "note-delete") remove(it);
        else if (f.type === "note-undo") await undo(it);
        else if (f.type === "note-img") {
          const file = imageFile(it, String(f.kind));
          const p = file && imagePath(file.file);
          if (!p || !existsSync(p)) send({ type: "note-img", id: it.id, kind: f.kind, missing: true });
          else send({ type: "note-img", id: it.id, kind: f.kind, mime: file.mime, data: readFileSync(p).toString("base64") });
        }
      }
    } catch (error) {
      log(`${f.type} : ${error.message || error}`);
      fail(error);
    }
    return true;
  }

  // a revert captured by apply/exec on a note's behalf
  function addRevert(noteId, revert) {
    const it = find(noteId);
    if (!it || !revert) return false;
    return addPatch(it, revert);
  }

  return { http, frame, push, addRevert, listening };
}
