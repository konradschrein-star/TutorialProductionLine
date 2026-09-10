DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tutorial_thumbnail_fanout' AND column_name = 'generation_request_id') THEN
    ALTER TABLE tutorial_thumbnail_fanout ADD COLUMN generation_request_id uuid;
    -- Old generic failures did not retain acknowledgement certainty.
    UPDATE tutorial_thumbnail_fanout SET state = 'uncertain', last_error = 'Legacy failure has no provider acknowledgement proof; Admin reconciliation required' WHERE state = 'failed';
  END IF;
END $$;
ALTER TABLE tutorial_thumbnail_fanout ADD COLUMN IF NOT EXISTS retry_history jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tutorial_thumbnail_ai_batches ADD COLUMN IF NOT EXISTS attempted_variants jsonb NOT NULL DEFAULT '[]'::jsonb;
