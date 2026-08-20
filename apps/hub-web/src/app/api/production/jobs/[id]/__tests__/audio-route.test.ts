import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Regression tests for GET /api/production/jobs/[id]/audio — the endpoint the
 * Tutorial Studio player and the "download audio" button both call.
 *
 * Two VA-reported failures are covered here:
 *
 * 1. "It is stuck at 0 again."  2,113 jobs still carry an `audio_path` whose
 *    file was deleted by the old cleanup watchdog. `stat()` threw ENOENT and
 *    the route answered 500, so the <audio> element got a JSON error body and
 *    sat at 0:00 forever. A missing file is a 404, not a server fault.
 *
 * 2. "Downloading is quite slow."  The route sent `Cache-Control: no-store`,
 *    so the browser could never reuse a file it already had. VAs replay the
 *    same narration dozens of times while recording (measured: 3,083 requests
 *    for 674 distinct files, 7.44 GB where 1.6 GB of unique audio exists).
 *    The audio must be revalidatable — ETag + 304 — so a replay costs a few
 *    hundred bytes instead of 3.5 MB over a congested link.
 */

const mockGetSession = vi.fn();
const mockHasPermission = vi.fn();
const mockGetTutorialJobById = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getSession: () => mockGetSession(),
}));
vi.mock("@/lib/auth/rbac", () => ({
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@repo/db", () => ({
  getTutorialJobById: (...args: unknown[]) => mockGetTutorialJobById(...args),
}));

const { GET } = await import("../audio/route");

const tmpDir = mkdtempSync(join(tmpdir(), "cf-audio-test-"));
const audioFile = join(tmpDir, "tts.mp3");
const AUDIO_BYTES = Buffer.from("ID3fake-mp3-payload-used-for-range-tests!!");
writeFileSync(audioFile, AUDIO_BYTES);

afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

function request(headers: Record<string, string> = {}) {
  return new Request("https://hub.example/api/production/jobs/j1/audio", {
    headers,
  }) as never;
}

const params = Promise.resolve({ id: "j1" });

describe("GET /api/production/jobs/[id]/audio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ userId: "u1", role: "TUTORIAL_VA" });
    mockHasPermission.mockReturnValue(true);
    mockGetTutorialJobById.mockResolvedValue({
      id: "j1",
      created_by: "u1",
      audio_path: audioFile,
    });
  });

  it("answers 404, not 500, when audio_path points at a deleted file", async () => {
    mockGetTutorialJobById.mockResolvedValue({
      id: "j1",
      created_by: "u1",
      audio_path: join(tmpDir, "does-not-exist.mp3"),
    });

    const res = await GET(request(), { params });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(String(body.error)).toMatch(/no longer available/i);
  });

  it("sends a validator and a revalidatable Cache-Control, never no-store", async () => {
    const res = await GET(request(), { params });

    expect(res.status).toBe(200);
    const cacheControl = res.headers.get("Cache-Control") ?? "";
    expect(cacheControl).not.toMatch(/no-store/);
    expect(cacheControl).toMatch(/private/);
    expect(res.headers.get("ETag")).toBeTruthy();
    expect(res.headers.get("Last-Modified")).toBeTruthy();
  });

  it("answers 304 with no body when the browser already has that ETag", async () => {
    const first = await GET(request(), { params });
    const etag = first.headers.get("ETag")!;
    await first.arrayBuffer();

    const res = await GET(request({ "if-none-match": etag }), { params });

    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    expect(res.headers.get("ETag")).toBe(etag);
  });

  it("still revalidates a cached copy when the audio is regenerated", async () => {
    const first = await GET(request(), { params });
    const staleEtag = first.headers.get("ETag")!;
    await first.arrayBuffer();

    // Simulate an audio retry rewriting the file with new content.
    writeFileSync(audioFile, Buffer.concat([AUDIO_BYTES, Buffer.from("-v2")]));

    const res = await GET(request({ "if-none-match": staleEtag }), { params });

    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).not.toBe(staleEtag);

    writeFileSync(audioFile, AUDIO_BYTES);
  });

  it("still serves byte ranges as 206 so seeking keeps working", async () => {
    const size = statSync(audioFile).size;

    const res = await GET(request({ range: "bytes=5-9" }), { params });

    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(`bytes 5-9/${size}`);
    expect(res.headers.get("Content-Length")).toBe("5");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(
      AUDIO_BYTES.subarray(5, 10),
    );
  });

  it("keeps the 403 guard for a VA who does not own the job", async () => {
    mockGetTutorialJobById.mockResolvedValue({
      id: "j1",
      created_by: "someone-else",
      audio_path: audioFile,
    });
    mockHasPermission.mockImplementation(
      (_s: unknown, p: string) => p === "view:production",
    );

    const res = await GET(request(), { params });

    expect(res.status).toBe(403);
  });
});
