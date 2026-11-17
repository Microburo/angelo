// One property fetch per node.
//
// Every property read on a node crosses the plugin sandbox. A read needs the
// same property several times (shared collection, the detail line, the
// fingerprint), so the walk works on a view: a proxy that forwards the first
// access of a property to the node and answers the next ones from memory.
// Output is the same as reading the node directly; only the crossings go away.
// A view lives for one pass (read or expand) and is never kept across a write.

const REAL = Symbol("angelo.real");

/**
 * A caching view of `node`. `children` come back as views too, and a child's
 * `parent` is the view it came from, so the layout mode of a parent is fetched
 * once however many children ask.
 */
export function snapshot<T extends BaseNode>(node: T, parent?: T): T {
  const cache = new Map<string, unknown>();
  const has = new Map<string, boolean>();
  const view: T = new Proxy(node as any, {
    get(target, key) {
      if (key === REAL) return target;
      if (typeof key === "symbol") return Reflect.get(target, key);
      if (cache.has(key)) return cache.get(key);
      let value: any;
      if (key === "parent" && parent) {
        value = parent;
      } else {
        value = target[key];
        if (typeof value === "function") {
          // methods need the real node as `this`
          return (...args: unknown[]) => value.apply(target, args);
        }
        if (key === "children" && Array.isArray(value)) {
          value = value.map((child: BaseNode) => snapshot(child, view));
        }
      }
      cache.set(key, value);
      return value;
    },
    has(target, key) {
      if (typeof key === "symbol") return Reflect.has(target, key);
      let known = has.get(key);
      if (known === undefined) {
        known = Reflect.has(target, key);
        has.set(key, known);
      }
      return known;
    },
  });
  return view;
}

/** The node behind a view (or the node itself when it is not one). */
export function realOf<T>(node: T): T {
  return ((node as any)[REAL] as T) ?? node;
}
