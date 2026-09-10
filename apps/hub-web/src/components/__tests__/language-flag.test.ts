import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const source = readFileSync(new URL("../language-flag.tsx", import.meta.url), "utf8");
it.each(["en", "de", "fr", "it", "sv"])("defines a vector flag for %s", language => {
  expect(source).toContain(`case "${language}":`);
});
it("keeps vector flags decorative, unfocusable, fixed-size and free of external assets", () => {
  expect(source).toContain('width="20" height="14"');
  expect(source).toContain('aria-hidden="true" focusable="false"');
  expect(source).not.toMatch(/<img|href=|<title|role="img"/);
  expect(source).toContain('return fallback ? <span aria-hidden="true">{fallback}</span> : null');
});
