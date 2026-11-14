// The Angelo grammar, as one module: types, lexer, parser, emitter, validator.
//
// Pure — no Figma globals — so the plugin, the roundtrip test and verify all
// read the same grammar from the same source.

export * from "./types";
export { LexError, headTokens, readQuoted, tokens, words } from "./lex";
export { ParseError, nodesOf, parse, tokensOf } from "./parse";
export { emit, emitNodeHead, emitToken, quote } from "./emit";
export { Problem, checkProps, validate } from "./validate";
export { fnv1a } from "./hash";
