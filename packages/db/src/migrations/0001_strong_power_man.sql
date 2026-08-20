ALTER TABLE "content_templates" ADD COLUMN "archetype_id" uuid;--> statement-breakpoint
ALTER TABLE "content_jobs" ADD COLUMN "progress" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_templates" ADD CONSTRAINT "content_templates_archetype_id_archetypes_id_fk" FOREIGN KEY ("archetype_id") REFERENCES "public"."archetypes"("id") ON DELETE set null ON UPDATE no action;