// Checks of the token matching behind H.adapt, on a small made-up design system, without Figma.
import { nearestColor, nearestGrid, nearestText, weightOf } from "../plugin/src/adapt-rules.mjs";

const rgb = (hex) => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });
const token = (name, hex, kind = "style") => ({ name, kind, opacity: 1, ...rgb(hex) });
const palette = [token("ink", "#111111"), token("ivory", "#F4EFE6"), token("gold", "#B08D57"), token("white", "#FFFFFF")];
const type = [
  { name: "Display", family: "Baton", style: "Regular", size: 64 },
  { name: "Title", family: "Baton", style: "Regular", size: 32 },
  { name: "Body", family: "Söhne", style: "Regular", size: 16 },
  { name: "Body strong", family: "Söhne", style: "Medium", size: 16 },
  { name: "Caption", family: "Söhne", style: "Regular", size: 12 },
];

const cases = [
  ["near black goes to ink", nearestColor(rgb("#1A1A1A"), palette).token.name, "ink"],
  ["warm off-white goes to ivory", nearestColor(rgb("#F7F3EC"), palette).token.name, "ivory"],
  ["pure white stays white", nearestColor(rgb("#FFFFFF"), palette).token.name, "white"],
  ["ochre goes to gold", nearestColor(rgb("#C9A227"), palette).token.name, "gold"],
  ["mid grey stays neutral, not gold", nearestColor(rgb("#8A8F98"), palette).token.name, "ivory"],
  ["grey text on black stays readable", nearestColor(rgb("#62666D"), palette, { was: rgb("#08090A"), on: rgb("#111111") }).token.name, "ivory"],
  ["the same grey without context goes dark", nearestColor(rgb("#62666D"), palette).token.name, "ink"],
  ["a card barely off its background may merge", nearestColor(rgb("#23252A"), palette, { was: rgb("#08090A"), on: rgb("#111111") }).token.name, "ink"],
  ["same color: variable over style", nearestColor(rgb("#111111"), [token("s", "#111111"), token("v", "#111111", "variable")]).token.name, "v"],
  ["15 px regular reads as body", nearestText({ family: "Inter", style: "Regular", size: 15 }, type).token.name, "Body"],
  ["15 px semibold reads as body strong", nearestText({ family: "Inter", style: "SemiBold", size: 15 }, type).token.name, "Body strong"],
  ["56 px headline reads as display", nearestText({ family: "Inter", style: "Bold", size: 56 }, type).token.name, "Display"],
  ["36 px headline reads as title", nearestText({ family: "Inter", style: "Bold", size: 36 }, type).token.name, "Title"],
  ["56 px bold headline with 32 px at most keeps its own text", nearestText({ family: "Inter", style: "Bold", size: 56 }, type.slice(1)).far, true],
  ["28 px serif snaps to a 32 px title", nearestText({ family: "Empirica", style: "Regular", size: 28 }, type).far, false],
  ["11 px label reads as caption", nearestText({ family: "Inter", style: "Medium", size: 11 }, type).token.name, "Caption"],
  ["weight of Extra Bold", weightOf("Extra Bold"), 800],
  ["weight of Light Italic", weightOf("Light Italic"), 300],
  ["grid nearest in width", nearestGrid(1440, [{ name: "mobile", width: 390, grids: [] }, { name: "desktop", width: 1512, grids: [] }]).name, "desktop"],
];

let failed = 0;
for (const [label, got, want] of cases) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : ` : ${got}, expected ${want}`}`);
}
console.log(`${cases.length - failed}/${cases.length}`);
process.exit(failed ? 1 : 0);
