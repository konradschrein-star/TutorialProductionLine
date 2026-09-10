#!/usr/bin/env tsx
/**
 * Database Seed Script
 *
 * Populates the database with test users for development and testing.
 * All passwords are bcrypt-hashed with 10 rounds.
 *
 * Usage:
 *   pnpm --filter @repo/db seed
 *   OR
 *   tsx packages/db/src/seed.ts
 *
 * Test Users:
 * - admin@content-forge.com / admin123 (ADMIN)
 * - manager@content-forge.com / manager123 (MANAGER)
 * - va-prod@content-forge.com / va1234 (PRODUCTION_VA)
 * - va-upload@content-forge.com / va1234 (UPLOADER_VA)
 * - investor@content-forge.com / view1234 (VIEWER)
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { users } from "./schema/users.js";
import { eq } from "drizzle-orm";
import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from monorepo root (three levels up: db/src/seed.ts -> db/src -> db -> root)
const envPath = resolve(__dirname, "../../../.env");
config({ path: envPath });

console.log(`[seed] Loading .env from: ${envPath}`);

// Load environment
import { loadConfig, getConfig } from "@repo/config";

async function seed() {
  console.log("[seed] Starting database seed...");

  // Load and validate config
  try {
    loadConfig();
  } catch (error) {
    console.error("[seed] Failed to load config:", error);
    process.exit(1);
  }

  const config = getConfig();
  const { DATABASE_URL } = config;

  // Connect to database
  const sql = postgres(DATABASE_URL);
  const db = drizzle(sql);

  console.log("[seed] Connected to database");

  // Define test users
  const testUsers = [
    {
      email: "admin@content-forge.com",
      name: "Admin User",
      role: "ADMIN" as const,
      password: "admin123",
    },
    {
      email: "omar@tutorialstudio.com",
      name: "Omar",
      role: "ADMIN" as const,
      password: "admin123",
    },
    {
      email: "jeen@tutorialstudio.com",
      name: "Jeen",
      role: "ADMIN" as const,
      password: "admin123",
    },
    {
      email: "nalu@tutorialstudio.com",
      name: "Nalu",
      role: "TUTORIAL_VA" as const,
      password: "va1234",
    },
    {
      email: "lorraine@tutorialstudio.com",
      name: "Lorraine",
      role: "TUTORIAL_VA" as const,
      password: "va1234",
    },
    {
      email: "manager@content-forge.com",
      name: "Manager User",
      role: "MANAGER" as const,
      password: "manager123",
    },
    {
      email: "va-prod@content-forge.com",
      name: "Production VA",
      role: "PRODUCTION_VA" as const,
      password: "va1234",
    },
    {
      email: "va-upload@content-forge.com",
      name: "Uploader VA",
      role: "UPLOADER_VA" as const,
      password: "va1234",
    },
    {
      email: "investor@content-forge.com",
      name: "Investor (Viewer)",
      role: "VIEWER" as const,
      password: "view1234",
    },
  ];

  console.log("[seed] Deleting existing test users...");

  // Delete existing test users to avoid conflicts
  for (const user of testUsers) {
    await db.delete(users).where(eq(users.email, user.email));
  }

  console.log("[seed] Creating test users with bcrypt-hashed passwords...");

  // Create users with hashed passwords
  for (const user of testUsers) {
    const passwordHash = await bcrypt.hash(user.password, 10);

    await db.insert(users).values({
      email: user.email,
      name: user.name,
      role: user.role,
      passwordHash,
      is_active: true,
    });

    console.log(`[seed] Created user: ${user.email} (${user.role})`);
  }

  // Production identities never belong in a repository seed. Create or reset
  // those accounts through the authenticated Admin flow so plaintext
  // credentials cannot be committed, logged, or reapplied by a seed rerun.

  console.log("[seed] Seed completed successfully!");
  console.log("\nTest user credentials:");
  console.log("┌─────────────────────────────────┬──────────────┬─────────────────┐");
  console.log("│ Email                           │ Password     │ Role            │");
  console.log("├─────────────────────────────────┼──────────────┼─────────────────┤");
  for (const user of testUsers) {
    console.log(
      `│ ${user.email.padEnd(31)} │ ${user.password.padEnd(12)} │ ${user.role.padEnd(15)} │`
    );
  }
  console.log("└─────────────────────────────────┴──────────────┴─────────────────┘");

  // Close connection
  await sql.end();
  process.exit(0);
}

// Run seed
seed().catch((error) => {
  console.error("[seed] Fatal error:", error);
  process.exit(1);
});
