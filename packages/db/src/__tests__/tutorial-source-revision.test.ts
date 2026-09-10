import { describe, expect, it } from "vitest";
import { tutorialSourceRevision } from "../tutorial-source-revision.js";

const source = { recording_path: "/recording.mp4", final_path: "/final.mp4", script_text: "Narration", recorded_at: new Date("2026-09-08T12:00:00Z") };
describe("source recording revision fence", () => {
  it("is deterministic across process restarts", () => {
    expect(tutorialSourceRevision(source)).toBe(tutorialSourceRevision({ ...source, recorded_at: new Date(source.recorded_at) }));
  });
  it("changes for a replacement recording even when an old storage path is reused", () => {
    expect(tutorialSourceRevision(source)).not.toBe(tutorialSourceRevision({ ...source, recorded_at: new Date("2026-09-08T12:10:00Z") }));
  });
  it("changes for edited narration or a new final video", () => {
    expect(tutorialSourceRevision(source)).not.toBe(tutorialSourceRevision({ ...source, script_text: "New narration" }));
    expect(tutorialSourceRevision(source)).not.toBe(tutorialSourceRevision({ ...source, final_path: "/new.mp4" }));
  });
});
