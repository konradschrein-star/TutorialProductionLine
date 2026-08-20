"use client";

/**
 * BUSINESS_PLAN_HUB Presenter Studio — the hitbox authoring tool.
 *
 * It exists to fix two shipped asset defects and to keep them fixed:
 *
 *  1. `poses.json` carries `anchor_status: "needs-calibration"` and
 *     `head_anchor: null` on all 16 poses. Automatic collar detection failed —
 *     it locked onto the white shirt, which is nearly the sweep colour, and on
 *     `holding-tablet` it found the tablet. Bad values were stripped rather than
 *     shipped, so there is nothing to correct: the anchors must be authored.
 *  2. Crops range from 424×1088 to 2752×1442, roughly a 6× swing in apparent
 *     figure size. Cutting between poses without normalising makes the presenter
 *     teleport. The `collar` hitbox is what normalises it.
 *
 * It is a tool, not a one-off script, because the pose library grows: new poses
 * are onboarded here without touching code (design §6.2).
 *
 * All authored values are normalised 0..1 against the pose PNG, so they survive
 * any output resolution. Nothing is ever guessed: a pose keeps
 * `anchor_status: "needs-calibration"` until an operator has placed all six
 * hitboxes, and the save route rejects the file if that is not true.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Pose } from "@repo/contracts";

import { GlassCard } from "../_components/glass-card";
import { V2TabNav, type V2Tab } from "../_components/v2-tab-nav";
import {
  HitboxCanvas,
  type CollarBarPosition,
} from "./_components/hitbox-canvas";
import { HitboxInspector } from "./_components/hitbox-inspector";
import { NormalisationPreview } from "./_components/normalisation-preview";
import { PumpPreview } from "./_components/pump-preview";
import { ScenePreview } from "./_components/scene-preview";
import {
  PoseList,
  type PoseListEntry,
  type PoseStatus,
} from "./_components/pose-list";
import {
  HITBOX_NAMES,
  applyHitboxPatch,
  draftFromHitboxes,
  draftToHitboxes,
  emptyDraft,
  missingHitboxes,
  type HitboxDraft,
  type HitboxName,
  type HitboxPatch,
} from "./_lib/geometry";
import { clearHitbox, seedHitbox } from "./_lib/seeds";
import { UI } from "./_lib/palette";
import {
  HEAD_MARK_SOURCE_SHA256,
  HEAD_MARK_DEFAULT_BG,
  HEAD_MARK_DEFAULT_FG,
} from "./_lib/head-mark";
import {
  exportHeadMarkPng,
  fetchHeadMark,
  fetchManifest,
  saveManifest,
} from "./_lib/api";

type TabId = "calibrate" | "pump" | "normalise" | "scene";

const TABS: V2Tab[] = [
  { id: "calibrate", label: "Calibrate" },
  { id: "pump", label: "Head pump" },
  { id: "normalise", label: "Normalisation" },
  { id: "scene", label: "Scene preview" },
];

/** Head-mark PNG size exported for the browserless compositor (R3 §2). */
const HEAD_MARK_EXPORT_PX = 512;

export function StudioClient() {
  const [poses, setPoses] = useState<Pose[] | null>(null);
  const [revision, setRevision] = useState<string | null>(null);
  const [manifestPath, setManifestPath] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<Record<string, HitboxDraft>>({});
  const [seeded, setSeeded] = useState<Record<string, Set<HitboxName>>>({});
  const [markCalibrated, setMarkCalibrated] = useState<Record<string, boolean>>(
    {},
  );
  const [collarBars, setCollarBars] = useState<
    Record<string, CollarBarPosition>
  >({});

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [activeHitbox, setActiveHitbox] = useState<HitboxName | null>("head");
  const [visible, setVisible] = useState<Record<HitboxName, boolean>>(
    () =>
      Object.fromEntries(HITBOX_NAMES.map((n) => [n, true])) as Record<
        HitboxName,
        boolean
      >,
  );

  const [tab, setTab] = useState<TabId>("calibrate");
  const [ground, setGround] = useState<"dark" | "light">("dark");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markDrift, setMarkDrift] = useState<string | null>(null);

  // ── load ──────────────────────────────────────────────────────────────────

  const hydrate = useCallback((loaded: Pose[], loadedRevision: string) => {
    setPoses(loaded);
    setRevision(loadedRevision);
    setDrafts(
      Object.fromEntries(
        loaded.map((pose) => [
          pose.slug,
          pose.hitboxes ? draftFromHitboxes(pose.hitboxes) : emptyDraft(),
        ]),
      ),
    );
    setSeeded({});
    setMarkCalibrated(
      Object.fromEntries(
        loaded.map((pose) => [pose.slug, pose.anchor_status === "calibrated"]),
      ),
    );
    setCollarBars(
      Object.fromEntries(
        loaded.map((pose) => [
          pose.slug,
          pose.hitboxes
            ? {
                cx: pose.hitboxes.head.center.x,
                cy: Math.min(
                  1,
                  pose.hitboxes.head.center.y + pose.hitboxes.head.radius,
                ),
              }
            : { cx: 0.5, cy: 0.5 },
        ]),
      ),
    );
    setSelectedSlug((current) =>
      current && loaded.some((p) => p.slug === current)
        ? current
        : (loaded[0]?.slug ?? null),
    );
  }, []);

  useEffect(() => {
    fetchManifest()
      .then((result) => {
        hydrate(result.poses, result.revision);
        setManifestPath(result.manifestPath);
      })
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : String(e));
      });
  }, [hydrate]);

  // The head mark is inlined into the preview for speed; verify the inlined copy
  // still matches the asset instead of quietly presenting a stale one.
  useEffect(() => {
    fetchHeadMark()
      .then((result) => {
        setMarkDrift(
          result.sha256 === HEAD_MARK_SOURCE_SHA256
            ? null
            : `The preview's inlined head mark was transcribed from a head-mark.svg with sha256 ` +
                `${HEAD_MARK_SOURCE_SHA256.slice(0, 12)}…, but ${result.path} now hashes to ` +
                `${result.sha256.slice(0, 12)}…. The preview may not match what renders — ` +
                "re-transcribe _lib/head-mark.tsx from the asset.",
        );
      })
      .catch((e: unknown) => {
        setMarkDrift(e instanceof Error ? e.message : String(e));
      });
  }, []);

  // ── derived ───────────────────────────────────────────────────────────────

  const selected = useMemo(
    () => poses?.find((p) => p.slug === selectedSlug) ?? null,
    [poses, selectedSlug],
  );
  const selectedDraft: HitboxDraft =
    (selectedSlug ? drafts[selectedSlug] : undefined) ?? emptyDraft();
  const selectedSeeded: Set<HitboxName> =
    (selectedSlug ? seeded[selectedSlug] : undefined) ?? new Set<HitboxName>();
  const selectedCollarBar: CollarBarPosition = (selectedSlug
    ? collarBars[selectedSlug]
    : undefined) ?? { cx: 0.5, cy: 0.5 };

  const listEntries: PoseListEntry[] = useMemo(() => {
    if (!poses) return [];
    return poses.map((pose) => {
      const draft = drafts[pose.slug] ?? emptyDraft();
      const complete = draftToHitboxes(draft) !== null;
      const flagged = markCalibrated[pose.slug] === true;
      const status: PoseStatus = flagged
        ? "calibrated"
        : complete
          ? "ready-to-mark"
          : "needs-calibration";
      return { pose, status, dirty: isDirty(pose, draft, flagged) };
    });
  }, [poses, drafts, markCalibrated]);

  const dirtyCount = listEntries.filter((e) => e.dirty).length;

  const calibrationEntries = useMemo(() => {
    if (!poses) return [];
    return poses.map((pose) => {
      const draft = drafts[pose.slug] ?? emptyDraft();
      return {
        pose,
        collarWidth: draft.collar?.width ?? null,
        head: draft.head,
        pointOrigin: draft.pointOrigin,
        pointDirection: draft.pointDirection,
        safeRegion: draft.safeRegion,
      };
    });
  }, [poses, drafts]);

  // ── mutation ──────────────────────────────────────────────────────────────

  function patchSelected(patch: HitboxPatch) {
    if (!selectedSlug) return;
    const slug = selectedSlug;
    setDrafts((prev) => ({
      ...prev,
      [slug]: applyHitboxPatch(prev[slug] ?? emptyDraft(), patch),
    }));
    // A drag is authorship: the value stops being a seed the moment it moves.
    setSeeded((prev) => {
      const current = prev[slug];
      if (!current || !current.has(patch.name)) return prev;
      const next = new Set(current);
      next.delete(patch.name);
      return { ...prev, [slug]: next };
    });
  }

  function seed(name: HitboxName) {
    if (!selectedSlug) return;
    const slug = selectedSlug;
    setDrafts((prev) => ({
      ...prev,
      [slug]: seedHitbox(prev[slug] ?? emptyDraft(), name),
    }));
    setSeeded((prev) => {
      const next = new Set(prev[slug] ?? []);
      next.add(name);
      return { ...prev, [slug]: next };
    });
    setActiveHitbox(name);
  }

  function clear(name: HitboxName) {
    if (!selectedSlug) return;
    const slug = selectedSlug;
    setDrafts((prev) => ({
      ...prev,
      [slug]: clearHitbox(prev[slug] ?? emptyDraft(), name),
    }));
    setSeeded((prev) => {
      const current = prev[slug];
      if (!current) return prev;
      const next = new Set(current);
      next.delete(name);
      return { ...prev, [slug]: next };
    });
    // Clearing a hitbox un-calibrates the pose: a "calibrated" flag with a
    // missing hitbox is exactly the state the save route rejects, and letting
    // it linger in the UI invites a save that fails for a non-obvious reason.
    setMarkCalibrated((prev) => ({ ...prev, [slug]: false }));
  }

  const canMarkCalibrated =
    selectedSlug !== null &&
    draftToHitboxes(selectedDraft) !== null &&
    selectedSeeded.size === 0;

  async function save() {
    if (!poses || revision === null) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const next: Pose[] = poses.map((pose) => {
        const draft = drafts[pose.slug] ?? emptyDraft();
        const hitboxes = draftToHitboxes(draft);
        const flagged = markCalibrated[pose.slug] === true;
        // Rebuilt field by field rather than spread-and-override so that
        // `hitboxes` is OMITTED, not set to null, when the pose is incomplete:
        // the contract models a partially-authored pose by the ABSENCE of the
        // key, and a null there is a parse error. `head_anchor` is carried
        // through untouched — it is the dead pixel anchor from the failed
        // automatic pass, kept so the file round-trips without data loss.
        return {
          source: pose.source,
          source_size: pose.source_size,
          crop: pose.crop,
          coverage: pose.coverage,
          soft_edge_px: pose.soft_edge_px,
          head_anchor: pose.head_anchor,
          slug: pose.slug,
          file: pose.file,
          size: pose.size,
          anchor_status: flagged ? "calibrated" : "needs-calibration",
          ...(hitboxes ? { hitboxes } : {}),
        };
      });

      const result = await saveManifest(next, revision);
      hydrate(result.poses, result.revision);
      setManifestPath(result.manifestPath);
      setNotice(
        `Saved. ${result.summary.calibrated} of ${result.summary.total} poses calibrated, ` +
          `${result.summary.needsCalibration} still need calibration.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function exportMark() {
    setError(null);
    setNotice(null);
    try {
      const result = await exportHeadMarkPng({
        markBg: HEAD_MARK_DEFAULT_BG,
        markFg: HEAD_MARK_DEFAULT_FG,
        sizePx: HEAD_MARK_EXPORT_PX,
      });
      setNotice(
        `Wrote ${result.written} (${result.sizePx}px, ${(result.bytes / 1024).toFixed(0)} KB) — ` +
          'pass this to buildPresenterTrack as { kind: "png" }.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  if (loadError) {
    return (
      <GlassCard style={{ padding: 20 }}>
        <h2
          style={{ fontSize: 14, fontWeight: 700, color: "#ffb4ab", margin: 0 }}
        >
          The pose library could not be read
        </h2>
        <p
          style={{
            fontSize: 12,
            color: UI.text2,
            marginTop: 8,
            lineHeight: 1.7,
            whiteSpace: "pre-wrap",
          }}
        >
          {loadError}
        </p>
      </GlassCard>
    );
  }

  if (!poses) {
    return (
      <GlassCard style={{ padding: 20 }}>
        <span style={{ fontSize: 12, color: UI.text2 }}>
          Loading the pose library…
        </span>
      </GlassCard>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <V2TabNav
          tabs={TABS}
          activeTab={tab}
          onChange={(id) => setTab(asTabId(id))}
        />
        <div style={{ flex: 1 }} />
        <GroundToggle ground={ground} onChange={setGround} />
        <button type="button" className="v2-btn" onClick={exportMark}>
          Export head-mark PNG
        </button>
        <button
          type="button"
          className="v2-btn-accent"
          disabled={saving || dirtyCount === 0}
          onClick={() => void save()}
          style={{ opacity: saving || dirtyCount === 0 ? 0.5 : 1 }}
        >
          {saving
            ? "Saving…"
            : dirtyCount === 0
              ? "No changes"
              : `Save ${dirtyCount} pose${dirtyCount === 1 ? "" : "s"}`}
        </button>
      </div>

      {markDrift && <Banner tone="warn">{markDrift}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="ok">{notice}</Banner>}

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <GlassCard style={{ padding: 12, width: 260, flexShrink: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: UI.text2,
              marginBottom: 8,
            }}
          >
            Poses ({poses.length})
          </div>
          <PoseList
            entries={listEntries}
            selectedSlug={selectedSlug}
            onSelect={(slug) => {
              setSelectedSlug(slug);
              setActiveHitbox("head");
            }}
          />
          <div
            style={{
              marginTop: 10,
              paddingTop: 10,
              borderTop: `1px solid ${UI.hairline}`,
              fontSize: 9.5,
              color: UI.text3,
              wordBreak: "break-all",
              lineHeight: 1.5,
            }}
          >
            {manifestPath}
          </div>
        </GlassCard>

        <div style={{ flex: 1, minWidth: 0 }}>
          {tab === "calibrate" && selected && (
            <div style={{ display: "flex", gap: 16, alignItems: "stretch" }}>
              <GlassCard
                style={{
                  padding: 12,
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <HitboxCanvas
                  pose={selected}
                  draft={selectedDraft}
                  seeded={selectedSeeded}
                  visible={visible}
                  activeHitbox={activeHitbox}
                  collarBar={selectedCollarBar}
                  onCollarBarChange={(next) =>
                    setCollarBars((prev) => ({
                      ...prev,
                      [selected.slug]: next,
                    }))
                  }
                  onActivate={setActiveHitbox}
                  onChange={patchSelected}
                  onDragError={setError}
                />
              </GlassCard>

              <GlassCard
                style={{
                  padding: 12,
                  width: 380,
                  flexShrink: 0,
                  maxHeight: "calc(100vh - 220px)",
                  overflowY: "auto",
                }}
              >
                <HitboxInspector
                  draft={selectedDraft}
                  seeded={selectedSeeded}
                  visible={visible}
                  activeHitbox={activeHitbox}
                  poseSizePx={selected.size}
                  onActivate={setActiveHitbox}
                  onToggleVisible={(name) =>
                    setVisible((prev) => ({ ...prev, [name]: !prev[name] }))
                  }
                  onSeed={seed}
                  onClear={clear}
                />

                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: `1px solid ${UI.hairline}`,
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      cursor: canMarkCalibrated ? "pointer" : "not-allowed",
                      opacity: canMarkCalibrated ? 1 : 0.55,
                    }}
                  >
                    <input
                      type="checkbox"
                      disabled={!canMarkCalibrated}
                      checked={markCalibrated[selected.slug] === true}
                      onChange={(e) =>
                        setMarkCalibrated((prev) => ({
                          ...prev,
                          [selected.slug]: e.target.checked,
                        }))
                      }
                      style={{ marginTop: 2, accentColor: "var(--v2-accent)" }}
                    />
                    <span style={{ fontSize: 12, color: UI.text1 }}>
                      Mark <strong>{selected.slug}</strong> calibrated
                      <span
                        style={{
                          display: "block",
                          fontSize: 10.5,
                          color: UI.text2,
                          marginTop: 3,
                          lineHeight: 1.5,
                        }}
                      >
                        {canMarkCalibrated
                          ? "All six hitboxes are placed. Only a calibrated pose can be used by a render."
                          : selectedSeeded.size > 0
                            ? `Still seeded: ${[...selectedSeeded].join(", ")}. A seeded value is a default, not a calibration.`
                            : `Unauthored: ${missingHitboxes(selectedDraft).join(", ")}.`}
                      </span>
                    </span>
                  </label>
                </div>
              </GlassCard>
            </div>
          )}

          {tab === "pump" && selected && (
            <GlassCard style={{ padding: 14 }}>
              <PumpPreview
                pose={selected}
                draft={selectedDraft}
                ground={ground}
              />
            </GlassCard>
          )}

          {tab === "normalise" && (
            <GlassCard style={{ padding: 14 }}>
              <NormalisationPreview
                entries={calibrationEntries}
                focusSlug={selectedSlug}
                ground={ground}
              />
            </GlassCard>
          )}

          {tab === "scene" && (
            <GlassCard style={{ padding: 14 }}>
              <ScenePreview
                entries={calibrationEntries}
                focusSlug={selectedSlug}
              />
            </GlassCard>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function GroundToggle({
  ground,
  onChange,
}: {
  ground: "dark" | "light";
  onChange: (next: "dark" | "light") => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        borderRadius: 8,
        overflow: "hidden",
        border: `1px solid ${UI.hairline}`,
      }}
    >
      {(["dark", "light"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          style={{
            padding: "7px 12px",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            cursor: "pointer",
            border: "none",
            background: ground === option ? UI.accentSoft : "transparent",
            color: ground === option ? UI.accent : UI.text2,
          }}
        >
          {option === "dark" ? "Near-black mat" : "Near-white mat"}
        </button>
      ))}
    </div>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "error";
  children: React.ReactNode;
}) {
  const colour =
    tone === "error" ? "#ffb4ab" : tone === "warn" ? UI.warning : UI.success;
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: `1px solid ${UI.hairline}`,
        background: UI.surface,
        fontSize: 11.5,
        lineHeight: 1.6,
        color: colour,
        whiteSpace: "pre-wrap",
      }}
    >
      {children}
    </div>
  );
}

/**
 * True when a pose's editor state differs from what is on disk.
 *
 * Compared by serialising the hitbox set: the values are plain numbers authored
 * in a fixed key order, so a structural compare here would be more code for the
 * same answer.
 */
function isDirty(pose: Pose, draft: HitboxDraft, flagged: boolean): boolean {
  const onDisk = pose.hitboxes ? JSON.stringify(pose.hitboxes) : null;
  const inEditor = (() => {
    const complete = draftToHitboxes(draft);
    return complete ? JSON.stringify(complete) : null;
  })();
  if (onDisk !== inEditor) return true;
  return (pose.anchor_status === "calibrated") !== flagged;
}

/**
 * Narrow the tab-nav's string back to {@link TabId}.
 *
 * @throws Error if the tab list and this union drift apart.
 */
function asTabId(id: string): TabId {
  if (
    id === "calibrate" ||
    id === "pump" ||
    id === "normalise" ||
    id === "scene"
  ) {
    return id;
  }
  throw new Error(`[PresenterStudio] unknown tab "${id}".`);
}
