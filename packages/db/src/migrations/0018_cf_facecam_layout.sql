-- 0018: facecam_layout on cf_sources
--
-- Stores the auto-detected speaker / facecam layout for the source video.
-- Drives the 9:16 clip composition: where to crop each speaker box, whether
-- the streamer is in a PiP overlay vs full-screen, etc.
--
-- Shape (JSONB):
--   {
--     "mode": "pip" | "split" | "fullscreen",
--     "frame_w": 1920, "frame_h": 1080,
--     "boxes": [
--       { "role": "main",      "x":  773, "y": 0,   "w": 1147, "h": 1080 },
--       { "role": "facecam",   "x":    0, "y": 0,   "w":  773, "h":  434 }
--     ],
--     "detected_at": "2026-06-18T...",
--     "samples": 20,
--     "confidence": 0.92
--   }
ALTER TABLE cf_sources
ADD COLUMN facecam_layout jsonb;
