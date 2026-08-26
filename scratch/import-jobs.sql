create temp table _imp (id uuid, title text, script_text text, keyword_ref text, mode text);
\copy _imp from '/opt/tutorial-studio/scratch/jobs.csv' with (format csv)
insert into tutorial_jobs
  (id, created_by, channel_id, title, script_text, keyword_ref, mode, language,
   status, script_provider, script_model, tts_provider, tts_voice, steps_input,
   recording_path, recorded_at, script_done_at, audio_done_at, progress, created_at, updated_at)
select
  i.id,
  'cb0ddcb0-7418-4cb9-8007-a3c3aada70be'::uuid,
  '2c95bd71-e753-451e-aec1-f3fb2b603f37'::uuid,
  i.title,
  nullif(i.script_text, ''),
  nullif(i.keyword_ref, ''),
  i.mode::tutorial_mode,
  'en',
  'COMPLETED'::tutorial_job_status,
  'deepseek', 'deepseek-chat', 'fish_audio', '', '',
  '/opt/tutorial-studio/media/tutorial/' || i.id::text || '/recording.mp4',
  now(), now(), now(), 100, now(), now()
from _imp i
on conflict (id) do nothing;
select 'imported_total:', count(*) from tutorial_jobs;
select 'en_completed_with_script:', count(*) from tutorial_jobs where language='en' and status::text='COMPLETED' and length(coalesce(script_text,''))>50;
