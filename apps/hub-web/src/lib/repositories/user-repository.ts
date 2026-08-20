import { eq } from 'drizzle-orm';
import { db, users } from '../db';
import type { OperatorRole } from '@repo/contracts';

/**
 * User Repository
 *
 * Data access layer for user operations.
 * Handles database queries for authentication and user management.
 */

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Find a user by email
 *
 * @param email - User email address
 * @returns User if found, null otherwise
 */
export async function findUserByEmail(
  email: string
): Promise<User | null> {
  const result = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  const user = result[0];
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.is_active,
    passwordHash: user.passwordHash,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

/**
 * Find a user by ID
 *
 * @param id - User ID
 * @returns User if found, null otherwise
 */
export async function findUserById(id: string): Promise<User | null> {
  const result = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  const user = result[0];
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.is_active,
    passwordHash: user.passwordHash,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

/**
 * Create a new user
 *
 * @param data - User data
 * @returns Created user
 */
export async function createUser(data: {
  email: string;
  name: string;
  role: OperatorRole;
  passwordHash: string;
}): Promise<User> {
  const result = await db
    .insert(users)
    .values({
      email: data.email,
      name: data.name,
      role: data.role,
      passwordHash: data.passwordHash,
      is_active: true,
    })
    .returning();

  const user = result[0];
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.is_active,
    passwordHash: user.passwordHash,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

/**
 * Update a user's password
 *
 * @param userId - User ID
 * @param passwordHash - New password hash
 */
export async function updateUserPassword(
  userId: string,
  passwordHash: string
): Promise<void> {
  await db
    .update(users)
    .set({
      passwordHash,
      updated_at: new Date(),
    })
    .where(eq(users.id, userId));
}
