/** Read-only by default. `--commit` may only reserve publication slots. */
import { createDrizzleClient, inspectTutorialProductionBatch, reserveTutorialProductionBatch, tutorialProductionBatchCsv } from "../packages/db/src/index.js";

const allowed = new Set(["--commit", "--format=json", "--format=csv"]);
const unknown = process.argv.slice(2).filter((value) => !allowed.has(value) && !/^--max-per-channel=\d+$/.test(value));
if (unknown.length) throw new Error(`Unknown argument: ${unknown.join(", ")}`);
const commit = process.argv.includes("--commit");
const format = process.argv.includes("--format=csv") ? "csv" : "json";
const maxArg = process.argv.find((value) => value.startsWith("--max-per-channel="));
const maxPerChannel = maxArg ? Number(maxArg.split("=")[1]) : 50;
if (!Number.isInteger(maxPerChannel) || maxPerChannel < 1 || maxPerChannel > 50) throw new Error("--max-per-channel must be an integer from 1 to 50");
const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const db = createDrizzleClient(databaseUrl, { max: 2, statementTimeoutMs: 120_000 });
const plan = commit
  ? await reserveTutorialProductionBatch(db, new Date(), maxPerChannel)
  : await inspectTutorialProductionBatch(db, new Date(), maxPerChannel);
process.stdout.write(format === "csv" ? tutorialProductionBatchCsv(plan) : `${JSON.stringify(plan, null, 2)}\n`);
process.exit(0);
