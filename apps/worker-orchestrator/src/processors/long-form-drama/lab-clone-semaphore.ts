/**
 * Per-process concurrency cap on lab-clone video i2v calls.
 *
 * The lab clone has ~1 truly clean IP (the eduVPN tunnel); residential
 * proxies storm UNUSUAL_ACTIVITY on video. The operator confirms ~6 is
 * the stable ceiling. Image gen flows through a different account+route
 * mix and isn't affected by this cap.
 *
 * Cap is shared across image-gen's inline pipeline-parallel path AND
 * video-gen's cleanup pass — both import this module, so a 25-clip
 * drama can't accidentally fire 25 lab-clone video calls at once if
 * the VUP wrapper is offline.
 *
 * Override via env: DRAMA_LAB_CLONE_VIDEO_CONCURRENCY (default 6).
 */
const MAX_INFLIGHT = Number(
  process.env["DRAMA_LAB_CLONE_VIDEO_CONCURRENCY"] ?? "6",
);

let inFlight = 0;
const waiting: Array<() => void> = [];

export async function acquireLabCloneVideoSlot(): Promise<() => void> {
  if (inFlight >= MAX_INFLIGHT) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  inFlight += 1;
  return () => {
    inFlight -= 1;
    const next = waiting.shift();
    if (next) next();
  };
}

export function labCloneSlotsInFlight(): number {
  return inFlight;
}
