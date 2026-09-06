#!/usr/bin/env tsx
import { config } from "dotenv";
import { resolve } from "node:path";
import { SignJWT } from "jose";
import postgres from "postgres";

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env.local"), override: false });
const databaseUrl = process.env["DATABASE_URL"];
const jwtSecret = process.env["JWT_SECRET"];
const email =
  process.env["TUTORIAL_VIEWER_EMAIL"] ?? "omar.viewer@tutorialstudio.local";
const baseArgIndex = process.argv.indexOf("--base-url");
const base =
  (baseArgIndex >= 0 ? process.argv[baseArgIndex + 1] : undefined) ??
  process.env["SMOKE_BASE_URL"] ??
  "http://127.0.0.1:3000";
if (!databaseUrl || !jwtSecret)
  throw new Error("DATABASE_URL and JWT_SECRET are required");

const sql = postgres(databaseUrl, { max: 1 });
try {
  const [viewer] = await sql<
    { id: string; role: string }[]
  >`select id, role from users where email = ${email} limit 1`;
  if (!viewer) throw new Error(`Viewer not found: ${email}`);
  const token = await new SignJWT({
    userId: viewer.id,
    role: viewer.role,
    email,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(jwtSecret));
  const headers = { cookie: `hub_session=${token}` };
  for (const path of [
    "/dashboard",
    "/tutorial-studio",
    "/thumbnails",
    "/channels",
    "/team",
    "/system-health",
    "/settings",
  ]) {
    const response = await fetch(`${base}${path}`, {
      headers,
      redirect: "manual",
    });
    if (response.status !== 200)
      throw new Error(`${path} returned ${response.status}`);
    if (path === "/settings") {
      const html = await response.text();
      if (
        !html.includes("Handoff checklist") ||
        !html.includes("YouTube uploader")
      ) {
        throw new Error(
          "Settings page is missing the handoff/uploader controls",
        );
      }
    }
    console.log(`GET ${path} 200`);
  }
  const denied = await fetch(`${base}/api/thumbnails/assets`, {
    method: "POST",
    headers,
  });
  if (denied.status !== 403)
    throw new Error(
      `Viewer write guard returned ${denied.status}, expected 403`,
    );
  console.log("Viewer mutation guard 403");

  const oauthDenied = await fetch(`${base}/api/storage/drive/oauth/start`, {
    headers,
    redirect: "manual",
  });
  if (oauthDenied.status !== 403)
    throw new Error(
      `Viewer Drive OAuth guard returned ${oauthDenied.status}, expected 403`,
    );
  console.log("Viewer Drive OAuth guard 403");

  for (const path of [
    "/api/production/uploader-config",
    "/api/production/uploader-jobs",
  ]) {
    const unauthorized = await fetch(`${base}${path}`);
    if (unauthorized.status !== 401)
      throw new Error(`${path} returned ${unauthorized.status}, expected 401`);
    console.log(`GET ${path} unauthenticated 401`);
  }
} finally {
  await sql.end();
}
