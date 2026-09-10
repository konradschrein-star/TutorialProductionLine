import { describe, expect, it, vi } from "vitest";
import type { DrizzleClient, StorageArtifact } from "@repo/db";
import { archiveArtifactVersion, markUploaded } from "../repository.js";

describe("durable Drive revision history", () => {
  const previous = { id: "artifact", drive_file_id: "old-id", vps_path: "/old/file.jpg", checksum_sha256: "old-sha", bytes: 99, drive_md5: "old-md5", verified_at: null } as StorageArtifact;
  it("preserves the old exact object identity even when its verification is unknown", async () => {
    const values = vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn() });
    await archiveArtifactVersion({ insert: () => ({ values }) } as unknown as DrizzleClient, previous);
    expect(values).toHaveBeenCalledWith({ artifact_id: "artifact", drive_file_id: "old-id", vps_path: "/old/file.jpg", checksum_sha256: "old-sha", bytes: 99, drive_md5: "old-md5", verified_at: null });
  });
  it("commits the new exact ID and its history together under the revision lock", async () => {
    const values = vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn() });
    const tx = {
      select: () => ({ from: () => ({ where: () => ({ for: async () => [{ ...previous, checksum_sha256: "new-sha" }] }) }) }),
      update: () => ({ set: (data: object) => ({ where: () => ({ returning: async () => [{ ...previous, ...data }] }) }) }),
      insert: () => ({ values }),
    };
    const transaction = vi.fn(async (callback: (t: unknown) => Promise<void>) => callback(tx));
    await markUploaded({ transaction } as unknown as DrizzleClient, "artifact", { drive_file_id: "new-id", drive_folder_id: "folder", drive_folder_path: "folder", drive_web_link: null, bytes: 100, checksum_sha256: "new-sha", verified: true });
    expect(transaction).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ drive_file_id: "new-id", checksum_sha256: "new-sha", verified_at: expect.any(Date) }));
  });
  it("rejects a stale upload result before replacing a newer source pointer", async () => {
    const update = vi.fn();
    const tx = { select: () => ({ from: () => ({ where: () => ({ for: async () => [previous] }) }) }), update };
    const db = { transaction: async (callback: (t: unknown) => Promise<void>) => callback(tx) } as unknown as DrizzleClient;
    await expect(markUploaded(db, "artifact", { drive_file_id: "new-id", drive_folder_id: "folder", drive_folder_path: "folder", drive_web_link: null, bytes: 100, checksum_sha256: "different-sha", verified: true })).rejects.toThrow("source revision changed");
    expect(update).not.toHaveBeenCalled();
  });
});
