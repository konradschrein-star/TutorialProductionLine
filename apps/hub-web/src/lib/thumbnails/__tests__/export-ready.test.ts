import { describe, it, expect, vi } from "vitest";
import { prepareThumbnailExport } from "../export-ready";

const canvas = (images: unknown[] = [], fonts: Promise<unknown> = Promise.resolve()) => ({
  ownerDocument: { fonts: { ready: fonts } }, querySelectorAll: () => images, querySelector: () => null,
  isConnected: true, clientWidth: 1280, clientHeight: 720,
}) as unknown as HTMLElement;

describe("thumbnail export readiness", () => {
  it("rejects actionable missing-asset placeholders before rendering", async () => {
    const root = canvas(); Object.defineProperty(root, "querySelector", { value: () => ({}) });
    await expect(prepareThumbnailExport(root)).rejects.toThrow("save this as a draft");
  });
  it("waits for actual image decoding", async () => {
    const decode = vi.fn().mockResolvedValue(undefined);
    await prepareThumbnailExport(canvas([{ decode, naturalWidth: 500, naturalHeight: 500 }]));
    expect(decode).toHaveBeenCalledOnce();
  });
  it("fails clearly on a broken image instead of approving an empty layer", async () => {
    await expect(prepareThumbnailExport(canvas([{ decode: () => Promise.reject(new Error()), naturalWidth: 0 }]))).rejects.toThrow("Replace the missing");
  });
  it("bounds a font-load stall", async () => {
    await expect(prepareThumbnailExport(canvas([], new Promise(() => {})), 5)).rejects.toThrow("still loading");
  });
  it("refuses a hidden canvas", async () => {
    const root = canvas(); Object.defineProperty(root, "clientWidth", { value: 0 });
    await expect(prepareThumbnailExport(root)).rejects.toThrow("not visible");
  });
});
