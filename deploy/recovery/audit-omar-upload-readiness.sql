\pset pager off

SELECT
  count(*) FILTER (WHERE publication_approval IS NOT NULL) AS publication_approved,
  count(*) FILTER (WHERE final_path IS NOT NULL AND btrim(final_path) <> '') AS final_video,
  count(*) FILTER (
    WHERE description IS NOT NULL
      AND btrim(description) <> ''
      AND jsonb_typeof(tags) = 'array'
      AND jsonb_array_length(tags) > 0
  ) AS metadata_ready
FROM tutorial_jobs;

SELECT count(*) AS selected_completed
FROM thumbnails
WHERE subject_kind = 'tutorial_job'
  AND is_selected
  AND status = 'completed';

SELECT review_verdict, count(*) AS selected_completed
FROM thumbnails
WHERE subject_kind = 'tutorial_job'
  AND is_selected
  AND status = 'completed'
GROUP BY review_verdict
ORDER BY review_verdict;

SELECT
  count(*) AS durable_gate_ready
FROM tutorial_jobs j
JOIN channels c ON c.id = j.channel_id
WHERE j.status = 'COMPLETED'
  AND NOT j.is_uploaded
  AND j.publication_approval IS NOT NULL
  AND j.final_path IS NOT NULL
  AND btrim(j.final_path) <> ''
  AND j.description IS NOT NULL
  AND btrim(j.description) <> ''
  AND jsonb_typeof(j.tags) = 'array'
  AND jsonb_array_length(j.tags) > 0
  AND j.thumbnail_text_top IS NOT NULL
  AND btrim(j.thumbnail_text_top) <> ''
  AND c.uploader_channel_key IS NOT NULL
  AND btrim(c.uploader_channel_key) <> ''
  AND c.language = j.language
  AND EXISTS (
    SELECT 1
    FROM thumbnails t
    WHERE t.subject_kind = 'tutorial_job'
      AND t.subject_id = j.id
      AND t.is_selected
      AND t.status = 'completed'
      AND t.output_path IS NOT NULL
  );

SELECT
  d.state,
  count(*) AS dispatches,
  min(d.requested_at) AS oldest,
  max(d.updated_at) AS newest
FROM tutorial_upload_dispatches d
GROUP BY d.state
ORDER BY d.state;

SELECT
  c.uploader_channel_key,
  count(*) FILTER (WHERE j.status = 'COMPLETED') AS completed,
  count(*) FILTER (WHERE j.publication_approval IS NOT NULL) AS publication_approved,
  count(*) FILTER (WHERE j.is_uploaded) AS uploaded
FROM tutorial_jobs j
LEFT JOIN channels c ON c.id = j.channel_id
GROUP BY c.uploader_channel_key
ORDER BY c.uploader_channel_key NULLS LAST;
