"use client";

/**
 * The right-hand panel of the Calibrate tab: one row per hitbox with its exact
 * normalised numbers, a place/clear control, a visibility toggle, and the
 * calibration gate.
 *
 * The numbers are shown, not hidden behind the drag, because collar width is the
 * single most load-bearing value in the pose file — it is what stops the figure
 * teleporting between cuts — and "about there" is not good enough for it.
 */

import type { NormRect } from "@repo/contracts";

import {
  HITBOX_NAMES,
  directionAngleDeg,
  missingHitboxes,
  type HitboxDraft,
  type HitboxName,
} from "../_lib/geometry";
import { HITBOX_COLOURS, UI } from "../_lib/palette";

interface Props {
  draft: HitboxDraft;
  seeded: ReadonlySet<HitboxName>;
  visible: Readonly<Record<HitboxName, boolean>>;
  activeHitbox: HitboxName | null;
  /** Pose PNG pixel size, for showing what each fraction means in real pixels. */
  poseSizePx: readonly [number, number];
  onActivate: (name: HitboxName) => void;
  onToggleVisible: (name: HitboxName) => void;
  onSeed: (name: HitboxName) => void;
  onClear: (name: HitboxName) => void;
}

/** What each hitbox is for, in the words of the design doc's table. */
const PURPOSE: Record<HitboxName, string> = {
  head: "Head mark placement + the narration loudness pump.",
  collar:
    "Apparent-scale normalisation. The 16 poses were matted from crops between 424×1088 and 2752×1442 — this is what stops the figure teleporting.",
  pointOrigin: "Start of the pointing vector — the hand.",
  pointDirection:
    "Object rotation in framed-chart, and layout side selection. Stored as a unit vector in pose-pixel space.",
  safeRegion: "Where a layout may place objects without occluding the figure.",
  crop: "Per-pose framing when the layout crops the figure.",
};

export function HitboxInspector({
  draft,
  seeded,
  visible,
  activeHitbox,
  poseSizePx,
  onActivate,
  onToggleVisible,
  onSeed,
  onClear,
}: Props) {
  const missing = missingHitboxes(draft);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {HITBOX_NAMES.map((name) => {
        const value = draft[name];
        const isSeeded = seeded.has(name);
        const active = activeHitbox === name;
        return (
          <div
            key={name}
            onClick={() => onActivate(name)}
            style={{
              padding: 10,
              borderRadius: 10,
              cursor: "pointer",
              background: active ? UI.accentSoft : UI.surface,
              border: `1px solid ${active ? UI.accentBorder : UI.hairline}`,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: HITBOX_COLOURS[name],
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: UI.text1,
                  flex: 1,
                }}
              >
                {name}
              </span>

              {value !== null && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleVisible(name);
                  }}
                  title={visible[name] ? "Hide on canvas" : "Show on canvas"}
                  style={iconButtonStyle}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{
                      fontSize: 16,
                      color: visible[name] ? UI.accent : UI.text3,
                    }}
                  >
                    {visible[name] ? "visibility" : "visibility_off"}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (value === null) onSeed(name);
                  else onClear(name);
                }}
                style={{
                  ...iconButtonStyle,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  padding: "3px 8px",
                  color: value === null ? UI.accent : UI.text2,
                }}
              >
                {value === null ? "Place" : "Clear"}
              </button>
            </div>

            <div
              style={{
                fontSize: 11,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                color: value === null ? UI.text3 : UI.text1,
              }}
            >
              {describe(name, draft, poseSizePx)}
            </div>

            {isSeeded && (
              <div
                style={{
                  marginTop: 5,
                  fontSize: 10,
                  color: UI.warning,
                  display: "flex",
                  gap: 5,
                  alignItems: "flex-start",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 13 }}
                >
                  warning
                </span>
                <span>
                  Seeded at a neutral default and not yet moved. This pose
                  cannot be marked calibrated until you place it.
                </span>
              </div>
            )}

            <div style={{ marginTop: 5, fontSize: 10, color: UI.text2 }}>
              {PURPOSE[name]}
            </div>
          </div>
        );
      })}

      {missing.length > 0 && (
        <div
          style={{
            padding: 10,
            borderRadius: 10,
            background: "rgba(255,180,171,0.08)",
            border: "1px solid rgba(255,180,171,0.25)",
            fontSize: 11,
            color: "#ffb4ab",
          }}
        >
          Unauthored: {missing.join(", ")}. A pose missing any hitbox fails the
          build rather than being placed by guesswork.
        </div>
      )}
    </div>
  );
}

const iconButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 3,
  borderRadius: 6,
  background: "transparent",
  border: `1px solid ${UI.hairline}`,
  cursor: "pointer",
} as const;

/** Human-readable value of one hitbox, with the pixel equivalent alongside. */
function describe(
  name: HitboxName,
  draft: HitboxDraft,
  poseSizePx: readonly [number, number],
): string {
  const [widthPx, heightPx] = poseSizePx;
  switch (name) {
    case "head": {
      const head = draft.head;
      if (!head) return "not placed";
      return (
        `centre ${fmt(head.center.x)}, ${fmt(head.center.y)}  ` +
        `(${Math.round(head.center.x * widthPx)}, ${Math.round(head.center.y * heightPx)}px)  ` +
        `r ${fmt(head.radius)} (${Math.round(head.radius * widthPx)}px)`
      );
    }
    case "collar": {
      const collar = draft.collar;
      if (!collar) return "not placed";
      return `width ${fmt(collar.width)} (${Math.round(collar.width * widthPx)}px of ${widthPx}px)`;
    }
    case "pointOrigin": {
      const origin = draft.pointOrigin;
      if (!origin) return "not placed";
      return (
        `${fmt(origin.x)}, ${fmt(origin.y)}  ` +
        `(${Math.round(origin.x * widthPx)}, ${Math.round(origin.y * heightPx)}px)`
      );
    }
    case "pointDirection": {
      const dir = draft.pointDirection;
      if (!dir) return "not placed";
      return `${fmt(dir.x)}, ${fmt(dir.y)}  (${directionAngleDeg(dir).toFixed(1)}° clockwise from +x)`;
    }
    case "safeRegion":
      return describeRect(draft.safeRegion, poseSizePx);
    case "crop":
      return describeRect(draft.crop, poseSizePx);
    default: {
      const exhaustive: never = name;
      throw new Error(
        `[HitboxInspector] unknown hitbox "${String(exhaustive)}".`,
      );
    }
  }
}

function describeRect(
  rect: NormRect | null,
  poseSizePx: readonly [number, number],
): string {
  if (!rect) return "not placed";
  const [widthPx, heightPx] = poseSizePx;
  return (
    `x ${fmt(rect.x)} y ${fmt(rect.y)} w ${fmt(rect.w)} h ${fmt(rect.h)}  ` +
    `(${Math.round(rect.w * widthPx)}×${Math.round(rect.h * heightPx)}px)`
  );
}

function fmt(value: number): string {
  return value.toFixed(4);
}
