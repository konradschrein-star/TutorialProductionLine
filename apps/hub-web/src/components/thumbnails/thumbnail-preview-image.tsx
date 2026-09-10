"use client";
import { useState, type CSSProperties } from "react";

/** Preview failures must not look like empty approved artwork. Export uses its own strict image validation. */
export function ThumbnailPreviewImage({ src, alt, width, height, style, onAvailabilityChange }: { src: string; alt: string; width?: number; height?: number; style?: CSSProperties; onAvailabilityChange?: (available: boolean) => void }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (failedSource === src) return <div role="img" aria-label={`${alt}: image unavailable`} style={{ aspectRatio: "16 / 9", display: "grid", placeContent: "center", gap: 8, padding: 24, textAlign: "center", background: "var(--v2-surface-2)", color: "var(--v2-text-1)", fontSize: 14 }}><strong>Image unavailable</strong><span style={{ fontSize: 13, color: "var(--v2-text-2)", lineHeight: 1.5 }}>The image could not be loaded. Ask an Admin to check file access or restore it. Saved approval is unchanged.</span></div>;
  return <img src={src} alt={alt} loading="lazy" width={width} height={height} onLoad={() => onAvailabilityChange?.(true)} onError={() => { setFailedSource(src); onAvailabilityChange?.(false); }} style={style} />;
}
