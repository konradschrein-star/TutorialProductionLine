update tutorial_settings set default_script_model='deepseek-chat', updated_at=now();
delete from tutorial_jobs where keyword_ref = 'e2e-fish-de-001';
select 'settings:', default_script_provider, default_script_model, default_tts_provider from tutorial_settings limit 1;
select 'jobs:', id, status, keyword_ref, script_model from tutorial_jobs order by created_at;
