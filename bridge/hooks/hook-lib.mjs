// Shared by the Claude Code hooks: talk to the local angelo bridge, find the note Claude is on,
// wait for the panel's answer. Feature port of Retoucher's hooks (MIT, Copyright (c) 2026 Ali Çorak).
// Any failure (bridge down, panel closed) returns null: the hook then prints nothing and the terminal asks.
export const BASE = `http://127.0.0.1:${process.env.ANGELO_PORT || 8787}`;

export const readStdin = () =>
  new Promise((resolve) => {
    let s = "";
    process.stdin.on("data", (c) => (s += c));
    process.stdin.on("end", () => resolve(s));
  });

export async function call(path, { method = "GET", body, timeout = 2000 } = {}) {
  const r = await fetch(BASE + path, {
    method,
    signal: AbortSignal.timeout(timeout),
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

// The panel takes over only while it is open and Claude is on a note; otherwise the person is at the terminal.
export async function noteInPanel() {
  try {
    const h = await call("/notes/health", { timeout: 1500 });
    return h.panel && h.working ? { id: h.working } : null;
  } catch {
    return null;
  }
}

// Post a prompt to the panel and hold one long poll until it is answered; null when nobody answers in time.
export async function askPanel(body, waitMs) {
  let p;
  try {
    p = await call("/permissions", { method: "POST", body });
  } catch {
    return null;
  }
  try {
    const cur = await call(`/permissions/${p.id}?wait=${waitMs}`, { timeout: waitMs + 3000 });
    if (cur.status === "answered") return cur;
  } catch {}
  try {
    await call(`/permissions/${p.id}/expire`, { method: "POST", body: {} });
  } catch {}
  return null;
}
