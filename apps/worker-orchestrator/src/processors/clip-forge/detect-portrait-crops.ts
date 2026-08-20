import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * Clip Forge — face-detected portrait crops.
 *
 * Given the source video + the facecam layout (PiP / split / fullscreen),
 * find each speaker's face position across N sampled frames and return a
 * portrait-shaped crop (~9:16) centered horizontally on the dominant face
 * with the head roughly in the upper third and torso framed below.
 *
 * Output is persisted to `cf_sources.portrait_crops` and consumed by the
 * 9:16 renderer. The renderer prefers these crops over heuristic ones
 * derived from facecam_layout alone.
 *
 * Why we do this:
 *   - Source frame is usually 16:9 landscape. A naive "split the frame in
 *     half" gives boxes where the speaker is off-center, or shows too much
 *     room and not enough face.
 *   - Face detection picks the actual head location once, then we build a
 *     portrait box around it that:
 *       - is at least PORTRAIT_TARGET_ASPECT (9:16) — keeps the box visually
 *         tall when fit into the 9:16 output canvas
 *       - puts the head at ~25% from the top → upper-third framing
 *       - extends downward to include the torso
 *       - never extends beyond the parent region
 *
 * Detector is implemented in Python and shelled out (OpenCV + numpy). The
 * VPS image has python3 + opencv-python-headless installed for the
 * existing Whisper/clip-forge toolchain.
 */

export type PortraitCrop = { x: number; y: number; w: number; h: number };

export interface DetectionHitbox {
  /** YOLO11n person bounding box, frame-global coords. */
  person_box: PortraitCrop;
  /** YOLO confidence 0..1 for the person box. */
  person_conf: number;
  /** YuNet face bounding box, frame-global coords. */
  face_box: PortraitCrop;
  /** YuNet confidence 0..1 for the face box. */
  face_conf: number;
  /** How many of the sampled frames produced a hit. */
  n_hits: number;
}

export interface PortraitCropsResult {
  /** 9:16 face-centered crop for fullscreen sources (whole frame). */
  fullscreen_portrait: PortraitCrop | null;
  /** 9:16 face-centered crop tightening the facecam PiP region. */
  facecam_portrait: PortraitCrop | null;
  /** 9:16 face-centered crop in the "main" region (non-PiP side). */
  main_portrait: PortraitCrop | null;
  /** 4:3 head+chest crop for fullscreen sources (zones panels). */
  fullscreen_headshot: PortraitCrop | null;
  /** 4:3 head+chest crop tightening the facecam PiP region (zones top panel). */
  facecam_headshot: PortraitCrop | null;
  /** 4:3 head+chest crop in the "main" region (zones bottom panel). */
  main_headshot: PortraitCrop | null;
  /** Person + face detection geometry for the fullscreen region (debug overlay). */
  fullscreen_hitbox: DetectionHitbox | null;
  /** Person + face detection geometry for the facecam PiP region (debug overlay). */
  facecam_hitbox: DetectionHitbox | null;
  /** Person + face detection geometry for the main region (debug overlay). */
  main_hitbox: DetectionHitbox | null;
  detected_at: string;
  samples: number;
  confidence: number;
}

export interface FacecamRegion {
  role: "main" | "facecam";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DetectPortraitCropsOptions {
  sourcePath: string;
  durationSec: number;
  frameW: number;
  frameH: number;
  /** From facecam_layout. "fullscreen" mode → only fullscreen crop computed. */
  mode: "pip" | "split" | "fullscreen";
  /** From facecam_layout.boxes. */
  boxes: FacecamRegion[];
  workDir: string;
  sampleCount?: number;
  log?: (line: object) => void;
}

const PYTHON_BIN = process.env["PYTHON_BIN"] ?? "python3";
const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";

export async function detectPortraitCrops(
  opts: DetectPortraitCropsOptions,
): Promise<PortraitCropsResult> {
  const sampleCount = opts.sampleCount ?? 16;
  const log = opts.log ?? ((line) => console.log(JSON.stringify(line)));
  const framesDir = join(opts.workDir, "portrait-samples");
  await mkdir(framesDir, { recursive: true });

  log({
    level: "info",
    msg: "[detect-portrait] sampling frames",
    samples: sampleCount,
    mode: opts.mode,
  });

  // Sample evenly, skipping intros/outros which often have title cards.
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

  // Build the region list we want a crop for.
  //   - fullscreen mode: one region covering the whole frame
  //   - pip mode: facecam region + the "opposite" rectangle as main
  //   - split mode: both boxes as their respective roles
  const detectorRegions = buildDetectorRegions(opts);

  const detected = await runPythonDetector(framePaths, detectorRegions);

  await rm(framesDir, { recursive: true, force: true }).catch(() => {});

  const result: PortraitCropsResult = {
    fullscreen_portrait: detected.regions.fullscreen_portrait ?? null,
    facecam_portrait: detected.regions.facecam_portrait ?? null,
    main_portrait: detected.regions.main_portrait ?? null,
    fullscreen_headshot: detected.regions.fullscreen_headshot ?? null,
    facecam_headshot: detected.regions.facecam_headshot ?? null,
    main_headshot: detected.regions.main_headshot ?? null,
    fullscreen_hitbox: detected.regions.fullscreen_hitbox ?? null,
    facecam_hitbox: detected.regions.facecam_hitbox ?? null,
    main_hitbox: detected.regions.main_hitbox ?? null,
    detected_at: new Date().toISOString(),
    samples: sampleCount,
    confidence: detected.confidence,
  };

  log({
    level: "info",
    msg: "[detect-portrait] complete",
    portrait: {
      fullscreen: result.fullscreen_portrait,
      facecam: result.facecam_portrait,
      main: result.main_portrait,
    },
    headshot: {
      fullscreen: result.fullscreen_headshot,
      facecam: result.facecam_headshot,
      main: result.main_headshot,
    },
    confidence: result.confidence,
  });

  return result;
}

type DetectorRegion = {
  /** Which output crop slot this region populates. */
  role: "fullscreen" | "facecam" | "main";
  x: number;
  y: number;
  w: number;
  h: number;
};

function buildDetectorRegions(
  opts: DetectPortraitCropsOptions,
): DetectorRegion[] {
  const { mode, boxes, frameW, frameH } = opts;

  if (mode === "fullscreen") {
    return [{ role: "fullscreen", x: 0, y: 0, w: frameW, h: frameH }];
  }

  if (mode === "pip") {
    const facecam = boxes.find((b) => b.role === "facecam");
    if (!facecam) {
      // No PiP detected after all — treat as fullscreen.
      return [{ role: "fullscreen", x: 0, y: 0, w: frameW, h: frameH }];
    }
    // Main region = largest uncovered rectangle on the opposite side of the
    // PiP. Corner-anchored PiPs leave a big rectangular open side.
    const main = oppositeRect(frameW, frameH, facecam);
    return [
      {
        role: "facecam",
        x: facecam.x,
        y: facecam.y,
        w: facecam.w,
        h: facecam.h,
      },
      { role: "main", x: main.x, y: main.y, w: main.w, h: main.h },
    ];
  }

  // mode === "split"
  const main = boxes.find((b) => b.role === "main");
  const facecam = boxes.find((b) => b.role === "facecam");
  const regions: DetectorRegion[] = [];
  if (main) {
    regions.push({ role: "main", x: main.x, y: main.y, w: main.w, h: main.h });
  }
  if (facecam) {
    regions.push({
      role: "facecam",
      x: facecam.x,
      y: facecam.y,
      w: facecam.w,
      h: facecam.h,
    });
  }
  return regions;
}

function oppositeRect(
  frameW: number,
  frameH: number,
  pip: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const onLeft = pip.x < frameW / 2;
  // If PiP is on the left side, main = right side, vice versa.
  if (onLeft) {
    return { x: pip.x + pip.w, y: 0, w: frameW - (pip.x + pip.w), h: frameH };
  }
  return { x: 0, y: 0, w: pip.x, h: frameH };
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

// ---------------------------------------------------------------------------
// Python detector. OpenCV Haar cascade for frontal faces — small, fast,
// good enough for talking heads. Per region we crop, run detection,
// median-cluster face centers across frames, then build a 9:16-ish
// portrait box around the dominant face.
// ---------------------------------------------------------------------------

const DETECTOR_SCRIPT = `
import sys, os, json
import numpy as np
import cv2

os.environ.setdefault("YOLO_VERBOSE", "False")
from ultralytics import YOLO

# YOLO11n person box + YuNet face center. Two crops per region:
#
#   portrait — 9:16 head+body, face vertically centered. Used for
#              fullscreen layouts where the speaker is the only thing
#              on the canvas. Crop is sized off the body box so the
#              full torso fits inside, with face anchored near canvas
#              vertical center.
#
#   headshot — 4:3 head+chest, face in upper third. Used for zones
#              panels where two speakers are stacked. Crop height is
#              ~4.5x face height — head + chest, no waist/arms.

MODELS_DIR = os.environ.get("CF_MODELS_DIR", "/opt/content-forge/models")
YOLO_MODEL_PATH = os.environ.get(
    "CF_YOLO_MODEL", os.path.join(MODELS_DIR, "yolo11n.pt"),
)
YUNET_MODEL_PATH = os.environ.get(
    "CF_YUNET_MODEL", os.path.join(MODELS_DIR, "yunet.onnx"),
)

PORTRAIT_ASPECT = 9.0 / 16.0
HEADSHOT_ASPECT = 4.0 / 3.0
PORTRAIT_FACE_TOP_FRAC = 0.40
HEADSHOT_FACE_TOP_FRAC = 0.20
PORTRAIT_PAD_W = 0.08
PORTRAIT_PAD_H = 0.07
HEADSHOT_HEAD_FACE_RATIO = 4.5

person_model = YOLO(YOLO_MODEL_PATH)
face_detector = cv2.FaceDetectorYN_create(
    YUNET_MODEL_PATH, "", (320, 320),
    score_threshold=0.6, nms_threshold=0.3,
)

def detect_in_region(img, region):
    rx, ry, rw, rh = region["x"], region["y"], region["w"], region["h"]
    rx = max(0, rx); ry = max(0, ry); rw = max(1, rw); rh = max(1, rh)
    sub = img[ry:ry+rh, rx:rx+rw]
    if sub.size == 0:
        return None

    res = person_model.predict(
        sub, classes=[0], conf=0.4, verbose=False, imgsz=640,
    )[0]
    person_box = None
    person_conf = 0.0
    if res.boxes is not None and len(res.boxes) > 0:
        boxes = res.boxes.xyxy.cpu().numpy()
        confs = res.boxes.conf.cpu().numpy()
        areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
        idx = int(np.argmax(areas))
        b = boxes[idx]
        person_box = {
            "x": float(b[0]), "y": float(b[1]),
            "w": float(b[2] - b[0]), "h": float(b[3] - b[1]),
        }
        person_conf = float(confs[idx])

    face_detector.setInputSize((sub.shape[1], sub.shape[0]))
    _, faces = face_detector.detect(sub)
    face_box = None
    face_conf = 0.0
    face_center = face_size = None
    if faces is not None and len(faces) > 0:
        face_arr = np.asarray(faces, dtype=float)
        picked = None
        if person_box is not None:
            for f in face_arr:
                fx, fy, fw, fh = f[0], f[1], f[2], f[3]
                cx, cy = fx + fw / 2.0, fy + fh / 2.0
                if (person_box["x"] <= cx <= person_box["x"] + person_box["w"]
                        and person_box["y"] <= cy <= person_box["y"] + person_box["h"]):
                    picked = f
                    break
        if picked is None:
            face_areas = face_arr[:, 2] * face_arr[:, 3]
            picked = face_arr[int(np.argmax(face_areas))]
        face_box = {
            "x": float(picked[0]), "y": float(picked[1]),
            "w": float(picked[2]), "h": float(picked[3]),
        }
        face_conf = float(picked[-1]) if len(picked) >= 15 else 0.9
        face_center = (face_box["x"] + face_box["w"] / 2.0,
                       face_box["y"] + face_box["h"] / 2.0)
        face_size = (face_box["w"], face_box["h"])

    if person_box is None and face_center is None:
        return None
    if person_box is None:
        fcx, fcy = face_center
        fw, fh = face_size
        person_box = {
            "x": fcx - fw * 2.0, "y": fcy - fh * 1.0,
            "w": fw * 4.0, "h": fh * 7.0,
        }
        person_conf = 0.0
    if face_center is None:
        face_center = (
            person_box["x"] + person_box["w"] / 2.0,
            person_box["y"] + person_box["h"] * 0.12,
        )
        face_size = (person_box["w"] * 0.3, person_box["h"] * 0.18)
        face_box = {
            "x": face_center[0] - face_size[0] / 2.0,
            "y": face_center[1] - face_size[1] / 2.0,
            "w": face_size[0], "h": face_size[1],
        }
        face_conf = 0.0

    return {
        "person_box": person_box,
        "person_conf": person_conf,
        "face_box": face_box,
        "face_conf": face_conf,
        "face_center": face_center,
        "face_size": face_size,
    }

def aggregate(per_frame):
    valid = [d for d in per_frame if d is not None]
    if len(valid) < 2:
        return None
    def med(extract):
        return float(np.median([extract(d) for d in valid]))
    return {
        "person_box": {
            "x": med(lambda d: d["person_box"]["x"]),
            "y": med(lambda d: d["person_box"]["y"]),
            "w": med(lambda d: d["person_box"]["w"]),
            "h": med(lambda d: d["person_box"]["h"]),
        },
        "person_conf": med(lambda d: d["person_conf"]),
        "face_box": {
            "x": med(lambda d: d["face_box"]["x"]),
            "y": med(lambda d: d["face_box"]["y"]),
            "w": med(lambda d: d["face_box"]["w"]),
            "h": med(lambda d: d["face_box"]["h"]),
        },
        "face_conf": med(lambda d: d["face_conf"]),
        "face_center": (
            med(lambda d: d["face_center"][0]),
            med(lambda d: d["face_center"][1]),
        ),
        "face_size": (
            med(lambda d: d["face_size"][0]),
            med(lambda d: d["face_size"][1]),
        ),
        "n_hits": len(valid),
    }

def build_portrait_crop(region, agg):
    rx, ry, rw, rh = region["x"], region["y"], region["w"], region["h"]
    pb = agg["person_box"]
    fcx, fcy = agg["face_center"]
    _, fh = agg["face_size"]

    body_w = pb["w"] * (1.0 + 2 * PORTRAIT_PAD_W)
    body_h = pb["h"] * (1.0 + 2 * PORTRAIT_PAD_H)

    if body_w / max(body_h, 1) > PORTRAIT_ASPECT:
        crop_w, crop_h = body_w, body_w / PORTRAIT_ASPECT
    else:
        crop_h, crop_w = body_h, body_h * PORTRAIT_ASPECT

    scale = min(1.0, rw / crop_w, rh / crop_h)
    crop_w *= scale; crop_h *= scale

    face_top = fcy - fh / 2.0
    crop_top = max(0.0, min(face_top - PORTRAIT_FACE_TOP_FRAC * crop_h, rh - crop_h))
    crop_left = max(0.0, min(fcx - crop_w / 2.0, rw - crop_w))
    return {
        "x": int(round(rx + crop_left)),
        "y": int(round(ry + crop_top)),
        "w": int(round(crop_w)),
        "h": int(round(crop_h)),
    }

def build_headshot_crop(region, agg):
    rx, ry, rw, rh = region["x"], region["y"], region["w"], region["h"]
    fcx, fcy = agg["face_center"]
    _, fh = agg["face_size"]

    crop_h = fh * HEADSHOT_HEAD_FACE_RATIO
    crop_w = crop_h * HEADSHOT_ASPECT
    scale = min(1.0, rw / crop_w, rh / crop_h)
    crop_w *= scale; crop_h *= scale

    face_top = fcy - fh / 2.0
    crop_top = max(0.0, min(face_top - HEADSHOT_FACE_TOP_FRAC * crop_h, rh - crop_h))
    crop_left = max(0.0, min(fcx - crop_w / 2.0, rw - crop_w))
    return {
        "x": int(round(rx + crop_left)),
        "y": int(round(ry + crop_top)),
        "w": int(round(crop_w)),
        "h": int(round(crop_h)),
    }

def centered_fallback(region, aspect):
    rx, ry, rw, rh = region["x"], region["y"], region["w"], region["h"]
    crop_h = rh
    crop_w = crop_h * aspect
    if crop_w > rw:
        crop_w = rw
        crop_h = crop_w / aspect
    return {
        "x": int(round(rx + (rw - crop_w) / 2.0)),
        "y": int(round(ry + (rh - crop_h) / 2.0)),
        "w": int(round(crop_w)),
        "h": int(round(crop_h)),
    }

def main():
    payload = json.loads(sys.stdin.read())
    frames = []
    for fp in payload["frames"]:
        img = cv2.imread(fp)
        if img is None:
            continue
        frames.append(img)
    if not frames:
        print(json.dumps({"regions": {}, "confidence": 0.0}))
        return

    out = {}
    hit_count = 0
    for region in payload["regions"]:
        role = region["role"]
        rx, ry = region["x"], region["y"]
        detections = [detect_in_region(f, region) for f in frames]
        agg = aggregate(detections)
        if agg is None:
            out[role + "_portrait"] = centered_fallback(region, PORTRAIT_ASPECT)
            out[role + "_headshot"] = centered_fallback(region, HEADSHOT_ASPECT)
            out[role + "_hitbox"] = None
        else:
            out[role + "_portrait"] = build_portrait_crop(region, agg)
            out[role + "_headshot"] = build_headshot_crop(region, agg)
            pb = agg["person_box"]; fb = agg["face_box"]
            out[role + "_hitbox"] = {
                "person_box": {
                    "x": int(round(rx + pb["x"])),
                    "y": int(round(ry + pb["y"])),
                    "w": int(round(pb["w"])),
                    "h": int(round(pb["h"])),
                },
                "person_conf": round(agg["person_conf"], 3),
                "face_box": {
                    "x": int(round(rx + fb["x"])),
                    "y": int(round(ry + fb["y"])),
                    "w": int(round(fb["w"])),
                    "h": int(round(fb["h"])),
                },
                "face_conf": round(agg["face_conf"], 3),
                "n_hits": agg["n_hits"],
            }
            hit_count += 1

    confidence = hit_count / max(1, len(payload["regions"]))
    print(json.dumps({"regions": out, "confidence": float(confidence)}))

if __name__ == "__main__":
    main()
`;

type DetectorCropKey =
  | "fullscreen_portrait"
  | "facecam_portrait"
  | "main_portrait"
  | "fullscreen_headshot"
  | "facecam_headshot"
  | "main_headshot";

type DetectorHitboxKey = "fullscreen_hitbox" | "facecam_hitbox" | "main_hitbox";

type DetectorRegions = Partial<
  Record<DetectorCropKey, PortraitCrop> &
    Record<DetectorHitboxKey, DetectionHitbox>
>;

function runPythonDetector(
  framePaths: string[],
  regions: DetectorRegion[],
): Promise<{
  regions: DetectorRegions;
  confidence: number;
}> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, ["-c", DETECTOR_SCRIPT]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", (e) =>
      reject(new Error(`python portrait detector spawn failed: ${e.message}`)),
    );
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `python portrait detector exited ${code}: ${stderr.slice(-600) || stdout.slice(-300)}`,
          ),
        );
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as {
          regions: DetectorRegions;
          confidence: number;
        };
        resolve(parsed);
      } catch (e) {
        reject(
          new Error(
            `python portrait detector returned invalid JSON: ${(e as Error).message} — ${stdout.slice(-200)}`,
          ),
        );
      }
    });
    proc.stdin.write(JSON.stringify({ frames: framePaths, regions: regions }));
    proc.stdin.end();
  });
}
