import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
const mediaLease = vi.hoisted(() => ({ run: vi.fn(async (_input: unknown, consume: () => Promise<unknown>) => consume()) }));
vi.mock("../utils/tutorial/media-inputs.js", () => ({ withTutorialPublicationInputs: mediaLease.run }));
import {
  canonicalTutorialUploaderJob,
  tutorialUploaderReceiptFileName,
  type TutorialUploaderAsset,
  type TutorialUploaderJob,
  type TutorialUploaderReceipt,
} from "@repo/contracts";
import {
  DRIVE_FOLDER_MIME,
  storageError,
  type Attempt,
  type DriveFile,
} from "@repo/storage";
import {
  publishTutorialUploaderCandidate,
  runTutorialUploaderExchangeOnce,
  tutorialJobProjectionForReceipt,
  TutorialUploaderExchangeError,
  type LocalAssetInspection,
  type PublishCandidate,
  type PublishFailure,
  type PublishRecord,
  type ReceiptCandidate,
  type ReceiptRecordResult,
  type TutorialUploaderDrivePort,
  type TutorialUploaderExchangeOptions,
  type TutorialUploaderExchangeRepository,
} from "../storage/tutorial-uploader-exchange.js";

const DISPATCH_ID = "10000000-0000-4000-8000-000000000001";
const TUTORIAL_JOB_ID = "10000000-0000-4000-8000-000000000002";
const EXCHANGE_JOB_ID = "10000000-0000-4000-8000-000000000003";
const THUMBNAIL_ID = "10000000-0000-4000-8000-000000000004";
const INBOX_ID = "inbox";
const OUTBOX_ID = "outbox";

function digest(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

const ATTRIBUTES = {
  title: "A complete tutorial",
  description: "A useful localized description.",
  tags: ["tutorial", "guide"],
  visibility: "private" as const,
  made_for_kids: false as const,
  monetization: "on" as const,
  ad_suitability: "none" as const,
};

function candidate(
  overrides: Partial<PublishCandidate> = {},
): PublishCandidate {
  return {
    dispatchId: DISPATCH_ID,
    tutorialJobId: TUTORIAL_JOB_ID,
    exchangeJobId: EXCHANGE_JOB_ID,
    revision: 1,
    idempotencyKey: `tutorial-studio:${EXCHANGE_JOB_ID}:1`,
    channelKey: "tutorial_english",
    requestedAt: new Date("2026-09-04T12:30:45.987Z"),
    attributes: ATTRIBUTES,
    manifestSha256: null,
    manifest: null,
    videoPath: "/media/video.mp4",
    thumbnailId: THUMBNAIL_ID,
    thumbnailPath: "/media/thumbnail.png",
    approvedAssetSnapshot: {
      version: 1, revision: "a".repeat(64), uploaderChannelKey: "tutorial_english",
      identity: { jobId: TUTORIAL_JOB_ID, videoPath: "/media/video.mp4", thumbnailId: THUMBNAIL_ID, thumbnailPath: "/media/thumbnail.png", title: ATTRIBUTES.title, description: ATTRIBUTES.description, tags: ATTRIBUTES.tags },
      video: { sha256: digest(Buffer.from("video-content")), size: Buffer.byteLength("video-content") },
      thumbnail: { sha256: digest(Buffer.from("thumbnail-content")), size: Buffer.byteLength("thumbnail-content") },
    },
    ...overrides,
  };
}

const LOCAL_BYTES = new Map<string, Buffer>([
  ["/media/video.mp4", Buffer.from("video-content")],
  ["/media/thumbnail.png", Buffer.from("thumbnail-content")],
]);

async function inspectFromMap(
  path: string,
  role: TutorialUploaderAsset["role"],
): Promise<LocalAssetInspection> {
  const content = LOCAL_BYTES.get(path);
  if (content === undefined) throw new Error(`missing test source ${path}`);
  return {
    path,
    fileName: role === "video" ? "video.mp4" : "thumbnail.png",
    sizeBytes: content.byteLength,
    sha256: digest(content),
    mediaType: role === "video" ? "video/mp4" : "image/png",
  };
}

interface FakeObject {
  file: DriveFile;
  parentId: string;
  content?: Buffer;
}

class FakeDrive implements TutorialUploaderDrivePort {
  readonly objects = new Map<string, FakeObject>();
  readonly operations: string[] = [];
  private sequence = 0;

  private id(): string {
    this.sequence += 1;
    return `drive-${this.sequence}`;
  }

  listChildren(folderId: string): Promise<Attempt<DriveFile[]>> {
    return Promise.resolve({
      ok: true,
      value: [...this.objects.values()]
        .filter((item) => item.parentId === folderId)
        .map((item) => item.file),
    });
  }

  createFolder(
    name: string,
    parentId: string | null,
  ): Promise<Attempt<string>> {
    const id = this.id();
    this.objects.set(id, {
      parentId: parentId ?? "root",
      file: { id, name, mimeType: DRIVE_FOLDER_MIME, trashed: false },
    });
    this.operations.push(`folder:${name}`);
    return Promise.resolve({ ok: true, value: id });
  }

  downloadBytes(
    fileId: string,
    maxBytes: number,
  ): Promise<Attempt<{ content: Buffer; sizeBytes: number; sha256: string }>> {
    const content = this.objects.get(fileId)?.content;
    if (content === undefined || content.byteLength > maxBytes) {
      return Promise.resolve({
        ok: false,
        error: storageError("not_found", "missing fake object"),
      });
    }
    return Promise.resolve({
      ok: true,
      value: {
        content,
        sizeBytes: content.byteLength,
        sha256: digest(content),
      },
    });
  }

  async inspectContent(
    fileId: string,
    maxBytes: number,
  ): Promise<Attempt<{ sizeBytes: number; sha256: string }>> {
    const result = await this.downloadBytes(fileId, maxBytes);
    if (!result.ok) return result;
    return {
      ok: true,
      value: { sizeBytes: result.value.sizeBytes, sha256: result.value.sha256 },
    };
  }

  putLocalFile(args: {
    folderId: string;
    sourcePath: string;
    asset: TutorialUploaderAsset;
    exchangeJobId: string;
    revision: number;
  }): Promise<Attempt<DriveFile>> {
    const content = LOCAL_BYTES.get(args.sourcePath);
    if (content === undefined) {
      return Promise.resolve({
        ok: false,
        error: storageError("local_file", "missing fake local file"),
      });
    }
    const id = this.id();
    const file: DriveFile = {
      id,
      name: args.asset.file_name,
      mimeType: args.asset.media_type,
      size: String(content.byteLength),
      sha256Checksum: digest(content),
      trashed: false,
    };
    this.objects.set(id, { file, parentId: args.folderId, content });
    this.operations.push(`asset:${args.asset.role}`);
    return Promise.resolve({ ok: true, value: file });
  }

  putBytes(args: {
    folderId: string;
    fileName: string;
    mediaType: string;
    content: Buffer;
    exchangeJobId: string;
    kind: string;
  }): Promise<Attempt<DriveFile>> {
    const id = this.id();
    const file: DriveFile = {
      id,
      name: args.fileName,
      mimeType: args.mediaType,
      size: String(args.content.byteLength),
      sha256Checksum: digest(args.content),
      trashed: false,
    };
    this.objects.set(id, {
      file,
      parentId: args.folderId,
      content: args.content,
    });
    this.operations.push(`bytes:${args.fileName}`);
    return Promise.resolve({ ok: true, value: file });
  }

  addReceipt(receipt: TutorialUploaderReceipt): string {
    const content = Buffer.from(JSON.stringify(receipt));
    const id = this.id();
    const name = tutorialUploaderReceiptFileName(receipt);
    this.objects.set(id, {
      parentId: OUTBOX_ID,
      content,
      file: {
        id,
        name,
        mimeType: "application/json",
        size: String(content.byteLength),
        sha256Checksum: digest(content),
        trashed: false,
      },
    });
    return id;
  }

  replaceObject(id: string, content: Buffer): void {
    const object = this.objects.get(id);
    if (object === undefined) throw new Error("missing fake object");
    object.content = content;
    object.file.size = String(content.byteLength);
    object.file.sha256Checksum = digest(content);
  }
}

class FakeRepository implements TutorialUploaderExchangeRepository {
  publishCandidates: PublishCandidate[] = [];
  receiptCandidates: ReceiptCandidate[] = [];
  failures: PublishFailure[] = [];
  published: PublishRecord[] = [];
  frozen: Array<Omit<PublishRecord, "driveFolderId">> = [];
  receiptHashes = new Map<number, string>();
  insertedReceipts: TutorialUploaderReceipt[] = [];
  projectedYoutubeUrl: string | null = null;

  listPublishCandidates(): Promise<PublishCandidate[]> {
    return Promise.resolve(this.publishCandidates);
  }

  markPublishing(record: Omit<PublishRecord, "driveFolderId">): Promise<void> {
    const target = this.publishCandidates.find(
      (item) => item.dispatchId === record.dispatchId,
    );
    if (
      target?.manifestSha256 &&
      target.manifestSha256 !== record.manifestSha256
    ) {
      throw new TutorialUploaderExchangeError(
        "dispatch_publish_conflict",
        "fake frozen manifest conflict",
      );
    }
    if (target !== undefined) {
      target.manifest = record.manifest;
      target.manifestSha256 = record.manifestSha256;
    }
    this.frozen.push(record);
    return Promise.resolve();
  }

  markPublished(record: PublishRecord): Promise<void> {
    this.published.push(record);
    return Promise.resolve();
  }

  markPublishFailed(failure: PublishFailure): Promise<void> {
    this.failures.push(failure);
    return Promise.resolve();
  }

  listReceiptCandidates(): Promise<ReceiptCandidate[]> {
    return Promise.resolve(this.receiptCandidates);
  }

  recordReceipt(
    candidate: ReceiptCandidate,
    receipt: TutorialUploaderReceipt,
    receiptSha256: string,
  ): Promise<ReceiptRecordResult> {
    const prior = this.receiptHashes.get(receipt.sequence);
    if (prior !== undefined) {
      if (prior !== receiptSha256) {
        throw new TutorialUploaderExchangeError(
          "receipt_immutable_conflict",
          "fake receipt changed",
        );
      }
      return Promise.resolve("duplicate");
    }
    if (receipt.sequence !== this.receiptHashes.size + 1) {
      throw new TutorialUploaderExchangeError(
        "receipt_sequence_gap",
        "fake receipt gap",
      );
    }
    this.receiptHashes.set(receipt.sequence, receiptSha256);
    this.insertedReceipts.push(receipt);
    candidate.latestSequence = receipt.sequence;
    if (receipt.state === "succeeded" && receipt.result !== null) {
      this.projectedYoutubeUrl = receipt.result.video_url;
    }
    return Promise.resolve("inserted");
  }
}

const OPTIONS: TutorialUploaderExchangeOptions = {
  inboxFolderId: INBOX_ID,
  receiptFolderId: OUTBOX_ID,
  batchSize: 10,
  maxJobBytes: 10_000,
};

function receiptCandidate(
  manifestSha256: string,
  overrides: Partial<ReceiptCandidate> = {},
): ReceiptCandidate {
  return {
    dispatchId: DISPATCH_ID,
    tutorialJobId: TUTORIAL_JOB_ID,
    exchangeJobId: EXCHANGE_JOB_ID,
    revision: 1,
    idempotencyKey: `tutorial-studio:${EXCHANGE_JOB_ID}:1`,
    manifestSha256,
    latestSequence: 0,
    attributes: ATTRIBUTES,
    ...overrides,
  };
}

function makeReceipt(
  candidateValue: ReceiptCandidate,
  sequence: number,
  state: TutorialUploaderReceipt["state"],
  overrides: Partial<TutorialUploaderReceipt> = {},
): TutorialUploaderReceipt {
  const succeeded = state === "succeeded";
  return {
    version: "tutorial-uploader-receipt/1",
    job_id: candidateValue.exchangeJobId,
    revision: candidateValue.revision,
    idempotency_key: candidateValue.idempotencyKey,
    manifest_sha256: candidateValue.manifestSha256,
    sequence,
    state,
    occurred_at: `2026-09-04T13:00:0${sequence}Z`,
    progress: succeeded ? 1 : 0.5,
    message: `${state} ${sequence}`,
    result: succeeded
      ? {
          video_id: "AbCdEfGhI_1",
          video_url: "https://www.youtube.com/watch?v=AbCdEfGhI_1",
          applied_attributes: [...Object.keys(ATTRIBUTES), "thumbnail"],
          proof_ref: "proofs/verified.json",
        }
      : null,
    error: null,
    ...overrides,
  };
}

describe("Tutorial Studio uploader Drive publication", () => {
  it("does not inspect or write Drive when exact approved media cannot be restored", async () => {
    const repository = new FakeRepository(); const drive = new FakeDrive(); const inspect = vi.fn(inspectFromMap);
    mediaLease.run.mockRejectedValueOnce(new Error("Verified archive unavailable"));
    await expect(publishTutorialUploaderCandidate(repository,drive,OPTIONS,candidate(),{inspectLocalAsset:inspect})).rejects.toThrow("archive unavailable");
    expect(inspect).not.toHaveBeenCalled();expect(drive.operations).toEqual([]);
  });
  it("holds the media lease until both uploads and publication bookkeeping finish", async () => {
    const repository = new FakeRepository(); const drive = new FakeDrive(); let active = false;
    mediaLease.run.mockImplementationOnce(async (_input,consume)=>{active=true;try{return await consume();}finally{active=false;}});
    const originalPut=drive.putLocalFile.bind(drive);vi.spyOn(drive,"putLocalFile").mockImplementation(async args=>{expect(active).toBe(true);return originalPut(args);});
    const originalMark=repository.markPublished.bind(repository);vi.spyOn(repository,"markPublished").mockImplementation(async record=>{expect(active).toBe(true);return originalMark(record);});
    await publishTutorialUploaderCandidate(repository,drive,OPTIONS,candidate(),{inspectLocalAsset:inspectFromMap});expect(active).toBe(false);expect(repository.published).toHaveLength(1);
  });
  it("defers NOWAIT review contention without failure receipts, Drive writes, or retry state consumption", async () => {
    const repository = new FakeRepository();const drive=new FakeDrive();repository.publishCandidates=[candidate()];
    vi.spyOn(repository,"markPublishing").mockRejectedValueOnce({cause:{code:"55P03"}});
    const first=await runTutorialUploaderExchangeOnce(repository,drive,OPTIONS,{inspectLocalAsset:inspectFromMap});
    expect(first.publishFailed).toBe(0);expect(first.published).toBe(0);expect(repository.failures).toEqual([]);expect(drive.operations).toEqual([]);
    const second=await runTutorialUploaderExchangeOnce(repository,drive,OPTIONS,{inspectLocalAsset:inspectFromMap});expect(second.published).toBe(1);
  });
  it("rejects missing or stale final approval before any Drive writes", async () => {
    for (const job of [candidate({ approvedAssetSnapshot: null }), candidate({ attributes: { ...ATTRIBUTES, title: "Changed after review" } }), candidate({ channelKey: "different_channel" })]) {
      const repository = new FakeRepository(); const drive = new FakeDrive();
      await expect(publishTutorialUploaderCandidate(repository, drive, OPTIONS, job, { inspectLocalAsset: inspectFromMap })).rejects.toMatchObject({ code: "approved_assets_changed" });
      expect(drive.operations).toEqual([]);
      expect(repository.frozen).toEqual([]);
    }
  });
  it("rejects replaced bytes even before the first exchange manifest is frozen", async () => {
    const repository = new FakeRepository(); const drive = new FakeDrive();
    await expect(publishTutorialUploaderCandidate(repository, drive, OPTIONS, candidate(), { inspectLocalAsset: async (path, role) => ({ ...await inspectFromMap(path, role), sha256: "f".repeat(64) }) })).rejects.toMatchObject({ code: "approved_assets_changed" });
    expect(drive.operations).toEqual([]);
  });
  it("freezes the identity, uploads both assets first, and writes exact canonical job.json last", async () => {
    const repository = new FakeRepository();
    const job = candidate();
    repository.publishCandidates = [job];
    const drive = new FakeDrive();

    const totals = await runTutorialUploaderExchangeOnce(
      repository,
      drive,
      OPTIONS,
      { inspectLocalAsset: inspectFromMap },
    );

    expect(totals.published).toBe(1);
    expect(repository.frozen).toHaveLength(1);
    expect(drive.operations.slice(-3)).toEqual([
      "asset:video",
      "asset:thumbnail",
      "bytes:job.json",
    ]);
    const manifestObject = [...drive.objects.values()].find(
      (item) => item.file.name === "job.json",
    );
    expect(manifestObject?.content?.toString()).toBe(
      canonicalTutorialUploaderJob(
        repository.published[0]?.manifest as TutorialUploaderJob,
      ),
    );
    expect(manifestObject?.content?.toString().endsWith("\n")).toBe(false);
    expect(repository.published[0]?.manifest.created_at).toBe(
      "2026-09-04T12:30:45Z",
    );
    expect(repository.published[0]?.manifestSha256).toBe(
      digest(manifestObject?.content ?? Buffer.alloc(0)),
    );
  });

  it("replays an identical folder without writing assets or the ready marker again", async () => {
    const repository = new FakeRepository();
    const job = candidate();
    repository.publishCandidates = [job];
    const drive = new FakeDrive();
    await publishTutorialUploaderCandidate(repository, drive, OPTIONS, job, {
      inspectLocalAsset: inspectFromMap,
    });
    const writesAfterFirst = drive.operations.length;

    await publishTutorialUploaderCandidate(repository, drive, OPTIONS, job, {
      inspectLocalAsset: inspectFromMap,
    });

    expect(drive.operations).toHaveLength(writesAfterFirst);
    expect(repository.published).toHaveLength(2);
  });

  it("refuses changed source bytes after the revision identity was frozen", async () => {
    const repository = new FakeRepository();
    const job = candidate();
    repository.publishCandidates = [job];
    const drive = new FakeDrive();
    await publishTutorialUploaderCandidate(repository, drive, OPTIONS, job, {
      inspectLocalAsset: inspectFromMap,
    });
    const writesAfterFirst = drive.operations.length;

    const changedInspector = async (
      path: string,
      role: TutorialUploaderAsset["role"],
    ): Promise<LocalAssetInspection> => {
      const original = await inspectFromMap(path, role);
      return role === "video"
        ? { ...original, sha256: "f".repeat(64) }
        : original;
    };
    await expect(
      publishTutorialUploaderCandidate(repository, drive, OPTIONS, job, {
        inspectLocalAsset: changedInspector,
      }),
    ).rejects.toMatchObject({ code: "manifest_revision_conflict" });
    expect(drive.operations).toHaveLength(writesAfterFirst);
  });

  it("enforces the total video plus thumbnail byte limit before Drive mutation", async () => {
    const repository = new FakeRepository();
    const job = candidate();
    const drive = new FakeDrive();
    await expect(
      publishTutorialUploaderCandidate(
        repository,
        drive,
        { ...OPTIONS, maxJobBytes: 10 },
        job,
        { inspectLocalAsset: inspectFromMap },
      ),
    ).rejects.toMatchObject({ code: "source_assets_too_large" });
    expect(drive.operations).toEqual([]);
    expect(repository.frozen).toEqual([]);
  });
});

describe("Tutorial Studio uploader receipt reconciliation", () => {
  it("projects a proven private success into verified Studio upload state", () => {
    const identity = receiptCandidate("a".repeat(64));
    const terminal = makeReceipt(identity, 1, "succeeded");

    expect(tutorialJobProjectionForReceipt(identity, terminal)).toMatchObject({
      uploader_status: "uploaded",
      youtube_visibility: "private",
      is_uploaded: true,
      uploaded_by: "tutorial-uploader",
      youtube_upload_url: "https://www.youtube.com/watch?v=AbCdEfGhI_1",
      uploader_job_id: EXCHANGE_JOB_ID,
    });
    expect(
      tutorialJobProjectionForReceipt(identity, terminal).upload_verified_at,
    ).toEqual(new Date("2026-09-04T13:00:01Z"));
  });

  it("projects progress and terminal failure without claiming an upload", () => {
    const identity = receiptCandidate("b".repeat(64));

    expect(
      tutorialJobProjectionForReceipt(
        identity,
        makeReceipt(identity, 1, "active"),
      ),
    ).toMatchObject({ uploader_status: "uploading" });
    expect(
      tutorialJobProjectionForReceipt(
        identity,
        makeReceipt(identity, 1, "failed", {
          progress: 1,
          error: {
            code: "publisher_failed",
            message: "publisher failed",
            retryable: false,
          },
        }),
      ),
    ).toMatchObject({ uploader_status: "failed" });
  });

  it("refuses to project success without a valid frozen visibility", () => {
    const identity = receiptCandidate("c".repeat(64), {
      attributes: { ...ATTRIBUTES, visibility: "public" },
    });

    expect(() =>
      tutorialJobProjectionForReceipt(
        identity,
        makeReceipt(identity, 1, "succeeded"),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "receipt_candidate_attributes_invalid" }),
    );
  });

  it("persists a contiguous journal and projects only a fully-proven success", async () => {
    const repository = new FakeRepository();
    const identity = receiptCandidate("a".repeat(64));
    repository.receiptCandidates = [identity];
    const drive = new FakeDrive();
    drive.addReceipt(makeReceipt(identity, 1, "accepted"));
    drive.addReceipt(makeReceipt(identity, 2, "succeeded"));

    const totals = await runTutorialUploaderExchangeOnce(
      repository,
      drive,
      OPTIONS,
    );

    expect(totals.receiptsInserted).toBe(2);
    expect(totals.receiptFailed).toBe(0);
    expect(repository.insertedReceipts.map((item) => item.sequence)).toEqual([
      1, 2,
    ]);
    expect(repository.projectedYoutubeUrl).toBe(
      "https://www.youtube.com/watch?v=AbCdEfGhI_1",
    );
  });

  it("refuses a receipt gap without advancing durable state", async () => {
    const repository = new FakeRepository();
    const identity = receiptCandidate("b".repeat(64));
    repository.receiptCandidates = [identity];
    const drive = new FakeDrive();
    drive.addReceipt(makeReceipt(identity, 2, "succeeded"));

    const totals = await runTutorialUploaderExchangeOnce(
      repository,
      drive,
      OPTIONS,
    );

    expect(totals.receiptFailed).toBe(1);
    expect(repository.insertedReceipts).toEqual([]);
    expect(repository.projectedYoutubeUrl).toBeNull();
  });

  it("refuses success that did not prove thumbnail and every requested attribute", async () => {
    const repository = new FakeRepository();
    const identity = receiptCandidate("c".repeat(64));
    repository.receiptCandidates = [identity];
    const drive = new FakeDrive();
    drive.addReceipt(
      makeReceipt(identity, 1, "succeeded", {
        result: {
          video_id: "AbCdEfGhI_1",
          video_url: "https://www.youtube.com/watch?v=AbCdEfGhI_1",
          applied_attributes: Object.keys(ATTRIBUTES),
          proof_ref: "proofs/verified.json",
        },
      }),
    );

    const totals = await runTutorialUploaderExchangeOnce(
      repository,
      drive,
      OPTIONS,
    );

    expect(totals.receiptFailed).toBe(1);
    expect(repository.insertedReceipts).toEqual([]);
    expect(repository.projectedYoutubeUrl).toBeNull();
  });

  it("detects changed immutable bytes below the durable high-water mark", async () => {
    const repository = new FakeRepository();
    const identity = receiptCandidate("d".repeat(64));
    repository.receiptCandidates = [identity];
    const drive = new FakeDrive();
    const firstId = drive.addReceipt(makeReceipt(identity, 1, "accepted"));
    const firstPass = await runTutorialUploaderExchangeOnce(
      repository,
      drive,
      OPTIONS,
    );
    expect(firstPass.receiptsInserted).toBe(1);

    const changed = makeReceipt(identity, 1, "accepted", {
      message: "accepted but rewritten",
    });
    drive.replaceObject(firstId, Buffer.from(JSON.stringify(changed)));
    const secondPass = await runTutorialUploaderExchangeOnce(
      repository,
      drive,
      OPTIONS,
    );

    expect(secondPass.receiptFailed).toBe(1);
    expect(repository.insertedReceipts).toHaveLength(1);
  });
});
