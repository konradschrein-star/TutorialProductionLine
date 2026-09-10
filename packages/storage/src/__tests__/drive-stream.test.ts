import { expect, it, vi } from "vitest";
import { DriveClient } from "../drive/client.js";
import { fakeDriveConfig } from "./fake-drive.js";

function setup(chunks: Uint8Array[], options: { status?: number; length?: string } = {}) {
  const cancel = vi.fn();
  const fetch = vi.fn(async (input: string | URL | Request) => {
    if (input.toString().includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "fake", expires_in: 3600 }));
    let index = 0;
    return new Response(new ReadableStream({ pull(controller) { if (index < chunks.length) controller.enqueue(chunks[index++]); else controller.close(); }, cancel }), { status: options.status ?? 200, headers: options.length ? { "content-length": options.length } : {} });
  });
  return { client: new DriveClient(fakeDriveConfig(), { fetch }), fetch, cancel };
}
it("downloads exact-ID bytes as chunks without content buffering", async () => {
  const { client, fetch } = setup([Buffer.from("abc"), Buffer.from("def")]);
  const chunks = [];
  for await (const chunk of client.streamFileContent("exact/id", 6)) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe("abcdef");
  expect(fetch.mock.calls[1]?.[0].toString()).toContain("exact%2Fid?alt=media");
});
it("cancels on declared overflow before consuming media", async () => {
  const { client, cancel } = setup([Buffer.from("abc")], { length: "100" });
  await expect(async () => { for await (const _ of client.streamFileContent("id", 3)) { /* drain */ } }).rejects.toThrow("read limit");
  expect(cancel).toHaveBeenCalled();
});
it("caps undeclared streaming bytes", async () => {
  const { client } = setup([Buffer.from("abc"), Buffer.from("def")]);
  await expect(async () => { for await (const _ of client.streamFileContent("id", 3)) { /* drain */ } }).rejects.toThrow("read limit");
});
it("cancels the upstream stream when a consumer exits early", async () => {
  const { client, cancel } = setup([Buffer.from("a"), Buffer.from("b"), Buffer.from("c")]);
  for await (const _ of client.streamFileContent("id", 3)) break;
  expect(cancel).toHaveBeenCalled();
});
it("rejects HTTP errors without exposing response contents or auth tokens", async () => {
  const { client } = setup([Buffer.from("secret")], { status: 403 });
  await expect(async () => { for await (const _ of client.streamFileContent("id", 3)) { /* drain */ } }).rejects.toThrow("HTTP 403");
});
