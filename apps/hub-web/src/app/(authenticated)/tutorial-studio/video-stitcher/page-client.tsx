"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { GlassCard } from "../../_components/glass-card";
import { V2Input } from "../../_components/v2-input";
import { V2Select } from "../../_components/v2-select";
import {
  Upload,
  X,
  Music,
  Type,
  Video,
  FileAudio,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Download,
  GripVertical,
  Plus,
  Trash2,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadFileWithProgress } from "@/lib/upload-with-progress";
import { AudioWaveform } from "@/components/asset-library/audio-waveform";

interface VideoFile {
  id: string;
  file: File;
  upload_id?: string;
  duration_seconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  recorded_at?: string;
  uploading?: boolean;
  uploadProgress?: number; // 0-100
  error?: string;
}

interface VoiceoverFile {
  file: File;
  upload_id?: string;
  duration_seconds?: number;
  uploading?: boolean;
  uploadProgress?: number; // 0-100
  error?: string;
}

interface MusicFile {
  file: File;
  upload_id?: string;
  uploading?: boolean;
  uploadProgress?: number; // 0-100
  error?: string;
}

interface MusicLibraryTrack {
  id: string;
  name: string;
  file_path: string;
  original_filename: string;
  duration_seconds: number;
  genre?: string;
  created_at: string;
  waveform_data?: number[];
}

interface SelectedMusicTrack {
  id: string;
  track_id: string;
  name: string;
  fade_in_duration?: number;
  fade_out_duration?: number;
  volume_adjustment?: number;
  order_index: number;
}

interface Job {
  id: string;
  status: string;
  progress: number;
  output_filename: string;
  created_at: string;
  updated_at: string;
  error_message?: string;
  output_video_path?: string;
  input_videos?: unknown[];
  alignment_mode?: string;
}

interface CaptionPreset {
  id: string;
  name: string;
  is_default: boolean;
}

interface RemotionCaptionPreset {
  id: string;
  name: string;
  is_default: boolean;
  config: {
    animation_type:
      | "fade"
      | "slideUp"
      | "pop"
      | "typewriter"
      | "smoothHighlight";
    font_family: string;
    font_size: number;
    primary_color: string;
    highlight_color: string;
    position: "top" | "center" | "bottom";
  };
}

interface Props {
  initialJobs: Job[];
  captionPresets: CaptionPreset[];
  remotionCaptionPresets: RemotionCaptionPreset[];
}

export function VideoStitcherPageClient({
  initialJobs,
  captionPresets,
  remotionCaptionPresets,
}: Props) {
  // Load preferences from localStorage
  const loadPreferences = () => {
    if (typeof window === "undefined") return null;
    try {
      const saved = localStorage.getItem("videoStitcherPreferences");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  };

  const savedPrefs = loadPreferences();

  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [manualOrder, setManualOrder] = useState<string[]>([]); // Track manual reordering by video IDs
  const [draggedVideoId, setDraggedVideoId] = useState<string | null>(null);
  const [voiceover, setVoiceover] = useState<VoiceoverFile | null>(null);
  const [music, setMusic] = useState<MusicFile | null>(null);
  const [musicVolume, setMusicVolume] = useState(savedPrefs?.musicVolume ?? 50);
  const [transitionType, setTransitionType] = useState(
    savedPrefs?.transitionType ?? "hard_cut",
  );
  const [transitionDuration, setTransitionDuration] = useState(
    savedPrefs?.transitionDuration ?? 0,
  );
  const [captionsEnabled, setCaptionsEnabled] = useState(
    savedPrefs?.captionsEnabled ?? false,
  );
  const [selectedPresetId, setSelectedPresetId] = useState(
    savedPrefs?.selectedPresetId ?? "",
  );
  const [wordsPerBlock, setWordsPerBlock] = useState(
    savedPrefs?.wordsPerBlock ?? 1,
  );
  const [captionRenderer, setCaptionRenderer] = useState<"ffmpeg" | "remotion">(
    savedPrefs?.captionRenderer ?? "ffmpeg",
  );
  const [selectedRemotionPresetId, setSelectedRemotionPresetId] =
    useState<string>("");
  const [speedAdjustMode, setSpeedAdjustMode] = useState<
    "audio_to_video" | "video_to_audio"
  >(savedPrefs?.speedAdjustMode ?? "audio_to_video");
  const [captionConfig, setCaptionConfig] = useState({
    font_family: "Montserrat",
    font_size: 72,
    vertical_offset_percent: 15,
    outline_width: 4,
  });
  const [outputFilename, setOutputFilename] = useState("");
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"completed" | "uploaded">(
    "completed",
  );
  const [musicPresets, setMusicPresets] = useState<
    Array<{
      id: string;
      name: string;
      file_path: string;
      original_filename: string;
      created_at: string;
    }>
  >([]);
  const [selectedMusicPresetId, setSelectedMusicPresetId] = useState<
    string | null
  >(null);
  const [showSavePresetDialog, setShowSavePresetDialog] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [musicLibraryTracks, setMusicLibraryTracks] = useState<
    MusicLibraryTrack[]
  >([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [selectedMusicTracks, setSelectedMusicTracks] = useState<
    SelectedMusicTrack[]
  >([]);
  const [showMusicLibraryUI, setShowMusicLibraryUI] = useState(false);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Save preferences to localStorage whenever they change
  useEffect(() => {
    if (typeof window === "undefined") return;
    const preferences = {
      musicVolume,
      transitionType,
      transitionDuration,
      captionsEnabled,
      selectedPresetId,
      wordsPerBlock,
      captionRenderer,
      speedAdjustMode,
    };
    localStorage.setItem(
      "videoStitcherPreferences",
      JSON.stringify(preferences),
    );
  }, [
    musicVolume,
    transitionType,
    transitionDuration,
    captionsEnabled,
    selectedPresetId,
    wordsPerBlock,
    captionRenderer,
    speedAdjustMode,
  ]);

  // Helper to calculate display volume in dB from user percentage
  const calculateDisplayVolume = (userVolume: number): string => {
    const minDB = -35;
    const maxDB = -20;
    const volumeDB = minDB + (userVolume / 100) * (maxDB - minDB);
    return volumeDB.toFixed(1);
  };

  // Calculate submission readiness
  const canSubmit = React.useMemo(() => {
    if (videos.length < 2)
      return { ready: false, reason: "Upload at least 2 videos" };
    if (videos.some((v) => v.uploading))
      return {
        ready: false,
        reason: `Uploading ${videos.filter((v) => v.uploading).length} video(s)...`,
      };
    if (videos.some((v) => !v.upload_id))
      return {
        ready: false,
        reason: "Some uploads failed - remove and re-upload",
      };
    if (!outputFilename.trim())
      return { ready: false, reason: "Enter an output filename" };
    if (captionsEnabled && !selectedPresetId)
      return { ready: false, reason: "Select a caption preset" };
    return { ready: true, reason: "" };
  }, [videos, outputFilename, captionsEnabled, selectedPresetId]);

  // Sort videos for display: use manual order if set, otherwise sort by filename
  const sortedVideos = React.useMemo(() => {
    if (manualOrder.length > 0) {
      // Use manual order
      return manualOrder
        .map((id) => videos.find((v) => v.id === id))
        .filter((v): v is VideoFile => v !== undefined);
    }
    // Auto-sort by filename (OBS uses timestamps in filenames)
    return [...videos].sort((a, b) => a.file.name.localeCompare(b.file.name));
  }, [videos, manualOrder]);

  // Calculate total duration
  const totalDuration = videos.reduce(
    (sum, v) => sum + (v.duration_seconds ?? 0),
    0,
  );

  // Calculate voiceover speed adjustment
  const voiceoverSpeedFactor =
    voiceover && voiceover.duration_seconds && totalDuration > 0
      ? voiceover.duration_seconds / totalDuration
      : 1.0;

  // Fetch music presets
  const fetchMusicPresets = useCallback(async () => {
    try {
      const res = await fetch("/api/video-stitch/music-presets");
      if (res.ok) {
        const data = await res.json();
        setMusicPresets(data);
      }
    } catch (err) {
      console.error("Failed to fetch music presets", err);
    }
  }, []);

  // Fetch music library tracks
  const fetchMusicLibrary = useCallback(async () => {
    setLoadingLibrary(true);
    try {
      const res = await fetch("/api/music-library");
      if (res.ok) {
        const data = await res.json();
        setMusicLibraryTracks(data.tracks || []);
      }
    } catch (err) {
      console.error("Failed to fetch music library", err);
    } finally {
      setLoadingLibrary(false);
    }
  }, []);

  // Save music as preset
  const saveMusicAsPreset = useCallback(async () => {
    if (!music || !music.upload_id || !presetName.trim()) return;

    try {
      const res = await fetch("/api/video-stitch/music-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: presetName,
          music_upload_id: music.upload_id,
          original_filename: music.file.name,
        }),
      });

      if (res.ok) {
        setShowSavePresetDialog(false);
        setPresetName("");
        await fetchMusicPresets();
      }
    } catch (err) {
      console.error("Failed to save preset", err);
    }
  }, [music, presetName, fetchMusicPresets]);

  // Which completed job is expanded for inline preview (visual verification).
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);

  // Download video
  const downloadVideo = useCallback(async (jobId: string, filename: string) => {
    try {
      const res = await fetch(`/api/video-stitch/jobs/${jobId}/download`);
      if (!res.ok) throw new Error("Download failed");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Failed to download video", err);
      alert("Failed to download video");
    }
  }, []);

  // Delete job
  const deleteJob = useCallback(async (jobId: string) => {
    if (!confirm("Are you sure you want to delete this job?")) return;

    try {
      const res = await fetch(`/api/video-stitch/jobs/${jobId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setJobs((prev) => prev.filter((j) => j.id !== jobId));
      }
    } catch (err) {
      console.error("Failed to delete job", err);
      alert("Failed to delete job");
    }
  }, []);

  // Mark job as uploaded
  const markJobAsUploaded = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/video-stitch/jobs/${jobId}/mark-uploaded`, {
        method: "POST",
      });

      if (res.ok) {
        // Refresh jobs to update the status
        const res2 = await fetch("/api/video-stitch/jobs");
        if (res2.ok) {
          const data = await res2.json();
          setJobs(data);
        }
      }
    } catch (err) {
      console.error("Failed to mark as uploaded", err);
      alert("Failed to mark as uploaded");
    }
  }, []);

  // Cancel job (delete if processing)
  const cancelJob = useCallback(
    async (jobId: string) => {
      if (!confirm("Cancel and delete this job?")) return;
      await deleteJob(jobId);
    },
    [deleteJob],
  );

  // Delete all processing jobs
  const deleteAllProcessingJobs = useCallback(async () => {
    const processingJobs = jobs.filter(
      (j) => j.status === "PROCESSING" || j.status === "PENDING",
    );
    if (processingJobs.length === 0) {
      alert("No processing jobs to delete");
      return;
    }

    if (!confirm(`Delete all ${processingJobs.length} processing jobs?`))
      return;

    try {
      await Promise.all(
        processingJobs.map((j) =>
          fetch(`/api/video-stitch/jobs/${j.id}`, { method: "DELETE" }),
        ),
      );
      setJobs((prev) =>
        prev.filter((j) => j.status !== "PROCESSING" && j.status !== "PENDING"),
      );
    } catch (err) {
      console.error("Failed to delete all processing jobs", err);
      alert("Failed to delete some jobs");
    }
  }, [jobs]);

  // Add track to selection
  const addMusicTrack = useCallback(
    (track: MusicLibraryTrack) => {
      const newTrack: SelectedMusicTrack = {
        id: Math.random().toString(36).substring(7),
        track_id: track.id,
        name: track.name,
        fade_in_duration: 0,
        fade_out_duration: 0,
        volume_adjustment: 0,
        order_index: selectedMusicTracks.length,
      };
      setSelectedMusicTracks((prev) => [...prev, newTrack]);
    },
    [selectedMusicTracks.length],
  );

  // Remove track from selection
  const removeMusicTrack = useCallback((id: string) => {
    setSelectedMusicTracks((prev) =>
      prev
        .filter((t) => t.id !== id)
        .map((t, idx) => ({ ...t, order_index: idx })),
    );
  }, []);

  // Update track fade/volume settings
  const updateMusicTrack = useCallback(
    (id: string, updates: Partial<SelectedMusicTrack>) => {
      setSelectedMusicTracks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...updates } : t)),
      );
    },
    [],
  );

  // Load music presets and library on mount
  useEffect(() => {
    fetchMusicPresets();
    fetchMusicLibrary();
  }, [fetchMusicPresets, fetchMusicLibrary]);

  // Video dropzone
  const onDropVideos = useCallback(async (acceptedFiles: File[]) => {
    const newVideos = acceptedFiles.map((file) => ({
      id: Math.random().toString(36).substring(7),
      file,
      uploading: true,
    }));
    setVideos((prev) => [...prev, ...newVideos]);

    // Upload each video
    for (const video of newVideos) {
      try {
        console.warn(`[Upload] Starting upload for: ${video.file.name}`);
        const data = await uploadFileWithProgress(
          video.file,
          "/api/video-stitch/upload",
          (progress) => {
            setVideos((prev) =>
              prev.map((v) =>
                v.id === video.id ? { ...v, uploadProgress: progress } : v,
              ),
            );
          },
        );

        console.warn(`[Upload] Success for ${video.file.name}:`, data);

        setVideos((prev) =>
          prev.map((v) =>
            v.id === video.id
              ? {
                  ...v,
                  upload_id: data.upload_id,
                  duration_seconds: data.duration_seconds,
                  width: data.width,
                  height: data.height,
                  fps: data.fps,
                  recorded_at: data.recorded_at,
                  uploading: false,
                  uploadProgress: undefined,
                  error: undefined,
                }
              : v,
          ),
        );
      } catch (err) {
        console.error(`[Upload] Error for ${video.file.name}:`, err);
        setVideos((prev) =>
          prev.map((v) =>
            v.id === video.id
              ? {
                  ...v,
                  uploading: false,
                  uploadProgress: undefined,
                  error: err instanceof Error ? err.message : "Upload failed",
                }
              : v,
          ),
        );
      } finally {
        // Failsafe: ensure uploading is always set to false
        setTimeout(() => {
          setVideos((prev) =>
            prev.map((v) =>
              v.id === video.id && v.uploading
                ? {
                    ...v,
                    uploading: false,
                    error: v.error || "Upload timeout after 5 minutes",
                  }
                : v,
            ),
          );
        }, 300000); // 5 minutes (was 60000)
      }
    }
  }, []);

  const {
    getRootProps: getVideoRootProps,
    getInputProps: getVideoInputProps,
    isDragActive: isVideoDragActive,
  } = useDropzone({
    onDrop: onDropVideos,
    accept: { "video/*": [".mp4", ".mov", ".avi", ".mkv", ".webm"] },
    multiple: true,
  });

  // Voiceover dropzone
  const onDropVoiceover = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setVoiceover({ file, uploading: true });

    try {
      console.warn(`[Upload] Starting voiceover upload: ${file.name}`);
      const data = await uploadFileWithProgress(
        file,
        "/api/video-stitch/upload",
        (progress) => {
          setVoiceover((prev) =>
            prev ? { ...prev, uploadProgress: progress } : prev,
          );
        },
      );

      console.warn(`[Upload] Voiceover success:`, data);

      setVoiceover({
        file,
        upload_id: data.upload_id,
        duration_seconds: data.duration_seconds,
        uploading: false,
        uploadProgress: undefined,
      });
    } catch (err) {
      setVoiceover({
        file,
        uploading: false,
        uploadProgress: undefined,
        error: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }, []);

  const {
    getRootProps: getVoiceoverRootProps,
    getInputProps: getVoiceoverInputProps,
    isDragActive: isVoiceoverDragActive,
  } = useDropzone({
    onDrop: onDropVoiceover,
    accept: { "audio/*": [".mp3", ".wav", ".ogg", ".m4a", ".flac"] },
    multiple: false,
  });

  // Music dropzone
  const onDropMusic = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setMusic({ file, uploading: true });

    try {
      const data = await uploadFileWithProgress(
        file,
        "/api/video-stitch/upload",
        (progress) => {
          setMusic((prev) =>
            prev ? { ...prev, uploadProgress: progress } : prev,
          );
        },
      );

      setMusic({
        file,
        upload_id: data.upload_id,
        uploading: false,
        uploadProgress: undefined,
      });
    } catch (err) {
      setMusic({
        file,
        uploading: false,
        uploadProgress: undefined,
        error: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }, []);

  const {
    getRootProps: getMusicRootProps,
    getInputProps: getMusicInputProps,
    isDragActive: isMusicDragActive,
  } = useDropzone({
    onDrop: onDropMusic,
    accept: { "audio/*": [".mp3", ".wav", ".ogg", ".m4a", ".flac"] },
    multiple: false,
  });

  // Remove video
  const removeVideo = useCallback((id: string) => {
    setVideos((prev) => prev.filter((v) => v.id !== id));
    setManualOrder((prev) => prev.filter((vid) => vid !== id));
  }, []);

  // Drag and drop handlers for manual reordering
  const handleDragStart = (videoId: string) => {
    setDraggedVideoId(videoId);
  };

  const handleDragOver = (e: React.DragEvent, targetVideoId: string) => {
    e.preventDefault();
    if (!draggedVideoId || draggedVideoId === targetVideoId) return;

    // Reorder videos
    const currentOrder =
      manualOrder.length > 0 ? manualOrder : sortedVideos.map((v) => v.id);
    const draggedIndex = currentOrder.indexOf(draggedVideoId);
    const targetIndex = currentOrder.indexOf(targetVideoId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const newOrder = [...currentOrder];
    newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedVideoId);

    setManualOrder(newOrder);
  };

  const handleDragEnd = () => {
    setDraggedVideoId(null);
  };

  // Reorder videos (drag to reorder)
  const moveVideo = useCallback((fromIndex: number, toIndex: number) => {
    setVideos((prev) => {
      const newVideos = [...prev];
      const [moved] = newVideos.splice(fromIndex, 1);
      newVideos.splice(toIndex, 0, moved);
      return newVideos;
    });
  }, []);

  // Submit job
  const handleSubmit = useCallback(async () => {
    setError(null);

    // Validation
    if (videos.length < 2) {
      setError("Please upload at least 2 videos");
      return;
    }

    if (videos.some((v) => !v.upload_id)) {
      setError("Please wait for all videos to finish uploading");
      return;
    }

    if (!outputFilename.trim()) {
      setError("Please enter an output filename");
      return;
    }

    if (captionsEnabled && !selectedPresetId) {
      setError("Please select a caption preset");
      return;
    }

    if (
      captionsEnabled &&
      captionRenderer === "remotion" &&
      !selectedRemotionPresetId
    ) {
      setError("Please select a Remotion animation style");
      return;
    }

    setSubmitting(true);

    try {
      // Use the already-sorted videos (respects manual reordering)
      const payload = {
        input_videos: sortedVideos.map((v, idx) => ({
          upload_id: v.upload_id!,
          filename: v.file.name,
          duration_seconds: v.duration_seconds!,
          width: v.width!,
          height: v.height!,
          fps: v.fps!,
          order_index: idx,
          metadata: { recorded_at: v.recorded_at },
        })),
        speed_adjust_mode: speedAdjustMode,
        output_filename: outputFilename.trim(),
        voiceover_enabled: !!voiceover,
        voiceover_upload_id: voiceover?.upload_id,
        voiceover_filename: voiceover?.file.name,
        music_enabled: !!music || selectedMusicTracks.length > 0,
        music_upload_id: selectedMusicPresetId ? undefined : music?.upload_id,
        music_filename: selectedMusicPresetId ? undefined : music?.file.name,
        music_preset_id: selectedMusicPresetId || undefined,
        music_volume: musicVolume,
        music_tracks:
          selectedMusicTracks.length > 0
            ? selectedMusicTracks.map((t) => ({
                track_id: t.track_id,
                fade_in_duration: t.fade_in_duration || 0,
                fade_out_duration: t.fade_out_duration || 0,
                volume_adjustment: t.volume_adjustment || 0,
                order_index: t.order_index,
              }))
            : undefined,
        captions_enabled: captionsEnabled,
        caption_preset_id: captionsEnabled ? selectedPresetId : undefined,
        caption_config: captionsEnabled
          ? {
              window_size: wordsPerBlock,
              font_family: captionConfig.font_family,
              font_size: captionConfig.font_size,
              vertical_offset_percent: captionConfig.vertical_offset_percent,
              outline_width: captionConfig.outline_width,
            }
          : undefined,
        caption_renderer: captionsEnabled ? captionRenderer : undefined,
        remotion_preset_id:
          captionsEnabled && captionRenderer === "remotion"
            ? selectedRemotionPresetId
            : undefined,
        transition_type: transitionType,
        transition_duration_seconds:
          transitionType === "hard_cut" ? 0 : transitionDuration,
      };

      const res = await fetch("/api/video-stitch/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to create job");
      }

      // Reset form
      setVideos([]);
      setVoiceover(null);
      setMusic(null);
      setSelectedMusicTracks([]);
      setOutputFilename("");
      setCaptionsEnabled(false);
      setSelectedPresetId("");
      setCaptionRenderer("ffmpeg");
      setSelectedRemotionPresetId("");
      setTransitionType("hard_cut");
      setTransitionDuration(0);
      setMusicVolume(50);
      setCaptionConfig({
        font_family: "Montserrat",
        font_size: 72,
        vertical_offset_percent: 15,
        outline_width: 4,
      });

      // Refresh job list
      refreshJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create job");
    } finally {
      setSubmitting(false);
    }
  }, [
    videos,
    sortedVideos,
    voiceover,
    music,
    outputFilename,
    captionsEnabled,
    selectedPresetId,
    wordsPerBlock,
    selectedMusicPresetId,
    speedAdjustMode,
    transitionType,
    transitionDuration,
    musicVolume,
    captionConfig,
  ]);

  // Refresh jobs
  const refreshJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/video-stitch/jobs");
      if (res.ok) {
        const data = await res.json();
        setJobs(data);
      }
    } catch (err) {
      console.error("Failed to refresh jobs", err);
    }
  }, []);

  // ── "Finish this job" mode ──────────────────────────────────────────────
  // When the studio sends a LONG_FORM job here (?job=<draftId>), open that
  // segmented DRAFT in a review mode: parts are shown read-only, the full
  // options panel below is editable, and the CTA becomes "Start render".
  const [finalizeJobId, setFinalizeJobId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window !== "undefined") {
      setFinalizeJobId(new URLSearchParams(window.location.search).get("job"));
    }
  }, []);
  const finalizeJob = finalizeJobId
    ? jobs.find((j) => j.id === finalizeJobId)
    : undefined;
  const finalizeMode = !!finalizeJob && finalizeJob.status === "DRAFT";
  const prefilledFinalizeRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      finalizeMode &&
      finalizeJob &&
      prefilledFinalizeRef.current !== finalizeJob.id
    ) {
      prefilledFinalizeRef.current = finalizeJob.id;
      setOutputFilename(finalizeJob.output_filename.replace(/\.mp4$/i, ""));
    }
  }, [finalizeMode, finalizeJob]);

  const handleStartFinalize = useCallback(async () => {
    if (!finalizeJob) return;
    if (captionsEnabled && captionRenderer === "ffmpeg" && !selectedPresetId) {
      setError("Please pick a caption preset (or turn captions off).");
      return;
    }
    if (
      captionsEnabled &&
      captionRenderer === "remotion" &&
      !selectedRemotionPresetId
    ) {
      setError(
        "Please pick a Remotion animation style (or turn captions off).",
      );
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const name = outputFilename.trim();
      const overrides = {
        output_filename: name
          ? name.toLowerCase().endsWith(".mp4")
            ? name
            : `${name}.mp4`
          : finalizeJob.output_filename,
        captions_enabled: captionsEnabled,
        caption_preset_id:
          captionsEnabled && captionRenderer === "ffmpeg"
            ? selectedPresetId || null
            : null,
        caption_config: captionsEnabled
          ? {
              window_size: wordsPerBlock,
              font_family: captionConfig.font_family,
              font_size: captionConfig.font_size,
              vertical_offset_percent: captionConfig.vertical_offset_percent,
              outline_width: captionConfig.outline_width,
            }
          : null,
        remotion_enabled: captionsEnabled && captionRenderer === "remotion",
        remotion_preset_id:
          captionsEnabled && captionRenderer === "remotion"
            ? selectedRemotionPresetId || null
            : null,
        music_enabled: selectedMusicTracks.length > 0,
        music_tracks:
          selectedMusicTracks.length > 0
            ? selectedMusicTracks.map((t) => ({
                track_id: t.track_id,
                fade_in_duration: t.fade_in_duration || 0,
                fade_out_duration: t.fade_out_duration || 0,
                volume_adjustment: t.volume_adjustment || 0,
                order_index: t.order_index,
              }))
            : undefined,
        music_volume: musicVolume,
        transition_type: transitionType,
        transition_duration_seconds:
          transitionType === "hard_cut" ? 0 : transitionDuration,
        speed_adjust_mode: speedAdjustMode,
      };
      const res = await fetch(
        `/api/video-stitch/jobs/${finalizeJob.id}/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(overrides),
        },
      );
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || "Failed to start render");
      }
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", "/tutorial-studio/video-stitcher");
      }
      setFinalizeJobId(null);
      await refreshJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start render");
    } finally {
      setSubmitting(false);
    }
  }, [
    finalizeJob,
    outputFilename,
    captionsEnabled,
    captionRenderer,
    selectedPresetId,
    selectedRemotionPresetId,
    wordsPerBlock,
    captionConfig,
    selectedMusicTracks,
    musicVolume,
    transitionType,
    transitionDuration,
    speedAdjustMode,
    refreshJobs,
  ]);

  // Track which DRAFT job is being started (for loading state)
  const [startingJobId, setStartingJobId] = useState<string | null>(null);

  // Start a DRAFT job (transitions to PENDING and enqueues)
  const startJob = useCallback(
    async (jobId: string) => {
      setStartingJobId(jobId);
      try {
        const res = await fetch(`/api/video-stitch/jobs/${jobId}/start`, {
          method: "POST",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          alert(
            `Failed to start job: ${(data as { error?: string }).error ?? res.statusText}`,
          );
          return;
        }
        // Refresh the job list so the status updates to PENDING/PROCESSING
        await refreshJobs();
      } catch (err) {
        console.error("Failed to start job", err);
        alert("Failed to start job");
      } finally {
        setStartingJobId(null);
      }
    },
    [refreshJobs],
  );

  // Poll for job updates every 5 seconds (only when there are active jobs)
  useEffect(() => {
    const hasActiveJobs = jobs.some(
      (j) => j.status === "PROCESSING" || j.status === "PENDING",
    );
    if (hasActiveJobs) {
      pollIntervalRef.current = setInterval(refreshJobs, 5000);
      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
      };
    }
  }, [refreshJobs, jobs]);

  // Find currently rendering job
  const renderingJob = jobs.find((j) => j.status === "PROCESSING");

  // Filter jobs by status
  const completedJobs = jobs.filter((j) => j.status === "RENDERED");
  const uploadedJobs = jobs.filter((j) => j.status === "UPLOADED");

  // Transition type options (FFmpeg xfade filter)
  const transitionOptions = [
    { value: "hard_cut", label: "Hard Cut" },
    { value: "fade", label: "Crossfade" },
    { value: "fadeblack", label: "Fade to Black" },
    { value: "wipeleft", label: "Wipe Left" },
    { value: "wiperight", label: "Wipe Right" },
  ];

  // Caption preset options
  const presetOptions = [
    { value: "", label: "Select preset..." },
    ...captionPresets.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* MVP Notice */}
      <div
        style={{
          padding: 12,
          background: "rgba(255, 200, 0, 0.1)",
          border: "1px solid rgba(255, 200, 0, 0.3)",
          borderRadius: 8,
        }}
      >
        <p
          style={{
            color: "rgba(255, 200, 0, 0.9)",
            fontSize: 12,
            margin: 0,
            fontWeight: 500,
          }}
        >
          ⚠️ MVP Version - Additional refinements and improvements coming soon
          (caption style previews, Remotion integration, enhanced styling
          controls)
        </p>
      </div>

      {/* Page header */}
      <div>
        <a
          href="/tutorial-studio"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "rgba(205,195,215,0.6)",
            textDecoration: "none",
            marginBottom: 8,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            arrow_back
          </span>
          Tutorial Studio
        </a>
        <h1
          style={{ color: "#e5e2e1", fontSize: 20, fontWeight: 800, margin: 0 }}
        >
          Video Stitcher
        </h1>
        <p
          style={{
            color: "rgba(205,195,215,0.6)",
            fontSize: 12,
            marginTop: 4,
            marginBottom: 0,
          }}
        >
          Combine multiple video clips with optional voiceover, music, and
          captions
        </p>
      </div>

      {/* Currently Rendering Banner */}
      {renderingJob && (
        <GlassCard
          style={{
            padding: 16,
            background:
              "linear-gradient(to right, rgba(var(--v2-accent-rgb), 0.15), transparent)",
            borderColor: "var(--v2-accent)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Loader2
              className="w-5 h-5 animate-spin"
              style={{ color: "var(--v2-accent)" }}
            />
            <div style={{ flex: 1 }}>
              <div
                style={{
                  color: "var(--v2-text-1)",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Rendering: {renderingJob.output_filename}
              </div>
              <div style={{ marginTop: 8 }}>
                <div
                  style={{
                    height: 6,
                    background: "rgba(255,255,255,0.1)",
                    borderRadius: 3,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      background: "var(--v2-accent)",
                      width: `${renderingJob.progress}%`,
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </div>
              <div
                style={{
                  color: "var(--v2-text-3)",
                  fontSize: 11,
                  marginTop: 4,
                }}
              >
                {renderingJob.progress}% complete
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Upload Zones */}
      <GlassCard style={{ padding: 24 }}>
        <h2
          style={{
            color: "var(--v2-text-1)",
            fontSize: 16,
            fontWeight: 700,
            marginBottom: 16,
          }}
        >
          {finalizeMode ? "Finish & render" : "Upload Videos"}
        </h2>

        {finalizeMode && finalizeJob && (
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 8,
              background: "rgba(var(--v2-accent-rgb), 0.08)",
              border: "1px solid rgba(var(--v2-accent-rgb), 0.3)",
              color: "var(--v2-text-1)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {finalizeJob.output_filename.replace(/\.mp4$/i, "")}
            </div>
            <div style={{ color: "var(--v2-text-2)" }}>
              {finalizeJob.input_videos?.length
                ? `${finalizeJob.input_videos.length} parts`
                : "Parts"}{" "}
              from the tutorial tool, segmented alignment — already prepared.
              Set the output name, captions and music below, then press{" "}
              <strong>Start render</strong>.
            </div>
          </div>
        )}

        {!finalizeMode && (
          <div
            {...getVideoRootProps()}
            className={cn(
              "border-2 border-dashed rounded-lg p-8 cursor-pointer transition-colors",
              isVideoDragActive
                ? "border-[var(--v2-accent)] bg-[var(--v2-accent)]/10"
                : "border-[var(--v2-border-1)] hover:border-[var(--v2-accent)]/40",
            )}
          >
            <input {...getVideoInputProps()} />
            <div style={{ textAlign: "center" }}>
              <Upload
                className="w-8 h-8 mx-auto mb-3"
                style={{ color: "var(--v2-text-3)" }}
              />
              <p
                style={{
                  color: "var(--v2-text-1)",
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                Drop video files here or click to browse
              </p>
              <p
                style={{
                  color: "var(--v2-text-3)",
                  fontSize: 11,
                  marginTop: 4,
                }}
              >
                Accepts MP4, MOV, AVI, MKV, WebM
              </p>
            </div>
          </div>
        )}

        {/* Video previews */}
        {videos.length > 0 && (
          <div
            style={{
              marginTop: 16,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {sortedVideos.map((video, idx) => (
              <div
                key={video.id}
                draggable
                onDragStart={() => handleDragStart(video.id)}
                onDragOver={(e) => handleDragOver(e, video.id)}
                onDragEnd={handleDragEnd}
                style={{
                  padding: 12,
                  background:
                    draggedVideoId === video.id
                      ? "rgba(var(--v2-accent-rgb), 0.1)"
                      : "rgba(255,255,255,0.02)",
                  border:
                    draggedVideoId === video.id
                      ? "1px solid var(--v2-accent)"
                      : "1px solid rgba(255,255,255,0.05)",
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  cursor: "grab",
                  opacity: draggedVideoId === video.id ? 0.5 : 1,
                  transition: "all 0.2s ease",
                }}
              >
                <GripVertical
                  className="w-5 h-5 shrink-0"
                  style={{ color: "var(--v2-text-3)", cursor: "grab" }}
                />
                <Video
                  className="w-5 h-5 shrink-0"
                  style={{ color: "var(--v2-accent)" }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      color: "var(--v2-text-1)",
                      fontSize: 13,
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    #{idx + 1}: {video.file.name}
                  </div>
                  {video.uploading && (
                    <div style={{ marginTop: 4 }}>
                      <div
                        style={{
                          height: 4,
                          background: "rgba(var(--v2-accent-rgb), 0.1)",
                          borderRadius: 2,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${video.uploadProgress || 0}%`,
                            background: "var(--v2-accent)",
                            transition: "width 0.2s ease",
                          }}
                        />
                      </div>
                      <div
                        style={{
                          color: "var(--v2-text-3)",
                          fontSize: 10,
                          marginTop: 2,
                        }}
                      >
                        Uploading... {video.uploadProgress || 0}%
                      </div>
                    </div>
                  )}
                  {video.error && (
                    <div
                      style={{
                        color: "var(--v2-error)",
                        fontSize: 11,
                        marginTop: 2,
                      }}
                    >
                      {video.error}
                    </div>
                  )}
                  {video.duration_seconds !== undefined && (
                    <div
                      style={{
                        color: "var(--v2-text-3)",
                        fontSize: 11,
                        marginTop: 2,
                      }}
                    >
                      {video.duration_seconds.toFixed(1)}s · {video.width}x
                      {video.height} · {video.fps}fps
                    </div>
                  )}
                </div>
                <button
                  onClick={() => removeVideo(video.id)}
                  className="p-1 rounded hover:bg-[var(--v2-error)]/20 transition-colors"
                  style={{ color: "var(--v2-error)" }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            <div
              style={{
                padding: 12,
                background: "rgba(var(--v2-accent-rgb), 0.1)",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.3)",
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  color: "var(--v2-accent)",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Total Duration: {totalDuration.toFixed(1)}s
              </div>
            </div>
          </div>
        )}
      </GlassCard>

      {/* Voiceover Upload */}
      <GlassCard style={{ padding: 24 }}>
        <h2
          style={{
            color: "var(--v2-text-1)",
            fontSize: 16,
            fontWeight: 700,
            marginBottom: 16,
          }}
        >
          Voiceover (Optional)
        </h2>

        <div
          {...getVoiceoverRootProps()}
          className={cn(
            "border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors",
            isVoiceoverDragActive
              ? "border-[var(--v2-accent)] bg-[var(--v2-accent)]/10"
              : "border-[var(--v2-border-1)] hover:border-[var(--v2-accent)]/40",
          )}
        >
          <input {...getVoiceoverInputProps()} />
          <div style={{ textAlign: "center" }}>
            <FileAudio
              className="w-6 h-6 mx-auto mb-2"
              style={{ color: "var(--v2-text-3)" }}
            />
            <p
              style={{
                color: "var(--v2-text-1)",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Drop audio file here or click to browse
            </p>
            <p
              style={{ color: "var(--v2-text-3)", fontSize: 10, marginTop: 2 }}
            >
              Accepts MP3, WAV, OGG, M4A, FLAC
            </p>
          </div>
        </div>

        {voiceover && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.05)",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <FileAudio
              className="w-5 h-5 shrink-0"
              style={{ color: "var(--v2-accent)" }}
            />
            <div style={{ flex: 1 }}>
              <div
                style={{
                  color: "var(--v2-text-1)",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                {voiceover.file.name}
              </div>
              {voiceover.uploading && (
                <div style={{ marginTop: 4 }}>
                  <div
                    style={{
                      height: 4,
                      background: "rgba(var(--v2-accent-rgb), 0.1)",
                      borderRadius: 2,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${voiceover.uploadProgress || 0}%`,
                        background: "var(--v2-accent)",
                        transition: "width 0.2s ease",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      color: "var(--v2-text-3)",
                      fontSize: 10,
                      marginTop: 2,
                    }}
                  >
                    Uploading... {voiceover.uploadProgress || 0}%
                  </div>
                </div>
              )}
              {voiceover.error && (
                <div
                  style={{
                    color: "var(--v2-error)",
                    fontSize: 11,
                    marginTop: 2,
                  }}
                >
                  {voiceover.error}
                </div>
              )}
              {voiceover.duration_seconds !== undefined && (
                <div
                  style={{
                    color: "var(--v2-text-3)",
                    fontSize: 11,
                    marginTop: 2,
                  }}
                >
                  {voiceover.duration_seconds.toFixed(1)}s
                  {totalDuration > 0 && voiceoverSpeedFactor !== 1.0 && (
                    <span
                      style={{
                        marginLeft: 8,
                        color:
                          voiceoverSpeedFactor > 1.1
                            ? "var(--v2-warning)"
                            : "var(--v2-text-3)",
                      }}
                    >
                      · Will be time-stretched to {totalDuration.toFixed(1)}s (
                      {(voiceoverSpeedFactor * 100).toFixed(0)}% speed)
                    </span>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={() => setVoiceover(null)}
              className="p-1 rounded hover:bg-[var(--v2-error)]/20 transition-colors"
              style={{ color: "var(--v2-error)" }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </GlassCard>

      {/* Music Library UI */}
      {showMusicLibraryUI && (
        <GlassCard style={{ padding: 24 }}>
          <h2
            style={{
              color: "var(--v2-text-1)",
              fontSize: 16,
              fontWeight: 700,
              marginBottom: 16,
            }}
          >
            Music Library - Track Selection
          </h2>

          {loadingLibrary ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: 24,
                color: "var(--v2-text-3)",
              }}
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading music library...
            </div>
          ) : musicLibraryTracks.length === 0 ? (
            <div
              style={{
                padding: 24,
                textAlign: "center",
                color: "var(--v2-text-3)",
              }}
            >
              No music tracks available in library
            </div>
          ) : (
            <>
              {/* Available Tracks */}
              <div style={{ marginBottom: 24 }}>
                <h3
                  style={{
                    color: "var(--v2-text-1)",
                    fontSize: 13,
                    fontWeight: 600,
                    marginBottom: 12,
                  }}
                >
                  Available Tracks ({musicLibraryTracks.length})
                </h3>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    maxHeight: 400,
                    overflowY: "auto",
                  }}
                >
                  {musicLibraryTracks.map((track) => (
                    <div
                      key={track.id}
                      style={{
                        padding: 12,
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid rgba(255,255,255,0.05)",
                        borderRadius: 8,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            color: "var(--v2-text-1)",
                            fontSize: 13,
                            fontWeight: 500,
                            marginBottom: 6,
                          }}
                        >
                          {track.name}
                        </div>
                        {track.waveform_data && (
                          <AudioWaveform
                            data={track.waveform_data}
                            width={300}
                            height={40}
                            color="rgba(var(--v2-accent-rgb), 0.7)"
                          />
                        )}
                        <div
                          style={{
                            color: "var(--v2-text-3)",
                            fontSize: 11,
                            marginTop: 4,
                          }}
                        >
                          {track.duration_seconds.toFixed(1)}s
                          {track.genre && ` · ${track.genre}`}
                        </div>
                      </div>
                      <button
                        onClick={() => addMusicTrack(track)}
                        className="v2-btn-accent"
                        style={{ padding: "6px 12px", fontSize: 11 }}
                        title="Add to video"
                      >
                        <Plus className="w-3 h-3" />
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Selected Tracks for Chaining */}
              <div>
                <h3
                  style={{
                    color: "var(--v2-text-1)",
                    fontSize: 13,
                    fontWeight: 600,
                    marginBottom: 12,
                  }}
                >
                  Selected Tracks for Chaining ({selectedMusicTracks.length})
                </h3>

                {selectedMusicTracks.length === 0 ? (
                  <div
                    style={{
                      padding: 16,
                      textAlign: "center",
                      color: "var(--v2-text-3)",
                      background: "rgba(255,255,255,0.02)",
                      borderRadius: 8,
                      border: "1px dashed rgba(255,255,255,0.1)",
                    }}
                  >
                    No tracks selected yet. Click &quot;Add&quot; to start
                    building a chain.
                  </div>
                ) : (
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    {selectedMusicTracks.map((selectedTrack) => {
                      const libraryTrack = musicLibraryTracks.find(
                        (t) => t.id === selectedTrack.track_id,
                      );
                      return (
                        <div
                          key={selectedTrack.id}
                          style={{
                            padding: 12,
                            background: "rgba(var(--v2-accent-rgb), 0.1)",
                            border: "1px solid rgba(var(--v2-accent-rgb), 0.3)",
                            borderRadius: 8,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              marginBottom: 12,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: 24,
                                height: 24,
                                background: "var(--v2-accent)",
                                borderRadius: "50%",
                                color: "#000",
                                fontSize: 12,
                                fontWeight: 700,
                              }}
                            >
                              {selectedTrack.order_index + 1}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div
                                style={{
                                  color: "var(--v2-text-1)",
                                  fontSize: 13,
                                  fontWeight: 500,
                                }}
                              >
                                {selectedTrack.name}
                              </div>
                              {libraryTrack && (
                                <div
                                  style={{
                                    color: "var(--v2-text-3)",
                                    fontSize: 11,
                                    marginTop: 2,
                                  }}
                                >
                                  {libraryTrack.duration_seconds.toFixed(1)}s
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => removeMusicTrack(selectedTrack.id)}
                              className="p-1 rounded hover:bg-[var(--v2-error)]/20 transition-colors"
                              style={{ color: "var(--v2-error)" }}
                              title="Remove track"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          {/* Fade and Volume Controls */}
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr 1fr",
                              gap: 12,
                            }}
                          >
                            {/* Fade In */}
                            <div>
                              <label
                                style={{
                                  display: "block",
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: "var(--v2-text-2)",
                                  marginBottom: 6,
                                  textTransform: "uppercase",
                                  letterSpacing: "0.06em",
                                }}
                              >
                                Fade In (s)
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="0.1"
                                max="10"
                                value={selectedTrack.fade_in_duration || 0}
                                onChange={(e) =>
                                  updateMusicTrack(selectedTrack.id, {
                                    fade_in_duration:
                                      parseFloat(e.target.value) || 0,
                                  })
                                }
                                style={{
                                  width: "100%",
                                  padding: 6,
                                  background: "var(--v2-surface-2)",
                                  border: "1px solid var(--v2-border-1)",
                                  borderRadius: 4,
                                  color: "var(--v2-text-1)",
                                  fontSize: 12,
                                }}
                              />
                            </div>

                            {/* Fade Out */}
                            <div>
                              <label
                                style={{
                                  display: "block",
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: "var(--v2-text-2)",
                                  marginBottom: 6,
                                  textTransform: "uppercase",
                                  letterSpacing: "0.06em",
                                }}
                              >
                                Fade Out (s)
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="0.1"
                                max="10"
                                value={selectedTrack.fade_out_duration || 0}
                                onChange={(e) =>
                                  updateMusicTrack(selectedTrack.id, {
                                    fade_out_duration:
                                      parseFloat(e.target.value) || 0,
                                  })
                                }
                                style={{
                                  width: "100%",
                                  padding: 6,
                                  background: "var(--v2-surface-2)",
                                  border: "1px solid var(--v2-border-1)",
                                  borderRadius: 4,
                                  color: "var(--v2-text-1)",
                                  fontSize: 12,
                                }}
                              />
                            </div>

                            {/* Volume */}
                            <div>
                              <label
                                style={{
                                  display: "block",
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: "var(--v2-text-2)",
                                  marginBottom: 6,
                                  textTransform: "uppercase",
                                  letterSpacing: "0.06em",
                                }}
                              >
                                Volume (dB)
                              </label>
                              <input
                                type="number"
                                min="-20"
                                step="1"
                                max="6"
                                value={selectedTrack.volume_adjustment || 0}
                                onChange={(e) =>
                                  updateMusicTrack(selectedTrack.id, {
                                    volume_adjustment:
                                      parseFloat(e.target.value) || 0,
                                  })
                                }
                                style={{
                                  width: "100%",
                                  padding: 6,
                                  background: "var(--v2-surface-2)",
                                  border: "1px solid var(--v2-border-1)",
                                  borderRadius: 4,
                                  color: "var(--v2-text-1)",
                                  fontSize: 12,
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </GlassCard>
      )}

      {/* Configuration Panel */}
      <GlassCard style={{ padding: 24 }}>
        <h2
          style={{
            color: "var(--v2-text-1)",
            fontSize: 16,
            fontWeight: 700,
            marginBottom: 16,
          }}
        >
          Configuration
        </h2>

        {/* Music Library Toggle */}
        <div
          style={{
            marginBottom: 24,
            padding: 16,
            background: "rgba(var(--v2-accent-rgb), 0.05)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
            borderRadius: 8,
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              cursor: "pointer",
            }}
          >
            <div
              style={{
                position: "relative",
                width: 44,
                height: 24,
                background: showMusicLibraryUI
                  ? "var(--v2-accent)"
                  : "rgba(255,255,255,0.2)",
                borderRadius: 12,
                transition: "background 0.2s",
              }}
            >
              <input
                type="checkbox"
                checked={showMusicLibraryUI}
                onChange={(e) => setShowMusicLibraryUI(e.target.checked)}
                style={{ display: "none" }}
              />
              <div
                style={{
                  position: "absolute",
                  top: 2,
                  left: showMusicLibraryUI ? "22px" : "2px",
                  width: 20,
                  height: 20,
                  background: "white",
                  borderRadius: "50%",
                  transition: "left 0.2s",
                }}
              />
            </div>
            <div>
              <div
                style={{
                  color: "var(--v2-text-1)",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Enable Music Library (Chaining)
              </div>
              <div
                style={{
                  color: "var(--v2-text-3)",
                  fontSize: 11,
                  marginTop: 2,
                }}
              >
                Select and chain multiple music tracks with fade/volume controls
              </div>
            </div>
          </label>
        </div>

        {/* Speed Adjustment Mode Toggle */}
        <div
          style={{
            marginBottom: 24,
            padding: 16,
            background: "rgba(var(--v2-accent-rgb), 0.05)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
            borderRadius: 8,
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              cursor: "pointer",
            }}
          >
            <div
              style={{
                position: "relative",
                width: 44,
                height: 24,
                background:
                  speedAdjustMode === "video_to_audio"
                    ? "var(--v2-accent)"
                    : "rgba(255,255,255,0.2)",
                borderRadius: 12,
                transition: "background 0.2s",
              }}
            >
              <input
                type="checkbox"
                checked={speedAdjustMode === "video_to_audio"}
                onChange={(e) =>
                  setSpeedAdjustMode(
                    e.target.checked ? "video_to_audio" : "audio_to_video",
                  )
                }
                style={{ display: "none" }}
              />
              <div
                style={{
                  position: "absolute",
                  top: 2,
                  left: speedAdjustMode === "video_to_audio" ? "22px" : "2px",
                  width: 20,
                  height: 20,
                  background: "white",
                  borderRadius: "50%",
                  transition: "left 0.2s",
                }}
              />
            </div>
            <div>
              <div
                style={{
                  color: "var(--v2-text-1)",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {speedAdjustMode === "audio_to_video"
                  ? "Adjust Audio Speed to Match Video"
                  : "Adjust Video Speed to Match Audio"}
              </div>
              <div
                style={{
                  color: "var(--v2-text-3)",
                  fontSize: 11,
                  marginTop: 2,
                }}
              >
                {speedAdjustMode === "audio_to_video"
                  ? "Voiceover will be time-stretched to match video duration"
                  : "Video will be speed-adjusted to match voiceover duration"}
              </div>
            </div>
          </label>
        </div>

        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
        >
          {/* Output Filename */}
          <div style={{ gridColumn: "1 / -1" }}>
            <V2Input
              label="Output Filename"
              value={outputFilename}
              onChange={(e) => setOutputFilename(e.target.value)}
              placeholder="my-video.mp4"
              fullWidth
            />
          </div>

          {/* Music Upload */}
          <div style={{ gridColumn: "1 / -1" }}>
            <label
              style={{
                display: "block",
                fontSize: 10,
                fontWeight: 700,
                color: "var(--v2-text-2)",
                marginBottom: 8,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Background Music (Optional)
            </label>
            {/* Music Presets Dropdown */}
            {musicPresets.length > 0 && !music && (
              <select
                value={selectedMusicPresetId || ""}
                onChange={(e) => {
                  const presetId = e.target.value;
                  setSelectedMusicPresetId(presetId || null);
                  if (presetId) {
                    const preset = musicPresets.find((p) => p.id === presetId);
                    if (preset) {
                      // Create a fake file object for the preset
                      const fakeFile = new File([], preset.original_filename);
                      setMusic({
                        file: fakeFile,
                        upload_id: presetId, // Use preset ID as upload_id
                        uploading: false,
                      });
                    }
                  }
                }}
                style={{
                  width: "100%",
                  padding: 8,
                  marginBottom: 8,
                  background: "var(--v2-surface-2)",
                  border: "1px solid var(--v2-border-1)",
                  borderRadius: 6,
                  color: "var(--v2-text-1)",
                  fontSize: 12,
                }}
              >
                <option value="">Upload new music...</option>
                {musicPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name} ({preset.original_filename})
                  </option>
                ))}
              </select>
            )}
            {/* Upload Area */}
            {!selectedMusicPresetId && (
              <div
                {...getMusicRootProps()}
                className={cn(
                  "border-2 border-dashed rounded-lg p-4 cursor-pointer transition-colors",
                  isMusicDragActive
                    ? "border-[var(--v2-accent)] bg-[var(--v2-accent)]/10"
                    : "border-[var(--v2-border-1)] hover:border-[var(--v2-accent)]/40",
                )}
              >
                <input {...getMusicInputProps()} />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    justifyContent: "space-between",
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <Music
                      className="w-5 h-5"
                      style={{ color: "var(--v2-text-3)" }}
                    />
                    <span style={{ color: "var(--v2-text-2)", fontSize: 12 }}>
                      {music
                        ? music.file.name
                        : "Drop audio file or click to browse"}
                    </span>
                  </div>
                  {music && !music.uploading && music.upload_id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowSavePresetDialog(true);
                      }}
                      className="v2-btn"
                      style={{ padding: "4px 8px", fontSize: 10 }}
                      type="button"
                    >
                      Save as Preset
                    </button>
                  )}
                </div>
                {music?.uploading && (
                  <div style={{ marginTop: 4, marginLeft: 8 }}>
                    <div
                      style={{
                        height: 3,
                        width: 100,
                        background: "rgba(var(--v2-accent-rgb), 0.1)",
                        borderRadius: 2,
                        overflow: "hidden",
                        display: "inline-block",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${music.uploadProgress || 0}%`,
                          background: "var(--v2-accent)",
                          transition: "width 0.2s ease",
                        }}
                      />
                    </div>
                    <span
                      style={{
                        color: "var(--v2-text-3)",
                        fontSize: 10,
                        marginLeft: 4,
                      }}
                    >
                      {music.uploadProgress || 0}%
                    </span>
                  </div>
                )}
                {music?.error && (
                  <div
                    style={{
                      color: "var(--v2-error)",
                      fontSize: 10,
                      marginLeft: 8,
                      marginTop: 2,
                    }}
                  >
                    {music.error}
                  </div>
                )}
              </div>
            )}
            {music && (
              <div style={{ marginTop: 12 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--v2-text-2)",
                    marginBottom: 8,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Music Volume: {musicVolume}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={musicVolume}
                  onChange={(e) => setMusicVolume(parseInt(e.target.value, 10))}
                  className="w-full"
                />
              </div>
            )}
            {music && (
              <div className="mt-4 p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                <h4 className="text-sm font-semibold text-purple-300 mb-3 flex items-center gap-2">
                  <FileAudio className="w-4 h-4" />
                  Audio Processing Details
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-center py-1 border-b border-purple-500/10">
                    <span className="text-gray-400">Voice normalization:</span>
                    <span className="text-gray-200 font-mono font-semibold">
                      -14 LUFS
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-purple-500/10">
                    <span className="text-gray-400">
                      Music volume ({musicVolume}%):
                    </span>
                    <span className="text-gray-200 font-mono font-semibold">
                      {calculateDisplayVolume(musicVolume)} dB
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-purple-500/10">
                    <span className="text-gray-400">Music looping:</span>
                    <span className="text-green-400 font-semibold">
                      Auto (full video)
                    </span>
                  </div>
                  <div className="mt-3 pt-3 border-t border-purple-500/20">
                    <p className="text-gray-400 leading-relaxed">
                      <span className="text-purple-300 font-semibold">
                        Two-pass LUFS:
                      </span>{" "}
                      Voice audio normalized to YouTube/podcast standard (-14
                      LUFS). Videos without audio use music-only mode.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Transition Type */}
          <V2Select
            label="Transition Type"
            value={transitionType}
            onChange={(e) => {
              setTransitionType(e.target.value);
              if (e.target.value === "hard_cut") {
                setTransitionDuration(0);
              } else if (transitionDuration === 0) {
                setTransitionDuration(1);
              }
            }}
            options={[
              { value: "hard_cut", label: "Hard Cut (instant)" },
              { value: "fade", label: "Crossfade (smooth blend)" },
              { value: "fadeblack", label: "Fade to Black" },
              { value: "wipeleft", label: "Wipe Left" },
              { value: "wiperight", label: "Wipe Right" },
            ]}
            fullWidth
          />

          {/* Transition Duration (only if not hard_cut) */}
          {transitionType !== "hard_cut" && (
            <>
              <V2Input
                label="Transition Duration (seconds)"
                type="number"
                value={transitionDuration}
                onChange={(e) =>
                  setTransitionDuration(parseFloat(e.target.value) || 0)
                }
                min="0"
                step="0.1"
                fullWidth
              />
              {transitionDuration > 0 && (
                <div className="mt-2 p-2 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-gray-400">
                  <p>
                    Transition effect will last {transitionDuration}s between
                    each video
                  </p>
                </div>
              )}
            </>
          )}

          {/* Captions */}
          <div
            style={{
              gridColumn: "1 / -1",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={captionsEnabled}
                onChange={(e) => setCaptionsEnabled(e.target.checked)}
                className="w-4 h-4"
              />
              <span
                style={{
                  color: "var(--v2-text-1)",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                Enable Captions
              </span>
            </label>

            {captionsEnabled && (
              <>
                <V2Select
                  label="Caption Preset"
                  value={selectedPresetId}
                  onChange={(e) => setSelectedPresetId(e.target.value)}
                  options={presetOptions}
                  fullWidth
                />
                {selectedPresetId && (
                  <>
                    {/* Font Family Dropdown */}
                    <V2Select
                      label="Font Family"
                      value={captionConfig.font_family}
                      onChange={(e) =>
                        setCaptionConfig({
                          ...captionConfig,
                          font_family: e.target.value,
                        })
                      }
                      options={[
                        { value: "Montserrat", label: "Montserrat" },
                        { value: "Inter", label: "Inter" },
                        { value: "Arial", label: "Arial" },
                      ]}
                      fullWidth
                    />

                    {/* Font Size Slider */}
                    <div className="mt-3">
                      <label
                        style={{
                          color: "var(--v2-text-2)",
                          fontSize: 12,
                          fontWeight: 500,
                          marginBottom: 8,
                          display: "block",
                        }}
                      >
                        Font Size: {captionConfig.font_size}pt
                      </label>
                      <input
                        type="range"
                        id="caption-font-size"
                        name="caption_font_size"
                        aria-label="Caption font size in points"
                        min="48"
                        max="96"
                        step="4"
                        value={captionConfig.font_size}
                        onChange={(e) =>
                          setCaptionConfig({
                            ...captionConfig,
                            font_size: parseInt(e.target.value),
                          })
                        }
                        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                      />
                    </div>

                    {/* Vertical Position Slider */}
                    <div className="mt-3">
                      <label
                        style={{
                          color: "var(--v2-text-2)",
                          fontSize: 12,
                          fontWeight: 500,
                          marginBottom: 8,
                          display: "block",
                        }}
                      >
                        Vertical Position:{" "}
                        {captionConfig.vertical_offset_percent}% from bottom
                      </label>
                      <input
                        type="range"
                        id="caption-vertical-position"
                        name="caption_vertical_position"
                        aria-label="Caption vertical position from bottom in percent"
                        min="10"
                        max="30"
                        step="2"
                        value={captionConfig.vertical_offset_percent}
                        onChange={(e) =>
                          setCaptionConfig({
                            ...captionConfig,
                            vertical_offset_percent: parseInt(e.target.value),
                          })
                        }
                        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                      />
                    </div>

                    {/* Outline Width Slider */}
                    <div className="mt-3">
                      <label
                        style={{
                          color: "var(--v2-text-2)",
                          fontSize: 12,
                          fontWeight: 500,
                          marginBottom: 8,
                          display: "block",
                        }}
                      >
                        Outline Width: {captionConfig.outline_width}px
                      </label>
                      <input
                        type="range"
                        id="caption-outline-width"
                        name="caption_outline_width"
                        aria-label="Caption text outline width in pixels"
                        min="2"
                        max="6"
                        step="1"
                        value={captionConfig.outline_width}
                        onChange={(e) =>
                          setCaptionConfig({
                            ...captionConfig,
                            outline_width: parseInt(e.target.value),
                          })
                        }
                        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                      />
                    </div>

                    <div className="mt-3">
                      <label
                        style={{
                          color: "var(--v2-text-2)",
                          fontSize: 12,
                          fontWeight: 500,
                          marginBottom: 8,
                          display: "block",
                        }}
                      >
                        Words per Block: {wordsPerBlock}
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="8"
                        step="1"
                        value={wordsPerBlock}
                        onChange={(e) =>
                          setWordsPerBlock(parseInt(e.target.value))
                        }
                        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                      />
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>1 word</span>
                        <span>8 words</span>
                      </div>
                    </div>

                    {/* Caption Renderer Toggle */}
                    <div className="mt-3">
                      <label
                        style={{
                          color: "var(--v2-text-2)",
                          fontSize: 12,
                          fontWeight: 500,
                          marginBottom: 8,
                          display: "block",
                        }}
                      >
                        Caption Renderer
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setCaptionRenderer("ffmpeg")}
                          className="flex-1 px-3 py-2 rounded text-xs font-medium transition-all"
                          style={{
                            background:
                              captionRenderer === "ffmpeg"
                                ? "var(--v2-accent)"
                                : "rgba(255,255,255,0.05)",
                            color:
                              captionRenderer === "ffmpeg"
                                ? "#000"
                                : "var(--v2-text-2)",
                            border:
                              captionRenderer === "ffmpeg"
                                ? "1px solid var(--v2-accent)"
                                : "1px solid rgba(255,255,255,0.1)",
                          }}
                        >
                          FFmpeg (Fast)
                        </button>
                        <button
                          type="button"
                          onClick={() => setCaptionRenderer("remotion")}
                          className="flex-1 px-3 py-2 rounded text-xs font-medium transition-all"
                          style={{
                            background:
                              captionRenderer === "remotion"
                                ? "var(--v2-accent)"
                                : "rgba(255,255,255,0.05)",
                            color:
                              captionRenderer === "remotion"
                                ? "#000"
                                : "var(--v2-text-2)",
                            border:
                              captionRenderer === "remotion"
                                ? "1px solid var(--v2-accent)"
                                : "1px solid rgba(255,255,255,0.1)",
                          }}
                        >
                          Remotion (Beta)
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        {captionRenderer === "ffmpeg"
                          ? "Fast rendering with FFmpeg subtitle filter"
                          : "Higher quality captions with Remotion (slower, in development)"}
                      </p>
                    </div>

                    {/* Remotion Animation Preset Dropdown */}
                    {captionRenderer === "remotion" && (
                      <V2Select
                        label="Animation Style"
                        value={selectedRemotionPresetId}
                        onChange={(e) =>
                          setSelectedRemotionPresetId(e.target.value)
                        }
                        options={[
                          { value: "", label: "Select animation..." },
                          ...remotionCaptionPresets.map((preset) => ({
                            value: preset.id,
                            label: preset.name,
                          })),
                        ]}
                        fullWidth
                      />
                    )}

                    <div className="mt-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs">
                      <p className="text-blue-300 font-semibold mb-1">
                        Whisper AI Captions
                      </p>
                      <p className="text-gray-400 leading-relaxed">
                        Generates word-level timed captions from audio using
                        Whisper AI. Words appear in static blocks of{" "}
                        {wordsPerBlock} {wordsPerBlock === 1 ? "word" : "words"}
                        , with each word highlighting as it&apos;s spoken. No
                        flickering.
                      </p>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </GlassCard>

      {/* Error */}
      {error && (
        <GlassCard
          style={{
            padding: 16,
            background: "rgba(var(--v2-error-rgb), 0.1)",
            borderColor: "var(--v2-error)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <AlertCircle
              className="w-5 h-5"
              style={{ color: "var(--v2-error)" }}
            />
            <span style={{ color: "var(--v2-error)", fontSize: 13 }}>
              {error}
            </span>
          </div>
        </GlassCard>
      )}

      {/* Upload Progress Summary */}
      {videos.some((v) => v.uploading) && (
        <div className="mb-4 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-blue-300 mb-2 font-semibold">
            <Loader2 className="w-4 h-4 animate-spin" />
            Uploading {videos.filter((v) => v.uploading).length} of{" "}
            {videos.length} videos
          </div>
          <div className="w-full bg-gray-700/50 rounded-full h-2.5">
            <div
              className="bg-blue-500 h-2.5 rounded-full transition-all duration-300"
              style={{
                width: `${(videos.filter((v) => !v.uploading).length / videos.length) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Validation Feedback (create flow only) */}
      {!finalizeMode && !canSubmit.ready && (
        <div className="mb-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-yellow-300">
              Cannot add to queue
            </div>
            <div className="text-sm text-yellow-200/80">{canSubmit.reason}</div>
          </div>
        </div>
      )}

      {/* Error feedback (finalize flow) */}
      {finalizeMode && error && (
        <div className="mb-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-red-200/90">{error}</div>
        </div>
      )}

      {/* CTA: Start render (finalize) or Add to Queue (create) */}
      {finalizeMode ? (
        <button
          onClick={handleStartFinalize}
          disabled={submitting}
          className="v2-btn-accent"
          style={{ padding: "12px 24px", fontSize: 14, fontWeight: 600 }}
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Starting render...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Start render
            </>
          )}
        </button>
      ) : (
        <button
          onClick={handleSubmit}
          disabled={submitting || !canSubmit.ready}
          className="v2-btn-accent"
          style={{ padding: "12px 24px", fontSize: 14, fontWeight: 600 }}
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Creating Job...
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4" />
              Add to Queue
            </>
          )}
        </button>
      )}

      {/* Queue Section */}
      <GlassCard style={{ padding: 24 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h2
            style={{
              color: "var(--v2-text-1)",
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            Recent Jobs
          </h2>
          <div style={{ display: "flex", gap: 8 }}>
            {jobs.some(
              (j) => j.status === "PROCESSING" || j.status === "PENDING",
            ) && (
              <button
                onClick={deleteAllProcessingJobs}
                className="v2-btn-error"
                style={{ padding: "6px 12px", fontSize: 11 }}
              >
                <X className="w-3 h-3" />
                Delete All Processing
              </button>
            )}
            {jobs.some((j) => j.status === "FAILED") && (
              <button
                onClick={async () => {
                  const failedJobs = jobs.filter((j) => j.status === "FAILED");
                  if (
                    !confirm(`Delete all ${failedJobs.length} failed job(s)?`)
                  )
                    return;
                  try {
                    await Promise.all(
                      failedJobs.map((j) =>
                        fetch(`/api/video-stitch/jobs/${j.id}`, {
                          method: "DELETE",
                        }),
                      ),
                    );
                    setJobs((prev) =>
                      prev.filter((j) => j.status !== "FAILED"),
                    );
                  } catch (err) {
                    console.error("Failed to delete failed jobs", err);
                    alert("Failed to delete some jobs");
                  }
                }}
                className="v2-btn-error"
                style={{ padding: "6px 12px", fontSize: 11 }}
              >
                <X className="w-3 h-3" />
                Delete All Failed
              </button>
            )}
          </div>
        </div>
        {jobs.slice(0, 6).map((job) => (
          <div
            key={job.id}
            style={{
              padding: 12,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.05)",
              borderRadius: 8,
              marginBottom: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  color: "var(--v2-text-1)",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                {job.output_filename}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    color:
                      job.status === "RENDERED"
                        ? "var(--v2-success)"
                        : job.status === "PROCESSING"
                          ? "var(--v2-accent)"
                          : job.status === "FAILED"
                            ? "var(--v2-error)"
                            : job.status === "DRAFT"
                              ? "#a78bfa"
                              : "var(--v2-text-3)",
                    background:
                      job.status === "RENDERED"
                        ? "rgba(var(--v2-success-rgb), 0.2)"
                        : job.status === "PROCESSING"
                          ? "rgba(var(--v2-accent-rgb), 0.2)"
                          : job.status === "FAILED"
                            ? "rgba(var(--v2-error-rgb), 0.2)"
                            : job.status === "DRAFT"
                              ? "rgba(167, 139, 250, 0.15)"
                              : "rgba(255,255,255,0.1)",
                  }}
                >
                  {job.status}
                </div>
                {job.status === "DRAFT" && (
                  <button
                    onClick={() => startJob(job.id)}
                    disabled={startingJobId === job.id}
                    className="v2-btn-accent"
                    style={{ padding: "4px 8px", fontSize: 10 }}
                    title="Start render"
                  >
                    {startingJobId === job.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Play className="w-3 h-3" />
                    )}
                    Start render
                  </button>
                )}
                {(job.status === "PROCESSING" || job.status === "PENDING") && (
                  <button
                    onClick={() => cancelJob(job.id)}
                    className="v2-btn-error"
                    style={{ padding: "4px 8px", fontSize: 10 }}
                    title="Cancel and delete"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
                {job.status === "FAILED" && (
                  <button
                    onClick={() => deleteJob(job.id)}
                    className="v2-btn-error"
                    style={{ padding: "4px 8px", fontSize: 10 }}
                    title="Delete failed job"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
            {job.status === "PROCESSING" && (
              <div style={{ marginTop: 8 }}>
                <div
                  style={{
                    height: 4,
                    background: "rgba(255,255,255,0.1)",
                    borderRadius: 2,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      background: "var(--v2-accent)",
                      width: `${job.progress}%`,
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
                <div
                  style={{
                    color: "var(--v2-text-3)",
                    fontSize: 10,
                    marginTop: 4,
                  }}
                >
                  {job.progress}% complete
                </div>
              </div>
            )}
            {job.error_message && (
              <div
                style={{ color: "var(--v2-error)", fontSize: 11, marginTop: 4 }}
              >
                {job.error_message}
              </div>
            )}
            <div
              style={{ color: "var(--v2-text-3)", fontSize: 10, marginTop: 4 }}
            >
              Created {new Date(job.created_at).toLocaleString()}
            </div>
          </div>
        ))}
      </GlassCard>

      {/* Results Tabs */}
      <GlassCard style={{ padding: 24 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button
            onClick={() => setActiveTab("completed")}
            className={cn(
              "px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors",
              activeTab === "completed"
                ? "bg-[var(--v2-accent)]/20 border-[var(--v2-accent)] text-[var(--v2-accent)]"
                : "bg-[var(--v2-surface-2)] border-[var(--v2-border-1)] text-[var(--v2-text-2)]",
            )}
            style={{ border: "1px solid" }}
          >
            Completed ({completedJobs.length})
          </button>
          <button
            onClick={() => setActiveTab("uploaded")}
            className={cn(
              "px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors",
              activeTab === "uploaded"
                ? "bg-[var(--v2-accent)]/20 border-[var(--v2-accent)] text-[var(--v2-accent)]"
                : "bg-[var(--v2-surface-2)] border-[var(--v2-border-1)] text-[var(--v2-text-2)]",
            )}
            style={{ border: "1px solid" }}
          >
            Uploaded ({uploadedJobs.length})
          </button>
        </div>

        {activeTab === "completed" && (
          <div>
            {completedJobs.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: 32,
                  color: "var(--v2-text-3)",
                  fontSize: 13,
                }}
              >
                No completed jobs yet
              </div>
            ) : (
              completedJobs.map((job) => (
                <div
                  key={job.id}
                  style={{
                    padding: 12,
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.05)",
                    borderRadius: 8,
                    marginBottom: 8,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          color: "var(--v2-text-1)",
                          fontSize: 13,
                          fontWeight: 500,
                        }}
                      >
                        {job.output_filename}
                      </div>
                      <div
                        style={{
                          color: "var(--v2-text-3)",
                          fontSize: 10,
                          marginTop: 4,
                        }}
                      >
                        Completed {new Date(job.updated_at).toLocaleString()}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() =>
                          setPreviewJobId((cur) =>
                            cur === job.id ? null : job.id,
                          )
                        }
                        className="v2-btn"
                        style={{ padding: "6px 12px", fontSize: 11 }}
                        title="Preview in browser"
                      >
                        <Play className="w-3 h-3" />
                        {previewJobId === job.id ? "Hide" : "Preview"}
                      </button>
                      <button
                        onClick={() =>
                          downloadVideo(job.id, job.output_filename)
                        }
                        className="v2-btn-accent"
                        style={{ padding: "6px 12px", fontSize: 11 }}
                      >
                        <Download className="w-3 h-3" />
                        Download
                      </button>
                      <button
                        onClick={() => markJobAsUploaded(job.id)}
                        className="v2-btn"
                        style={{ padding: "6px 12px", fontSize: 11 }}
                        title="Mark as uploaded"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        Uploaded
                      </button>
                      <button
                        onClick={() => deleteJob(job.id)}
                        className="v2-btn-error"
                        style={{ padding: "6px 12px", fontSize: 11 }}
                        title="Delete job"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  {previewJobId === job.id && (
                    <video
                      controls
                      autoPlay
                      preload="metadata"
                      src={`/api/video-stitch/jobs/${job.id}/preview`}
                      style={{
                        width: "100%",
                        maxHeight: 460,
                        borderRadius: 6,
                        background: "#000",
                      }}
                    />
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "uploaded" && (
          <div>
            {uploadedJobs.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: 32,
                  color: "var(--v2-text-3)",
                  fontSize: 13,
                }}
              >
                No uploaded jobs yet
              </div>
            ) : (
              uploadedJobs.map((job) => (
                <div
                  key={job.id}
                  style={{
                    padding: 12,
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.05)",
                    borderRadius: 8,
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      color: "var(--v2-text-1)",
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    {job.output_filename}
                  </div>
                  <div
                    style={{
                      color: "var(--v2-text-3)",
                      fontSize: 10,
                      marginTop: 4,
                    }}
                  >
                    Uploaded {new Date(job.updated_at).toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </GlassCard>

      {/* Save Music Preset Dialog */}
      {showSavePresetDialog && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => setShowSavePresetDialog(false)}
        >
          <div
            style={{
              background: "var(--v2-surface-1)",
              borderRadius: 12,
              padding: 24,
              maxWidth: 400,
              width: "90%",
              border: "1px solid var(--v2-border-1)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                color: "var(--v2-text-1)",
                fontSize: 16,
                fontWeight: 700,
                marginBottom: 16,
              }}
            >
              Save Music Preset
            </h3>
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Preset name"
              style={{
                width: "100%",
                padding: 8,
                background: "var(--v2-surface-2)",
                border: "1px solid var(--v2-border-1)",
                borderRadius: 6,
                color: "var(--v2-text-1)",
                fontSize: 13,
                marginBottom: 16,
              }}
            />
            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <button
                onClick={() => {
                  setShowSavePresetDialog(false);
                  setPresetName("");
                }}
                className="v2-btn"
                style={{ padding: "8px 16px", fontSize: 12 }}
              >
                Cancel
              </button>
              <button
                onClick={saveMusicAsPreset}
                disabled={!presetName.trim()}
                className="v2-btn-accent"
                style={{ padding: "8px 16px", fontSize: 12 }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
