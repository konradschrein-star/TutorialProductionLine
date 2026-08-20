import { createDrizzleClient, type DrizzleClient } from "@repo/db";
import { initializeDb } from "@repo/db/singleton";
import { getHubConfig } from "./config";

/**
 * PostgreSQL connection singleton for Hub Web
 *
 * Uses Drizzle ORM with postgres.js driver from @repo/db
 * Connection pooling is managed automatically by postgres.js
 */

// Create Drizzle client
const config = getHubConfig();
export const db: DrizzleClient = createDrizzleClient(config.DATABASE_URL);

// Also register with the package's singleton so repos that resolve
// the db via getDb() (e.g. @repo/db/repositories/clip-libraries)
// work from server components / route handlers without each caller
// passing a transaction. Module load runs once per process.
initializeDb(config.DATABASE_URL);

/**
 * Type export for inferring types from schema
 */
export type Database = DrizzleClient;

/**
 * Re-export all schema entities for convenience
 */
export * from "@repo/db";
