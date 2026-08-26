\pset border 0
select '=== encrypted_secrets columns ===';
select column_name from information_schema.columns where table_name='encrypted_secrets' order by ordinal_position;
select '=== encrypted_secrets identifiers (no values) ===';
select provider_id, credential_kind from encrypted_secrets order by provider_id;
select '=== tutorial_settings ===';
select default_script_provider, default_tts_provider, coalesce(default_tts_voice,'(none)') from tutorial_settings limit 1;
select '=== tts_voices provider|lang|default|active ===';
select provider, language, is_default, is_active from tts_voices order by language;
select '=== channels name|lang|accepts_tut|has_voice ===';
select name, language, accepts_tutorials, (voice_id is not null) from channels order by created_at;
select '=== tutorial_jobs by status ===';
select status, count(*) from tutorial_jobs group by status order by 1;
