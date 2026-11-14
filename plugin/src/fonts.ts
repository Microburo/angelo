// Fonts loaded once per plugin run.
//
// A font loaded with loadFontAsync stays loaded until the plugin closes, so the
// second request for it is a round trip for nothing. A load that throws (font
// missing) is not remembered: the same error comes back on every try.

const loaded = new Set<string>();

export const fontKey = (font: FontName): string => `${font.family}|${font.style}`;

export async function loadFont(font: FontName): Promise<void> {
  const key = fontKey(font);
  if (loaded.has(key)) return;
  await figma.loadFontAsync(font);
  loaded.add(key);
}
