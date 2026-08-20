/**
 * Test fixtures for the visual gateway: synthetic image headers, fake provider
 * adapters and an in-memory store. No network, no filesystem, no live API.
 */
import { createHash } from "node:crypto";
import type {
  StoredVisual,
  VisualCandidate,
  VisualProvenance,
  VisualProvider,
  VisualProviderAdapter,
  VisualRequest,
  VisualStore,
} from "../types.js";

// ── synthetic image headers ────────────────────────────────────────────────

/** Minimal valid PNG header (IHDR only) declaring `width`x`height`. */
export function pngBytes(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

/** Minimal JPEG with an APP0 segment followed by an SOF0 frame header. */
export function jpegBytes(width: number, height: number): Buffer {
  const app0 = Buffer.alloc(4 + 14);
  app0.writeUInt16BE(0xffe0, 0);
  app0.writeUInt16BE(16, 2); // length covers itself + 14 payload bytes
  const sof0 = Buffer.alloc(11);
  sof0.writeUInt16BE(0xffc0, 0);
  sof0.writeUInt16BE(17, 2);
  sof0.writeUInt8(8, 4); // sample precision
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0]);
}

/** Minimal GIF89a logical screen descriptor. */
export function gifBytes(width: number, height: number): Buffer {
  const buf = Buffer.alloc(13);
  buf.write("GIF89a", 0, "ascii");
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return buf;
}

/** Minimal WebP (VP8X extended-format) canvas header. */
export function webpBytes(width: number, height: number): Buffer {
  const buf = Buffer.alloc(30);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(22, 4);
  buf.write("WEBP", 8, "ascii");
  buf.write("VP8X", 12, "ascii");
  buf.writeUInt32LE(10, 16);
  buf.writeUIntLE(width - 1, 24, 3);
  buf.writeUIntLE(height - 1, 27, 3);
  return buf;
}

// ── requests ───────────────────────────────────────────────────────────────

export function makeRequest(
  overrides: Partial<VisualRequest> = {},
): VisualRequest {
  return {
    intent: "broll",
    query: "small bakery storefront",
    orientation: "landscape",
    minWidth: 1280,
    preferMotion: false,
    topic: "how to write a bakery business plan for an SBA 7(a) loan",
    ...overrides,
  };
}

export function makeProvenance(
  overrides: Partial<VisualProvenance> = {},
): VisualProvenance {
  return {
    provider: "pexels",
    sourceUrl: "https://www.pexels.com/photo/example-1/",
    licence: "Pexels License",
    retrievedAt: "2026-08-15T10:00:00.000Z",
    width: 1920,
    height: 1080,
    title: "a bakery storefront",
    ...overrides,
  };
}

export interface FakeCandidateOptions {
  provenance?: Partial<VisualProvenance>;
  bytes?: Buffer;
  mediaKind?: VisualCandidate["mediaKind"];
  fileExtension?: string;
  dimensionsDeclared?: boolean;
  fetchError?: Error;
  onFetch?: () => void;
}

export function makeCandidate(
  options: FakeCandidateOptions = {},
): VisualCandidate {
  const provenance = makeProvenance(options.provenance);
  return {
    provenance,
    mediaKind: options.mediaKind ?? "image",
    fileExtension: options.fileExtension ?? "png",
    dimensionsDeclared: options.dimensionsDeclared ?? true,
    fetchBytes: async () => {
      options.onFetch?.();
      if (options.fetchError) throw options.fetchError;
      return options.bytes ?? pngBytes(provenance.width, provenance.height);
    },
  };
}

// ── fake adapters ──────────────────────────────────────────────────────────

export interface FakeAdapter extends VisualProviderAdapter {
  calls: number;
}

/** An adapter that returns fixed candidates and counts its calls. */
export function fakeAdapter(
  provider: VisualProvider,
  candidates: VisualCandidate[],
): FakeAdapter {
  const adapter: FakeAdapter = {
    provider,
    calls: 0,
    async search(): Promise<VisualCandidate[]> {
      adapter.calls += 1;
      return candidates;
    },
  };
  return adapter;
}

/** An adapter that always throws — a provider that is down. */
export function failingAdapter(
  provider: VisualProvider,
  message: string,
): FakeAdapter {
  const adapter: FakeAdapter = {
    provider,
    calls: 0,
    async search(): Promise<VisualCandidate[]> {
      adapter.calls += 1;
      throw new Error(message);
    },
  };
  return adapter;
}

// ── in-memory store ────────────────────────────────────────────────────────

export interface MemoryStore extends VisualStore {
  readonly byHash: Map<string, StoredVisual>;
  readonly byUrl: Map<string, string>;
  saves: number;
}

export function memoryStore(): MemoryStore {
  const byHash = new Map<string, StoredVisual>();
  const byUrl = new Map<string, string>();
  const store: MemoryStore = {
    byHash,
    byUrl,
    saves: 0,
    async lookupByHash(hash) {
      return byHash.get(hash) ?? null;
    },
    async lookupBySourceUrl(url) {
      const hash = byUrl.get(url);
      return hash ? (byHash.get(hash) ?? null) : null;
    },
    async save(input) {
      store.saves += 1;
      const stored: StoredVisual = {
        contentHash: input.contentHash,
        assetKey: `visual-library/objects/${input.contentHash.slice(0, 2)}/${input.contentHash}.${input.fileExtension}`,
        storagePath: `/tmp/visual-library/${input.contentHash}.${input.fileExtension}`,
        bytes: input.bytes.length,
        mediaKind: input.mediaKind,
        provenance: input.provenance,
        posture: input.posture,
      };
      byHash.set(stored.contentHash, stored);
      byUrl.set(stored.provenance.sourceUrl, stored.contentHash);
      return stored;
    },
  };
  return store;
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
