// Types of lint-rules.mjs: plain JS so that the Node tools import the same file as the plugin.
export interface LintLayer {
  name: string;
  kind: "frame" | "text" | "icon" | "image" | "shape" | "instance";
  auto?: boolean;
  painted?: boolean;
  padded?: boolean;
  abs?: boolean;
  slot?: boolean;
  optional?: boolean;
  boolProp?: string;
  swapProp?: string;
  kids?: LintLayer[];
}
export interface LintComponent {
  id?: string;
  name: string;
  count?: number;
  kit?: string;
  level?: string;
  free?: boolean;
  axes: Record<string, string[]>;
  props: { name: string; type: string }[];
  variants: LintLayer[];
}
export interface LintIssue {
  rule: string;
  severity: "error" | "warn" | "info";
  component: string;
  at: string;
  detail?: string;
}
export const RULES: Record<string, string>;
export const AXES: Set<string>;
export const DEPTH: Record<string, number>;
export function isCssFragment(word: string): boolean;
export function kitKey(name: string): string;
export function lintComponent(c: LintComponent): LintIssue[];
export function lint(components: LintComponent[]): LintIssue[];
export function summarize(components: LintComponent[], issues: LintIssue[]): {
  components: number;
  errors: number;
  warnings: number;
  infos: number;
  byRule: Record<string, number>;
  clean: number;
};
