import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

// ---------------------------------------------------------------------------
// Guard against the regression that killed subtitle previews twice: a SECOND
// copy of `remotion` getting bundled, so <Captions> binds to a different module
// instance than <Player> and useCurrentFrame() throws. The fix is the
// resolve.alias in next.config.js. This test fails loudly the moment someone
// removes the alias (or switches to turbopack, which ignores it) — cheap
// insurance for the whole class of "blank preview" bugs.
//
// `react`/`react-dom` are deliberately NOT aliased (a blanket alias breaks Next
// 15 RSC export conditions — see the comment in next.config.js), so they are not
// asserted here.
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);

describe("next.config webpack single-instance alias", () => {
  it("pins remotion to one physical copy", async () => {
    const mod = await import("../../../../next.config.js");
    const nextConfig = mod.default as {
      webpack: (c: { resolve?: { alias?: Record<string, string> } }) => {
        resolve: { alias: Record<string, string> };
      };
    };
    expect(typeof nextConfig.webpack).toBe("function");

    const out = nextConfig.webpack({});
    const alias = out.resolve.alias;

    expect(alias["remotion"], "alias for remotion is missing").toBeTruthy();
    const expected = path.dirname(require.resolve("remotion/package.json"));
    expect(alias["remotion"]).toBe(expected);
  });
});
