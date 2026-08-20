/**
 * Database singleton
 *
 * Provides a singleton Drizzle client for use by repositories.
 * Must be initialized before using repositories.
 *
 * Usage:
 * ```ts
 * import { initializeDb, getDb } from '@repo/db/singleton';
 *
 * // Initialize once at app startup
 * initializeDb(process.env.DATABASE_URL);
 *
 * // Then use in repositories
 * const db = getDb();
 * ```
 */

import { createDrizzleClient, type DrizzleClient } from "./client.js";

let dbInstance: DrizzleClient | null = null;

/**
 * Initialize the database singleton
 *
 * Must be called once before using any repositories.
 *
 * @param connectionString - PostgreSQL connection string
 */
export function initializeDb(connectionString: string): void {
  if (dbInstance) {
    console.warn("Database already initialized");
    return;
  }

  dbInstance = createDrizzleClient(connectionString);
}

/**
 * Get the database singleton instance
 *
 * @returns Drizzle client instance
 * @throws Error if database not initialized
 */
export function getDb(): DrizzleClient {
  if (!dbInstance) {
    throw new Error(
      "Database not initialized. Call initializeDb() first."
    );
  }

  return dbInstance;
}

/**
 * Reset the database singleton
 *
 * Only for testing purposes.
 */
export function resetDb(): void {
  dbInstance = null;
}
