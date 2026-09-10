/** Scoped static regression checks; visual acceptance still requires browser QA. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const root="apps/hub-web/src/app/(authenticated)/tutorial-studio/_components/";
for(const file of ["studio.tsx","create.tsx","keywords.tsx","my-work.tsx"]) {
  const source=await readFile(root+file,"utf8");
  assert.doesNotMatch(source,/rgba\(255,\s*255,\s*255,/ ,`${file}: hardcoded white neutral surfaces`);
  assert.doesNotMatch(source,/color:\s*["']#(?:fff|ffffff|888|9ca3af)["']/i,`${file}: hardcoded neutral text`);
  assert.doesNotMatch(source,/background:\s*["']rgba\(0,0,0,0\.3\)["']/ ,`${file}: dark UI surface`);
  assert.ok(source.includes("var(--v2-text-2)"));
}
const studio=await readFile(root+"studio.tsx","utf8");
assert.equal((studio.match(/background: "#000"/g)??[]).length,4,"Keep intentional audio/video backgrounds black");
assert.ok(studio.includes('barColor = `rgb('),"Preserve continuous recording timing visualizer");
console.log(JSON.stringify({scopedFiles:4,neutralSurfacesTokenized:true,intentionalMediaBackgroundsPreserved:true,visualBrowserAcceptancePending:true}));
