// SCRATCH — P1 tracer. Not shipped code. Drives BUSINESS_PLAN_HUB script gen only.
import { config as dotenvConfig } from "dotenv";
import path from "node:path";
import { writeFile } from "node:fs/promises";

dotenvConfig({ path: path.resolve(process.cwd(), "../../.env") });

const { loadConfig } = await import("@repo/config");
loadConfig();

const { generateBusinessHubScript, toPlannableScript } = await import(
  "../src/processors/business-hub/script.js"
);

const topic = "How to write a business plan for a bakery";

const result = await generateBusinessHubScript({
  topic,
  family: "how-to-write-for",
  targetMinutes: 4,
  chapterMinutes: 2,
  title: "How To Write A Business Plan For A Bakery",
});

console.log("word count:", result.wordCount);
console.log("chapters:", result.chapters.length);
console.log("sources:", result.sources.length);

const plannable = toPlannableScript(result);
const out = path.resolve(process.cwd(), "tmp-p1");
await writeFile(path.join(out, "script-raw.json"), JSON.stringify(result, null, 2), "utf8");
await writeFile(path.join(out, "script-plannable.txt"), plannable, "utf8");
console.log("wrote", path.join(out, "script-plannable.txt"));
