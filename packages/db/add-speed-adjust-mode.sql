-- Add speed_adjust_mode column to video_stitch_jobs
ALTER TABLE video_stitch_jobs
ADD COLUMN IF NOT EXISTS speed_adjust_mode varchar(50) NOT NULL DEFAULT 'audio_to_video';

COMMENT ON COLUMN video_stitch_jobs.speed_adjust_mode IS
'audio_to_video: Time-stretch voiceover to match video duration (default); video_to_audio: Speed-adjust video to match voiceover duration';
