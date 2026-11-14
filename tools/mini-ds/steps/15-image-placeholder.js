// In-place patch: Image placeholder = plain bg/muted fill, no pictogram.
const set = setNamed("Image");
let n = 0;
for (const v of set.children) {
  v.fills = [solid("bg/muted")];
  v.findChild((k) => k.name === "placeholder")?.remove();
  n++;
}
return { patched: n };
