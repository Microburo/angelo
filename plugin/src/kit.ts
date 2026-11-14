// What a component of the kit is made of (level, heights, axes, props, slots), embedded at build time from
// grammar/shadcn: structure only, the site or the design brings the values.

import table from "virtual:kit";

export interface KitComponent {
  name: string;
  level: string;
  heights?: number[];
  axes: Record<string, string[]>;
  props: Record<string, string>;
  slots: { name: string; t: string }[];
}

let parsed: Map<string, KitComponent> | null = null;
const all = (): Map<string, KitComponent> => {
  if (!parsed) {
    const list = JSON.parse(table) as KitComponent[];
    parsed = new Map(list.map((c) => [c.name.toLowerCase(), c]));
  }
  return parsed;
};

// One component by name (case ignored), null if the kit has no such name.
export const kitComponent = (name: string): KitComponent | null => all().get(name.trim().toLowerCase()) || null;

// H.kit("Button") → that component · H.kit() → every name with its level.
export const kit = (name?: string): KitComponent | { name: string; level: string }[] | null =>
  name === undefined
    ? Array.from(all().values()).map((c) => ({ name: c.name, level: c.level }))
    : kitComponent(name);
