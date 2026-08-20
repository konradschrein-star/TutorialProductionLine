import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchYouTubeSubtitles = vi.fn();
vi.mock("../../yt-dlp-client.js", () => ({
  fetchYouTubeSubtitles: (...args: unknown[]) =>
    fetchYouTubeSubtitles(...args) as unknown,
}));

const {
  vttToPlainText,
  resolveSourceTranscript,
  SourceTranscriptError,
  subtitleLanguagesFor,
  isYouTubeUrl,
  MIN_TRANSCRIPT_WORDS,
} = await import("../source-transcript.js");

const AUTO_CAPTION_VTT = `WEBVTT
Kind: captions
Language: en

00:00:00.120 --> 00:00:02.500 align:start position:0%
so today we're going to look at

00:00:02.500 --> 00:00:05.000 align:start position:0%
so today we're going to look at
<00:00:03.100><c> how</c> to export

00:00:05.000 --> 00:00:07.400 align:start position:0%
how to export
your project as an mp4
`;

function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
}

describe("vttToPlainText", () => {
  const text = vttToPlainText(AUTO_CAPTION_VTT);

  it("drops the WEBVTT header, Kind/Language lines and cue timings", () => {
    expect(text).not.toMatch(/WEBVTT/);
    expect(text).not.toMatch(/Kind:/);
    expect(text).not.toMatch(/-->/);
    expect(text).not.toMatch(/00:00/);
  });

  it("strips inline karaoke timings and <c> spans", () => {
    expect(text).not.toMatch(/[<>]/);
    expect(text).toContain("how to export");
  });

  it("de-duplicates YouTube's rolling auto-captions", () => {
    // "so today we're going to look at" appears in two consecutive cues, and
    // "how to export" in two more. A naive concat would say each twice and hand
    // the writer a stutter.
    const occurrences = (needle: string) => text.split(needle).length - 1;
    expect(occurrences("so today we're going to look at")).toBe(1);
    expect(occurrences("how to export")).toBe(1);
  });

  it("produces a single normalised line of prose", () => {
    expect(text).toBe(
      "so today we're going to look at how to export your project as an mp4",
    );
  });

  // ── The CSS-leak regression ────────────────────────────────────────────────
  //
  // NOTE / STYLE / REGION are BLOCKS in the WebVTT grammar — the keyword opens
  // them, a blank line closes them. They used to be matched as one-LINE headers,
  // which dropped "Style:" and kept its body, so every fetched transcript began
  // "::cue(c.cyan) { color: cyan; } ## Dear all, welcome to…" — and that string
  // was fed to the script LLM as the opening words of the source material.
  // Measured on prod 2026-08-04: 1,600 words with the leak, 1,594 without.
  //
  // This is the real header YouTube emits, verbatim.
  const YOUTUBE_STYLE_BLOCK_VTT = `WEBVTT
Kind: captions
Language: en

STYLE
::cue(c.colorCCCCCC) { color: rgb(204,204,204); }
::cue(c.colorE5E5E5) { color: rgb(229,229,229); }
##

NOTE
This file was produced by an automated pipeline.
Do not edit by hand.

REGION
id:speaker
width:40%
lines:3

00:00:00.000 --> 00:00:03.000
Dear all, welcome to this tutorial

00:00:03.000 --> 00:00:06.000
today we are exporting a project
`;

  it("skips multi-line STYLE/NOTE/REGION blocks to the blank line", () => {
    const styled = vttToPlainText(YOUTUBE_STYLE_BLOCK_VTT);
    expect(styled).toBe(
      "Dear all, welcome to this tutorial today we are exporting a project",
    );
    // The specific leaked strings, named so a regression is unmistakable.
    expect(styled).not.toMatch(/::cue/);
    expect(styled).not.toMatch(/color:/);
    expect(styled).not.toMatch(/##/);
    expect(styled).not.toMatch(/automated pipeline/);
    expect(styled).not.toMatch(/width:40%/);
  });

  it("starts at the first spoken word, not at CSS", () => {
    expect(vttToPlainText(YOUTUBE_STYLE_BLOCK_VTT).startsWith("Dear all")).toBe(
      true,
    );
  });

  it("accepts YouTube's `Style:` spelling as a block, not a header", () => {
    // The prod header is `Style:` with a colon on many videos; `\b` must treat
    // that as the block keyword too, or the CSS body walks straight through.
    const withColon = vttToPlainText(`WEBVTT
Kind: captions
Language: en
Style:
::cue(c.cyan) { color: cyan; }
##

00:00:00.000 --> 00:00:02.000
Dear all, welcome to this tutorial
`);
    expect(withColon).toBe("Dear all, welcome to this tutorial");
  });
});

describe("subtitleLanguagesFor", () => {
  it("defaults to English", () => {
    expect(subtitleLanguagesFor(null)).toEqual(["en"]);
    expect(subtitleLanguagesFor("English")).toEqual(["en"]);
  });

  it("maps a named language and keeps English as a usable secondary", () => {
    expect(subtitleLanguagesFor("German")).toEqual(["de", "en"]);
  });

  it("passes an explicit code through", () => {
    expect(subtitleLanguagesFor("pt-BR")).toEqual(["pt-br", "en"]);
  });
});

describe("isYouTubeUrl", () => {
  it("accepts the forms VAs actually paste", () => {
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(isYouTubeUrl("https://youtu.be/abc")).toBe(true);
    expect(isYouTubeUrl("https://m.youtube.com/watch?v=abc")).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isYouTubeUrl("https://vimeo.com/12345")).toBe(false);
  });
});

/**
 * The whole point of TRANSCRIPT_REWRITE is that the script is grounded in a
 * specific competitor video. Repo rule: NO SYNTHETIC FALLBACKS — a job that
 * cannot get its source must stop, never quietly degrade into a from-scratch
 * script that looks identical from the outside.
 */
describe("resolveSourceTranscript", () => {
  beforeEach(() => {
    fetchYouTubeSubtitles.mockReset();
  });

  it("uses a transcript already on the job without touching the network", async () => {
    const provided = words(200);
    const res = await resolveSourceTranscript({
      referenceTranscript: provided,
      referenceUrl: "https://youtu.be/abc",
    });
    expect(res.source).toBe("provided");
    expect(res.transcript).toBe(provided);
    expect(fetchYouTubeSubtitles).not.toHaveBeenCalled();
  });

  it("fetches captions from the reference URL when none was pasted", async () => {
    fetchYouTubeSubtitles.mockResolvedValue({
      kind: "manual",
      lang: "en",
      vtt: `WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n${words(120)}\n`,
      video_id: "abc",
      title: "How to export",
      duration_seconds: 640,
      manual_langs: ["en"],
      auto_langs: ["en"],
    });

    const res = await resolveSourceTranscript({
      referenceUrl: "https://youtu.be/abc",
      language: "English",
    });

    expect(fetchYouTubeSubtitles).toHaveBeenCalledWith("https://youtu.be/abc", [
      "en",
    ]);
    expect(res.source).toBe("youtube_manual_captions");
    expect(res.video_seconds).toBe(640);
    expect(res.video_title).toBe("How to export");
    expect(res.word_count).toBe(120);
  });

  it("labels auto captions as auto so the prompt can distrust their spelling", async () => {
    fetchYouTubeSubtitles.mockResolvedValue({
      kind: "auto",
      lang: "en",
      vtt: `WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n${words(120)}\n`,
      video_id: "abc",
      title: "t",
      duration_seconds: 100,
      manual_langs: [],
      auto_langs: ["en"],
    });
    const res = await resolveSourceTranscript({
      referenceUrl: "https://youtu.be/abc",
    });
    expect(res.source).toBe("youtube_auto_captions");
  });

  it("throws NO_SOURCE when there is neither a URL nor a transcript", async () => {
    await expect(resolveSourceTranscript({})).rejects.toMatchObject({
      name: "SourceTranscriptError",
      code: "NO_SOURCE",
    });
  });

  it("throws NO_CAPTIONS when the video has none — never falls back", async () => {
    fetchYouTubeSubtitles.mockResolvedValue(null);
    await expect(
      resolveSourceTranscript({ referenceUrl: "https://youtu.be/abc" }),
    ).rejects.toMatchObject({ code: "NO_CAPTIONS" });
  });

  it("throws FETCH_FAILED with the underlying yt-dlp error attached", async () => {
    fetchYouTubeSubtitles.mockRejectedValue(
      new Error("yt-dlp exited 1: Sign in to confirm you're not a bot"),
    );
    const err = await resolveSourceTranscript({
      referenceUrl: "https://youtu.be/abc",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceTranscriptError);
    expect((err as InstanceType<typeof SourceTranscriptError>).code).toBe(
      "FETCH_FAILED",
    );
    expect((err as Error).message).toMatch(/not a bot/);
    expect((err as Error).message).toMatch(/YT_DLP_COOKIES/);
  });

  it("throws FETCH_FAILED for a non-YouTube URL instead of guessing", async () => {
    await expect(
      resolveSourceTranscript({ referenceUrl: "https://vimeo.com/1" }),
    ).rejects.toMatchObject({ code: "FETCH_FAILED" });
    expect(fetchYouTubeSubtitles).not.toHaveBeenCalled();
  });

  it("rejects a transcript too short to rewrite from", async () => {
    await expect(
      resolveSourceTranscript({ referenceTranscript: words(10) }),
    ).rejects.toMatchObject({ code: "TRANSCRIPT_TOO_SHORT" });

    fetchYouTubeSubtitles.mockResolvedValue({
      kind: "auto",
      lang: "en",
      vtt: `WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n${words(MIN_TRANSCRIPT_WORDS - 1)}\n`,
      video_id: "abc",
      title: "t",
      duration_seconds: 30,
      manual_langs: [],
      auto_langs: ["en"],
    });
    await expect(
      resolveSourceTranscript({ referenceUrl: "https://youtu.be/abc" }),
    ).rejects.toMatchObject({ code: "TRANSCRIPT_TOO_SHORT" });
  });
});
