/**
 * SCRATCH (task R1) — how large and where the presenter actually lands.
 *
 * Priority 1 for this render is "the narrator is VISIBLE". `target_collar_px`
 * is an apparent-size knob, not a size in itself: it says how wide his collar
 * reads, and the figure's real on-screen size falls out of each pose's own
 * collar hitbox. This prints that arithmetic for the five poses the plan places,
 * BEFORE any money is spent, so a figure that would come out as a 40px speck or
 * as a 6000px giant is caught here rather than in a finished MP4.
 *
 * usage: tsx src/scratch-r1-geom.ts [targetCollarPx]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { PoseManifestSchema } from "@repo/contracts";
import {
  requireCalibratedPose,
  resolvePresenterLayout,
} from "@repo/media-core";

const REPO_ROOT = path.resolve(process.cwd(), "../..");
const WIDTH = 1920;
const HEIGHT = 1080;

/** slug -> the side the planner derived for it on this script. */
const PLACED: readonly (readonly [string, "left" | "right" | "center"])[] = [
  ["arms-at-side", "center"],
  ["holding-pointer", "right"],
  ["thumbs-up", "center"],
  ["pointing-down-left", "left"],
];

async function main(): Promise<void> {
  const targetCollarPx = Number(process.argv[2] ?? "150");
  const poses = PoseManifestSchema.parse(
    JSON.parse(
      await readFile(
        path.join(
          REPO_ROOT,
          "media/style-assets/presenter/poses/poses.json",
        ),
        "utf8",
      ),
    ),
  );

  console.log(
    `frame ${WIDTH}x${HEIGHT}, target_collar_px=${targetCollarPx}, ` +
      `bottom_anchor=1, side_inset=0.06\n`,
  );
  for (const [slug, side] of PLACED) {
    const entry = poses.find((p) => p.slug === slug);
    if (entry === undefined) throw new Error(`pose ${slug} missing`);
    const pose = requireCalibratedPose(entry);
    const layout = resolvePresenterLayout({
      pose,
      placement: {
        side,
        targetCollarPx,
        bottomAnchor: 1,
        sideInset: 0.06,
      },
      frameWidth: WIDTH,
      frameHeight: HEIGHT,
    });
    const { suit, head } = layout;
    // The head is what carries the identity and the loudness pump, and it pumps
    // UP to 1.08x, so the peak is what has to clear the frame edge.
    const peakRadius = (head.diameterPx * 1.08) / 2;
    const headTop = head.centreYPx - peakRadius;
    const headLeft = head.centreXPx - peakRadius;
    const headRight = head.centreXPx + peakRadius;
    console.log(
      `${slug.padEnd(20)} side=${side.padEnd(6)} scale=${layout.scale.toFixed(3)} ` +
        `suit ${suit.widthPx}x${suit.heightPx} @(${suit.xPx},${suit.yPx}) ` +
        `${((suit.heightPx / HEIGHT) * 100).toFixed(0)}%H | head d=${head.diameterPx.toFixed(0)} ` +
        `top=${headTop.toFixed(0)} left=${headLeft.toFixed(0)} right=${headRight.toFixed(0)} ` +
        `${headTop >= 0 && headLeft >= 0 && headRight <= WIDTH ? "IN FRAME" : "*** CLIPPED ***"}`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
