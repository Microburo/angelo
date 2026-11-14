# Fixtures

- `live/` — captured from a real file through `/rpc` (`node tools/capture.mjs page`),
  so the contents are the serializer's own output. Recapture after any change to
  `plugin/src/serialize/`: a diff there is the change, or a regression.
- `edge/` — written by hand, for shapes the captures do not contain (mixed values,
  escaped text, a token the file happens never to use). Never overwrite these with
  a capture.

`node tools/roundtrip.mjs` parses every `.angelo` here and re-emits it: the output must
be identical, and the validator must find nothing.
