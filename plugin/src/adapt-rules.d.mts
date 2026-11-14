export interface RGB { r: number; g: number; b: number }
export interface ColorToken extends RGB { id?: string; kind: "variable" | "style" | "raw"; name: string; opacity: number }
export interface TextToken { id?: string; name: string; family: string; style: string; size: number }
export interface GridToken { id?: string; name: string; width?: number; grids: readonly any[] }
export function oklab(c: RGB): [number, number, number];
export function colorDistance(a: RGB, b: RGB): number;
export function chroma(c: RGB): number;
export function contrast(a: RGB, b: RGB): number;
export function nearestColor(c: RGB, palette: ColorToken[], ctx?: { was: RGB; on: RGB } | null): { token: ColorToken; dist: number } | null;
export function weightOf(style: string): number;
export function isItalic(style: string): boolean;
export function textDistance(a: { family: string; style: string; size: number }, b: { family: string; style: string; size: number }): number;
export function nearestText(t: { family: string; style: string; size: number }, list: TextToken[]): { token: TextToken; dist: number; far: boolean } | null;
export function nearestGrid(width: number, grids: GridToken[]): GridToken | null;
