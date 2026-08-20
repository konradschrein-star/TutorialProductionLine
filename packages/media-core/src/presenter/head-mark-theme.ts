/**
 * Head-mark theming for the browserless presenter path.
 *
 * `media/style-assets/presenter/mark/head-mark.svg` is drawn with
 * `fill="var(--mark-bg, #1272b0)"` / `stroke="var(--mark-fg, #ffffff)"` so a
 * browser can theme it per subformat and per ground (design §6 / §3.3). There
 * is no browser in the presenter compositor, and no SVG rasteriser honours CSS
 * custom properties that are never declared — every renderer falls back to the
 * literal in the `var()` call.
 *
 * So we resolve the variables to literals in the SVG text before rasterising.
 * Pure string work, unit-tested.
 */

/** Colours the head mark exposes as CSS custom properties. */
export interface HeadMarkTheme {
  /** `--mark-bg`: the disc. */
  markBg: string;
  /** `--mark-fg`: the bars, hook and dot. */
  markFg: string;
}

/** `--mark-bg` / `--mark-fg` — the only variables head-mark.svg declares. */
const THEMEABLE_VARS = ["--mark-bg", "--mark-fg"] as const;

function themeValue(variable: string, theme: HeadMarkTheme): string {
  switch (variable) {
    case "--mark-bg":
      return theme.markBg;
    case "--mark-fg":
      return theme.markFg;
    default:
      throw new Error(
        `[head-mark-theme] unknown themeable variable "${variable}". ` +
          `Only ${THEMEABLE_VARS.join(", ")} are supported.`,
      );
  }
}

/**
 * Replace every `var(--mark-bg, …)` / `var(--mark-fg, …)` in an SVG document
 * with the literal colour from `theme`.
 *
 * A `var()` reference to any other custom property is left untouched: silently
 * rewriting an unknown variable would be a guess.
 *
 * @param svgText Raw contents of the head-mark SVG.
 * @param theme Literal colours to substitute.
 * @returns The SVG text with both variables resolved.
 * @throws Error if `svgText` is empty, if either colour is blank, or if the
 *         document contains no themeable variable at all (that means the asset
 *         changed shape and the caller is about to rasterise something it does
 *         not understand).
 */
export function themeHeadMarkSvg(
  svgText: string,
  theme: HeadMarkTheme,
): string {
  if (svgText.trim().length === 0) {
    throw new Error("[head-mark-theme] themeHeadMarkSvg: svgText is empty.");
  }
  if (theme.markBg.trim().length === 0 || theme.markFg.trim().length === 0) {
    throw new Error(
      `[head-mark-theme] themeHeadMarkSvg: both colours are required, got ` +
        `markBg="${theme.markBg}" markFg="${theme.markFg}".`,
    );
  }

  let replacements = 0;
  // var( --mark-bg , #1272b0 )  — optional whitespace, optional fallback.
  const varPattern = /var\(\s*(--mark-bg|--mark-fg)\s*(?:,[^()]*)?\)/g;
  const themed = svgText.replace(varPattern, (_match, variable: string) => {
    replacements++;
    return themeValue(variable, theme);
  });

  if (replacements === 0) {
    throw new Error(
      "[head-mark-theme] themeHeadMarkSvg: the SVG declares neither --mark-bg nor " +
        "--mark-fg. Either the wrong file was passed, or head-mark.svg was rewritten " +
        "without its theming variables — check media/style-assets/presenter/mark/head-mark.svg.",
    );
  }

  return themed;
}
