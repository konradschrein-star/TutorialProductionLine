import { describe, it, expect } from "vitest";
import { parseRankingScript } from "../ranking/ranking-analysis.js";

describe("parseRankingScript", () => {
  it("parses a well-formed LLM response", () => {
    const llmResponse = `
\`\`\`json
{
  "placements": [
    { "itemId": "i1", "tierIndex": 4, "revealOrder": 0 },
    { "itemId": "i2", "tierIndex": 2, "revealOrder": 1 },
    { "itemId": "i3", "tierIndex": 0, "revealOrder": 2 }
  ],
  "targetRuntimeSeconds": 360
}
\`\`\`

Today we're ranking smartphones. Let's start with the worst — the i1.
It's a disaster. Moving on, i2 is fine. And the winner, i3, is incredible.
`.trim();

    const plan = parseRankingScript(llmResponse, ["i1", "i2", "i3"]);
    expect(plan.placements).toHaveLength(3);
    expect(plan.placements[0]).toMatchObject({
      itemId: "i1",
      tierIndex: 4,
      revealOrder: 0,
    });
    expect(plan.targetRuntimeSeconds).toBe(360);
    expect(plan.scriptText).toContain("Today we're ranking smartphones");
    expect(plan.scriptText).not.toContain("`json");
  });

  it("throws when JSON block is missing", () => {
    expect(() => parseRankingScript("just a script", ["i1"])).toThrow(
      /JSON block/i,
    );
  });

  it("throws when a placement references an unknown itemId", () => {
    const llmResponse = `\`\`\`json
{ "placements": [{ "itemId": "ghost", "tierIndex": 0, "revealOrder": 0 }], "targetRuntimeSeconds": 60 }
\`\`\`
script body`;
    expect(() => parseRankingScript(llmResponse, ["i1", "i2"])).toThrow(
      /unknown itemId.*ghost/i,
    );
  });

  it("throws when placements is empty", () => {
    const llmResponse = `\`\`\`json
{ "placements": [], "targetRuntimeSeconds": 60 }
\`\`\`
script body`;
    expect(() => parseRankingScript(llmResponse, ["i1"])).toThrow(
      /at least one placement/i,
    );
  });
});
