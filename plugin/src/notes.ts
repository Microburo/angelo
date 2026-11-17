// Ported from Retoucher (https://github.com/alicorak/retoucher), MIT License, Copyright (c) 2026 Ali Çorak. See THIRD_PARTY_LICENSES.
// Notes panel, main-thread side: everything the panel needs from the Figma API.
// Selection, canvas markers (native annotations), @mentions, the file key, quick action,
// focus. The UI iframe relays notes to the bridge; nothing here talks to the network.
//
// Messages: UI → main {kind:"notes", type, ...} · main → UI {kind:"notes", type, ...}

import { nodeOrNull } from "./lookup";

const MAX_NODES = 12;
const MAX_TARGETS = 6;
const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting",
  working: "Claude is working",
  question: "Needs your answer",
  done: "Done",
};
const PREF_KEYS = ["size", "mini", "miniW", "markers", "optionsOpen", "view"];
const IDEAS = [
  "Make 3 variations",
  "Convert to dark mode",
  "Fix spacing to the 8 pt grid",
  "Use components and variables from the design system",
  "Replace placeholder copy and images with realistic content",
  "Apply the comments on this screen",
];

type Post = (message: Record<string, unknown>) => void;

let post: Post = () => {};
let panelOpen = false;
let uiReady = false;
let quickNote: string | null = null;

const send = (type: string, data: Record<string, unknown> = {}) => post({ kind: "notes", type, ...data });

// ── pictures

export async function exportNode(node: BaseNode, maxPx: number): Promise<Uint8Array | null> {
  if (!("exportAsync" in node)) return null;
  const n = node as SceneNode;
  const w = "width" in n ? n.width : 1;
  const h = "height" in n ? n.height : 1;
  const scale = Math.max(0.1, Math.min(2, maxPx / Math.max(w, h, 1)));
  try {
    return await n.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: scale } });
  } catch {
    return null;
  }
}

/** rpc `export {id, maxPx}` → base64 PNG (note snapshots taken by Claude). */
export async function exportForRpc(params: Record<string, unknown>): Promise<unknown> {
  const id = String(params.id || "");
  if (!id) throw new Error("export: `id` missing");
  const node = await nodeOrNull(id);
  if (!node || !("exportAsync" in node)) throw new Error(`export: unknown or non-exportable node #${id}`);
  const bytes = await exportNode(node, Number(params.maxPx) || 1600);
  if (!bytes) throw new Error(`export: failed on #${id}`);
  return { data: figma.base64Encode(bytes), mime: "image/png" };
}

/** Everything selected becomes a target. */
async function targetsFromSelection(): Promise<unknown[]> {
  const page = figma.currentPage;
  const out: Record<string, unknown>[] = [];
  for (const n of page.selection.slice(0, MAX_TARGETS)) {
    const t: Record<string, unknown> = {
      id: n.id, name: n.name, type: n.type,
      w: Math.round(n.width), h: Math.round(n.height),
      pageId: page.id, page: page.name,
    };
    out.push(t);
  }
  return out;
}

// ── selection and context

export function pushSelection(): void {
  if (!panelOpen) return;
  const all = figma.currentPage.selection;
  const sel = all.slice(0, MAX_NODES);
  // The selected layer and its parents, so the panel can open the note that covers it
  const path: string[] = [];
  for (let n: BaseNode | null = sel[0] || null; n && n.type !== "PAGE" && n.type !== "DOCUMENT"; n = n.parent) path.push(n.id);
  send("selection", {
    nodes: sel.map((n) => ({
      id: n.id, name: n.name, type: n.type,
      w: "width" in n ? Math.round(n.width) : null,
      h: "height" in n ? Math.round(n.height) : null,
    })),
    total: all.length,
    path,
  });
}

// Plugins outside the private dev build get no figma.fileKey. The designer pastes the file's link once:
// kept in the document (plugin data, right for everyone opening it) and on this computer under the
// file's name for view-only files, where the document can't be written.
const KEY_DATA = "angelo:fileKey";
const localKeyName = () => "fileKey:" + figma.root.name;
let savedKey: string | null = null;

async function loadSavedKey(): Promise<void> {
  savedKey = figma.root.getPluginData(KEY_DATA) || (await figma.clientStorage.getAsync(localKeyName())) || null;
}

async function saveKey(key: string): Promise<void> {
  savedKey = key || null;
  try {
    figma.root.setPluginData(KEY_DATA, key || "");
  } catch {}
  await figma.clientStorage.setAsync(localKeyName(), key || "");
}

export function pushContext(): void {
  send("context", {
    fileKey: figma.fileKey || savedKey || null,
    fileName: figma.root.name,
    pageName: figma.currentPage.name,
    pageId: figma.currentPage.id,
  });
}

// ── canvas markers: one native annotation per note per layer, "Claude #<id>". Others' annotations stay.

const markerState = new Map<string, string>(); // note id → signature last applied ('none' = removed)

const MARKER = /^\W*Claude #(\w+)\b/;
const markerId = (a: Annotation) => MARKER.exec(a.labelMarkdown || a.label || "")?.[1];
const isMine = (a: Annotation, id: string) => markerId(a) === id;

async function setMarker(nodeId: string, id: string, markdown: string | null): Promise<void> {
  const node = await nodeOrNull(nodeId);
  if (!node || !("annotations" in node)) return;
  const target = node as SceneNode & AnnotationsMixin;
  const others = (target.annotations || []).filter((a) => !isMine(a, id));
  target.annotations = markdown ? others.concat([{ labelMarkdown: markdown }]) : others;
}

// A note's marker travels with its layer when the layer is duplicated: removal sweeps the page,
// not only the note's targets, so no copy keeps it.
function sweepMarkers(ids: Set<string>): void {
  if (!ids.size) return;
  const swept = (a: Annotation) => ids.has(markerId(a) as string);
  for (const n of figma.currentPage.findAll((n) => "annotations" in n && (n as any).annotations.some(swept))) {
    try {
      const target = n as SceneNode & AnnotationsMixin;
      target.annotations = target.annotations.filter((a) => !swept(a));
    } catch {} // locked or read-only layer
  }
}

async function syncMarkers(items: Array<{ id: string | number; status: string; note: string; nodeIds: string[] }>, enabled: boolean): Promise<void> {
  const gone = new Set<string>();
  for (const it of items || []) {
    const id = String(it.id);
    const want = enabled && it.status !== "done" ? `${it.status}|${it.note}` : "none";
    if (markerState.get(id) === want) continue;
    const md = want === "none" ? null : `**Claude #${id}** · ${STATUS_LABEL[it.status] || it.status}\n${String(it.note).slice(0, 220)}`;
    for (const nodeId of it.nodeIds || []) {
      try {
        await setMarker(nodeId, id, md);
      } catch {} // layer gone or type without annotations
    }
    if (!md) gone.add(id);
    markerState.set(id, want);
  }
  sweepMarkers(gone);
}

// ── @mentions: variables, styles, components and libraries a note can point Claude to

interface Mention {
  kind: string;
  id?: string;
  key: string;
  name: string;
  sub: string;
  library?: string;
}
let mentionCache: Mention[] | null = null;
let mentionAt = 0;

async function libraryVariables(out: Mention[], libs: Set<string>): Promise<void> {
  try {
    for (const col of await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()) {
      libs.add(col.libraryName);
      for (const v of await figma.teamLibrary.getVariablesInLibraryCollectionAsync(col.key)) {
        out.push({ kind: "variable", key: v.key, name: v.name, sub: v.resolvedType.toLowerCase(), library: col.libraryName });
      }
    }
  } catch {} // no team library access
}

/** Library components can't be listed through the plugin API; the ones this page already uses can. */
async function usedLibraryComponents(out: Mention[]): Promise<void> {
  const seen = new Set<string>();
  for (const inst of figma.currentPage.findAllWithCriteria({ types: ["INSTANCE"] }).slice(0, 400)) {
    const main = await inst.getMainComponentAsync().catch(() => null);
    if (!main || !main.remote) continue;
    const top = main.parent && main.parent.type === "COMPONENT_SET" ? main.parent : main;
    if (seen.has(top.key)) continue;
    seen.add(top.key);
    out.push({
      kind: "component", key: top.key, name: top.name,
      sub: "library " + (top.type === "COMPONENT_SET" ? "component set" : "component"),
      library: "used on this page",
    });
  }
}

async function mentionIndex(): Promise<Mention[]> {
  if (mentionCache && Date.now() - mentionAt < 60000) return mentionCache;
  const out: Mention[] = [];
  const libs = new Set<string>();
  try {
    for (const v of await figma.variables.getLocalVariablesAsync()) {
      out.push({ kind: "variable", id: v.id, key: v.key, name: v.name, sub: v.resolvedType.toLowerCase() });
    }
  } catch {}
  const styleKinds: Array<[() => Promise<BaseStyle[]>, string]> = [
    [() => figma.getLocalPaintStylesAsync(), "color style"],
    [() => figma.getLocalTextStylesAsync(), "text style"],
    [() => figma.getLocalEffectStylesAsync(), "effect style"],
  ];
  for (const [list, sub] of styleKinds) {
    try {
      for (const st of await list()) out.push({ kind: "style", id: st.id, key: st.key, name: st.name, sub });
    } catch {}
  }
  try {
    for (const c of figma.currentPage.findAllWithCriteria({ types: ["COMPONENT", "COMPONENT_SET"] })) {
      if (c.type === "COMPONENT" && c.parent && c.parent.type === "COMPONENT_SET") continue; // the set stands for its variants
      out.push({ kind: "component", id: c.id, key: c.key, name: c.name, sub: c.type === "COMPONENT_SET" ? "component set" : "component" });
    }
  } catch {}
  try {
    await usedLibraryComponents(out);
  } catch {}
  await libraryVariables(out, libs);
  libs.forEach((name) => out.push({ kind: "library", key: name, name, sub: "library" }));
  mentionCache = out;
  mentionAt = Date.now();
  return out;
}

async function searchMentions(q: string): Promise<Mention[]> {
  const lq = String(q || "").toLowerCase();
  const score = (m: Mention) => {
    const n = m.name.toLowerCase();
    if (n.startsWith(lq)) return 0;
    if (n.split(/[\/\s_-]/).some((p) => p.startsWith(lq))) return 1;
    return n.includes(lq) ? 2 : 9;
  };
  return (await mentionIndex())
    .map((m) => [score(m), m] as [number, Mention])
    .filter(([s]) => s < 9)
    .sort((a, b) => a[0] - b[0] || a[1].name.length - b[1].name.length)
    .slice(0, 8)
    .map(([, m]) => m);
}

async function libraryNames(): Promise<string[]> {
  const libs = new Set<string>();
  try {
    for (const col of await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()) libs.add(col.libraryName);
  } catch {}
  return Array.from(libs).sort();
}

// ── focus

function pageOf(node: BaseNode): PageNode | null {
  let n: BaseNode | null = node;
  while (n && n.type !== "PAGE") n = n.parent;
  return n as PageNode | null;
}

async function focus(ids: string[]): Promise<void> {
  const found: SceneNode[] = [];
  for (const id of ids || []) {
    const n = await nodeOrNull(id);
    if (n && n.type !== "DOCUMENT" && n.type !== "PAGE") found.push(n as SceneNode);
  }
  if (!found.length) {
    figma.notify("Those layers no longer exist.");
    return;
  }
  const page = pageOf(found[0]);
  if (page && page !== figma.currentPage) await figma.setCurrentPageAsync(page);
  figma.currentPage.selection = found;
  figma.viewport.scrollAndZoomIntoView(found);
}

// ── quick action: Cmd+/ → angelo → type the note, Enter sends it with the selection

function sendQuick(): void {
  if (!quickNote || !uiReady) return;
  send("quick-note", { note: quickNote });
  quickNote = null;
}

export function initNotes(postMessage: Post, sizeTo: (w: number, h: number) => void): void {
  post = postMessage;
  figma.parameters.on("input", ({ key, query, result }) => {
    if (key !== "note") return;
    const q = query.trim();
    const lq = q.toLowerCase();
    result.setSuggestions((q ? [q] : []).concat(IDEAS.filter((s) => s !== q && s.toLowerCase().includes(lq))));
  });
  figma.on("run", ({ parameters }) => {
    if (!parameters || !parameters.note) return;
    quickNote = String(parameters.note);
    sendQuick();
  });
  figma.on("selectionchange", pushSelection);
  figma.on("currentpagechange", () => {
    pushContext();
    pushSelection();
  });
  windowSizer = sizeTo;
}

let windowSizer: (w: number, h: number) => void = () => {};

/** UI → main messages of the notes panel. */
export async function onNotesMessage(msg: Record<string, any>): Promise<void> {
  switch (msg.type) {
    case "ready": {
      await loadSavedKey();
      const values = await Promise.all(PREF_KEYS.map((key) => figma.clientStorage.getAsync("notes." + key)));
      const prefs: Record<string, unknown> = Object.fromEntries(PREF_KEYS.map((key, i) => [key, values[i]]));
      panelOpen = prefs.mini === false;
      send("prefs", prefs);
      pushContext();
      pushSelection();
      uiReady = true;
      sendQuick();
      libraryNames().then((names) => send("libraries", { names }));
      return;
    }
    case "panel":
      // The panel is shown (true) or folded back into the bar (false)
      panelOpen = !!msg.open;
      await figma.clientStorage.setAsync("notes.mini", !panelOpen);
      if (panelOpen) pushSelection();
      return;
    case "set-pref":
      if (PREF_KEYS.includes(msg.key)) await figma.clientStorage.setAsync("notes." + msg.key, msg.value);
      return;
    case "resize":
      windowSizer(Math.round(msg.w), Math.round(msg.h));
      return;
    case "save-file-key":
      await saveKey(String(msg.key || ""));
      pushContext();
      return;
    case "sync-markers":
      await syncMarkers(msg.items, !!msg.enabled);
      return;
    case "clear-markers":
      for (const nodeId of msg.nodeIds || []) {
        try {
          await setMarker(nodeId, String(msg.id), null);
        } catch {}
      }
      sweepMarkers(new Set([String(msg.id)]));
      markerState.delete(String(msg.id));
      return;
    case "focus":
      await focus(msg.ids);
      return;
    case "add-selection":
      send("targets-added", { targets: await targetsFromSelection() });
      return;
    case "mention-search":
      send("mention-results", { q: msg.q, results: await searchMentions(msg.q) });
      return;
    case "notify":
      figma.notify(String(msg.text || ""));
      return;
    case "open-url":
      if (/^https?:\/\//.test(msg.url || "")) figma.openExternal(msg.url);
      return;
  }
}
