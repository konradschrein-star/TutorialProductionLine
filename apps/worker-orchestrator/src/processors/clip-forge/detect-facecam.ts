import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * Clip Forge — Facecam / speaker-box auto-detection.
 *
 * Given the raw source video, detect:
 *   - Where the streamer's webcam sits (full-screen, PiP corner box, or a
 *     split layout with two cam boxes)
 *   - Pixel-exact x/y/w/h for each detected box
 *
 * Output is stored on `cf_sources.facecam_layout` and consumed downstream by
 * the 9:16 clip composer so it can crop each speaker using the exact box
 * border (no overshoot into the surrounding stream UI).
 *
 * Approach:
 *   1. Sample N frames spread across the source duration
 *   2. For each frame, run a vertical + horizontal gradient sum scan to find
 *      strong rectangular edges (the black border around an OBS PiP overlay)
 *   3. Cluster detected boxes across frames — a real box is consistent across
 *      time, while spurious gradient peaks (mouths, shoulders, neon signs)
 *      are not
 *   4. Classify mode:
 *        - fullscreen: no consistent inset box detected, dominant content
 *          fills > 80% of frame
 *        - pip: exactly one consistent inset box smaller than 50% area
 *        - split: two consistent inset boxes OR one inset box + a clear
 *          divider line bisecting the frame
 *
 * Detector is implemented in Python and shelled out — numpy/PIL gradient
 * scans are an order of magnitude faster than a pure-JS port and the worker
 * VPS already has them for the Whisper toolchain.
 */

export interface FacecamBox {
  role: "main" | "facecam";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FacecamLayout {
  mode: "pip" | "split" | "fullscreen";
  frame_w: number;
  frame_h: number;
  boxes: FacecamBox[];
  detected_at: string;
  samples: number;
  confidence: number;
}

export interface DetectFacecamOptions {
  /** Source video path. */
  sourcePath: string;
  /** Total source duration in seconds (from ffprobe). */
  durationSec: number;
  /** Working dir for sampled frames. Cleaned up on success. */
  workDir: string;
  /** Number of frames to sample across the source. Default 20. */
  sampleCount?: number;
  /** Optional logger. Falls back to console. */
  log?: (line: object) => void;
}

const PYTHON_BIN = process.env["PYTHON_BIN"] ?? "python3";
const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";

export async function detectFacecamLayout(
  opts: DetectFacecamOptions,
): Promise<FacecamLayout> {
  const sampleCount = opts.sampleCount ?? 20;
  const log = opts.log ?? ((line) => console.log(JSON.stringify(line)));
  const framesDir = join(opts.workDir, "facecam-samples");
  await mkdir(framesDir, { recursive: true });

  log({
    level: "info",
    msg: "[detect-facecam] sampling frames",
    samples: sampleCount,
    duration_sec: opts.durationSec,
  });

  // 1. Sample N frames evenly across the source.
  //    Skip the first/last 5% — title cards and end-credits often differ
  //    from the steady-state stream layout.
  const safeStart = Math.max(5, opts.durationSec * 0.05);
  const safeEnd = Math.max(safeStart + 1, opts.durationSec * 0.95);
  const stepSec = (safeEnd - safeStart) / Math.max(1, sampleCount - 1);

  const framePaths: string[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = safeStart + i * stepSec;
    const outPath = join(framesDir, `f${String(i).padStart(3, "0")}.png`);
    await runFfmpegFrame(opts.sourcePath, t, outPath);
    framePaths.push(outPath);
  }

  // 2. Run the Python detector on every sampled frame, then aggregate.
  const detectorJson = await runPythonDetector(framePaths);

  // 3. Clean up sampled frames (~5 MB each).
  await rm(framesDir, { recursive: true, force: true }).catch(() => {});

  const layout: FacecamLayout = {
    ...detectorJson,
    detected_at: new Date().toISOString(),
    samples: sampleCount,
  };

  log({
    level: "info",
    msg: "[detect-facecam] complete",
    mode: layout.mode,
    boxes: layout.boxes.map((b) => `${b.role}@${b.x},${b.y},${b.w}x${b.h}`),
    confidence: layout.confidence,
  });

  return layout;
}

function runFfmpegFrame(
  sourcePath: string,
  atSec: number,
  outPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      atSec.toFixed(3),
      "-i",
      sourcePath,
      "-frames:v",
      "1",
      outPath,
    ]);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", (e) =>
      reject(new Error(`ffmpeg frame extract failed: ${e.message}`)),
    );
    proc.on("close", (code) => {
      if (code !== 0)
        reject(
          new Error(
            `ffmpeg frame extract exited ${code}: ${stderr.slice(-200)}`,
          ),
        );
      else resolve();
    });
  });
}

const DETECTOR_SCRIPT = `
import sys, json
import numpy as np
from PIL import Image

# ---------------------------------------------------------------------------
# Facecam-box detector.
#
# Given N sampled frames from a stream VOD, find the inset PiP box(es)
# around the streamer's webcam. Returns:
#   - mode: pip | split | fullscreen
#   - boxes: list of (role, x, y, w, h)
#   - confidence: 0..1
#
# Algorithm per frame:
#   1. Build a vertical-gradient summary (per-column gradient strength
#      summed over y), and a horizontal-gradient summary (per-row gradient
#      strength summed over x). PiP borders appear as sharp peaks.
#   2. Find peak columns/rows that exceed a threshold and are isolated
#      (no nearby competing peak within 30 px). These are candidate edges.
#   3. Pair candidates into rectangles touching at least one frame corner
#      (PiP boxes almost always anchor to a corner in OBS layouts).
#   4. Score each rectangle by border contrast + corner proximity.
#
# After per-frame detection, cluster rectangles across frames:
#   - A "real" box appears in >= 60% of sampled frames at the same coords
#     (±10 px tolerance).
#   - One real box => "pip" mode (main = frame minus box).
#   - Two real boxes that don't overlap => "split" mode.
#   - Zero real boxes => "fullscreen".
# ---------------------------------------------------------------------------

CORNER_DIST_THRESH = 50         # pixels — PiP must touch a corner this close
PEAK_ISOLATION = 30             # pixels — min spacing between detected edges
EDGE_THRESH_PCT = 0.75          # percentile threshold for "strong" edges
MIN_BOX_DIM = 200               # smaller than this is noise
MAX_BOX_AREA_FRAC = 0.50        # bigger than half the frame is not a "PiP"
CLUSTER_TOL = 12                # px — frames matching within this are same box
MIN_FRAMES_PCT = 0.55           # 55% of frames must show the box for it to count

def gray(arr):
    return arr.mean(axis=2)

def detect_edges(frame_path):
    img = np.array(Image.open(frame_path).convert("RGB"))
    H, W = img.shape[:2]
    g = gray(img)

    # Vertical edges (changes across x). Sum |dx| over y in the top half +
    # bottom half separately so a corner-anchored PiP can be located.
    dx = np.abs(np.diff(g.astype(np.int32), axis=1))   # (H, W-1)
    dy = np.abs(np.diff(g.astype(np.int32), axis=0))   # (H-1, W)

    # Score columns and rows. We don't care about which half — just where
    # the strongest persistent gradient line is.
    col_score = dx.sum(axis=0)                          # length W-1
    row_score = dy.sum(axis=1)                          # length H-1

    # Find peaks (non-max suppression).
    def find_peaks(scores, isolation, threshold):
        out = []
        order = np.argsort(scores)[::-1]
        used = np.zeros(len(scores), dtype=bool)
        for idx in order:
            if scores[idx] < threshold:
                break
            if used[idx]:
                continue
            out.append(int(idx))
            lo = max(0, idx - isolation)
            hi = min(len(scores), idx + isolation + 1)
            used[lo:hi] = True
            if len(out) >= 20:
                break
        return out

    col_thresh = np.percentile(col_score, EDGE_THRESH_PCT * 100)
    row_thresh = np.percentile(row_score, EDGE_THRESH_PCT * 100)

    col_peaks = find_peaks(col_score, PEAK_ISOLATION, col_thresh)
    row_peaks = find_peaks(row_score, PEAK_ISOLATION, row_thresh)

    # Always consider the frame edges as candidate borders so corner-anchored
    # PiPs (left-edge at x=0, top-edge at y=0) are reachable.
    col_candidates = sorted(set(col_peaks + [0, W - 1]))
    row_candidates = sorted(set(row_peaks + [0, H - 1]))

    # Generate candidate rectangles touching at least one corner.
    rects = []
    for x1 in col_candidates:
        for x2 in col_candidates:
            if x2 - x1 < MIN_BOX_DIM:
                continue
            for y1 in row_candidates:
                for y2 in row_candidates:
                    if y2 - y1 < MIN_BOX_DIM:
                        continue
                    rw = x2 - x1
                    rh = y2 - y1
                    if rw * rh > MAX_BOX_AREA_FRAC * W * H:
                        continue
                    # Must touch at least one corner of the frame
                    corner_touch = (
                        (x1 < CORNER_DIST_THRESH and y1 < CORNER_DIST_THRESH) or
                        (W - x2 < CORNER_DIST_THRESH and y1 < CORNER_DIST_THRESH) or
                        (x1 < CORNER_DIST_THRESH and H - y2 < CORNER_DIST_THRESH) or
                        (W - x2 < CORNER_DIST_THRESH and H - y2 < CORNER_DIST_THRESH)
                    )
                    if not corner_touch:
                        continue
                    # Score = average edge strength along the four borders
                    top = row_score[max(0, y1 - 1):y1 + 2].max() if y1 < len(row_score) else 0
                    bot = row_score[max(0, y2 - 1):min(len(row_score), y2 + 2)].max() if y2 < len(row_score) else 0
                    lft = col_score[max(0, x1 - 1):x1 + 2].max() if x1 < len(col_score) else 0
                    rgt = col_score[max(0, x2 - 1):min(len(col_score), x2 + 2)].max() if x2 < len(col_score) else 0
                    score = (top + bot + lft + rgt) / 4.0
                    rects.append((score, x1, y1, rw, rh))

    rects.sort(reverse=True, key=lambda r: r[0])
    # Keep the top 5 candidates per frame to feed the cross-frame clusterer
    return [(int(x), int(y), int(w), int(h)) for (_, x, y, w, h) in rects[:5]], W, H


def cluster_boxes(per_frame, n_frames):
    """
    per_frame: list[list[(x,y,w,h)]]  — top candidates per frame
    Returns clusters of boxes that recur in >= MIN_FRAMES_PCT of frames.
    """
    clusters = []  # each: { repr: (x,y,w,h), count: int, members: [(x,y,w,h)] }
    for boxes in per_frame:
        for box in boxes:
            x, y, w, h = box
            matched = None
            for c in clusters:
                cx, cy, cw, ch = c["repr"]
                if (
                    abs(cx - x) < CLUSTER_TOL
                    and abs(cy - y) < CLUSTER_TOL
                    and abs(cw - w) < CLUSTER_TOL
                    and abs(ch - h) < CLUSTER_TOL
                ):
                    matched = c
                    break
            if matched is None:
                clusters.append({"repr": box, "count": 1, "members": [box]})
            else:
                matched["count"] += 1
                matched["members"].append(box)
                # update repr to running median for stability
                xs = sorted(m[0] for m in matched["members"])
                ys = sorted(m[1] for m in matched["members"])
                ws = sorted(m[2] for m in matched["members"])
                hs = sorted(m[3] for m in matched["members"])
                mid = len(matched["members"]) // 2
                matched["repr"] = (xs[mid], ys[mid], ws[mid], hs[mid])

    threshold = max(2, int(round(MIN_FRAMES_PCT * n_frames)))
    return [c for c in clusters if c["count"] >= threshold]


def main(frame_paths):
    per_frame = []
    W = H = 0
    for fp in frame_paths:
        rects, W, H = detect_edges(fp)
        per_frame.append(rects)

    clusters = cluster_boxes(per_frame, len(frame_paths))
    # Sort by count desc, then by area asc (smaller PiP-shaped boxes win
    # over larger ones that may accidentally include the whole frame).
    clusters.sort(key=lambda c: (-c["count"], c["repr"][2] * c["repr"][3]))

    if len(clusters) == 0:
        # Pure fullscreen mode — single speaker, no inset cam box.
        return {
            "mode": "fullscreen",
            "frame_w": W,
            "frame_h": H,
            "boxes": [
                {"role": "main", "x": 0, "y": 0, "w": W, "h": H},
            ],
            "confidence": 0.6,
        }

    # Use the highest-confidence cluster as the PiP/facecam box.
    facecam = clusters[0]["repr"]
    fx, fy, fw, fh = facecam
    facecam_box = {"role": "facecam", "x": fx, "y": fy, "w": fw, "h": fh}

    # Main content = frame minus the facecam region. For corner-anchored
    # PiPs we describe the main region as the full frame and let the
    # composer crop around the facecam region (Marck's room is visible
    # behind/around the PiP, but the face we want is on the opposite side).
    main_box = {"role": "main", "x": 0, "y": 0, "w": W, "h": H}

    confidence = clusters[0]["count"] / max(1, len(frame_paths))

    # Detect SPLIT mode: two strong, non-overlapping inset boxes that BOTH
    # appear in >= MIN_FRAMES_PCT of frames. Some 2-host stream layouts use
    # twin PiP overlays instead of one PiP + one main.
    if len(clusters) >= 2:
        b1 = clusters[0]["repr"]
        b2 = clusters[1]["repr"]
        # Reject if box2 is essentially contained in box1 or vice versa
        def contains(a, b):
            ax, ay, aw, ah = a
            bx, by, bw, bh = b
            return (
                bx >= ax - 2 and by >= ay - 2
                and bx + bw <= ax + aw + 2 and by + bh <= ay + ah + 2
            )
        if not contains(b1, b2) and not contains(b2, b1):
            second_conf = clusters[1]["count"] / max(1, len(frame_paths))
            if second_conf >= MIN_FRAMES_PCT:
                return {
                    "mode": "split",
                    "frame_w": W,
                    "frame_h": H,
                    "boxes": [
                        {"role": "main", "x": b1[0], "y": b1[1], "w": b1[2], "h": b1[3]},
                        {"role": "facecam", "x": b2[0], "y": b2[1], "w": b2[2], "h": b2[3]},
                    ],
                    "confidence": (confidence + second_conf) / 2,
                }

    return {
        "mode": "pip",
        "frame_w": W,
        "frame_h": H,
        "boxes": [main_box, facecam_box],
        "confidence": confidence,
    }


if __name__ == "__main__":
    paths = json.loads(sys.stdin.read())["frames"]
    print(json.dumps(main(paths)))
`;

function runPythonDetector(
  framePaths: string[],
): Promise<Omit<FacecamLayout, "detected_at" | "samples">> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, ["-c", DETECTOR_SCRIPT]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", (e) =>
      reject(new Error(`python detector spawn failed: ${e.message}`)),
    );
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `python detector exited ${code}: ${stderr.slice(-600) || stdout.slice(-300)}`,
          ),
        );
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as Omit<
          FacecamLayout,
          "detected_at" | "samples"
        >;
        resolve(parsed);
      } catch (e) {
        reject(
          new Error(
            `python detector returned invalid JSON: ${(e as Error).message} — ${stdout.slice(-200)}`,
          ),
        );
      }
    });
    proc.stdin.write(JSON.stringify({ frames: framePaths }));
    proc.stdin.end();
  });
}
