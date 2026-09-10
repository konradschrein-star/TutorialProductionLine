import { expect, it } from "vitest";
import { libraryDuration, libraryStageTone, youtubeLibraryLinks } from "../tutorial-library";
it("only derives YouTube Studio from known valid video URLs", () => {
  expect(youtubeLibraryLinks("https://youtu.be/abcdefghijk")).toEqual({
    youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    youtubeStudioUrl: "https://studio.youtube.com/video/abcdefghijk/edit",
  });
  for (const value of [
    null,
    "javascript:alert(1)",
    "https://youtube.com.evil.test/watch?v=abcdefghijk",
    "https://youtube.com/watch?v=short",
    "https://user:pass@youtube.com/watch?v=abcdefghijk",
  ])
    expect(youtubeLibraryLinks(value).youtubeUrl).toBeNull();
});
it("does not invent an unmeasured duration", () => {
  expect(libraryDuration(null)).toBe("—");
  expect(libraryDuration("NaN")).toBe("—");
  expect(libraryDuration("125.5")).toBe("2:05");
});
it("colors stages without treating waiting or unknown work as complete", () => {
  expect(libraryStageTone("COMPLETED")).toBe("success");
  expect(libraryStageTone("FAILED_AUDIO")).toBe("danger");
  expect(libraryStageTone("AWAITING_THUMBNAILS")).toBe("warning");
  expect(libraryStageTone("GENERATING_SCRIPT")).toBe("active");
  expect(libraryStageTone("UNKNOWN")).toBe("neutral");
});
