// In-place patch: Checkbox and Radio element frames grouped into one "Checkbox · Radio" frame
// (shared Checked × State title, checkbox row then radio row); the Radio frame removed.
const cb = elements().find((n) => n.name === "Checkbox");
const ra = elements().find((n) => n.name === "Radio");
if (!cb || !ra) return { skipped: true };
cb.name = "Checkbox · Radio";
cb.appendChild(ra.findChild((n) => n.name === "radio"));
ra.remove();
return { children: cb.children.map((n) => n.name) };
