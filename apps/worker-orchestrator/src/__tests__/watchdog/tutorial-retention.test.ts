import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, stat, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRetentionSweepOnce } from "../../watchdog/tutorial-retention.js";

/**
 * The retention sweep deletes irreversibly and there is NO media backup by
 * policy. Its single safety property is that a local file is removed ONLY when
 * its Drive copy is confirmed by `drive_file_id` — not when a hand-written
 * `delivered_to_drive` boolean says so. These tests exercise that against real
 * files on disk, so a regression cannot pass by mocking `unlink`.
 */

interface FakeArtifact {
  kind: string;
}

/** Minimal drizzle stand-in: two chained selects, in call order. */
function makeDb(jobs: unknown[], artifactsByCall: FakeArtifact[][]) {
  let selectCall = 0;
  const builder = (rows: unknown[]) => {
    const b: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit"]) {
      b[m] = vi.fn(() => b);
    }
    // Awaiting the builder resolves to the rows.
    (b as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
      resolve(rows);
    return b;
  };
  return {
    select: vi.fn(() => {
      const isJobQuery = selectCall === 0;
      const rows = isJobQuery ? jobs : (artifactsByCall[selectCall - 1] ?? []);
      selectCall += 1;
      return builder(rows);
    }),
  } as never;
}

let mediaRoot: string;

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), "cf-retention-"));
});
afterEach(() => vi.restoreAllMocks());

async function makeFile(name: string, bytes = 1024): Promise<string> {
  const p = join(mediaRoot, name);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, Buffer.alloc(bytes));
  return p;
}

const OLD = new Date("2026-01-01T00:00:00Z");

describe("retention sweep", () => {
  it("does NOT delete a file whose Drive copy is unconfirmed", async () => {
    const finalPath = await makeFile("job1/final.mp4");
    // No confirmed artefacts for this job.
    const db = makeDb(
      [
        {
          id: "job1",
          final_path: finalPath,
          recording_path: null,
          completed_at: OLD,
        },
      ],
      [[]],
    );

    const r = await runRetentionSweepOnce(db, { mediaRoot, dryRun: false });

    expect(r.skippedUnconfirmed).toBe(1);
    expect(r.deleted).toBe(0);
    // The file must still exist — this is the whole point.
    await expect(stat(finalPath)).resolves.toBeDefined();
  });

  it("blocks eviction even when the legacy Drive flag is set", async () => {
    const finalPath = await makeFile("job2/final.mp4");
    const rawPath = await makeFile("job2/raw.mp4");
    // Drive confirmed the final video but NOT the raw recording.
    const db = makeDb(
      [
        {
          id: "job2",
          final_path: finalPath,
          recording_path: rawPath,
          completed_at: OLD,
        },
      ],
      [[{ kind: "final_video" }]],
    );

    const r = await runRetentionSweepOnce(db, { mediaRoot, dryRun: false });

    expect(r.deleted).toBe(0);
    expect(r.proposedFiles).toBe(1);
    expect(r.blockedUnsafeEviction).toBe(true);
    expect(r.skippedUnconfirmed).toBe(1);
    await expect(stat(finalPath)).resolves.toBeDefined(); // kept until verified restore exists
    await expect(stat(rawPath)).resolves.toBeDefined(); // kept
  });

  it("dry run reports what it would free and deletes nothing", async () => {
    const finalPath = await makeFile("job3/final.mp4", 2048);
    const db = makeDb(
      [
        {
          id: "job3",
          final_path: finalPath,
          recording_path: null,
          completed_at: OLD,
        },
      ],
      [[{ kind: "final_video" }]],
    );

    const r = await runRetentionSweepOnce(db, { mediaRoot, dryRun: true });

    expect(r.dryRun).toBe(true);
    expect(r.deleted).toBe(0);
    expect(r.bytesFreed).toBe(0);
    expect(r.proposedFiles).toBe(1);
    expect(r.proposedBytes).toBe(2048);
    await expect(stat(finalPath)).resolves.toBeDefined();
  });

  it("defaults to a dry run when the caller says nothing", async () => {
    const finalPath = await makeFile("job4/final.mp4");
    const db = makeDb(
      [
        {
          id: "job4",
          final_path: finalPath,
          recording_path: null,
          completed_at: OLD,
        },
      ],
      [[{ kind: "final_video" }]],
    );

    const r = await runRetentionSweepOnce(db, { mediaRoot });

    expect(r.dryRun).toBe(true);
    await expect(stat(finalPath)).resolves.toBeDefined();
  });

  it("counts an already-missing file without failing", async () => {
    const db = makeDb(
      [
        {
          id: "job5",
          final_path: join(mediaRoot, "gone.mp4"),
          recording_path: null,
          completed_at: OLD,
        },
      ],
      [[{ kind: "final_video" }]],
    );

    const r = await runRetentionSweepOnce(db, { mediaRoot, dryRun: false });

    expect(r.skippedMissing).toBe(1);
    expect(r.deleted).toBe(0);
  });

  it("never throws, even when the database blows up", async () => {
    const db = {
      select: () => {
        throw new Error("connection reset");
      },
    } as never;
    await expect(
      runRetentionSweepOnce(db, { mediaRoot, dryRun: false }),
    ).resolves.toMatchObject({ deleted: 0 });
  });
});
