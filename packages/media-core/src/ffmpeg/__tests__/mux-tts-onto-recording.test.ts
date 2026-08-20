import { describe, it, expect } from "vitest";
import { buildMuxArgs } from "../mux-tts-onto-recording.js";

describe("buildMuxArgs (speed correction)", () => {
  it("slows the video when the VA recorded fast (audio longer than recording)", () => {
    // audio 120s, recording 60s -> factor 2.0 -> setpts=2*PTS (slows video to ~120s)
    const args = buildMuxArgs({
      recordingPath: "/rec.mp4",
      ttsAudioPath: "/tts.mp3",
      outputPath: "/out.mp4",
      factor: 2,
      videoCodec: "libx264",
    });
    expect(args).toContain("setpts=2*PTS");
    const joined = args.join(" ");
    expect(joined).toContain("-map 0:v");
    expect(joined).toContain("-map 1:a");
    expect(joined).toContain("-shortest");
  });

  it("speeds the video when the VA recorded slow (recording longer than audio)", () => {
    const args = buildMuxArgs({
      recordingPath: "/rec.mp4",
      ttsAudioPath: "/tts.mp3",
      outputPath: "/out.mp4",
      factor: 0.5,
      videoCodec: "libx264",
    });
    expect(args).toContain("setpts=0.5*PTS");
  });

  it("uses the veryfast x264 preset — every splice falls back to CPU", () => {
    const args = buildMuxArgs({
      recordingPath: "/rec.mp4",
      ttsAudioPath: "/tts.mp3",
      outputPath: "/out.mp4",
      factor: 2,
      videoCodec: "libx264",
    });
    expect(args.join(" ")).toContain("-preset veryfast");
  });

  it("leaves the NVENC preset alone (different preset vocabulary)", () => {
    const args = buildMuxArgs({
      recordingPath: "/rec.mp4",
      ttsAudioPath: "/tts.mp3",
      outputPath: "/out.mp4",
      factor: 2,
      videoCodec: "h264_nvenc",
    });
    expect(args.join(" ")).toContain("-preset fast");
  });

  it("uses the requested codec and ends with the output path", () => {
    const args = buildMuxArgs({
      recordingPath: "/rec.mp4",
      ttsAudioPath: "/tts.mp3",
      outputPath: "/out.mp4",
      factor: 1,
      videoCodec: "h264_nvenc",
    });
    expect(args).toContain("h264_nvenc");
    expect(args[args.length - 1]).toBe("/out.mp4");
  });
});
