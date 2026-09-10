import type { ThumbnailLayout } from "./layout-document";

export interface SoftwareLogo {
  name: string;
  url: string;
}
const words = (value: string) =>
  value
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const ASSET_SUFFIXES = new Set([
  "logo",
  "symbol",
  "icon",
  "mark",
  "badge",
  "png",
  "image",
]);
function assetSubject(value: string): string {
  const tokens = words(value).split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && ASSET_SUFFIXES.has(tokens[tokens.length - 1]!))
    tokens.pop();
  return tokens.join(" ");
}

/** Exact token boundaries avoid matching R in Chrome or Teams in Steam.
 * Longest software name wins; callers supply newest assets first for revisions. */
export function findSoftwareLogo(
  title: string,
  assets: SoftwareLogo[],
): SoftwareLogo | null {
  const text = ` ${words(title)} `;
  return (
    assets
      .filter(
        (asset) =>
          assetSubject(asset.name) &&
          text.includes(` ${assetSubject(asset.name)} `),
      )
      .sort(
        (a, b) => assetSubject(b.name).length - assetSubject(a.name).length,
      )[0] ?? null
  );
}

/** Only explicitly auto-managed layers change. Legacy layouts and deliberate
 * manual logos are preserved, as are approved images and locale overrides. */
export function applySoftwareLogo<
  T extends ThumbnailLayout["elements"][number],
>(
  elements: T[],
  url: string | null | undefined,
  protectedLayout: boolean,
): T[] {
  if (!url || protectedLayout) return elements;
  return elements.map((layer) =>
    layer.type === "LOGO" && layer.autoLogo === true
      ? { ...layer, url }
      : layer,
  );
}
