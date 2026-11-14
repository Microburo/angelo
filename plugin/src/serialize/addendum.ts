// Expanding a chunk can surface variables, styles or components the manifest
// did not carry (library references). Those are appended to the chunk so the
// legend stays self-sufficient.

import { quote, slug } from "./format";
import { Legend } from "./legend";
import { valueToken } from "./manifest";

export interface Known {
  vars: Set<string>;
  styles: Set<string>;
  components: Set<string>;
}

export function snapshot(legend: Legend): Known {
  return {
    vars: new Set(legend.vars.keys()),
    styles: new Set(legend.styles.keys()),
    components: new Set(legend.components.keys()),
  };
}

/** Aliases stay raw ids in an addendum: the target may not be in the legend. */
const noLabel = (): null => null;

export async function renderAddendum(
  legend: Legend,
  known: Known
): Promise<string> {
  const sections: string[] = [];

  const newVars = Array.from(legend.vars.values()).filter(
    (entry) => !known.vars.has(entry.id)
  );
  if (newVars.length) {
    const lines = ["# vars+"];
    for (const entry of newVars) {
      const variable = entry.variable;
      let collection: VariableCollection | null = null;
      try {
        collection = await figma.variables.getVariableCollectionByIdAsync(
          variable.variableCollectionId
        );
      } catch {
        collection = null;
      }
      const modes = collection ? collection.modes : [];
      const values = Object.keys(variable.valuesByMode).map((modeId) => {
        const mode = modes.filter((item) => item.modeId === modeId)[0];
        const token = valueToken(variable.valuesByMode[modeId], variable.resolvedType, noLabel);
        return mode && modes.length > 1 ? `${slug(mode.name)}:${token}` : token;
      });
      lines.push(`${entry.label} = ${values.join(" | ")}`);
    }
    sections.push(lines.join("\n"));
  }

  const newStyles = Array.from(legend.styles.values()).filter(
    (entry) => !known.styles.has(entry.id)
  );
  if (newStyles.length) {
    const lines = ["# styles+"];
    for (const entry of newStyles) {
      lines.push(`${entry.label} = ${quote(entry.style.name)}${entry.remote ? " lib" : ""}`);
    }
    sections.push(lines.join("\n"));
  }

  const newComponents = Array.from(legend.components.values()).filter(
    (entry) => !known.components.has(entry.id)
  );
  if (newComponents.length) {
    const lines = ["# cmp+"];
    for (const entry of newComponents) {
      lines.push(`${entry.label} = ${quote(entry.name)}${entry.remote ? " lib" : ""}`);
    }
    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n");
}
