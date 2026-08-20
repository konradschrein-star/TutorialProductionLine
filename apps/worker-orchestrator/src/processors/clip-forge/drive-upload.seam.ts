/**
 * Clip Forge -> Google Drive output SEAM (interface only — NOT implemented here).
 *
 * Decision §3.6 / §4: finished Clip Forge clips upload to Google Drive, in
 * Clip Forge's OWN folder, separate from the Content Forge tree. Konrad builds
 * the uploader and owns distribution. A separate agent owns the Drive
 * integration (packages/storage: OAuth, resumable upload, the GLOBAL
 * per-account rate limiter that protects the ~12,000/day quota, retry).
 *
 * This file exists so Clip Forge can DEPEND ON that seam without building it.
 * It defines exactly the call Clip Forge needs and nothing more. When a variant
 * is approved, Clip Forge will enqueue a `cf-drive-upload` job whose handler
 * calls `requestDriveUpload(...)`. That is the entire Clip Forge surface — no
 * Drive HTTP call, no OAuth, no retry, no rate limiting, and no uploader to any
 * publishing platform live in Clip Forge.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TODO(drive-agent / Konrad): provide the real implementation of
 * `requestDriveUpload`. It is expected to be backed by
 * `packages/storage` ArtifactStore.putFinalArtifact, extended per migration
 * 0050 to accept `ownerKind: 'cf_variant'` + `ownerId` + a `rootFolderName`
 * override so Clip Forge lands in its own Drive root. Until then this throws so
 * a missing implementation fails loudly (no silent fallback), never ships a
 * silent no-op.
 *
 * GATE (§4.1): do NOT wire live Drive uploads to a shared personal Drive until
 * the account-linkage research is answered (does a shared Drive create a
 * linkage signal between otherwise-isolated YouTube channels?). Sequence this
 * after that research and after Konrad supplies the target folder location.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** What Clip Forge ships to Drive for one approved variant. */
export type DriveArtifactKind =
  | "final_video" // the rendered 1080x1920 variant MP4
  | "metadata" // persona, source URL, clip window, caption, layoutKind, render hash, duration, sha256
  | "transcript"; // clip-window word timings, so translations never re-transcribe (§4)

export interface DriveUploadRequest {
  /** Always 'clip_forge' for this seam — distinguishes the owner from Content Forge jobs. */
  ownerKind: "clip_forge";
  /** The cf_finishing_variants.id whose output is being uploaded. */
  ownerId: string;
  /** Absolute path to the finished, on-disk artifact. Must exist (trust the filesystem). */
  filePath: string;
  /** Which kind of artifact this file is. */
  kind: DriveArtifactKind;
  /**
   * Drive root folder name. Clip Forge is SEPARATE from Content Forge, so this
   * defaults to "Clip Forge". The Drive layer plans the persona/month subtree
   * beneath it (Clip Forge / <persona> / <YYYY-MM> / <slug__id>/ …).
   */
  rootFolderName?: string;
}

export interface DriveUploadResult {
  /** Lifecycle outcome from packages/storage. 'skipped' is a RECORDED decision, never silent. */
  status: "uploaded" | "skipped" | "failed";
  /** Drive file id once uploaded, if the integration returns one. */
  driveFileId?: string;
  /** Reason, present for skipped/failed. */
  reason?: string;
}

/**
 * The single function Clip Forge depends on. Implemented by the Drive agent /
 * Konrad against packages/storage. See the TODO above.
 */
export type RequestDriveUpload = (
  req: DriveUploadRequest,
) => Promise<DriveUploadResult>;

export const requestDriveUpload: RequestDriveUpload = async () => {
  throw new Error(
    "requestDriveUpload is not implemented. Clip Forge defines this seam " +
      "(drive-upload.seam.ts) but does NOT build the Drive uploader — it is " +
      "owned by the Drive agent / Konrad and gated on the §4.1 account-linkage " +
      "research. Wire it to packages/storage ArtifactStore.putFinalArtifact " +
      "with ownerKind:'cf_variant' (migration 0050) once that gate clears.",
  );
};
