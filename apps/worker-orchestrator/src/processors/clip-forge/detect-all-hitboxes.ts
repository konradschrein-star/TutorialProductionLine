import { spawn } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * Clip Forge — full-frame hitbox detection V2.
 *
 * Runs YOLO11n + YuNet on the WHOLE source frame (no region pre-segmentation)
 * and returns EVERY detected person and face — not just the largest. Across N
 * sampled frames it clusters consistent hits into stable "speakers".
 *
 * Output is persisted to `cf_sources.detection` and consumed by the V2 layout
 * decider, which decides between four layouts:
 *
 *   fullscreen-single                — one stable speaker, not inside a panel
 *   facecam-top-screen-bottom        — one stable speaker, lives inside a facecam
 *   stacked-facecams                 — two speakers, both in facecams
 *   top-fullscreen-bottom-facecam    — one fullscreen + one facecam (the Marck × Olli case)
 *
 * Detector lives in this file as embedded Python (numpy + opencv-python-headless +
 * ultralytics). The runner shells out to python3 with one CLI subprocess per call.
 *
 * Why a separate detector from detect-portrait-crops.ts:
 *   - The old one picks the SINGLE largest box per region, which is wrong as
 *     soon as the frame contains more than one person.
 *   - The old one needs facecam_layout to pre-segment the frame, and that
 *     pre-segmentation is what misclassified the Marck × Olli PIP layout as
 *     split-screen in the first place.
 */

export interface HitboxV2Person {
  /** Median person bounding box across stable samples, source-frame coords. */
  person_box: { x: number; y: number; w: number; h: number };
  person_conf: number;
  /** Matched face inside the person box (when YuNet found one). */
  face_box: { x: number; y: number; w: number; h: number } | null;
  face_conf: number;
  /** How many of the sampled frames produced a hit at this position. */
  cluster_size: number;
}

export interface HitboxV2Result {
  frame_w: number;
  frame_h: number;
  samples: number;
  /** Every stable speaker the detector found, sorted by area (biggest first). */
  persons: HitboxV2Person[];
  detected_at: string;
}

export interface DetectAllHitboxesOptions {
  sourcePath: string;
  durationSec: number;
  workDir: string;
  sampleCount?: number;
  log?: (line: object) => void;
}

const PYTHON_BIN = process.env["PYTHON_BIN"] ?? "python3";
const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";

export async function detectAllHitboxes(
  opts: DetectAllHitboxesOptions,
): Promise<HitboxV2Result> {
  const sampleCount = opts.sampleCount ?? 16;
  const log = opts.log ?? ((line) => console.log(JSON.stringify(line)));
  const framesDir = join(opts.workDir, "v2-samples");
  await mkdir(framesDir, { recursive: true });

  log({
    level: "info",
    msg: "[detect-v2] sampling frames",
    samples: sampleCount,
  });

  // Sample frames evenly, skipping the first/last 5% to avoid title cards.
  const safeStart = Math.max(5, opts.durationSec * 0.05);
  const safeEnd = Math.max(safeStart + 1, opts.durationSec * 0.95);
  const stepSec = (safeEnd - safeStart) / Math.max(1, sampleCount - 1);

  const framePaths: string[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = safeStart + i * stepSec;
    const outPath = join(framesDir, `f${String(i).padStart(3, "0")}.jpg`);
    await runFfmpegFrame(opts.sourcePath, t, outPath);
    framePaths.push(outPath);
  }

  const result = await runPythonDetector(framePaths);
  await rm(framesDir, { recursive: true, force: true }).catch(() => {});

  const final: HitboxV2Result = {
    ...result,
    detected_at: new Date().toISOString(),
    samples: sampleCount,
  };

  log({
    level: "info",
    msg: "[detect-v2] complete",
    persons: final.persons.length,
    sizes: final.persons.map(
      (p) =>
        `${p.person_box.w}x${p.person_box.h}@(${p.person_box.x},${p.person_box.y})`,
    ),
  });

  return final;
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
      "-q:v",
      "3",
      outPath,
    ]);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", (e: Error) =>
      reject(new Error(`ffmpeg frame extract failed: ${e.message}`)),
    );
    proc.on("close", (code: number | null) => {
      if (code !== 0)
        reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-300)}`));
      else resolve();
    });
  });
}

/**
 * Embedded python script — runs YOLO + YuNet on each frame, returns every
 * detection (no top-1 filter), then clusters across frames in this same script
 * before printing one JSON result on stdout.
 */
const PY_SCRIPT = `
import sys, os, json
import numpy as np
import cv2
os.environ.setdefault("YOLO_VERBOSE", "False")
from ultralytics import YOLO

MODELS_DIR = os.environ.get("CF_MODELS_DIR", "/opt/content-forge/models")
YOLO_PATH = os.environ.get("CF_YOLO_MODEL", os.path.join(MODELS_DIR, "yolo11n.pt"))
YUNET_PATH = os.environ.get("CF_YUNET_MODEL", os.path.join(MODELS_DIR, "yunet.onnx"))

person_model = YOLO(YOLO_PATH)
face_detector = cv2.FaceDetectorYN_create(
    YUNET_PATH, "", (320, 320),
    score_threshold=0.5, nms_threshold=0.3,
)

# Per-frame: return every YOLO person box + every YuNet face box.
def detect_frame(img):
    h, w = img.shape[:2]
    persons = []
    res = person_model.predict(img, classes=[0], conf=0.35, verbose=False, imgsz=960)[0]
    if res.boxes is not None and len(res.boxes) > 0:
        boxes = res.boxes.xyxy.cpu().numpy()
        confs = res.boxes.conf.cpu().numpy()
        for b, c in zip(boxes, confs):
            persons.append({
                "x": float(b[0]), "y": float(b[1]),
                "w": float(b[2] - b[0]), "h": float(b[3] - b[1]),
                "conf": float(c),
            })

    face_detector.setInputSize((w, h))
    _, faces = face_detector.detect(img)
    face_list = []
    if faces is not None:
        for f in faces:
            face_list.append({
                "x": float(f[0]), "y": float(f[1]),
                "w": float(f[2]), "h": float(f[3]),
                "conf": float(f[-1]) if len(f) >= 15 else 0.7,
            })

    return persons, face_list

def iou(a, b):
    ax2 = a["x"] + a["w"]; ay2 = a["y"] + a["h"]
    bx2 = b["x"] + b["w"]; by2 = b["y"] + b["h"]
    ix1 = max(a["x"], b["x"]); iy1 = max(a["y"], b["y"])
    ix2 = min(ax2, bx2); iy2 = min(ay2, by2)
    iw = max(0.0, ix2 - ix1); ih = max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0: return 0.0
    ua = a["w"] * a["h"] + b["w"] * b["h"] - inter
    return inter / max(1.0, ua)

# Cluster boxes that appear consistently across frames.
# Two boxes from different frames belong to the same cluster if IoU > IOU_THRESH.
# A cluster is "stable" if it appears in at least MIN_HITS frames.
IOU_THRESH = 0.4

def cluster(per_frame_boxes, min_hits):
    clusters = []  # each entry: list of boxes from different frames
    for boxes in per_frame_boxes:
        for b in boxes:
            best_idx = -1
            best_iou = 0.0
            for ci, c in enumerate(clusters):
                # match against the most recent box added to this cluster
                m = iou(b, c[-1])
                if m > best_iou:
                    best_iou = m
                    best_idx = ci
            if best_idx >= 0 and best_iou > IOU_THRESH:
                clusters[best_idx].append(b)
            else:
                clusters.append([b])
    return [c for c in clusters if len(c) >= min_hits]

def med_box(boxes):
    arr = np.array([[b["x"], b["y"], b["w"], b["h"]] for b in boxes])
    m = np.median(arr, axis=0)
    cf = float(np.median([b["conf"] for b in boxes]))
    return {"x": float(m[0]), "y": float(m[1]),
            "w": float(m[2]), "h": float(m[3]), "conf": cf}

def main():
    payload = json.loads(sys.stdin.read())
    frame_paths = payload["frames"]
    samples = len(frame_paths)
    min_hits = max(2, samples // 3)

    persons_per_frame = []
    faces_per_frame = []
    frame_w = frame_h = 0
    for fp in frame_paths:
        img = cv2.imread(fp)
        if img is None:
            continue
        if frame_w == 0:
            frame_h, frame_w = img.shape[:2]
        p, f = detect_frame(img)
        persons_per_frame.append(p)
        faces_per_frame.append(f)

    person_clusters = cluster(persons_per_frame, min_hits)
    face_clusters = cluster(faces_per_frame, min_hits)

    # Build stable persons. For each person cluster: median box, then look for a
    # face cluster whose median center sits inside the person box.
    persons = []
    for pc in person_clusters:
        pbox = med_box(pc)
        face_box = None
        face_conf = 0.0
        for fc in face_clusters:
            fbox = med_box(fc)
            fcx = fbox["x"] + fbox["w"] / 2.0
            fcy = fbox["y"] + fbox["h"] / 2.0
            if (pbox["x"] <= fcx <= pbox["x"] + pbox["w"] and
                pbox["y"] <= fcy <= pbox["y"] + pbox["h"]):
                # Pick the face cluster with the largest cluster size; if tied,
                # pick the largest face by area.
                if face_box is None or len(fc) > face_conf:
                    face_box = {
                        "x": int(round(fbox["x"])),
                        "y": int(round(fbox["y"])),
                        "w": int(round(fbox["w"])),
                        "h": int(round(fbox["h"])),
                    }
                    face_conf = float(fbox["conf"])
        persons.append({
            "person_box": {
                "x": int(round(pbox["x"])),
                "y": int(round(pbox["y"])),
                "w": int(round(pbox["w"])),
                "h": int(round(pbox["h"])),
            },
            "person_conf": round(float(pbox["conf"]), 3),
            "face_box": face_box,
            "face_conf": round(face_conf, 3),
            "cluster_size": len(pc),
        })

    # Sort by area, biggest first.
    persons.sort(key=lambda p: -p["person_box"]["w"] * p["person_box"]["h"])

    print(json.dumps({
        "frame_w": frame_w,
        "frame_h": frame_h,
        "persons": persons,
    }))

if __name__ == "__main__":
    main()
`;

function runPythonDetector(framePaths: string[]): Promise<{
  frame_w: number;
  frame_h: number;
  persons: HitboxV2Person[];
}> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, ["-c", PY_SCRIPT]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", (e: Error) =>
      reject(new Error(`python detect-v2 spawn failed: ${e.message}`)),
    );
    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        return reject(
          new Error(
            `python detect-v2 exited ${code}: ${stderr.slice(-600) || stdout.slice(-300)}`,
          ),
        );
      }
      try {
        const parsed = JSON.parse(stdout) as {
          frame_w: number;
          frame_h: number;
          persons: HitboxV2Person[];
        };
        resolve(parsed);
      } catch (e) {
        reject(
          new Error(
            `python detect-v2 returned invalid JSON: ${(e as Error).message} — ${stdout.slice(-200)}`,
          ),
        );
      }
    });
    proc.stdin.write(JSON.stringify({ frames: framePaths }));
    proc.stdin.end();
  });
}

/** Convenience for the inspector — confirms detection has been run. */
export async function hasDetectionV2(jsonbValue: unknown): Promise<boolean> {
  if (!jsonbValue || typeof jsonbValue !== "object") return false;
  const v = jsonbValue as { persons?: unknown };
  return Array.isArray(v.persons);
}

// Suppress unused-import lint warnings for helpers used only by callers.
void access;
