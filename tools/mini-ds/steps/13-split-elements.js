// In-place patch: every presentation card becomes its own top-level element frame (white card on the
// grey page, named after the element), combined cards split one per element, the old boards removed.
const BOARDS = ["Mini DS / Colors", "Mini DS / Typography", "Mini DS / Foundations", "Mini DS / Components"];
const SPLIT = {
  "Textarea · Select": { Textarea: (n) => n.name === "Textarea", Select: (n) => n.name === "Select" },
  "Checkbox · Radio · Slider": { Checkbox: (n) => n.name === "checkbox", Radio: (n) => n.name === "radio", Slider: (n) => n.name === "slider" },
  "Avatar · Badge": { Avatar: (n) => n.name === "avatars", Badge: (n) => n.name === "badges" },
};
const page = figma.currentPage;
const asElement = (f, name) => {
  f.name = name;
  page.appendChild(f);
  pad(f, 40);
  f.setPluginData(ELEMENT, "1");
  return f;
};
const made = [];
for (const b of BOARDS) {
  const root = rootNamed(b);
  if (!root) continue;
  const body = root.findChild((n) => n.name === "body");
  for (const w of [...body.children]) {
    const caption = w.name.replace(/^card \/ /, "");
    const inner = w.findChild((n) => n.name === "card");
    if (SPLIT[caption]) {
      const title = inner.findChild((n) => n.name === "title");
      for (const [el, pick] of Object.entries(SPLIT[caption])) {
        const f = asElement(box(el, { fill: "bg/surface", radius: 24, gap: inner.itemSpacing }), el);
        f.appendChild(title.clone());
        for (const k of inner.children.filter(pick)) f.appendChild(k);
        made.push(el);
      }
    } else {
      asElement(inner, caption);
      made.push(caption);
    }
    w.remove();
  }
  root.remove();
}
page.backgrounds = [{ type: "SOLID", color: { r: 0.898, g: 0.898, b: 0.898 } }];
return made;
