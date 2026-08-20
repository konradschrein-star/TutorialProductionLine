import { describe, it, expect } from "vitest";
import {
  vttToPlainText,
  countTranscriptWords,
  isYouTubeUrl,
  pickSubtitleLang,
  subtitleLanguagesFor,
} from "../yt-transcript";

/**
 * The VTT samples below are trimmed from the REAL captions of
 * https://www.youtube.com/watch?v=vCNASTnM6p4 ("Ableton Live 11 - Tutorial for
 * Beginners in 12 MINUTES!"), fetched on prod on 2026-08-04. That video is a
 * live Keyword Tool row (kt_keywords id 39991, 10-20min, 749s), so this is the
 * exact shape the Create form now has to render.
 */

describe("vttToPlainText", () => {
  it("drops YouTube's Style block instead of reading CSS out to the VA", () => {
    // THE BUG: `STYLE` was matched as a one-line header, so "Style:" was
    // dropped and the CSS under it was kept — every transcript began
    // "::cue(c.cyan) { color: cyan; } ## Dear all, welcome to…".
    const vtt = [
      "WEBVTT",
      "Kind: captions",
      "Language: en",
      "Style:",
      "::cue(c.cyan) { color: cyan; }",
      "##",
      "",
      "00:00:00.500 --> 00:00:05.500 position:97%",
      "<c.cyan>Dear all, welcome to this new tutorial.</c>",
      "",
    ].join("\n");
    expect(vttToPlainText(vtt)).toBe("Dear all, welcome to this new tutorial.");
  });

  it("ends a block at the blank line and keeps the cues after it", () => {
    const vtt = [
      "WEBVTT",
      "",
      "NOTE this file was machine generated",
      "and this second line is still the note",
      "",
      "00:00:01.000 --> 00:00:02.000",
      "Real narration here.",
      "",
    ].join("\n");
    expect(vttToPlainText(vtt)).toBe("Real narration here.");
  });

  it("de-dupes the rolling repeats YouTube's auto-captions emit", () => {
    // Without this a naive join triples the word count and the LLM is handed a
    // stutter. Same rule as the worker's converter.
    const vtt = [
      "WEBVTT",
      "",
      "00:00:01.000 --> 00:00:02.000",
      "open the settings panel",
      "",
      "00:00:02.000 --> 00:00:03.000",
      "open the settings panel",
      "",
      "00:00:03.000 --> 00:00:04.000",
      "and choose audio",
      "",
    ].join("\n");
    expect(vttToPlainText(vtt)).toBe(
      "open the settings panel and choose audio",
    );
  });

  it("strips cue indices, timings and inline karaoke tags", () => {
    const vtt = [
      "WEBVTT",
      "",
      "1",
      "00:00:01.000 --> 00:00:02.000",
      "<00:00:01.100><c>Click</c> <00:00:01.400><c>New</c> &amp; save",
      "",
    ].join("\n");
    expect(vttToPlainText(vtt)).toBe("Click New & save");
  });

  it("returns an empty string for a caption file with no cues", () => {
    // The caller turns this into TRANSCRIPT_TOO_SHORT. It must never invent
    // text to fill the box.
    expect(vttToPlainText("WEBVTT\nKind: captions\nLanguage: en\n")).toBe("");
  });
});

describe("countTranscriptWords", () => {
  it("counts words, not characters or lines", () => {
    expect(countTranscriptWords("one two  three\nfour")).toBe(4);
    expect(countTranscriptWords("   ")).toBe(0);
  });
});

describe("isYouTubeUrl", () => {
  it("accepts the forms the Keyword Tool and VAs actually produce", () => {
    // KT builds https://www.youtube.com/watch?v=<video_id>.
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=vCNASTnM6p4")).toBe(
      true,
    );
    expect(isYouTubeUrl("https://youtu.be/vCNASTnM6p4")).toBe(true);
    expect(isYouTubeUrl("http://m.youtube.com/watch?v=x")).toBe(true);
  });

  it("rejects everything else so the failure is named, not guessed at", () => {
    expect(isYouTubeUrl("https://vimeo.com/12345")).toBe(false);
    expect(isYouTubeUrl("not a url")).toBe(false);
    // A lookalike host must not slip through.
    expect(isYouTubeUrl("https://notyoutube.com/watch?v=x")).toBe(false);
  });
});

describe("pickSubtitleLang", () => {
  it("prefers an exact tag, then a regional variant", () => {
    expect(pickSubtitleLang(["de", "en-GB", "fr"], ["en"])).toBe("en-GB");
    expect(pickSubtitleLang(["en-GB", "en"], ["en"])).toBe("en");
  });

  it("is null when the language is genuinely absent", () => {
    expect(pickSubtitleLang(["de", "fr"], ["en"])).toBeNull();
    expect(pickSubtitleLang([], ["en"])).toBeNull();
  });
});

describe("subtitleLanguagesFor", () => {
  it("always keeps English as a fallback for a non-English job", () => {
    // Most tutorial source videos are English even when the output is dubbed.
    expect(subtitleLanguagesFor("German")).toEqual(["de", "en"]);
    expect(subtitleLanguagesFor("English")).toEqual(["en"]);
    expect(subtitleLanguagesFor(null)).toEqual(["en"]);
  });
});
