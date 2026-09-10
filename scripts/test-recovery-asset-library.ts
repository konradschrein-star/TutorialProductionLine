/** Local HTTP integration only. Retains the clearly named synthetic test asset. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import postgres from "postgres";
import { signToken } from "../apps/hub-web/src/lib/auth/jwt";
const require = createRequire(new URL("../apps/hub-web/package.json", import.meta.url));
const sharp = require("sharp");
const url = process.env.DATABASE_URL ?? "";
if (url !== "postgresql://recovery:local-test-only@127.0.0.1:55438/tutorial_recovery_test" || process.env.JWT_SECRET !== "local-recovery-test-secret-not-for-production-2026") throw new Error("Isolated local recovery runtime only");
const sql = postgres(url, { max: 1 });
const base = "http://127.0.0.1:3108";
try {
  const [owner] = await sql`SELECT id FROM users WHERE email='va@recovery.test'`;
  const [other] = await sql`SELECT id FROM users WHERE email='other@recovery.test'`;
  assert(owner && other);
  const token = await signToken({ userId: owner.id, email: "va@recovery.test", role: "TUTORIAL_VA" });
  const otherToken = await signToken({ userId: other.id, email: "other@recovery.test", role: "TUTORIAL_VA" });
  const call = (path: string, init: RequestInit = {}, auth = token) => fetch(`${base}${path}`, { ...init, headers: { Cookie: `hub_session=${auth}`, ...init.headers }, redirect: "error" });
  if (!process.argv.includes("--metadata-only")) {
  const name = `SYNTHETIC API TEST LOGO ${randomUUID()}`;
  const png = await sharp({ create: { width: 96, height: 96, channels: 4, background: { r: 25, g: 90, b: 180, alpha: 0.8 } } }).png().toBuffer();
  const form = new FormData(); form.set("file", new Blob([png], { type: "image/png" }), "synthetic-api-test.png"); form.set("name", name); form.set("category", "LOGOS");
  const uploaded = await call("/api/thumbnails/assets", { method: "POST", body: form });
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const { asset } = await uploaded.json();
  const library = async (auth = token) => { const response = await call(`/api/thumbnails/assets?q=${encodeURIComponent(name)}`, {}, auth); assert.equal(response.status, 200); return response.json(); };
  assert((await library()).assets.some((row: { id: string }) => row.id === asset.id));
  const readBytes = async () => { const response = await call(asset.url); assert.equal(response.status, 200); return Buffer.from(await response.arrayBuffer()); };
  const before = await readBytes(); const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  assert.equal((await call(`/api/thumbnails/assets?id=${asset.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await library()).preferences[asset.id].hidden, true);
  const otherView = await library(otherToken); assert(otherView.assets.some((row: { id: string }) => row.id === asset.id)); assert.notEqual(otherView.preferences[asset.id]?.hidden, true);
  assert.equal(hash(await readBytes()), hash(before));
  assert.equal((await call("/api/thumbnails/assets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assetKey: asset.id, hidden: false }) })).status, 200);
  assert.equal((await library()).preferences[asset.id].hidden, false); assert.equal(hash(await readBytes()), hash(before));
  console.log(JSON.stringify({ permanentUpload: true, libraryReload: true, ownHide: true, otherVaUnaffected: true, restore: true, bytesRetained: true, bytes: before.length, fixtureAssetId: asset.id, coverage: "HTTP API only; no file chooser" }));
  }
  const jobId = "22222222-3333-4444-8555-666666666601";
  const metadataResponse = await call(`/api/production/jobs/${jobId}/manual-delivery`);
  const metadata = await metadataResponse.json();
  if (metadataResponse.status !== 200) console.log(JSON.stringify({ manualDeliveryStatus: metadataResponse.status, error: metadata.error, externalUploads: 0 }));
  else {
    assert.equal(metadata.tutorialId, jobId); assert.equal(metadata.channel.language, "en"); assert(metadata.video.url && metadata.thumbnail.url && metadata.approvalRevision);
    console.log(JSON.stringify({ manualDeliveryStatus: 200, language: metadata.channel.language, scope: "one English tutorial; not a five-language bundle", approvalRevision: true, video: true, thumbnail: true, title: Boolean(metadata.title), description: Boolean(metadata.description), tags: Array.isArray(metadata.tags), externalUploads: 0 }));
  }
} finally { await sql.end(); }
