// Line -> tokens.
//
// Token boundaries are the only thing a patch depends on, so they are decided
// here and nowhere else. Two rules do all the work:
//
//   1. a space only separates words at bracket depth 0, outside quotes, so
//      `ov{label:"a, b"}` and `grad.linear(#FFF@0%,#000@100%)` stay whole;
//   2. a token starts at a *known* key, never at "anything with a colon", so a
//      value made of several words — `stroke:1 inside #EBEBEB`,
//      `font:TWK Everett Regular 12`, `grid:cols 12` — absorbs the words that
//      follow it. Closing the vocabulary is what makes that absorption safe.

import {
  ATTACHED_KEYS,
  FLAG_KEYS,
  GREEDY_KEYS,
  HEAD_FLAGS,
  HEAD_KEYS,
  PAIR_KEYS,
  Token,
} from "./types";

export class LexError extends Error {
  constructor(message: string, readonly at: number) {
    super(message);
  }
}

const SIZE = /^-?\d+(\.\d+)?x-?\d+(\.\d+)?$/;

/** Split on spaces that sit at depth 0 and outside a quoted string. */
export function words(text: string): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = [];
  let depth = 0;
  let quoted = false;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === "\\") i++;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      if (start < 0) start = i;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    else if (ch === " " && depth === 0) {
      if (start >= 0) out.push({ text: text.slice(start, i), at: start });
      start = -1;
      continue;
    }
    if (start < 0) start = i;
  }
  if (quoted) throw new LexError("unterminated string", Math.max(start, 0));
  if (depth !== 0) throw new LexError(`unbalanced parentheses (${depth})`, 0);
  if (start >= 0) out.push({ text: text.slice(start), at: start });
  return out;
}

function pairKey(word: string): string | null {
  const colon = word.indexOf(":");
  if (colon <= 0) return null;
  const key = word.slice(0, colon);
  return Object.prototype.hasOwnProperty.call(PAIR_KEYS, key) ? key : null;
}

function attachedKey(word: string): string | null {
  const open = word.search(/[({]/);
  if (open <= 0) return null;
  const key = word.slice(0, open);
  return ATTACHED_KEYS.has(key) ? key : null;
}

/** True when a word begins a token rather than continuing the previous value. */
function startsToken(word: string, greedy: boolean): boolean {
  if (pairKey(word)) return true;
  if (attachedKey(word)) return true;
  // While a greedy value is open, only a known key can close it: a font family
  // or a paint label may otherwise look like a flag ("TWK Row Medium") or a
  // size, and the value is what the writer must get back untouched.
  if (greedy) return false;
  if (FLAG_KEYS.has(word)) return true;
  if (SIZE.test(word)) return true;
  return false;
}

/** Tokens of the part of a node line that follows the quoted name. */
export function tokens(text: string, offset = 0): Token[] {
  const out: Token[] = [];
  let greedy = false;

  for (const word of words(text)) {
    const at = offset + word.at;
    if (!out.length || startsToken(word.text, greedy)) {
      const pair = pairKey(word.text);
      if (pair) {
        out.push({
          key: pair,
          value: word.text.slice(pair.length + 1),
          shape: "pair",
        });
        greedy = GREEDY_KEYS.has(pair);
        continue;
      }
      const attached = attachedKey(word.text);
      if (attached) {
        out.push({
          key: attached,
          value: word.text.slice(attached.length),
          shape: "attached",
        });
        greedy = false;
        continue;
      }
      if (FLAG_KEYS.has(word.text)) {
        out.push({ key: word.text, value: null, shape: "flag" });
        greedy = false;
        continue;
      }
      if (SIZE.test(word.text)) {
        out.push({ key: "", value: word.text, shape: "bare" });
        greedy = false;
        continue;
      }
      throw new LexError(`unknown token "${word.text}"`, at);
    }

    // Continuation of the previous value.
    const last = out[out.length - 1];
    if (last.shape === "flag") {
      throw new LexError(
        `"${word.text}" follows the keyword "${last.key}", which takes no value`,
        at
      );
    }
    last.value = `${last.value} ${word.text}`;
  }
  return out;
}

/** Tokens of the versioned header, whose keys are a vocabulary of their own. */
export function headTokens(text: string, offset = 0): Token[] {
  const out: Token[] = [];
  for (const word of words(text)) {
    const colon = word.text.indexOf(":");
    const key = colon > 0 ? word.text.slice(0, colon) : word.text;
    if (colon > 0 && HEAD_KEYS.has(key)) {
      out.push({ key, value: word.text.slice(colon + 1), shape: "pair" });
      continue;
    }
    if (colon < 0 && HEAD_FLAGS.has(word.text)) {
      out.push({ key: word.text, value: null, shape: "flag" });
      continue;
    }
    throw new LexError(
      `unknown header key "${word.text}"`,
      offset + word.at
    );
  }
  return out;
}

/** The quoted string starting at `from`, decoded. */
export function readQuoted(
  text: string,
  from: number
): { value: string; end: number } {
  if (text[from] !== '"') throw new LexError("string expected", from);
  let out = "";
  for (let i = from + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === "n") out += "\n";
      else if (next === "s") out += " ";
      else if (next === undefined) throw new LexError("empty escape", i);
      else out += next;
      i++;
      continue;
    }
    if (ch === '"') return { value: out, end: i + 1 };
    out += ch;
  }
  throw new LexError("unterminated string", from);
}
