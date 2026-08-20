"use client";

/**
 * Pose picker: thumbnail, slug, native size, and a calibration-status badge.
 *
 * The badge distinguishes three states, not two, because the middle one is the
 * one that bites: a pose can carry a full hitbox set in the editor and still be
 * `anchor_status: "needs-calibration"` on disk, which is exactly the state every
 * render path rejects. Showing "ready to mark" separately from "calibrated"
 * stops an operator believing a pose is done when the file still says otherwise.
 */

import type { Pose } from "@repo/contracts";
import { poseImageUrl } from "../_lib/api";
import { UI } from "../_lib/palette";

/** Per-pose calibration state, as the list presents it. */
export type PoseStatus = "calibrated" | "ready-to-mark" | "needs-calibration";

export interface PoseListEntry {
  pose: Pose;
  status: PoseStatus;
  /** Unsaved edits exist for this pose. */
  dirty: boolean;
}

interface Props {
  entries: PoseListEntry[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
}

const BADGE: Record<
  PoseStatus,
  { label: string; colour: string; background: string }
> = {
  calibrated: {
    label: "calibrated",
    colour: "var(--v2-success)",
    background: "rgba(var(--v2-success-rgb), 0.12)",
  },
  "ready-to-mark": {
    label: "ready to mark",
    colour: "var(--v2-warning)",
    background: "rgba(var(--v2-warning-rgb), 0.14)",
  },
  "needs-calibration": {
    label: "needs calibration",
    colour: "#ffb4ab",
    background: "rgba(255, 180, 171, 0.12)",
  },
};

/** Thumbnail width requested from the image route. */
const THUMB_W = 128;

export function PoseList({ entries, selectedSlug, onSelect }: Props) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        overflowY: "auto",
        maxHeight: "calc(100vh - 260px)",
        paddingRight: 4,
      }}
    >
      {entries.map(({ pose, status, dirty }) => {
        const selected = pose.slug === selectedSlug;
        const badge = BADGE[status];
        return (
          <button
            key={pose.slug}
            type="button"
            onClick={() => onSelect(pose.slug)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: 8,
              borderRadius: 10,
              textAlign: "left",
              cursor: "pointer",
              background: selected ? UI.accentSoft : UI.surface,
              border: `1px solid ${selected ? UI.accentBorder : UI.hairline}`,
              transition: "background 120ms, border-color 120ms",
            }}
          >
            <div
              style={{
                width: 48,
                height: 60,
                flexShrink: 0,
                borderRadius: 6,
                overflow: "hidden",
                background: "#15181c",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={poseImageUrl(pose.file, THUMB_W)}
                alt={pose.slug}
                loading="lazy"
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain",
                }}
              />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: UI.text1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {pose.slug}
                {dirty && (
                  <span style={{ color: UI.accent, marginLeft: 6 }}>•</span>
                )}
              </div>
              <div style={{ fontSize: 10, color: UI.text2, marginTop: 2 }}>
                {pose.size[0]}×{pose.size[1]}
              </div>
              <span
                style={{
                  display: "inline-block",
                  marginTop: 4,
                  padding: "2px 6px",
                  borderRadius: 999,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: badge.colour,
                  background: badge.background,
                }}
              >
                {badge.label}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
