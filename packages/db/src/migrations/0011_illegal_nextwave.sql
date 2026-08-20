ALTER TABLE "tutorial_jobs" ADD COLUMN "parent_job_id" uuid;--> statement-breakpoint
ALTER TABLE "tutorial_jobs" ADD COLUMN "segment_index" integer;--> statement-breakpoint
ALTER TABLE "tutorial_jobs" ADD CONSTRAINT "tutorial_jobs_parent_job_id_tutorial_jobs_id_fk" FOREIGN KEY ("parent_job_id") REFERENCES "public"."tutorial_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tutorial_jobs_parent_job_id_idx" ON "tutorial_jobs" USING btree ("parent_job_id");