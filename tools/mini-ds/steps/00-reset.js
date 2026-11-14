// Clears the file's local variables and styles, empties (or creates) the "📐 Design system" board page and the
// "💊 Components" masters page (V1 page names), then stages the masters frame empty on the latter.
// guard: a file that already holds variables is never wiped unless run.mjs got --wipe
const existing = await figma.variables.getLocalVariableCollectionsAsync();
if (existing.length && !WIPE) throw new Error(`"${figma.root.name}" already has ${existing.length} variable collection(s): blank file expected (run.mjs --wipe to force)`);
for (const col of existing) col.remove();
// a wiped rebuild redraws its icons (the plugin-made sheet would be reused as is otherwise)
if (WIPE) for (const p of figma.root.children) if (/lucide/i.test(p.name) && figma.root.children.length > 1) p.remove();
const styles = [...(await figma.getLocalTextStylesAsync()), ...(await figma.getLocalEffectStylesAsync()), ...(await figma.getLocalGridStylesAsync()), ...(await figma.getLocalPaintStylesAsync())];
for (const s of styles) s.remove();

const ensurePage = async (name, label) => {
  let p = pageNamed(name);
  if (!p) p = figma.createPage();
  p.name = label;
  await p.loadAsync();
  for (const k of [...p.children]) k.remove();
  return p;
};
const page = await ensurePage(PAGE, "📐 " + PAGE);
const mpage = await ensurePage(MASTERS_PAGE, "💊 " + MASTERS_PAGE);

// element frames are created by the build steps (card()); only the masters frame is staged here
await figma.setCurrentPageAsync(mpage);
const c = await H.cursor();
page.backgrounds = [{ type: "SOLID", color: { r: 0.961, g: 0.961, b: 0.961 } }];
const boards = [[MASTERS, 1600, 1400]];
let x = 0;
const ids = {};
for (const [name, w, h] of boards) {
  const f = await c.stage({ name, width: w, height: h, x, y: 0 });
  f.fills = [{ type: "SOLID", color: { r: 0.957, g: 0.957, b: 0.961 } }];
  ids[name] = f.id;
  x += w + 300;
}
c.done();
await figma.setCurrentPageAsync(page);
return { removedStyles: styles.length, ids };
