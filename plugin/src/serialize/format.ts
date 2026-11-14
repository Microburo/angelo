// Low-level Angelo text primitives: numbers, colors, names, quoting.

export const ANGELO_VERSION = "angelo/1";

/** 12.004 -> "12", 12.5 -> "12.5" (2 decimals max, no trailing zeros). */
export function num(value: number): string {
  if (!isFinite(value)) return "0";
  const rounded = Math.round(value * 100) / 100;
  return String(rounded === 0 ? 0 : rounded);
}

export function pct(value: number): string {
  return num(Math.round(value * 1000) / 10);
}

function channel(value: number): string {
  const hex = Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16);
  return hex.length === 1 ? "0" + hex : hex;
}

/** #RGB when it collapses, #RRGGBB otherwise, #RRGGBBAA when opacity < 1. */
export function hex(color: RGB | RGBA, opacity?: number): string {
  const r = channel(color.r);
  const g = channel(color.g);
  const b = channel(color.b);
  const a = opacity === undefined ? ("a" in color ? color.a : 1) : opacity;
  let out = r + g + b;
  if (r[0] === r[1] && g[0] === g[1] && b[0] === b[1]) out = r[0] + g[0] + b[0];
  if (a < 0.999) out += channel(a);
  return "#" + out.toUpperCase();
}

/** "Surface / Default bg" -> "surface.default-bg" */
export function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s*\/\s*/g, ".")
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

/** Quoted string, newlines kept escaped so a node always sits on one line. */
export function quote(text: string): string {
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/[\u2028\u2029]/g, "\\n")
    .replace(/\u00a0/g, "\\s");
  return '"' + escaped + '"';
}

export function indent(depth: number): string {
  return "  ".repeat(depth);
}

export class Lines {
  private readonly parts: string[] = [];

  push(line: string): void {
    this.parts.push(line);
  }

  toString(): string {
    return this.parts.join("\n");
  }
}
