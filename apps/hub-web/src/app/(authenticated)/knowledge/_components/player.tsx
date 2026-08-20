"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import type {
  Course,
  CourseChapter,
  CourseVideo,
  VideoWatchProgress,
  VideoNote,
} from "@repo/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface CourseVideoWithProgress extends CourseVideo {
  progress: VideoWatchProgress | null;
}
interface ChapterWithVideos extends CourseChapter {
  videos: CourseVideoWithProgress[];
}
interface CourseWithChapters extends Course {
  chapters: ChapterWithVideos[];
  totalVideos: number;
  completedVideos: number;
}
interface VideoDetail extends CourseVideo {
  chapter: CourseChapter & { course: Course };
  progress: VideoWatchProgress | null;
}
interface NextVideoInfo {
  id: string;
  title: string;
}

interface PlayerProps {
  course: CourseWithChapters;
  video: VideoDetail;
  streamUrl: string;
  initialNotes: VideoNote[];
  userId: string;
  nextVideo: NextVideoInfo | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ICON_MAP: Record<string, string> = {
  Rocket: "rocket_launch",
  BookOpen: "menu_book",
  Search: "search",
  Sliders: "tune",
  Zap: "bolt",
  Users: "group",
  TrendingUp: "trending_up",
  DollarSign: "attach_money",
};

function formatTime(secs: number): string {
  if (!isFinite(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Chapter Sidebar
// ---------------------------------------------------------------------------
function ChapterSidebar({
  course,
  currentVideoId,
  completionMap,
}: {
  course: CourseWithChapters;
  currentVideoId: string;
  completionMap: Record<string, boolean>;
}) {
  const [openChapters, setOpenChapters] = useState<Record<string, boolean>>(
    () => {
      const init: Record<string, boolean> = {};
      for (const ch of course.chapters) {
        init[ch.id] =
          ch.videos.some((v) => v.id === currentVideoId) ||
          ch.order_index === 0;
      }
      return init;
    },
  );

  const completedCount = Object.values(completionMap).filter(Boolean).length;
  const pct =
    course.totalVideos > 0
      ? Math.round((completedCount / course.totalVideos) * 100)
      : 0;

  return (
    <aside
      className="flex-shrink-0 h-full flex flex-col overflow-hidden"
      style={{
        width: 280,
        background: "#000",
        borderRight: "1px solid rgba(var(--v2-accent-rgb), 0.10)",
      }}
    >
      {/* Back link */}
      <div
        className="px-4 py-4 flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.08)" }}
      >
        <Link
          href={`/knowledge/${course.id}`}
          className="flex items-center gap-2 transition-colors"
          style={{
            color: "rgba(229,226,225,0.4)",
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            fontWeight: 600,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            arrow_back
          </span>
          All Modules
        </Link>
      </div>

      {/* Course header + progress */}
      <div
        className="px-4 py-4 flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.08)" }}
      >
        <p
          style={{
            color: "#eceae6",
            fontSize: 12,
            fontWeight: 700,
            lineHeight: 1.4,
            marginBottom: 8,
          }}
        >
          {course.title}
        </p>
        <div className="flex items-center justify-between mb-1.5">
          <span
            style={{
              fontSize: 10,
              color: "rgba(229,226,225,0.35)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {completedCount} / {course.totalVideos} watched
          </span>
          <span
            style={{ fontSize: 10, fontWeight: 700, color: "var(--v2-accent)" }}
          >
            {pct}%
          </span>
        </div>
        <div
          style={{
            height: 3,
            borderRadius: 3,
            background: "rgba(255,255,255,0.06)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              borderRadius: 3,
              width: `${pct}%`,
              background:
                "linear-gradient(to right, var(--v2-accent), var(--v2-accent-dim))",
              transition: "width 0.6s ease",
            }}
          />
        </div>
      </div>

      {/* Chapter list */}
      <nav
        className="flex-1 overflow-y-auto"
        style={{ scrollbarWidth: "thin" }}
      >
        {course.chapters.map((chapter) => {
          const isOpen = !!openChapters[chapter.id];
          const chapterDone =
            chapter.videos.length > 0 &&
            chapter.videos.every((v) => completionMap[v.id]);
          const matIcon = ICON_MAP[chapter.icon ?? ""] ?? "menu_book";
          const cleanTitle = chapter.title.replace(/^Module \d+ — /, "");

          return (
            <div
              key={chapter.id}
              style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
            >
              <button
                onClick={() =>
                  setOpenChapters((prev) => ({
                    ...prev,
                    [chapter.id]: !prev[chapter.id],
                  }))
                }
                className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors"
                style={{
                  background: isOpen
                    ? "rgba(var(--v2-accent-rgb), 0.04)"
                    : "transparent",
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="material-symbols-outlined flex-shrink-0"
                    style={{
                      fontSize: 14,
                      color: chapterDone
                        ? "var(--v2-accent)"
                        : "rgba(229,226,225,0.3)",
                      fontVariationSettings: chapterDone
                        ? "'FILL' 1"
                        : "'FILL' 0",
                    }}
                  >
                    {chapterDone ? "check_circle" : matIcon}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "rgba(229,226,225,0.8)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {cleanTitle}
                  </span>
                </div>
                <span
                  className="material-symbols-outlined flex-shrink-0 transition-transform duration-200"
                  style={{
                    fontSize: 16,
                    color: "rgba(229,226,225,0.25)",
                    transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                  }}
                >
                  expand_more
                </span>
              </button>

              {isOpen && (
                <div className="pb-1">
                  {chapter.videos.map((video) => {
                    const isActive = video.id === currentVideoId;
                    const isDone = !!completionMap[video.id];

                    return (
                      <Link
                        key={video.id}
                        href={`/knowledge/${course.id}/${video.id}`}
                        className="flex items-start gap-3 px-4 py-2.5 transition-all"
                        style={{
                          background: isActive
                            ? "linear-gradient(to right, rgba(var(--v2-accent-rgb), 0.12), transparent)"
                            : "transparent",
                          borderLeft: isActive
                            ? "3px solid var(--v2-accent)"
                            : "3px solid transparent",
                        }}
                      >
                        <span
                          className="material-symbols-outlined flex-shrink-0 mt-0.5"
                          style={{
                            fontSize: 14,
                            color: isDone
                              ? "var(--v2-accent)"
                              : isActive
                                ? "var(--v2-accent)"
                                : "rgba(229,226,225,0.2)",
                            fontVariationSettings: isDone
                              ? "'FILL' 1"
                              : "'FILL' 0",
                          }}
                        >
                          {isDone ? "check_circle" : "radio_button_unchecked"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p
                            style={{
                              fontSize: 11,
                              lineHeight: 1.4,
                              fontWeight: isActive ? 600 : 400,
                              color: isActive
                                ? "var(--v2-accent)"
                                : isDone
                                  ? "rgba(229,226,225,0.4)"
                                  : "rgba(229,226,225,0.75)",
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {video.title}
                          </p>
                          {video.duration_seconds != null && (
                            <span
                              style={{
                                fontSize: 9,
                                color: "rgba(229,226,225,0.3)",
                                marginTop: 2,
                                display: "flex",
                                alignItems: "center",
                                gap: 2,
                              }}
                            >
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: 11 }}
                              >
                                schedule
                              </span>
                              {formatTime(video.duration_seconds)}
                            </span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Video Player
// ---------------------------------------------------------------------------

// Logarithmic speed scale: slider 0–100 maps to 0.25×–4× with 1× at midpoint (50)
const SPEED_MIN = 0.25;
const SPEED_MAX = 4;
function sliderToSpeed(val: number): number {
  return SPEED_MIN * Math.pow(SPEED_MAX / SPEED_MIN, val / 100);
}
function speedToSlider(s: number): number {
  return Math.round(
    (Math.log(s / SPEED_MIN) / Math.log(SPEED_MAX / SPEED_MIN)) * 100,
  );
}
function fmtSpeed(s: number): string {
  return parseFloat(s.toFixed(2)).toString() + "×";
}

function VideoPlayer({
  streamUrl,
  videoId,
  initialPosition,
  onComplete,
  onProgress,
  onTimeChange,
  onEnded,
}: {
  streamUrl: string;
  videoId: string;
  initialPosition: number;
  onComplete: () => void;
  onProgress: (pos: number) => void;
  onTimeChange?: (pos: number) => void;
  onEnded?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completedRef = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(100); // 0–100
  const [currentTime, setCurrentTime] = useState(initialPosition);
  const [duration, setDuration] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  // sliderVal 0–100, logarithmically mapped; spaceTurbo = hold-space 2× mode
  const [sliderVal, setSliderVal] = useState(speedToSlider(1)); // 50
  const [spaceTurbo, setSpaceTurbo] = useState(false);

  const activeSpeed = spaceTurbo ? 2 : sliderToSpeed(sliderVal);

  // Apply speed to video whenever it changes
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = activeSpeed;
  }, [activeSpeed]);

  // Apply volume to video whenever it changes
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume / 100;
  }, [volume]);

  // Seek to saved position on load
  useEffect(() => {
    const video = videoRef.current;
    if (!video || initialPosition <= 0) return;
    const handler = () => {
      video.currentTime = initialPosition;
    };
    video.addEventListener("loadedmetadata", handler, { once: true });
    return () => video.removeEventListener("loadedmetadata", handler);
  }, [initialPosition, streamUrl]);

  // Reset on video change
  useEffect(() => {
    completedRef.current = false;
    setSpaceTurbo(false);
  }, [videoId]);

  // Hold-Space → 2× turbo (ignored when typing in inputs)
  useEffect(() => {
    function onDown(e: KeyboardEvent) {
      if (e.code !== "Space" || e.repeat) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      setSpaceTurbo(true);
    }
    function onUp(e: KeyboardEvent) {
      if (e.code === "Space") setSpaceTurbo(false);
    }
    document.addEventListener("keydown", onDown);
    document.addEventListener("keyup", onUp);
    return () => {
      document.removeEventListener("keydown", onDown);
      document.removeEventListener("keyup", onUp);
    };
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const t = video.currentTime;
    setCurrentTime(t);
    onTimeChange?.(t);
    if (
      !completedRef.current &&
      video.duration > 0 &&
      t / video.duration >= 0.9
    ) {
      completedRef.current = true;
      onComplete();
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => onProgress(Math.floor(t)), 5000);
  }, [onComplete, onProgress, onTimeChange]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    v.paused ? v.play().catch(() => {}) : v.pause();
  }
  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = parseFloat(e.target.value);
  }
  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }
  function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseInt(e.target.value);
    setVolume(val);
    // Unmute automatically when dragging slider up from 0
    if (val > 0 && muted) {
      const v = videoRef.current;
      if (v) {
        v.muted = false;
        setMuted(false);
      }
    }
  }
  function volIcon(): string {
    if (muted || volume === 0) return "volume_off";
    if (volume < 34) return "volume_mute";
    if (volume < 67) return "volume_down";
    return "volume_up";
  }
  function toggleFullscreen() {
    const el = containerRef.current;
    if (!el) return;
    document.fullscreenElement
      ? document.exitFullscreen()
      : el.requestFullscreen();
  }
  function handleMouseMove() {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (playing)
      hideTimer.current = setTimeout(() => setControlsVisible(false), 3000);
  }

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const isCustomSpeed = sliderVal !== speedToSlider(1);

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-video rounded-xl overflow-hidden"
      style={{ background: "#000" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => playing && setControlsVisible(false)}
    >
      <video
        ref={videoRef}
        src={streamUrl}
        className="w-full h-full object-contain"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={onEnded}
        onClick={togglePlay}
        preload="metadata"
      />

      {/* Space-turbo flash indicator */}
      {spaceTurbo && (
        <div
          className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full"
          style={{
            background: "rgba(var(--v2-accent-rgb), 0.20)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.5)",
            backdropFilter: "blur(6px)",
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 13,
              color: "var(--v2-accent)",
              fontVariationSettings: "'FILL' 1",
            }}
          >
            fast_forward
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: "var(--v2-accent)",
              fontFamily: "monospace",
            }}
          >
            2× TURBO
          </span>
        </div>
      )}

      {/* Big play overlay when paused */}
      {!playing && (
        <div
          className="absolute inset-0 flex items-center justify-center cursor-pointer"
          onClick={togglePlay}
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center transition-transform hover:scale-110"
            style={{
              background:
                "linear-gradient(135deg, var(--v2-accent), var(--v2-accent-dim))",
              boxShadow: "0 0 30px rgba(var(--v2-accent-rgb), 0.4)",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: 32,
                color: "#000",
                fontVariationSettings: "'FILL' 1",
              }}
            >
              play_arrow
            </span>
          </div>
        </div>
      )}

      {/* Controls bar */}
      <div
        className="absolute bottom-0 left-0 right-0 flex flex-col gap-2 px-4 pt-8 pb-3 transition-opacity duration-300"
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,0.88), transparent)",
          opacity: controlsVisible || !playing ? 1 : 0,
        }}
      >
        {/* Scrubber */}
        <input
          type="range"
          min={0}
          max={duration || 100}
          step={0.5}
          value={currentTime}
          className="scrubber"
          onChange={handleSeek}
          style={{
            width: "100%",
            height: 4,
            appearance: "none",
            borderRadius: 4,
            outline: "none",
            cursor: "pointer",
            background: `linear-gradient(to right, var(--v2-accent) ${pct}%, rgba(255,255,255,0.15) ${pct}%)`,
          }}
        />

        {/* Main controls row */}
        <div className="flex items-center justify-between">
          {/* Left: play, volume control, time */}
          <div className="flex items-center gap-3">
            <button onClick={togglePlay} style={{ color: "#fff" }}>
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 22, fontVariationSettings: "'FILL' 1" }}
              >
                {playing ? "pause" : "play_arrow"}
              </span>
            </button>

            {/* Volume: icon + slider + 1× reset */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={toggleMute}
                style={{ color: "#fff", lineHeight: 1 }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}
                >
                  {volIcon()}
                </span>
              </button>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={muted ? 0 : volume}
                onChange={handleVolumeChange}
                title={`Volume: ${muted ? 0 : volume}%`}
                style={{
                  width: 72,
                  height: 3,
                  appearance: "none",
                  borderRadius: 3,
                  outline: "none",
                  cursor: "pointer",
                  background: `linear-gradient(to right, rgba(255,255,255,0.85) ${muted ? 0 : volume}%, rgba(255,255,255,0.18) ${muted ? 0 : volume}%)`,
                }}
              />
              {(volume !== 100 || muted) && (
                <button
                  onClick={() => {
                    setVolume(100);
                    setMuted(false);
                    if (videoRef.current) {
                      videoRef.current.volume = 1;
                      videoRef.current.muted = false;
                    }
                  }}
                  title="Reset to 100%"
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    fontFamily: "monospace",
                    color: "var(--v2-accent)",
                    background: "rgba(var(--v2-accent-rgb), 0.12)",
                    border: "1px solid rgba(var(--v2-accent-rgb), 0.3)",
                    borderRadius: 4,
                    padding: "1px 5px",
                    cursor: "pointer",
                    lineHeight: 1.6,
                  }}
                >
                  1×
                </button>
              )}
            </div>

            <span
              style={{
                color: "rgba(255,255,255,0.6)",
                fontSize: 11,
                fontFamily: "monospace",
              }}
            >
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          {/* Right: speed slider + fullscreen */}
          <div className="flex items-center gap-3">
            {/* Speed control */}
            <div className="flex items-center gap-2">
              {/* Speed label */}
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: "monospace",
                  minWidth: 34,
                  textAlign: "right",
                  color: spaceTurbo
                    ? "var(--v2-accent)"
                    : isCustomSpeed
                      ? "var(--v2-accent)"
                      : "rgba(255,255,255,0.55)",
                  transition: "color 0.15s",
                }}
              >
                {spaceTurbo ? "2×" : fmtSpeed(sliderToSpeed(sliderVal))}
              </span>

              {/* Logarithmic slider */}
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={sliderVal}
                onChange={(e) => setSliderVal(parseInt(e.target.value))}
                title={`Playback speed: ${fmtSpeed(sliderToSpeed(sliderVal))}`}
                style={{
                  width: 80,
                  height: 3,
                  appearance: "none",
                  borderRadius: 3,
                  outline: "none",
                  cursor: "pointer",
                  background: `linear-gradient(to right, ${isCustomSpeed ? "var(--v2-accent)" : "rgba(255,255,255,0.5)"} ${sliderVal}%, rgba(255,255,255,0.15) ${sliderVal}%)`,
                  opacity: spaceTurbo ? 0.4 : 1,
                  transition: "opacity 0.15s",
                }}
              />

              {/* Space hint badge */}
              <span
                title="Hold Space bar for instant 2× turbo speed"
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.35)",
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 4,
                  padding: "1px 5px",
                  fontFamily: "monospace",
                  cursor: "default",
                  letterSpacing: "0.03em",
                  userSelect: "none",
                }}
              >
                ⎵ 2×
              </span>
            </div>

            <button onClick={toggleFullscreen} style={{ color: "#fff" }}>
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 20 }}
              >
                fullscreen
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Autoplay countdown overlay
// ---------------------------------------------------------------------------
function AutoplayOverlay({
  nextVideo,
  courseId,
  onCancel,
}: {
  nextVideo: NextVideoInfo;
  courseId: string;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (countdown <= 0) {
      router.push(`/knowledge/${courseId}/${nextVideo.id}`);
      return;
    }
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown, courseId, nextVideo.id, router]);

  const pct = ((5 - countdown) / 5) * 100;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{
        background: "rgba(0,0,0,0.82)",
        backdropFilter: "blur(4px)",
        zIndex: 10,
      }}
    >
      <div
        className="flex flex-col items-center gap-5 p-8 rounded-2xl"
        style={{
          background: "rgba(var(--v2-accent-rgb), 0.06)",
          border: "1px solid rgba(var(--v2-accent-rgb), 0.18)",
          maxWidth: 400,
          width: "90%",
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: 40,
            color: "var(--v2-accent)",
            fontVariationSettings: "'FILL' 1",
          }}
        >
          skip_next
        </span>
        <div className="text-center space-y-1">
          <p
            style={{
              fontSize: 11,
              color: "rgba(229,226,225,0.4)",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
            }}
          >
            Up next
          </p>
          <p
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#eceae6",
              lineHeight: 1.4,
            }}
          >
            {nextVideo.title}
          </p>
        </div>

        {/* Countdown bar */}
        <div
          style={{
            width: "100%",
            height: 4,
            borderRadius: 4,
            background: "rgba(255,255,255,0.1)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              borderRadius: 4,
              width: `${pct}%`,
              background:
                "linear-gradient(to right, var(--v2-accent), var(--v2-accent-dim))",
              transition: "width 1s linear",
            }}
          />
        </div>

        <p style={{ fontSize: 12, color: "rgba(229,226,225,0.5)" }}>
          Playing in {countdown}s
        </p>

        <div className="flex items-center gap-3">
          <button
            onClick={() =>
              router.push(`/knowledge/${courseId}/${nextVideo.id}`)
            }
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all"
            style={{ background: "var(--v2-accent)", color: "#000" }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 14 }}
            >
              play_arrow
            </span>
            Play Now
          </button>
          <button
            onClick={onCancel}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all"
            style={{
              background: "rgba(255,255,255,0.06)",
              color: "rgba(229,226,225,0.6)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notes panel
// ---------------------------------------------------------------------------
function NotesPanel({
  videoId,
  initialNotes,
  currentTime,
}: {
  videoId: string;
  initialNotes: VideoNote[];
  currentTime: number;
}) {
  const [notes, setNotes] = useState<VideoNote[]>(initialNotes);
  const [content, setContent] = useState("");
  const [useTimestamp, setUseTimestamp] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!content.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/knowledge/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId,
          content: content.trim(),
          timestampSeconds: useTimestamp ? Math.floor(currentTime) : null,
        }),
      });
      if (res.ok) {
        const { note } = await res.json();
        setNotes((prev) => [note, ...prev]);
        setContent("");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(noteId: string) {
    await fetch(`/api/knowledge/notes?noteId=${noteId}`, { method: "DELETE" });
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  }

  return (
    <div className="space-y-4">
      {/* Add note form */}
      <div
        className="space-y-3"
        style={{
          background: "rgba(var(--v2-accent-rgb), 0.04)",
          border: "1px solid rgba(var(--v2-accent-rgb), 0.10)",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Add a note..."
          rows={3}
          className="w-full resize-none focus:outline-none"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            color: "#eceae6",
            lineHeight: 1.6,
          }}
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useTimestamp}
              onChange={(e) => setUseTimestamp(e.target.checked)}
              style={{ accentColor: "var(--v2-accent)" }}
            />
            <span style={{ fontSize: 11, color: "rgba(229,226,225,0.4)" }}>
              Link to {formatTime(currentTime)}
            </span>
          </label>
          <button
            onClick={handleSave}
            disabled={!content.trim() || saving}
            className="flex items-center gap-1.5 transition-all"
            style={{
              background: "var(--v2-accent)",
              color: "#000",
              padding: "5px 14px",
              borderRadius: 8,
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              opacity: !content.trim() || saving ? 0.4 : 1,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 13 }}
            >
              add
            </span>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* Notes list */}
      {notes.length === 0 ? (
        <p
          style={{
            textAlign: "center",
            color: "rgba(229,226,225,0.3)",
            fontSize: 12,
            padding: "16px 0",
          }}
        >
          No notes yet.
        </p>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => (
            <div
              key={note.id}
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 10,
                padding: "10px 12px",
              }}
            >
              {note.timestamp_seconds != null && (
                <span
                  className="inline-flex items-center gap-1"
                  style={{
                    fontSize: 9,
                    color: "var(--v2-accent)",
                    fontFamily: "monospace",
                    background: "rgba(var(--v2-accent-rgb), 0.10)",
                    border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                    padding: "2px 8px",
                    borderRadius: 20,
                    marginBottom: 6,
                    display: "inline-flex",
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 10 }}
                  >
                    schedule
                  </span>
                  {formatTime(note.timestamp_seconds)}
                </span>
              )}
              <p
                style={{
                  fontSize: 12,
                  color: "rgba(229,226,225,0.8)",
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                }}
              >
                {note.content}
              </p>
              <div className="flex items-center justify-between mt-2">
                <span style={{ fontSize: 9, color: "rgba(229,226,225,0.25)" }}>
                  {new Date(note.created_at).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                <button
                  onClick={() => handleDelete(note.id)}
                  style={{ color: "rgba(229,226,225,0.25)" }}
                  className="hover:text-red-400 transition-colors"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 14 }}
                  >
                    delete
                  </span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Not generated yet" placeholder
// ---------------------------------------------------------------------------
function NotGenerated({ label, icon }: { label: string; icon: string }) {
  return (
    <div
      className="flex flex-col items-center gap-3 py-8"
      style={{ textAlign: "center" }}
    >
      <span
        className="material-symbols-outlined"
        style={{ fontSize: 36, color: "rgba(229,226,225,0.15)" }}
      >
        {icon}
      </span>
      <p
        style={{
          fontSize: 13,
          color: "rgba(229,226,225,0.3)",
          fontStyle: "italic",
        }}
      >
        {label} not generated yet.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export function V2KnowledgePlayer({
  course,
  video,
  streamUrl,
  initialNotes,
  nextVideo,
}: PlayerProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [activeTab, setActiveTab] = useState<
    "info" | "notes" | "transcript" | "report" | "takeaways"
  >("info");
  const [showAutoplay, setShowAutoplay] = useState(false);

  const [completionMap, setCompletionMap] = useState<Record<string, boolean>>(
    () => {
      const map: Record<string, boolean> = {};
      for (const ch of course.chapters) {
        for (const v of ch.videos) {
          map[v.id] = v.progress?.is_completed ?? false;
        }
      }
      return map;
    },
  );

  const handleComplete = useCallback(async () => {
    setCompletionMap((prev) => ({ ...prev, [video.id]: true }));
    await fetch("/api/knowledge/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoId: video.id,
        lastPositionSeconds: Math.floor(currentTime),
        isCompleted: true,
      }),
    });
  }, [video.id, currentTime]);

  const handleProgress = useCallback(
    async (pos: number) => {
      await fetch("/api/knowledge/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: video.id,
          lastPositionSeconds: pos,
          isCompleted: completionMap[video.id] ?? false,
        }),
      });
    },
    [video.id, completionMap],
  );

  function handleVideoEnded() {
    if (nextVideo) {
      setShowAutoplay(true);
    }
  }

  const initialPosition = video.progress?.last_position_seconds ?? 0;

  return (
    // Break out of layout p-8 and fill full height below 64px header
    <div
      className="cf-player flex -m-8 overflow-hidden"
      style={{ height: "calc(100vh - 64px)" }}
    >
      {/* Lime-coloured range thumbs across all sliders in this player */}
      <style>{`
        .cf-player input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 13px; height: 13px;
          border-radius: 50%;
          background: #aaff00;
          box-shadow: 0 0 6px rgba(170,255,0,0.5);
          cursor: pointer;
          border: none;
        }
        .cf-player input[type=range]::-moz-range-thumb {
          width: 13px; height: 13px;
          border-radius: 50%;
          background: #aaff00;
          box-shadow: 0 0 6px rgba(170,255,0,0.5);
          cursor: pointer;
          border: none;
        }
        .cf-player input[type=range].scrubber::-webkit-slider-thumb { width: 14px; height: 14px; }
        .cf-player input[type=range].scrubber::-moz-range-thumb    { width: 14px; height: 14px; }
        .cf-md h1,.cf-md h2,.cf-md h3,.cf-md h4 { color: #eceae6; font-weight: 700; margin: 1.2em 0 0.4em; line-height: 1.3; }
        .cf-md h1 { font-size: 17px; }
        .cf-md h2 { font-size: 15px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 4px; }
        .cf-md h3 { font-size: 13px; color: #aaff00; }
        .cf-md p  { margin: 0 0 10px; }
        .cf-md ul,.cf-md ol { margin: 0 0 10px; padding-left: 20px; }
        .cf-md li { margin-bottom: 4px; }
        .cf-md strong { color: #eceae6; font-weight: 700; }
        .cf-md em { color: rgba(229,226,225,0.55); font-style: italic; }
        .cf-md code { background: rgba(255,255,255,0.07); border-radius: 4px; padding: 1px 5px; font-size: 12px; font-family: monospace; }
        .cf-md blockquote { border-left: 3px solid #aaff00; margin: 0 0 10px; padding: 4px 12px; color: rgba(229,226,225,0.5); }
        .cf-md hr { border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 16px 0; }
      `}</style>
      {/* Left sidebar */}
      <ChapterSidebar
        course={course}
        currentVideoId={video.id}
        completionMap={completionMap}
      />

      {/* Main content */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ scrollbarWidth: "thin" }}
      >
        <div className="p-6 space-y-5" style={{ maxWidth: 900 }}>
          {/* Breadcrumb */}
          <div
            className="flex items-center gap-2"
            style={{
              fontSize: 10,
              color: "rgba(229,226,225,0.35)",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
            }}
          >
            <Link
              href="/knowledge"
              style={{ color: "rgba(229,226,225,0.35)" }}
              className="hover:text-white transition-colors"
            >
              Knowledge
            </Link>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 12 }}
            >
              chevron_right
            </span>
            <Link
              href={`/knowledge/${course.id}`}
              style={{ color: "rgba(229,226,225,0.35)" }}
              className="hover:text-white transition-colors"
            >
              {video.chapter.course.title}
            </Link>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 12 }}
            >
              chevron_right
            </span>
            <span style={{ color: "#eceae6" }}>
              {video.chapter.title.replace(/^Module \d+ — /, "")}
            </span>
          </div>

          {/* Video title */}
          <h1
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: "#eceae6",
              letterSpacing: "-0.01em",
              lineHeight: 1.3,
            }}
          >
            {video.title}
          </h1>

          {/* Player wrapper (position relative for autoplay overlay) */}
          <div className="relative rounded-xl overflow-hidden">
            <VideoPlayer
              streamUrl={streamUrl}
              videoId={video.id}
              initialPosition={initialPosition}
              onComplete={handleComplete}
              onProgress={handleProgress}
              onTimeChange={setCurrentTime}
              onEnded={handleVideoEnded}
            />
            {showAutoplay && nextVideo && (
              <AutoplayOverlay
                nextVideo={nextVideo}
                courseId={course.id}
                onCancel={() => setShowAutoplay(false)}
              />
            )}
          </div>

          {/* Tabs */}
          <div
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {/* Tab bar — scrollable so all 5 fit on smaller screens */}
            <div
              className="flex overflow-x-auto"
              style={{
                borderBottom: "1px solid rgba(255,255,255,0.07)",
                scrollbarWidth: "none",
              }}
            >
              {(
                [
                  { id: "info", icon: "info", label: "Info" },
                  { id: "notes", icon: "edit_note", label: "Notes" },
                  { id: "transcript", icon: "subtitles", label: "Transcript" },
                  { id: "report", icon: "summarize", label: "Report" },
                  {
                    id: "takeaways",
                    icon: "format_list_bulleted",
                    label: "Takeaways",
                  },
                ] as const
              ).map(({ id, icon, label }) => {
                const isActive = activeTab === id;
                return (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className="flex items-center gap-2 px-5 py-3 transition-colors shrink-0"
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      color: isActive
                        ? "var(--v2-accent)"
                        : "rgba(229,226,225,0.4)",
                      borderBottom: isActive
                        ? "2px solid var(--v2-accent)"
                        : "2px solid transparent",
                      background: isActive
                        ? "rgba(var(--v2-accent-rgb), 0.05)"
                        : "transparent",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 14 }}
                    >
                      {icon}
                    </span>
                    {label}
                    {id === "notes" && initialNotes.length > 0 && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          background: "rgba(var(--v2-accent-rgb), 0.15)",
                          color: "var(--v2-accent)",
                          padding: "1px 6px",
                          borderRadius: 20,
                        }}
                      >
                        {initialNotes.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            <div className="p-5">
              {activeTab === "info" && (
                <div className="space-y-3">
                  {video.description ? (
                    <p
                      style={{
                        fontSize: 13,
                        color: "rgba(229,226,225,0.6)",
                        lineHeight: 1.7,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {video.description}
                    </p>
                  ) : (
                    <p
                      style={{
                        fontSize: 13,
                        color: "rgba(229,226,225,0.25)",
                        fontStyle: "italic",
                      }}
                    >
                      No description available.
                    </p>
                  )}
                  {video.duration_seconds != null && (
                    <div
                      className="flex items-center gap-2"
                      style={{ fontSize: 11, color: "rgba(229,226,225,0.35)" }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 14 }}
                      >
                        schedule
                      </span>
                      Duration: {formatTime(video.duration_seconds)}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "notes" && (
                <NotesPanel
                  videoId={video.id}
                  initialNotes={initialNotes}
                  currentTime={currentTime}
                />
              )}

              {activeTab === "transcript" &&
                ((video as any).transcript ? (
                  <p
                    style={{
                      fontSize: 13,
                      color: "rgba(229,226,225,0.65)",
                      lineHeight: 1.9,
                      whiteSpace: "pre-wrap",
                      fontFamily: "monospace",
                    }}
                  >
                    {(video as any).transcript}
                  </p>
                ) : (
                  <NotGenerated label="Transcript" icon="subtitles" />
                ))}

              {activeTab === "report" &&
                ((video as any).summary ? (
                  <div
                    className="cf-md"
                    style={{
                      fontSize: 13,
                      color: "rgba(229,226,225,0.7)",
                      lineHeight: 1.8,
                    }}
                  >
                    <ReactMarkdown>{(video as any).summary}</ReactMarkdown>
                  </div>
                ) : (
                  <NotGenerated label="Report / Summary" icon="summarize" />
                ))}

              {activeTab === "takeaways" &&
                ((video as any).takeaways ? (
                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    {((video as any).takeaways as string)
                      .split("\n")
                      .map((l: string) => l.replace(/^[-•*]\s*/, "").trim())
                      .filter(Boolean)
                      .map((item: string, i: number) => (
                        <li key={i} className="flex items-start gap-3">
                          <span
                            className="material-symbols-outlined shrink-0 mt-0.5"
                            style={{
                              fontSize: 14,
                              color: "var(--v2-accent)",
                              fontVariationSettings: "'FILL' 1",
                            }}
                          >
                            check_circle
                          </span>
                          <span
                            style={{
                              fontSize: 13,
                              color: "rgba(229,226,225,0.75)",
                              lineHeight: 1.6,
                            }}
                          >
                            {item}
                          </span>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <NotGenerated label="Takeaways" icon="format_list_bulleted" />
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
