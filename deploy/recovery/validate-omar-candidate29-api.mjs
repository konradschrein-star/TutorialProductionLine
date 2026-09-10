// Authenticated, read-only Candidate29 acceptance probe. It creates a short-lived
// in-memory JWT for an existing active reviewer and never prints identity/secrets.
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const releaseRoot = "/opt/tutorial-review-omar-20260910-final-c29";
const jobId = "7d6cdc5d-23b8-4b51-8bf6-7224e26aa876";
const thumbnailId = "d38201cc-852a-4e3e-a3dd-7814ee345018";
const expectedPngSha256 = "1c1b637fc77a8a506e7c52c7c40122461df5421e18c12acf6791a1974e348423";
const fail = (message) => {
  throw new Error(`Candidate29 authenticated read-only gate failed: ${message}`);
};
const b64url = (value) => Buffer.from(value).toString("base64url");

try {
  const processes = JSON.parse(execFileSync("pm2", ["jlist"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
  const web = processes.find((row) => row.name === "tutorial-web");
  if (!web || web.pm2_env?.status !== "online" || !String(web.pm2_env?.pm_cwd).startsWith(`${releaseRoot}/app/`)) fail("unexpected web process");
  const secret = web.pm2_env?.JWT_SECRET;
  if (typeof secret !== "string" || secret.length < 32) fail("session signing configuration unavailable");
  const userJson = execFileSync("runuser", ["-u", "postgres", "--", "psql", "-X", "-d", "tutorial_studio", "-Atqc", "SELECT row_to_json(x) FROM (SELECT id, email, role FROM users WHERE is_active = true AND role IN ('ADMIN', 'MANAGER', 'TUTORIAL_VA') ORDER BY CASE role WHEN 'ADMIN' THEN 0 ELSE 1 END, created_at LIMIT 1) x"], { encoding: "utf8" }).trim();
  if (!userJson) fail("no active authorized reviewer");
  const user = JSON.parse(userJson);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ userId: user.id, email: user.email, role: user.role, iat: now, exp: now + 120 }));
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  const cookie = `hub_session=${header}.${payload}.${signature}`;
  const curl = (path, binary = false) => execFileSync("curl", ["-fsS", "--max-time", "20", "-H", `Cookie: ${cookie}`, `http://127.0.0.1:3000${path}`], binary ? { maxBuffer: 20 * 1024 * 1024 } : { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  const bundle = JSON.parse(curl(`/api/production/jobs/${jobId}/thumbnail-bundle`));
  const selected = bundle.variants?.find((variant) => variant.id === jobId);
  if (!selected || selected.thumbnailId !== thumbnailId) fail("selected thumbnail identity mismatch");
  if (!selected.hasSelectedImage || selected.layout !== null) fail("selected flattened image is not review truth");
  if (JSON.stringify(selected.selectedHeadlineLines) !== JSON.stringify(["ADD A", "WITNESS"])) fail("selected three-word headline mismatch");
  if (selected.draftLayout !== null || selected.draftRevision !== 0) fail("phantom draft/unsaved state present");
  const logoName = String(bundle.softwareLogo?.name ?? "");
  const logoSubject = logoName.toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
  const decorative = new Set(["logo", "symbol", "icon", "mark", "badge", "png", "image"]);
  while (logoSubject.length > 1 && decorative.has(logoSubject.at(-1))) logoSubject.pop();
  if (logoSubject.join(" ") !== "docusign" || !bundle.softwareLogo?.url) fail("DocuSign software-logo match absent");
  const image = curl(`/api/thumbnails/image/${thumbnailId}`, true);
  const pngSha256 = crypto.createHash("sha256").update(image).digest("hex");
  if (pngSha256 !== expectedPngSha256) fail("selected image bytes mismatch");
  console.log(JSON.stringify({ authenticated: true, readOnly: true, jobId, thumbnailId, selectedHeadlineLines: selected.selectedHeadlineLines, selectedWordCount: selected.selectedHeadlineLines.join(" ").split(/\s+/).length, flattenedReviewTruth: true, draftLayout: null, draftRevision: 0, phantomUnsavedState: false, softwareLogo: { name: bundle.softwareLogo.name, urlPresent: true }, falseNoMatchingLogoWarning: false, pngSha256 }));
} catch (error) {
  if (error instanceof Error && error.message.startsWith("Candidate29 authenticated read-only gate failed:")) throw error;
  fail("probe execution error");
}
