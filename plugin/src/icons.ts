// Lucide embedded in the plugin: every drawing ships in the bundle, a component is
// only created in the file the first time a name is asked for.
//
// The component mirrors the kit's icons: a 24 px frame holding one filled vector
// that scales with the instance (a live stroke would keep its weight when resized),
// so one colour override on the vector paints the icon.

import LUCIDE from "virtual:lucide";

const PREFIX = "Icon / ";
const SHEET = "Lucide on demand";
const COLUMNS = 40;
const SIZE = 24;
const GAP = 16;

// The table is a string until the first icon: 1 MB of object literal would be
// paid at every plugin launch, read or not.
let drawings: Record<string, string> | null = null;
const table = (): Record<string, string> => {
  if (!drawings) drawings = JSON.parse(LUCIDE) as Record<string, string>;
  return drawings;
};

const svgOf = (inner: string, stroke: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" fill="none" stroke="#000000" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const iconPage = async (): Promise<PageNode> => {
  let page = figma.root.children.find((p) => /lucide/i.test(p.name));
  if (!page) {
    page = figma.createPage();
    page.name = "👻 lucide-icons";
  }
  await page.loadAsync();
  return page;
};

// Name → component of the file; a miss rescans, the file may have changed since.
const known = new Map<string, ComponentNode>();
const scan = (page: PageNode): void => {
  known.clear();
  for (const c of page.findAllWithCriteria({ types: ["COMPONENT"] })) {
    if (c.name.startsWith(PREFIX)) known.set(c.name.slice(PREFIX.length), c);
  }
};

const sheetOf = (page: PageNode): FrameNode => {
  const found = page.children.find((n) => n.type === "FRAME" && n.name === SHEET);
  if (found) return found as FrameNode;
  const bottom = page.children.reduce((y, n) => Math.max(y, n.y + n.height), 0);
  const f = figma.createFrame();
  f.name = SHEET;
  f.fills = [];
  f.layoutMode = "HORIZONTAL";
  f.layoutWrap = "WRAP";
  f.itemSpacing = GAP;
  f.counterAxisSpacing = GAP;
  f.resize(COLUMNS * (SIZE + GAP) - GAP, SIZE);
  f.primaryAxisSizingMode = "FIXED";
  f.counterAxisSizingMode = "AUTO";
  page.appendChild(f);
  f.y = page.children.length > 1 ? bottom + 80 : 0;
  return f;
};

// The file's icon colour token, when it has one: drawn icons bind to it instead of plain black.
const ICON_TOKEN = "icon/default";
const iconToken = async (): Promise<Variable | null> => {
  const vars = await figma.variables.getLocalVariablesAsync("COLOR");
  return vars.find((v) => v.name === ICON_TOKEN) ?? null;
};

const draw = (name: string, inner: string, page: PageNode, stroke: number, token: Variable | null): ComponentNode => {
  const frame = figma.createNodeFromSvg(svgOf(inner, stroke));
  const parts: SceneNode[] = [];
  for (const k of [...frame.children]) {
    const out = (k as VectorNode).outlineStroke();
    if (out) {
      frame.appendChild(out);
      parts.push(out);
    }
    k.remove();
  }
  // A union first: outlines overlap and flatten alone keeps their winding, holes included.
  const merged = parts.length > 1 ? figma.union(parts, frame) : parts[0];
  const vector = figma.flatten([merged], frame);
  vector.name = "Vector";
  // figma.union paints the boolean in Figma's default grey (#D9D9D9) and flatten keeps it
  const black: SolidPaint = { type: "SOLID", color: { r: 0, g: 0, b: 0 } };
  vector.fills = [token ? figma.variables.setBoundVariableForPaint(black, "color", token) : black];
  vector.constraints = { horizontal: "SCALE", vertical: "SCALE" };
  frame.fills = [];
  frame.clipsContent = false;
  const c = figma.createComponentFromNode(frame);
  c.name = PREFIX + name;
  sheetOf(page).appendChild(c);
  return c;
};

// The file's component for a Lucide name, created once, or null for a name Lucide does not have.
// `stroke` (Lucide default 2) only applies when the component is drawn; an existing one is reused as is.
export async function icon(name: string, opts: { stroke?: number } = {}): Promise<ComponentNode | null> {
  const hit = known.get(name);
  if (hit && !hit.removed) return hit;
  const page = await iconPage();
  scan(page);
  const again = known.get(name);
  if (again) return again;
  const inner = table()[name];
  if (inner === undefined) return null;
  const made = draw(name, inner, page, opts.stroke ?? 2, await iconToken());
  known.set(name, made);
  return made;
}
