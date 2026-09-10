import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execa = promisify(execFile);
import { runVideoQaGate, SCREEN_RECORDING_QA_THRESHOLDS } from "@repo/media-core";
it.skipIf(process.env["RUN_REAL_TUTORIAL_QA"] !== "1")("measures real synthetic audio and distinguishes visible video from black output", async () => {
  const root = await mkdtemp(join(tmpdir(), "tutorial-qa-synthetic-"));
  try {
    for (const color of ["blue", "black"]) {
      const output = join(root, `${color}.mp4`);
      await execa(process.env["FFMPEG_PATH"] ?? "ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${color}:s=320x180:r=15:d=4`, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4", "-af", "loudnorm=I=-14:TP=-1:LRA=7", "-c:v", "libx264", "-preset", "ultrafast", "-threads", "1", "-c:a", "aac", "-shortest", output], { timeout: 30000 });
      const qa = await runVideoQaGate(output, { requireAudio: true }, SCREEN_RECORDING_QA_THRESHOLDS);
      const loudness = qa.checks.find(check => check.id === "loudness")!;
      expect(loudness.status).toBe("pass");
      expect(Math.abs(Number(loudness.measured?.integrated_lufs) + 14)).toBeLessThan(2);
      expect(qa.checks.find(check => check.id === "black")?.status).toBe(color === "black" ? "fail" : "pass");
      expect(qa.passed).toBe(color === "blue");
      if (color === "blue") await expect(runVideoQaGate(output, {}, SCREEN_RECORDING_QA_THRESHOLDS, (async () => ({ exitCode: 1, stderr: "partial decode" })) as any)).rejects.toThrow("did not complete");
    }
  } finally {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes("tutorial-qa-synthetic-")) throw new Error("Unsafe synthetic cleanup path");
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
