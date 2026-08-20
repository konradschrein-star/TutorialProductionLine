"use client";

import { useState, useEffect, useCallback } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

export interface SceneImage {
  sceneIndex: number;
  imageIndex: number;
  /** Legacy: R2/local key served via /api/assets. Ignored when `url` is set. */
  r2Key?: string;
  /** Direct, ready-to-use image URL (e.g. /api/media/...) for local formats. */
  url?: string;
  /** Optional display label (falls back to Scene #idx). */
  label?: string | null;
  prompt?: string | null;
  text?: string | null;
}

interface SceneGalleryProps {
  jobId: string;
  images: SceneImage[];
}

export function SceneGallery({ jobId, images }: SceneGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const prev = useCallback(
    () => setLightboxIndex((i) => (i !== null ? Math.max(0, i - 1) : 0)),
    [],
  );
  const next = useCallback(
    () =>
      setLightboxIndex((i) =>
        i !== null ? Math.min(images.length - 1, i + 1) : 0,
      ),
    [images.length],
  );

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, closeLightbox, prev, next]);

  if (images.length === 0) return null;

  const srcOf = (img: SceneImage) =>
    img.url ?? `/api/assets/${jobId}/${img.r2Key}`;

  const current = lightboxIndex !== null ? images[lightboxIndex] : null;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
        {images.map((img, i) => (
          <button
            key={`${img.sceneIndex}-${img.imageIndex}`}
            onClick={() => setLightboxIndex(i)}
            className="relative group aspect-video rounded-lg overflow-hidden bg-surface-container border border-surface-bright hover:border-lime-400/50 focus:outline-none focus:ring-2 focus:ring-lime-400/50 transition-all"
          >
            <img
              src={srcOf(img)}
              alt={
                img.label ?? `Scene ${img.sceneIndex} image ${img.imageIndex}`
              }
              className="w-full h-full object-cover"
              loading="lazy"
            />

            {/* Scene/image index badge (label for local formats) */}
            <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-black/70 text-gray-300 leading-tight max-w-[90%] truncate">
              {img.label ??
                (img.imageIndex === 0
                  ? `#${img.sceneIndex}`
                  : `#${img.sceneIndex}·${img.imageIndex}`)}
            </div>

            {/* Hover overlay with prompt */}
            {img.prompt && (
              <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2 pointer-events-none">
                <p
                  className="text-[9px] text-gray-300 text-left leading-snug"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 4,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {img.prompt}
                </p>
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && current && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
          onClick={closeLightbox}
        >
          {/* Close */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              closeLightbox();
            }}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>

          {/* Prev */}
          {lightboxIndex > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                prev();
              }}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            >
              <ChevronLeft className="w-6 h-6 text-white" />
            </button>
          )}

          {/* Next */}
          {lightboxIndex < images.length - 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                next();
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            >
              <ChevronRight className="w-6 h-6 text-white" />
            </button>
          )}

          {/* Image + meta */}
          <div
            className="max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={srcOf(current)}
              alt={
                current.label ??
                `Scene ${current.sceneIndex} image ${current.imageIndex}`
              }
              className="max-w-full max-h-[75vh] object-contain rounded-lg"
            />
            <div className="text-center space-y-1 max-w-2xl px-4">
              <p className="text-xs font-mono text-gray-500">
                {current.label ?? `Scene ${current.sceneIndex}`}
                {!current.label &&
                  current.imageIndex > 0 &&
                  ` · Frame ${current.imageIndex}`}
                <span className="mx-2 opacity-40">·</span>
                {lightboxIndex + 1} / {images.length}
              </p>
              {current.prompt && (
                <p className="text-xs text-gray-400 leading-relaxed">
                  {current.prompt}
                </p>
              )}
              {current.text && (
                <p className="text-xs text-gray-600 italic leading-relaxed">
                  {current.text}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
