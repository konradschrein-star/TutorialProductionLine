#!/usr/bin/env tsx
import { config } from "dotenv";
import { resolve } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import bcrypt from "bcryptjs";
import { users } from "./schema/users.js";

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env"), override: false });

const databaseUrl = process.env["DATABASE_URL"];
const email = process.env["TUTORIAL_VIEWER_EMAIL"]?.trim().toLowerCase();
const password = process.env["TUTORIAL_VIEWER_PASSWORD"];
const name = process.env["TUTORIAL_VIEWER_NAME"]?.trim() || "Tutorial Studio Viewer";

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!email) throw new Error("TUTORIAL_VIEWER_EMAIL is required");
if (!password || password.length < 12) {
  throw new Error("TUTORIAL_VIEWER_PASSWORD must contain at least 12 characters");
}

const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client);
try {
  const passwordHash = await bcrypt.hash(password, 12);
  await db
    .insert(users)
    .values({ email, name, role: "VIEWER", passwordHash, is_active: true })
    .onConflictDoUpdate({
      target: users.email,
      set: { name, role: "VIEWER", passwordHash, is_active: true, updated_at: new Date() },
    });
  console.log(`Read-only Tutorial Studio viewer ready: ${email}`);
} finally {
  await client.end();
}
