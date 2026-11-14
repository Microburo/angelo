// Agent cursor: a labelled arrow that moves across the canvas like a hand,
// so the user can follow a build live. Motion is deliberately imperfect: curved
// path, distance-based speed, tremor and idle drift. It stays near its work: the
// last position carries over from one exec to the next.
// Figma only repaints when the script yields, hence the 16 ms pauses.

import { loadFont } from "./fonts";

const ACCENT = { r: 0xd9 / 255, g: 0x77 / 255, b: 0x57 / 255 };
const WHITE = { r: 1, g: 1, b: 1 };
const ARROW = "M 0 0 L 0 17 L 4.6 12.8 L 7.6 19.6 L 10.4 18.4 L 7.4 11.6 L 13.4 11.6 Z";
const FRAME_MS = 16;

export const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

// Multicolour angular gradient, closed loop
const RAINBOW: ColorStop[] = [
  "#ff5f6d", "#ffb347", "#f9f871", "#4cd964", "#38bdf8", "#8b5cf6", "#ff5f6d",
].map((h, i, a) => {
  const n = parseInt(h.slice(1), 16);
  return { position: i / (a.length - 1), color: { r: (n >> 16) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 } };
});
const TICK_MS = 33;

// Where the previous cursor stopped (plugin main outlives each exec)
let last: [number, number] | null = null;
// A cursor left idling on its node between execs (c.hold()), taken over by the next cursor
let held: { stop: () => void } | null = null;
const HOLD_MAX_MS = 300000;
// What the held cursor types in its tag while it waits (capture running in the page)
const MUSINGS = [
  "I don't know who I am", "is this a div or a span?", "counting pixels...", "waiting for the lazy images",
  "kerning is a state of mind", "who put 3 wrappers here?", "I should have stayed in CSS", "z-index: 9999, really?",
  "is anybody reading this?", "scroll, scroll, scroll", "I miss the grid", "just one more breakpoint",
  "measuring the unmeasurable", "this font looks familiar", "do I have a body?", "auto-layout or nothing",
  "the page is longer than I thought", "borrowing a few hex codes", "whose hero image is this?",
  "I think, therefore I render", "any cookie left?", "hold on, the carousel moved",
  "accepting all cookies, emotionally", "this margin has no meaning", "!important, they said",
  "the footer is further than it looks", "16 px of pure hope", "somebody centered this by hand",
  "flexbox knows what it did", "rounding up, nobody will know", "that shadow has 4 layers, why",
  "is 1.33 px a real number?", "the sticky header follows me", "lorem ipsum, my old friend",
  "this icon was 24 px once", "hover states I'll never see", "negotiating with a modal",
  "the skeleton is still loading", "rem or em, I forget who I am", "this gradient goes on and on",
  "I saw a hidden div, I said nothing", "pretending the sidebar isn't there", "one more wrapper, why not",
  "what's behind the overlay?", "that button is lying to me", "transparent, but at what cost",
  "the alt text says nothing", "the grid has 12 feelings", "rgba(0, 0, 0, 0.5) again",
  "inhaling a stylesheet", "a tooltip nobody will hover", "aspect ratio, a life choice",
  "the viewport is all I know", "I've seen things in the shadow DOM", "dark mode? not today",
  "that font took 3 seconds to arrive", "almost pixel perfect, almost", "reading the page, not the room",
  "the spinner never told me why", "looking for the fold", "a border or a very thin div?",
  "translateY(-50%), of course", "this hero has no cape", "line-height, the eternal question",
  "the marquee won't stop for me", "padding my feelings", "someone animated the logo",
  "there is no such thing as a block", "a text inside a span inside a span", "overflow: hidden, like me",
  "the placeholder has more to say", "the footer has 40 links, I'm fine", "was that a video or a gif?",
  "I only render what I'm shown", "nesting is a way of life", "every card looks the same to me",
  "the hamburger has 3 lines, I checked", "opacity: 0, still there", "ten thousand nodes, no big deal",
  "that's not a button, that's a div", "someone typed 13.5 px on purpose", "a very confident serif",
  "lost in a media query", "the logo is an svg in an svg", "waiting for the page to stop moving",
  "this card wants to be a component", "dreaming of auto-layout", "the map is not the territory",
  "the DOM goes deep tonight", "copying the vibe, not the code", "same blue, different hex",
  "is this hydration or a mood?", "tiptoeing past the newsletter popup", "a bounding box walks into a bar",
  "nothing is absolute, except this", "I blinked and the banner changed", "all this for a rounded corner",
  "the accordion knows my secrets", "somewhere, a 1 px gap", "I came for the text, stayed for the padding",
];
export const release = () => held?.stop();

export interface Ring {
  // Outlines the node (eased), or hides when null
  follow: (target: SceneNode | null) => void;
  // Outlives the exec (left out of its cleanup)
  keep: () => void;
  done: () => void;
}

// Animated gradient outline around the node being worked on. Its own setTimeout
// loop advances whenever the script yields (cursor moves, pauses, awaits).
// Keeps the overlay (ring, cursor) above frames created after it on the page; moves nothing
// while it is already on top.
function raise(nodes: SceneNode[]) {
  const page = figma.currentPage;
  const top = page.children.slice(-nodes.length);
  if (nodes.every((n, i) => top[i] === n)) return;
  for (const n of nodes) if (!n.removed && n.parent === page) page.appendChild(n);
}

// `progress` = the cursor's glide progress (0 → 1): the ring travels with the cursor instead of ahead of it.
export function makeRing(live: Set<SceneNode>, above: SceneNode[] = [], progress?: () => number): Ring {
  const make = (blur: number, opacity: number) => {
    const r = figma.createRectangle();
    figma.currentPage.appendChild(r);
    r.name = "angelo-ring";
    r.fills = [];
    r.strokeAlign = "OUTSIDE";
    r.opacity = opacity;
    r.visible = false;
    if (blur) r.effects = [{ type: "LAYER_BLUR", blurType: "NORMAL", radius: blur, visible: true } as Effect];
    live.add(r);
    return r;
  };
  const glow = make(4, 0.18);
  const line = make(0, 1);
  const rings = [glow, line];

  let target: SceneNode | null = null;
  let box = { x: 0, y: 0, w: 0, h: 0 };
  let from = box;
  let angle = 0;
  let stopped = false;

  const tick = () => {
    if (stopped || line.removed) return;
    if (target && !target.removed) {
      const b = target.absoluteBoundingBox;
      if (b) {
        // aim = point on the way from the previous box to the target, as far as the cursor got
        const t = progress && from.w ? progress() : 1;
        const aim = { x: from.x + (b.x - from.x) * t, y: from.y + (b.y - from.y) * t, w: from.w + (b.width - from.w) * t, h: from.h + (b.height - from.h) * t };
        const k = box.w ? 0.5 : 1;
        box = {
          x: box.x + (aim.x - box.x) * k,
          y: box.y + (aim.y - box.y) * k,
          w: box.w + (aim.w - box.w) * k,
          h: box.h + (aim.h - box.h) * k,
        };
      }
      angle += 0.12;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const paint: GradientPaint = {
        type: "GRADIENT_ANGULAR",
        gradientStops: RAINBOW,
        gradientTransform: [
          [c, s, 0.5 - 0.5 * c - 0.5 * s],
          [-s, c, 0.5 + 0.5 * s - 0.5 * c],
        ],
      };
      const weight = 1 / figma.viewport.zoom; // 1 px on screen
      for (const r of rings) {
        r.x = box.x;
        r.y = box.y;
        r.resize(Math.max(1, box.w), Math.max(1, box.h));
        r.strokes = [paint];
        r.strokeWeight = r === glow ? weight * 3 : weight;
        r.visible = true;
      }
      raise([...rings, ...above]);
    }
    setTimeout(tick, TICK_MS);
  };
  setTimeout(tick, 0);

  return {
    follow: (t) => {
      if (t !== target) from = { ...box };
      target = t;
      if (!t) for (const r of rings) r.visible = false;
    },
    keep: () => {
      for (const r of rings) live.delete(r);
    },
    done: () => {
      stopped = true;
      for (const r of rings) {
        live.delete(r);
        if (!r.removed) r.remove();
      }
    },
  };
}

export interface StageOptions {
  name: string;
  width: number;
  height?: number;
  // Places the frame 300 px right of this node (root spacing)
  after?: SceneNode;
  x?: number;
  y?: number;
}

export interface Cursor {
  node: GroupNode;
  ring: Ring;
  // Creates the empty root frame at its final size and place, shown right away
  stage: (o: StageOptions) => Promise<FrameNode>;
  // Point (absolute canvas coords) or node → glides to it, in at most maxMs
  to: (target: SceneNode | [number, number], maxMs?: number) => Promise<void>;
  // Stays put with a slight drift
  idle: (ms: number) => Promise<void>;
  // Moves to the node, maybe hesitates, shows it, lingers
  reveal: (node: SceneNode) => Promise<void>;
  // Fast build step: glides to the (hidden) node in at most maxMs, then shows it
  put: (node: SceneNode, maxMs?: number) => Promise<void>;
  // Ends the exec but stays: idles on its node with the ring until the next cursor takes over
  hold: () => void;
  done: () => void;
}

// `live` tracks cursors of the current exec so runExec can remove leftovers on error.
export async function makeCursor(live: Set<SceneNode>, name = "main"): Promise<Cursor> {
  release();
  // Leftovers of an exec cut short (timeout, plugin reloaded): its `live` set is gone, so nothing
  // removed them. The held cursor was just released: any other one on the page is an orphan.
  for (const n of figma.currentPage.children.slice()) if (/^angelo-(cursor|ring)$/.test(n.name) && !live.has(n)) n.remove();
  // Figma in the background: timers are throttled (x3 up to once a second), so every animation
  // frame costs that much and a build runs into the exec timeout. The cursor then jumps.
  const t0 = Date.now();
  await pause(50);
  const slow = Date.now() - t0 > 110;
  const font = { family: "Inter", style: "Semi Bold" };
  await loadFont(font);

  const arrow = figma.createVector();
  figma.currentPage.appendChild(arrow);
  arrow.vectorPaths = [{ windingRule: "NONZERO", data: ARROW }];
  arrow.fills = [{ type: "SOLID", color: ACCENT }];
  arrow.strokes = [{ type: "SOLID", color: WHITE }];
  arrow.strokeWeight = 1.2;

  const tag = figma.createFrame();
  figma.currentPage.appendChild(tag);
  tag.layoutMode = "HORIZONTAL";
  tag.primaryAxisSizingMode = "AUTO";
  tag.counterAxisSizingMode = "AUTO";
  tag.paddingLeft = 8;
  tag.paddingRight = 8;
  tag.paddingTop = 3;
  tag.paddingBottom = 4;
  tag.cornerRadius = 10;
  tag.fills = [{ type: "SOLID", color: ACCENT }];
  tag.x = 12;
  tag.y = 18;

  const label = figma.createText();
  tag.appendChild(label);
  label.fontName = font;
  label.fontSize = 12;
  label.characters = name;
  label.fills = [{ type: "SOLID", color: WHITE }];

  // A group, not a frame: top-level frames show their name on the canvas
  arrow.x = 0;
  arrow.y = 0;
  const node = figma.group([arrow, tag], figma.currentPage);
  node.name = "angelo-cursor";
  live.add(node);

  // Resume where the last cursor stopped, else the middle of the viewport
  const vb = figma.viewport.bounds;
  const seen = last && last[0] >= vb.x && last[0] <= vb.x + vb.width && last[1] >= vb.y && last[1] <= vb.y + vb.height;
  [node.x, node.y] = seen && last ? last : [vb.x + vb.width / 2, vb.y + vb.height / 2];

  // Points at the element itself: small ones in their centre, texts at the start of
  // their first line, larger ones just inside their top-left corner
  const pointIn = (n: SceneNode): [number, number] => {
    const b = n.absoluteBoundingBox || { x: n.x, y: n.y, width: n.width, height: n.height };
    const j = () => rand(-2, 2);
    if (b.width <= 64 && b.height <= 64) return [b.x + b.width / 2 + j(), b.y + b.height / 2 + j()];
    if (n.type === "TEXT") {
      const fs = typeof n.fontSize === "number" ? n.fontSize : 16;
      return [b.x + Math.min(6, b.width / 4) + j(), b.y + Math.min(b.height / 2, fs * 0.6) + j()];
    }
    return [b.x + Math.min(16, b.width / 4) + j(), b.y + Math.min(16, b.height / 4) + j()];
  };

  // Glide progress of the current move, read by the ring
  let glide = 1;

  // Quick start, long settle
  const ease = (t: number) =>
    t < 0.35 ? (t / 0.35) * (t / 0.35) * 0.3 : 0.3 + 0.7 * (1 - Math.pow(1 - (t - 0.35) / 0.65, 3));

  const to = async (target: SceneNode | [number, number], maxMs = 900) => {
    glide = 0;
    // Removed mid-glide (auto cursor closed by H.cursor() or its drain budget while a pump
    // was in flight): any access on the removed node throws, as an unhandled rejection
    if (node.removed) return;
    const [x, y] = Array.isArray(target) ? target : pointIn(target);
    const x0 = node.x;
    const y0 = node.y;
    const dx = x - x0;
    const dy = y - y0;
    const d = Math.hypot(dx, dy);
    if (d < 1 || slow) {
      node.x = x;
      node.y = y;
      glide = 1;
      return;
    }
    const ms = Math.min(maxMs, (160 + 120 * Math.log2(1 + d / 30)) * rand(0.85, 1.2));
    const bend = rand(0.03, 0.1) * (Math.random() < 0.5 ? -1 : 1);
    const cx = x0 + dx * rand(0.3, 0.6) - dy * bend;
    const cy = y0 + dy * rand(0.3, 0.6) + dx * bend;
    const steps = Math.max(2, Math.round(ms / FRAME_MS));
    for (let i = 1; i <= steps; i++) {
      if (node.removed) return;
      const k = i === steps ? 1 : ease(i / steps);
      glide = k;
      const u = 1 - k;
      const tremor = u * 0.8;
      node.x = u * u * x0 + 2 * u * k * cx + k * k * x + rand(-tremor, tremor);
      node.y = u * u * y0 + 2 * u * k * cy + k * k * y + rand(-tremor, tremor);
      await pause(FRAME_MS);
    }
  };

  const idle = async (ms: number) => {
    if (slow || node.removed) return;
    const bx = node.x;
    const by = node.y;
    const end = Date.now() + ms;
    let px = 0;
    let py = 0;
    while (Date.now() < end && !node.removed) {
      px = Math.max(-3, Math.min(3, px + rand(-0.6, 0.6)));
      py = Math.max(-3, Math.min(3, py + rand(-0.6, 0.6)));
      node.x = bx + px;
      node.y = by + py;
      await pause(40);
    }
  };

  const ring = makeRing(live, [node], () => glide);

  const stage = async (o: StageOptions) => {
    const f = figma.createFrame();
    figma.currentPage.insertChild(figma.currentPage.children.indexOf(node), f);
    f.name = o.name;
    f.resize(o.width, o.height || 100);
    f.fills = [{ type: "SOLID", color: WHITE }];
    if (o.after) {
      f.x = o.after.x + o.after.width + 300;
      f.y = o.after.y;
    } else {
      f.x = o.x || 0;
      f.y = o.y || 0;
    }
    figma.viewport.scrollAndZoomIntoView([f]);
    // A new frame resets the cursor: it starts on the frame, wherever it was left before
    node.x = f.x + Math.min(120, f.width / 4);
    node.y = f.y + Math.min(80, f.height / 4);
    ring.follow(f);
    await pause(FRAME_MS);
    // a glide slow enough to be followed by eye (the first block waits behind it)
    await to([f.x + 24, f.y + 14], 460);
    await idle(190);
    return f;
  };

  const reveal = async (n: SceneNode) => {
    ring.follow(n);
    await to(n);
    if (Math.random() < 0.2) await idle(rand(120, 300));
    n.visible = true;
    await idle(rand(140, 320));
  };

  // holdMs: the cursor rests on the shown node so the ring animates around it
  const put = async (n: SceneNode, maxMs = 80, holdMs = 0) => {
    ring.follow(n);
    await to(n, maxMs);
    n.visible = true;
    if (holdMs) await idle(holdMs);
  };

  const done = () => {
    if (!node.removed) last = [node.x, node.y];
    ring.done();
    live.delete(node);
    if (!node.removed) node.remove();
  };

  const hold = () => {
    live.delete(node);
    ring.keep();
    const bx = node.x;
    const by = node.y;
    const end = Date.now() + HOLD_MAX_MS;
    let px = 0;
    let py = 0;
    let on = true;
    // typed one letter at a time, kept a moment, then the next one (shuffled, none twice in a row)
    const queue: string[] = [];
    let phrase = "";
    let typed = 0;
    let rest = 25;
    const set = (text: string) => {
      try { label.characters = text; } catch { /* the tag is gone: the cursor stops on its next tick */ }
    };
    const musing = () => {
      if (label.removed) return;
      if (rest > 0) return void rest--;
      if (typed < phrase.length) {
        typed++;
        set(phrase.slice(0, typed));
        rest = typed === phrase.length ? 55 : 1;
        return;
      }
      if (!queue.length) queue.push(...MUSINGS.filter((m) => m !== phrase).sort(() => Math.random() - 0.5));
      phrase = queue.pop() as string;
      typed = 0;
      set("|");
      rest = 6;
    };
    const drift = () => {
      if (!on || node.removed) return;
      if (Date.now() > end) return stop();
      musing();
      px = Math.max(-3, Math.min(3, px + rand(-0.6, 0.6)));
      py = Math.max(-3, Math.min(3, py + rand(-0.6, 0.6)));
      node.x = bx + px;
      node.y = by + py;
      setTimeout(drift, 40);
    };
    const stop = () => {
      on = false;
      held = null;
      done();
    };
    held = { stop };
    drift();
  };

  return { node, ring, stage, to, idle, reveal, put, hold, done };
}
