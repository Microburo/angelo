// Legend: every variable / style / component referenced in a read gets a short
// stable name (c.surface.default, t.body, cmp.button) instead of an opaque id.
// Resolution is lazy and cached, so the walk can ask for a name inline.

import { slug } from "./format";

const VAR_PREFIX: Record<string, string> = {
  COLOR: "c",
  FLOAT: "n",
  STRING: "s",
  BOOLEAN: "b",
};

const STYLE_PREFIX: Record<string, string> = {
  PAINT: "p",
  TEXT: "t",
  EFFECT: "e",
  GRID: "g",
};

export interface VarEntry {
  id: string;
  label: string;
  variable: Variable;
  collection: VariableCollection | null;
  remote: boolean;
}

export interface StyleEntry {
  id: string;
  label: string;
  style: BaseStyle;
  remote: boolean;
}

export interface CmpEntry {
  id: string;
  label: string;
  name: string;
  /** COMPONENT_SET when the component is a variant, else the component itself. */
  owner: ComponentNode | ComponentSetNode;
  remote: boolean;
}

export class Legend {
  readonly vars = new Map<string, VarEntry>();
  readonly styles = new Map<string, StyleEntry>();
  readonly components = new Map<string, CmpEntry>();
  readonly fonts = new Set<string>();

  private readonly taken = new Set<string>();
  private readonly missing = new Set<string>();
  private localsLoaded = false;

  /**
   * Register every local variable and style (all-locals manifest, or a write
   * naming a label the focused read did not show). Idempotent.
   */
  async registerLocals(maxVariables = Infinity, maxStyles = Infinity): Promise<void> {
    if (this.localsLoaded) return;
    this.localsLoaded = true;
    try {
      const locals = await figma.variables.getLocalVariablesAsync();
      for (const variable of locals.slice(0, maxVariables)) this.addVariable(variable);
    } catch {
      // variables unavailable: referenced ones still resolve lazily
    }
    try {
      const [paints, texts, effects, grids] = await Promise.all([
        figma.getLocalPaintStylesAsync(),
        figma.getLocalTextStylesAsync(),
        figma.getLocalEffectStylesAsync(),
        figma.getLocalGridStylesAsync(),
      ]);
      const all: BaseStyle[] = [...texts, ...paints, ...effects, ...grids];
      for (const style of all.slice(0, maxStyles)) this.addStyle(style);
    } catch {
      // local styles unavailable (e.g. restricted file)
    }
  }

  /** Every label handed out so far (variables, styles, components). */
  hasLabel(label: string): boolean {
    return this.taken.has(label);
  }

  private unique(base: string): string {
    if (!this.taken.has(base)) {
      this.taken.add(base);
      return base;
    }
    for (let i = 2; ; i++) {
      const candidate = `${base}-${i}`;
      if (!this.taken.has(candidate)) {
        this.taken.add(candidate);
        return candidate;
      }
    }
  }

  async variable(id: string): Promise<string | null> {
    const known = this.vars.get(id);
    if (known) return known.label;
    if (this.missing.has(id)) return null;
    let variable: Variable | null = null;
    try {
      variable = await figma.variables.getVariableByIdAsync(id);
    } catch {
      variable = null;
    }
    if (!variable) {
      this.missing.add(id);
      return null;
    }
    return this.addVariable(variable);
  }

  addVariable(variable: Variable): string {
    const known = this.vars.get(variable.id);
    if (known) return known.label;
    const prefix = VAR_PREFIX[variable.resolvedType] ?? "v";
    const label = this.unique(`${prefix}.${slug(variable.name)}`);
    this.vars.set(variable.id, {
      id: variable.id,
      label,
      variable,
      collection: null,
      remote: variable.remote,
    });
    return label;
  }

  async style(id: string): Promise<string | null> {
    if (!id) return null;
    const known = this.styles.get(id);
    if (known) return known.label;
    if (this.missing.has(id)) return null;
    let style: BaseStyle | null = null;
    try {
      style = await figma.getStyleByIdAsync(id);
    } catch {
      style = null;
    }
    if (!style) {
      this.missing.add(id);
      return null;
    }
    return this.addStyle(style);
  }

  addStyle(style: BaseStyle): string {
    const known = this.styles.get(style.id);
    if (known) return known.label;
    const prefix = STYLE_PREFIX[style.type] ?? "y";
    const label = this.unique(`${prefix}.${slug(style.name)}`);
    this.styles.set(style.id, {
      id: style.id,
      label,
      style,
      remote: style.remote,
    });
    return label;
  }

  component(component: ComponentNode): string {
    const owner =
      component.parent && component.parent.type === "COMPONENT_SET"
        ? (component.parent as ComponentSetNode)
        : component;
    const known = this.components.get(owner.id);
    if (known) return known.label;
    const label = this.unique(`cmp.${slug(owner.name)}`);
    this.components.set(owner.id, {
      id: owner.id,
      label,
      name: owner.name,
      owner,
      remote: owner.remote === true,
    });
    return label;
  }

  font(font: FontName): void {
    this.fonts.add(`${font.family} ${font.style}`);
  }
}
