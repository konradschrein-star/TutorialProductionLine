/**
 * Transaction utilities
 *
 * Provides transaction support for database operations.
 * All repositories should use these utilities for multi-step operations
 * to ensure atomicity.
 *
 * Usage:
 * ```ts
 * import { withTransaction } from './transaction';
 *
 * const result = await withTransaction(async (tx) => {
 *   await tx.insert(contentJobs).values(...);
 *   await tx.insert(systemEvents).values(...);
 *   return { success: true };
 * });
 * ```
 */

import { getDb } from "../singleton.js";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type { ExtractTablesWithRelations } from "drizzle-orm";

// Type alias for the transaction object
export type Transaction = PgTransaction<
  PostgresJsQueryResultHKT,
  Record<string, never>,
  ExtractTablesWithRelations<Record<string, never>>
>;

/**
 * Execute a function within a database transaction
 *
 * Automatically commits on success and rolls back on error.
 *
 * @param fn - Function to execute within the transaction
 * @returns Result of the function
 * @throws Error if transaction fails
 */
export async function withTransaction<T>(
  fn: (tx: Transaction) => Promise<T>
): Promise<T> {
  const db = getDb();

  return await db.transaction(async (tx) => {
    return await fn(tx as unknown as Transaction);
  });
}

/**
 * Check if a value is a transaction object
 *
 * Useful for repositories that can work with either a transaction or the main db instance.
 *
 * @param dbOrTx - Database or transaction instance
 * @returns True if it's a transaction
 */
export function isTransaction(
  dbOrTx: unknown
): dbOrTx is Transaction {
  // Transaction objects have a `transaction` method, regular db objects have it too
  // But transactions have a `rollback` method
  return (
    typeof dbOrTx === "object" &&
    dbOrTx !== null &&
    "rollback" in dbOrTx &&
    typeof (dbOrTx as any).rollback === "function"
  );
}

/**
 * Get the database instance to use
 *
 * Returns the transaction if provided, otherwise returns the main db instance.
 * Allows repositories to work with or without transactions.
 *
 * @param tx - Optional transaction instance
 * @returns Database or transaction instance
 */
export function getDbOrTx(tx?: Transaction): any {
  return tx || getDb();
}
