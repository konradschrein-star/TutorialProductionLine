import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveTutorialShipMigrationPlan,
  tutorialShipPrerequisite,
} from "../tutorial-ship-migration-plan.js";

const dbRoot = resolve(import.meta.dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(resolve(dbRoot, relativePath), "utf8");

describe("Tutorial Studio ship migration bootstrap", () => {
  it("runs the prerequisite reconciliation before every ship migration", () => {
    expect(resolveTutorialShipMigrationPlan([])[0]).toBe(
      tutorialShipPrerequisite,
    );
    expect(
      resolveTutorialShipMigrationPlan([
        "--from",
        "0105_tutorial_keyword_identity_v2.sql",
      ]),
    ).toEqual([
      tutorialShipPrerequisite,
      "0105_tutorial_keyword_identity_v2.sql",
    ]);
  });

  it("reconciles every predecessor field that the current schema and identity migration require", () => {
    const sql = read(
      "src/migrations/0068_tutorial_ship_schema_prerequisites.sql",
    );
    const requiredColumns = [
      "accepts_tutorials",
      "accepts_rankings",
      "default_tutorial_channel_id",
      "source_job_id",
      "script_structure",
      "reference_transcript_source",
      "reference_transcript_fetched_at",
      "tts_provider_used",
      "description",
      "tags",
      "va_review_status",
      "va_reviewed_at",
      "va_reviewed_by",
      "output_qa_status",
      "output_qa_detail",
      "output_qa_checked_at",
    ];

    for (const column of requiredColumns) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
  });

  it("restores relational and review/QC invariants idempotently", () => {
    const sql = read(
      "src/migrations/0068_tutorial_ship_schema_prerequisites.sql",
    );

    expect(sql).toContain("users_default_tutorial_channel_id_fkey");
    expect(sql).toContain("tutorial_jobs_source_job_id_tutorial_jobs_id_fk");
    expect(sql).toContain("tutorial_jobs_va_review_status_check");
    expect(sql).toContain("tutorial_jobs_output_qa_status_check");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS tutorial_jobs_source_job_id_idx");
  });
});
