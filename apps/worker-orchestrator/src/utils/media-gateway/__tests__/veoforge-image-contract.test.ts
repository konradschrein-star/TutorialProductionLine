import { afterEach, expect, it, vi } from "vitest";
import { submitVeoForgeImage } from "../veoforge-client.js";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function configured() {
  vi.stubEnv("VEOFORGE_API_KEY", "synthetic-test-key");
  vi.stubEnv("VEOFORGE_API_URL", "https://veoforge.test");
  vi.stubEnv("VEOFORGE_IMAGES_ENABLED", "1");
}
it("forwards all reference slots and keeps operation identity on a lost-response retry", async () => {
  configured();
  const fetchMock = vi.fn().mockRejectedValueOnce(Error("lost acknowledgement")).mockResolvedValue(new Response(JSON.stringify({ id: "provider-job" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await submitVeoForgeImage("Exact headline", { idempotencyKey: "thumbnail-batch-variant-0", referenceImages: [Buffer.from("layout"), Buffer.from("host"), Buffer.from("scene")] })).toBe("provider-job");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const bodies = fetchMock.mock.calls.map(call => JSON.parse(call[1].body));
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0].idempotency_key).toBe("thumbnail-batch-variant-0");
  expect(bodies[0].reference_images.map((ref: { category: string }) => ref.category)).toEqual(["style", "subject", "scene"]);
});
it("refuses excess references or a disabled image capability before a submit", async () => {
  configured(); const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  await expect(submitVeoForgeImage("Headline", { referenceImages: Array(4).fill(Buffer.from("ref")) })).rejects.toThrow("at most 3");
  vi.stubEnv("VEOFORGE_IMAGES_ENABLED", "0");
  await expect(submitVeoForgeImage("Headline")).rejects.toThrow("disabled");
  expect(fetchMock).not.toHaveBeenCalled();
});
